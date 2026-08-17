import { z } from "zod";

import { addDaysIso, formatIsoDate } from "@/lib/dates";
import { formatMinor, parseAmountToMinor } from "@/lib/money";
import { formatBp } from "@/components/charts/format";
import { resolvePeriod } from "@/lib/periods";
import type { Db } from "@/server/db/client";
import { analyticsService } from "@/server/services/analytics";
import { goalsService } from "@/server/services/goals";
import { intelService } from "@/server/services/intel";
import { recurringService } from "@/server/services/recurring";

/**
 * The assistant's fixed tool registry (architecture doc §6, spec B7):
 * - `user_id` is injected server-side — never model-supplied.
 * - Every tool validates its args with Zod, returns pre-aggregated data with
 *   row caps, echoes the filters/period it used, and supplies:
 *   - `facts`: a deterministic sentence (the phrasing input AND the fallback);
 *   - `verified`: every number the phrasing may legally mention (B5);
 *   - `evidence`: label/value rows rendered as the card's table;
 *   - `links`: same-app deep links so answers are never chat-only.
 * - The LLM performs no arithmetic anywhere in this file.
 */

export interface ToolCard {
  tool: string;
  filters: Record<string, string>;
  facts: string;
  verified: { amountsMinor: number[]; pctBp: number[] };
  evidence: Array<{ label: string; value: string }>;
  links: Array<{ label: string; href: string }>;
  assumptions: string[];
}

type ToolRunner = (
  db: Db,
  userId: string,
  today: string,
  args: unknown,
) => Promise<ToolCard | null>;

const spendingArgs = z.object({
  period: z.enum(["this-month", "last-month"]).default("last-month"),
});

const runSpendingSummary: ToolRunner = async (db, userId, today, rawArgs) => {
  const args = spendingArgs.safeParse(rawArgs ?? {});
  if (!args.success) return null;
  const period = resolvePeriod(args.data.period, today);
  const totals = await analyticsService.periodTotals(db, userId, {
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
  });
  if (!totals.ok) return null;
  const currency = Object.keys(totals.data).includes("MYR")
    ? "MYR"
    : (Object.keys(totals.data)[0] ?? "MYR");
  const t = totals.data[currency] ?? {
    incomeMinor: 0,
    expenseMinor: 0,
    savingsMinor: 0,
    savingsRateBp: null,
  };
  return {
    tool: "get_spending_summary",
    filters: { period: args.data.period, from: period.dateFrom, to: period.dateTo, currency },
    facts: `Between ${formatIsoDate(period.dateFrom, "en-MY")} and ${formatIsoDate(period.dateTo, "en-MY")} you earned ${formatMinor(t.incomeMinor, currency)}, spent ${formatMinor(t.expenseMinor, currency)}, and ${t.savingsMinor >= 0 ? "saved" : "overspent by"} ${formatMinor(Math.abs(t.savingsMinor), currency)}${t.savingsRateBp !== null ? ` (${formatBp(t.savingsRateBp)} savings rate)` : ""}.`,
    verified: {
      amountsMinor: [t.incomeMinor, t.expenseMinor, t.savingsMinor, Math.abs(t.savingsMinor)],
      pctBp: t.savingsRateBp !== null ? [t.savingsRateBp] : [],
    },
    evidence: [
      { label: "Income", value: formatMinor(t.incomeMinor, currency) },
      { label: "Expenses", value: formatMinor(t.expenseMinor, currency) },
      { label: "Savings", value: formatMinor(t.savingsMinor, currency) },
      {
        label: "Savings rate",
        value: t.savingsRateBp !== null ? formatBp(t.savingsRateBp) : "— (no income)",
      },
    ],
    links: [
      {
        label: "Open in Analytics",
        href: `/analytics?period=${args.data.period}`,
      },
    ],
    assumptions: ["Posted, non-excluded transactions only; refunds already subtracted."],
  };
};

const billsArgs = z.object({ days: z.coerce.number().int().min(1).max(60).default(14) });

