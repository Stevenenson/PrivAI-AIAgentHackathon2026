import { request } from "undici";

import { env } from "./env.js";
import { FieldValue, db } from "./firebase.js";

interface HealthResult {
  llm: boolean;
  provider: string;
  searxng: boolean;
  model: string;
  paired: boolean;
  version: string;
}

interface PairStatus {
  paired: boolean;
  owner: string | null;
}

async function fetchJson<T>(path: string, timeoutMs = 5000): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await request(`${env.backendUrl}${path}`, {
      method: "GET",
      signal: ac.signal,
    });
    if (res.statusCode >= 400) throw new Error(`status ${res.statusCode}`);
    return (await res.body.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

let resolvedOwnerUid: string | null = null;

async function ownerUid(): Promise<string | null> {
  if (env.ownerUid) return env.ownerUid;
  if (resolvedOwnerUid) return resolvedOwnerUid;
  try {
    const ps = await fetchJson<PairStatus>("/pair/status", 3000);
    resolvedOwnerUid = ps.owner;
    return resolvedOwnerUid;
  } catch {
    return null;
  }
}

export function startHeartbeat() {
  let consecutiveErrors = 0;

  const tick = async () => {
    const uid = await ownerUid();
    if (!uid) {
      // Device not paired yet — nothing to write. Print a hint occasionally.
      if (consecutiveErrors === 0) {
        console.log(
          "[agent] device not paired yet — waiting for /pair to be called from the web app",
        );
      }
      consecutiveErrors += 1;
      return;
    }

    try {
      // /admin/llm/status now requires owner ID-token auth; the web app reads
      // it directly. Agent only reflects /health here.
      const health = await fetchJson<HealthResult>("/health").catch(() => null);
      const ok = health !== null;

      const data: Record<string, unknown> = {
        online: ok,
        boardUrl: env.publicBoardUrl,
        // llmLoaded is reported live by the web app via /admin/llm/status.
        model: ok ? health!.model : "",
        provider: ok ? health!.provider : "",
        ramMb: null,
        llm: ok ? health!.llm : false,
        searxng: ok ? health!.searxng : false,
        agentVersion: env.agentVersion,
        version: ok ? health!.version : null,
        lastSeen: FieldValue.serverTimestamp(),
      };

      await db
        .collection("users")
        .doc(uid)
        .collection("device")
        .doc("status")
        .set(data, { merge: true });

      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors += 1;
      if (consecutiveErrors === 1 || consecutiveErrors % 6 === 0) {
        console.error("[heartbeat]", (err as Error).message);
      }
      try {
        await db
          .collection("users")
          .doc(uid)
          .collection("device")
          .doc("status")
          .set(
            {
              online: false,
              boardUrl: env.publicBoardUrl,
              lastSeen: FieldValue.serverTimestamp(),
              agentVersion: env.agentVersion,
            },
            { merge: true },
          );
      } catch {
        /* ignore */
      }
    }
  };

  void tick();
  return setInterval(tick, env.heartbeatMs);
}
