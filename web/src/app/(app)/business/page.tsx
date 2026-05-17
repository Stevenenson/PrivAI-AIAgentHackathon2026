"use client";
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Inbox,
  Link2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { SpaceAgentPanel } from "@/components/SpaceAgentPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type {
  BusinessAction,
  BusinessEmailInsight,
  BusinessEmailMessage,
  BusinessEmailScanResult,
  CalendarEvent,
  GoogleWorkspaceStatus,
  SearchSource,
} from "@/lib/types";

export default function BusinessSpacePage() {
  const searchParams = useSearchParams();
  const [agentSources, setAgentSources] = useState<SearchSource[]>([]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] bg-bg">
      <main className="h-full min-h-0 overflow-hidden flex flex-col xl:col-start-1 xl:row-start-1">
        <BusinessHeader />
        <div className="min-h-0 flex-1">
          <BusinessWorkspace agentSources={agentSources} />
        </div>
      </main>
      <SpaceAgentPanel
        title="Business agent"
        subtitle="Research, draft, automate, and prepare files."
        seedTitle="Business workspace"
        placeholder="Ask the agent to research, draft, schedule, or automate..."
        emptyTitle="How can I help the business?"
        emptyBody="Use web search for live research, or agent mode for files, trackers, drafts, and workflow automation."
        defaultForceSearch
        sessionId={searchParams.get("session")}
        space="business"
        onSources={setAgentSources}
        className="xl:col-start-2 xl:row-start-1"
      />
    </div>
  );
}

function BusinessHeader() {
  return (
    <header className="h-14 shrink-0 border-b border-line bg-bg px-4 flex items-center gap-3">
      <div className="grid h-8 w-8 place-items-center rounded-[8px] bg-accent-tint text-accent">
        <BriefcaseBusiness className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="font-serif text-lg tracking-tight">Business</div>
        <div className="truncate text-xs text-muted">
          Search the web, draft client work, and automate business tasks with Gemini.
        </div>
      </div>
      <Link
        href="/setup"
        className="ml-auto hidden items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-xs text-muted hover:text-ink md:inline-flex"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        Gemini setup
      </Link>
    </header>
  );
}

function BusinessWorkspace({ agentSources }: { agentSources: SearchSource[] }) {
  const [view, setView] = useState<"assistant" | "research" | "gmail" | "calendar" | "review">("assistant");
  const [google, setGoogle] = useState<GoogleWorkspaceStatus | null>(null);
  const [googleErr, setGoogleErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      board.googleStatus()
        .then((status) => {
          if (!cancel) {
            setGoogle(status);
            setGoogleErr(null);
          }
        })
        .catch((e) => {
          if (!cancel) setGoogleErr((e as Error).message);
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="h-full min-h-0 overflow-hidden bg-bg grid grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="border-b border-line bg-bg px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceTab
            active={view === "assistant"}
            icon={<Sparkles className="h-4 w-4" />}
            label="Assistant"
            onClick={() => setView("assistant")}
          />
          <WorkspaceTab
            active={view === "research"}
            icon={<Search className="h-4 w-4" />}
            label="Research"
            onClick={() => setView("research")}
          />
          <WorkspaceTab
            active={view === "gmail"}
            icon={<Inbox className="h-4 w-4" />}
            label="Gmail"
            onClick={() => setView("gmail")}
          />
          <WorkspaceTab
            active={view === "calendar"}
            icon={<CalendarClock className="h-4 w-4" />}
            label="Calendar"
            onClick={() => setView("calendar")}
          />
          <WorkspaceTab
            active={view === "review"}
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Action Review"
            onClick={() => setView("review")}
          />
          <GoogleConnection
            status={google}
            error={googleErr}
            onChange={setGoogle}
          />
        </div>
      </div>
      <ActionReviewStrip onOpen={() => setView("review")} />
      <div className="min-h-0 overflow-hidden">
        {view === "assistant" ? (
          <InboxAssistantWorkspace
            connected={Boolean(google?.connected)}
            onOpenReview={() => setView("review")}
            onOpenGmail={() => setView("gmail")}
            onOpenCalendar={() => setView("calendar")}
          />
        ) : null}
        {view === "research" ? <ResearchWorkspace agentSources={agentSources} /> : null}
        {view === "gmail" ? <GmailWorkspace connected={Boolean(google?.connected)} /> : null}
        {view === "calendar" ? <CalendarWorkspace connected={Boolean(google?.connected)} /> : null}
        {view === "review" ? <ActionReviewWorkspace /> : null}
      </div>
    </section>
  );
}

function WorkspaceTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-sm font-medium",
        active
          ? "border-accent bg-accent text-white"
          : "border-line bg-surface text-muted hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function GoogleConnection({
  status,
  error,
  onChange,
}: {
  status: GoogleWorkspaceStatus | null;
  error: string | null;
  onChange: (status: GoogleWorkspaceStatus) => void;
}) {
  async function connect() {
    const { url } = await board.googleAuthUrl();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function disconnect() {
    onChange(await board.googleDisconnect());
  }

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2">
      {error ? <span className="hidden text-xs text-bad md:inline">{error}</span> : null}
      {!status ? (
        <span className="text-xs text-muted">Checking Google...</span>
      ) : !status.configured ? (
        <span className="rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-xs text-warn">
          Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
        </span>
      ) : status.connected ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-3 py-1 text-xs text-good">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Google connected
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" onClick={() => void connect()}>
          <Link2 className="h-3.5 w-3.5" />
          Connect Google
        </Button>
      )}
    </div>
  );
}

