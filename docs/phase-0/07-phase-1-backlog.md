# FinPilot — Phased Backlog & Phase 1 Plan (Phase 0)

## 1. Phased backlog summary (Phases 1–10)

*(Amended at Phase 0 review: phases roll up into three milestones — **Core MVP** (1–6), **AI Beta**
(7–8), **Production V1** (9–10) — and each phase migrates only its own domain's tables per ERD doc
§5.1 / ADR-017.)*

Each phase ends with a review stop. Exit criteria are cumulative with the global gates in spec §6
(no TS/lint errors, migrations apply from empty, all tests green, responsive + a11y checks on new
screens, isolation tests for every new entity).

| Phase | Milestone | Scope | Exit criteria (headline) |
|---|---|---|---|
| **1** | Core MVP | Project + tooling, identity/security schema (5 tables), auth, app shell, design tokens, base components, settings foundation, identity demo seed | Sign-up→sign-in→protected responsive shell works; migrations from empty; isolation + tamper tests green on `sessions`/`preferences`; demo identity seed loads |
| **2** | Core MVP | Ledger + classification schema; accounts, categories, tags, transactions (CRUD, splits, transfers, review), rules | Invariants green: transfer neutrality, split sums, soft delete/restore; correct totals on seed |
| **3** | Core MVP | Import schema + job queue; CSV wizard, profiles, dedup, idempotent commit | Hostile-file suite passes; re-run/retry never duplicates; nothing commits pre-confirm; undo window |
| **4** | Core MVP | Overview dashboard, analytics workspace, reports, CSV export (no new tables planned) | Dashboard reconciles to ledger on seed; every chart has table alt; export is injection-safe |
| **5** | Core MVP | Planning schema; budgets (4 modes, payday cycles, pace health), goals & sinking funds | Cycle resolver fixtures (weekends/holidays) pass; pace statuses correct on seed; goal forecasting deterministic |
| **6** | Core MVP ✅ | Recurring schema + notifications; detection, subscriptions, BNPL estimates, bill calendar, notification centre | Detection precision on seed fixtures; price-change evidence; dedup + quiet hours; **Core MVP acceptance (spec §6) green** |
| **7** | AI Beta | Intelligence schema (deterministic); safe-to-spend, forecasts (30/60/90, 3 bands), anomalies, deterministic budget suggestions | STS itemization equals ledger math; bands monotone; zero LLM calls |
| **8** | AI Beta ✅ | AI schema; `AIProvider` + first adapter selected via config/env, assistant + tools, generative insights, Action Queue, Privacy Mode, injection defenses, AI evals | Privacy-Mode e2e proves zero external calls; numeric-claim verification; golden fixtures incl. injections; **AI Beta acceptance green** |
| **9** | Production V1 | Scenario/journal schema; Scenario Lab (save/compare/uncertainty), Decision Journal, outcome reviews | Scenario writes touch no real records (invariant test); journal exclusions change baselines correctly |
| **10** | Production V1 ✅ | Security review (incl. recorded RLS reconsideration, ADR-010), performance, a11y pass, export/deletion, backup/restore docs, observability, deployment, regression | **Production V1 acceptance (spec §6) green**; launch checklist incl. PDPA items signed off |

Dependencies are strictly forward; the only intentional back-reference is Phase 8 upgrading Phase 7's
deterministic insight phrasing.

---

## 2. Phase 1 — Project, database, authentication, and design system

### 2.1 Phase goal

A deployable skeleton with real security and the full database: quality tooling, complete schema v1
migrations, email/password auth with hardened sessions, the responsive protected app shell (sidebar +
mobile bottom nav + command palette stub), design tokens + base component set, settings foundation,
and the demo seed. **No feature domains yet** (no transactions UI, no dashboards).

### 2.2 Assumptions

- **Incremental schema (amended, ADR-017):** Phase 1 migrates exactly five tables — `users`,
  `user_preferences`, `sessions`, `password_reset_tokens`, `audit_logs` — plus the enums,
  extensions, and triggers they need. The full ERD stays the target model; each later phase
  migrates its own domain's tables (ERD doc §5.1).
- Local dev: Node LTS + PostgreSQL 16+ (any reachable server via `DATABASE_URL`; a self-contained
  embedded/dockerized option documented for machines without one); `.env.example` documents every
  variable.
- Email delivery is a console/file adapter in dev (`Mailer` interface); reset flow is fully real
  minus SMTP.
