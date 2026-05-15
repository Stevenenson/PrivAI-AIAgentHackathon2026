"""FastAPI entrypoint for the Gemini-powered desktop assistant.

Privacy posture: all chat content is stored in local SQLite. Firebase is used
only for **identity** — we verify the caller's Firebase ID token and check it
against the device's paired owner. The web app talks to this backend directly
(no Firestore relay for chat).
"""
from __future__ import annotations

import asyncio
import base64
import html
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

# kept here so async tasks below resolve clean
_ = asyncio

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from fastapi import File, UploadFile

from . import (
    approvals,
    artifacts,
    attachments,
    business,
    converter,
    database,
    google_workspace,
    pdf_builder,
    preview,
    runtime,
    terminal,
)
from .admin import router as admin_router
from .auth import (
    Caller,
    _print_pairing_code_once,
    claim_pairing,
    require_owner,
    verify_id_token,
)
from .config import settings
from .llm_client import LLMClient
from .orchestrator import Orchestrator
from .searxng_client import SearxngClient

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init()
    if database.get_owner_uid() is None:
        _print_pairing_code_once()
    else:
        log.info("device already paired to uid=%s", database.get_owner_uid())
    yield


app = FastAPI(title="Privai API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins) or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

llm = LLMClient()
search = SearxngClient()
orch = Orchestrator(llm, search)
app.include_router(admin_router)


# ---- public endpoints ----------------------------------------------------


@app.get("/health")
async def health():
    paired_uid = database.get_owner_uid()
    workspace = terminal.workspace_root_or_none()
    llm_ok, searxng_ok, fallback_ok = await asyncio.gather(
        llm.health(),
        search.health(),
        search.fallback_health(),
    )
    return {
        "llm": llm_ok,
        "provider": runtime.get_provider(),
        "searxng": searxng_ok,
        "searchFallback": fallback_ok,
        "model": runtime.get_model(),
        "default": runtime.default_model(),
        "paired": paired_uid is not None,
        "version": app.version,
        "numCtx": runtime.context_window(),
        "numPredict": settings.llm_num_predict,
        "searchTopK": settings.search_top_k,
        "visionModel": runtime.get_vision_model(),
        "terminalEnabled": bool(settings.terminal_enabled and workspace),
        "workspaceRoot": str(workspace or ""),
        "agentMaxToolSteps": settings.agent_max_tool_steps,
        "commandApprovalRequired": settings.agent_command_approval_required,
    }


# ---- pairing -------------------------------------------------------------


class PairRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)


@app.post("/pair")
async def pair(req: PairRequest, caller: Caller = Depends(verify_id_token)):
    existing = database.get_owner_uid()
    if existing == caller.uid:
        return {"paired": True, "owner": caller.uid, "alreadyPaired": True}
    if existing and existing != caller.uid:
        raise HTTPException(
            status_code=409,
            detail="device already paired to a different account",
        )
    if not claim_pairing(req.code, caller):
        raise HTTPException(status_code=403, detail="invalid pairing code")
    log.info("device paired to uid=%s email=%s", caller.uid, caller.email)
    return {"paired": True, "owner": caller.uid}


@app.get("/pair/status")
async def pair_status():
    return {
        "paired": database.get_owner_uid() is not None,
        "owner": database.get_owner_uid(),
    }


# ---- sessions -----------------------------------------------------------


class SessionCreate(BaseModel):
    title: str | None = None
    space: str | None = None


@app.get("/sessions")
async def list_sessions(caller: Caller = Depends(require_owner)):
    return {"sessions": database.list_sessions(caller.uid)}


@app.post("/sessions")
async def create_session(
    req: SessionCreate, caller: Caller = Depends(require_owner)
):
    sess = database.create_session(caller.uid, req.title or "New chat", req.space)
    return sess


@app.get("/sessions/{sid}")
async def get_session(sid: str, caller: Caller = Depends(require_owner)):
    sess = database.get_session(caller.uid, sid)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    return sess


class SessionRename(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


@app.patch("/sessions/{sid}")
async def patch_session(
    sid: str, req: SessionRename, caller: Caller = Depends(require_owner)
):
    if not database.rename_session(caller.uid, sid, req.title):
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@app.delete("/sessions/{sid}")
async def delete_session(sid: str, caller: Caller = Depends(require_owner)):
    if not database.delete_session(caller.uid, sid):
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@app.get("/sessions/{sid}/messages")
async def session_messages(
    sid: str, caller: Caller = Depends(require_owner)
):
    if not database.get_session(caller.uid, sid):
        raise HTTPException(status_code=404, detail="session not found")
    return {"messages": database.list_messages(caller.uid, sid)}


@app.get("/sessions/{sid}/stats")
async def session_stats(
    sid: str, caller: Caller = Depends(require_owner)
):
    if not database.get_session(caller.uid, sid):
        raise HTTPException(status_code=404, detail="session not found")
    s = database.message_stats(caller.uid, sid)
    return {**s, "numCtx": runtime.context_window()}


@app.post("/sessions/{sid}/clear")
async def clear_session_messages(
    sid: str, caller: Caller = Depends(require_owner)
):
    if not database.get_session(caller.uid, sid):
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": database.clear_messages(caller.uid, sid)}


@app.post("/sessions/{sid}/compact")
async def compact_session(
    sid: str, caller: Caller = Depends(require_owner)
):
    if not database.get_session(caller.uid, sid):
        raise HTTPException(status_code=404, detail="session not found")
    msgs = database.list_messages(caller.uid, sid)
    if len(msgs) < 2:
        raise HTTPException(status_code=400, detail="not enough messages to compact")
    summary = await orch.compact([{"role": m["role"], "content": m["content"]} for m in msgs])
    database.clear_messages(caller.uid, sid)
    note = database.append_message(
        caller.uid,
        sid,
        "assistant",
        f"_Conversation compacted._\n\n{summary}",
    )
    return {"compacted": True, "summary": note}


# ---- chat ---------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str = Field(default="", max_length=8000)
    sessionId: str | None = None
    forceSearch: bool | None = None
    mode: str | None = None  # "chat" (default) | "agent" | "convert"
    attachmentIds: list[str] | None = None
    searchTopK: int | None = Field(default=None, ge=1, le=50)
    experience: dict | None = None
    commandApprovalRequired: bool | None = None
    autoApproveReadOnlyCommands: bool | None = None
    privacyMode: str | None = None
    space: str | None = None


class ApprovalDecision(BaseModel):
    approved: bool


class BusinessSettingsPatch(BaseModel):
    privacyMode: str | None = None
    gmailEnabled: bool | None = None
    calendarEnabled: bool | None = None
    requireApprovalForEmailSend: bool | None = None
    requireApprovalForCalendarWrites: bool | None = None


class CalendarSlotsRequest(BaseModel):
    timeMin: str = Field(..., min_length=1)
    timeMax: str = Field(..., min_length=1)
    durationMinutes: int = Field(default=30, ge=15, le=480)
    calendarId: str = Field(default="primary", min_length=1, max_length=200)


class CalendarEventRequest(BaseModel):
    summary: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    start: str = Field(..., min_length=1)
    end: str = Field(..., min_length=1)
    timezone: str = Field(default="UTC", min_length=1, max_length=80)
    attendees: list[str] = Field(default_factory=list, max_length=50)
    calendarId: str = Field(default="primary", min_length=1, max_length=200)


class PreviewRequest(BaseModel):
    cwd: str | None = "."


class LearningTextMaterialRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    content: str = Field(..., min_length=1, max_length=200_000)


class LearningAttachmentMaterialRequest(BaseModel):
    attachmentId: str = Field(..., min_length=1)


class LearningPracticeRequest(BaseModel):
    kind: str = Field(default="test", min_length=1, max_length=20)
    count: int = Field(default=8, ge=1, le=20)


class WorkspaceSaveFileRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., max_length=2_000_000)


class WorkspaceTerminalRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=4000)
    cwd: str | None = "."
    timeoutS: int | None = Field(default=60, ge=1, le=120)


class WorkspaceCheckpointRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)


_WORKSPACE_SKIP_DIRS = {
    ".cache",
    ".git",
    ".next",
    ".pytest_cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "dist-backend",
    "node_modules",
}

_WORKSPACE_TEXT_SUFFIXES = {
    ".c",
    ".cfg",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".csv",
    ".go",
    ".h",
    ".html",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".rb",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


def _resolve_workspace_path(raw_path: str | None = ".") -> Path:
    try:
        root = terminal.workspace_root()
    except terminal.TerminalError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    raw = Path((raw_path or ".").strip() or ".").expanduser()
    candidate = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"path must stay inside workspace root {root}",
        ) from e
    if any(part.startswith(".env") or part.endswith(".env") for part in candidate.parts):
        raise HTTPException(status_code=403, detail="environment files are hidden")
    return candidate


def _workspace_rel(path: Path) -> str:
    try:
        rel = path.resolve().relative_to(terminal.workspace_root())
    except (ValueError, terminal.TerminalError):
        return "."
    text = str(rel)
    return "." if text == "." else text


def _is_text_file(path: Path) -> bool:
    if path.suffix.lower() in _WORKSPACE_TEXT_SUFFIXES:
        return True
    try:
        sample = path.read_bytes()[:2048]
    except OSError:
        return False
    return b"\x00" not in sample


def _iter_workspace_files(limit: int = 5000):
    try:
        root = terminal.workspace_root()
    except terminal.TerminalError:
        return
    seen = 0
    for current, dirs, files in os.walk(root):
        dirs[:] = [
            d
            for d in dirs
            if d not in _WORKSPACE_SKIP_DIRS and not d.startswith(".")
        ]
        current_path = Path(current)
        for name in files:
            if name == ".DS_Store" or name.startswith(".env") or name.endswith(".env"):
                continue
            path = current_path / name
            try:
                path.resolve().relative_to(root)
            except (OSError, ValueError):
                continue
            seen += 1
            if seen > limit:
                return
            yield path


def _checkpoint_dir(uid: str) -> Path:
    safe_uid = re.sub(r"[^a-zA-Z0-9_.-]", "_", uid)
    base = Path(settings.cache_dir).expanduser().resolve().parent
    target = base / "checkpoints" / safe_uid
    target.mkdir(parents=True, exist_ok=True)
    return target


def _workspace_snapshot() -> tuple[dict[str, str], int]:
    files: dict[str, str] = {}
    skipped = 0
    total_chars = 0
    for path in _iter_workspace_files(limit=3000):
        try:
            stat = path.stat()
        except OSError:
            skipped += 1
            continue
        if stat.st_size > 500_000 or not _is_text_file(path):
            skipped += 1
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            skipped += 1
            continue
        if len(files) >= 300 or total_chars + len(content) > 5_000_000:
            skipped += 1
            continue
        files[_workspace_rel(path)] = content
        total_chars += len(content)
    return files, skipped


def _checkpoint_meta(raw: dict) -> dict:
    return {
        "id": raw.get("id"),
        "title": raw.get("title") or "Workspace checkpoint",
        "createdAt": raw.get("createdAt") or 0,
        "root": raw.get("root") or "",
        "fileCount": len(raw.get("files") or {}),
        "skipped": raw.get("skipped") or 0,
    }


def _language_for(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".css": "css",
        ".html": "html",
        ".js": "javascript",
        ".json": "json",
        ".jsx": "javascript",
        ".md": "markdown",
        ".mjs": "javascript",
        ".py": "python",
        ".sh": "shell",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".yaml": "yaml",
        ".yml": "yaml",
    }.get(suffix, "plaintext")


def _history_for(uid: str, sid: str | None, limit: int = 10) -> list[dict]:
    if not sid:
        return []
    msgs = database.list_messages(uid, sid, limit=limit)
    return [{"role": m["role"], "content": m["content"]} for m in msgs[-limit:]]


def _resolve_attachments(uid: str, ids: list[str] | None) -> tuple[list[dict], str]:
    """Load attachments by id; return (descriptors, prompt_block)."""
    if not ids:
        return [], ""
    rows = database.list_attachments(uid, ids)
    descriptors = _attachment_descriptors(rows)
    text = attachments.build_attachment_block(
        [
            {
                "name": r["name"],
                "mime": r["mime"],
                "size": r["size"],
                "text_excerpt": r.get("text_excerpt"),
            }
            for r in rows
        ]
    )
    return descriptors, text


def _attachment_descriptors(rows: list[dict]) -> list[dict]:
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "mime": r["mime"],
            "size": r["size"],
            "hasText": bool(r.get("text_excerpt")),
        }
        for r in rows
    ]


def _normalize_mode(m: str | None) -> str:
    if (m or "").lower() == "convert":
        return "convert"
    return "agent" if (m or "").lower() == "agent" else "chat"


def _empty_model_response_message() -> str:
    return (
        "The model returned no final answer. Please send the message again."
    )


def _should_use_vision(message: str, rows: list[dict], mode: str) -> bool:
    if mode == "convert":
        return False
    has_image = any(str(r.get("mime") or "").lower().startswith("image/") for r in rows)
    if not has_image:
        return False
    # Any image attachment in chat/agent mode is visual context. Do not require
    # the user to say "image" explicitly ("what is this?" should still work).
    return True


def _image_payloads(rows: list[dict]) -> list[dict]:
    payloads: list[dict] = []
    for row in rows:
        mime = str(row.get("mime") or "").lower()
        if not mime.startswith("image/"):
            continue
        try:
            with open(row["path"], "rb") as f:
                payloads.append({
                    "mime": mime,
                    "data": base64.b64encode(f.read()).decode("ascii"),
                })
        except OSError:
            log.warning("failed to read image attachment id=%s", row.get("id"))
    return payloads


