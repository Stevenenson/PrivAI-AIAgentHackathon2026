#!/usr/bin/env bash
# One-shot setup for MacBook prototype. Re-runnable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --upgrade pip
.venv/bin/pip install fastapi 'uvicorn[standard]' httpx pydantic-settings

if [ ! -d "searxng" ]; then
  git clone --depth 1 https://github.com/searxng/searxng.git
fi
.venv/bin/pip install -r searxng/requirements.txt

if [ ! -f "searxng/searx/settings_local.yml" ]; then
  echo "warning: searxng/searx/settings_local.yml missing; run_searxng.sh will fail" >&2
fi

mkdir -p data/cache data/logs

if [ ! -f ".env" ]; then
  cp .env.example .env
  chmod 600 .env
  echo "created .env from .env.example; set OPENAI_API_KEY before running"
fi

echo "install ok. next: bash scripts/run_all.sh"
