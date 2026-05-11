"use client";
import { Sidebar } from "@/components/Sidebar";
import { AuthGate } from "@/components/AuthGate";
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
  if (!user) return null;
  return (
    <div className="min-h-dvh grid grid-cols-[280px_1fr] max-md:grid-cols-1">
      <Sidebar />
      <div className="min-h-dvh flex flex-col bg-bg">{children}</div>
    </div>
  );
}
