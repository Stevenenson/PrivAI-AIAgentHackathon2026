"use client";
import {
  BookOpenCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileQuestion,
  FileText,
  Flame,
  GraduationCap,
  Image as ImageIcon,
  Layers3,
  ListChecks,
  NotebookTabs,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
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
  LearningDashboard,
  LearningGuidePayload,
  LearningMaterial,
  LearningPracticeSet,
  LearningStudyItem,
  LearningTopicMastery,
} from "@/lib/types";

type LearningTab = "sources" | "guide" | "recall" | "review" | "progress";
type ReviewRating = "again" | "hard" | "good" | "easy";

type StudyItemDraft = {
  type: LearningStudyItem["type"];
  topic: string;
  prompt: string;
  answer: string;
  optionsText: string;
  sourceHint: string;
  sourceExcerpt: string;
  status: LearningStudyItem["status"];
};

const TABS: Array<{
  id: LearningTab;
  label: string;
  icon: ReactNode;
}> = [
  { id: "sources", label: "Sources", icon: <UploadCloud className="h-4 w-4" /> },
  { id: "guide", label: "Study Guide", icon: <BookOpenCheck className="h-4 w-4" /> },
  { id: "recall", label: "Recall Studio", icon: <Layers3 className="h-4 w-4" /> },
  { id: "review", label: "Review Queue", icon: <Clock3 className="h-4 w-4" /> },
  { id: "progress", label: "Progress", icon: <Target className="h-4 w-4" /> },
];

const REVIEW_LABELS: Record<ReviewRating, { label: string; body: string; tone: string }> = {
  again: { label: "Again", body: "10 min", tone: "border-bad/30 bg-bad/10 text-bad" },
  hard: { label: "Hard", body: "1 day", tone: "border-warn/35 bg-warn/10 text-warn" },
  good: { label: "Good", body: "next interval", tone: "border-good/30 bg-good/10 text-good" },
  easy: { label: "Easy", body: "longer jump", tone: "border-accent/35 bg-accent-soft text-accent" },
};

