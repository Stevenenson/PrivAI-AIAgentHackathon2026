"use client";
import {
  BookOpen,
  Cpu,
  LogOut,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { board } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { ChatSession } from "@/lib/types";

export function Sidebar({
  refreshKey,
  onChange,
}: {
  refreshKey?: number;
  onChange?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
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
      const s = await board.createSession("New chat");
      onChange?.();
      router.push(`/c/${s.id}`);
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
    <aside className="bg-surface border-r border-line flex flex-col h-dvh sticky top-0 max-md:hidden">
      <div className="px-4 pt-5 pb-3">
        <Logo className="text-[28px]" />
      </div>

      <div className="px-3 pt-2 pb-3">
        <Button
          variant="primary"
          size="md"
          className="w-full justify-start"
          onClick={newChat}
          loading={creating}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <div className="px-3 text-[11px] text-muted uppercase tracking-wider pb-1">
        Conversations
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="text-sm text-muted px-2 py-4">loading…</div>
        ) : err ? (
          <div className="text-sm text-bad px-2 py-2">
            {err}
            <div className="text-xs text-muted mt-1">
              Is the device paired? See <Link href="/settings" className="underline">Settings</Link>.
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-muted px-2 py-4">
            No conversations yet.
          </div>
        ) : (
          sessions.map((s) => {
            const active = pathname === `/c/${s.id}`;
            return (
              <div key={s.id} className="group relative">
                <Link
                  href={`/c/${s.id}`}
                  className={cn(
                    "block px-3 py-2 text-sm rounded-[8px] truncate",
                    active
                      ? "bg-surface-2 text-ink"
                      : "text-ink-2 hover:bg-surface-2",
                  )}
                >
                  {s.title || "Untitled"}
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
        <NavItem href="/board" icon={<Cpu className="h-4 w-4" />}>
          Device
        </NavItem>
        <NavItem href="/how-it-works" icon={<BookOpen className="h-4 w-4" />}>
          How it works
        </NavItem>
        <NavItem href="/settings" icon={<Settings className="h-4 w-4" />}>
          Settings
        </NavItem>
        <div className="px-3 py-2 text-[11px] text-muted flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          Chats stay on device
        </div>
      </div>

      <div className="border-t border-line px-3 py-3 flex items-center gap-3">
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
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">
            {user?.displayName || user?.email}
          </div>
          <div className="text-[11px] text-muted truncate">{user?.email}</div>
        </div>
        <ThemeToggle />
        <button
          onClick={() => signOut()}
          className="p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function NavItem({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm rounded-[8px]",
        active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
