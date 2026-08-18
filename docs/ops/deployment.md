# FinPilot — Deployment

How to run FinPilot in production. Closes the deployment-configuration item in spec V5.

> **Not yet exercised in production.** The image below was authored during Phase 10 but **not
> built or run** — the development machine has no Docker (security review limitation L3). Build it,
> run the smoke test in §6, and fix anything that surfaces before treating this as proven.

## 1. What you need

| Component | Requirement | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | Or the container image in §3 |
| Database | PostgreSQL 17 (16 works) | Managed with automated backups + PITR ([backup-restore.md](backup-restore.md)) |
| Extensions | `citext`, `pg_trgm`, `pgcrypto` | Created by migration `0000`; the app role needs rights to create them, or a superuser runs `0000` once |
| TLS | Terminated at the proxy/load balancer | HSTS is already sent by the app; do not serve plain HTTP |
| Outbound | Only to the AI provider, and only if enabled | No other egress is required |

One instance is enough for V1. The job queue is PostgreSQL-backed (pg-boss), so a second instance
works without extra infrastructure, but see the purge-job note in §5.

## 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL connection string. Use a dedicated, non-superuser application role. |
| `AUTH_SECRET` | **yes** | Server-side key for salted IP/identifier hashes. 32 random bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Rotating it invalidates rate-limit and audit hash continuity (acceptable in an incident, not routinely). |
| `APP_BASE_URL` | **yes** | Public origin, e.g. `https://finpilot.example`. Used in password-reset links — a wrong value sends users somewhere else. |
| `NODE_ENV=production` | yes | Enables the nonce-based CSP and secure cookies. Set by the image. |
| `AI_PROVIDER` | no | Unset/anything else → deterministic stub, zero external calls. `anthropic` selects that adapter (ADR-012). |
| `ANTHROPIC_API_KEY` | only with `AI_PROVIDER=anthropic` | Provider credential. |
| `AI_MODEL` | no | Overrides the adapter's default model. |
| `AI_DISABLED` | no | `1` refuses every generative call at the gateway — the product kill switch. |
| `LOG_LEVEL` | no | pino level, default `info`. |
| `PORT` / `HOSTNAME` | no | Default `3000` / `0.0.0.0`. |

`DEV_MAIL_DIR` is development-only. **There is no production mailer adapter yet** — password-reset
emails will not be delivered until one is implemented (see [launch-checklist.md](launch-checklist.md)).

Never bake secrets into the image; inject them at runtime from your platform's secret store.

## 3. Container image

```bash
docker build -t finpilot:$(git rev-parse --short HEAD) .
```

Three stages (`Dockerfile`): `build` (full install + `next build`), `migrate` (release step), and
`runtime` (default — Next.js standalone output, non-root user `finpilot:1001`, `HEALTHCHECK`
against `/api/health`). Production dependencies are installed with `--omit=dev` semantics via
tracing, so the development-only embedded PostgreSQL never ships.

**`.dockerignore` is a security control, not tidiness.** Next.js standalone output mirrors what is
present in the build context — including `.env` if you leave it there. The provided
`.dockerignore` excludes `.env*`, `tests`, `docs`, and local database/mail state, which is what
keeps them out of the image. After building, verify:

```bash
docker run --rm --entrypoint sh finpilot:TAG -c 'ls -a; ls node_modules | wc -l'
# expect: no .env, no tests/, no docs/
```

## 4. Release procedure

Order matters: migrations are forward-only, so schema goes first and code follows.

```bash
# 0. Back up (mandatory before any migration against a non-local database).
pg_dump "$DATABASE_URL" -Fc -f "pre-release-$(git rev-parse --short HEAD).dump"

# 1. Apply migrations to completion, then verify.
docker build --target migrate -t finpilot-migrate:$(git rev-parse --short HEAD) .
docker run --rm -e DATABASE_URL="$DATABASE_URL" finpilot-migrate:$(git rev-parse --short HEAD)
#    → "Migrations up to date — N applied."

# 2. Roll the app.
docker run -d --name finpilot -p 3000:3000 \
  -e DATABASE_URL="$DATABASE_URL" -e AUTH_SECRET="$AUTH_SECRET" \
  -e APP_BASE_URL="https://finpilot.example" \
  finpilot:$(git rev-parse --short HEAD)

# 3. Verify.
curl -fsS https://finpilot.example/api/health
```

**Rollback** = redeploy the previous image tag. Do **not** revert migrations; if a migration is
wrong, write a new forward migration (ADR-017). If the schema change is incompatible with the old
code, restore the pre-release dump instead ([backup-restore.md](backup-restore.md) §6).

## 5. Background jobs

`src/instrumentation.ts` registers workers on boot: import validate/commit, and the daily account
purge (`account.purge`, 03:30 Asia/Kuala_Lumpur) that finalizes staged deletions. Notes:

- If worker registration fails, the app still serves — imports report a queue error and the purge
  waits for the next healthy boot. Watch `queue.failed` in `/api/health`.
- pg-boss schedules are stored in the database, so **N instances do not mean N purges** — the job
  is claimed once. It is idempotent regardless (already-purged users no longer match).
- The purge needs `AUTH_SECRET` for its audit subject hash; registration throws without it.

## 6. Post-deploy smoke test

1. `GET /api/health` → `ok: true`, `db: "up"`, expected `migrations` count.
2. Sign up a throwaway account; confirm the onboarding redirect.
3. Add an account and a transaction; confirm Overview shows them.
4. `GET /legal/privacy` signed out → renders in both languages.
5. Settings → Data → **Download my data** → a ZIP arrives.
6. Response headers include `content-security-policy` with a `nonce-`, `strict-transport-security`,
   and **no** `x-powered-by`.
7. Delete the throwaway account; confirm the restore gate appears on sign-in.

## 7. Hardening checklist

- [ ] Database role is not a superuser and owns only the app schema.
- [ ] `AUTH_SECRET` is unique per environment and stored in a secret manager.
- [ ] TLS enforced end to end; HTTP redirects to HTTPS at the edge.
- [ ] Backups automated **and** a restore drill has been run against this environment.
- [ ] Uptime and certificate-expiry monitors live ([observability.md](observability.md) §5).
- [ ] Container image scanned; base image patched on a schedule.
- [ ] Logs shipped somewhere durable, with retention set.
