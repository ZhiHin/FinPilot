import { createHash } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { addDaysIso, formatIsoDate, isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { computeSafeToSpend, type StsLineItem, type StsResult } from "@/lib/intel/sts";
import {
  computeCashFlowForecast,
  projectOccurrences,
  robustBaseline,
  type ForecastPoint,
} from "@/lib/intel/forecast";
import { detectSpendAnomaly } from "@/lib/intel/anomaly";
import { formatMinor } from "@/lib/money";
import { paydayFor, prevWindow, resolveWindow, type CycleSpec } from "@/lib/cycles";
import { normalizeSeriesKey } from "@/lib/recurrence";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { forecasts, insightEvidence, insights } from "@/server/db/schema";
import { accountsService } from "@/server/services/accounts";
import { analyticsService } from "@/server/services/analytics";
import { budgetsService } from "@/server/services/budgets";
import { goalsService } from "@/server/services/goals";
import { recurringService, type PatternRow } from "@/server/services/recurring";

/**
 * Phase 7 deterministic intelligence. Every number here is computed by
 * unit-tested code (lib/intel) over the user's own ledger — zero LLM calls,
 * fully available in Privacy Mode (ADR-011). Derived results are cached in
 * the `forecasts` table keyed by an inputs hash and recomputed when the
 * ledger changes (ADR-015) — the cache is never the source of truth.
 */

const FORECAST_METHOD = "recurring+baseline";
const FORECAST_METHOD_VERSION = "v1";

// ---------------------------------------------------------------------------
// Safe-to-Spend
// ---------------------------------------------------------------------------

export interface StsView {
  currency: string;
  payday: string;
  result: StsResult;
  incomeItems: StsLineItem[];
  billItems: StsLineItem[];
  /** Allocations counted as committals (name + remaining), for the drawer. */
  committalItems: Array<{ name: string; amountMinor: number }>;
  goalItems: Array<{ name: string; amountMinor: number }>;
  hasPaydayPattern: boolean;
}

function nextPayday(
  income: { day?: number | "last"; weekendAdjust?: boolean } | null,
  today: string,
): { payday: string; hasPattern: boolean } {
  if (income?.day == null) {
    // Documented fallback: the spending window runs to month end + 1 day.
    const [y, m] = today.split("-").map(Number);
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      payday: addDaysIso(
        `${y}-${String(m).padStart(2, "0")}-${String(daysIn).padStart(2, "0")}`,
        1,
      ),
      hasPattern: false,
    };
  }
  const anchor = { day: income.day, weekendAdjust: income.weekendAdjust ?? true };
  const [y, m] = today.split("-").map(Number);
  for (const delta of [0, 1, 2]) {
    const index = y * 12 + (m - 1) + delta;
    const candidate = paydayFor(Math.floor(index / 12), (index % 12) + 1, anchor);
    if (candidate > today) return { payday: candidate, hasPattern: true };
  }
  return { payday: addDaysIso(today, 30), hasPattern: true };
}

/** Monthly contribution still unpaid this calendar month for a goal. */
async function goalDueThisMonth(
  db: Db,
  goalId: string,
  scheduleMinor: number,
  today: string,
): Promise<number> {
  const monthStart = `${today.slice(0, 7)}-01`;
  const [row] = (
    await db.execute<{ total: number }>(sql`
      select coalesce(sum(amount_minor), 0)::bigint as total from goal_contributions
      where goal_id = ${goalId} and contributed_on >= ${monthStart}::date and contributed_on <= ${today}::date
    `)
  ).rows;
  return Math.max(scheduleMinor - Number(row?.total ?? 0), 0);
}