async def _study_image_material(row: dict) -> str | None:
    if not str(row.get("mime") or "").lower().startswith("image/"):
        return None
    payloads = _image_payloads([row])
    if not payloads:
        return None
    messages = [
        {
            "role": "system",
            "content": (
                "You study class material images for a learning notebook. "
                "Extract visible text, diagrams, labels, formulas, concepts, "
                "and anything a student should remember. Return concise notes."
            ),
        },
        {
            "role": "user",
            "content": "Study this image as course material for future quizzes and explanations.",
            "images": payloads,
        },
    ]
    try:
        notes = await llm.chat(messages, model=runtime.get_vision_model())
    except Exception as e:
        log.warning("image material study failed id=%s: %s", row.get("id"), e)
        return None
    return notes[: attachments.TEXT_PREVIEW_BYTES] if notes else None


def _ensure_learning_session(owner_uid: str, sid: str) -> dict:
    sess = database.get_session(owner_uid, sid)
    if not sess:
        raise HTTPException(status_code=404, detail="learning notebook not found")
    if sess.get("space") not in {"learning", "general"}:
        raise HTTPException(
            status_code=400,
            detail="materials can only be added to learning notebooks",
        )
    return sess


def _study_summary(title: str, text: str | None) -> tuple[str, str]:
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if not clean:
        return (
            "needs review",
            "Stored as a source, but no readable text was extracted yet.",
        )

    sentences = re.split(r"(?<=[.!?])\s+", clean)
    summary = " ".join(sentences[:3]).strip()
    if len(summary) > 700:
        summary = summary[:697].rstrip() + "..."

    words = [
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z\-]{4,}", clean)
        if word.lower() not in _LEARNING_STOP_WORDS
    ]
    counts: dict[str, int] = {}
    for word in words[:4000]:
        counts[word] = counts.get(word, 0) + 1
    topics = [
        word
        for word, _count in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )[:8]
    ]
    if topics:
        summary = f"{summary}\n\nKey terms: {', '.join(topics)}."
    return "studied", summary or f"Studied {title}."


async def _study_text_material(title: str, text: str | None) -> tuple[str, str]:
    fallback_status, fallback_summary = _study_summary(title, text)
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if not clean:
        return fallback_status, fallback_summary

    prompt = (
        "Study this class material for a learning notebook. Return a concise "
        "student-facing study summary with: subject, main ideas, key terms, "
        "definitions, formulas/processes if present, likely quiz points, and "
        "anything unclear or missing. Do not invent facts outside the material.\n\n"
        f"Title: {title}\n\nMaterial:\n{clean[:24_000]}"
    )
    try:
        summary = await llm.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You are a careful study assistant. You convert course "
                        "materials into reliable notebook summaries for later "
                        "quizzes, tests, flashcards, and explanations."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            model=runtime.get_model(),
        )
    except Exception as e:
        log.warning("text material study failed title=%s: %s", title, e)
        return fallback_status, fallback_summary

    clean_summary = (summary or "").strip()
    if not clean_summary:
        return fallback_status, fallback_summary
    return "studied", clean_summary[:3000]


def _learning_context_block(owner_uid: str, sid: str) -> str:
    rows = database.list_learning_materials(owner_uid, sid, include_text=True)
    if not rows:
        return ""

    parts = [
        "Learning notebook materials and study context:",
        (
            "Use these materials as the primary source of truth. When answering, "
            "prefer the notebook sources first. If the answer is not in the "
            "materials, say that clearly before using general knowledge."
        ),
    ]
    used = sum(len(part) for part in parts)
    max_chars = 65_000
    for idx, row in enumerate(rows, start=1):
        excerpt = str(row.get("textExcerpt") or "")
        excerpt = excerpt[: min(12_000, max(0, max_chars - used))]
        item = (
            f"\n\nSource {idx}: {row['title']} "
            f"({row['mime']}, {row['status']})\n"
            f"Summary:\n{row.get('summary') or 'No summary yet.'}\n"
        )
        if excerpt:
            item += f"Excerpt:\n{excerpt}\nEnd source {idx}."
        else:
            item += (
                "Excerpt unavailable. Treat this source as stored but not "
                "readable yet."
            )
        parts.append(item)
        used += len(item)
        if used >= max_chars:
            parts.append("\n\n[Notebook context truncated to fit this request.]")
            break
    return "\n".join(parts)


def _extract_json_object(raw: str) -> dict:
    text = (raw or "").strip()
    if not text:
        raise ValueError("model returned an empty response")
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S | re.I)
    if fenced:
        text = fenced.group(1)
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError("model did not return valid JSON") from e
    if not isinstance(data, dict):
        raise ValueError("model JSON must be an object")
    return data


async def _repair_practice_json(
    raw: str,
    kind: str,
    count: int,
    context: str,
) -> dict:
    repair_prompt = f"""
Convert the following model output into valid JSON for an interactive study practice set.

Return ONLY valid JSON with this exact shape:
{{
  "title": "short title",
  "kind": "{kind}",
  "questions": [
    {{
      "id": "q1",
      "question": "question text",
      "options": ["A option", "B option", "C option", "D option"],
      "answerIndex": 0,
      "explanation": "brief explanation",
      "sourceHint": "short source/topic hint"
    }}
  ]
}}

Rules:
- Preserve the questions and options from the output when possible.
- Include no more than {count} questions.
- If the correct answer is missing, infer it from the notebook context only when clear.
- answerIndex is zero-based.
- Return JSON only.

Model output:
{raw[:24_000]}

Notebook context:
{context[:45_000]}
""".strip()
    repaired = await llm.chat(
        [
            {
                "role": "system",
                "content": "You repair malformed quiz output into valid JSON only.",
            },
            {"role": "user", "content": repair_prompt},
        ],
        model=runtime.get_model(),
        response_mime_type="application/json",
        max_output_tokens=8192,
    )
    return _extract_json_object(repaired)


def _coerce_answer_index(question: dict, options: list[str]) -> int | None:
    raw = question.get("answerIndex")
    if raw is None:
        raw = question.get("answer_index")
    if raw is None:
        raw = question.get("correctIndex")
    if raw is None:
        raw = question.get("correct_index")
    if raw is None:
        raw = question.get("correctAnswer")
    if raw is None:
        raw = question.get("correct")
    if raw is None:
        raw = question.get("answer")
    if isinstance(raw, int):
        return raw if 0 <= raw < len(options) else None
    value = str(raw or "").strip()
    if not value:
        return None
    if value.isdigit():
        idx = int(value)
        if 0 <= idx < len(options):
            return idx
        if 1 <= idx <= len(options):
            return idx - 1
    letter = value[0].upper()
    if "A" <= letter <= "Z":
        idx = ord(letter) - ord("A")
        if 0 <= idx < len(options):
            return idx
    for idx, option in enumerate(options):
        if value.lower() in option.lower() or option.lower() in value.lower():
            return idx
    return None


