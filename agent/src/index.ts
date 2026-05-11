import { env } from "./env.js";
import { startHeartbeat } from "./heartbeat.js";

console.log(
  `[agent] starting; backend=${env.backendUrl}; publicBoardUrl=${env.publicBoardUrl}`,
);

const heartbeatTimer = startHeartbeat();

function shutdown(signal: string) {
  console.log(`[agent] ${signal} received, shutting down`);
  clearInterval(heartbeatTimer);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
