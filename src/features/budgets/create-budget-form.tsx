"use client";

import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

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

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Create your budget</CardTitle>
        <p className="text-[13px] text-ink-muted">
          One budget per currency; every change you make later is explicit and kept in history.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state && !state.ok && !state.error.fieldErrors ? (
            <Banner variant="risk">{state.error.message}</Banner>
          ) : null}
          {state?.ok ? <Banner variant="positive">{state.data.message}</Banner> : null}
          <FormField label="Name" errors={errors.name}>
            <Input name="name" defaultValue="My budget" required maxLength={80} />
          </FormField>
          <FormField label="Mode" help={BUDGET_MODE_HELP[mode as (typeof MODES)[number]]}>
            <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {BUDGET_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </FormField>
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
          <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="checkbox"
              name="carryNegative"
              className="h-4 w-4 accent-[var(--accent-primary)]"
            />
            Carry overspending into the next cycle as a negative rollover (off = overspent
            categories restart at zero)
          </label>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Creating…" : "Create budget"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
