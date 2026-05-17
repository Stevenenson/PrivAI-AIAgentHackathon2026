"use client";
import {
  Bot,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  ExternalLink,
  FileCode2,
  Files,
  FolderOpen,
  FolderPlus,
  GitBranch,
  History,
  ListChecks,
  MonitorPlay,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  StopCircle,
  SquareTerminal,
  XCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CodeEditorPane } from "@/components/CodeEditorPane";
import { SpaceAgentPanel } from "@/components/SpaceAgentPanel";
import { TerminalPanel } from "@/components/TerminalPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WorkspaceExplorer } from "@/components/WorkspaceExplorer";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import {
  chooseDesktopWorkspace,
  createDesktopWorkspace,
  setDesktopWorkspace,
} from "@/lib/desktop";
import type {
  AgentToolEvent,
  ChatMode,
  PreviewInfo,
  WorkspaceCheckpoint,
  WorkspaceSearchMatch,
  WorkspaceTerminalResult,
} from "@/lib/types";

type ActivityView = "explorer" | "search" | "git" | "changes" | "run";
type BottomView = "terminal" | "problems" | "output";
type AgentMode = "ask" | "plan" | "agent" | "auto";
type CenterView = "editor" | "preview";

const RECENT_WORKSPACES_KEY = "privai.coding.recentWorkspaces";

const agentModes: Array<{
  id: AgentMode;
  label: string;
  description: string;
  composerMode: ChatMode;
}> = [
  {
    id: "ask",
    label: "Ask",
    description: "Answer and explain without tools by default.",
    composerMode: "chat",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Think through steps before changing the project.",
    composerMode: "chat",
  },
  {
    id: "agent",
    label: "Agent",
    description: "Edit files and run commands with approval.",
    composerMode: "agent",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Run commands without approval for faster local work.",
    composerMode: "agent",
  },
];

