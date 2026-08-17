import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { formatIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { formatMinor } from "@/lib/money";
import { inQuietHours } from "@/lib/recurrence";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { notifications, subscriptions } from "@/server/db/schema";
import { budgetsService } from "@/server/services/budgets";
import { goalsService } from "@/server/services/goals";
import { recurringService, SERVICE_GROUPS } from "@/server/services/recurring";

/**
 * The notification centre (Phase 6). In-app only; the stored `delivery` shape
 * is email-ready for post-V1. Every producer is deterministic and carries a
 * dedup key:
 * - one LIVE notification per (user, key) — DB partial unique index;
 * - a DISMISSED key is never re-created (the service checks all history);
 * - keys include their period/price/state so genuinely new events (next
 *   month's cluster, a further price change) notify again.
 * Generation respects quiet hours (user-local time): during the quiet window
 * nothing is created; the next generation outside it catches up. Thresholds
 * and per-type switches live in user_preferences.notification_prefs.
 */

export interface NotificationPrefs {
  digestFrequency?: string;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  /** Bills at or above this magnitude notify individually. Default RM 500. */
  largeBillMinor?: number;
  types?: Partial<Record<ProducerType, boolean>>;
}

export type ProducerType =
  | "bill_cluster"
  | "upcoming_bill"
  | "subscription_change"
  | "budget_pace"
  | "goal_behind"
  | "duplicate_service";

export const DEFAULT_LARGE_BILL_MINOR = 50000;

export interface NotificationRow {
  id: string;
  type: string;
  severity: "info" | "attention" | "risk";
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface Candidate {
  type: ProducerType;
  severity: "info" | "attention" | "risk";
  title: string;
  body: string;
  href: string;
  dedupKey: string;
}

function enabled(prefs: NotificationPrefs, type: ProducerType): boolean {
  return prefs.types?.[type] !== false;
}

/** Same-app deep links only — anything else renders as no link. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return /^\/(recurring|budget|goals|transactions|analytics|overview|notifications)(\/|\?|$)/.test(
    raw,
  )
    ? raw
    : null;
}

export const notificationsService = {
  /**
   * Run every producer and insert what's new. Idempotent; safe to call on
   * page loads. `now` is the current instant, used only for quiet hours.
   */
  async generate(
    db: Db,
    userId: string,
    input: { today: string; now?: Date },
  ): Promise<Result<{ created: number; suppressedByQuietHours: boolean }>> {
    const prefsRow = await preferencesRepo.get(db, userId);
    const prefs = (prefsRow?.notificationPrefs ?? {}) as NotificationPrefs;
    const timezone = prefsRow?.timezone ?? "Asia/Kuala_Lumpur";

    const now = input.now ?? new Date();
    const localTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(now);
    if (inQuietHours(localTime, prefs.quietHoursStart, prefs.quietHoursEnd)) {
      return ok({ created: 0, suppressedByQuietHours: true });
    }

    const candidates: Candidate[] = [];

    // ---- Bills: clusters and large upcoming bills ----
    const { due, clusters } = await recurringService.upcoming(db, userId, {
      from: input.today,
      days: 14,
    });
    if (enabled(prefs, "bill_cluster")) {
      for (const cluster of clusters) {
        candidates.push({
          type: "bill_cluster",
          severity: "attention",
          title: `${cluster.count} bills cluster around ${formatIsoDate(cluster.start, "en-MY")}`,
          body: `${cluster.count} recurring bills land between ${formatIsoDate(cluster.start, "en-MY")} and ${formatIsoDate(cluster.end, "en-MY")} — ${formatMinor(cluster.totalMinor, "MYR")} in total. Worth a look before payday plans.`,
          href: "/recurring",
          dedupKey: `bill_cluster:${cluster.start}`,
        });
      }
    }
    if (enabled(prefs, "upcoming_bill")) {
      const threshold = prefs.largeBillMinor ?? DEFAULT_LARGE_BILL_MINOR;
      for (const bill of due) {
        if (bill.typicalAmountMinor < threshold) continue;
        candidates.push({
          type: "upcoming_bill",
          severity: "info",
          title: `${bill.name}: ${formatMinor(bill.typicalAmountMinor, bill.currency)} due ${formatIsoDate(bill.nextExpectedOn, "en-MY")}`,
          body: `A larger recurring ${bill.isInstallment ? "installment" : "bill"} is expected soon. Amounts are estimates from your history.`,
          href: "/recurring",
          dedupKey: `upcoming_bill:${bill.id}:${bill.nextExpectedOn}`,
        });
      }
    }

    // ---- Subscription price changes (evidence-backed) ----
    if (enabled(prefs, "subscription_change")) {
      const subs = await db
        .select()
        .from(subscriptions)
        .where(
          and(eq(subscriptions.userId, userId), isNull(subscriptions.priceChangeAcknowledgedAt)),
        );
      for (const sub of subs) {
        if (sub.priceChangedAt === null || sub.previousPriceMinor === null) continue;
        const evidence = sub.priceEvidence as {
          previousCount: number;
          currentCount: number;
        } | null;
        candidates.push({
          type: "subscription_change",
          severity: "attention",
          title: `${sub.serviceName} price changed`,
          body: `${sub.serviceName} now charges ${formatMinor(sub.currentPriceMinor, "MYR")}, previously ${formatMinor(sub.previousPriceMinor, "MYR")}${evidence ? ` (${evidence.previousCount} charges at the old price, ${evidence.currentCount} at the new)` : ""}.`,
          href: "/recurring?filter=subscriptions",
          dedupKey: `subscription_change:${sub.id}:${sub.currentPriceMinor}`,
        });
      }

      // Possible duplicate services (documented deterministic groups).
      if (enabled(prefs, "duplicate_service")) {
        const activeSubs = await db
          .select({ serviceName: subscriptions.serviceName, status: subscriptions.status })
          .from(subscriptions)
          .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));
        for (const [group, needles] of Object.entries(SERVICE_GROUPS)) {
          const matches = activeSubs.filter((sub) =>
            needles.some((needle) => sub.serviceName.toLowerCase().includes(needle)),
          );
          if (matches.length >= 2) {
            candidates.push({
              type: "duplicate_service",
              severity: "info",
              title: `Two active ${group} subscriptions`,
              body: `${matches.map((m) => m.serviceName).join(" and ")} are both active — possibly overlapping ${group}. Only you can judge; the evidence is on the Recurring screen.`,
              href: "/recurring?filter=subscriptions",
              dedupKey: `duplicate_service:${group}`,
            });
          }
        }
      }
    }

    // ---- Budget pace (deterministic health, current cycle) ----
    if (enabled(prefs, "budget_pace")) {
      const budgets = await budgetsService.list(db, userId);
      const active = budgets.find((b) => b.isActive);
      if (active) {
        const report = await budgetsService.periodReport(db, userId, {
          budgetId: active.id,
          today: input.today,
        });
        if (report.ok) {
          for (const allocation of report.data.allocations) {
            if (allocation.health !== "at_risk" && allocation.health !== "exceeded") continue;
            candidates.push({
              type: "budget_pace",
              severity: allocation.health === "exceeded" ? "risk" : "attention",
              title:
                allocation.health === "exceeded"
                  ? `${allocation.categoryName} budget exceeded`
                  : `${allocation.categoryName} is ahead of pace`,
              body:
                allocation.health === "exceeded"
                  ? `Spending passed the available ${formatMinor(allocation.availableMinor, report.data.budget.currency)} for this cycle.`
                  : `${formatMinor(allocation.remainingMinor, report.data.budget.currency)} remains with ${Math.round((10000 - report.data.totals.elapsedBp) / 100)}% of the cycle left — pace-based, not a prediction.`,
              href: "/budget",
              dedupKey: `budget_pace:${allocation.allocationId}:${report.data.period.periodStart}:${allocation.health}`,
            });
          }
        }
      }
    }

    // ---- Goals behind schedule (deterministic, monthly cadence) ----
    if (enabled(prefs, "goal_behind")) {
      const goals = await goalsService.listWithProgress(db, userId, input.today);
      for (const goal of goals) {
        if (goal.status !== "active") continue;
        if (goal.outlook.timeStatus !== "behind" && goal.outlook.timeStatus !== "overdue") continue;
        candidates.push({
          type: "goal_behind",
          severity: "info",
          title: `${goal.name} is behind schedule`,
          body:
            goal.outlook.requiredMonthlyMinor !== null
              ? `At the current rate this goal misses its target date. It needs ${formatMinor(goal.outlook.requiredMonthlyMinor, goal.currency)}/month from here.`
              : `At the current rate this goal misses its target date.`,
          href: `/goals/${goal.id}`,
          dedupKey: `goal_behind:${goal.id}:${input.today.slice(0, 7)}`,
        });
      }
    }

    // ---- Deduplicated insert (never re-create any key, dismissed included) ----
    let created = 0;
    if (candidates.length > 0) {
      const keys = candidates.map((c) => c.dedupKey);
      const existing = (
        await db.execute<{ dedup_key: string }>(sql`
          select dedup_key from notifications
          where user_id = ${userId} and dedup_key in (${sql.join(
            keys.map((k) => sql`${k}`),
            sql`, `,
          )})
        `)
      ).rows;
      const known = new Set(existing.map((row) => row.dedup_key));
      for (const candidate of candidates) {
        if (known.has(candidate.dedupKey)) continue;
        try {
          await db.insert(notifications).values({
            id: uuidv7(),
            userId,
            type: candidate.type,
            severity: candidate.severity,
            title: candidate.title,
            body: candidate.body,
            data: { href: candidate.href },
            dedupKey: candidate.dedupKey,
          });
          created += 1;
        } catch {
          // Concurrent generation raced us — the unique index kept it single.
        }
      }
    }
    return ok({ created, suppressedByQuietHours: false });
  },

  async list(db: Db, userId: string, opts: { limit?: number } = {}): Promise<NotificationRow[]> {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.dismissedAt)))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(opts.limit ?? 100, 200));
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      body: row.body,
      href: safeHref((row.data as { href?: unknown } | null)?.href),
      readAt: row.readAt,
      createdAt: row.createdAt,
    }));
  },

  async unreadCount(db: Db, userId: string): Promise<number> {
    const [row] = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int as n from notifications
        where user_id = ${userId} and read_at is null and dismissed_at is null
      `)
    ).rows;
    return Number(row?.n ?? 0);
  },

  async markRead(db: Db, userId: string, notificationId: string): Promise<Result<{ read: true }>> {
    const [row] = await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    if (!row) return err("not_found", "That notification doesn’t exist.");
    return ok({ read: true as const });
  },

  async markAllRead(db: Db, userId: string): Promise<{ marked: number }> {
    const rows = await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          isNull(notifications.dismissedAt),
        ),
      )
      .returning({ id: notifications.id });
    return { marked: rows.length };
  },

  /** Dismissal is final for this key — generation never re-creates it. */
  async dismiss(
    db: Db,
    userId: string,
    notificationId: string,
  ): Promise<Result<{ dismissed: true }>> {
    const [row] = await db
      .update(notifications)
      .set({ dismissedAt: sql`now()`, readAt: sql`coalesce(read_at, now())` })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    if (!row) return err("not_found", "That notification doesn’t exist.");
    return ok({ dismissed: true as const });
  },
} as const;
