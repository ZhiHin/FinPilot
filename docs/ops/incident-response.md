# FinPilot — Incident Response & Breach Runbook

Covers security incidents generally and **PDPA 2010 (as amended 2024) breach notification**
specifically. Closes the breach-readiness item in the risk doc §2 and spec V6.

> This is an engineering runbook, not legal advice. Notification decisions are made **with the
> operator's legal adviser**; this document makes sure the facts they need exist and are reachable.

## 1. Severity

| Sev | Definition | Response |
|---|---|---|
| **S1** | Personal data confirmed or likely exposed to an unauthorized party; or attacker control of the app/database. | Immediately; PDPA clock starts (§4) |
| **S2** | Exploitable vulnerability found, no evidence of exploitation; or credential-stuffing success against some accounts. | Same day |
| **S3** | Availability loss with no data exposure (outage, stuck queue, failed deploy). | Business hours; use [backup-restore.md](backup-restore.md) |
| **S4** | Low-risk finding: dependency advisory, hardening gap. | Next work cycle |

When unsure between S1 and S2, treat it as S1. Downgrading later is cheap; a late start is not.

## 2. First 60 minutes (S1/S2)

1. **Write it down.** Open a timestamped incident log — every action, every finding, in UTC+8.
   Everything downstream (notification, post-mortem) depends on this being contemporaneous.
2. **Preserve evidence before changing anything.** Snapshot the database
   (`pg_dump -Fc`, §2 of the backup runbook) and copy the current logs off the host. Rebuilding a
   container destroys the evidence you will need to scope the breach.
3. **Contain**, cheapest effective action first:
   - Suspected credential/session theft → revoke sessions (§3.1).
   - Vulnerable code path → disable the feature (`AI_DISABLED=1` for the AI path) or roll back to
     the previous image; migrations are forward-only, so roll back **code**, not schema.
   - Compromised host or database credentials → rotate `AUTH_SECRET` and the database password
     (note: rotating `AUTH_SECRET` invalidates rate-limit/audit subject-hash continuity, which is
     acceptable in an incident), then redeploy.
4. **Assess scope** with the queries in §3 — which accounts, which data, what time window.
5. **Notify the operator/DPO** with: what happened, what data, how many people, containment status,
   and whether §4's thresholds look met.

## 3. Tools

### 3.1 Mass session revocation

```sql
-- One account.
update sessions set revoked_at = now() where user_id = $1 and revoked_at is null;

-- Everyone (forces a global re-login; use for suspected token/secret compromise).
update sessions set revoked_at = now() where revoked_at is null;
```

Sessions are validated against the database on every request, so revocation takes effect on the
next request — no cache to wait out. Password reset tokens:
`update password_reset_tokens set used_at = now() where used_at is null;`

### 3.2 Scoping queries

```sql
-- What did this account do, and from which source?
select created_at, event_type, entity_type, entity_id, ip_hash
from audit_logs where user_id = $1 order by created_at desc;

-- Everything one source did across accounts (ip_hash is salted — compare, never decode).
select user_id, event_type, count(*), min(created_at), max(created_at)
from audit_logs where ip_hash = $1 group by 1, 2 order by 4;

-- Did data leave? Exports are the bulk-egress path and every one is audited.
select user_id, created_at, event_type, diff
from audit_logs where event_type in ('export.transactions', 'export.account')
  and created_at > $1 order by created_at;

-- Successful sign-ins after a suspected compromise window.
select user_id, created_at from audit_logs
where event_type = 'auth.sign_in' and created_at between $1 and $2 order by created_at;
```

`export.account` rows are the strongest signal available: they record that a full personal-data
archive was generated, for whom, and how many rows.

### 3.3 What an attacker could *not* have taken

Facts that legitimately narrow a breach assessment — verify they still hold before relying on them:

- Passwords are Argon2id hashes; session and reset tokens are stored as SHA-256 hashes. Database
  read access does not yield usable credentials.
- Uploaded statement files are never stored — only confirmed rows.
- IPs and identifiers in `audit_logs` are salted hashes, not raw values.
- No card numbers, bank account numbers, national ID, phone, or address are collected at all.

## 4. PDPA notification

The 2024 amendments require notifying the **Personal Data Protection Commissioner** where a breach
causes or is likely to cause significant harm, and notifying **affected data subjects** where the
risk to them is significant. Financial data raises the likelihood of "significant harm" — assume
notification is required until legal advice says otherwise.

**Target: notify the Commissioner as soon as practicable, and no later than 72 hours after
becoming aware.** Start drafting at hour one; a partial notification on time beats a complete one
late.

Assemble (all obtainable from §3):

- what happened and when (discovery time *and* estimated occurrence time);
- categories of personal data involved — ledger records, email, preferences;
- number of affected data subjects and the query used to derive it;
- likely consequences;
- containment and remediation steps taken and planned;
- contact point for enquiries.

Subject notification must be in plain language, in **English and Bahasa Melayu** (the same pairing
as the [privacy notice](/legal/privacy)), and must tell people what to do — change password, review
recent transactions, watch for phishing that references FinPilot.

## 5. After

- **Post-mortem within a week**: timeline, root cause, why detection took as long as it did, and
  the specific control that would have prevented or caught it. Blameless.
- **Land the fix as a test first** — the regression suite is where "never again" is enforced.
- **Update the risk register** ([../phase-0/06-risk-and-privacy.md](../phase-0/06-risk-and-privacy.md) §4)
  with the realized risk and its new score.
- **Re-run the drill** if the incident touched backups or deletion.

## 6. Contacts

Fill in before launch — an unfilled table is a launch blocker
([launch-checklist.md](launch-checklist.md)).

| Role | Who | Reachable at |
|---|---|---|
| Incident lead | _TBD_ | |
| Data protection officer / legal | _TBD_ | |
| Hosting provider support | _TBD_ | |
| Database provider support | _TBD_ | |
| AI provider contact (if enabled) | _TBD_ | |
