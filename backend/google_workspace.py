"""Google Workspace integration for local Business tools.

The desktop app stores OAuth tokens in the local SQLite kv table. Gmail is
read-only; Calendar writes are represented as local Business actions first so
the user can review and approve them before anything is created remotely.
"""
from __future__ import annotations

import base64
import json
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from . import database
from .config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1"
CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3"

SCOPES = (
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
)


GOOGLE_WORKSPACE_TOOLS = [
    {
        "type": "function",
        "name": "search_email",
        "description": (
            "Search the user's connected Gmail mailbox in read-only mode. Use "
            "Gmail search syntax when helpful, for example `from:client "
            "newer_than:30d meeting`."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Gmail search query.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum messages to return, from 1 to 20.",
                    "minimum": 1,
                    "maximum": 20,
                },
            },
            "required": ["query", "max_results"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "read_email_thread",
        "description": "Read metadata and snippets for a Gmail thread in read-only mode.",
        "parameters": {
            "type": "object",
            "properties": {
                "thread_id": {
                    "type": "string",
                    "description": "Gmail thread ID returned by search_email.",
                },
            },
            "required": ["thread_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "find_calendar_slots",
        "description": (
            "Find free calendar slots in the user's primary Google Calendar. "
            "Use this before proposing a meeting time."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "time_min": {
                    "type": "string",
                    "description": "ISO datetime start, for example 2026-05-14T09:00:00+03:00.",
                },
                "time_max": {
                    "type": "string",
                    "description": "ISO datetime end, for example 2026-05-14T17:00:00+03:00.",
                },
                "duration_minutes": {
                    "type": "integer",
                    "minimum": 15,
                    "maximum": 480,
                    "description": "Desired meeting length in minutes.",
                },
                "calendar_id": {
                    "type": "string",
                    "description": "Calendar ID. Use primary unless the user gives another one.",
                },
            },
            "required": ["time_min", "time_max", "duration_minutes", "calendar_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "draft_calendar_event",
        "description": (
            "Draft a Google Calendar event for user review. This does not "
            "create the event; it creates a pending Business action."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Calendar event title."},
                "description": {"type": "string", "description": "Event notes or agenda."},
                "start": {"type": "string", "description": "ISO start datetime."},
                "end": {"type": "string", "description": "ISO end datetime."},
                "timezone": {"type": "string", "description": "IANA timezone, for example Europe/Bucharest."},
                "attendees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Attendee email addresses.",
                },
                "calendar_id": {"type": "string", "description": "Calendar ID, usually primary."},
            },
            "required": [
                "summary",
                "description",
                "start",
                "end",
                "timezone",
                "attendees",
                "calendar_id",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "create_calendar_event",
        "description": (
            "Request creation of a Google Calendar event. The tool always "
            "creates a pending Business action first; the user must approve it "
            "in Action Review before the event is sent to Google Calendar."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Calendar event title."},
                "description": {"type": "string", "description": "Event notes or agenda."},
                "start": {"type": "string", "description": "ISO start datetime."},
                "end": {"type": "string", "description": "ISO end datetime."},
                "timezone": {"type": "string", "description": "IANA timezone, for example Europe/Bucharest."},
                "attendees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Attendee email addresses.",
                },
                "calendar_id": {"type": "string", "description": "Calendar ID, usually primary."},
            },
            "required": [
                "summary",
                "description",
                "start",
                "end",
                "timezone",
                "attendees",
                "calendar_id",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


def configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def auth_url(owner_uid: str) -> str:
    if not configured():
        raise RuntimeError("Google OAuth is not configured")
    state = _state_for(owner_uid)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code(owner_uid: str, code: str) -> dict[str, Any]:
    if not configured():
        raise RuntimeError("Google OAuth is not configured")
    payload = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.google_redirect_uri,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response))
    token = response.json()
    _save_token(owner_uid, token)
    return status(owner_uid)


def status(owner_uid: str) -> dict[str, Any]:
    token = _load_token(owner_uid)
    return {
        "configured": configured(),
        "connected": bool(token and token.get("refresh_token")),
        "scopes": list(SCOPES),
        "email": None,
        "expiresAt": token.get("expires_at") if token else None,
        "redirectUri": settings.google_redirect_uri,
    }


def disconnect(owner_uid: str) -> dict[str, Any]:
    database.set_kv(_token_key(owner_uid), None)
    return status(owner_uid)


async def execute_tool(owner_uid: str, name: str, args: dict[str, Any]) -> str:
    try:
        if name == "search_email":
            result = await search_email(
                owner_uid,
                str(args.get("query") or ""),
                int(args.get("max_results") or 10),
            )
        elif name == "read_email_thread":
            result = await read_email_thread(owner_uid, str(args.get("thread_id") or ""))
        elif name == "find_calendar_slots":
            result = await find_calendar_slots(
                owner_uid=owner_uid,
                time_min=str(args.get("time_min") or ""),
                time_max=str(args.get("time_max") or ""),
                duration_minutes=int(args.get("duration_minutes") or 30),
                calendar_id=str(args.get("calendar_id") or "primary"),
            )
        elif name in {"draft_calendar_event", "create_calendar_event"}:
            result = draft_calendar_action(owner_uid, args)
        else:
            result = {"error": f"unknown Google Workspace tool: {name}"}
    except Exception as e:
        result = {"error": str(e)}
    return json.dumps(result, ensure_ascii=False)


async def search_email(
    owner_uid: str,
    query: str,
    max_results: int = 10,
) -> dict[str, Any]:
    if not query.strip():
        raise RuntimeError("query is required")
    access_token = await _access_token(owner_uid)
    max_results = max(1, min(max_results, 20))
    async with httpx.AsyncClient(timeout=30) as client:
        listed = await client.get(
            f"{GMAIL_BASE_URL}/users/me/messages",
            headers=_auth_headers(access_token),
            params={"q": query, "maxResults": max_results},
        )
        if listed.status_code >= 400:
            raise RuntimeError(_google_error(listed))
        messages = listed.json().get("messages") or []
        details = await _gather_message_metadata(client, access_token, messages)
    return {"query": query, "messages": details}


async def read_email_thread(owner_uid: str, thread_id: str) -> dict[str, Any]:
    if not thread_id.strip():
        raise RuntimeError("thread_id is required")
    access_token = await _access_token(owner_uid)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{GMAIL_BASE_URL}/users/me/threads/{thread_id}",
            headers=_auth_headers(access_token),
            params={
                "format": "full",
            },
        )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response))
    data = response.json()
    return {
        "threadId": data.get("id"),
        "historyId": data.get("historyId"),
        "messages": [_format_gmail_message(item) for item in data.get("messages") or []],
    }


