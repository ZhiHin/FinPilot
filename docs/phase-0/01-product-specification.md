# FinPilot — Product Specification (Phase 0)

FinPilot is a production-quality, responsive AI personal finance web application for individual users
in Malaysia. It helps a user understand where their money went, know what they can safely spend,
anticipate upcoming expenses, improve saving habits, and test financial decisions before making them.

It is **not** a bank. It never executes payments, moves money, or gives regulated investment, tax,
credit, or legal advice. Every AI output is explainable, evidence-backed, and subject to human
approval. All financial arithmetic is deterministic code, never LLM text.

---

## 1. Clarified assumptions

Assumptions were made wherever they could be made safely; each is recorded here so review can
overturn any of them before Phase 1. None of them, if reversed, changes the database schema in a
breaking way.

### Market and locale

| # | Assumption | Rationale |
|---|-----------|-----------|
| A1 | Single market at launch: Malaysia. Default currency MYR displayed as `RM 1,234.56`; default locale `en-MY`; default timezone `Asia/Kuala_Lumpur`. | Given in the brief. |
| A2 | The i18n layer ships in Phase 1 (message catalog, locale-aware formatting) but only `en-MY` strings are authored. `ms-MY` and `zh-MY` are catalog additions later, not architecture changes. | "Prepare the architecture" without paying full translation cost now. |
| A3 | Accounts may hold non-MYR currencies (e.g. a USD e-wallet), but the MVP does **not** convert between currencies. Cross-currency aggregation is blocked at the query layer; non-MYR accounts are shown separately with their own currency. FX conversion is a future feature. | Storing currency per record is required anyway; conversion adds rate-source complexity with little MVP value. |
| A4 | Dates shown to users are in `Asia/Kuala_Lumpur` (or the user's chosen timezone); storage is UTC `timestamptz` plus a separate local `date` for statement dates. | Statement dates are calendar dates with no meaningful time component. |

### Users and access

| # | Assumption | Rationale |
|---|-----------|-----------|
| A5 | One user = one household ledger. No shared/joint budgets, no multi-user accounts in MVP. | Multi-user introduces authorization complexity that would dominate early phases. |
| A6 | Web-first responsive app (360px–1440px). No native mobile app; the mobile web experience must be first-class, not an afterthought. | Given in the brief. |
| A7 | No consumer-facing admin panel. A minimal operational surface (migrations, job dashboard via CLI/DBeaver/pg-boss tables) is enough for development operations. | Brief explicitly discourages an admin panel unless strictly needed. |
| A8 | Email verification is soft in MVP: accounts work immediately; verification is required only before data export is emailed (not in MVP) and shown as a settings nudge. Password reset requires a working email path in production but is delivered via console/log adapter in development. | Avoids hard dependency on an email provider in early phases while keeping the token flow real. |

### Data and integrations

| # | Assumption | Rationale |
|---|-----------|-----------|
| A9 | All data enters via manual entry, CSV import, or demo seed. No live bank sync in MVP. A `StatementProvider` interface is designed now so a future authorized provider (e.g. an open-finance aggregator) can be added without schema change. | Brief: keep bank sync out of the first MVP. |
| A10 | CSV import supports the common Malaysian consumer formats: Maybank2u, CIMB Clicks, RHB, Bank Islam, HSBC MY exports, Touch 'n Go eWallet, GrabPay, and generic signed-amount / debit-credit-column CSVs. Formats are handled by user-configurable import profiles, not per-bank hardcoding; we ship starter profiles for the named formats using synthetic samples. | Real statement formats vary and change; profiles keep the wizard generic. |
| A11 | Receipts (attachments) are stored but not OCR-parsed in MVP. | OCR is a distinct pipeline; storage schema supports it later. |
| A12 | BNPL (SPayLater, Atome, GrabPayLater) appears as detected installment patterns from transactions, shown as *estimates* until the user confirms them. We never present inferred BNPL as verified debt. | Brief requirement; no BNPL provider API exists to verify against. |

### AI and analytics

| # | Assumption | Rationale |
|---|-----------|-----------|
| A13 | Generative AI is optional at two levels: product configuration (no provider key configured → generative features hidden, deterministic everything still works) and per-user Privacy Mode (user disables generative processing). Phases 1–7 build zero generative dependency. | Brief: Privacy Mode + hybrid pipeline. |
| A14 | The `AIProvider` interface is provider-independent; **the first adapter is selected in Phase 8 via configuration and environment variables** — no provider is implemented or bound before then. Anthropic is documented as the provisional candidate for planning purposes only, not an architectural commitment. Whatever the provider, only minimal, pre-aggregated, user-scoped data is sent — never full transaction dumps, never raw descriptions when a normalized form exists. | Amended at Phase 0 review: keep the provider decision reversible until Phase 8. |
| A15 | Categorization suggestions in MVP use deterministic rules + a lightweight scoring model (merchant/token/amount-band heuristics with per-user correction feedback), not an LLM per transaction. The LLM is reserved for explanations, the assistant, and low-volume suggestion generation. | Cost, latency, and determinism; per-transaction LLM calls don't scale for imports of thousands of rows. |
| A16 | Forecast horizons are 30/60/90 days with optimistic/expected/conservative bands from transparent statistical methods (recurring projection + robust baseline spend). No ML black-box forecasting in MVP. | Brief: transparent statistical methods first. |

### Operations

| # | Assumption | Rationale |
|---|-----------|-----------|
| A17 | Deployment target is a single Node.js runtime (e.g. a VPS or container platform) plus managed PostgreSQL 16+. Background jobs run in-process via a PostgreSQL-backed queue (pg-boss) — no Redis, no separate worker fleet in MVP. The job interface is replaceable. | Brief: prefer PostgreSQL-backed jobs, avoid unnecessary infrastructure. |
| A18 | File storage (receipts) is local-disk in development and S3-compatible object storage in production, behind a `FileStorage` interface with signed short-lived URLs. | Encryption + signed access requirement. |
| A19 | Development database administration is via DBeaver; the ERD doc includes a DBeaver workflow. DBeaver is not part of the runtime. | Given in the brief. |

## 2. Explicit non-goals

FinPilot will **not**, in any phase currently planned:

1. **Move money.** No payments, transfers between real banks, standing instructions, or account funding.
2. **Give regulated advice.** No investment recommendations, no individual securities, no tax
   computation, no credit counseling, no legal advice. Every forecast/recommendation carries
   "educational information, not financial advice."
3. **Guarantee outcomes.** No promised savings amounts, returns, or debt-freedom dates.
4. **Connect to banks without authorization.** No credential harvesting, no screen-scraping. Bank
   connectivity waits for a real authorized provider.
5. **Cancel services on the user's behalf.** Cancellation checklists and savings simulations only; we
   never claim a cancellation happened unless a supported integration confirms it (none in MVP).
6. **Act autonomously on financial data.** AI suggests; the user approves. No silent mutation of
   confirmed data, ever.
7. **Serve businesses.** No invoicing, GST/SST handling, payroll, or multi-entity bookkeeping.
8. **Social features.** No sharing, leaderboards, or comparison with other users.
9. **Crypto trading aesthetics or functionality.** No coin tickers, no real-time trading UI.
10. **Ads or data sale.** The data model and privacy posture assume user data is never monetized.

Deliberately deferred (not "never", but explicitly out of MVP): native mobile apps, PDF report
export, email delivery of notifications (architecture is email-ready), receipt OCR, `ms-MY`/`zh-MY`
translations, FX conversion, shared household ledgers, investment portfolio depth (holdings, prices),
open-finance bank sync.

## 3. Primary persona and jobs-to-be-done

### Primary persona — "Aisyah", the urban salaried professional

- 29, UX designer at a KL agency. Net salary **RM 5,200**, paid on the **25th** (moved earlier when
  the 25th hits a weekend/public holiday).
- Banks with Maybank (current account), keeps float in **Touch 'n Go eWallet** and **GrabPay**, has
  one credit card, an ASB investment she tops up ad hoc, and a **PTPTN** study-loan deduction.
- Spends via DuitNow QR, card, and e-wallets: Grab rides, food delivery, Shopee/Lazada (sometimes on
  **SPayLater/Atome** installments), mamak and kopitiam meals, Setel petrol, Unifi home internet,
  Hotlink postpaid, Netflix/Spotify/iCloud subscriptions.
- Money reality: comfortable but leaky. She doesn't know where ~RM800/month goes, gets surprised by
  annual renewals and bill clusters at month-end, and wants an emergency fund of 3 months' expenses
  but progress keeps stalling.
- Tech posture: fluent app user, privacy-aware, skeptical of AI that can't show its work, will
  abandon anything that nags or shames her.

### Secondary persona (design-considered, not MVP-optimized) — "Hafiz", variable-income gig worker

Grab driver + freelance photographer, irregular weekly income, cash-heavy. MVP supports him via
manual/cash transactions and income patterns with uncertainty, but income-smoothing features are
post-MVP. He exists in Phase 0 so income modeling isn't hardcoded to "monthly salary."

### Jobs-to-be-done

| # | When… | I want to… | So that… | Served by |
|---|-------|-----------|----------|-----------|
| J1 | I look at my money mid-month | know exactly what I can spend today and until payday without breaking anything | I can say yes/no to plans instantly | Safe-to-Spend Meter |
| J2 | My spending feels off | see *why* this month is different, with evidence | I can fix the real cause, not guess | Explainable Insight Cards |
| J3 | I'm considering a big purchase | test it against my real finances without touching real records | I decide with facts, not vibes | Scenario Lab / Digital Twin |
| J4 | Payday is coming | know which bills and renewals are about to land | I'm never surprised by a bill cluster | Resilience Forecast, Recurring |
| J5 | I download a bank statement | get it into the app quickly without duplicates or mis-mapped columns | my data stays trustworthy | Import wizard + profiles |
| J6 | I had an unusual month (travel, medical, moving) | mark it as one-off | AI doesn't wreck my budgets over it | Money Decision Journal |
| J7 | I'm trying to save | see whether my goal is on track and what would fix it | I stay motivated with honest numbers | Goals + what-if |
| J8 | An AI suggests something | review, edit, or reject it — and tell it why | I stay in control of my own ledger | Action Queue |
| J9 | I worry about my data | turn off generative AI and still get full value | I don't trade privacy for utility | Privacy Mode |

## 4. End-to-end user journeys

### Journey 1 — First hour: sign-up → onboarding → import → trust

1. Aisyah signs up with email/password; lands in the 5-step onboarding (locale/currency prefilled
   for `en-MY`/MYR/KL; payday pattern "25th, weekend-adjusted"; accounts: Maybank, TnG, credit card
   with opening balances; priorities: emergency fund; budget style: flexible; safety buffer RM 300).
2. Step 5 offers import or demo mode. She uploads a Maybank CSV. The wizard detects encoding and
   delimiter, she maps columns once (saved as an import profile), previews parsed dates/amounts,
   resolves 3 flagged rows (2 possible duplicates, 1 unparseable date), confirms.
3. Import summary: 214 added, 2 skipped as duplicates, 12 "needs review" categorizations. She sweeps
   the Needs Review queue — rules she accepts ("Grab* → Transport") apply to existing unreviewed rows.
4. The Overview now shows a real liquid balance, a safe-to-spend figure with its "why" expansion, and
   one insight with evidence. **Success criterion: within one session she sees a number she believes.**

### Journey 2 — Daily glance (the retention loop)

Open app → Overview answers three questions above the fold: *How much do I have? What can I spend
today/until payday? Is anything wrong?* One tap on Safe-to-Spend expands the reservation breakdown
("RM 420 reserved for bills, RM 200 for your goal, RM 150 buffer"). Total time: under 30 seconds.

### Journey 3 — "Why did I spend more this month?"

Insight card on Overview: "Food spending increased 23% vs July. Food delivery contributed RM 320 of
the RM 410 increase. Excludes 2 pending transactions. Confidence: High." → "How this was calculated"
drawer shows periods compared, contributing merchants, and the arithmetic. Optional actions: set a
food-delivery budget, open the transactions behind the number. In Privacy Mode the same card renders
from deterministic templates without LLM phrasing.

### Journey 4 — "Can I afford an RM 2,800 laptop next month?"

Scenario Lab → new scenario → one-time expense RM 2,800 on a chosen date. Center panel shows
projected balance with uncertainty band; right panel shows lowest expected balance (and date), goals
affected (emergency fund milestone slips 3 weeks), budget risk, and the earliest safer purchase date.
She saves the scenario "Laptop — Sept", later compares it against "Laptop — Nov" side by side. Real
records never change.

### Journey 5 — Monthly budget cycle (payday-aware)

On the 25th the budget period rolls (payday cycle, not calendar month). She copies last cycle's
budget, accepts two AI-suggested adjustments from the queue (each explains its baseline, ignored
outliers, and savings trade-off), edits one, dismisses one with a reason. Mid-cycle, pace-based
health warns "Dining is at 80% with 12 days left" only when intervention is actually useful.

### Journey 6 — Subscription audit

Recurring screen lists detected subscriptions with confidence and annualized cost. Evidence-backed
flags: "Spotify charged RM 23.90, previously RM 16.90 (price increase, 2 observations)", "iCloud and
Google One both active — possible duplicate storage". She confirms usage of one, opens a cancellation
checklist for the other, runs the savings simulation, and annotates the decision in the journal.
Three months later the journal shows whether the expected saving materialized.

### Journey 7 — Unusual month protection

Aisyah's December includes flights and hotels for a family wedding. She annotates the period
"Travel — one-time" in the Decision Journal. January's budget suggestions and anomaly baselines
exclude the annotated spending; the suggestion explains "December travel (RM 2,140, marked one-time)
was excluded from your baseline."

### Journey 8 — Privacy, export, deletion

Settings → Privacy: she reviews exactly which features use external AI and what data each sends,
disables generative AI (Privacy Mode), and the app states which surfaces switch to deterministic
rendering. Later she exports her full data as CSV (formula-injection-safe) and, when leaving, starts
staged account deletion: deactivation → recovery window → final purge, each step audited.

## 5. Milestones and feature priority table

*(Amended at Phase 0 review: delivery is structured as three product milestones, not one Phase 1–10
MVP.)*

- **Core MVP — Phases 1–6.** Foundation, authentication, accounts, transactions, categories and
  rules, CSV import, dashboard, analytics, budgets, goals, recurring transactions and subscriptions,
  notification centre. A complete, fully deterministic daily-use product with zero AI dependency.
- **AI Beta — Phases 7–8.** Deterministic intelligence (safe-to-spend, resilience forecasting,
  anomaly detection, budget suggestions), then the generative layer (AI categorisation suggestions,
  explainable insight cards, assistant, Action Queue, Privacy Mode, injection defenses).
- **Production V1 — Phases 9–10.** Scenario Lab, Money Decision Journal, hardening, security
  review, accessibility and performance passes, data export/deletion, release readiness.

**Post-V1** = after Production V1 ships. **Future** = directional, requires new decisions.

| Capability | Milestone | Phase | Notes |
|---|---|---|---|
| Email/password auth, sessions, reset, rate limiting | Core MVP | 1 | Passkeys/MFA/social login are future-ready architecture only |
| Onboarding (5 steps, save-and-resume, demo mode) | Core MVP | 1–2 | Demo seed = sample dataset (§7), seeded incrementally per phase |
| Settings: profile, currency, timezone, theme, privacy, AI consent, retention, export, delete | Core MVP → Production V1 | 1 (foundation) → 10 (export/delete) | |
| Manual accounts, balances, transfers (linked double entries), reconciliation | Core MVP | 2 | |
| Transactions CRUD, splits, merge duplicates, bulk edit, search/filter/sort, tags, soft delete/restore, change history | Core MVP | 2 | |
| Categories, groups, tags, rule builder (priority, preview, conflicts, apply-to-existing) | Core MVP | 2 | |
| CSV import wizard + reusable profiles + idempotent commit | Core MVP | 3 | Starter profiles for common MY formats |
| Overview dashboard, analytics workspace, reports, CSV export | Core MVP | 4 | PDF export post-V1 |
| Budgets (fixed/flexible/rollover/zero-based), payday cycles, pace-based health | Core MVP | 5 | |
| Savings goals & sinking funds, contribution forecasting, what-if controls | Core MVP | 5 | |
| Recurring detection, subscriptions, price-change review, BNPL estimates, bill calendar | Core MVP | 6 | |
| Notification centre, digest preferences, quiet hours, dedup | Core MVP | 6 | In-app only; email-ready architecture, no email delivery |
| Safe-to-Spend Meter with explanation drawer | AI Beta | 7 | Fully deterministic |
| Resilience forecast (30/60/90d, three bands), anomaly detection | AI Beta | 7 | Transparent statistical methods |
| Deterministic budget suggestions | AI Beta | 7 | LLM phrasing added in Phase 8 |
| AI provider abstraction, prompt versioning, AI activity page | AI Beta | 8 | Provider chosen in Phase 8 via config/env |
| Explainable insight cards (generative phrasing over verified aggregates) | AI Beta | 8 | Deterministic template fallback always available |
| AI assistant (structured tools, no SQL generation), suggestion Action Queue, feedback learning | AI Beta | 8 | |
| Privacy Mode (disable generative AI, full deterministic product) | AI Beta | 8 | Deterministic core exists from Phase 7 |
| Prompt-injection defenses + golden AI test fixtures | AI Beta | 8 | |
| Scenario Lab (save, compare, uncertainty), Money Decision Journal + outcome reviews | Production V1 | 9 | |
| Data export, staged deletion with purge, audit completeness, backup/restore docs, observability | Production V1 | 10 | |
| Email delivery of notifications/digests | Post-V1 | — | Adapter exists; provider + templates later |
| PDF reports | Post-V1 | — | |
| Receipt OCR → transaction prefill | Post-V1 | — | Attachments schema already supports it |
| `ms-MY`, `zh-MY` locales | Post-V1 | — | Catalog work only |
| WebAuthn passkeys, MFA, social login | Post-V1 | — | Auth service abstraction reserved |
| Income smoothing for variable earners | Post-V1 | — | Persona Hafiz |
| FX conversion + multi-currency aggregation | Future | — | Needs rate source decision |
| Bank sync via authorized open-finance provider | Future | — | `StatementProvider` interface designed now |
| Shared household ledgers | Future | — | Authorization model change |
| Investment holdings/prices | Future | — | Out of "not a broker" posture review |

## 6. Acceptance criteria by milestone

*(Amended at Phase 0 review: criteria are gated per milestone rather than one end-of-Phase-10 MVP
bar.)* (T) = verified by automated tests; others by manual review.

**Global gates — every phase, from Phase 1 onward**
- G1. Zero TypeScript errors, zero lint errors, all migrations apply cleanly forward from an empty
  database, full test suite green (T — CI gate).
- G2. New/changed screens verified at 360, 768, 1024, 1440 px (T — Playwright viewports) and pass
  keyboard-navigation, visible-focus, and axe checks (T).
- G3. All primary visible actions work; demo/simulated/unavailable/future items are labeled as such.
- G4. All money math is integer minor units; a lint rule/test rejects floating-point money
  arithmetic (T).
- G5. No user can read or mutate another user's records — enforced at the service layer and
  integration-tested for every entity the phase introduces, including tampered-ID payloads and
  unauthenticated access (T).
- G6. Audit events recorded for the phase's security-relevant actions; logs contain no raw
  financial detail or secrets (T — log scrubber test).

**Core MVP (end of Phase 6)**
- C1. Account transfers never change income/expense totals (T).
- C2. Transaction split amounts always sum exactly to the parent amount (T).
- C3. Refunds reduce net spending without double-counting either leg (T).
- C4. Excluded and pending transactions obey reporting rules in every aggregate — dashboard,
  analytics, budgets (T).
- C5. Re-running or retrying any import never duplicates records — idempotency keys + content
  hashes (T).
- C6. A new user reaches a trustworthy Overview (real or demo data) in under 10 minutes.
- C7. Every chart ships with a table alternative, tooltip, legend, and loading/empty/error states.
- C8. p95 under 2s for Overview and Transactions list with the 10k-transaction seed on commodity
  hardware.
- C9. Notifications are deduplicated, threshold-tunable, and respect quiet hours (T for dedup).

**AI Beta (end of Phase 8)**
- B1. Safe-to-Spend always shows its reservation breakdown; it renders a range when income/bill
  forecasts are uncertain (T for the math; manual for presentation).
- B2. Forecast bands are ordered (conservative ≤ expected ≤ optimistic) and every displayed figure
  matches deterministic computation (T).
- B3. Every insight card carries: conclusion, comparison period, contributors, absolute + % change,
  confidence, data-quality warnings, "How this was calculated," and optional actions.
- B4. No AI path can mutate confirmed financial data without explicit user approval through the
  Action Queue (T).
- B5. Every numerical claim in AI-generated text matches the deterministic calculation it cites
  (T — golden fixtures).
- B6. Privacy Mode delivers every deterministic feature with zero external AI calls (T — network
  assertion in e2e).
- B7. The assistant answers only from structured tool results, shows filters/period used, refuses
  out-of-scope requests, and survives the prompt-injection fixture suite (T).
- B8. The AI provider is bound only via configuration/environment; swapping providers requires no
  changes outside the adapter layer (T — a second stub adapter proves the interface).

**Production V1 (end of Phase 10)**
- V1. Scenario records never alter real balances, budgets, or goals (T).
- V2. Journal annotations correctly exclude one-off periods from baselines and suggestions (T).
- V3. WCAG 2.2 AA pass on all critical screens (Overview, Transactions, Budget, Import, Settings):
  keyboard, focus, screen-reader labels, reduced motion, chart alternatives (T + manual pass).
- V4. Data export (formula-injection-safe CSV) and staged account deletion with recovery window and
  final purge work end to end, fully audited (T).
- V5. Security review complete (including the recorded RLS reconsideration — see architecture
  ADR-010), performance profiling done, backup/restore runbook tested, observability live.
- V6. Launch checklist signed off, including PDPA items (BM privacy notice, breach runbook,
  provider agreements).

## 7. Sample dataset definition (demo seed)

One deterministic, seeded dataset (fixed RNG seed) used for demo mode, development, and tests. All
data is synthetic; merchant names are real Malaysian brands but no real persons, card numbers, or
account numbers appear.

- **Profile:** "Aisyah Demo", `en-MY`, MYR, `Asia/Kuala_Lumpur`, payday 25th (weekend-adjusted),
  safety buffer RM 300, flexible budget style.
- **Span:** 8 full months ending "last month," so month-over-month, budget history, recurring
  detection (≥3 observations), and 90-day forecasts all have data.
- **Accounts (7):** Maybank current (opening RM 4,850), Maybank savings (RM 12,000), TnG eWallet
  (RM 180), GrabPay (RM 45), Visa credit card (limit RM 8,000), ASB investment (tracking, RM 15,000),
  PTPTN loan (liability, RM 18,400).
- **Income:** salary RM 5,200 net on adjusted 25th; one RM 1,300 freelance payment; one RM 450
  Shopee refund (linked to its purchase).
- **Recurring outflows:** rent RM 1,600 (1st), Unifi RM 129, Hotlink postpaid RM 60, Netflix
  RM 54.90, Spotify RM 16.90→RM 23.90 (price change mid-series), iCloud RM 11.90, gym RM 129, PTPTN
  RM 200, car insurance RM 1,380 annual (single occurrence — tests annual-renewal detection limits),
  SPayLater phone installment RM 291.58 × 6 (4 observed, 2 remaining — BNPL estimate).
- **Variable spending:** ~90–130 transactions/month across mamak/kopitiam, Grab rides, GrabFood/
  foodpanda, Shopee/Lazada, Setel petrol, Village Grocer/99 Speedmart, pharmacies, cinemas — amounts
  drawn from realistic bands with weekday/payday-cycle seasonality.
- **Deliberate edge cases baked in:** 2 exact-duplicate rows (import dedup demo), 3 pending
  transactions, 1 split transaction (Shopee order across two categories, part reimbursable), 1
  account-to-account transfer pair (must not count as income/spending), 1 refund pair, an annotated
  one-off month (December travel cluster, journal entry attached), 4 uncategorized "needs review"
  rows, 1 cash adjustment, and a food-delivery step-up in the final month that produces the canonical
  "+23% food" insight.
- **Statement fixtures:** matching synthetic CSV files in Maybank, TnG eWallet, and generic
  debit/credit formats (plus one deliberately messy file: BOM, `dd/mm/yyyy` and `dd MMM yyyy` mixed,
  thousands separators, trailing junk row) for import-wizard tests and the import demo.
- **Scale fixture (tests only):** a generated 10k-transaction variant for pagination/performance.

Acceptance: seeding is idempotent, completes in under 30 seconds, and every number shown on the demo
Overview reconciles to the seeded rows (verified by a seed-integrity test).

**Seeding schedule (follows incremental migrations):** the dataset builds up phase by phase — Phase
1 seeds the demo identity only (user, preferences, sample audit events); Phase 2 adds accounts,
categories, and transactions; Phase 3 adds the statement CSV fixtures; later phases add budgets,
goals, recurring patterns, and scenario/journal fixtures as their tables land.
