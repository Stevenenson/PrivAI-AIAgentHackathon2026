"""Local-first privacy filter — redacts likely-sensitive tokens before they leave the box.

Patterns are intentionally conservative (low false-positive). The point of the licenta
project is to *demonstrate* a guard, not ship a full DLP system.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Romanian CNP: 13 digits, first digit 1-8, second-third = year (2 digits) etc.
_CNP = re.compile(r"\b[1-8]\d{12}\b")
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE_RO = re.compile(r"\b(?:\+?40|0)\s?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b")
_CREDIT_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_API_KEY = re.compile(
    r"\b(?:sk|pk|api|token|bearer|ghp|xoxb|AKIA)[_\-]?[A-Za-z0-9]{16,}\b",
    re.IGNORECASE,
)
_PASSWORD_LINE = re.compile(
    r"(?im)\b(?:password|parola|passwd|pwd)\s*[:=]\s*\S+"
)

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("CNP", _CNP),
    ("EMAIL", _EMAIL),
    ("PHONE", _PHONE_RO),
    ("CARD", _CREDIT_CARD),
    ("APIKEY", _API_KEY),
    ("PASSWORD", _PASSWORD_LINE),
)


@dataclass
class GuardResult:
    text: str
    redactions: list[str]

    @property
    def triggered(self) -> bool:
        return bool(self.redactions)


def scan(text: str) -> GuardResult:
    redacted = text
    hits: list[str] = []
    for label, pat in _PATTERNS:
        def _sub(m: re.Match[str], _l=label) -> str:
            hits.append(_l)
            return f"[REDACTED:{_l}]"
        redacted = pat.sub(_sub, redacted)
    return GuardResult(text=redacted, redactions=hits)


def looks_sensitive(text: str) -> bool:
    return scan(text).triggered
