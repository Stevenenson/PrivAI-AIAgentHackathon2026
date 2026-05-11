"""Artifact extraction.

The agent system prompt asks the model to wrap any built thing in
<artifact type="html" title="...">...</artifact>. We pull that out so the
web app can render it in a sandboxed iframe instead of just showing the raw
HTML in the chat bubble.
"""
from __future__ import annotations

import re

_ARTIFACT_OPEN = re.compile(
    r"<artifact\b([^>]*)>", re.IGNORECASE,
)
_ARTIFACT_CLOSE = re.compile(r"</artifact>", re.IGNORECASE)
_HTML_CLOSE = re.compile(r"</html\s*>", re.IGNORECASE)
_HTML_DOC = re.compile(r"^\s*(?:<!doctype\s+html\b|<html\b)", re.IGNORECASE)
_ATTR = re.compile(r'(\w+)\s*=\s*"([^"]*)"', re.IGNORECASE)


def _count_open(text: str, tag: str) -> int:
    return len(re.findall(rf"<{tag}\b", text, re.IGNORECASE))


def _count_close(text: str, tag: str) -> int:
    return len(re.findall(rf"</{tag}\s*>", text, re.IGNORECASE))


def _repair_html(content: str) -> str | None:
    """Best-effort salvage for local models that stop mid-artifact.

    A truncated artifact is still better rendered as a downloadable preview
    than dumped into the chat as raw HTML. We only repair obvious full HTML
    documents, trim a dangling partial tag, and close common containers.
    """
    html = content.strip()
    if not html or not _HTML_DOC.search(html):
        return None

    last_lt = html.rfind("<")
    last_gt = html.rfind(">")
    if last_lt > last_gt:
        html = html[:last_lt].rstrip()

    for tag in ("style", "script", "svg"):
        if _count_open(html, tag) > _count_close(html, tag):
            html += f"\n</{tag}>"

    if _count_open(html, "body") > _count_close(html, "body"):
        html += "\n</body>"
    if _count_open(html, "html") > _count_close(html, "html"):
        html += "\n</html>"

    return html


def _visible_html_text_len(html: str) -> int:
    body = re.search(r"<body\b[^>]*>(.*?)(?:</body\s*>|</html\s*>|$)", html, re.IGNORECASE | re.DOTALL)
    if body:
        fragment = body.group(1)
    else:
        head = re.search(r"</head\s*>(.*?)(?:</html\s*>|$)", html, re.IGNORECASE | re.DOTALL)
        fragment = head.group(1) if head else html
    fragment = re.sub(r"<(?:style|script|svg)\b.*?</(?:style|script|svg)\s*>", " ", fragment, flags=re.IGNORECASE | re.DOTALL)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    fragment = re.sub(r"\s+", " ", fragment).strip()
    return len(fragment)


def extract(text: str) -> tuple[str, dict | None]:
    """Return (text_with_artifact_stripped, artifact_dict | None).

    The first artifact wins. Subsequent ones are ignored — the agent prompt
    says one per response.
    """
    open_match = _ARTIFACT_OPEN.search(text)
    if not open_match:
        return text, None
    close_match = _ARTIFACT_CLOSE.search(text, pos=open_match.end())
    html_close = None
    repaired = False
    if not close_match:
        html_close = _HTML_CLOSE.search(text, pos=open_match.end())
        if not html_close:
            content = text[open_match.end() :].strip()
            repaired_content = _repair_html(content)
            if not repaired_content:
                # Not an HTML artifact we can salvage. Strip it anyway so the
                # UI does not show a raw wall of unfinished code.
                visible = text[: open_match.start()].strip()
                if not visible:
                    visible = "The generated artifact was cut off before it could be recovered."
                return visible, None
            content = repaired_content
            end_pos = len(text)
            repaired = True

    attrs_raw = open_match.group(1)
    attrs = {k.lower(): v for k, v in _ATTR.findall(attrs_raw)}
    if not repaired:
        end_pos = close_match.start() if close_match else html_close.end()
        content = text[open_match.end() : end_pos].strip()
    artifact = {
        "type": (attrs.get("type") or "html").lower(),
        "title": (attrs.get("title") or "Untitled artifact")[:120],
        "html": content if (attrs.get("type") or "html").lower() == "html" else None,
        "raw": content,
        "repaired": repaired,
    }
    if artifact["type"] == "html" and _visible_html_text_len(content) < 20:
        visible = text[: open_match.start()].strip()
        if not visible:
            visible = (
                "The generated HTML was cut off before any visible page content, "
                "so I did not create a blank artifact. Try again with a shorter "
                "page request or a larger model."
            )
        return visible, None
    stripped = (
        text[: open_match.start()].rstrip()
        + "\n\n"
        + (text[close_match.end() :] if close_match else text[end_pos:]).lstrip()
    ).strip()
    if not stripped:
        stripped = (
            "The generated HTML was cut off, so I recovered a preview artifact. "
            "Open or download it below."
            if repaired
            else "Created an artifact. Open it below."
        )
    return stripped, artifact


def has_open_unfinished(text: str) -> bool:
    """Used by the streaming path: while an artifact is mid-emission, we keep
    suppressing its content from the visible delta stream."""
    o = _ARTIFACT_OPEN.search(text)
    if not o:
        return False
    return _ARTIFACT_CLOSE.search(text, pos=o.end()) is None
