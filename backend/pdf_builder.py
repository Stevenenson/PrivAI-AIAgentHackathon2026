"""Small local PDF builder.

This intentionally avoids cloud APIs and heavyweight Python dependencies. It
renders Markdown-like text plus attached JPEG/PNG images into a simple,
downloadable PDF using only the Python standard library.
"""
from __future__ import annotations

import re
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from textwrap import wrap


class PdfBuildError(Exception):
    """Raised when a local PDF document cannot be created."""


@dataclass
class ImageData:
    name: str
    width: int
    height: int
    color_space: str
    bits: int
    pdf_filter: str
    data: bytes


def filename_from_title(title: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9]+", "-", title.strip()).strip("-").lower()
    return f"{(stem or 'privai-document')[:80]}.pdf"


def render_markdown_pdf(
    title: str,
    markdown: str,
    image_rows: list[dict] | None = None,
) -> bytes:
    doc = _PdfDocument(title or "Privai document")
    doc.add_markdown(markdown or title or "Generated PDF")
    rows = image_rows or []
    images = []
    for row in rows:
        try:
            images.append(_load_image(row))
        except Exception as e:
            doc.add_paragraph(
                f"Skipped image {row.get('name', 'attachment')}: {e}",
                size=9,
                color=(0.55, 0.2, 0.05),
            )
    if images:
        doc.add_heading("Attached images", level=2)
        for img in images:
            doc.add_image(img)
    return doc.to_bytes()


class _PdfDocument:
    width = 595.28
    height = 841.89
    margin = 54.0

    def __init__(self, title: str):
        self.title = title
        self.pages: list[dict] = []
        self.images: list[tuple[str, ImageData]] = []
        self._new_page()
        self.add_heading(title, level=1)

    def _new_page(self) -> None:
        self.pages.append({"ops": [], "images": []})
        self.y = self.height - self.margin

    @property
    def _ops(self) -> list[str]:
        return self.pages[-1]["ops"]

    def _ensure_space(self, needed: float) -> None:
        if self.y - needed < self.margin:
            self._new_page()

    def add_heading(self, text: str, level: int = 2) -> None:
        clean = _clean_text(text)
        if not clean:
            return
        size = 24 if level == 1 else 16
        leading = size + 8
        self._ensure_space(leading * 2)
        color = (0.06, 0.08, 0.12) if level == 1 else (0.12, 0.18, 0.32)
        for line in _wrap_text(clean, size, self.width - self.margin * 2):
            self._text(line, self.margin, self.y, size=size, color=color)
            self.y -= leading
        self.y -= 6 if level == 1 else 2

    def add_paragraph(
        self,
        text: str,
        *,
        size: float = 11,
        indent: float = 0,
        color: tuple[float, float, float] = (0.17, 0.2, 0.27),
    ) -> None:
        clean = _clean_text(text)
        if not clean:
            self.y -= 6
            return
        max_width = self.width - self.margin * 2 - indent
        lines = _wrap_text(clean, size, max_width)
        line_height = size * 1.45
        self._ensure_space(line_height * max(1, len(lines)) + 4)
        for line in lines:
            self._text(line, self.margin + indent, self.y, size=size, color=color)
            self.y -= line_height
        self.y -= 4

    def add_bullet(self, text: str) -> None:
        self._ensure_space(24)
        self._text("-", self.margin, self.y, size=11, color=(0.10, 0.32, 0.78))
        self.add_paragraph(text, size=11, indent=18)

    def add_markdown(self, markdown: str) -> None:
        for raw in markdown.splitlines():
            line = raw.strip()
            if not line:
                self.y -= 8
                continue
            if line.startswith("# "):
                self.add_heading(line[2:], level=1)
            elif line.startswith("## "):
                self.add_heading(line[3:], level=2)
            elif line.startswith("### "):
                self.add_heading(line[4:], level=2)
            elif line.startswith(("- ", "* ")):
                self.add_bullet(line[2:])
            else:
                self.add_paragraph(line)

    def add_image(self, image: ImageData) -> None:
        name = f"Im{len(self.images) + 1}"
        self.images.append((name, image))
        max_width = self.width - self.margin * 2
        max_height = 300.0
        scale = min(max_width / image.width, max_height / image.height, 1.0)
        draw_w = image.width * scale
        draw_h = image.height * scale
        self._ensure_space(draw_h + 42)
        x = self.margin + (max_width - draw_w) / 2
        self._ops.append(f"q {draw_w:.2f} 0 0 {draw_h:.2f} {x:.2f} {self.y - draw_h:.2f} cm /{name} Do Q")
        self.pages[-1]["images"].append(name)
        self.y -= draw_h + 10
        self.add_paragraph(image.name, size=9, color=(0.38, 0.43, 0.50))

    def _text(
        self,
        text: str,
        x: float,
        y: float,
        *,
        size: float,
        color: tuple[float, float, float],
    ) -> None:
        r, g, b = color
        self._ops.append(
            f"{r:.3f} {g:.3f} {b:.3f} rg BT /F1 {size:.2f} Tf 1 0 0 1 "
            f"{x:.2f} {y:.2f} Tm ({_pdf_string(text)}) Tj ET"
        )

    def to_bytes(self) -> bytes:
        writer = _ObjectWriter()
        font_id = writer.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        pages_id = writer.reserve()

        image_obj_ids: dict[str, int] = {}
        for name, image in self.images:
            image_obj_ids[name] = writer.add(_image_object(image))

        page_ids: list[int] = []
        for page in self.pages:
            content = "\n".join(page["ops"]).encode("latin-1", "replace")
            content_id = writer.add(
                b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n"
                + content
                + b"\nendstream"
            )
            xobjects = []
            for name in page["images"]:
                obj_id = image_obj_ids.get(name)
                if obj_id:
                    xobjects.append(f"/{name} {obj_id} 0 R")
            resources = f"<< /Font << /F1 {font_id} 0 R >>"
            if xobjects:
                resources += f" /XObject << {' '.join(xobjects)} >>"
            resources += " >>"
            page_id = writer.add(
                (
                    f"<< /Type /Page /Parent {pages_id} 0 R "
                    f"/MediaBox [0 0 {self.width:.2f} {self.height:.2f}] "
                    f"/Resources {resources} /Contents {content_id} 0 R >>"
                ).encode("latin-1")
            )
            page_ids.append(page_id)

        kids = " ".join(f"{pid} 0 R" for pid in page_ids)
        writer.set(
            pages_id,
            f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("latin-1"),
        )
        catalog_id = writer.add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("latin-1"))
        return writer.finish(catalog_id)


