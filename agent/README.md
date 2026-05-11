# Board agent

Long-running Node service that lives on the same machine as the FastAPI
backend. It is the bridge between Firestore (where the web app puts commands)
and the local FastAPI orchestrator (which runs Ollama + SearXNG).

```
[Web app] -> Firestore.commands -> [agent] -> FastAPI :8080 -> {Ollama, SearXNG}
                                       \--> Firestore.{messages, board}
```

## Run

```sh
cp .env.example .env       # set OWNER_UID, point at service-account.json
npm install
npm run dev                # tsx watch
```

## Env

| Var | Purpose |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Firebase service-account JSON. |
| `OWNER_UID` | The Firebase user this agent serves. |
| `BACKEND_URL` | FastAPI base URL (default `http://127.0.0.1:8080`). |
| `ADMIN_TOKEN` | Bearer for `/admin/llm/*`; must equal backend's `ADMIN_TOKEN`. |
| `HEARTBEAT_MS` | How often to write `users/{uid}/board/status`. |
| `AGENT_VERSION` | Free-form label shown on the device page. |

## What it does

- Subscribes to `users/{uid}/commands` filtered to `status == 'pending'`.
- For each command: claims it transactionally (status → in-progress), runs it
  against the FastAPI backend, writes the result back, marks it `done` or
  `error`.
- Heartbeats `users/{uid}/board/status` every `HEARTBEAT_MS` with the live
  health of Ollama, SearXNG, and which model is currently loaded into RAM.

Works the same on the laptop prototype and on the RISC-V board (Node 20+ runs
fine on Debian/Ubuntu RISC-V images).
