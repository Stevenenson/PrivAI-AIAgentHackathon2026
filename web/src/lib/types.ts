import type { Timestamp } from "firebase/firestore";

export type Role = "user" | "assistant" | "system";
export type ChatMode = "chat" | "agent" | "convert";

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
  createdAt: number;
  updatedAt: number;
}

export interface SearchSource {
  title: string;
  url: string;
  content?: string;
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
  ollama?: boolean;
  searxng?: boolean;
  lastSeen: Timestamp | Date | null;
}
