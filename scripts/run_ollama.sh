#!/usr/bin/env bash
# Start Ollama daemon (idempotent) and ensure the configured model is pulled.
set -euo pipefail

MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama not installed. https://ollama.com/download" >&2
  exit 1
fi

if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "starting ollama daemon..."
  ollama serve >/tmp/ollama.log 2>&1 &
  for _ in $(seq 1 20); do
    sleep 0.5
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break
  done
fi

if ! ollama list | awk '{print $1}' | grep -qx "$MODEL"; then
  echo "pulling $MODEL..."
  ollama pull "$MODEL"
fi

echo "ollama ready, model=$MODEL"