async def find_calendar_slots(
    owner_uid: str,
    time_min: str,
    time_max: str,
    duration_minutes: int = 30,
    calendar_id: str = "primary",
) -> dict[str, Any]:
    start = _parse_dt(time_min)
    end = _parse_dt(time_max)
    if end <= start:
        raise RuntimeError("time_max must be after time_min")
    duration_minutes = max(15, min(duration_minutes, 480))
    access_token = await _access_token(owner_uid)
    body = {
        "timeMin": _iso_z(start),
        "timeMax": _iso_z(end),
        "items": [{"id": calendar_id or "primary"}],
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{CALENDAR_BASE_URL}/freeBusy",
            headers=_auth_headers(access_token),
            json=body,
        )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response))
    busy = (
        response.json()
        .get("calendars", {})
        .get(calendar_id or "primary", {})
        .get("busy", [])
    )
    slots = _free_slots(start, end, busy, duration_minutes)
    return {
        "calendarId": calendar_id or "primary",
        "timeMin": _iso_z(start),
        "timeMax": _iso_z(end),
        "durationMinutes": duration_minutes,
        "busy": busy,
        "slots": slots,
    }


def draft_calendar_action(owner_uid: str, payload: dict[str, Any]) -> dict[str, Any]:
    event = _calendar_payload(payload)
    title = f"Calendar event: {event.get('summary') or 'Untitled meeting'}"
    action = database.create_business_action(owner_uid, "calendar_event", title, event)
    return {
        "status": "pending_approval",
        "action": action,
        "message": "Calendar event drafted. Ask the user to review it in Business Action Review.",
    }


