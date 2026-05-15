"use client";
import dynamic from "next/dynamic";
import { Save, SearchCode } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { board } from "@/lib/board";
import { useTheme } from "@/lib/theme";
import type { WorkspaceFile } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-muted">
      Loading editor...
    </div>
  ),
});

export function CodeEditorPane({ path }: { path: string | null }) {
  const { theme } = useTheme();
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(() => {
      if (!path) {
        setFile(null);
        setContent("");
        setDirty(false);
        setErr(null);
        return;
      }
      setLoading(true);
      setErr(null);
      board.workspaceFile(path)
        .then((next) => {
          if (cancel) return;
          setFile(next);
          setContent(next.content);
          setDirty(false);
        })
        .catch((e) => {
          if (!cancel) setErr((e as Error).message);
        })
        .finally(() => {
          if (!cancel) setLoading(false);
        });
    }, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [path]);

  async function save() {
    if (!file) return;
    setSaving(true);
    setErr(null);
    try {
      const result = await board.saveWorkspaceFile(file.path, content);
      setFile({ ...file, size: result.size, modified: result.modified });
      setDirty(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!path) {
    return (
      <section className="min-h-0 flex-1 overflow-hidden bg-bg grid place-items-center">
        <div className="max-w-sm text-center">
          <SearchCode className="mx-auto mb-3 h-10 w-10 text-accent" />
          <h2 className="font-serif text-2xl tracking-tight">
            Open a project file
          </h2>
          <p className="mt-2 text-sm text-muted">
            Pick a file from Explorer. Privai can edit through the agent, and
            you can inspect or save changes here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-0 flex-1 overflow-hidden bg-bg flex flex-col">
      <header className="h-11 shrink-0 border-b border-line bg-surface px-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {file?.path || path}
          {dirty ? <span className="text-warn"> (unsaved)</span> : null}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={saving}
          disabled={!file || !dirty}
          onClick={save}
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      </header>

      {err ? (
        <div className="m-3 rounded-[8px] border tone-bad px-3 py-2 text-sm">
          {err}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-muted">
            Opening file...
          </div>
        ) : file ? (
          <MonacoEditor
            height="100%"
            language={file.language || "plaintext"}
            value={content}
            theme={theme === "dark" ? "vs-dark" : "light"}
            onChange={(value) => {
              setContent(value ?? "");
              setDirty(true);
            }}
            options={{
              minimap: { enabled: true },
              fontSize: 13,
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              wordWrap: "on",
              smoothScrolling: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
