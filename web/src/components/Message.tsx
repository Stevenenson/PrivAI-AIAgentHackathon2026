"use client";
import {
  Check,
  Copy,
  FileText,
  Globe2,
  Image as ImageIcon,
  Paperclip,
  Play,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { Artifact, AttachmentMeta, ChatMessage, SearchSource } from "@/lib/types";

interface BubbleProps {
  msg: ChatMessage;
  streaming?: boolean;
  onOpenArtifact?: (a: Artifact) => void;
}

export function MessageBubble({ msg, streaming, onOpenArtifact }: BubbleProps) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const displayContent =
    msg.content ||
    (!isUser && !streaming
      ? "The model returned no final answer. Please retry this message."
      : "");
  return (
    <div
      className={cn(
        "msg-enter w-full flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("group", isUser ? "max-w-[78%]" : "max-w-[88%] md:max-w-[760px]")}>
        {!isUser ? (
          <div className="flex items-center gap-2 mb-1.5 text-xs text-muted">
            <span className="h-5 w-5 rounded-md bg-accent text-white grid place-items-center">
              <Sparkles className="h-3 w-3" />
            </span>
            assistant
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-[14px] px-4 py-3 text-[15px] leading-7 break-words prose",
            isUser
              ? "bg-accent text-white rounded-br-[6px] whitespace-pre-wrap"
              : "bg-surface border border-line text-ink rounded-bl-[6px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
          )}
        >
          {isUser ? (
            <span className={streaming ? "caret" : ""}>{displayContent}</span>
          ) : (
            <MarkdownText text={displayContent} streaming={streaming} />
          )}
        </div>

        {!isUser && displayContent ? (
          <div className="mt-1.5 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => void copyText(displayContent, setCopied)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:text-ink hover:bg-surface-2"
              title="Copy response"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "copied" : "copy"}
            </button>
          </div>
        ) : null}

        {(msg.usedSearch || (msg.redactions && msg.redactions.length)) && !isUser ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {msg.usedSearch ? <Tag tone="good" icon={<Globe2 className="h-3 w-3" />}>web</Tag> : null}
            {msg.redactions?.map((r) => (
              <Tag key={r} tone="warn" icon={<ShieldAlert className="h-3 w-3" />}>
                redacted: {r}
              </Tag>
            ))}
          </div>
        ) : null}

        {msg.attachments && msg.attachments.length ? (
          <Attachments items={msg.attachments} onUser={isUser} />
        ) : null}

        {!isUser && msg.artifact ? (
          <ArtifactCard artifact={msg.artifact} onOpen={onOpenArtifact} />
        ) : null}

        {msg.sources && msg.sources.length ? <Sources sources={msg.sources} /> : null}
      </div>
    </div>
  );
}

function MarkdownText({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="markdown-body">
      {renderBlocks(text)}
      {streaming ? <span className="caret" aria-hidden="true" /> : null}
    </div>
  );
}

