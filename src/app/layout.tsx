import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { PrivacyProvider } from "@/components/providers/privacy-provider";
import { ToastProvider } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { getCurrentSession } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: t("app.name"), template: `%s · ${t("app.name")}` },
  description: t("app.tagline"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1219" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme comes from server-rendered preferences: no flash, no inline script.
  const current = await getCurrentSession();
  const prefs = current ? await preferencesRepo.get(getDb(), current.user.id) : null;
  const theme = prefs?.theme ?? "system";

  return (
    <html lang="en-MY" data-theme={theme === "system" ? undefined : theme}>
      <body className={`${inter.variable} antialiased`}>
        <PrivacyProvider>
          <ToastProvider>{children}</ToastProvider>
        </PrivacyProvider>
      </body>
    </html>
  );
}
