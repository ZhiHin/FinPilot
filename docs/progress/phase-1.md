# Phase 1 — Project, database, authentication, and design system

**Status:** Complete — all acceptance criteria green. Awaiting review before Phase 2.
**Date:** 2026-08-16
**Plan:** `docs/phase-0/07-phase-1-backlog.md` (as amended at the Phase 0 review)

## Completed work

- **Project & tooling (E1):** Next.js 16.3 (App Router, Turbopack), TypeScript strict, Tailwind v4
  with tokenized theme, ESLint 9 (+ module-boundary rules and a float-money ban), Prettier,
  lefthook pre-commit (eslint + prettier + typecheck), Vitest 4 (unit/components/integration
  projects), Playwright, GitHub Actions CI workflow, `.env.example`, README setup docs.
- **Identity schema & migrations (E2, amended scope):** exactly the five approved tables — `users`,
  `user_preferences`, `sessions`, `password_reset_tokens`, `audit_logs` — via four forward-only SQL
  migrations (`0000` citext extension, `0001` identity schema, `0002` audit append-only trigger,
  `0003` users.display_name). Case-insensitive unique emails (citext, partial index on
  not-deleted), check constraints (session expiry, non-negative buffer, purge-date requirement),
  FK cascade/set-null behavior, rate-limit indexes. Audit log is append-only at the database level
  with a single carve-out for FK-driven user anonymization.
- **Authentication (E3):** Argon2id (19 MiB / t=2 / p=1); 256-bit opaque session tokens stored as
  SHA-256 hashes; HttpOnly/Secure/SameSite=Lax cookies; session rotation on sign-in, sliding idle
  expiry (14 d) with absolute cap (30 d), server-side revocation (sign-out, per-session, all-others,
  on password change/reset); login/sign-up/reset rate limiting backed by `audit_logs` (salted
  subject/IP hashes — raw identifiers never stored); enumeration-safe generic errors with
  dummy-hash timing equalization; single-use 30-minute hashed reset tokens; Zod at every boundary;
  audit events for every auth action. `proxy.ts` does the coarse cookie redirect; `requireUser()`
  does the real database-backed check in layouts, pages, and every server action.
- **App shell & routes (E4):** responsive shell (desktop sidebar ≥1024 px, mobile bottom nav with
  command button), ⌘K/Ctrl-K command palette (navigation commands), header with privacy toggle,
  theme toggle, user menu; every Phase 0 route exists — placeholders are honestly labeled with the
  phase that delivers them; security headers (nosniff, frame-deny, referrer policy, permissions
  policy, HSTS) plus a nonce-based CSP in production.
- **Design system (E5):** Phase 0 tokens implemented as CSS custom properties (light + dark +
  system) mapped into Tailwind; 25+ base components; `AmountText` renders all money (tabular
  numerals, ICU `RM 1,234.56` formatting, privacy masking); dev-only `/dev/components` gallery.
  Two contrast corrections were made against the Phase 0 proposal and written back to the design
  doc: light `--text-muted` → `#626C82`, dark `--text-on-accent` → `#0F1219`.
- **Settings foundation (E6):** profile (name, password change with re-auth), preferences
  (locale/currency/timezone/theme), security (session list + revocation), notifications
  (digest/quiet-hours, persisted for Phase 6), privacy (Privacy Mode flag + per-feature AI
  disclosure page), data (honest Phase 10 placeholders).
- **Onboarding skeleton (E7):** five-step flow with save-and-resume; steps 1 (locale/currency/
  timezone) and 4 (budget style + safety buffer) fully functional; steps 2/3/5 honest structural
  placeholders; personalized summary; completion state persisted.
- **Seeds:** idempotent demo identity (`aisyah.demo@finpilot.test`) and deterministic e2e users.

## Important decisions (beyond the Phase 0 ADRs)

1. **Embedded PostgreSQL 17 for dev/test** (`embedded-postgres` npm): no Docker on the dev machine
   and the local PostgreSQL service requires unknown credentials. Dev DB on 5433, integration on
   5434 (fresh cluster + template-cloned DB per test file), e2e on 5435 (fresh per run). Any
   PostgreSQL 16+ works via `DATABASE_URL`; docker-compose file provided.
2. **Rate limiting stores nothing new:** failure counting queries `audit_logs` by salted
   subject/IP hash — persistent, multi-instance-safe, and within the approved five tables.
