import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatBp } from "@/components/charts/format";
import { AssistantPanel } from "@/features/intel/assistant-panel";
import { DismissInsightButton, InsightFeedback } from "@/features/intel/insight-controls";
import { QueuePanel, type QueueCategoryOption, type QueueItem } from "@/features/intel/queue-panel";
import { cn } from "@/lib/cn";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatMinor } from "@/lib/money";
import { aiAvailability } from "@/server/ai/gateway";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { SUGGESTED_QUESTIONS } from "@/server/services/assistant";
import { categoriesService } from "@/server/services/categories";
import { categorizeService } from "@/server/services/categorize";
import { intelService } from "@/server/services/intel";
import { phrasingService } from "@/server/services/phrasing";

export const metadata: Metadata = { title: t("nav.insights") };

function ConfidenceLabel({ bp }: { bp: number }) {
  const label = bp >= 8500 ? "High" : bp >= 7000 ? "Medium" : "Low";
  return <span className="text-[12.5px] text-ink-muted">Confidence: {label}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  switch (severity) {
    case "risk":
      return <Badge variant="risk">Needs attention</Badge>;
    case "attention":
      return <Badge variant="attention">Worth a look</Badge>;
    default:
      return <Badge variant="info">Info</Badge>;
  }
}

interface EvidenceRow {
  evidenceType: string;
  payload: unknown;
}

