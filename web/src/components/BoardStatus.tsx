"use client";
import { Activity, AlertCircle, CircleOff } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { listenDevice } from "@/lib/firestore";
import type { DeviceStatus } from "@/lib/types";

const STALE_MS = 30_000;

export function BoardStatusPill({ uid }: { uid: string }) {
  const [s, setS] = useState<DeviceStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => listenDevice(uid, setS), [uid]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const lastSeenMs = toMillis(s?.lastSeen);
  const stale = !lastSeenMs || now - lastSeenMs > STALE_MS;
  const online = !!s?.online && !stale;
  const llmReady = s?.llm ?? s?.llmLoaded;

  let label: string;
  let tone: "good" | "bad" | "warn";
  let Icon = Activity;
  if (!s) {
    label = "no device";
    tone = "warn";
    Icon = CircleOff;
  } else if (stale) {
    label = "offline";
    tone = "bad";
    Icon = CircleOff;
  } else if (!llmReady) {
    label = `idle · ${s.model || "no model"}`;
    tone = "warn";
    Icon = AlertCircle;
  } else {
    label = `live · ${s.model || "model"}`;
    tone = "good";
    Icon = Activity;
  }
  void online;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border",
        tone === "good" && "bg-good/10 text-good border-good/20",
        tone === "warn" && "bg-warn/10 text-warn border-warn/20",
        tone === "bad" && "bg-bad/10 text-bad border-bad/20",
      )}
      title={label}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function toMillis(t: DeviceStatus["lastSeen"] | undefined): number | null {
  if (!t) return null;
  if (t instanceof Date) return t.getTime();
  const obj = t as { toMillis?: () => number };
  if (typeof obj.toMillis === "function") return obj.toMillis();
  return null;
}
