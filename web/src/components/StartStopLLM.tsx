"use client";
import { Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { board } from "@/lib/board";

interface LlmStatus {
  provider: string;
  loaded: boolean;
  model: string;
  default: string;
  running: Array<{ name: string; size?: string }>;
}

export function StartStopLLM({
  onChange,
}: {
  onChange?: (s: LlmStatus | null) => void;
}) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "status" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy("status");
    setErr(null);
    try {
      const j = await board.llmStatus();
      setStatus(j);
      onChange?.(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [onChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function trigger(kind: "start" | "stop") {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "start") await board.llmStart();
      else await board.llmStop();
      await new Promise((r) => setTimeout(r, 500));
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const loaded = !!status?.loaded;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          variant={loaded ? "secondary" : "primary"}
          onClick={() => trigger("start")}
          loading={busy === "start"}
        >
          <Play className="h-4 w-4" /> Check Gemini
        </Button>
        <Button variant="ghost" onClick={refresh} loading={busy === "status"}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>
      {err ? (
        <div className="text-bad text-sm tone-bad border rounded-[8px] px-3 py-2">
          {err}
        </div>
      ) : null}
      {status ? (
        <div className="text-xs text-muted">
          <span>
            <span className={loaded ? "text-good" : "text-bad"}>
              {loaded ? "●" : "○"}
            </span>{" "}
            {loaded ? "Gemini API ready" : "Gemini API key is not configured"} ·{" "}
            <code className="font-mono">{status.model}</code>
          </span>
        </div>
      ) : null}
    </div>
  );
}
