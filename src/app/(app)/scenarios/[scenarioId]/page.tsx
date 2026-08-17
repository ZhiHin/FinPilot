import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChartCard, ChartDataTable } from "@/components/charts/chart-card";
import { ScenarioBandChart } from "@/components/charts/scenario-band";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import {
  AddEventForm,
  DeleteScenarioButton,
  RemoveEventButton,
  SaveScenarioForm,
  type PickerOption,
} from "@/features/scenarios/panels";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { formatMinor } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { categoriesService } from "@/server/services/categories";
import { goalsService } from "@/server/services/goals";
import { recurringService } from "@/server/services/recurring";
import { scenariosService, type ScenarioEventRow } from "@/server/services/scenarios";

export const metadata: Metadata = { title: "Scenario editor" };

const EVENT_LABELS: Record<string, string> = {
  one_time_expense: "One-time purchase",
  emergency_expense: "Emergency expense",
  income_change: "Income change",
  rent_change: "Recurring amount change",
  cancel_recurring: "Cancel recurring",
  add_installment: "Instalment",
  savings_change: "Savings change",
};

function describeEvent(
  event: ScenarioEventRow,
  currency: string,
  names: {
    patterns: Map<string, string>;
    categories: Map<string, string>;
    goals: Map<string, string>;
  },
): string {
  const refs = (event.refs ?? {}) as { patternId?: string; categoryId?: string; goalId?: string };
  const params = (event.params ?? {}) as { months?: number; newAmountMinor?: number };
  const amount = event.amountMinor === null ? null : Number(event.amountMinor);
  const date = formatIsoDate(event.effectiveOn, "en-MY");
  switch (event.eventType) {
    case "one_time_expense":
    case "emergency_expense":
      return `${formatMinor(amount ?? 0, currency)} on ${date}${
        refs.categoryId ? ` · ${names.categories.get(refs.categoryId) ?? "category"}` : ""
      }`;
    case "income_change":
      return `${amount != null && amount > 0 ? "+" : ""}${formatMinor(amount ?? 0, currency)}/month from ${date}${
        refs.patternId ? ` · ${names.patterns.get(refs.patternId) ?? "income"}` : " · all income"
      }`;
    case "rent_change":
      return `${names.patterns.get(refs.patternId ?? "") ?? "Recurring"} becomes ${formatMinor(
        Number(params.newAmountMinor ?? 0),
        currency,
      )} from ${date}`;
    case "cancel_recurring":
      return `${names.patterns.get(refs.patternId ?? "") ?? "Recurring"} cancelled from ${date}`;
    case "add_installment":
      return `${formatMinor(amount ?? 0, currency)}/month × ${params.months ?? 1} from ${date}`;
    case "savings_change":
      return `${amount != null && amount > 0 ? "+" : ""}${formatMinor(amount ?? 0, currency)}/month set aside from ${date}${
        refs.goalId ? ` · ${names.goals.get(refs.goalId) ?? "goal"}` : ""
      }`;
    default:
      return date;
  }
}

