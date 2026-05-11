"use client";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtifactPanel } from "@/components/ArtifactPanel";
import { BoardStatusPill } from "@/components/BoardStatus";
import { ChatStream } from "@/components/ChatStream";
import { Composer, type SlashCommand } from "@/components/Composer";
import { useAuth } from "@/lib/auth";
import { board, streamChat } from "@/lib/board";
import type { Artifact, AttachmentMeta, ChatMessage, ChatMode } from "@/lib/types";

const DEFAULT_NUM_CTX = 4096;
const CHARS_PER_TOKEN = 4;

export default function SessionPage() {
  const { user } = useAuth();
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
  const [agentMaxToolSteps, setAgentMaxToolSteps] = useState(20);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
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
            },
            onDelta: (delta) => {
              buffer += delta;
              setPending((cur) => (cur ? { ...cur, content: buffer } : cur));
            },
            onDone: (assistant, artifact) => {
              setPending(null);
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
    [user, sid, refreshTitle],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
    setStreaming(false);
  }, []);

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

  return (
    <div
      className={
        activeArtifact
          ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] flex-1 min-h-0"
          : "flex flex-col flex-1 min-h-0"
      }
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-4 md:px-6 py-3 border-b border-line flex items-center justify-between bg-bg sticky top-0 z-10">
          <div className="font-serif text-lg tracking-tight truncate pr-4">
            {heading}
          </div>
          {user ? <BoardStatusPill uid={user.uid} /> : null}
        </div>

        {err ? (
          <div className="px-4 md:px-6 pt-3">
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
        />
      </div>

      {activeArtifact ? (
        <ArtifactPanel
          artifact={activeArtifact}
          onClose={() => setActiveArtifact(null)}
        />
      ) : null}
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
