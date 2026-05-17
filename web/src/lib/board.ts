"use client";
import { auth } from "./firebase";
import type {
  Artifact,
  AttachmentMeta,
  ChatMessage,
  ChatMode,
  ChatSpace,
  ChatSession,
  AgentToolEvent,
  BusinessAction,
  BusinessEmailMessage,
  BusinessEmailScanResult,
  BusinessSettings,
  CalendarEvent,
  CalendarSlot,
  GoogleWorkspaceStatus,
  LearningArtifact,
  LearningDashboard,
  LearningExamPlan,
  LearningMaterial,
  LearningPracticeSet,
  LearningReviewEvent,
  LearningStudyItem,
  PreviewInfo,
  PrivacyMode,
  SearchSource,
  WorkspaceFile,
  WorkspaceCheckpoint,
  WorkspaceSearchMatch,
  WorkspaceTerminalResult,
  WorkspaceTree,
} from "./types";

interface ExperienceRequest {
  persona?: string;
  primaryGoal?: string;
  detailLevel?: string;
  businessContext?: string;
  privacyMode?: string;
  autoApproveReadOnlyCommands?: boolean;
}

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
      searxng: boolean;
      searchFallback: boolean;
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
      commandApprovalRequired: boolean;
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

  createSession: (title?: string, space?: ChatSpace) =>
    api<ChatSession>("/sessions", { method: "POST", body: { title, space } }),

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
      experience?: ExperienceRequest;
      commandApprovalRequired?: boolean;
      autoApproveReadOnlyCommands?: boolean;
      privacyMode?: PrivacyMode;
      space?: ChatSpace;
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
        experience: opts.experience ?? null,
        commandApprovalRequired: opts.commandApprovalRequired ?? null,
        autoApproveReadOnlyCommands: opts.autoApproveReadOnlyCommands ?? null,
        privacyMode: opts.privacyMode ?? opts.experience?.privacyMode ?? null,
        space: opts.space ?? null,
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

  startPreview: (cwd: string) =>
    api<PreviewInfo>("/agent/preview", {
      method: "POST",
      body: { cwd },
    }),

  stopPreview: () =>
    api<{ ok: boolean }>("/agent/preview/stop", { method: "POST" }),

  previewStatus: () => api<PreviewInfo>("/agent/preview"),

  businessSettings: () => api<BusinessSettings>("/business/settings"),

  saveBusinessSettings: (patch: Partial<BusinessSettings>) =>
    api<BusinessSettings>("/business/settings", {
      method: "POST",
      body: patch,
    }),

  searchWeb: (q: string, topK = 10) =>
    api<{ results: SearchSource[] }>("/search", {
      method: "POST",
      body: { q, top_k: topK },
    }).then((r) => r.results),

  googleStatus: () => api<GoogleWorkspaceStatus>("/google/status"),

  googleAuthUrl: () => api<{ url: string }>("/google/auth-url"),

  googleDisconnect: () =>
    api<GoogleWorkspaceStatus>("/google/disconnect", { method: "POST" }),

  businessEmailSearch: (q: string, limit = 10) =>
    api<{ query: string; messages: BusinessEmailMessage[] }>(
      `/business/email/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  businessEmailThread: (threadId: string) =>
    api<{ threadId: string; messages: BusinessEmailMessage[] }>(
      `/business/email/thread/${encodeURIComponent(threadId)}`,
    ),

  businessEmailScan: (days = 14, maxResults = 50) =>
    api<BusinessEmailScanResult>("/business/email/scan", {
      method: "POST",
      body: { days, maxResults },
    }),

  businessCalendarEvents: (params: {
    timeMin?: string;
    timeMax?: string;
    calendarId?: string;
    maxResults?: number;
  } = {}) => {
    const search = new URLSearchParams();
    if (params.timeMin) search.set("timeMin", params.timeMin);
    if (params.timeMax) search.set("timeMax", params.timeMax);
    if (params.calendarId) search.set("calendarId", params.calendarId);
    if (params.maxResults) search.set("maxResults", String(params.maxResults));
    const qs = search.toString();
    return api<{
      calendarId: string;
      timeMin: string;
      timeMax: string;
      events: CalendarEvent[];
    }>(`/business/calendar/events${qs ? `?${qs}` : ""}`);
  },

  businessCalendarSlots: (payload: {
    timeMin: string;
    timeMax: string;
    durationMinutes?: number;
    calendarId?: string;
  }) =>
    api<{
      calendarId: string;
      timeMin: string;
      timeMax: string;
      durationMinutes: number;
      busy: Array<{ start: string; end: string }>;
      slots: CalendarSlot[];
    }>("/business/calendar/slots", {
      method: "POST",
      body: payload,
    }),

  draftBusinessCalendarEvent: (payload: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    timezone?: string;
    attendees?: string[];
    calendarId?: string;
  }) =>
    api<{ status: string; action: BusinessAction; message: string }>(
      "/business/calendar/events/draft",
      {
        method: "POST",
        body: payload,
      },
    ),

  businessActions: (status?: string) =>
    api<{ actions: BusinessAction[] }>(
      `/business/actions${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ).then((r) => r.actions),

  approveBusinessAction: (actionId: string) =>
    api<BusinessAction>(`/business/actions/${actionId}/approve`, {
      method: "POST",
    }),

  rejectBusinessAction: (actionId: string) =>
    api<BusinessAction>(`/business/actions/${actionId}/reject`, {
      method: "POST",
    }),

  learningMaterials: (sid: string) =>
    api<{ materials: LearningMaterial[]; studied: number; total: number }>(
      `/learning/${sid}/materials`,
    ),

  addLearningTextMaterial: (
    sid: string,
    payload: { title?: string; content: string },
  ) =>
    api<LearningMaterial>(`/learning/${sid}/materials/text`, {
      method: "POST",
      body: payload,
    }),

  addLearningAttachmentMaterial: (sid: string, attachmentId: string) =>
    api<LearningMaterial>(`/learning/${sid}/materials/attachment`, {
      method: "POST",
      body: { attachmentId },
    }),

  deleteLearningMaterial: (sid: string, mid: string) =>
    api<{ ok: boolean }>(`/learning/${sid}/materials/${mid}`, {
      method: "DELETE",
    }),

  generateLearningPractice: (
    sid: string,
    payload: { kind: "quiz" | "test"; count?: number },
  ) =>
    api<LearningPracticeSet>(`/learning/${sid}/practice`, {
      method: "POST",
      body: payload,
    }),

  learningDashboard: (sid: string) =>
    api<LearningDashboard>(`/learning/${sid}/dashboard`),

  generateLearningGuide: (sid: string, materialIds?: string[]) =>
    api<{ artifact: LearningArtifact; dashboard: LearningDashboard }>(
      `/learning/${sid}/guide`,
      {
        method: "POST",
        body: { materialIds: materialIds?.length ? materialIds : null },
      },
    ),

  learningStudyItems: (sid: string, includeSuspended = false) =>
    api<{ items: LearningStudyItem[] }>(
      `/learning/${sid}/study-items?includeSuspended=${includeSuspended ? "true" : "false"}`,
    ).then((r) => r.items),

  generateLearningStudyItems: (
    sid: string,
    payload: { materialIds?: string[]; count?: number } = {},
  ) =>
    api<{ items: LearningStudyItem[]; dashboard: LearningDashboard }>(
      `/learning/${sid}/study-items/generate`,
      {
        method: "POST",
        body: {
          materialIds: payload.materialIds?.length ? payload.materialIds : null,
          count: payload.count ?? 12,
        },
      },
    ),

  updateLearningStudyItem: (
    sid: string,
    itemId: string,
    patch: Partial<
      Pick<
        LearningStudyItem,
        | "type"
        | "topic"
        | "prompt"
        | "answer"
        | "options"
        | "sourceHint"
        | "sourceExcerpt"
        | "status"
      >
    >,
  ) =>
    api<LearningStudyItem>(
      `/learning/${sid}/study-items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: patch },
    ),

  deleteLearningStudyItem: (sid: string, itemId: string) =>
    api<{ ok: boolean }>(
      `/learning/${sid}/study-items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    ),

  learningReviewQueue: (sid: string, limit = 30) =>
    api<{ items: LearningStudyItem[] }>(
      `/learning/${sid}/review/queue?limit=${limit}`,
    ).then((r) => r.items),

  recordLearningReview: (
    sid: string,
    payload: {
      studyItemId: string;
      rating: "again" | "hard" | "good" | "easy";
    },
  ) =>
    api<{
      event: LearningReviewEvent;
      item: LearningStudyItem;
      dashboard: LearningDashboard;
    }>(`/learning/${sid}/review/events`, {
      method: "POST",
      body: payload,
    }),

  learningExamPlan: (sid: string) =>
    api<{ examPlan: LearningExamPlan | null }>(`/learning/${sid}/exam-plan`),

  saveLearningExamPlan: (
    sid: string,
    payload: { examDate?: string | null; dailyTarget?: number; title?: string },
  ) =>
    api<{ examPlan: LearningExamPlan; dashboard: LearningDashboard }>(
      `/learning/${sid}/exam-plan`,
      {
        method: "POST",
        body: {
          examDate: payload.examDate ?? null,
          dailyTarget: payload.dailyTarget ?? 20,
          title: payload.title ?? null,
        },
      },
    ),

  decideCommandApproval: (approvalId: string, approved: boolean) =>
    api<{ ok: boolean; approved: boolean }>(`/agent/approvals/${approvalId}`, {
      method: "POST",
      body: { approved },
    }),

  approveCommand: (approvalId: string) =>
    api<{ ok: boolean; approved: true }>(
      `/agent/approvals/${approvalId}/approve`,
      { method: "POST" },
    ),

  rejectCommand: (approvalId: string) =>
    api<{ ok: boolean; approved: false }>(
      `/agent/approvals/${approvalId}/reject`,
      { method: "POST" },
    ),

  answerAgentQuestion: (questionId: string, answer: string) =>
    api<{ ok: boolean }>(`/agent/questions/${questionId}`, {
      method: "POST",
      body: { answer },
    }),

  workspaceTree: (path = ".") =>
    api<WorkspaceTree>(`/workspace/tree?path=${encodeURIComponent(path)}`),

  workspaceFile: (path: string) =>
    api<WorkspaceFile>(`/workspace/file?path=${encodeURIComponent(path)}`),

  workspaceSearch: (q: string, limit = 50) =>
    api<{ query: string; matches: WorkspaceSearchMatch[] }>(
      `/workspace/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  workspaceCheckpoints: () =>
    api<{ checkpoints: WorkspaceCheckpoint[] }>("/workspace/checkpoints").then(
      (r) => r.checkpoints,
    ),

  createWorkspaceCheckpoint: (title?: string) =>
    api<WorkspaceCheckpoint>("/workspace/checkpoints", {
      method: "POST",
      body: { title: title ?? null },
    }),

  restoreWorkspaceCheckpoint: (checkpointId: string) =>
    api<{ ok: boolean; restored: number }>(
      `/workspace/checkpoints/${checkpointId}/restore`,
      { method: "POST" },
    ),

  saveWorkspaceFile: (path: string, content: string) =>
    api<{ ok: boolean; path: string; size: number; modified: number }>(
      "/workspace/file",
      {
        method: "POST",
        body: { path, content },
      },
    ),

  runWorkspaceCommand: (
    command: string,
    cwd = ".",
    timeoutS = 60,
  ) =>
    api<WorkspaceTerminalResult>("/workspace/terminal", {
      method: "POST",
      body: { command, cwd, timeoutS },
    }),
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
    provider?: string;
    routeReason?: string;
    routedSensitive?: boolean;
  }) => void;
  onDelta?: (delta: string) => void;
  onTool?: (event: AgentToolEvent) => void;
  onStatus?: (status: AgentStatusUpdate | null) => void;
  onDone?: (assistant: ChatMessage, artifact: Artifact | null) => void;
  onError?: (err: string) => void;
}

export interface AgentStatusUpdate {
  phase: "thinking" | "running" | "verifying" | "planning" | "idle";
  label?: string;
  detail?: string;
}

export interface StreamOpts {
  forceSearch?: boolean;
  mode?: ChatMode;
  attachmentIds?: string[];
  searchTopK?: number;
  experience?: ExperienceRequest;
  commandApprovalRequired?: boolean;
  autoApproveReadOnlyCommands?: boolean;
  privacyMode?: PrivacyMode;
  space?: ChatSpace;
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
      experience: opts.experience ?? null,
      commandApprovalRequired: opts.commandApprovalRequired ?? null,
      autoApproveReadOnlyCommands: opts.autoApproveReadOnlyCommands ?? null,
      privacyMode: opts.privacyMode ?? opts.experience?.privacyMode ?? null,
      space: opts.space ?? null,
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
        else if (obj.type === "tool") handlers.onTool?.(obj);
        else if (obj.type === "status")
          handlers.onStatus?.(
            obj.phase
              ? { phase: obj.phase, label: obj.label, detail: obj.detail }
              : null,
          );
        else if (obj.type === "done")
          handlers.onDone?.(obj.assistant, obj.artifact ?? null);
        else if (obj.type === "error") handlers.onError?.(obj.error);
      } catch {
        /* ignore */
      }
    }
  }
}
