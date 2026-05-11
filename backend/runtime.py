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
    return settings.llm_provider


def default_model(provider: str | None = None) -> str:
    active_provider = provider or settings.llm_provider
    if active_provider == "ollama":
        return settings.ollama_model
    return settings.openai_model


def get_model() -> str:
    saved = database.get_kv("llm_model")
    if saved:
        return saved
    if settings.llm_provider == "ollama":
        return database.get_kv("ollama_model") or settings.ollama_model
    return settings.openai_model


def set_model(model: str) -> None:
    database.set_kv("llm_model", model.strip())


def get_vision_model() -> str:
    if settings.llm_provider == "ollama":
        return settings.ollama_vision_model
    return settings.openai_vision_model or get_model()


def context_window() -> int:
    if settings.llm_provider == "openai":
        return settings.openai_context_window
    return settings.llm_num_ctx


def available_models() -> tuple[str, ...]:
    if settings.llm_provider == "openai":
        current = get_model()
        values = list(settings.openai_models)
        if current not in values:
            values.insert(0, current)
        return tuple(values)
    return ()
