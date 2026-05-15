"use client";
import {
  BriefcaseBusiness,
  Code2,
  Cpu,
  FileCog,
  FolderOpen,
  GraduationCap,
  ListChecks,
  MessageSquarePlus,
  Search,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { board } from "@/lib/board";
import {
  chooseDesktopWorkspace,
  desktopBridge,
  openDesktopAppData,
  openDesktopLogs,
  revealDesktopEnvFile,
} from "@/lib/desktop";

interface Action {
  title: string;
  hint: string;
  icon: ReactNode;
  desktopOnly?: boolean;
  run: () => Promise<void> | void;
}

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inDesktop = Boolean(desktopBridge());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const actions = useMemo<Action[]>(
    () => [
      {
        title: "New chat",
        hint: "Start a fresh conversation",
        icon: <MessageSquarePlus className="h-4 w-4" />,
        run: async () => {
          const session = await board.createSession("New chat");
          router.push(`/c/${session.id}`);
        },
      },
      {
        title: "Business space",
        hint: "Search, draft, automate, and work with the business agent",
        icon: <BriefcaseBusiness className="h-4 w-4" />,
        run: () => router.push("/business"),
      },
      {
        title: "Coding space",
        hint: "Open projects, edit files, use terminal, and build with the agent",
        icon: <Code2 className="h-4 w-4" />,
        run: () => router.push("/coding"),
      },
      {
        title: "Learning space",
        hint: "Create quizzes, homework plans, notes, and study workflows",
        icon: <GraduationCap className="h-4 w-4" />,
        run: () => router.push("/learning"),
      },
      {
        title: "Open workspace",
        hint: "Choose where Privai can create and edit files",
        icon: <FolderOpen className="h-4 w-4" />,
        desktopOnly: true,
        run: async () => {
          await chooseDesktopWorkspace();
        },
      },
      {
        title: "Setup checklist",
        hint: "Review model, search, workspace, and desktop status",
        icon: <ListChecks className="h-4 w-4" />,
        run: () => router.push("/setup"),
      },
      {
        title: "Settings",
        hint: "Change experience, account, and device pairing",
        icon: <Settings className="h-4 w-4" />,
        run: () => router.push("/settings"),
      },
      {
        title: "Device status",
        hint: "Check model, search, and local agent health",
        icon: <Cpu className="h-4 w-4" />,
        run: () => router.push("/board"),
      },
      {
        title: "Open support logs",
        hint: "Show backend and app startup logs",
        icon: <Wrench className="h-4 w-4" />,
        desktopOnly: true,
        run: openDesktopLogs,
      },
      {
        title: "Open app data",
        hint: "Show local database, cache, and desktop config folder",
        icon: <FileCog className="h-4 w-4" />,
        desktopOnly: true,
        run: openDesktopAppData,
      },
      {
        title: "Reveal model settings file",
        hint: "Open the local environment file used by the desktop app",
        icon: <FileCog className="h-4 w-4" />,
        desktopOnly: true,
        run: revealDesktopEnvFile,
      },
    ],
    [router],
  );

  const filtered = actions.filter((action) => {
    const haystack = `${action.title} ${action.hint}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  async function run(action: Action) {
    if (action.desktopOnly && !inDesktop) {
      window.alert("This action is available in the Privai desktop app.");
      return;
    }
    setOpen(false);
    setQuery("");
    try {
      await action.run();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 px-4 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <section
        className="mx-auto w-full max-w-2xl overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions..."
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close command palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {filtered.length ? (
            filtered.map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={() => void run(action)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left hover:bg-surface-2 disabled:opacity-50"
                disabled={action.desktopOnly && !inDesktop}
              >
                <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-surface-2 text-accent">
                  {action.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {action.title}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {action.desktopOnly && !inDesktop ? "Desktop app only" : action.hint}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-sm text-muted">
              No matching actions.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
