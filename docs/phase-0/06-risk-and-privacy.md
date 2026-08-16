# FinPilot — Privacy, Threat, Failure-Mode & Risk Analysis (Phase 0)

---

## 1. Privacy analysis (PDPA-oriented)

FinPilot handles personal financial data for Malaysian users, so we design against the **Personal
Data Protection Act 2010 (PDPA)** principles, including the 2024 amendments (breach notification,
data-portability direction, DPO expectations). **This documents our engineering posture; it is not a
claim of legal compliance certification — legal review is required before public launch.**

| PDPA principle | Engineering commitment |
|---|---|
| General / consent | Explicit consent at sign-up (terms + privacy notice); **separate explicit consent for generative-AI processing** (`ai_consent_at`), revocable at any time (Privacy Mode). Consent changes audited. |
| Notice & choice | Privacy notice in plain language (en-MY now; ms-MY translation post-MVP — PDPA expects BM availability, tracked as a launch blocker in the risk register). Settings → Privacy discloses per-feature: what data, what shape, sent where, why. |
| Disclosure | No sale, no ads, no third-party disclosure except the configured AI provider (minimized aggregates only) and infrastructure processors — all listed in the notice. |
| Security | §2 threat model; Argon2id, TLS-only, encrypted attachments, signed short-lived URLs, secret management, audit logs, redacted logging. |
| Retention | User-configurable retention (`data_retention_months`); import raw files deleted after job completion (only staged rows + metadata kept); staged account deletion: deactivate → 30-day recovery window → purge job hard-deletes and writes a purge audit record. |
| Data integrity | User-correctable records everywhere; reconciliation flow; import review before commit. |
| Access & portability | Full self-service export (CSV, formula-injection-safe) of every user-owned entity; account data viewable in-app. |

**Data minimization decisions:** no national ID, no phone requirement, no address; birth date not
collected (not needed for any feature); IP stored only as salted hash for rate limiting/audit;
AI provider receives pre-aggregated, ID-stripped shapes (e.g. category totals, deltas, reason
codes) — never full transaction dumps, account numbers, or free-text notes unless a specific tool
schema requires a normalized merchant name. Synthetic data only in dev/test/demo.

## 2. Threat model

Assets: credentials/sessions, the financial ledger, attachments, AI consent state, audit trail.
Adversaries: external attackers, other authenticated users (horizontal escalation), malicious file/
CSV content, compromised AI provider path, curious insiders (operators).

### STRIDE summary by surface

