import type { Metadata } from "next";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";
import { transactionsService } from "@/server/services/transactions";
import { DEMO_USER } from "@/server/db/seeds/demo";

export const metadata: Metadata = { title: t("overview.title") };

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function OverviewPage() {
  const { user } = await requireUser();
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";
  const today = localDateInTz(new Date(), timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
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

  const [netPosition, monthSummary] = await Promise.all([
    accountsService.netPosition(db, user.id),
    transactionsService.summary(db, user.id, { dateFrom: monthStart, dateTo: today }),
  ]);
  const hasAccounts = Object.keys(netPosition).length > 0;
  const myr = netPosition.MYR;
  const myrMonth = monthSummary.MYR;
  const otherCurrencies = Object.keys(netPosition).filter((c) => c !== "MYR");

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
            <strong>Demo account.</strong> Synthetic Malaysian data — explore freely, nothing here
            is real.
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

        {hasAccounts ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Liquid balance" detail="Cash, bank & e-wallets (MYR)">
              <AmountText amountMinor={myr?.liquidMinor ?? 0} currency="MYR" />
            </StatTile>
            <StatTile label="Net worth (MYR)" detail="Assets minus liabilities">
              <AmountText amountMinor={myr?.netMinor ?? 0} currency="MYR" />
            </StatTile>
            <StatTile label="Income this month" detail="Posted, non-excluded">
              <AmountText amountMinor={myrMonth?.incomeMinor ?? 0} currency="MYR" />
            </StatTile>
            <StatTile label="Expenses this month" detail="Refunds already deducted">
              <AmountText amountMinor={myrMonth?.expenseMinor ?? 0} currency="MYR" />
            </StatTile>
          </div>
        ) : (
          <Banner variant="info">
            No accounts yet —{" "}
            <Link href="/accounts" className="font-semibold underline">
              add your first account
            </Link>{" "}
            to see balances here.
          </Banner>
        )}

        {otherCurrencies.length > 0 ? (
          <p className="text-[13px] text-ink-muted">
            Other currencies (never converted or combined):{" "}
            {otherCurrencies.map((currency, index) => (
              <span key={currency}>
                {index > 0 ? " · " : ""}
                {currency}{" "}
                <AmountText amountMinor={netPosition[currency].netMinor} currency={currency} />
              </span>
            ))}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="Safety buffer"
            detail="Money FinPilot will always treat as off-limits (from your settings)."
          >
            <AmountText
              amountMinor={prefs?.safetyBufferMinor ?? 0}
              currency={(prefs?.currency ?? "MYR").trim()}
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
            <CardTitle>What arrives next</CardTitle>
          </CardHeader>
          <CardContent className="text-[13px] leading-6 text-ink-secondary">
            <p>
              Accounts, transactions, transfers, splits, and the review workflow are live. The rest
              of the Overview builds up phase by phase — only working features are ever shown:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>CSV statement import — Phase 3</li>
              <li>Cash-flow charts and full analytics — Phase 4</li>
              <li>Budgets and goals — Phase 5 · Upcoming bills — Phase 6</li>
              <li>Safe-to-Spend and forecasts — Phase 7</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
