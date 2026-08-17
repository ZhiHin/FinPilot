import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { uuidv7 } from "@/lib/ids";
import { normalizeSeriesKey } from "@/lib/recurrence";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { aiFeedback, aiSuggestions, categories, categorizationRules } from "@/server/db/schema";
import { transactionsService } from "@/server/services/transactions";

/**
 * Category suggestions (ADR-013): rules + a statistical scorer — never a
 * per-transaction LLM call. User rules always win; the scorer learns only
 * from the user's own history (corrections are batch-incorporated on every
 * scan by construction, never retrained on a single event). Every suggestion
 * goes to the ACTION QUEUE and changes nothing until explicitly approved
 * (spec B4); approvals flow through the existing audited transaction paths.
 *
 * Scorer v1 (documented):
 * - merchant_history: the most common category among the user's categorized
 *   transactions for the same merchant (needs ≥2 samples). Confidence
 *   6000 + 400 × min(samples, 8); +500 when the history is unanimous.
 * - token_match fallback: shared description tokens (length ≥ 4) with
 *   categorized history (needs ≥2 supporting rows). Confidence 5500 + 250 ×
 *   min(samples, 6).
 * - Suggestions below 6000 bp are discarded — silence beats noise.
 * - merchant_rule: a merchant with ≥3 unanimous user-categorized rows and no
 *   existing rule gets a proposed rule ("always categorize X as Y"); approving
 *   it creates the `categorization_rules` row and applies it to the current
 *   needs-review set.
 */

const SCORER_VERSION = "scorer-v1";

export interface RuleConditions {
  merchantContains?: string;
  descriptionContains?: string;
}

export interface RuleActions {
  setCategoryId: string;
}

interface ReviewTxn extends Record<string, unknown> {
  id: string;
  description: string;
  merchant_id: string | null;
  merchant_name: string | null;
  version: number;
}

function matchesRule(conditions: RuleConditions, txn: ReviewTxn): boolean {
  if (conditions.merchantContains) {
    if (!txn.merchant_name?.toLowerCase().includes(conditions.merchantContains.toLowerCase())) {
      return false;
    }
  }
  if (conditions.descriptionContains) {
    if (!txn.description.toLowerCase().includes(conditions.descriptionContains.toLowerCase())) {
      return false;
    }
  }
  return Boolean(conditions.merchantContains || conditions.descriptionContains);
}

