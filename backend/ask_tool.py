"""Tool that lets the agent pause and ask the user a short clarifying question."""
from __future__ import annotations

import json

REQUEST_USER_INPUT_TOOL = {
    "type": "function",
    "name": "request_user_input",
    "description": (
        "Pause and ask the user a short clarifying question when you genuinely "
        "cannot proceed without more information (missing required detail, "
        "ambiguous goal, irreversible choice). Do NOT use this for status "
        "updates, progress checks, or confirmations of routine actions. Keep "
        "the question one sentence; offer 2-4 short options when there is a "
        "clear shortlist."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The clarifying question, one sentence.",
            },
            "options": {
                "type": "array",
                "description": "Optional short answer choices to suggest.",
                "items": {"type": "string"},
            },
        },
        "required": ["question", "options"],
        "additionalProperties": False,
    },
    "strict": True,
}


def result_payload(answer: str | None) -> str:
    if answer is None or not answer.strip():
        return json.dumps(
            {
                "ok": False,
                "answer": "",
                "note": (
                    "User did not answer within the timeout; proceed with the "
                    "most reasonable default and clearly note the assumption."
                ),
            },
            ensure_ascii=False,
        )
    return json.dumps({"ok": True, "answer": answer.strip()}, ensure_ascii=False)