async def create_calendar_event(owner_uid: str, payload: dict[str, Any]) -> dict[str, Any]:
    access_token = await _access_token(owner_uid)
    calendar_id = str(payload.get("calendar_id") or "primary")
    event = _calendar_event_body(payload)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{CALENDAR_BASE_URL}/calendars/{calendar_id}/events",
            headers=_auth_headers(access_token),
            json=event,
            params={"sendUpdates": "all"},
        )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response))
    created = response.json()
    return {
        "id": created.get("id"),
        "htmlLink": created.get("htmlLink"),
        "summary": created.get("summary"),
        "start": created.get("start"),
        "end": created.get("end"),
        "attendees": created.get("attendees") or [],
    }


def _calendar_payload(payload: dict[str, Any]) -> dict[str, Any]:
    timezone_name = str(payload.get("timezone") or "UTC")
    attendees = payload.get("attendees") or []
    if not isinstance(attendees, list):
        attendees = []
    return {
        "summary": str(payload.get("summary") or "Untitled meeting").strip(),
        "description": str(payload.get("description") or "").strip(),
        "start": str(payload.get("start") or "").strip(),
        "end": str(payload.get("end") or "").strip(),
        "timezone": timezone_name,
        "attendees": [str(item).strip() for item in attendees if str(item).strip()],
        "calendar_id": str(payload.get("calendar_id") or "primary").strip() or "primary",
    }


def _calendar_event_body(payload: dict[str, Any]) -> dict[str, Any]:
    event = _calendar_payload(payload)
    if not event["summary"]:
        raise RuntimeError("summary is required")
    if not event["start"] or not event["end"]:
        raise RuntimeError("start and end are required")
    return {
        "summary": event["summary"],
        "description": event["description"],
        "start": {"dateTime": event["start"], "timeZone": event["timezone"]},
        "end": {"dateTime": event["end"], "timeZone": event["timezone"]},
        "attendees": [{"email": email} for email in event["attendees"]],
    }


