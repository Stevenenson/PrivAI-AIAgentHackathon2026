"""Central config — env-overridable so MacBook prototype and RISC-V port share code."""
import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> None:
    """Load a simple repo-root .env without adding a runtime dependency."""
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_tuple(name: str, default: str) -> tuple[str, ...]:
    raw = os.getenv(name, default)
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    # Privai uses the Gemini API for chat, business, learning, and coding.
    llm_provider: str = "gemini"

    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_base_url: str = os.getenv(
        "GEMINI_BASE_URL",
        "https://generativelanguage.googleapis.com/v1beta",
    )
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
    gemini_vision_model: str = os.getenv(
        "GEMINI_VISION_MODEL",
        os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview"),
    )
    gemini_thinking_level: str = os.getenv("GEMINI_THINKING_LEVEL", "high")
    gemini_context_window: int = int(os.getenv("GEMINI_CONTEXT_WINDOW", "1000000"))
    gemini_max_retries: int = int(os.getenv("GEMINI_MAX_RETRIES", "4"))
    gemini_retry_base_s: float = float(os.getenv("GEMINI_RETRY_BASE_S", "0.75"))
    gemini_models: tuple[str, ...] = _env_tuple(
        "GEMINI_MODELS",
        "gemini-3.1-pro-preview,gemini-3-flash-preview,gemini-3.1-flash-lite",
    )

    searxng_url: str = os.getenv("SEARXNG_URL", "http://127.0.0.1:8888")

    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8080"))

    db_path: str = os.getenv("DB_PATH", "data/chat.db")
    cache_dir: str = os.getenv("CACHE_DIR", "data/cache")

    workspace_root: str = os.getenv("WORKSPACE_ROOT", "")
    terminal_enabled: bool = _env_bool("TERMINAL_ENABLED", True)
    terminal_shell: str = os.getenv("TERMINAL_SHELL", "/bin/zsh")
    terminal_timeout_s: int = int(os.getenv("TERMINAL_TIMEOUT_S", "60"))
    terminal_max_output_chars: int = int(
        os.getenv("TERMINAL_MAX_OUTPUT_CHARS", "20000")
    )
    terminal_allow_dangerous: bool = _env_bool("TERMINAL_ALLOW_DANGEROUS", False)
    agent_max_tool_steps: int = int(os.getenv("AGENT_MAX_TOOL_STEPS", "300"))
    agent_max_verification_nudges: int = int(
        os.getenv("AGENT_MAX_VERIFICATION_NUDGES", "20")
    )
    agent_command_approval_required: bool = _env_bool(
        "AGENT_COMMAND_APPROVAL_REQUIRED",
        True,
    )

    search_top_k: int = int(os.getenv("SEARCH_TOP_K", "50"))
    agent_search_top_k: int = int(os.getenv("AGENT_SEARCH_TOP_K", "50"))
    search_timeout_s: float = float(os.getenv("SEARCH_TIMEOUT_S", "15"))
    search_fallback_enabled: bool = _env_bool("SEARCH_FALLBACK_ENABLED", True)
    search_fallback_url: str = os.getenv(
        "SEARCH_FALLBACK_URL",
        "https://html.duckduckgo.com/html/",
    )
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    google_redirect_uri: str = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://127.0.0.1:8080/google/oauth/callback",
    )
    llm_timeout_s: float = float(os.getenv("LLM_TIMEOUT_S", "600"))
    llm_num_ctx: int = int(os.getenv("LLM_NUM_CTX", "8192"))
    llm_num_predict: int = int(os.getenv("LLM_NUM_PREDICT", "8192"))
    agent_step_max_output_tokens: int = int(
        os.getenv("AGENT_STEP_MAX_OUTPUT_TOKENS", "8192")
    )
    llm_think: bool = _env_bool("LLM_THINK", False)
    llm_keep_alive: str = os.getenv("LLM_KEEP_ALIVE", "30m")

    admin_token: str = os.getenv("ADMIN_TOKEN", "dev-token-change-me")
    owner_takeover_enabled: bool = _env_bool("OWNER_TAKEOVER_ENABLED", True)

    firebase_project_id: str = os.getenv(
        "FIREBASE_PROJECT_ID", "privatellm-6ad93"
    )
    pairing_code: str = os.getenv("PAIRING_CODE", "")
    cors_origins: tuple[str, ...] = tuple(
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,"
            "http://localhost:3100,http://127.0.0.1:3100,"
            "http://localhost:8080",
        ).split(",")
        if o.strip()
    )


settings = Settings()
