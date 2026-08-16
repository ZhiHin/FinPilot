import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";

import { uuidv7 } from "@/lib/ids";
import { assertSafeMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { pgErrorCode, UNIQUE_VIOLATION } from "./shared";
import { auditRepo } from "../db/repositories/audit";
import { accountBalanceSnapshots, accounts, transactions } from "../db/schema";

export type AccountRow = typeof accounts.$inferSelect;
export type AccountType = AccountRow["type"];

export interface AccountWithBalance extends AccountRow {
  /** Opening balance + posted, non-deleted transactions (excluded ones included — documented reporting rule). */
  balanceMinor: number;
  /** Sum of pending, non-deleted transactions (not part of the balance). */
  pendingMinor: number;
  txnCount: number;
}

const LIQUID_TYPES: ReadonlySet<AccountType> = new Set(["cash", "current", "savings", "ewallet"]);
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card",
  "loan",
  "liability_other",
]);

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  currency?: string;
  openingBalanceMinor?: number;
  openingBalanceDate: string;
  creditLimitMinor?: number | null;
  color?: string | null;
  icon?: string | null;
  isLiquid?: boolean;
  includeInNetWorth?: boolean;
}

// NOTE: the correlation uses literal `accounts.id` — a drizzle column ref here
// renders unqualified ("id") and would resolve against the subquery's alias.
const balanceSelection = {
  balanceMinor: sql<number>`(${accounts.openingBalanceMinor} + coalesce((
    select sum(t.amount_minor) from transactions t
    where t.account_id = accounts.id and t.status = 'posted' and t.deleted_at is null
  ), 0))::bigint`.mapWith(Number),
  pendingMinor: sql<number>`coalesce((
    select sum(t.amount_minor) from transactions t
    where t.account_id = accounts.id and t.status = 'pending' and t.deleted_at is null
  ), 0)::bigint`.mapWith(Number),
  txnCount: sql<number>`coalesce((
    select count(*) from transactions t
    where t.account_id = accounts.id and t.deleted_at is null
  ), 0)::int`.mapWith(Number),
};

function withBalance(
  row: AccountRow & { balanceMinor: number; pendingMinor: number; txnCount: number },
): AccountWithBalance {
  return row;
}

