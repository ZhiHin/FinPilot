# FinPilot — Backup & Restore Runbook

**Status:** drill executed 18 August 2026 against the development database — results in §5.
Referenced by ERD doc §6 (migration workflow) and spec V5.

The database is the only stateful component. There is no file storage in V1 (uploaded statements
are discarded after import), so **the database backup is a complete backup**.

## 1. What to back up

| What | How | Frequency | Retention |
|---|---|---|---|
| PostgreSQL data | Managed provider PITR / automated snapshots | continuous (WAL) + daily snapshot | 30 days |
| Logical dump (`pg_dump -Fc`) | The command in §2 | daily, off-site | 30 days |
| `.env` / secrets | Secret manager, **never** in the dump or repo | on change | versioned by the manager |

Both layers matter: PITR recovers from "an hour ago"; the logical dump survives provider-account
loss and is the only artifact that restores onto a *different* provider.

## 2. Take a backup

```bash
# Custom format: compressed, selective restore, parallel restore.
pg_dump "$DATABASE_URL" -Fc -f "finpilot-$(date +%Y%m%d-%H%M).dump"

# Verify it is readable before trusting it (lists contents, restores nothing).
pg_restore --list "finpilot-20260818-1030.dump" | head
```

A dump you have never restored is a hypothesis, not a backup. Run §4 quarterly.

**Always dump before a migration against any non-local database** (ERD doc §6 rule 6). Migrations
are forward-only; the dump is the rollback.

## 3. Restore into a fresh database

```bash
createdb finpilot_restored
pg_restore -d finpilot_restored --no-owner --no-privileges "finpilot-20260818-1030.dump"

# Confirm the schema is complete and migrations are all applied.
psql -d finpilot_restored -Atc "select count(*) from drizzle.__drizzle_migrations"   # expect 18
npm run db:migrate            # against the restored URL: must report "no pending"
```

`--no-owner --no-privileges` lets the dump land under whatever role the target uses. Restore the
application role's grants from your provisioning, not from the dump.

## 4. Verification checklist (what "restored" must mean)

Run against source and restored databases and compare — identical output on every line:

```sql
select 'transactions=' || (select count(*) from transactions)
    || ' accounts='    || (select count(*) from accounts)
    || ' budgets='     || (select count(*) from budgets)
    || ' goals='       || (select count(*) from savings_goals)
    || ' scenarios='   || (select count(*) from scenarios)
    || ' journal='     || (select count(*) from journal_entries)
    || ' migrations='  || (select count(*) from drizzle.__drizzle_migrations)
    || ' txn_md5='     || md5(coalesce((select string_agg(t.id::text || t.amount_minor::text, '|' order by t.id)
                                        from transactions t), ''));

select 'tables='   || (select count(*) from information_schema.tables where table_schema='public')
    || ' triggers='|| (select count(*) from information_schema.triggers where trigger_schema='public')
    || ' checks='  || (select count(*) from information_schema.table_constraints
                       where constraint_schema='public' and constraint_type='CHECK')
    || ' indexes=' || (select count(*) from pg_indexes where schemaname='public');
```

The checksum matters more than the counts: it proves **amounts** survived, not just row counts.
The second query proves the guard triggers and check constraints came back — a restore that loses
them silently disables the ledger's invariants.

Then, before serving traffic: point a staging app at the restored database and confirm
`/api/health` reports `db: "up"` with the expected migration count, sign in, and open Overview.

## 5. Drill record — 18 August 2026

Executed end to end against the development database (PostgreSQL 17.10, 925 transactions):

| Step | Result |
|---|---|
| `pg_dump -Fc` | exit 0, 224,167 bytes |
| `createdb` + `pg_restore --no-owner --no-privileges` | exit 0, no errors |
| Data comparison | **identical** — `transactions=925 accounts=7 budgets=0 goals=0 scenarios=0 journal=0 migrations=18 txn_md5=12685aa56ec03b338a4f4fc065548cad` on both |
| Schema comparison | **identical** — `tables=38 triggers=33 checks=358 indexes=102` on both |
| Cleanup | drill database dropped, dump deleted |

Drill artifacts are deliberately not committed.

## 6. Recovery scenarios

| Scenario | Action | Expected data loss |
|---|---|---|
| Bad migration | Restore the pre-migration dump into a fresh database, repoint, then fix the migration forward. | Writes since the dump |
| Accidental mass delete by a user | Most deletes are **soft** (`deleted_at`) — clear the column instead of restoring. Hard purges are irreversible by design. | None (soft) |
| Provider/region outage | Restore the latest off-site dump onto a new instance; run §3 and §4. | Up to one day |
| Corruption discovered late | PITR to just before the first bad write; if the window has passed, use the newest clean dump. | Depends on detection lag |
| Purge job ran on the wrong account | Restore to a scratch database, extract that user's rows, re-insert. **This is why the purge writes row counts to the audit log** — they tell you what should come back. | None if a backup covers the purge time |

## 7. Rules

1. Never restore a production dump onto a developer machine — it is real personal data. Use the
   demo seed (`npm run db:seed:demo`).
2. Dumps are personal data: encrypt at rest, restrict access, delete on the retention schedule.
3. Record every restore (who, when, which dump, why) — restores touch everyone's data.
4. Test the *documented* commands during a drill, not remembered ones; if a command here is wrong,
   the drill's job is to find that.
