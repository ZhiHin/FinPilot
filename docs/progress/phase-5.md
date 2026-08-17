# Phase 5 — Budgets and Savings Goals

**Status:** Complete — all acceptance criteria pass; committed as
`feat: complete phase 5 budgets and savings goals`.
**Date:** 2026-08-17
**Plan:** Master prompt Phase 5 + backlog §1 row 5 + ERD §3/§4/§5 (Phase 5 tables) + ADR-003/-007/-010/-017
+ the Phase 2 reporting rules and Phase 4 analytics engine.

## Schema (migrations 0008 + 0009, forward-only, from-empty verified)

- **0008_planning** (drizzle-generated): enums `budget_mode`, `budget_cycle`,
  `budget_period_status`, `goal_type`, `goal_status`, `goal_contribution_kind`; tables
  `budgets` (mode, cycle_type + jsonb `cycle_anchor`, explicit `currency`, `carry_negative`,
  partial-unique active name per user, payday-anchor check), `budget_periods` (unique
  `(budget_id, period_start)`, `period_end > period_start`, expected income ≥ 0),
  `budget_allocations` (unique `(budget_period_id, category_id)` — the duplicate-allocation
  guard, `planned_minor >= 0`, `rollover_in_minor`, per-category `rollover_enabled`, notes,
  `version` for optimistic concurrency), `savings_goals` (type, `target_amount_minor > 0`,
  explicit currency, nullable target date, priority 1–5 check, set-null linked account,
  jsonb contribution schedule, status, partial-unique name, `deleted_at` reserved),
  `goal_contributions` (signed `amount_minor <> 0`, date, kind, `linked_transfer ⇒
  transaction_id` check, note, `(goal_id, contributed_on)` index).
- **0009_planning_guards** (hand-written, like 0006): `btree_gist` +
  **EXCLUDE-constraint preventing overlapping periods per budget**; triggers enforcing
  ownership (period→budget user, allocation→period user **and** same-user category,
  contribution→goal user, linked account→goal user), **linked-transfer currency must match
  the goal currency**, and **a goal's contribution ledger can never sum below zero**.
- No stored derivables: budget spending comes from the transactions ledger at read time and
  a goal's saved amount is always `Σ contributions` — neither is ever persisted, so neither
  can drift. The one deliberately stored value is `rollover_in_minor`, a **historical
  snapshot computed exactly once** (see rollover rules) — storing it is what makes history
  immutable when past periods are edited later.
- Workflow: `npm run db:generate` → review SQL → `npm run db:migrate` (dev/CI/e2e apply the
  chain 0000→0009 from empty on every run). DBeaver: connect to `localhost:5433/finpilot`
  and verify via `drizzle.__drizzle_migrations` (10 rows) and the `budget*`/`savings_goals`/
  `goal_contributions` tables; DBeaver stays read-only for schema — DDL only via migrations.

## Budget engine (`budgetsService` — the only place budget math lives)

- **Inclusion rules** (identical to the analytics engine): actual spending = posted ∧
  not-excluded ∧ not-deleted expenses minus refunds, **split-aware** (splits count in their
  split category), in the budget's currency only; transfers/adjustments/debt payments never
  count; **pending is computed separately and never reduces Remaining**; uncategorized and
  unbudgeted spending are reported in their own sections, never silently assigned; archived
  accounts naturally remain in history (queries are ledger-wide, not account-filtered).
