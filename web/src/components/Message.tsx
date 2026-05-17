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
  User,
} from "lucide-react";
import { useState } from "react";

import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { Artifact, AttachmentMeta, ChatMessage, SearchSource } from "@/lib/types";

interface BubbleProps {
  msg: ChatMessage;
  streaming?: boolean;
  onOpenArtifact?: (a: Artifact) => void;
  onOpenFile?: (path: string) => void;
}

export function MessageBubble({ msg, streaming, onOpenArtifact, onOpenFile }: BubbleProps) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const displayContent =
    msg.content ||
    (!isUser && !streaming
      ? "The model returned no final answer. Please retry this message."
      : "");

  return (
    <article className="msg-enter group flex w-full gap-3 px-1">
      <div className="shrink-0 pt-0.5">
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-md text-[11px] font-semibold",
            isUser
              ? "bg-accent text-white"
              : "bg-accent-tint text-accent",
          )}
          aria-hidden
        >
          {isUser ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-2 text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-wide text-ink-2">
            {isUser ? "You" : "Privai"}
          </span>
          {streaming ? (
            <span className="text-accent">streaming…</span>
          ) : null}
        </header>

        <div
          className={cn(
            "markdown-body mt-1 text-[15px] leading-7 text-ink break-words",
            isUser && "whitespace-pre-wrap",
          )}
        >
          {isUser ? (
            <span className={streaming ? "caret" : ""}>{displayContent}</span>
          ) : (
            <MarkdownText
              text={displayContent}
              streaming={streaming}
              onOpenFile={onOpenFile}
            />
          )}
        </div>

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

        {!isUser && displayContent ? (
          <div className="mt-2 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
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
      </div>
    </article>
  );
}

function MarkdownText({
  text,
  streaming,
  onOpenFile,
}: {
  text: string;
  streaming?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div>
      {renderBlocks(text, { onOpenFile })}
      {streaming ? <span className="caret" aria-hidden="true" /> : null}
    </div>
  );
}

interface RenderOpts {
  onOpenFile?: (path: string) => void;
}

function renderBlocks(text: string, opts: RenderOpts = {}) {
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
              {renderInline(titled.title, `section-title-${blocks.length}`, opts)}
            </div>
            <p>{renderInline(titled.body, `section-body-${blocks.length}`, opts)}</p>
          </section>,
        );
      } else {
        blocks.push(
          <p key={`p-${blocks.length}`}>
            {renderInline(body, `p-${blocks.length}`, opts)}
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
          {renderInline(heading[2], `h-${blocks.length}`, opts)}
        </Tag>,
      );
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const lang = trimmed.slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <CodeBlock
          key={`code-${blocks.length}`}
          lang={lang || undefined}
          code={code.join("\n")}
          onOpenFile={opts.onOpenFile}
        />,
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
            <li key={index}>{renderInline(item, `ul-${blocks.length}-${index}`, opts)}</li>
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
            <li key={index}>{renderInline(item, `ol-${blocks.length}-${index}`, opts)}</li>
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

function renderInline(
  text: string,
  keyPrefix: string,
  opts: RenderOpts = {},
): React.ReactNode[] {
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
        const inner = text.slice(i + 1, end);
        if (isFilePath(inner) && opts.onOpenFile) {
          nodes.push(
            <FileChip
              key={`${keyPrefix}-file-${textKey++}`}
              path={inner}
              onOpenFile={opts.onOpenFile}
            />,
          );
        } else {
          nodes.push(
            <code key={`${keyPrefix}-code-${textKey++}`}>{inner}</code>,
          );
        }
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

const FILE_PATH_RE =
  /^(?:\.{1,2}\/)?[\w@./-]+\.(?:tsx?|jsx?|css|scss|html|md|mdx|json|ya?ml|toml|py|rs|go|java|kt|swift|sh|bash|zsh|sql|prisma|svelte|vue|astro|env|cfg|ini|conf)$|^(?:src|app|components|backend|web|public|tests?|spec)\//;

function isFilePath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (/\s/.test(trimmed) && !trimmed.includes("/")) return false;
  return FILE_PATH_RE.test(trimmed);
}

function FileChip({
  path,
  onOpenFile,
}: {
  path: string;
  onOpenFile: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenFile(path)}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink hover:border-accent hover:text-accent"
      title={`Open ${path} in editor`}
    >
      <FileText className="h-3 w-3" />
      {path}
    </button>
  );
}

