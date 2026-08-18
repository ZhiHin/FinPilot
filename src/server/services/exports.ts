import { sql, type SQL } from "drizzle-orm";

import { buildEntityCsv, raw, type ArchiveCell } from "@/lib/csv/archive";
import { buildTransactionsCsv, signedDecimal, type ExportTransactionRow } from "@/lib/csv/export";
import { isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { usersRepo } from "@/server/db/repositories/users";
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

  /**
   * Full-account data-portability export (Phase 10, spec V4 / PDPA access &
   * portability): one file per owned entity, every user-influenced cell
   * formula-injection-safe via the shared archive builder. Includes row ids
   * (relations between files are part of the data). NEVER includes password
   * hashes, session/reset tokens, or ip/subject hashes. Derived caches
   * (forecasts, balance snapshots, import staging rows, AI suggestion
   * internals) are recomputable and excluded — noted in the manifest.
   * Audited with file/row counts only; rate-limited per user.
   */
  async exportAccountArchive(db: Db, userId: string): Promise<Result<AccountArchive>> {
    const recent = await auditRepo.countRecentEvents(db, {
      eventType: "export.account",
      since: new Date(Date.now() - 60 * 60_000),
      userId,
    });
    if (recent >= ACCOUNT_EXPORTS_PER_HOUR) {
      return err(
        "rate_limited",
        "Too many full exports in the last hour. Please wait a while and try again.",
      );
    }

    const user = await usersRepo.findById(db, userId);
    if (!user) return err("unauthorized", "Please sign in again.");
    const prefs = await preferencesRepo.get(db, userId);
    const userCurrency = (prefs?.currency ?? "MYR").trim();

    const files: ArchiveFile[] = [];
    const manifestFiles: Array<{ name: string; rows: number; truncated: boolean }> = [];

    for (const entity of archiveEntities(userId, userCurrency)) {
      const result = await db.execute<Record<string, unknown>>(entity.query);
      const truncated = result.rows.length > EXPORT_ROW_LIMIT;
      const rows = (truncated ? result.rows.slice(0, EXPORT_ROW_LIMIT) : result.rows).map(
        entity.map,
      );
      files.push({ name: entity.file, content: buildEntityCsv(entity.headers, rows) });
      manifestFiles.push({ name: entity.file, rows: rows.length, truncated });
    }

    const exportedAt = new Date().toISOString();
    const profile = {
      format: ARCHIVE_FORMAT,
      exportedAt,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt.toISOString(),
      },
      preferences: prefs
        ? {
            locale: prefs.locale,
            currency: userCurrency,
            timezone: prefs.timezone,
            theme: prefs.theme,
            safetyBufferMinor: prefs.safetyBufferMinor,
            budgetStyle: prefs.budgetStyle,
            privacyMode: prefs.privacyMode,
            aiConsentAt: prefs.aiConsentAt?.toISOString() ?? null,
            dataRetentionMonths: prefs.dataRetentionMonths,
            notificationPrefs: prefs.notificationPrefs,
          }
        : null,
    };
    files.push({ name: "profile.json", content: JSON.stringify(profile, null, 2) });

    const manifest = {
      format: ARCHIVE_FORMAT,
      exportedAt,
      files: manifestFiles,
      notes: [
        "Amounts are signed decimals in the row's currency column.",
        "Cells starting with =, +, -, @, tab, or CR are prefixed with ' to stay plain text in spreadsheets.",
        "Derived data (forecast cache, balance snapshots, import staging rows, AI request metadata) is not included; the app recomputes it from this data.",
        `Each file is capped at ${EXPORT_ROW_LIMIT} rows; "truncated" marks files that hit the cap.`,
      ],
    };
    files.push({ name: "manifest.json", content: JSON.stringify(manifest, null, 2) });

    const totalRows = manifestFiles.reduce((sum, f) => sum + f.rows, 0);
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "export.account",
      entityType: "export",
      entityId: null,
      diff: { files: manifestFiles.length, totalRows },
    });

    return ok({ files, totalRows });
  },
} as const;

/* ------------------------- full-account archive ---------------------------- */

export const ACCOUNT_EXPORTS_PER_HOUR = 5;
const ARCHIVE_FORMAT = "finpilot-account-export/1";

export interface ArchiveFile {
  name: string;
  content: string;
}

export interface AccountArchive {
  files: ArchiveFile[];
  totalRows: number;
}

interface EntitySpec {
  file: string;
  headers: string[];
  query: SQL;
  map: (row: Record<string, unknown>) => ArchiveCell[];
}