class _ObjectWriter:
    def __init__(self) -> None:
        self.objects: list[bytes | None] = []

    def reserve(self) -> int:
        self.objects.append(None)
        return len(self.objects)

    def add(self, obj: bytes) -> int:
        self.objects.append(obj)
        return len(self.objects)

    def set(self, obj_id: int, obj: bytes) -> None:
        self.objects[obj_id - 1] = obj

    def finish(self, root_id: int) -> bytes:
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for i, obj in enumerate(self.objects, start=1):
            if obj is None:
                raise PdfBuildError(f"PDF object {i} was not written")
            offsets.append(len(out))
            out.extend(f"{i} 0 obj\n".encode("ascii"))
            out.extend(obj)
            out.extend(b"\nendobj\n")
        xref = len(out)
        out.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
        out.extend(b"0000000000 65535 f \n")
        for off in offsets[1:]:
            out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
        out.extend(
            (
                f"trailer\n<< /Size {len(offsets)} /Root {root_id} 0 R >>\n"
                f"startxref\n{xref}\n%%EOF\n"
            ).encode("ascii")
        )
        return bytes(out)


def _clean_text(text: str) -> str:
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def _wrap_text(text: str, size: float, max_width: float) -> list[str]:
    chars = max(24, int(max_width / (size * 0.52)))
    return wrap(text, width=chars, replace_whitespace=True, drop_whitespace=True) or [""]


def _pdf_string(text: str) -> str:
    encoded = text.encode("latin-1", "replace").decode("latin-1")
    return encoded.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _image_object(image: ImageData) -> bytes:
    header = (
        f"<< /Type /XObject /Subtype /Image /Width {image.width} "
        f"/Height {image.height} /ColorSpace /{image.color_space} "
        f"/BitsPerComponent {image.bits} /Filter /{image.pdf_filter} "
        f"/Length {len(image.data)} >>\nstream\n"
    ).encode("latin-1")
    return header + image.data + b"\nendstream"


def _load_image(row: dict) -> ImageData:
    path = Path(str(row["path"]))
    raw = path.read_bytes()
    name = str(row.get("name") or path.name)
    mime = str(row.get("mime") or "").lower()
    if mime in {"image/jpeg", "image/jpg"} or raw[:2] == b"\xff\xd8":
        width, height, components = _jpeg_size(raw)
        return ImageData(
            name=name,
            width=width,
            height=height,
            color_space="DeviceGray" if components == 1 else "DeviceRGB",
            bits=8,
            pdf_filter="DCTDecode",
            data=raw,
        )
    if mime == "image/png" or raw.startswith(b"\x89PNG\r\n\x1a\n"):
        width, height, rgb = _png_to_rgb(raw)
        return ImageData(
            name=name,
            width=width,
            height=height,
            color_space="DeviceRGB",
            bits=8,
            pdf_filter="FlateDecode",
            data=zlib.compress(rgb),
        )
    raise PdfBuildError("only JPEG and PNG images can be embedded in generated PDFs")


