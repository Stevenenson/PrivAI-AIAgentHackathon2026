"use client";
import { CheckCircle2, ShieldAlert, Wifi } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/lib/auth";
import { board, getBoardUrl, setBoardUrl } from "@/lib/board";
import { seedDevice } from "@/lib/firestore";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [boardUrl, setBoardUrlState] = useState(getBoardUrl());
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [model, setModel] = useState<string>("");

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const h = await board.health();
      setReachable(true);
      setPaired(h.paired);
      setModel(h.model);
      const ps = await board.pairStatus();
      setOwner(ps.owner);
    } catch (e) {
      setReachable(false);
      setPaired(null);
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (user) seedDevice(user.uid).catch(() => {});
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function saveBoardUrl(e: FormEvent) {
    e.preventDefault();
    setBoardUrl(boardUrl);
    setBoardUrlState(boardUrl);
    setOk("Saved board URL.");
    setTimeout(() => setOk(null), 1500);
    void refresh();
  }

  async function pair(e: FormEvent) {
    e.preventDefault();
    setPairing(true);
    setErr(null);
    setOk(null);
    try {
      const r = await board.pair(code.trim());
      setPaired(true);
      setOwner(r.owner);
      setCode("");
      setOk("Device paired to your account.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPairing(false);
    }
  }

  return (
    <>
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg sticky top-0 z-10">
        <div className="font-serif text-lg tracking-tight">Settings</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-8">
        <div className="mx-auto max-w-3xl grid gap-8">
          <section>
            <h2 className="font-serif text-2xl tracking-tight mb-1 flex items-center gap-2">
              <Wifi className="h-5 w-5 text-accent" /> Device URL
            </h2>
            <p className="text-muted text-sm mb-4">
              Where this app should reach your device&apos;s FastAPI backend.
              Default is fine for laptop dev. Set to a Tailscale hostname or
              Cloudflare-Tunnel URL once your board is online.
            </p>
            <form onSubmit={saveBoardUrl} className="flex gap-2">
              <Input
                value={boardUrl}
                onChange={(e) => setBoardUrlState(e.target.value)}
                placeholder="http://127.0.0.1:8080"
                className="font-mono text-sm"
              />
              <Button type="submit" variant="secondary">
                Save
              </Button>
            </form>
            <ReachabilityHint reachable={reachable} model={model} />
          </section>

          <section>
            <h2 className="font-serif text-2xl tracking-tight mb-1">Pairing</h2>
            <p className="text-muted text-sm mb-4">
              Type the pairing code printed in your backend console. After
              pairing, this device only accepts requests signed with{" "}
              <em>your</em> Firebase ID token.
            </p>

            {paired === true ? (
              <div className="bg-good/10 border border-good/20 text-good text-sm rounded-[10px] px-3 py-2.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Paired
                {owner === user?.uid ? " to this account" : owner ? " to a different account" : ""}.
              </div>
            ) : (
              <form onSubmit={pair} className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code from backend console"
                  inputMode="numeric"
                  className="font-mono tracking-widest"
                />
                <Button type="submit" loading={pairing}>
                  Pair device
                </Button>
              </form>
            )}
          </section>

          {err ? (
            <div className="text-bad text-sm bg-bad/5 border border-bad/20 rounded-[8px] px-3 py-2">
              {err}
            </div>
          ) : null}
          {ok ? (
            <div className="text-good text-sm bg-good/10 border border-good/20 rounded-[8px] px-3 py-2">
              {ok}
            </div>
          ) : null}

          <section>
            <h2 className="font-serif text-2xl tracking-tight mb-1">Account</h2>
            <p className="text-muted text-sm mb-4">{user?.email}</p>
            <Button variant="secondary" onClick={() => signOut()}>
              Sign out
            </Button>
          </section>

          <section className="bg-bad/5 border border-bad/20 rounded-[14px] p-5">
            <h2 className="font-serif text-2xl tracking-tight mb-2 text-bad flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> Privacy posture
            </h2>
            <ul className="text-sm list-disc pl-5 space-y-1 text-ink-2">
              <li>
                <strong>No chat content is sent to Firebase.</strong> Conversations live in the device&apos;s SQLite.
              </li>
              <li>
                Firebase only stores: your account info and a pointer to your
                device (URL + heartbeat metadata).
              </li>
              <li>
                Even Anthropic-style telemetry is off — see{" "}
                <code className="bg-surface-2 px-1 py-0.5 rounded">backend/privacy_guard.py</code> for the redaction rules.
              </li>
              <li>
                Delete a conversation from the sidebar to wipe it from the
                device immediately.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function ReachabilityHint({
  reachable,
  model,
}: {
  reachable: boolean | null;
  model: string;
}) {
  if (reachable === null) return null;
  return reachable ? (
    <div className="text-xs text-good mt-2">
      ● reachable {model ? `· model ${model}` : ""}
    </div>
  ) : (
    <div className="text-xs text-bad mt-2">
      ● unreachable — is the backend running on this URL?
    </div>
  );
}
