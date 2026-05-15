"use client";
import { AlertTriangle, FolderOpen, RefreshCw, Terminal } from "lucide-react";

import { chooseDesktopWorkspace } from "@/lib/desktop";

export function WorkspaceBar({
  workspaceRoot,
  terminalEnabled,
  maxToolSteps,
  onWorkspaceChanged,
}: {
  workspaceRoot: string;
  terminalEnabled: boolean;
  maxToolSteps: number;
  onWorkspaceChanged?: (path: string) => void;
}) {
  async function chooseWorkspace() {
    const next = await chooseDesktopWorkspace();
    if (next) onWorkspaceChanged?.(next);
  }
  const broadWorkspace = isBroadWorkspace(workspaceRoot);

  return (
    <div className="shrink-0 border-b border-line bg-surface/70 px-4 md:px-6 py-2">
      <div className="mx-auto max-w-3xl flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-2">
          <FolderOpen className="h-3.5 w-3.5 text-accent shrink-0" />
          <span className="text-muted">Work folder</span>
          <code className="truncate max-w-[min(54vw,520px)] bg-surface-2 border border-line rounded px-1.5 py-0.5">
            {formatWorkspace(workspaceRoot)}
          </code>
        </span>
        <span className="inline-flex items-center gap-1 text-muted">
          <Terminal className="h-3.5 w-3.5 text-accent" />
          {terminalEnabled ? "automation on" : "automation off"} · max {maxToolSteps}
        </span>
        {broadWorkspace ? (
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 tone-warn">
            <AlertTriangle className="h-3.5 w-3.5" />
            broad folder
          </span>
        ) : null}
        <button
          type="button"
          onClick={chooseWorkspace}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-ink-2 hover:text-ink hover:bg-surface-2"
          title="Choose workspace"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Change folder
        </button>
      </div>
    </div>
  );
}

function formatWorkspace(path: string) {
  if (!path) return "unknown";
  const homePrefix = "/Users/";
  if (path.startsWith(homePrefix)) {
    const parts = path.split("/");
    if (parts.length >= 4) return `~/${parts.slice(3).join("/") || ""}`;
  }
  return path;
}

function isBroadWorkspace(path: string) {
  if (!path) return false;
  return (
    path === "/" ||
    path === "/Users" ||
    /^\/Users\/[^/]+$/.test(path) ||
    path === "/Users/Shared"
  );
}