function CodeBlock({
  lang,
  code,
  onOpenFile,
}: {
  lang?: string;
  code: string;
  onOpenFile?: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const firstLine = code.split("\n", 1)[0] ?? "";
  const detectedPath =
    isFilePath(firstLine.trim()) ? firstLine.trim() : null;
  const language = (lang || "").toLowerCase();
  return (
    <div className="code-block group">
      <header className="code-block-head">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {detectedPath && onOpenFile ? (
            <button
              type="button"
              onClick={() => onOpenFile(detectedPath)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
              title={`Open ${detectedPath} in editor`}
            >
              <FileText className="h-3 w-3" />
              {detectedPath}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copyText(code, setCopied)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
            title="Copy code"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </header>
      <pre className="code-block-body">
        <code dangerouslySetInnerHTML={{ __html: highlight(code, language) }} />
      </pre>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const KEYWORDS: Record<string, string[]> = {
  js: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "from", "export", "default", "class", "new", "await", "async", "of", "in", "typeof", "true", "false", "null", "undefined", "this", "as", "interface", "type", "extends", "implements", "switch", "case", "break", "continue", "try", "catch", "finally", "throw"],
  ts: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "from", "export", "default", "class", "new", "await", "async", "of", "in", "typeof", "true", "false", "null", "undefined", "this", "as", "interface", "type", "extends", "implements", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "readonly", "public", "private", "protected", "enum"],
  py: ["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "True", "False", "None", "with", "as", "try", "except", "finally", "raise", "pass", "lambda", "yield", "async", "await", "global", "nonlocal"],
  sh: ["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "case", "esac", "function", "return", "exit", "echo", "export", "source"],
  rust: ["fn", "let", "mut", "const", "if", "else", "for", "while", "loop", "match", "return", "use", "mod", "pub", "struct", "enum", "impl", "trait", "self", "Self", "as", "in", "true", "false"],
};

function languageGroup(lang: string): keyof typeof KEYWORDS | null {
  if (["js", "javascript", "jsx", "mjs", "cjs"].includes(lang)) return "js";
  if (["ts", "typescript", "tsx"].includes(lang)) return "ts";
  if (["py", "python"].includes(lang)) return "py";
  if (["sh", "bash", "zsh", "shell"].includes(lang)) return "sh";
  if (["rs", "rust"].includes(lang)) return "rust";
  return null;
}

function highlight(code: string, lang: string): string {
  const group = languageGroup(lang);
  if (!group) return escapeHtml(code);
  const keywords = new Set(KEYWORDS[group]);
  const tokens: string[] = [];
  const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|[\s\S])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const token = match[0];
    if (/^["'`]/.test(token)) {
      tokens.push(`<span class="hl-str">${escapeHtml(token)}</span>`);
    } else if (/^(?:\/\/|#|\/\*)/.test(token)) {
      tokens.push(`<span class="hl-com">${escapeHtml(token)}</span>`);
    } else if (/^\d/.test(token)) {
      tokens.push(`<span class="hl-num">${escapeHtml(token)}</span>`);
    } else if (/^[A-Za-z_$]/.test(token) && keywords.has(token)) {
      tokens.push(`<span class="hl-kw">${escapeHtml(token)}</span>`);
    } else {
      tokens.push(escapeHtml(token));
    }
  }
  return tokens.join("");
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