def _normalize_practice_payload(data: dict, kind: str, count: int) -> dict:
    raw_questions = data.get("questions")
    if not isinstance(raw_questions, list):
        raise ValueError("practice JSON needs a questions array")

    questions: list[dict] = []
    for index, item in enumerate(raw_questions[:count], start=1):
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("question") or item.get("prompt") or "").strip()
        raw_options = item.get("options")
        if isinstance(raw_options, dict):
            raw_options = [
                raw_options[key]
                for key in sorted(raw_options)
                if str(raw_options.get(key) or "").strip()
            ]
        if not prompt or not isinstance(raw_options, list):
            continue
        options = [str(option).strip() for option in raw_options if str(option).strip()]
        if len(options) < 2:
            continue
        answer_index = _coerce_answer_index(item, options)
        if answer_index is None:
            continue
        questions.append(
            {
                "id": str(item.get("id") or f"q{index}"),
                "question": prompt,
                "options": options[:6],
                "answerIndex": answer_index,
                "explanation": str(item.get("explanation") or "").strip(),
                "sourceHint": str(item.get("sourceHint") or item.get("source") or "").strip(),
            }
        )

    if not questions:
        raise ValueError("practice JSON did not contain valid multiple-choice questions")
    label = "Quiz" if kind == "quiz" else "Practice test"
    return {
        "title": str(data.get("title") or f"{label} from notebook").strip()[:120],
        "kind": "quiz" if kind == "quiz" else "test",
        "questions": questions,
        "createdAt": time.time(),
    }


async def _generate_learning_practice(
    owner_uid: str,
    sid: str,
    kind: str,
    count: int,
) -> dict:
    normalized_kind = "quiz" if kind.strip().lower() == "quiz" else "test"
    context = _learning_context_block(owner_uid, sid)
    if not context:
        raise HTTPException(
            status_code=400,
            detail="add learning materials before creating practice",
        )

    label = "short interactive quiz" if normalized_kind == "quiz" else "practice test"
    prompt = f"""
Create a {label} from the learning notebook materials.

Return ONLY valid JSON with this exact shape:
{{
  "title": "short title",
  "kind": "{normalized_kind}",
  "questions": [
    {{
      "id": "q1",
      "question": "question text",
      "options": ["A option", "B option", "C option", "D option"],
      "answerIndex": 0,
      "explanation": "why the answer is correct, based on the notebook",
      "sourceHint": "short source/topic hint"
    }}
  ]
}}

Rules:
- Produce {count} multiple-choice questions.
- Use 4 answer options when possible.
- answerIndex must be zero-based.
- Make plausible distractors, but only mark one correct answer.
- Base questions on the notebook materials. Do not invent unsupported facts.
- Keep explanations concise and useful for studying.

{context}
""".strip()
    try:
        raw = await llm.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You create reliable interactive study quizzes from "
                        "course materials. You must return valid JSON only."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            model=runtime.get_model(),
            response_mime_type="application/json",
            max_output_tokens=8192,
        )
        try:
            data = _extract_json_object(raw)
            return _normalize_practice_payload(data, normalized_kind, count)
        except Exception as first_error:
            repaired_data = await _repair_practice_json(
                raw,
                normalized_kind,
                count,
                context,
            )
            try:
                return _normalize_practice_payload(
                    repaired_data,
                    normalized_kind,
                    count,
                )
            except Exception as repair_error:
                raise ValueError(
                    f"{first_error}; repair failed: {repair_error}"
                ) from repair_error
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"could not create interactive practice: {e}",
        ) from e


_LEARNING_STOP_WORDS = {
    "about",
    "after",
    "again",
    "being",
    "could",
    "every",
    "their",
    "there",
    "these",
    "those",
    "through",
    "under",
    "where",
    "which",
    "would",
}


async def _convert_attachments(
    owner_uid: str,
    session_id: str,
    instruction: str,
    attachment_ids: list[str] | None,
) -> dict:
    rows = database.list_attachments(owner_uid, attachment_ids or [])
    out_attachments: list[dict] = []
    try:
        converted, failures = await asyncio.to_thread(
            converter.convert_files,
            rows,
            instruction,
        )
        for item in converted:
            path, excerpt = attachments.store_bytes(
                owner_uid,
                item.name,
                item.data,
                item.mime,
            )
            rec = database.insert_attachment(
                owner_uid=owner_uid,
                session_id=session_id,
                name=item.name,
                mime=item.mime,
                size=len(item.data),
                path=path,
                text_excerpt=excerpt,
            )
            out_attachments.append(rec)
        target = converter.parse_target_format(instruction)
        label = target.upper() if target else "the requested format"
        noun = "file" if len(out_attachments) == 1 else "files"
        content = f"Converted {len(out_attachments)} {noun} to {label}."
        if failures:
            content += "\n\nSome files were skipped:\n" + "\n".join(
                f"- {failure}" for failure in failures
            )
        content += "\n\nClick the attachment below to download."
    except converter.ConversionError as e:
        content = f"I couldn't convert that: {e}"

    return database.append_message(
        owner_uid,
        session_id,
        "assistant",
        content,
        attachments=out_attachments,
    )


def _wants_generated_pdf(instruction: str, rows: list[dict]) -> bool:
    if converter.parse_target_format(instruction) != "pdf":
        return False
    text = (instruction or "").lower()
    doc_words = (
        "booklet",
        "brochure",
        "create",
        "document",
        "explain",
        "generate",
        "guide",
        "make",
        "report",
        "write",
    )
    simple_convert = re.search(
        r"\b(?:convert|turn)\s+(?:this|these|the)?\s*"
        r"(?:file|files|image|images|photo|photos|png|jpg|jpeg|pptx|powerpoint)?"
        r"\s*(?:to|into)\s+pdf\b",
        text,
    )
    if simple_convert and not any(word in text for word in doc_words):
        return False
    return not rows or any(word in text for word in doc_words)


def _pdf_title(instruction: str) -> str:
    text = re.sub(r"\b(?:make|create|generate|write|build|convert)\b", "", instruction, flags=re.I)
    text = re.sub(r"\b(?:a|an|the|pdf|document|file|for me|please)\b", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" .:-")
    return (text[:70].strip() or "Privai PDF Document").title()


