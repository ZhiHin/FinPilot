# FinPilot — Observability

What you can see about a running FinPilot, and what you must never see. Closes the observability
half of spec V5.

## 1. Health endpoint

`GET /api/health` — unauthenticated by design, so its payload is strictly non-sensitive.

```json
{ "ok": true, "db": "up", "migrations": 18, "queue": { "pending": 0, "failed": 0 }, "uptimeSeconds": 412 }
```

| Field | Meaning | Alert when |
|---|---|---|
| `ok` / `db` | Database round-trip succeeded (HTTP 503 when not) | any 503 — page immediately |
| `migrations` | Rows in `drizzle.__drizzle_migrations` | value < the release's expected count (a release step was skipped) |
| `queue.pending` | pg-boss jobs `created`/`retry`/`active` | > 50 for 10 min (workers stalled or backlogged) |
| `queue.failed` | jobs that exhausted retries | > 0 (investigate; imports or the purge are stuck) |
| `uptimeSeconds` | Seconds since this instance booted | resets you did not deploy = crash-looping |

`null` for `migrations` or `queue` means the table/schema is not there yet — expected on a first
boot before migrations, alarming afterwards. The endpoint never returns user data, configuration
values, or version/build identifiers.

## 2. Structured logs

`src/server/observability/logger.ts` (pino) writes JSON lines to stdout — the container runtime
ships them. Use `logInfo` / `logWarn` / `logError` with a `scope` plus an optional context object.

**Every context object passes through `scrubForLogging()`**, which redacts by key name,
recursively, with depth and string caps:

- credentials — `password`, `*secret*`, `*token*`, `cookie`, `authorization`, `api_key`
- personal data — `email`, `phone`, `address`, `display_name`
- financial detail — `*amount*`, `*minor`, `*balance*`, `description*`, `note(s)`, `title`,
  `body`, `*merchant*`, `filename`, `search`, `question`, `prompt`, `diff`

What survives is what you can act on: ids, counts, durations, statuses, error class and message.
The unit suite (`logger.test.ts`) is the enforcement — it fails if a financial key stops being
redacted. `LOG_LEVEL` sets verbosity (default `info`).

**Do not** add `console.log` in server code; it bypasses scrubbing.

## 3. The audit trail is the security log

`audit_logs` is the durable record of who did what: auth events, session revocations, exports,
imports, AI approvals, journal outcome reviews, deletion requests and purges. It stores **salted
hashes** of IP and identifiers, never raw values, and never financial detail beyond counts.

Useful queries during an incident:

```sql
-- Everything one account did, newest first.
select created_at, event_type, entity_type, entity_id
from audit_logs where user_id = $1 order by created_at desc limit 200;

-- Failed sign-ins by source in the last hour (credential stuffing).
select ip_hash, count(*) from audit_logs
where event_type = 'auth.sign_in_failed' and created_at > now() - interval '1 hour'
group by ip_hash having count(*) > 20 order by 2 desc;

-- Accounts scheduled for deletion and when they will be purged.
select user_id, created_at, diff->>'purgeAfter' as purge_after
from audit_logs where event_type = 'account.deletion_requested' order by created_at desc;
```

The table is append-only (migration `0002_audit_append_only`): updates and deletes are rejected by
trigger, so the trail cannot be quietly rewritten.

## 4. AI spend and behaviour

`ai_requests` records every generative call as metadata only — feature, provider, model, prompt
version, token counts, duration, status (`ok` / `error` / `refused` / `fallback`), redacted error.
Users see their own rows on the AI activity page; operators can aggregate:

```sql
select date_trunc('day', created_at) as day, feature, status,
       count(*), sum(input_tokens + output_tokens) as tokens
from ai_requests group by 1, 2, 3 order by 1 desc;
```

Watch for: a rising `fallback` share (the model is producing numbers that fail verification), any
`refused` with `error_redacted = 'rate_limited'` (a user is hitting the hourly budget — expected
occasionally, suspicious in bulk), and token totals against your provider budget.

## 5. Recommended external monitors

Minimum viable set for V1:

1. **Uptime** — `GET /api/health` every minute from outside the network; page on two consecutive
   failures or any 503.
2. **Certificate expiry** — 14-day warning.
3. **Database** — provider metrics for connections (the pool caps at 10 per instance), disk, and
   replication/backup age. Alert if the newest successful backup is older than 26 hours.
4. **Log-based** — alert on `level:50` (error) volume spikes and on any `scope:"jobs.pgboss"` error.

No APM/error-tracking SaaS is wired in. If one is added later, it must receive **scrubbed** payloads
only — route it through `scrubForLogging` and update the privacy notice's disclosure section first.