export default function LearningSpacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeSessionId = searchParams.get("session");
  const fileRef = useRef<HTMLInputElement>(null);
  const promptCounterRef = useRef(0);
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null);
  const [studyItems, setStudyItems] = useState<LearningStudyItem[]>([]);
  const [reviewQueue, setReviewQueue] = useState<LearningStudyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LearningTab>("sources");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [showTextBox, setShowTextBox] = useState(false);
  const [practice, setPractice] = useState<LearningPracticeSet | null>(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceErr, setPracticeErr] = useState<string | null>(null);
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<StudyItemDraft | null>(null);
  const [examDate, setExamDate] = useState("");
  const [examTitle, setExamTitle] = useState("Exam");
  const [dailyTarget, setDailyTarget] = useState(20);
  const [queuedPrompt, setQueuedPrompt] = useState<{
    id: string;
    prompt: string;
  } | null>(null);

  const sessionId = routeSessionId || localSessionId;
  const latestGuide = dashboard?.latestGuide?.payload;
  const guide = isGuidePayload(latestGuide) ? latestGuide : null;
  const currentReviewItem = reviewQueue[0] ?? null;
  const dueNow = dashboard?.dueCount ?? reviewQueue.length;
  const activeItems = studyItems.filter((item) => item.status !== "suspended");
  const suspendedItems = studyItems.filter((item) => item.status === "suspended");

  const loadStudyOs = useCallback(
    async (sid = sessionId) => {
      if (!sid) {
        setMaterials([]);
        setDashboard(null);
        setStudyItems([]);
        setReviewQueue([]);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const [materialPayload, nextDashboard, nextItems, queue] = await Promise.all([
          board.learningMaterials(sid),
          board.learningDashboard(sid),
          board.learningStudyItems(sid, true),
          board.learningReviewQueue(sid, 40),
        ]);
        setMaterials(materialPayload.materials);
        setDashboard(nextDashboard);
        setStudyItems(nextItems);
        setReviewQueue(queue);
        if (nextDashboard.examPlan) {
          setExamDate(nextDashboard.examPlan.examDate ?? "");
          setExamTitle(nextDashboard.examPlan.title || "Exam");
          setDailyTarget(nextDashboard.examPlan.dailyTarget || 20);
        }
      } catch (e) {
        setErr(friendlyLearningError(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void loadStudyOs();
  }, [loadStudyOs]);

  const ensureNotebook = useCallback(async () => {
    if (sessionId) return sessionId;
    const created = await board.createSession("Learning notebook", "learning");
    setLocalSessionId(created.id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("session", created.id);
    router.replace(`/learning?${params.toString()}`);
    return created.id;
  }, [router, searchParams, sessionId]);

  const handleSessionCreated = useCallback(
    (sid: string) => {
      setLocalSessionId(sid);
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", sid);
      router.replace(`/learning?${params.toString()}`);
      void loadStudyOs(sid);
    },
    [loadStudyOs, router, searchParams],
  );

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setBusy("upload");
    setErr(null);
    try {
      const sid = await ensureNotebook();
      for (const file of files) {
        const attachment = await board.uploadAttachment(file, sid);
        await board.addLearningAttachmentMaterial(sid, attachment.id);
      }
      setActiveTab("sources");
      await loadStudyOs(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  }

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = textContent.trim();
    if (!content) {
      setErr("Paste some notes, a syllabus, or a chapter excerpt first.");
      return;
    }
    setBusy("text");
    setErr(null);
    try {
      const sid = await ensureNotebook();
      await board.addLearningTextMaterial(sid, {
        title: textTitle.trim() || "Pasted notes",
        content,
      });
      setTextTitle("");
      setTextContent("");
      setShowTextBox(false);
      setActiveTab("sources");
      await loadStudyOs(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteMaterial(materialId: string) {
    if (!sessionId) return;
    setBusy(`material-${materialId}`);
    setErr(null);
    try {
      await board.deleteLearningMaterial(sessionId, materialId);
      await loadStudyOs(sessionId);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleGuide() {
    setBusy("guide");
    setErr(null);
    try {
      const sid = await ensureNotebook();
      const result = await board.generateLearningGuide(sid);
      setDashboard(result.dashboard);
      setActiveTab("guide");
      await loadStudyOs(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerateItems() {
    setBusy("items");
    setErr(null);
    try {
      const sid = await ensureNotebook();
      const result = await board.generateLearningStudyItems(sid, { count: 12 });
      setStudyItems((cur) => [...result.items, ...cur]);
      setDashboard(result.dashboard);
      setActiveTab("recall");
      await loadStudyOs(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handlePractice(kind: "quiz" | "test") {
    setPracticeBusy(true);
    setPracticeErr(null);
    setErr(null);
    try {
      const sid = await ensureNotebook();
      const result = await board.generateLearningPractice(sid, {
        kind,
        count: kind === "quiz" ? 6 : 10,
      });
      setPractice(result);
      setActiveTab("progress");
    } catch (e) {
      setPracticeErr(friendlyLearningError(e));
    } finally {
      setPracticeBusy(false);
    }
  }

  function queueAgentPrompt(prompt: string) {
    promptCounterRef.current += 1;
    setQueuedPrompt({ id: `learning-${promptCounterRef.current}`, prompt });
  }

  function startEdit(item: LearningStudyItem) {
    setEditingId(item.id);
    setEditDraft({
      type: item.type,
      topic: item.topic,
      prompt: item.prompt,
      answer: item.answer,
      optionsText: item.options.join("\n"),
      sourceHint: item.sourceHint,
      sourceExcerpt: item.sourceExcerpt,
      status: item.status,
    });
  }

  async function saveEdit(itemId: string) {
    if (!sessionId || !editDraft) return;
    setBusy(`item-${itemId}`);
    setErr(null);
    try {
      const updated = await board.updateLearningStudyItem(sessionId, itemId, {
        type: editDraft.type,
        topic: editDraft.topic,
        prompt: editDraft.prompt,
        answer: editDraft.answer,
        options: editDraft.optionsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        sourceHint: editDraft.sourceHint,
        sourceExcerpt: editDraft.sourceExcerpt,
        status: editDraft.status,
      });
      setStudyItems((cur) => cur.map((item) => (item.id === itemId ? updated : item)));
      setReviewQueue((cur) => cur.map((item) => (item.id === itemId ? updated : item)));
      setEditingId(null);
      setEditDraft(null);
      await loadStudyOs(sessionId);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function deleteItem(itemId: string) {
    if (!sessionId) return;
    setBusy(`item-${itemId}`);
    setErr(null);
    try {
      await board.deleteLearningStudyItem(sessionId, itemId);
      setStudyItems((cur) => cur.filter((item) => item.id !== itemId));
      setReviewQueue((cur) => cur.filter((item) => item.id !== itemId));
      await loadStudyOs(sessionId);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend(item: LearningStudyItem) {
    if (!sessionId) return;
    setBusy(`item-${item.id}`);
    setErr(null);
    try {
      const nextStatus = item.status === "suspended" ? "active" : "suspended";
      const updated = await board.updateLearningStudyItem(sessionId, item.id, {
        status: nextStatus,
      });
      setStudyItems((cur) => cur.map((row) => (row.id === item.id ? updated : row)));
      setReviewQueue((cur) =>
        nextStatus === "suspended"
          ? cur.filter((row) => row.id !== item.id)
          : cur.map((row) => (row.id === item.id ? updated : row)),
      );
      await loadStudyOs(sessionId);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function rateReview(item: LearningStudyItem, rating: ReviewRating) {
    if (!sessionId) return;
    setBusy(`review-${rating}`);
    setErr(null);
    try {
      const result = await board.recordLearningReview(sessionId, {
        studyItemId: item.id,
        rating,
      });
      setDashboard(result.dashboard);
      setStudyItems((cur) =>
        cur.map((row) => (row.id === item.id ? result.item : row)),
      );
      setReviewQueue((cur) => cur.filter((row) => row.id !== item.id));
      setRevealedItemId(null);
      await loadStudyOs(sessionId);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveExamPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("exam");
    setErr(null);
    try {
      const sid = await ensureNotebook();
      const result = await board.saveLearningExamPlan(sid, {
        examDate: examDate || null,
        dailyTarget,
        title: examTitle.trim() || "Exam",
      });
      setDashboard(result.dashboard);
      await loadStudyOs(sid);
    } catch (e) {
      setErr(friendlyLearningError(e));
    } finally {
      setBusy(null);
    }
  }

  const nextAction = useMemo(() => {
    if (!dashboard) return "Create a Learning notebook and add your first source.";
    if (!dashboard.materialsTotal) return "Add source material to start the Study OS.";
    if (!dashboard.latestGuide) return "Generate the study guide so the system can map the material.";
    if (!dashboard.studyItemsTotal) return "Generate recall items from the guide and sources.";
    if (dashboard.dueCount) return `Review ${dashboard.dueCount} due item${dashboard.dueCount === 1 ? "" : "s"}.`;
    return dashboard.nextAction || "Keep the habit warm with a short practice set.";
  }, [dashboard]);

  return (
    <>
      <div className="shrink-0 border-b border-line bg-bg px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-accent">
              <GraduationCap className="h-4 w-4" />
              Learning Study OS
            </div>
            <h1 className="font-serif text-2xl tracking-tight">Today</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadStudyOs()}
              loading={loading}
              disabled={!sessionId}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button type="button" size="sm" onClick={() => fileRef.current?.click()} loading={busy === "upload"}>
              <UploadCloud className="h-3.5 w-3.5" />
              Add files
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleFiles(event)}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <main className="grid min-w-0 gap-4">
            {err ? (
              <div className="tone-bad rounded-[10px] border px-3 py-2 text-sm">
                {err}
              </div>
            ) : null}

            <section className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                      {nextAction}
                    </span>
                    {dashboard?.examPlan?.examDate ? (
                      <span className="rounded-full border border-line bg-bg px-3 py-1 text-xs text-muted">
                        {daysUntil(dashboard.examPlan.examDate)}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <h2 className="font-serif text-3xl tracking-tight">
                      Build memory from your own material.
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                      Add sources, generate a grounded study guide, turn key points into editable recall cards, then review what is due each day.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={handleGuide} loading={busy === "guide"}>
                      <Sparkles className="h-4 w-4" />
                      Generate guide
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleGenerateItems}
                      loading={busy === "items"}
                    >
                      <Layers3 className="h-4 w-4" />
                      Generate cards
                    </Button>
                    <Button
                      type="button"
                      variant={dueNow ? "primary" : "secondary"}
                      onClick={() => setActiveTab("review")}
                    >
                      <Clock3 className="h-4 w-4" />
                      Review due
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="Due now" value={dashboard?.dueCount ?? 0} icon={<Clock3 className="h-4 w-4" />} />
                  <StatTile label="New" value={dashboard?.newCount ?? 0} icon={<Plus className="h-4 w-4" />} />
                  <StatTile label="Studied" value={`${dashboard?.materialsStudied ?? 0}/${dashboard?.materialsTotal ?? 0}`} icon={<FileText className="h-4 w-4" />} />
                  <StatTile label="Streak" value={`${dashboard?.streakDays ?? 0}d`} icon={<Flame className="h-4 w-4" />} />
                </div>
              </div>
            </section>

            <nav className="flex gap-2 overflow-x-auto rounded-[12px] border border-line bg-surface p-1">
              {TABS.map((tab) => (
                <TabButton
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  icon={tab.icon}
                >
                  {tab.label}
                </TabButton>
              ))}
            </nav>

            {activeTab === "sources" ? (
              <section className="grid gap-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <div className="rounded-[12px] border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-medium">Add material</h2>
                        <p className="mt-1 text-sm leading-6 text-muted">
                          Use files or pasted notes. The generated guide and cards stay grounded to these sources.
                        </p>
                      </div>
                      <UploadCloud className="h-5 w-5 text-accent" />
                    </div>
                    <div className="mt-4 grid gap-2">
                      <Button type="button" onClick={() => fileRef.current?.click()} loading={busy === "upload"}>
                        <UploadCloud className="h-4 w-4" />
                        Upload files
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setShowTextBox((value) => !value)}
                      >
                        <Plus className="h-4 w-4" />
                        Paste text
                      </Button>
                    </div>
                    {showTextBox ? (
                      <form className="mt-4 grid gap-3" onSubmit={handleTextSubmit}>
                        <Input
                          value={textTitle}
                          onChange={(event) => setTextTitle(event.target.value)}
                          placeholder="Title, chapter, lecture..."
                        />
                        <textarea
                          value={textContent}
                          onChange={(event) => setTextContent(event.target.value)}
                          placeholder="Paste notes, textbook excerpts, syllabus points, or your own messy recall dump."
                          className="min-h-[220px] w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="ghost" onClick={() => setShowTextBox(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" loading={busy === "text"}>
                            Save source
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>

                  <div className="rounded-[12px] border border-line bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-medium">Source library</h2>
                        <p className="text-sm text-muted">
                          {materials.length ? `${materials.length} saved source${materials.length === 1 ? "" : "s"}` : "No sources yet"}
                        </p>
                      </div>
                      <StatusPill tone={materials.length ? "good" : "muted"}>
                        {materials.length ? "Ready" : "Empty"}
                      </StatusPill>
                    </div>
                    <MaterialList
                      materials={materials}
                      busy={busy}
                      onDelete={(id) => void handleDeleteMaterial(id)}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "guide" ? (
              <section className="rounded-[12px] border border-line bg-surface p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">Layered study guide</h2>
                    <p className="mt-1 text-sm text-muted">
                      Overview, sections, key terms, misconceptions, and likely exam questions with source hints.
                    </p>
                  </div>
                  <Button type="button" onClick={handleGuide} loading={busy === "guide"}>
                    <Sparkles className="h-4 w-4" />
                    {guide ? "Regenerate" : "Generate guide"}
                  </Button>
                </div>
                <GuideView guide={guide} />
              </section>
            ) : null}

            {activeTab === "recall" ? (
              <section className="grid gap-4">
                <div className="rounded-[12px] border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-medium">Recall Studio</h2>
                      <p className="mt-1 text-sm leading-6 text-muted">
                        Generated cards are editable. Tighten prompts, fix wording, suspend low-value items, or delete them.
                      </p>
                    </div>
                    <Button type="button" onClick={handleGenerateItems} loading={busy === "items"}>
                      <Layers3 className="h-4 w-4" />
                      Generate 12 cards
                    </Button>
                  </div>
                </div>

                {!studyItems.length ? (
                  <EmptyPanel
                    icon={<Layers3 className="h-5 w-5" />}
                    title="No recall items yet"
                    body="Generate cards after adding material. Privai will create high-yield QA, cloze, multiple-choice, and free-response items you can edit."
                  />
                ) : (
                  <div className="grid gap-3">
                    {activeItems.map((item) => (
                      <StudyItemCard
                        key={item.id}
                        item={item}
                        editing={editingId === item.id}
                        draft={editingId === item.id ? editDraft : null}
                        busy={busy === `item-${item.id}`}
                        onEdit={() => startEdit(item)}
                        onCancel={() => {
                          setEditingId(null);
                          setEditDraft(null);
                        }}
                        onChange={(patch) =>
                          setEditDraft((cur) => (cur ? { ...cur, ...patch } : cur))
                        }
                        onSave={() => void saveEdit(item.id)}
                        onDelete={() => void deleteItem(item.id)}
                        onSuspend={() => void toggleSuspend(item)}
                      />
                    ))}
                    {suspendedItems.length ? (
                      <details className="rounded-[12px] border border-line bg-surface p-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          Suspended items ({suspendedItems.length})
                        </summary>
                        <div className="mt-3 grid gap-3">
                          {suspendedItems.map((item) => (
                            <StudyItemCard
                              key={item.id}
                              item={item}
                              editing={editingId === item.id}
                              draft={editingId === item.id ? editDraft : null}
                              busy={busy === `item-${item.id}`}
                              onEdit={() => startEdit(item)}
                              onCancel={() => {
                                setEditingId(null);
                                setEditDraft(null);
                              }}
                              onChange={(patch) =>
                                setEditDraft((cur) => (cur ? { ...cur, ...patch } : cur))
                              }
                              onSave={() => void saveEdit(item.id)}
                              onDelete={() => void deleteItem(item.id)}
                              onSuspend={() => void toggleSuspend(item)}
                            />
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "review" ? (
              <section className="grid gap-4">
                <div className="rounded-[12px] border border-line bg-surface p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-medium">Review Queue</h2>
                      <p className="mt-1 text-sm text-muted">
                        Reveal the answer, self-grade honestly, and the local scheduler moves the item.
                      </p>
                    </div>
                    <StatusPill tone={reviewQueue.length ? "warn" : "good"}>
                      {reviewQueue.length ? `${reviewQueue.length} due/new` : "Clear"}
                    </StatusPill>
                  </div>

                  {currentReviewItem ? (
                    <div className="grid gap-4">
                      <div className="rounded-[12px] border border-line bg-bg p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <StatusPill tone="accent">{currentReviewItem.type.replace("_", " ")}</StatusPill>
                          <StatusPill tone="muted">{currentReviewItem.topic || "General"}</StatusPill>
                          <span className="text-xs text-muted">
                            Due {formatDue(currentReviewItem.dueAt)}
                          </span>
                        </div>
                        <h3 className="text-lg font-medium leading-7">
                          {currentReviewItem.prompt}
                        </h3>
                        {currentReviewItem.sourceHint ? (
                          <div className="mt-3 rounded-[9px] border border-line bg-surface px-3 py-2 text-xs leading-5 text-muted">
                            Source: {currentReviewItem.sourceHint}
                          </div>
                        ) : null}
                      </div>

                      {revealedItemId === currentReviewItem.id ? (
                        <div className="rounded-[12px] border border-good/25 bg-good/10 p-4">
                          <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-good">
                            Answer
                          </div>
                          <div className="whitespace-pre-line text-sm leading-6 text-ink">
                            {currentReviewItem.answer}
                          </div>
                          {currentReviewItem.sourceExcerpt ? (
                            <blockquote className="mt-3 border-l-2 border-good/40 pl-3 text-sm leading-6 text-ink-2">
                              {currentReviewItem.sourceExcerpt}
                            </blockquote>
                          ) : null}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setRevealedItemId(currentReviewItem.id)}
                        >
                          <BookOpenCheck className="h-4 w-4" />
                          Reveal answer
                        </Button>
                      )}

                      <div className="grid gap-2 sm:grid-cols-4">
                        {(Object.keys(REVIEW_LABELS) as ReviewRating[]).map((rating) => {
                          const meta = REVIEW_LABELS[rating];
                          return (
                            <button
                              key={rating}
                              type="button"
                              disabled={revealedItemId !== currentReviewItem.id || !!busy}
                              onClick={() => void rateReview(currentReviewItem, rating)}
                              className={cn(
                                "rounded-[10px] border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                                meta.tone,
                              )}
                            >
                              <div className="font-medium">{meta.label}</div>
                              <div className="text-xs opacity-80">{meta.body}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <EmptyPanel
                      icon={<ClipboardCheck className="h-5 w-5" />}
                      title="Nothing due right now"
                      body="Generate recall items or come back when the scheduler brings cards due. New cards also appear here."
                    />
                  )}
                </div>

                {reviewQueue.length > 1 ? (
                  <div className="rounded-[12px] border border-line bg-surface p-4">
                    <h3 className="mb-3 text-sm font-medium">Up next</h3>
                    <div className="grid gap-2">
                      {reviewQueue.slice(1, 6).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-[9px] border border-line bg-bg px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{item.prompt}</div>
                            <div className="text-xs text-muted">{item.topic || "General"}</div>
                          </div>
                          <span className="shrink-0 text-xs text-muted">{formatDue(item.dueAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "progress" ? (
              <section className="grid gap-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="rounded-[12px] border border-line bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-medium">Topic mastery</h2>
                        <p className="text-sm text-muted">
                          Computed from review outcomes and due status.
                        </p>
                      </div>
                      <Brain className="h-5 w-5 text-accent" />
                    </div>
                    <MasteryList mastery={dashboard?.mastery ?? []} />
                  </div>

                  <form className="rounded-[12px] border border-line bg-surface p-4" onSubmit={saveExamPlan}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-medium">Exam plan</h2>
                      <CalendarDays className="h-5 w-5 text-accent" />
                    </div>
                    <div className="grid gap-3">
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted">Title</span>
                        <Input value={examTitle} onChange={(event) => setExamTitle(event.target.value)} />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted">Exam date</span>
                        <Input
                          type="date"
                          value={examDate}
                          onChange={(event) => setExamDate(event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted">Daily review target</span>
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={dailyTarget}
                          onChange={(event) => setDailyTarget(Number(event.target.value) || 1)}
                        />
                      </label>
                      <Button type="submit" loading={busy === "exam"}>
                        <Save className="h-4 w-4" />
                        Save plan
                      </Button>
                    </div>
                  </form>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
                  <div className="rounded-[12px] border border-line bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="font-medium">Practice</h2>
                        <p className="text-sm text-muted">
                          Existing quiz/test flow stays compatible and now includes source hints where available.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void handlePractice("quiz")}
                          loading={practiceBusy}
                        >
                          <FileQuestion className="h-3.5 w-3.5" />
                          Quiz
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void handlePractice("test")}
                          loading={practiceBusy}
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          Test
                        </Button>
                      </div>
                    </div>
                    <InteractivePracticePanel
                      practice={practice}
                      loading={practiceBusy}
                      error={practiceErr}
                      onRetry={() => void handlePractice(practice?.kind ?? "quiz")}
                    />
                  </div>

                  <div className="rounded-[12px] border border-line bg-surface p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-accent" />
                      <h2 className="font-medium">Recommended next</h2>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <Recommendation done={!!materials.length} text="Add at least one source" />
                      <Recommendation done={!!guide} text="Generate a source-grounded study guide" />
                      <Recommendation done={!!studyItems.length} text="Create editable recall items" />
                      <Recommendation done={!dueNow && !!studyItems.length} text="Clear today's review queue" />
                      <Recommendation done={!!dashboard?.examPlan?.examDate} text="Set an exam date and daily target" />
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </main>

          <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start">
            <SpaceAgentPanel
              className="min-h-[760px]"
              title="Learning agent"
              subtitle="Ask for explanations, coaching, or exam drills grounded in this notebook."
              seedTitle="Learning notebook"
              placeholder="Ask about your sources, weak topics, or exam plan..."
              emptyTitle="Your study copilot"
              emptyBody={
                <div className="grid gap-3 text-sm text-muted">
                  <p>
                    Use generated study objects for the durable workflow, and use chat for flexible tutoring.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        queueAgentPrompt(
                          "Using only this Learning notebook, explain my weakest topics and ask me one diagnostic question at a time.",
                        )
                      }
                    >
                      Weak-topic drill
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        queueAgentPrompt(
                          "Create a 25-minute study sprint from this Learning notebook: what to review first, what to actively recall, and how to self-check.",
                        )
                      }
                    >
                      Study sprint
                    </Button>
                  </div>
                </div>
              }
              sessionId={sessionId}
              space="learning"
              onSessionCreated={handleSessionCreated}
              composerDefaultMode="agent"
              queuedPrompt={queuedPrompt}
              onQueuedPromptConsumed={(id) => {
                setQueuedPrompt((current) => (current?.id === id ? null : current));
              }}
            />
          </aside>
        </div>
      </div>
    </>
  );
}

function TabButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[9px] px-3 text-sm font-medium transition",
        active ? "bg-accent text-white shadow-sm" : "text-muted hover:bg-bg hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-bg p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        {label}
        <span className="text-accent">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "good" | "warn" | "bad" | "accent" | "muted";
  children: ReactNode;
}) {
  const classes = {
    good: "border-good/25 bg-good/10 text-good",
    warn: "border-warn/30 bg-warn/10 text-warn",
    bad: "border-bad/25 bg-bad/10 text-bad",
    accent: "border-accent/25 bg-accent-soft text-accent",
    muted: "border-line bg-bg text-muted",
  }[tone];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", classes)}>
      {children}
    </span>
  );
}

function MaterialList({
  materials,
  busy,
  onDelete,
}: {
  materials: LearningMaterial[];
  busy: string | null;
  onDelete: (id: string) => void;
}) {
  if (!materials.length) {
    return (
      <EmptyPanel
        icon={<NotebookTabs className="h-5 w-5" />}
        title="Start with sources"
        body="Upload PDFs, slides, documents, images with extracted text, or paste notes. Learning objects are generated only after the material is saved locally."
      />
    );
  }
  return (
    <div className="grid gap-2">
      {materials.map((material) => (
        <div key={material.id} className="flex items-start gap-3 rounded-[10px] border border-line bg-bg p-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent">
            {materialIcon(material)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate font-medium">{material.title}</div>
              <StatusPill tone={material.status === "studied" ? "good" : material.status === "failed" ? "bad" : "warn"}>
                {material.status}
              </StatusPill>
            </div>
            <div className="mt-1 text-xs text-muted">
              {material.kind} - {formatSize(material.size)} - {material.hasText ? "text ready" : "no extracted text"}
            </div>
            {material.summary ? (
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-2">
                {material.summary}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onDelete(material.id)}
            loading={busy === `material-${material.id}`}
            aria-label={`Delete ${material.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function GuideView({ guide }: { guide: LearningGuidePayload | null }) {
  if (!guide) {
    return (
      <EmptyPanel
        icon={<BookOpenCheck className="h-5 w-5" />}
        title="Generate the map first"
        body="Privai will create a layered guide from your saved sources: overview, sections, key terms, misconceptions, and exam-style questions."
      />
    );
  }
  return (
    <div className="grid gap-4">
      <div className="rounded-[12px] border border-line bg-bg p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-accent">
          Overview
        </div>
        <p className="whitespace-pre-line text-sm leading-7 text-ink-2">{guide.overview}</p>
      </div>

      {guide.sections.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {guide.sections.map((section, index) => (
            <article key={`${section.title}-${index}`} className="rounded-[12px] border border-line bg-bg p-4">
              <h3 className="font-medium">{section.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-2">{section.summary}</p>
              {section.sourceHint ? (
                <div className="mt-3 text-xs text-muted">Source: {section.sourceHint}</div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <GuideList title="Key terms" items={guide.keyTerms.map((term) => `${term.term}: ${term.definition}`)} />
        <GuideList title="Misconceptions" items={guide.misconceptions} />
        <GuideList title="Likely exam questions" items={guide.likelyExamQuestions} />
      </div>

      {guide.teachBackPrompts.length ? (
        <GuideList title="Teach-back prompts" items={guide.teachBackPrompts} />
      ) : null}
    </div>
  );
}

function GuideList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[12px] border border-line bg-bg p-4">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      {items.length ? (
        <ul className="grid gap-2 text-sm leading-6 text-ink-2">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-muted">Nothing saved yet.</div>
      )}
    </div>
  );
}

function StudyItemCard({
  item,
  editing,
  draft,
  busy,
  onEdit,
  onCancel,
  onChange,
  onSave,
  onDelete,
  onSuspend,
}: {
  item: LearningStudyItem;
  editing: boolean;
  draft: StudyItemDraft | null;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onChange: (patch: Partial<StudyItemDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
  onSuspend: () => void;
}) {
  return (
    <article className={cn("rounded-[12px] border border-line bg-surface p-4", item.status === "suspended" && "opacity-70")}>
      {editing && draft ? (
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Type</span>
              <select
                value={draft.type}
                onChange={(event) => onChange({ type: event.target.value as LearningStudyItem["type"] })}
                className="h-11 rounded-[10px] border border-line bg-bg px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="qa">QA</option>
                <option value="cloze">Cloze</option>
                <option value="multiple_choice">Multiple choice</option>
                <option value="free_response">Free response</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Topic</span>
              <Input value={draft.topic} onChange={(event) => onChange({ topic: event.target.value })} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Prompt</span>
            <textarea
              value={draft.prompt}
              onChange={(event) => onChange({ prompt: event.target.value })}
              className="min-h-[110px] rounded-[10px] border border-line bg-bg px-3 py-2 text-sm leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Answer</span>
            <textarea
              value={draft.answer}
              onChange={(event) => onChange({ answer: event.target.value })}
              className="min-h-[120px] rounded-[10px] border border-line bg-bg px-3 py-2 text-sm leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Options, one per line</span>
            <textarea
              value={draft.optionsText}
              onChange={(event) => onChange({ optionsText: event.target.value })}
              className="min-h-[90px] rounded-[10px] border border-line bg-bg px-3 py-2 text-sm leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Source hint</span>
              <Input value={draft.sourceHint} onChange={(event) => onChange({ sourceHint: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Status</span>
              <select
                value={draft.status}
                onChange={(event) => onChange({ status: event.target.value as LearningStudyItem["status"] })}
                className="h-11 rounded-[10px] border border-line bg-bg px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Source excerpt</span>
            <textarea
              value={draft.sourceExcerpt}
              onChange={(event) => onChange({ sourceExcerpt: event.target.value })}
              className="min-h-[80px] rounded-[10px] border border-line bg-bg px-3 py-2 text-sm leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button type="button" onClick={onSave} loading={busy}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={item.status === "suspended" ? "muted" : "accent"}>
                {item.type.replace("_", " ")}
              </StatusPill>
              <StatusPill tone="muted">{item.topic || "General"}</StatusPill>
              <span className="text-xs text-muted">
                Due {formatDue(item.dueAt)} - interval {formatInterval(item.intervalDays)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" onClick={onEdit} aria-label="Edit card">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={onSuspend} loading={busy} aria-label="Suspend card">
                {item.status === "suspended" ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={onDelete} loading={busy} aria-label="Delete card">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium leading-6">{item.prompt}</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-2">{item.answer}</p>
          </div>
          {item.options.length ? (
            <div className="flex flex-wrap gap-2">
              {item.options.map((option, index) => (
                <span key={`${item.id}-${index}`} className="rounded-full border border-line bg-bg px-2.5 py-1 text-xs text-muted">
                  {option}
                </span>
              ))}
            </div>
          ) : null}
          {item.sourceHint ? (
            <div className="rounded-[9px] border border-line bg-bg px-3 py-2 text-xs leading-5 text-muted">
              Source: {item.sourceHint}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

function MasteryList({ mastery }: { mastery: LearningTopicMastery[] }) {
  if (!mastery.length) {
    return (
      <EmptyPanel
        icon={<Brain className="h-5 w-5" />}
        title="Mastery appears after reviews"
        body="Review outcomes drive the topic states. A topic can move from learning to mastered only when answers are strong and nothing is overdue."
      />
    );
  }
  return (
    <div className="grid gap-3">
      {mastery.map((topic) => (
        <div key={topic.topic} className="rounded-[10px] border border-line bg-bg p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">{topic.topic}</div>
            <StatusPill tone={masteryTone(topic.state)}>{topic.state.replace("_", " ")}</StatusPill>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round(topic.score * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted">
            {Math.round(topic.correctRate * 100)}% correct - {topic.reviewedCount} reviewed - {topic.dueCount} due
          </div>
        </div>
      ))}
    </div>
  );
}

function Recommendation({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[9px] border border-line bg-bg px-3 py-2">
      {done ? <CheckCircle2 className="h-4 w-4 text-good" /> : <Clock3 className="h-4 w-4 text-muted" />}
      <span className={done ? "text-ink" : "text-muted"}>{text}</span>
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[12px] border border-dashed border-line bg-bg p-5 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-[10px] bg-accent-soft text-accent">
        {icon}
      </div>
      <div className="font-medium">{title}</div>
      <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted">{body}</p>
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

  useEffect(() => {
    setAnswers({});
  }, [practice?.createdAt]);

  const total = practice?.questions.length ?? 0;
  const answered = Object.keys(answers).length;
  const correct =
    practice?.questions.reduce(
      (sum, question) => sum + (answers[question.id] === question.answerIndex ? 1 : 0),
      0,
    ) ?? 0;

  function choose(questionId: string, optionIndex: number) {
    setAnswers((cur) => ({ ...cur, [questionId]: optionIndex }));
  }

  if (error) {
    return <div className="tone-bad rounded-[10px] border px-3 py-2 text-sm">{error}</div>;
  }

  if (loading && !practice) {
    return (
      <div className="rounded-[10px] border border-line bg-bg p-4 text-sm text-muted">
        Creating source-grounded practice...
      </div>
    );
  }

  if (!practice) {
    return (
      <EmptyPanel
        icon={<FileQuestion className="h-5 w-5" />}
        title="No practice set yet"
        body="Generate a quiz or test when you want a quick checkpoint outside the spaced-review queue."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{practice.title}</h3>
          <div className="text-xs text-muted">
            {answered}/{total} answered - {correct} correct
          </div>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onRetry} loading={loading}>
          <RotateCcw className="h-3.5 w-3.5" />
          Regenerate
        </Button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${total ? Math.round((answered / total) * 100) : 0}%` }}
        />
      </div>
      {practice.questions.map((question, index) => (
        <PracticeQuestionCard
          key={question.id}
          question={question}
          index={index}
          selected={answers[question.id]}
          onChoose={(optionIndex) => choose(question.id, optionIndex)}
        />
      ))}
    </div>
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
          <h3 className="text-sm font-medium leading-6 text-ink">{question.question}</h3>
          {question.sourceHint ? (
            <div className="mt-1 text-xs text-muted">Source: {question.sourceHint}</div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {question.options.map((option, optionIndex) => {
              const isSelected = selected === optionIndex;
              const isCorrectAnswer = answered && optionIndex === question.answerIndex;
              const isWrongSelection = answered && isSelected && optionIndex !== question.answerIndex;
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
                correct ? "border-good/25 bg-good/10 text-ink" : "border-bad/25 bg-bad/10 text-ink",
              )}
            >
              <div className="font-medium">
                {correct ? "Correct" : `Not quite. Correct answer: ${String.fromCharCode(65 + question.answerIndex)}`}
              </div>
              {question.explanation ? <div className="mt-1 text-ink-2">{question.explanation}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function isGuidePayload(value: unknown): value is LearningGuidePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<LearningGuidePayload>;
  return (
    typeof payload.overview === "string" &&
    Array.isArray(payload.sections) &&
    Array.isArray(payload.keyTerms) &&
    Array.isArray(payload.misconceptions) &&
    Array.isArray(payload.likelyExamQuestions)
  );
}

function materialIcon(item: LearningMaterial) {
  if (item.mime.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function masteryTone(state: LearningTopicMastery["state"]): "good" | "accent" | "warn" | "muted" {
  if (state === "mastered" || state === "proficient") return "good";
  if (state === "familiar") return "accent";
  if (state === "learning") return "warn";
  return "muted";
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDue(seconds: number) {
  const diffMs = seconds * 1000 - Date.now();
  if (diffMs <= 0) return "now";
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `in ${days}d`;
}

function formatInterval(days: number) {
  if (days <= 0.05) return "10m";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

function daysUntil(value: string) {
  const exam = new Date(value);
  if (Number.isNaN(exam.getTime())) return "Exam date set";
  const days = Math.ceil((exam.getTime() - Date.now()) / 86400000);
  if (days < 0) return "Exam date passed";
  if (days === 0) return "Exam today";
  if (days === 1) return "Exam tomorrow";
  return `${days} days to exam`;
}

function friendlyLearningError(error: unknown) {
  const message = (error as Error).message || "Learning action failed";
  if (/learning notebook not found|session not found/i.test(message)) {
    return "This notebook session could not be found. Start a new Learning notebook and add the material again.";
  }
  if (/materials can only be added/i.test(message)) {
    return "This conversation is not a Learning notebook. Open Learning and create a new notebook before adding materials.";
  }
  if (/add at least one learning material|no learning material/i.test(message)) {
    return "Add at least one source before generating guides, cards, or practice.";
  }
  if (/^not found$/i.test(message)) {
    return "Learning backend route was not found. Restart Privai so the updated backend is running, then try again.";
  }
  return message;
}
