"use client";

interface PrivaiDesktopBridge {
  platform?: string;
  pairingCode?: string;
  apiUrl?: string;
  chooseWorkspace?: () => Promise<string | null>;
  createWorkspace?: (name: string) => Promise<string | null>;
  setWorkspace?: (path: string) => Promise<string | null>;
  openLogs?: () => Promise<void>;
  openAppData?: () => Promise<void>;
  revealEnvFile?: () => Promise<void>;
}

export function desktopBridge(): PrivaiDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { privaiDesktop?: PrivaiDesktopBridge };
  return w.privaiDesktop ?? null;
}

export async function chooseDesktopWorkspace(): Promise<string | null> {
  return (await desktopBridge()?.chooseWorkspace?.()) ?? null;
}

export async function createDesktopWorkspace(name: string): Promise<string | null> {
  return (await desktopBridge()?.createWorkspace?.(name)) ?? null;
}

export async function setDesktopWorkspace(path: string): Promise<string | null> {
  return (await desktopBridge()?.setWorkspace?.(path)) ?? null;
}

export async function openDesktopLogs(): Promise<void> {
  await desktopBridge()?.openLogs?.();
}

export async function openDesktopAppData(): Promise<void> {
  await desktopBridge()?.openAppData?.();
}

export async function revealDesktopEnvFile(): Promise<void> {
  await desktopBridge()?.revealEnvFile?.();
}