- Demo seed runs as a script (`db:seed:demo`) and is also triggerable from onboarding later; in
  Phase 1 it's CLI-only and seeds the demo identity only (spec §7 seeding schedule).
- i18n scaffolding (ADR-016) ships now with `en-MY` only.
- **No AI provider code, no social login/MFA/passkeys, and no job-queue dependency in Phase 1** —
  interfaces and reserved designs only.

### 2.3 Epics, user stories, acceptance criteria

**E1 — Project initialization & quality gates**
- S1.1 As a developer I get a reproducible environment.
  ✓ `pnpm i && docker compose up -d && pnpm db:migrate && pnpm db:seed:demo && pnpm dev` works from
  a clean clone per README; `.env.example` complete.
- S1.2 As a maintainer I can't merge broken code.
  ✓ CI: lint, `tsc --noEmit`, migrate-from-empty, Vitest, Playwright smoke; lefthook pre-commit runs
  lint-staged + typecheck; ESLint enforces module-boundary rules (arch doc §2) and the no-float-money
  rule.

**E2 — Identity/security schema + seeds (amended: 5 tables only)**
- S2.1 As the system I have the identity/security schema under migration control.
  ✓ Migrations apply from empty and are idempotent to re-run via migrator, creating exactly
  `users`, `user_preferences`, `sessions`, `password_reset_tokens`, `audit_logs` with their enums,
  `citext`, indexes, and the audit append-only guard; rollback notes written; forward-only,
  version-controlled SQL readable in DBeaver.
- S2.2 As a developer I have deterministic data.
  ✓ `db:seed:demo` creates the demo identity (user + preferences + sample audit events)
  idempotently; `db:seed:test` builds identity fixtures for integration tests. (The Aisyah
  financial dataset arrives with its domains, Phases 2–3.)

**E3 — Authentication & sessions**
- S3.1 As a user I can sign up with email/password.
  ✓ Zod-validated; Argon2id hash; password policy (min 12 chars, breach-list check offline);
  duplicate email gives enumeration-safe response; audit event written.
- S3.2 As a user I can sign in / sign out.
  ✓ Opaque token session (hashed at rest), HttpOnly/Secure/SameSite=Lax cookie; rotation on login;
  sign-out revokes server-side; generic failure copy.
- S3.3 As a user I can reset a forgotten password.
  ✓ Single-use hashed token, 30-min expiry; all sessions revoked on reset; enumeration-safe;
  audited.
- S3.4 As the system I resist abuse.
  ✓ Postgres-backed rate limits per IP + identifier on all three flows with tested lockout +
  retry-after copy.
- S3.5 As a user I can see and revoke my sessions (Settings → Security).
  ✓ List (device, ip-hash-derived hint, last active), revoke one/all-others.

**E4 — Protected app shell & navigation**
- S4.1 As a signed-in user I get the responsive shell.
  ✓ Desktop sidebar (8 primary + 4 secondary destinations, correct active states), mobile bottom nav
  (5 slots incl. ⌘ button), topbar with privacy toggle + user menu; unauthenticated access to any
  app route redirects to sign-in preserving return URL.
  ✓ Verified at 360/768/1024/1440; keyboard navigable; skip-link; focus visible.
- S4.2 As a user I have placeholder destination pages.
  ✓ Every route from the route map renders a PageHeader + labeled EmptyState explaining what arrives
  in which phase (honest "not built yet", no fake UI); command palette opens (⌘K) with navigation
  commands only.

**E5 — Design tokens & base components**
- S5.1 Tokens implemented per design doc: color (light+dark, `data-theme` + system default),
  type scale, spacing, radii, shadows, focus ring; theme toggle persists.
- S5.2 Base primitives built and Storybook-style demo page (dev-only route) shows all states:
  Button, IconButton, Input, CurrencyInput, Select, Checkbox, RadioGroup, Switch, FormField, Dialog,
  Drawer, Popover, Tooltip, Tabs, Badge, Banner, Toast, Progress, Skeleton, EmptyState, ErrorState,
  Card, DataTable (static), StatTile, AmountText (tabular nums + privacy masking), ConfidenceChip,
  CommandPalette, AppShell, PageHeader.
  ✓ axe clean on the demo page; AmountText renders `RM 1,234.56` via locale tokens and masks
  without layout shift.

