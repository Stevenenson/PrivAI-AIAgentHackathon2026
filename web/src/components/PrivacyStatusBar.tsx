"use client";
import { Cloud, Terminal } from "lucide-react";
import Link from "next/link";

import { useExperience } from "@/lib/experience";

export function PrivacyStatusBar() {
  const { prefs } = useExperience();

  return (
    <div className="shrink-0 border-b border-line bg-surface/75 px-4 md:px-6 py-1.5">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-xs text-muted">
        <Link
          href="/business"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2 py-1 text-muted"
          title="Open business settings"
        >
          <Cloud className="h-3.5 w-3.5" />
          Gemini API
        </Link>
        <span className="hidden sm:inline">
          Privai uses Gemini for model responses.
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Terminal className="h-3.5 w-3.5 text-accent" />
          command approval {prefs.askBeforeCommands ? "on" : "off"}
          {prefs.autoApproveReadOnlyCommands ? " · read-only auto" : ""}
        </span>
      </div>
    </div>
  );
}
