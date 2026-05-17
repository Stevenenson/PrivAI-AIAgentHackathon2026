"""Lightweight per-session checklist the agent can publish to the UI.

The model calls `update_plan` with an ordered list of short steps and the
current step status. The orchestrator streams the latest plan as a tool event
and the frontend renders it as a checklist.
"""
from __future__ import annotations

import json
import time
from typing import Any

_VALID_STATUSES = ("pending", "in_progress", "completed", "skipped")
_MAX_STEPS = 30
_MAX_STEP_CHARS = 200


UPDATE_PLAN_TOOL = {
    "type": "function",
    "name": "update_plan",
    "description": (
        "Publish or update the agent's working plan as a short ordered checklist. "
        "Call once near the start of any task that needs more than one or two "
        "steps so the user can see what you intend to do. Call again whenever a "
        "step starts, finishes, or you need to change the plan. Keep each step "
        "imperative and under 12 words."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "description": "Ordered list of plan steps.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Imperative step title, e.g. 'Scaffold Vite app'.",
                        },
                        "status": {
                            "type": "string",
                            "description": "One of pending, in_progress, completed, skipped.",
                            "enum": list(_VALID_STATUSES),
                        },
                    },
                    "required": ["title", "status"],
                    "additionalProperties": False,
                },
            },
            "note": {
                "type": "string",
                "description": "Optional short note about the current focus.",
            },
        },
        "required": ["steps", "note"],
        "additionalProperties": False,
    },
    "strict": True,
}


_plans: dict[str, dict[str, Any]] = {}


def _normalize_steps(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        raise ValueError("steps must be a list")
    if not raw:
        raise ValueError("steps must include at least one item")
    if len(raw) > _MAX_STEPS:
        raise ValueError(f"plan limited to {_MAX_STEPS} steps")
    normalized: list[dict[str, str]] = []
    for index, step in enumerate(raw, 1):
        if not isinstance(step, dict):
            raise ValueError(f"step #{index} must be an object")
        title = str(step.get("title") or "").strip()
        status = str(step.get("status") or "pending").strip().lower()
        if not title:
            raise ValueError(f"step #{index} has no title")
        if status not in _VALID_STATUSES:
            raise ValueError(
                f"step #{index} status must be one of {', '.join(_VALID_STATUSES)}"
            )
        normalized.append({"title": title[:_MAX_STEP_CHARS], "status": status})
    return normalized


def execute_tool(session_id: str, args: dict) -> str:
    try:
        steps = _normalize_steps((args or {}).get("steps"))
    except ValueError as e:
        return json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)

    note = str((args or {}).get("note") or "").strip()[:400]
    plan = {
        "steps": steps,
        "note": note,
        "updatedAt": time.time(),
    }
    _plans[session_id or "default"] = plan
    return json.dumps({"ok": True, **plan}, ensure_ascii=False)


def get_plan(session_id: str) -> dict[str, Any] | None:
    return _plans.get(session_id or "default")


def clear_plan(session_id: str) -> None:
    _plans.pop(session_id or "default", None)
