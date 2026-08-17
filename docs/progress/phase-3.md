# Phase 3 — CSV Import and Data Quality

**Status:** Complete — checkpoint review passed with fixes (below); committed as
`feat: complete phase 3 CSV import workflow`.
**Date:** 2026-08-17
**Plan:** Phase 3 implementation plan (approved scope) + backlog §1 + ERD doc §5.1 + ADR-006/ADR-017.

## Completed functionality

- **Upload:** multipart CSV upload (`POST /api/imports`) with 5 MB / 20,000-row / 40-column caps,
  extension + content sniffing (NUL-byte binary rejection), sanitized filenames, per-user upload
  rate limit (audit-backed, 30/hour), and 303 redirects into the wizard. **The uploaded file is
  parsed in memory and discarded** — only job metadata and per-row cell data are stored (exactly
  what review, auditing, and undo require), per the retention instruction.
- **Encoding & delimiter detection:** BOM-aware UTF-8/UTF-16LE/BE plus a windows-1252 fallback for
  legacy bank exports; comma/semicolon/tab/pipe detection; a dependency-free RFC-4180-ish parser
  (quotes, escaped quotes, embedded newlines, CRLF, junk-line tolerance) with caps enforced while
  reading.
- **Six-step wizard** at `/imports/new` → `/imports/[jobId]`: Upload → Map fields (live preview,
  header-row count, date-format choice incl. auto-detect, one-signed-amount *or* debit/credit
  modes, header-keyword auto-suggestion) → background validation with progress polling → Review
  (per-row will-import / possible-duplicate / can’t-import with human-readable reasons; per-row
  include/skip; ambiguous rows — e.g. both debit and credit filled — are invalid with reasons) →
  explicit Confirm (nothing written before it) → Results (added / duplicates skipped / user-skipped
  / failed / needs-review counts) with a link into the Needs-review queue and **Undo**.
- **Import profiles:** three built-in synthetic-format templates (Maybank2u-style, TnG
  eWallet-style, generic debit/credit) plus user-saved profiles (upsert by name, last-used
  tracking), applied from the mapping step; import history lists all jobs with statuses and
  profile chips.
- **Amount forms:** signed with grouping, `RM` prefixes, parentheses negatives, trailing `DR`/`CR`
  suffixes, and debit/credit column pairs. **Dates:** dd/mm/yyyy (and `-`/`.` separators), ISO,
  mm/dd/yyyy, `dd MMM yyyy`, and auto (ISO → day-first → `dd MMM yyyy`, matching Malaysian
  statements).
- **Duplicates & idempotency:** occurrence-indexed content hashes
  (`sha256(account|date|amount|normalized-desc):n`) — identical rows within one file stay distinct
  transactions; rows already covered by the ledger are flagged *possible duplicate* (skipped by
  default, individually includable with a bumped occurrence). A **partial unique index on
  (account_id, import_content_hash)** plus conflict-ignoring inserts makes commits, retries, and
  re-clicks physically unable to duplicate (spec §6 C5). Unique job idempotency keys + status-gated
  transitions.
- **Background jobs (ADR-006):** pg-boss 12 behind the `JobQueue` interface, started once per
  server via `instrumentation.ts`; queues `import.validate` / `import.commit` with retryLimit 3 +
  exponential backoff; handlers wrap idempotent executors that integration tests drive directly.
  Commit failures mark the job `failed` with a user-safe error and a Retry button; a mid-commit
  crash rolls back wholly and the retry heals row↔transaction links.
- **Committed transactions:** typed income/expense by sign, posted, merchant-normalized from the
  description (originals preserved verbatim), merchant default category applied when known,
  otherwise flagged **needs review**.
- **Undo:** soft-deletes only **untouched** imported transactions (restorable from the Deleted
  view), clears their import hashes so the statement can be re-imported cleanly, marks the job
  `undone`, audited. Transactions the user edited after importing (any edit/bulk action bumps
  `version` above 1) are **kept**, the UI warns about this before undoing, and the result message
  reports both counts.
- **Auditing:** `import.uploaded` / `import.committed` / `import.undone` events with counts.

## Schema changes (forward-only migration 0007)

`import_status` / `import_row_status` enums; `import_profiles` (unique lower(name) per user),
`import_jobs` (account FK, mapping jsonb, unique `idempotency_key`, stats jsonb, sanitized
filename + sha256 + encoding/delimiter metadata), `import_rows` (raw + parsed jsonb, content hash,
`transaction_id` FK set-null, unique (job, row_number)); `transactions.import_content_hash` with
the partial unique idempotency index. **ERD deviation, recorded:** provenance is normalized on the
row side (`import_rows.transaction_id`) instead of also adding `transactions.import_row_id`,
avoiding a two-way FK cycle; both directions stay queryable through the indexed row table.

