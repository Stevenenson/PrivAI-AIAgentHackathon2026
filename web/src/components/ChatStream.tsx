"use client";
import { useEffect, useMemo, useRef } from "react";

import { MessageBubble } from "@/components/Message";
import type { Artifact, ChatMessage } from "@/lib/types";

export function ChatStream({
  messages,
  pending,
  onOpenArtifact,
}: {
  messages: ChatMessage[];
  pending?: ChatMessage | null;
  onOpenArtifact?: (a: Artifact) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const visibleMessages = useMemo(() => uniqueMessages(messages), [messages]);

  function scrollToEnd(behavior: ScrollBehavior) {
    endRef.current?.scrollIntoView({ behavior, block: "end" });
  }

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 120;
  }

  useEffect(() => {
    if (stickToBottomRef.current) scrollToEnd("smooth");
  }, [visibleMessages.length, pending?.id]);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToEnd("auto");
  }, [pending?.content]);

  if (visibleMessages.length === 0 && !pending) {
    return <Empty />;
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto px-4 md:px-6 py-6"
    >
      <div className="mx-auto max-w-3xl flex flex-col gap-5">
        {visibleMessages.map((m) => (
          <MessageBubble key={m.id} msg={m} onOpenArtifact={onOpenArtifact} />
        ))}
        {pending ? (
          <MessageBubble
            msg={pending}
            streaming
            onOpenArtifact={onOpenArtifact}
          />
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function uniqueMessages(items: ChatMessage[]) {
  const order: string[] = [];
  const byId = new Map<string, ChatMessage>();
  for (const item of items) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id)!);
}

function Empty() {
  return (
    <div className="flex-1 grid place-items-center px-6">
      <div className="max-w-md text-center">
        <h2 className="font-serif text-3xl tracking-tight mb-2">
          What do you want to ask your device?
        </h2>
        <p className="text-muted text-[15px]">
          This conversation runs through your configured model provider. Hit{" "}
          <span className="text-accent">web</span> for real-time context, or{" "}
          <span className="text-accent">agent</span> to inspect the workspace,
          run terminal checks, and build something runnable. Use{" "}
          <span className="text-accent">convert</span> for local file conversion
          or private PDF creation.
        </p>
      </div>
    </div>
  );
}
