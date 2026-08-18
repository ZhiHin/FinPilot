import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";

import { PrivacyProvider } from "@/components/providers/privacy-provider";
import { ToastProvider } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { getCurrentSession } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";

import "./globals.css";

/**
 * Three type roles (design doc §5, revised at the Phase 10 visual pass):
 * Inter keeps every dense UI surface — tables, forms, body — because nothing
 * beats it for legibility at 13px. Archivo carries the voice in headings and
 * instrument labels. Plex Mono is reserved for the large readouts, where
 * fixed-width digits read like an instrument rather than prose.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-readout",
});

export const metadata: Metadata = {
  title: { default: t("app.name"), template: `%s · ${t("app.name")}` },
  description: t("app.tagline"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf0f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1017" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme comes from server-rendered preferences: no flash, no inline script.
  const current = await getCurrentSession();
  const prefs = current ? await preferencesRepo.get(getDb(), current.user.id) : null;
  const theme = prefs?.theme ?? "system";

  return (
    <html
      lang="en-MY"
      data-theme={theme === "system" ? undefined : theme}
      data-scroll-behavior="smooth"
    >
      <body className={`${inter.variable} ${archivo.variable} ${plexMono.variable} antialiased`}>
        <PrivacyProvider>
          <ToastProvider>{children}</ToastProvider>
        </PrivacyProvider>
      </body>
    </html>
  );
}