export default function CodingSpacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [centerView, setCenterView] = useState<CenterView>("editor");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActivityView>("explorer");
  const [sideOpen, setSideOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [bottomView, setBottomView] = useState<BottomView>("terminal");
  const [agentMode, setAgentMode] = useState<AgentMode>("agent");
  const [agentEvents, setAgentEvents] = useState<AgentToolEvent[]>([]);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [agentHitLimit, setAgentHitLimit] = useState(false);
  const [checkpoints, setCheckpoints] = useState<WorkspaceCheckpoint[]>([]);
  const [checkpointErr, setCheckpointErr] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<WorkspaceTerminalResult | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("my-app");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceDialogErr, setWorkspaceDialogErr] = useState<string | null>(null);
  const autoCheckpointStarted = useRef(false);
  const currentPreviewUrl = useRef<string | null>(null);

  const mode = agentModes.find((item) => item.id === agentMode) ?? agentModes[2];
  const commandApprovalRequired = agentMode !== "auto";

  const refreshWorkspace = useCallback(async () => {
    try {
      const health = await board.health();
      setWorkspaceRoot(health.workspaceRoot || "");
      if (health.workspaceRoot) rememberWorkspace(health.workspaceRoot, setRecents);
    } catch {
      /* setup/status pages surface backend errors */
    }
  }, []);

  const refreshCheckpoints = useCallback(async () => {
    try {
      setCheckpoints(await board.workspaceCheckpoints());
      setCheckpointErr(null);
    } catch (e) {
      setCheckpointErr((e as Error).message);
    }
  }, []);

  const refreshPreview = useCallback(async () => {
    try {
      const next = await board.previewStatus();
      if (next.running && next.url) {
        setPreview(next);
        if (currentPreviewUrl.current !== next.url) {
          currentPreviewUrl.current = next.url;
          setCenterView("preview");
        }
      } else {
        currentPreviewUrl.current = null;
        setPreview(null);
      }
    } catch {
      /* preview status is best-effort; chat and terminal still show errors */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWorkspace();
      void refreshCheckpoints();
      setRecents(readRecentWorkspaces());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshCheckpoints, refreshWorkspace]);

  useEffect(() => {
    if (!workspaceRoot) {
      currentPreviewUrl.current = null;
      const reset = window.setTimeout(() => setPreview(null), 0);
      return () => window.clearTimeout(reset);
    }
    const initial = window.setTimeout(() => void refreshPreview(), 0);
    const interval = window.setInterval(() => void refreshPreview(), 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshPreview, workspaceRoot]);

  useEffect(() => {
    autoCheckpointStarted.current = false;
  }, [sessionId]);

  const handleAgentActivity = useCallback(
    (payload: {
      events: AgentToolEvent[];
      changedFiles: string[];
      hitLimit: boolean;
    }) => {
      setAgentEvents(payload.events);
      setChangedFiles(payload.changedFiles);
      setAgentHitLimit(payload.hitLimit);

      const previewFinished = payload.events.some(
        (event) =>
          event.name === "start_project_preview" &&
          (event.status === "completed" || event.status === "failed"),
      );
      if (previewFinished) void refreshPreview();

      const startedWork = payload.events.some(
        (event) => event.status === "running" || event.status === "pending_approval",
      );
      if (!startedWork || autoCheckpointStarted.current) return;
      autoCheckpointStarted.current = true;
      board
        .createWorkspaceCheckpoint("Before agent session")
        .then(() => refreshCheckpoints())
        .catch(() => {
          /* manual checkpoint button remains available */
        });
    },
    [refreshCheckpoints, refreshPreview],
  );

  async function chooseWorkspace() {
    const next = await chooseDesktopWorkspace();
    if (next) switchToWorkspace(next);
  }

  function openCreateWorkspaceDialog() {
    setWorkspaceName("my-app");
    setWorkspaceDialogErr(null);
    setWorkspaceDialogOpen(true);
  }

  async function createWorkspaceWithName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = workspaceName.trim();
    if (!name) {
      setWorkspaceDialogErr("Workspace name is required.");
      return;
    }

    setCreatingWorkspace(true);
    setWorkspaceDialogErr(null);
    try {
      const next = await createDesktopWorkspace(name);
      if (next) {
        setWorkspaceDialogOpen(false);
        switchToWorkspace(next);
      }
    } catch (err) {
      setWorkspaceDialogErr((err as Error).message);
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function openRecent(path: string) {
    const next = await setDesktopWorkspace(path);
    if (next) switchToWorkspace(next);
  }

  function switchToWorkspace(path: string) {
    setWorkspaceRoot(path);
    setSelectedPath(null);
    setCenterView("editor");
    currentPreviewUrl.current = null;
    setPreview(null);
    setRefreshKey((n) => n + 1);
    rememberWorkspace(path, setRecents);
    void board.stopPreview().catch(() => {
      /* switching workspaces should not be blocked by preview cleanup */
    });
    void refreshCheckpoints();
  }

  function openFile(path: string) {
    setSelectedPath(path);
    setCenterView("editor");
  }

  const stopCodingPreview = useCallback(async () => {
    await board.stopPreview();
    currentPreviewUrl.current = null;
    setPreview(null);
    setCenterView("editor");
  }, []);

  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const startCodingPreview = useCallback(async () => {
    if (!workspaceRoot) return;
    setPreviewBusy(true);
    setPreviewErr(null);
    try {
      const cwd = inferPreviewCwd(changedFiles);
      const next = await board.startPreview(cwd);
      if (next?.url) {
        currentPreviewUrl.current = next.url;
        setPreview(next);
        setCenterView("preview");
      }
    } catch (err) {
      setPreviewErr((err as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }, [changedFiles, workspaceRoot]);

  function openSession(id: string) {
    router.replace(`/coding?session=${encodeURIComponent(id)}`);
  }

  const sideTitle = useMemo(() => {
    if (activeView === "explorer") return "Explorer";
    if (activeView === "search") return "Search";
    if (activeView === "git") return "Source Control";
    if (activeView === "changes") return "Changes";
    return "Run";
  }, [activeView]);

  return (
    <>
      <div
        className="grid h-full min-h-0 overflow-hidden bg-bg"
        style={{
          gridTemplateColumns: `48px ${sideOpen ? "310px" : "0px"} minmax(0,1fr) ${
            agentOpen ? "440px" : "0px"
          }`,
        }}
      >
      <ActivityRail
        activeView={activeView}
        onSelect={(view) => {
          setActiveView(view);
          setSideOpen(true);
        }}
        agentOpen={agentOpen}
        onToggleAgent={() => setAgentOpen((open) => !open)}
      />

      <aside
        className={cn(
          "min-w-0 overflow-hidden border-r border-line bg-surface transition-opacity",
          sideOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <header className="h-11 border-b border-line px-3 flex items-center gap-2">
          <span className="text-sm font-semibold">{sideTitle}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            onClick={() => setSideOpen(false)}
            title="Collapse side panel"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
        </header>
        <SidePanel
          activeView={activeView}
          selectedPath={selectedPath}
          refreshKey={refreshKey}
          recents={recents}
          checkpoints={checkpoints}
          checkpointErr={checkpointErr}
          workspaceRoot={workspaceRoot}
          agentEvents={agentEvents}
          changedFiles={changedFiles}
          agentHitLimit={agentHitLimit}
          lastRun={lastRun}
          onOpenFile={openFile}
          onOpenRecent={openRecent}
          onCreateWorkspace={openCreateWorkspaceDialog}
          onChooseWorkspace={chooseWorkspace}
          onRefreshCheckpoints={refreshCheckpoints}
          onRunCommand={setLastRun}
          onRestoreCheckpoint={async (id) => {
            if (!window.confirm("Restore this checkpoint into the current workspace?")) {
              return;
            }
            await board.restoreWorkspaceCheckpoint(id);
            setSelectedPath(null);
            setRefreshKey((n) => n + 1);
          }}
          onCreateCheckpoint={async () => {
            await board.createWorkspaceCheckpoint("Manual checkpoint");
            await refreshCheckpoints();
          }}
        />
      </aside>

      <main className="min-w-0 min-h-0 overflow-hidden grid grid-rows-[56px_minmax(0,1fr)_auto]">
        <header className="min-h-0 border-b border-line bg-bg px-3 flex items-center gap-2 overflow-x-auto">
          {!sideOpen ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => setSideOpen(true)}
              title="Show side panel"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
            <Code2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">Coding</div>
              <span className="hidden sm:inline rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-muted truncate max-w-[180px]">
                {workspaceRoot ? compactWorkspace(workspaceRoot) : "No workspace"}
              </span>
            </div>
            <div className="hidden xl:block truncate text-xs text-muted">
              Build, inspect, run, checkpoint, and review projects with Privai.
            </div>
          </div>

          <div className="hidden 2xl:flex items-center rounded-[10px] border border-line bg-surface p-1 shrink-0">
            {agentModes.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAgentMode(item.id)}
                title={item.description}
                className={cn(
                  "h-7 rounded-[8px] px-2.5 text-xs transition",
                  agentMode === item.id
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={openCreateWorkspaceDialog}
            className="shrink-0"
            title="Create workspace"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">New</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={chooseWorkspace}
            className="shrink-0"
            title="Open workspace"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Open</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setRefreshKey((n) => n + 1)}
            className="shrink-0"
            title="Refresh workspace"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Refresh</span>
          </Button>
          {workspaceRoot && !(preview?.running && preview.url) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={previewBusy}
              onClick={startCodingPreview}
              className="shrink-0"
              title={previewErr ?? "Detect and start the local dev server"}
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Run preview</span>
            </Button>
          ) : null}
          {workspaceRoot && preview?.running && preview.url ? (
            <div className="flex items-center rounded-[10px] border border-line bg-surface p-1 shrink-0">
              <button
                type="button"
                onClick={() => setCenterView("editor")}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-xs transition",
                  centerView === "editor"
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
                title="Editor"
              >
                <FileCode2 className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Editor</span>
              </button>
              <button
                type="button"
                onClick={() => setCenterView("preview")}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-xs transition",
                  centerView === "preview"
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
                title="Preview"
              >
                <MonitorPlay className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Preview</span>
              </button>
            </div>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => setAgentOpen((open) => !open)}
            title={agentOpen ? "Hide agent" : "Show agent"}
          >
            {agentOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
        </header>

        {workspaceRoot ? (
          centerView === "preview" && preview?.running && preview.url ? (
            <CodingPreviewPane
              preview={preview}
              onRefresh={refreshPreview}
              onStop={stopCodingPreview}
            />
          ) : (
            <CodeEditorPane path={selectedPath} />
          )
        ) : (
          <NoWorkspacePane
            onCreateWorkspace={openCreateWorkspaceDialog}
            onChooseWorkspace={chooseWorkspace}
          />
        )}

        {workspaceRoot ? (
          <section
            className={cn(
              "min-h-0 overflow-hidden border-t border-line bg-bg",
              bottomOpen ? "h-[280px]" : "h-10",
            )}
          >
          <div className="h-10 border-b border-line bg-surface px-2 flex items-center gap-1">
            <BottomTab
              active={bottomView === "terminal"}
              onClick={() => {
                setBottomView("terminal");
                setBottomOpen(true);
              }}
              icon={<SquareTerminal className="h-3.5 w-3.5" />}
            >
              Terminal
            </BottomTab>
            <BottomTab
              active={bottomView === "problems"}
              onClick={() => {
                setBottomView("problems");
                setBottomOpen(true);
              }}
              icon={<ListChecks className="h-3.5 w-3.5" />}
            >
              Problems
            </BottomTab>
            <BottomTab
              active={bottomView === "output"}
              onClick={() => {
                setBottomView("output");
                setBottomOpen(true);
              }}
              icon={<FileCode2 className="h-3.5 w-3.5" />}
            >
              Output
            </BottomTab>
            <div className="ml-auto text-[11px] text-muted hidden lg:block">
              {mode.description}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-2 h-7 w-7"
              onClick={() => setBottomOpen((open) => !open)}
              title={bottomOpen ? "Collapse panel" : "Expand panel"}
            >
              {bottomOpen ? (
                <PanelBottomClose className="h-4 w-4" />
              ) : (
                <PanelBottomOpen className="h-4 w-4" />
              )}
            </Button>
          </div>
          {bottomOpen ? (
            bottomView === "terminal" ? (
              <TerminalPanel
                className="h-[240px] border-t-0"
                onResult={setLastRun}
              />
            ) : bottomView === "problems" ? (
              <ProblemsPanel lastRun={lastRun} />
            ) : (
              <OutputPanel lastRun={lastRun} />
            )
          ) : null}
          </section>
        ) : null}
      </main>

      <div
        className={cn(
          "min-w-0 min-h-0 overflow-hidden transition-opacity",
          agentOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <SpaceAgentPanel
          title="Coding agent"
          subtitle="Plan, edit files, run commands, and explain changes."
          seedTitle="Coding workspace"
          placeholder={placeholderForMode(agentMode)}
          emptyTitle="What should we build?"
          emptyBody="Open a project folder, then ask Privai to create files, fix bugs, run checks, or explain code. Use /fix, /test, /review, /new-app, /preview, and /commit for focused workflows."
          sessionId={sessionId}
          space="coding"
          onSessionCreated={openSession}
          onAgentActivity={handleAgentActivity}
          commandApprovalRequired={commandApprovalRequired}
          autoApproveReadOnlyCommands={agentMode === "auto" ? true : undefined}
          composerDefaultMode="agent"
          composerAgentOnly
          onOpenFile={openFile}
          onClose={() => setAgentOpen(false)}
        />
      </div>
      </div>
      {workspaceDialogOpen ? (
        <CreateWorkspaceDialog
          name={workspaceName}
          error={workspaceDialogErr}
          creating={creatingWorkspace}
          onNameChange={setWorkspaceName}
          onClose={() => {
            if (!creatingWorkspace) setWorkspaceDialogOpen(false);
          }}
          onSubmit={createWorkspaceWithName}
        />
      ) : null}
    </>
  );
}

function CreateWorkspaceDialog({
  name,
  error,
  creating,
  onNameChange,
  onClose,
  onSubmit,
}: {
  name: string;
  error: string | null;
  creating: boolean;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-4"
      role="presentation"
    >
      <form
        className="w-full max-w-md rounded-[14px] border border-line bg-surface p-5 shadow-2xl"
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-workspace-title"
      >
        <h2 id="create-workspace-title" className="text-lg font-semibold text-ink">
          Create workspace
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Privai will ask for a parent folder, create this folder there, and
          open it as the coding workspace.
        </p>
        <label className="mt-5 grid gap-2 text-sm font-medium text-ink">
          Folder name
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="my-app"
            disabled={creating}
          />
        </label>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button type="submit" loading={creating}>
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}

function NoWorkspacePane({
  onCreateWorkspace,
  onChooseWorkspace,
}: {
  onCreateWorkspace: () => void;
  onChooseWorkspace: () => void;
}) {
  return (
    <div className="grid h-full min-h-0 place-items-center px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-[14px] border border-line bg-surface text-accent">
          <FolderOpen className="h-6 w-6" />
        </div>
        <h2 className="font-serif text-2xl tracking-tight">Open a coding workspace</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Choose a project folder before the agent reads files, edits code, or
          runs terminal commands.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button type="button" variant="secondary" onClick={onCreateWorkspace}>
            <FolderPlus className="h-4 w-4" />
            Create workspace
          </Button>
          <Button type="button" onClick={onChooseWorkspace}>
            <FolderOpen className="h-4 w-4" />
            Open folder
          </Button>
        </div>
      </div>
    </div>
  );
}

function CodingPreviewPane({
  preview,
  onRefresh,
  onStop,
}: {
  preview: PreviewInfo;
  onRefresh: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [frameKey, setFrameKey] = useState(0);
  const [busy, setBusy] = useState<"refresh" | "stop" | null>(null);
  const url = preview.url || "";

  async function reload() {
    setBusy("refresh");
    try {
      await onRefresh();
      setFrameKey((key) => key + 1);
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    try {
      await onStop();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="min-h-0 flex-1 overflow-hidden bg-bg flex flex-col">
      <header className="h-12 shrink-0 border-b border-line bg-surface px-3 flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-[8px] bg-accent-tint text-accent">
          <MonitorPlay className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Local preview</span>
            {preview.ready ? (
              <span className="rounded-full border border-good/20 bg-good/5 px-2 py-0.5 text-[11px] text-good">
                ready
              </span>
            ) : (
              <span className="rounded-full border border-warn/20 bg-warn/5 px-2 py-0.5 text-[11px] text-warn">
                starting
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-muted">
            {preview.command || "Managed preview server"}
          </div>
        </div>
        {url ? (
          <code className="hidden max-w-[240px] truncate rounded-full border border-line bg-bg px-2 py-1 text-[11px] text-muted xl:block">
            {url.replace("http://", "")}
          </code>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={busy === "refresh"}
          onClick={reload}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reload
        </Button>
        {url ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="danger"
          loading={busy === "stop"}
          onClick={stop}
        >
          <StopCircle className="h-3.5 w-3.5" />
          Stop
        </Button>
      </header>

      {!preview.ready ? (
        <div className="shrink-0 border-b border-line p-3">
          <Notice tone="muted">
            Privai started the preview server and is waiting for the page to
            become available. If the app shows an error overlay, ask the coding
            agent to fix the preview error and run the build again.
          </Notice>
        </div>
      ) : null}

      {url ? (
        <iframe
          key={`${url}-${frameKey}`}
          src={url}
          title="Local app preview"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm">
            <MonitorPlay className="mx-auto mb-3 h-10 w-10 text-accent" />
            <h2 className="font-serif text-2xl tracking-tight">
              No preview URL yet
            </h2>
            <p className="mt-2 text-sm text-muted">
              Ask the agent to build and preview the app after verification.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ActivityRail({
  activeView,
  onSelect,
  agentOpen,
  onToggleAgent,
}: {
  activeView: ActivityView;
  onSelect: (view: ActivityView) => void;
  agentOpen: boolean;
  onToggleAgent: () => void;
}) {
  const items: Array<{
    id: ActivityView;
    title: string;
    icon: ReactNode;
  }> = [
    { id: "explorer", title: "Explorer", icon: <Files className="h-5 w-5" /> },
    { id: "search", title: "Search", icon: <Search className="h-5 w-5" /> },
    { id: "git", title: "Source Control", icon: <GitBranch className="h-5 w-5" /> },
    { id: "changes", title: "Changes", icon: <History className="h-5 w-5" /> },
    { id: "run", title: "Run", icon: <Play className="h-5 w-5" /> },
  ];
  return (
    <nav className="h-full min-h-0 border-r border-line bg-surface grid grid-rows-[1fr_auto] py-2">
      <div className="grid content-start gap-1 px-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            title={item.title}
            className={cn(
              "relative grid h-10 w-10 place-items-center rounded-[9px] text-muted hover:bg-surface-2 hover:text-ink",
              activeView === item.id && "bg-accent-tint text-accent",
            )}
          >
            {activeView === item.id ? (
              <span className="absolute left-[-6px] h-5 w-1 rounded-r bg-accent" />
            ) : null}
            {item.icon}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggleAgent}
        title={agentOpen ? "Hide agent" : "Show agent"}
        className={cn(
          "mx-1.5 grid h-10 w-10 place-items-center rounded-[9px] text-muted hover:bg-surface-2 hover:text-ink",
          agentOpen && "bg-accent-tint text-accent",
        )}
      >
        <Bot className="h-5 w-5" />
      </button>
    </nav>
  );
}

function SidePanel({
  activeView,
  selectedPath,
  refreshKey,
  recents,
  checkpoints,
  checkpointErr,
  workspaceRoot,
  agentEvents,
  changedFiles,
  agentHitLimit,
  lastRun,
  onOpenFile,
  onOpenRecent,
  onCreateWorkspace,
  onChooseWorkspace,
  onRefreshCheckpoints,
  onRunCommand,
  onCreateCheckpoint,
  onRestoreCheckpoint,
}: {
  activeView: ActivityView;
  selectedPath: string | null;
  refreshKey: number;
  recents: string[];
  checkpoints: WorkspaceCheckpoint[];
  checkpointErr: string | null;
  workspaceRoot: string;
  agentEvents: AgentToolEvent[];
  changedFiles: string[];
  agentHitLimit: boolean;
  lastRun: WorkspaceTerminalResult | null;
  onOpenFile: (path: string) => void;
  onOpenRecent: (path: string) => void;
  onCreateWorkspace: () => void;
  onChooseWorkspace: () => void;
  onRefreshCheckpoints: () => void;
  onRunCommand: (result: WorkspaceTerminalResult) => void;
  onCreateCheckpoint: () => Promise<void>;
  onRestoreCheckpoint: (id: string) => Promise<void>;
}) {
  if (activeView === "explorer") {
    return (
      <div className="h-[calc(100%-44px)] min-h-0 grid grid-rows-[auto_minmax(0,1fr)]">
        <WorkspaceQuickStart
          recents={recents}
          onOpenRecent={onOpenRecent}
          onCreateWorkspace={onCreateWorkspace}
          onChooseWorkspace={onChooseWorkspace}
        />
        {workspaceRoot ? (
          <WorkspaceExplorer
            key={refreshKey}
            selectedPath={selectedPath}
            onSelectFile={onOpenFile}
          />
        ) : (
          <div className="p-3 text-sm leading-6 text-muted">
            No workspace is open. Create or open a folder before browsing files.
          </div>
        )}
      </div>
    );
  }
  if (!workspaceRoot) {
    return (
      <div className="h-[calc(100%-44px)] min-h-0 p-3">
        <Notice tone="muted">
          Open a coding workspace before using this panel.
        </Notice>
      </div>
    );
  }
  if (activeView === "search") {
    return <WorkspaceSearchPanel onOpenFile={onOpenFile} />;
  }
  if (activeView === "git") {
    return <GitPanel onRunCommand={onRunCommand} />;
  }
  if (activeView === "changes") {
    return (
      <ChangesPanel
        checkpoints={checkpoints}
        checkpointErr={checkpointErr}
        agentEvents={agentEvents}
        changedFiles={changedFiles}
        agentHitLimit={agentHitLimit}
        onOpenFile={onOpenFile}
        onCreateCheckpoint={onCreateCheckpoint}
        onRestoreCheckpoint={onRestoreCheckpoint}
        onRefreshCheckpoints={onRefreshCheckpoints}
      />
    );
  }
  return <RunPanel lastRun={lastRun} onRunCommand={onRunCommand} />;
}

function WorkspaceQuickStart({
  recents,
  onOpenRecent,
  onCreateWorkspace,
  onChooseWorkspace,
}: {
  recents: string[];
  onOpenRecent: (path: string) => void;
  onCreateWorkspace: () => void;
  onChooseWorkspace: () => void;
}) {
  return (
    <div className="border-b border-line p-3 grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" onClick={onCreateWorkspace}>
          <FolderPlus className="h-3.5 w-3.5" />
          New
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onChooseWorkspace}>
          <FolderOpen className="h-3.5 w-3.5" />
          Open
        </Button>
      </div>
      {recents.length ? (
        <div className="grid gap-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">
            Recent
          </div>
          {recents.slice(0, 4).map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => onOpenRecent(path)}
              className="rounded-[8px] px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
              title={path}
            >
              <span className="block truncate">{compactWorkspace(path)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceSearchPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<WorkspaceSearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function searchWorkspace() {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    setErr(null);
    try {
      const result = await board.workspaceSearch(text, 80);
      setMatches(result.matches);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-[calc(100%-44px)] min-h-0 overflow-hidden grid grid-rows-[auto_minmax(0,1fr)]">
      <form
        className="border-b border-line p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void searchWorkspace();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files..."
          className="h-9 text-sm"
        />
        <Button type="submit" size="sm" loading={loading}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </form>
      <div className="min-h-0 overflow-y-auto p-2">
        {err ? <Notice tone="bad">{err}</Notice> : null}
        {matches.map((match) => (
          <button
            key={`${match.path}:${match.line}:${match.text}`}
            type="button"
            onClick={() => onOpenFile(match.path)}
            className="mb-1 w-full rounded-[8px] p-2 text-left hover:bg-surface-2"
          >
            <div className="truncate text-xs font-medium text-ink">
              {match.path}:{match.line}
            </div>
            <div className="mt-1 line-clamp-2 font-mono text-[11px] text-muted">
              {match.text}
            </div>
          </button>
        ))}
        {!loading && query && matches.length === 0 && !err ? (
          <div className="px-2 py-6 text-sm text-muted">No matches.</div>
        ) : null}
      </div>
    </div>
  );
}

function GitPanel({
  onRunCommand,
}: {
  onRunCommand: (result: WorkspaceTerminalResult) => void;
}) {
  const [result, setResult] = useState<WorkspaceTerminalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const next = await board.runWorkspaceCommand("git status --short", ".", 30);
      setResult(next);
      onRunCommand(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = result?.stdout.trim().split("\n").filter(Boolean) ?? [];
  return (
    <div className="h-[calc(100%-44px)] min-h-0 overflow-y-auto p-3">
      <Button type="button" size="sm" variant="secondary" onClick={refresh} loading={loading}>
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh status
      </Button>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="mt-3 grid gap-2">
        {lines.length ? (
          lines.map((line) => (
            <div key={line} className="rounded-[8px] border border-line bg-bg px-2 py-1.5 font-mono text-xs">
              {line}
            </div>
          ))
        ) : (
          <Notice tone="muted">
            {result ? "No git changes detected." : "Loading git status..."}
          </Notice>
        )}
      </div>
    </div>
  );
}

function ChangesPanel({
  checkpoints,
  checkpointErr,
  agentEvents,
  changedFiles,
  agentHitLimit,
  onOpenFile,
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onRefreshCheckpoints,
}: {
  checkpoints: WorkspaceCheckpoint[];
  checkpointErr: string | null;
  agentEvents: AgentToolEvent[];
  changedFiles: string[];
  agentHitLimit: boolean;
  onOpenFile: (path: string) => void;
  onCreateCheckpoint: () => Promise<void>;
  onRestoreCheckpoint: (id: string) => Promise<void>;
  onRefreshCheckpoints: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function createCheckpoint() {
    setBusy("create");
    try {
      await onCreateCheckpoint();
    } finally {
      setBusy(null);
    }
  }

  async function restore(id: string) {
    setBusy(id);
    try {
      await onRestoreCheckpoint(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-[calc(100%-44px)] min-h-0 overflow-y-auto p-3 grid content-start gap-4">
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            Agent changes
          </div>
          {agentHitLimit ? <span className="text-[11px] text-warn">Hit action limit</span> : null}
        </div>
        {changedFiles.length ? (
          <div className="grid gap-1">
            {changedFiles.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onOpenFile(path)}
                className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-xs hover:bg-surface-2"
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate">{path}</span>
              </button>
            ))}
          </div>
        ) : (
          <Notice tone="muted">Changed files from agent work appear here.</Notice>
        )}
      </section>

      <section className="grid gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">
          Timeline
        </div>
        {agentEvents.length ? (
          <div className="grid gap-1.5">
            {agentEvents.slice(-8).map((event) => (
              <div key={event.id} className="rounded-[8px] border border-line bg-bg p-2">
                <div className="flex items-center gap-2 text-xs">
                  {event.status === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-good" />
                  ) : event.status === "failed" || event.status === "rejected" ? (
                    <XCircle className="h-3.5 w-3.5 text-bad" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-accent" />
                  )}
                  <span className="text-muted">step {event.step}/{event.maxSteps}</span>
                  <span className="truncate text-ink">{event.name}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted">
                  {event.command || event.explanation || event.cwd}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Notice tone="muted">No agent work in this session yet.</Notice>
        )}
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            Checkpoints
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onRefreshCheckpoints}
              title="Refresh checkpoints"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7"
              loading={busy === "create"}
              onClick={createCheckpoint}
              title="Create checkpoint"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {checkpointErr ? <Notice tone="bad">{checkpointErr}</Notice> : null}
        {checkpoints.length ? (
          <div className="grid gap-2">
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.id} className="rounded-[8px] border border-line bg-bg p-2">
                <div className="truncate text-xs font-medium">{checkpoint.title}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {checkpoint.fileCount} files - {formatDate(checkpoint.createdAt)}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2 h-7 text-xs"
                  loading={busy === checkpoint.id}
                  onClick={() => restore(checkpoint.id)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Notice tone="muted">Create a checkpoint before large agent work.</Notice>
        )}
      </section>
    </div>
  );
}

function RunPanel({
  lastRun,
  onRunCommand,
}: {
  lastRun: WorkspaceTerminalResult | null;
  onRunCommand: (result: WorkspaceTerminalResult) => void;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const commands = [
    { label: "Install", command: "npm install" },
    { label: "Lint", command: "npm run lint" },
    { label: "Build", command: "npm run build" },
    { label: "Test", command: "npm test" },
  ];

  async function run(command: string) {
    setRunning(command);
    setErr(null);
    try {
      const result = await board.runWorkspaceCommand(command, ".", 120);
      onRunCommand(result);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="h-[calc(100%-44px)] min-h-0 overflow-y-auto p-3 grid content-start gap-3">
      <div className="grid gap-2">
        {commands.map((item) => (
          <Button
            key={item.command}
            type="button"
            size="sm"
            variant="secondary"
            className="justify-start"
            loading={running === item.command}
            onClick={() => run(item.command)}
          >
            <Play className="h-3.5 w-3.5" />
            {item.label}
            <span className="ml-auto font-mono text-[11px] text-muted">
              {item.command}
            </span>
          </Button>
        ))}
      </div>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      {lastRun ? (
        <Notice tone={lastRun.exit_code === 0 ? "good" : "bad"}>
          Last run: {lastRun.command} exited {lastRun.exit_code ?? "-"}.
        </Notice>
      ) : (
        <Notice tone="muted">Run common project commands from here or use the terminal.</Notice>
      )}
    </div>
  );
}

function ProblemsPanel({ lastRun }: { lastRun: WorkspaceTerminalResult | null }) {
  if (!lastRun) {
    return (
      <div className="h-[240px] overflow-auto p-4 text-sm text-muted">
        Run a command to see problems here.
      </div>
    );
  }
  const hasProblems = lastRun.exit_code !== 0 || Boolean(lastRun.stderr.trim());
  return (
    <div className="h-[240px] overflow-auto p-3">
      <Notice tone={hasProblems ? "bad" : "good"}>
        {hasProblems
          ? `Command exited ${lastRun.exit_code ?? "-"}. Review output below.`
          : "No problems reported by the last command."}
      </Notice>
      {lastRun.stderr ? (
        <pre className="mt-3 whitespace-pre-wrap rounded-[8px] border border-line bg-surface p-3 font-mono text-xs text-bad">
          {lastRun.stderr}
        </pre>
      ) : null}
    </div>
  );
}

function OutputPanel({ lastRun }: { lastRun: WorkspaceTerminalResult | null }) {
  return (
    <div className="h-[240px] overflow-auto p-3">
      {lastRun ? (
        <pre className="whitespace-pre-wrap rounded-[8px] border border-line bg-surface p-3 font-mono text-xs text-ink-2">
          {lastRun.stdout || lastRun.stderr || "No output."}
        </pre>
      ) : (
        <div className="text-sm text-muted">Command output appears here.</div>
      )}
    </div>
  );
}

function BottomTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-xs transition",
        active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "muted" | "good" | "bad";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[8px] border px-3 py-2 text-xs",
        tone === "good" && "border-good/20 bg-good/5 text-good",
        tone === "bad" && "border-bad/20 bg-bad/5 text-bad",
        tone === "muted" && "border-line bg-bg text-muted",
      )}
    >
      {children}
    </div>
  );
}

function placeholderForMode(mode: AgentMode) {
  if (mode === "ask") return "Ask about this project, file, error, or architecture...";
  if (mode === "plan") return "Describe the coding goal and ask for a step-by-step plan...";
  if (mode === "auto") return "Ask the agent to work fast. Commands will not ask for approval...";
  return "Ask the agent to build, fix, refactor, run checks, or use / commands...";
}

function inferPreviewCwd(files: string[]) {
  const packageFile = files.find((file) => file.endsWith("package.json"));
  if (packageFile) {
    const parts = packageFile.split("/");
    parts.pop();
    return parts.join("/") || ".";
  }
  const sourceFile = files.find((file) => /(^|\/)src\//.test(file));
  if (sourceFile) {
    const beforeSrc = sourceFile.split("/src/")[0];
    return beforeSrc || ".";
  }
  return files[0]?.split("/")[0] || ".";
}

function compactWorkspace(path: string) {
  const desktop = path.match(/\/Users\/[^/]+\/Desktop\/(.+)$/);
  if (desktop) return `~/Desktop/${desktop[1]}`;
  const home = path.match(/\/Users\/[^/]+\/(.+)$/);
  if (home) return `~/${home[1]}`;
  return path;
}

function readRecentWorkspaces() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_WORKSPACES_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberWorkspace(
  path: string,
  setRecents: (updater: (cur: string[]) => string[]) => void,
) {
  if (typeof window === "undefined" || !path) return;
  setRecents((cur) => {
    const next = [path, ...cur.filter((item) => item !== path)].slice(0, 8);
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next));
    return next;
  });
}

function formatDate(value: number) {
  if (!value) return "unknown";
  return new Date(value * 1000).toLocaleString();
}
