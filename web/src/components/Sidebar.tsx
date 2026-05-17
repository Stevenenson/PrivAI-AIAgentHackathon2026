"use client";
import {
  BookOpen,
  BriefcaseBusiness,
  Code2,
  Command,
  ListChecks,
  Cpu,
  GraduationCap,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import { sessionHref, sessionSpace, spaceTitle } from "@/lib/sessionSpace";
import type { ChatSession, ChatSpace } from "@/lib/types";

export function Sidebar({
  refreshKey,
  onChange,
  collapsed = false,
  onToggleCollapsed,
}: {
  refreshKey?: number;
  onChange?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancel = false;

    const fetchOnce = (showLoader: boolean) => {
      if (showLoader) setLoading(true);
      return board
        .listSessions()
        .then((s) => {
          if (!cancel) {
            setSessions(s);
            setErr(null);
          }
        })
        .catch((e: Error & { status?: number }) => {
          if (cancel) return;
          if (e.status !== 409) setErr(e.message);
          setSessions([]);
        })
        .finally(() => {
          if (!cancel && showLoader) setLoading(false);
        });
    };

    const initial = window.setTimeout(() => void fetchOnce(true), 0);
    // Light polling so the sidebar picks up backend-side renames (auto-title
    // generation runs after first /chat returns) without a manual refresh.
    const t = setInterval(() => void fetchOnce(false), 4000);
    return () => {
      cancel = true;
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [user, refreshKey, pathname]);

  async function newChat() {
    setCreating(true);
    try {
      // Sidebar "New chat" always opens a neutral chat. Space-tagged sessions
      // are created from inside the Business / Coding / Learning pages.
      const s = await board.createSession(spaceTitle("general"), "general");
      onChange?.();
      router.push(sessionHref(s));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(sid: string) {
    if (!confirm("Delete this conversation?")) return;
    try {
      await board.deleteSession(sid);
      onChange?.();
      setSessions((cur) => cur.filter((s) => s.id !== sid));
      if (pathname?.startsWith(`/c/${sid}`)) router.push("/chat");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <aside
      className={cn(
        "bg-surface border-r border-line flex flex-col h-dvh sticky top-0 max-md:hidden transition-[width]",
        collapsed ? "w-[76px]" : "w-[280px]",
      )}
    >
      <div className={cn("pt-5 pb-3 flex items-center gap-2", collapsed ? "px-3 justify-center" : "px-4")}>
        {collapsed ? null : <Logo className="text-[28px]" />}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink",
            collapsed ? "" : "ml-auto",
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className={cn("pb-3", collapsed ? "px-2" : "px-3")}>
        <div className={cn("px-2 pb-1 text-[11px] text-muted uppercase tracking-wider", collapsed && "sr-only")}>
          Spaces
        </div>
        <div className="grid gap-1">
          <NavItem
            href="/business"
            icon={<BriefcaseBusiness className="h-4 w-4" />}
            collapsed={collapsed}
          >
            Business
          </NavItem>
          <NavItem href="/coding" icon={<Code2 className="h-4 w-4" />} collapsed={collapsed}>
            Coding
          </NavItem>
          <NavItem
            href="/learning"
            icon={<GraduationCap className="h-4 w-4" />}
            collapsed={collapsed}
          >
            Learning
          </NavItem>
        </div>
      </div>

      <div className={cn("pt-2 pb-3", collapsed ? "px-2" : "px-3")}>
        <Button
          variant="primary"
          size={collapsed ? "icon" : "md"}
          className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          onClick={newChat}
          loading={creating}
          title="New chat"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {collapsed ? null : "New chat"}
        </Button>
      </div>

      <div className={cn("px-3 text-[11px] text-muted uppercase tracking-wider pb-1", collapsed && "sr-only")}>
        Conversations
      </div>
      <nav className={cn("flex-1 overflow-y-auto px-2 pb-2", collapsed && "hidden")}>
        {loading ? (
          <div className="text-sm text-muted px-2 py-4">loading…</div>
        ) : err ? (
          <div className="text-sm text-bad px-2 py-2">
            {err}
            <div className="text-xs text-muted mt-1">
              Backend unavailable. See <Link href="/setup" className="underline">Setup</Link>.
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-muted px-2 py-4">
            No conversations yet.
          </div>
        ) : (
          sessions.map((s) => {
            const space = sessionSpace(s);
            const active =
              space === "general"
                ? pathname === `/c/${s.id}`
                : pathname === `/${space}` &&
                  searchParams?.get("session") === s.id;
            return (
              <div key={s.id} className="group relative">
                <Link
                  href={sessionHref(s)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm rounded-[8px] pr-9",
                    active
                      ? "bg-surface-2 text-ink"
                      : "text-ink-2 hover:bg-surface-2",
                  )}
                >
                  <span className="shrink-0 text-muted">{spaceIcon(space)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {s.title || "Untitled"}
                  </span>
                </Link>
                <button
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted hover:text-bad hover:bg-bad/5 opacity-0 group-hover:opacity-100 transition"
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.preventDefault();
                    remove(s.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </nav>

      <div className="border-t border-line px-2 py-2 grid gap-0.5">
        <NavItem href="/setup" icon={<ListChecks className="h-4 w-4" />} collapsed={collapsed}>
          Setup
        </NavItem>
        <NavItem href="/board" icon={<Cpu className="h-4 w-4" />} collapsed={collapsed}>
          Device
        </NavItem>
        <NavItem href="/how-it-works" icon={<BookOpen className="h-4 w-4" />} collapsed={collapsed}>
          How it works
        </NavItem>
        <NavItem href="/settings" icon={<Settings className="h-4 w-4" />} collapsed={collapsed}>
          Settings
        </NavItem>
        <div className={cn("px-3 py-2 text-[11px] text-muted flex items-center gap-1", collapsed && "hidden")}>
          <ShieldCheck className="h-3.5 w-3.5" />
          Chats stay on device
        </div>
        <div className={cn("px-3 pb-2 text-[11px] text-muted flex items-center gap-1", collapsed && "hidden")}>
          <Command className="h-3.5 w-3.5" />
          Cmd K opens actions
        </div>
      </div>

      <div className={cn("border-t border-line px-3 py-3 flex items-center gap-3", collapsed && "justify-center")}>
        <div className="h-8 w-8 rounded-full bg-surface-2 grid place-items-center text-sm font-medium overflow-hidden">
          {user?.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.photoURL}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            (user?.displayName || user?.email || "?").slice(0, 1).toUpperCase()
          )}
        </div>
        <div className={cn("flex-1 min-w-0", collapsed && "hidden")}>
          <div className="text-sm truncate">
            {user?.displayName || user?.email}
          </div>
          <div className="text-[11px] text-muted truncate">{user?.email}</div>
        </div>
        {collapsed ? null : <ThemeToggle />}
        <button
          onClick={() => signOut()}
          className={cn("p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2", collapsed && "hidden")}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function spaceIcon(space: ChatSpace) {
  if (space === "business") return <BriefcaseBusiness className="h-3.5 w-3.5" />;
  if (space === "coding") return <Code2 className="h-3.5 w-3.5" />;
  if (space === "learning") return <GraduationCap className="h-3.5 w-3.5" />;
  return <MessageSquarePlus className="h-3.5 w-3.5" />;
}

function NavItem({
  href,
  icon,
  children,
  collapsed = false,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      title={typeof children === "string" ? children : undefined}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm rounded-[8px]",
        collapsed && "justify-center px-0",
        active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2",
      )}
    >
      {icon}
      {collapsed ? null : children}
    </Link>
  );
}
