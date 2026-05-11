"use client";
import { FirebaseError } from "firebase/app";
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { board } from "./board";
import { auth, db, githubProvider, googleProvider } from "./firebase";

interface PrivaiDesktopBridge {
  platform?: string;
  pairingCode?: string;
}

function desktopPairingCode(): string | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { privaiDesktop?: PrivaiDesktopBridge };
  const code = w.privaiDesktop?.pairingCode?.trim();
  return code ? code : null;
}

async function autoPairIfDesktop() {
  const code = desktopPairingCode();
  if (!code) return;
  try {
    const status = await board.pairStatus();
    if (status.paired) return;
    await board.pair(code);
  } catch {
    /* surface in board UI on next call */
  }
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInGithub: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function ensureUserDoc(user: User) {
  const ref = doc(db, "users", user.uid);
  await setDoc(
    ref,
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split("@")[0] || "user",
      photoURL: user.photoURL,
      lastSignInAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Resolve any pending redirect (Google/GitHub sign-in via signInWithRedirect)
    getRedirectResult(auth).catch(() => {
      /* not a redirect flow */
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          await ensureUserDoc(u);
        } catch {
          /* Firestore rules / network — surface elsewhere */
        }
        await autoPairIfDesktop();
      }
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUpEmail = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const signInGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (isPopupError(e)) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw e;
    }
  }, []);

  const signInGithub = useCallback(async () => {
    try {
      await signInWithPopup(auth, githubProvider);
    } catch (e) {
      if (isPopupError(e)) {
        await signInWithRedirect(auth, githubProvider);
        return;
      }
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      signInEmail,
      signUpEmail,
      signInGoogle,
      signInGithub,
      signOut,
    }),
    [user, loading, signInEmail, signUpEmail, signInGoogle, signInGithub, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

function isPopupError(e: unknown): boolean {
  if (!(e instanceof FirebaseError)) return false;
  return (
    e.code === "auth/popup-blocked" ||
    e.code === "auth/popup-closed-by-user" ||
    e.code === "auth/cancelled-popup-request" ||
    e.code === "auth/operation-not-supported-in-this-environment"
  );
}

// Re-export for convenience
export { GoogleAuthProvider, GithubAuthProvider };
