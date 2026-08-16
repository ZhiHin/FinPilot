# Phase 2 — Accounts, Categories, and Transactions

**Status:** Complete and conditionally approved; checkpoint-review fixes applied and verified, then committed and pushed.
**Date:** 2026-08-16
**Plan:** Phase 2 implementation plan (approved scope) + `docs/phase-0/07-phase-1-backlog.md` §1 + ERD doc §5.1.

## Completed functionality

- **Accounts:** nine manual account types with currencies (MYR/SGD/USD, never converted or mixed),
  opening/computed balances (pending shown separately), credit limits, colors/net-worth inclusion,
  archive/unarchive (history preserved), delete only when empty; account list with per-currency net
  position (assets/liabilities/net/liquid) and detail screen with **statement reconciliation**
  (snapshot + optional adjustment transaction, atomic).
- **Classification:** per-user Malaysian default category template (10 groups / 38 categories,
  seeded idempotently at sign-up and on demand), custom groups/categories with case-insensitive
  per-group uniqueness, archive cascades, tags, and **merchant normalization** (deterministic
  key/canonical-name heuristics, alias collection, per-merchant default category) — originals
  always preserved on the transaction. Managed at `/settings/categories` (route-map addition,
  recorded in the UX doc).
- **Transactions:** manual income/expense/refund/adjustment/debt-payment entry (sign derived from
  type), linked double-entry **transfers**, **splits** (sum-exact, partly reimbursable),
  **refund-to-purchase** and **possible-duplicate** links (duplicate ⇒ excluded, undoable),
  pending/posted + excluded + needs-review states, edit with optimistic versioning, soft delete /
  restore (transfer legs travel together), search (description/merchant), filters (account,
  category, type, status, tags, dates), saved views (All/Needs review/Pending/Excluded/Deleted),
  date and amount sorts, **keyset pagination**, per-currency summary bar with the documented
  reporting rules, desktop table + responsive mobile cards, edit drawer with splits editor,
  relationships, and **audit history**, bulk categorize/review/exclude (fail-closed).
- **Onboarding steps 2–3 activated:** monthly payday pattern (`income_pattern`) and quick-add
  accounts. **Overview** now shows real liquid balance, net worth, and month-to-date income/expense.
- **Demo data:** deterministic, idempotent Aisyah dataset — 7 accounts, ~925 transactions across 8
  full months, salary/rent/subscriptions (Spotify price change), BNPL installments, annual
  insurance, travel-cluster month, exact-duplicate pair, linked refund, split, adjustment, 3
  pending, 4 needs-review, and the final-month food-delivery step-up that will power the canonical
  “+23%” insight.

## Schema changes (forward-only migrations 0004–0006)

`0004` pg_trgm extension · `0005` generated ledger schema — 12 tables per ERD §5.1
(`accounts`, `account_balance_snapshots`, `merchants`, `category_groups`, `categories`, `tags`,
`transaction_tags`, `transactions`, `transaction_splits`, `transaction_links`,
`categorization_rules`, `attachments`) with 10 enums, sign/nonzero/credit-limit/confidence checks,
partial case-insensitive unique indexes, keyset/search indexes · `0006` invariant triggers
(account-currency+ownership match; **deferred split-sum constraint triggers on both splits and
parent amount**; link validation). `categorization_rules`/`attachments` are schema-only this phase
(FK targets); `transactions.import_row_id`/`import_content_hash` land with Phase 3 per ADR-017.

## How each financial invariant is enforced

1. **Transfers never count as income/expense** — reporting queries aggregate strictly by type
   (income / expense / refund only); enforced in `transactionsService.summary` and account
   balances; e2e shows an unchanged summary across a transfer; integration compares summaries
   before/after.
2. **Equal-and-opposite linked legs** — `createTransfer` writes both legs + link in one DB
   transaction; the `transaction_links` trigger rejects any transfer pair that isn’t
   equal-and-opposite, same-currency, transfer-typed (proven by raw-SQL attempts); legs refuse
   amount edits and delete/restore together.
3. **Splits sum exactly** — deferred constraint triggers validate at COMMIT from both directions
   (split rows and parent amount); the service performs split replacement inside the same
   transaction; raw-SQL violation attempts fail at commit; a service-level mismatch rolls back the
   parent too (tested).
4. **Refunds never double-count** — refunds are sign-checked positive, reported as expense
   *reductions*, never income (`summary` subtracts refunds from gross expense); tested with a
   linked purchase/refund pair netting to zero.
5. **Pending/excluded follow documented rules** — rules documented in
   `src/server/services/transactions.ts` and surfaced in the UI: reports = posted ∧ ¬excluded ∧
   ¬deleted; balances = posted ∧ ¬deleted (excluded included); pending reported separately; deleted
   nowhere. Integration test asserts every branch.
6. **Archived records preserve history** — archive is a status flag; transactions are untouched
   (tested); accounts with any history can’t be deleted; category/group archiving never breaks
   references (FKs are NO ACTION/SET NULL, never cascade-delete of financial rows).
