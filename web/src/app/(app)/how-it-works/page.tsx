"use client";
import {
  Activity,
  ArrowDown,
  Cpu,
  Database,
  Eye,
  Globe2,
  HardDrive,
  KeyRound,
  Lock,
  Network,
  RefreshCw,
  ScissorsLineDashed,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { board, getBoardUrl } from "@/lib/board";

export default function HowItWorksPage() {
  const [model, setModel] = useState<string>("gpt-5.4-mini");
  const [provider, setProvider] = useState<string>("openai");
  const [numCtx, setNumCtx] = useState<number>(400000);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    board
      .health()
      .then((h) => {
        setModel(h.model);
        setProvider(h.provider);
        setNumCtx(h.numCtx);
        setVersion(h.version);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg sticky top-0 z-10">
        <div className="font-serif text-lg tracking-tight">How it works</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-8">
        <div className="mx-auto max-w-3xl grid gap-10">
          <Hero />

          <Section
            id="privacy"
            icon={<ShieldCheck className="h-4 w-4 text-accent" />}
            title="Why this is private"
          >
            <p>
              Privai is split in two layers. <b>Identity</b> uses Firebase
              (sign-in, ID tokens). <b>Conversation history</b> lives in SQLite
              on your device — the laptop today, your RISC-V single-board
              computer once you flash one.
            </p>
            <p>
              Your browser sends each message <em>directly</em> to the device,
              with a Firebase-signed token attached. The device verifies the
              token against Google&apos;s public keys and checks that you are the
              paired owner. If the provider is OpenAI, the backend then sends
              the prompt to OpenAI for generation; if the provider is Ollama,
              generation stays local.
            </p>

            <PrivacyTable />

            <Callout tone="good" icon={<Lock className="h-4 w-4" />}>
              Firebase still never carries chat content. The single Firestore
              document we keep per device only stores health metadata
              (online/offline, provider, model name). Current provider:{" "}
              <code className="bg-surface-2 px-1 rounded">{provider}</code>.
            </Callout>
          </Section>

          <Section
            id="flow"
            icon={<Network className="h-4 w-4 text-accent" />}
            title="What happens when you press Send"
          >
            <Flow />
          </Section>

          <Section
            id="context"
            icon={<HardDrive className="h-4 w-4 text-accent" />}
            title="Context — how the model remembers"
          >
            <p>
              An LLM has a fixed-size <b>context window</b>: the number of
              tokens it can keep in working memory at one time, including the
              system prompt, prior turns, retrieved web snippets, and the new
              user message. Exceed it and the model either errors or silently
              forgets the oldest turns.
            </p>
            <p>
              For this device the window is <b>{numCtx.toLocaleString()} tokens</b>{" "}
              (reported by the active provider configuration in{" "}
              <code className="bg-surface-2 px-1 rounded">backend/config.py</code>).
              A token is roughly four characters of English text — so{" "}
              {numCtx.toLocaleString()} tokens is about{" "}
              {(numCtx * 4).toLocaleString()} characters, or ~{Math.round(numCtx / 750)} pages
              of dense prose. The meter at the bottom of the composer estimates
              how full the window is.
            </p>
            <p>
              Two ways to free space without losing the conversation:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Type{" "}
                <code className="bg-surface-2 px-1 rounded">/compact</code> —
                the model summarises the chat into a single recap message. Old
                turns are deleted, the recap stays as context.
              </li>
              <li>
                Type{" "}
                <code className="bg-surface-2 px-1 rounded">/clear</code> —
                wipe every message but keep the session.
              </li>
            </ul>
          </Section>

          <Section
            id="model"
            icon={<Sparkles className="h-4 w-4 text-accent" />}
            title="The model provider"
          >
            <p>
              Currently configured:{" "}
              <code className="bg-surface-2 px-1 rounded font-mono">
                {model}
              </code>{" "}
              through{" "}
              <code className="bg-surface-2 px-1 rounded font-mono">
                {provider}
              </code>{" "}
              · backend version{" "}
              <code className="bg-surface-2 px-1 rounded">
                {version || "—"}
              </code>
              .
            </p>
            <p>
              The backend now speaks the OpenAI Responses API by default, with
              the old Ollama path still available behind{" "}
              <code className="bg-surface-2 px-1 rounded">LLM_PROVIDER=ollama</code>.
              Chat rows, attachments, titles, sources, and redaction metadata
              still stay in <code className="bg-surface-2 px-1 rounded">data/chat.db</code>.
            </p>

            <div className="grid sm:grid-cols-3 gap-3 not-prose">
              <Bullet
                icon={<HardDrive className="h-4 w-4" />}
                title="Local storage"
                body="Conversation history remains in SQLite on the device. Firebase only sees health metadata."
              />
              <Bullet
                icon={<Cpu className="h-4 w-4" />}
                title="Remote model"
                body="OpenAI handles generation, so the laptop or board no longer needs to keep a local model in RAM."
              />
              <Bullet
                icon={<Activity className="h-4 w-4" />}
                title="Reversible"
                body="Set LLM_PROVIDER=ollama and OLLAMA_MODEL later to return to a local model setup."
              />
            </div>

            <h3 className="font-medium mt-4">Swapping the model</h3>
            <ol className="list-decimal pl-5 space-y-2 marker:text-muted">
              <li>
                Change the OpenAI model in the repo-root environment file:
                <Code>OPENAI_MODEL=gpt-5.4-mini</Code>
              </li>
              <li>
                Restart the backend:
                <Code>bash scripts/run_all.sh</Code>
              </li>
              <li>
                For the local model path later, switch provider and set an
                Ollama tag:
                <Code>{`LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.2:1b bash scripts/run_all.sh`}</Code>
              </li>
            </ol>
            <Callout tone="warn" icon={<Eye className="h-4 w-4" />}>
              With the OpenAI provider, prompt content leaves the device for
              generation. Stored chat history remains local unless you export or
              sync the database yourself.
            </Callout>
          </Section>

          <Section
            id="search"
            icon={<Globe2 className="h-4 w-4 text-accent" />}
            title="Web search — how the device touches the internet"
          >
            <p>
              When you tap the <b>web</b> button, the device runs a search
              query through a local SearXNG instance. SearXNG fans the query
              out to public engines (Google, Bing, DuckDuckGo, etc.) and
              returns a clean JSON list. The orchestrator passes the top
              snippets to the model as context for that one turn.
            </p>
            <p>
              The query travels to upstream search engines — that&apos;s the
              one place data leaves the device. The privacy guard scrubs
              obvious PII (CNP, RO mobile numbers, emails, API keys, password
              lines) before that even happens.
            </p>
          </Section>

          <Section
            id="convert"
            icon={<RefreshCw className="h-4 w-4 text-accent" />}
            title="Convert — why local file conversion matters"
          >
            <p>
              The <b>convert</b> mode turns attached files into another format
              directly on your device. Use it for everyday work like PNG to
              HEIC, JPG to PDF, or PowerPoint to PDF without uploading the file
              to a public converter site. You can also describe a document you
              want, optionally attach photos, and ask Privai to make a PDF for
              you locally.
            </p>
            <p>
              This matters because conversion is often done on sensitive files:
              IDs, contracts, invoices, school documents, company slides,
              medical forms, or private photos. Public converter websites may
              store uploads, inspect metadata, keep temporary copies, or route
              files through infrastructure you do not control. Privai keeps the
              original and the converted output in the device&apos;s local
              attachment storage.
            </p>
            <Callout tone="good" icon={<Lock className="h-4 w-4" />}>
              Basic file conversion does not need the LLM and does not need
              cloud storage. PDF document creation uses the configured LLM
              provider to write the text, then the backend renders the PDF
              on-device.
              For format conversion, the backend calls local tools such as{" "}
              <code className="bg-surface-2 px-1 rounded">sips</code> or{" "}
              <code className="bg-surface-2 px-1 rounded">LibreOffice</code>,
              then returns the converted or generated file as a private downloadable
              attachment.
            </Callout>
          </Section>

          <Section
            id="auth"
            icon={<KeyRound className="h-4 w-4 text-accent" />}
            title="How auth works without a password ever leaving"
          >
            <p>
              You sign in with Firebase. Firebase mints a short-lived ID token
              (a signed JWT). The web app attaches that token to every request
              the device receives. The device verifies the JWT signature
              against Google&apos;s public x509 certificates — no service
              account, no shared secret, no call back to Firebase to validate
              it. If the JWT&apos;s subject matches the paired owner UID, the
              request is honoured.
            </p>
            <p>
              First-time pairing: the backend prints a 6-digit code in the
              terminal. You enter it once on the Settings page. From that
              moment, only your account can talk to this device.
            </p>
          </Section>

          <Section
            id="storage"
            icon={<Database className="h-4 w-4 text-accent" />}
            title="Where things are stored"
          >
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>Conversations</b> →{" "}
                <code className="bg-surface-2 px-1 rounded">
                  data/chat.db
                </code>{" "}
                (SQLite on the device).
              </li>
              <li>
                <b>Identity</b> → Firebase Auth + the single doc{" "}
                <code className="bg-surface-2 px-1 rounded">
                  users/&#123;uid&#125;/device/status
                </code>{" "}
                in Firestore.
              </li>
              <li>
                <b>Models</b> → current provider is{" "}
                <code className="bg-surface-2 px-1 rounded">{provider}</code>.
                Ollama models are managed under{" "}
                <code className="bg-surface-2 px-1 rounded">~/.ollama</code>{" "}
                when the local provider is enabled.
              </li>
              <li>
                <b>Search cache</b> → in-memory inside SearXNG, not persisted.
              </li>
            </ul>
            <p>
              Storage cost on the board itself: chat content is text, ~2.5 kB
              per round-trip. Even at a thousand turns a day, the database
              grows under 1 GB per year — negligible against the 128 GB
              microSD or 256 GB NVMe.
            </p>
          </Section>

          <Section
            id="endpoints"
            icon={<Server className="h-4 w-4 text-accent" />}
            title="API surface"
          >
            <p>
              The web app exclusively uses the device&apos;s HTTP API at{" "}
              <code className="bg-surface-2 px-1 rounded">{getBoardUrl()}</code>.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>
                <code>GET /health</code> · <code>GET /pair/status</code> ·{" "}
                <code>POST /pair</code>
              </li>
              <li>
                <code>GET /sessions</code> · <code>POST /sessions</code> ·{" "}
                <code>PATCH /sessions/&#123;id&#125;</code> ·{" "}
                <code>DELETE /sessions/&#123;id&#125;</code>
              </li>
              <li>
                <code>GET /sessions/&#123;id&#125;/messages</code> ·{" "}
                <code>GET /sessions/&#123;id&#125;/stats</code>
              </li>
              <li>
                <code>POST /sessions/&#123;id&#125;/clear</code> ·{" "}
                <code>POST /sessions/&#123;id&#125;/compact</code>
              </li>
              <li>
                <code>POST /chat</code> · <code>POST /chat/stream</code> (SSE)
              </li>
              <li>
                <code>GET /admin/llm/status</code> ·{" "}
                <code>POST /admin/llm/start</code> ·{" "}
                <code>POST /admin/llm/stop</code>
              </li>
            </ul>
            <p className="text-xs text-muted">
              Every owner-only endpoint requires a valid Firebase ID token in
              the <code>Authorization</code> header. The device returns 401 if
              the JWT is malformed, 403 if it&apos;s for a different account,
              409 if the device hasn&apos;t been paired yet.
            </p>
          </Section>

          <Section
            id="commands"
            icon={<ScissorsLineDashed className="h-4 w-4 text-accent" />}
            title="Slash commands"
          >
            <table className="w-full text-sm border border-line rounded-[10px] overflow-hidden">
              <tbody>
                <tr className="border-b border-line">
                  <td className="px-3 py-2 font-mono">/clear</td>
                  <td className="px-3 py-2 text-muted">
                    Wipe every message in this conversation. Title and session
                    survive.
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono">/compact</td>
                  <td className="px-3 py-2 text-muted">
                    Summarise the conversation into a single recap message,
                    delete the rest. Useful when the context meter goes amber.
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>
        </div>
      </div>
    </>
  );
}

function Hero() {
  return (
    <header className="grid gap-3">
      <h1 className="font-serif text-4xl tracking-tight">How Privai works</h1>
      <p className="text-muted text-[15px]">
        A short tour of the architecture, the privacy posture, the model, and
        the controls you have. Nothing here is marketing — read it as a spec.
      </p>
    </header>
  );
}

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="grid gap-3">
      <h2 className="font-serif text-2xl tracking-tight flex items-center gap-2">
        {icon}
        {title}
      </h2>
      <div className="text-[15px] leading-7 text-ink-2 grid gap-3 prose">
        {children}
      </div>
    </section>
  );
}

