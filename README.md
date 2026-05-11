# Local AI Assistant — Licenta Prototype

Local AI assistant: an OpenAI-backed LLM by default, talking to a local
metasearch engine (SearXNG), exposed through a FastAPI backend and a mobile-friendly
web chat. Chat history still stays in local SQLite; prompts are sent to OpenAI
when `LLM_PROVIDER=openai`.

This MacBook prototype is a stepping stone toward the same software running on a
RISC-V single-board computer (Milk-V Jupiter / StarFive VisionFive 2). The code
avoids macOS-specific dependencies so the port is mostly a hardware swap.

## Architecture

Storage posture: chat history lives on the device in SQLite. Firebase is used
**only for identity** (sign in, ID tokens) and heartbeat metadata. With the
default `openai` provider, prompt content is sent from the backend to OpenAI for
generation; with `ollama`, generation stays local. The web app talks to the
device's FastAPI directly with a `Bearer <id-token>` header.

```
┌──────────────────────────────┐         Firebase
│  Web app (Next.js 16)        │  ───→   Auth: sign in (email / Google / GitHub)
│   Firebase Auth · chat UI    │         Firestore: ONLY users/{uid}/device/status
│   Device control · pairing   │                    (heartbeat metadata, no chat)
└────────────┬─────────────────┘
             │ HTTPS  (Authorization: Bearer <Firebase ID token>)
             ▼
┌──────────────────────────────┐
│ FastAPI :8080                │
│  /pair        owner pairing  │
│  /sessions    list / CRUD    │
│  /chat        non-streaming  │
│  /chat/stream SSE token-stream
│  /admin/llm/* start/stop     │
└──┬───────────────────────────┘
   ├─→ OpenAI Responses API (default LLM provider)
   ├─→ Ollama :11434       (optional local LLM provider)
   ├─→ SearXNG :8888       (local search)
   ├─→ Privacy guard       (regex redaction)
   └─→ SQLite              (chats live HERE, only here)

[Agent (Node)]  ──Admin SDK──→  Firestore: heartbeat to users/{uid}/device/status
                                (online · boardUrl · model · ramMb · lastSeen)
```

What goes through Firebase:
- Auth credentials (email, hashed password, OAuth provider tokens).
- One small heartbeat doc per device (no chat content).

What stays on the device:
- Every conversation (titles + messages + sources + redactions).
- Search results, scrape caches.
- Privacy-guard logs.

The orchestrator decides per-message whether web search is needed (URL or
keyword heuristic, plus an explicit "web" toggle in the UI). Search results are
formatted as a numbered context block and passed to the LLM, which is asked to
ground its answer and cite `[n]`.

## Prerequisites

