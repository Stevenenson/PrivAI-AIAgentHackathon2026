"""Attachment storage + text extraction.

Files live under data/attachments/{owner_uid}/{attachment_id}/{name}. Plain text
files (mime starting with text/, plus a small whitelist of source-code mime
types) are read up to TEXT_PREVIEW_BYTES and stored as text_excerpt so /chat
can embed them in the prompt without re-reading the file each turn.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from .config import settings

TEXT_PREVIEW_BYTES = 50_000  # ~12.5k tokens worst case
MAX_UPLOAD_BYTES = int(
    os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))
)  # local-only default, large enough for small presentations

_TEXT_MIME_WHITELIST = {
    "application/json",
    "application/javascript",
    "application/x-yaml",
    "application/yaml",
    "application/xml",
    "application/x-sh",
    "application/x-python",
    "application/x-tex",
    "application/x-typescript",
    "application/sql",
}

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(raw: str) -> str:
    name = _SAFE_NAME.sub("_", raw.strip()) or "file"
    return name[:200]


def attachments_root() -> Path:
    base = Path(settings.cache_dir).resolve().parent / "attachments"
    base.mkdir(parents=True, exist_ok=True)
    return base


def store_bytes(owner_uid: str, name: str, data: bytes, mime: str) -> tuple[str, str | None]:
    """Returns (path, text_excerpt) — text_excerpt is None for binaries.

    Owner_uid is sandboxed in the path; we also hash for collision safety.
    """
    h = hashlib.sha256(data).hexdigest()[:16]
    safe = safe_filename(name)
    folder = attachments_root() / owner_uid / h
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / safe
    with open(path, "wb") as f:
        f.write(data)

    text_excerpt: str | None = None
    if _is_pdf(mime, name):
        text_excerpt = _extract_pdf_text(path)
    elif _is_docx(mime, name):
        text_excerpt = _extract_docx_text(path)
    elif _is_text(mime, name):
        try:
            text_excerpt = data[:TEXT_PREVIEW_BYTES].decode("utf-8", errors="replace")
        except Exception:
            text_excerpt = None
    return str(path), text_excerpt


def _is_pdf(mime: str, name: str) -> bool:
    return (mime or "").lower() == "application/pdf" or name.lower().endswith(".pdf")


def _is_docx(mime: str, name: str) -> bool:
    m = (mime or "").lower()
    return (
        m == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or name.lower().endswith(".docx")
    )


def _extract_pdf_text(path: Path) -> str | None:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        return None
    try:
        proc = subprocess.run(
            [pdftotext, "-layout", str(path), "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except Exception:
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    return proc.stdout[:TEXT_PREVIEW_BYTES].decode("utf-8", errors="replace")


def _extract_docx_text(path: Path) -> str | None:
    try:
        with zipfile.ZipFile(path) as docx:
            raw = docx.read("word/document.xml")
    except Exception:
        return None
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return None

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for para in root.findall(".//w:p", ns):
        chunks = [node.text or "" for node in para.findall(".//w:t", ns)]
        text = "".join(chunks).strip()
        if text:
            paragraphs.append(text)
    if not paragraphs:
        return None
    return "\n".join(paragraphs)[:TEXT_PREVIEW_BYTES]


def _is_text(mime: str, name: str) -> bool:
    m = (mime or "").lower()
    if m.startswith("text/"):
        return True
    if m in _TEXT_MIME_WHITELIST:
        return True
    # Heuristic by extension for generated output, .md notes, etc.
    ext = os.path.splitext(name.lower())[1]
    if ext in {
        ".md", ".txt", ".py", ".ts", ".tsx", ".js", ".jsx", ".json",
        ".yaml", ".yml", ".xml", ".html", ".htm", ".css", ".sh", ".sql",
        ".csv", ".tsv", ".log", ".rs", ".go", ".java", ".kt", ".c",
        ".cpp", ".h", ".hpp", ".rb", ".php", ".swift", ".m", ".mm",
        ".env", ".cfg", ".ini", ".toml",
    }:
        return True
    return False


def build_attachment_block(items: list[dict]) -> str:
    """Convert a list of {name, mime, size, text_excerpt} dicts into the prompt
    block that gets prepended to the user message."""
    if not items:
        return ""
    parts = []
    for it in items:
        name = it["name"]
        mime = it["mime"]
        size = it["size"]
        text = it.get("text_excerpt") or ""
        if text:
            parts.append(
                f"=== {name} ({mime}, {size} bytes) ===\n{text}\n=== end {name} ==="
            )
        else:
            parts.append(
                f"=== {name} ({mime}, {size} bytes) ===\n"
                f"[binary or non-text file, content not embedded]\n"
                f"=== end {name} ==="
            )
    return "\n\n".join(parts)
