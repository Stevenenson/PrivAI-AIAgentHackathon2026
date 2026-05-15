"""Business settings and Gemini-only routing."""
from __future__ import annotations

import json
import re
from typing import Any

from . import database


PRIVACY_MODES = {"cloud"}

_SENSITIVE_PATTERNS = (
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    r"\b(?:\+?\d[\d\s().-]{7,}\d)\b",
    r"\b(?:confidential|private|sensitive|secret|internal|nda)\b",
    r"\b(?:salary|payroll|employee\s+id|payment\s+details)\b",
    r"\b(?:bank\s+account|iban|swift|vat|tax id|cnp|ssn)\b",
    r"\b(?:invoice|contract|customer|client)\s*(?:#|no\.?|number|id)\s*[:#-]?\s*\w+",
    r"\b(?:\d[ -]*?){13,19}\b",
)

DEFAULT_SETTINGS = {
    "privacyMode": "cloud",
    "gmailEnabled": False,
    "calendarEnabled": False,
    "emailProvider": "gmail",
    "calendarProvider": "google",
    "requireApprovalForEmailSend": True,
    "requireApprovalForCalendarWrites": True,
}


def get_settings() -> dict[str, Any]:
    raw = database.get_kv("business_settings")
    if not raw:
        return dict(DEFAULT_SETTINGS)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {}
    merged = {**DEFAULT_SETTINGS, **parsed}
    if merged.get("privacyMode") not in PRIVACY_MODES:
        merged["privacyMode"] = "cloud"
    return merged


def set_settings(patch: dict[str, Any]) -> dict[str, Any]:
    current = get_settings()
    next_settings = {**current}
    for key in DEFAULT_SETTINGS:
        if key in patch:
            next_settings[key] = patch[key]
    if next_settings.get("privacyMode") not in PRIVACY_MODES:
        next_settings["privacyMode"] = "cloud"
    database.set_kv("business_settings", json.dumps(next_settings))
    return next_settings


def detect_sensitive(text: str) -> bool:
    haystack = text or ""
    return any(re.search(pattern, haystack, flags=re.IGNORECASE) for pattern in _SENSITIVE_PATTERNS)


def choose_provider(privacy_mode: str | None, text: str) -> tuple[str, str, bool]:
    sensitive = detect_sensitive(text)
    reason = "Gemini API selected"
    if sensitive:
        reason = "Gemini API selected; sensitive content detected"
    return "gemini", reason, sensitive
