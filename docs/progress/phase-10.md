# Phase 10 — Hardening and release readiness

**Status:** complete · **Date:** 18 August 2026 · **Milestone:** Production V1 ✅ (engineering)

Phase 10 turns a feature-complete app into a releasable one: users can take their data out and
erase their account for real, the security decision Phase 0 deferred is decided, and an operator
now has runbooks for deploying, watching, backing up, and responding to incidents.

**No migrations.** Staged deletion runs on the `users.status` / `purge_after` columns that Phase 1
migrated. The chain stays at 0000 → 0017, 18 applied.

---

## 1. What shipped

### Data export (spec V4, PDPA access & portability)

`Settings → Data → Download my data` produces a ZIP: **25 CSVs** — one per owned entity, from
accounts and transactions through budgets, goals, recurring, subscriptions, notifications,
insights, scenarios, journal, rules, import history, attachments, and the user's own audit trail —
plus `profile.json` and `manifest.json`.

- **Every user-influenced cell is formula-injection-safe.** A shared `buildEntityCsv` applies the
  Phase 4 escaping contract (`= + - @ TAB CR` → prefixed with `'`); app-generated fixed-grammar
  values (dates, signed decimals, enums, uuids, JSON) are marked `raw()` so a legitimate `-1600.00`
  is never corrupted. UTF-8 BOM + CRLF, matching the transactions export.
- **Row ids and reference ids are included on purpose** — relations between files are part of the
  data being ported. Password hashes, session and reset tokens, and IP/subject hashes never are.
- Rate-limited to 5 archives/hour/user, audited with file and row counts only, capped at 20,000
  rows per file with `truncated` flagged in the manifest.

### Staged account deletion (spec V4)

Password-confirmed request → status `pending_purge`, `purge_after = now + 30 days`, **every session
revoked immediately** → daily purge job hard-deletes after the window.

- Inside the window the user can still sign in, but `requireUser()` funnels *every* route to
  `/restore`, which states the purge date and offers restore or sign out. After the window,
  sign-in fails exactly like bad credentials — no new enumeration oracle.
- The purge is a single transaction: delete the user (cascades wipe every owned table) and write an
  `account.purged` audit record carrying a **salted subject hash** and per-table **row counts**,
  never the email or any financial detail. Those counts are what tells you what to restore if the
  job ever runs on the wrong account.
- Idempotent under pg-boss retries: purged users no longer match the due query.

### Security review (spec V5) — and the decision Phase 0 owed

[docs/ops/security-review.md](../ops/security-review.md) walks every threat-model surface.
**Two Medium findings were found and fixed during the review:**

- **F1** — generative AI had no per-user budget, so a scripted client could burn provider spend
  (risk R7). Now `AI_CALLS_PER_HOUR = 60`, enforced at the single gateway chokepoint, counted from
  `ai_requests`; refusals are logged and surfaced as calm copy. Refusals don't consume budget.
- **F2** — account deletion existed only as a schema state with no way to reach it, so the PDPA
  erasure right was unexercisable. Fixed by the feature above.

**ADR-010's open clause is now closed as ADR-018: service-layer authorization is confirmed for V1;
RLS is not adopted.** One pooled role would make RLS depend on `SET LOCAL` per checkout — a control
whose failure mode is *silent widening* — while the hand-written analytics CTEs, the
`information_schema`-driven purge sweep, and pg-boss would all need re-profiling or `BYPASSRLS`
carve-outs. The compensating controls are stronger than "we scope in code": ownership only ever
comes from the server-side session, 33 database triggers reject child rows whose owner disagrees
with their parent, and per-entity isolation tests are CI-blocking. Revisit triggers are recorded.

### Accessibility (spec V3)

axe (serious + critical) clean on the new surfaces — Settings → Data, the delete-account dialog
with focus trap and Escape, `/restore`, and `/legal/privacy` — added to the existing per-phase axe
coverage of Overview, Transactions, Budget, Import, and Settings. Settings → Data verified at 360 px
with a zero horizontal-overflow assertion.

**Fixed a long-standing React key warning** carried since Phase 7: `ChartCard` passed the
server-rendered `footer` as a bare sibling of `<Tabs>`, so on the client it landed in an unkeyed
children array. Traced by instrumenting `CardContent` (the culprit was neither obvious nor in the
page it was reported against), fixed by giving `footer` its own wrapper. The dev console is now
clean on Overview.

### Observability, deployment, and the runbooks (spec V5)

- **Structured logging** (`pino`) with `scrubForLogging()` — redacts credentials *and* raw financial
  detail (amounts, balances, descriptions, notes, titles, merchant names, emails, `diff` blobs) by
  key, recursively, with depth and length caps. Unit-tested, which is what makes G6 enforceable
  rather than aspirational. `console.log` is gone from server paths.
- **`/api/health`** now reports db up/down, applied migration count, pg-boss pending/failed depth,
  and uptime — with alert thresholds documented. Strictly non-sensitive, since it is unauthenticated.
- **`Dockerfile`** with `build` / `migrate` / `runtime` stages on Next.js standalone output,
  non-root user, and a `HEALTHCHECK`; `poweredByHeader: false`.
- **Runbooks:** [deployment](../ops/deployment.md), [backup & restore](../ops/backup-restore.md),
  [observability](../ops/observability.md), [incident response](../ops/incident-response.md)
  (PDPA breach notification with real scoping queries), [security review](../ops/security-review.md),
  [launch checklist](../ops/launch-checklist.md).

### Bilingual privacy notice (spec V6)

`/legal/privacy` — public, reachable signed out, in **English and Bahasa Melayu** (PDPA expects BM
availability; this closes the R10 gap that Phase 0 flagged as a launch blocker). Linked from the
sign-in screen and Settings → Privacy. It describes what the app actually does — no aspirational
claims — and says plainly that it documents an engineering posture, not certified compliance.

