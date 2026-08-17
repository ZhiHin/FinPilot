"use client";

import { useActionState, useEffect, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import {
  addEventAction,
  deleteScenarioAction,
  removeEventAction,
  saveScenarioAction,
  type ScenarioFormState,
} from "./actions";

export interface PickerOption {
  id: string;
  label: string;
}

const EVENT_TYPE_OPTIONS = [
  ["one_time_expense", "One-time purchase"],
  ["emergency_expense", "Emergency expense"],
  ["income_change", "Income change (monthly ±)"],
  ["rent_change", "Recurring amount change"],
  ["cancel_recurring", "Cancel a recurring item"],
  ["add_installment", "New instalment (BNPL/loan)"],
  ["savings_change", "Save more/less each month"],
] as const;

type EventType = (typeof EVENT_TYPE_OPTIONS)[number][0];

/** Left panel (UX 4.6): typed what-if inputs. Nothing here touches real records. */
export function AddEventForm({
  scenarioId,
  patterns,
  categories,
  goals,
}: {
  scenarioId: string;
  patterns: PickerOption[];
  categories: PickerOption[];
  goals: PickerOption[];
}) {
  const [state, formAction, pending] = useActionState<ScenarioFormState, FormData>(
    addEventAction,
    null,
  );
  const [eventType, setEventType] = useState<EventType>("one_time_expense");

  const wantsAmount = eventType !== "cancel_recurring";
  const amountLabel =
    eventType === "income_change" || eventType === "savings_change"
      ? "Monthly change (negative to reduce)"
      : eventType === "rent_change"
        ? "New amount per occurrence"
        : "Amount";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="event-type" className="text-[13px] font-medium text-ink-secondary">
          What happens?
        </label>
        <Select
          id="event-type"
          name="eventType"
          value={eventType}
          onChange={(e) => setEventType(e.target.value as EventType)}
        >
          {EVENT_TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="event-date" className="text-[13px] font-medium text-ink-secondary">
          {eventType === "one_time_expense" || eventType === "emergency_expense"
            ? "On date"
            : "Starting"}
        </label>
        <Input id="event-date" name="effectiveOn" type="date" required />
      </div>
      {wantsAmount ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-amount" className="text-[13px] font-medium text-ink-secondary">
            {amountLabel}
          </label>
          <Input id="event-amount" name="amount" inputMode="decimal" placeholder="e.g. 2,800" />
        </div>
      ) : null}
      {eventType === "add_installment" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-months" className="text-[13px] font-medium text-ink-secondary">
            Months
          </label>
          <Input id="event-months" name="months" type="number" min={1} max={60} defaultValue={6} />
        </div>
      ) : null}
      {eventType === "rent_change" || eventType === "cancel_recurring" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-pattern" className="text-[13px] font-medium text-ink-secondary">
            Recurring item
          </label>
          <Select id="event-pattern" name="patternId" required>
            {patterns.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {eventType === "income_change" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-income" className="text-[13px] font-medium text-ink-secondary">
            Which income (optional)
          </label>
          <Select id="event-income" name="patternId" defaultValue="">
            <option value="">All income</option>
            {patterns.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {eventType === "one_time_expense" || eventType === "emergency_expense" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-category" className="text-[13px] font-medium text-ink-secondary">
            Category (optional, for budget impact)
          </label>
          <Select id="event-category" name="categoryId" defaultValue="">
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {eventType === "savings_change" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-goal" className="text-[13px] font-medium text-ink-secondary">
            Toward goal (optional)
          </label>
          <Select id="event-goal" name="goalId" defaultValue="">
            <option value="">Not goal-specific</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Adding…" : "Add event"}
      </Button>
    </form>
  );
}

export function RemoveEventButton({
  scenarioId,
  eventId,
}: {
  scenarioId: string;
  eventId: string;
}) {
  const [state, formAction, pending] = useActionState<ScenarioFormState, FormData>(
    removeEventAction,
    null,
  );
  return (
    <form action={formAction}>
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <input type="hidden" name="eventId" value={eventId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Remove
      </Button>
    </form>
  );
}

/**
 * The explicit save (UX 4.6) with the unsaved-changes guard: while the name
 * field is dirty (or the scenario is still a draft), navigating away warns.
 */
export function SaveScenarioForm({
  scenarioId,
  name,
  description,
  status,
}: {
  scenarioId: string;
  name: string;
  description: string;
  status: "draft" | "saved" | "archived";
}) {
  const [state, formAction, pending] = useActionState<ScenarioFormState, FormData>(
    saveScenarioAction,
    null,
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <form action={formAction} className="flex flex-col gap-2" onSubmit={() => setDirty(false)}>
      {state?.ok && state.data.message ? (
        <Banner variant="positive">{state.data.message}</Banner>
      ) : null}
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      {status === "draft" ? (
        <Banner variant="info">Draft — give it a name and save to keep it.</Banner>
      ) : null}
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <label htmlFor="scenario-name" className="text-[13px] font-medium text-ink-secondary">
        Scenario name
      </label>
      <Input
        id="scenario-name"
        name="name"
        defaultValue={status === "draft" ? "" : name}
        placeholder="e.g. Laptop — Sept"
        maxLength={80}
        onChange={() => setDirty(true)}
        required
      />
      <label htmlFor="scenario-description" className="text-[13px] font-medium text-ink-secondary">
        Notes (optional)
      </label>
      <Input
        id="scenario-description"
        name="description"
        defaultValue={description}
        maxLength={200}
        onChange={() => setDirty(true)}
      />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Saving…" : status === "draft" ? "Save scenario" : "Update name/notes"}
      </Button>
    </form>
  );
}

export function DeleteScenarioButton({ scenarioId }: { scenarioId: string }) {
  const [state, formAction, pending] = useActionState<ScenarioFormState, FormData>(
    deleteScenarioAction,
    null,
  );
  return (
    <form action={formAction}>
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Delete scenario
      </Button>
    </form>
  );
}
