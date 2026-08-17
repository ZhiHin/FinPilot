import type { Metadata } from "next";
import Link from "next/link";

import { formatBp } from "@/components/charts/format";
import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { GoalFormDialog, type AccountOption } from "@/features/goals/goal-dialogs";
import { formatMonth, GOAL_TYPE_LABELS, TimeStatusBadge } from "@/features/goals/labels";
import { cn } from "@/lib/cn";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";
import { goalsService, type GoalWithProgress } from "@/server/services/goals";

export const metadata: Metadata = { title: t("nav.goals") };

const VIEWS = [
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
] as const;

function GoalCard({ goal }: { goal: GoalWithProgress }) {
  const pct = Math.min(goal.outlook.progressBp, 10000);
  return (
    <li className="flex flex-col gap-3 rounded-card border border-hairline bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/goals/${goal.id}`}
            className="text-[15px] font-semibold text-ink underline-offset-2 hover:underline"
          >
            {goal.name}
          </Link>
          <p className="text-[11.5px] text-ink-muted">
            {GOAL_TYPE_LABELS[goal.type]} · priority {goal.priority}
            {goal.linkedAccountName
              ? ` · linked to ${goal.linkedAccountName} (reference only)`
              : ""}
          </p>
        </div>
        <TimeStatusBadge status={goal.outlook.timeStatus} />
      </div>
      <p className="num text-[15px] text-ink">
        <AmountText amountMinor={goal.savedMinor} currency={goal.currency} />{" "}
        <span className="text-ink-muted">
          of <AmountText amountMinor={goal.targetAmountMinor} currency={goal.currency} /> (
          {formatBp(goal.outlook.progressBp)})
        </span>
      </p>
      <Progress
        value={pct}
        max={10000}
        label={`${goal.name}: ${formatBp(goal.outlook.progressBp)} of the target saved`}
      />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-ink-secondary">
        {goal.outlook.requiredMonthlyMinor !== null && goal.outlook.requiredMonthlyMinor > 0 ? (
          <>
            <dt>Needs monthly</dt>
            <dd className="num text-right">
              <AmountText
                amountMinor={goal.outlook.requiredMonthlyMinor}
                currency={goal.currency}
              />
            </dd>
          </>
        ) : null}
        {goal.outlook.estimatedCompletionMonth ? (
          <>
            <dt>Est. done</dt>
            <dd className="text-right">{formatMonth(goal.outlook.estimatedCompletionMonth)}</dd>
          </>
        ) : goal.outlook.timeStatus !== "completed" ? (
          <>
            <dt>Est. done</dt>
            <dd className="text-right text-ink-muted">No contributions yet</dd>
          </>
        ) : null}
        {goal.targetDate ? (
          <>
            <dt>Target date</dt>
            <dd className="text-right">{formatIsoDate(goal.targetDate, "en-MY")}</dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");

  const view = (VIEWS.map((v) => v.key) as string[]).includes(sp.view ?? "")
    ? (sp.view as (typeof VIEWS)[number]["key"])
    : "active";

  const [goals, accountRows] = await Promise.all([
    goalsService.listWithProgress(db, user.id, today),
    accountsService.list(db, user.id),
  ]);
  const accounts: AccountOption[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency.trim(),
  }));
  const visible = goals.filter((goal) => goal.status === view);
  const countFor = (key: string) => goals.filter((goal) => goal.status === key).length;

  return (
    <>
      <PageHeader
        title={t("nav.goals")}
        description="Honest progress toward what you're saving for. Contributions here track intent — they never move money."
        actions={<GoalFormDialog mode="create" accounts={accounts} />}
      />

      <div className="flex flex-col gap-4">
        <nav aria-label="Goal views" className="flex flex-wrap gap-1">
          {VIEWS.map((entry) => (
            <Link
              key={entry.key}
              href={entry.key === "active" ? "/goals" : `/goals?view=${entry.key}`}
              aria-current={view === entry.key ? "page" : undefined}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[13px] font-medium",
                view === entry.key
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:bg-sunken hover:text-ink",
              )}
            >
              {entry.label}
              {countFor(entry.key) > 0 ? ` (${countFor(entry.key)})` : ""}
            </Link>
          ))}
        </nav>

        {visible.length === 0 ? (
          goals.length === 0 ? (
            <EmptyState
              title="No goals yet"
              description="Create your first savings goal — an emergency fund is the classic place to start. You record progress yourself; FinPilot never moves money."
            />
          ) : (
            <EmptyState
              title={`No ${view} goals`}
              description="Switch views above to see your other goals."
            />
          )
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </ul>
        )}

        {view === "paused" && visible.length > 0 ? (
          <p className="text-[12.5px] text-ink-muted">
            Paused goals keep their history and estimates but sit out of your active list.
          </p>
        ) : null}
        {visible.some(
          (goal) => goal.status === "active" && goal.outlook.timeStatus === "behind",
        ) ? (
          <p className="text-[12.5px] text-ink-muted">
            <Badge variant="attention">Behind</Badge> compares the estimated completion (at your
            current contribution rate) with the target date — a deterministic calculation, not a
            prediction.
          </p>
        ) : null}
      </div>
    </>
  );
}
