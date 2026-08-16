import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/features/auth/forms";
import { t } from "@/lib/i18n";
import { getCurrentSession } from "@/server/auth/guard";

export const metadata: Metadata = { title: t("auth.signUp.title") };

export default async function SignUpPage() {
  if (await getCurrentSession()) {
    redirect("/overview");
  }
  return (
    <>
      <h1 className="mb-5 text-[19px] font-semibold text-ink">{t("auth.signUp.title")}</h1>
      <SignUpForm />
      <p className="mt-5 text-[13px] text-ink-secondary">
        {t("auth.signUp.haveAccount")}{" "}
        <Link
          href="/sign-in"
          className="text-accent underline underline-offset-2 hover:no-underline"
        >
          {t("auth.signIn.submit")}
        </Link>
      </p>
    </>
  );
}
