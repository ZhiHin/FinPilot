# Phase 6 — Recurring, Subscriptions, and Notifications

**Status:** Complete — all acceptance criteria pass; committed as
`feat: complete phase 6 recurring subscriptions and notifications`.
**Date:** 2026-08-17
**Plan:** Master prompt Phase 6 + backlog §1 row 6 ("Detection precision on seed fixtures;
price-change evidence; dedup + quiet hours") + ERD §3/§4/§5 + UX doc §4.5 + spec A12 (BNPL
estimates) / C9 (notification dedup, thresholds, quiet hours).

## Schema (migrations 0010 + 0011, forward-only, from-empty verified — chain 0000→0011)

- **0010_recurring** (drizzle-generated): enums `recurring_direction/frequency/source/status`,
  `subscription_status`, `notification_severity`; tables `recurring_patterns` (merchant/
  category/account set-null FKs, positive typical amount, tolerance ≥ 0, `next_expected_on`
  indexed per user, installment fields with an observed ≤ total check, **partial-unique
  `(user_id, inference_key)` — the detector's idempotency guarantee**), `subscriptions`
  (**unique 1:1 pattern extension**, positive price, previous price + `price_changed_at` +
  evidence counts + acknowledge timestamp, user-stated `usage_confirmed_at`), `notifications`
  (**partial-unique `(user_id, dedup_key)` where not dismissed — the ERD dedup guarantee**,
  unread partial index, jsonb `data` deep links + email-ready `delivery` shape).
- **0011_recurring_guards** (hand-written): ownership triggers — a pattern may only reference
  the owner's merchant/category/account; a subscription must belong to its pattern's user.
- **Recorded ERD deviation:** `confidence` is stored as integer basis points
  (`confidence_bp`, 0–10000) instead of `numeric 0..1` — consistent with the codebase-wide
  integer-math discipline (ADR-003). Noted in ERD §5.1.

## Detection engine (deterministic — documented rules, never a prediction)

`src/lib/recurrence` (pure, unit-tested) + `recurringService.scan`:
- **Inputs:** posted ∧ not-excluded ∧ not-deleted transactions from the last 13 months;
  outflows = expenses + debt payments, inflows = income; transfers/refunds/adjustments never
  form patterns. Series key = merchant id (or the digit-stripped, uppercased description) +
  currency + direction; same-day duplicates collapse.
- **Frequency bands:** weekly 6–8d, biweekly 12–16d, monthly 27–33d, quarterly 84–98d,
  annual 350–380d; the median interval must sit in a band, ≥80% of intervals too; minimum
  three occurrences (two for annual). Anything else is not recurring.
- **Amounts:** typical = the latest charge; its trailing run = consecutive charges within 2%;
  a **price change needs ≥2 charges at the new level and ≥2 at the old, ≥5% apart** — a
  single odd charge is never a price change. Tolerance = max(10%, observed run spread),
  widened to the full spread for unstable series.
- **Confidence (bp):** 4000 + 500×min(occurrences, 8) + regularity bonus (2000 if intervals
  deviate ≤2 days, 1000 if ≤4) + 1000 if amounts stable, **capped at 9500 — only the user's
  own confirmation reaches 10000**. Rendered as High (≥80%) / Medium (≥65%) / Low text.
- **Next expected:** last seen + one cycle (month-clamped), rolled forward to today or later
  (missed-occurrence surfacing is Phase 7 anomaly territory — documented, not backfilled).
- **Idempotent upsert** by inference key: rescans never duplicate. **User-confirmed patterns
  keep their user-owned fields** (name, amounts, tolerance, category, installment total) —
  scans refresh observations only. **Patterns the user ended are never resurrected.**
  Inferred series that stop appearing are closed out (`ended`).
- **BNPL/installments** (spec A12): keyword-flagged (INSTAL/PAYLATER/ATOME/BNPL); shown as
  "N observed — total unconfirmed (estimate)" until the user sets the total (validated ≥
  observed), then "N of M — K left". Never presented as verified debt.
- **Subscriptions:** monthly/annual outflows in the "Streaming & subscriptions" category gain
  the 1:1 extension automatically; any pattern can be marked/unmarked manually. Price changes
  update the subscription with evidence counts ("RM 16.90 ×5 → RM 23.90 ×2") and reset the
  acknowledge flag. Usage is **user-stated only** ("I still use this"). We never claim to
  cancel anything for the user.

## Notification centre (in-app; email-ready architecture, no email delivery)

`notificationsService.generate` — idempotent, run on page visits and after scans:
- **Producers** (each deterministic, each with a dedup key): bill clusters (≥3 dues within 5
  days in the next 14 — key `bill_cluster:<start>`), large upcoming bills (≥ the user's
  threshold, default RM 500 — key includes pattern + due date), subscription price changes
  (until acknowledged — key includes the new price so a further change re-notifies),
  budget-pace (at-risk/exceeded categories — key includes allocation + period + state),
  goals behind schedule (monthly cadence key), possible duplicate services (documented
  name-group map: cloud storage / music / video).
- **Dedup guarantee (C9):** at most one live notification per (user, key) — DB partial unique
  index; **a dismissed key is never re-created** (service checks all history); genuinely new
  events carry new keys. Integration-tested: double generation creates nothing; dismissal
  survives regeneration and reloads.
- **Quiet hours:** generation checks the user's local time (their stored timezone) against
  the configured window (midnight-crossing supported); inside the window nothing is created —
  the next generation outside it catches up. **Thresholds + per-type switches + quiet hours**
  live in `/settings/notifications` (large-bill amount, six type toggles, digest cadence
  stored for post-V1 email).
- Deep links are validated same-app paths (`safeHref`) — hostile hrefs render as no link
  (tested). Read/dismiss/mark-all are user-scoped; severity is text + variant, never color
  alone. No badge counters — anxiety-aware defaults per the UX doc.

## UI/UX

- **/recurring** (placeholder replaced): List/Calendar toggle; All·Confirmed·Inferred·
  Subscriptions·BNPL filters; next-14-days cluster banner; table (desktop) + cards (mobile)
  with type badges, amount ± tolerance, next due, annual cost, confidence text; price-change
  evidence rows with Acknowledge + usage check-in; row actions confirm / pause / resume /
  not-recurring / mark-as-sub; edit dialog (name, amount, tolerance, next date, BNPL total —
  "editing confirms"); Rescan button; first visit auto-runs the scan. **Calendar**: a real
  `<table>` month grid (axe-clean), bills per day with amounts, payday chip (weekend-adjusted
  from the onboarding pattern), month navigation; the List view is its text alternative.
- **/notifications** (placeholder replaced): unread/earlier sections, severity labels,
  Open deep links, mark read / dismiss / mark-all-read, honest empty state, link to settings.
- **Dashboard:** real "Upcoming bills" card (next 5 dues with inferred/installment labels +
  cluster warning) joining the budget and goals cards; Phase 4/5 surfaces untouched.
- **Demo seed** (still idempotent): persona payday pattern added to preferences; bills whose
  day already passed post in the current month (so next dues land realistically next month,
  with the Sep 1–5 rent/fitness/unifi cluster); BNPL rebuilt as 4 observed payments (story:
  user confirms 6 total → 2 remaining); the Spotify price step remains the evidence fixture.

## Test & verification results (2026-08-17, this machine)

| Gate | Result |
|---|---|
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **388 passed / 388** (37 files) — adds 18 recurrence-lib tests (normalization, frequency bands, next-date clamping, price-change evidence, single-odd-charge rejection, confidence, clusters, quiet hours incl. midnight crossing), 11 detection-service tests (fixture precision incl. "nothing else detected", idempotent rescans, confirmed-field protection, BNPL totals, never-resurrect, subscription mark/usage, upcoming/clusters, isolation, audits), 7 notification tests (producer dedup ×2 runs, dismissed-never-returns, quiet-hours suppression, type switches, read/dismiss/isolation, hostile deep links), 6 schema-constraint tests |
| Playwright e2e | ✅ **87 passed / 87** — adds 10 recurring journeys (detection on seed, price-change evidence + acknowledge, BNPL estimate → confirmed total, confirm pattern, filters, calendar with payday marker, never-resurrect, mobile cards, axe ×2, dashboard card) and 5 notification journeys (alerts with severities, dismiss permanence across reloads, mark-all-read, settings round-trip, axe) — plus the full Phase 1–5 regression |
| `npm run build` | ✅ production build succeeds |
| Migrations from empty | ✅ chain 0000→0011 on every integration/e2e run; dev DB at 12 applied |
| Demo seeding idempotent | ✅ CLI re-run: "already present — nothing to do" |
| `git diff --check` | ✅ clean |

## Known limitations

- Detection needs ≥3 occurrences (2 for annual): brand-new bills appear only after enough
  history; users can't hand-create a pattern from nothing yet (the `custom` frequency enum
  is reserved for that) — editing any detected pattern covers correction.
- The cancellation checklist + savings simulation from the UX mock lean on Scenario Lab
  (Phase 9); the Recurring screen states we never cancel for the user, and evidence rows
  cover the audit story.
- Missed-bill surfacing ("expected on X, not seen") is deferred to the Phase 7 anomaly
  engine; next-expected dates roll forward silently (documented in the service).
- Quiet hours defer creation rather than queueing a delivery time — correct for in-app;
  revisit when email delivery lands (post-V1).
- Digest frequency is stored and shown but produces nothing until email delivery exists
  (post-V1) — the settings screen says so.

## Recommended next phase (not started)

**Phase 7 — Deterministic intelligence** (backlog §1): the intelligence schema (`forecasts`,
`insights`, `insight_evidence`), Safe-to-Spend with itemized reservations, 30/60/90-day
cash-flow forecasts with monotone optimistic/expected/conservative bands, anomaly baselines,
deterministic budget suggestions, and resilience warnings — all with zero LLM calls.
