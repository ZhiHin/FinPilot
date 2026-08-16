import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignInForm } from "@/features/auth/forms";
import { t } from "@/lib/i18n";
import { getCurrentSession } from "@/server/auth/guard";
import { safeInternalPath } from "@/server/auth/schemas";

export const metadata: Metadata = { title: t("auth.signIn.title") };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  // Real session check (not just cookie presence): valid session goes to the app.
  const current = await getCurrentSession();
  const params = await searchParams;
  if (current) {
    redirect(safeInternalPath(params.next, "/overview"));
  }

  return (
    <>
      <h1 className="mb-5 text-[19px] font-semibold text-ink">{t("auth.signIn.title")}</h1>
      <SignInForm
        next={params.next}
        notice={params.reset === "done" ? t("auth.reset.success") : undefined}
      />
      <div className="mt-5 flex flex-col gap-2 text-[13px] text-ink-secondary">
        <Link
          href="/reset-password"
          className="text-accent underline underline-offset-2 hover:no-underline"
        >
          {t("auth.signIn.forgot")}
        </Link>
        <p>
          {t("auth.signIn.noAccount")}{" "}
          <Link
            href="/sign-up"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            {t("auth.signIn.createAccount")}
          </Link>
        </p>
      </div>
    </>
  );
}