function renderBlocks(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    const body = paragraph.join(" ").trim();
    if (body) {
      const titled = titledParagraph(body);
      if (titled) {
        blocks.push(
          <section key={`section-${blocks.length}`} className="answer-section">
            <div className="answer-section-title">
              {renderInline(titled.title, `section-title-${blocks.length}`)}
            </div>
            <p>{renderInline(titled.body, `section-body-${blocks.length}`)}</p>
          </section>,
        );
      } else {
        blocks.push(
          <p key={`p-${blocks.length}`}>
            {renderInline(body, `p-${blocks.length}`)}
          </p>,
        );
      }
    }
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const Tag = heading[1].length <= 2 ? "h3" : "h4";
      blocks.push(
        <Tag key={`h-${blocks.length}`}>
          {renderInline(heading[2], `h-${blocks.length}`)}
        </Tag>,
      );
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    if (unordered) {
      flushParagraph();
      const items: string[] = [unordered[1]];
      while (i + 1 < lines.length) {
        const next = /^\s*[-*]\s+(.+)$/.exec(lines[i + 1]);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `ul-${blocks.length}-${index}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      const items: string[] = [ordered[1]];
      while (i + 1 < lines.length) {
        const next = /^\s*\d+[.)]\s+(.+)$/.exec(lines[i + 1]);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `ol-${blocks.length}-${index}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks.length ? blocks : null;
}

function titledParagraph(text: string): { title: string; body: string } | null {
  const markdown = /^\*\*([^*]{3,80})\*\*:?\s+(.+)$/.exec(text);
  if (markdown) return { title: markdown[1], body: markdown[2] };

  const plain = /^([A-Z][A-Za-z0-9 &/()'-]{3,58}):\s+(.+)$/.exec(text);
  if (!plain) return null;
  const title = plain[1].trim();
  if (title.split(/\s+/).length > 8) return null;
  return { title, body: plain[2] };
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let textKey = 0;

  function pushText(value: string) {
    if (!value) return;
    const urlRe = /(https?:\/\/[^\s)]+|www\.[^\s)]+)/gi;
    let last = 0;
    for (const match of value.matchAll(urlRe)) {
      const index = match.index ?? 0;
      if (index > last) nodes.push(value.slice(last, index));
      const raw = match[0];
      nodes.push(
        <a
          key={`${keyPrefix}-url-${textKey++}`}
          href={safeHref(raw)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {raw}
        </a>,
      );
      last = index + raw.length;
    }
    if (last < value.length) nodes.push(value.slice(last));
  }

  while (i < text.length) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        nodes.push(<code key={`${keyPrefix}-code-${textKey++}`}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }

    if (text[i] === "[") {
      const labelEnd = text.indexOf("](", i);
      const urlEnd = labelEnd >= 0 ? text.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd > i && urlEnd > labelEnd) {
        const label = text.slice(i + 1, labelEnd);
        const href = text.slice(labelEnd + 2, urlEnd);
        nodes.push(
          <a
            key={`${keyPrefix}-a-${textKey++}`}
            href={safeHref(href)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {renderInline(label, `${keyPrefix}-a-label-${textKey}`)}
          </a>,
        );
        i = urlEnd + 1;
        continue;
      }
    }

    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        nodes.push(
          <strong key={`${keyPrefix}-strong-${textKey++}`}>
            {renderInline(text.slice(i + 2, end), `${keyPrefix}-strong-${textKey}`)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    if (text[i] === "*" && text[i + 1] !== " ") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        nodes.push(
          <em key={`${keyPrefix}-em-${textKey++}`}>
            {renderInline(text.slice(i + 1, end), `${keyPrefix}-em-${textKey}`)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }

    const nextSpecial = findNextSpecial(text, i + 1);
    pushText(text.slice(i, nextSpecial));
    i = nextSpecial;
  }

  return nodes;
}

function findNextSpecial(text: string, start: number) {
  const indexes = ["`", "[", "*"]
    .map((char) => text.indexOf(char, start))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : text.length;
}

function safeHref(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^www\./i.test(href)) return `https://${href}`;
  return "#";
}

async function copyText(text: string, setCopied: (value: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  } catch {
    /* clipboard can be unavailable in restricted browser contexts */
  }
}

function Tag({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: "good" | "warn";
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border",
        tone === "good" && "bg-good/10 text-good border-good/20",
        tone === "warn" && "bg-warn/10 text-warn border-warn/20",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Attachments({
  items,
  onUser,
}: {
  items: AttachmentMeta[];
  onUser: boolean;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(item: AttachmentMeta) {
    setDownloading(item.id);
    try {
      await board.downloadAttachment(item.id, item.name);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className={cn("mt-2 flex flex-wrap gap-1.5", onUser ? "justify-end" : "")}>
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => void download(a)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border",
            onUser
              ? "bg-white/15 border-white/20 text-white hover:bg-white/20"
              : "bg-surface-2 border-line text-ink-2 hover:border-accent hover:text-ink",
          )}
          title={`${a.name} · ${a.mime} · ${formatSize(a.size)} · click to download`}
        >
          {a.mime.startsWith("image/") ? (
            <ImageIcon className="h-3 w-3" />
          ) : a.hasText ? (
            <FileText className="h-3 w-3" />
          ) : (
            <Paperclip className="h-3 w-3" />
          )}
          <span className="max-w-[160px] truncate">{a.name}</span>
          {downloading === a.id ? <span className="text-[10px]">...</span> : null}
        </button>
      ))}
    </div>
  );
}

function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen?: (a: Artifact) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(artifact)}
      className="mt-3 w-full cursor-pointer text-left bg-surface border border-line rounded-[12px] p-3 hover:border-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 transition flex items-center gap-3"
    >
      <span className="h-9 w-9 rounded-md bg-accent-soft text-accent grid place-items-center">
        <Play className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted">
          {artifact.repaired
            ? "Artifact · recovered HTML"
            : artifact.type === "html"
              ? "Artifact · HTML"
              : `Artifact · ${artifact.type}`}
        </div>
        <div className="font-medium truncate">
          {artifact.title || "Untitled artifact"}
        </div>
      </div>
      <span className="text-xs text-accent font-medium">Open preview ↗</span>
    </button>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function Sources({ sources }: { sources: SearchSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-muted hover:text-ink underline-offset-2 hover:underline"
      >
        {open ? "hide" : "show"} {sources.length} source{sources.length !== 1 ? "s" : ""}
      </button>
      {open ? (
        <ol className="mt-2 grid gap-2">
          {sources.map((s, i) => (
            <li key={s.url + i} className="text-sm">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                [{i + 1}] {s.title || s.url}
              </a>
              {s.content ? (
                <div className="text-xs text-muted line-clamp-2 mt-0.5">
                  {s.content}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
