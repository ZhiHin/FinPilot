import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { createScenarioAction } from "@/features/scenarios/actions";
import { formatIsoDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { scenariosService } from "@/server/services/scenarios";

export const metadata: Metadata = { title: t("nav.scenarios") };

function StatusBadge({ status }: { status: string }) {
  if (status === "saved") return <Badge variant="positive">Saved</Badge>;
  if (status === "archived") return <Badge>Archived</Badge>;
  return <Badge variant="attention">Draft</Badge>;
}

export default async function ScenariosPage() {
  const { user } = await requireUser();
  const scenarios = await scenariosService.list(getDb(), user.id);
  const saved = scenarios.filter((s) => s.status === "saved");

  return (
    <>
      <PageHeader
        title={t("nav.scenarios")}
        description="Test financial decisions against your real numbers before making them — simulations never change your records."
        actions={
          <form action={createScenarioAction}>
            <Button type="submit">New scenario</Button>
          </form>
        }
      />

      <div className="flex flex-col gap-4">
        {saved.length >= 2 ? (
          <form
            action="/scenarios/compare"
            method="get"
            className="flex flex-wrap items-end gap-2 rounded-card border border-hairline bg-card p-4"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="compare-a" className="text-[13px] font-medium text-ink-secondary">
                Compare
              </label>
              <Select id="compare-a" name="a" defaultValue={saved[0].id} className="w-56">
                {saved.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="compare-b" className="text-[13px] font-medium text-ink-secondary">
                with
              </label>
              <Select id="compare-b" name="b" defaultValue={saved[1].id} className="w-56">
                {saved.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Compare A vs B
            </Button>
          </form>
        ) : null}

        {scenarios.length === 0 ? (
          <EmptyState
            title="No scenarios yet"
            description="Start one to answer questions like “Can I afford an RM 2,800 laptop next month?” — the simulation uses your real balances, bills, and spending, and never changes any of them."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {scenarios.map((scenario) => (
              <li
                key={scenario.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-hairline bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/scenarios/${scenario.id}`}
                    className="text-[15px] font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {scenario.name}
                  </Link>
                  {scenario.description ? (
                    <p className="text-[13px] text-ink-secondary">{scenario.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                  <StatusBadge status={scenario.status} />
                  <span>
                    Based on data as of{" "}
                    {formatIsoDate(scenario.baseSnapshotAt.toISOString().slice(0, 10), "en-MY")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Banner variant="info">
          Scenarios are a sandbox: projections reuse the same deterministic engine as your Overview
          forecast, and nothing you do here alters balances, budgets, or goals.
        </Banner>
      </div>
    </>
  );
}
