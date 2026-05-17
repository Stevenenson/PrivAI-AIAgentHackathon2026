"use client";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentStatusUpdate } from "@/lib/board";
import { cn } from "@/lib/cn";

const THINKING_VERBS = [
  "Thinking",
  "Pondering",
  "Reasoning",
  "Considering",
  "Crafting",
  "Investigating",
  "Composing",
  "Reflecting",
  "Deliberating",
  "Plotting",
];

const PHASE_VERBS: Record<NonNullable<AgentStatusUpdate["phase"]>, string[]> = {
  thinking: THINKING_VERBS,
  planning: ["Planning", "Sketching", "Outlining", "Mapping"],
  verifying: ["Verifying", "Checking", "Validating", "Inspecting"],
  running: ["Running", "Executing", "Working"],
  idle: ["Wrapping up"],
};

export function ThinkingIndicator({
  status,
}: {
  status: AgentStatusUpdate | null;
}) {
  const startedAt = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [verbIndex, setVerbIndex] = useState(0);

  const phase = status?.phase ?? "thinking";
  const verbs = useMemo(() => PHASE_VERBS[phase] ?? THINKING_VERBS, [phase]);
  const explicitLabel = status?.label && status.label.trim().length
    ? status.label
    : null;
  const verb = explicitLabel ?? verbs[verbIndex % verbs.length];
  const detail = status?.detail?.trim() || null;

  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setVerbIndex((i) => i + 1);
    }, 2200);
    return () => window.clearInterval(timer);
  }, []);

  // Reset elapsed timer whenever the phase actually changes so each step
  // shows its own duration rather than total turn duration.
  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
  }, [phase, explicitLabel, detail]);

  return (
    <div className="msg-enter w-full flex justify-start">
      <div
        className={cn(
          "group inline-flex items-center gap-2.5 rounded-[14px] rounded-bl-[6px]",
          "border border-line bg-surface px-3 py-2 text-[13px] text-muted",
          "shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        )}
        aria-live="polite"
      >
        <span className="grid h-5 w-5 place-items-center rounded-md bg-accent-tint text-accent">
          <Sparkles className="h-3 w-3 animate-pulse" />
        </span>
        <span className="thinking-shimmer font-medium text-ink">
          {verb}
          <span className="thinking-dots" aria-hidden>
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        {detail ? (
          <span className="hidden truncate max-w-[320px] font-mono text-xs text-muted md:inline">
            {detail}
          </span>
        ) : null}
        <span className="ml-1 tabular-nums text-[11px] text-muted">
          {formatElapsed(elapsed)}
        </span>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}`;
}