- **Formulas** (bigint minor units; unit-tested):
  - `Remaining = Planned − Posted spending`
  - `Available with rollover = Planned + Rollover-in − Posted spending`
  - `Usage rate (bp) = Posted ÷ Available` — **null when Available ≤ 0** (shown as "no
    available budget", never a fake percentage)
  - `Rollover-out = max(Available − Posted, 0)`, or the signed value when the budget's
    **carryNegative** flag is on (explicit, user-configurable negative-rollover policy)
  - Zero-based: `Unallocated = Expected income − Σ Planned` — null until income is set
    (prompt, no fake number), negative shown explicitly as over-allocation.
- **Cycles** (`src/lib/cycles`, pure + timezone-aware via the user's stored timezone):
  calendar-month, or payday-to-payday anchored on day 1–28/"last" with **weekend adjustment
  to the preceding Friday** (the approved onboarding pattern; fixtures test Saturday/Sunday
  paydays, "last day" anchors, chaining without gaps). Periods are **lazily created** when
  first visited, inside one DB transaction; the unique + exclusion constraints make
  concurrent creation safe; **future periods are never created** ("the next cycle opens on
  its first day"), which also guarantees rollover is computed only from finished data.
- **Rollover is computed once**: when the next *adjacent* period is created (or when "Copy
  previous period" imports a category), from the previous period's stored allocation and its
  posted spending at that moment; the result is stored on the new allocation and **later
  edits to the old period never rewrite it**. Rollover-mode budgets carry all categories;
  other modes carry only categories with `rollover_enabled`. Non-adjacent (skipped) periods
  carry nothing — documented.
- **Explicit and auditable**: every budget change is a user action with an audit event
  (`budget.created/updated/archived`, `budget_period.created/updated/copied`,
  `budget_allocation.created/updated/deleted`); allocations carry `version` (stale edits get
  a conflict error); creates use a server-generated allocation id as the idempotency key so
  double-submits collapse (the unique index is the backstop). Budgets never change
  themselves when income or spending changes.

## Budget health (deterministic, documented thresholds — never AI)

Ladder, evaluated per category and for the cycle totals, using `elapsedBp` (share of cycle
days passed, inclusive) and `usageBp`:

1. `not_started` — the period hasn't begun.
2. `no_activity` — nothing posted and nothing pending.
3. `exceeded` — posted > available (including available ≤ 0 with any spending).
4. `at_risk` — usage ≥ **90%**, or usage ≥ **20 percentage points** ahead of elapsed.
5. `watch` — usage ≥ **10 points** ahead of elapsed.
6. `on_track` — otherwise.

Categories with spending but no allocation surface as `no_budget` rows. The UI renders every
state as a text badge (never color alone) and labels the logic "a deterministic rule, not a
prediction".

## Goals engine (`goalsService`)

- **Contributions are tracking allocations**: an append-only ledger; recording one never
  moves money, never creates a transaction, never changes balances or net worth
  (integration-tested: net position and transaction count are byte-identical before/after).
  The UI states this in the dialog, the success message, and the page description. A
  contribution may optionally reference one of the user's real transactions as evidence
  (`kind = linked_transfer`, same-currency enforced by trigger). Withdrawals/corrections are
  negative entries that **require a note**, stay in history (never netted away), and can
  never take the ledger below zero (service + DB trigger).
- **Formulas** (unit-tested; the what-if controls call the same `computeGoalOutlook`):
  - `Progress (bp) = Saved ÷ Target` (Saved always derived from the ledger)
  - `Remaining = max(Target − Saved, 0)`
  - `Required monthly = ceil(Remaining ÷ calendar months until target)`; the full remainder
    when the target month is current or past
  - `Estimated completion = today + ceil(Remaining ÷ monthly rate)` calendar months, month
    resolution; **null at rate ≤ 0** (never a fake date)
  - Rate = the goal's planned schedule amount, else the trailing-3-calendar-month average of
    net contributions (documented).
  - Time status: `completed` (saved ≥ target — surfaced, never auto-changing the goal's
    status), `overdue` (date passed), `ahead`/`on_track`/`behind` (estimated month vs target
    month), `no_target_date` (progress only). Zero rate with a live date is honestly
    `behind` with no estimate.
- Status transitions active ↔ paused → completed → archived (+ reactivate) with an explicit
  allowed-transition table; archived goals refuse contributions; history survives every
  transition. Edits to target amount/date recompute the outlook. All goal events audited.

## UI/UX

- **/budget**: first-run create form (mode with plain-language help, calendar/payday cycle,
  payday day + weekend adjustment prefilled from onboarding, currency, negative-rollover
  toggle); workspace with period navigation (past unlimited, future blocked with an honest
  note), summary tiles (Planned + rollover, Spent posted, Remaining, Pending), cycle-health
  line with elapsed %, zero-based unallocated banner (4 states), allocation table (desktop)
  + cards (mobile) showing name/planned/rollover/spent/pending/remaining/usage bar/health
  badge, edit + remove via dialog, copy-previous, period notes & expected income dialog,
  archive with confirmation, unbudgeted-spending and uncategorized sections, category
  drill-down into /transactions carrying the period range and a validated `back` link.
- **/goals**: active/paused/completed/archived views, cards with progress bars, saved/target,
  needs-monthly, estimated completion, deterministic status badges; "contributions never
  move money" stated on the page. **/goals/[goalId]**: milestone markers (25/50/75/100%),
  stat tiles, **what-if controls** (GET form → recompute via the same pure function; applied
  only through an explicit "Apply this plan" submit), status controls, append-only
  contribution history table (allocation/linked-transfer/withdrawal badges). Motivating but
  sober — no confetti, no gamification.
- **Dashboard**: real "Budget this cycle" card (usage bar, health, top-2 at-risk categories)
  and "Savings goals" card (top-priority progress bars, behind-schedule count) — honest
  empty states, links into the workspaces; the Phase 4 layout, filters, drill-downs,
  formulas, currency separation, and analytics pages are untouched.
- Accessibility: labeled progress bars, text badges for every state, FormField label wiring,
  dialogs own their triggers, tables with captions + mobile card alternatives, GET-form
  what-if (no pointer-only interaction), reduced motion globally; axe (serious+critical = 0)
  on populated /budget, /goals, and /goals/[id].

## Security & ownership

Every operation derives the user from the session; budget/period/allocation/category/goal/
account/transaction ids are ownership-validated and fail closed (`not_found`), with DB
triggers as the bypass-proof backstop; cross-user probes are integration-tested for every
entity; multi-record operations (period creation + rollover, copy-previous, all
audit-paired writes) run in DB transactions; duplicate submissions are idempotent
(allocation unique index + client-generated ids; contribution id doubles as the idempotency
key and a replay returns the original result); audit diffs carry structured fields, never
raw statements; error messages never expose database details.

## Test & verification results (2026-08-17, this machine)

| Gate | Result |
|---|---|
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **346 passed / 346** (33 files) — adds 13 cycle-resolver tests (weekend paydays, "last day", chaining, elapsed), 17 budget-formula tests (remaining/available/usage/rollover/negative-rollover/zero-based/health ladder), 11 goal-formula tests (progress/required/estimate/what-if edge cases incl. zero rate, past dates, overshoot), 10 budget integration tests (CRUD, inclusion rules, version guard, period navigation, copy, zero-based, payday cycles, rollover generation + period closing, isolation, audits), 11 goal integration tests (CRUD, no-money-moved proof, withdrawals, idempotent double-submit, linked transfer, transitions, isolation, audits), 8 schema-constraint tests (overlap exclusion, checks, ownership triggers, ledger-floor trigger, cross-currency link rejection) |
| Playwright e2e | ✅ **72 passed / 72** — adds 9 budget journeys (workspace, period nav, edit/create/remove allocation, copy-previous, drill-down + back, mobile cards, axe, fresh-user zero-based flow with expected income) and 10 goal journeys (list + statuses, views, detail + milestones + history, contribution with no-money-moved messaging, withdrawal with reason, what-if + clear + non-mutation proof, pause/resume, create, axe ×2, dashboard cards) — plus the full Phase 1–4 regression suite |
| `npm run build` | ✅ production build succeeds |
| Migrations from empty | ✅ chain 0000→0009 on every integration/e2e run; dev DB at 10 applied |
| Demo seeding idempotent | ✅ CLI re-run: "already present — nothing to do"; seed now includes the payday budget (2 cycles, 5 allocations each) and 3 goals with 13 contributions |
| `git diff --check` | ✅ clean |

## Known limitations

- One-off **mid-cycle plan adjustments are edits with notes** (versioned + audited); a
  dedicated "adjustment with reason" timeline arrives with the Phase 7 suggestion queue.
- Payday adjustment handles weekends only — **no public-holiday calendar** exists in the
  approved scope (no holiday data source); documented as the backlog's cycle-resolver gap.
- The goal projection **band** (uncertainty range) waits for the Phase 7 forecast engine;
  Phase 5 shows a single deterministic estimate, clearly labeled.
- Budget templates beyond "copy previous period" were not in the approved Phase 0
  design/ERD, so no template entity exists.
- Linked-transfer contributions are supported end-to-end in the service/schema and tested,
  but the contribution dialog records allocations only; picking an existing transfer as
  evidence gets UI in a later phase.
- Sinking funds are represented as goal types (purchase/custom), per the ERD (no separate
  entity).

## Recommended next phase (not started)

**Phase 6 — Recurring, subscriptions, and notifications** (backlog §1): recurring-pattern
detection from ledger history, subscription/price-change review, the upcoming-bills
calendar with cluster warnings, BNPL estimates, and the notification centre with dedup
guarantees (`recurring_patterns`, `subscriptions`, `notifications` tables per ERD §5.1).
