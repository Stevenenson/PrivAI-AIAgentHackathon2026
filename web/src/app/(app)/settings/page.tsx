"use client";
import { ShieldAlert, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { useExperience } from "@/lib/experience";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { prefs, savePrefs } = useExperience();

  return (
    <>
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-line bg-bg sticky top-0 z-10">
        <div className="font-serif text-lg tracking-tight">Settings</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6 py-8">
        <div className="mx-auto max-w-3xl grid gap-8">
          <section>
            <h1 className="font-serif text-3xl tracking-tight mb-1">
              Account
            </h1>
            <p className="text-muted text-sm mb-4">{user?.email}</p>
            <Button variant="secondary" onClick={() => signOut()}>
              Sign out
            </Button>
          </section>

          <section className="bg-surface border border-line rounded-[14px] p-5">
            <h2 className="font-serif text-2xl tracking-tight mb-2 flex items-center gap-2">
              <SquareTerminal className="h-5 w-5 text-accent" />
              Agent permissions
            </h2>
            <p className="text-sm text-muted mb-4">
              Default command rules for Agent mode. Coding Auto mode can still
              run faster for that session when you select it.
            </p>
            <div className="grid gap-3">
              <label className="flex items-start gap-3 rounded-[10px] border border-line bg-bg p-3">
                <input
                  type="checkbox"
                  checked={prefs.askBeforeCommands}
                  onChange={(e) =>
                    savePrefs({ askBeforeCommands: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Ask before running commands
                  </span>
                  <span className="block text-xs text-muted mt-1">
                    Privai pauses before terminal commands so you can approve
                    or reject them.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-[10px] border border-line bg-bg p-3">
                <input
                  type="checkbox"
                  checked={prefs.autoApproveReadOnlyCommands}
                  onChange={(e) =>
                    savePrefs({ autoApproveReadOnlyCommands: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Auto-approve safe inspection commands
                  </span>
                  <span className="block text-xs text-muted mt-1">
                    Commands like <code>pwd</code>, <code>ls</code>,{" "}
                    <code>rg</code>, and <code>git status</code> can run
                    without pausing. Commands that may change files still ask
                    first.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="bg-surface border border-line rounded-[14px] p-5">
            <h2 className="font-serif text-2xl tracking-tight mb-2 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-accent" />
              Privacy posture
            </h2>
            <ul className="text-sm list-disc pl-5 space-y-1 text-ink-2">
              <li>
                Conversations are stored in the local desktop backend, not in
                Firebase.
              </li>
              <li>
                Firebase is used for sign-in identity only.
              </li>
              <li>
                Gemini receives the prompts and files you choose to send for AI
                responses.
              </li>
              <li>
                Coding commands run inside the selected workspace. Use Agent
                mode controls to require approval or allow faster auto-run.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