const runUpcomingBills: ToolRunner = async (db, userId, today, rawArgs) => {
  const args = billsArgs.safeParse(rawArgs ?? {});
  if (!args.success) return null;
  const { due, clusters } = await recurringService.upcoming(db, userId, {
    from: today,
    days: args.data.days,
  });
  const top = due.slice(0, 8);
  const totalMinor = due.reduce((sum, bill) => sum + bill.typicalAmountMinor, 0);
  return {
    tool: "get_upcoming_bills",
    filters: { from: today, days: String(args.data.days) },
    facts:
      due.length === 0
        ? `No recurring bills are expected in the next ${args.data.days} days.`
        : `${due.length} recurring bill(s) totalling ${formatMinor(totalMinor, "MYR")} are expected in the next ${args.data.days} days${clusters.length > 0 ? `, including a cluster of ${clusters[0].count} around ${formatIsoDate(clusters[0].start, "en-MY")}` : ""}.`,
    verified: { amountsMinor: [totalMinor, ...top.map((b) => b.typicalAmountMinor)], pctBp: [] },
    evidence: top.map((bill) => ({
      label: `${bill.name} · ${formatIsoDate(bill.nextExpectedOn, "en-MY")}${bill.source === "inferred" ? " (inferred)" : ""}`,
      value: formatMinor(bill.typicalAmountMinor, bill.currency),
    })),
    links: [{ label: "Open Recurring", href: "/recurring" }],
    assumptions: ["Amounts are estimates from your own history; inferred bills may vary."],
  };
};

const runSafeToSpend: ToolRunner = async (db, userId, today) => {
  const sts = await intelService.safeToSpend(db, userId, today);
  if (!sts.ok) return null;
  const { result, currency } = sts.data;
  return {
    tool: "get_safe_to_spend",
    filters: { asOf: today, until: sts.data.payday, currency },
    facts: `You can safely spend about ${formatMinor(result.expected.todayMinor, currency)} today and ${formatMinor(result.expected.untilPaydayMinor, currency)} until ${formatIsoDate(sts.data.payday, "en-MY")}${result.isRange ? ` (range ${formatMinor(result.conservative.untilPaydayMinor, currency)} to ${formatMinor(result.optimistic.untilPaydayMinor, currency)} — some bills and income are still estimates)` : ""}.`,
    verified: {
      amountsMinor: [
        result.expected.todayMinor,
        result.expected.untilPaydayMinor,
        result.conservative.untilPaydayMinor,
        result.optimistic.untilPaydayMinor,
      ],
      pctBp: [],
    },
    evidence: [
      { label: "Safe to spend today", value: formatMinor(result.expected.todayMinor, currency) },
      {
        label: "Until payday",
        value: formatMinor(result.expected.untilPaydayMinor, currency),
      },
      {
        label: "Conservative – optimistic",
        value: `${formatMinor(result.conservative.untilPaydayMinor, currency)} – ${formatMinor(result.optimistic.untilPaydayMinor, currency)}`,
      },
    ],
    links: [{ label: "See the full breakdown on Overview", href: "/overview" }],
    assumptions: [
      "Reserves upcoming bills, remaining budget plans, goal contributions, and your safety buffer.",
    ],
  };
};

const runGoalStatus: ToolRunner = async (db, userId, today) => {
  const goals = (await goalsService.listWithProgress(db, userId, today)).filter(
    (goal) => goal.status === "active",
  );
  const top = goals.slice(0, 5);
  const behind = goals.filter(
    (g) => g.outlook.timeStatus === "behind" || g.outlook.timeStatus === "overdue",
  ).length;
  return {
    tool: "get_goal_status",
    filters: { asOf: today, activeGoals: String(goals.length) },
    facts:
      goals.length === 0
        ? "You have no active savings goals."
        : `You have ${goals.length} active goal(s); ${behind === 0 ? "none are" : `${behind} ${behind === 1 ? "is" : "are"}`} behind schedule at the current contribution rate.`,
    verified: { amountsMinor: top.flatMap((g) => [g.savedMinor, g.targetAmountMinor]), pctBp: [] },
    evidence: top.map((goal) => ({
      label: `${goal.name} (${goal.outlook.timeStatus.replaceAll("_", " ")})`,
      value: `${formatMinor(goal.savedMinor, goal.currency)} of ${formatMinor(goal.targetAmountMinor, goal.currency)}`,
    })),
    links: [{ label: "Open Goals", href: "/goals" }],
    assumptions: [
      "Status compares estimated completion with target dates — deterministic, not a prediction.",
    ],
  };
};

const affordabilityArgs = z.object({ amount: z.string().min(1) });

