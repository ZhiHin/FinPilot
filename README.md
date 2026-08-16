# FinPilot

An AI personal finance manager for Malaysia — understand where your money went, know what you can
safely spend, anticipate upcoming expenses, and test decisions before making them. Educational
information, not financial advice; FinPilot never moves money.

**Status:** Phase 1 complete (foundation, auth, app shell). Product docs live in
[`docs/phase-0/`](docs/phase-0/README.md); phase progress in [`docs/progress/`](docs/progress/phase-1.md).

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