export const intelService = {
  /** The binding STS computation, fully itemized for the "why" drawer. */
  async safeToSpend(db: Db, userId: string, today: string): Promise<Result<StsView>> {
    if (!isValidIsoDate(today)) return err("invalid_input", "Invalid date.");
    const prefs = await preferencesRepo.get(db, userId);
    const currency = (prefs?.currency ?? "MYR").trim();
    const income = (prefs?.incomePattern ?? null) as {
      day?: number | "last";
      weekendAdjust?: boolean;
    } | null;
    const { payday, hasPattern } = nextPayday(income, today);
    const windowEnd = addDaysIso(payday, -1);

    const netPosition = await accountsService.netPosition(db, userId);
    const liquidMinor = netPosition[currency]?.liquidMinor ?? 0;

    const patterns = (await recurringService.list(db, userId)).filter(
      (p) => p.status === "active" && p.currency === currency,
    );
    const inWindow = (p: PatternRow) => p.nextExpectedOn >= today && p.nextExpectedOn <= windowEnd;
    const incomeItems: StsLineItem[] = patterns
      .filter((p) => p.direction === "inflow" && inWindow(p))
      .map((p) => ({
        name: p.name,
        amountMinor: p.typicalAmountMinor,
        toleranceMinor: p.amountToleranceMinor,
        confirmed: p.source === "user_confirmed",
      }));
    const billPatterns = patterns.filter((p) => p.direction === "outflow" && inWindow(p));
    const billItems: StsLineItem[] = billPatterns.map((p) => ({
      name: p.name,
      amountMinor: p.typicalAmountMinor,
      toleranceMinor: p.amountToleranceMinor,
      confirmed: p.source === "user_confirmed",
    }));
    const billCategoryIds = new Set(
      billPatterns.map((p) => p.categoryId).filter((id): id is string => id !== null),
    );

    // Budget committals: unspent plan for the current cycle, excluding
    // categories already reserved by a counted bill (no double reservation).
    let committalItems: Array<{ name: string; amountMinor: number }> = [];
    const budgets = await budgetsService.list(db, userId);
    const activeBudget = budgets.find((b) => b.isActive && b.currency === currency);
    if (activeBudget) {
      const report = await budgetsService.periodReport(db, userId, {
        budgetId: activeBudget.id,
        today,
      });
      if (report.ok) {
        committalItems = report.data.allocations
          .filter((a) => !billCategoryIds.has(a.categoryId))
          .map((a) => ({
            name: a.categoryName,
            amountMinor: Math.max(a.remainingMinor, 0),
          }))
          .filter((item) => item.amountMinor > 0);
      }
    }
    const budgetCommittalMinor = committalItems.reduce((sum, i) => sum + i.amountMinor, 0);

    const goals = (await goalsService.listWithProgress(db, userId, today)).filter(
      (g) => g.status === "active" && g.currency === currency && g.contributionSchedule,
    );
    const goalItems: Array<{ name: string; amountMinor: number }> = [];
    for (const goal of goals) {
      const due = await goalDueThisMonth(
        db,
        goal.id,
        goal.contributionSchedule!.amountMinor,
        today,
      );
      if (due > 0) goalItems.push({ name: goal.name, amountMinor: due });
    }
    const goalContributionsDueMinor = goalItems.reduce((sum, i) => sum + i.amountMinor, 0);

    const result = computeSafeToSpend({
      liquidMinor,
      today,
      payday,
      expectedIncome: incomeItems,
      bills: billItems,
      budgetCommittalMinor,
      goalContributionsDueMinor,
      safetyBufferMinor: prefs?.safetyBufferMinor ?? 0,
    });
    return ok({
      currency,
      payday,
      result,
      incomeItems,
      billItems,
      committalItems,
      goalItems,
      hasPaydayPattern: hasPattern,
    });
  },

  // -------------------------------------------------------------------------
  // Cash-flow forecast (cached per ADR-015)
  // -------------------------------------------------------------------------

  async cashFlowForecast(
    db: Db,
    userId: string,
    input: { horizonDays: 30 | 60 | 90; today: string },
  ): Promise<
    Result<{
      series: ForecastPoint[];
      lowestExpected: { date: string; balanceMinor: number };
      lowestConservative: { date: string; balanceMinor: number };
      currency: string;
      cached: boolean;
      method: string;
    }>
  > {
    if (!isValidIsoDate(input.today)) return err("invalid_input", "Invalid date.");
    const prefs = await preferencesRepo.get(db, userId);
    const currency = (prefs?.currency ?? "MYR").trim();

    // Inputs hash: ledger + pattern fingerprints; any change recomputes.
    const [fingerprint] = (
      await db.execute<{ txn: string; pat: string }>(sql`
        select
          (select coalesce(max(updated_at)::text, '') || count(*)::text from transactions where user_id = ${userId}) as txn,
          (select coalesce(max(updated_at)::text, '') || count(*)::text from recurring_patterns where user_id = ${userId}) as pat
      `)
    ).rows;
    const inputsHash = createHash("sha256")
      .update(
        [
          userId,
          "cash_flow",
          input.horizonDays,
          input.today,
          currency,
          fingerprint?.txn,
          fingerprint?.pat,
        ].join("|"),
      )
      .digest("hex");

    const [cachedRow] = await db
      .select()
      .from(forecasts)
      .where(
        and(
          eq(forecasts.userId, userId),
          eq(forecasts.kind, "cash_flow"),
          eq(forecasts.inputsHash, inputsHash),
          eq(forecasts.horizonDays, input.horizonDays),
          sql`${forecasts.expiresAt} > now()`,
        ),
      )
      .limit(1);
    if (cachedRow) {
      const stored = cachedRow.series as {
        series: ForecastPoint[];
        lowestExpected: { date: string; balanceMinor: number };
        lowestConservative: { date: string; balanceMinor: number };
      };
      return ok({ ...stored, currency, cached: true, method: FORECAST_METHOD });
    }

    const netPosition = await accountsService.netPosition(db, userId);
    const startBalanceMinor = netPosition[currency]?.liquidMinor ?? 0;

    const patterns = (await recurringService.list(db, userId)).filter(
      (p) => p.status === "active" && p.currency === currency && p.frequency !== "custom",
    );
    const horizonEnd = addDaysIso(input.today, input.horizonDays);
    const occurrences = projectOccurrences(
      patterns.map((p) => ({
        nextExpectedOn: p.nextExpectedOn,
        frequency: p.frequency,
        typicalAmountMinor: p.typicalAmountMinor,
        amountToleranceMinor: p.amountToleranceMinor,
        confirmed: p.source === "user_confirmed",
        direction: p.direction,
      })),
      input.today,
      horizonEnd,
    );

    // Non-recurring baseline: trailing 12 weeks of posted net spending minus
    // charges attributable to the recurring series (same keying as detection).
    const trailingStart = addDaysIso(input.today, -84);
    const rows = (
      await db.execute<{
        txn_date: string;
        amount: number;
        merchant_id: string | null;
        description: string;
      }>(sql`
        select t.txn_date::text as txn_date,
               (case when t.type = 'refund' then -t.amount_minor else abs(t.amount_minor) end)::bigint as amount,
               t.merchant_id, t.description_original as description
        from transactions t
        where t.user_id = ${userId} and t.status = 'posted' and t.deleted_at is null
          and t.is_excluded = false and t.currency = ${currency}
          and t.type in ('expense', 'refund', 'debt_payment')
          and t.txn_date >= ${trailingStart}::date and t.txn_date < ${input.today}::date
      `)
    ).rows;
    const recurringMerchants = new Set(
      patterns.filter((p) => p.merchantId).map((p) => p.merchantId as string),
    );
    const recurringNames = new Set(
      patterns.filter((p) => !p.merchantId).map((p) => normalizeSeriesKey(p.name)),
    );
    const weeklySums = new Array<number>(12).fill(0);
    const dayNumber = (isoDate: string): number => {
      const [y, m, d] = isoDate.split("-").map(Number);
      return Date.UTC(y, m - 1, d) / 86_400_000;
    };
    const startDay = dayNumber(trailingStart);
    for (const row of rows) {
      if (row.merchant_id && recurringMerchants.has(row.merchant_id)) continue;
      if (recurringNames.has(normalizeSeriesKey(row.description))) continue;
      const week = Math.min(Math.floor((dayNumber(row.txn_date) - startDay) / 7), 11);
      weeklySums[week] += Number(row.amount);
    }
    const baseline = robustBaseline(weeklySums);

    const result = computeCashFlowForecast({
      startBalanceMinor,
      today: input.today,
      horizonDays: input.horizonDays,
      occurrences,
      baseline,
    });

    const payload = {
      series: result.series,
      lowestExpected: result.lowestExpected,
      lowestConservative: result.lowestConservative,
    };
    try {
      await db.insert(forecasts).values({
        id: uuidv7(),
        userId,
        kind: "cash_flow",
        scope: { currency },
        horizonDays: input.horizonDays,
        method: FORECAST_METHOD,
        methodVersion: FORECAST_METHOD_VERSION,
        series: payload,
        inputsHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
    } catch {
      // A concurrent request cached the same inputs — theirs is identical.
    }
    return ok({ ...payload, currency, cached: false, method: FORECAST_METHOD });
  },

  // -------------------------------------------------------------------------
  // Insight generation (deterministic producers, deduplicated)
  // -------------------------------------------------------------------------

  async generateInsights(
    db: Db,
    userId: string,
    today: string,
  ): Promise<Result<{ created: number }>> {
    if (!isValidIsoDate(today)) return err("invalid_input", "Invalid date.");
    const prefs = await preferencesRepo.get(db, userId);
    const currency = (prefs?.currency ?? "MYR").trim();

    interface CandidateInsight {
      type: string;
      severity: "info" | "attention" | "risk";
      title: string;
      body: string;
      periodStart: string;
      periodEnd: string;
      comparison: Record<string, unknown>;
      confidenceBp: number;
      dataQuality: Record<string, unknown>;
      dedupKey: string;
      validUntil: Date | null;
      evidence: Array<{ evidenceType: string; payload: Record<string, unknown> }>;
    }
    const candidates: CandidateInsight[] = [];

    // ---- Last two complete calendar months ----
    const [y, m] = today.split("-").map(Number);
    const monthOf = (delta: number) => {
      const index = y * 12 + (m - 1) + delta;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        key: `${year}-${String(month).padStart(2, "0")}`,
        start: `${year}-${String(month).padStart(2, "0")}-01`,
        end: `${year}-${String(month).padStart(2, "0")}-${String(daysIn).padStart(2, "0")}`,
      };
    };
    const current = monthOf(-1); // last complete month
    const previous = monthOf(-2);

    const [currentBreakdown, previousBreakdown, currentQuality] = await Promise.all([
      analyticsService.categoryBreakdown(db, userId, {
        dateFrom: current.start,
        dateTo: current.end,
        kind: "expense",
      }),
      analyticsService.categoryBreakdown(db, userId, {
        dateFrom: previous.start,
        dateTo: previous.end,
        kind: "expense",
      }),
      analyticsService.dataQuality(db, userId, { dateFrom: current.start, dateTo: current.end }),
    ]);
    const pendingCount = currentQuality.ok ? currentQuality.data.pendingCount : 0;

    // ---- spend_change: MoM category increases ≥20% and ≥RM 100 ----
    const coveredCategories = new Set<string>();
    if (currentBreakdown.ok && previousBreakdown.ok) {
      const prevByCat = new Map(
        previousBreakdown.data
          .filter((r) => r.currency === currency)
          .map((r) => [r.categoryId ?? "uncategorized", r.amountMinor]),
      );
      const changes = currentBreakdown.data
        .filter((r) => r.currency === currency && r.categoryId !== null)
        .map((r) => {
          const prev = prevByCat.get(r.categoryId as string) ?? 0;
          return { row: r, prevMinor: prev, deltaMinor: r.amountMinor - prev };
        })
        .filter(
          (c) =>
            c.prevMinor > 0 && c.deltaMinor >= 10000 && c.deltaMinor * 10000 >= c.prevMinor * 2000, // ≥ 20%
        )
        .sort((a, b) => b.deltaMinor - a.deltaMinor)
        .slice(0, 2);

      for (const change of changes) {
        const categoryId = change.row.categoryId as string;
        coveredCategories.add(categoryId);
        const pctBp = Math.round((change.deltaMinor * 10000) / change.prevMinor);
        const [currentMerchants, previousMerchants] = await Promise.all([
          analyticsService.topMerchants(db, userId, {
            dateFrom: current.start,
            dateTo: current.end,
            categoryIds: [categoryId],
            limit: 10,
          }),
          analyticsService.topMerchants(db, userId, {
            dateFrom: previous.start,
            dateTo: previous.end,
            categoryIds: [categoryId],
            limit: 10,
          }),
        ]);
        const prevSpend = new Map(
          (previousMerchants.ok ? previousMerchants.data : []).map((r) => [
            r.merchantId,
            r.spendMinor,
          ]),
        );
        const contributors = (currentMerchants.ok ? currentMerchants.data : [])
          .map((r) => ({
            name: r.name,
            currentMinor: r.spendMinor,
            previousMinor: prevSpend.get(r.merchantId) ?? 0,
            deltaMinor: r.spendMinor - (prevSpend.get(r.merchantId) ?? 0),
          }))
          .filter((r) => r.deltaMinor > 0)
          .sort((a, b) => b.deltaMinor - a.deltaMinor)
          .slice(0, 3);
        const monthName = formatIsoDate(previous.start, "en-MY").slice(2).trim();
        candidates.push({
          type: "spend_change",
          severity: "attention",
          title: `${change.row.categoryName} spending increased ${Math.round(pctBp / 100)}% vs ${monthName.split(" ")[1] ?? "last month"}`,
          body:
            `${change.row.categoryName} rose from ${formatMinor(change.prevMinor, currency)} to ${formatMinor(change.row.amountMinor, currency)} (+${formatMinor(change.deltaMinor, currency)}).` +
            (contributors[0]
              ? ` ${contributors[0].name} contributed ${formatMinor(contributors[0].deltaMinor, currency)} of the increase.`
              : "") +
            (pendingCount > 0 ? ` Excludes ${pendingCount} pending transaction(s).` : ""),
          periodStart: current.start,
          periodEnd: current.end,
          comparison: {
            comparedStart: previous.start,
            comparedEnd: previous.end,
            currentMinor: change.row.amountMinor,
            previousMinor: change.prevMinor,
            deltaMinor: change.deltaMinor,
            pctBp,
          },
          confidenceBp: pendingCount === 0 ? 9000 : 7500,
          dataQuality: pendingCount > 0 ? { pendingExcluded: pendingCount } : {},
          dedupKey: `spend_change:${categoryId}:${current.key}`,
          validUntil: new Date(Date.now() + 60 * 24 * 60 * 60_000),
          evidence: [
            {
              evidenceType: "category_delta",
              payload: {
                categoryId,
                categoryName: change.row.categoryName,
                currentMinor: change.row.amountMinor,
                previousMinor: change.prevMinor,
                deltaMinor: change.deltaMinor,
                pctBp,
              },
            },
            ...(contributors.length > 0
              ? [{ evidenceType: "merchant_delta", payload: { contributors } }]
              : []),
            {
              evidenceType: "calculation",
              payload: {
                formula:
                  "delta = spend(current month) - spend(previous month); pct = delta / previous",
                currentPeriod: [current.start, current.end],
                previousPeriod: [previous.start, previous.end],
              },
            },
          ],
        });
      }
    }

    // ---- anomaly: last complete month vs trailing 6-month baseline ----
    if (currentBreakdown.ok) {
      const historyWindows = [-2, -3, -4, -5, -6, -7].map((delta) => monthOf(delta));
      const historyBreakdowns = await Promise.all(
        historyWindows.map((window) =>
          analyticsService.categoryBreakdown(db, userId, {
            dateFrom: window.start,
            dateTo: window.end,
            kind: "expense",
          }),
        ),
      );
      for (const row of currentBreakdown.data.filter(
        (r) => r.currency === currency && r.categoryId !== null,
      )) {
        if (coveredCategories.has(row.categoryId as string)) continue;
        const history = historyBreakdowns.map((res) =>
          res.ok
            ? (res.data.find((h) => h.categoryId === row.categoryId && h.currency === currency)
                ?.amountMinor ?? 0)
            : 0,
        );
        const verdict = detectSpendAnomaly(row.amountMinor, history);
        if (!verdict.isAnomaly) continue;
        candidates.push({
          type: "anomaly",
          severity: "attention",
          title: `${row.categoryName} was unusually high last month`,
          body: `${formatMinor(row.amountMinor, currency)} against a typical ${formatMinor(verdict.baselineMedianMinor, currency)} (six-month median) — ${formatMinor(verdict.deltaMinor, currency)} above your own baseline.`,
          periodStart: current.start,
          periodEnd: current.end,
          comparison: {
            baselineMedianMinor: verdict.baselineMedianMinor,
            deltaMinor: verdict.deltaMinor,
            robustZ: Math.round((verdict.z ?? 0) * 100) / 100,
          },
          confidenceBp: 8500,
          dataQuality: {},
          dedupKey: `anomaly:${row.categoryId}:${current.key}`,
          validUntil: new Date(Date.now() + 60 * 24 * 60 * 60_000),
          evidence: [
            {
              evidenceType: "calculation",
              payload: {
                method: "robust z-score (median/MAD ×1.4826) over 6 complete months",
                baseline: history,
                currentMinor: row.amountMinor,
                z: verdict.z,
              },
            },
          ],
        });
      }
    }

    // ---- low_balance (resilience warning from the conservative band) ----
    const forecast = await this.cashFlowForecast(db, userId, { horizonDays: 30, today });
    if (forecast.ok) {
      const buffer = prefs?.safetyBufferMinor ?? 0;
      const low = forecast.data.lowestConservative;
      if (low.balanceMinor < buffer && low.date > today) {
        candidates.push({
          type: "low_balance",
          severity: low.balanceMinor < 0 ? "risk" : "attention",
          title: `Projected balance dips to ${formatMinor(low.balanceMinor, currency)} on ${formatIsoDate(low.date, "en-MY")}`,
          body: `On the conservative path (confirmed income only, bills padded by their tolerance), your liquid balance falls ${low.balanceMinor < 0 ? "below zero" : `under your ${formatMinor(buffer, currency)} safety buffer`} within 30 days. The expected path bottoms out at ${formatMinor(forecast.data.lowestExpected.balanceMinor, currency)}.`,
          periodStart: today,
          periodEnd: addDaysIso(today, 30),
          comparison: {
            lowestConservativeMinor: low.balanceMinor,
            lowestExpectedMinor: forecast.data.lowestExpected.balanceMinor,
            safetyBufferMinor: buffer,
          },
          confidenceBp: 8000,
          dataQuality: {},
          dedupKey: `low_balance:${low.date}`,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000),
          evidence: [
            {
              evidenceType: "calculation",
              payload: {
                method: `${FORECAST_METHOD} ${FORECAST_METHOD_VERSION}`,
                lowestConservative: low,
                lowestExpected: forecast.data.lowestExpected,
              },
            },
          ],
        });
      }
    }

    // ---- budget_suggestion: 3-cycle median vs planned ----
    const budgets = await budgetsService.list(db, userId);
    const activeBudget = budgets.find((b) => b.isActive && b.currency === currency);
    if (activeBudget) {
      const report = await budgetsService.periodReport(db, userId, {
        budgetId: activeBudget.id,
        today,
      });
      if (report.ok) {
        const spec: CycleSpec = { type: activeBudget.cycleType, anchor: activeBudget.cycleAnchor };
        let window = resolveWindow(spec, today);
        const cycles: Array<{ start: string; end: string }> = [];
        for (let i = 0; i < 3; i++) {
          window = prevWindow(spec, window);
          cycles.push({ start: window.periodStart, end: window.periodEnd });
        }
        const cycleBreakdowns = await Promise.all(
          cycles.map((cycle) =>
            analyticsService.categoryBreakdown(db, userId, {
              dateFrom: cycle.start,
              dateTo: cycle.end,
              kind: "expense",
            }),
          ),
        );
        for (const allocation of report.data.allocations) {
          const spends = cycleBreakdowns.map((res) =>
            res.ok
              ? (res.data.find(
                  (r) => r.categoryId === allocation.categoryId && r.currency === currency,
                )?.amountMinor ?? 0)
              : 0,
          );
          const sorted = [...spends].sort((a, b) => a - b);
          const medianMinor = sorted[1]; // median of 3
          const deltaMinor = medianMinor - allocation.plannedMinor;
          const threshold = Math.max(Math.round(allocation.plannedMinor * 0.1), 5000);
          if (Math.abs(deltaMinor) < threshold || medianMinor === 0) continue;
          const suggestedMinor = Math.round(medianMinor / 1000) * 1000; // to RM 10
          if (suggestedMinor === allocation.plannedMinor) continue;
          candidates.push({
            type: "budget_suggestion",
            severity: "info",
            title: `${deltaMinor > 0 ? "Raise" : "Lower"} ${allocation.categoryName} to ${formatMinor(suggestedMinor, currency)}`,
            body: `Planned ${formatMinor(allocation.plannedMinor, currency)}, but your last three cycles' median spending is ${formatMinor(medianMinor, currency)}. A deterministic baseline comparison — nothing changes unless you apply it.`,
            periodStart: report.data.period.periodStart,
            periodEnd: report.data.period.periodEnd,
            comparison: {
              plannedMinor: allocation.plannedMinor,
              medianMinor,
              suggestedMinor,
              allocationId: allocation.allocationId,
              periodId: report.data.period.id,
              categoryId: allocation.categoryId,
              allocationVersion: allocation.version,
            },
            confidenceBp: 8000,
            dataQuality: {},
            dedupKey: `budget_suggestion:${allocation.allocationId}:${report.data.period.periodStart}`,
            validUntil: new Date(Date.now() + 45 * 24 * 60 * 60_000),
            evidence: [
              {
                evidenceType: "aggregate",
                payload: {
                  cycles: cycles.map((cycle, index) => ({ ...cycle, spendMinor: spends[index] })),
                  medianMinor,
                  plannedMinor: allocation.plannedMinor,
                  suggestedMinor,
                },
              },
            ],
          });
        }
      }
    }

    // ---- Deduplicated insert with evidence, atomically per insight ----
    let created = 0;
    for (const candidate of candidates) {
      const [existing] = (
        await db.execute<{ id: string }>(
          sql`select id from insights where user_id = ${userId} and dedup_key = ${candidate.dedupKey} limit 1`,
        )
      ).rows;
      if (existing) continue;
      const insightId = uuidv7();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(insights).values({
            id: insightId,
            userId,
            type: candidate.type,
            severity: candidate.severity,
            title: candidate.title,
            body: candidate.body,
            periodStart: candidate.periodStart,
            periodEnd: candidate.periodEnd,
            comparison: candidate.comparison,
            confidenceBp: candidate.confidenceBp,
            dataQuality: candidate.dataQuality,
            dedupKey: candidate.dedupKey,
            validUntil: candidate.validUntil,
          });
          for (const [index, evidence] of candidate.evidence.entries()) {
            await tx.insert(insightEvidence).values({
              id: uuidv7(),
              insightId,
              userId,
              evidenceType: evidence.evidenceType,
              payload: evidence.payload,
              displayOrder: index,
            });
          }
        });
        created += 1;
      } catch (error) {
        // Concurrent generation raced; the unique dedup index kept it single.
        if (process.env.NODE_ENV !== "production") {
          const cause = (error as { cause?: unknown }).cause;
          process.stdout.write(
            `[intel] insert skipped (${candidate.dedupKey}): ${String(cause)}\n`,
          );
        }
      }
    }
    if (created > 0) {
      await auditRepo.record(db, {
        id: uuidv7(),
        userId,
        actor: "system",
        eventType: "insight.generated",
        entityType: "insight",
        entityId: null,
        diff: { created },
      });
    }
    return ok({ created });
  },

  /** Run generation at most ~twice a day per user (page loads stay fast). */
  async generateInsightsIfStale(
    db: Db,
    userId: string,
    today: string,
  ): Promise<Result<{ created: number }>> {
    const [row] = (
      await db.execute<{ latest: string | null }>(
        sql`select max(created_at)::text as latest from insights where user_id = ${userId}`,
      )
    ).rows;
    if (row?.latest && Date.now() - new Date(row.latest).getTime() < 12 * 60 * 60_000) {
      return ok({ created: 0 });
    }
    return this.generateInsights(db, userId, today);
  },

  async listInsights(
    db: Db,
    userId: string,
    opts: { includeDismissed?: boolean; type?: string } = {},
  ) {
    const conditions = [eq(insights.userId, userId)];
    if (!opts.includeDismissed) conditions.push(sql`${insights.status} <> 'dismissed'`);
    if (opts.type) conditions.push(eq(insights.type, opts.type));
    const rows = await db
      .select()
      .from(insights)
      .where(and(...conditions))
      .orderBy(desc(insights.createdAt))
      .limit(100);
    return rows;
  },

  async getEvidence(db: Db, userId: string, insightId: string) {
    return db
      .select()
      .from(insightEvidence)
      .where(and(eq(insightEvidence.insightId, insightId), eq(insightEvidence.userId, userId)))
      .orderBy(asc(insightEvidence.displayOrder));
  },

  async setInsightStatus(
    db: Db,
    userId: string,
    insightId: string,
    status: "read" | "dismissed" | "actioned",
  ): Promise<Result<{ status: string }>> {
    const [row] = await db
      .update(insights)
      .set({ status })
      .where(and(eq(insights.id, insightId), eq(insights.userId, userId)))
      .returning({ id: insights.id });
    if (!row) return err("not_found", "That insight doesn’t exist.");
    if (status !== "read") {
      await auditRepo.record(db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: `insight.${status}`,
        entityType: "insight",
        entityId: insightId,
        diff: {},
      });
    }
    return ok({ status });
  },
} as const;
