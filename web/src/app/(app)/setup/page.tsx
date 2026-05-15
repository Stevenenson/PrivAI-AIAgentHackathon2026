"use client";
import {
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  KeyRound,
  RefreshCw,
  Search,
  Terminal,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { board } from "@/lib/board";
import { chooseDesktopWorkspace } from "@/lib/desktop";

type SetupState = Awaited<ReturnType<typeof board.health>>;

export default function SetupPage() {
  const { user } = useAuth();
  const [state, setState] = useState<SetupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setState(await board.health());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const chooseWorkspace = useCallback(async () => {
    const next = await chooseDesktopWorkspace();
    if (next) await refresh();
  }, [refresh]);

  const items = useMemo(
    () => [
      {
        title: "Signed in",
        body: user?.email || "Sign in to use your local workspace.",
        ok: Boolean(user),
        icon: <UserRound className="h-4 w-4" />,
        href: "/login",
      },
      {
        title: "AI model",
        body: state?.llm
          ? `Gemini API: ${state.model}`
          : "Add your Gemini key in the local settings file and restart.",
        ok: Boolean(state?.llm),
        icon: <KeyRound className="h-4 w-4" />,
      },
      {
        title: "Work folder selected",
        body: state?.workspaceRoot || "Choose where Privai can create and edit files.",
        ok: Boolean(state?.workspaceRoot),
        icon: <FolderOpen className="h-4 w-4" />,
        action: chooseWorkspace,
      },
      {
        title: "Work actions",
        body: state?.terminalEnabled
          ? `Enabled, max ${state.agentMaxToolSteps} actions per reply.`
          : "File and command actions are disabled.",
        ok: Boolean(state?.terminalEnabled),
        icon: <Terminal className="h-4 w-4" />,
      },
      {
        title: "Business workspace",
        body: "Use Gemini-powered business automation, search, and workflows.",
        ok: true,
        icon: <BriefcaseBusiness className="h-4 w-4" />,
        href: "/business",
        alwaysLink: true,
      },
      {
        title: "Web search",
        body: state?.searxng
          ? "Private search is reachable."
          : state?.searchFallback
            ? "Private search is offline; web fallback is available."
            : "No search provider is reachable.",
        ok: Boolean(state?.searxng || state?.searchFallback),
        warn: Boolean(!state?.searxng && state?.searchFallback),
        icon: <Search className="h-4 w-4" />,
      },
    ],
    [chooseWorkspace, state, user],
  );

  return (
    <>
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-line bg-bg sticky top-0 z-10 flex items-center justify-between">
        <div className="font-serif text-lg tracking-tight">Setup</div>
        <Button variant="secondary" size="sm" onClick={refresh} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6 py-8">
        <div className="mx-auto max-w-3xl grid gap-6">
          <header>
            <h1 className="font-serif text-3xl tracking-tight mb-1">
              Setup checklist
            </h1>
            <p className="text-muted">
              Get Privai ready for business automation, app building, files,
              and search.
            </p>
          </header>

          {err ? (
            <div className="tone-bad border rounded-[8px] px-3 py-2 text-sm">
              {err}
            </div>
          ) : null}

          <section className="grid sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <SetupCard key={item.title} {...item} />
            ))}
          </section>

          <section className="rounded-[12px] border border-line bg-surface p-4 text-sm text-ink-2">
            Desktop builds read Gemini model settings from{" "}
            <code className="bg-surface-2 border border-line rounded px-1.5 py-0.5">
              ~/Library/Application Support/Privai/.env
            </code>
            . Development mode reads the repo-root <code>.env</code>.
          </section>
        </div>
      </div>
    </>
  );
}

function SetupCard({
  title,
  body,
  ok,
  warn,
  icon,
  href,
  alwaysLink,
  action,
}: {
  title: string;
  body: string;
  ok: boolean;
  warn?: boolean;
  icon: React.ReactNode;
  href?: string;
  alwaysLink?: boolean;
  action?: () => void;
}) {
  const tone = ok ? (warn ? "text-warn" : "text-good") : "text-bad";
  const content = (
    <div className="rounded-[12px] border border-line bg-surface p-4 text-left h-full hover:bg-surface-2 transition">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-accent">{icon}</span>
          {title}
        </div>
        {ok ? (
          <CheckCircle2 className={`h-4 w-4 ${tone}`} />
        ) : (
          <CircleAlert className={`h-4 w-4 ${tone}`} />
        )}
      </div>
      <p className="text-sm text-muted break-words">{body}</p>
    </div>
  );
  if (action) {
    return (
      <button type="button" onClick={action} className="text-left">
        {content}
      </button>
    );
  }
  if (href && (alwaysLink || !ok)) return <Link href={href}>{content}</Link>;
  return content;
}
