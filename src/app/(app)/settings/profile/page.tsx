import type { Metadata } from "next";

import { ChangePasswordForm, ProfileForm } from "@/features/settings/forms";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";

export const metadata: Metadata = { title: t("settings.profile.title") };

export default async function ProfileSettingsPage() {
  const { user } = await requireUser();
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="mb-4 text-[19px] font-semibold text-ink">
          {t("settings.profile.title")}
        </h2>
        <ProfileForm displayName={user.displayName ?? ""} email={user.email} />
      </section>
      <section aria-labelledby="password-heading">
        <h2 id="password-heading" className="mb-4 text-[19px] font-semibold text-ink">
          Password
        </h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
