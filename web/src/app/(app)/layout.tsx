"use client";
import { useState } from "react";

import { Sidebar } from "@/components/Sidebar";
import { AuthGate } from "@/components/AuthGate";
import { CommandPalette } from "@/components/CommandPalette";
import { OnboardingQuiz } from "@/components/OnboardingQuiz";
import { PrivacyStatusBar } from "@/components/PrivacyStatusBar";
import { useAuth } from "@/lib/auth";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <Shell>{children}</Shell>
    </AuthGate>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  if (!user) return null;
  return (
    <div
      className={
        sidebarCollapsed
          ? "h-dvh overflow-hidden grid grid-cols-[76px_1fr] max-md:grid-cols-1"
          : "h-dvh overflow-hidden grid grid-cols-[280px_1fr] max-md:grid-cols-1"
      }
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      <div className="h-dvh min-h-0 overflow-hidden flex flex-col bg-bg">
        <PrivacyStatusBar />
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {children}
        </main>
        <OnboardingQuiz />
        <CommandPalette />
      </div>
    </div>
  );
}