async def _generate_pdf_document(
    owner_uid: str,
    session_id: str,
    instruction: str,
    rows: list[dict],
    attachments_text: str,
) -> dict:
    title = _pdf_title(instruction)
    system = (
        "You create concise, polished PDF document content. Return only "
        "Markdown. Use headings, short paragraphs, and bullets where helpful. "
        "Do not include HTML, code fences, or download instructions."
    )
    prompt = (
        f"User request:\n{instruction or 'Create a private PDF document.'}\n\n"
        f"Document title:\n{title}\n\n"
    )
    if attachments_text:
        prompt += f"Attached file excerpts:\n{attachments_text[:12000]}\n\n"
    if any(str(r.get("mime") or "").lower().startswith("image/") for r in rows):
        prompt += (
            "Some attached images will be inserted into the PDF after the text. "
            "If image content is visible, refer to it naturally."
        )

    image_payloads = _image_payloads(rows)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    if image_payloads:
        messages[1]["images"] = image_payloads

    try:
        markdown = await llm.chat(
            messages,
            model=runtime.get_vision_model() if image_payloads else None,
        )
    except Exception as e:
        log.warning("PDF content generation fell back to local text: %s", e)
        markdown = f"# {title}\n\n{instruction or 'Generated private PDF.'}"
        if attachments_text:
            markdown += f"\n\n## Attached context\n\n{attachments_text[:3000]}"

    image_rows = [
        r for r in rows if str(r.get("mime") or "").lower() in {"image/jpeg", "image/jpg", "image/png"}
    ]
    try:
        data = await asyncio.to_thread(
            pdf_builder.render_markdown_pdf,
            title,
            markdown,
            image_rows,
        )
        name = pdf_builder.filename_from_title(title)
        path, excerpt = attachments.store_bytes(owner_uid, name, data, "application/pdf")
        rec = database.insert_attachment(
            owner_uid=owner_uid,
            session_id=session_id,
            name=name,
            mime="application/pdf",
            size=len(data),
            path=path,
            text_excerpt=excerpt,
        )
        content = (
            "Created a private PDF document from your instructions"
            + (" and attachments." if rows else ".")
            + "\n\nClick the attachment below to download."
        )
        return database.append_message(
            owner_uid,
            session_id,
            "assistant",
            content,
            attachments=[rec],
        )
    except Exception as e:
        return database.append_message(
            owner_uid,
            session_id,
            "assistant",
            f"I couldn't make that PDF locally: {e}",
        )


