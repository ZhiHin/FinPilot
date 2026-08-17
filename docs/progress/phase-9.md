# Phase 9 — Scenario Lab and Decision Journal

**Status:** Complete — all acceptance criteria pass; committed as
`feat: complete phase 9 scenario lab and decision journal`.
**Date:** 2026-08-18
**Plan:** Master prompt Phase 9 + backlog §1 row 9 ("Scenario writes touch no real records
(invariant test); journal exclusions change baselines correctly") + ERD §3/§5.1
(`scenarios`, `scenario_events`, `journal_entries`, `journal_links`) + UX §4.6 (three-part
Scenario Lab) + spec Journeys 4/6/7 + invariants V1/V2.

**The two binding invariants.**
- **V1 — simulation never touches real records:** the engine is pure code; the service's
  `simulate`/`compare` write NOTHING (not even the forecast cache), and saving writes only
  `scenarios`/`scenario_events`. Proven by an integration test that md5-checksums every real
  table (transactions, accounts, budgets, periods, allocations, goals, contributions,
  patterns, categories, forecasts) before and after a full scenario lifecycle — byte-identical.
- **V2 — journal exclusions change baselines correctly:** entries marked one-off remove
  their period from anomaly baselines, budget-suggestion medians, and the forecast's
  non-recurring baseline — proven by two users with byte-identical ledgers where only one
  annotated the one-off period, asserting exact numbers on both sides.

## Schema (migrations 0016 + 0017, chain 0000→0017, from-empty verified)

- **0016_simulation**: `scenarios` (status draft/saved/archived — saving is the explicit
  action; assumptions jsonb; `base_snapshot_at`; soft delete; **partial-unique saved names
  per user among live rows**; name-not-empty check), `scenario_events` (event_type enum:
  one_time_expense · income_change · rent_change · cancel_recurring · add_installment ·
  savings_change · emergency_expense; signed bigint minor amount; refs/params jsonb),
  `journal_entries` (kind life_event/decision/note; period with `ends_on >= starts_on`
  check; `exclude_from_baselines`; expected_outcome jsonb; review_on + outcome_review;
  soft delete), `journal_links` (entity_type check ∈ transaction/category/
  recurring_pattern/scenario; **unique (entry, entity_type, entity)**).
- **0017_simulation_guards**: triggers — scenario events must belong to their scenario's
  user; journal links must belong to their entry's user (cross-user attachment impossible
  even bypassing the service layer; both directions tested).

## Simulation engine (`lib/intel/scenario.ts` — pure, unit-tested)

Events transform the projected occurrence list, then the SAME
`computeCashFlowForecast` (Phase 7, method `recurring+baseline` v1) runs for baseline and
scenario — so band ordering (B2) holds for every scenario by construction, and the
scenario's dashed baseline IS the Overview projection. Documented semantics: one-time /
emergency = single confirmed outflow; income_change = signed monthly delta on projected
inflows (all income or one pattern) floored at zero; rent_change = new amount for one
pattern from the date; cancel_recurring drops a pattern's future occurrences;
add_installment = N confirmed monthly outflows (BNPL/loan); savings_change = signed
monthly cash set aside (goal contributions never move real money — Phase 5 invariant,
restated in the UI assumptions). `earliestSaferDate` generalizes the Phase 8 affordability
rule (suffix minima over the conservative path vs the safety buffer), asked of the
scenario *without* its largest purchase. Input gathering was extracted to
`gatherForecastInputs` (intel service), shared verbatim by the cached Overview forecast
and the never-caching simulation.

## Scenario Lab surfaces (UX §4.6)

- `/scenarios`: list with status badges + "based on data as of", explicit **New scenario**
  (creates a draft, lands in the editor), compare picker (A vs B) once two are saved.
- `/scenarios/[id]`: the three-part layout — **inputs left** (typed event forms with
  pattern/category/goal pickers, ownership-validated fail-closed), **projection centre**
  (chart-kit band chart: solid expected, translucent optimistic–conservative band, dashed
  baseline; weekly table alternative), **impact right** (lowest expected vs baseline with
  dates, buffer warning, end-of-horizon delta, earliest safer purchase date, affected
  goals via `computeGoalOutlook` rate math, current-cycle budget risk vs remaining
  allocation, assumptions drawer, explicit save with unsaved-changes guard
  (beforeunload while the name is dirty), delete, "Ask AI about this" link).
- `/scenarios/compare?a&b`: one shared chart (baseline + both expected paths) over two
  impact columns.

## Decision Journal (spec feature 5, Journeys 6–7)

