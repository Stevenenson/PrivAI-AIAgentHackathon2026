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

export interface BusinessEmailInsight {
  id: string;
  kind:
    | "meeting_request"
    | "follow_up"
    | "deadline"
    | "invoice"
    | "task"
    | "client_question"
    | string;
  title: string;
  summary: string;
  suggestedAction: string;
  confidence: number;
  messageId?: string | null;
  threadId?: string | null;
  subject: string;
  from: string;
  fromName?: string;
  fromEmail?: string;
  date?: string;
  attendees?: string[];
  durationMinutes?: number | null;
  proposedTitle?: string;
  proposedDescription?: string;
}

export interface BusinessEmailScanResult {
  query: string;
  days: number;
  scanned: number;
  insights: BusinessEmailInsight[];
  generatedAt: number;
}

export interface CalendarSlot {
  start: string;
  end: string;
}

export interface CalendarEventAttendee {
  email: string;
  displayName: string;
  responseStatus: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  htmlLink: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: CalendarEventAttendee[];
  organizer: string;
  hangoutLink: string;
}

export interface AgentToolEvent {
  id: string;
  name: string;
  status:
    | "pending_approval"
    | "pending_question"
    | "running"
    | "completed"
    | "failed"
    | "rejected";
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
  risk?: "read" | "write" | "danger" | "safe-write";
  readOnly?: boolean;
  explanation?: string;
  plan?: AgentPlan;
  questionId?: string;
  question?: string;
  options?: string[];
}

export type AgentPlanStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface AgentPlanStep {
  title: string;
  status: AgentPlanStatus;
}

export interface AgentPlan {
  steps: AgentPlanStep[];
  note?: string;
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

export interface LearningGuidePayload {
  overview: string;
  sections: Array<{ title: string; summary: string; sourceHint?: string }>;
  keyTerms: Array<{ term: string; definition: string }>;
  misconceptions: string[];
  likelyExamQuestions: string[];
  teachBackPrompts: string[];
}

export interface LearningArtifact {
  id: string;
  kind: "guide" | string;
  title: string;
  payload: LearningGuidePayload | Record<string, unknown>;
  sourceMaterialIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LearningStudyItem {
  id: string;
  sourceMaterialId?: string | null;
  sourceTitle: string;
  sourceHint: string;
  sourceExcerpt: string;
  type: "qa" | "cloze" | "multiple_choice" | "free_response";
  topic: string;
  prompt: string;
  answer: string;
  options: string[];
  status: "active" | "suspended";
  dueAt: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  createdAt: number;
  updatedAt: number;
}

export interface LearningReviewEvent {
  id: string;
  studyItemId: string;
  rating: "again" | "hard" | "good" | "easy";
  previousDueAt?: number | null;
  nextDueAt: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  createdAt: number;
}

export interface LearningTopicMastery {
  topic: string;
  state: "not_started" | "learning" | "familiar" | "proficient" | "mastered";
  score: number;
  dueCount: number;
  reviewedCount: number;
  correctRate: number;
  updatedAt: number;
}

export interface LearningExamPlan {
  id: string;
  examDate?: string | null;
  dailyTarget: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface LearningDashboard {
  materialsTotal: number;
  materialsStudied: number;
  studyItemsTotal: number;
  dueCount: number;
  newCount: number;
  suspendedCount: number;
  reviewedToday: number;
  reviewedThisWeek: number;
  streakDays: number;
  nextAction: string;
  weakTopics: LearningTopicMastery[];
  mastery: LearningTopicMastery[];
  latestGuide?: LearningArtifact | null;
  examPlan?: LearningExamPlan | null;
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
  risk?: "read" | "write" | "danger" | "safe-write";
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
