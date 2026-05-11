"use client";
import { InputHTMLAttributes, forwardRef } from "react";

import { cn } from "@/lib/cn";

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full h-11 px-3.5 rounded-[10px] bg-surface border border-line text-ink",
        "placeholder:text-muted",
        "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
        "transition",
        className,
      )}
      {...rest}
    />
  );
});
