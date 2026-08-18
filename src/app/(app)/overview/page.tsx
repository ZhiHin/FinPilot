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
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ForecastBandChart } from "@/components/charts/forecast-band";
import { HealthBadge } from "@/features/budgets/labels";
import { TimeStatusBadge } from "@/features/goals/labels";
import { SafeToSpendCard } from "@/features/intel/sts-card";
import { intelService } from "@/server/services/intel";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { DEMO_USER } from "@/server/db/seeds/demo";
import { accountsService } from "@/server/services/accounts";
import { analyticsService, type PeriodTotals } from "@/server/services/analytics";
import { budgetsService } from "@/server/services/budgets";
import { goalsService } from "@/server/services/goals";
import { recurringService } from "@/server/services/recurring";
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

function hasAccountsPrecheck(netPosition: Record<string, unknown>): boolean {
  return Object.keys(netPosition).length > 0;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; forecast?: string }>;
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
    budgetList,
    goals,
  ] = await Promise.all([
    accountsService.netPosition(db, user.id),
    analyticsService.periodTotals(db, user.id, period),
    analyticsService.periodTotals(db, user.id, prev),
    analyticsService.monthlyFlows(db, user.id, trendRange),
    analyticsService.categoryBreakdown(db, user.id, { ...period, kind: "expense" }),
    analyticsService.topMerchants(db, user.id, { ...period, limit: 5 }),
    analyticsService.dataQuality(db, user.id, period),
    transactionsService.list(db, user.id, { limit: 5 }),
    budgetsService.list(db, user.id),
    goalsService.listWithProgress(db, user.id, today),
  ]);
  // Phase 6: upcoming recurring bills (next 14 days) — read-only, no scan here.
  const upcoming = await recurringService.upcoming(db, user.id, { from: today, days: 14 });
  const upcomingDue = upcoming.due.slice(0, 5);

  // Phase 7: Safe-to-Spend, cash-flow forecast, and the top insight.
  const horizonDays = sp.forecast === "60" ? 60 : sp.forecast === "90" ? 90 : 30;
  const stsRes = hasAccountsPrecheck(netPosition)
    ? await intelService.safeToSpend(db, user.id, today)
    : null;
  const forecastRes = hasAccountsPrecheck(netPosition)
    ? await intelService.cashFlowForecast(db, user.id, { horizonDays, today })
    : null;
  await intelService.generateInsightsIfStale(db, user.id, today);
  const topInsight =
    (await intelService.listInsights(db, user.id)).find(
      (i) => i.type !== "budget_suggestion" && i.status !== "actioned",
    ) ?? null;

  // Phase 5: compact budget snapshot (first active budget, current cycle).
  const activeBudget = budgetList.find((b) => b.isActive) ?? null;
  const budgetReportRes = activeBudget
    ? await budgetsService.periodReport(db, user.id, { budgetId: activeBudget.id, today })
    : null;
  const budgetReport = budgetReportRes && budgetReportRes.ok ? budgetReportRes.data : null;
  const HEALTH_SEVERITY = { exceeded: 3, at_risk: 2, watch: 1 } as const;
  const riskyCategories = budgetReport
    ? budgetReport.allocations
        .filter((a) => a.health === "exceeded" || a.health === "at_risk" || a.health === "watch")
        .sort(
          (a, b) =>
            HEALTH_SEVERITY[b.health as keyof typeof HEALTH_SEVERITY] -
            HEALTH_SEVERITY[a.health as keyof typeof HEALTH_SEVERITY],
        )
        .slice(0, 2)
    : [];
  const activeGoals = goals.filter((g) => g.status === "active");
  const topGoals = activeGoals.slice(0, 3);
  const behindGoals = activeGoals.filter(
    (g) => g.outlook.timeStatus === "behind" || g.outlook.timeStatus === "overdue",
  );

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
            {/* ---- Phase 7: Safe-to-Spend + the top insight ---- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {stsRes?.ok ? <SafeToSpendCard view={stsRes.data} /> : null}
              {topInsight ? (
                <Card>
                  <CardContent className="flex flex-col gap-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium uppercase tracking-wide text-ink-muted">
                        Top insight
                      </span>
                      {topInsight.severity === "risk" ? (
                        <Badge variant="risk">Needs attention</Badge>
                      ) : topInsight.severity === "attention" ? (
                        <Badge variant="attention">Worth a look</Badge>
                      ) : (
                        <Badge variant="info">Info</Badge>
                      )}
                    </p>
                    <p className="text-[15px] font-semibold text-ink">{topInsight.title}</p>
                    <p className="text-[13px] text-ink-secondary">{topInsight.body}</p>
                    <Link
                      href="/insights"
                      className="text-[13px] font-medium text-accent underline underline-offset-2"
                    >
                      See the evidence
                    </Link>
                  </CardContent>
                </Card>
              ) : null}
            </div>

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
                    <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
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
                      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
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

            {/* ---- Phase 7: projected balance with uncertainty band ---- */}
            {forecastRes?.ok ? (
              <ChartCard
                title={`Projected balance · ${forecastRes.data.currency}`}
                description={`Next ${horizonDays} days: recurring bills and income projected forward plus your typical non-recurring spending (transparent statistical method, three bands — never a black box).`}
                chart={
                  <ForecastBandChart
                    data={forecastRes.data.series}
                    currency={forecastRes.data.currency}
                  />
                }
                table={
                  <ChartDataTable
                    caption={`Projected balance for the next ${horizonDays} days`}
                    headers={["Date", "Conservative", "Expected", "Optimistic"]}
                    rows={forecastRes.data.series
                      .filter((_, index) => index % 7 === 6 || index === 0)
                      .map((point) => [
                        formatIsoDate(point.date, "en-MY"),
                        formatMinor(point.conservativeMinor, forecastRes.data.currency),
                        formatMinor(point.expectedMinor, forecastRes.data.currency),
                        formatMinor(point.optimisticMinor, forecastRes.data.currency),
                      ])}
                  />
                }
                footer={
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                    <span className="text-ink-secondary">
                      Lowest expected:{" "}
                      <AmountText
                        amountMinor={forecastRes.data.lowestExpected.balanceMinor}
                        currency={forecastRes.data.currency}
                      />{" "}
                      on {formatIsoDate(forecastRes.data.lowestExpected.date, "en-MY")} ·
                      conservative bottom{" "}
                      <AmountText
                        amountMinor={forecastRes.data.lowestConservative.balanceMinor}
                        currency={forecastRes.data.currency}
                      />
                    </span>
                    {/* Static children: keyed arrays inside client-component
                        props drop their keys across the RSC boundary. */}
                    <nav aria-label="Forecast horizon" className="flex gap-1">
                      <Link
                        href={sp.period ? `/overview?period=${sp.period}` : "/overview"}
                        aria-current={horizonDays === 30 ? "page" : undefined}
                        className={cn(
                          "rounded-chip px-2.5 py-0.5",
                          horizonDays === 30
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-ink-secondary hover:bg-sunken",
                        )}
                      >
                        30d
                      </Link>
                      <Link
                        href={`/overview?${new URLSearchParams({ ...(sp.period ? { period: sp.period } : {}), forecast: "60" }).toString()}`}
                        aria-current={horizonDays === 60 ? "page" : undefined}
                        className={cn(
                          "rounded-chip px-2.5 py-0.5",
                          horizonDays === 60
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-ink-secondary hover:bg-sunken",
                        )}
                      >
                        60d
                      </Link>
                      <Link
                        href={`/overview?${new URLSearchParams({ ...(sp.period ? { period: sp.period } : {}), forecast: "90" }).toString()}`}
                        aria-current={horizonDays === 90 ? "page" : undefined}
                        className={cn(
                          "rounded-chip px-2.5 py-0.5",
                          horizonDays === 90
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-ink-secondary hover:bg-sunken",
                        )}
                      >
                        90d
                      </Link>
                    </nav>
                  </div>
                }
              />
            ) : null}

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

        {/* ---- Phase 5/6: budget, goals, and upcoming-bill snapshots (real data) ---- */}
        {hasAccounts ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Budget this cycle</CardTitle>
                <Link
                  href="/budget"
                  className="text-[12.5px] font-medium text-accent underline underline-offset-2 hover:no-underline"
                >
                  Open budget
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {budgetReport ? (
                  <>
                    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
                      <span className="num text-ink">
                        <AmountText
                          amountMinor={budgetReport.totals.postedMinor}
                          currency={budgetReport.budget.currency}
                        />
                      </span>
                      of
                      <span className="num">
                        <AmountText
                          amountMinor={budgetReport.totals.availableMinor}
                          currency={budgetReport.budget.currency}
                        />
                      </span>
                      spent · <HealthBadge health={budgetReport.totals.health} />
                    </p>
                    <Progress
                      value={
                        budgetReport.totals.usageBp === null
                          ? 0
                          : Math.min(budgetReport.totals.usageBp, 10000)
                      }
                      max={10000}
                      label={
                        budgetReport.totals.usageBp === null
                          ? "Budget usage: no allocations yet"
                          : `Budget usage: ${formatBp(budgetReport.totals.usageBp)} of the available budget spent`
                      }
                    />
                    {budgetReport.allocations.length === 0 ? (
                      <p className="text-[12.5px] text-ink-muted">
                        No categories allocated for this cycle yet —{" "}
                        <Link href="/budget" className="font-medium text-accent underline">
                          plan the cycle
                        </Link>
                        .
                      </p>
                    ) : riskyCategories.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
                        {riskyCategories.map((row) => (
                          <li
                            key={row.allocationId}
                            className="flex items-center justify-between gap-2"
                          >
                            <span>{row.categoryName}</span>
                            <span className="flex items-center gap-2">
                              <span className="num">
                                <AmountText
                                  amountMinor={row.remainingMinor}
                                  currency={budgetReport.budget.currency}
                                />{" "}
                                left
                              </span>
                              <HealthBadge health={row.health} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12.5px] text-ink-muted">
                        No categories need attention right now.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-ink-muted">
                    No budget yet —{" "}
                    <Link href="/budget" className="font-medium text-accent underline">
                      create one
                    </Link>{" "}
                    to watch spending pace per category.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Savings goals</CardTitle>
                <Link
                  href="/goals"
                  className="text-[12.5px] font-medium text-accent underline underline-offset-2 hover:no-underline"
                >
                  Open goals
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {topGoals.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    No active goals —{" "}
                    <Link href="/goals" className="font-medium text-accent underline">
                      create one
                    </Link>{" "}
                    (an emergency fund is the classic first goal).
                  </p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-3">
                      {topGoals.map((goal) => (
                        <li key={goal.id} className="flex flex-col gap-1">
                          <span className="flex items-center justify-between gap-2 text-[13px]">
                            <Link
                              href={`/goals/${goal.id}`}
                              className="font-medium text-ink underline-offset-2 hover:underline"
                            >
                              {goal.name}
                            </Link>
                            <span className="flex items-center gap-2">
                              <span className="num text-ink-secondary">
                                {formatBp(Math.min(goal.outlook.progressBp, 10000))}
                              </span>
                              <TimeStatusBadge status={goal.outlook.timeStatus} />
                            </span>
                          </span>
                          <Progress
                            value={Math.min(goal.outlook.progressBp, 10000)}
                            max={10000}
                            label={`${goal.name}: ${formatBp(goal.outlook.progressBp)} of the target saved`}
                          />
                        </li>
                      ))}
                    </ul>
                    {behindGoals.length > 0 ? (
                      <p className="text-[12.5px] text-ink-secondary">
                        {behindGoals.length} goal{behindGoals.length === 1 ? " is" : "s are"} behind
                        schedule at the current contribution rate.
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Upcoming bills</CardTitle>
                <Link
                  href="/recurring"
                  className="text-[12.5px] font-medium text-accent underline underline-offset-2 hover:no-underline"
                >
                  Open recurring
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {upcoming.clusters.length > 0 ? (
                  <Banner variant="attention">
                    {upcoming.clusters[0].count} bills cluster around{" "}
                    {formatIsoDate(upcoming.clusters[0].start, "en-MY")} —{" "}
                    <AmountText amountMinor={upcoming.clusters[0].totalMinor} currency="MYR" /> in
                    total.
                  </Banner>
                ) : null}
                {upcomingDue.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    No recurring bills expected in the next 14 days. Detection runs from your
                    history on the{" "}
                    <Link href="/recurring" className="font-medium text-accent underline">
                      Recurring screen
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-hairline text-[13px]">
                    {upcomingDue.map((bill) => (
                      <li
                        key={bill.id}
                        className="flex items-baseline justify-between gap-2 py-1.5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{bill.name}</span>
                          <span className="text-[11.5px] text-ink-muted">
                            {formatIsoDate(bill.nextExpectedOn, "en-MY")}
                            {bill.source === "inferred" ? " · inferred" : ""}
                            {bill.isInstallment ? " · installment estimate" : ""}
                          </span>
                        </span>
                        <AmountText
                          amountMinor={bill.typicalAmountMinor}
                          currency={bill.currency}
                          className="text-[13px]"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

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
