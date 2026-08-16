import type { Metadata } from "next";
import Link from "next/link";

import { RequestResetForm, ResetPasswordForm } from "@/features/auth/forms";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("auth.reset.title") };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <>
      <h1 className="mb-5 text-[19px] font-semibold text-ink">
        {token ? t("auth.reset.set.title") : t("auth.reset.title")}
      </h1>
      {token ? <ResetPasswordForm token={token} /> : <RequestResetForm />}
      <p className="mt-5 text-[13px] text-ink-secondary">
        <Link
          href="/sign-in"
          className="text-accent underline underline-offset-2 hover:no-underline"
        >
          {t("auth.signIn.title")}
        </Link>
      </p>
    </>
  );
}