3. **Two target-model additions recorded in the ERD doc:** `sessions.last_seen_at`,
   `audit_logs.subject_hash`; plus `users.display_name` (settings/profile requires it).
4. **Next 16 specifics honored:** `proxy.ts` (middleware successor, Node runtime), async
   `cookies()`/`params`, separate `viewport` export, `useActionState` forms, cookie writes only in
   actions/route handlers (theme therefore lives in preferences, server-rendered — no flash, no
   inline script).
5. **E2E server wrapper** (`scripts/e2e-server.ts`) starts database + migrations + seeds + dev
   server in one process tree because Playwright boots its web server *before* global setup.
6. **Inline links are always underlined** (axe `link-in-text-block`); color-only links fail WCAG.

## Commands

Setup/run: see `README.md` (install → `.env` → `db:start` → `db:migrate` → `db:seed:demo` → `dev`).
Migrations applied this phase: `0000_extensions`, `0001_identity`, `0002_audit_append_only`,
`0003_users_display_name` (`npm run db:migrate`; verify in DBeaver via `drizzle.__drizzle_migrations`).
Environment variables: `DATABASE_URL`, `AUTH_SECRET` (required); `DEV_MAIL_DIR`, `APP_BASE_URL`
(optional).

## Test & verification results (2026-08-16, this machine)

| Gate | Result |
|---|---|
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean (strict) |
| `npm run format:check` | ✅ clean |
| Unit + component tests | ✅ 56 passed (money, dates, uuidv7, result, i18n, password policy, tokens, AmountText masking, FormField wiring) |
| Integration tests | ✅ 39 passed — migrations-from-empty; exactly the 5 approved tables; citext uniqueness; audit append-only; check constraints; cascade/set-null; repository CRUD; **isolation harness: cross-user read/update/delete blocked, tampered session/user ids in payloads match nothing**; seeds idempotent; auth service (sign-up/in, generic errors, identifier lockout, session lifecycle, reset flow incl. single-use + session revocation, change-password) |
| E2E (Playwright, Chromium) | ✅ 23 passed — unauthenticated redirects with return URL; sign-up → onboarding (skip paths, save-and-resume) → personalized overview; wrong-password generic error; sign-out revokes server-side; full password-reset journey via dev mailbox incl. token replay rejection; two-device revocation; sidebar/bottom-nav at 1440/1024/768/360; command palette; theme persistence; privacy masking; settings save; **axe: no serious/critical violations** on sign-in, sign-up, overview, settings (profile/security), onboarding, placeholder, and component gallery |
| `npm run build` | ✅ production build succeeds (all routes dynamic, proxy registered) |
| Manual verification | ✅ registration, login, logout, reset, protected routes, responsive layouts exercised via the e2e journeys above; health endpoint reports `{ok:true,db:"up"}` |

## Known limitations

- **No email transport:** reset mails are JSON files in `.dev-mail/` (provider integration is
  post-V1; the token flow itself is production-shaped).
- **Per-IP rate limiting is inert in local dev** (no `x-forwarded-for`); per-identifier limits
  carry the protection. Behind a proxy in production both apply — configure the proxy to set the
  header truthfully.
- **`npm audit`: 4 moderate advisories**, all in the dev-only toolchain via drizzle-kit's bundled
  esbuild (<=0.24.2, GHSA-67mh-4wv8-2f99 — dev-server request forgery; not part of the runtime or
  production build). Track drizzle-kit updates; no runtime dependency is affected.
- **E2E runs use `next dev`,** not a production build (Turbopack dev is compile-on-demand; the
  production build is verified separately). Revisit if dev/prod divergence ever matters to a test.
- Theme quick-toggle requires a server round-trip (theme is a server-rendered preference by
  design); the ~0.5 s delay is acceptable for Phase 1.
- The repository is initialized but has **no commits yet** — awaiting maintainer preference on
  history granularity (pre-commit hooks are installed and will run from the first commit).

## Recommended next phase

**Phase 2 — Accounts, categories, and transactions** (per `docs/phase-0/07-phase-1-backlog.md` §1):
migrate the ledger + classification tables (ERD doc §5.1), implement manual accounts and balances,
categories/tags/rules, transaction CRUD with splits and linked-double-entry transfers, the review
workflow, and the Aisyah demo financial dataset — with the transfer-neutrality and split-sum
invariant tests from spec §6 as the acceptance core. Not started, per the phase-gate process.
