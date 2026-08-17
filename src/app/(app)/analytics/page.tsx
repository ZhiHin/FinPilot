import type { Metadata } from "next";
import Link from "next/link";

import { BarList } from "@/components/charts/bar-list";
import { ChartCard, ChartDataTable } from "@/components/charts/chart-card";
import { formatBp, longMonthLabel } from "@/components/charts/format";
import { IncomeExpenseBars, SavingsBars } from "@/components/charts/flow-bars";
import { MoneyTrendLine, RateTrendLine } from "@/components/charts/trend-line";
import { AmountText } from "@/components/ui/amount-text";
import { Banner } from "@/components/ui/banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { AnalyticsFilterPanel, type FilterOption } from "@/features/analytics/filter-panel";
import {
  analyticsHref,
  drillDownHref,
  exportHref,
  parseAnalyticsSearchParams,
  type AnalyticsSearchParams,
} from "@/features/analytics/search-params";
import { comparisonText, periodDisplayLabel } from "@/features/analytics/summary";
import { localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatMinor } from "@/lib/money";
import { previousPeriod, shiftRangeMonthsBack, yearAgoPeriod } from "@/lib/periods";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";
import { analyticsService, type PeriodTotals } from "@/server/services/analytics";
import { categoriesService } from "@/server/services/categories";
import { tagsService } from "@/server/services/tags";

