"use client";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  Eye,
  FileCode2,
  FilePlus2,
  FileSearch,
  FolderTree,
  ListChecks,
  MonitorPlay,
  Pencil,
  PlayCircle,
  RotateCw,
  Search,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { MessageBubble } from "@/components/Message";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { Button } from "@/components/ui/Button";
import { type AgentStatusUpdate } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { AgentPlan, AgentToolEvent, Artifact, ChatMessage } from "@/lib/types";

export function ChatStream({
  messages,
  pending,
  onOpenArtifact,
  emptyTitle,
  emptyBody,
  compact = false,
  agentEvents,
  changedFiles,
  agentHitLimit,
  onContinueAgent,
  onApproveCommand,
  onRejectCommand,
  onAnswerQuestion,
  onOpenFile,
  showAgentActivityInline = false,
  agentStatus,
}: {
  messages: ChatMessage[];
  pending?: ChatMessage | null;
  onOpenArtifact?: (a: Artifact) => void;
  emptyTitle?: string;
  emptyBody?: React.ReactNode;
  compact?: boolean;
  agentEvents?: AgentToolEvent[];
  changedFiles?: string[];
  agentHitLimit?: boolean;
  onContinueAgent?: (message?: string) => void;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  onOpenFile?: (path: string) => void;
  showAgentActivityInline?: boolean;
  agentStatus?: AgentStatusUpdate | null;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const visibleMessages = useMemo(() => uniqueMessages(messages), [messages]);
  const agentScrollKey = useMemo(
    () =>
      (agentEvents ?? [])
        .map(
          (event) =>
            `${event.id}:${event.status}:${event.exitCode ?? ""}:${event.stdout?.length ?? 0}:${event.stderr?.length ?? 0}:${event.changedFiles?.length ?? 0}`,
        )
        .join("|"),
    [agentEvents],
  );
  const inlineActivity =
    showAgentActivityInline &&
    Boolean(
      (agentEvents && agentEvents.length) ||
        (changedFiles && changedFiles.length) ||
        agentHitLimit,
    );
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const activityBeforeMessageId =
    inlineActivity && !pending && lastMessage?.role === "assistant"
      ? lastMessage.id
      : null;
  const activityNode = inlineActivity ? (
    <AgentActivityInChat
      events={agentEvents ?? []}
      changedFiles={changedFiles ?? []}
      hitLimit={Boolean(agentHitLimit)}
      onContinue={onContinueAgent}
      onApproveCommand={onApproveCommand}
      onRejectCommand={onRejectCommand}
      onAnswerQuestion={onAnswerQuestion}
      onOpenFile={onOpenFile}
    />
  ) : null;

  function scrollToEnd(behavior: ScrollBehavior) {
    endRef.current?.scrollIntoView({ behavior, block: "end" });
  }

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 120;
  }

  useEffect(() => {
    if (stickToBottomRef.current) scrollToEnd("smooth");
  }, [visibleMessages.length, pending?.id, agentScrollKey, changedFiles?.length, agentHitLimit]);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToEnd("auto");
  }, [pending?.content, agentScrollKey, changedFiles?.length, agentHitLimit]);

  if (visibleMessages.length === 0 && !pending && !inlineActivity) {
    return <Empty title={emptyTitle} body={emptyBody} compact={compact} />;
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className={compact ? "min-h-0 flex-1 overflow-y-auto px-3 py-4" : "min-h-0 flex-1 overflow-y-auto px-4 md:px-6 py-6"}
    >
      <div className={compact ? "mx-auto max-w-full flex flex-col gap-4" : "mx-auto max-w-3xl flex flex-col gap-5"}>
        {visibleMessages.map((m) => (
          <Fragment key={m.id}>
            {activityBeforeMessageId === m.id ? activityNode : null}
            <MessageBubble
            msg={m}
            onOpenArtifact={onOpenArtifact}
            onOpenFile={onOpenFile}
          />
          </Fragment>
        ))}
        {inlineActivity && !activityBeforeMessageId ? activityNode : null}
        {pending && pending.content ? (
          <MessageBubble
            msg={pending}
            streaming
            onOpenArtifact={onOpenArtifact}
            onOpenFile={onOpenFile}
          />
        ) : pending ? (
          <ThinkingIndicator status={agentStatus ?? null} />
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function AgentActivityInChat({
  events,
  changedFiles,
  hitLimit,
  onContinue,
  onApproveCommand,
  onRejectCommand,
  onAnswerQuestion,
  onOpenFile,
}: {
  events: AgentToolEvent[];
  changedFiles: string[];
  hitLimit: boolean;
  onContinue?: (message?: string) => void;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const [traceOpen, setTraceOpen] = useState(false);
  const failed = events.some(
    (event) => event.status === "failed" || event.status === "rejected",
  );
  const allChangedFiles = uniqueStrings([
    ...changedFiles,
    ...events.flatMap((event) => event.changedFiles ?? []),
  ]);
  const plan = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const p = events[i]?.plan;
      if (p && Array.isArray(p.steps) && p.steps.length) return p;
    }
    return null;
  }, [events]);
  const renderableEvents = events.filter((event) => event.name !== "update_plan");
  const activeEvents = renderableEvents.filter(
    (event) =>
      event.status === "running" ||
      event.status === "pending_approval" ||
      event.status === "pending_question",
  );
  const resolvedEvents = renderableEvents.filter(
    (event) => !activeEvents.includes(event),
  );
  const totalSeconds = renderableEvents.reduce(
    (acc, e) => acc + (e.durationS || 0),
    0,
  );

  return (
    <div className="msg-enter w-full flex justify-start">
      <article className="flex w-full gap-3 px-1">
        <div className="shrink-0 pt-0.5">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent-tint text-accent">
            <SquareTerminal className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <header className="flex items-center gap-2 text-[11px] text-muted">
            <span className="font-semibold uppercase tracking-wide text-ink-2">
              Privai agent
            </span>
            {activeEvents.length ? (
              <span className="text-accent">working…</span>
            ) : null}
          </header>

          <div className="mt-1 grid gap-2">
            {plan ? <InlinePlanCard plan={plan} /> : null}

            {activeEvents.map((event) => (
              <InlineCommandCard
                key={event.id}
                event={event}
                onApproveCommand={onApproveCommand}
                onRejectCommand={onRejectCommand}
                onAnswerQuestion={onAnswerQuestion}
                onOpenFile={onOpenFile}
              />
            ))}

            {resolvedEvents.length ? (
              <TraceCard
                events={resolvedEvents}
                changedFiles={allChangedFiles}
                totalSeconds={totalSeconds}
                hasFailure={failed}
                open={traceOpen || failed}
                onToggle={() => setTraceOpen((v) => !v)}
                onOpenFile={onOpenFile}
              />
            ) : null}

            {hitLimit || failed ? (
              <div className="flex flex-wrap items-center gap-2">
                {hitLimit ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onContinue?.()}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Continue
                  </Button>
                ) : null}
                {failed ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      onContinue?.("fix the failed command, then verify the result again")
                    }
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Ask Privai to fix
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

function TraceCard({
  events,
  changedFiles,
  totalSeconds,
  hasFailure,
  open,
  onToggle,
  onOpenFile,
}: {
  events: AgentToolEvent[];
  changedFiles: string[];
  totalSeconds: number;
  hasFailure: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-bg/45">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2/40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-medium text-ink">
          {events.length} step{events.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-muted">
          {totalSeconds > 0.05 ? ` · ${totalSeconds.toFixed(1)}s` : ""}
          {changedFiles.length
            ? ` · ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}`
            : ""}
        </span>
        {hasFailure ? (
          <span className="ml-auto text-xs text-bad">needs review</span>
        ) : null}
      </button>
      {open ? (
        <div className="grid gap-1 border-t border-line p-2">
          {events.map((event) => (
            <TraceRow
              key={`${event.id}-${event.status}`}
              event={event}
              onOpenFile={onOpenFile}
            />
          ))}
          {changedFiles.length ? (
            <div className="mt-1 border-t border-line pt-2">
              <ChangedFilesCard files={changedFiles} onOpenFile={onOpenFile} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TraceRow({
  event,
  onOpenFile,
}: {
  event: AgentToolEvent;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const failed = event.status === "failed" || event.status === "rejected";
  const Icon = toolIcon(event.name);
  const summary = traceSummary(event);
  const diff = fileDiffSummary(event);
  const path = filePathFromEvent(event);

  return (
    <div
      className={cn(
        "rounded-md border bg-surface/60",
        failed ? "border-bad/30" : "border-line",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-2/40"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted" />
        )}
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            failed ? "text-bad" : "text-accent",
          )}
        />
        <span className="min-w-0 truncate font-mono text-[12px] text-ink">
          {summary}
        </span>
        {diff ? (
          <span className="ml-1 shrink-0 text-[11px] text-muted">{diff}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] text-muted">
          {event.durationS && event.durationS > 0.05
            ? `${event.durationS.toFixed(1)}s`
            : ""}
        </span>
        {path && onOpenFile ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile(path);
            }}
            className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
            title={`Open ${path}`}
          >
            <Eye className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="grid gap-1 border-t border-line p-2">
          <OutputBlock label="output" text={event.stdout} />
          <OutputBlock label="error" text={event.stderr} tone="bad" defaultOpen />
          {event.changedFiles?.length ? (
            <ChangedFilesCard
              files={event.changedFiles}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function toolIcon(name: string) {
  switch (name) {
    case "run_terminal_command":
      return SquareTerminal;
    case "read_file":
      return FileSearch;
    case "write_file":
      return FilePlus2;
    case "apply_patch":
      return Pencil;
    case "list_dir":
      return FolderTree;
    case "grep_workspace":
      return Search;
    case "start_project_preview":
      return MonitorPlay;
    case "update_plan":
      return ListChecks;
    default:
      return PlayCircle;
  }
}

function traceSummary(event: AgentToolEvent): string {
  if (event.command && event.command.length) return event.command;
  return event.name;
}

function filePathFromEvent(event: AgentToolEvent): string | null {
  const command = event.command || "";
  if (event.name === "write_file" || event.name === "apply_patch" || event.name === "read_file") {
    const match = /\(([^)]+)\)/.exec(command);
    if (match) return match[1].trim();
  }
  if (event.changedFiles && event.changedFiles.length === 1) {
    return event.changedFiles[0];
  }
  return null;
}

function fileDiffSummary(event: AgentToolEvent): string | null {
  if (event.name !== "write_file" && event.name !== "apply_patch") return null;
  const stdout = event.stdout || "";
  const linesMatch = /(\d+)\s+lines/.exec(stdout);
  const deltaMatch = /delta[_ ]bytes["']?:\s*(-?\d+)/.exec(stdout);
  if (event.name === "write_file" && linesMatch) {
    return `+${linesMatch[1]} lines`;
  }
  if (event.name === "apply_patch" && deltaMatch) {
    const delta = parseInt(deltaMatch[1], 10);
    if (Number.isFinite(delta)) {
      if (delta === 0) return "edited";
      return delta > 0 ? `+${delta}b` : `${delta}b`;
    }
  }
  return null;
}

function InlineCommandCard({
  event,
  onApproveCommand,
  onRejectCommand,
  onAnswerQuestion,
  onOpenFile,
}: {
  event: AgentToolEvent;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  if (event.status === "pending_question" && event.questionId) {
    return (
      <InlineQuestionCard event={event} onAnswer={onAnswerQuestion} />
    );
  }
  const failed = event.status === "failed";
  const rejected = event.status === "rejected";
  const pending = event.status === "pending_approval";
  const running = event.status === "running";
  const isTerminal = event.name === "run_terminal_command";
  const command = event.command?.trim();

  return (
    <div
      className={cn(
        "rounded-[12px] border bg-bg/45 p-2.5",
        failed || rejected ? "border-bad/35" : "border-line",
      )}
    >
      <div className="flex items-start gap-2">
        <StatusIcon
          running={running}
          failed={failed}
          rejected={rejected}
          pending={pending}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>step {event.step}/{event.maxSteps}</span>
            {pending ? <span className="text-accent">waiting for approval</span> : null}
            {rejected ? <span className="text-bad">rejected</span> : null}
            {event.risk ? (
              <span className={riskClass(event.risk)}>
                {event.risk === "read" ? "read-only" : event.risk}
              </span>
            ) : null}
            {isTerminal ? (
              <span>
                folder <code>{event.cwd || "."}</code>
              </span>
            ) : (
              <span>
                tool <code>{event.name}</code>
              </span>
            )}
            {isTerminal && event.exitCode !== undefined ? (
              <span>exit {event.exitCode ?? "-"}</span>
            ) : null}
            {event.durationS ? <span>{event.durationS}s</span> : null}
          </div>

          {pending && event.explanation ? (
            <div className="mt-2 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-xs text-muted">
              {event.explanation}
            </div>
          ) : null}

          <pre
            className={cn(
              "mt-1.5 overflow-x-auto rounded-[8px] px-2 py-1.5 font-mono text-xs text-ink",
              command ? "bg-surface-2" : "border border-bad/25 bg-bad/5 text-bad",
            )}
          >
            {command || "No command received"}
          </pre>

          {pending && event.approvalId ? (
            <div className="mt-2 flex flex-wrap gap-2">
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
          ) : null}

          <OutputBlock label="output" text={event.stdout} />
          <OutputBlock label="error" text={event.stderr} tone="bad" />

          {event.changedFiles?.length ? (
            <div className="mt-2 rounded-[8px] border border-line bg-surface px-2 py-1.5">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink">
                <FileCode2 className="h-3.5 w-3.5 text-accent" />
                files changed
              </div>
              <div className="grid gap-0.5">
                {event.changedFiles.slice(0, 8).map((file) =>
                  onOpenFile ? (
                    <button
                      key={file}
                      type="button"
                      onClick={() => onOpenFile(file)}
                      className="truncate text-left font-mono text-[11px] text-muted hover:text-accent"
                      title={`Open ${file}`}
                    >
                      {file}
                    </button>
                  ) : (
                    <code
                      key={file}
                      className="truncate text-[11px] text-muted"
                    >
                      {file}
                    </code>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InlineQuestionCard({
  event,
  onAnswer,
}: {
  event: AgentToolEvent;
  onAnswer?: (questionId: string, answer: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const question = event.question || "Privai is asking for input";

  function submit(value: string) {
    const text = value.trim();
    if (!text || !event.questionId || submitted) return;
    setSubmitted(true);
    onAnswer?.(event.questionId, text);
  }

  if (submitted) {
    return (
      <div className="rounded-[12px] border border-line bg-bg/45 p-3">
        <div className="text-xs text-muted">You answered:</div>
        <div className="mt-1 text-sm text-ink">{draft || "(sent)"}</div>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-accent/40 bg-accent-tint/40 p-3">
      <div className="text-xs uppercase tracking-wide text-accent">
        Privai needs input
      </div>
      <div className="mt-1 text-sm font-medium text-ink">{question}</div>
      {event.options?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {event.options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(option);
                submit(option);
              }}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type your answer"
          className="min-w-[200px] flex-1 rounded-[8px] border border-line bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

function StatusIcon({
  running,
  failed,
  rejected,
  pending,
}: {
  running: boolean;
  failed: boolean;
  rejected: boolean;
  pending: boolean;
}) {
  if (running) {
    return <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-warn animate-pulse" />;
  }
  if (failed || rejected) {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />;
  }
  if (pending) {
    return <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent animate-pulse" />;
  }
  return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />;
}

function OutputBlock({
  label,
  text,
  tone = "normal",
  defaultOpen,
}: {
  label: string;
  text?: string;
  tone?: "normal" | "bad";
  defaultOpen?: boolean;
}) {
  const trimmed = text?.trim();
  const lines = trimmed ? trimmed.split("\n") : [];
  const isLong = lines.length > 6 || (trimmed?.length ?? 0) > 600;
  const [open, setOpen] = useState(defaultOpen ?? (tone === "bad" || !isLong));

  if (!trimmed) return null;

  const preview = lines.slice(0, 6).join("\n") + (isLong ? "\n…" : "");
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        <span>{label}</span>
        {isLong ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-muted hover:bg-surface-2 hover:text-ink"
          >
            {open ? "collapse" : `show all (${lines.length} lines)`}
          </button>
        ) : null}
      </div>
      <pre
        className={cn(
          "overflow-auto whitespace-pre-wrap rounded-[8px] border px-2 py-1.5 font-mono text-xs",
          open ? "max-h-80" : "max-h-32",
          tone === "bad"
            ? "border-bad/20 bg-bad/5 text-bad"
            : "border-line bg-surface-2 text-muted",
        )}
      >
        {open ? truncateOutput(trimmed) : preview}
      </pre>
    </div>
  );
}

function ChangedFilesCard({
  files,
  onOpenFile,
}: {
  files: string[];
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-bg/45 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileCode2 className="h-4 w-4 text-accent" />
        Changed files
      </div>
      <FileTreeView files={files} onOpenFile={onOpenFile} />
    </div>
  );
}

function FileTreeView({
  files,
  onOpenFile,
}: {
  files: string[];
  onOpenFile?: (path: string) => void;
}) {
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
    <div className="grid max-h-40 gap-2 overflow-y-auto">
      {Object.entries(grouped).map(([folder, children]) => (
        <div key={folder}>
          <div className="flex items-center gap-1.5 text-xs text-ink">
            <FolderTree className="h-3.5 w-3.5 text-accent" />
            <code>{folder}</code>
          </div>
          <div className="ml-5 grid gap-0.5">
            {children.map((child) => {
              const fullPath = folder === "." ? child : `${folder}/${child}`;
              if (onOpenFile) {
                return (
                  <button
                    key={`${folder}/${child}`}
                    type="button"
                    onClick={() => onOpenFile(fullPath)}
                    className="truncate text-left font-mono text-xs text-muted hover:text-accent"
                    title={`Open ${fullPath}`}
                  >
                    {child}
                  </button>
                );
              }
              return (
                <code
                  key={`${folder}/${child}`}
                  className="truncate text-xs text-muted"
                >
                  {child}
                </code>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function riskClass(risk: AgentToolEvent["risk"]) {
  if (risk === "read") return "text-good";
  if (risk === "danger") return "text-bad";
  return "text-warn";
}

function truncateOutput(text: string, limit = 3200) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[output truncated in chat]`;
}

function uniqueMessages(items: ChatMessage[]) {
  const order: string[] = [];
  const byId = new Map<string, ChatMessage>();
  for (const item of items) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id)!);
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function InlinePlanCard({ plan }: { plan: AgentPlan }) {
  const done = plan.steps.filter((step) => step.status === "completed").length;
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ListChecks className="h-4 w-4 text-accent" />
        Plan
        <span className="text-xs text-muted">
          {done}/{plan.steps.length} done
        </span>
      </div>
      {plan.note ? <div className="mt-1 text-xs text-muted">{plan.note}</div> : null}
      <ul className="mt-2 grid gap-1.5">
        {plan.steps.map((step, index) => (
          <li
            key={`${index}-${step.title}`}
            className="flex items-start gap-2 text-sm"
          >
            <InlinePlanIcon status={step.status} />
            <span
              className={cn(
                "min-w-0 flex-1",
                step.status === "completed" && "text-muted line-through",
                step.status === "skipped" && "text-muted italic",
                step.status === "in_progress" && "text-ink font-medium",
                step.status === "pending" && "text-muted",
              )}
            >
              {step.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InlinePlanIcon({
  status,
}: {
  status: AgentPlan["steps"][number]["status"];
}) {
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />;
  }
  if (status === "in_progress") {
    return (
      <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent animate-spin" />
    );
  }
  if (status === "skipped") {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />;
}

function Empty({
  title,
  body,
  compact,
}: {
  title?: string;
  body?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 grid place-items-center px-6">
      <div className={compact ? "max-w-sm text-center" : "max-w-md text-center"}>
        <h2 className={`${compact ? "text-2xl" : "text-3xl"} font-serif tracking-tight mb-2`}>
          {title ?? "What do you want to ask your device?"}
        </h2>
        <div className="text-muted text-[15px]">
          {body ?? (
            <>
              This conversation runs through your configured model provider. Hit{" "}
              <span className="text-accent">web</span> for current information, or{" "}
              <span className="text-accent">agent</span> when Privai should create
              files, automate a process, build an app, or check a project. Use{" "}
              <span className="text-accent">convert</span> for local file conversion
              or private PDF creation.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
