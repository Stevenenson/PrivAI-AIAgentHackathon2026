"""FastAPI entrypoint for the privacy-first local AI assistant.

Privacy posture: all chat content is stored in local SQLite. Firebase is used
only for **identity** — we verify the caller's Firebase ID token and check it
against the device's paired owner. The web app talks to this backend directly
(no Firestore relay for chat).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

# kept here so async tasks below resolve clean
_ = asyncio

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from fastapi import File, UploadFile

from . import artifacts, attachments, converter, database, pdf_builder, runtime
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


app = FastAPI(title="Local AI Assistant", version="0.2.0", lifespan=lifespan)

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
    llm_ok = await llm.health()
    return {
        "llm": llm_ok,
        "provider": settings.llm_provider,
        "ollama": llm_ok if settings.llm_provider == "ollama" else False,
        "searxng": await search.health(),
        "model": runtime.get_model(),
        "default": runtime.default_model(),
        "paired": paired_uid is not None,
        "version": app.version,
        "numCtx": runtime.context_window(),
        "numPredict": settings.llm_num_predict,
        "searchTopK": settings.search_top_k,
        "visionModel": runtime.get_vision_model(),
        "terminalEnabled": settings.terminal_enabled,
        "workspaceRoot": settings.workspace_root,
        "agentMaxToolSteps": settings.agent_max_tool_steps,
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


@app.get("/sessions")
async def list_sessions(caller: Caller = Depends(require_owner)):
    return {"sessions": database.list_sessions(caller.uid)}


@app.post("/sessions")
async def create_session(
    req: SessionCreate, caller: Caller = Depends(require_owner)
):
    sess = database.create_session(caller.uid, req.title or "New chat")
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
    sid = req.sessionId or database.create_session(caller.uid, first_title)["id"]
    hist = _history_for(caller.uid, sid)
    mode = _normalize_mode(req.mode)
    attach_descriptors, attach_text = _resolve_attachments(
        caller.uid, req.attachmentIds
    )
    attach_rows = database.list_attachments(caller.uid, req.attachmentIds or [])
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

    try:
        turn = await orch.answer(
            req.message,
            history=hist,
            force_search=req.forceSearch,
            mode=mode,
            attachments_text=attach_text or None,
            search_top_k=req.searchTopK,
            image_payloads=image_payloads,
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
    sid = req.sessionId or database.create_session(caller.uid, first_title)["id"]
    hist = _history_for(caller.uid, sid)
    mode = _normalize_mode(req.mode)
    attach_descriptors, attach_text = _resolve_attachments(
        caller.uid, req.attachmentIds
    )
    attach_rows = database.list_attachments(caller.uid, req.attachmentIds or [])
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
        }
        yield _sse(meta)

        full: list[str] = []
        # While inside an <artifact> block we suppress deltas — we don't want
        # the user to see a wall of HTML scroll past in the chat bubble.
        try:
            if orch._should_use_agent_tools(prep):
                yield _sse({
                    "type": "delta",
                    "delta": "_working in the terminal..._\n",
                })
                full.append(await orch.complete(prep))
            else:
                async for chunk in llm.chat_stream(prep.messages, model=prep.model):
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
