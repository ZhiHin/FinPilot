import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatBp } from "@/components/charts/format";
import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { StatTile } from "@/components/ui/stat-tile";
import { applyWhatIfAction } from "@/features/goals/actions";
import {
  ContributionDialog,
  GoalFormDialog,
  GoalStatusButtons,
  type AccountOption,
} from "@/features/goals/goal-dialogs";
import { formatMonth, GOAL_TYPE_LABELS, TimeStatusBadge } from "@/features/goals/labels";
import { formatIsoDate, isValidIsoDate, localDateInTz } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { formatMinor, minorToAmountInput, parseAmountToMinor } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";
import { computeGoalOutlook, goalsService } from "@/server/services/goals";

export const metadata: Metadata = { title: "Goal" };

const MILESTONES = [2500, 5000, 7500, 10000] as const;

export default async function GoalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ goalId: string }>;
  searchParams: Promise<{
    wifContribution?: string;
    wifDate?: string;
    wifTarget?: string;
    applyError?: string;
  }>;
}) {
  const { user } = await requireUser();
  const { goalId } = await params;
  const sp = await searchParams;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");

  const detailRes = await goalsService.getDetail(db, user.id, goalId, today);
  if (!detailRes.ok) notFound();
  const { goal, contributions } = detailRes.data;
  const accountRows = await accountsService.list(db, user.id);
  const accounts: AccountOption[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency.trim(),
  }));

  // ---- Deterministic what-if (URL-driven; nothing is saved until applied) ----
  const wifContribution = sp.wifContribution ? parseAmountToMinor(sp.wifContribution) : null;
  const wifTarget = sp.wifTarget ? parseAmountToMinor(sp.wifTarget) : null;
  const wifDate = sp.wifDate && isValidIsoDate(sp.wifDate) ? sp.wifDate : null;
  const whatIfActive = wifContribution !== null || wifTarget !== null || wifDate !== null;
  const whatIf = whatIfActive
    ? computeGoalOutlook({
        targetMinor: wifTarget ?? goal.targetAmountMinor,
        savedMinor: goal.savedMinor,
        targetDate: wifDate ?? goal.targetDate,
        monthlyRateMinor: wifContribution ?? goal.outlook.monthlyRateMinor,
        today,
      })
    : null;

  const currency = goal.currency;
  const linkedDifferentCurrency = accountRows.find(
    (a) => a.id === goal.linkedAccountId && a.currency.trim() !== currency,
  );

  return (
    <>
      <PageHeader
        title={goal.name}
        description={`${GOAL_TYPE_LABELS[goal.type]} · ${currency} · priority ${goal.priority}${goal.linkedAccountName ? ` · linked to ${goal.linkedAccountName} (reference only)` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{goal.status}</Badge>
            <GoalFormDialog
              mode="edit"
              accounts={accounts}
              initial={{
                goalId: goal.id,
                name: goal.name,
                type: goal.type,
                target: minorToAmountInput(goal.targetAmountMinor, currency),
                currency,
                targetDate: goal.targetDate ?? "",
                priority: goal.priority,
                linkedAccountId: goal.linkedAccountId ?? "",
                plannedContribution: goal.contributionSchedule
                  ? minorToAmountInput(goal.contributionSchedule.amountMinor, currency)
                  : "",
              }}
            />
            {goal.status !== "archived" ? (
              <ContributionDialog goalId={goal.id} today={today} idempotencyId={uuidv7()} />
            ) : null}
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <Link href="/goals" className="text-[13px] text-accent underline underline-offset-2">
          ← All goals
        </Link>

        {sp.applyError ? (
          <Banner variant="risk">
            That plan couldn’t be applied — check the what-if values and try again.
          </Banner>
        ) : null}
        {goal.savedMinor >= goal.targetAmountMinor && goal.status === "active" ? (
          <Banner variant="positive">
            Target reached! Mark the goal completed below whenever you’re ready — nothing changes
            automatically.
          </Banner>
        ) : null}
        {linkedDifferentCurrency ? (
          <Banner variant="attention">
            The linked account ({linkedDifferentCurrency.name}) holds{" "}
            {linkedDifferentCurrency.currency.trim()}, but this goal tracks {currency}. The link is
            a reference only — amounts are never converted or compared.
          </Banner>
        ) : null}

        {/* Progress */}
        <section aria-labelledby="progress-heading" className="flex flex-col gap-3">
          <h2 id="progress-heading" className="sr-only">
            Progress
          </h2>
          <p className="num text-[24px] font-semibold text-ink">
            <AmountText amountMinor={goal.savedMinor} currency={currency} />{" "}
            <span className="text-[15px] font-normal text-ink-muted">
              of <AmountText amountMinor={goal.targetAmountMinor} currency={currency} /> (
              {formatBp(goal.outlook.progressBp)}) ·{" "}
              <TimeStatusBadge status={goal.outlook.timeStatus} />
            </span>
          </p>
          <Progress
            value={Math.min(goal.outlook.progressBp, 10000)}
            max={10000}
            label={`${formatBp(goal.outlook.progressBp)} of the target saved`}
          />
          <ol className="flex justify-between text-[11.5px] text-ink-muted" aria-label="Milestones">
            {MILESTONES.map((milestone) => (
              <li key={milestone}>
                {goal.outlook.progressBp >= milestone ? (
                  <span className="font-medium text-positive">✓ {formatBp(milestone)}</span>
                ) : (
                  <span>{formatBp(milestone)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Remaining">
            <AmountText amountMinor={goal.outlook.remainingMinor} currency={currency} />
          </StatTile>
          <StatTile
            label="Needs monthly"
            detail={
              goal.targetDate
                ? `to hit ${formatIsoDate(goal.targetDate, "en-MY")}`
                : "No target date set"
            }
          >
            {goal.outlook.requiredMonthlyMinor !== null ? (
              <AmountText amountMinor={goal.outlook.requiredMonthlyMinor} currency={currency} />
            ) : (
              <span className="text-[15px]">—</span>
            )}
          </StatTile>
          <StatTile
            label="Est. completion"
            detail={`At ${formatMinor(goal.outlook.monthlyRateMinor, currency)}/month (${goal.contributionSchedule ? "your planned rate" : "3-month average"})`}
          >
            <span className="text-[15px] font-medium">
              {goal.outlook.estimatedCompletionMonth
                ? formatMonth(goal.outlook.estimatedCompletionMonth)
                : "No estimate at RM 0/month"}
            </span>
          </StatTile>
          <StatTile label="Target date">
            <span className="text-[15px] font-medium">
              {goal.targetDate ? formatIsoDate(goal.targetDate, "en-MY") : "None set"}
            </span>
          </StatTile>
        </div>

        {/* What-if */}
        <Card>
          <CardHeader>
            <CardTitle>What if…</CardTitle>
            <p className="text-[12.5px] text-ink-muted">
              Try different numbers — deterministic math on your real progress. Nothing changes
              until you apply it.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              method="get"
              className="grid grid-cols-1 gap-3 sm:grid-cols-4"
              aria-label="What-if controls"
            >
              <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
                Monthly contribution
                <Input
                  name="wifContribution"
                  inputMode="decimal"
                  defaultValue={sp.wifContribution ?? ""}
                  placeholder={minorToAmountInput(goal.outlook.monthlyRateMinor, currency)}
                  className="num"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
                Target date
                <Input name="wifDate" type="date" defaultValue={sp.wifDate ?? ""} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
                Target amount
                <Input
                  name="wifTarget"
                  inputMode="decimal"
                  defaultValue={sp.wifTarget ?? ""}
                  placeholder={minorToAmountInput(goal.targetAmountMinor, currency)}
                  className="num"
                />
              </label>
              <div className="flex items-end gap-2">
                <Button type="submit" variant="secondary" size="sm">
                  Recalculate
                </Button>
                {whatIfActive ? (
                  <Link
                    href={`/goals/${goal.id}`}
                    className="pb-2 text-[13px] text-accent underline underline-offset-2"
                  >
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>

            {whatIf ? (
              <div className="flex flex-col gap-3 rounded-control bg-sunken p-3">
                <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-muted">Estimated completion</dt>
                    <dd className="font-medium text-ink">
                      {whatIf.estimatedCompletionMonth
                        ? formatMonth(whatIf.estimatedCompletionMonth)
                        : "Never at RM 0/month"}
                      {goal.outlook.estimatedCompletionMonth &&
                      whatIf.estimatedCompletionMonth &&
                      whatIf.estimatedCompletionMonth !== goal.outlook.estimatedCompletionMonth ? (
                        <span className="ml-1 text-[11.5px] text-ink-muted">
                          (now {formatMonth(goal.outlook.estimatedCompletionMonth)})
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Required monthly</dt>
                    <dd className="num font-medium text-ink">
                      {whatIf.requiredMonthlyMinor !== null ? (
                        <>
                          {formatMinor(whatIf.requiredMonthlyMinor, currency)}
                          {goal.outlook.requiredMonthlyMinor !== null &&
                          whatIf.requiredMonthlyMinor !== goal.outlook.requiredMonthlyMinor ? (
                            <span className="ml-1 text-[11.5px] text-ink-muted">
                              (
                              {whatIf.requiredMonthlyMinor > goal.outlook.requiredMonthlyMinor
                                ? "+"
                                : "−"}
                              {formatMinor(
                                Math.abs(
                                  whatIf.requiredMonthlyMinor - goal.outlook.requiredMonthlyMinor,
                                ),
                                currency,
                              )}{" "}
                              vs now)
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "— (no target date)"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">This plan would be</dt>
                    <dd>
                      <TimeStatusBadge status={whatIf.timeStatus} />
                    </dd>
                  </div>
                </dl>
                <form action={applyWhatIfAction} className="flex items-center gap-2">
                  {/* Applying is explicit: this submits a normal goal update. */}
                  <input type="hidden" name="goalId" value={goal.id} />
                  <input type="hidden" name="name" value={goal.name} />
                  <input type="hidden" name="type" value={goal.type} />
                  <input type="hidden" name="currency" value={currency} />
                  <input type="hidden" name="priority" value={goal.priority} />
                  <input type="hidden" name="linkedAccountId" value={goal.linkedAccountId ?? ""} />
                  <input
                    type="hidden"
                    name="target"
                    value={
                      wifTarget !== null
                        ? minorToAmountInput(wifTarget, currency)
                        : minorToAmountInput(goal.targetAmountMinor, currency)
                    }
                  />
                  <input type="hidden" name="targetDate" value={wifDate ?? goal.targetDate ?? ""} />
                  <input
                    type="hidden"
                    name="plannedContribution"
                    value={
                      wifContribution !== null
                        ? minorToAmountInput(wifContribution, currency)
                        : goal.contributionSchedule
                          ? minorToAmountInput(goal.contributionSchedule.amountMinor, currency)
                          : ""
                    }
                  />
                  <Button type="submit" size="sm">
                    Apply this plan to the goal
                  </Button>
                  <span className="text-[11.5px] text-ink-muted">
                    Updates the saved target/date/planned contribution.
                  </span>
                </form>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Status controls */}
        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Goal status</h2>
            <GoalStatusButtons goalId={goal.id} status={goal.status} />
          </CardContent>
        </Card>

        {/* Contribution history */}
        <Card>
          <CardHeader>
            <CardTitle>Contribution history</CardTitle>
            <p className="text-[12.5px] text-ink-muted">
              An append-only record. Entries here track your goal — they never move real money.
            </p>
          </CardHeader>
          <CardContent>
            {contributions.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                Nothing recorded yet — add your first contribution.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <caption className="sr-only">Contributions and withdrawals for this goal</caption>
                  <thead>
                    <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Date
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Kind
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Note
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributions.map((entry) => (
                      <tr key={entry.id} className="border-b border-hairline last:border-0">
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {formatIsoDate(entry.contributedOn, "en-MY")}
                        </td>
                        <td className="px-2 py-1.5">
                          {entry.amountMinor < 0 ? (
                            <Badge variant="attention">Withdrawal</Badge>
                          ) : entry.kind === "linked_transfer" ? (
                            <Badge variant="info">Linked transfer</Badge>
                          ) : (
                            <Badge>Allocation</Badge>
                          )}
                        </td>
                        <td className="max-w-64 truncate px-2 py-1.5 text-ink-secondary">
                          {entry.note ?? "—"}
                        </td>
                        <td className="num px-2 py-1.5 text-right">
                          <AmountText amountMinor={entry.amountMinor} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
