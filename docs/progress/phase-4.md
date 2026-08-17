# Phase 4 — Dashboard and Analytics

**Status:** Complete — all acceptance criteria pass; committed as
`feat: complete phase 4 dashboard and analytics`.
**Date:** 2026-08-17
**Plan:** Master prompt Phase 4 + backlog §1 + ERD §5.1 (no new tables) + ADR-009 (chart kit)
+ design doc §4 (validated chart palette) + the reporting rules documented in Phase 2.

## Design decisions (the plan as executed)

1. **One formula engine.** `src/server/services/analytics.ts` is the single home of every
   financial formula: income, expense (refund-reducing), **Savings = posted income − posted
   expenses**, **Savings rate = savings ÷ income** (basis-point integers; **null on zero or
   negative income — never a misleading percentage**), and comparison change (null on a zero
   baseline → UI says "New — no previous activity"). Pages, exports, and charts only render
   what the service computed; the pure formulas are unit-tested in isolation.
2. **Reporting rules** (unchanged from their approved Phase 2 meaning): reports cover
   posted ∧ not-excluded ∧ not-deleted rows; transfers/adjustments/debt-payments are never
   income or expense; refunds reduce expense (and their category/merchant); pending rows are
   surfaced separately as data-quality notices; staged (uncommitted) import rows are not
   transactions and appear only as an "imports awaiting confirmation" notice; **balances and
   the net-position trend include excluded transactions** (they moved real money) and
   archived accounts still marked include-in-net-worth; **currencies are never combined** —
   every result is grouped by currency and rendered in separate sections.
3. **Split-aware category math.** Category breakdowns join `transaction_splits`
   (`coalesce(split.category, txn.category)` / `coalesce(split.amount, txn.amount)`), so a
   split transaction counts once per split and never double-counts (splits sum exactly to the
   parent — DB invariant). The integration test pins breakdown-total ≡ period-expense.
