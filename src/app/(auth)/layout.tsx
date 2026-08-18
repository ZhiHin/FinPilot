import Link from "next/link";

import { CursorGlow } from "@/components/motion/cursor-glow";
import { t } from "@/lib/i18n";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-page px-4 py-10">
      <CursorGlow />
      <div className="animate-rise relative mb-6 flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-10 w-10 place-items-center rounded-control bg-accent text-[15px] font-bold text-on-accent"
        >
          F
        </span>
        <div>
          <div className="font-display text-[20px] font-semibold tracking-tight text-ink">
            {t("app.name")}
          </div>
          <div className="text-[13px] text-ink-secondary">{t("app.tagline")}</div>
        </div>
      </div>
      <div className="animate-rise relative w-full max-w-md rounded-card border border-hairline bg-card p-6 shadow-[0_10px_40px_rgba(15,25,45,0.07)] sm:p-8">
        {children}
      </div>
      <p className="mt-6 max-w-md text-center text-[11.5px] text-ink-muted">
        {t("common.notFinancialAdvice")}
      </p>
      <p className="mt-2 text-center text-[11.5px]">
        <Link
          href="/legal/privacy"
          className="text-ink-muted underline underline-offset-2 hover:text-ink-secondary"
        >
          Privacy notice · Notis privasi
        </Link>
      </p>
    </div>
  );
}
