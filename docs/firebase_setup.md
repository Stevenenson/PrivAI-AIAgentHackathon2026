# Firebase setup & device pairing

The web app uses Firebase **only** for identity. Chat content never touches
Firestore. The web app talks to the device's FastAPI backend directly,
authenticating with a Firebase ID token. The agent on the device writes one
document — heartbeat metadata — so the web app can show "online / offline".

```
Firebase
├── Auth                 ← used: login, ID tokens
├── Firestore
│   ├── users/{uid}                     ← user profile
│   └── users/{uid}/device/status       ← heartbeat (boardUrl, online, model)
│
│  (no sessions, no messages, no commands)
│
Device-local FastAPI
├── /pair, /sessions, /chat, /chat/stream  ← all owner-only via ID token
└── SQLite                              ← chats live ONLY here
```

## 1. Firebase console — manual steps

### 1.1 Create the Firestore database

Project `privatellm-6ad93` → **Build → Firestore Database** → *Create database* →
*Production mode* → location `eur3` (or `nam5`, whichever is closest).

### 1.2 Enable auth providers

**Build → Authentication → Sign-in method**, enable:

- **Email/Password** — required
- **Google** — required for the "Continue with Google" button
- **GitHub** — optional. Needs an OAuth app:
  1. <https://github.com/settings/developers> → *New OAuth App*
  2. Authorization callback URL =
     `https://privatellm-6ad93.firebaseapp.com/__/auth/handler`
  3. Paste Client ID + Client Secret into Firebase, save

### 1.3 Generate the agent's service account key

**Project settings → Service accounts → Generate new private key.** Save as
`agent/service-account.json` — gitignored.

> The backend (FastAPI) does **not** need this file. Backend ID-token
> verification uses Google's public JWKs only. Service-account creds are only
> needed for the agent's writes to `users/{uid}/device/status`.

### 1.4 Authorized domains

**Authentication → Settings → Authorized domains** — add `localhost`.

## 2. Deploy rules

```sh
firebase login            # one-time
firebase use default      # picks up .firebaserc
firebase deploy --only firestore:rules
# (no indexes needed — schema is shallow)
```

## 3. Run everything locally

You need **three** processes running.

```sh
# 1) device-local stack (Ollama + SearXNG + FastAPI)
bash scripts/run_all.sh

# 2) board agent (writes heartbeats only)
cd agent
cp .env.example .env       # set GOOGLE_APPLICATION_CREDENTIALS to your JSON
npm install
npm run dev

# 3) web app
cd web
cp .env.local.example .env.local
npm install
npm run dev                # http://localhost:3000
```

## 4. Pairing flow

1. Start the backend. Watch the console — it prints a 6-digit pairing code:
   ```
   ┌──────────────────────────────────────────────┐
   │  PAIRING CODE: 482919                        │
   │  Enter this in the web app /settings page.   │
   └──────────────────────────────────────────────┘
   ```
   (If `PAIRING_CODE` is set in env, that exact value is used. Otherwise a
   fresh random code is generated each boot until the device is paired.)
2. Open <http://localhost:3000>, sign in with any provider.
3. Click **Settings**.
4. Enter the 6-digit code, click *Pair device*.
5. The device is now bound to your Firebase UID. Subsequent calls only
   succeed for tokens issued to that UID. The agent picks up your UID from
   `/pair/status` and starts heartbeating.

To pair to a *different* account: delete `data/chat.db` (or call
`database.reset_owner()` from a Python REPL), restart the backend, repeat.

## 5. Privacy posture

This is the licenta defence:

| What | Where | Sees content? |
| --- | --- | --- |
| User credentials, displayName | Firebase Auth | yes (only auth metadata) |
| Heartbeat (online, model, RAM) | Firestore | yes (no chat) |
| **Chat messages, sources, redactions** | Device SQLite | **no one but the device** |
| Search queries (sent to SearXNG) | Device SearXNG → upstream engines | upstream sees the query |
| LLM inferences | Device Ollama | nobody (local model) |

The only way for chat content to leave the device is the SearXNG fetch when
web search is enabled. That goes to public search engines, **not Firebase**.
The privacy guard scrubs CNP / phone / email / API keys before that even
happens.

## 6. Deploy the web app

Static export to Firebase Hosting:

```sh
# in web/next.config.ts add  output: 'export'
cd web && npm run build
cd .. && firebase deploy --only hosting
```

Note: when deployed the web app calls the device URL set in
*Settings → Device URL*. For laptop dev that's `http://127.0.0.1:8080`. For a
real board on your home Wi-Fi you'd use a Tailscale magic-DNS hostname or a
Cloudflare Tunnel HTTPS URL — the web app's behaviour doesn't change.
