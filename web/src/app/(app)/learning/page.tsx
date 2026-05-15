"use client";
import {
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  FileQuestion,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  Layers3,
  LayoutDashboard,
  MessageSquareText,
  NotebookTabs,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SpaceAgentPanel } from "@/components/SpaceAgentPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type {
  ChatMessage,
  LearningMaterial,
  LearningPracticeSet,
} from "@/lib/types";

type LearningActionId = "summary" | "quiz" | "test" | "flashcards" | "explain";

const ACTIONS: Array<{
  id: LearningActionId;
  title: string;
  body: string;
  prompt: string;
  icon: React.ReactNode;
}> = [
  {
    id: "summary",
    title: "Summarize",
    body: "Make lecture notes, definitions, and exam points.",
    prompt:
      "Using the notebook materials only, create clean lecture notes with sections, key concepts, definitions, formulas if any, and likely exam points. If something is not covered by the materials, say so clearly.",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: "quiz",
    title: "Quiz me",
    body: "Ask one question at a time and grade my answer.",
    prompt:
      "Quiz me from the notebook materials. Ask one question at a time, wait for my answer, grade it, explain the correct answer from the materials, then continue with the next question.",
    icon: <FileQuestion className="h-4 w-4" />,
  },
  {
    id: "test",
    title: "Make a test",
    body: "Build a mixed practice test with answer key.",
    prompt:
      "Create a practice test from the notebook materials. Include multiple-choice, short-answer, and explanation questions. After the test, include a separate answer key with short explanations.",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    id: "flashcards",
    title: "Flashcards",
    body: "Extract terms, facts, formulas, and review cards.",
    prompt:
      "Create flashcards from the notebook materials. Use a table with Front, Back, and Why it matters. Focus on terms, formulas, dates, processes, and concepts that are likely to be tested.",
    icon: <Layers3 className="h-4 w-4" />,
  },
  {
    id: "explain",
    title: "Explain",
    body: "Explain a topic from the lectures in plain language.",
    prompt:
      "I want help explaining a concept from this notebook. First ask me which topic or confusing part I want explained. Then explain it from the notebook materials first, and only use general knowledge if the materials do not cover enough.",
    icon: <BookOpenCheck className="h-4 w-4" />,
  },
];