def _jpeg_size(raw: bytes) -> tuple[int, int, int]:
    if raw[:2] != b"\xff\xd8":
        raise PdfBuildError("not a JPEG file")
    i = 2
    while i < len(raw):
        if raw[i] != 0xFF:
            i += 1
            continue
        marker = raw[i + 1]
        i += 2
        if marker in {0xD8, 0xD9}:
            continue
        if i + 2 > len(raw):
            break
        length = struct.unpack(">H", raw[i : i + 2])[0]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB}:
            if i + 8 > len(raw):
                break
            height = struct.unpack(">H", raw[i + 3 : i + 5])[0]
            width = struct.unpack(">H", raw[i + 5 : i + 7])[0]
            components = raw[i + 7]
            return width, height, components
        i += length
    raise PdfBuildError("could not read JPEG dimensions")


def _png_to_rgb(raw: bytes) -> tuple[int, int, bytes]:
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise PdfBuildError("not a PNG file")
    pos = 8
    width = height = bit_depth = color_type = None
    palette: list[tuple[int, int, int]] = []
    transparency: bytes = b""
    idat = bytearray()

    while pos + 8 <= len(raw):
        length = struct.unpack(">I", raw[pos : pos + 4])[0]
        kind = raw[pos + 4 : pos + 8]
        data = raw[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filter, interlace = struct.unpack(
                ">IIBBBBB", data
            )
            if interlace:
                raise PdfBuildError("interlaced PNG images are not supported")
            if bit_depth != 8:
                raise PdfBuildError("only 8-bit PNG images are supported")
        elif kind == b"PLTE":
            palette = [
                (data[i], data[i + 1], data[i + 2])
                for i in range(0, len(data) - 2, 3)
            ]
        elif kind == b"tRNS":
            transparency = data
        elif kind == b"IDAT":
            idat.extend(data)
        elif kind == b"IEND":
            break

    if width is None or height is None or bit_depth is None or color_type is None:
        raise PdfBuildError("invalid PNG metadata")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if not channels:
        raise PdfBuildError("unsupported PNG color type")

    scanline = width * channels
    decompressed = zlib.decompress(bytes(idat))
    rows: list[bytes] = []
    prev = bytearray(scanline)
    offset = 0
    bpp = channels
    for _ in range(height):
        filter_type = decompressed[offset]
        offset += 1
        cur = bytearray(decompressed[offset : offset + scanline])
        offset += scanline
        _unfilter(cur, prev, filter_type, bpp)
        rows.append(bytes(cur))
        prev = cur

    rgb = bytearray()
    for row in rows:
        if color_type == 0:
            for gray in row:
                rgb.extend((gray, gray, gray))
        elif color_type == 2:
            rgb.extend(row)
        elif color_type == 3:
            for idx in row:
                r, g, b = palette[idx] if idx < len(palette) else (255, 255, 255)
                alpha = transparency[idx] if idx < len(transparency) else 255
                rgb.extend(_over_white(r, g, b, alpha))
        elif color_type == 4:
            for i in range(0, len(row), 2):
                gray, alpha = row[i], row[i + 1]
                rgb.extend(_over_white(gray, gray, gray, alpha))
        elif color_type == 6:
            for i in range(0, len(row), 4):
                rgb.extend(_over_white(row[i], row[i + 1], row[i + 2], row[i + 3]))

    return width, height, bytes(rgb)


def _unfilter(cur: bytearray, prev: bytearray, filter_type: int, bpp: int) -> None:
    if filter_type == 0:
        return
    for i, raw in enumerate(cur):
        left = cur[i - bpp] if i >= bpp else 0
        up = prev[i]
        up_left = prev[i - bpp] if i >= bpp else 0
        if filter_type == 1:
            val = raw + left
        elif filter_type == 2:
            val = raw + up
        elif filter_type == 3:
            val = raw + ((left + up) // 2)
        elif filter_type == 4:
            val = raw + _paeth(left, up, up_left)
        else:
            raise PdfBuildError("invalid PNG filter")
        cur[i] = val & 0xFF


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _over_white(r: int, g: int, b: int, alpha: int) -> tuple[int, int, int]:
    if alpha >= 255:
        return r, g, b
    if alpha <= 0:
        return 255, 255, 255
    return (
        int((r * alpha + 255 * (255 - alpha)) / 255),
        int((g * alpha + 255 * (255 - alpha)) / 255),
        int((b * alpha + 255 * (255 - alpha)) / 255),
    )
