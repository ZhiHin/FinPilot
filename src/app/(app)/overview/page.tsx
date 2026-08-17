import type { Metadata } from "next";
import Link from "next/link";

import { AmountText } from "@/components/ui/amount-text";
import { Banner } from "@/components/ui/banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { BarList } from "@/components/charts/bar-list";
import { ChartCard, ChartDataTable } from "@/components/charts/chart-card";
import { formatBp, longMonthLabel } from "@/components/charts/format";
import { IncomeExpenseBars } from "@/components/charts/flow-bars";
import { drillDownHref, type AnalyticsState } from "@/features/analytics/search-params";
import { comparisonText, periodDisplayLabel } from "@/features/analytics/summary";
import { cn } from "@/lib/cn";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { formatMinor } from "@/lib/money";
import { PERIOD_OPTIONS, previousPeriod, resolvePeriod, shiftRangeMonthsBack } from "@/lib/periods";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { DEMO_USER } from "@/server/db/seeds/demo";
import { accountsService } from "@/server/services/accounts";
import { analyticsService, type PeriodTotals } from "@/server/services/analytics";
import { transactionsService } from "@/server/services/transactions";

export const metadata: Metadata = { title: t("overview.title") };

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function unwrapOr<T>(result: { ok: true; data: T } | { ok: false }, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";
  const today = localDateInTz(new Date(), timezone);
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

  const period = resolvePeriod(sp.period ?? "this-month", today);
  const prev = previousPeriod(period.dateFrom, period.dateTo);
  const trendRange = shiftRangeMonthsBack(period.dateTo, 6);

  const [
    netPosition,
    totalsRes,
    prevTotalsRes,
    flowsRes,
    categoriesRes,
    merchantsRes,
    qualityRes,
    recent,
  ] = await Promise.all([
    accountsService.netPosition(db, user.id),
    analyticsService.periodTotals(db, user.id, period),
    analyticsService.periodTotals(db, user.id, prev),
    analyticsService.monthlyFlows(db, user.id, trendRange),
    analyticsService.categoryBreakdown(db, user.id, { ...period, kind: "expense" }),
    analyticsService.topMerchants(db, user.id, { ...period, limit: 5 }),
    analyticsService.dataQuality(db, user.id, period),
    transactionsService.list(db, user.id, { limit: 5 }),
  ]);

  const totals = unwrapOr<Record<string, PeriodTotals>>(totalsRes, {});
  const prevTotals = unwrapOr<Record<string, PeriodTotals>>(prevTotalsRes, {});
  const flows = unwrapOr(flowsRes, []);
  const categories = unwrapOr(categoriesRes, []);
  const merchants = unwrapOr(merchantsRes, []);
  const quality = unwrapOr(qualityRes, null);

  const hasAccounts = Object.keys(netPosition).length > 0;
  const currencies = [...new Set([...Object.keys(netPosition), ...Object.keys(totals)])].sort(
    (a, b) => (a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b)),
  );
  const flowCurrencies = currencies.filter(
    (c) => totals[c] || flows.some((f) => f.currency === c && (f.incomeMinor || f.expenseMinor)),
  );
  const periodLabel = periodDisplayLabel(period.dateFrom, period.dateTo, period.incomplete);

  // Drill-down state passed to category/merchant links (period + no filters).
  const drillState: AnalyticsState = {
    period,
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    compare: "none",
    filtered: false,
  };
  const backHref = sp.period ? `/overview?period=${sp.period}` : "/overview";

  return (
    <>
      <PageHeader
        title={`${greetingFor(hour)}, ${name}`}
        description={new Intl.DateTimeFormat("en-MY", {
          dateStyle: "full",
          timeZone: timezone,
        }).format(new Date())}
        actions={
          <Link
            href="/analytics"
            className="text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            Open Analytics
          </Link>
        }
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

        {!hasAccounts ? (
          <Banner variant="info">
            No accounts yet —{" "}
            <Link href="/accounts" className="font-semibold underline">
              add your first account
            </Link>{" "}
            to see balances here.
          </Banner>
        ) : (
          <>
            {/* ---- Net position (always current, per currency, never combined) ---- */}
            <section aria-labelledby="net-position-heading" className="flex flex-col gap-3">
              <h2 id="net-position-heading" className="text-[15px] font-semibold text-ink">
                Where you stand today
              </h2>
              {currencies
                .filter((c) => netPosition[c])
                .map((currency) => (
                  <div key={currency} className="flex flex-col gap-2">
                    {currencies.length > 1 ? (
                      <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-muted">
                        {currency} accounts (currencies are never combined)
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <StatTile label="Liquid" detail="Cash, bank & e-wallets">
                        <AmountText
                          amountMinor={netPosition[currency].liquidMinor}
                          currency={currency}
                        />
                      </StatTile>
                      <StatTile label="Assets" detail="Everything you own">
                        <AmountText
                          amountMinor={netPosition[currency].assetsMinor}
                          currency={currency}
                        />
                      </StatTile>
                      <StatTile label="Liabilities" detail="Cards & loans (sign kept)">
                        <AmountText
                          amountMinor={netPosition[currency].liabilitiesMinor}
                          currency={currency}
                        />
                      </StatTile>
                      <StatTile label="Net position" detail="Assets plus liabilities">
                        <AmountText
                          amountMinor={netPosition[currency].netMinor}
                          currency={currency}
                        />
                      </StatTile>
                    </div>
                  </div>
                ))}
            </section>

            {/* ---- Period flows ---- */}
            <section aria-labelledby="flows-heading" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="flows-heading" className="text-[15px] font-semibold text-ink">
                  This period
                </h2>
                <nav aria-label="Reporting period" className="flex flex-wrap gap-1">
                  {PERIOD_OPTIONS.map((option) => {
                    const active = period.key === option.key;
                    return (
                      <Link
                        key={option.key}
                        href={
                          option.key === "this-month"
                            ? "/overview"
                            : `/overview?period=${option.key}`
                        }
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "rounded-chip px-3 py-1 text-[12.5px]",
                          active
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-ink-secondary hover:bg-sunken",
                        )}
                      >
                        {option.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
              <p className="text-[12.5px] text-ink-muted">
                {periodLabel}
                {period.incomplete
                  ? " — figures grow as the period continues; comparisons use the same number of days."
                  : ""}
              </p>

              {flowCurrencies.length === 0 ? (
                <Card>
                  <CardContent className="text-[13px] text-ink-muted">
                    No income or spending recorded in this period yet. Add transactions or{" "}
                    <Link href="/imports" className="font-medium text-accent underline">
                      import a statement
                    </Link>
                    .
                  </CardContent>
                </Card>
              ) : (
                flowCurrencies.map((currency) => {
                  const t9 = totals[currency];
                  const p9 = prevTotals[currency];
                  const currencyFlows = flows.filter((f) => f.currency === currency);
                  return (
                    <div key={currency} className="flex flex-col gap-4">
                      {flowCurrencies.length > 1 ? (
                        <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-muted">
                          {currency} activity
                        </p>
                      ) : null}
                      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <StatTile
                          label="Income"
                          detail={comparisonText(t9?.incomeMinor ?? 0, p9?.incomeMinor ?? 0)}
                        >
                          <AmountText amountMinor={t9?.incomeMinor ?? 0} currency={currency} />
                        </StatTile>
                        <StatTile
                          label="Expenses"
                          detail={comparisonText(t9?.expenseMinor ?? 0, p9?.expenseMinor ?? 0)}
                        >
                          <AmountText amountMinor={t9?.expenseMinor ?? 0} currency={currency} />
                        </StatTile>
                        <StatTile
                          label="Savings"
                          detail={comparisonText(t9?.savingsMinor ?? 0, p9?.savingsMinor ?? 0)}
                        >
                          <AmountText amountMinor={t9?.savingsMinor ?? 0} currency={currency} />
                        </StatTile>
                        <StatTile
                          label="Savings rate"
                          detail={
                            t9?.savingsRateBp === null
                              ? "No income this period, so no rate is shown"
                              : "Savings as a share of income"
                          }
                        >
                          <span className="num text-[15px] font-medium">
                            {t9?.savingsRateBp != null ? formatBp(t9.savingsRateBp) : "—"}
                          </span>
                        </StatTile>
                      </div>

                      <ChartCard
                        title={`Cash flow · ${currency}`}
                        description="Income and expenses per month for the last six months."
                        chart={<IncomeExpenseBars data={currencyFlows} currency={currency} />}
                        table={
                          <ChartDataTable
                            caption={`Monthly income and expenses in ${currency}`}
                            headers={["Month", "Income", "Expenses", "Savings"]}
                            rows={currencyFlows.map((f) => [
                              longMonthLabel(f.month),
                              formatMinor(f.incomeMinor, currency),
                              formatMinor(f.expenseMinor, currency),
                              formatMinor(f.savingsMinor, currency),
                            ])}
                          />
                        }
                      />
                    </div>
                  );
                })
              )}
            </section>

            {/* ---- Spending detail ---- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top spending categories</CardTitle>
                </CardHeader>
                <CardContent>
                  {categories.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">No categorized spending yet.</p>
                  ) : (
                    currencies
                      .filter((c) => categories.some((row) => row.currency === c))
                      .map((currency) => (
                        <div key={currency} className="mb-3 last:mb-0">
                          {flowCurrencies.length > 1 ? (
                            <p className="mb-1 text-[11.5px] uppercase tracking-wide text-ink-muted">
                              {currency}
                            </p>
                          ) : null}
                          <BarList
                            currency={currency}
                            hueVar="--chart-2"
                            items={categories
                              .filter((row) => row.currency === currency)
                              .slice(0, 5)
                              .map((row) => ({
                                key: row.categoryId ?? "uncategorized",
                                label: row.categoryName,
                                detail: row.groupName,
                                amountMinor: row.amountMinor,
                                href: row.categoryId
                                  ? drillDownHref(
                                      drillState,
                                      { categoryId: row.categoryId },
                                      backHref,
                                    )
                                  : null,
                              }))}
                          />
                        </div>
                      ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top merchants</CardTitle>
                </CardHeader>
                <CardContent>
                  {merchants.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">
                      No merchant spending recorded in this period.
                    </p>
                  ) : (
                    currencies
                      .filter((c) => merchants.some((row) => row.currency === c))
                      .map((currency) => (
                        <div key={currency} className="mb-3 last:mb-0">
                          {flowCurrencies.length > 1 ? (
                            <p className="mb-1 text-[11.5px] uppercase tracking-wide text-ink-muted">
                              {currency}
                            </p>
                          ) : null}
                          <BarList
                            currency={currency}
                            hueVar="--chart-1"
                            items={merchants
                              .filter((row) => row.currency === currency)
                              .map((row) => ({
                                key: row.merchantId,
                                label: row.name,
                                detail: `${row.txnCount} transaction${row.txnCount === 1 ? "" : "s"}`,
                                amountMinor: row.spendMinor,
                                href: drillDownHref(drillState, { search: row.name }, backHref),
                              }))}
                          />
                        </div>
                      ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ---- Recent activity + data quality ---- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <CardTitle>Recent transactions</CardTitle>
                  <Link
                    href="/transactions"
                    className="text-[12.5px] font-medium text-accent underline underline-offset-2 hover:no-underline"
                  >
                    View all
                  </Link>
                </CardHeader>
                <CardContent>
                  {recent.items.length === 0 ? (
                    <p className="text-[13px] text-ink-muted">Nothing recorded yet.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-hairline">
                      {recent.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-3 py-1.5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] text-ink">
                              {item.merchantName ?? item.descriptionOriginal ?? "(no description)"}
                            </span>
                            <span className="text-[11.5px] text-ink-muted">
                              {formatIsoDate(item.txnDate, "en-MY")} · {item.accountName}
                              {item.status === "pending" ? " · pending" : ""}
                            </span>
                          </span>
                          <AmountText
                            amountMinor={item.amountMinor}
                            currency={item.currency.trim()}
                            className="text-[13px]"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Data quality</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-[13px] text-ink-secondary">
                  {quality &&
                  (quality.pendingCount ||
                    quality.needsReviewCount ||
                    quality.uncommittedImportJobs) ? (
                    <>
                      {quality.needsReviewCount > 0 ? (
                        <p>
                          <Link
                            href="/transactions?view=review"
                            className="font-medium text-accent underline"
                          >
                            {quality.needsReviewCount} transaction
                            {quality.needsReviewCount === 1 ? "" : "s"} need review
                          </Link>{" "}
                          — categorizing them keeps these numbers accurate.
                        </p>
                      ) : null}
                      {quality.pendingCount > 0 ? (
                        <p>
                          {quality.pendingCount} pending transaction
                          {quality.pendingCount === 1 ? "" : "s"} in this period are not counted
                          until they post.
                        </p>
                      ) : null}
                      {quality.uncommittedImportJobs > 0 ? (
                        <p>
                          <Link href="/imports" className="font-medium text-accent underline">
                            {quality.uncommittedImportJobs} statement import
                            {quality.uncommittedImportJobs === 1 ? "" : "s"} awaiting confirmation
                          </Link>{" "}
                          — staged rows are not in your ledger yet.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-ink-muted">
                      Nothing needs your attention — pending, unreviewed, and half-imported items
                      would be flagged here.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Setup strip: onboarding choices stay visible regardless of data. */}
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
          <StatTile label="Timezone" detail="Every date and period boundary uses this.">
            <span className="text-[15px] font-medium">{timezone}</span>
          </StatTile>
          <StatTile label="Budget style" detail="Chosen during onboarding; used from Phase 5.">
            <span className="text-[15px] font-medium capitalize">
              {prefs?.budgetStyle ?? "Not set"}
            </span>
          </StatTile>
        </div>
      </div>
    </>
  );
}