export const metadata: Metadata = { title: t("nav.analytics") };

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Repeated checkbox params (`accounts=a&accounts=b`) → comma-joined string. */
function normalize(params: RawSearchParams): AnalyticsSearchParams {
  const pick = (key: string): string | undefined => {
    const value = params[key];
    if (Array.isArray(value)) return value.join(",");
    return value || undefined;
  };
  return {
    period: pick("period"),
    from: pick("from"),
    to: pick("to"),
    accounts: pick("accounts"),
    categories: pick("categories"),
    tags: pick("tags"),
    currency: pick("currency"),
    compare: pick("compare"),
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { user } = await requireUser();
  const params = normalize(await searchParams);
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";
  const today = localDateInTz(new Date(), timezone);
  const state = parseAnalyticsSearchParams(params, today);
  const backHref = analyticsHref(params);

  const [accountRows, groups, tagRows] = await Promise.all([
    accountsService.list(db, user.id, { includeArchived: true }),
    categoriesService.listGroups(db, user.id),
    tagsService.list(db, user.id),
  ]);

  if (accountRows.length === 0) {
    return (
      <>
        <PageHeader title={t("nav.analytics")} />
        <EmptyState
          title="Nothing to analyze yet"
          description="Analytics builds on your accounts and transactions. Add an account and record (or import) some activity first."
          action={
            <Link href="/accounts" className="font-medium text-accent underline">
              Go to Accounts
            </Link>
          }
        />
      </>
    );
  }

  const filter = {
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    accountIds: state.accountIds,
    categoryIds: state.categoryIds,
    tagIds: state.tagIds,
  };
  const compareRange =
    state.compare === "prev"
      ? previousPeriod(state.dateFrom, state.dateTo)
      : state.compare === "year"
        ? yearAgoPeriod(state.dateFrom, state.dateTo)
        : null;
  const trendWindow = shiftRangeMonthsBack(state.dateTo, 12);

  const [
    totalsRes,
    compareTotalsRes,
    flowsRes,
    expenseRes,
    incomeRes,
    merchantsRes,
    netTrendRes,
    qualityRes,
  ] = await Promise.all([
    analyticsService.periodTotals(db, user.id, filter),
    compareRange
      ? analyticsService.periodTotals(db, user.id, { ...filter, ...compareRange })
      : Promise.resolve(null),
    analyticsService.monthlyFlows(db, user.id, filter),
    analyticsService.categoryBreakdown(db, user.id, { ...filter, kind: "expense" }),
    analyticsService.categoryBreakdown(db, user.id, { ...filter, kind: "income" }),
    analyticsService.topMerchants(db, user.id, { ...filter, limit: 10 }),
    analyticsService.netPositionTrend(db, user.id, trendWindow),
    analyticsService.dataQuality(db, user.id, {
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
    }),
  ]);

  const failed = [totalsRes, flowsRes, expenseRes, incomeRes, merchantsRes, netTrendRes].find(
    (res) => res && !res.ok,
  );
  if (failed && !failed.ok) {
    return (
      <>
        <PageHeader title={t("nav.analytics")} />
        <ErrorState
          title="Those filters can’t be applied"
          description={failed.error.message}
          action={
            <Link href="/analytics" className="font-medium text-accent underline">
              Reset filters
            </Link>
          }
        />
      </>
    );
  }

  const totals = totalsRes.ok ? totalsRes.data : {};
  const compareTotals: Record<string, PeriodTotals> =
    compareTotalsRes && compareTotalsRes.ok ? compareTotalsRes.data : {};
  const flows = flowsRes.ok ? flowsRes.data : [];
  const expenseBreakdown = expenseRes.ok ? expenseRes.data : [];
  const incomeBreakdown = incomeRes.ok ? incomeRes.data : [];
  const merchants = merchantsRes.ok ? merchantsRes.data : [];
  const netTrend = netTrendRes.ok ? netTrendRes.data : [];
  const quality = qualityRes.ok ? qualityRes.data : null;

  const allCurrencies = [
    ...new Set([
      ...Object.keys(totals),
      ...flows.map((f) => f.currency),
      ...netTrend.map((p) => p.currency),
    ]),
  ].sort((a, b) => (a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b)));
  const currencies = state.currency
    ? allCurrencies.filter((c) => c === state.currency)
    : allCurrencies;

  const incomplete = state.period ? state.period.incomplete : state.dateTo >= today;
  const periodLabel = periodDisplayLabel(state.dateFrom, state.dateTo, incomplete);
  const compareLabel =
    state.compare === "prev"
      ? "previous period"
      : state.compare === "year"
        ? "same period last year"
        : null;

  const accounts: FilterOption[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    detail: `${a.currency.trim()}${a.status === "archived" ? " · archived" : ""}`,
  }));
  const categoryOptions: FilterOption[] = groups.flatMap((group) =>
    group.categories.map((category) => ({
      id: category.id,
      name: category.name,
      detail: group.name,
    })),
  );
  const tagOptions: FilterOption[] = tagRows.map((tag) => ({ id: tag.id, name: tag.name }));

  return (
    <>
      <PageHeader
        title={t("nav.analytics")}
        description="Answer your money questions — every chart has a table view, every number can be drilled into."
        actions={
          <a
            href={exportHref(state)}
            className="rounded-control border border-strongline bg-raised px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sunken"
          >
            Export CSV
          </a>
        }
      />

      <div className="flex flex-col gap-4">
        <AnalyticsFilterPanel
          params={params}
          state={state}
          accounts={accounts}
          categories={categoryOptions}
          tags={tagOptions}
          currencies={allCurrencies}
        />

        <p className="text-[12.5px] text-ink-muted" data-testid="period-indicator">
          Showing {periodLabel}
          {state.filtered ? " · filters active" : ""}
          {incomplete ? " · this period is still in progress" : ""}
          {compareLabel ? ` · compared with the ${compareLabel}` : ""}
        </p>

        {quality &&
        (quality.pendingCount > 0 ||
          quality.uncommittedImportJobs > 0 ||
          quality.needsReviewCount > 0) ? (
          <Banner variant="info">
            Heads up:{" "}
            {[
              quality.pendingCount > 0
                ? `${quality.pendingCount} pending transaction(s) aren’t counted until they post`
                : null,
              quality.needsReviewCount > 0
                ? `${quality.needsReviewCount} transaction(s) still need review`
                : null,
              quality.uncommittedImportJobs > 0
                ? `${quality.uncommittedImportJobs} import(s) await confirmation`
                : null,
            ]
              .filter(Boolean)
              .join("; ")}
            .
          </Banner>
        ) : null}

        {currencies.length === 0 ? (
          <EmptyState
            title="No activity for these filters"
            description="Nothing matches this period and filter combination. Widen the date range or reset the filters."
            action={
              <Link href="/analytics" className="font-medium text-accent underline">
                Reset filters
              </Link>
            }
          />
        ) : (
          currencies.map((currency) => {
            const t9 = totals[currency];
            const c9 = compareTotals[currency];
            const currencyFlows = flows.filter((f) => f.currency === currency);
            const currencyTrend = netTrend.filter((p) => p.currency === currency);
            const expenseRows = expenseBreakdown.filter((r) => r.currency === currency);
            const incomeRows = incomeBreakdown.filter((r) => r.currency === currency);
            const merchantRows = merchants.filter((r) => r.currency === currency);
            const summarySentence = t9
              ? `You earned ${formatMinor(t9.incomeMinor, currency)}, spent ${formatMinor(
                  t9.expenseMinor,
                  currency,
                )}, and ${t9.savingsMinor >= 0 ? "saved" : "overspent by"} ${formatMinor(
                  Math.abs(t9.savingsMinor),
                  currency,
                )}${
                  t9.savingsRateBp != null
                    ? ` — a ${formatBp(t9.savingsRateBp)} savings rate`
                    : " — no income this period, so no savings rate is shown"
                }.`
              : "No income or spending in this period.";

            return (
              <section
                key={currency}
                aria-label={`${currency} analytics`}
                className="flex flex-col gap-4"
              >
                {currencies.length > 1 || state.currency ? (
                  <h2 className="text-[15px] font-semibold text-ink">
                    {currency}
                    <span className="ml-2 text-[12.5px] font-normal text-ink-muted">
                      currencies are never converted or combined
                    </span>
                  </h2>
                ) : null}

                <Card>
                  <CardContent className="text-[15px] leading-6 text-ink">
                    {summarySentence}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatTile
                    label="Income"
                    detail={
                      compareLabel && c9 !== undefined
                        ? comparisonText(t9?.incomeMinor ?? 0, c9?.incomeMinor ?? 0)
                        : undefined
                    }
                  >
                    <AmountText amountMinor={t9?.incomeMinor ?? 0} currency={currency} />
                  </StatTile>
                  <StatTile
                    label="Expenses"
                    detail={
                      compareLabel && c9 !== undefined
                        ? comparisonText(t9?.expenseMinor ?? 0, c9?.expenseMinor ?? 0)
                        : undefined
                    }
                  >
                    <AmountText amountMinor={t9?.expenseMinor ?? 0} currency={currency} />
                  </StatTile>
                  <StatTile
                    label="Savings"
                    detail={
                      compareLabel && c9 !== undefined
                        ? comparisonText(t9?.savingsMinor ?? 0, c9?.savingsMinor ?? 0)
                        : undefined
                    }
                  >
                    <AmountText amountMinor={t9?.savingsMinor ?? 0} currency={currency} />
                  </StatTile>
                  <StatTile
                    label="Savings rate"
                    detail={
                      t9?.savingsRateBp == null
                        ? "No income this period, so no rate is shown"
                        : compareLabel && c9?.savingsRateBp != null
                          ? `Was ${formatBp(c9.savingsRateBp)} in the ${compareLabel}`
                          : "Savings as a share of income"
                    }
                  >
                    <span className="num text-[15px] font-medium">
                      {t9?.savingsRateBp != null ? formatBp(t9.savingsRateBp) : "—"}
                    </span>
                  </StatTile>
                </div>

                {compareLabel && compareRange ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Compared with the {compareLabel}</CardTitle>
                      <p className="text-[12.5px] text-ink-muted">
                        {periodDisplayLabel(compareRange.dateFrom, compareRange.dateTo, false)} —
                        equal-length windows, so the comparison is fair.
                      </p>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <ChartDataTable
                        caption={`This period vs the ${compareLabel} in ${currency}`}
                        headers={["Measure", "This period", "Baseline", "Change"]}
                        rows={[
                          ["Income", t9?.incomeMinor ?? 0, c9?.incomeMinor ?? 0] as const,
                          ["Expenses", t9?.expenseMinor ?? 0, c9?.expenseMinor ?? 0] as const,
                          ["Savings", t9?.savingsMinor ?? 0, c9?.savingsMinor ?? 0] as const,
                        ].map(([label, current, baseline]) => [
                          label,
                          formatMinor(current as number, currency),
                          formatMinor(baseline as number, currency),
                          comparisonText(current as number, baseline as number),
                        ])}
                      />
                    </CardContent>
                  </Card>
                ) : null}

                <ChartCard
                  title={`Income vs expenses · ${currency}`}
                  description="Monthly income and expenses across the selected range."
                  chart={<IncomeExpenseBars data={currencyFlows} currency={currency} />}
                  table={
                    <ChartDataTable
                      caption={`Monthly income and expenses in ${currency}`}
                      headers={["Month", "Income", "Expenses", "Savings", "Savings rate"]}
                      rows={currencyFlows.map((f) => [
                        longMonthLabel(f.month),
                        formatMinor(f.incomeMinor, currency),
                        formatMinor(f.expenseMinor, currency),
                        formatMinor(f.savingsMinor, currency),
                        f.savingsRateBp != null ? formatBp(f.savingsRateBp) : "—",
                      ])}
                    />
                  }
                />

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <ChartCard
                    title={`Net cash flow · ${currency}`}
                    description="Savings per month — blue above the line, red below."
                    chart={<SavingsBars data={currencyFlows} currency={currency} />}
                    table={
                      <ChartDataTable
                        caption={`Net cash flow per month in ${currency}`}
                        headers={["Month", "Net cash flow"]}
                        rows={currencyFlows.map((f) => [
                          longMonthLabel(f.month),
                          formatMinor(f.savingsMinor, currency),
                        ])}
                      />
                    }
                  />
                  <ChartCard
                    title={`Savings rate trend · ${currency}`}
                    description="Savings as a share of income per month; months without income show a gap."
                    chart={
                      <RateTrendLine
                        data={currencyFlows.map((f) => ({
                          month: f.month,
                          rateBp: f.savingsRateBp,
                        }))}
                      />
                    }
                    table={
                      <ChartDataTable
                        caption={`Savings rate per month in ${currency}`}
                        headers={["Month", "Savings rate"]}
                        rows={currencyFlows.map((f) => [
                          longMonthLabel(f.month),
                          f.savingsRateBp != null ? formatBp(f.savingsRateBp) : "No income",
                        ])}
                      />
                    }
                  />
                </div>

                <ChartCard
                  title={`Net position trend · ${currency}`}
                  description="Month-end net position over the last 12 months. Account-based: category and tag filters don’t apply here, and excluded transactions are included because they moved real money."
                  chart={
                    <MoneyTrendLine
                      data={currencyTrend.map((p) => ({ month: p.month, valueMinor: p.netMinor }))}
                      currency={currency}
                      seriesName="Net position"
                    />
                  }
                  table={
                    <ChartDataTable
                      caption={`Month-end net position in ${currency}`}
                      headers={["Month", "Assets", "Liabilities", "Net position"]}
                      rows={currencyTrend.map((p) => [
                        longMonthLabel(p.month),
                        formatMinor(p.assetsMinor, currency),
                        formatMinor(p.liabilitiesMinor, currency),
                        formatMinor(p.netMinor, currency),
                      ])}
                    />
                  }
                />

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <ChartCard
                    title={`Spending by category · ${currency}`}
                    interactive
                    description="Split-aware: split transactions count in each split’s category; refunds reduce their category. Click a category to see its transactions."
                    chart={
                      expenseRows.length === 0 ? (
                        <p className="py-6 text-[13px] text-ink-muted">
                          No categorized spending in this period.
                        </p>
                      ) : (
                        <BarList
                          currency={currency}
                          hueVar="--chart-2"
                          items={expenseRows.map((row) => ({
                            key: row.categoryId ?? "uncategorized",
                            label: row.categoryName,
                            detail: row.groupName,
                            amountMinor: row.amountMinor,
                            href: row.categoryId
                              ? drillDownHref(state, { categoryId: row.categoryId }, backHref)
                              : null,
                          }))}
                        />
                      )
                    }
                    table={
                      <ChartDataTable
                        caption={`Spending by category in ${currency}`}
                        headers={["Category", "Amount"]}
                        rows={expenseRows.map((row) => [
                          `${row.categoryName}${row.groupName ? ` (${row.groupName})` : ""}`,
                          formatMinor(row.amountMinor, currency),
                        ])}
                      />
                    }
                  />
                  <ChartCard
                    title={`Income by category · ${currency}`}
                    interactive
                    description="Where your income came from in this period."
                    chart={
                      incomeRows.length === 0 ? (
                        <p className="py-6 text-[13px] text-ink-muted">No income in this period.</p>
                      ) : (
                        <BarList
                          currency={currency}
                          hueVar="--chart-1"
                          items={incomeRows.map((row) => ({
                            key: row.categoryId ?? "uncategorized",
                            label: row.categoryName,
                            detail: row.groupName,
                            amountMinor: row.amountMinor,
                            href: row.categoryId
                              ? drillDownHref(state, { categoryId: row.categoryId }, backHref)
                              : null,
                          }))}
                        />
                      )
                    }
                    table={
                      <ChartDataTable
                        caption={`Income by category in ${currency}`}
                        headers={["Category", "Amount"]}
                        rows={incomeRows.map((row) => [
                          `${row.categoryName}${row.groupName ? ` (${row.groupName})` : ""}`,
                          formatMinor(row.amountMinor, currency),
                        ])}
                      />
                    }
                  />
                </div>

                <ChartCard
                  title={`Top merchants · ${currency}`}
                  interactive
                  description="Net spending per merchant (refunds subtracted). Click a merchant to see its transactions."
                  chart={
                    merchantRows.length === 0 ? (
                      <p className="py-6 text-[13px] text-ink-muted">
                        No merchant spending in this period.
                      </p>
                    ) : (
                      <BarList
                        currency={currency}
                        hueVar="--chart-1"
                        items={merchantRows.map((row) => ({
                          key: row.merchantId,
                          label: row.name,
                          detail: `${row.txnCount} transaction${row.txnCount === 1 ? "" : "s"}`,
                          amountMinor: row.spendMinor,
                          href: drillDownHref(state, { search: row.name }, backHref),
                        }))}
                      />
                    )
                  }
                  table={
                    <ChartDataTable
                      caption={`Net spending per merchant in ${currency}`}
                      headers={["Merchant", "Transactions", "Net spend"]}
                      rows={merchantRows.map((row) => [
                        row.name,
                        String(row.txnCount),
                        formatMinor(row.spendMinor, currency),
                      ])}
                    />
                  }
                />
              </section>
            );
          })
        )}

        <p className="text-[11.5px] text-ink-muted">
          Exports respect the active filters, contain only your data, and neutralize spreadsheet
          formulas. Reports count posted, non-excluded transactions; transfers move money between
          your accounts and are never income or expenses.
        </p>
      </div>
    </>
  );
}
