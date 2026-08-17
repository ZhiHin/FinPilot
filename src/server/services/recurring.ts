import { and, asc, eq, sql } from "drizzle-orm";

import { isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { assertSafeMinor } from "@/lib/money";
import {
  analyzeAmounts,
  annualizedMinor,
  classifyIntervals,
  confidenceBp,
  findClusters,
  nextExpected,
  normalizeSeriesKey,
  type Cluster,
  type RecurringFrequency,
} from "@/lib/recurrence";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { categories, recurringPatterns, subscriptions } from "@/server/db/schema";

/**
 * Recurring detection and review (Phase 6). Fully deterministic — the rules
 * live in lib/recurrence and are documented there; nothing here is a
 * prediction or an AI output, and inferred results are always labeled
 * "inferred" with a confidence that caps below certainty.
 *
 * Detection contract:
 * - Only posted ∧ not-excluded ∧ not-deleted transactions count; outflows are
 *   expenses + debt payments, inflows are income; transfers/refunds/
 *   adjustments never form patterns. Lookback: 13 months.
 * - A series key is the merchant (or the digit-stripped description) plus the
 *   currency; `inference_key` makes rescans idempotent (upsert, never
 *   duplicate).
 * - User-confirmed patterns keep their user-owned fields (name, amounts,
 *   tolerance, category, installment total) — rescans only refresh
 *   observations (last seen, next expected, observed installment count).
 *   Patterns the user ended stay ended; detection never resurrects them.
 * - BNPL/installments are flagged by description/merchant keywords and are
 *   ESTIMATES until the user sets the total ("X observed, total unconfirmed").
 * - Subscriptions: monthly/annual outflows in the "Streaming & subscriptions"
 *   category gain a subscription row; sustained price moves record
 *   evidence-backed price changes (never a single odd charge).
 */

const INSTALLMENT_HINT = /INSTAL|PAYLATER|ATOME|BNPL|SPAYLATER/i;
const SUBSCRIPTION_CATEGORY = "streaming & subscriptions";
const LOOKBACK_MONTHS = 13;

/** Documented duplicate-service groups (deterministic, name-keyed). */
export const SERVICE_GROUPS: Record<string, string[]> = {
  "cloud storage": ["icloud", "google one", "google drive", "onedrive", "dropbox"],
  "music streaming": ["spotify", "apple music", "youtube music", "deezer"],
  "video streaming": ["netflix", "disney", "viu", "iqiyi", "hbo", "prime video"],
};

export interface SubscriptionInfo {
  id: string;
  serviceName: string;
  currentPriceMinor: number;
  previousPriceMinor: number | null;
  priceChangedAt: Date | null;
  priceEvidence: { previousCount: number; currentCount: number } | null;
  status: "active" | "trial" | "canceled" | "unknown";
  usageConfirmedAt: Date | null;
  priceChangeAcknowledgedAt: Date | null;
}

export interface PatternRow {
  id: string;
  name: string;
  merchantId: string | null;
  direction: "inflow" | "outflow";
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "custom";
  typicalAmountMinor: number;
  amountToleranceMinor: number;
  currency: string;
  nextExpectedOn: string;
  lastSeenOn: string | null;
  confidenceBp: number;
  source: "user_confirmed" | "inferred";
  status: "active" | "paused" | "ended";
  categoryId: string | null;
  categoryName: string | null;
  isInstallment: boolean;
  installmentsTotal: number | null;
  installmentsObserved: number;
  annualizedMinor: number | null;
  subscription: SubscriptionInfo | null;
}

function toPatternRow(
  row: typeof recurringPatterns.$inferSelect,
  categoryName: string | null,
  subscription: typeof subscriptions.$inferSelect | null,
): PatternRow {
  return {
    id: row.id,
    name: row.name,
    merchantId: row.merchantId,
    direction: row.direction,
    frequency: row.frequency,
    typicalAmountMinor: row.typicalAmountMinor,
    amountToleranceMinor: row.amountToleranceMinor,
    currency: row.currency.trim(),
    nextExpectedOn: row.nextExpectedOn,
    lastSeenOn: row.lastSeenOn,
    confidenceBp: row.confidenceBp,
    source: row.source,
    status: row.status,
    categoryId: row.categoryId,
    categoryName,
    isInstallment: row.isInstallment,
    installmentsTotal: row.installmentsTotal,
    installmentsObserved: row.installmentsObserved,
    annualizedMinor:
      row.frequency === "custom"
        ? null
        : annualizedMinor(row.typicalAmountMinor, row.frequency as RecurringFrequency),
    subscription: subscription
      ? {
          id: subscription.id,
          serviceName: subscription.serviceName,
          currentPriceMinor: subscription.currentPriceMinor,
          previousPriceMinor: subscription.previousPriceMinor,
          priceChangedAt: subscription.priceChangedAt,
          priceEvidence: (subscription.priceEvidence as SubscriptionInfo["priceEvidence"]) ?? null,
          status: subscription.status,
          usageConfirmedAt: subscription.usageConfirmedAt,
          priceChangeAcknowledgedAt: subscription.priceChangeAcknowledgedAt,
        }
      : null,
  };
}

async function getOwnedPattern(
  db: Db,
  userId: string,
  patternId: string,
): Promise<typeof recurringPatterns.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(recurringPatterns)
    .where(and(eq(recurringPatterns.id, patternId), eq(recurringPatterns.userId, userId)))
    .limit(1);
  return row ?? null;
}

