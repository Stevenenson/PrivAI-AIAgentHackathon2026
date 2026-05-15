import type { Timestamp } from "firebase/firestore";

export type Role = "user" | "assistant" | "system";
export type ChatMode = "chat" | "agent" | "convert";
export type ChatSpace = "general" | "business" | "coding" | "learning";
export type PrivacyMode = "hybrid" | "local" | "cloud";

export interface Artifact {
  type: string;
  title: string;
  html: string | null;
  raw: string;
  repaired?: boolean;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  hasText: boolean;
  createdAt?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  sources?: SearchSource[];
  redactions?: string[];
  usedSearch?: boolean;
  artifact?: Artifact | null;
  attachments?: AttachmentMeta[];
}

export interface ChatSession {
  id: string;
  title: string;
  space?: ChatSpace;
  createdAt: number;
  updatedAt: number;
}

export interface SearchSource {
  title: string;
  url: string;
  content?: string;
}

export interface GoogleWorkspaceStatus {
  configured: boolean;
  connected: boolean;
  scopes: string[];
  email?: string | null;
  expiresAt?: number | null;
  redirectUri?: string;
}

export interface BusinessAction {
  id: string;
  kind: "calendar_event" | "email_draft" | string;
  status: "pending" | "completed" | "rejected" | "failed" | string;
  title: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface BusinessEmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to?: string;
  cc?: string;
  date?: string;
  snippet: string;
  text?: string;
}

export interface CalendarSlot {
  start: string;
  end: string;
}

export interface AgentToolEvent {
  id: string;
  name: string;
  status: "pending_approval" | "running" | "completed" | "failed" | "rejected";
  step: number;
  maxSteps: number;
  command: string;
  cwd: string;
  approvalId?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationS?: number;
  timedOut?: boolean;
  changedFiles?: string[];
  risk?: "read" | "write" | "danger";
  readOnly?: boolean;
  explanation?: string;
}

export interface PreviewInfo {
  running?: boolean;
  cwd?: string;
  path?: string;
  url?: string;
  command?: string;
  ready?: boolean;
}

export interface BusinessSettings {
  privacyMode: PrivacyMode;
  gmailEnabled: boolean;
  calendarEnabled: boolean;
  emailProvider: string;
  calendarProvider: string;
  requireApprovalForEmailSend: boolean;
  requireApprovalForCalendarWrites: boolean;
}

export interface LearningMaterial {
  id: string;
  attachmentId?: string | null;
  title: string;
  kind: "file" | "text";
  mime: string;
  size: number;
  status: "studied" | "needs review" | "failed";
  summary: string;
  hasText: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LearningPracticeQuestion {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  sourceHint?: string;
}

export interface LearningPracticeSet {
  title: string;
  kind: "quiz" | "test";
  questions: LearningPracticeQuestion[];
  createdAt: number;
}

export interface WorkspaceItem {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number | null;
  modified?: number;
  language?: string | null;
}

export interface WorkspaceTree {
  root: string;
  path: string;
  parent: string | null;
  items: WorkspaceItem[];
}

export interface WorkspaceFile {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
  modified: number;
}

export interface WorkspaceTerminalResult {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_s: number;
  changed_files: string[];
  timed_out: boolean;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
  risk?: "read" | "write" | "danger";
  readOnly?: boolean;
  explanation?: string;
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  text: string;
  language?: string | null;
}

export interface WorkspaceCheckpoint {
  id: string;
  title: string;
  createdAt: number;
  root: string;
  fileCount: number;
  skipped: number;
}

export interface DeviceStatus {
  online: boolean;
  boardUrl: string;
  llmLoaded?: boolean;
  llm?: boolean;
  provider?: string;
  model: string;
  ramMb?: number | null;
  agentVersion?: string;
  version?: string | null;
  searxng?: boolean;
  lastSeen: Timestamp | Date | null;
}
