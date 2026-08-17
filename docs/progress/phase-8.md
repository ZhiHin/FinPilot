# Phase 8 — Explainable AI and Assistant

**Status:** Complete — all acceptance criteria pass; committed as
`feat: complete phase 8 explainable ai and assistant`.
**Date:** 2026-08-17
**Plan:** Master prompt Phase 8 + backlog §1 row 8 ("Privacy-Mode e2e proves zero external
calls; numeric-claim verification; golden fixtures incl. injections; AI Beta acceptance
green") + ERD §3/§5.1 (`ai_suggestions`, `ai_feedback`, `ai_requests`) + architecture doc §6
(three-layer AI architecture, provider abstraction) + risk doc (consent, minimization,
injection defenses) + ADR-012/-013 + spec B4–B8.

**The architecture in one paragraph.** Generative AI in FinPilot never computes and never
mutates. Layer 1 (rules/statistics) and layer 2 (deterministic math) produce every number;
layer 3 (LLM) is only allowed to *phrase* already-verified facts and *route* assistant
questions to typed tools — and everything it emits is checked against the deterministic
numbers before display, falling back to deterministic wording on any mismatch. All calls
flow through one gateway that refuses before any adapter is touched when Privacy Mode is on,
consent is absent, or the kill switch is set.

## Schema (migrations 0014 + 0015, chain 0000→0015, from-empty verified)

- **0014_ai**: `ai_suggestions` (kind enum: category_correction · merchant_rule ·
  budget_change · subscription_detect · duplicate_txn · refund_match · goal_adjustment;
  status enum pending/approved/edited/dismissed/snoozed/expired; `proposed_change` jsonb =
  the exact patch approval applies; rationale + typed evidence; confidence bp check;
  **partial-unique (user, kind, target) among live statuses** for idempotent scans;
  dismissal reason codes), `ai_feedback` (**check: exactly one** of suggestion_id/insight_id;
  verdict helpful/not_helpful/wrong; optional note), `ai_requests` (**metadata only** —
  feature, provider, model, prompt version, token counts, duration, status
  ok/error/refused/fallback, redacted error; never prompt or response bodies, never
  financial data).
- **0015_ai_guards**: trigger — feedback must reference a suggestion/insight owned by the
  same user.
- Recorded ERD deviation (same as Phases 6–7): confidence stored as integer basis points.

## Provider abstraction (B8, ADR-012)

`AIProvider` = `{ name, model, complete(request) }`. Adapters:

- **StubProvider (default)** — deterministic, zero network: routes tool-selection by
  keyword and phrases by echoing the verified FACTS line. The full suite (unit,
  integration, e2e) runs against it, proving CI needs no key and no egress.
- **AnthropicProvider** — `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ optional
  `AI_MODEL`); plain fetch, 20s timeout, status-code-only error reporting (no bodies into
  logs).
- **WrongNumberStubProvider** (`AI_PROVIDER=stub-wrong`) — the B5/B8 golden fixture: a
  provider that fabricates "RM 999,999.99". Integration tests bind it and prove the
  verification layer rejects its output and falls back (and that a second adapter proves
  the interface).

Binding is configuration-only (`resolveProvider()` reads env); nothing outside the adapter
layer changes when swapping. `AI_DISABLED=1` is the global kill switch.

## The gateway (B6 — the single chokepoint)

`aiComplete(db, userId, feature, ...)` checks, in order: Privacy Mode → consent
(`ai_consent_at`) → kill switch — and **refuses before any adapter is even resolved**,
logging a `refused` row. Every outcome (ok/error/refused/fallback) writes one metadata-only
`ai_requests` row, surfaced to the user on `/insights/activity` with an explainer for
refusals and fallbacks. Consent is a separate explicit, revocable toggle in
Settings → Privacy & AI (audited: `consent.ai_updated`), independent of Privacy Mode, which
always wins.

## Numeric-claim verification (B5)

`extractClaims` pulls every RM amount and percentage from generated text;
`verifyNumericClaims` demands each amount match a whitelisted verified value **exactly to
the sen** (percentages get display-rounding tolerance only). Applied to both AI surfaces:

- **Insight phrasing**: `phrasePendingInsights` offers deterministic insight bodies to the
  provider for rewording; the verified set is the deterministic body's own numbers. Pass →
  body updated and badged "AI-phrased · model" with feedback thumbs; fail → deterministic
  body stays and a `fallback` row is logged. The stub-wrong fixture proves fabricated
  numbers never reach the page.
- **Assistant**: identical check against the tool card's `verified` set before any
  model-phrased conclusion is shown; failure falls back to the deterministic conclusion.

## Category suggestions (ADR-013 — rules + scorer, no per-transaction LLM)

`categorizeService.scan` (idempotent via the live-target unique index; wakes due snoozes,
expires >30-day pendings) over needs-review transactions:

- **User rules always win**: first active match by priority → confidence 9500 bp, source
  `deterministic`.
- **Scorer v1** (documented in code): merchant_history = most common category among ≥2
  same-merchant categorized rows, 6000 + 400×min(n,8) (+500 if unanimous); token_match
  fallback over shared description tokens (≥4 chars, ≥2 rows), 5500 + 250×min(n,6); below
  6000 bp nothing is suggested — silence beats noise. Trained only on the user's own
  history; corrections are incorporated by construction on the next scan (approve/edit
  writes categorization_source `user`, which both stops re-suggesting and feeds history).
- **merchant_rule proposals**: ≥3 unanimous user-categorized rows and no existing rule →
  propose "always categorize X as Y"; approval creates the real `categorization_rules` row
  and bulk-applies it to that merchant's current needs-review set (source `rule`).
- A hostile merchant name ("Ignore previous instructions Ltd") is inert data end-to-end
  (fixture-tested).

## Action queue (B4 — nothing changes without explicit approval)

`/insights?tab=queue` (badge with pending count): every suggestion shows the proposal, the
target transaction, a plain-language rationale, confidence, and four actions — **Approve**
(applies the exact `proposed_change` through the existing audited, versioned
`bulkSetCategory` path and clears needs-review), **Edit** (pick a different category —
applied and recorded as `wrong` feedback so the scorer's history learns), **Dismiss** (with
reason code), **Snooze** (7 days; auto-wakes). Stale pendings expire at 30 days. Suggestion
status transitions are guarded (only live suggestions resolve; concurrent version drift
refuses safely).

## Assistant (B7 — structured tools only, never raw data)

`assistantService.ask`: the model selects from a **closed registry of six read-only tools**
(spending summary, category breakdown, upcoming bills, safe-to-spend, goals progress,
affordability check) with Zod-validated arguments; the server injects the user id — the
model never chooses whose data. Tool results are `ToolCard`s: verified numbers, evidence
rows, filters used, assumptions, and links to the real screens. The UI answer is always a
structured card (conclusion + evidence table + "Used: tool · filters" + non-advisory
notice), never free chat. Affordability reuses STS/forecast math and reports the verdict
against the safety buffer plus the earliest safer date from the conservative series.

**Injection defenses**: user text enters prompts only inside `<question>` delimiters with
explicit "data, not instructions" framing; hostile fixtures (both hostile questions and
hostile merchant names inside FACTS) are integration-tested to produce refusals or inert
phrasing — and anything that slips past still faces the numeric verifier and read-only
tools. Off-topic questions get a scoped refusal listing what the assistant can do.

## Privacy Mode and consent surfaces

- Settings → Privacy & AI: Privacy Mode switch + a **separate Generative-AI consent**
  switch (explicit, revocable, audited) + an accurate disclosure of exactly what is sent
  (phrased insight sentences and pre-aggregated tool results — never raw tables) and the
  provider binding.
- With Privacy Mode on or consent absent: the assistant tab is replaced by an explainer,
  insight wording stays deterministic, and **nothing visible is reduced** (the page says
  so).
- `/insights/activity`: the per-user AI request log (when/feature/provider/model/prompt
  version/tokens/duration/status), including refusals — users can see every call that did
  or did not happen.

## Evaluations (AI Beta acceptance)

Golden-fixture evaluations run as part of the integration suite against the stub adapters
(zero network, deterministic): scorer fixtures (merchant history → suggestion; hostile
merchant → none; sub-threshold → none), lifecycle fixtures (approve/edit/dismiss/snooze/
expire; rule approval → future scans route deterministically at 9500 bp), assistant routing
fixtures (each tool + amount capture), four hostile-question injection fixtures + hostile
merchant inertness, the stub-wrong numeric-fabrication fixture (B5), gateway refusal
fixtures for all three reasons (B6), and cross-user isolation.

## Test & verification results (2026-08-17, this machine)

| Gate | Result |
|---|---|
| `format:check` / `lint` / `typecheck` | ✅ all clean |
| Vitest (unit + components + integration) | ✅ **441 passed / 441** (43 files) — adds 8 verification-core tests (claim extraction incl. negatives/thousands/decimals, exact-sen matching, pct tolerance) and 18 AI integration tests (gateway refusals ×3 reasons, scorer + hostile-merchant + threshold fixtures, full queue lifecycle, rule-approval determinism, assistant routing + affordability + 4 injection fixtures, stub-wrong fallback proof, isolation) |
| Playwright e2e | ✅ **105 passed / 105** — adds 9 AI journeys (three-section insights page, queue proposal anatomy + B4 pre-approval inertness, approve end-state, consent gating, consent grant → assistant evidence card + refusal of an injection question, **B6: Privacy Mode session with every request intercepted — zero external calls asserted** + explainer + restore, metadata-only activity log, axe on all five AI surfaces, mobile 360px) — plus the full Phase 1–7 regression |
| `npm run build` | ✅ production build succeeds |
| Migrations from empty | ✅ chain 0000→0015 on every integration/e2e run; dev DB at 16 applied |
| Demo seeding idempotent | ✅ re-run: "already present — nothing to do" (fresh seeds now include two uncategorized ZUS Coffee charges so the queue demonstrates the scorer) |
| `git diff --check` | ✅ clean |

## Known limitations

- The B6 e2e network assertion intercepts every browser-context request; server-side
  egress is enforced by the gateway ordering (refuse before adapter) and proven by the
  integration fixtures — the default stub adapter makes no network calls anywhere in any
  suite.
- Suggestion kinds beyond category_correction/merchant_rule (budget_change,
  subscription_detect, duplicate_txn, refund_match, goal_adjustment) are schema-ready; the
  deterministic producers from Phases 6–7 keep surfacing those findings as insights and
  notifications for now.
- Assistant answers are single-turn tool routing (no conversation memory) by design; the
  scoped refusal points at the suggested questions.
- The Anthropic adapter is production-shaped (timeouts, redacted errors) but this
  environment holds no key: it is exercised structurally (interface + config binding),
  while all behavior gates run on the stub adapters by design.
- Prompt versions are pinned constants (`assistant-tools@v1`, `phrasing@v1`) logged per
  request; a prompt-management surface is out of scope.

## Recommended next phase (not started)

**Phase 9 — Scenario Lab and Decision Journal**: what-if scenarios over the deterministic
engines (affordability, goal trade-offs, recurring changes) with side-by-side comparison,
saved scenarios, and the append-only decision journal with baseline-exclusion follow-through
(the Phase 7 note about "mark December travel one-off" baselines).
