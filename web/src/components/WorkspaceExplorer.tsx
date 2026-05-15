"use client";
import {
  ChevronLeft,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { WorkspaceItem, WorkspaceTree } from "@/lib/types";

export function WorkspaceExplorer({
  selectedPath,
  onSelectFile,
}: {
  selectedPath?: string | null;
  onSelectFile: (path: string) => void;
}) {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [path, setPath] = useState(".");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(nextPath = path) {
    setLoading(true);
    setErr(null);
    try {
      const next = await board.workspaceTree(nextPath);
      setTree(next);
      setPath(next.path);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load("."), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(item: WorkspaceItem) {
    if (item.type === "directory") {
      void load(item.path);
    } else {
      onSelectFile(item.path);
    }
  }

  return (
    <aside className="h-full min-h-0 overflow-hidden border-r border-line bg-surface flex flex-col">
      <header className="h-11 shrink-0 border-b border-line px-3 flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold">Explorer</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => tree?.parent && load(tree.parent)}
            disabled={!tree?.parent}
            title="Parent folder"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => load()}
            loading={loading}
            title="Refresh files"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="shrink-0 border-b border-line px-3 py-2 text-[11px] text-muted truncate">
        {tree?.root ? compactRoot(tree.root) : "Workspace"}
        <span className="text-ink-2"> / {path === "." ? "" : path}</span>
      </div>

      {err ? (
        <div className="m-3 rounded-[8px] border tone-bad px-3 py-2 text-xs">
          {err}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tree?.items.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => open(item)}
            className={cn(
              "flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-sm hover:bg-surface-2",
              item.path === selectedPath ? "bg-accent-tint text-ink" : "text-ink-2",
            )}
          >
            {item.type === "directory" ? (
              <Folder className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <FileCode2 className="h-4 w-4 shrink-0 text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </button>
        ))}
        {!loading && tree && tree.items.length === 0 ? (
          <div className="px-2 py-6 text-sm text-muted">No files here.</div>
        ) : null}
      </div>
    </aside>
  );
}

function compactRoot(root: string) {
  const parts = root.split("/");
  const desktop = root.match(/\/Users\/[^/]+\/Desktop\/(.+)$/);
  if (desktop) return `~/Desktop/${desktop[1]}`;
  if (parts.length > 3) return `.../${parts.slice(-2).join("/")}`;
  return root;
}
