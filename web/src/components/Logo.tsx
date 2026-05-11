"use client";

import { cn } from "@/lib/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-label="Privai"
      className={cn(
        "inline-flex items-baseline font-sans font-black tracking-normal leading-none select-none",
        className,
      )}
    >
      <span>Privai</span>
      <span className="text-muted">.</span>
    </span>
  );
}
