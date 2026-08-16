import type { Metadata } from "next";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { DEMO_USER } from "@/server/db/seeds/demo";

export const metadata: Metadata = { title: t("overview.title") };

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function OverviewPage() {
  const { user } = await requireUser();
  const prefs = await preferencesRepo.get(getDb(), user.id);
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date()),
  );
  const name = user.displayName || user.email.split("@")[0];
  const isDemo = user.email === DEMO_USER.email;
  const onboarding = (prefs?.onboardingState ?? {}) as { completed?: boolean };

  return (
    <>
      <PageHeader
        title={`${greetingFor(hour)}, ${name}`}
        description={new Intl.DateTimeFormat("en-MY", {
          dateStyle: "full",
          timeZone: timezone,
        }).format(new Date())}
      />

      <div className="flex flex-col gap-4">
        {isDemo ? (
          <Banner variant="info">
            <strong>Demo account.</strong> This is synthetic data for exploring FinPilot — the demo
            financial dataset (accounts &amp; transactions) arrives with Phases 2–3.
          </Banner>
        ) : null}
        {!onboarding.completed ? (
          <Banner variant="info">
            Your setup isn’t finished.{" "}
            <Link href="/onboarding" className="font-semibold underline">
              Continue onboarding
            </Link>{" "}
            to set your payday, accounts, and safety buffer.
          </Banner>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="Safety buffer"
            detail="Money FinPilot will always treat as off-limits (from your settings)."
          >
            <AmountText
              amountMinor={prefs?.safetyBufferMinor ?? 0}
              currency={prefs?.currency ?? "MYR"}
            />
          </StatTile>
          <StatTile label="Timezone" detail="Every date and payday calculation uses this.">
            <span className="text-[15px] font-medium">{timezone}</span>
          </StatTile>
          <StatTile label="Budget style" detail="Chosen during onboarding; used from Phase 5.">
            <span className="text-[15px] font-medium capitalize">
              {prefs?.budgetStyle ?? "Not set"}
            </span>
          </StatTile>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your dashboard is on its way</CardTitle>
          </CardHeader>
          <CardContent className="text-[13px] leading-6 text-ink-secondary">
            <p>
              This Overview will answer three questions at a glance:{" "}
              <em>How much do I have? What can I safely spend? Is anything wrong?</em> The pieces
              arrive phase by phase, and only working features are ever shown:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Balances, accounts, and transactions — Phase 2</li>
              <li>CSV statement import — Phase 3</li>
              <li>Income, spending, and cash-flow summaries — Phase 4</li>
              <li>Budgets and goals — Phase 5 · Upcoming bills — Phase 6</li>
              <li>Safe-to-Spend and forecasts — Phase 7</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
