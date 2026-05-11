"use client";
import {
  Activity,
  Cpu,
  FolderOpen,
  HardDrive,
  Network,
  Search,
  Server,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ModelPicker } from "@/components/ModelPicker";
import { StartStopLLM } from "@/components/StartStopLLM";
import { useAuth } from "@/lib/auth";
import { board } from "@/lib/board";
import { listenDevice } from "@/lib/firestore";
import type { DeviceStatus } from "@/lib/types";

export default function BoardPage() {
  const { user } = useAuth();
  const [s, setS] = useState<DeviceStatus | null>(null);
  const [llm, setLlm] = useState<{
    provider: string;
    loaded: boolean;
    model: string;
    default: string;
    running: Array<{ name: string; size?: string }>;
  } | null>(null);
  const [llmRefreshKey, setLlmRefreshKey] = useState(0);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [agentMaxToolSteps, setAgentMaxToolSteps] = useState(20);

  useEffect(() => {
    if (!user) return;
    return listenDevice(user.uid, setS);
  }, [user]);

  useEffect(() => {
    board.health()
      .then((h) => {
        setWorkspaceRoot(h.workspaceRoot || "");
        setAgentMaxToolSteps(h.agentMaxToolSteps || 20);
      })
      .catch(() => {
        /* status cards surface backend reachability elsewhere */
      });
  }, []);

  const lastSeen = formatLastSeen(s?.lastSeen);

  return (
    <>
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg sticky top-0 z-10">
        <div className="font-serif text-lg tracking-tight">Device</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-8">
        <div className="mx-auto max-w-3xl grid gap-6">
          <header>
            <h1 className="font-serif text-3xl tracking-tight mb-1">
              Your device
            </h1>
            <p className="text-muted">
              See the active model provider, what&apos;s configured, and search
              health.
            </p>
          </header>

          <section className="bg-surface border border-line rounded-[14px] p-5 grid gap-4">
            <h2 className="font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" />
              LLM lifecycle
            </h2>
            <StartStopLLM key={llmRefreshKey} onChange={setLlm} />
          </section>

          <section className="bg-surface border border-line rounded-[14px] p-5 grid gap-4">
            <h2 className="font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4 text-accent" />
              Model
            </h2>
            <ModelPicker onChanged={() => setLlmRefreshKey((v) => v + 1)} />
          </section>

          <section className="grid sm:grid-cols-2 gap-4">
            <Card
              icon={<Cpu className="h-4 w-4 text-accent" />}
              label="Model"
              value={llm?.model || s?.model || "—"}
            />
            <Card
              icon={<HardDrive className="h-4 w-4 text-accent" />}
              label="Provider"
              value={llm?.provider || s?.provider || "—"}
            />
            <Card
              icon={<Server className="h-4 w-4 text-accent" />}
              label="LLM"
              value={s?.llm || s?.ollama ? "configured" : "unconfigured"}
              tone={s?.llm || s?.ollama ? "good" : "bad"}
            />
            <Card
              icon={<Search className="h-4 w-4 text-accent" />}
              label="SearXNG"
              value={s?.searxng ? "reachable" : "unreachable"}
              tone={s?.searxng ? "good" : "bad"}
            />
            <Card
              icon={<Network className="h-4 w-4 text-accent" />}
              label="Last heartbeat"
              value={lastSeen}
            />
            <Card
              icon={<Server className="h-4 w-4 text-accent" />}
              label="Agent version"
              value={s?.agentVersion || "—"}
            />
            <Card
              icon={<FolderOpen className="h-4 w-4 text-accent" />}
              label="Workspace"
              value={formatWorkspace(workspaceRoot)}
              title={workspaceRoot || "Workspace unknown"}
            />
            <Card
              icon={<Server className="h-4 w-4 text-accent" />}
              label="Agent terminal"
              value={`max ${agentMaxToolSteps} steps`}
            />
          </section>

          {s?.boardUrl ? (
            <p className="text-xs text-muted">
              Connected at <code className="bg-surface-2 px-1 py-0.5 rounded">{s.boardUrl}</code>.
              Chat content is read directly from this URL — never via Firebase.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Card({
  icon,
  label,
  value,
  tone,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "good" | "bad";
  title?: string;
}) {
  return (
    <div className="bg-surface border border-line rounded-[14px] p-4">
      <div className="text-xs text-muted flex items-center gap-1.5 mb-1">
        {icon}
        {label}
      </div>
      <div
        title={title}
        className={
          tone === "good"
            ? "text-good font-medium"
            : tone === "bad"
              ? "text-bad font-medium"
              : "text-ink font-medium truncate"
        }
      >
        {value}
      </div>
    </div>
  );
}

function formatWorkspace(path: string) {
  if (!path) return "—";
  const homePrefix = "/Users/";
  if (path.startsWith(homePrefix)) {
    const parts = path.split("/");
    if (parts.length >= 4) return `~/${parts.slice(3).join("/") || ""}`;
  }
  return path;
}

function formatLastSeen(t: DeviceStatus["lastSeen"] | undefined) {
  if (!t) return "—";
  let d: Date | null = null;
  if (t instanceof Date) {
    d = t;
  } else {
    const obj = t as { toDate?: () => Date };
    if (typeof obj.toDate === "function") d = obj.toDate();
  }
  if (!d) return "—";
  const diff = Math.max(0, Date.now() - d.getTime());
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return d.toLocaleString();
}