## Security & hostile-input coverage (all test-proven)

Oversized file, 20k+ row file, empty file, binary masquerading as CSV, malformed CSV (unclosed
quotes), legacy encodings, path-traversal/control-character filenames (sanitized), spreadsheet
formulas (`=SUM(A1:A2)` imports as inert text, byte-identical), prompt-injection descriptions
(stored verbatim as data; rendering is React-escaped), cross-user isolation (upload into another
user's account, and reading/mapping/confirming/undoing another user's job, all rejected
fail-closed), per-user upload rate limiting, and user-safe error surfaces (no parser/driver text).

## Test & verification results (2026-08-17, this machine)

| Gate | Result |
|---|---|
| Migrations from empty | ✅ Fresh embedded cluster migrates 0000→0007 on every integration and e2e run; dev DB at 8 applied |
| Demo seeding idempotent | ✅ CLI re-run: “already present — nothing to do” (plus dev-only seed guard) |
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **213 passed / 213** (21 files) — adds 23 CSV-lib tests, 4 import-schema tests, 14 pipeline tests (happy path, confirm gate, crash-retry idempotency, duplicate re-import + selective include, undo with edited-transaction protection, row paging/counts, date-ambiguity flag, debit/credit, messy/hostile file, profiles, isolation) |
| Playwright e2e | ✅ **41 passed / 41** — adds the four-part wizard journey (upload → suggested mapping + saved profile → background validation → review → confirm → results → ledger/balance verification; duplicate re-import via saved profile; history; undo → Deleted view) with **axe clean** on upload, mapping, review, and history screens; live pg-boss workers via instrumentation |
| `npm run build` | ✅ production build succeeds |

## Checkpoint review fixes (2026-08-17)

The pre-commit checkpoint review found four gaps against the acceptance criteria; all are fixed
and covered by the counts above:

1. **Every staged row is inspectable.** Review previously rendered only the first 500 rows. It now
   has status filter chips (all / will-import / duplicates / can’t-import / skipped) with accurate
   whole-import counts (`countRowsByStatus`, header rows excluded) and 200-row pagination
   (`listRows` gained `offset`; prev/next links preserve the active filter; “Rows X–Y of Z”).
2. **Invalid rows are resolvable in-app.** The review step links to **Adjust mapping**
   (`?step=mapping` re-opens the mapping form for a job already in review, with a no-changes way
   back), and an info banner explains that mapping/date-format fixes re-validate every row;
   rows left invalid are excluded from the commit and reported. Duplicates/valids remain
   individually includable/skippable.
3. **Day/month ambiguity is detected and surfaced.** Validation counts numeric dates that parse
   validly both day-first and month-first; when *every* date in the file is ambiguous the job is
   flagged (`stats.ambiguousDates`) and review shows an attention banner naming the format used
   and pointing at Adjust mapping. Files with any unambiguous date (e.g. day > 12) are not
   flagged.
4. **Undo cannot remove user-modified transactions.** All transaction mutations (edit, review
   bump, bulk category/exclude, duplicate marking) increment `version`; undo soft-deletes only
   `version = 1` linked rows, keeps the rest, warns in the UI beforehand, and reports
   undone/kept counts. Covered by an integration test that edits one imported transaction and
   asserts it survives the undo.

Also re-confirmed during the review: raw uploads are never persisted and no temp files are
written (in-memory parse only); demo seeds/test credentials are dev-guarded
(`assertSeedTargetIsSafe`) and e2e worker settings live only in test harness code; formulas stay
inert on display (CSV *export* escaping lands with the Phase 4 export feature); retries cannot
duplicate (partial unique index + conflict-ignoring inserts, crash-retry test); every import
operation resolves the user from the session and is ownership-checked (cross-user tests); no
Phase 4 work is mixed in.

## Known limitations

- Inline row **editing** in Resolve is deferred — invalid rows carry precise reasons and can be
  fixed via Adjust mapping, at the source file, or entered manually; duplicates support
  include/skip.
- One date format per import (plus `auto`, which handles the common mixed Malaysian cases);
  all-ambiguous files are flagged for confirmation rather than offering per-row overrides.
- OFX/PDF, scheduled imports, and rule-based categorization at import time (Phase 8) are out of
  scope; merchant default categories already auto-categorize known merchants.
- pg-boss keeps its own `pgboss` schema (created on first start) — outside the drizzle migration
  chain by design (ADR-006), documented here.

## Recommended next phase (not started)

**Phase 4 — Dashboard and analytics** (backlog §1): overview summaries and cash-flow chart,
the analytics workspace (persistent filters, comparison toggle, summary sentence, chart + table
alternative per the dataviz method), reports, net-position trend, month-over-month comparisons,
CSV export with formula-injection escaping, and the 10k-row performance check — no new tables
planned (ERD §5.1).
