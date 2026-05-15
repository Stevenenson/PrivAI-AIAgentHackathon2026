"use client";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";

interface Installed {
  name: string;
  size: string;
  modified?: string;
}

export function ModelPicker({ onChanged }: { onChanged?: () => void }) {
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [active, setActive] = useState<string>("");
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState<"refresh" | "set" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setErr(null);
    try {
      const r = await board.llmModels();
      setInstalled(r.installed);
      setActive(r.active);
      setPicked(r.active);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function apply() {
    if (!picked || picked === active) return;
    setBusy("set");
    setErr(null);
    setOk(null);
    try {
      await board.setModel(picked);
      setActive(picked);
      setOk(`Active model is now ${picked}.`);
      onChanged?.();
      setTimeout(() => setOk(null), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          disabled={busy !== null || installed.length === 0}
          className={cn(
            "h-10 px-3 pr-8 rounded-[10px] bg-surface border border-line text-ink",
            "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
            "disabled:opacity-50",
          )}
        >
          {installed.length === 0 ? (
            <option value="">no AI models configured</option>
          ) : (
            installed.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {m.size}
              </option>
            ))
          )}
        </select>
        <Button
          variant="primary"
          onClick={apply}
          loading={busy === "set"}
          disabled={!picked || picked === active || installed.length === 0}
        >
          <CheckCircle2 className="h-4 w-4" /> Use this
        </Button>
        <Button variant="ghost" onClick={refresh} loading={busy === "refresh"}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {active ? (
        <div className="text-xs text-muted">
          <span className="text-good">●</span> Active:{" "}
          <code className="font-mono">{active}</code>
        </div>
      ) : null}

      {ok ? (
        <div className="text-good text-sm tone-good border rounded-[8px] px-3 py-2">
          {ok}
        </div>
      ) : null}
      {err ? (
        <div className="text-bad text-sm tone-bad border rounded-[8px] px-3 py-2">
          {err}
        </div>
      ) : null}

      <p className="text-xs text-muted">
        Need another Gemini model? Add it to{" "}
        <code className="bg-surface-2 px-1 py-0.5 rounded">GEMINI_MODELS</code>{" "}
        in the local settings file. The default is the configured Gemini model.
      </p>
    </div>
  );
}