7. **Signed bigint minor units only** — all money columns are `bigint` minor units;
   `assertSafeMinor` guards service edges; parsing/formatting only via `lib/money` (integer math);
   float-shaped APIs are lint-banned; DB sign checks per type.
8. **No silent cross-currency aggregation** — every aggregate GROUPs BY currency and returns
   per-currency maps with no combined total (tested for shape); the account-currency trigger pins
   each row’s currency to its account; cross-currency transfers and account moves are rejected;
   UI renders per-currency sections/badges.
9. **Multi-record atomicity** — transfers, splits, refund/duplicate links, paired delete/restore,
   reconciliation (snapshot+adjustment), and bulk ops run in `db.transaction`; rollback is proven
   by the split-mismatch test (no parent persists) and the reconciliation-replay test (unique
   violation leaves no stray adjustment).
10. **Cross-user isolation** — every service call takes the session `user_id`; every foreign id in
    a payload (accounts, categories, tags, counterpart transactions, bulk id lists) is verified
    owned, **fail-closed** (one foreign id rejects the whole operation); the DB currency trigger
    additionally rejects transactions on accounts the user doesn’t own; the link trigger rejects
    cross-user links. Integration proofs cover read/update/delete/archive, tampered payload ids,
    bulk lists containing another user’s ids, and list leakage for every entity.

## Test & verification results (2026-08-16, this machine)

| Gate | Result |
|---|---|
| Migrations from empty | ✅ Fresh embedded cluster migrated 0000→0006 on every integration and e2e run; dev DB at 7 applied migrations |
| Demo seeding idempotent | ✅ Test-proven (second run is a no-op, counts unchanged) + CLI re-run on dev: “already present — nothing to do” |
| `npm run format:check` / `lint` / `typecheck` | ✅ all clean (strict TS, 0 warnings) |
| Vitest (unit + components + integration) | ✅ **172 passed / 172** — includes 18 ledger-schema tests (raw-SQL invariant attempts), 18 reference-domain tests, 27 transactions-service tests, 6 demo-dataset tests, all Phase 1 suites |
| Playwright e2e | ✅ **37 passed / 37** — Phase 1 journeys plus: account creation & net position, expense with merchant/category, transfer neutrality on screen, split editing with audit history, review workflow with bulk clear, delete/restore round-trip, demo-data pagination, 7-account demo positions, mobile-360 card layout; **axe: no serious/critical violations** on accounts, transactions (with data), account detail, categories settings, and all Phase 1 screens |
| `npm run build` | ✅ production build succeeds (all routes dynamic, proxy registered) |

## Checkpoint-review fixes (added before commit, all verified)

- **Tag filter UI** (was a gap vs the Phase 0 filter-row spec): `tags` URL parameter + a Tag
  select in the filters bar; integration assertion on the service filter **surfaced and fixed a
  real bug** (the tag EXISTS clause passed a JS array that node-postgres can't serialize as a PG
  array — replaced with a parameterized IN list); new e2e journey creates a tag, tags a
  transaction, and filters by it.
- **Refund/duplicate pickers now search the whole ledger**: a `LinkPicker` with server-side search
  (top-20 results) replaces the page-limited selects; current-page candidates remain the initial
  options.
- **Merchant management search**: search box (with `?tab=`/`?mq=` URL state) plus an explicit
  "showing first 100 of N" notice — the previous silent cap is gone.
- **Seeds are development-only by construction**: seed scripts refuse to run when `NODE_ENV` is
  production or the database host is non-local, unless `ALLOW_REMOTE_SEED=yes` is set
  deliberately (`scripts/lib/env.ts`). The app itself never triggers seeding at runtime; the demo
  user exists only where a seed was run.
- Removed a leftover local debug log (`pw.txt`) that was never tracked.

## Known limitations

- Amount-range filter and CSV export of the filtered list are deferred (export belongs to Phase 4
  reports per the master prompt).
- The transactions filter selects choose one account/category/tag at a time (the URL accepts
  comma-separated ids for power users).
- One Phase 1 test was updated (schema table-count assertion) because the schema legitimately grew —
  the exhaustive whole-schema assertion now lives in the ledger schema suite.
- The WebKit/Firefox browser matrix, pixel-perfect visual diffs, and 10k-row performance
  assertions remain for Phase 4/10 as planned.

## Recommended Phase 3 scope (not started)

**CSV import and data quality** (backlog §1, ERD §5.1): migrate `import_profiles`, `import_jobs`,
`import_rows` (+ pg-boss job schema and `transactions.import_row_id`/`import_content_hash`); the
six-step wizard (Upload → Map → Review → Resolve → Confirm → Results) with encoding/delimiter
detection, reusable mapping profiles (starter profiles for Maybank/TnG/generic debit-credit
formats from synthetic fixtures), duplicate detection via content hashes, **idempotent commit**
(idempotency keys, nothing written before Confirm), an undo window, and the hostile-file test
suite. Exit criteria: re-run/retry never duplicates (spec §6 C5); nothing commits pre-confirm;
import summary counts reconcile.