**E6 — Settings foundation**
- S6.1 As a user I can manage profile & preferences.
  ✓ Settings pages per route map with working: name change, password change (re-auth required),
  locale/currency/timezone/theme, notification-pref placeholders (persisted schema), privacy page
  showing Privacy Mode toggle (persisted; enforcement matters from Phase 8 but the flag + disclosure
  copy exist now), start-of-week/start screen prefs.
  ✓ Data/export/delete pages exist with honest "arrives in Phase 10" labels.

**E7 — Onboarding skeleton**
- S7.1 As a new user I enter the 5-step onboarding after sign-up with save-and-resume.
  ✓ Steps 1 (locale/currency/timezone) and 4-lite (safety buffer + budget style) fully functional
  into `user_preferences`; steps 2/3/5 render structure with "coming in Phase 2/3" honesty and can
  be skipped; resume restores position; final summary reflects entered values.
  *(Scope decision: full accounts/income/import steps activate in Phases 2–3; the flow shell ships
  now so navigation and persistence are real.)*

### 2.4 Files/modules to create (top level)

Per architecture doc §2: repo scaffold (`next.config`, `tsconfig` strict, `eslint`, `prettier`,
`lefthook`, dev-database scripts, CI workflow), `src/lib/{money,dates,result,i18n,zod}`,
`src/server/db/{schema/*,migrations,repositories/*}`, `src/server/auth/*`,
`src/server/jobs/queue.ts` (interface only — no queue dependency until Phase 3),
`src/components/*` (E5 list), `src/app/(auth)/*`, `src/app/(app)/*` (shell + placeholders),
`src/features/{settings,onboarding}/*`, `scripts/{seed-demo,seed-test}.ts`, `docs/sql/*`.

### 2.5 Schema/API changes

Schema: Phase 1 migrations = the five identity/security tables with enums, `citext`, indexes, and
the audit append-only guard (ERD doc §5.1, ADR-017). API surface added: server actions
`auth.signUp/signIn/signOut/requestReset/resetPassword/updateProfile/updatePreferences/
revokeSession`; route handlers: `/api/health`. All Zod-validated, Result-envelope returns.

### 2.6 UX states & edge cases

Auth: invalid credentials (generic), rate-limited (retry-after), expired/used reset token, weak
password inline validation. Shell: loading skeletons per region; offline banner; session-expired
redirect preserving return URL; privacy toggle with masked amounts in demo components; theme toggle
without flash (inline script). Onboarding: resume mid-flow, skip paths, back navigation preserving
input. Settings: optimistic save with rollback + toast on failure; re-auth modal for password
change.

### 2.7 Test plan

- **Unit:** money module (format/parse/allocate rounding), date/cycle helpers, password policy,
  token hashing, rate-limit bucket, Zod schemas.
- **Integration (DB):** migration-from-empty; repository CRUD for users/sessions/preferences;
  **isolation harness** (amended — required proofs): user A cannot **read** user B's data; user A
  cannot **update or delete** user B's data; **changing IDs in URLs or request payloads does not
  bypass authorization** (tampered session ids, tampered user ids in action inputs); **unauthenticated
  callers cannot reach protected routes or operations**. This harness is the pattern every later
  phase must extend per entity. Plus: seed integrity; audit-event writes for all auth flows.
- **E2E (Playwright):** sign-up → onboarding → shell; sign-in/out; reset flow (console mailer
  capture); protected-route redirect; session revocation; theme + privacy toggles; viewports
  360/768/1024/1440; axe on auth pages, shell, settings, component demo page.
- **Quality gates:** CI green = lint + types + migrate + unit + integration + e2e; no float-money
  lint violations.

### 2.8 Security & privacy considerations

All of risk-register P1 items: Argon2id params documented; sessions hashed + rotated; cookies
HttpOnly/Secure/SameSite; rate limiting live; enumeration-safe copy reviewed; CSRF posture (server
actions origin check) verified; security headers (CSP without inline scripts, HSTS, frame-deny,
nosniff) set in Phase 1 so later phases inherit them; logs structured with redaction schema from the
first line; audit events for auth; `.env` never committed; synthetic data only.

### 2.9 Definition of done (Phase 1 gate)

All §2.3 acceptance criteria met · §2.7 suites green in CI · responsive + a11y verified · README
onboarding path tested on a clean machine · risk register reviewed · then stop for review before
Phase 2.
