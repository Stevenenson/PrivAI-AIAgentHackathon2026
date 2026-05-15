"""Admin endpoints for the Gemini API provider.

Authenticated as the device *owner* (Firebase ID token). No separate token,
because the owner is already the most-privileged caller for this device.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import Caller, require_owner
from .config import settings
from . import runtime

router = APIRouter(prefix="/admin/llm", tags=["admin"])


@router.get("/status")
async def status(_: Caller = Depends(require_owner)):
    active = runtime.get_model()
    configured = bool(settings.gemini_api_key)
    return {
        "provider": "gemini",
        "model": active,
        "default": runtime.default_model(),
        "loaded": configured,
        "running": (
            [{"name": active, "size": "remote", "processor": "Gemini"}]
            if configured
            else []
        ),
    }


@router.get("/models")
async def list_models(_: Caller = Depends(require_owner)):
    return {
        "provider": "gemini",
        "active": runtime.get_model(),
        "installed": [
            {"name": name, "size": "Gemini", "modified": "configured"}
            for name in runtime.available_models()
        ],
    }


class ModelChange(BaseModel):
    model: str


@router.post("/model")
async def set_model(req: ModelChange, _: Caller = Depends(require_owner)):
    name = req.model.strip()
    if not name:
        raise HTTPException(status_code=400, detail="model name required")
    runtime.set_model(name)
    return {"ok": True, "model": name}


@router.post("/start")
async def start(_: Caller = Depends(require_owner)):
    model = runtime.get_model()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=502, detail="GEMINI_API_KEY is not set")
    return {
        "ok": True,
        "model": model,
        "message": "Gemini provider configured; no local process to start",
    }


@router.post("/stop")
async def stop(_: Caller = Depends(require_owner)):
    model = runtime.get_model()
    return {
        "ok": True,
        "model": model,
        "message": "Gemini provider is remote; no local process to stop",
    }
