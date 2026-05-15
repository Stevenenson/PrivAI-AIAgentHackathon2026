"use client";

import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/BrandMark";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-label="Privai"
      className={cn(
        "inline-flex items-center gap-2 font-sans font-black tracking-normal leading-none select-none",
        className,
      )}
    >
      <BrandMark className="h-[1.05em] w-[1.05em] text-[0.58em]" />
      <span className="inline-flex items-baseline">
        <span>Privai</span>
        <span className="text-muted">.</span>
      </span>
    </span>
  );
}