async def _gather_message_metadata(
    client: httpx.AsyncClient,
    access_token: str,
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for item in messages:
        mid = item.get("id")
        if not mid:
            continue
        response = await client.get(
            f"{GMAIL_BASE_URL}/users/me/messages/{mid}",
            headers=_auth_headers(access_token),
            params={
                "format": "metadata",
                "metadataHeaders": ["From", "To", "Subject", "Date"],
            },
        )
        if response.status_code >= 400:
            continue
        details.append(_format_gmail_message(response.json()))
    return details


def _format_gmail_message(item: dict[str, Any]) -> dict[str, Any]:
    headers = {
        str(header.get("name") or "").lower(): str(header.get("value") or "")
        for header in (item.get("payload") or {}).get("headers", [])
    }
    return {
        "id": item.get("id"),
        "threadId": item.get("threadId"),
        "subject": headers.get("subject", "(no subject)"),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "cc": headers.get("cc", ""),
        "date": _normalize_email_date(headers.get("date", "")),
        "snippet": item.get("snippet") or "",
        "text": _message_text(item.get("payload") or {})[:6000],
    }


def _message_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []
    _collect_message_text(payload, chunks)
    return "\n\n".join(chunk for chunk in chunks if chunk).strip()


def _collect_message_text(payload: dict[str, Any], chunks: list[str]) -> None:
    mime = str(payload.get("mimeType") or "")
    body = payload.get("body") or {}
    data = body.get("data")
    if data and mime in {"text/plain", "text/html"}:
        text = _decode_gmail_body(str(data))
        if mime == "text/html":
            text = _html_to_text(text)
        if text:
            chunks.append(text)
    for part in payload.get("parts") or []:
        if isinstance(part, dict):
            _collect_message_text(part, chunks)


def _decode_gmail_body(data: str) -> str:
    try:
        padding = "=" * (-len(data) % 4)
        raw = base64.urlsafe_b64decode((data + padding).encode())
        return raw.decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


def _html_to_text(value: str) -> str:
    value = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value)
    value = re.sub(r"(?s)<br\s*/?>", "\n", value)
    value = re.sub(r"(?s)</p\s*>", "\n\n", value)
    value = re.sub(r"(?s)<.*?>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _normalize_email_date(raw: str) -> str:
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(raw).isoformat()
    except Exception:
        return raw


def _free_slots(
    start: datetime,
    end: datetime,
    busy: list[dict[str, str]],
    duration_minutes: int,
) -> list[dict[str, str]]:
    duration = timedelta(minutes=duration_minutes)
    intervals = sorted(
        (
            (_parse_dt(item["start"]), _parse_dt(item["end"]))
            for item in busy
            if item.get("start") and item.get("end")
        ),
        key=lambda item: item[0],
    )
    slots: list[dict[str, str]] = []
    cursor = start
    for busy_start, busy_end in intervals:
        if busy_start > cursor:
            _append_slots(slots, cursor, min(busy_start, end), duration)
        cursor = max(cursor, busy_end)
        if cursor >= end:
            break
    if cursor < end:
        _append_slots(slots, cursor, end, duration)
    return slots[:20]


def _append_slots(
    slots: list[dict[str, str]],
    start: datetime,
    end: datetime,
    duration: timedelta,
) -> None:
    cursor = _round_up_to_quarter(start)
    while cursor + duration <= end and len(slots) < 20:
        slots.append({"start": _iso_z(cursor), "end": _iso_z(cursor + duration)})
        cursor += duration


def _round_up_to_quarter(value: datetime) -> datetime:
    minute = ((value.minute + 14) // 15) * 15
    rounded = value.replace(minute=0, second=0, microsecond=0) + timedelta(minutes=minute)
    return rounded


def _parse_dt(value: str) -> datetime:
    raw = value.strip()
    if not raw:
        raise RuntimeError("datetime value is required")
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


async def _access_token(owner_uid: str) -> str:
    token = _load_token(owner_uid)
    if not token or not token.get("refresh_token"):
        raise RuntimeError("Google Workspace is not connected")
    if float(token.get("expires_at") or 0) > time.time() + 60 and token.get("access_token"):
        return str(token["access_token"])
    refreshed = await _refresh_token(token)
    _save_token(owner_uid, {**token, **refreshed})
    return str(refreshed.get("access_token") or token.get("access_token") or "")


async def _refresh_token(token: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "refresh_token": token.get("refresh_token"),
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response))
    return response.json()


def _save_token(owner_uid: str, token: dict[str, Any]) -> None:
    existing = _load_token(owner_uid) or {}
    merged = {**existing, **token}
    if "expires_in" in merged:
        merged["expires_at"] = time.time() + float(merged.get("expires_in") or 0)
    database.set_kv(_token_key(owner_uid), json.dumps(merged))


def _load_token(owner_uid: str) -> dict[str, Any] | None:
    raw = database.get_kv(_token_key(owner_uid))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _auth_headers(access_token: str) -> dict[str, str]:
    if not access_token:
        raise RuntimeError("Google access token is unavailable")
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }


def owner_from_state(state: str) -> str:
    try:
        return base64.urlsafe_b64decode(state.encode()).decode()
    except Exception:
        return ""


def _state_for(owner_uid: str) -> str:
    return base64.urlsafe_b64encode(owner_uid.encode()).decode()


def _token_key(owner_uid: str) -> str:
    return f"google_workspace_token:{owner_uid}"


def _google_error(response: httpx.Response) -> str:
    try:
        data = response.json()
        detail = (data.get("error") or {}).get("message") or data.get("error_description")
        if detail:
            return f"Google API error {response.status_code}: {detail}"
    except Exception:
        pass
    return f"Google API error {response.status_code}: {response.text}"