@app.post("/chat")
async def chat(req: ChatRequest, caller: Caller = Depends(require_owner)):
    first_title = req.message or ("File conversion" if req.mode == "convert" else "New chat")
    sid = req.sessionId or database.create_session(caller.uid, first_title, req.space)["id"]
    hist = _history_for(caller.uid, sid)
    mode = _normalize_mode(req.mode)
    attach_descriptors, attach_text = _resolve_attachments(
        caller.uid, req.attachmentIds
    )
    attach_rows = database.list_attachments(caller.uid, req.attachmentIds or [])
    session_info = database.get_session(caller.uid, sid)
    session_space = req.space or (session_info.get("space") if session_info else None)
    if session_space == "learning":
        learning_context = _learning_context_block(caller.uid, sid)
        if learning_context:
            attach_text = "\n\n".join(
                part for part in [learning_context, attach_text] if part
            )
    image_payloads = (
        _image_payloads(attach_rows)
        if _should_use_vision(req.message, attach_rows, mode)
        else None
    )

    user_msg = database.append_message(
        caller.uid,
        sid,
        "user",
        req.message or ("Convert files" if mode == "convert" else ""),
        attachments=attach_descriptors,
    )

    if mode == "convert":
        if _wants_generated_pdf(req.message, attach_rows):
            asst_msg = await _generate_pdf_document(
                caller.uid,
                sid,
                req.message,
                attach_rows,
                attach_text,
            )
        else:
            asst_msg = await _convert_attachments(
                caller.uid,
                sid,
                req.message,
                req.attachmentIds,
            )
        return {
            "sessionId": sid,
            "user": user_msg,
            "assistant": asst_msg,
        }

    command_approval_required = (
        settings.agent_command_approval_required
        if req.commandApprovalRequired is None
        else req.commandApprovalRequired
    )
    if mode == "agent" and command_approval_required:
        raise HTTPException(
            status_code=400,
            detail="command approval requires streaming chat",
        )

    try:
        turn = await orch.answer(
            req.message,
            history=hist,
            force_search=req.forceSearch,
            mode=mode,
            attachments_text=attach_text or None,
            search_top_k=req.searchTopK,
            image_payloads=image_payloads,
            experience=req.experience,
            privacy_mode=req.privacyMode,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}") from e

    raw_answer = turn.answer.strip() or _empty_model_response_message()
    visible, artifact = artifacts.extract(raw_answer)
    asst_msg = database.append_message(
        caller.uid,
        sid,
        "assistant",
        visible,
        used_search=turn.used_search,
        sources=turn.sources,
        redactions=turn.redactions,
        artifact=artifact,
    )
    is_first_turn = req.sessionId is None or len(hist) == 0
    if is_first_turn and req.message:
        database.rename_session(caller.uid, sid, req.message[:60])
        asyncio.create_task(_auto_title(caller.uid, sid, req.message))
    return {
        "sessionId": sid,
        "user": user_msg,
        "assistant": asst_msg,
    }


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, caller: Caller = Depends(require_owner)):
    first_title = req.message or ("File conversion" if req.mode == "convert" else "New chat")
    sid = req.sessionId or database.create_session(caller.uid, first_title, req.space)["id"]
    hist = _history_for(caller.uid, sid)
    mode = _normalize_mode(req.mode)
    attach_descriptors, attach_text = _resolve_attachments(
        caller.uid, req.attachmentIds
    )
    attach_rows = database.list_attachments(caller.uid, req.attachmentIds or [])
    session_info = database.get_session(caller.uid, sid)
    session_space = req.space or (session_info.get("space") if session_info else None)
    if session_space == "learning":
        learning_context = _learning_context_block(caller.uid, sid)
        if learning_context:
            attach_text = "\n\n".join(
                part for part in [learning_context, attach_text] if part
            )
    image_payloads = (
        _image_payloads(attach_rows)
        if _should_use_vision(req.message, attach_rows, mode)
        else None
    )
    user_msg = database.append_message(
        caller.uid,
        sid,
        "user",
        req.message or ("Convert files" if mode == "convert" else ""),
        attachments=attach_descriptors,
    )

    if mode == "convert":
        async def convert_gen() -> AsyncIterator[bytes]:
            yield _sse({
                "type": "meta",
                "sessionId": sid,
                "user": user_msg,
                "usedSearch": False,
                "sources": [],
                "redactions": [],
                "mode": mode,
            })
            if _wants_generated_pdf(req.message, attach_rows):
                asst_msg = await _generate_pdf_document(
                    caller.uid,
                    sid,
                    req.message,
                    attach_rows,
                    attach_text,
                )
            else:
                asst_msg = await _convert_attachments(
                    caller.uid,
                    sid,
                    req.message,
                    req.attachmentIds,
                )
            yield _sse({"type": "done", "assistant": asst_msg, "artifact": None})

        return StreamingResponse(
            convert_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    prep = await orch.prepare(
        req.message,
        history=hist,
        force_search=req.forceSearch,
        mode=mode,
        attachments_text=attach_text or None,
        search_top_k=req.searchTopK,
        image_payloads=image_payloads,
        experience=req.experience,
        privacy_mode=req.privacyMode,
    )
    command_approval_required = (
        settings.agent_command_approval_required
        if req.commandApprovalRequired is None
        else req.commandApprovalRequired
    )

    async def gen() -> AsyncIterator[bytes]:
        meta = {
            "type": "meta",
            "sessionId": sid,
            "user": user_msg,
            "usedSearch": prep.used_search,
            "sources": prep.sources,
            "redactions": prep.redactions,
            "mode": mode,
            "provider": prep.provider,
            "routeReason": prep.route_reason,
            "routedSensitive": prep.routed_sensitive,
        }
        yield _sse(meta)

        full: list[str] = []
        # While inside an <artifact> block we suppress deltas — we don't want
        # the user to see a wall of HTML scroll past in the chat bubble.
        try:
            if orch._should_use_agent_tools(prep):
                tool_events: asyncio.Queue[dict] = asyncio.Queue()

                async def on_tool_event(event: dict) -> None:
                    if event.get("name") == "run_terminal_command":
                        await tool_events.put({
                            **event,
                            **terminal.command_policy(str(event.get("command") or "")),
                        })
                    else:
                        await tool_events.put(event)

                async def request_tool_approval(event: dict) -> bool:
                    if event.get("name") != "run_terminal_command":
                        return True
                    policy = terminal.command_policy(str(event.get("command") or ""))
                    event = {**event, **policy}
                    if req.autoApproveReadOnlyCommands and policy.get("readOnly"):
                        return True
                    if not command_approval_required:
                        return True
                    pending = await approvals.command_approvals.create(
                        caller.uid,
                        str(event.get("command") or ""),
                        str(event.get("cwd") or "."),
                    )
                    await tool_events.put({
                        **event,
                        "status": "pending_approval",
                        "approvalId": pending.id,
                    })
                    return await approvals.command_approvals.wait(pending.id)

                task = asyncio.create_task(
                    orch.complete(
                        prep,
                        on_tool_event=on_tool_event,
                        request_tool_approval=request_tool_approval,
                        owner_uid=caller.uid,
                    )
                )
                yielded_working = False
                while True:
                    if task.done():
                        while not tool_events.empty():
                            yield _sse({"type": "tool", **tool_events.get_nowait()})
                        full.append(task.result())
                        break
                    try:
                        event = await asyncio.wait_for(tool_events.get(), 0.25)
                        yield _sse({"type": "tool", **event})
                    except asyncio.TimeoutError:
                        if not yielded_working:
                            yield _sse({
                                "type": "delta",
                                "delta": "_working in the terminal..._\n",
                            })
                            yielded_working = True
            else:
                stream_llm = (
                    llm
                    if not prep.provider or prep.provider == llm.provider
                    else LLMClient(provider=prep.provider)
                )
                async for chunk in stream_llm.chat_stream(
                    prep.messages,
                    model=prep.model,
                ):
                    full.append(chunk)
                    joined = "".join(full)
                    if mode == "agent" and artifacts.has_open_unfinished(joined):
                        # Emit a single placeholder once when we first detect a
                        # stream-in-progress artifact.
                        if chunk and "<artifact" in chunk.lower():
                            yield _sse({
                                "type": "delta",
                                "delta": "\n\n_(building artifact...)_\n",
                            })
                        continue
                    yield _sse({"type": "delta", "delta": chunk})
        except Exception as e:
            yield _sse({"type": "error", "error": str(e)})
            return

        text = "".join(full).strip() or _empty_model_response_message()
        visible, artifact = artifacts.extract(text)
        asst_msg = database.append_message(
            caller.uid,
            sid,
            "assistant",
            visible,
            used_search=prep.used_search,
            sources=prep.sources,
            redactions=prep.redactions,
            artifact=artifact,
        )
        is_first_turn = req.sessionId is None or len(hist) == 0
        if is_first_turn and req.message:
            database.rename_session(caller.uid, sid, req.message[:60])
            asyncio.create_task(_auto_title(caller.uid, sid, req.message))
        yield _sse({"type": "done", "assistant": asst_msg, "artifact": artifact})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode()


# ---- agent preview ------------------------------------------------------


@app.get("/business/settings")
async def get_business_settings(_caller: Caller = Depends(require_owner)):
    return business.get_settings()


@app.post("/business/settings")
async def update_business_settings(
    req: BusinessSettingsPatch,
    _caller: Caller = Depends(require_owner),
):
    return business.set_settings(req.model_dump(exclude_unset=True))


@app.get("/google/status")
async def google_status(caller: Caller = Depends(require_owner)):
    return google_workspace.status(caller.uid)


@app.get("/google/auth-url")
async def google_auth_url(caller: Caller = Depends(require_owner)):
    try:
        return {"url": google_workspace.auth_url(caller.uid)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/google/oauth/callback", response_class=HTMLResponse)
async def google_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        return HTMLResponse(
            "<html><body><h2>Google connection failed</h2>"
            f"<p>{html.escape(error)}</p></body></html>",
            status_code=400,
        )
    owner_uid = google_workspace.owner_from_state(state or "")
    if not code or not owner_uid or owner_uid != database.get_owner_uid():
        return HTMLResponse(
            "<html><body><h2>Google connection failed</h2><p>Invalid OAuth state.</p></body></html>",
            status_code=400,
        )
    try:
        await google_workspace.exchange_code(owner_uid, code)
    except Exception as e:
        return HTMLResponse(
            "<html><body><h2>Google connection failed</h2>"
            f"<p>{html.escape(str(e))}</p></body></html>",
            status_code=502,
        )
    return HTMLResponse(
        "<html><body><h2>Google Workspace connected</h2>"
        "<p>You can close this tab and return to Privai.</p></body></html>"
    )


@app.post("/google/disconnect")
async def google_disconnect(caller: Caller = Depends(require_owner)):
    return google_workspace.disconnect(caller.uid)


@app.get("/business/email/search")
async def business_email_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=20),
    caller: Caller = Depends(require_owner),
):
    try:
        return await google_workspace.search_email(caller.uid, q, limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.get("/business/email/thread/{thread_id}")
async def business_email_thread(
    thread_id: str,
    caller: Caller = Depends(require_owner),
):
    try:
        return await google_workspace.read_email_thread(caller.uid, thread_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/business/calendar/slots")
async def business_calendar_slots(
    req: CalendarSlotsRequest,
    caller: Caller = Depends(require_owner),
):
    try:
        return await google_workspace.find_calendar_slots(
            owner_uid=caller.uid,
            time_min=req.timeMin,
            time_max=req.timeMax,
            duration_minutes=req.durationMinutes,
            calendar_id=req.calendarId,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/business/calendar/events/draft")
async def business_calendar_event_draft(
    req: CalendarEventRequest,
    caller: Caller = Depends(require_owner),
):
    try:
        return google_workspace.draft_calendar_action(
            caller.uid,
            {
                "summary": req.summary,
                "description": req.description,
                "start": req.start,
                "end": req.end,
                "timezone": req.timezone,
                "attendees": req.attendees,
                "calendar_id": req.calendarId,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/business/actions")
async def business_actions(
    status: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=100),
    caller: Caller = Depends(require_owner),
):
    return {"actions": database.list_business_actions(caller.uid, status, limit)}


@app.post("/business/actions/{action_id}/approve")
async def approve_business_action(
    action_id: str,
    caller: Caller = Depends(require_owner),
):
    action = database.get_business_action(caller.uid, action_id)
    if not action:
        raise HTTPException(status_code=404, detail="business action not found")
    if action["status"] != "pending":
        return action
    try:
        if action["kind"] == "calendar_event":
            result = await google_workspace.create_calendar_event(
                caller.uid,
                action["payload"],
            )
            updated = database.update_business_action(
                caller.uid,
                action_id,
                "completed",
                result,
            )
        else:
            updated = database.update_business_action(
                caller.uid,
                action_id,
                "completed",
                {"ok": True},
            )
    except Exception as e:
        database.update_business_action(caller.uid, action_id, "failed", {"error": str(e)})
        raise HTTPException(status_code=502, detail=str(e)) from e
    if not updated:
        raise HTTPException(status_code=404, detail="business action not found")
    return updated


@app.post("/business/actions/{action_id}/reject")
async def reject_business_action(
    action_id: str,
    caller: Caller = Depends(require_owner),
):
    updated = database.update_business_action(
        caller.uid,
        action_id,
        "rejected",
        {"ok": False},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="business action not found")
    return updated


@app.get("/learning/{sid}/materials")
async def get_learning_materials(
    sid: str,
    caller: Caller = Depends(require_owner),
):
    _ensure_learning_session(caller.uid, sid)
    items = database.list_learning_materials(caller.uid, sid)
    return {
        "materials": items,
        "studied": sum(1 for item in items if item.get("status") == "studied"),
        "total": len(items),
    }


@app.post("/learning/{sid}/materials/text")
async def add_learning_text_material(
    sid: str,
    req: LearningTextMaterialRequest,
    caller: Caller = Depends(require_owner),
):
    _ensure_learning_session(caller.uid, sid)
    title = req.title or "Pasted notes"
    status, summary = await _study_text_material(title, req.content)
    item = database.insert_learning_material(
        owner_uid=caller.uid,
        session_id=sid,
        title=title,
        kind="text",
        mime="text/plain",
        size=len(req.content.encode("utf-8")),
        status=status,
        summary=summary,
        text_excerpt=req.content[: attachments.TEXT_PREVIEW_BYTES],
    )
    return item


@app.post("/learning/{sid}/materials/attachment")
async def add_learning_attachment_material(
    sid: str,
    req: LearningAttachmentMaterialRequest,
    caller: Caller = Depends(require_owner),
):
    return await _add_learning_attachment_material(caller.uid, sid, req.attachmentId)


@app.post("/learning/{sid}/materials")
async def add_learning_material_compat(
    sid: str,
    req: LearningAttachmentMaterialRequest,
    caller: Caller = Depends(require_owner),
):
    return await _add_learning_attachment_material(caller.uid, sid, req.attachmentId)


@app.post("/learning/{sid}/practice")
async def create_learning_practice(
    sid: str,
    req: LearningPracticeRequest,
    caller: Caller = Depends(require_owner),
):
    _ensure_learning_session(caller.uid, sid)
    return await _generate_learning_practice(
        caller.uid,
        sid,
        req.kind,
        req.count,
    )


async def _add_learning_attachment_material(
    owner_uid: str,
    sid: str,
    attachment_id: str,
):
    _ensure_learning_session(owner_uid, sid)
    row = database.get_attachment(owner_uid, attachment_id)
    if not row:
        raise HTTPException(status_code=404, detail="attachment not found")
    title = row["name"]
    text = row.get("text_excerpt") or ""
    if not text and str(row.get("mime") or "").lower().startswith("image/"):
        text = await _study_image_material(row) or ""
    status, summary = await _study_text_material(title, text)
    item = database.insert_learning_material(
        owner_uid=owner_uid,
        session_id=sid,
        attachment_id=row["id"],
        title=title,
        kind="file",
        mime=row["mime"],
        size=row["size"],
        status=status,
        summary=summary,
        text_excerpt=text,
    )
    return item


@app.delete("/learning/{sid}/materials/{mid}")
async def delete_learning_material(
    sid: str,
    mid: str,
    caller: Caller = Depends(require_owner),
):
    _ensure_learning_session(caller.uid, sid)
    if not database.delete_learning_material(caller.uid, sid, mid):
        raise HTTPException(status_code=404, detail="material not found")
    return {"ok": True}


@app.post("/agent/approvals/{approval_id}")
async def decide_agent_command(
    approval_id: str,
    req: ApprovalDecision,
    caller: Caller = Depends(require_owner),
):
    try:
        await approvals.command_approvals.decide(
            approval_id,
            caller.uid,
            req.approved,
        )
    except approvals.ApprovalNotFound as e:
        raise HTTPException(status_code=404, detail="approval not found") from e
    except approvals.ApprovalOwnerMismatch as e:
        raise HTTPException(status_code=403, detail="approval owner mismatch") from e
    return {"ok": True, "approved": req.approved}


@app.post("/agent/approvals/{approval_id}/approve")
async def approve_agent_command(
    approval_id: str,
    caller: Caller = Depends(require_owner),
):
    try:
        await approvals.command_approvals.decide(approval_id, caller.uid, True)
    except approvals.ApprovalNotFound as e:
        raise HTTPException(status_code=404, detail="approval not found") from e
    except approvals.ApprovalOwnerMismatch as e:
        raise HTTPException(status_code=403, detail="approval owner mismatch") from e
    return {"ok": True, "approved": True}


@app.post("/agent/approvals/{approval_id}/reject")
async def reject_agent_command(
    approval_id: str,
    caller: Caller = Depends(require_owner),
):
    try:
        await approvals.command_approvals.decide(approval_id, caller.uid, False)
    except approvals.ApprovalNotFound as e:
        raise HTTPException(status_code=404, detail="approval not found") from e
    except approvals.ApprovalOwnerMismatch as e:
        raise HTTPException(status_code=403, detail="approval owner mismatch") from e
    return {"ok": True, "approved": False}


@app.post("/agent/preview")
async def start_agent_preview(
    req: PreviewRequest,
    _caller: Caller = Depends(require_owner),
):
    try:
        return await preview.start_preview(req.cwd)
    except preview.PreviewError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/agent/preview/stop")
async def stop_agent_preview(_caller: Caller = Depends(require_owner)):
    return await preview.stop_preview()


@app.get("/agent/preview")
async def get_agent_preview(_caller: Caller = Depends(require_owner)):
    return preview.preview_status()


# ---- workspace browser/editor/terminal ---------------------------------


@app.get("/workspace/tree")
async def workspace_tree(
    path: str = ".",
    _caller: Caller = Depends(require_owner),
):
    target = _resolve_workspace_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="path not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="path is not a folder")

    items: list[dict] = []
    try:
        entries = list(target.iterdir())
    except OSError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    for child in entries:
        name = child.name
        if name == ".DS_Store":
            continue
        try:
            child.resolve().relative_to(terminal.workspace_root())
        except ValueError:
            continue
        if child.is_dir() and name in _WORKSPACE_SKIP_DIRS:
            continue
        if name.startswith(".") and name not in {".env", ".gitignore"}:
            continue
        try:
            stat = child.stat()
        except OSError:
            continue
        items.append(
            {
                "name": name,
                "path": _workspace_rel(child),
                "type": "directory" if child.is_dir() else "file",
                "size": stat.st_size if child.is_file() else None,
                "modified": stat.st_mtime,
                "language": _language_for(child) if child.is_file() else None,
            }
        )

    items.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    return {
        "root": str(terminal.workspace_root()),
        "path": _workspace_rel(target),
        "parent": _workspace_rel(target.parent)
        if target.resolve() != terminal.workspace_root()
        else None,
        "items": items[:500],
    }


@app.get("/workspace/search")
async def workspace_search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    _caller: Caller = Depends(require_owner),
):
    needle = q.lower()
    matches: list[dict] = []
    for path in _iter_workspace_files():
        try:
            if path.stat().st_size > 500_000 or not _is_text_file(path):
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if needle in line.lower():
                matches.append(
                    {
                        "path": _workspace_rel(path),
                        "line": line_number,
                        "text": line.strip()[:500],
                        "language": _language_for(path),
                    }
                )
                if len(matches) >= limit:
                    return {"query": q, "matches": matches}
    return {"query": q, "matches": matches}


@app.get("/workspace/checkpoints")
async def workspace_checkpoints(caller: Caller = Depends(require_owner)):
    items: list[dict] = []
    for path in _checkpoint_dir(caller.uid).glob("*.json"):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items.append(_checkpoint_meta(raw))
    items.sort(key=lambda item: item["createdAt"], reverse=True)
    return {"checkpoints": items[:50]}


@app.post("/workspace/checkpoints")
async def create_workspace_checkpoint(
    req: WorkspaceCheckpointRequest,
    caller: Caller = Depends(require_owner),
):
    try:
        root = terminal.workspace_root()
    except terminal.TerminalError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    files, skipped = _workspace_snapshot()
    checkpoint = {
        "id": uuid.uuid4().hex,
        "title": req.title or "Workspace checkpoint",
        "createdAt": time.time(),
        "root": str(root),
        "files": files,
        "skipped": skipped,
    }
    target = _checkpoint_dir(caller.uid) / f"{checkpoint['id']}.json"
    target.write_text(json.dumps(checkpoint), encoding="utf-8")
    return _checkpoint_meta(checkpoint)


@app.post("/workspace/checkpoints/{checkpoint_id}/restore")
async def restore_workspace_checkpoint(
    checkpoint_id: str,
    caller: Caller = Depends(require_owner),
):
    if not re.fullmatch(r"[a-f0-9]{32}", checkpoint_id):
        raise HTTPException(status_code=400, detail="invalid checkpoint id")
    target = _checkpoint_dir(caller.uid) / f"{checkpoint_id}.json"
    if not target.exists():
        raise HTTPException(status_code=404, detail="checkpoint not found")
    try:
        checkpoint = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail="checkpoint is unreadable") from e
    try:
        root = terminal.workspace_root()
    except terminal.TerminalError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if checkpoint.get("root") != str(root):
        raise HTTPException(
            status_code=409,
            detail="checkpoint belongs to a different workspace root",
        )
    restored = 0
    for rel, content in (checkpoint.get("files") or {}).items():
        file_path = _resolve_workspace_path(rel)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            file_path.write_text(str(content), encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        restored += 1
    return {"ok": True, "restored": restored}


@app.get("/workspace/file")
async def workspace_file(
    path: str,
    _caller: Caller = Depends(require_owner),
):
    target = _resolve_workspace_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="file not found")
    if not target.is_file():
        raise HTTPException(status_code=400, detail="path is not a file")
    if target.stat().st_size > 2_000_000:
        raise HTTPException(status_code=413, detail="file is too large to edit here")
    if not _is_text_file(target):
        raise HTTPException(status_code=415, detail="binary file cannot be edited here")
    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=415, detail="file is not valid UTF-8 text") from e
    stat = target.stat()
    return {
        "path": _workspace_rel(target),
        "name": target.name,
        "content": content,
        "language": _language_for(target),
        "size": stat.st_size,
        "modified": stat.st_mtime,
    }


@app.post("/workspace/file")
async def save_workspace_file(
    req: WorkspaceSaveFileRequest,
    _caller: Caller = Depends(require_owner),
):
    target = _resolve_workspace_path(req.path)
    if not target.parent.exists():
        raise HTTPException(status_code=400, detail="parent folder does not exist")
    if target.exists() and not target.is_file():
        raise HTTPException(status_code=400, detail="path is not a file")
    try:
        target.write_text(req.content, encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "path": _workspace_rel(target),
        "size": target.stat().st_size,
        "modified": target.stat().st_mtime,
    }


@app.post("/workspace/terminal")
async def run_workspace_terminal(
    req: WorkspaceTerminalRequest,
    _caller: Caller = Depends(require_owner),
):
    try:
        result = await terminal.run_command(req.command, req.cwd, req.timeoutS)
    except terminal.TerminalError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        **json.loads(terminal.result_json(result)),
        **terminal.command_policy(req.command),
    }