const text = (v: unknown): ArchiveCell => (v === null || v === undefined ? null : String(v));
const id = (v: unknown): ArchiveCell => raw(v === null || v === undefined ? null : String(v));
const ts = (v: unknown): ArchiveCell =>
  v === null || v === undefined ? null : raw(v instanceof Date ? v.toISOString() : String(v));
const bool = (v: unknown): ArchiveCell => (v === null || v === undefined ? null : Boolean(v));
const num = (v: unknown): ArchiveCell => (v === null || v === undefined ? null : Number(v));
const money = (v: unknown, currency: string): ArchiveCell =>
  v === null || v === undefined ? null : raw(signedDecimal(Number(v), currency));
const cur = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;

/** jsonb cells: JSON serializations start with a safe character for objects/
 *  arrays/strings; anything else falls back to escaped-text handling. */
const json = (v: unknown): ArchiveCell => {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /^[[{"]/.test(s) ? raw(s) : s;
};

function archiveEntities(userId: string, userCurrency: string): EntitySpec[] {
  return [
    {
      file: "accounts.csv",
      headers: [
        "Id",
        "Name",
        "Type",
        "Currency",
        "Opening balance",
        "Opening balance date",
        "Credit limit",
        "Liquid",
        "In net worth",
        "Status",
        "Created at",
      ],
      query: sql`select id, name, type::text as type, currency, opening_balance_minor,
                        opening_balance_date::text as opening_balance_date, credit_limit_minor,
                        is_liquid, include_in_net_worth, status::text as status, created_at
                 from accounts where user_id = ${userId} and deleted_at is null
                 order by sort_order, name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.name),
        text(r.type),
        text(cur(r.currency, userCurrency)),
        money(r.opening_balance_minor, cur(r.currency, userCurrency)),
        ts(r.opening_balance_date),
        money(r.credit_limit_minor, cur(r.currency, userCurrency)),
        bool(r.is_liquid),
        bool(r.include_in_net_worth),
        text(r.status),
        ts(r.created_at),
      ],
    },
    {
      file: "category_groups.csv",
      headers: ["Id", "Name", "Kind", "Sort order", "Archived at"],
      query: sql`select id, name, kind::text as kind, sort_order, archived_at
                 from category_groups where user_id = ${userId}
                 order by sort_order, name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [id(r.id), text(r.name), text(r.kind), num(r.sort_order), ts(r.archived_at)],
    },
    {
      file: "categories.csv",
      headers: ["Id", "Group id", "Name", "System", "Archived at"],
      query: sql`select id, group_id, name, is_system, archived_at
                 from categories where user_id = ${userId}
                 order by name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [id(r.id), id(r.group_id), text(r.name), bool(r.is_system), ts(r.archived_at)],
    },
    {
      file: "tags.csv",
      headers: ["Id", "Name"],
      query: sql`select id, name from tags where user_id = ${userId} and deleted_at is null
                 order by name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [id(r.id), text(r.name)],
    },
    {
      file: "merchants.csv",
      headers: ["Id", "Canonical name", "Default category id", "Aliases"],
      query: sql`select id, canonical_name, default_category_id, aliases
                 from merchants where user_id = ${userId}
                 order by canonical_name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [id(r.id), text(r.canonical_name), id(r.default_category_id), json(r.aliases)],
    },
    {
      file: "transactions.csv",
      headers: [
        "Id",
        "Date",
        "Description",
        "Merchant",
        "Merchant id",
        "Category",
        "Category id",
        "Account",
        "Account id",
        "Type",
        "Status",
        "Excluded",
        "Needs review",
        "Reimbursable",
        "Tags",
        "Amount",
        "Currency",
        "Notes",
        "Created at",
      ],
      query: sql`
        select t.id, t.txn_date::text as txn_date,
               coalesce(t.description_clean, t.description_original) as description,
               m.canonical_name as merchant, t.merchant_id,
               c.name as category, t.category_id,
               a.name as account, t.account_id,
               t.type::text as type, t.status::text as status,
               t.is_excluded, t.needs_review, t.is_reimbursable,
               tag_names.names as tags,
               t.amount_minor, t.currency, t.notes, t.created_at
        from transactions t
        join accounts a on a.id = t.account_id
        left join categories c on c.id = t.category_id
        left join merchants m on m.id = t.merchant_id
        left join lateral (
          select array_agg(tg.name order by tg.name) as names
          from transaction_tags tt join tags tg on tg.id = tt.tag_id
          where tt.transaction_id = t.id
        ) tag_names on true
        where t.user_id = ${userId} and t.deleted_at is null
        order by t.txn_date asc, t.id asc
        limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        ts(r.txn_date),
        text(r.description),
        text(r.merchant),
        id(r.merchant_id),
        text(r.category),
        id(r.category_id),
        text(r.account),
        id(r.account_id),
        text(r.type),
        text(r.status),
        bool(r.is_excluded),
        bool(r.needs_review),
        bool(r.is_reimbursable),
        text(Array.isArray(r.tags) ? r.tags.join("; ") : null),
        money(r.amount_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        text(r.notes),
        ts(r.created_at),
      ],
    },
    {
      file: "transaction_splits.csv",
      headers: [
        "Id",
        "Transaction id",
        "Category id",
        "Amount",
        "Currency",
        "Reimbursable",
        "Note",
      ],
      query: sql`select s.id, s.transaction_id, s.category_id, s.amount_minor, t.currency,
                        s.is_reimbursable, s.note
                 from transaction_splits s
                 join transactions t on t.id = s.transaction_id
                 where s.user_id = ${userId} and t.deleted_at is null
                 order by s.transaction_id, s.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.transaction_id),
        id(r.category_id),
        money(r.amount_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        bool(r.is_reimbursable),
        text(r.note),
      ],
    },
    {
      file: "transaction_links.csv",
      headers: ["Id", "Link type", "From transaction id", "To transaction id"],
      query: sql`select id, link_type::text as link_type, from_transaction_id, to_transaction_id
                 from transaction_links where user_id = ${userId}
                 order by id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [id(r.id), text(r.link_type), id(r.from_transaction_id), id(r.to_transaction_id)],
    },
    {
      file: "budgets.csv",
      headers: [
        "Id",
        "Name",
        "Mode",
        "Cycle type",
        "Cycle anchor",
        "Currency",
        "Carry negative",
        "Active",
      ],
      query: sql`select id, name, mode::text as mode, cycle_type::text as cycle_type, cycle_anchor,
                        currency, carry_negative, is_active
                 from budgets where user_id = ${userId}
                 order by name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.name),
        text(r.mode),
        text(r.cycle_type),
        json(r.cycle_anchor),
        text(cur(r.currency, userCurrency)),
        bool(r.carry_negative),
        bool(r.is_active),
      ],
    },
    {
      file: "budget_periods.csv",
      headers: [
        "Id",
        "Budget id",
        "Start",
        "End",
        "Status",
        "Expected income",
        "Currency",
        "Notes",
      ],
      query: sql`select p.id, p.budget_id, p.period_start::text as period_start,
                        p.period_end::text as period_end, p.status::text as status,
                        p.expected_income_minor, b.currency, p.notes
                 from budget_periods p join budgets b on b.id = p.budget_id
                 where p.user_id = ${userId}
                 order by p.period_start, p.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.budget_id),
        ts(r.period_start),
        ts(r.period_end),
        text(r.status),
        money(r.expected_income_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        text(r.notes),
      ],
    },
    {
      file: "budget_allocations.csv",
      headers: [
        "Id",
        "Budget period id",
        "Category id",
        "Planned",
        "Rollover in",
        "Currency",
        "Rollover enabled",
        "Notes",
      ],
      query: sql`select al.id, al.budget_period_id, al.category_id, al.planned_minor,
                        al.rollover_in_minor, b.currency, al.rollover_enabled, al.notes
                 from budget_allocations al
                 join budget_periods p on p.id = al.budget_period_id
                 join budgets b on b.id = p.budget_id
                 where al.user_id = ${userId}
                 order by al.budget_period_id, al.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.budget_period_id),
        id(r.category_id),
        money(r.planned_minor, cur(r.currency, userCurrency)),
        money(r.rollover_in_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        bool(r.rollover_enabled),
        text(r.notes),
      ],
    },
    {
      file: "savings_goals.csv",
      headers: [
        "Id",
        "Name",
        "Type",
        "Target amount",
        "Currency",
        "Target date",
        "Priority",
        "Linked account id",
        "Contribution schedule",
        "Status",
      ],
      query: sql`select id, name, type::text as type, target_amount_minor, currency,
                        target_date::text as target_date, priority, linked_account_id,
                        contribution_schedule, status::text as status
                 from savings_goals where user_id = ${userId} and deleted_at is null
                 order by priority, name limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.name),
        text(r.type),
        money(r.target_amount_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        ts(r.target_date),
        num(r.priority),
        id(r.linked_account_id),
        json(r.contribution_schedule),
        text(r.status),
      ],
    },
    {
      file: "goal_contributions.csv",
      headers: ["Id", "Goal id", "Amount", "Currency", "Date", "Kind", "Transaction id", "Note"],
      query: sql`select gc.id, gc.goal_id, gc.amount_minor, g.currency,
                        gc.contributed_on::text as contributed_on, gc.kind::text as kind,
                        gc.transaction_id, gc.note
                 from goal_contributions gc join savings_goals g on g.id = gc.goal_id
                 where gc.user_id = ${userId}
                 order by gc.contributed_on, gc.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.goal_id),
        money(r.amount_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        ts(r.contributed_on),
        text(r.kind),
        id(r.transaction_id),
        text(r.note),
      ],
    },
    {
      file: "recurring_patterns.csv",
      headers: [
        "Id",
        "Name",
        "Direction",
        "Frequency",
        "Schedule",
        "Typical amount",
        "Tolerance",
        "Currency",
        "Next expected",
        "Last seen",
        "Confidence bp",
        "Source",
        "Status",
        "Category id",
        "Account id",
        "Installment",
        "Installments total",
        "Installments observed",
      ],
      query: sql`select id, name, direction::text as direction, frequency::text as frequency,
                        schedule, typical_amount_minor, amount_tolerance_minor, currency,
                        next_expected_on::text as next_expected_on, last_seen_on::text as last_seen_on,
                        confidence_bp, source::text as source, status::text as status,
                        category_id, account_id, is_installment, installments_total,
                        installments_observed
                 from recurring_patterns where user_id = ${userId}
                 order by name, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.name),
        text(r.direction),
        text(r.frequency),
        json(r.schedule),
        money(r.typical_amount_minor, cur(r.currency, userCurrency)),
        money(r.amount_tolerance_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        ts(r.next_expected_on),
        ts(r.last_seen_on),
        num(r.confidence_bp),
        text(r.source),
        text(r.status),
        id(r.category_id),
        id(r.account_id),
        bool(r.is_installment),
        num(r.installments_total),
        num(r.installments_observed),
      ],
    },
    {
      file: "subscriptions.csv",
      headers: [
        "Id",
        "Recurring pattern id",
        "Service name",
        "Billing cycle",
        "Current price",
        "Previous price",
        "Currency",
        "Price changed at",
        "Status",
        "Renewal date",
      ],
      query: sql`select s.id, s.recurring_pattern_id, s.service_name, s.billing_cycle,
                        s.current_price_minor, s.previous_price_minor, rp.currency,
                        s.price_changed_at, s.status::text as status,
                        s.renewal_date::text as renewal_date
                 from subscriptions s
                 left join recurring_patterns rp on rp.id = s.recurring_pattern_id
                 where s.user_id = ${userId}
                 order by s.service_name, s.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.recurring_pattern_id),
        text(r.service_name),
        text(r.billing_cycle),
        money(r.current_price_minor, cur(r.currency, userCurrency)),
        money(r.previous_price_minor, cur(r.currency, userCurrency)),
        text(cur(r.currency, userCurrency)),
        ts(r.price_changed_at),
        text(r.status),
        ts(r.renewal_date),
      ],
    },
    {
      file: "notifications.csv",
      headers: [
        "Id",
        "Type",
        "Severity",
        "Title",
        "Body",
        "Data",
        "Read at",
        "Dismissed at",
        "Created at",
      ],
      query: sql`select id, type, severity::text as severity, title, body, data,
                        read_at, dismissed_at, created_at
                 from notifications where user_id = ${userId}
                 order by created_at, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.type),
        text(r.severity),
        text(r.title),
        text(r.body),
        json(r.data),
        ts(r.read_at),
        ts(r.dismissed_at),
        ts(r.created_at),
      ],
    },
    {
      file: "insights.csv",
      headers: [
        "Id",
        "Type",
        "Severity",
        "Title",
        "Body",
        "Period start",
        "Period end",
        "Comparison",
        "Confidence bp",
        "Data quality",
        "Generated by",
        "Status",
        "Created at",
      ],
      query: sql`select id, type, severity::text as severity, title, body,
                        period_start::text as period_start, period_end::text as period_end,
                        comparison, confidence_bp, data_quality, generated_by::text as generated_by,
                        status::text as status, created_at
                 from insights where user_id = ${userId}
                 order by created_at, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.type),
        text(r.severity),
        text(r.title),
        text(r.body),
        ts(r.period_start),
        ts(r.period_end),
        json(r.comparison),
        num(r.confidence_bp),
        json(r.data_quality),
        text(r.generated_by),
        text(r.status),
        ts(r.created_at),
      ],
    },
    {
      file: "scenarios.csv",
      headers: [
        "Id",
        "Name",
        "Description",
        "Status",
        "Assumptions",
        "Base snapshot at",
        "Created at",
      ],
      query: sql`select id, name, description, status::text as status, assumptions,
                        base_snapshot_at, created_at
                 from scenarios where user_id = ${userId} and deleted_at is null
                 order by created_at, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.name),
        text(r.description),
        text(r.status),
        json(r.assumptions),
        ts(r.base_snapshot_at),
        ts(r.created_at),
      ],
    },
    {
      file: "scenario_events.csv",
      headers: [
        "Id",
        "Scenario id",
        "Event type",
        "Effective on",
        "Amount",
        "Currency",
        "Refs",
        "Params",
      ],
      query: sql`select e.id, e.scenario_id, e.event_type::text as event_type,
                        e.effective_on::text as effective_on, e.amount_minor, e.refs, e.params
                 from scenario_events e
                 join scenarios s on s.id = e.scenario_id
                 where e.user_id = ${userId} and s.deleted_at is null
                 order by e.effective_on, e.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.scenario_id),
        text(r.event_type),
        ts(r.effective_on),
        money(r.amount_minor, userCurrency),
        text(userCurrency),
        json(r.refs),
        json(r.params),
      ],
    },
    {
      file: "journal_entries.csv",
      headers: [
        "Id",
        "Kind",
        "Title",
        "Body",
        "Starts on",
        "Ends on",
        "Excluded from baselines",
        "Expected outcome",
        "Review on",
        "Outcome review",
        "Created at",
      ],
      query: sql`select id, kind::text as kind, title, body, starts_on::text as starts_on,
                        ends_on::text as ends_on, exclude_from_baselines, expected_outcome,
                        review_on::text as review_on, outcome_review, created_at
                 from journal_entries where user_id = ${userId} and deleted_at is null
                 order by starts_on, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.kind),
        text(r.title),
        text(r.body),
        ts(r.starts_on),
        ts(r.ends_on),
        bool(r.exclude_from_baselines),
        json(r.expected_outcome),
        ts(r.review_on),
        json(r.outcome_review),
        ts(r.created_at),
      ],
    },
    {
      file: "journal_links.csv",
      headers: ["Id", "Journal entry id", "Entity type", "Entity id"],
      query: sql`select l.id, l.journal_entry_id, l.entity_type, l.entity_id
                 from journal_links l
                 join journal_entries j on j.id = l.journal_entry_id
                 where l.user_id = ${userId} and j.deleted_at is null
                 order by l.journal_entry_id, l.id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [id(r.id), id(r.journal_entry_id), text(r.entity_type), id(r.entity_id)],
    },
    {
      file: "categorization_rules.csv",
      headers: ["Id", "Name", "Priority", "Conditions", "Actions", "Active"],
      query: sql`select id, name, priority, conditions, actions, is_active
                 from categorization_rules where user_id = ${userId}
                 order by priority, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        text(r.name),
        num(r.priority),
        json(r.conditions),
        json(r.actions),
        bool(r.is_active),
      ],
    },
    {
      file: "import_jobs.csv",
      headers: [
        "Id",
        "Account id",
        "Filename",
        "Status",
        "Row count",
        "Committed at",
        "Created at",
      ],
      query: sql`select id, account_id, filename, status::text as status, row_count,
                        committed_at, created_at
                 from import_jobs where user_id = ${userId}
                 order by created_at, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.account_id),
        text(r.filename),
        text(r.status),
        num(r.row_count),
        ts(r.committed_at),
        ts(r.created_at),
      ],
    },
    {
      file: "attachments.csv",
      headers: [
        "Id",
        "Transaction id",
        "Kind",
        "Filename",
        "Mime type",
        "Byte size",
        "Scan status",
      ],
      query: sql`select id, transaction_id, kind::text as kind, filename, mime_type, byte_size,
                        scan_status::text as scan_status
                 from attachments where user_id = ${userId} and deleted_at is null
                 order by created_at, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        id(r.id),
        id(r.transaction_id),
        text(r.kind),
        text(r.filename),
        text(r.mime_type),
        num(r.byte_size),
        text(r.scan_status),
      ],
    },
    {
      file: "audit.csv",
      headers: ["Created at", "Actor", "Event type", "Entity type", "Entity id"],
      query: sql`select created_at, actor::text as actor, event_type, entity_type, entity_id
                 from audit_logs where user_id = ${userId}
                 order by created_at, id limit ${EXPORT_ROW_LIMIT + 1}`,
      map: (r) => [
        ts(r.created_at),
        text(r.actor),
        text(r.event_type),
        text(r.entity_type),
        id(r.entity_id),
      ],
    },
  ];
}
