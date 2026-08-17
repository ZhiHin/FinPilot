import { sql, type SQL } from "drizzle-orm";

import { isValidIsoDate } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";

/**
 * FinPilot's reporting engine — every dashboard/analytics number funnels
 * through here so the financial formulas exist in exactly one place.
 *
 * Reporting rules (spec §6, documented in transactionsService.summary):
 * - Reports cover posted ∧ not-excluded ∧ not-deleted transactions.
 * - Income  = Σ amount where type = income.
 * - Expense = Σ (−amount) where type = expense, minus Σ amount where type = refund.
 * - Transfers, adjustments, and debt payments are never income or expense.
 * - Savings = income − expense. Savings rate = savings ÷ income (null on
 *   zero/negative income — never a misleading percentage).
 * - Currencies are never combined; every result is grouped by currency.
 * - Balances (net-position trend) additionally INCLUDE excluded transactions
 *   and exclude pending ones — mirroring accountsService.balanceSelection.
 */

// ---------------------------------------------------------------------------
// Pure formulas (unit-tested; UI and exports must not re-derive these).
// ---------------------------------------------------------------------------

export function savingsMinor(incomeMinor: number, expenseMinor: number): number {
  return incomeMinor - expenseMinor;
}

/** Savings rate in basis points (7500 = 75.00%); null when income ≤ 0. */
export function savingsRateBp(incomeMinor: number, savings: number): number | null {
  if (incomeMinor <= 0) return null;
  return Math.round((savings * 10_000) / incomeMinor);
}

/**
 * Change vs a baseline in basis points (1200 = +12.00%); null when the
 * baseline is zero — the UI must say "New / no previous activity" instead.
 */
export function changeBp(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 10_000) / Math.abs(previous));
}

// ---------------------------------------------------------------------------
// Query filter
// ---------------------------------------------------------------------------

export interface AnalyticsRange {
  dateFrom: string;
  dateTo: string;
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
}

export interface PeriodTotals {
  incomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
  savingsRateBp: number | null;
}

export interface MonthlyFlow extends PeriodTotals {
  month: string; // "YYYY-MM"
  currency: string;
}

export interface CategoryBreakdownRow {
  currency: string;
  categoryId: string | null;
  categoryName: string;
  groupName: string | null;
  amountMinor: number;
}

export interface MerchantRow {
  currency: string;
  merchantId: string;
  name: string;
  spendMinor: number;
  txnCount: number;
}

export interface NetPositionPoint {
  month: string;
  currency: string;
  assetsMinor: number;
  liabilitiesMinor: number;
  netMinor: number;
}

export interface DataQuality {
  pendingCount: number;
  needsReviewCount: number;
  uncategorizedCount: number;
  uncommittedImportJobs: number;
}

const LIABILITY_TYPES_SQL = sql`('credit_card', 'loan', 'liability_other')`;

function uuidInList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/**
 * Fail closed: every id supplied in a filter must belong to the caller.
 * Unknown or foreign ids reject the whole request rather than silently
 * narrowing it (an attacker probing ids learns nothing but "not found").
 * Shared by analytics queries and the CSV export.
 */
