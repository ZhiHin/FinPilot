"use client";

import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";

import { createBudgetAction, type BudgetFormState } from "./actions";
import { BUDGET_MODE_HELP, BUDGET_MODE_LABELS } from "./labels";

const MODES = ["fixed", "flexible", "rollover", "zero_based"] as const;

export function CreateBudgetForm({
  defaultMode,
  defaultPaydayDay,
  defaultWeekendAdjust,
  currencies,
}: {
  defaultMode: string | null;
  defaultPaydayDay: string | null;
  defaultWeekendAdjust: boolean;
  currencies: string[];
}) {
  const [state, formAction, pending] = useActionState<BudgetFormState, FormData>(
    createBudgetAction,
    null,
  );
  const [mode, setMode] = useState(
    MODES.includes(defaultMode as (typeof MODES)[number]) ? (defaultMode as string) : "flexible",
  );
  const [cycleType, setCycleType] = useState(defaultPaydayDay ? "payday" : "calendar_month");
  const errors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  const selectedMode = mode as (typeof MODES)[number];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your budget</CardTitle>
        <p className="text-[13px] text-ink-muted">
          One budget per currency; every change you make later is explicit and kept in history.
        </p>
      </CardHeader>
      <CardContent>
        {/* Form left, mode reference right — the choice being made here is
            mostly "which mode?", so the space beside the fields shows the
            options side by side instead of sitting empty. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <form action={formAction} className="flex flex-col gap-4" noValidate>
            {state && !state.ok && !state.error.fieldErrors ? (
              <Banner variant="risk">{state.error.message}</Banner>
            ) : null}
            {state?.ok ? <Banner variant="positive">{state.data.message}</Banner> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Name" errors={errors.name}>
                <Input name="name" defaultValue="My budget" required maxLength={80} />
              </FormField>
              <FormField label="Mode" help={BUDGET_MODE_HELP[selectedMode]}>
                <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {BUDGET_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Cycle"
                help={
                  cycleType === "payday"
                    ? "Each cycle runs payday to payday."
                    : "Each cycle is a calendar month."
                }
              >
                <Select
                  name="cycleType"
                  value={cycleType}
                  onChange={(e) => setCycleType(e.target.value)}
                >
                  <option value="calendar_month">Calendar month</option>
                  <option value="payday">Payday to payday</option>
                </Select>
              </FormField>
              <FormField
                label="Currency"
                help="A budget tracks one currency; amounts are never converted."
                errors={errors.currency}
              >
                <Select name="currency" defaultValue={currencies[0] ?? "MYR"}>
                  {(currencies.length > 0 ? currencies : ["MYR"]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            {cycleType === "payday" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Payday" errors={errors.paydayDay}>
                  <Select name="paydayDay" defaultValue={defaultPaydayDay ?? "25"}>
                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((day) => (
                      <option key={day} value={day}>
                        Day {day}
                      </option>
                    ))}
                    <option value="last">Last day of the month</option>
                  </Select>
                </FormField>
                <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-secondary">
                  <input
                    type="checkbox"
                    name="weekendAdjust"
                    defaultChecked={defaultWeekendAdjust}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                  Move weekend paydays to Friday
                </label>
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-[13px] text-ink-secondary">
              <input
                type="checkbox"
                name="carryNegative"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
              />
              <span>
                Carry overspending into the next cycle as a negative rollover (off = overspent
                categories restart at zero)
              </span>
            </label>
            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Creating…" : "Create budget"}
            </Button>
          </form>

          <aside
            aria-labelledby="budget-mode-reference"
            className="flex flex-col gap-3 rounded-card bg-sunken p-4"
          >
            <h3 id="budget-mode-reference" className="text-[13px] font-semibold text-ink">
              How the modes differ
            </h3>
            <dl className="flex flex-col gap-3">
              {MODES.map((m) => {
                const active = m === selectedMode;
                return (
                  <div
                    key={m}
                    className={cn(
                      "rounded-control border px-3 py-2",
                      active ? "border-accent bg-card" : "border-transparent text-ink-secondary",
                    )}
                  >
                    <dt
                      className={cn(
                        "text-[13px] font-medium",
                        active ? "text-ink" : "text-ink-secondary",
                      )}
                    >
                      {BUDGET_MODE_LABELS[m]}
                      {active ? (
                        <span className="ml-2 text-[11.5px] font-normal text-accent">selected</span>
                      ) : null}
                    </dt>
                    <dd className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">
                      {BUDGET_MODE_HELP[m]}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="text-[11.5px] leading-5 text-ink-muted">
              You set the per-category amounts after this step, and you can change mode later —
              every change is recorded in history.
            </p>
          </aside>
        </div>
      </CardContent>
    </Card>
  );
}