- macOS (Apple Silicon ok), Python 3.11+, git
- An OpenAI API key in the repo-root `.env`
- Optional: [Ollama](https://ollama.com/download) if `LLM_PROVIDER=ollama`

## Install

```sh
bash scripts/install.sh
```

This creates `.venv/`, installs the FastAPI deps, clones SearXNG into
`searxng/`, and installs its requirements.

Set the OpenAI key and model in `.env`:

```sh
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.4-mini
OPENAI_VISION_MODEL=gpt-5.4-mini
```

## Run everything

```sh
bash scripts/run_all.sh
```

This starts SearXNG on `127.0.0.1:8888` and FastAPI on `0.0.0.0:8080`.
If `LLM_PROVIDER=ollama`, it also starts the Ollama daemon first. Open `http://127.0.0.1:8080/` from your laptop, or
`http://<laptop-LAN-ip>:8080/` from your phone (same Wi-Fi).

`Ctrl-C` stops the API; SearXNG is killed via the script's trap.

### Run pieces individually

| What | Command |
| --- | --- |
| Ollama only, optional | `bash scripts/run_ollama.sh` |
| SearXNG only | `bash scripts/run_searxng.sh` |
| API only | `bash scripts/run_api.sh` |

## Configuration

All knobs are env vars (`backend/config.py`):

| Var | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | `openai` or `ollama` |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_MODEL` | `gpt-5.4-mini` | default OpenAI text model |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` | model used for image attachments |
| `OPENAI_REASONING_EFFORT` | `low` | OpenAI reasoning effort for reasoning models |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `qwen2.5:3b` | model tag when `LLM_PROVIDER=ollama` |
| `SEARXNG_URL` | `http://127.0.0.1:8888` | SearXNG base URL |
| `API_HOST` | `0.0.0.0` | bind addr (so phone can reach it) |
| `API_PORT` | `8080` | bind port |
| `SEARCH_TOP_K` | `50` | search results passed to LLM |
| `OPENAI_CONTEXT_WINDOW` | `400000` | context meter when OpenAI is active |
| `LLM_NUM_CTX` | `8192` | Ollama context window |
| `WORKSPACE_ROOT` | repo root | directory where agent terminal commands run |
| `TERMINAL_ENABLED` | `true` | expose terminal tool in agent mode |
| `TERMINAL_TIMEOUT_S` | `60` | default terminal command timeout |
| `TERMINAL_MAX_OUTPUT_CHARS` | `20000` | captured stdout/stderr cap per stream |
| `TERMINAL_ALLOW_DANGEROUS` | `false` | bypass the small destructive-command denylist |
| `AGENT_MAX_TOOL_STEPS` | `20` | maximum terminal tool loop steps per agent reply |

## API

All endpoints except `/health`, `/pair`, `/pair/status` require
`Authorization: Bearer <firebase-id-token>`. Owner-only endpoints additionally
require the caller's uid to match the paired owner.

| Method | Path | Auth | What |
| --- | --- | --- | --- |
| GET | `/health` | — | `{llm, provider, searxng, model, paired, version}` |
| GET | `/pair/status` | — | `{paired, owner}` |
| POST | `/pair` | id-token | `{code}` → claims pairing for caller's uid |
| GET | `/sessions` | owner | list sessions |
| POST | `/sessions` | owner | create session |
| GET | `/sessions/{id}` | owner | one session |
| PATCH | `/sessions/{id}` | owner | rename |
| DELETE | `/sessions/{id}` | owner | delete (cascading messages) |
| GET | `/sessions/{id}/messages` | owner | list messages |
| POST | `/chat` | owner | non-streaming chat turn |
| POST | `/chat/stream` | owner | SSE: meta → delta… → done |
| POST | `/search` | owner | raw SearXNG passthrough (debug) |
| GET | `/admin/llm/status` | owner | provider/model status |
| POST | `/admin/llm/start` | owner | warm-up/no-op depending on provider |
| POST | `/admin/llm/stop` | owner | unload/no-op depending on provider |

## Privacy guard

`backend/privacy_guard.py` runs a conservative regex pass over user input
before it can leave the device (e.g. before SearXNG sees it). It redacts:

- Romanian CNP, RO mobile numbers, emails, credit-card-like digit runs
- API keys / tokens / bearer tokens
- `password: …` style lines

Redactions are surfaced in the UI as a yellow tag — that demo is part of the
licenta value pitch ("we *show* the user when something gets stripped").

## Agent terminal tools

Agent mode can run non-interactive shell commands inside `WORKSPACE_ROOT`.
This is the Claude Code/Codex-style path: press **agent**, ask for a change or
an app, and the model can inspect the workspace, create/edit real files, run
package-manager commands, and verify the result. It captures stdout/stderr,
enforces a timeout, returns structured command results to the model, and blocks
obvious destructive commands unless `TERMINAL_ALLOW_DANGEROUS=true`.

For the desktop app, use **File → Open Workspace...** to choose where the agent
is allowed to work. Select a project folder for existing code, or select
`~/Desktop` if you want it to create new app folders on your Desktop.

Examples to try in agent mode:

```text
Use the terminal to inspect this repo and tell me how to run the backend tests.
Run the frontend lint check and summarize any failures.
Search the backend for chat streaming code and explain the flow.
Create a new Vite React app called todo-agent-demo in this workspace and run its build.
```

## Desktop app

The Electron shell lives in `web/electron`. It starts two local services when
the app opens:

- FastAPI backend on `127.0.0.1:8080` by default, or the next free port
- Standalone Next UI on `127.0.0.1:3100` by default, or the next free port

Run the desktop app from source:

```sh
cd web
npm run desktop:dev
```

Build an unpacked macOS app for testing:

```sh
cd web
npm run build:backend
npm run desktop:pack
open dist/mac-arm64/Privai.app
```

Build a distributable installer:

```sh
cd web
npm run dist
```

Installed desktop builds read their local API key from:

```sh
~/Library/Application Support/Privai/.env
```

The first app launch creates that file with placeholders. Add `OPENAI_API_KEY`
there, then restart the app. Use **File → Open Workspace...** to choose the
folder where agent terminal commands should run.

## Porting to RISC-V (later)

The prototype is intentionally portable:

- Replace `qwen2.5:3b` with `qwen2.5:0.5b`, `llama3.2:1b`, or a `llama.cpp`
  GGUF setup (Ollama on RISC-V isn't reliable yet — `llama.cpp` is).
- If swapping to `llama.cpp` server, only `backend/llm_client.py` needs to
  change (or run `llama-server` with its OpenAI-compatible API and adjust
  `ollama_url`).
- SearXNG runs the same way on Linux (Debian/Ubuntu image for RISC-V).
- Cap `SEARCH_TOP_K` and `LLM_NUM_CTX` lower for 4 GB RAM boards.
- `scripts/run_*.sh` are bash and should work on the target distro.

## Layout

```
backend/      FastAPI app + orchestrator + privacy guard + sqlite + /admin/llm
frontend/     static chat UI fallback (HTML/CSS/JS, no build step)
web/          Next.js 16 + Tailwind + Firebase — the polished app
agent/        Node service: Firestore listener -> FastAPI driver
searxng/      upstream clone (gitignored), with our settings_local.yml
scripts/      install + run_* shell scripts
firestore.*   rules + indexes (deploy via firebase CLI)
firebase.json  + .firebaserc — points at project privatellm-6ad93
data/         chat.db + caches + logs (gitignored)
docs/         arhitectura, firebase_setup, rezultate (work in progress)
```

## The full stack — three things to run

```sh
# 1) device stack — prints PAIRING CODE on first boot
bash scripts/run_all.sh                 # OpenAI provider + SearXNG + FastAPI

# 2) board agent — writes heartbeat to Firestore
cd agent && cp .env.example .env        # set GOOGLE_APPLICATION_CREDENTIALS
npm install && npm run dev

# 3) web app
cd web && cp .env.local.example .env.local
npm install && npm run dev              # http://localhost:3000

# Pair: open /settings, enter the 6-digit code from terminal 1.
# (one-time) deploy Firestore rules:
firebase deploy --only firestore:rules
```

Full setup including the Firebase console clicks and the OAuth dance is in
[`docs/firebase_setup.md`](docs/firebase_setup.md).