function EvidenceBlock({ evidence, currency }: { evidence: EvidenceRow[]; currency: string }) {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {evidence.map((item, index) => {
        const payload = item.payload as Record<string, unknown>;
        if (item.evidenceType === "category_delta") {
          return (
            <dl key={index} className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-ink-muted">This period</dt>
              <dd className="num text-right">
                {formatMinor(Number(payload.currentMinor), currency)}
              </dd>
              <dt className="text-ink-muted">Previous period</dt>
              <dd className="num text-right">
                {formatMinor(Number(payload.previousMinor), currency)}
              </dd>
              <dt className="text-ink-muted">Change</dt>
              <dd className="num text-right">
                +{formatMinor(Number(payload.deltaMinor), currency)} (
                {formatBp(Number(payload.pctBp))})
              </dd>
            </dl>
          );
        }
        if (item.evidenceType === "merchant_delta") {
          const contributors = (payload.contributors ?? []) as Array<{
            name: string;
            currentMinor: number;
            previousMinor: number;
            deltaMinor: number;
          }>;
          return (
            <table key={index} className="w-full">
              <caption className="sr-only">Contributing merchants</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="py-1 font-medium">
                    Merchant
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Now
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Before
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((contributor) => (
                  <tr key={contributor.name} className="border-b border-hairline last:border-0">
                    <td className="py-1">{contributor.name}</td>
                    <td className="num py-1 text-right">
                      {formatMinor(contributor.currentMinor, currency)}
                    </td>
                    <td className="num py-1 text-right">
                      {formatMinor(contributor.previousMinor, currency)}
                    </td>
                    <td className="num py-1 text-right">
                      +{formatMinor(contributor.deltaMinor, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (item.evidenceType === "aggregate" && Array.isArray(payload.cycles)) {
          const cycles = payload.cycles as Array<{
            start: string;
            end: string;
            spendMinor: number;
          }>;
          return (
            <div key={index}>
              <p className="mb-1 text-ink-muted">Spending in the last three cycles:</p>
              <ul className="flex flex-col gap-0.5">
                {cycles.map((cycle) => (
                  <li key={cycle.start} className="flex justify-between gap-3">
                    <span>
                      {formatIsoDate(cycle.start, "en-MY")} – {formatIsoDate(cycle.end, "en-MY")}
                    </span>
                    <span className="num">{formatMinor(cycle.spendMinor, currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                Median {formatMinor(Number(payload.medianMinor), currency)} vs planned{" "}
                {formatMinor(Number(payload.plannedMinor), currency)} → suggested{" "}
                {formatMinor(Number(payload.suggestedMinor), currency)}.
              </p>
            </div>
          );
        }
        return (
          <pre key={index} className="overflow-x-auto rounded-control bg-sunken p-2 text-[11.5px]">
            {JSON.stringify(payload, null, 2)}
          </pre>
        );
      })}
    </div>
  );
}

const TABS = [
  { key: "insights", label: "Insights" },
  { key: "assistant", label: "Assistant" },
  { key: "queue", label: "Suggestion queue" },
] as const;

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const currency = (prefs?.currency ?? "MYR").trim();
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const tab = (TABS.map((entry) => entry.key) as string[]).includes(sp.tab ?? "")
    ? (sp.tab as (typeof TABS)[number]["key"])
    : "insights";

  // Deterministic generation + scorer scan on every visit (both idempotent);
  // generative phrasing only when the gateway allows it.
  await intelService.generateInsights(db, user.id, today);
  await categorizeService.scan(db, user.id);
  const availability = await aiAvailability(db, user.id);
  if (availability.available) {
    await phrasingService.phrasePendingInsights(db, user.id);
  }

  const insights = await intelService.listInsights(db, user.id);
  const evidenceByInsight = new Map<string, EvidenceRow[]>();
  for (const insight of insights) {
    evidenceByInsight.set(insight.id, await intelService.getEvidence(db, user.id, insight.id));
  }
  const queue = await categorizeService.listQueue(db, user.id);
  const pendingCount = queue.length;

  // Human labels for queue targets (transactions / rule categories).
  const txnIds = queue
    .filter((s) => s.kind === "category_correction" && s.targetEntityId)
    .map((s) => s.targetEntityId as string);
  const txnLabels = new Map<string, string>();
  if (txnIds.length > 0) {
    const rows = (
      await db.execute<{ id: string; description: string; amount: string; d: string }>(sql`
        select id, description_original as description, amount_minor::text as amount, txn_date::text as d
        from transactions where user_id = ${user.id} and id in (${sql.join(
          txnIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      `)
    ).rows;
    for (const row of rows) {
      txnLabels.set(
        row.id,
        `${row.description} · ${formatMinor(Number(row.amount), currency)} · ${formatIsoDate(row.d, "en-MY")}`,
      );
    }
  }
  const groups = await categoriesService.listGroups(db, user.id);
  const categoryOptions: QueueCategoryOption[] = groups.flatMap((group) =>
    group.categories.map((category) => ({
      id: category.id,
      name: `${category.name} — ${group.name}`,
    })),
  );
  const categoryNames = new Map<string, string>(
    groups.flatMap((group) =>
      group.categories.map((category) => [category.id, category.name] as [string, string]),
    ),
  );
  const queueItems: QueueItem[] = queue.map((suggestion) => {
    const change = suggestion.proposedChange as {
      categoryId?: string;
      setCategoryId?: string;
      merchantContains?: string;
    };
    const categoryId = change.categoryId ?? change.setCategoryId;
    const categoryName = categoryId
      ? (categoryNames.get(categoryId) ?? "a category")
      : "a category";
    return {
      id: suggestion.id,
      kind: suggestion.kind,
      rationale: suggestion.rationale,
      confidenceBp: suggestion.confidenceBp,
      source: suggestion.source,
      targetLabel:
        suggestion.kind === "merchant_rule"
          ? `Rule: always categorize ${change.merchantContains ?? "this merchant"} as ${categoryName}, including its current needs-review transactions.`
          : (txnLabels.get(suggestion.targetEntityId ?? "") ?? "Transaction"),
      proposedLabel:
        suggestion.kind === "merchant_rule"
          ? `${change.merchantContains ?? "Merchant"} → ${categoryName}`
          : `Categorize as ${categoryName}`,
    };
  });

  const hrefFor = (key: string) => (key === "insights" ? "/insights" : `/insights?tab=${key}`);

  return (
    <>
      <PageHeader
        title={t("nav.insights")}
        description="Deterministic findings, an assistant over your own numbers, and a queue where every AI idea waits for your approval."
        actions={
          <Link
            href="/insights/activity"
            className="text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            AI activity
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <nav aria-label="Insight sections" className="flex flex-wrap gap-1">
          {TABS.map((entry) => (
            <Link
              key={entry.key}
              href={hrefFor(entry.key)}
              aria-current={tab === entry.key ? "page" : undefined}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[13px] font-medium",
                tab === entry.key
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:bg-sunken hover:text-ink",
              )}
            >
              {entry.label}
              {entry.key === "queue" && pendingCount > 0 ? ` (${pendingCount})` : ""}
            </Link>
          ))}
        </nav>

        {tab === "assistant" ? (
          availability.available ? (
            <AssistantPanel suggestedQuestions={SUGGESTED_QUESTIONS} />
          ) : (
            <Banner variant="info">
              {availability.reason === "privacy_mode"
                ? "Privacy Mode is on, so the assistant is off and no data ever leaves FinPilot. Every deterministic feature — insights, forecasts, safe-to-spend — keeps working fully."
                : availability.reason === "no_consent"
                  ? "The assistant needs your explicit AI consent. Grant it (or read what it means) in "
                  : "AI features are currently disabled by configuration."}
              {availability.reason === "no_consent" ? (
                <Link href="/settings/privacy" className="font-semibold underline">
                  Settings → Privacy &amp; AI
                </Link>
              ) : null}
            </Banner>
          )
        ) : null}

        {tab === "queue" ? <QueuePanel items={queueItems} categories={categoryOptions} /> : null}

        {tab === "insights" ? (
          <>
            <Banner variant="info">
              Every number here is deterministic arithmetic over your ledger — inspect it under “How
              this was calculated”.{" "}
              {availability.available
                ? "Wording may be AI-phrased; any phrasing whose numbers fail verification is discarded automatically."
                : "Privacy Mode / no AI consent: wording stays deterministic. Nothing you can see is reduced."}
            </Banner>
            {insights.length === 0 ? (
              <EmptyState
                title="No insights yet"
                description="Insights appear when something changes materially: category spending jumps, unusual months, projected balance dips, or budget plans drifting from reality."
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {insights.map((insight) => {
                  const evidence = evidenceByInsight.get(insight.id) ?? [];
                  const categoryDelta = evidence.find((e) => e.evidenceType === "category_delta")
                    ?.payload as { categoryId?: string } | undefined;
                  return (
                    <li
                      key={insight.id}
                      className="rounded-card border border-hairline bg-card p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-semibold text-ink">
                              {insight.title}
                            </span>
                            <SeverityBadge severity={insight.severity} />
                            {insight.status === "new" ? <Badge>New</Badge> : null}
                            {insight.status === "actioned" ? (
                              <Badge variant="positive">Applied</Badge>
                            ) : null}
                            {insight.generatedBy === "generative" ? (
                              <Badge variant="info">AI-phrased · {insight.model}</Badge>
                            ) : null}
                          </p>
                          <p className="mt-1 text-[13px] text-ink-secondary">{insight.body}</p>
                          <p className="mt-1 text-[12.5px] text-ink-muted">
                            Period {formatIsoDate(insight.periodStart, "en-MY")} –{" "}
                            {formatIsoDate(insight.periodEnd, "en-MY")} ·{" "}
                            <ConfidenceLabel bp={insight.confidenceBp} />
                          </p>
                          {Object.keys((insight.dataQuality ?? {}) as object).length > 0 ? (
                            <p className="mt-1 text-[12.5px] text-attention">
                              Data note:{" "}
                              {(insight.dataQuality as { pendingExcluded?: number }).pendingExcluded
                                ? `${(insight.dataQuality as { pendingExcluded?: number }).pendingExcluded} pending transaction(s) excluded from this math.`
                                : "See calculation details."}
                            </p>
                          ) : null}
                        </div>
                        <DismissInsightButton insightId={insight.id} />
                      </div>

                      <details className="mt-3 rounded-control bg-sunken px-3 py-2">
                        <summary className="cursor-pointer text-[13px] font-medium text-accent">
                          How this was calculated
                        </summary>
                        <div className="mt-2">
                          <EvidenceBlock evidence={evidence} currency={currency} />
                        </div>
                      </details>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
                        {categoryDelta?.categoryId ? (
                          <Link
                            href={`/transactions?categories=${categoryDelta.categoryId}&from=${insight.periodStart}&to=${insight.periodEnd}&back=/insights`}
                            className="font-medium text-accent underline underline-offset-2"
                          >
                            Open the transactions behind this
                          </Link>
                        ) : null}
                        {insight.type === "budget_suggestion" ? (
                          <Link
                            href="/budget"
                            className="font-medium text-accent underline underline-offset-2"
                          >
                            Review in Budget
                          </Link>
                        ) : null}
                        {insight.type === "low_balance" ? (
                          <Link
                            href="/recurring"
                            className="font-medium text-accent underline underline-offset-2"
                          >
                            Review upcoming bills
                          </Link>
                        ) : null}
                        <InsightFeedback insightId={insight.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
