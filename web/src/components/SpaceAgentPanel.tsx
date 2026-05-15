"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import { ChatStream } from "@/components/ChatStream";
import { Composer } from "@/components/Composer";
import { board, streamChat } from "@/lib/board";
import { cn } from "@/lib/cn";
import { experienceForRequest, useExperience } from "@/lib/experience";
import type {
  AgentToolEvent,
  AttachmentMeta,
  ChatMessage,
  ChatMode,
  ChatSpace,
  SearchSource,
} from "@/lib/types";

interface Props {
  title: string;
  subtitle?: string;
  seedTitle?: string;
  placeholder?: string;
  emptyTitle?: string;
  emptyBody?: React.ReactNode;
  defaultForceSearch?: boolean;
  sessionId?: string | null;
  space?: ChatSpace;
  onSessionCreated?: (sessionId: string) => void;
  onSources?: (sources: SearchSource[]) => void;
  onAgentActivity?: (payload: {
    events: AgentToolEvent[];
    changedFiles: string[];
    hitLimit: boolean;
  }) => void;
  commandApprovalRequired?: boolean;
  autoApproveReadOnlyCommands?: boolean;
  composerDefaultMode?: ChatMode;
  queuedPrompt?: {
    id: string;
    prompt: string;
    mode?: ChatMode;
    forceSearch?: boolean;
  } | null;
  onQueuedPromptConsumed?: (id: string) => void;
  className?: string;
}

