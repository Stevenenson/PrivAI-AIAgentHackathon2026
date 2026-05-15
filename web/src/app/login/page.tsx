"use client";
import { FirebaseError } from "firebase/app";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { user, loading, signInEmail, signUpEmail, signInGoogle, signInGithub } =
    useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/chat");
  }, [user, loading, router]);

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setBusy("email");
    setErr(null);
    try {
      if (mode === "signin") {
        await signInEmail(email, password);
      } else {
        await signUpEmail(email, password);
      }
    } catch (e) {
      setErr(prettyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function withProvider(name: "google" | "github", fn: () => Promise<void>) {
    setBusy(name);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(prettyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <Logo className="text-[32px]" />
        <ThemeToggle />
      </header>

      <main className="flex-1 grid place-items-center px-6 pb-12">
        <div className="w-full max-w-[380px]">
          <h1
            className="font-serif text-[34px] leading-[1.1] tracking-tight mb-2"
          >
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-muted text-[15px] mb-8">
            Your conversations stay on your hardware. We just keep your account
            and a tiny pointer to your device.
          </p>

          <div className="grid gap-2 mb-5">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => withProvider("google", signInGoogle)}
              loading={busy === "google"}
              type="button"
            >
              <GoogleMark />
              Continue with Google
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => withProvider("github", signInGithub)}
              loading={busy === "github"}
              type="button"
            >
              <GitHubMark />
              Continue with GitHub
            </Button>
          </div>

          <Divider>or</Divider>

          <form onSubmit={onEmail} className="grid gap-3 mt-5">
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {err ? (
              <div className="text-bad text-sm bg-bad/5 border border-bad/20 rounded-[8px] px-3 py-2">
                {err}
              </div>
            ) : null}
            <Button type="submit" size="lg" loading={busy === "email"}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-muted mt-6 text-center">
            {mode === "signin" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  className="text-accent hover:underline underline-offset-2"
                  onClick={() => setMode("signup")}
                  type="button"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  className="text-accent hover:underline underline-offset-2"
                  onClick={() => setMode("signin")}
                  type="button"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </main>

      <footer className="text-xs text-muted text-center pb-8">
        Gemini workspace · desktop automation
      </footer>
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted uppercase tracking-wider">
      <div className="flex-1 h-px bg-line" />
      <span>{children}</span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.5 32.4 29.1 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.5 1.1 7.5 2.8l5.7-5.7C33.6 6.3 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.3l6.6 4.8C14.6 15.4 19 12.5 24 12.5c2.9 0 5.5 1.1 7.5 2.8l5.7-5.7C33.6 6.3 29 4.5 24 4.5 16.4 4.5 9.9 8.8 6.3 14.3z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5 0 9.5-1.7 13.1-4.6l-6.1-5C29 35.5 26.6 36 24 36c-5.1 0-9.5-3.1-11.3-7.5l-6.5 5C9.7 39.1 16.3 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.9 2.5-2.6 4.7-4.7 6.2l6.1 5C40.9 36.5 43.5 30.7 43.5 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 .5C5.7.5.6 5.6.6 11.9c0 5.1 3.3 9.4 7.8 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.7 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.5-1.5 7.7-5.8 7.7-10.9C23.4 5.6 18.3.5 12 .5z"
      />
    </svg>
  );
}

function prettyError(e: unknown) {
  if (e instanceof FirebaseError) {
    const map: Record<string, string> = {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/wrong-password": "Wrong password.",
      "auth/user-not-found": "No account with that email.",
      "auth/email-already-in-use": "Email already in use.",
      "auth/weak-password": "Password is too short (min 6 chars).",
      "auth/popup-closed-by-user": "Login window was closed.",
      "auth/operation-not-allowed":
        "This sign-in method isn’t enabled in Firebase.",
      "auth/unauthorized-domain":
        "This domain isn’t authorized in Firebase Auth settings.",
    };
    return map[e.code] ?? `${e.code}: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Unknown error.";
}
