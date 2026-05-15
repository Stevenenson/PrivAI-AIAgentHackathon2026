"use client";
import {
  CheckCircle2,
  FileCode2,
  FolderTree,
  RotateCw,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef } from "react";

import { MessageBubble } from "@/components/Message";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { AgentToolEvent, Artifact, ChatMessage } from "@/lib/types";

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
  showAgentActivityInline = false,
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
  showAgentActivityInline?: boolean;
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
            <MessageBubble msg={m} onOpenArtifact={onOpenArtifact} />
          </Fragment>
        ))}
        {inlineActivity && !activityBeforeMessageId ? activityNode : null}
        {pending && (pending.content || !inlineActivity) ? (
          <MessageBubble
            msg={pending}
            streaming
            onOpenArtifact={onOpenArtifact}
          />
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
}: {
  events: AgentToolEvent[];
  changedFiles: string[];
  hitLimit: boolean;
  onContinue?: (message?: string) => void;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
}) {
  const failed = events.some(
    (event) => event.status === "failed" || event.status === "rejected",
  );
  const allChangedFiles = uniqueStrings([
    ...changedFiles,
    ...events.flatMap((event) => event.changedFiles ?? []),
  ]);

  return (
    <div className="msg-enter w-full flex justify-start">
      <div className="group max-w-[96%] md:max-w-[820px]">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-accent text-white">
            <SquareTerminal className="h-3 w-3" />
          </span>
          agent actions
        </div>
        <div className="grid gap-2 rounded-[14px] rounded-bl-[6px] border border-line bg-surface px-3 py-3 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          {events.length ? (
            <div className="grid gap-2">
              {events.map((event) => (
                <InlineCommandCard
                  key={event.id}
                  event={event}
                  onApproveCommand={onApproveCommand}
                  onRejectCommand={onRejectCommand}
                />
              ))}
            </div>
          ) : null}

          {allChangedFiles.length ? (
            <ChangedFilesCard files={allChangedFiles} />
          ) : null}

          {hitLimit || failed ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
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
    </div>
  );
}

function InlineCommandCard({
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
                {event.changedFiles.slice(0, 8).map((file) => (
                  <code key={file} className="truncate text-[11px] text-muted">
                    {file}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
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
}: {
  label: string;
  text?: string;
  tone?: "normal" | "bad";
}) {
  if (!text?.trim()) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
      <pre
        className={cn(
          "max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border px-2 py-1.5 font-mono text-xs",
          tone === "bad"
            ? "border-bad/20 bg-bad/5 text-bad"
            : "border-line bg-surface-2 text-muted",
        )}
      >
        {truncateOutput(text)}
      </pre>
    </div>
  );
}

function ChangedFilesCard({ files }: { files: string[] }) {
  return (
    <div className="rounded-[12px] border border-line bg-bg/45 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileCode2 className="h-4 w-4 text-accent" />
        Changed files
      </div>
      <FileTreeView files={files} />
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
    <div className="grid max-h-40 gap-2 overflow-y-auto">
      {Object.entries(grouped).map(([folder, children]) => (
        <div key={folder}>
          <div className="flex items-center gap-1.5 text-xs text-ink">
            <FolderTree className="h-3.5 w-3.5 text-accent" />
            <code>{folder}</code>
          </div>
          <div className="ml-5 grid gap-0.5">
            {children.map((child) => (
              <code key={`${folder}/${child}`} className="truncate text-xs text-muted">
                {child}
              </code>
            ))}
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
        <p className="text-muted text-[15px]">
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
        </p>
      </div>
    </div>
  );
}