export function SpaceAgentPanel({
  title,
  subtitle,
  seedTitle,
  placeholder,
  emptyTitle,
  emptyBody,
  defaultForceSearch = false,
  sessionId,
  space = "general",
  onSessionCreated,
  onSources,
  onAgentActivity,
  commandApprovalRequired,
  autoApproveReadOnlyCommands,
  composerDefaultMode = "agent",
  queuedPrompt,
  onQueuedPromptConsumed,
  className,
}: Props) {
  const { prefs, savePrefs } = useExperience();
  const [sid, setSid] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [agentMaxToolSteps, setAgentMaxToolSteps] = useState(20);
  const [models, setModels] = useState<Array<{ name: string; size: string }>>([]);
  const [activeModel, setActiveModel] = useState("");
  const [modelBusy, setModelBusy] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentToolEvent[]>([]);
  const [agentHitLimit, setAgentHitLimit] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const consumedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    board.health()
      .then((h) => {
        setWorkspaceRoot(h.workspaceRoot || "");
        setAgentMaxToolSteps(h.agentMaxToolSteps || 20);
      })
      .catch(() => {
        /* the main status pill surfaces backend health */
      });
  }, []);

  useEffect(() => {
    board.llmModels()
      .then((r) => {
        setModels(r.installed);
        setActiveModel(r.active);
      })
      .catch(() => {
        /* settings page surfaces model configuration issues */
      });
  }, []);

  async function changeModel(model: string) {
    if (!model || model === activeModel) return;
    setModelBusy(true);
    try {
      await board.setModel(model);
      setActiveModel(model);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setModelBusy(false);
    }
  }

  useEffect(() => {
    abortRef.current?.abort();
    let cancel = false;
    const timer = window.setTimeout(() => {
      setPending(null);
      setStreaming(false);
      setAgentEvents([]);
      setAgentHitLimit(false);

      if (!sessionId) {
        setSid(null);
        setMessages([]);
        setErr(null);
        return;
      }

      setSid(sessionId);
      setMessages([]);
      setErr(null);
      board
        .listMessages(sessionId)
        .then((items) => {
          if (!cancel) setMessages(uniqueMessages(items));
        })
        .catch((e) => {
          if (!cancel) setErr((e as Error).message);
        });
    }, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [sessionId]);

  const send = useCallback(
    async (
      text: string,
      opts: {
        forceSearch: boolean;
        mode: ChatMode;
        attachmentIds: string[];
        attachments: AttachmentMeta[];
      },
    ) => {
      let nextSid = sid;
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
        if (!nextSid) {
          const session = await board.createSession(
            seedTitle || `${title}: ${text.slice(0, 64)}`,
            space,
          );
          nextSid = session.id;
          setSid(session.id);
          onSessionCreated?.(session.id);
        }

        await streamChat(
          text,
          nextSid,
          {
            forceSearch: opts.forceSearch,
            mode: opts.mode,
            attachmentIds: opts.attachmentIds,
            experience: experienceForRequest(prefs),
            commandApprovalRequired:
              commandApprovalRequired ?? prefs.askBeforeCommands,
            autoApproveReadOnlyCommands:
              autoApproveReadOnlyCommands ?? prefs.autoApproveReadOnlyCommands,
            space,
          },
          {
            onMeta: (m) => {
              serverUserMsg = m.user;
              if (m.sources?.length) onSources?.(m.sources);
              setMessages((cur) =>
                uniqueMessages(
                  cur.map((msg) => (msg.id === userMsg.id ? m.user : msg)),
                ),
              );
            },
            onDelta: (delta) => {
              if (
                space === "coding" &&
                delta.trim() === "_working in the terminal..._"
              ) {
                return;
              }
              buffer += delta;
              setPending((cur) => (cur ? { ...cur, content: buffer } : cur));
            },
            onTool: (event) => {
              setAgentEvents((cur) => upsertToolEvent(cur, event));
            },
            onDone: (assistant) => {
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
                return uniqueMessages(
                  serverUserMsg
                    ? [...filtered, serverUserMsg, assistant]
                    : [...filtered, userMsg, assistant],
                );
              });
            },
            onError: (message) => {
              setPending(null);
              setErr(message);
            },
          },
          controller.signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setErr((e as Error).message);
        }
        setPending(null);
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [
      autoApproveReadOnlyCommands,
      commandApprovalRequired,
      onSessionCreated,
      onSources,
      prefs,
      seedTitle,
      sid,
      space,
      title,
    ],
  );

  const changedFiles = useMemo(
    () => uniqueStrings(agentEvents.flatMap((event) => event.changedFiles ?? [])),
    [agentEvents],
  );

  useEffect(() => {
    onAgentActivity?.({
      events: agentEvents,
      changedFiles,
      hitLimit: agentHitLimit,
    });
  }, [agentEvents, agentHitLimit, changedFiles, onAgentActivity]);

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

  useEffect(() => {
    if (!queuedPrompt || streaming) return;
    if (consumedPromptRef.current === queuedPrompt.id) return;
    consumedPromptRef.current = queuedPrompt.id;
    onQueuedPromptConsumed?.(queuedPrompt.id);
    void send(queuedPrompt.prompt, {
      forceSearch: queuedPrompt.forceSearch ?? false,
      mode: queuedPrompt.mode ?? composerDefaultMode,
      attachmentIds: [],
      attachments: [],
    });
  }, [
    composerDefaultMode,
    onQueuedPromptConsumed,
    queuedPrompt,
    send,
    streaming,
  ]);

  return (
    <section
      className={cn(
        "h-full min-h-0 overflow-hidden border-l border-line bg-surface flex flex-col",
        className,
      )}
    >
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            {subtitle ? (
              <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div>
            ) : null}
          </div>
          {models.length ? (
            <select
              value={activeModel}
              disabled={modelBusy}
              onChange={(e) => void changeModel(e.target.value)}
              className="h-8 max-w-[190px] rounded-[8px] border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
              title="Change Gemini model for chat"
            >
              {models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {err ? (
        <div className="shrink-0 px-3 pt-3">
          <div className="tone-bad rounded-[8px] border px-3 py-2 text-xs">
            {err}
          </div>
        </div>
      ) : null}

      {space !== "coding" && (agentEvents.length || changedFiles.length || agentHitLimit) ? (
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
            askBeforeCommands={commandApprovalRequired ?? prefs.askBeforeCommands}
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
      ) : null}

      <ChatStream
        messages={messages}
        pending={pending}
        emptyTitle={emptyTitle ?? "Agent ready"}
        emptyBody={emptyBody ?? "Ask Privai to plan, research, write files, run checks, or explain the next step."}
        agentEvents={space === "coding" ? agentEvents : undefined}
        changedFiles={space === "coding" ? changedFiles : undefined}
        agentHitLimit={space === "coding" ? agentHitLimit : undefined}
        onContinueAgent={continueAgent}
        onApproveCommand={(approvalId) =>
          void decideCommandApproval(approvalId, true)
        }
        onRejectCommand={(approvalId) =>
          void decideCommandApproval(approvalId, false)
        }
        showAgentActivityInline={space === "coding"}
        compact
      />

      <div className="shrink-0">
        <Composer
          key={`${composerDefaultMode}-${defaultForceSearch}`}
          onSend={send}
          disabled={streaming}
          generating={streaming}
          onStop={() => abortRef.current?.abort()}
          placeholder={placeholder}
          workspaceRoot={workspaceRoot}
          agentMaxToolSteps={agentMaxToolSteps}
          askBeforeCommands={commandApprovalRequired ?? prefs.askBeforeCommands}
          defaultMode={composerDefaultMode}
          defaultForceSearch={defaultForceSearch}
          compact
        />
      </div>
    </section>
  );
}

function upsertToolEvent(items: AgentToolEvent[], event: AgentToolEvent) {
  const index = items.findIndex((item) => item.id === event.id);
  if (index === -1) return [...items, event];
  const next = items.slice();
  next[index] = { ...next[index], ...event };
  return next;
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

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}
