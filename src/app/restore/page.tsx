import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { restoreAccountAction, signOutAction } from "@/features/auth/actions";
import { getCurrentSession } from "@/server/auth/guard";

const dateFormat = new Intl.DateTimeFormat("en-MY", {
  dateStyle: "long",
  timeZone: "Asia/Kuala_Lumpur",
});

export const metadata: Metadata = { title: "Restore your account" };

/**
 * The only screen a deletion-scheduled account can reach (requireUser funnels
 * pending_purge here). Uses getCurrentSession directly to avoid the redirect
 * loop.
 */
export default async function RestorePage() {
  const current = await getCurrentSession();
  if (!current) redirect("/sign-in");
  if (current.user.status !== "pending_purge") redirect("/overview");

  const purgeAfter = current.user.purgeAfter;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-page px-4 py-10">
      <main className="w-full max-w-md rounded-card border border-hairline bg-card p-6 sm:p-8">
        <h1 className="text-[19px] font-semibold text-ink">
          Your account is scheduled for deletion
        </h1>
        <div className="mt-4 flex flex-col gap-4">
          <Banner variant="risk">
            {purgeAfter
              ? `Everything you own will be permanently erased after ${dateFormat.format(purgeAfter)}.`
              : "Everything you own will be permanently erased soon."}
          </Banner>
          <p className="text-[13px] leading-6 text-ink-secondary">
            Nothing has been erased yet. Restore your account to pick up exactly where you left off
            — accounts, transactions, budgets, goals, scenarios, and journal are all still here. Or
            sign out and let the deletion complete on schedule.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={restoreAccountAction}>
              <Button type="submit">Restore my account</Button>
            </form>
            <form action={signOutAction}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
