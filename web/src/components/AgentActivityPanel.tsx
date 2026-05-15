"use client";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FolderTree,
  Play,
  RotateCw,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { board } from "@/lib/board";
import type { AgentToolEvent, PreviewInfo } from "@/lib/types";

export function AgentActivityPanel({
  events,
  changedFiles,
  hitLimit,
  onContinue,
  onApproveCommand,
  onRejectCommand,
  askBeforeCommands = true,
  autoApproveReadOnly = false,
  embedded = false,
}: {
  events: AgentToolEvent[];
  changedFiles: string[];
  hitLimit: boolean;
  onContinue: (message?: string) => void;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  askBeforeCommands?: boolean;
  onSetAskBeforeCommands?: (enabled: boolean) => void;
  autoApproveReadOnly?: boolean;
  onSetAutoApproveReadOnly?: (enabled: boolean) => void;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const previewCwd = useMemo(() => inferPreviewCwd(changedFiles), [changedFiles]);

  if (!events.length && !changedFiles.length && !hitLimit) return null;

  async function startPreview() {
    if (!previewCwd) return;
    setPreviewBusy(true);
    setPreviewErr(null);
    try {
      setPreview(await board.startPreview(previewCwd));
    } catch (e) {
      setPreviewErr((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }

  const failed = events.some((event) => event.status === "failed" || event.status === "rejected");
  const body = (
      <section className="rounded-[12px] border border-line bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-surface-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="min-w-0 flex flex-1 items-center gap-2 text-left"
          >
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <SquareTerminal className="h-4 w-4 shrink-0 text-accent" />
            <span className="font-medium">Work progress</span>
            <span className="truncate text-xs text-muted">
              {events.length ? `${events.length} actions` : "waiting"}
              {changedFiles.length ? ` · ${changedFiles.length} files` : ""}
            </span>
          </button>
          <span className="shrink-0 rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] text-muted">
            {askBeforeCommands ? "approval on" : "auto-run all"}
            {autoApproveReadOnly ? " · read-only auto" : ""}
          </span>
        </div>

        {open ? (
          <div className="border-t border-line p-3 grid gap-3">
            <ProgressTimeline events={events} changedFiles={changedFiles} />

            {events.length ? (
              <div className="grid gap-2">
                {events.map((event) => (
                  <CommandRow
                    key={`${event.id}-${event.status}`}
                    event={event}
                    onApproveCommand={onApproveCommand}
                    onRejectCommand={onRejectCommand}
                  />
                ))}
              </div>
            ) : null}

            {changedFiles.length ? (
              <div className="rounded-lg border border-line bg-bg/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <FileCode2 className="h-4 w-4 text-accent" />
                  Work files
                </div>
                <FileTreeView files={changedFiles} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {previewCwd ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={previewBusy}
                  onClick={startPreview}
                >
                  <Play className="h-3.5 w-3.5" />
                  Run preview
                </Button>
              ) : null}
              {preview?.url ? (
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-3 text-sm font-medium text-white hover:bg-accent-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open {preview.url.replace("http://", "")}
                </a>
              ) : null}
              {hitLimit ? (
                <Button type="button" onClick={() => onContinue()}>
                  <RotateCw className="h-3.5 w-3.5" />
                  Continue
                </Button>
              ) : null}
              {failed ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => onContinue("fix the failed command, then verify the result again")}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Ask Privai to fix
                </Button>
              ) : null}
            </div>
            {previewErr ? (
              <div className="text-xs text-bad">{previewErr}</div>
            ) : null}
          </div>
        ) : null}
      </section>
  );
  if (embedded) return body;
  return (
    <div className="px-4 md:px-6 pt-3">
      <div className="mx-auto max-w-3xl">{body}</div>
    </div>
  );
}

function CommandRow({
  event,
  onApproveCommand,
  onRejectCommand,
}: {
  event: AgentToolEvent;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
}) {
  const failed = event.status === "failed";
  const rejected = event.status === "rejected";
  const pending = event.status === "pending_approval";
  const running = event.status === "running";
  const isTerminal = event.name === "run_terminal_command";
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2.5">
      <div className="flex items-start gap-2">
        {running ? (
          <span className="mt-1 h-2 w-2 rounded-full bg-warn animate-pulse" />
        ) : failed || rejected ? (
          <XCircle className="mt-0.5 h-4 w-4 text-bad shrink-0" />
        ) : pending ? (
          <span className="mt-1 h-2 w-2 rounded-full bg-accent animate-pulse" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-good shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>step {event.step}/{event.maxSteps}</span>
            {pending ? <span className="text-accent">waiting for approval</span> : null}
            {rejected ? <span className="text-bad">rejected</span> : null}
            {event.risk ? (
              <span
                className={
                  event.risk === "read"
                    ? "text-good"
                    : event.risk === "danger"
                      ? "text-bad"
                      : "text-warn"
                }
              >
                {event.risk === "read" ? "read-only" : event.risk}
              </span>
            ) : null}
            {isTerminal ? (
              <span>folder <code>{event.cwd || "."}</code></span>
            ) : (
              <span>tool <code>{event.name}</code></span>
            )}
            {isTerminal && event.exitCode !== undefined ? <span>exit {event.exitCode ?? "-"}</span> : null}
            {event.durationS ? <span>{event.durationS}s</span> : null}
          </div>
          {pending && event.explanation ? (
            <div className="mt-2 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-xs text-muted">
              {event.explanation}
            </div>
          ) : null}
          <pre className="mt-1 overflow-x-auto rounded bg-surface-2 px-2 py-1.5 text-xs text-ink">
            {event.command}
          </pre>
          {pending && event.approvalId ? (
            <div className="mt-2 grid gap-2">
              <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => onApproveCommand?.(event.approvalId!)}
              >
                Approve command
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => onRejectCommand?.(event.approvalId!)}
              >
                Reject
              </Button>
              </div>
            </div>
          ) : null}
          {event.stderr ? (
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-bad/20 bg-bad/5 px-2 py-1.5 text-xs text-bad">
              {event.stderr}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProgressTimeline({
  events,
  changedFiles,
}: {
  events: AgentToolEvent[];
  changedFiles: string[];
}) {
  const items = [
    {
      label: "Understand the task",
      done: events.length > 0,
      active: events.some((event) => event.status === "running" || event.status === "pending_approval"),
    },
    {
      label: "Create or update files",
      done: changedFiles.length > 0,
      active: events.some((event) => /cat|sed|node|python|npm create|mkdir|touch/i.test(event.command)),
    },
    {
      label: "Check the result",
      done: events.some((event) => /npm run (build|lint|test)|pytest|pnpm|yarn|smoke|check/i.test(event.command) && event.status === "completed"),
      active: events.some((event) => /build|lint|test|check/i.test(event.command) && event.status === "running"),
    },
  ];

  return (
    <div className="grid gap-2 rounded-lg border border-line bg-bg/40 p-3">
      <div className="text-sm font-medium">Task timeline</div>
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                item.done
                  ? "bg-good"
                  : item.active
                    ? "bg-warn animate-pulse"
                    : "bg-surface-3"
              }`}
            />
            <span className={item.done ? "text-ink" : "text-muted"}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileTreeView({ files }: { files: string[] }) {
  const grouped = files.slice(0, 100).reduce<Record<string, string[]>>(
    (acc, file) => {
      const parts = file.split("/");
      const root = parts.length > 1 ? parts[0] : ".";
      const rest = parts.length > 1 ? parts.slice(1).join("/") : file;
      acc[root] = [...(acc[root] ?? []), rest];
      return acc;
    },
    {},
  );
  return (
    <div className="grid gap-2 max-h-40 overflow-y-auto">
      {Object.entries(grouped).map(([folder, children]) => (
        <div key={folder}>
          <div className="flex items-center gap-1.5 text-xs text-ink">
            <FolderTree className="h-3.5 w-3.5 text-accent" />
            <code>{folder}</code>
          </div>
          <div className="ml-5 grid gap-0.5">
            {children.map((child) => (
              <code key={`${folder}/${child}`} className="text-xs text-muted truncate">
                {child}
              </code>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function inferPreviewCwd(files: string[]) {
  const packageFile = files.find((file) => file.endsWith("package.json"));
  if (packageFile) {
    const parts = packageFile.split("/");
    parts.pop();
    return parts.join("/") || ".";
  }
  const sourceFile = files.find((file) => /(^|\/)src\//.test(file));
  if (sourceFile) {
    const beforeSrc = sourceFile.split("/src/")[0];
    return beforeSrc || ".";
  }
  const first = files[0]?.split("/")[0];
  return first || "";
}