`/journal` (secondary nav / command menu / More — not primary): entries with kind, period,
context, **"Mark as one-off"** exclusion toggle (with a plain-language explanation of
exactly what it does and does not touch), expected monthly saving + review date for
decisions, optional link to a saved scenario, transaction links (service + schema),
soft delete. **Outcome reviews**: when `review_on` arrives, the entry surfaces in
"Outcome reviews due" — verdict happened/partly/no + note recorded append-style into
`outcome_review` (audited). Baseline consumers explain themselves: affected insights carry
"December-style" notes — e.g. *"Wedding season (RM 3,200.00, marked one-time) was excluded
from your baseline"* — in body, data-quality, and evidence payloads.

Exclusion mechanics (documented): consumers re-sum history windows through the SAME
`analyticsService.categoryBreakdown` over the non-excluded segments (`lib/intel/
exclusions.ts` does the interval math), so exclusion can never drift from the reporting
rules. **Fully excluded windows are dropped from the sample** — never counted as fake
zero-spend periods (anomaly keeps its min-samples guard; budget suggestions require ≥2
clean cycles). The forecast's trailing-12-week baseline skips excluded days, and the
journal fingerprint joined the forecast `inputs_hash`, so annotating invalidates cached
projections (tested).

## Demo data

The seed gained the Journey 7 fixture: a travel cluster (flights + hotel, RM 2,140, ~6
months back) with a "Travel — family wedding" journal entry excluding that week — fresh
databases (CI, e2e, new checkouts) demonstrate annotated baselines out of the box.
Idempotence unchanged ("already present — nothing to do").

## Test & verification results (2026-08-18, this machine)

| Gate | Result |
|---|---|
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **491 passed / 491** (48 files) — adds 14 engine tests (per-event occurrence math, immutability, exact one-time delta, band ordering under stacked events, lowest-point shift, safer-date incl. no-safe-day), 7 exclusion-interval tests, 5 schema-constraint tests (enums, checks, live-only unique saved names, link uniqueness, both ownership triggers), 11 scenario-service tests (baseline identity, hand-computed purchase/safer-date/budget-risk/goal-shift numbers, explicit save + duplicate-name refusal, compare over one baseline, **V1 checksum invariant**, archive/delete, isolation), 13 journal tests (**V2 two-user baseline proofs with exact numbers for budget suggestion, anomaly, and forecast + cache invalidation**, CRUD, review-due flow, idempotent links, exclusion-window shape, soft-delete effect, isolation) |
| Playwright e2e | ✅ **113 passed / 113** — adds 8 journeys (Journey 4 build→inspect→save with **real-records-untouched assertion** (byte-identical accounts page), band chart + baseline table alt, safer-date sentence, compare A-vs-B columns, seeded Journey-7 annotation visible, decision entry → due review → outcome recorded, delete permanence, axe on scenarios/editor/journal + mobile 360px) — plus the full Phase 1–8 regression (shell spec now asserts no placeholders remain) |
| `npm run build` | ✅ production build succeeds |
| Migrations from empty | ✅ chain 0000→0017 on every integration/e2e run; dev DB at 18 applied |
| Demo seeding idempotent | ✅ re-run: "already present — nothing to do" |
| `git diff --check` | ✅ clean |

## Known limitations

- Scenario events are add/remove (no in-place edit form); the editor recomputes on every
  change, so remove-and-re-add is equivalent. Journal entries likewise get create/delete/
  outcome UI (the update service path exists and is tested).
- Fully excluded partial-window months contribute their remaining (non-excluded) days'
  spending — a month annotated wall-to-wall is dropped from samples entirely. Excluded
  days inside the forecast's trailing window count as no-spend days in their week; the
  robust median absorbs this by design.
- Affected-goal math covers savings_change deltas and buffer-dip contribution risk;
  it does not attempt to attribute one-time purchases to specific goals beyond the dip
  warning (deterministic rules only, stated in the assumptions drawer).
- The transaction-drawer "annotate from here" shortcut is not wired; transactions are
  linked from the journal service/API, and period annotation (the V2 mechanism) is fully
  covered in the UI.
- Dev-only React key warning ("CardContent … from ScenarioEditorPage") matches the
  pre-existing OverviewPage warning from the same chart-kit composition pattern (present
  since Phase 7's shipped gates); it does not occur in production builds.

## Recommended next phase (not started)

**Phase 10 — Hardening and release readiness**: security review (incl. the recorded RLS
reconsideration, ADR-010), performance profiling, accessibility pass, responsive polish,
data export/deletion (staged purge), backup/restore documentation, observability,
deployment configuration, final regression, and the Production V1 acceptance checklist
(incl. PDPA items).
