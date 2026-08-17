"use client";

import { useActionState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

import { applySuggestionAction, dismissInsightAction, type IntelFormState } from "./actions";

export function DismissInsightButton({ insightId }: { insightId: string }) {
  const [state, formAction, pending] = useActionState<IntelFormState, FormData>(
    dismissInsightAction,
    null,
  );
  return (
    <div className="flex flex-col items-end gap-1.5">
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <form action={formAction}>
        <input type="hidden" name="insightId" value={insightId} />
        <Button type="submit" variant="ghost" size="sm" disabled={pending}>
          Dismiss
        </Button>
      </form>
    </div>
  );
}

export function SuggestionActions({
  insightId,
  periodId,
  categoryId,
  suggestedMinor,
  expectedVersion,
}: {
  insightId: string;
  periodId: string;
  categoryId: string;
  suggestedMinor: number;
  expectedVersion: number;
}) {
  const [applyState, applyFormAction, applyPending] = useActionState<IntelFormState, FormData>(
    applySuggestionAction,
    null,
  );
  const [dismissState, dismissFormAction, dismissPending] = useActionState<
    IntelFormState,
    FormData
  >(dismissInsightAction, null);
  return (
    <div className="flex flex-col gap-1.5">
      {applyState && !applyState.ok ? (
        <Banner variant="risk">{applyState.error.message}</Banner>
      ) : null}
      {dismissState && !dismissState.ok ? (
        <Banner variant="risk">{dismissState.error.message}</Banner>
      ) : null}
      <div className="flex gap-1.5">
        <form action={applyFormAction}>
          <input type="hidden" name="insightId" value={insightId} />
          <input type="hidden" name="periodId" value={periodId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="suggestedMinor" value={suggestedMinor} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <Button type="submit" size="sm" disabled={applyPending || dismissPending}>
            {applyPending ? "Applying…" : "Approve"}
          </Button>
        </form>
        <form action={dismissFormAction}>
          <input type="hidden" name="insightId" value={insightId} />
          <Button type="submit" variant="ghost" size="sm" disabled={applyPending || dismissPending}>
            Dismiss
          </Button>
        </form>
      </div>
    </div>
  );
}
