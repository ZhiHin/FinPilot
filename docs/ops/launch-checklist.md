# FinPilot — Production V1 Launch Checklist

Closes spec **V6**. Status as of 18 August 2026, end of Phase 10.

**Overall: engineering is ready; launch is blocked on four items** — a production mailer, legal
review of the privacy notice, an AI provider agreement (only if generative AI is enabled), and
filling in the incident contacts. Everything blocking is listed in §1, honestly, with an owner.

Legend: ✅ done and verified · ⛔ **blocks launch** · 🟡 do soon after launch · ➖ not applicable to V1

---

## 1. Blockers — must clear before public launch

| # | Item | Why it blocks | Owner |
|---|---|---|---|
| ⛔ B1 | **Production mailer.** Only a development mailer exists (`createDevMailer` writes JSON files). Password-reset emails are not delivered. | A user who forgets their password is permanently locked out — the recovery path is dead. | Eng |
| ⛔ B2 | **Legal review of the privacy notice** (`/legal/privacy`, English + Bahasa Melayu) and the sign-up consent copy. | The notice states an engineering posture, not vetted legal text; PDPA notice-and-choice compliance is a legal judgement. Risk R10. | Product + legal |
| ⛔ B3 | **AI provider data-processing agreement** — required only if shipping with `AI_PROVIDER` set. Launching with the deterministic stub (or `AI_DISABLED=1`) clears this item by making it not applicable. | Disclosing personal data to a processor without an agreement is a PDPA disclosure-principle failure. | Product + legal |
| ⛔ B4 | **Incident contacts filled in** ([incident-response.md](incident-response.md) §6) and the DPO/responsible person named. | A breach runbook nobody can execute is not a runbook; the 72-hour clock does not pause while you look for a phone number. | Product |

## 2. Security

| Status | Item | Evidence |
|---|---|---|
| ✅ | Security review complete, no High/Critical open | [security-review.md](security-review.md) |
| ✅ | **RLS reconsidered and decided** (ADR-010 → ADR-018) | security review §1; architecture doc §7 |
| ✅ | Cross-user isolation tested for every entity, including tampered ids and unauthenticated access | integration suites, every phase |
| ✅ | Purge leaves zero rows in every `user_id` table; control user untouched | `account-deletion.test.ts` |
| ✅ | Argon2id, hashed opaque sessions, single-use reset tokens, rate limits | `auth-service.test.ts` |
| ✅ | Formula-injection-safe exports (transactions + full archive) | `export.test.ts`, `archive.test.ts`, `exports.test.ts` |
| ✅ | Logs carry no financial detail or secrets (G6) | `logger.test.ts` |
| ✅ | Per-user AI call budget; Privacy Mode makes zero external calls | `ai.test.ts`, `ai.spec.ts` (network assertion) |
| ✅ | Security headers + nonce CSP; no `x-powered-by` | `next.config.ts`, `proxy.ts`, smoke test §6 |
| ✅ | Production dependency audit clean (`npm audit --omit=dev`) | security review F4 |
| ⛔ | External security review of the self-built auth (risk R3) | not done — solo project; see security review L1. **Not a blocker for a private/beta launch; is one for a public launch.** |
| 🟡 | Container image vulnerability scan on a schedule | needs the image built first ([deployment.md](deployment.md)) |

## 3. Privacy & PDPA

| Status | Item | Evidence |
|---|---|---|
| ✅ | Privacy notice published in **English and Bahasa Melayu**, reachable signed out | `/legal/privacy`, linked from sign-in and Settings → Privacy |
| ✅ | Separate, revocable consent for generative AI; Privacy Mode kill switch | Settings → Privacy & AI |
| ✅ | Self-service export of all personal data, machine-readable | Settings → Data |
| ✅ | Self-service deletion: staged, 30-day recovery, permanent purge, fully audited | Settings → Data → Delete my account |
| ✅ | Data minimization holds (no national ID, phone, address, DOB; IPs salted-hashed) | schema review |
| ✅ | Breach runbook with notification thresholds and scoping queries | [incident-response.md](incident-response.md) |
| ✅ | Uploaded statement files discarded after import | `imports` service |
| ⛔ | Legal review (B2) and provider agreement (B3) | above |
| 🟡 | Configurable retention window that trims old history | not built — Settings → Data says so plainly; deletion covers the PDPA right |

## 4. Reliability & operations

| Status | Item | Evidence |
|---|---|---|
| ✅ | Backup **and restore** drilled with byte-level verification | [backup-restore.md](backup-restore.md) §5 |
| ✅ | Health endpoint exposing db, migrations, queue depth | `/api/health` |
| ✅ | Structured, scrubbed logging | [observability.md](observability.md) |
| ✅ | Release procedure with forward-only migrations and rollback | [deployment.md](deployment.md) §4 |
| ✅ | Daily purge job scheduled and idempotent | `workers.ts`, `account-deletion.test.ts` |
| ⛔/🟡 | Container image **built and smoke-tested** in the target environment | not possible here (no Docker); do it before first deploy |
| 🟡 | Uptime, certificate, and backup-age monitors live | [observability.md](observability.md) §5 |
| 🟡 | Managed PostgreSQL with PITR provisioned | provider choice pending |

## 5. Product quality

| Status | Item | Evidence |
|---|---|---|
| ✅ | Every route is real — no placeholder pages left | `shell.spec.ts`, `release.spec.ts` |
| ✅ | WCAG 2.2 AA pass on critical screens: axe clean, keyboard, focus, chart table alternatives, reduced motion | `a11y.spec.ts`, `release.spec.ts`, per-phase specs |
| ✅ | Verified at 360 / 768 / 1024 / 1440 px | Playwright viewport specs |
| ✅ | Performance profiled at 10k transactions | [../progress/phase-10.md](../progress/phase-10.md) §performance |
| ✅ | Money is integer minor units end to end; float-money lint rule | `money.test.ts`, eslint rule |
| ✅ | Full suite green: unit, integration, e2e | phase-10 progress doc |
| ✅ | Demo seed idempotent and reconcilable | `seeds.test.ts`, `demo-financial.test.ts` |
| ✅ | AI numeric claims verified against deterministic math | `ai.test.ts` golden fixtures |

## 6. Sign-off

| Milestone | Criteria | Status |
|---|---|---|
| Core MVP (Phases 1–6) | C1–C9 | ✅ green |
| AI Beta (Phases 7–8) | B1–B8 | ✅ green |
| Production V1 (Phases 9–10) | V1–V6 | ✅ **V1–V5 green**; V6 = this checklist: engineering complete, **four launch blockers open** (§1) |

Nothing in §1 is an engineering task hiding behind a legal label except B1, which is a genuine
missing feature. The honest summary: **FinPilot is ready for a private beta with a real mailer;
public launch waits on legal review and the provider agreement.**
