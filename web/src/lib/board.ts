"use client";
import { auth } from "./firebase";
import type {
  Artifact,
  AttachmentMeta,
  ChatMessage,
  ChatMode,
  ChatSession,
  SearchSource,
} from "./types";

const DEFAULT_BOARD_URL =
  process.env.NEXT_PUBLIC_DEFAULT_BOARD_URL ?? "http://127.0.0.1:8080";

const LS_BOARD_URL = "localai.boardUrl";

interface PrivaiDesktopBridge {
  apiUrl?: string;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function desktopBoardUrl(): string | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { privaiDesktop?: PrivaiDesktopBridge };
  const url = w.privaiDesktop?.apiUrl?.trim();
  return url ? normalizeUrl(url) : null;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export function getBoardUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BOARD_URL;
  const desktopUrl = desktopBoardUrl();
  const stored = localStorage.getItem(LS_BOARD_URL);
  if (desktopUrl && (!stored || isLoopbackUrl(stored))) return desktopUrl;
  return normalizeUrl(stored || DEFAULT_BOARD_URL);
}

export function setBoardUrl(url: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_BOARD_URL, normalizeUrl(url));
}

async function idToken(): Promise<string> {
  const u = auth.currentUser;
  if (!u) throw new Error("not signed in");
  return u.getIdToken();
}

interface FetchOpts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}

async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.auth !== false) {
    headers.authorization = `Bearer ${await idToken()}`;
  }
  const res = await fetch(`${getBoardUrl()}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail =
      (data as { detail?: string }).detail ?? `HTTP ${res.status}`;
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// ---- public surface

export const board = {
  health: () =>
    api<{
      llm: boolean;
      provider: string;
      ollama: boolean;
      searxng: boolean;
      model: string;
      default: string;
      paired: boolean;
      version: string;
      numCtx: number;
      numPredict: number;
      searchTopK: number;
      visionModel: string;
      terminalEnabled: boolean;
      workspaceRoot: string;
      agentMaxToolSteps: number;
    }>("/health", { auth: false }),

  pairStatus: () =>
    api<{ paired: boolean; owner: string | null }>("/pair/status", {
      auth: false,
    }),

  pair: (code: string) =>
    api<{ paired: boolean; owner: string }>("/pair", {
      method: "POST",
      body: { code },
    }),

  listSessions: () =>
    api<{ sessions: ChatSession[] }>("/sessions").then((r) => r.sessions),

  createSession: (title?: string) =>
    api<ChatSession>("/sessions", { method: "POST", body: { title } }),

  renameSession: (sid: string, title: string) =>
    api<{ ok: boolean }>(`/sessions/${sid}`, {
      method: "PATCH",
      body: { title },
    }),

  deleteSession: (sid: string) =>
    api<{ ok: boolean }>(`/sessions/${sid}`, { method: "DELETE" }),

  listMessages: (sid: string) =>
    api<{ messages: ChatMessage[] }>(`/sessions/${sid}/messages`).then(
      (r) => r.messages,
    ),

  sessionStats: (sid: string) =>
    api<{ messages: number; chars: number; numCtx: number }>(
      `/sessions/${sid}/stats`,
    ),

  clearSession: (sid: string) =>
    api<{ deleted: number }>(`/sessions/${sid}/clear`, { method: "POST" }),

  compactSession: (sid: string) =>
    api<{ compacted: boolean; summary: ChatMessage }>(
      `/sessions/${sid}/compact`,
      { method: "POST" },
    ),

  chat: (
    message: string,
    sessionId: string | null,
    opts: {
      forceSearch?: boolean;
      mode?: ChatMode;
      attachmentIds?: string[];
      searchTopK?: number;
    } = {},
  ) =>
    api<{
      sessionId: string;
      user: ChatMessage;
      assistant: ChatMessage;
    }>("/chat", {
      method: "POST",
      body: {
        message,
        sessionId,
        forceSearch: opts.forceSearch ?? null,
        mode: opts.mode ?? "chat",
        attachmentIds: opts.attachmentIds ?? null,
        searchTopK: opts.searchTopK ?? null,
      },
    }),

  uploadAttachment: async (file: File, sessionId?: string) => {
    const u = auth.currentUser;
    if (!u) throw new Error("not signed in");
    const tok = await u.getIdToken();
    const fd = new FormData();
    fd.append("file", file);
    if (sessionId) fd.append("sessionId", sessionId);
    const res = await fetch(`${getBoardUrl()}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}` },
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(
        (j as { detail?: string }).detail ?? `HTTP ${res.status}`,
      );
    }
    return (await res.json()) as AttachmentMeta;
  },

  deleteAttachment: (aid: string) =>
    api<{ ok: boolean }>(`/attachments/${aid}`, { method: "DELETE" }),

  attachmentRawUrl: (aid: string) => `${getBoardUrl()}/attachments/${aid}/raw`,

  downloadAttachment: async (aid: string, name: string) => {
    const tok = await idToken();
    const res = await fetch(`${getBoardUrl()}/attachments/${aid}/raw`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  llmStatus: () =>
    api<{
      provider: string;
      loaded: boolean;
      model: string;
      default: string;
      running: Array<{ name: string; size?: string }>;
    }>("/admin/llm/status"),

  llmModels: () =>
    api<{
      provider: string;
      active: string;
      installed: Array<{ name: string; size: string; modified?: string }>;
    }>("/admin/llm/models"),

  setModel: (model: string) =>
    api<{ ok: boolean; model: string }>("/admin/llm/model", {
      method: "POST",
      body: { model },
    }),

  llmStart: () =>
    api<{ ok: boolean; model: string }>("/admin/llm/start", { method: "POST" }),

  llmStop: () =>
    api<{ ok: boolean; model: string }>("/admin/llm/stop", { method: "POST" }),
};

// ---- streaming chat (SSE)

export interface StreamHandlers {
  onMeta?: (m: {
    sessionId: string;
    user: ChatMessage;
    usedSearch: boolean;
    sources: SearchSource[];
    redactions: string[];
    mode?: ChatMode;
  }) => void;
  onDelta?: (delta: string) => void;
  onDone?: (assistant: ChatMessage, artifact: Artifact | null) => void;
  onError?: (err: string) => void;
}

export interface StreamOpts {
  forceSearch?: boolean;
  mode?: ChatMode;
  attachmentIds?: string[];
  searchTopK?: number;
}

export async function streamChat(
  message: string,
  sessionId: string | null,
  opts: StreamOpts,
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  const token = await idToken();
  const res = await fetch(`${getBoardUrl()}/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      message,
      sessionId,
      forceSearch: opts.forceSearch ?? null,
      mode: opts.mode ?? "chat",
      attachmentIds: opts.attachmentIds ?? null,
      searchTopK: opts.searchTopK ?? null,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    handlers.onError?.(`HTTP ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.type === "meta") handlers.onMeta?.(obj);
        else if (obj.type === "delta") handlers.onDelta?.(obj.delta);
        else if (obj.type === "done")
          handlers.onDone?.(obj.assistant, obj.artifact ?? null);
        else if (obj.type === "error") handlers.onError?.(obj.error);
      } catch {
        /* ignore */
      }
    }
  }
}
