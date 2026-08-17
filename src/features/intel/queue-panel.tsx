"use client";

import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

import { resolveSuggestionAction, type IntelFormState } from "./actions";

export interface QueueItem {
  id: string;
  kind: string;
  rationale: string;
  confidenceBp: number;
  source: string;
  targetLabel: string;
  proposedLabel: string;
}

export interface QueueCategoryOption {
  id: string;
  name: string;
}

const DISMISS_REASONS = [
  ["wrong_category", "Wrong category"],
  ["not_useful", "Not useful"],
  ["other", "Other"],
] as const;

function confidenceLabel(bp: number): string {
  return bp >= 8500 ? "High" : bp >= 7000 ? "Medium" : "Low";
}

function QueueRow({ item, categories }: { item: QueueItem; categories: QueueCategoryOption[] }) {
  const [state, formAction, pending] = useActionState<IntelFormState, FormData>(
    resolveSuggestionAction,
    null,
  );
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0][0]);

  if (state?.ok) {
    return (
      <li className="rounded-card border border-hairline bg-card p-4">
        <Banner variant="positive">{state.data.message}</Banner>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-card border border-hairline bg-card p-4">
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-medium text-ink">{item.proposedLabel}</span>
        <Badge variant={item.source === "deterministic" ? "positive" : "info"}>
          {item.kind === "merchant_rule" ? "Rule proposal" : "Category suggestion"}
        </Badge>
        <span className="text-[12.5px] text-ink-muted">
          Confidence: {confidenceLabel(item.confidenceBp)}
        </span>
      </div>
      <p className="text-[13px] text-ink-secondary">{item.targetLabel}</p>
      <p className="text-[13px] text-ink-secondary">{item.rationale}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <form action={formAction}>
          <input type="hidden" name="suggestionId" value={item.id} />
          <input type="hidden" name="action" value="approve" />
          <Button type="submit" size="sm" disabled={pending}>
            Approve
          </Button>
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
          Edit
        </Button>
        <form action={formAction} className="flex items-center gap-1.5">
          <input type="hidden" name="suggestionId" value={item.id} />
          <input type="hidden" name="action" value="dismiss" />
          <input type="hidden" name="reasonCode" value={reason} />
          <label className="sr-only" htmlFor={`reason-${item.id}`}>
            Dismiss reason
          </label>
          <Select
            id={`reason-${item.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-40 py-1 text-[12.5px]"
          >
            {DISMISS_REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            Dismiss
          </Button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="suggestionId" value={item.id} />
          <input type="hidden" name="action" value="snooze" />
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            Snooze
          </Button>
        </form>
      </div>

      {editing ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="suggestionId" value={item.id} />
          <input type="hidden" name="action" value="edit" />
          <label htmlFor={`edit-${item.id}`} className="text-[13px] text-ink-secondary">
            Apply a different category:
          </label>
          <Select id={`edit-${item.id}`} name="categoryId" className="w-56">
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={pending}>
            Apply
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export function QueuePanel({
  items,
  categories,
}: {
  items: QueueItem[];
  categories: QueueCategoryOption[];
}) {
  if (items.length === 0) {
    return (
      <Banner variant="info">
        The queue is empty — nothing needs your decision. Suggestions appear here when the
        categorizer is confident about uncategorized transactions; nothing is ever applied without
        your approval.
      </Banner>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <QueueRow key={item.id} item={item} categories={categories} />
      ))}
    </ul>
  );
}
