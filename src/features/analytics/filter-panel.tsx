import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PERIOD_OPTIONS } from "@/lib/periods";

import type { AnalyticsSearchParams, AnalyticsState } from "./search-params";

export interface FilterOption {
  id: string;
  name: string;
  detail?: string;
}

/**
 * Plain GET form — the URL is the filter state, so results are bookmarkable,
 * the browser Back button works, and no client JS is required. Multi-selects
 * are checkbox groups inside collapsible sections.
 */
export function AnalyticsFilterPanel({
  params,
  state,
  accounts,
  categories,
  tags,
  currencies,
}: {
  params: AnalyticsSearchParams;
  state: AnalyticsState;
  accounts: FilterOption[];
  categories: FilterOption[];
  tags: FilterOption[];
  currencies: string[];
}) {
  const checked = (list: string[] | undefined, id: string) => Boolean(list?.includes(id));
  return (
    <form
      method="get"
      action="/analytics"
      aria-label="Analytics filters"
      className="rounded-card border border-hairline bg-card p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1 text-[13px] text-ink-secondary">
          <label htmlFor="analytics-period">Period</label>
          <Select id="analytics-period" name="period" defaultValue={state.period?.key ?? ""}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
            {state.period === null ? <option value="">Custom range</option> : null}
          </Select>
        </div>
        <div className="flex flex-col gap-1 text-[13px] text-ink-secondary">
          <label htmlFor="analytics-from">Custom from</label>
          <Input id="analytics-from" type="date" name="from" defaultValue={params.from ?? ""} />
        </div>
        <div className="flex flex-col gap-1 text-[13px] text-ink-secondary">
          <label htmlFor="analytics-to">Custom to</label>
          <Input id="analytics-to" type="date" name="to" defaultValue={params.to ?? ""} />
        </div>
        <div className="flex flex-col gap-1 text-[13px] text-ink-secondary">
          <label htmlFor="analytics-compare">Compare against</label>
          <Select id="analytics-compare" name="compare" defaultValue={state.compare}>
            <option value="none">No comparison</option>
            <option value="prev">Previous period</option>
            <option value="year">Same period last year</option>
          </Select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {currencies.length > 1 ? (
          <div className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            <label htmlFor="analytics-currency">Currency</label>
            <Select id="analytics-currency" name="currency" defaultValue={state.currency ?? ""}>
              <option value="">All currencies (shown separately)</option>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <CheckboxGroup
          legend="Accounts"
          name="accounts"
          options={accounts}
          selected={state.accountIds}
          isChecked={checked}
        />
        <CheckboxGroup
          legend="Categories"
          name="categories"
          options={categories}
          selected={state.categoryIds}
          isChecked={checked}
        />
        <CheckboxGroup
          legend="Tags"
          name="tags"
          options={tags}
          selected={state.tagIds}
          isChecked={checked}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        <Link
          href="/analytics"
          className="text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
        >
          Reset all filters
        </Link>
        <p className="text-[11.5px] text-ink-muted">
          A custom from/to range overrides the period preset.
        </p>
      </div>
    </form>
  );
}

/**
 * Checkbox multi-select that submits as a comma-joined single param via
 * same-named checkboxes; the server joins repeated params.
 */
function CheckboxGroup({
  legend,
  name,
  options,
  selected,
  isChecked,
}: {
  legend: string;
  name: string;
  options: FilterOption[];
  selected: string[] | undefined;
  isChecked: (list: string[] | undefined, id: string) => boolean;
}) {
  if (options.length === 0) return null;
  const activeCount = selected?.length ?? 0;
  return (
    <details
      className="rounded-control border border-hairline bg-raised px-3 py-2"
      open={activeCount > 0}
    >
      <summary className="cursor-pointer text-[13px] font-medium text-ink-secondary">
        {legend}
        {activeCount > 0 ? ` (${activeCount} selected)` : ""}
      </summary>
      <fieldset className="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              name={name}
              value={option.id}
              defaultChecked={isChecked(selected, option.id)}
              className="h-4 w-4 accent-[var(--accent-primary)]"
            />
            <span className="truncate">
              {option.name}
              {option.detail ? (
                <span className="ml-1 text-[11.5px] text-ink-muted">{option.detail}</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
