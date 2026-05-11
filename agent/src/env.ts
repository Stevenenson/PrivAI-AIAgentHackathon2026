function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[agent] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

export const env = {
  // Optional — when blank, the agent reads the paired UID from the backend.
  ownerUid: process.env.OWNER_UID ?? "",
  backendUrl: (process.env.BACKEND_URL ?? "http://127.0.0.1:8080").replace(
    /\/$/,
    "",
  ),
  // The URL the web app should use to reach this device. For laptop dev this
  // matches BACKEND_URL; on a board it'll be a LAN/Tailscale/Cloudflare URL.
  publicBoardUrl:
    process.env.PUBLIC_BOARD_URL ??
    process.env.BACKEND_URL ??
    "http://127.0.0.1:8080",
  heartbeatMs: Number(process.env.HEARTBEAT_MS ?? "10000"),
  agentVersion: process.env.AGENT_VERSION ?? "licenta-prototype-0.2",
};

void req; // keep export shape compatible if needed later
