import { sql, type SQL } from "drizzle-orm";

import { buildTransactionsCsv, type ExportTransactionRow } from "@/lib/csv/export";
import { isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { assertFilterIdsOwned } from "@/server/services/analytics";

/**
 * User-scoped CSV export of the transactions ledger (Phase 4).
 * - Always the session user's rows only; filter ids are ownership-validated
 *   and fail closed. Soft-deleted rows are never exported.
 * - Size limit EXPORT_ROW_LIMIT; per-user rate limit EXPORTS_PER_HOUR
 *   (audit-log-backed, like uploads); every export is audited with counts,
 *   never with row contents.
 * - The CSV contract (columns, escaping) lives in lib/csv/export.
 */

export const EXPORT_ROW_LIMIT = 20_000;
export const EXPORTS_PER_HOUR = 20;

export interface ExportFilter {
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  types?: string[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

const TXN_TYPES = new Set([
  "income",
  "expense",
  "transfer",
  "refund",
  "adjustment",
  "debt_payment",
]);

function uuidInList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

export const exportsService = {
  async exportTransactionsCsv(
    db: Db,
    userId: string,
    filter: ExportFilter,
  ): Promise<Result<{ csv: string; rowCount: number; truncated: boolean }>> {
    if (
      (filter.dateFrom && !isValidIsoDate(filter.dateFrom)) ||
      (filter.dateTo && !isValidIsoDate(filter.dateTo))
    ) {
      return err("invalid_input", "Please pick a valid date range.");
    }
    const owned = await assertFilterIdsOwned(db, userId, filter);
    if (!owned.ok) return owned;

    const recent = await auditRepo.countRecentEvents(db, {
      eventType: "export.transactions",
      since: new Date(Date.now() - 60 * 60_000),
      userId,
    });
    if (recent >= EXPORTS_PER_HOUR) {
      return err(
        "rate_limited",
        "Too many exports in the last hour. Please wait a while and try again.",
      );
    }

    const conditions: SQL[] = [sql`t.user_id = ${userId}`, sql`t.deleted_at is null`];
    if (filter.accountIds?.length) {
      conditions.push(sql`t.account_id in (${uuidInList(filter.accountIds)})`);
    }
    if (filter.categoryIds?.length) {
      conditions.push(sql`t.category_id in (${uuidInList(filter.categoryIds)})`);
    }
    if (filter.tagIds?.length) {
      conditions.push(
        sql`exists (select 1 from transaction_tags tt where tt.transaction_id = t.id and tt.tag_id in (${uuidInList(filter.tagIds)}))`,
      );
    }
    const types = (filter.types ?? []).filter((t) => TXN_TYPES.has(t));
    if (types.length) {
      conditions.push(
        sql`t.type in (${sql.join(
          types.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      );
    }
    if (filter.dateFrom) conditions.push(sql`t.txn_date >= ${filter.dateFrom}::date`);
    if (filter.dateTo) conditions.push(sql`t.txn_date <= ${filter.dateTo}::date`);
    if (filter.search?.trim()) {
      const needle = `%${filter.search.trim()}%`;
      conditions.push(
        sql`(t.description_original ilike ${needle}
          or coalesce(t.description_clean, '') ilike ${needle}
          or exists (select 1 from merchants m2 where m2.id = t.merchant_id and m2.canonical_name ilike ${needle}))`,
      );
    }

    const rows = (
      await db.execute<{
        txn_date: string;
        description: string;
        merchant: string | null;
        category: string | null;
        account: string;
        type: string;
        status: string;
        is_excluded: boolean;
        tags: string[] | null;
        amount_minor: number;
        currency: string;
        notes: string | null;
      }>(sql`
        select t.txn_date::text as txn_date,
               coalesce(t.description_clean, t.description_original) as description,
               m.canonical_name as merchant,
               c.name as category,
               a.name as account,
               t.type::text as type,
               t.status::text as status,
               t.is_excluded,
               tag_names.names as tags,
               t.amount_minor::bigint as amount_minor,
               t.currency,
               t.notes
        from transactions t
        join accounts a on a.id = t.account_id
        left join categories c on c.id = t.category_id
        left join merchants m on m.id = t.merchant_id
        left join lateral (
          select array_agg(tg.name order by tg.name) as names
          from transaction_tags tt join tags tg on tg.id = tt.tag_id
          where tt.transaction_id = t.id
        ) tag_names on true
        where ${sql.join(conditions, sql` and `)}
        order by t.txn_date asc, t.id asc
        limit ${EXPORT_ROW_LIMIT + 1}
      `)
    ).rows;

    const truncated = rows.length > EXPORT_ROW_LIMIT;
    const limited = truncated ? rows.slice(0, EXPORT_ROW_LIMIT) : rows;
    const exportRows: ExportTransactionRow[] = limited.map((row) => ({
      txnDate: row.txn_date,
      description: row.description,
      merchant: row.merchant,
      category: row.category,
      account: row.account,
      type: row.type,
      status: row.status,
      isExcluded: row.is_excluded,
      tags: row.tags ?? [],
      amountMinor: Number(row.amount_minor),
      currency: row.currency.trim(),
      notes: row.notes,
    }));

    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "export.transactions",
      entityType: "export",
      entityId: null,
      diff: { rowCount: exportRows.length, truncated },
    });

    return ok({ csv: buildTransactionsCsv(exportRows), rowCount: exportRows.length, truncated });
  },
} as const;
