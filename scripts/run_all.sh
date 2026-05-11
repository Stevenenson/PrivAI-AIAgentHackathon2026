#!/usr/bin/env bash
# Bring up Ollama + SearXNG + API in one shell. Ctrl-C tears them all down.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"

if [ "${LLM_PROVIDER:-openai}" = "ollama" ]; then
  bash "$ROOT/scripts/run_ollama.sh"
else
  echo "using OpenAI provider; skipping Ollama daemon"
fi

echo "starting searxng (logs: $LOG_DIR/searxng.log)"
bash "$ROOT/scripts/run_searxng.sh" >"$LOG_DIR/searxng.log" 2>&1 &
SEARXNG_PID=$!

cleanup() {
  echo "stopping..."
  kill "$SEARXNG_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  sleep 0.5
  curl -sf "http://127.0.0.1:8888/" >/dev/null && break
done

echo "starting api on http://127.0.0.1:${API_PORT:-8080}"
bash "$ROOT/scripts/run_api.sh"
