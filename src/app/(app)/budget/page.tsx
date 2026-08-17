import type { Metadata } from "next";
import Link from "next/link";

import { formatBp } from "@/components/charts/format";
import { AmountText } from "@/components/ui/amount-text";
import { Banner } from "@/components/ui/banner";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { StatTile } from "@/components/ui/stat-tile";
import { AllocationDialog, type CategoryOption } from "@/features/budgets/allocation-dialog";
import { CreateBudgetForm } from "@/features/budgets/create-budget-form";
import { BUDGET_MODE_LABELS, HealthBadge } from "@/features/budgets/labels";
import {
  ArchiveBudgetDialog,
  CopyPreviousForm,
  PeriodMetaDialog,
} from "@/features/budgets/toolbar";
import { cn } from "@/lib/cn";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { t } from "@/lib/i18n";
import { minorToAmountInput } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { budgetsService, type AllocationReport } from "@/server/services/budgets";
import { categoriesService } from "@/server/services/categories";

export const metadata: Metadata = { title: t("nav.budget") };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function txnHref(categoryId: string, from: string, to: string, back: string): string {
  const qs = new URLSearchParams({ categories: categoryId, from, to, back });
  return `/transactions?${qs.toString()}`;
}

function AllocationRow({
  row,
  currency,
  drillHref,
  editDialog,
}: {
  row: AllocationReport;
  currency: string;
  drillHref: string;
  editDialog: React.ReactNode;
}) {
  const usage = row.usageBp;
  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="px-3 py-2">
        <Link href={drillHref} className="font-medium text-ink underline-offset-2 hover:underline">
          {row.categoryName}
        </Link>
        {row.groupName ? (
          <span className="ml-1.5 text-[11.5px] text-ink-muted">{row.groupName}</span>
        ) : null}
        {row.notes ? <p className="text-[11.5px] text-ink-muted">{row.notes}</p> : null}
      </td>
      <td className="num px-3 py-2 text-right">
        <AmountText amountMinor={row.plannedMinor} currency={currency} />
      </td>
      <td className="num px-3 py-2 text-right">
        {row.rolloverInMinor !== 0 ? (
          <AmountText amountMinor={row.rolloverInMinor} currency={currency} />
        ) : row.rolloverEnabled ? (
          <span className="text-[11.5px] text-ink-muted">rolls over</span>
        ) : (
          <span aria-hidden>—</span>
        )}
      </td>
      <td className="num px-3 py-2 text-right">
        <AmountText amountMinor={row.postedMinor} currency={currency} />
      </td>
      <td className="num px-3 py-2 text-right">
        {row.pendingMinor !== 0 ? (
          <AmountText amountMinor={row.pendingMinor} currency={currency} />
        ) : (
          <span aria-hidden>—</span>
        )}
      </td>
      <td className="num px-3 py-2 text-right">
        <AmountText
          amountMinor={row.remainingMinor}
          currency={currency}
          className={cn(row.remainingMinor < 0 && "text-risk")}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Progress
            value={usage === null ? 0 : Math.min(usage, 10000)}
            max={10000}
            label={`${row.categoryName}: ${usage === null ? "no available budget" : `${formatBp(usage)} of the available budget spent`}`}
            className="w-20"
          />
          <span className="num text-[11.5px] text-ink-muted">
            {usage === null ? "—" : formatBp(usage)}
          </span>
        </div>
      </td>
      <td className="px-3 py-2">
        <HealthBadge health={row.health} />
      </td>
      <td className="px-3 py-2 text-right">{editDialog}</td>
    </tr>
  );
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ budget?: string; period?: string }>;
}) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";
  const today = localDateInTz(new Date(), timezone);

  const allBudgets = await budgetsService.list(db, user.id);
  const activeBudgets = allBudgets.filter((b) => b.isActive);

  if (activeBudgets.length === 0) {
    const income = (prefs?.incomePattern ?? null) as {
      day?: number | "last";
      weekendAdjust?: boolean;
    } | null;
    return (
      <>
        <PageHeader
          title={t("nav.budget")}
          description="Plan each cycle per category, then watch pace — not just totals."
        />
        {allBudgets.length > 0 ? (
          <Banner variant="info" className="mb-4">
            Your previous budget is archived; its history stays readable once you create a new one.
          </Banner>
        ) : null}
        <CreateBudgetForm
          defaultMode={prefs?.budgetStyle ?? null}
          defaultPaydayDay={income?.day != null ? String(income.day) : null}
          defaultWeekendAdjust={income?.weekendAdjust ?? true}
          currencies={["MYR", "SGD", "USD", "EUR"]}
        />
      </>
    );
  }

  const requested = sp.budget && UUID.test(sp.budget) ? sp.budget : null;
  const budgetRow = activeBudgets.find((b) => b.id === requested) ?? activeBudgets[0];

  const reportRes = await budgetsService.periodReport(db, user.id, {
    budgetId: budgetRow.id,
    periodStart: sp.period,
    today,
  });
  if (!reportRes.ok) {
    return (
      <>
        <PageHeader title={t("nav.budget")} />
        <ErrorState
          title="That period isn’t available"
          description={reportRes.error.message}
          action={
            <Link href="/budget" className="font-medium text-accent underline">
              Back to the current cycle
            </Link>
          }
        />
      </>
    );
  }
  const report = reportRes.data;
  const currency = report.budget.currency;
  const { periodStart, periodEnd } = report.period;
  const selfHref = `/budget?${new URLSearchParams({
    ...(requested ? { budget: budgetRow.id } : {}),
    ...(sp.period ? { period: sp.period } : {}),
  }).toString()}`.replace(/\?$/, "");

  const groups = await categoriesService.listGroups(db, user.id);
  const categoryOptions: CategoryOption[] = groups
    .filter((group) => group.kind === "expense")
    .flatMap((group) =>
      group.categories.map((category) => ({
        id: category.id,
        name: category.name,
        groupName: group.name,
      })),
    );

  const periodLabel = `${formatIsoDate(periodStart, "en-MY")} – ${formatIsoDate(periodEnd, "en-MY")}`;
  const periodHref = (start: string) =>
    `/budget?${new URLSearchParams({
      ...(requested ? { budget: budgetRow.id } : {}),
      period: start,
    }).toString()}`;

  return (
    <>
      <PageHeader
        title={t("nav.budget")}
        description={`${report.budget.name} · ${BUDGET_MODE_LABELS[report.budget.mode]} · ${currency}${report.budget.cycleType === "payday" ? " · payday cycle" : ""}`}
        actions={
          <AllocationDialog
            periodId={report.period.id}
            categories={categoryOptions}
            idempotencyId={uuidv7()}
          />
        }
      />

      <div className="flex flex-col gap-4">
        {activeBudgets.length > 1 ? (
          <nav aria-label="Budgets" className="flex flex-wrap gap-1">
            {activeBudgets.map((b) => (
              <Link
                key={b.id}
                href={`/budget?budget=${b.id}`}
                aria-current={b.id === budgetRow.id ? "page" : undefined}
                className={cn(
                  "rounded-chip px-3 py-1 text-[12.5px]",
                  b.id === budgetRow.id
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-sunken",
                )}
              >
                {b.name} ({b.currency})
              </Link>
            ))}
          </nav>
        ) : null}

        {/* Period navigation */}
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Budget periods" className="flex items-center gap-2">
            <Link
              href={periodHref(report.nav.prevStart)}
              className="rounded-control border border-hairline px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-sunken"
            >
              ← Previous
            </Link>
            <span className="text-[13px] font-medium text-ink">
              {periodLabel}
              {report.incomplete ? (
                <span className="ml-1.5 text-[11.5px] font-normal text-ink-muted">
                  (day {Math.round((report.totals.elapsedBp / 10000) * 100)}% elapsed)
                </span>
              ) : null}
            </span>
            {report.nav.nextStart ? (
              <Link
                href={periodHref(report.nav.nextStart)}
                className="rounded-control border border-hairline px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-sunken"
              >
                Next →
              </Link>
            ) : (
              <span className="px-2.5 py-1 text-[11.5px] text-ink-muted">
                Next cycle opens on its first day
              </span>
            )}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {report.hasPreviousPeriod ? <CopyPreviousForm periodId={report.period.id} /> : null}
            <PeriodMetaDialog
              periodId={report.period.id}
              initialNotes={report.period.notes ?? ""}
              initialExpectedIncome={
                report.period.expectedIncomeMinor !== null
                  ? minorToAmountInput(report.period.expectedIncomeMinor, currency)
                  : ""
              }
              zeroBased={report.budget.mode === "zero_based"}
            />
            <ArchiveBudgetDialog budgetId={report.budget.id} name={report.budget.name} />
          </div>
        </div>

        {report.period.notes ? (
          <p className="text-[13px] text-ink-muted">Note: {report.period.notes}</p>
        ) : null}

        {/* Zero-based banner */}
        {report.budget.mode === "zero_based" ? (
          report.unallocatedIncomeMinor === null ? (
            <Banner variant="info">
              Zero-based budgeting plans every ringgit — set this cycle’s expected income under
              “Income &amp; notes” to see what’s left to allocate.
            </Banner>
          ) : report.unallocatedIncomeMinor === 0 ? (
            <Banner variant="positive">Fully allocated — every ringgit has a job.</Banner>
          ) : report.unallocatedIncomeMinor > 0 ? (
            <Banner variant="attention">
              Unallocated income:{" "}
              <AmountText amountMinor={report.unallocatedIncomeMinor} currency={currency} /> still
              needs a category.
            </Banner>
          ) : (
            <Banner variant="risk">
              Over-allocated by{" "}
              <AmountText amountMinor={-report.unallocatedIncomeMinor} currency={currency} /> —
              plans exceed the expected income.
            </Banner>
          )
        ) : null}

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Planned"
            detail={
              report.totals.rolloverInMinor !== 0 ? (
                <>
                  + <AmountText amountMinor={report.totals.rolloverInMinor} currency={currency} />{" "}
                  rolled over
                </>
              ) : undefined
            }
          >
            <AmountText amountMinor={report.totals.plannedMinor} currency={currency} />
          </StatTile>
          <StatTile label="Spent (posted)" detail="Refunds already subtracted">
            <AmountText amountMinor={report.totals.postedMinor} currency={currency} />
          </StatTile>
          <StatTile
            label="Remaining"
            detail={
              report.totals.usageBp !== null
                ? `${formatBp(report.totals.usageBp)} of the available budget used`
                : "No available budget yet"
            }
          >
            <AmountText
              amountMinor={report.totals.remainingMinor}
              currency={currency}
              className={cn(report.totals.remainingMinor < 0 && "text-risk")}
            />
          </StatTile>
          <StatTile label="Pending" detail="Not counted until posted">
            <AmountText amountMinor={report.totals.pendingMinor} currency={currency} />
          </StatTile>
        </div>
        <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
          Cycle health: <HealthBadge health={report.totals.health} />
          <span className="text-ink-muted">
            {Math.round((report.totals.elapsedBp / 10000) * 100)}% of the cycle has passed.
          </span>
        </p>

        {/* Allocations */}
        {report.allocations.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="text-[13px] text-ink-secondary">
                No categories allocated for this cycle yet. Allocate your first category
                {report.hasPreviousPeriod ? " or copy the previous period’s plan" : ""}.
              </p>
              <div className="flex gap-2">
                <AllocationDialog
                  periodId={report.period.id}
                  categories={categoryOptions}
                  idempotencyId={uuidv7()}
                  triggerLabel="Allocate a category"
                />
                {report.hasPreviousPeriod ? <CopyPreviousForm periodId={report.period.id} /> : null}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-card border border-hairline bg-card lg:block">
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  Category allocations for {periodLabel}: planned, rollover, spent, pending,
                  remaining, usage, and health per category.
                </caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Category
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Planned
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Rollover
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Spent
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Pending
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Remaining
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Usage
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Health
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.allocations.map((row) => (
                    <AllocationRow
                      key={row.allocationId}
                      row={row}
                      currency={currency}
                      drillHref={txnHref(row.categoryId, periodStart, periodEnd, selfHref)}
                      editDialog={
                        <AllocationDialog
                          periodId={report.period.id}
                          categories={categoryOptions}
                          idempotencyId={uuidv7()}
                          initial={{
                            categoryId: row.categoryId,
                            categoryName: row.categoryName,
                            planned: minorToAmountInput(row.plannedMinor, currency),
                            rolloverEnabled: row.rolloverEnabled,
                            notes: row.notes ?? "",
                            version: row.version,
                            allocationId: row.allocationId,
                          }}
                        />
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {report.allocations.map((row) => (
                <li
                  key={row.allocationId}
                  className="rounded-card border border-hairline bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={txnHref(row.categoryId, periodStart, periodEnd, selfHref)}
                      className="font-medium text-ink"
                    >
                      {row.categoryName}
                    </Link>
                    <HealthBadge health={row.health} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                    <span className="text-ink-muted">Planned</span>
                    <AmountText
                      amountMinor={row.plannedMinor}
                      currency={currency}
                      className="text-right"
                    />
                    {row.rolloverInMinor !== 0 ? (
                      <>
                        <span className="text-ink-muted">Rollover</span>
                        <AmountText
                          amountMinor={row.rolloverInMinor}
                          currency={currency}
                          className="text-right"
                        />
                      </>
                    ) : null}
                    <span className="text-ink-muted">Spent</span>
                    <AmountText
                      amountMinor={row.postedMinor}
                      currency={currency}
                      className="text-right"
                    />
                    {row.pendingMinor !== 0 ? (
                      <>
                        <span className="text-ink-muted">Pending</span>
                        <AmountText
                          amountMinor={row.pendingMinor}
                          currency={currency}
                          className="text-right"
                        />
                      </>
                    ) : null}
                    <span className="text-ink-muted">Remaining</span>
                    <AmountText
                      amountMinor={row.remainingMinor}
                      currency={currency}
                      className={cn("text-right", row.remainingMinor < 0 && "text-risk")}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress
                      value={row.usageBp === null ? 0 : Math.min(row.usageBp, 10000)}
                      max={10000}
                      label={`${row.categoryName}: ${row.usageBp === null ? "no available budget" : `${formatBp(row.usageBp)} of the available budget spent`}`}
                      className="flex-1"
                    />
                    <AllocationDialog
                      periodId={report.period.id}
                      categories={categoryOptions}
                      idempotencyId={uuidv7()}
                      initial={{
                        categoryId: row.categoryId,
                        categoryName: row.categoryName,
                        planned: minorToAmountInput(row.plannedMinor, currency),
                        rolloverEnabled: row.rolloverEnabled,
                        notes: row.notes ?? "",
                        version: row.version,
                        allocationId: row.allocationId,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Unbudgeted + uncategorized — visible, never silently assigned */}
        {report.unbudgeted.length > 0 ? (
          <Card>
            <CardContent>
              <h2 className="text-[15px] font-semibold text-ink">Spending without a budget</h2>
              <p className="mb-2 text-[12.5px] text-ink-muted">
                These categories saw spending this cycle but have no allocation — allocate them or
                leave them unbudgeted on purpose.
              </p>
              <ul className="flex flex-col divide-y divide-hairline text-[13px]">
                {report.unbudgeted.map((row) => (
                  <li
                    key={row.categoryId}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span className="flex items-center gap-2">
                      <Link
                        href={txnHref(row.categoryId as string, periodStart, periodEnd, selfHref)}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {row.categoryName}
                      </Link>
                      <HealthBadge health="no_budget" />
                    </span>
                    <span className="num">
                      <AmountText amountMinor={row.postedMinor} currency={currency} />
                      {row.pendingMinor !== 0 ? (
                        <span className="ml-2 text-[11.5px] text-ink-muted">
                          + <AmountText amountMinor={row.pendingMinor} currency={currency} />{" "}
                          pending
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {report.uncategorized.postedMinor !== 0 || report.uncategorized.pendingMinor !== 0 ? (
          <Banner variant="info">
            <AmountText amountMinor={report.uncategorized.postedMinor} currency={currency} /> of
            this cycle’s spending has no category yet
            {report.uncategorized.pendingMinor !== 0 ? (
              <>
                {" "}
                (+
                <AmountText
                  amountMinor={report.uncategorized.pendingMinor}
                  currency={currency}
                />{" "}
                pending)
              </>
            ) : null}
            .{" "}
            <Link href="/transactions?view=review" className="font-semibold underline">
              Categorize it
            </Link>{" "}
            so your budget stays truthful.
          </Banner>
        ) : null}

        <p className="text-[11.5px] text-ink-muted">
          Spending counts posted, non-excluded transactions in {currency}; refunds reduce their
          category; transfers never count. Health compares spending pace with how much of the cycle
          has passed — a deterministic rule, not a prediction.
        </p>
      </div>
    </>
  );
}
