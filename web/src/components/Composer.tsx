"use client";
import {
  Eraser,
  FileText,
  Globe2,
  Image as ImageIcon,
  Paperclip,
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
}

const SLASH_COMMANDS: Array<{
  cmd: SlashCommand;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    cmd: "clear",
    label: "/clear",
    hint: "Wipe this conversation's messages",
    icon: <Eraser className="h-3.5 w-3.5" />,
  },
  {
    cmd: "compact",
    label: "/compact",
    hint: "Summarize history into a single recap",
    icon: <ScissorsLineDashed className="h-3.5 w-3.5" />,
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
}: Props) {
  const [value, setValue] = useState("");
  const [forceSearch, setForceSearch] = useState(false);
  const [mode, setMode] = useState<ChatMode>("chat");
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
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  const submit = useCallback(async () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || busy || disabled) return;

    if (text.startsWith("/")) {
      const head = text.split(/\s+/)[0]?.toLowerCase();
      const slash = SLASH_COMMANDS.find((c) => c.label === head);
      if (slash && onSlash) {
        setBusy(true);
        try {
          await onSlash(slash.cmd);
          setValue("");
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

  return (
    <div className="bg-bg sticky bottom-0 px-3 md:px-6 py-3 md:py-4">
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
            "flex items-end gap-1.5 bg-surface border rounded-[14px] px-3 py-2 transition shadow-[0_2px_10px_color-mix(in_srgb,var(--ink)_4%,transparent)]",
            drag
              ? "border-accent ring-2 ring-accent/30"
              : "border-line focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15",
          )}
        >
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
          <ToggleButton
            active={mode === "agent"}
            onClick={() => setMode((v) => (v === "agent" ? "chat" : "agent"))}
            label="agent"
            title={
              mode === "agent"
                ? "Agent ON — model can create files and run workspace terminal commands. Click to turn off"
                : "Click to enable agent mode (inspect code, edit files, run tests, build apps)"
            }
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
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
            placeholder={
              placeholder ?? (mode === "agent"
                ? "Ask the agent to inspect code, edit files, run tests, or build an app…"
                : mode === "convert"
                  ? "Type: to heic, to pdf, or make a PDF about…"
                  : "Ask anything… type / for commands")
            }
            className="flex-1 bg-transparent border-none outline-none resize-none py-1.5 text-[15px] leading-6 text-ink placeholder:text-muted disabled:opacity-50 max-h-60"
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
}: {
  usage?: { used: number; max: number } | null;
  mode: ChatMode;
  workspaceRoot?: string;
  agentMaxToolSteps?: number;
}) {
  return (
    <div className="mt-2 flex items-center justify-between text-[11px] text-muted gap-3">
      <div className={mode === "agent" ? "min-w-0 flex-1" : "min-w-0 hidden sm:block"}>
        {mode === "agent" ? (
          <span
            className="text-accent block truncate"
            title={workspaceRoot || "Workspace unknown"}
          >
            agent · workspace {formatWorkspace(workspaceRoot)} · max {agentMaxToolSteps ?? 20} terminal steps
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
