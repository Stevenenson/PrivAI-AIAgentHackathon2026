"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BoardStatusPill } from "@/components/BoardStatus";
import { Composer } from "@/components/Composer";
import { useAuth } from "@/lib/auth";
import { board } from "@/lib/board";
import type { AttachmentMeta, ChatMode } from "@/lib/types";

export default function ChatHome() {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(
    text: string,
    opts: {
      forceSearch: boolean;
      mode: ChatMode;
      attachmentIds: string[];
      attachments: AttachmentMeta[];
    },
  ) {
    setBusy(true);
    setErr(null);
    try {
      const s = await board.createSession(text);
      const params = new URLSearchParams({
        prompt: text,
        web: opts.forceSearch ? "1" : "0",
        agent: opts.mode === "agent" ? "1" : "0",
        convert: opts.mode === "convert" ? "1" : "0",
      });
      if (opts.attachmentIds.length) {
        params.set("att", opts.attachmentIds.join(","));
      }
      router.push(`/c/${s.id}?${params.toString()}`);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(
        /not paired|409/.test(msg)
          ? "Your account isn't paired to a device yet. Open Settings."
          : msg,
      );
      setBusy(false);
    }
  }

  return (
    <>
      <div className="px-4 md:px-6 py-3 border-b border-line flex items-center justify-between bg-bg sticky top-0 z-10">
        <div className="font-serif text-lg tracking-tight">New chat</div>
        {user ? <BoardStatusPill uid={user.uid} /> : null}
      </div>

      <div className="flex-1 grid place-items-center px-6">
        <div className="max-w-md text-center">
          <h2 className="font-serif text-4xl tracking-tight mb-3">
            Hello{user?.displayName ? `, ${firstName(user.displayName)}` : ""}.
          </h2>
          <p className="text-muted">
            What do you want to ask your device today?
          </p>
          {err ? (
            <div className="mt-4 text-bad text-sm bg-bad/5 border border-bad/20 rounded-[8px] px-3 py-2 text-left">
              {err}
            </div>
          ) : null}
        </div>
      </div>

      <Composer
        onSend={send}
        disabled={busy}
        placeholder="Start a new conversation…"
      />
    </>
  );
}

function firstName(name: string) {
  return name.split(" ")[0];
}