function ActionReviewStrip({ onOpen }: { onOpen: () => void }) {
  const [actions, setActions] = useState<BusinessAction[]>([]);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      board.businessActions("pending")
        .then((items) => {
          if (!cancel) setActions(items);
        })
        .catch(() => {
          if (!cancel) setActions([]);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!actions.length) return <div className="hidden" />;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-b border-line bg-warn/10 px-4 py-2 text-left text-sm text-ink hover:bg-warn/20"
    >
      <span className="font-medium">{actions.length} pending action{actions.length === 1 ? "" : "s"}</span>
      <span className="ml-2 text-muted">Review before Privai creates calendar events or sends anything.</span>
    </button>
  );
}

function InboxAssistantWorkspace({
  connected,
  onOpenReview,
  onOpenGmail,
  onOpenCalendar,
}: {
  connected: boolean;
  onOpenReview: () => void;
  onOpenGmail: () => void;
  onOpenCalendar: () => void;
}) {
  const [days, setDays] = useState(14);
  const [scan, setScan] = useState<BusinessEmailScanResult | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const insights = scan?.insights ?? [];
  const visibleInsights =
    filter === "all"
      ? insights
      : insights.filter((insight) => insight.kind === filter);
  const counts = insights.reduce<Record<string, number>>((acc, insight) => {
    acc[insight.kind] = (acc[insight.kind] ?? 0) + 1;
    return acc;
  }, {});

  async function runScan(nextDays = days) {
    setDays(nextDays);
    setLoading(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await board.businessEmailScan(nextDays, 50);
      setScan(result);
      setFilter("all");
      if (!result.insights.length) {
        setNotice("No obvious meeting requests, follow-ups, deadlines, or tasks were found in recent email.");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function draftMeeting(insight: BusinessEmailInsight) {
    setDrafting(insight.id);
    setErr(null);
    setNotice(null);
    try {
      const slotWindow = nextMeetingWindow();
      const slots = await board.businessCalendarSlots({
        timeMin: slotWindow.start.toISOString(),
        timeMax: slotWindow.end.toISOString(),
        durationMinutes: insight.durationMinutes || 30,
        calendarId: "primary",
      });
      const slot = slots.slots[0];
      if (!slot) {
        setErr("No free calendar slot was found in the next 7 days. Open Calendar to choose a wider range.");
        return;
      }
      await board.draftBusinessCalendarEvent({
        summary: insight.proposedTitle || insight.subject || "Business meeting",
        description: insight.proposedDescription || insight.summary,
        start: slot.start,
        end: slot.end,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        attendees: insight.attendees ?? [],
        calendarId: "primary",
      });
      setNotice("Calendar draft created. Review and approve it in Action Review.");
      onOpenReview();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDrafting(null);
    }
  }

  if (!connected) {
    return (
      <section className="h-full min-h-0 overflow-y-auto p-5">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-[10px] border border-line bg-surface p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-2xl tracking-tight">
                  Connect Google to start
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  After Google is connected, Privai can scan Gmail in read-only
                  mode, find meeting requests and follow-ups, check your
                  Calendar, and create draft events for approval.
                </p>
                <div className="mt-5 grid gap-2 text-sm text-ink-2 sm:grid-cols-3">
                  <CapabilityCard
                    icon={<Mail className="h-4 w-4" />}
                    title="Read-only Gmail"
                    body="Searches recent messages without sending email."
                  />
                  <CapabilityCard
                    icon={<CalendarClock className="h-4 w-4" />}
                    title="Calendar slots"
                    body="Finds free times before drafting meetings."
                  />
                  <CapabilityCard
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    title="You approve"
                    body="Calendar events wait in Action Review first."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="h-full min-h-0 overflow-y-auto p-4">
      <div className="mx-auto grid max-w-6xl gap-4">
        <div className="rounded-[10px] border border-line bg-surface p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-accent" />
                <h2 className="font-serif text-2xl tracking-tight">
                  Inbox assistant
                </h2>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted">
                Scan recent email, find business items, and turn meeting
                requests into calendar drafts that you approve.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void runScan(7)} loading={loading && days === 7}>
                <Zap className="h-4 w-4" />
                Scan 7 days
              </Button>
              <Button type="button" variant="secondary" onClick={() => void runScan(14)} loading={loading && days === 14}>
                Scan 14 days
              </Button>
              <Button type="button" variant="secondary" onClick={() => void runScan(30)} loading={loading && days === 30}>
                Scan 30 days
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                setFilter("meeting_request");
                if (!scan) void runScan(days);
              }}
              className="rounded-[8px] border border-line bg-bg p-3 text-left hover:bg-surface-2"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <CalendarClock className="h-4 w-4 text-accent" />
                Find meetings
              </div>
              <div className="mt-1 text-xs text-muted">
                Detect people asking to schedule a call.
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setFilter("follow_up");
                if (!scan) void runScan(days);
              }}
              className="rounded-[8px] border border-line bg-bg p-3 text-left hover:bg-surface-2"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <RefreshCw className="h-4 w-4 text-accent" />
                Find follow-ups
              </div>
              <div className="mt-1 text-xs text-muted">
                Surface messages that need a response.
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setFilter("deadline");
                if (!scan) void runScan(days);
              }}
              className="rounded-[8px] border border-line bg-bg p-3 text-left hover:bg-surface-2"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4 text-accent" />
                Find deadlines
              </div>
              <div className="mt-1 text-xs text-muted">
                Catch urgent items, due dates, and tasks.
              </div>
            </button>
          </div>
        </div>

        {err ? <div className="tone-bad rounded-[8px] border px-3 py-2 text-sm">{err}</div> : null}
        {notice ? <div className="rounded-[8px] border border-good/20 bg-good/5 px-3 py-2 text-sm text-good">{notice}</div> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-[10px] border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">
                {scan ? `${visibleInsights.length} insight${visibleInsights.length === 1 ? "" : "s"}` : "Ready to scan"}
              </div>
              {scan ? (
                <span className="text-xs text-muted">
                  scanned {scan.scanned} messages from the last {scan.days} days
                </span>
              ) : null}
              <div className="ml-auto flex flex-wrap gap-1">
                <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
                  All {insights.length || ""}
                </FilterPill>
                <FilterPill active={filter === "meeting_request"} onClick={() => setFilter("meeting_request")}>
                  Meetings {counts.meeting_request || ""}
                </FilterPill>
                <FilterPill active={filter === "follow_up"} onClick={() => setFilter("follow_up")}>
                  Follow-ups {counts.follow_up || ""}
                </FilterPill>
                <FilterPill active={filter === "deadline"} onClick={() => setFilter("deadline")}>
                  Deadlines {counts.deadline || ""}
                </FilterPill>
              </div>
            </div>
            <div className="grid gap-3 p-3">
              {loading ? (
                <div className="grid min-h-[260px] place-items-center text-center text-sm text-muted">
                  Scanning recent Gmail messages...
                </div>
              ) : visibleInsights.length ? (
                visibleInsights.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    drafting={drafting === insight.id}
                    onDraftMeeting={() => void draftMeeting(insight)}
                    onOpenGmail={onOpenGmail}
                  />
                ))
              ) : (
                <EmptyBusinessState
                  icon={<Inbox className="h-10 w-10 text-accent" />}
                  title={scan ? "No items in this filter" : "Scan your inbox"}
                  body={
                    scan
                      ? "Try another filter or scan a wider date range."
                      : "Privai will look for meeting requests, follow-ups, deadlines, client questions, invoices, and tasks."
                  }
                />
              )}
            </div>
          </section>

          <aside className="grid content-start gap-3">
            <SideAction
              icon={<CheckCircle2 className="h-4 w-4" />}
              title="Action Review"
              body="Approve drafted calendar events before they are created."
              onClick={onOpenReview}
            />
            <SideAction
              icon={<Mail className="h-4 w-4" />}
              title="Manual Gmail search"
              body="Search a sender, client, or Gmail query directly."
              onClick={onOpenGmail}
            />
            <SideAction
              icon={<CalendarClock className="h-4 w-4" />}
              title="Calendar tools"
              body="Find custom availability or draft a meeting manually."
              onClick={onOpenCalendar}
            />
          </aside>
        </div>
      </div>
    </section>
  );
}

function CapabilityCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[8px] border border-line bg-bg p-3">
      <div className="flex items-center gap-2 font-medium">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-2.5 text-xs",
        active
          ? "border-accent bg-accent text-white"
          : "border-line bg-bg text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function InsightCard({
  insight,
  drafting,
  onDraftMeeting,
  onOpenGmail,
}: {
  insight: BusinessEmailInsight;
  drafting: boolean;
  onDraftMeeting: () => void;
  onOpenGmail: () => void;
}) {
  const canDraftMeeting = insight.kind === "meeting_request";
  return (
    <article className="rounded-[10px] border border-line bg-bg p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
          <InsightIcon kind={insight.kind} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{insight.title}</h3>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", insightTone(insight.kind))}>
              {insightLabel(insight.kind)}
            </span>
            <span className="text-[11px] text-muted">
              {Math.round((insight.confidence || 0) * 100)}% match
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="h-3.5 w-3.5" />
              <span className="truncate">{insight.fromName || insight.fromEmail || insight.from}</span>
            </span>
            {insight.date ? <span>{formatDateTime(insight.date)}</span> : null}
          </div>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-ink-2">
            {insight.summary || insight.subject}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canDraftMeeting ? (
              <Button type="button" size="sm" loading={drafting} onClick={onDraftMeeting}>
                <CalendarClock className="h-3.5 w-3.5" />
                Draft calendar event
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="secondary" onClick={onOpenGmail}>
              <Mail className="h-3.5 w-3.5" />
              Open Gmail tools
            </Button>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              {insight.suggestedAction}
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function InsightIcon({ kind }: { kind: string }) {
  if (kind === "meeting_request") return <CalendarClock className="h-5 w-5" />;
  if (kind === "follow_up") return <RefreshCw className="h-5 w-5" />;
  if (kind === "deadline") return <Clock3 className="h-5 w-5" />;
  if (kind === "invoice") return <FileText className="h-5 w-5" />;
  if (kind === "task") return <CheckCircle2 className="h-5 w-5" />;
  return <AlertCircle className="h-5 w-5" />;
}

function insightLabel(kind: string) {
  if (kind === "meeting_request") return "Meeting";
  if (kind === "follow_up") return "Follow-up";
  if (kind === "deadline") return "Deadline";
  if (kind === "invoice") return "Finance";
  if (kind === "task") return "Task";
  return "Question";
}

function insightTone(kind: string) {
  if (kind === "meeting_request") return "border-accent/30 bg-accent-tint text-accent";
  if (kind === "deadline") return "border-warn/30 bg-warn/10 text-warn";
  if (kind === "invoice") return "border-good/30 bg-good/10 text-good";
  return "border-line bg-surface text-muted";
}

function SideAction({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[10px] border border-line bg-surface p-4 text-left hover:bg-surface-2"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">{body}</p>
    </button>
  );
}

function ResearchWorkspace({ agentSources }: { agentSources: SearchSource[] }) {
  const [query, setQuery] = useState("");
  const [manualResults, setManualResults] = useState<SearchSource[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const results = manualResults.length ? manualResults : agentSources;
  const selected =
    results.find((result) => result.url === selectedUrl) ?? results[0] ?? null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = query.trim();
    if (!value) return;
    setLoading(true);
    setErr(null);
    board.searchWeb(value, 10)
      .then((items) => {
        setManualResults(items);
        setSelectedUrl(items[0]?.url ?? null);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }

  return (
    <section className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] bg-bg">
      <form onSubmit={submit} className="shrink-0 border-b border-line bg-bg px-4 py-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 pl-9"
            placeholder="Search the web for market info, competitors, vendors, or business questions..."
          />
        </div>
        <Button type="submit" variant="secondary" loading={loading}>
          Search
        </Button>
      </form>
      <div className="min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-line p-3">
          {err ? <div className="tone-bad rounded-[8px] border px-3 py-2 text-sm">{err}</div> : null}
          {results.length ? (
            <div className="grid gap-2">
              {results.map((result) => (
                <button
                  type="button"
                  key={result.url || result.title}
                  onClick={() => setSelectedUrl(result.url)}
                  className={cn(
                    "rounded-[8px] border p-3 text-left hover:bg-surface-2",
                    selected?.url === result.url
                      ? "border-accent bg-accent-tint"
                      : "border-line bg-surface",
                  )}
                >
                  <div className="line-clamp-2 text-sm font-medium text-ink">{result.title}</div>
                  <div className="mt-1 truncate text-xs text-accent">{result.url}</div>
                  {result.content ? (
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">
                      {result.content}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <EmptyBusinessState
              icon={<Search className="h-10 w-10 text-accent" />}
              title="Research workspace"
              body="Search results and sources from the agent appear here as clean cards, not a broken embedded Google page."
            />
          )}
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          {selected ? (
            <article className="mx-auto max-w-3xl">
              <div className="mb-4 flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
                  <ExternalLink className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif text-2xl tracking-tight">{selected.title}</h2>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-sm text-accent hover:underline"
                  >
                    {selected.url}
                  </a>
                </div>
              </div>
              <div className="rounded-[10px] border border-line bg-surface p-4 text-sm leading-7 text-ink-2">
                {selected.content || "No preview text was returned for this source."}
              </div>
              <div className="mt-4">
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open source
                </a>
              </div>
            </article>
          ) : (
            <EmptyBusinessState
              icon={<Search className="h-10 w-10 text-accent" />}
              title="Start with a search"
              body="Ask the agent to research something, or search here directly. Sources stay inspectable in the middle workspace."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function GmailWorkspace({ connected }: { connected: boolean }) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<BusinessEmailMessage[]>([]);
  const [selected, setSelected] = useState<BusinessEmailMessage | null>(null);
  const [thread, setThread] = useState<BusinessEmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    board.businessEmailSearch(query.trim(), 10)
      .then((res) => {
        setMessages(res.messages);
        setSelected(res.messages[0] ?? null);
        setThread([]);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }

  function readThread(message: BusinessEmailMessage) {
    setSelected(message);
    setErr(null);
    board.businessEmailThread(message.threadId)
      .then((res) => setThread(res.messages))
      .catch((e) => setErr((e as Error).message));
  }

  if (!connected) {
    return (
      <EmptyBusinessState
        icon={<Inbox className="h-10 w-10 text-accent" />}
        title="Connect Google to search Gmail"
        body="Gmail stays read-only. Privai can search messages and read thread snippets, but it cannot send email from this version."
      />
    );
  }

  return (
    <section className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] bg-bg">
      <form onSubmit={submit} className="border-b border-line p-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 pl-9"
            placeholder="Search Gmail, e.g. from:client newer_than:30d meeting"
          />
        </div>
        <Button type="submit" loading={loading}>
          Search Gmail
        </Button>
      </form>
      <div className="min-h-0 grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] overflow-hidden">
        <div className="min-h-0 overflow-y-auto border-r border-line p-3">
          {err ? <div className="tone-bad rounded-[8px] border px-3 py-2 text-sm">{err}</div> : null}
          {messages.length ? (
            <div className="grid gap-2">
              {messages.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => readThread(message)}
                  className={cn(
                    "rounded-[8px] border p-3 text-left hover:bg-surface-2",
                    selected?.id === message.id
                      ? "border-accent bg-accent-tint"
                      : "border-line bg-surface",
                  )}
                >
                  <div className="line-clamp-1 text-sm font-medium text-ink">{message.subject}</div>
                  <div className="mt-1 truncate text-xs text-muted">{message.from}</div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{message.snippet}</p>
                </button>
              ))}
            </div>
          ) : (
            <EmptyBusinessState
              icon={<Mail className="h-10 w-10 text-accent" />}
              title="Search client email"
              body="Find meeting requests, follow-ups, invoices, and customer context without leaving Privai."
            />
          )}
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          {thread.length ? (
            <div className="mx-auto max-w-3xl grid gap-3">
              {thread.map((message) => (
                <div key={message.id} className="rounded-[10px] border border-line bg-surface p-4">
                  <div className="text-sm font-medium text-ink">{message.subject}</div>
                  <div className="mt-1 text-xs text-muted">{message.from}</div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-2">
                    {message.text || message.snippet}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBusinessState
              icon={<Inbox className="h-10 w-10 text-accent" />}
              title="Open a thread"
              body="Select an email to read the thread preview. Ask the agent to summarize it or suggest next steps."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function CalendarWorkspace({ connected }: { connected: boolean }) {
  const [timeMin, setTimeMin] = useState(defaultDatetimeLocal(1));
  const [timeMax, setTimeMax] = useState(defaultDatetimeLocal(9));
  const [duration, setDuration] = useState(30);
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [summary, setSummary] = useState("");
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafted, setDrafted] = useState<BusinessAction | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!connected) {
    return (
      <EmptyBusinessState
        icon={<CalendarClock className="h-10 w-10 text-accent" />}
        title="Connect Google Calendar"
        body="Privai can check availability and draft calendar events. Events are created only after you approve them in Action Review."
      />
    );
  }

  function findSlots(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    board.businessCalendarSlots({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      durationMinutes: duration,
      calendarId: "primary",
    })
      .then((res) => setSlots(res.slots))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }

  function draftEvent(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    board.draftBusinessCalendarEvent({
      summary: summary || "Business meeting",
      description,
      start: new Date(timeMin).toISOString(),
      end: new Date(timeMax).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      attendees: attendees.split(",").map((item) => item.trim()).filter(Boolean),
      calendarId: "primary",
    })
      .then((res) => setDrafted(res.action))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }

  return (
    <section className="h-full min-h-0 overflow-y-auto p-5">
      <div className="mx-auto grid max-w-4xl gap-4">
        <UpcomingCalendarEvents />
      </div>
      <div className="mx-auto mt-4 grid max-w-4xl gap-4 lg:grid-cols-2">
        <form onSubmit={findSlots} className="rounded-[10px] border border-line bg-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-accent" />
            Find open slots
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Start
              <Input type="datetime-local" value={timeMin} onChange={(e) => setTimeMin(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              End
              <Input type="datetime-local" value={timeMax} onChange={(e) => setTimeMax(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Duration minutes
              <Input type="number" min={15} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </label>
            <Button type="submit" loading={loading}>
              Find slots
            </Button>
          </div>
          {slots.length ? (
            <div className="mt-4 grid gap-2">
              {slots.slice(0, 8).map((slot) => (
                <button
                  type="button"
                  key={`${slot.start}-${slot.end}`}
                  onClick={() => {
                    setTimeMin(toDatetimeLocal(slot.start));
                    setTimeMax(toDatetimeLocal(slot.end));
                  }}
                  className="rounded-[8px] border border-line bg-bg px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  {formatDateTime(slot.start)} - {formatDateTime(slot.end)}
                </button>
              ))}
            </div>
          ) : null}
        </form>
        <form onSubmit={draftEvent} className="rounded-[10px] border border-line bg-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            Draft event for review
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Title
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Client follow-up call" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Attendees
              <Input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="client@example.com, team@example.com" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Notes
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-24 rounded-[10px] border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="Agenda, context, or next steps..."
              />
            </label>
            <Button type="submit" loading={loading}>
              Send to Action Review
            </Button>
          </div>
          {drafted ? (
            <div className="mt-4 rounded-[8px] border border-good/30 bg-good/10 px-3 py-2 text-sm text-good">
              Drafted: {drafted.title}
            </div>
          ) : null}
          {err ? <div className="mt-4 tone-bad rounded-[8px] border px-3 py-2 text-sm">{err}</div> : null}
        </form>
      </div>
    </section>
  );
}

function UpcomingCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState(14);

  const load = useCallback(
    (days: number) => {
      setLoading(true);
      setErr(null);
      const now = new Date();
      const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      board
        .businessCalendarEvents({
          timeMin: now.toISOString(),
          timeMax: end.toISOString(),
          maxResults: 100,
        })
        .then((res) => setEvents(res.events))
        .catch((e) => setErr((e as Error).message))
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    load(rangeDays);
  }, [load, rangeDays]);

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = (event.start || "").slice(0, 10) || "unscheduled";
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  return (
    <section className="rounded-[10px] border border-line bg-surface p-4">
      <header className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="h-4 w-4 text-accent" />
        Upcoming events
        <div className="ml-auto flex items-center gap-2">
          {[7, 14, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setRangeDays(days)}
              className={
                "rounded-full px-2.5 py-0.5 text-[11px] transition " +
                (rangeDays === days
                  ? "bg-accent text-white"
                  : "border border-line text-muted hover:bg-surface-2 hover:text-ink")
              }
            >
              {days}d
            </button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={loading}
            onClick={() => load(rangeDays)}
          >
            Refresh
          </Button>
        </div>
      </header>
      {err ? (
        <div className="tone-bad mb-2 rounded-[8px] border px-3 py-2 text-xs">
          {err}
        </div>
      ) : null}
      {!loading && !err && events.length === 0 ? (
        <p className="text-sm text-muted">
          No events in the next {rangeDays} days.
        </p>
      ) : null}
      <div className="grid gap-3">
        {grouped.map(([day, list]) => (
          <div key={day} className="grid gap-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted">
              {formatDayHeading(day)}
            </div>
            <div className="grid gap-1.5">
              {list.map((event) => (
                <a
                  key={event.id}
                  href={event.htmlLink || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-[8px] border border-line bg-bg px-3 py-2 transition hover:border-accent/40 hover:bg-surface-2"
                >
                  <div className="w-20 shrink-0 text-xs text-muted">
                    {event.allDay
                      ? "All day"
                      : formatClock(event.start) + " – " + formatClock(event.end)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      {event.summary}
                    </div>
                    {event.location ? (
                      <div className="truncate text-xs text-muted">
                        {event.location}
                      </div>
                    ) : null}
                    {event.attendees.length ? (
                      <div className="mt-0.5 truncate text-[11px] text-muted">
                        {event.attendees.length} attendee
                        {event.attendees.length === 1 ? "" : "s"}
                        {event.hangoutLink ? " · video link" : ""}
                      </div>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDayHeading(day: string) {
  if (!day || day === "unscheduled") return "Unscheduled";
  const date = new Date(day + "T00:00:00");
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatClock(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActionReviewWorkspace() {
  const [actions, setActions] = useState<BusinessAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    board.businessActions()
      .then((items) => {
        setActions(items);
        setErr(null);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancel = false;
    board.businessActions()
      .then((items) => {
        if (!cancel) {
          setActions(items);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancel) setErr((e as Error).message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function decide(action: BusinessAction, approved: boolean) {
    try {
      const updated = approved
        ? await board.approveBusinessAction(action.id)
        : await board.rejectBusinessAction(action.id);
      setActions((cur) => cur.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section className="h-full min-h-0 overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[8px] bg-accent-tint text-accent">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl tracking-tight">Action Review</h2>
            <p className="text-sm text-muted">Approve calendar events and future email actions before they happen.</p>
          </div>
          <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        {err ? <div className="mb-3 tone-bad rounded-[8px] border px-3 py-2 text-sm">{err}</div> : null}
        {loading ? (
          <div className="text-sm text-muted">Loading actions...</div>
        ) : actions.length ? (
          <div className="grid gap-3">
            {actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onApprove={() => void decide(action, true)}
                onReject={() => void decide(action, false)}
              />
            ))}
          </div>
        ) : (
          <EmptyBusinessState
            icon={<CheckCircle2 className="h-10 w-10 text-good" />}
            title="Nothing waiting"
            body="Calendar events and future email actions will appear here before Privai creates or sends anything."
          />
        )}
      </div>
    </section>
  );
}

function ActionCard({
  action,
  onApprove,
  onReject,
}: {
  action: BusinessAction;
  onApprove: () => void;
  onReject: () => void;
}) {
  const payload = action.payload || {};
  const pending = action.status === "pending";
  return (
    <div className="rounded-[10px] border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
          {action.kind === "calendar_event" ? (
            <CalendarClock className="h-4 w-4" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-ink">{action.title}</h3>
            <span className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              action.status === "completed"
                ? "border-good/30 bg-good/10 text-good"
                : action.status === "failed" || action.status === "rejected"
                  ? "border-bad/30 bg-bad/10 text-bad"
                  : "border-warn/30 bg-warn/10 text-warn",
            )}>
              {action.status}
            </span>
          </div>
          <div className="mt-3 grid gap-1 text-sm text-muted">
            {typeof payload.summary === "string" ? <span>{payload.summary}</span> : null}
            {typeof payload.start === "string" && typeof payload.end === "string" ? (
              <span>{formatDateTime(payload.start)} - {formatDateTime(payload.end)}</span>
            ) : null}
            {Array.isArray(payload.attendees) && payload.attendees.length ? (
              <span>{payload.attendees.join(", ")}</span>
            ) : null}
            {typeof payload.description === "string" && payload.description ? (
              <span className="line-clamp-2">{payload.description}</span>
            ) : null}
          </div>
          {pending ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={onApprove}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button type="button" size="sm" variant="danger" onClick={onReject}>
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyBusinessState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="grid h-full min-h-[280px] place-items-center text-center">
      <div className="max-w-sm px-6">
        <div className="mb-3 flex justify-center">{icon}</div>
        <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
      </div>
    </div>
  );
}

function defaultDatetimeLocal(hoursFromNow: number) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toDatetimeLocal(date.toISOString());
}

function nextMeetingWindow() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
