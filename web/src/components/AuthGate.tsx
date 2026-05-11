"use client";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";

import { useAuth } from "@/lib/auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-dvh grid place-items-center text-muted">
        <Pulse />
      </div>
    );
  }
  return <>{children}</>;
}

function Pulse() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-2 w-2 rounded-full bg-accent animate-ping" />
      <span className="text-sm">loading…</span>
    </div>
  );
}
