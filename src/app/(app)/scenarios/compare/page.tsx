import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChartCard, ChartDataTable } from "@/components/charts/chart-card";
import { ScenarioBandChart } from "@/components/charts/scenario-band";
import { PageHeader } from "@/components/ui/page-header";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { formatMinor } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { scenariosService, type ScenarioSimulationView } from "@/server/services/scenarios";

export const metadata: Metadata = { title: "Compare scenarios" };

function ImpactColumn({
  name,
  view,
  currency,
}: {
  name: string;
  view: ScenarioSimulationView;
  currency: string;
}) {
  return (
    <section
      aria-label={`Impact: ${name}`}
      className="flex flex-col gap-2 rounded-card border border-hairline bg-card p-4"
    >
      <h2 className="text-[15px] font-semibold text-ink">{name}</h2>
      <dl className="flex flex-col gap-2 text-[13px]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-secondary">Lowest expected</dt>
          <dd className="num text-right font-medium">
            {formatMinor(view.scenario.lowestExpected.balanceMinor, currency)}
            <span className="block text-[11.5px] font-normal text-ink-muted">
              on {formatIsoDate(view.scenario.lowestExpected.date, "en-MY")}
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
        {view.largestPurchaseMinor != null ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-secondary">Safer purchase date</dt>
            <dd className="text-right">
              {view.saferDate ? formatIsoDate(view.saferDate, "en-MY") : "None in horizon"}
            </dd>
          </div>
        ) : null}
      </dl>
      {view.budgetRisks.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
          {view.budgetRisks.map((risk) => (
            <li key={risk.categoryName}>{risk.note}</li>
          ))}
        </ul>
      ) : null}
      {view.affectedGoals.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
          {view.affectedGoals.map((goal) => (
            <li key={goal.goalId}>
              <span className="font-medium text-ink">{goal.name}:</span> {goal.note}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default async function CompareScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { user } = await requireUser();
  const { a, b } = await searchParams;
  if (!a || !b) notFound();
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const compared = await scenariosService.compare(db, user.id, a, b, { today });
  if (!compared.ok) notFound();
  const { a: left, b: right } = compared.data;
  const currency = left.view.currency;

  // One shared chart: shared baseline dashed, both expected paths solid.
  const chartData = left.view.scenario.series.map((point, index) => ({
    date: point.date,
    conservativeMinor: point.conservativeMinor,
    expectedMinor: point.expectedMinor,
    optimisticMinor: point.optimisticMinor,
    baselineMinor: left.view.baseline.series[index]?.expectedMinor ?? point.expectedMinor,
    secondMinor: right.view.scenario.series[index]?.expectedMinor ?? point.expectedMinor,
  }));
  const tableRows = chartData
    .filter((_, index) => index % 7 === 6 || index === 0)
    .map((point) => [
      formatIsoDate(point.date, "en-MY"),
      formatMinor(point.expectedMinor, currency),
      formatMinor(point.secondMinor, currency),
      formatMinor(point.baselineMinor, currency),
    ]);

  return (
    <>
      <PageHeader
        title="Compare scenarios"
        description={`${left.scenario.name} vs ${right.scenario.name} over one shared baseline.`}
        actions={
          <Link
            href="/scenarios"
            className="text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            All scenarios
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <ChartCard
          title="Projected balance · A vs B"
          description={`Solid lines: expected paths for ${left.scenario.name} (A) and ${right.scenario.name} (B); shaded band: A's optimistic-to-conservative range; dashed: baseline without either.`}
          chart={
            <ScenarioBandChart
              data={chartData}
              currency={currency}
              scenarioLabel={`A · ${left.scenario.name}`}
              secondLabel={`B · ${right.scenario.name}`}
            />
          }
          table={
            <ChartDataTable
              caption={`Weekly expected balances for both scenarios and the baseline, in ${currency}`}
              headers={[
                "Date",
                `A · ${left.scenario.name}`,
                `B · ${right.scenario.name}`,
                "Baseline",
              ]}
              rows={tableRows}
            />
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ImpactColumn name={`A · ${left.scenario.name}`} view={left.view} currency={currency} />
          <ImpactColumn name={`B · ${right.scenario.name}`} view={right.view} currency={currency} />
        </div>
      </div>
    </>
  );
}