4. **Periods & comparisons** (`src/lib/periods`, pure date-string math, timezone-aware via
   the user's stored timezone): presets this-month / last-month / last-3-months / this-year /
   last-12-months plus custom from/to. Equal-length comparisons: whole calendar months
   compare to the preceding same-count months; month-to-date compares the same days into the
   previous month (clamped); arbitrary ranges compare to the equal-day-count window ending
   the day before. Year-over-year shifts a year with Feb-29 clamping. Incomplete periods are
   labeled "(in progress)" everywhere.
5. **Chart kit (ADR-009).** Recharts 3 wrapped in `src/components/charts/` — feature code
   never imports Recharts. Every chart ships as a `ChartCard` with a title, one-sentence
   description, and a **Table tab holding the same data** (the accessible path; drawings are
   `role="img"`, and card content with real links opts out of the img role to avoid nested
   interactives). Palette: validated slots `--chart-1..8` added to tokens light + dark;
   diverging blue↔red with neutral midpoint for net cash flow; fixed slot order; no dual
   axes; animations disabled (motion discipline). Ranked category/merchant "bar list" charts
   are plain HTML (real text, real links) rather than canvas drawings.
6. **Dashboard** (`/overview` rewritten): per-currency net-position tiles (liquid / assets /
   liabilities / net, liabilities keep their sign), period selector (`?period=`), per-currency
   income / expenses / savings / savings-rate tiles with previous-period comparison sentences,
   six-month cash-flow chart, top-5 spending categories and merchants with drill-downs,
   five most recent transactions, data-quality notices (pending, needs-review, uncommitted
   imports), and the onboarding setup strip. Only live features are shown.
7. **Analytics workspace** (`/analytics`): URL-is-the-state GET filter form (period preset,
   custom range, previous-period/year-over-year comparison, per-currency focus, account /
   category / tag checkbox groups) so every view is bookmarkable and Back works; summary
   sentence; income-vs-expense bars, net-cash-flow diverging bars, savings-rate line,
   12-month net-position line, split-aware category breakdowns (expense + income), top-10
   merchants; comparison table on equal-length windows; empty / error / loading states;
   mobile-clean at 360px.
8. **Drill-down with a way back.** Category and merchant rows link into `/transactions`
   carrying the active date/account/category/tag filters plus a `back` parameter; the
   transactions page renders a "Back to Analytics/Overview" banner only for same-app
   `/analytics…` or `/overview…` values (no open redirect).
9. **CSV export** (`GET /api/exports/transactions` → `exportsService` → `lib/csv/export`):
   session-derived user only; filter ids ownership-validated fail-closed; stable documented
   column order **Date, Description, Merchant, Category, Account, Type, Status, Excluded,
   Tags, Amount, Currency, Notes** (never internal ids/hashes/user or session data); minor
   units converted to signed decimals; UTF-8 with BOM, CRLF, RFC-4180 quoting;
   **formula-injection protection**: free-text fields starting with `=` `+` `-` `@` TAB or CR
   are apostrophe-prefixed (fixed-grammar app-generated columns are exempt — escaping Amount
   would corrupt negative numbers; documented in the module); 20,000-row size cap with an
   explicit truncation flag; **20/hour per-user rate limit** (audit-log-backed) and an
   `export.transactions` audit event with counts only; app-generated safe filename.
10. **No schema changes.** Phase 4 added no tables, columns, or migrations, and no new
    indexes: measured query times (below) show the Phase 2 indexes
    (`txn_user_date_idx`, `txn_user_account_date_idx`, `txn_user_category_date_idx`,
    `txn_user_merchant_idx`) already cover every analytics query.

## Performance (measured 2026-08-17, this machine, embedded PostgreSQL 17)

`tests/integration/analytics-perf.test.ts` seeds **10,000 transactions** (24 months,
8 categories, 20 merchants, excluded rows mixed in) and asserts every query beats a 1.5 s
budget; measured:

| Query | Measured |
|---|---|
| periodTotals (12-month range) | 17 ms |
| monthlyFlows (12 months) | 27 ms |
| categoryBreakdown | 24 ms |
| topMerchants | 9 ms |
| netPositionTrend (12 month-ends) | 84 ms |
| CSV export (1 month, filtered) | 9 ms |

All aggregation happens in PostgreSQL; result sets are summary-sized (12 flow rows, ≤10
merchants — never the ledger). The browser never receives the full ledger; the transactions
drill-down keeps its existing cursor pagination. `netPositionTrend` is a single pass over
pre-aggregated per-account monthly deltas (no per-month rescans).

## Security & privacy

- Every query derives the user from the session; **filter ids that don't belong to the
  caller fail closed** (`not_found`, revealing nothing) — integration-tested for accounts,
  categories, and cross-user probes in both analytics and exports.
- Exports: per-user rate limiting (429), audit events (counts only, no row contents),
  `cache-control: no-store`, no sensitive data in logs or error messages, and
  malicious-value tests prove hostile descriptions arrive escaped and inert.
- URL parameters cannot widen access: unauthenticated requests redirect via the existing
  guard, and tampered filter ids or `back` values are validated before use.

## Accessibility

- Every chart: named heading, plain-language description, `role="img"` drawing (Recharts'
  redundant focusable layer disabled) and a **Table tab with the same data**; bar lists are
  real HTML lists with real links. Axe (serious+critical = 0) passes on the populated demo
  dashboard and analytics workspace, and the empty-state overview.
- Comparisons are full sentences ("up 12.3% vs the previous period", "New — no previous
  activity"), not color or arrows alone; amounts use tabular numerals via `AmountText`
  (privacy masking preserved); animations are globally disabled under reduced motion (and
  chart animations are off entirely); keyboard: native links/selects/tabs throughout, GET
  form filters, no pointer-only interactions; 360 px viewport has no horizontal scroll.

## Test & verification results (2026-08-17, this machine)

| Gate | Result |
|---|---|
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **270 passed / 270** (27 files) — adds 21 period-math tests, 12 CSV-export contract tests (incl. injection), 5 formula tests, 11 analytics-service tests (splits, refunds, transfers, excluded/pending/deleted, isolation, fail-closed filters), 3 export-service tests (escaping, rate limit, audit, isolation), 5 perf tests over 10k rows |
| Playwright e2e | ✅ **53 passed / 53** — adds 12 dashboard/analytics journeys (period switching, chart+table tabs, filter persistence + reset, MoM and YoY comparisons, drill-down with back-link, CSV download contract, 360px mobile, axe on both populated screens) |
| `npm run build` | ✅ production build succeeds |
| Migrations from empty | ✅ unchanged chain 0000→0007 (Phase 4 adds none); fresh cluster per integration/e2e run |
| `git diff --check` | ✅ clean |

## Known limitations

- Merchant drill-down uses the transactions search box (`q=merchant name`) — matches the
  merchant's transactions via canonical-name search rather than a dedicated merchant filter
  param; a structured merchant filter can arrive with the rules engine (Phase 8).
- The net-position trend always shows all include-in-net-worth accounts (it's account-based);
  category/tag filters intentionally don't apply and the chart says so.
- Custom-range charts group by calendar month (no daily/weekly granularity toggle yet).
- Exports are CSV-only (the approved format); report-PDF export is out of scope.
- The savings-rate chart plots basis points; screen readers get exact percentages from the
  table view.

## Recommended next phase (not started)

**Phase 5 — Budgets and goals** (backlog §1): budget creation per category with the chosen
budget style, progress and variance against the analytics engine's numbers, goals with
funding progress, and the corresponding a11y/isolation/e2e suites.
