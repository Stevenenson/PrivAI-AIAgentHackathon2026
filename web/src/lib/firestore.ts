"use client";
import {
  DocumentReference,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "./firebase";
import type { DeviceStatus } from "./types";

// Firestore now stores ONLY:
//   users/{uid}                  – profile (created by auth provider)
//   users/{uid}/device/status    – heartbeat from board agent
//
// No chat content lives in Firestore. Chats live in board SQLite.

export const deviceStatusDoc = (uid: string): DocumentReference<DeviceStatus> =>
  doc(db, "users", uid, "device", "status") as DocumentReference<DeviceStatus>;

export function listenDevice(
  uid: string,
  cb: (s: DeviceStatus | null) => void,
) {
  return onSnapshot(deviceStatusDoc(uid), (snap) =>
    cb(snap.exists() ? (snap.data() as DeviceStatus) : null),
  );
}

export async function seedDevice(uid: string) {
  // Only called after sign-in to ensure the doc exists for the agent's first
  // write. The agent will overwrite with real values immediately.
  await setDoc(
    deviceStatusDoc(uid),
    {
      online: false,
      boardUrl: "",
      llmLoaded: false,
      model: "",
      lastSeen: serverTimestamp(),
    } as Partial<DeviceStatus>,
    { merge: true },
  );
}