export async function assertFilterIdsOwned(
  db: Db,
  userId: string,
  ids: { accountIds?: string[]; categoryIds?: string[]; tagIds?: string[] },
): Promise<Result<null>> {
  const checks: Array<{ ids: string[] | undefined; table: SQL }> = [
    { ids: ids.accountIds, table: sql`accounts` },
    { ids: ids.categoryIds, table: sql`categories` },
    { ids: ids.tagIds, table: sql`tags` },
  ];
  for (const { ids: list, table } of checks) {
    if (!list?.length) continue;
    const unique = [...new Set(list)];
    const [row] = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${table} where user_id = ${userId} and id in (${uuidInList(unique)})`,
      )
    ).rows;
    if (Number(row?.n ?? 0) !== unique.length) {
      return err("not_found", "That filter isn’t available.");
    }
  }
  return ok(null);
}

async function assertFilterOwnership(
  db: Db,
  userId: string,
  filter: AnalyticsRange,
): Promise<Result<null>> {
  if (!isValidIsoDate(filter.dateFrom) || !isValidIsoDate(filter.dateTo)) {
    return err("invalid_input", "Please pick a valid date range.");
  }
  if (filter.dateFrom > filter.dateTo) {
    return err("invalid_input", "The start date must not be after the end date.");
  }
  return assertFilterIdsOwned(db, userId, filter);
}

/** WHERE fragment for reporting rows on `t` (alias for transactions). */
function reportWhere(userId: string, filter: AnalyticsRange): SQL {
  const conditions: SQL[] = [
    sql`t.user_id = ${userId}`,
    sql`t.status = 'posted'`,
    sql`t.is_excluded = false`,
    sql`t.deleted_at is null`,
    sql`t.txn_date >= ${filter.dateFrom}::date`,
    sql`t.txn_date <= ${filter.dateTo}::date`,
  ];
  if (filter.accountIds?.length) {
    conditions.push(sql`t.account_id in (${uuidInList(filter.accountIds)})`);
  }
  if (filter.tagIds?.length) {
    conditions.push(
      sql`exists (select 1 from transaction_tags tt where tt.transaction_id = t.id and tt.tag_id in (${uuidInList(filter.tagIds)}))`,
    );
  }
  return sql.join(conditions, sql` and `);
}

/**
 * Split-aware effective rows: a transaction with splits contributes its split
 * amounts/categories (they sum exactly to the parent — DB invariant C3), one
 * without contributes itself. No row is ever counted twice.
 */
function effectiveRowsCte(userId: string, filter: AnalyticsRange): SQL {
  const categoryFilter = filter.categoryIds?.length
    ? sql` where eff.category_id in (${uuidInList(filter.categoryIds)})`
    : sql``;
  return sql`
    with eff as (
      select t.id, t.txn_date, t.currency, t.type, t.merchant_id,
             coalesce(s.category_id, t.category_id) as category_id,
             coalesce(s.amount_minor, t.amount_minor)::bigint as amount_minor
      from transactions t
      left join transaction_splits s on s.transaction_id = t.id
      where ${reportWhere(userId, filter)}
        and t.type in ('income', 'expense', 'refund')
    )
    select * from eff${categoryFilter}
  `;
}

function toTotals(income: number, grossExpense: number, refunds: number): PeriodTotals {
  const expenseMinor = grossExpense - refunds;
  const savings = savingsMinor(income, expenseMinor);
  return {
    incomeMinor: income,
    expenseMinor,
    savingsMinor: savings,
    savingsRateBp: savingsRateBp(income, savings),
  };
}

export const analyticsService = {
  /** Per-currency income/expense/savings for a date range (with filters). */
  async periodTotals(
    db: Db,
    userId: string,
    filter: AnalyticsRange,
  ): Promise<Result<Record<string, PeriodTotals>>> {
    const owned = await assertFilterOwnership(db, userId, filter);
    if (!owned.ok) return owned;
    const rows = (
      await db.execute<{
        currency: string;
        income: number;
        gross_expense: number;
        refunds: number;
      }>(sql`
        select currency,
               coalesce(sum(amount_minor) filter (where type = 'income'), 0)::bigint as income,
               coalesce(sum(-amount_minor) filter (where type = 'expense'), 0)::bigint as gross_expense,
               coalesce(sum(amount_minor) filter (where type = 'refund'), 0)::bigint as refunds
        from (${effectiveRowsCte(userId, filter)}) rows
        group by currency
      `)
    ).rows;
    const result: Record<string, PeriodTotals> = {};
    for (const row of rows) {
      result[row.currency.trim()] = toTotals(
        Number(row.income),
        Number(row.gross_expense),
        Number(row.refunds),
      );
    }
    return ok(result);
  },

  /** Calendar-month income/expense/savings series, zero-filled per currency. */
  async monthlyFlows(
    db: Db,
    userId: string,
    filter: AnalyticsRange,
  ): Promise<Result<MonthlyFlow[]>> {
    const owned = await assertFilterOwnership(db, userId, filter);
    if (!owned.ok) return owned;
    const rows = (
      await db.execute<{
        month: string;
        currency: string;
        income: number;
        gross_expense: number;
        refunds: number;
      }>(sql`
        select to_char(txn_date, 'YYYY-MM') as month, currency,
               coalesce(sum(amount_minor) filter (where type = 'income'), 0)::bigint as income,
               coalesce(sum(-amount_minor) filter (where type = 'expense'), 0)::bigint as gross_expense,
               coalesce(sum(amount_minor) filter (where type = 'refund'), 0)::bigint as refunds
        from (${effectiveRowsCte(userId, filter)}) rows
        group by 1, 2
        order by 1, 2
      `)
    ).rows;

    const { enumerateMonths } = await import("@/lib/periods");
    const months = enumerateMonths(filter.dateFrom, filter.dateTo);
    const currencies = [...new Set(rows.map((r) => r.currency.trim()))];
    const byKey = new Map(rows.map((r) => [`${r.month}|${r.currency.trim()}`, r]));
    const series: MonthlyFlow[] = [];
    for (const currency of currencies.sort()) {
      for (const month of months) {
        const row = byKey.get(`${month}|${currency}`);
        series.push({
          month,
          currency,
          ...toTotals(
            Number(row?.income ?? 0),
            Number(row?.gross_expense ?? 0),
            Number(row?.refunds ?? 0),
          ),
        });
      }
    }
    return ok(series);
  },

  /** Split-aware spending (or income) per category; refunds reduce their category. */
  async categoryBreakdown(
    db: Db,
    userId: string,
    filter: AnalyticsRange & { kind: "expense" | "income" },
  ): Promise<Result<CategoryBreakdownRow[]>> {
    const owned = await assertFilterOwnership(db, userId, filter);
    if (!owned.ok) return owned;
    const typeFilter =
      filter.kind === "expense" ? sql`type in ('expense', 'refund')` : sql`type = 'income'`;
    const amount =
      filter.kind === "expense" ? sql`sum(-amount_minor)::bigint` : sql`sum(amount_minor)::bigint`;
    const rows = (
      await db.execute<{
        currency: string;
        category_id: string | null;
        category_name: string | null;
        group_name: string | null;
        amount: number;
      }>(sql`
        select rows.currency, rows.category_id, c.name as category_name, g.name as group_name,
               ${amount} as amount
        from (${effectiveRowsCte(userId, filter)}) rows
        left join categories c on c.id = rows.category_id
        left join category_groups g on g.id = c.group_id
        where ${typeFilter}
        group by rows.currency, rows.category_id, c.name, g.name
        having ${amount} <> 0
        order by amount desc
      `)
    ).rows;
    return ok(
      rows.map((row) => ({
        currency: row.currency.trim(),
        categoryId: row.category_id,
        categoryName: row.category_name ?? "Uncategorized",
        groupName: row.group_name,
        amountMinor: Number(row.amount),
      })),
    );
  },

  /** Top merchants by net expense (expense − refunds), per currency. */
  async topMerchants(
    db: Db,
    userId: string,
    filter: AnalyticsRange & { limit?: number },
  ): Promise<Result<MerchantRow[]>> {
    const owned = await assertFilterOwnership(db, userId, filter);
    if (!owned.ok) return owned;
    const limit = Math.min(Math.max(filter.limit ?? 10, 1), 50);
    const categoryCondition = filter.categoryIds?.length
      ? sql` and (t.category_id in (${uuidInList(filter.categoryIds)}) or exists (
          select 1 from transaction_splits s
          where s.transaction_id = t.id and s.category_id in (${uuidInList(filter.categoryIds)})))`
      : sql``;
    const rows = (
      await db.execute<{
        currency: string;
        merchant_id: string;
        name: string;
        spend: number;
        txn_count: number;
      }>(sql`
        select t.currency, t.merchant_id, m.canonical_name as name,
               sum(-t.amount_minor)::bigint as spend,
               count(*) filter (where t.type = 'expense')::int as txn_count
        from transactions t
        join merchants m on m.id = t.merchant_id
        where ${reportWhere(userId, filter)}
          and t.type in ('expense', 'refund')
          and t.merchant_id is not null${categoryCondition}
        group by t.currency, t.merchant_id, m.canonical_name
        having sum(-t.amount_minor) > 0
        order by spend desc
        limit ${limit}
      `)
    ).rows;
    return ok(
      rows.map((row) => ({
        currency: row.currency.trim(),
        merchantId: row.merchant_id,
        name: row.name,
        spendMinor: Number(row.spend),
        txnCount: Number(row.txn_count),
      })),
    );
  },

  /**
   * Month-end net position per currency. Mirrors accountsService balances:
   * posted only, deleted excluded, EXCLUDED TRANSACTIONS INCLUDED (they moved
   * real money), archived accounts included while marked include-in-net-worth.
   * Liability balances keep their sign (debt is negative).
   */
  async netPositionTrend(
    db: Db,
    userId: string,
    range: { dateFrom: string; dateTo: string },
  ): Promise<Result<NetPositionPoint[]>> {
    if (!isValidIsoDate(range.dateFrom) || !isValidIsoDate(range.dateTo)) {
      return err("invalid_input", "Please pick a valid date range.");
    }
    const rows = (
      await db.execute<{
        month: string;
        currency: string;
        assets: number;
        liabilities: number;
      }>(sql`
        with months as (
          select generate_series(
            date_trunc('month', ${range.dateFrom}::date),
            date_trunc('month', ${range.dateTo}::date),
            interval '1 month'
          )::date as month_start
        ),
        acct as (
          select id, currency, type, opening_balance_minor, opening_balance_date
          from accounts
          where user_id = ${userId} and deleted_at is null and include_in_net_worth = true
        ),
        deltas as (
          select account_id, date_trunc('month', txn_date)::date as month_start,
                 sum(amount_minor)::bigint as delta
          from transactions
          where user_id = ${userId} and status = 'posted' and deleted_at is null
          group by 1, 2
        )
        select to_char(m.month_start, 'YYYY-MM') as month,
               a.currency,
               coalesce(sum(b.bal) filter (where a.type not in ${LIABILITY_TYPES_SQL}), 0)::bigint as assets,
               coalesce(sum(b.bal) filter (where a.type in ${LIABILITY_TYPES_SQL}), 0)::bigint as liabilities
        from months m
        join acct a on a.opening_balance_date <= (m.month_start + interval '1 month' - interval '1 day')::date
        cross join lateral (
          select a.opening_balance_minor + coalesce(sum(d.delta), 0) as bal
          from deltas d
          where d.account_id = a.id and d.month_start <= m.month_start
        ) b
        group by 1, a.currency
        order by 1, a.currency
      `)
    ).rows;
    return ok(
      rows.map((row) => ({
        month: row.month,
        currency: row.currency.trim(),
        assetsMinor: Number(row.assets),
        liabilitiesMinor: Number(row.liabilities),
        netMinor: Number(row.assets) + Number(row.liabilities),
      })),
    );
  },

  /** Honest data-quality notices for the period (never silent). */
  async dataQuality(
    db: Db,
    userId: string,
    range: { dateFrom: string; dateTo: string },
  ): Promise<Result<DataQuality>> {
    if (!isValidIsoDate(range.dateFrom) || !isValidIsoDate(range.dateTo)) {
      return err("invalid_input", "Please pick a valid date range.");
    }
    const [row] = (
      await db.execute<{
        pending: number;
        needs_review: number;
        uncategorized: number;
        uncommitted: number;
      }>(sql`
        select
          (select count(*)::int from transactions t
            where t.user_id = ${userId} and t.deleted_at is null and t.status = 'pending'
              and t.txn_date >= ${range.dateFrom}::date and t.txn_date <= ${range.dateTo}::date) as pending,
          (select count(*)::int from transactions t
            where t.user_id = ${userId} and t.deleted_at is null and t.needs_review = true
              and t.txn_date >= ${range.dateFrom}::date and t.txn_date <= ${range.dateTo}::date) as needs_review,
          (select count(*)::int from transactions t
            where t.user_id = ${userId} and t.deleted_at is null
              and t.type in ('income', 'expense', 'refund') and t.category_id is null
              and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
              and t.txn_date >= ${range.dateFrom}::date and t.txn_date <= ${range.dateTo}::date) as uncategorized,
          (select count(*)::int from import_jobs j
            where j.user_id = ${userId} and j.status in ('mapping', 'validating', 'review')) as uncommitted
      `)
    ).rows;
    return ok({
      pendingCount: Number(row?.pending ?? 0),
      needsReviewCount: Number(row?.needs_review ?? 0),
      uncategorizedCount: Number(row?.uncategorized ?? 0),
      uncommittedImportJobs: Number(row?.uncommitted ?? 0),
    });
  },
} as const;
