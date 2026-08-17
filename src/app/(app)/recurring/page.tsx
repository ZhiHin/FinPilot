import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { BillCalendar } from "@/features/recurring/calendar";
import {
  PatternEditDialog,
  PatternQuickActions,
  RescanButton,
  SubscriptionEvidenceActions,
} from "@/features/recurring/row-actions";
import { cn } from "@/lib/cn";
import type { CycleAnchor } from "@/lib/cycles";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatMinor, minorToAmountInput } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { notificationsService } from "@/server/services/notifications";
import { recurringService, type PatternRow } from "@/server/services/recurring";

export const metadata: Metadata = { title: t("nav.recurring") };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "inferred", label: "Inferred" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "bnpl", label: "BNPL" },
] as const;

function confidenceLabel(pattern: PatternRow): string {
  if (pattern.source === "user_confirmed") return "—";
  if (pattern.confidenceBp >= 8000) return "High";
  if (pattern.confidenceBp >= 6500) return "Medium";
  return "Low";
}

function TypeBadges({ pattern }: { pattern: PatternRow }) {
  return (
    <span className="flex flex-wrap gap-1">
      {pattern.source === "user_confirmed" ? (
        <Badge variant="positive">Confirmed</Badge>
      ) : (
        <Badge>Inferred</Badge>
      )}
      {pattern.subscription ? <Badge variant="info">Subscription</Badge> : null}
      {pattern.isInstallment ? <Badge variant="attention">BNPL estimate</Badge> : null}
      {pattern.status === "paused" ? <Badge>Paused</Badge> : null}
      {pattern.direction === "inflow" ? <Badge variant="positive">Income</Badge> : null}
    </span>
  );
}

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; filter?: string; month?: string }>;
}) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";
  const today = localDateInTz(new Date(), timezone);

  // First visit: run the deterministic scan once, then refresh notifications.
  let patterns = await recurringService.list(db, user.id);
  if (patterns.length === 0) {
    await recurringService.scan(db, user.id, today);
    await notificationsService.generate(db, user.id, { today });
    patterns = await recurringService.list(db, user.id);
  }

  const view = sp.view === "calendar" ? "calendar" : "list";
  const filter = (FILTERS.map((f) => f.key) as string[]).includes(sp.filter ?? "")
    ? (sp.filter as (typeof FILTERS)[number]["key"])
    : "all";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : today.slice(0, 7);

  const visible = patterns
    .filter((p) => p.status !== "ended")
    .filter((p) => {
      switch (filter) {
        case "confirmed":
          return p.source === "user_confirmed";
        case "inferred":
          return p.source === "inferred";
        case "subscriptions":
          return p.subscription !== null;
        case "bnpl":
          return p.isInstallment;
        default:
          return true;
      }
    });
  const endedCount = patterns.filter((p) => p.status === "ended").length;
  const { clusters } = await recurringService.upcoming(db, user.id, { from: today, days: 14 });

  const income = (prefs?.incomePattern ?? null) as {
    day?: number | "last";
    weekendAdjust?: boolean;
  } | null;
  const paydayAnchor: CycleAnchor | null =
    income?.day != null ? { day: income.day, weekendAdjust: income.weekendAdjust ?? true } : null;

  const hrefFor = (overrides: Record<string, string | undefined>): string => {
    const params = new URLSearchParams();
    const merged = { view, filter, month, ...overrides };
    if (merged.view === "calendar") params.set("view", "calendar");
    if (merged.filter && merged.filter !== "all") params.set("filter", merged.filter);
    if (merged.view === "calendar" && merged.month) params.set("month", merged.month);
    const qs = params.toString();
    return qs ? `/recurring?${qs}` : "/recurring";
  };
  const monthShift = (delta: number): string => {
    const [y, m] = month.split("-").map(Number);
    const index = y * 12 + (m - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };

  return (
    <>
      <PageHeader
        title={t("nav.recurring")}
        description="Bills, subscriptions, and installments detected from your own history — always labeled inferred until you confirm them."
        actions={<RescanButton />}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="View" className="flex gap-1">
            <Link
              href={hrefFor({ view: "list" })}
              aria-current={view === "list" ? "page" : undefined}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[13px] font-medium",
                view === "list"
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:bg-sunken",
              )}
            >
              List
            </Link>
            <Link
              href={hrefFor({ view: "calendar" })}
              aria-current={view === "calendar" ? "page" : undefined}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[13px] font-medium",
                view === "calendar"
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:bg-sunken",
              )}
            >
              Calendar
            </Link>
          </nav>
          <nav aria-label="Filter" className="flex flex-wrap gap-1">
            {FILTERS.map((entry) => (
              <Link
                key={entry.key}
                href={hrefFor({ filter: entry.key })}
                aria-current={filter === entry.key ? "page" : undefined}
                className={cn(
                  "rounded-chip px-3 py-1 text-[12.5px]",
                  filter === entry.key
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-sunken",
                )}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        </div>

        {clusters.length > 0 ? (
          <Banner variant="attention">
            Next 14 days: {clusters[0].count} bills cluster between{" "}
            {formatIsoDate(clusters[0].start, "en-MY")} and{" "}
            {formatIsoDate(clusters[0].end, "en-MY")} —{" "}
            <AmountText amountMinor={clusters[0].totalMinor} currency="MYR" /> in total.
          </Banner>
        ) : null}

        {view === "calendar" ? (
          <>
            <nav aria-label="Calendar month" className="flex items-center gap-2">
              <Link
                href={hrefFor({ view: "calendar", month: monthShift(-1) })}
                className="rounded-control border border-hairline px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-sunken"
              >
                ← Previous month
              </Link>
              <Link
                href={hrefFor({ view: "calendar", month: monthShift(1) })}
                className="rounded-control border border-hairline px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-sunken"
              >
                Next month →
              </Link>
            </nav>
            <BillCalendar
              patterns={visible}
              month={month}
              paydayAnchor={paydayAnchor}
              today={today}
            />
          </>
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              patterns.length === 0 ? "Nothing recurring detected yet" : `No ${filter} patterns`
            }
            description={
              patterns.length === 0
                ? "Detection needs at least three similar charges (two for annual bills) in your posted history. Import statements or record transactions, then rescan."
                : "Try another filter above."
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-card border border-hairline bg-card lg:block">
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  Recurring patterns: name, type, amount, next due date, annual cost, confidence,
                  and actions.
                </caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Next due
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Annual cost
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Confidence
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((pattern) => (
                    <Fragment key={pattern.id}>
                      <tr key={pattern.id} className="border-b border-hairline last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-medium text-ink">{pattern.name}</span>
                          {pattern.categoryName ? (
                            <span className="ml-1.5 text-[11.5px] text-ink-muted">
                              {pattern.categoryName}
                            </span>
                          ) : null}
                          {pattern.isInstallment ? (
                            <p className="text-[11.5px] text-ink-muted">
                              {pattern.installmentsTotal !== null
                                ? `${pattern.installmentsObserved} of ${pattern.installmentsTotal} payments — ${pattern.installmentsTotal - pattern.installmentsObserved} left`
                                : `${pattern.installmentsObserved} payment(s) observed — total unconfirmed (estimate)`}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <TypeBadges pattern={pattern} />
                        </td>
                        <td className="num px-3 py-2 text-right">
                          <AmountText
                            amountMinor={pattern.typicalAmountMinor}
                            currency={pattern.currency}
                          />
                          {pattern.amountToleranceMinor > 0 ? (
                            <span className="block text-[11.5px] text-ink-muted">
                              ± {formatMinor(pattern.amountToleranceMinor, pattern.currency)}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {pattern.status === "active"
                            ? formatIsoDate(pattern.nextExpectedOn, "en-MY")
                            : "—"}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {pattern.annualizedMinor !== null && !pattern.isInstallment ? (
                            <AmountText
                              amountMinor={pattern.annualizedMinor}
                              currency={pattern.currency}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">{confidenceLabel(pattern)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <PatternEditDialog
                              initial={{
                                patternId: pattern.id,
                                name: pattern.name,
                                amount: minorToAmountInput(
                                  pattern.typicalAmountMinor,
                                  pattern.currency,
                                ),
                                tolerance:
                                  pattern.amountToleranceMinor > 0
                                    ? minorToAmountInput(
                                        pattern.amountToleranceMinor,
                                        pattern.currency,
                                      )
                                    : "",
                                nextExpectedOn: pattern.nextExpectedOn,
                                isInstallment: pattern.isInstallment,
                                installmentsTotal:
                                  pattern.installmentsTotal !== null
                                    ? String(pattern.installmentsTotal)
                                    : "",
                                installmentsObserved: pattern.installmentsObserved,
                              }}
                            />
                            <PatternQuickActions
                              patternId={pattern.id}
                              status={pattern.status}
                              source={pattern.source}
                              hasSubscription={pattern.subscription !== null}
                            />
                          </div>
                        </td>
                      </tr>
                      {pattern.subscription &&
                      pattern.subscription.priceChangedAt &&
                      pattern.subscription.previousPriceMinor !== null &&
                      !pattern.subscription.priceChangeAcknowledgedAt ? (
                        <tr
                          key={`${pattern.id}-evidence`}
                          className="border-b border-hairline bg-sunken/50"
                        >
                          <td colSpan={7} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-secondary">
                              <span>
                                ▸ Price change evidence:{" "}
                                {formatMinor(
                                  pattern.subscription.previousPriceMinor,
                                  pattern.currency,
                                )}
                                {pattern.subscription.priceEvidence
                                  ? ` ×${pattern.subscription.priceEvidence.previousCount}`
                                  : ""}{" "}
                                →{" "}
                                {formatMinor(
                                  pattern.subscription.currentPriceMinor,
                                  pattern.currency,
                                )}
                                {pattern.subscription.priceEvidence
                                  ? ` ×${pattern.subscription.priceEvidence.currentCount}`
                                  : ""}
                              </span>
                              <SubscriptionEvidenceActions
                                subscriptionId={pattern.subscription.id}
                                showAcknowledge
                              />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {visible.map((pattern) => (
                <li key={pattern.id} className="rounded-card border border-hairline bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink">{pattern.name}</span>
                    <TypeBadges pattern={pattern} />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-ink-secondary">
                    <dt>Amount</dt>
                    <dd className="num text-right">
                      <AmountText
                        amountMinor={pattern.typicalAmountMinor}
                        currency={pattern.currency}
                      />
                    </dd>
                    <dt>Next due</dt>
                    <dd className="text-right">
                      {pattern.status === "active"
                        ? formatIsoDate(pattern.nextExpectedOn, "en-MY")
                        : "—"}
                    </dd>
                    <dt>Confidence</dt>
                    <dd className="text-right">{confidenceLabel(pattern)}</dd>
                  </dl>
                  <div className="mt-2">
                    <PatternQuickActions
                      patternId={pattern.id}
                      status={pattern.status}
                      source={pattern.source}
                      hasSubscription={pattern.subscription !== null}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {endedCount > 0 ? (
          <p className="text-[11.5px] text-ink-muted">
            {endedCount} pattern(s) marked not recurring or ended — they stay out of this list and
            are never re-detected.
          </p>
        ) : null}
        <p className="text-[11.5px] text-ink-muted">
          Detection is a deterministic rule over your posted transactions (documented in the Phase 6
          notes): at least three similar charges at regular intervals, amounts within tolerance.
          BNPL totals are estimates until you confirm them. We never claim to cancel anything for
          you.
        </p>
      </div>
    </>
  );
}
