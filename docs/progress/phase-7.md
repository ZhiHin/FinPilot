# Phase 7 — Deterministic Intelligence

**Status:** Complete — all acceptance criteria pass; committed as
`feat: complete phase 7 deterministic intelligence`.
**Date:** 2026-08-17
**Plan:** Master prompt Phase 7 + backlog §1 row 7 ("STS itemization equals ledger math; bands
monotone; zero LLM calls") + ERD §3/§5.1 (`forecasts`, `insights`, `insight_evidence`) +
architecture doc §6 (binding STS definition, three-layer AI architecture) + ADR-011/-015 +
spec B1/B2/B3.

**Zero LLM calls.** Everything in this phase is deterministic code over the user's own
ledger — the entire feature set works identically in Privacy Mode (ADR-011). The insights
page says so explicitly.

## Schema (migrations 0012 + 0013, chain 0000→0013, from-empty verified)

- **0012_intel**: `forecasts` (the ADR-015 derived-result cache: kind enum, jsonb scope,
  horizon check ∈ {30,60,90}, documented method id + version, series jsonb, **unique
  (user, kind, inputs_hash)**, expiry), `insights` (open-set type, severity, deterministic
  template body, period checks, comparison jsonb with verified numbers, confidence bp check,
  data-quality jsonb, `generated_by` defaulting to deterministic with model/prompt columns
  dormant until Phase 8, status enum, **unique (user, dedup_key)** for idempotent
  generation), `insight_evidence` (typed payloads of verified numbers only, display order).
- **0013_intel_guards**: trigger — evidence must belong to its insight's user.
- Recorded ERD deviation (same as Phases 6): confidence stored as integer basis points.

## Safe-to-Spend (the binding definition, architecture doc §6)

`STS_until_payday = liquid + expected_income_by_payday − confirmed_bills − predicted_bills −
budget_committals − goal_contributions_due − safety_buffer`, per band; `STS_today = band ÷
days_to_payday` with bills front-loaded. Implementation notes (all documented in
`lib/intel/sts.ts` and unit-tested):

- **Itemization = ledger math** (backlog acceptance): the expected band equals the sum of
  its breakdown terms exactly — asserted in unit and integration tests against hand-computed
  fixtures.
- **Band rules:** conservative counts only user-confirmed income and pads every bill by its
  tolerance; optimistic adds income tolerance and trims inferred bills; committals, goal
  dues, and the buffer are constant. Ordering holds by construction (B2).
- **Range rendering (B1):** when bands diverge (any inferred income/bill), the meter shows
  the conservative–optimistic range explicitly. Negative STS renders honestly as negative.
- Term gathering: liquid from account balances (preference currency); income/bills from
  active recurring patterns due inside [today, payday−1] (payday from the onboarding
  pattern, weekend-adjusted; documented month-end fallback without one); **budget committals
  exclude categories already reserved by a counted bill** (no double reservation); goal dues
  = monthly schedule minus this month's contributions; buffer from preferences.
- The Overview meter's "Why this number?" drawer itemizes every term (native `<details>` —
  keyboard/SR accessible with zero JS).

## Cash-flow forecast (spec A16 — transparent statistics, no ML)

Method `recurring+baseline` v1 (id + version stored on every cached row): active recurring
patterns projected forward (confirmed vs inferred handled per band) plus a robust
non-recurring daily baseline from trailing 12 weeks of posted spending with
recurring-attributed charges removed (same series keying as the detector): expected =
median week ÷ 7, conservative = P75 ÷ 7, optimistic = P25 ÷ 7. Bands are **monotone by
construction every single day** (B2, tested). 30/60/90-day horizons on the Overview with the
design-doc band rendering (solid slot-1 expected line, translucent same-hue band), a table
alternative, and the lowest expected/conservative points. **Cached per ADR-015** in
`forecasts` keyed by an inputs hash over ledger + pattern fingerprints — cache hits are
tested, and any ledger change recomputes (tested); the cache is never the source of truth.

## Insights (deterministic producers, deduplicated, evidence-backed)

Every card carries the full B3 anatomy: conclusion, comparison period, contributors,
absolute + % change, confidence (High/Medium/Low text from bp), data-quality warnings
(e.g. "Excludes N pending transaction(s)"), an expandable **"How this was calculated"**
evidence drawer (typed payloads: category_delta, merchant_delta, aggregate, calculation),
and actions (open the transactions behind it / review in Budget / review bills). Producers:

