import type { Metadata, Viewport } from "next";

import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ExperienceProvider } from "@/lib/experience";
import { ThemeProvider, themeBootstrapScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Privai",
  description: "Gemini-powered workspace for business, coding, and learning.",
  icons: {
    icon: "/privai-mark.svg",
    shortcut: "/privai-mark.svg",
    apple: "/privai-mark.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <ThemeProvider>
          <AuthProvider>
            <ExperienceProvider>{children}</ExperienceProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