function Bullet({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-surface border border-line rounded-[12px] p-4">
      <div className="flex items-center gap-2 text-accent text-sm font-medium mb-1">
        {icon}
        {title}
      </div>
      <div className="text-sm text-ink-2 leading-relaxed">{body}</div>
    </div>
  );
}

function Callout({
  tone,
  icon,
  children,
}: {
  tone: "good" | "warn" | "bad";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "good"
      ? "tone-good"
      : tone === "warn"
        ? "tone-warn"
        : "tone-bad";
  return (
    <div className={`${cls} border rounded-[10px] px-4 py-3 text-sm flex gap-2 items-start`}>
      <span className="mt-0.5">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-surface-2 border border-line rounded-[10px] px-3 py-2 text-[13px] overflow-x-auto my-2">
      <code className="font-mono">{children}</code>
    </pre>
  );
}

function PrivacyTable() {
  const rows: Array<{ what: string; where: string; sees: string; tone: "good" | "warn" }> = [
    { what: "Login credentials", where: "Firebase Auth", sees: "Auth metadata only", tone: "warn" },
    { what: "Session IDs, models in use, RAM", where: "Firestore (heartbeat doc)", sees: "Yes — but no chat content", tone: "warn" },
    { what: "Chat messages, sources, redactions", where: "Device SQLite", sees: "Only the device", tone: "good" },
    { what: "Uploaded and converted files", where: "Device attachment storage", sees: "Only the device", tone: "good" },
    { what: "Search queries (when web on)", where: "Device → upstream engines", sees: "Engines see the query", tone: "warn" },
    { what: "Model inferences", where: "OpenAI or device Ollama", sees: "Provider sees prompt when OpenAI is active", tone: "warn" },
  ];
  return (
    <div className="not-prose overflow-hidden border border-line rounded-[12px]">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="text-left px-3 py-2 font-medium">What</th>
            <th className="text-left px-3 py-2 font-medium">Where</th>
            <th className="text-left px-3 py-2 font-medium">Who sees it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.what} className="border-t border-line">
              <td className="px-3 py-2">{r.what}</td>
              <td className="px-3 py-2 text-muted">{r.where}</td>
              <td
                className={
                  r.tone === "good"
                    ? "px-3 py-2 text-good"
                    : "px-3 py-2 text-warn"
                }
              >
                {r.sees}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flow() {
  const steps = [
    {
      icon: <Eye className="h-4 w-4" />,
      title: "1. You type a message in the browser",
      body: "The web app is a static Next.js bundle. It renders nothing on a server you don't own.",
    },
    {
      icon: <KeyRound className="h-4 w-4" />,
      title: "2. Browser asks Firebase for a fresh ID token",
      body: "Firebase Auth signs a short-lived JWT (≤1h) with your UID. Token is attached to the next HTTP call.",
    },
    {
      icon: <Network className="h-4 w-4" />,
      title: "3. Browser sends the message directly to your device",
      body: "POST to the boardUrl saved in your browser. The device is the only consumer — no relay through Firebase or any cloud.",
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      title: "4. Device verifies the JWT and the paired owner",
      body: "Backend cross-checks the signature against Google's public x509 certs and matches the JWT subject to the paired UID. Mismatch → 403.",
    },
    {
      icon: <Globe2 className="h-4 w-4" />,
      title: "5. (Optional) Web search via local SearXNG",
      body: "If the web button is on, the device queries SearXNG → public engines → returns trimmed snippets. Privacy guard strips PII before this.",
    },
    {
      icon: <RefreshCw className="h-4 w-4" />,
      title: "6. (Optional) Convert or create PDFs locally",
      body: "If convert is on, files go through local tools, and PDF requests can be written by the configured LLM then rendered on-device. No public converter server is involved.",
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      title: "7. The configured LLM generates the answer",
      body: "OpenAI is the default provider now; Ollama can still be enabled for local generation. Tokens stream back over Server-Sent Events.",
    },
    {
      icon: <Database className="h-4 w-4" />,
      title: "8. SQLite stores user + assistant turn",
      body: "Chats persist in data/chat.db on the device. Use /clear or /compact when the context fills up.",
    },
  ];
  return (
    <div className="not-prose grid gap-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="h-7 w-7 rounded-md bg-accent-soft text-accent grid place-items-center mt-0.5">
            {s.icon}
          </span>
          <div className="flex-1 bg-surface border border-line rounded-[12px] p-3">
            <div className="font-medium text-sm">{s.title}</div>
            <div className="text-sm text-muted mt-0.5">{s.body}</div>
          </div>
        </div>
      ))}
      <div className="flex justify-center text-muted">
        <ArrowDown className="h-4 w-4" />
      </div>
      <div className="text-center text-xs text-muted">
        Total round-trip: token-streamed answer with sources, no third party in the loop.
      </div>
    </div>
  );
}
