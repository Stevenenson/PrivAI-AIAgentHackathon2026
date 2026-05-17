"use client";
import {
  Bug,
  CheckCircle2,
  Code2,
  Eraser,
  FileCode2,
  FileText,
  GitCommit,
  Globe2,
  Hammer,
  Image as ImageIcon,
  Lightbulb,
  Paperclip,
  PlayCircle,
  RefreshCw,
  ScissorsLineDashed,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { AttachmentMeta, ChatMode } from "@/lib/types";

export type SlashCommand = "clear" | "compact";

interface Props {
  onSend: (
    message: string,
    opts: {
      forceSearch: boolean;
      mode: ChatMode;
      attachmentIds: string[];
      attachments: AttachmentMeta[];
    },
  ) => Promise<void> | void;
  onSlash?: (cmd: SlashCommand) => Promise<void> | void;
  disabled?: boolean;
  generating?: boolean;
  onStop?: () => void;
  placeholder?: string;
  usage?: { used: number; max: number } | null;
  sessionId?: string;
  workspaceRoot?: string;
  agentMaxToolSteps?: number;
  askBeforeCommands?: boolean;
  defaultMode?: ChatMode;
  defaultForceSearch?: boolean;
  compact?: boolean;
  agentOnly?: boolean;
}

const SLASH_COMMANDS: Array<{
  cmd: string;
  action?: SlashCommand;
  label: string;
  hint: string;
  icon: React.ReactNode;
  prompt?: (detail: string) => string;
  mode?: ChatMode;
  forceSearch?: boolean;
}> = [
  {
    cmd: "clear",
    action: "clear",
    label: "/clear",
    hint: "Wipe this conversation's messages",
    icon: <Eraser className="h-3.5 w-3.5" />,
  },
  {
    cmd: "compact",
    action: "compact",
    label: "/compact",
    hint: "Summarize history into a single recap",
    icon: <ScissorsLineDashed className="h-3.5 w-3.5" />,
  },
  {
    cmd: "fix",
    label: "/fix",
    hint: "Find the bug, edit files, and run checks",
    icon: <Bug className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Fix the issue in this workspace${detail ? `: ${detail}` : "."} Start by inspecting the project, identify the likely files, make the smallest correct edits, run the relevant checks, and summarize the changes.`,
  },
  {
    cmd: "test",
    label: "/test",
    hint: "Create or run project tests",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Work on tests for this workspace${detail ? `: ${detail}` : "."} Detect the test framework, add or update focused tests, run them, and fix failures caused by the change.`,
  },
  {
    cmd: "explain",
    label: "/explain",
    hint: "Explain the project or selected file",
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    mode: "chat",
    prompt: (detail) =>
      `Explain this codebase clearly${detail ? `, focusing on: ${detail}` : "."} Describe the architecture, main files, data flow, and the next practical improvement.`,
  },
  {
    cmd: "refactor",
    label: "/refactor",
    hint: "Improve structure without changing behavior",
    icon: <Hammer className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Refactor this workspace${detail ? `: ${detail}` : "."} Preserve behavior, keep the edit scoped, run checks, and explain the before/after improvement.`,
  },
  {
    cmd: "docs",
    label: "/docs",
    hint: "Add useful README or code docs",
    icon: <FileText className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Improve documentation for this project${detail ? `: ${detail}` : "."} Inspect the app, update README or nearby docs, and keep the writing practical for a real user.`,
  },
  {
    cmd: "new-app",
    label: "/new-app",
    hint: "Scaffold a polished app in this workspace",
    icon: <Code2 className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Create a polished web app in this workspace${detail ? `: ${detail}` : "."} Choose a practical stack already available on the machine when possible, create the files, install only what is needed, run a build or lint check, and tell me how to open it.`,
  },
  {
    cmd: "review",
    label: "/review",
    hint: "Review code like a senior engineer",
    icon: <FileCode2 className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Review this workspace for bugs, risky code, missing checks, and UX issues${detail ? `, focusing on: ${detail}` : "."} Inspect relevant files and report findings first with file references. Do not edit unless I ask.`,
  },
  {
    cmd: "commit",
    label: "/commit",
    hint: "Prepare git status and commit message",
    icon: <GitCommit className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Inspect git status and summarize the current changes${detail ? `: ${detail}` : "."} Suggest a concise commit message. Do not commit unless I explicitly approve.`,
  },
  {
    cmd: "preview",
    label: "/preview",
    hint: "Run or repair the local preview",
    icon: <PlayCircle className="h-3.5 w-3.5" />,
    mode: "agent",
    prompt: (detail) =>
      `Get this app preview running${detail ? `: ${detail}` : "."} Detect the start command, install missing dependencies if necessary, run checks, and explain the local URL or blocker.`,
  },
];

export function Composer({
  onSend,
  onSlash,
  disabled,
  generating,
  onStop,
  placeholder,
  usage,
  sessionId,
  workspaceRoot,
  agentMaxToolSteps,
  askBeforeCommands,
  defaultMode = "chat",
  defaultForceSearch = false,
  compact = false,
  agentOnly = false,
}: Props) {
  const [value, setValue] = useState("");
  const [forceSearch, setForceSearch] = useState(
    agentOnly ? false : defaultForceSearch,
  );
  const [mode, setMode] = useState<ChatMode>(agentOnly ? "agent" : defaultMode);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = (value ? Math.min(el.scrollHeight, 240) : 36) + "px";
  }, [value]);

  const submit = useCallback(async () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || busy || disabled) return;

    if (text.startsWith("/")) {
      const head = text.split(/\s+/)[0]?.toLowerCase();
      const slash = SLASH_COMMANDS.find((c) => c.label === head);
      if (slash?.action && onSlash) {
        setBusy(true);
        try {
          await onSlash(slash.action);
          setValue("");
        } finally {
          setBusy(false);
        }
        return;
      }
      if (slash?.prompt) {
        const detail = text.slice(head.length).trim();
        setValue("");
        setBusy(true);
        try {
          await onSend(slash.prompt(detail), {
            forceSearch: slash.forceSearch ?? forceSearch,
            mode: slash.mode ?? mode,
            attachmentIds: attachments.map((a) => a.id),
            attachments,
          });
          setAttachments([]);
        } finally {
          setBusy(false);
        }
        return;
      }
    }

    const sentAttachments = attachments;
    const attachmentIds = sentAttachments.map((a) => a.id);
    setValue("");
    setAttachments([]);
    setBusy(true);
    try {
      await onSend(text, {
        forceSearch,
        mode,
        attachmentIds,
        attachments: sentAttachments,
      });
      // intentionally keep forceSearch + mode sticky
    } finally {
      setBusy(false);
    }
  }, [value, busy, disabled, onSend, onSlash, forceSearch, mode, attachments]);

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    setErr(null);
    const list = Array.from(files);
    setUploading((n) => n + list.length);
    try {
      const uploaded = await Promise.all(
        list.map((f) => board.uploadAttachment(f, sessionId)),
      );
      setAttachments((cur) => [...cur, ...uploaded]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading((n) => Math.max(0, n - list.length));
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length) void uploadFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeAttachment(aid: string) {
    setAttachments((cur) => cur.filter((a) => a.id !== aid));
    try {
      await board.deleteAttachment(aid);
    } catch {
      /* ignore — orphan cleanup is best-effort */
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(true);
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
  }

  const showSlashHints = value.startsWith("/") && !busy;
  const filteredHints = showSlashHints
    ? SLASH_COMMANDS.filter((c) =>
        c.label.startsWith(value.split(/\s+/)[0]?.toLowerCase() ?? "/"),
      )
    : [];

  const resolvedPlaceholder =
    placeholder ??
    (mode === "agent"
      ? "Ask Privai to automate a process, prepare files, build an app, or check a project..."
      : mode === "convert"
        ? "Type: to heic, to pdf, or make a PDF about..."
        : "Ask anything... type / for commands");

  return (
    <div
      className={cn(
        "bg-bg",
        compact
          ? "px-3 py-3"
          : "sticky bottom-0 px-3 md:px-6 py-3 md:py-4",
      )}
    >
      <div className="mx-auto max-w-3xl">
        {filteredHints.length ? (
          <div className="mb-2 bg-surface border border-line rounded-[12px] overflow-hidden">
            {filteredHints.map((c) => (
              <button
                key={c.cmd}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2 text-left"
                onClick={() => {
                  setValue(c.label);
                  taRef.current?.focus();
                }}
              >
                {c.icon}
                <span className="font-mono text-[13px]">{c.label}</span>
                <span className="text-muted text-xs ml-1">{c.hint}</span>
              </button>
            ))}
          </div>
        ) : null}

        {(attachments.length > 0 || uploading > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-surface border border-line text-ink-2"
                title={`${a.mime} · ${formatSize(a.size)}${a.hasText ? " · text embedded" : ""}`}
              >
                {a.mime.startsWith("image/") ? (
                  <ImageIcon className="h-3 w-3" />
                ) : a.hasText ? (
                  <FileText className="h-3 w-3" />
                ) : (
                  <Paperclip className="h-3 w-3" />
                )}
                <span className="max-w-[180px] truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="text-muted hover:text-bad"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {uploading > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-surface border border-line text-muted">
                <Spinner /> uploading {uploading}…
              </span>
            ) : null}
          </div>
        )}

        {err ? (
          <div className="mb-2 text-bad text-xs tone-bad border rounded-[8px] px-2.5 py-1.5">
            {err}
          </div>
        ) : null}

        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            "flex gap-1.5 bg-surface border rounded-[14px] px-3 py-2 transition shadow-[0_2px_10px_color-mix(in_srgb,var(--ink)_4%,transparent)]",
            compact ? "flex-wrap items-end" : "items-end",
            drag
              ? "border-accent ring-2 ring-accent/30"
              : "border-line focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15",
          )}
        >
          {agentOnly ? null : (
            <ToggleButton
              active={forceSearch}
              onClick={() => setForceSearch((v) => !v)}
              label="web"
              title={
                forceSearch
                  ? "Web search ON — click to turn off"
                  : "Click to keep web search on for following messages"
              }
              icon={<Globe2 className="h-3.5 w-3.5" />}
            />
          )}
          <ToggleButton
            active={mode === "agent"}
            onClick={() => {
              if (agentOnly) return;
              setMode((v) => (v === "agent" ? "chat" : "agent"));
            }}
            label="agent"
            title={
              agentOnly
                ? "Agent always on in this space"
                : mode === "agent"
                  ? "Agent ON — Privai can create files and run workspace commands. Click to turn off"
                  : "Click to let Privai automate work, create files, build apps, and check results"
            }
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
          {agentOnly ? null : (
            <ToggleButton
              active={mode === "convert"}
              onClick={() =>
                setMode((v) => (v === "convert" ? "chat" : "convert"))
              }
              label="convert"
              title={
                mode === "convert"
                  ? "Convert ON — convert files or make a private PDF"
                  : "Click to convert files or generate a local PDF"
              }
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            />
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-9 w-9 grid place-items-center rounded-[10px] text-muted hover:text-ink hover:bg-surface-2 transition"
            title="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={onPick}
          />

          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled || busy}
            rows={1}
            placeholder={resolvedPlaceholder}
            className={cn(
              "min-w-0 bg-transparent border-none outline-none resize-none py-1.5 text-[15px] leading-6 text-ink placeholder:text-muted disabled:opacity-50 max-h-60",
              compact ? "order-first w-full flex-none" : "flex-1",
            )}
          />

          <button
            type="button"
            onClick={generating ? onStop : submit}
            disabled={
              generating
                ? false
                : busy || disabled || (!value.trim() && attachments.length === 0)
            }
            className={cn(
              "h-9 w-9 grid place-items-center rounded-[10px] transition",
              generating
                ? "bg-bad/10 text-bad border border-bad/20 hover:bg-bad/15"
                : "bg-accent text-white hover:bg-accent-2",
              "disabled:bg-surface-2 disabled:text-muted",
            )}
            aria-label={generating ? "Stop generation" : "Send"}
            title={generating ? "Stop generation" : "Send"}
          >
            {generating ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        <Footer
          usage={usage}
          mode={mode}
          workspaceRoot={workspaceRoot}
          agentMaxToolSteps={agentMaxToolSteps}
          askBeforeCommands={askBeforeCommands}
        />
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  title,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "h-9 px-3 text-xs rounded-[10px] inline-flex items-center gap-1.5 transition select-none",
        active ? "bg-accent text-white" : "text-muted hover:bg-surface-2",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Footer({
  usage,
  mode,
  workspaceRoot,
  agentMaxToolSteps,
  askBeforeCommands,
}: {
  usage?: { used: number; max: number } | null;
  mode: ChatMode;
  workspaceRoot?: string;
  agentMaxToolSteps?: number;
  askBeforeCommands?: boolean;
}) {
  return (
    <div className="mt-2 flex items-center justify-between text-[11px] text-muted gap-3">
      <div className={mode === "agent" ? "min-w-0 flex-1" : "min-w-0 hidden sm:block"}>
        {mode === "agent" ? (
          <span
            className="text-accent block truncate"
            title={workspaceRoot || "Workspace unknown"}
          >
            agent · works in {formatWorkspace(workspaceRoot)} · max {agentMaxToolSteps ?? 20} actions · approval {askBeforeCommands === false ? "off" : "on"}
          </span>
        ) : mode === "convert" ? (
          <span className="text-accent">convert mode · local conversion and private PDF creation</span>
        ) : (
          <>
            <kbd className="px-1 py-0.5 rounded bg-surface-2 border border-line text-[10px]">
              Enter
            </kbd>{" "}
            send ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-2 border border-line text-[10px]">
              Shift+Enter
            </kbd>{" "}
            newline ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-2 border border-line text-[10px]">
              /
            </kbd>{" "}
            commands
          </>
        )}
      </div>
      {usage ? <ContextMeter used={usage.used} max={usage.max} /> : <span />}
    </div>
  );
}

function formatWorkspace(path?: string) {
  if (!path) return "unknown";
  const homePrefix = "/Users/";
  if (path.startsWith(homePrefix)) {
    const parts = path.split("/");
    if (parts.length >= 4) {
      return `~/${parts.slice(3).join("/") || ""}`;
    }
  }
  return path;
}

function ContextMeter({ used, max }: { used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const tone =
    pct >= 90 ? "var(--bad)" : pct >= 70 ? "var(--warn)" : "var(--accent)";
  return (
    <span
      className="inline-flex items-center gap-2"
      title={`${used.toLocaleString()} / ${max.toLocaleString()} tokens (estimate)`}
    >
      <span className="font-mono">
        {fmtTok(used)} / {fmtTok(max)}
      </span>
      <span className="relative h-1.5 w-24 rounded-full bg-surface-2 overflow-hidden">
        <span
          className="absolute inset-y-0 left-0 transition-all"
          style={{ width: `${pct}%`, background: tone }}
        />
      </span>
    </span>
  );
}

function fmtTok(n: number) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        opacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
