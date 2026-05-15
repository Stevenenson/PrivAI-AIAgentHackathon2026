"use client";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import { ArtifactPanel } from "@/components/ArtifactPanel";
import { BoardStatusPill } from "@/components/BoardStatus";
import { ChatStream } from "@/components/ChatStream";
import { Composer, type SlashCommand } from "@/components/Composer";
import { WorkspaceBar } from "@/components/WorkspaceBar";
import { useAuth } from "@/lib/auth";
import { board, streamChat } from "@/lib/board";
import { experienceForRequest, useExperience } from "@/lib/experience";
import type {
  AgentToolEvent,
  Artifact,
  AttachmentMeta,
  ChatMessage,
  ChatMode,
} from "@/lib/types";

const DEFAULT_NUM_CTX = 4096;
const CHARS_PER_TOKEN = 4;

export default function SessionPage() {
  const { user } = useAuth();
  const { prefs, savePrefs } = useExperience();
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const sid = params?.sessionId ?? "";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [numCtx, setNumCtx] = useState<number>(DEFAULT_NUM_CTX);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [agentMaxToolSteps, setAgentMaxToolSteps] = useState(20);
  const [agentEvents, setAgentEvents] = useState<AgentToolEvent[]>([]);
  const [agentHitLimit, setAgentHitLimit] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    provider?: string;
    reason?: string;
    sensitive?: boolean;
  } | null>(null);
  const autoSentRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!sid) return;
    try {
      const [all, m, h] = await Promise.all([
        board.listSessions(),
        board.listMessages(sid),
        board.health(),
      ]);
      const me = all.find((x) => x.id === sid);
      setTitle(me?.title ?? "");
      setMessages(uniqueMessages(m));
      if (h.numCtx) setNumCtx(h.numCtx);
      setWorkspaceRoot(h.workspaceRoot || "");
      setTerminalEnabled(Boolean(h.terminalEnabled));
      if (h.agentMaxToolSteps) setAgentMaxToolSteps(h.agentMaxToolSteps);
      // Auto-show the most recent artifact when navigating into a session
      const latestArt = [...m]
        .reverse()
        .find((x) => x.artifact?.html)?.artifact;
      if (latestArt) setActiveArtifact(latestArt);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [sid]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [user, reload]);

  const refreshTitle = useCallback(async () => {
    try {
      const all = await board.listSessions();
      const me = all.find((x) => x.id === sid);
      if (me) setTitle(me.title);
    } catch {
      /* ignore */
    }
  }, [sid]);

  const send = useCallback(
    async (
      text: string,
      opts: {
        forceSearch: boolean;
        mode: ChatMode;
        attachmentIds: string[];
        attachments?: AttachmentMeta[];
      },
    ) => {
      if (!user || !sid) return;

      const userMsg: ChatMessage = {
        id: `tmp-${Date.now()}`,
        role: "user",
        content: text,
        attachments: opts.attachments ?? [],
        createdAt: Date.now() / 1000,
      };
      setMessages((cur) => [...cur, userMsg]);
      setPending({
        id: "pending",
        role: "assistant",
        content: "",
        createdAt: Date.now() / 1000,
      });
      setErr(null);
      if (opts.mode === "agent") {
        setAgentEvents([]);
        setAgentHitLimit(false);
      }
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let buffer = "";
      let serverUserMsg: ChatMessage | null = null;
      try {
        await streamChat(
          text,
          sid,
          {
            forceSearch: opts.forceSearch,
            mode: opts.mode,
            attachmentIds: opts.attachmentIds,
            experience: experienceForRequest(prefs),
            commandApprovalRequired: prefs.askBeforeCommands,
            autoApproveReadOnlyCommands: prefs.autoApproveReadOnlyCommands,
          },
          {
            onMeta: (m) => {
              serverUserMsg = m.user;
              setMessages((cur) =>
                uniqueMessages(
                  cur.map((msg) => (msg.id === userMsg.id ? m.user : msg)),
                ),
              );
              setPending((cur) =>
                cur
                  ? {
                      ...cur,
                      content: "",
                      sources: m.sources,
                      redactions: m.redactions,
                      usedSearch: m.usedSearch,
                    }
                  : cur,
              );
              setRouteInfo({
                provider: m.provider,
                reason: m.routeReason,
                sensitive: m.routedSensitive,
              });
            },
            onDelta: (delta) => {
              buffer += delta;
              setPending((cur) => (cur ? { ...cur, content: buffer } : cur));
            },
            onTool: (event) => {
              setAgentEvents((cur) => upsertToolEvent(cur, event));
            },
            onDone: (assistant, artifact) => {
              setPending(null);
              setAgentHitLimit(
                /maximum .*terminal tool steps|AGENT_MAX_TOOL_STEPS/i.test(
                  assistant.content || "",
                ),
              );
              setMessages((cur) => {
                const filtered = cur.filter(
                  (m) => m.id !== userMsg.id && m.id !== serverUserMsg?.id,
                );
                const next = serverUserMsg
                  ? [...filtered, serverUserMsg, assistant]
                  : [...filtered, userMsg, assistant];
                return uniqueMessages(next);
              });
              if (artifact?.html) setActiveArtifact(artifact);
            },
            onError: (msg) => {
              setPending(null);
              setErr(msg);
            },
          },
          controller.signal,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setPending(null);
          return;
        }
        setPending(null);
        setErr((e as Error).message);
      } finally {
        abortRef.current = null;
        setStreaming(false);
        void refreshTitle();
        setTimeout(() => void refreshTitle(), 4000);
      }
    },
    [user, sid, refreshTitle, prefs],
  );

  const continueAgent = useCallback(
    (message = "continue from where you stopped") => {
      void send(message, {
        forceSearch: false,
        mode: "agent",
        attachmentIds: [],
        attachments: [],
      });
    },
    [send],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
    setStreaming(false);
  }, []);

  const decideCommandApproval = useCallback(
    async (approvalId: string, approved: boolean) => {
      try {
        await board.decideCommandApproval(approvalId, approved);
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [],
  );

  const onSlash = useCallback(
    async (cmd: SlashCommand) => {
      if (!sid) return;
      setErr(null);
      try {
        if (cmd === "clear") {
          if (!confirm("Wipe every message in this conversation?")) return;
          await board.clearSession(sid);
          setMessages([]);
          setActiveArtifact(null);
        } else if (cmd === "compact") {
          if (
            !confirm(
              "Replace this conversation with a single recap message? Older messages will be deleted.",
            )
          )
            return;
          setStreaming(true);
          await board.compactSession(sid);
          await reload();
        }
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setStreaming(false);
      }
    },
    [sid, reload],
  );

  useEffect(() => {
    if (!user || !sid || autoSentRef.current) return;
    const prompt = search?.get("prompt");
    if (!prompt) return;
    if (messages.length > 0) return;
    autoSentRef.current = true;
    const attRaw = search?.get("att") ?? "";
    const timer = window.setTimeout(() => void send(prompt, {
      forceSearch: search?.get("web") === "1",
      mode:
        search?.get("convert") === "1"
          ? "convert"
          : search?.get("agent") === "1"
            ? "agent"
            : "chat",
      attachmentIds: attRaw ? attRaw.split(",").filter(Boolean) : [],
      attachments: [],
    }), 0);
    return () => window.clearTimeout(timer);
  }, [user, sid, search, messages.length, send]);

  const heading = useMemo(
    () => title || messages[0]?.content?.slice(0, 60) || "Conversation",
    [title, messages],
  );

  useEffect(() => {
    document.title = `${heading} · Privai`;
  }, [heading]);

  const usage = useMemo(() => {
    const visible = [...messages, ...(pending ? [pending] : [])];
    const chars = visible.reduce((s, m) => s + (m.content?.length ?? 0), 0);
    return { used: Math.ceil(chars / CHARS_PER_TOKEN), max: numCtx };
  }, [messages, pending, numCtx]);

  const changedFiles = useMemo(
    () => uniqueStrings(agentEvents.flatMap((event) => event.changedFiles ?? [])),
    [agentEvents],
  );
  const showWorkPanel =
    Boolean(activeArtifact) ||
    agentEvents.length > 0 ||
    changedFiles.length > 0 ||
    agentHitLimit;

  return (
    <div
      className={
        showWorkPanel
          ? "h-full min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]"
          : "h-full min-h-0 overflow-hidden flex flex-col"
      }
    >
      <div className="h-full min-h-0 overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 md:px-6 py-3 border-b border-line flex items-center justify-between bg-bg sticky top-0 z-10">
          <div className="font-serif text-lg tracking-tight truncate pr-4">
            {heading}
          </div>
          <div className="flex items-center gap-2">
            {routeInfo?.provider ? <PrivacyRoutePill route={routeInfo} /> : null}
            {user ? <BoardStatusPill uid={user.uid} /> : null}
          </div>
        </div>

        <WorkspaceBar
          workspaceRoot={workspaceRoot}
          terminalEnabled={terminalEnabled}
          maxToolSteps={agentMaxToolSteps}
          onWorkspaceChanged={setWorkspaceRoot}
        />

        {err ? (
          <div className="shrink-0 px-4 md:px-6 pt-3">
            <div className="mx-auto max-w-3xl text-bad text-sm tone-bad border rounded-[8px] px-3 py-2">
              {err}
            </div>
          </div>
        ) : null}

        <ChatStream
          messages={messages}
          pending={pending}
          onOpenArtifact={(a) => setActiveArtifact(a)}
        />
        <Composer
          onSend={send}
          onSlash={onSlash}
          disabled={streaming}
          generating={streaming}
          onStop={stopGeneration}
          usage={usage}
          sessionId={sid}
          workspaceRoot={workspaceRoot}
          agentMaxToolSteps={agentMaxToolSteps}
          askBeforeCommands={prefs.askBeforeCommands}
        />
      </div>

      {showWorkPanel ? (
        <aside className="h-full min-h-0 overflow-hidden border-l border-line bg-surface flex flex-col">
          <div className="shrink-0 max-h-[34dvh] overflow-y-auto border-b border-line p-3">
            <AgentActivityPanel
              events={agentEvents}
              changedFiles={changedFiles}
              hitLimit={agentHitLimit}
              onContinue={continueAgent}
              onApproveCommand={(approvalId) =>
                void decideCommandApproval(approvalId, true)
              }
              onRejectCommand={(approvalId) =>
                void decideCommandApproval(approvalId, false)
              }
              askBeforeCommands={prefs.askBeforeCommands}
              onSetAskBeforeCommands={(enabled) =>
                savePrefs({ askBeforeCommands: enabled })
              }
              autoApproveReadOnly={prefs.autoApproveReadOnlyCommands}
              onSetAutoApproveReadOnly={(enabled) =>
                savePrefs({ autoApproveReadOnlyCommands: enabled })
              }
              embedded
            />
          </div>
          {activeArtifact ? (
            <ArtifactPanel
              artifact={activeArtifact}
              onClose={() => setActiveArtifact(null)}
              embedded
            />
          ) : (
            <WorkPanelEmpty />
          )}
        </aside>
      ) : null}
    </div>
  );
}

function PrivacyRoutePill({
  route,
}: {
  route: { provider?: string; reason?: string; sensitive?: boolean };
}) {
  return (
    <span
      className="hidden rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted sm:inline-flex"
      title={route.reason || route.provider}
    >
      Gemini API{route.sensitive ? " · sensitive" : ""}
    </span>
  );
}

function WorkPanelEmpty() {
  return (
    <div className="border-t border-line px-4 py-6 text-sm text-muted">
      Results, previews, and changed files appear here while Privai works.
    </div>
  );
}

function uniqueMessages(items: ChatMessage[]) {
  const order: string[] = [];
  const byId = new Map<string, ChatMessage>();
  for (const item of items) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id)!);
}

function upsertToolEvent(items: AgentToolEvent[], event: AgentToolEvent) {
  const index = items.findIndex((item) => item.id === event.id);
  if (index === -1) return [...items, event];
  const next = items.slice();
  next[index] = { ...next[index], ...event };
  return next;
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}
