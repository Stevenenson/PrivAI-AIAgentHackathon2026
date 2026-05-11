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
    llm_provider: str = os.getenv("LLM_PROVIDER", "openai").strip().lower()

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
    openai_vision_model: str = os.getenv(
        "OPENAI_VISION_MODEL",
        os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
    )
    openai_reasoning_effort: str = os.getenv("OPENAI_REASONING_EFFORT", "low")
    openai_context_window: int = int(os.getenv("OPENAI_CONTEXT_WINDOW", "400000"))
    openai_models: tuple[str, ...] = _env_tuple(
        "OPENAI_MODELS",
        "gpt-5.4-mini,gpt-5.4-nano,gpt-5.5,gpt-5-mini,gpt-5-nano",
    )

    ollama_url: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    ollama_vision_model: str = os.getenv("OLLAMA_VISION_MODEL", "llava:7b")

    searxng_url: str = os.getenv("SEARXNG_URL", "http://127.0.0.1:8888")

    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8080"))

    db_path: str = os.getenv("DB_PATH", "data/chat.db")
    cache_dir: str = os.getenv("CACHE_DIR", "data/cache")

    workspace_root: str = os.getenv(
        "WORKSPACE_ROOT",
        str(Path(__file__).resolve().parent.parent),
    )
    terminal_enabled: bool = _env_bool("TERMINAL_ENABLED", True)
    terminal_shell: str = os.getenv("TERMINAL_SHELL", "/bin/zsh")
    terminal_timeout_s: int = int(os.getenv("TERMINAL_TIMEOUT_S", "60"))
    terminal_max_output_chars: int = int(
        os.getenv("TERMINAL_MAX_OUTPUT_CHARS", "20000")
    )
    terminal_allow_dangerous: bool = _env_bool("TERMINAL_ALLOW_DANGEROUS", False)
    agent_max_tool_steps: int = int(os.getenv("AGENT_MAX_TOOL_STEPS", "20"))

    search_top_k: int = int(os.getenv("SEARCH_TOP_K", "50"))
    agent_search_top_k: int = int(os.getenv("AGENT_SEARCH_TOP_K", "50"))
    search_timeout_s: float = float(os.getenv("SEARCH_TIMEOUT_S", "15"))
    llm_timeout_s: float = float(os.getenv("LLM_TIMEOUT_S", "180"))
    llm_num_ctx: int = int(os.getenv("LLM_NUM_CTX", "8192"))
    llm_num_predict: int = int(os.getenv("LLM_NUM_PREDICT", "2048"))
    llm_think: bool = _env_bool("LLM_THINK", False)
    llm_keep_alive: str = os.getenv("LLM_KEEP_ALIVE", "30m")

    admin_token: str = os.getenv("ADMIN_TOKEN", "dev-token-change-me")

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