| Surface | Primary threats | Mitigations (phase) |
|---|---|---|
| Auth (sign-in/up/reset) | Credential stuffing, brute force, enumeration, session fixation/theft | Argon2id, per-IP+identifier rate limits, enumeration-safe copy, opaque rotated sessions hashed at rest, HttpOnly/Secure/SameSite, reset tokens single-use/expiring/hashed (P1) |
| Every data endpoint | **IDOR / cross-user access**, mass assignment | Service-layer `user_id` scoping from session only; Zod strips unknown fields; per-entity isolation tests in CI (P1→continuous) |
| Transactions/UI | XSS via merchant names, notes, CSV-sourced strings | React escaping, no `dangerouslySetInnerHTML` on user content, CSP without `unsafe-inline` scripts, sanitized attachment filenames (P2+) |
| SQL layer | Injection | Drizzle parameterized queries only; raw SQL requires review + parameter binding; no string-built SQL (P1) |
| CSV import | Malformed/hostile files: zip bombs, encoding tricks, 10⁶-row DoS, formula payloads, path tricks in filenames | Type/size/row-count limits, streaming parse, encoding whitelist, content stored as data only, filenames sanitized, per-user import rate limits (P3) |
| CSV export | **Formula injection** (`=`, `+`, `-`, `@`, tab/CR prefixes) | Prefix-escape on export of any user-influenced cell; test fixture (P4) |
| Attachments | Malware upload, MIME spoofing, unauthorized fetch | Magic-byte + MIME + size validation, scan hook (`scan_status`), private storage keys, signed short-lived per-user URLs, no direct bucket exposure (P2) |
| AI assistant | **Prompt injection** via merchant/description/notes/receipt text; data exfiltration via tool abuse; instruction smuggling in tool outputs | Data/instruction delimitation, fixed tool registry with server-injected `user_id`, Zod I/O validation, row caps, no SQL generation, numeric re-verification, injection fixture suite, refusal boundaries (P8) |
| AI provider path | Over-sharing financial data, provider logging | Minimized aggregate payloads, consent gate, Privacy Mode kill-path, `ai_requests` metadata-only logging, provider DPA review pre-launch (P8) |
| SSRF | Future webhook/import-URL features | No user-supplied URL fetching in MVP; if added: allowlist + metadata-IP block (n/a) |
| Resource abuse | Expensive analytics/forecast/assistant hammering | Per-user rate limits on heavy endpoints, job queue backpressure, query row caps, statement timeouts (P4/P7/P8) |
| Operators/insiders | Casual data browsing | Read-only prod role for inspection, audited access, redacted logs — amounts/descriptions never in logs (P1→) |
| Supply chain | Malicious/vulnerable dependencies | Lockfiles, Dependabot/audit in CI, minimal dependency policy, pinned GitHub Actions (P1→) |

Breach readiness (PDPA 2024): incident runbook in Phase 10 including notification obligations,
audit-log forensics, and session mass-revocation procedure.

## 3. Failure-mode analysis (product correctness under things going wrong)

| Failure | Blast radius | Design response |
|---|---|---|
| Wrong/duplicated import commit | Corrupted ledger, wrong balances everywhere | Nothing commits before explicit confirm; idempotency key + content hashes; single DB transaction; post-commit undo window (soft-delete batch by `import_job_id`) |
| Miscategorization at scale (bad rule or model drift) | Budgets/insights become nonsense | Rules preview before apply; "apply to existing" limited to unreviewed txns; low-confidence → Needs Review; bulk re-categorize + rule versioning; AI never overwrites explicit user rules |
| Forecast/safe-to-spend wrong (bad recurring inference, unannotated one-off) | User overdraws trusting us — worst trust failure | Ranges not points; confidence surfaced; confirmed vs inferred separated; journal annotations excluded from baselines; conservative band drives "safe" framing; formulas itemized in the why-drawer |
| Anomaly detector flags normal big purchase as "fraud-like" | Anxiety, alert fatigue, churn | User-specific baselines, robust statistics, calm copy ("unusual", never "fraud"), threshold tuning, dedup, quiet hours |
| AI provider outage/latency | Insights/assistant unavailable | Deterministic fallback templates render the same facts; assistant shows outage state; zero core-feature dependency on the provider |
| LLM hallucination (numbers or causes) | Wrong financial claims | Numeric re-verification against tool results before render (mismatch → deterministic text); no free-form causal claims without reason codes; golden fixtures |
| Job queue stuck/backlog | Stale forecasts, missed alerts | Staleness metadata surfaced ("as of 14 Aug"), queue-depth alerting, idempotent re-runs, dead-letter handling |
| Balance drift (bug in aggregate math) | Silent wrong balances | Balances always derived from ledger (no dual-write), reconciliation snapshots detect drift, invariant tests on every aggregate rule |
| Partial multi-record write (split/transfer/rollover) | Broken invariants | All multi-record mutations in DB transactions + deferred constraint triggers; invariant checks in CI and a periodic integrity job |
| Data loss | Everything | Managed Postgres PITR + tested restore runbook (P10); export gives users their own copy anytime |
| Clock/timezone bugs (payday on weekend, DST-free but UTC+8 offsets) | Wrong cycle boundaries, wrong "today" | All cycle math in user timezone via tested date lib; `cycle_anchor` resolver fixture-tested around weekends/holidays/month-ends (incl. Feb) |

