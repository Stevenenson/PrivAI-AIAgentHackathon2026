"""Runtime overrides — what env defaults can be flipped at runtime by an
authenticated owner without a restart.

Only the model is overridable for now. We keep this in a tiny module so
LLMClient and the orchestrator agree on which model is active without a
circular-import dance.
"""
from __future__ import annotations

from . import database
from .config import settings


def get_provider() -> str:
    return "gemini"


def default_model(provider: str | None = None) -> str:
    return settings.gemini_model


def get_model(provider: str | None = None) -> str:
    return (
        database.get_kv("gemini_model")
        or database.get_kv("llm_model")
        or settings.gemini_model
    )


def set_model(model: str, provider: str | None = None) -> None:
    database.set_kv("gemini_model", model.strip())
    database.set_kv("llm_model", model.strip())


def get_vision_model(provider: str | None = None) -> str:
    return settings.gemini_vision_model or get_model("gemini")


def context_window() -> int:
    return settings.gemini_context_window


def available_models() -> tuple[str, ...]:
    current = get_model()
    values = list(settings.gemini_models)
    if current not in values:
        values.insert(0, current)
    return tuple(values)
