#!/usr/bin/env bash
# Build a single-file backend executable for the Electron installer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

if ! .venv/bin/python -m PyInstaller --version >/dev/null 2>&1; then
  .venv/bin/pip install pyinstaller
fi

rm -rf "$ROOT/dist-backend" "$ROOT/build/pyinstaller-backend"
mkdir -p "$ROOT/dist-backend"

.venv/bin/python -m PyInstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name privai-backend \
  --distpath "$ROOT/dist-backend" \
  --workpath "$ROOT/build/pyinstaller-backend" \
  --paths "$ROOT" \
  --collect-all uvicorn \
  --collect-all fastapi \
  --collect-all pydantic \
  --add-data "$ROOT/backend/prompts:backend/prompts" \
  "$ROOT/backend/desktop_server.py"

echo "backend binary ready in dist-backend/"
