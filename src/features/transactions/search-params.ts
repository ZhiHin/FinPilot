import type { ListQuery } from "@/server/services/transactions";

export interface TransactionsSearchParams {
  view?: string;
  accounts?: string;
  categories?: string;
  tags?: string;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  cursor?: string;
  /** Same-app return path for report drill-downs (validated before rendering). */
  back?: string;
}

export type SavedView = "all" | "review" | "pending" | "excluded" | "deleted";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidList(raw: string | undefined): string[] | undefined {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID.test(s));
  return ids.length > 0 ? ids : undefined;
}

/** URL → service query; URLs hold all filter state so views are bookmarkable. */
export function parseTransactionsSearchParams(params: TransactionsSearchParams): {
  query: ListQuery;
  view: SavedView;
} {
  const view = (["all", "review", "pending", "excluded", "deleted"] as const).includes(
    params.view as SavedView,
  )
    ? (params.view as SavedView)
    : "all";

  const query: ListQuery = {
    accountIds: uuidList(params.accounts),
    categoryIds: uuidList(params.categories),
    tagIds: uuidList(params.tags),
    search: params.q?.trim() || undefined,
    dateFrom: params.from || undefined,
    dateTo: params.to || undefined,
    sort: (["date_desc", "date_asc", "amount_desc", "amount_asc"] as const).includes(
      params.sort as never,
    )
      ? (params.sort as ListQuery["sort"])
      : "date_desc",
    cursor: params.cursor || undefined,
    limit: 50,
  };

  if (
    params.type &&
    ["income", "expense", "transfer", "refund", "adjustment", "debt_payment"].includes(params.type)
  ) {
    query.types = [params.type as NonNullable<ListQuery["types"]>[number]];
  }

  switch (view) {
    case "review":
      query.review = "needs_review";
      break;
    case "pending":
      query.statuses = ["pending"];
      break;
    case "excluded":
      query.excluded = true;
      break;
    case "deleted":
      query.deleted = true;
      break;
  }
  return { query, view };
}

/** Rebuild the query string, optionally overriding keys (cursor resets unless kept). */
export function transactionsHref(
  params: TransactionsSearchParams,
  overrides: Partial<TransactionsSearchParams>,
): string {
  const next: Record<string, string> = {};
  for (const key of [
    "view",
    "accounts",
    "categories",
    "tags",
    "type",
    "from",
    "to",
    "q",
    "sort",
    "back",
  ] as const) {
    const value = overrides[key] !== undefined ? overrides[key] : params[key];
    if (value) next[key] = value;
  }
  if (overrides.cursor) next.cursor = overrides.cursor;
  const qs = new URLSearchParams(next).toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}
