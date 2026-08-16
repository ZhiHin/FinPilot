import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="flex min-h-dvh flex-col items-center bg-page px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-control bg-accent text-[13px] font-bold text-on-accent"
        >
          F
        </span>
        <span className="text-[19px] font-semibold text-ink">{t("onboarding.title")}</span>
      </div>
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}
