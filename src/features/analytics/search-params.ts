import { isValidIsoDate } from "@/lib/dates";
import { PERIOD_OPTIONS, resolvePeriod, type PeriodKey, type ResolvedPeriod } from "@/lib/periods";

/**
 * URL → analytics state. The URL is the single source of filter truth so every
 * view is bookmarkable, drill-downs can carry filters along, and Back works.
 */

export interface AnalyticsSearchParams {
  period?: string;
  from?: string;
  to?: string;
  accounts?: string;
  categories?: string;
  tags?: string;
  currency?: string;
  compare?: string;
}

export type CompareMode = "none" | "prev" | "year";

export interface AnalyticsState {
  period: ResolvedPeriod | null; // null when a custom from/to range is active
  dateFrom: string;
  dateTo: string;
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  currency?: string;
  compare: CompareMode;
  /** True when any non-default filter is active (shows the Reset control). */
  filtered: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidList(raw: string | undefined): string[] | undefined {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID.test(s));
  return ids.length > 0 ? ids : undefined;
}

export function parseAnalyticsSearchParams(
  params: AnalyticsSearchParams,
  today: string,
): AnalyticsState {
  const customValid =
    params.from &&
    params.to &&
    isValidIsoDate(params.from) &&
    isValidIsoDate(params.to) &&
    params.from <= params.to;

  const period = customValid ? null : resolvePeriod(params.period ?? "this-month", today);
  const compare: CompareMode =
    params.compare === "prev" || params.compare === "year" ? params.compare : "none";
  const accountIds = uuidList(params.accounts);
  const categoryIds = uuidList(params.categories);
  const tagIds = uuidList(params.tags);
  const currency =
    params.currency && /^[A-Za-z]{3}$/.test(params.currency)
      ? params.currency.toUpperCase()
      : undefined;

  return {
    period,
    dateFrom: period ? period.dateFrom : (params.from as string),
    dateTo: period ? period.dateTo : (params.to as string),
    accountIds,
    categoryIds,
    tagIds,
    currency,
    compare,
    filtered: Boolean(
      accountIds || categoryIds || tagIds || currency || customValid || params.period,
    ),
  };
}

/** Rebuild /analytics?… keeping current params, with overrides ("" removes a key). */
export function analyticsHref(
  params: AnalyticsSearchParams,
  overrides: Partial<AnalyticsSearchParams> = {},
): string {
  const next: Record<string, string> = {};
  for (const key of [
    "period",
    "from",
    "to",
    "accounts",
    "categories",
    "tags",
    "currency",
    "compare",
  ] as const) {
    const value = overrides[key] !== undefined ? overrides[key] : params[key];
    if (value) next[key] = value;
  }
  const qs = new URLSearchParams(next).toString();
  return qs ? `/analytics?${qs}` : "/analytics";
}

/** Drill-down into /transactions preserving the analytics filters + a way back. */
export function drillDownHref(
  state: AnalyticsState,
  extra: { categoryId?: string; search?: string },
  backHref: string,
): string {
  const qs = new URLSearchParams();
  qs.set("from", state.dateFrom);
  qs.set("to", state.dateTo);
  if (state.accountIds?.length) qs.set("accounts", state.accountIds.join(","));
  if (extra.categoryId) qs.set("categories", extra.categoryId);
  else if (state.categoryIds?.length) qs.set("categories", state.categoryIds.join(","));
  if (state.tagIds?.length) qs.set("tags", state.tagIds.join(","));
  if (extra.search) qs.set("q", extra.search);
  qs.set("back", backHref);
  return `/transactions?${qs.toString()}`;
}

/** The CSV export URL for the active filters (same params the API validates). */
export function exportHref(state: AnalyticsState): string {
  const qs = new URLSearchParams();
  qs.set("from", state.dateFrom);
  qs.set("to", state.dateTo);
  if (state.accountIds?.length) qs.set("accounts", state.accountIds.join(","));
  if (state.categoryIds?.length) qs.set("categories", state.categoryIds.join(","));
  if (state.tagIds?.length) qs.set("tags", state.tagIds.join(","));
  return `/api/exports/transactions?${qs.toString()}`;
}

export { PERIOD_OPTIONS };
export type { PeriodKey };