const runAffordability: ToolRunner = async (db, userId, today, rawArgs) => {
  const args = affordabilityArgs.safeParse(rawArgs ?? {});
  if (!args.success) return null;
  const amountMinor = parseAmountToMinor(args.data.amount);
  if (amountMinor === null || amountMinor <= 0) return null;
  const [sts, forecast] = await Promise.all([
    intelService.safeToSpend(db, userId, today),
    intelService.cashFlowForecast(db, userId, { horizonDays: 30, today }),
  ]);
  if (!sts.ok || !forecast.ok) return null;
  const currency = sts.data.currency;
  const buffer = sts.data.result.breakdown.safetyBufferMinor;
  const worstAfter = forecast.data.lowestConservative.balanceMinor - amountMinor;
  const verdict = worstAfter >= buffer ? "comfortably yes" : worstAfter >= 0 ? "tight" : "not yet";

  // Earliest safer date: first day whose remaining conservative path stays
  // at or above the buffer after the purchase (suffix minima, integer math).
  let saferDate: string | null = null;
  const series = forecast.data.series;
  const suffixMin: number[] = new Array(series.length);
  for (let i = series.length - 1; i >= 0; i--) {
    suffixMin[i] = Math.min(
      series[i].conservativeMinor,
      i + 1 < series.length ? suffixMin[i + 1] : series[i].conservativeMinor,
    );
  }
  for (let i = 0; i < series.length; i++) {
    if (suffixMin[i] - amountMinor >= buffer) {
      saferDate = series[i].date;
      break;
    }
  }

  return {
    tool: "run_affordability_check",
    filters: { amount: formatMinor(amountMinor, currency), horizon: "30 days", asOf: today },
    facts: `Spending ${formatMinor(amountMinor, currency)} now: ${verdict}. On the conservative path your balance would bottom out at ${formatMinor(worstAfter, currency)} within 30 days, against a ${formatMinor(buffer, currency)} safety buffer${verdict !== "comfortably yes" && saferDate ? `; it looks safer after ${formatIsoDate(saferDate, "en-MY")}` : ""}.`,
    verified: {
      amountsMinor: [
        amountMinor,
        worstAfter,
        buffer,
        forecast.data.lowestConservative.balanceMinor,
      ],
      pctBp: [],
    },
    evidence: [
      { label: "Purchase amount", value: formatMinor(amountMinor, currency) },
      {
        label: "Lowest projected balance after purchase (conservative)",
        value: formatMinor(worstAfter, currency),
      },
      { label: "Safety buffer", value: formatMinor(buffer, currency) },
      ...(saferDate
        ? [{ label: "Looks safer after", value: formatIsoDate(saferDate, "en-MY") }]
        : []),
    ],
    links: [{ label: "See the projection on Overview", href: "/overview" }],
    assumptions: [
      "Uses the 30-day conservative forecast band (confirmed income only, bills padded).",
      "Educational information, not financial advice.",
    ],
  };
};

const trendArgs = z.object({ category: z.string().min(1).max(60) });

const runCategoryTrend: ToolRunner = async (db, userId, today, rawArgs) => {
  const args = trendArgs.safeParse(rawArgs ?? {});
  if (!args.success) return null;
  const current = resolvePeriod("last-month", today);
  const flows = await analyticsService.monthlyFlows(db, userId, {
    dateFrom: addDaysIso(current.dateFrom, -92),
    dateTo: current.dateTo,
  });
  if (!flows.ok) return null;
  // Trend is category-level: reuse the breakdown per month for the named category.
  const months = [...new Set(flows.data.map((f) => f.month))].slice(-3);
  const values: Array<{ month: string; amountMinor: number }> = [];
  for (const month of months) {
    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const breakdown = await analyticsService.categoryBreakdown(db, userId, {
      dateFrom: start,
      dateTo: end,
      kind: "expense",
    });
    if (!breakdown.ok) return null;
    const row = breakdown.data.find(
      (r) => r.categoryName.toLowerCase() === args.data.category.toLowerCase(),
    );
    values.push({ month, amountMinor: row?.amountMinor ?? 0 });
  }
  const latest = values[values.length - 1];
  return {
    tool: "get_category_trend",
    filters: { category: args.data.category, months: String(values.length) },
    facts: `${args.data.category} spending over the last ${values.length} complete months: ${values.map((v) => formatMinor(v.amountMinor, "MYR")).join(", ")} — most recently ${formatMinor(latest?.amountMinor ?? 0, "MYR")}.`,
    verified: { amountsMinor: values.map((v) => v.amountMinor), pctBp: [] },
    evidence: values.map((v) => ({ label: v.month, value: formatMinor(v.amountMinor, "MYR") })),
    links: [{ label: "Open in Analytics", href: "/analytics" }],
    assumptions: ["Split-aware, refund-reducing category totals; posted transactions only."],
  };
};

export const TOOL_REGISTRY: Record<string, ToolRunner> = {
  get_spending_summary: runSpendingSummary,
  get_upcoming_bills: runUpcomingBills,
  get_safe_to_spend: runSafeToSpend,
  get_goal_status: runGoalStatus,
  run_affordability_check: runAffordability,
  get_category_trend: runCategoryTrend,
};

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);
