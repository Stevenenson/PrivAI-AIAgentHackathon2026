"""Packaged desktop backend entrypoint."""
from __future__ import annotations

import os

import uvicorn

from backend.main import app


def main() -> None:
    uvicorn.run(
        app,
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", "8080")),
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
