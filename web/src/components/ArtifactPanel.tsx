"use client";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import type { Artifact } from "@/lib/types";

interface Props {
  artifact: Artifact;
  onClose: () => void;
}

export function ArtifactPanel({ artifact, onClose }: Props) {
  const [bust, setBust] = useState(0);

  function reload() {
    setBust((b) => b + 1);
  }

  function openInNewTab() {
    const blob = new Blob([artifact.html ?? ""], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadHtml() {
    const blob = new Blob([artifact.html ?? ""], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileName(artifact.title || "artifact")}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="flex flex-col border-l border-line bg-surface min-w-0 min-h-[360px]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted">
            {artifact.repaired ? "Recovered artifact" : "Artifact"}
          </div>
          <div className="font-medium truncate">
            {artifact.title || "Untitled"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={reload}
            title="Reload preview"
            className="p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={openInNewTab}
            title="Open in new tab"
            className="p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            onClick={downloadHtml}
            title="Download HTML"
            className="p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            title="Close panel"
            className="p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-hidden bg-bg">
        <iframe
          key={`${artifact.title}-${artifact.html?.length ?? 0}-${bust}`}
          srcDoc={artifact.html ?? ""}
          // Locked-down sandbox: scripts allowed (so the artifact runs), but
          // no same-origin, no top-level navigation, no form-submit, no popups.
          sandbox="allow-scripts"
          className="w-full h-full border-0 bg-white"
          title={artifact.title}
        />
      </div>
    </aside>
  );
}

function safeFileName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "artifact"
  );
}
