"use client";

import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid place-items-center overflow-hidden rounded-[8px] border border-accent-line bg-surface-2 font-sans font-black text-white shadow-[0_8px_24px_color-mix(in_srgb,var(--accent)_18%,transparent)]",
        className,
      )}
    >
      <span className="absolute inset-0 bg-[linear-gradient(135deg,var(--accent),color-mix(in_srgb,var(--good)_80%,var(--accent)))] opacity-95" />
      <span className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-white/18" />
      <span className="relative leading-none">P</span>
    </span>
  );
}