# ---- attachments --------------------------------------------------------


@app.post("/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    sessionId: str | None = None,
    caller: Caller = Depends(require_owner),
):
    raw = await file.read()
    if len(raw) > attachments.MAX_UPLOAD_BYTES:
        max_mb = attachments.MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"file too large (max {max_mb} MB)",
        )
    name = file.filename or "file"
    mime = file.content_type or "application/octet-stream"
    path, excerpt = attachments.store_bytes(caller.uid, name, raw, mime)
    rec = database.insert_attachment(
        owner_uid=caller.uid,
        session_id=sessionId,
        name=name,
        mime=mime,
        size=len(raw),
        path=path,
        text_excerpt=excerpt,
    )
    return rec


@app.delete("/attachments/{aid}")
async def delete_attachment(aid: str, caller: Caller = Depends(require_owner)):
    rec = database.get_attachment(caller.uid, aid)
    if not rec:
        raise HTTPException(status_code=404, detail="attachment not found")
    try:
        os.remove(rec["path"])
    except FileNotFoundError:
        pass
    database.delete_attachment(caller.uid, aid)
    return {"ok": True}


@app.get("/attachments/{aid}/raw")
async def get_attachment_raw(aid: str, caller: Caller = Depends(require_owner)):
    rec = database.get_attachment(caller.uid, aid)
    if not rec:
        raise HTTPException(status_code=404, detail="attachment not found")
    return FileResponse(
        rec["path"],
        media_type=rec["mime"],
        filename=rec["name"],
    )


async def _auto_title(uid: str, sid: str, first_message: str) -> None:
    try:
        title = await orch.generate_title(first_message)
        if title:
            database.rename_session(uid, sid, title)
    except Exception as e:
        log.warning("auto-title failed for sid=%s: %s", sid, e)


# ---- search (debug) -----------------------------------------------------


class SearchRequest(BaseModel):
    q: str
    top_k: int | None = None


@app.post("/search")
async def do_search(
    req: SearchRequest, _caller: Caller = Depends(require_owner)
):
    try:
        return {"results": await search.search(req.q, top_k=req.top_k)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


# ---- static frontend (no-cloud fallback) --------------------------------

_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static")

    @app.get("/")
    async def index():
        return FileResponse(_FRONTEND_DIR / "index.html")
