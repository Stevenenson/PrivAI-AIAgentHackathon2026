"""Admin endpoints — start/stop/status for the configured LLM provider.

Authenticated as the device *owner* (Firebase ID token). No separate token,
because the owner is already the most-privileged caller for this device.
"""
from __future__ import annotations

import asyncio
import shutil

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import Caller, require_owner
from .config import settings
from . import runtime

router = APIRouter(prefix="/admin/llm", tags=["admin"])


async def _ollama_ps() -> list[dict]:
    if not shutil.which("ollama"):
        return []
    proc = await asyncio.create_subprocess_exec(
        "ollama", "ps",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    text = out.decode().strip().splitlines()
    if len(text) < 2:
        return []
    rows = []
    for line in text[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        rows.append({
            "name": parts[0],
            "id": parts[1],
            "size": " ".join(parts[2:4]),
            "processor": parts[4] if len(parts) > 4 else "",
            "until": " ".join(parts[5:]) if len(parts) > 5 else "",
        })
    return rows


async def _ollama_stop(model: str) -> tuple[bool, str]:
    if not shutil.which("ollama"):
        return False, "ollama binary not found"
    proc = await asyncio.create_subprocess_exec(
        "ollama", "stop", model,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        return False, (err or out).decode().strip()
    return True, (out or err).decode().strip() or "stopped"


async def _ollama_warmup(model: str) -> tuple[bool, str]:
    payload = {
        "model": model,
        "prompt": "",
        "stream": False,
        "keep_alive": settings.llm_keep_alive,
        "options": {"num_predict": 1},
    }
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as c:
            r = await c.post(f"{settings.ollama_url}/api/generate", json=payload)
            r.raise_for_status()
        return True, "warmed up"
    except Exception as e:
        return False, str(e)


async def _ollama_list() -> list[dict]:
    """Parse `ollama list` into rows."""
    if not shutil.which("ollama"):
        return []
    proc = await asyncio.create_subprocess_exec(
        "ollama", "list",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    lines = out.decode().strip().splitlines()
    if len(lines) < 2:
        return []
    rows = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 3:
            continue
        rows.append({
            "name": parts[0],
            "id": parts[1],
            "size": " ".join(parts[2:4]),
            "modified": " ".join(parts[4:]) if len(parts) > 4 else "",
        })
    return rows


@router.get("/status")
async def status(_: Caller = Depends(require_owner)):
    if settings.llm_provider == "openai":
        active = runtime.get_model()
        configured = bool(settings.openai_api_key)
        return {
            "provider": "openai",
            "model": active,
            "default": runtime.default_model(),
            "loaded": configured,
            "running": (
                [{"name": active, "size": "remote", "processor": "OpenAI"}]
                if configured
                else []
            ),
        }

    running = await _ollama_ps()
    active = runtime.get_model()
    loaded = next((r for r in running if r["name"] == active), None)
    return {
        "provider": "ollama",
        "model": active,
        "default": runtime.default_model(),
        "loaded": loaded is not None,
        "running": running,
    }


@router.get("/models")
async def list_models(_: Caller = Depends(require_owner)):
    if settings.llm_provider == "openai":
        return {
            "provider": "openai",
            "active": runtime.get_model(),
            "installed": [
                {"name": name, "size": "OpenAI", "modified": "configured"}
                for name in runtime.available_models()
            ],
        }

    installed = await _ollama_list()
    return {
        "provider": "ollama",
        "active": runtime.get_model(),
        "installed": installed,
    }


class ModelChange(BaseModel):
    model: str


@router.post("/model")
async def set_model(req: ModelChange, _: Caller = Depends(require_owner)):
    name = req.model.strip()
    if not name:
        raise HTTPException(status_code=400, detail="model name required")
    if settings.llm_provider == "openai":
        runtime.set_model(name)
        return {"ok": True, "model": name}

    installed = await _ollama_list()
    available = {r["name"] for r in installed}
    if name not in available:
        raise HTTPException(
            status_code=404,
            detail=(
                f"model '{name}' not installed. Run `ollama pull {name}` "
                "on the device first."
            ),
        )
    runtime.set_model(name)
    return {"ok": True, "model": name}


@router.post("/start")
async def start(_: Caller = Depends(require_owner)):
    model = runtime.get_model()
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise HTTPException(status_code=502, detail="OPENAI_API_KEY is not set")
        return {
            "ok": True,
            "model": model,
            "message": "OpenAI provider configured; no local process to start",
        }

    ok, msg = await _ollama_warmup(model)
    if not ok:
        raise HTTPException(status_code=502, detail=msg)
    return {"ok": True, "model": model, "message": msg}


@router.post("/stop")
async def stop(_: Caller = Depends(require_owner)):
    model = runtime.get_model()
    if settings.llm_provider == "openai":
        return {
            "ok": True,
            "model": model,
            "message": "OpenAI provider is remote; no local process to stop",
        }

    ok, msg = await _ollama_stop(model)
    if not ok:
        raise HTTPException(status_code=502, detail=msg)
    return {"ok": True, "model": model, "message": msg}