export default async function ScenarioEditorPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { user } = await requireUser();
  const { scenarioId } = await params;
  const db = getDb();
  const loaded = await scenariosService.get(db, user.id, scenarioId);
  if (!loaded.ok) notFound();
  const { scenario, events } = loaded.data;

  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const simulated = await scenariosService.simulate(db, user.id, scenarioId, { today });
  if (!simulated.ok) notFound();
  const view = simulated.data;
  const currency = view.currency;

  const patterns = (await recurringService.list(db, user.id)).filter(
    (p) => p.status === "active" && p.frequency !== "custom",
  );
  const groups = await categoriesService.listGroups(db, user.id);
  const goals = (await goalsService.listWithProgress(db, user.id, today)).filter(
    (g) => g.status === "active",
  );
  const patternOptions: PickerOption[] = patterns.map((p) => ({
    id: p.id,
    label: `${p.name} · ${formatMinor(p.typicalAmountMinor, p.currency)} ${p.direction === "inflow" ? "in" : "out"}`,
  }));
  const categoryOptions: PickerOption[] = groups.flatMap((group) =>
    group.categories.map((category) => ({
      id: category.id,
      label: `${category.name} — ${group.name}`,
    })),
  );
  const goalOptions: PickerOption[] = goals.map((g) => ({ id: g.id, label: g.name }));
  const names = {
    patterns: new Map(patterns.map((p) => [p.id, p.name])),
    categories: new Map(
      groups.flatMap((group) => group.categories.map((c) => [c.id, c.name] as [string, string])),
    ),
    goals: new Map(goals.map((g) => [g.id, g.name])),
  };

  const chartData = view.scenario.series.map((point, index) => ({
    ...point,
    baselineMinor: view.baseline.series[index]?.expectedMinor ?? point.expectedMinor,
  }));
  const tableRows = view.scenario.series
    .filter((_, index) => index % 7 === 6 || index === 0)
    .map((point, sampleIndex) => {
      const baseline = chartData.find((p) => p.date === point.date)?.baselineMinor ?? 0;
      void sampleIndex;
      return [
        formatIsoDate(point.date, "en-MY"),
        formatMinor(point.conservativeMinor, currency),
        formatMinor(point.expectedMinor, currency),
        formatMinor(point.optimisticMinor, currency),
        formatMinor(baseline, currency),
      ];
    });

  const lowest = view.scenario.lowestExpected;
  const lowestBaseline = view.baseline.lowestExpected;

  return (
    <>
      <PageHeader
        title={scenario.status === "draft" ? "New scenario" : scenario.name}
        description="What happens if…? Adjust the inputs on the left; the projection and impact update on the spot. Real records never change."
        actions={
          <Link
            href="/scenarios"
            className="text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            All scenarios
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* INPUTS */}
        <section
          aria-labelledby="scenario-inputs-heading"
          className="flex flex-col gap-4 rounded-card border border-hairline bg-card p-4"
        >
          <h2 id="scenario-inputs-heading" className="text-[15px] font-semibold text-ink">
            Scenario inputs
          </h2>
          {events.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">
              No events yet — add one below, e.g. a one-time RM 2,800 purchase.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-2 rounded-control bg-sunken px-3 py-2"
                >
                  <div>
                    <p className="text-[13px] font-medium text-ink">
                      {EVENT_LABELS[event.eventType] ?? event.eventType}
                    </p>
                    <p className="text-[12.5px] text-ink-secondary">
                      {describeEvent(event, currency, names)}
                    </p>
                  </div>
                  <RemoveEventButton scenarioId={scenarioId} eventId={event.id} />
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-hairline pt-3">
            <AddEventForm
              scenarioId={scenarioId}
              patterns={patternOptions}
              categories={categoryOptions}
              goals={goalOptions}
            />
          </div>
        </section>

        {/* PROJECTION */}
        <section aria-label="Projection" className="min-w-0">
          <ChartCard
            title={`Projected balance · ${view.horizonDays} days`}
            description="Solid line: expected path with this scenario; shaded band: optimistic to conservative; dashed line: baseline without the scenario."
            chart={<ScenarioBandChart data={chartData} currency={currency} />}
            table={
              <ChartDataTable
                caption={`Projected balance with and without the scenario, weekly, in ${currency}`}
                headers={["Date", "Conservative", "Expected", "Optimistic", "Baseline"]}
                rows={tableRows}
              />
            }
            footer={
              <p className="mt-2 text-[11.5px] text-ink-muted">
                Deterministic simulation over the same engine as the Overview forecast — recomputed
                on every change, never stored, never touching real records.
              </p>
            }
          />
        </section>

        {/* IMPACT */}
        <section
          aria-labelledby="scenario-impact-heading"
          className="flex flex-col gap-4 rounded-card border border-hairline bg-card p-4"
        >
          <h2 id="scenario-impact-heading" className="text-[15px] font-semibold text-ink">
            Impact
          </h2>
          <dl className="flex flex-col gap-2 text-[13px]">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-secondary">Lowest expected balance</dt>
              <dd className="num text-right font-medium">
                {formatMinor(lowest.balanceMinor, currency)}
                <span className="block text-[11.5px] font-normal text-ink-muted">
                  on {formatIsoDate(lowest.date, "en-MY")}
                </span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-secondary">Baseline lowest</dt>
              <dd className="num text-right">
                {formatMinor(lowestBaseline.balanceMinor, currency)}
                <span className="block text-[11.5px] text-ink-muted">
                  on {formatIsoDate(lowestBaseline.date, "en-MY")}
                </span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-secondary">End-of-horizon difference</dt>
              <dd className="num text-right">
                {view.endDeltaMinor > 0 ? "+" : ""}
                {formatMinor(view.endDeltaMinor, currency)}
              </dd>
            </div>
          </dl>
          {lowest.balanceMinor < view.bufferMinor ? (
            <Banner variant="attention">
              The expected path dips under your {formatMinor(view.bufferMinor, currency)} safety
              buffer.
            </Banner>
          ) : null}
          {view.largestPurchaseMinor != null ? (
            <p className="text-[13px] text-ink-secondary">
              <span className="font-medium text-ink">Safer purchase date: </span>
              {view.saferDate
                ? `${formatIsoDate(view.saferDate, "en-MY")} — from then, buying ${formatMinor(view.largestPurchaseMinor, currency)} keeps the conservative path at or above your buffer.`
                : `none within ${view.horizonDays} days for ${formatMinor(view.largestPurchaseMinor, currency)}.`}
            </p>
          ) : null}
          {view.affectedGoals.length > 0 ? (
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Goals</h3>
              <ul className="mt-1 flex flex-col gap-1 text-[12.5px] text-ink-secondary">
                {view.affectedGoals.map((goal) => (
                  <li key={goal.goalId}>
                    <span className="font-medium text-ink">{goal.name}:</span> {goal.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.budgetRisks.length > 0 ? (
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Budget</h3>
              <ul className="mt-1 flex flex-col gap-1 text-[12.5px] text-ink-secondary">
                {view.budgetRisks.map((risk) => (
                  <li key={risk.categoryName}>{risk.note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="rounded-control bg-sunken px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-accent">
              Assumptions
            </summary>
            <ul className="mt-2 list-disc pl-5 text-[12.5px] text-ink-secondary">
              {view.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </details>

          <div className="border-t border-hairline pt-3">
            <SaveScenarioForm
              scenarioId={scenarioId}
              name={scenario.name}
              description={scenario.description ?? ""}
              status={scenario.status}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Link
              href="/insights?tab=assistant"
              className="font-medium text-accent underline underline-offset-2"
            >
              Ask AI about this
            </Link>
            <DeleteScenarioButton scenarioId={scenarioId} />
          </div>
        </section>
      </div>
    </>
  );
}
