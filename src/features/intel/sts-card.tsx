import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatIsoDate } from "@/lib/dates";
import { formatMinor } from "@/lib/money";
import type { StsView } from "@/server/services/intel";

/**
 * The Safe-to-Spend meter (UX doc §4.1): today + until-payday figures, a
 * range when the bands diverge (spec B1), and a "why" drawer itemizing every
 * term of the binding formula. Server-rendered; the drawer is a native
 * <details> — fully keyboard/SR accessible with zero JS.
 */
export function SafeToSpendCard({ view }: { view: StsView }) {
  const { result, currency } = view;
  const negative = result.expected.untilPaydayMinor < 0;
  const line = (label: string, amountMinor: number, sign: "+" | "−") => (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-ink-secondary">
        {sign === "−" ? "− " : "+ "}
        {label}
      </span>
      <AmountText amountMinor={amountMinor} currency={currency} className="text-[13px]" />
    </li>
  );

  return (
    <Card className="panel">
      <div className="sheen" aria-hidden />
      <CardContent className="relative flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="eyebrow">Safe to spend</h2>
            <p
              className={cn(
                "num-readout mt-1.5 text-[clamp(2.5rem,4.4vw,3.5rem)] font-medium leading-[1.02]",
                negative ? "text-risk" : "text-ink",
              )}
            >
              <AmountText amountMinor={result.expected.todayMinor} currency={currency} />
            </p>
            <p className="mt-2 text-[13px] text-ink-secondary">
              available today, after everything already committed
            </p>
          </div>
          <div className="shrink-0 border-hairline sm:border-l sm:pl-6 sm:text-right">
            <p className="num-readout text-[22px] font-medium text-ink">
              <AmountText amountMinor={result.expected.untilPaydayMinor} currency={currency} />
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              until {view.hasPaydayPattern ? "payday" : "month end"}
              <br />
              {formatIsoDate(view.payday, "en-MY")}
            </p>
          </div>
        </div>
        <div className="horizon animate-horizon" aria-hidden />

        {result.isRange ? (
          <p className="text-[12.5px] text-ink-secondary">
            Range {formatMinor(result.conservative.untilPaydayMinor, currency)} –{" "}
            {formatMinor(result.optimistic.untilPaydayMinor, currency)} until payday — some income
            or bills are still estimates, so the conservative and optimistic paths differ.
          </p>
        ) : null}
        {negative ? (
          <p className="text-[12.5px] font-medium text-risk">
            Committed bills, budgets, goals, and your buffer exceed today’s liquid balance — this
            figure is honestly negative, not hidden.
          </p>
        ) : null}

        <details className="group rounded-control bg-sunken px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-medium text-accent">
            Why this number?
          </summary>
          <ul className="mt-2 text-[13px]">
            {line("Liquid balance", view.result.breakdown.liquidMinor, "+")}
            {view.incomeItems.map((item) => (
              <li key={item.name} className="flex items-baseline justify-between gap-3 py-1">
                <span className="text-ink-secondary">
                  + Expected income: {item.name}
                  {!item.confirmed ? " (inferred)" : ""}
                </span>
                <AmountText
                  amountMinor={item.amountMinor}
                  currency={currency}
                  className="text-[13px]"
                />
              </li>
            ))}
            {view.billItems.map((item) => (
              <li key={item.name} className="flex items-baseline justify-between gap-3 py-1">
                <span className="text-ink-secondary">
                  − Upcoming bill: {item.name}
                  {!item.confirmed ? " (inferred)" : ""}
                </span>
                <AmountText
                  amountMinor={item.amountMinor}
                  currency={currency}
                  className="text-[13px]"
                />
              </li>
            ))}
            {view.committalItems.map((item) => (
              <li key={item.name} className="flex items-baseline justify-between gap-3 py-1">
                <span className="text-ink-secondary">− Budget still planned: {item.name}</span>
                <AmountText
                  amountMinor={item.amountMinor}
                  currency={currency}
                  className="text-[13px]"
                />
              </li>
            ))}
            {view.goalItems.map((item) => (
              <li key={item.name} className="flex items-baseline justify-between gap-3 py-1">
                <span className="text-ink-secondary">− Goal contribution due: {item.name}</span>
                <AmountText
                  amountMinor={item.amountMinor}
                  currency={currency}
                  className="text-[13px]"
                />
              </li>
            ))}
            {line("Safety buffer", view.result.breakdown.safetyBufferMinor, "−")}
            <li className="mt-1 flex items-baseline justify-between gap-3 border-t border-hairline pt-2 font-medium">
              <span>= Safe to spend until payday</span>
              <AmountText
                amountMinor={result.expected.untilPaydayMinor}
                currency={currency}
                className="text-[13px]"
              />
            </li>
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-muted">
            Divided over {result.daysToPayday} day{result.daysToPayday === 1 ? "" : "s"} with bills
            reserved up front. Deterministic arithmetic over your own ledger — never a prediction
            model.
            {!view.hasPaydayPattern
              ? " Set your payday in onboarding/settings for a payday-aware window."
              : ""}
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
