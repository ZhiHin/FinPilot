# FinPilot

An AI personal finance manager for Malaysia — understand where your money went, know what you can
safely spend, anticipate upcoming expenses, and test decisions before making them. Educational
information, not financial advice; FinPilot never moves money.

**Status:** **Phase 10 complete — Production V1 engineering done.** All ten phases have shipped:
accounts and ledger, CSV import, dashboard and analytics, budgets and goals, recurring and
notifications, deterministic intelligence, explainable AI, Scenario Lab and Decision Journal, and
now hardening — full data export, staged account deletion, security review, performance profile,
observability, and deployment. Remaining launch blockers (a production mailer, legal review, an AI
provider agreement, incident contacts) are tracked honestly in
[`docs/ops/launch-checklist.md`](docs/ops/launch-checklist.md).

Product docs live in [`docs/phase-0/`](docs/phase-0/README.md), operations runbooks in
[`docs/ops/`](docs/ops/launch-checklist.md), and phase-by-phase progress in
[`docs/progress/`](docs/progress/phase-10.md). The demo login (`db:seed:demo`) is
`aisyah.demo@finpilot.test` / `demo-aisyah-2026` — 8 months of synthetic Malaysian data. Synthetic
statement fixtures for trying the import wizard live in `tests/fixtures/statements/`.

## Stack

Next.js (App Router, TypeScript strict) · PostgreSQL 17 · Drizzle ORM (versioned SQL migrations) ·
Tailwind CSS v4 + Radix primitives · Zod · Vitest · Playwright · ESLint/Prettier/lefthook.

## Getting started

Prerequisites: **Node.js ≥ 20.9** (developed on 24) and npm. No Docker or system PostgreSQL needed —
the dev database is a project-managed embedded PostgreSQL 17.

```bash
npm install                 # also installs git pre-commit hooks (lefthook)
copy .env.example .env      # then set AUTH_SECRET (command in the file's comment)

npm run db:start            # embedded PostgreSQL 17 on port 5433 (keep this terminal open)
npm run db:migrate          # apply SQL migrations (forward-only)
npm run db:seed:demo        # demo identity: aisyah.demo@finpilot.test / demo-aisyah-2026

npm run dev                 # http://localhost:3000
```

Stop the database with Ctrl-C in its terminal or `npm run db:stop` from another one.

**Using your own PostgreSQL instead:** point `DATABASE_URL` in `.env` at any PostgreSQL 16+ server
(e.g. a local service on 5432 or `docker compose up -d` for the bundled compose file), then run
migrate/seed as above.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Server-side secret for keyed hashes (rate-limit subjects, IP hashes) |
| `DEV_MAIL_DIR` | no | Where the dev mailer writes outgoing mail JSON (default `.dev-mail/`) |
| `APP_BASE_URL` | no | Base URL used in emailed links (default `http://localhost:3000`) |
| `AI_PROVIDER` | no | Generative-AI adapter: `stub` (default — deterministic, zero network), `anthropic`, or `stub-wrong` (evaluation fixture that fabricates numbers; must never surface) |
| `ANTHROPIC_API_KEY` | with `anthropic` | API key for the Anthropic adapter |
| `AI_MODEL` | no | Model override for the Anthropic adapter (default `claude-sonnet-5`) |
| `AI_DISABLED` | no | `1` = kill switch: every AI call refuses at the gateway regardless of provider/consent |
| `LOG_LEVEL` | no | pino level for structured server logs (default `info`) |

AI features (assistant, insight phrasing) additionally require per-user consent in
Settings → Privacy & AI, and Privacy Mode always overrides everything: with it on, zero
external AI calls are possible. The default `stub` provider makes no network calls at all, so
a fresh checkout is fully functional — and CI runs entirely offline — without any AI key.

There is no email provider yet: password-reset mails are written to `DEV_MAIL_DIR` as JSON files
(the reset flow is otherwise fully real — single-use, expiring, hashed tokens).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve |
| `npm run db:start` / `db:stop` | Start/stop the embedded dev database (data in `.pgdata/`) |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:seed:demo` / `db:seed:test` | Idempotent demo identity / deterministic test users |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Integration tests against a throwaway embedded PostgreSQL (port 5434) |
| `npm run test:e2e` | Playwright e2e (own database on 5435 + dev server on 3100 — nothing of yours is touched; stop your dev server first, Next allows one dev instance per project) |
| `npm run lint` / `typecheck` / `format:check` | Quality gates (also run by CI and pre-commit) |

First e2e run needs `npx playwright install chromium`.

## Database inspection with DBeaver

1. New connection → PostgreSQL → host `localhost`, port `5433`, database `finpilot`, user
   `finpilot`, password `finpilot` (the embedded dev instance while `db:start` runs).
2. Schema lives in `public`; applied migrations are listed in `drizzle.__drizzle_migrations`.
3. The ER diagram tab on the database node reconstructs the schema from live foreign keys — compare
   against `docs/phase-0/04-domain-model-and-erd.md`.
4. Treat DBeaver as read-only for schema: all DDL goes through migration files
   (`src/server/db/migrations/`), never manual edits. See the ERD doc §6 for the full workflow.

## Project layout

See `docs/phase-0/05-technical-architecture.md`. Short version: `src/app` routes (thin),
`src/components` design system (domain-free), `src/features/*` domain UI + server actions,
`src/server/{auth,db}` framework-independent core, `src/lib` shared pure modules (money, dates,
ids, i18n, result). Module boundaries are lint-enforced, as is the ban on float money math.

## Running it in production

`Dockerfile` builds the deployable image (Next.js standalone output, non-root, health-checked).
The runbooks in [`docs/ops/`](docs/ops/deployment.md) cover it end to end:

| Document | Covers |
|---|---|
| [deployment.md](docs/ops/deployment.md) | Requirements, environment variables, image build, release procedure, smoke test |
| [backup-restore.md](docs/ops/backup-restore.md) | Backup commands, restore procedure, verification queries, drill record |
| [observability.md](docs/ops/observability.md) | Health endpoint, scrubbed structured logs, audit trail queries, recommended monitors |
| [incident-response.md](docs/ops/incident-response.md) | Severity levels, containment, scoping queries, PDPA breach notification |
| [security-review.md](docs/ops/security-review.md) | Phase 10 review, findings, and the recorded RLS decision (ADR-018) |
| [launch-checklist.md](docs/ops/launch-checklist.md) | Production V1 sign-off and the open launch blockers |