export const accountsService = {
  async create(db: Db, userId: string, input: CreateAccountInput): Promise<Result<AccountRow>> {
    const openingBalanceMinor = input.openingBalanceMinor ?? 0;
    assertSafeMinor(openingBalanceMinor);
    if (input.creditLimitMinor != null) {
      assertSafeMinor(input.creditLimitMinor);
      if (input.type !== "credit_card") {
        return err("invalid_input", "Please check the form.", {
          creditLimitMinor: ["Credit limits only apply to credit cards."],
        });
      }
    }
    try {
      const [row] = await db
        .insert(accounts)
        .values({
          id: uuidv7(),
          userId,
          name: input.name.trim(),
          type: input.type,
          currency: input.currency ?? "MYR",
          openingBalanceMinor,
          openingBalanceDate: input.openingBalanceDate,
          creditLimitMinor: input.creditLimitMinor ?? null,
          color: input.color ?? null,
          icon: input.icon ?? null,
          isLiquid: input.isLiquid ?? LIQUID_TYPES.has(input.type),
          includeInNetWorth: input.includeInNetWorth ?? true,
        })
        .returning();
      await auditRepo.record(db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "account.created",
        entityType: "account",
        entityId: row.id,
      });
      return ok(row);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["You already have an account with this name."],
        });
      }
      throw error;
    }
  },

  async list(
    db: Db,
    userId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<AccountWithBalance[]> {
    const conditions = [eq(accounts.userId, userId), isNull(accounts.deletedAt)];
    if (!opts.includeArchived) {
      conditions.push(eq(accounts.status, "active"));
    }
    const rows = await db
      .select({ ...getTableColumns(accounts), ...balanceSelection })
      .from(accounts)
      .where(and(...conditions))
      .orderBy(accounts.sortOrder, accounts.createdAt);
    return rows.map(withBalance);
  },

  async get(db: Db, userId: string, accountId: string): Promise<AccountWithBalance | null> {
    const [row] = await db
      .select({ ...getTableColumns(accounts), ...balanceSelection })
      .from(accounts)
      .where(
        and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
      )
      .limit(1);
    return row ? withBalance(row) : null;
  },

  async update(
    db: Db,
    userId: string,
    accountId: string,
    patch: Partial<
      Pick<
        CreateAccountInput,
        "name" | "creditLimitMinor" | "color" | "icon" | "isLiquid" | "includeInNetWorth"
      > & { openingBalanceMinor: number; openingBalanceDate: string; sortOrder: number }
    >,
    expectedVersion: number,
  ): Promise<Result<AccountRow>> {
    if (patch.openingBalanceMinor !== undefined) assertSafeMinor(patch.openingBalanceMinor);
    if (patch.creditLimitMinor != null) assertSafeMinor(patch.creditLimitMinor);
    try {
      const [row] = await db
        .update(accounts)
        .set({
          ...patch,
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          version: sql`${accounts.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(accounts.id, accountId),
            eq(accounts.userId, userId),
            isNull(accounts.deletedAt),
            eq(accounts.version, expectedVersion),
          ),
        )
        .returning();
      if (row) {
        await auditRepo.record(db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "account.updated",
          entityType: "account",
          entityId: accountId,
          diff: { fields: Object.keys(patch) },
        });
        return ok(row);
      }
      const exists = await this.get(db, userId, accountId);
      if (!exists) return err("not_found", "That account doesn’t exist.");
      return err("conflict", "This account changed in another tab. Refresh and try again.");
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["You already have an account with this name."],
        });
      }
      throw error;
    }
  },

  async setArchived(
    db: Db,
    userId: string,
    accountId: string,
    archived: boolean,
  ): Promise<Result<AccountRow>> {
    const [row] = await db
      .update(accounts)
      .set({ status: archived ? "archived" : "active", updatedAt: sql`now()` })
      .where(
        and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
      )
      .returning();
    if (!row) return err("not_found", "That account doesn’t exist.");
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: archived ? "account.archived" : "account.unarchived",
      entityType: "account",
      entityId: accountId,
    });
    return ok(row);
  },

  /** Deleting is only allowed for accounts with no transaction history (invariant 6). */
  async softDelete(db: Db, userId: string, accountId: string): Promise<Result<{ deleted: true }>> {
    const account = await this.get(db, userId, accountId);
    if (!account) return err("not_found", "That account doesn’t exist.");
    const [{ n }] = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from transactions where account_id = ${accountId}`,
      )
    ).rows;
    if (Number(n) > 0) {
      return err(
        "conflict",
        "This account has transaction history. Archive it instead — history is preserved.",
      );
    }
    await db
      .update(accounts)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "account.deleted",
      entityType: "account",
      entityId: accountId,
    });
    return ok({ deleted: true });
  },

  /**
   * Per-currency net position. Currencies are NEVER combined (invariant 8):
   * the result is keyed by currency and no cross-currency total exists.
   */
  async netPosition(
    db: Db,
    userId: string,
  ): Promise<
    Record<
      string,
      { assetsMinor: number; liabilitiesMinor: number; netMinor: number; liquidMinor: number }
    >
  > {
    const rows = await this.list(db, userId);
    const byCurrency: Record<
      string,
      { assetsMinor: number; liabilitiesMinor: number; netMinor: number; liquidMinor: number }
    > = {};
    for (const account of rows) {
      if (!account.includeInNetWorth) continue;
      const currency = account.currency.trim();
      const bucket = (byCurrency[currency] ??= {
        assetsMinor: 0,
        liabilitiesMinor: 0,
        netMinor: 0,
        liquidMinor: 0,
      });
      if (LIABILITY_TYPES.has(account.type)) {
        bucket.liabilitiesMinor += account.balanceMinor;
      } else {
        bucket.assetsMinor += account.balanceMinor;
      }
      bucket.netMinor += account.balanceMinor;
      if (account.isLiquid && account.status === "active") {
        bucket.liquidMinor += account.balanceMinor;
      }
    }
    return byCurrency;
  },

  async previewReconciliation(
    db: Db,
    userId: string,
    input: { accountId: string; asOf: string; statementBalanceMinor: number },
  ): Promise<Result<{ computedMinor: number; discrepancyMinor: number }>> {
    assertSafeMinor(input.statementBalanceMinor);
    const account = await this.get(db, userId, input.accountId);
    if (!account) return err("not_found", "That account doesn’t exist.");
    const [{ computed }] = (
      await db.execute<{ computed: string }>(
        sql`select (${account.openingBalanceMinor} + coalesce((
          select sum(amount_minor) from transactions
          where account_id = ${input.accountId} and status = 'posted'
            and deleted_at is null and txn_date <= ${input.asOf}
        ), 0))::bigint as computed`,
      )
    ).rows;
    const computedMinor = Number(computed);
    return ok({ computedMinor, discrepancyMinor: input.statementBalanceMinor - computedMinor });
  },

  /** Snapshot + optional adjustment in one database transaction (invariant 9). */
  async recordReconciliation(
    db: Db,
    userId: string,
    input: {
      accountId: string;
      asOf: string;
      statementBalanceMinor: number;
      createAdjustment: boolean;
    },
  ): Promise<Result<{ snapshotId: string; adjustmentTransactionId?: string }>> {
    const preview = await this.previewReconciliation(db, userId, input);
    if (!preview.ok) return preview;
    const account = await this.get(db, userId, input.accountId);
    if (!account) return err("not_found", "That account doesn’t exist.");

    const snapshotId = uuidv7();
    const adjustmentTransactionId =
      input.createAdjustment && preview.data.discrepancyMinor !== 0 ? uuidv7() : undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(accountBalanceSnapshots).values({
          id: snapshotId,
          accountId: input.accountId,
          userId,
          asOf: input.asOf,
          balanceMinor: input.statementBalanceMinor,
          currency: account.currency,
          source: "reconciliation",
          discrepancyMinor: preview.data.discrepancyMinor,
        });
        if (adjustmentTransactionId) {
          await tx.insert(transactions).values({
            id: adjustmentTransactionId,
            userId,
            accountId: input.accountId,
            type: "adjustment",
            status: "posted",
            amountMinor: preview.data.discrepancyMinor,
            currency: account.currency,
            txnDate: input.asOf,
            descriptionOriginal: "Reconciliation adjustment",
          });
        }
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "account.reconciled",
          entityType: "account",
          entityId: input.accountId,
          diff: {
            asOf: input.asOf,
            discrepancyMinor: preview.data.discrepancyMinor,
            adjustmentCreated: Boolean(adjustmentTransactionId),
          },
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "This account was already reconciled for that date.");
      }
      throw error;
    }
    return ok({ snapshotId, adjustmentTransactionId });
  },
} as const;
