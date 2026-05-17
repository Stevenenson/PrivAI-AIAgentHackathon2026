"use client";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Play, SquareTerminal, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { board } from "@/lib/board";
import type { WorkspaceTerminalResult } from "@/lib/types";

export function TerminalPanel({
  className = "",
  onResult,
}: {
  className?: string;
  onResult?: (result: WorkspaceTerminalResult) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState(".");
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<WorkspaceTerminalResult | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const readThemeTokens = () => {
      const styles = getComputedStyle(document.documentElement);
      const pick = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      return {
        background: pick("--bg", "#0b0d12"),
        foreground: pick("--ink", "#ececec"),
        cursor: pick("--accent", "#4f8cff"),
        selectionBackground: pick("--accent-soft", "#1c2a4f"),
      };
    };

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      theme: readThemeTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    term.writeln("Privai terminal");
    term.writeln("Commands run inside the selected workspace.");
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const applyTheme = () => {
      term.options.theme = readThemeTokens();
    };
    const themeObs = new MutationObserver(applyTheme);
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });

    const resize = new ResizeObserver(() => fit.fit());
    resize.observe(hostRef.current);
    return () => {
      themeObs.disconnect();
      resize.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  async function run(e: FormEvent) {
    e.preventDefault();
    const text = command.trim();
    if (!text || running) return;
    setCommand("");

    const term = termRef.current;
    if (text === "clear") {
      term?.clear();
      return;
    }

    term?.writeln("");
    term?.writeln(`$ ${text}`);
    setRunning(true);
    try {
      const result = await board.runWorkspaceCommand(text, cwd, 120);
      setLast(result);
      onResult?.(result);
      writeOutput(result.stdout, false);
      writeOutput(result.stderr, true);
      term?.writeln(`[exit ${result.exit_code ?? "-"} in ${result.duration_s}s]`);
    } catch (err) {
      term?.writeln(`Error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  function writeOutput(text: string, error: boolean) {
    const term = termRef.current;
    if (!term || !text) return;
    const lines = text.replace(/\r/g, "").split("\n");
    for (const line of lines) {
      term.writeln(error ? `ERR ${line}` : line);
    }
  }

  return (
    <section className={`min-h-0 overflow-hidden border-t border-line bg-bg flex flex-col ${className}`}>
      <header className="h-10 shrink-0 border-b border-line bg-surface px-3 flex items-center gap-2">
        <SquareTerminal className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold">Terminal</span>
        <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
          {cwd}
        </span>
        {last?.changed_files?.length ? (
          <span className="text-[11px] text-warn">
            {last.changed_files.length} file change
            {last.changed_files.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={() => termRef.current?.clear()}
          title="Clear terminal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </header>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-2" />
      <form onSubmit={run} className="shrink-0 border-t border-line bg-surface p-2 flex gap-2">
        <Input
          value={cwd}
          onChange={(e) => setCwd(e.target.value || ".")}
          className="h-9 w-28 font-mono text-xs"
          aria-label="Working directory"
        />
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Run a command in this workspace..."
          className="h-9 flex-1 font-mono text-xs"
          aria-label="Terminal command"
        />
        <Button type="submit" size="sm" loading={running}>
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
      </form>
    </section>
  );
}
