import { t } from "@/lib/i18n";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-page px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-10 w-10 place-items-center rounded-control bg-accent text-[15px] font-bold text-on-accent"
        >
          F
        </span>
        <div>
          <div className="text-[19px] font-semibold text-ink">{t("app.name")}</div>
          <div className="text-[13px] text-ink-secondary">{t("app.tagline")}</div>
        </div>
      </div>
      <div className="w-full max-w-md rounded-card border border-hairline bg-card p-6 sm:p-8">
        {children}
      </div>
      <p className="mt-6 max-w-md text-center text-[11.5px] text-ink-muted">
        {t("common.notFinancialAdvice")}
      </p>
    </div>
  );
}