export const categorizeService = {
  /**
   * Scan needs-review transactions and (re)fill the queue. Idempotent: the
   * partial-unique (user, kind, target) index keeps one live suggestion per
   * transaction/merchant; snoozed suggestions past their date reopen; stale
   * pending ones (>30 days) expire.
   */
  async scan(db: Db, userId: string): Promise<Result<{ created: number }>> {
    // Housekeeping first: wake snoozes, expire stale pendings.
    await db.execute(sql`
      update ai_suggestions set status = 'pending', snoozed_until = null
      where user_id = ${userId} and status = 'snoozed' and snoozed_until <= now()
    `);
    await db.execute(sql`
      update ai_suggestions set status = 'expired', resolved_at = now()
      where user_id = ${userId} and status = 'pending' and created_at < now() - interval '30 days'
    `);

    const reviewRows = (
      await db.execute<ReviewTxn>(sql`
        select t.id, t.description_original as description, t.merchant_id,
               m.canonical_name as merchant_name, t.version
        from transactions t
        left join merchants m on m.id = t.merchant_id
        where t.user_id = ${userId} and t.deleted_at is null and t.needs_review = true
          and t.type in ('expense', 'income', 'refund')
          and (t.category_id is null or t.categorization_source <> 'user')
        order by t.txn_date desc
        limit 200
      `)
    ).rows;
    if (reviewRows.length === 0) return ok({ created: 0 });

    const rules = await db
      .select()
      .from(categorizationRules)
      .where(and(eq(categorizationRules.userId, userId), eq(categorizationRules.isActive, true)))
      .orderBy(categorizationRules.priority);

    // The user's own categorized history — the scorer's only training data.
    const history = (
      await db.execute<{
        merchant_id: string | null;
        category_id: string;
        description: string;
        source: string;
      }>(sql`
        select t.merchant_id, t.category_id, t.description_original as description,
               t.categorization_source as source
        from transactions t
        where t.user_id = ${userId} and t.deleted_at is null and t.category_id is not null
          and t.categorization_source in ('user', 'rule', 'default')
          and t.type in ('expense', 'income', 'refund')
        order by t.txn_date desc
        limit 2000
      `)
    ).rows;

    const byMerchant = new Map<string, Map<string, number>>();
    const byToken = new Map<string, Map<string, number>>();
    for (const row of history) {
      if (row.merchant_id) {
        const counts = byMerchant.get(row.merchant_id) ?? new Map<string, number>();
        counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
        byMerchant.set(row.merchant_id, counts);
      }
      for (const token of normalizeSeriesKey(row.description).split(" ")) {
        if (token.length < 4) continue;
        const counts = byToken.get(token) ?? new Map<string, number>();
        counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
        byToken.set(token, counts);
      }
    }
    const categoryNames = new Map(
      (
        await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.userId, userId))
      ).map((c) => [c.id, c.name]),
    );

    let created = 0;
    const insert = async (values: typeof aiSuggestions.$inferInsert): Promise<void> => {
      try {
        await db.insert(aiSuggestions).values(values);
        created += 1;
      } catch {
        // Live suggestion already exists for this target — dedup index held.
      }
    };

    for (const txn of reviewRows) {
      // Rules always win (first active match by priority).
      const rule = rules.find((r) => matchesRule(r.conditions as RuleConditions, txn));
      if (rule) {
        const action = rule.actions as RuleActions;
        if (categoryNames.has(action.setCategoryId)) {
          await insert({
            id: uuidv7(),
            userId,
            kind: "category_correction",
            targetEntityType: "transaction",
            targetEntityId: txn.id,
            proposedChange: { categoryId: action.setCategoryId, expectedVersion: txn.version },
            rationale: `Matches your rule “${rule.name}”.`,
            confidenceBp: 9500,
            evidence: { reasons: ["user_rule"], ruleId: rule.id, ruleName: rule.name },
            source: "deterministic",
            modelVersion: null,
          });
          continue;
        }
      }

      // Scorer: merchant history first, token overlap as fallback.
      let best: {
        categoryId: string;
        confidenceBp: number;
        reasons: string[];
        samples: number;
      } | null = null;
      if (txn.merchant_id && byMerchant.has(txn.merchant_id)) {
        const counts = [...byMerchant.get(txn.merchant_id)!.entries()].sort((a, b) => b[1] - a[1]);
        const [categoryId, samples] = counts[0];
        if (samples >= 2) {
          const unanimous = counts.length === 1;
          best = {
            categoryId,
            confidenceBp: Math.min(6000 + 400 * Math.min(samples, 8) + (unanimous ? 500 : 0), 9500),
            reasons: ["merchant_history"],
            samples,
          };
        }
      }
      if (!best) {
        const tokenVotes = new Map<string, number>();
        for (const token of normalizeSeriesKey(txn.description).split(" ")) {
          if (token.length < 4) continue;
          for (const [categoryId, count] of byToken.get(token) ?? []) {
            tokenVotes.set(categoryId, (tokenVotes.get(categoryId) ?? 0) + count);
          }
        }
        const sorted = [...tokenVotes.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0 && sorted[0][1] >= 2) {
          best = {
            categoryId: sorted[0][0],
            confidenceBp: Math.min(5500 + 250 * Math.min(sorted[0][1], 6), 8000),
            reasons: ["token_match"],
            samples: sorted[0][1],
          };
        }
      }
      if (!best || best.confidenceBp < 6000) continue;
      const categoryName = categoryNames.get(best.categoryId);
      if (!categoryName) continue;
      await insert({
        id: uuidv7(),
        userId,
        kind: "category_correction",
        targetEntityType: "transaction",
        targetEntityId: txn.id,
        proposedChange: { categoryId: best.categoryId, expectedVersion: txn.version },
        rationale: `You’ve put ${best.samples} similar transaction(s)${txn.merchant_name ? ` from ${txn.merchant_name}` : ""} in ${categoryName}.`,
        confidenceBp: best.confidenceBp,
        evidence: { reasons: best.reasons, samples: best.samples },
        source: "model",
        modelVersion: SCORER_VERSION,
      });
    }

    // merchant_rule proposals: unanimous, well-supported, not yet a rule.
    const reviewMerchants = new Set(
      reviewRows.map((t) => t.merchant_id).filter((id): id is string => id !== null),
    );
    for (const merchantId of reviewMerchants) {
      const counts = byMerchant.get(merchantId);
      if (!counts || counts.size !== 1) continue;
      const [categoryId, samples] = [...counts.entries()][0];
      if (samples < 3) continue;
      const merchantName = reviewRows.find((t) => t.merchant_id === merchantId)?.merchant_name;
      const categoryName = categoryNames.get(categoryId);
      if (!merchantName || !categoryName) continue;
      const existingRule = rules.find(
        (r) =>
          (r.conditions as RuleConditions).merchantContains?.toLowerCase() ===
          merchantName.toLowerCase(),
      );
      if (existingRule) continue;
      await insert({
        id: uuidv7(),
        userId,
        kind: "merchant_rule",
        targetEntityType: "merchant",
        targetEntityId: merchantId,
        proposedChange: { merchantContains: merchantName, setCategoryId: categoryId },
        rationale: `All ${samples} of your categorized ${merchantName} transactions are ${categoryName} — a rule would categorize future ones automatically.`,
        confidenceBp: Math.min(7000 + 300 * Math.min(samples, 8), 9500),
        evidence: { reasons: ["unanimous_merchant_history"], samples },
        source: "model",
        modelVersion: SCORER_VERSION,
      });
    }

    if (created > 0) {
      await auditRepo.record(db, {
        id: uuidv7(),
        userId,
        actor: "system",
        eventType: "suggestion.generated",
        entityType: "ai_suggestion",
        entityId: null,
        diff: { created },
      });
    }
    return ok({ created });
  },

  async listQueue(db: Db, userId: string) {
    return db
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.userId, userId), eq(aiSuggestions.status, "pending")))
      .orderBy(desc(aiSuggestions.confidenceBp), desc(aiSuggestions.createdAt))
      .limit(50);
  },

  async pendingCount(db: Db, userId: string): Promise<number> {
    const [row] = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int as n from ai_suggestions
        where user_id = ${userId} and status = 'pending'
      `)
    ).rows;
    return Number(row?.n ?? 0);
  },

  /**
   * Resolve a queue item (spec B4 — the ONLY path from suggestion to change):
   * - approve: apply the exact proposed patch via the audited services;
   * - edit: apply a user-chosen category instead (recorded as feedback);
   * - dismiss: no change; optional reason recorded as feedback;
   * - snooze: hide for 7 days.
   */
  async resolve(
    db: Db,
    userId: string,
    suggestionId: string,
    action:
      | { kind: "approve" }
      | { kind: "edit"; categoryId: string }
      | { kind: "dismiss"; reasonCode?: string }
      | { kind: "snooze" },
  ): Promise<Result<{ status: string }>> {
    const [suggestion] = await db
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.id, suggestionId), eq(aiSuggestions.userId, userId)))
      .limit(1);
    if (!suggestion) return err("not_found", "That suggestion doesn’t exist.");
    if (suggestion.status !== "pending" && suggestion.status !== "snoozed") {
      return err("conflict", "That suggestion was already resolved.");
    }

    if (action.kind === "snooze") {
      await db
        .update(aiSuggestions)
        .set({ status: "snoozed", snoozedUntil: new Date(Date.now() + 7 * 24 * 60 * 60_000) })
        .where(eq(aiSuggestions.id, suggestionId));
      return ok({ status: "snoozed" });
    }

    if (action.kind === "dismiss") {
      await db.transaction(async (tx) => {
        await tx
          .update(aiSuggestions)
          .set({ status: "dismissed", resolvedAt: sql`now()` })
          .where(eq(aiSuggestions.id, suggestionId));
        if (action.reasonCode) {
          await tx.insert(aiFeedback).values({
            id: uuidv7(),
            userId,
            suggestionId,
            verdict: action.reasonCode === "wrong_category" ? "wrong" : "not_helpful",
            reasonCode: action.reasonCode,
          });
        }
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "suggestion.dismissed",
          entityType: "ai_suggestion",
          entityId: suggestionId,
          diff: { reasonCode: action.reasonCode ?? null },
        });
      });
      return ok({ status: "dismissed" });
    }

    // approve / edit — apply through the audited domain services.
    if (suggestion.kind === "category_correction") {
      const change = z
        .object({ categoryId: z.string().uuid() })
        .safeParse(suggestion.proposedChange);
      if (!change.success || !suggestion.targetEntityId) {
        return err("invalid_input", "This suggestion can’t be applied.");
      }
      const categoryId = action.kind === "edit" ? action.categoryId : change.data.categoryId;
      const applied = await transactionsService.bulkSetCategory(db, userId, {
        transactionIds: [suggestion.targetEntityId],
        categoryId,
      });
      if (!applied.ok) return applied;
      // Approving a categorization IS the review — clear the flag.
      await transactionsService.setReviewed(db, userId, [suggestion.targetEntityId], true);
    } else if (suggestion.kind === "merchant_rule") {
      const change = z
        .object({ merchantContains: z.string().min(1), setCategoryId: z.string().uuid() })
        .safeParse(suggestion.proposedChange);
      if (!change.success) return err("invalid_input", "This suggestion can’t be applied.");
      const categoryId = action.kind === "edit" ? action.categoryId : change.data.setCategoryId;
      const [owned] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!owned) return err("not_found", "That category doesn’t exist.");
      await db.transaction(async (tx) => {
        const [maxPriority] = (
          await tx.execute<{ p: number }>(
            sql`select coalesce(max(priority), 0)::int as p from categorization_rules where user_id = ${userId}`,
          )
        ).rows;
        const ruleId = uuidv7();
        await tx.insert(categorizationRules).values({
          id: ruleId,
          userId,
          name: `Always categorize ${change.data.merchantContains}`,
          priority: Number(maxPriority?.p ?? 0) + 1,
          conditions: { merchantContains: change.data.merchantContains },
          actions: { setCategoryId: categoryId },
        });
        // Apply to the current needs-review rows of this merchant.
        await tx.execute(sql`
          update transactions set category_id = ${categoryId}::uuid,
            categorization_source = 'rule', applied_rule_id = ${ruleId}::uuid,
            needs_review = false, version = version + 1, updated_at = now()
          where user_id = ${userId} and deleted_at is null and needs_review = true
            and merchant_id = ${suggestion.targetEntityId}::uuid and type <> 'transfer'
        `);
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "rule.created_from_suggestion",
          entityType: "categorization_rule",
          entityId: ruleId,
          diff: { merchantContains: change.data.merchantContains, categoryId },
        });
      });
    } else {
      return err("invalid_input", "This suggestion kind isn’t applicable yet.");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(aiSuggestions)
        .set({ status: action.kind === "edit" ? "edited" : "approved", resolvedAt: sql`now()` })
        .where(eq(aiSuggestions.id, suggestionId));
      if (action.kind === "edit") {
        await tx.insert(aiFeedback).values({
          id: uuidv7(),
          userId,
          suggestionId,
          verdict: "wrong",
          reasonCode: "edited_category",
        });
      }
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: `suggestion.${action.kind === "edit" ? "edited" : "approved"}`,
        entityType: "ai_suggestion",
        entityId: suggestionId,
        diff: { kind: suggestion.kind },
      });
    });
    return ok({ status: action.kind === "edit" ? "edited" : "approved" });
  },

  /** Explicit user feedback on an insight card (thumbs). */
  async recordInsightFeedback(
    db: Db,
    userId: string,
    insightId: string,
    verdict: "helpful" | "not_helpful" | "wrong",
  ): Promise<Result<{ recorded: true }>> {
    try {
      await db.insert(aiFeedback).values({ id: uuidv7(), userId, insightId, verdict });
    } catch (error) {
      const chain = `${error instanceof Error ? error.message : ""} ${
        error instanceof Error && error.cause instanceof Error ? error.cause.message : ""
      }`;
      if (/another user|not found/i.test(chain)) {
        return err("not_found", "That insight doesn’t exist.");
      }
      throw error;
    }
    return ok({ recorded: true as const });
  },
} as const;
