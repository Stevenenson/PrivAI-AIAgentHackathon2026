"""Local file conversion helpers.

The converter never calls external APIs. It uses local command-line tools:
- macOS `sips` for image conversions, including PNG -> HEIC when supported.
- LibreOffice/soffice for Office documents and presentations -> PDF.
"""
from __future__ import annotations

import mimetypes
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


class ConversionError(Exception):
    """Raised when a requested conversion cannot be completed locally."""


@dataclass
class ConvertedFile:
    name: str
    mime: str
    data: bytes


_FORMAT_ALIASES = {
    "jpg": "jpeg",
    "jpeg": "jpeg",
    "png": "png",
    "heic": "heic",
    "heif": "heif",
    "webp": "webp",
    "tif": "tiff",
    "tiff": "tiff",
    "gif": "gif",
    "bmp": "bmp",
    "ico": "ico",
    "pdf": "pdf",
}

_OUTPUT_EXT = {
    "jpeg": "jpg",
    "tiff": "tiff",
}

_IMAGE_INPUT_EXTS = {
    ".avif", ".bmp", ".gif", ".heic", ".heif", ".ico", ".jpeg", ".jpg",
    ".png", ".tif", ".tiff", ".webp",
}

_SIPS_IMAGE_TARGETS = {
    "avif", "bmp", "gif", "heic", "ico", "jpeg", "pdf", "png", "tiff",
}

_OFFICE_TO_PDF_EXTS = {
    ".doc", ".docx", ".odp", ".ods", ".odt", ".pot", ".potx", ".pps",
    ".ppsx", ".ppt", ".pptx", ".rtf", ".xls", ".xlsx",
}


def parse_target_format(instruction: str) -> str | None:
    text = (instruction or "").lower()
    explicit = re.search(
        r"\b(?:to|as|into|format)\s+\.?([a-z0-9]{2,5})\b",
        text,
    )
    if explicit:
        return _FORMAT_ALIASES.get(explicit.group(1))

    for raw, normalized in _FORMAT_ALIASES.items():
        if re.search(rf"\b{re.escape(raw)}\b", text):
            return normalized
    return None


def convert_files(files: list[dict], instruction: str) -> tuple[list[ConvertedFile], list[str]]:
    target = parse_target_format(instruction)
    if not target:
        raise ConversionError(
            "Tell me the target format, for example: `to heic` or `to pdf`."
        )
    if not files:
        raise ConversionError("Attach at least one file to convert.")

    converted: list[ConvertedFile] = []
    failures: list[str] = []
    for item in files:
        try:
            converted.append(convert_one(item, target))
        except ConversionError as e:
            failures.append(f"{item.get('name', 'file')}: {e}")

    if not converted and failures:
        raise ConversionError("; ".join(failures))
    return converted, failures


def convert_one(item: dict, target: str) -> ConvertedFile:
    path = Path(str(item["path"]))
    if not path.exists():
        raise ConversionError("file is missing on disk")

    suffix = path.suffix.lower()
    source_name = str(item.get("name") or path.name)
    if _is_image(item, suffix) and target in _SIPS_IMAGE_TARGETS:
        return _convert_image_with_sips(path, source_name, target)

    if suffix in _OFFICE_TO_PDF_EXTS and target == "pdf":
        return _convert_office_to_pdf(path, source_name)

    if suffix in _OFFICE_TO_PDF_EXTS:
        raise ConversionError("Office files can currently be converted to PDF only")
    if target == "pdf" and not _is_image(item, suffix):
        raise ConversionError("PDF output is supported for images and Office files")
    raise ConversionError(f"conversion to {target.upper()} is not supported for this file")


def _is_image(item: dict, suffix: str) -> bool:
    mime = str(item.get("mime") or "").lower()
    return mime.startswith("image/") or suffix in _IMAGE_INPUT_EXTS


def _convert_image_with_sips(path: Path, source_name: str, target: str) -> ConvertedFile:
    sips = shutil.which("sips")
    if not sips:
        raise ConversionError("macOS `sips` is not installed")

    out_name = _output_name(source_name, target)
    with tempfile.TemporaryDirectory(prefix="privai-convert-") as tmp:
        out_path = Path(tmp) / out_name
        proc = subprocess.run(
            [sips, "-s", "format", target, str(path), "--out", str(out_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=120,
            check=False,
        )
        if proc.returncode != 0 or not out_path.exists():
            msg = (proc.stderr or proc.stdout or "sips conversion failed").strip()
            raise ConversionError(msg)
        return ConvertedFile(out_name, _mime_for(target, out_name), out_path.read_bytes())


def _convert_office_to_pdf(path: Path, source_name: str) -> ConvertedFile:
    office = shutil.which("soffice") or shutil.which("libreoffice")
    if not office:
        raise ConversionError(
            "LibreOffice/soffice is not installed, so PowerPoint/Office to PDF is unavailable"
        )

    with tempfile.TemporaryDirectory(prefix="privai-office-") as tmp:
        proc = subprocess.run(
            [
                office,
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                tmp,
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=180,
            check=False,
        )
        out_path = Path(tmp) / f"{path.stem}.pdf"
        if proc.returncode != 0 or not out_path.exists():
            msg = (proc.stderr or proc.stdout or "LibreOffice conversion failed").strip()
            raise ConversionError(msg)
        return ConvertedFile(_output_name(source_name, "pdf"), "application/pdf", out_path.read_bytes())


def _output_name(source_name: str, target: str) -> str:
    ext = _OUTPUT_EXT.get(target, target)
    stem = Path(source_name).stem or "converted"
    return f"{stem}.{ext}"


def _mime_for(target: str, name: str) -> str:
    if target == "heic":
        return "image/heic"
    if target == "heif":
        return "image/heif"
    if target == "pdf":
        return "application/pdf"
    guessed, _ = mimetypes.guess_type(name)
    return guessed or "application/octet-stream"
