import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function makeApp() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!explicit) {
    console.error(
      "[agent] GOOGLE_APPLICATION_CREDENTIALS is not set.\n" +
        "         Add it to agent/.env and restart, or use ApplicationDefault.",
    );
    return initializeApp({ credential: applicationDefault() });
  }
  const path = resolve(explicit);
  if (!existsSync(path)) {
    throw new Error(
      `[agent] service account JSON not found at ${path}. ` +
        `Download it from Firebase Console → Project settings → Service accounts.`,
    );
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed.project_id) {
    throw new Error(`[agent] service account JSON at ${path} is missing project_id`);
  }
  return initializeApp({
    credential: cert(parsed),
    projectId: parsed.project_id,
  });
}

export const app = makeApp();
export const db = getFirestore(app);
export { FieldValue };