interface SeriesTxn extends Record<string, unknown> {
  txn_date: string;
  amount: number;
  merchant_id: string | null;
  merchant_name: string | null;
  description: string;
  category_id: string | null;
  account_id: string;
  currency: string;
  direction: "inflow" | "outflow";
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

function dominant<T>(values: Array<T | null>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export interface ScanSummary {
  created: number;
  updated: number;
  ended: number;
}

export const recurringService = {
  /**
   * Deterministic rescan over the last 13 months. Idempotent: series upsert
   * by inference key; running twice changes nothing.
   */
  async scan(db: Db, userId: string, today: string): Promise<Result<ScanSummary>> {
    if (!isValidIsoDate(today)) return err("invalid_input", "Invalid date.");
    const rows = (
      await db.execute<SeriesTxn>(sql`
        select t.txn_date::text as txn_date,
               abs(t.amount_minor)::bigint as amount,
               t.merchant_id,
               m.canonical_name as merchant_name,
               t.description_original as description,
               t.category_id,
               t.account_id,
               t.currency,
               case when t.type = 'income' then 'inflow' else 'outflow' end as direction
        from transactions t
        left join merchants m on m.id = t.merchant_id
        where t.user_id = ${userId}
          and t.status = 'posted'
          and t.deleted_at is null
          and t.is_excluded = false
          and t.type in ('expense', 'debt_payment', 'income')
          and t.txn_date >= (${today}::date - interval '${sql.raw(String(LOOKBACK_MONTHS))} months')
          and t.txn_date <= ${today}::date
        order by t.txn_date asc
      `)
    ).rows;

    // Group into series: merchant (or normalized description) + currency + direction.
    // node-postgres returns bigint columns as strings — coerce at the boundary
    // so downstream integer math never string-concatenates.
    const groups = new Map<string, SeriesTxn[]>();
    for (const raw of rows) {
      const row = { ...raw, amount: Number(raw.amount) };
      const base = row.merchant_id
        ? `merchant:${row.merchant_id}`
        : `desc:${normalizeSeriesKey(row.description)}`;
      const key = `${base}|${row.currency.trim()}|${row.direction}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    const summary: ScanSummary = { created: 0, updated: 0, ended: 0 };
    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(recurringPatterns)
        .where(eq(recurringPatterns.userId, userId));
      const byKey = new Map(
        existing.filter((p) => p.inferenceKey).map((p) => [p.inferenceKey as string, p]),
      );
      const seenKeys = new Set<string>();

      for (const [key, txns] of groups) {
        // One occurrence per calendar date (same-day duplicates collapse).
        const byDate = new Map<string, SeriesTxn>();
        for (const txn of txns) if (!byDate.has(txn.txn_date)) byDate.set(txn.txn_date, txn);
        const series = [...byDate.values()];
        if (series.length < 2) continue;
        const dates = series.map((t) => t.txn_date);
        const classification = classifyIntervals(dates);
        if (!classification) continue;
        seenKeys.add(key);

        const amounts = analyzeAmounts(series.map((t) => t.amount));
        const last = series[series.length - 1];
        const isInstallment =
          INSTALLMENT_HINT.test(last.description) ||
          (last.merchant_name !== null && INSTALLMENT_HINT.test(last.merchant_name));
        const name =
          last.merchant_name ??
          titleCase(normalizeSeriesKey(last.description)) ??
          "Recurring payment";
        const confidence = confidenceBp({
          occurrences: series.length,
          intervalDeviationDays: classification.deviationDays,
          amountStable: amounts.stable,
        });
        // Next expected rolls forward to today or later — the upcoming view
        // shows the next plausible date; missed-occurrence detection is
        // Phase 7 anomaly territory, not silently backfilled here.
        let next = nextExpected(last.txn_date, classification.frequency);
        for (let guard = 0; next < today && guard < 60; guard++) {
          next = nextExpected(next, classification.frequency);
        }
        const categoryId = dominant(series.map((t) => t.category_id));
        const accountId = dominant(series.map((t) => t.account_id));

        const current = byKey.get(key);
        let patternId: string;
        if (!current) {
          patternId = uuidv7();
          await tx.insert(recurringPatterns).values({
            id: patternId,
            userId,
            merchantId: last.merchant_id,
            name,
            direction: last.direction,
            frequency: classification.frequency,
            typicalAmountMinor: amounts.typicalMinor,
            amountToleranceMinor: amounts.toleranceMinor,
            currency: last.currency.trim(),
            nextExpectedOn: next,
            lastSeenOn: last.txn_date,
            confidenceBp: confidence,
            source: "inferred",
            categoryId,
            accountId,
            isInstallment,
            installmentsObserved: isInstallment ? series.length : 0,
            inferenceKey: key,
          });
          summary.created += 1;
        } else if (current.status === "ended") {
          // The user (or a previous scan) ended it — never resurrect.
          continue;
        } else {
          patternId = current.id;
          if (current.source === "user_confirmed") {
            // Observations only; user-owned fields stay untouched.
            const observed = isInstallment ? series.length : current.installmentsObserved;
            await tx
              .update(recurringPatterns)
              .set({
                lastSeenOn: last.txn_date,
                nextExpectedOn: next,
                installmentsObserved:
                  current.installmentsTotal !== null
                    ? Math.min(observed, current.installmentsTotal)
                    : observed,
                updatedAt: sql`now()`,
              })
              .where(eq(recurringPatterns.id, current.id));
          } else {
            await tx
              .update(recurringPatterns)
              .set({
                name,
                merchantId: last.merchant_id,
                frequency: classification.frequency,
                typicalAmountMinor: amounts.typicalMinor,
                amountToleranceMinor: amounts.toleranceMinor,
                nextExpectedOn: next,
                lastSeenOn: last.txn_date,
                confidenceBp: confidence,
                categoryId,
                accountId,
                isInstallment,
                installmentsObserved: isInstallment ? series.length : 0,
                updatedAt: sql`now()`,
              })
              .where(eq(recurringPatterns.id, current.id));
          }
          summary.updated += 1;
        }

        // Subscription extension: monthly/annual outflow in the subscriptions category.
        if (
          last.direction === "outflow" &&
          (classification.frequency === "monthly" || classification.frequency === "annual") &&
          categoryId !== null
        ) {
          const [category] = await tx
            .select({ name: categories.name })
            .from(categories)
            .where(eq(categories.id, categoryId))
            .limit(1);
          if (category && category.name.toLowerCase() === SUBSCRIPTION_CATEGORY) {
            const [sub] = await tx
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.recurringPatternId, patternId))
              .limit(1);
            if (!sub) {
              await tx.insert(subscriptions).values({
                id: uuidv7(),
                recurringPatternId: patternId,
                userId,
                serviceName: name,
                billingCycle: classification.frequency,
                currentPriceMinor: amounts.typicalMinor,
                ...(amounts.priceChange
                  ? {
                      previousPriceMinor: amounts.priceChange.previousMinor,
                      priceChangedAt: new Date(),
                      priceEvidence: {
                        previousCount: amounts.priceChange.previousCount,
                        currentCount: amounts.priceChange.currentCount,
                      },
                    }
                  : {}),
              });
            } else if (sub.currentPriceMinor !== amounts.typicalMinor) {
              // Evidence-backed sustained change only (analyzeAmounts already
              // refused single odd charges by keeping typical at the old level).
              await tx
                .update(subscriptions)
                .set({
                  previousPriceMinor: sub.currentPriceMinor,
                  currentPriceMinor: amounts.typicalMinor,
                  priceChangedAt: sql`now()`,
                  priceEvidence: amounts.priceChange
                    ? {
                        previousCount: amounts.priceChange.previousCount,
                        currentCount: amounts.priceChange.currentCount,
                      }
                    : null,
                  priceChangeAcknowledgedAt: null,
                  updatedAt: sql`now()`,
                })
                .where(eq(subscriptions.id, sub.id));
            }
          }
        }
      }

      // Inferred series that stopped appearing get closed out (never confirmed ones).
      for (const pattern of existing) {
        if (!pattern.inferenceKey || seenKeys.has(pattern.inferenceKey)) continue;
        if (pattern.source !== "inferred" || pattern.status === "ended") continue;
        await tx
          .update(recurringPatterns)
          .set({ status: "ended", updatedAt: sql`now()` })
          .where(eq(recurringPatterns.id, pattern.id));
        summary.ended += 1;
      }

      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "system",
        eventType: "recurring.scan",
        entityType: "recurring_pattern",
        entityId: null,
        diff: { ...summary },
      });
    });
    return ok(summary);
  },

  async list(db: Db, userId: string): Promise<PatternRow[]> {
    const rows = await db
      .select({
        pattern: recurringPatterns,
        categoryName: categories.name,
        subscription: subscriptions,
      })
      .from(recurringPatterns)
      .leftJoin(categories, eq(categories.id, recurringPatterns.categoryId))
      .leftJoin(subscriptions, eq(subscriptions.recurringPatternId, recurringPatterns.id))
      .where(eq(recurringPatterns.userId, userId))
      .orderBy(asc(recurringPatterns.nextExpectedOn));
    return rows.map((row) => toPatternRow(row.pattern, row.categoryName, row.subscription));
  },

  /** Active patterns due inside [from, from+days], plus bill clusters. */
  async upcoming(
    db: Db,
    userId: string,
    input: { from: string; days: number },
  ): Promise<{ due: PatternRow[]; clusters: Cluster[] }> {
    const all = await this.list(db, userId);
    const to = new Date(
      Date.UTC(
        Number(input.from.slice(0, 4)),
        Number(input.from.slice(5, 7)) - 1,
        Number(input.from.slice(8, 10)) + input.days,
      ),
    )
      .toISOString()
      .slice(0, 10);
    const due = all.filter(
      (p) =>
        p.status === "active" &&
        p.direction === "outflow" &&
        p.nextExpectedOn >= input.from &&
        p.nextExpectedOn <= to,
    );
    const clusters = findClusters(
      due.map((p) => ({ date: p.nextExpectedOn, amountMinor: p.typicalAmountMinor })),
      5,
      3,
    );
    return { due, clusters };
  },

  /** User confirmation: certainty and protection of user-owned fields. */
  async confirm(db: Db, userId: string, patternId: string): Promise<Result<{ confirmed: true }>> {
    const pattern = await getOwnedPattern(db, userId, patternId);
    if (!pattern) return err("not_found", "That pattern doesn’t exist.");
    await db.transaction(async (tx) => {
      await tx
        .update(recurringPatterns)
        .set({ source: "user_confirmed", confidenceBp: 10000, updatedAt: sql`now()` })
        .where(eq(recurringPatterns.id, patternId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "recurring.confirmed",
        entityType: "recurring_pattern",
        entityId: patternId,
        diff: {},
      });
    });
    return ok({ confirmed: true as const });
  },

  /** pause / resume (active) / end ("not recurring" — never resurrected). */
  async setStatus(
    db: Db,
    userId: string,
    patternId: string,
    status: "active" | "paused" | "ended",
  ): Promise<Result<{ status: string }>> {
    const pattern = await getOwnedPattern(db, userId, patternId);
    if (!pattern) return err("not_found", "That pattern doesn’t exist.");
    await db.transaction(async (tx) => {
      await tx
        .update(recurringPatterns)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(recurringPatterns.id, patternId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: `recurring.${status === "ended" ? "ended" : status}`,
        entityType: "recurring_pattern",
        entityId: patternId,
        diff: { from: pattern.status },
      });
    });
    return ok({ status });
  },

  /** Editing a pattern is a user statement — it becomes confirmed. */
  async update(
    db: Db,
    userId: string,
    patternId: string,
    patch: Partial<{
      name: string;
      typicalAmountMinor: number;
      amountToleranceMinor: number;
      categoryId: string | null;
      nextExpectedOn: string;
      installmentsTotal: number | null;
    }>,
  ): Promise<Result<{ updated: true }>> {
    const pattern = await getOwnedPattern(db, userId, patternId);
    if (!pattern) return err("not_found", "That pattern doesn’t exist.");
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 80)) {
      return err("invalid_input", "Please give the pattern a name (up to 80 characters).");
    }
    if (patch.typicalAmountMinor !== undefined) {
      assertSafeMinor(patch.typicalAmountMinor);
      if (patch.typicalAmountMinor <= 0) {
        return err("invalid_input", "The amount must be above zero.");
      }
    }
    if (patch.amountToleranceMinor !== undefined) {
      assertSafeMinor(patch.amountToleranceMinor);
      if (patch.amountToleranceMinor < 0) {
        return err("invalid_input", "Tolerance can’t be negative.");
      }
    }
    if (patch.nextExpectedOn !== undefined && !isValidIsoDate(patch.nextExpectedOn)) {
      return err("invalid_input", "That date isn’t valid.");
    }
    if (patch.installmentsTotal !== undefined && patch.installmentsTotal !== null) {
      if (
        !Number.isInteger(patch.installmentsTotal) ||
        patch.installmentsTotal < Math.max(pattern.installmentsObserved, 1)
      ) {
        return err(
          "invalid_input",
          `The total must be at least the ${pattern.installmentsObserved} payment(s) already observed.`,
        );
      }
    }
    if (patch.categoryId) {
      const [owned] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, patch.categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!owned) return err("not_found", "That category doesn’t exist.");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(recurringPatterns)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.typicalAmountMinor !== undefined
            ? { typicalAmountMinor: patch.typicalAmountMinor }
            : {}),
          ...(patch.amountToleranceMinor !== undefined
            ? { amountToleranceMinor: patch.amountToleranceMinor }
            : {}),
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
          ...(patch.nextExpectedOn !== undefined ? { nextExpectedOn: patch.nextExpectedOn } : {}),
          ...(patch.installmentsTotal !== undefined
            ? { installmentsTotal: patch.installmentsTotal }
            : {}),
          source: "user_confirmed",
          confidenceBp: 10000,
          updatedAt: sql`now()`,
        })
        .where(eq(recurringPatterns.id, patternId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "recurring.updated",
        entityType: "recurring_pattern",
        entityId: patternId,
        diff: { changed: Object.keys(patch) },
      });
    });
    return ok({ updated: true as const });
  },

  /** "Mark as subscription" / "Not a sub". */
  async setSubscription(
    db: Db,
    userId: string,
    patternId: string,
    isSubscription: boolean,
  ): Promise<Result<{ updated: true }>> {
    const pattern = await getOwnedPattern(db, userId, patternId);
    if (!pattern) return err("not_found", "That pattern doesn’t exist.");
    await db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.recurringPatternId, patternId))
        .limit(1);
      if (isSubscription && !sub) {
        await tx.insert(subscriptions).values({
          id: uuidv7(),
          recurringPatternId: patternId,
          userId,
          serviceName: pattern.name,
          billingCycle: pattern.frequency,
          currentPriceMinor: pattern.typicalAmountMinor,
        });
      } else if (!isSubscription && sub) {
        await tx.delete(subscriptions).where(eq(subscriptions.id, sub.id));
      }
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: isSubscription ? "subscription.marked" : "subscription.unmarked",
        entityType: "recurring_pattern",
        entityId: patternId,
        diff: {},
      });
    });
    return ok({ updated: true as const });
  },

  async acknowledgePriceChange(
    db: Db,
    userId: string,
    subscriptionId: string,
  ): Promise<Result<{ acknowledged: true }>> {
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!sub) return err("not_found", "That subscription doesn’t exist.");
    await db
      .update(subscriptions)
      .set({ priceChangeAcknowledgedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(subscriptions.id, subscriptionId));
    return ok({ acknowledged: true as const });
  },

  /** User-stated usage check-in — never inferred. */
  async confirmUsage(
    db: Db,
    userId: string,
    subscriptionId: string,
  ): Promise<Result<{ confirmed: true }>> {
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!sub) return err("not_found", "That subscription doesn’t exist.");
    await db
      .update(subscriptions)
      .set({ usageConfirmedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(subscriptions.id, subscriptionId));
    return ok({ confirmed: true as const });
  },
} as const;