export default function LearningSpacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeSessionId = searchParams.get("session");
  const fileRef = useRef<HTMLInputElement>(null);
  const promptCounterRef = useRef(0);
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [activeAction, setActiveAction] = useState<LearningActionId | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [practice, setPractice] = useState<LearningPracticeSet | null>(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceErr, setPracticeErr] = useState<string | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<{
    id: string;
    prompt: string;
  } | null>(null);

  const sessionId = routeSessionId || localSessionId;

  const loadMaterials = useCallback(async (sid = sessionId) => {
    if (!sid) {
      setMaterials([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const result = await board.learningMaterials(sid);
      setMaterials(result.materials);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMaterials(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMaterials]);

  async function ensureNotebook() {
    if (sessionId) return sessionId;
    const session = await board.createSession("Learning notebook", "learning");
    setLocalSessionId(session.id);
    router.replace(`/learning?session=${encodeURIComponent(session.id)}`);
    return session.id;
  }

  function handleSessionCreated(id: string) {
    setLocalSessionId(id);
    router.replace(`/learning?session=${encodeURIComponent(id)}`);
  }

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setErr(null);
    try {
      const sid = await ensureNotebook();
      const uploaded = await Promise.all(
        list.map((file) => board.uploadAttachment(file, sid)),
      );
      await Promise.all(
        uploaded.map((file) => board.addLearningAttachmentMaterial(sid, file.id)),
      );
      await loadMaterials(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(false);
    }
  }

  async function addText() {
    const content = textContent.trim();
    if (!content) return;
    setBusy(true);
    setErr(null);
    try {
      const sid = await ensureNotebook();
      await board.addLearningTextMaterial(sid, {
        title: textTitle.trim() || "Pasted notes",
        content,
      });
      setTextTitle("");
      setTextContent("");
      await loadMaterials(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMaterial(mid: string) {
    if (!sessionId) return;
    setErr(null);
    try {
      await board.deleteLearningMaterial(sessionId, mid);
      setMaterials((cur) => cur.filter((item) => item.id !== mid));
    } catch (e) {
      setErr(friendlyLearningError(e));
    }
  }

  async function generatePractice(kind: "quiz" | "test") {
    if (!materials.length) {
      setErr("Add class materials first, then choose a study action.");
      return;
    }
    setPracticeBusy(true);
    setPracticeErr(null);
    setErr(null);
    try {
      const sid = await ensureNotebook();
      const next = await board.generateLearningPractice(sid, {
        kind,
        count: kind === "quiz" ? 5 : 10,
      });
      setPractice(next);
      setShowWorkspace(false);
    } catch (e) {
      setPracticeErr(friendlyLearningError(e));
    } finally {
      setPracticeBusy(false);
    }
  }

  async function startAction(action: (typeof ACTIONS)[number]) {
    if (!materials.length) {
      setErr("Add class materials first, then choose a study action.");
      return;
    }
    try {
      setErr(null);
      setActiveAction(action.id);
      if (action.id === "quiz" || action.id === "test") {
        await generatePractice(action.id);
        return;
      }
      await ensureNotebook();
      promptCounterRef.current += 1;
      setQueuedPrompt({
        id: `${action.id}-${promptCounterRef.current}`,
        prompt: action.prompt,
      });
    } catch (e) {
      setErr(friendlyLearningError(e));
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files?.length) void addFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  const studied = materials.filter((item) => item.status === "studied").length;
  const materialCount = materials.length;
  const activeActionLabel = useMemo(
    () => ACTIONS.find((item) => item.id === activeAction)?.title,
    [activeAction],
  );

  return (
    <div className="grid h-full min-h-0 overflow-hidden bg-bg xl:grid-cols-[minmax(0,1fr)_440px]">
      <main className="min-h-0 overflow-hidden flex flex-col">
        <header className="h-14 shrink-0 border-b border-line bg-bg px-4 flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-[8px] bg-accent-tint text-accent">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-serif text-lg tracking-tight">
              Learning notebook
            </div>
            <div className="truncate text-xs text-muted">
              Upload class materials, let Privai study them, then generate practice from the source.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted md:flex">
              <BookOpenCheck className="h-3.5 w-3.5 text-accent" />
              {materialCount ? `${studied}/${materialCount} studied` : "No materials yet"}
            </div>
            <Button
              type="button"
              size="sm"
              variant={showWorkspace ? "primary" : "secondary"}
              onClick={() => setShowWorkspace((value) => !value)}
              disabled={!sessionId}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Workspace
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <section className="mx-auto grid max-w-6xl gap-5">
            {err ? (
              <div className="tone-bad rounded-[10px] border px-3 py-2 text-sm">
                {err}
              </div>
            ) : null}

            <section className="rounded-[12px] border border-line bg-surface overflow-hidden">
              <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <NotebookTabs className="h-4 w-4 text-accent" />
                  <span className="font-medium">Materials</span>
                </div>
                {busy ? (
                  <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs text-accent">
                    studying...
                  </span>
                ) : null}
              </div>
              <div className="grid gap-4 p-4">
                <div
                  className={cn(
                    "rounded-[10px] border border-dashed border-line bg-bg px-4 py-5 text-center transition",
                    busy && "opacity-70",
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
                  }}
                >
                  <UploadCloud className="mx-auto mb-2 h-8 w-8 text-accent" />
                  <div className="font-medium">Drop class materials here</div>
                  <div className="mt-1 text-sm text-muted">
                    PDFs, DOCX, notes, screenshots, images, text, Markdown, and code files.
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    hidden
                    onChange={onPick}
                    accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,image/*,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  />
                  <Button
                    type="button"
                    className="mt-4"
                    onClick={() => fileRef.current?.click()}
                    loading={busy}
                  >
                    <Plus className="h-4 w-4" />
                    Add files
                  </Button>
                </div>

                <div className="grid gap-2">
                  <Input
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    placeholder="Optional title for pasted notes..."
                    disabled={busy}
                  />
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Paste lecture notes, syllabus text, homework instructions, or study material..."
                    disabled={busy}
                    className="min-h-[132px] resize-y rounded-[10px] border border-line bg-bg px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addText}
                      loading={busy}
                      disabled={!textContent.trim()}
                    >
                      <Plus className="h-4 w-4" />
                      Add pasted text
                    </Button>
                  </div>
                </div>

                <MaterialList
                  materials={materials}
                  loading={loading}
                  onDelete={(mid) => void removeMaterial(mid)}
                />
              </div>
            </section>

            <section className="rounded-[12px] border border-line bg-surface overflow-hidden">
              <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent" />
                  <span className="font-medium">Study actions</span>
                </div>
                {activeActionLabel ? (
                  <span className="text-xs text-muted">
                    latest: {activeActionLabel}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
                {ACTIONS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => void startAction(item)}
                    className={cn(
                      "rounded-[9px] border border-line bg-bg px-3 py-3 text-left transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55",
                      activeAction === item.id && "border-accent/50 bg-accent-tint",
                    )}
                    disabled={!materialCount || busy}
                    title={materialCount ? item.title : "Add materials first"}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="text-accent">{item.icon}</span>
                      {item.title}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {item.body}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            {(practice || practiceBusy || practiceErr) ? (
              <InteractivePracticePanel
                key={practice ? `${practice.kind}-${practice.createdAt}` : "practice-loading"}
                practice={practice}
                loading={practiceBusy}
                error={practiceErr}
                onRetry={() => {
                  const kind = practice?.kind ?? (activeAction === "quiz" ? "quiz" : "test");
                  void generatePractice(kind);
                }}
              />
            ) : null}

            {showWorkspace ? (
              <LearningWorkspaceBoard sessionId={sessionId} />
            ) : null}
          </section>
        </div>
      </main>

      <SpaceAgentPanel
        title="Learning agent"
        subtitle="Study materials, quiz you, explain lectures, and generate review work."
        seedTitle="Learning notebook"
        placeholder="Ask for summaries, quizzes, tests, flashcards, or explanations..."
        emptyTitle={materialCount ? "What should we study?" : "Add class materials to begin."}
        emptyBody={
          materialCount
            ? "Choose a study action or ask a question. Privai answers from the notebook materials first."
            : "Upload PDFs, DOCX files, images, or pasted notes. After that, Privai can summarize, quiz, test, make flashcards, and explain."
        }
        sessionId={sessionId}
        space="learning"
        onSessionCreated={handleSessionCreated}
        queuedPrompt={queuedPrompt}
        onQueuedPromptConsumed={() => setQueuedPrompt(null)}
        composerDefaultMode="chat"
        className="max-xl:hidden"
      />
    </div>
  );
}

function MaterialList({
  materials,
  loading,
  onDelete,
}: {
  materials: LearningMaterial[];
  loading: boolean;
  onDelete: (mid: string) => void;
}) {
  if (loading) {
    return <div className="rounded-[10px] border border-line bg-bg p-4 text-sm text-muted">Loading materials...</div>;
  }
  if (!materials.length) {
    return (
      <div className="rounded-[10px] border border-line bg-bg p-4 text-sm text-muted">
        No materials yet. Add files or paste text to create this notebook.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {materials.map((item) => (
        <div
          key={item.id}
          className="rounded-[10px] border border-line bg-bg px-3 py-3"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-accent">{materialIcon(item)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{item.title}</span>
                <span
                  className={
                    item.status === "studied"
                      ? "rounded-full border border-good/20 bg-good/10 px-2 py-0.5 text-[11px] text-good"
                      : "rounded-full border border-warn/20 bg-warn/10 px-2 py-0.5 text-[11px] text-warn"
                  }
                >
                  {item.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {item.kind} · {formatSize(item.size)} · {item.mime}
              </div>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-2 whitespace-pre-line">
                {item.summary || "No summary yet."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-bad/10 hover:text-bad"
              aria-label="Remove material"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function InteractivePracticePanel({
  practice,
  loading,
  error,
  onRetry,
}: {
  practice: LearningPracticeSet | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const total = practice?.questions.length ?? 0;
  const answered = practice
    ? practice.questions.filter((question) => answers[question.id] !== undefined).length
    : 0;
  const correct = practice
    ? practice.questions.filter(
        (question) => answers[question.id] === question.answerIndex,
      ).length
    : 0;

  function choose(questionId: string, optionIndex: number) {
    setAnswers((cur) => ({ ...cur, [questionId]: optionIndex }));
  }

  function reset() {
    setAnswers({});
  }

  return (
    <section className="rounded-[12px] border border-line bg-surface overflow-hidden">
      <div className="border-b border-line px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileQuestion className="h-4 w-4 text-accent" />
          <span className="font-medium">
            {practice?.title ?? "Interactive practice"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {practice ? (
            <span className="rounded-full border border-line bg-bg px-2.5 py-1 text-xs text-muted">
              {answered}/{total} answered · {correct} correct
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onRetry}
            loading={loading}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        {error ? (
          <div className="tone-bad rounded-[10px] border px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}
        {loading && !practice ? (
          <div className="rounded-[10px] border border-line bg-bg p-4 text-sm text-muted">
            Creating interactive questions from your notebook...
          </div>
        ) : null}
        {practice ? (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${total ? Math.round((answered / total) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="grid gap-3">
              {practice.questions.map((question, qIndex) => (
                <PracticeQuestionCard
                  key={question.id}
                  question={question}
                  index={qIndex}
                  selected={answers[question.id]}
                  onChoose={(optionIndex) => choose(question.id, optionIndex)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="text-sm text-muted">
                Score: <span className="text-ink">{correct}</span> / {total}
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={reset}>
                Reset answers
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function PracticeQuestionCard({
  question,
  index,
  selected,
  onChoose,
}: {
  question: LearningPracticeSet["questions"][number];
  index: number;
  selected?: number;
  onChoose: (optionIndex: number) => void;
}) {
  const answered = selected !== undefined;
  const correct = selected === question.answerIndex;
  return (
    <article className="rounded-[10px] border border-line bg-bg p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-sm font-semibold text-accent">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-6 text-ink">
            {question.question}
          </h3>
          {question.sourceHint ? (
            <div className="mt-1 text-xs text-muted">
              Source: {question.sourceHint}
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {question.options.map((option, optionIndex) => {
              const isSelected = selected === optionIndex;
              const isCorrectAnswer = answered && optionIndex === question.answerIndex;
              const isWrongSelection =
                answered && isSelected && optionIndex !== question.answerIndex;
              return (
                <button
                  key={`${question.id}-${optionIndex}`}
                  type="button"
                  onClick={() => onChoose(optionIndex)}
                  className={cn(
                    "flex items-start gap-2 rounded-[9px] border px-3 py-2 text-left text-sm leading-6 transition",
                    !answered && "border-line bg-surface hover:border-accent/50 hover:bg-surface-2",
                    isCorrectAnswer && "border-good/35 bg-good/10 text-ink",
                    isWrongSelection && "border-bad/35 bg-bad/10 text-ink",
                    answered && !isCorrectAnswer && !isWrongSelection && "border-line bg-surface/60 text-muted",
                  )}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-[11px] font-semibold">
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span className="min-w-0 flex-1">{option}</span>
                  {isCorrectAnswer ? <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-good" /> : null}
                  {isWrongSelection ? <XCircle className="mt-1 h-4 w-4 shrink-0 text-bad" /> : null}
                </button>
              );
            })}
          </div>
          {answered ? (
            <div
              className={cn(
                "mt-3 rounded-[9px] border px-3 py-2 text-sm leading-6",
                correct
                  ? "border-good/25 bg-good/10 text-ink"
                  : "border-bad/25 bg-bad/10 text-ink",
              )}
            >
              <div className="font-medium">
                {correct ? "Correct" : `Not quite. Correct answer: ${String.fromCharCode(65 + question.answerIndex)}`}
              </div>
              {question.explanation ? (
                <div className="mt-1 text-ink-2">{question.explanation}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function LearningWorkspaceBoard({ sessionId }: { sessionId: string | null | undefined }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      setMessages(await board.listMessages(sessionId));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const generated = messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.content.trim() &&
      !message.content.startsWith("_"),
  );

  return (
    <section className="rounded-[12px] border border-line bg-surface overflow-hidden">
      <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-accent" />
          <span className="font-medium">Workspace board</span>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </div>
      <div className="grid gap-3 p-4">
        {err ? (
          <div className="tone-bad rounded-[10px] border px-3 py-2 text-sm">
            {err}
          </div>
        ) : null}
        {!generated.length ? (
          <div className="rounded-[10px] border border-line bg-bg p-4 text-sm leading-6 text-muted">
            Generated summaries, quizzes, tests, flashcards, and explanations from this notebook appear here.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {generated.map((message) => (
              <div
                key={message.id}
                className="rounded-[10px] border border-line bg-bg p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <MessageSquareText className="h-4 w-4 text-accent" />
                  {boardTitle(message.content)}
                </div>
                <p className="line-clamp-5 whitespace-pre-line text-sm leading-6 text-muted">
                  {message.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function materialIcon(item: LearningMaterial) {
  if (item.mime.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function boardTitle(content: string) {
  const first = content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return (first || "Learning output").slice(0, 72);
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function friendlyLearningError(error: unknown) {
  const message = (error as Error).message || "Learning action failed";
  if (/learning notebook not found|session not found/i.test(message)) {
    return "This notebook session could not be found. Start a new Learning notebook and add the material again.";
  }
  if (/materials can only be added/i.test(message)) {
    return "This conversation is not a Learning notebook. Open Learning and create a new notebook before adding materials.";
  }
  if (/^not found$/i.test(message)) {
    return "Learning backend route was not found. Restart Privai so the updated backend is running, then add the material again.";
  }
  return message;
}
