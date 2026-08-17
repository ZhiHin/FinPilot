"use client";

import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  createEntryAction,
  deleteEntryAction,
  recordOutcomeAction,
  type JournalFormState,
} from "./actions";

const KIND_OPTIONS = [
  ["life_event", "Life event (travel, moving, medical, celebration)"],
  ["decision", "Decision (cancelled a service, changed a plan)"],
  ["note", "Note"],
] as const;

export function NewEntryForm({ scenarios }: { scenarios: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState<JournalFormState, FormData>(
    createEntryAction,
    null,
  );
  const [kind, setKind] = useState<string>("life_event");

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-card border border-hairline bg-card p-4"
    >
      <h2 className="text-[15px] font-semibold text-ink">New journal entry</h2>
      {state?.ok && state.data.message ? (
        <Banner variant="positive">{state.data.message}</Banner>
      ) : null}
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="entry-kind" className="text-[13px] font-medium text-ink-secondary">
            Kind
          </label>
          <Select
            id="entry-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KIND_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entry-title" className="text-[13px] font-medium text-ink-secondary">
            Title
          </label>
          <Input
            id="entry-title"
            name="title"
            required
            maxLength={120}
            placeholder="e.g. Travel — family wedding"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entry-start" className="text-[13px] font-medium text-ink-secondary">
            From
          </label>
          <Input id="entry-start" name="startsOn" type="date" required />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entry-end" className="text-[13px] font-medium text-ink-secondary">
            To (optional)
          </label>
          <Input id="entry-end" name="endsOn" type="date" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="entry-body" className="text-[13px] font-medium text-ink-secondary">
          What was going on? (optional)
        </label>
        <Input id="entry-body" name="body" maxLength={2000} />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-control bg-sunken px-3 py-2">
        <div>
          <div className="text-[13px] font-medium text-ink">Mark as one-off</div>
          <p className="text-[12.5px] text-ink-secondary">
            Excludes this period from anomaly baselines, budget suggestions, and the spending
            forecast — so one unusual stretch doesn&apos;t distort your normal numbers. Your
            transactions and reports are untouched.
          </p>
        </div>
        <Switch name="excludeFromBaselines" aria-label="Mark as one-off (exclude from baselines)" />
      </div>

      {kind === "decision" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="entry-saving" className="text-[13px] font-medium text-ink-secondary">
              Expected saving per month (optional)
            </label>
            <Input
              id="entry-saving"
              name="expectedSaving"
              inputMode="decimal"
              placeholder="e.g. 90"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="entry-review" className="text-[13px] font-medium text-ink-secondary">
              Review on (optional)
            </label>
            <Input id="entry-review" name="reviewOn" type="date" />
          </div>
          {scenarios.length > 0 ? (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label
                htmlFor="entry-scenario"
                className="text-[13px] font-medium text-ink-secondary"
              >
                Link a saved scenario (optional)
              </label>
              <Select id="entry-scenario" name="scenarioId" defaultValue="">
                <option value="">No linked scenario</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Add entry"}
      </Button>
    </form>
  );
}

export function OutcomeReviewForm({ entryId }: { entryId: string }) {
  const [state, formAction, pending] = useActionState<JournalFormState, FormData>(
    recordOutcomeAction,
    null,
  );
  if (state?.ok) {
    return <Banner variant="positive">{state.data.message}</Banner>;
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="entryId" value={entryId} />
      <label htmlFor={`verdict-${entryId}`} className="text-[13px] text-ink-secondary">
        Did it happen?
      </label>
      <Select id={`verdict-${entryId}`} name="verdict" defaultValue="happened" className="w-36">
        <option value="happened">Yes</option>
        <option value="partly">Partly</option>
        <option value="no">No</option>
      </Select>
      <Input name="note" placeholder="Optional note" maxLength={500} className="w-52" />
      <Button type="submit" size="sm" disabled={pending}>
        Record outcome
      </Button>
    </form>
  );
}

export function DeleteEntryButton({ entryId }: { entryId: string }) {
  const [state, formAction, pending] = useActionState<JournalFormState, FormData>(
    deleteEntryAction,
    null,
  );
  return (
    <form action={formAction}>
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="entryId" value={entryId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Delete
      </Button>
    </form>
  );
}