## 4. Risk register

Scoring: Likelihood × Impact, High/Med/Low. **P1-tagged** mitigations land in Phase 1 and appear in
the backlog. Owner is a role (solo-dev project: all "builder" today, split for clarity).

| ID | Risk | L | I | Score | Mitigation | Owner | When |
|----|------|---|---|-------|------------|-------|------|
| R1 | Cross-user data leak (IDOR class) | M | H | **High** | Service-layer scoping pattern + per-entity isolation tests in CI from the first entity; no repository method without `user_id` | Eng | P1 → every phase |
| R2 | Users lose trust after one wrong number (safe-to-spend/forecast) | M | H | **High** | Deterministic math with unit tests; ranges + confidence; explanation drawers; conservative defaults; seed-reconciliation test | Product/Eng | P4–P7 |
| R3 | Self-built auth has a flaw | M | H | **High** | Keep surface minimal, follow OWASP ASVS checklist, focused test suite, external review in P10 | Eng | P1, P10 |
| R4 | Import corrupts ledger / duplicates silently | M | H | **High** | Idempotency design (ERD §4), confirm-gate, undo window, fixture suite incl. hostile files | Eng | P3 |
| R5 | Scope creep — differentiators (Scenario Lab, explainable AI) arrive late and thin | H | M | **High** | Phase gates with review stops; MVP table is the contract; deterministic core first (ADR-011) | Product | Every phase |
| R6 | Prompt injection exfiltrates or fabricates data | M | M | Med | Tool-registry design, data delimitation, verification pass, golden injection fixtures | Eng/AI | P8 |
| R7 | AI cost blowout (per-txn LLM calls, chatty assistant) | M | M | Med | ADR-013 (no per-txn LLM), token budgets per feature, `ai_requests` spend metric, caching of phrasings | Eng/AI | P8 |
| R8 | Recurring/BNPL detection accuracy poor on real MY data | M | M | Med | Tolerance-based detection with confidence; confirmed vs inferred split; user confirm loop; tune on demo + early-user feedback | Eng | P6 |
| R9 | Alert fatigue → notifications ignored/disabled | M | M | Med | Dedup keys, thresholds, quiet hours, digest batching, calm copy; "risk" severity rationed | Product | P6 |
| R10 | PDPA gap (BM notice, breach process, provider DPA) blocks launch | M | H | **High** | Track as launch checklist; legal review before public release; posture already documented (§1) | Product | P10 |
| R11 | Performance collapse on large ledgers (10k+ txns) | M | M | Med | Keyset pagination, index plan, 10k seed perf test in CI, RSC payload discipline | Eng | P2, P4 |
| R12 | Solo-bus-factor / phase stall | M | M | Med | Everything documented (this set); phases independently shippable; forward-only migrations keep DB safe | Product | — |
| R13 | Payday-cycle math wrong around holidays/month-ends | M | M | Med | Materialized periods (ADR-014) + resolver fixtures incl. MY public holidays | Eng | P5 |
| R14 | Demo data leaks into real accounts (or vice versa) | L | H | Med | Demo is a flagged seed under the user's own id, banner-labeled, one-click wipe (`seed origin` tag on rows); export excludes demo by default | Eng | P1–P2 |
| R15 | Vendor lock (AI provider, queue, storage) | L | M | Low | Interfaces: `AIProvider`, `JobQueue`, `FileStorage` (ADRs 006, 012, A18) | Eng | P1, P8 |
| R16 | Chart accessibility failures (color-only meaning, no alternatives) | M | M | Med | Design-system chart kit with enforced table alt + validated palette + relief rule; axe checks in e2e | Design/Eng | P4 → every chart |

Review cadence: register revisited at every phase gate; new risks get IDs, closed risks stay listed
with resolution notes.
