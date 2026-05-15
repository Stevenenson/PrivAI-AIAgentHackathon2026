"use client";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "@/lib/auth";
import type { PrivacyMode } from "@/lib/types";

export type Persona = "business" | "developer" | "creator" | "student";
export type DetailLevel = "simple" | "balanced" | "technical";
export type PrimaryGoal = "automate" | "build" | "research" | "documents";

export interface ExperiencePrefs {
  persona: Persona;
  detailLevel: DetailLevel;
  primaryGoal: PrimaryGoal;
  businessContext: string;
  privacyMode: PrivacyMode;
  askBeforeCommands: boolean;
  autoApproveReadOnlyCommands: boolean;
  onboardingDone: boolean;
  updatedAt: number;
}

interface ExperienceContextValue {
  prefs: ExperiencePrefs;
  loaded: boolean;
  savePrefs: (patch: Partial<ExperiencePrefs>) => void;
  resetOnboarding: () => void;
}

const DEFAULT_PREFS: ExperiencePrefs = {
  persona: "business",
  detailLevel: "balanced",
  primaryGoal: "automate",
  businessContext: "",
  privacyMode: "cloud",
  askBeforeCommands: true,
  autoApproveReadOnlyCommands: false,
  onboardingDone: false,
  updatedAt: 0,
};

const ExperienceContext = createContext<ExperienceContextValue | null>(null);

function storageKey(uid?: string) {
  return `privai.experience.${uid || "local"}`;
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<ExperiencePrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancel = false;
    let next = DEFAULT_PREFS;
    try {
      const raw = localStorage.getItem(storageKey(user?.uid));
      const parsed = raw ? JSON.parse(raw) : {};
      next = { ...DEFAULT_PREFS, ...parsed, privacyMode: "cloud" };
    } catch {
      next = DEFAULT_PREFS;
    }
    const timer = window.setTimeout(() => {
      if (cancel) return;
      setPrefs(next);
      setLoaded(true);
    }, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [user?.uid]);

  const savePrefs = useCallback(
    (patch: Partial<ExperiencePrefs>) => {
      const next = {
        ...prefs,
        ...patch,
        updatedAt: Date.now(),
      };
      setPrefs(next);
      localStorage.setItem(storageKey(user?.uid), JSON.stringify(next));
    },
    [prefs, user?.uid],
  );

  const resetOnboarding = useCallback(() => {
    savePrefs({ onboardingDone: false });
  }, [savePrefs]);

  const value = useMemo(
    () => ({ prefs, loaded, savePrefs, resetOnboarding }),
    [prefs, loaded, savePrefs, resetOnboarding],
  );

  return (
    <ExperienceContext.Provider value={value}>
      {children}
    </ExperienceContext.Provider>
  );
}

export function useExperience() {
  const ctx = useContext(ExperienceContext);
  if (!ctx) throw new Error("useExperience must be inside ExperienceProvider");
  return ctx;
}

export function personaLabel(persona: Persona) {
  if (persona === "developer") return "Developer";
  if (persona === "creator") return "Creator";
  if (persona === "student") return "Student";
  return "Business";
}

export function goalLabel(goal: PrimaryGoal) {
  if (goal === "build") return "Build apps";
  if (goal === "research") return "Research";
  if (goal === "documents") return "Documents";
  return "Automate work";
}

export function experienceForRequest(prefs: ExperiencePrefs) {
  return {
    persona: prefs.persona,
    primaryGoal: prefs.primaryGoal,
    detailLevel: prefs.detailLevel,
    businessContext: prefs.businessContext.trim(),
    privacyMode: "cloud",
    autoApproveReadOnlyCommands: prefs.autoApproveReadOnlyCommands,
  };
}