- **spend_change** (Journey 3's canonical card): last complete month vs the month before,
  per category — alerts at ≥20% AND ≥RM 100, top-2 by delta, merchant contributors computed
  from both windows.
- **anomaly**: robust z-score (median/MAD ×1.4826, documented fallback at zero variance)
  against six complete months of the user's own baseline; needs z ≥ 3 AND ≥RM 100; increases
  only; skips categories already covered by spend_change that month.
- **low_balance** (resilience warning): the 30-day conservative band dipping under the
  safety buffer (risk severity below zero); evidence carries both lowest points and the
  method id.
- **budget_suggestion** (deterministic — the AI Beta table row for Phase 7): per allocated
  category, the median of the last three cycle windows vs the plan; suggests the rounded
  median when they drift ≥ max(10%, RM 50). Persisted as insights (recorded decision: the
  ERD's `insights.type` is an open set; `ai_suggestions` remains reserved for Phase 8's
  AI-drafted actions). Surfaced as the Budget screen's SUGGESTIONS panel (UX §4.3) with
  explicit **Approve** (an audited allocation update via the existing versioned path,
  insight → actioned) and **Dismiss** — nothing ever changes by itself.
- **Dedup**: unique (user, dedup_key); regeneration is a no-op (tested); dismissed insights
  never return (tested); generation is stale-guarded (~12h) on dashboard/budget loads and
  runs fresh on the Insights page.

## Surfaces

Overview gained the STS meter (primary position), the projected-balance band card with
horizon toggle, and the top insight card. `/insights` replaced its placeholder with the
deterministic insight list (honestly labeled: AI phrasing + assistant arrive in Phase 8).
The Budget screen gained the suggestions panel. Existing Phase 4–6 surfaces are unchanged
(full regression green).

## Fixed en route (found by Phase 7's B1 math)

`recurringService.scan` passed node-postgres bigint strings into the amount analysis;
`median()` string-concatenated on even-length series, ballooning tolerances (a stable
8×RM 5,200 salary got an RM 2.6 billion tolerance — absurd optimistic STS bands surfaced
it). Amounts are now coerced at the ingestion boundary; a regression test pins the 10%
tolerance floor on an even-count stable series. Also fixed: a WIN1252 client-encoding
failure on U+2212 in evidence payloads (ASCII formulas now), and unkeyed server-rendered
arrays inside client-component props (forecast footer unrolled to static children).

## Test & verification results (2026-08-17, this machine)

| Gate | Result |
|---|---|
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **415 passed / 415** (41 files) — adds 6 STS-core tests (itemization identity, band ordering, range trigger, negative honesty, window edges), 12 forecast/anomaly-core tests (projection, percentile baselines, daily monotone bands, exact arithmetic, lowest points, robust-z gating incl. zero-variance and min-history), 6 intel integration tests (term gathering incl. committal de-overlap and goal dues, cache hit/invalidate across horizons, all four producers with evidence shapes and exact deltas, dedup idempotence, dismissal permanence, isolation incl. empty-ledger STS), 5 schema-constraint tests, 1 recurring regression (tolerance floor) |
| Playwright e2e | ✅ **96 passed / 96** — adds 9 intel journeys (why-drawer itemization + range, forecast band card with horizon toggle and 3-band table, top-insight surfacing, canonical spend-change card with B3 anatomy + merchant evidence, drill-down with back-link, dismissal permanence, suggestion approve flow, mobile 360px, axe on /insights) — plus the full Phase 1–6 regression |
| `npm run build` | ✅ production build succeeds |
| Migrations from empty | ✅ chain 0000→0013 on every integration/e2e run; dev DB at 14 applied |
| Demo seeding idempotent | ✅ unchanged ("already present — nothing to do") |
| `git diff --check` | ✅ clean |

## Known limitations

- STS and the forecast compute for the preference currency only (documented; other
  currencies' accounts simply aren't in the liquid figure — never silently converted).
- Forecast granularity is daily with month-clamped recurring projection; goal-projection and
  category-spend forecast kinds are schema-ready but unproduced until Scenario Lab needs
  them (Phase 9).
- Journal-based baseline exclusions (spec V2, "mark December travel one-off") arrive with
  the Decision Journal in Phase 9 — baselines currently use all posted history.
- Insight generation is request-time (stale-guarded + cached), not a background job; the
  pg-boss queue remains available if generation cost ever warrants it (documented).
- Digest/email delivery of insights stays post-V1 with the rest of email.

## Recommended next phase (not started)

**Phase 8 — Explainable AI and assistant**: the `AIProvider` abstraction with the first
adapter selected via configuration (ADR-012), category suggestions (rules + scorer,
ADR-013), LLM phrasing over these verified insight facts (B5 golden fixtures), the
assistant over strict typed tools with prompt-injection defenses (B7), the suggestion/action
queue (`ai_suggestions`, `ai_feedback`, `ai_requests`), Privacy-Mode enforcement at the
gateway (B6), and AI evaluations.
