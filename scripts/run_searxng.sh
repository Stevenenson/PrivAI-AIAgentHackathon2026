#!/usr/bin/env bash
# Run SearXNG against our settings_local.yml.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/searxng"

export SEARXNG_SETTINGS_PATH="$ROOT/searxng/searx/settings_local.yml"
export PYTHONPATH="$ROOT/searxng:${PYTHONPATH:-}"

exec "$ROOT/.venv/bin/python" -m searx.webapp