---

## 2. Verification

### Backup/restore drill — actually executed

Not a documented procedure: run end to end against the development database (PostgreSQL 17.10,
925 transactions), `pg_dump -Fc` → fresh database → `pg_restore`.

| Check | Source | Restored |
|---|---|---|
| Counts + amount checksum | `transactions=925 accounts=7 migrations=18 txn_md5=12685aa5…` | **identical** |
| Schema objects | `tables=38 triggers=33 checks=358 indexes=102` | **identical** |

The checksum matters more than the counts — it proves *amounts* survived. The object counts prove
the guard triggers and check constraints came back; a restore that silently loses them disables the
ledger's invariants. Drill artifacts were deleted.

### Performance profile (spec C8 / V5)

New `release-perf.test.ts` profiles the release-critical paths Phase 4 didn't cover, at 10,000
transactions:

| Path | Measured | Budget |
|---|---|---|
| Transactions list, first page (50) | 31 ms | 1,500 ms |
| Transactions list, **page 21 via cursor** | 24 ms | 1,500 ms |
| Transactions list, text search + filter | 5 ms | 1,500 ms |
| Safe-to-spend | 17 ms | 4,000 ms |
| 90-day forecast, cold | 24 ms | 4,000 ms |
| 90-day forecast, cached | 4 ms | 1,500 ms |
| Net position roll-up | 8 ms | 1,500 ms |
| Full-account export archive | 150 ms | 4,000 ms |

The headline is the deep page: **24 ms at page 21 versus 31 ms at page 1** — keyset pagination
doesn't degrade with depth, which is the regression this test exists to catch.

### Gates

| Gate | Result |
|---|---|
| Vitest | **519 / 519** passed (52 files) — +28 this phase |
| Playwright | **120 / 120** passed (run as two halves of 60) — +7 this phase |
| `npm run lint` / `typecheck` / `format:check` | clean |
| Production build | succeeds; `.next/standalone/server.js` produced |
| Migrations from empty | fresh database → 0000 → 0017, **18 applied**; `db:generate` reports no drift |
| Demo seed | first run 933 transactions; second run "already present — nothing to do" |
| `npm audit --omit=dev` | 0 vulnerabilities (4 moderate dev-only — security review F4) |
| `git diff --check` | clean |
| Secret / encoding scan | 53 changed files: 0 secrets, 0 BOMs, 0 control bytes (also removed a stray pre-existing BOM from `sign-in/page.tsx`) |

---

## 3. Known limitations

1. **No production mailer** — only the development file-based mailer exists, so password-reset
   emails are not delivered. This is a **launch blocker** (checklist B1), not a nice-to-have: it
   makes account recovery impossible.
2. **Docker image not built here** — the development machine has no Docker, so the image is correct
   by construction, not by execution. Build and smoke-test it before the first deploy
   (deployment.md §6). Same for the container vulnerability scan.
3. **Retention window not implemented** — `data_retention_months` persists but nothing trims old
   history; its balance-consolidation semantics were never specified and were not in this phase's
   backlog row. Settings → Data says so plainly rather than showing a control that does nothing.
   Deletion, which is the actual PDPA right, is fully implemented.
4. **Solo security review** — no independent reviewer and no dynamic testing (risk R3 stays open).
   Fine for a private beta; external review belongs before a public launch.
5. **Attachments remain modelled but unshipped** — the table and scan-status hook exist with no
   upload path, so the export lists metadata for rows that cannot yet exist.
6. **`style-src 'unsafe-inline'`** is still required by Tailwind/Recharts inline styles; `script-src`
   carries no inline allowance, which is where it matters.
7. **Next.js standalone output mirrors the build context**, so `.dockerignore` — not file tracing —
   is what keeps `.env`, tests, and docs out of the image (security review F7). Verify with the
   command in deployment.md §3 after the first build.

## 4. Files

**New:** `src/lib/csv/archive.ts` (+ test) · `src/server/services/account-purge.ts` ·
`src/server/observability/logger.ts` (+ test) · `src/app/api/exports/account/route.ts` ·
`src/app/restore/page.tsx` · `src/app/legal/privacy/page.tsx` ·
`src/features/settings/data-panels.tsx` · `Dockerfile` · `.dockerignore` ·
`tests/integration/account-deletion.test.ts` · `tests/integration/release-perf.test.ts` ·
`tests/e2e/release.spec.ts` · `docs/ops/{security-review,backup-restore,observability,incident-response,deployment,launch-checklist}.md`

**Changed:** `exports.ts` (archive) · `auth/service.ts` (deletion lifecycle, `pending_purge`
sign-in) · `auth/guard.ts` (restore funnel) · `users.ts` repo · `ai/gateway.ts` (call budget) ·
`assistant.ts` + `assistant-panel.tsx` (new refusal reason) · `jobs/{queue,pgboss,workers}.ts`
(schedules + purge worker) · `instrumentation.ts` · `api/health/route.ts` ·
`charts/chart-card.tsx` (key fix) · `settings/data/page.tsx` · `settings/privacy/page.tsx` ·
`(auth)/{layout,sign-in}` · `proxy.ts` (public `/legal`) · `next.config.ts` · `README.md` ·
`.env.example` · Phase 0 docs (ADR-018, tracker row 10, ERD backup reference).

## 5. Next

Phase 10 was the last planned phase. The remaining work is **not** a new phase but the four launch
blockers in [../ops/launch-checklist.md](../ops/launch-checklist.md) §1 — a production mailer
(engineering), legal review of the notice, an AI provider agreement if generative AI ships enabled,
and incident contacts. After those: private beta behind the checklist's post-launch items
(monitors, image scanning, managed Postgres with PITR).
