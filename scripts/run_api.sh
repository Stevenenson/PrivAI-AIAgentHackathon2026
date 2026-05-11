#!/usr/bin/env bash
# Run the FastAPI backend (also serves the static frontend at /).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

HOST="${API_HOST:-0.0.0.0}"
PORT="${API_PORT:-8080}"

exec "$ROOT/.venv/bin/python" -m uvicorn backend.main:app \
  --host "$HOST" --port "$PORT" --reload
