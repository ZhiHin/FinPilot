# FinPilot — Security Review (Phase 10)

**Reviewed:** 18 August 2026 · **Scope:** the whole application at commit of Phase 10
· **Reviewer:** builder (solo project — see limitation L1)
· **Verdict:** no High or Critical findings open. Two Medium items fixed during this review;
the rest are accepted with recorded rationale or tracked as launch-checklist items.

This closes spec **V5** ("security review complete, including the recorded RLS reconsideration")
and re-walks the Phase 0 threat model ([../phase-0/06-risk-and-privacy.md](../phase-0/06-risk-and-privacy.md) §2)
surface by surface.

---

## 1. The decision this phase owed: PostgreSQL RLS (ADR-010)

Phase 0 recorded RLS as **a decision that must be explicitly reconsidered before Production V1** —
not an open-ended "later". Reconsidered here, in full.

**Decision: keep service-layer authorization; do NOT adopt RLS for V1.** Recorded as **ADR-018**
(architecture doc §7), which supersedes the "reconsider later" clause of ADR-010.

**Why the current control is trustworthy**

- Every repository/service call is scoped by a `user_id` that comes only from
  `requireUser()` → the database-backed session. Ownership is never read from a request body,
  URL, or hidden field; `assertFilterIdsOwned`-style checks fail **closed** on foreign ids.
- Defense in depth already exists at the database: **child-table ownership triggers** raise
  `belongs to another user` if a row's `user_id` ever disagrees with its parent's
  (planning, recurring, intel, AI, and simulation guard migrations — 33 triggers live).
- Cross-user isolation is **non-negotiable CI**: every phase added isolation tests for its own
  entities, including tampered-ID payloads and unauthenticated access. Phase 10 adds the purge
  sweep, which asserts a deleted user's rows are gone from **every** `user_id`-bearing table
  while a control user's rows are untouched.

**Why RLS is not the right trade today**

- The app uses one pooled application role (`pg.Pool`, `max: 10`). RLS needs either per-request
  `SET LOCAL app.user_id` on every checkout — easy to forget on a raw `db.execute`, and silently
  *widening* if missed — or per-user roles, which the pooler cannot share. Both add a failure mode
  whose blast radius is larger than the one they remove.
- Analytics/forecast queries are hand-written SQL CTEs; RLS interacts with `SECURITY DEFINER`
  functions, `information_schema` sweeps (the purge job), and planner behaviour in ways that would
  need re-profiling of every Phase 4/7 query.
- The pg-boss job schema and migration tooling run as the same role and would need explicit
  `BYPASSRLS` carve-outs.

**Revisit triggers (any one flips the decision):** a second human operator gains database access; a
multi-tenant/shared-workspace feature lands; direct SQL access is granted to a third party; or an
IDOR-class incident occurs. Until then the CI isolation suite is the control, and it is a **release
blocker** if it ever goes red.

---

## 2. Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| F1 | Medium | Generative AI calls had **no per-user budget** — a scripted client could burn provider spend (risk R7, threat model "resource abuse"). | **Fixed** — `AI_CALLS_PER_HOUR = 60` enforced at the single gateway chokepoint, counted from `ai_requests`, refusals logged and surfaced as calm copy. Integration-tested (per-user, refusals don't consume budget). |
| F2 | Medium | Account deletion existed only as a schema state (`users.status`) with no way to reach it, so a user could not exercise their PDPA erasure right. | **Fixed** — staged deletion shipped this phase: password-confirmed request, 30-day recovery, audited purge that provably empties every owned table. |
| F3 | Low | `x-powered-by: Next.js` advertised the framework. | **Fixed** — `poweredByHeader: false`. |
| F4 | Low | Dev-only `npm audit` moderates (4) via `drizzle-kit → @esbuild-kit/* → esbuild` (dev server request SSRF, CVE class). | **Accepted** — `npm audit --omit=dev` reports **0 vulnerabilities**; the chain is a build-time CLI never present in the runtime image (the Dockerfile installs and ships only what `next build` traces). Tracked to clear when drizzle-kit updates its loader. |
| F5 | Info | `account-purge.ts` builds one query with `sql.identifier(table_name)`. | **Accepted** — the identifier comes from `information_schema`, never from user input, and Drizzle quotes identifiers. It is the only non-literal identifier in the codebase. |
| F6 | Info | Attachments (`attachments` table, storage keys, scan hook) are modelled but no upload path ships. | **Accepted** — no live surface, therefore no live risk; the malware/MIME controls in the threat model apply when the feature lands. |
| F7 | Low | Next.js **standalone output mirrors the build context**, so a `docker build` run without a proper `.dockerignore` would copy `.env` (and tests/docs) into the image — observed directly when inspecting `.next/standalone` locally. | **Mitigated** — `.dockerignore` excludes `.env*`, tests, docs, and local state, so the build container never sees them; the Dockerfile and [deployment.md](deployment.md) call this out as a control to keep in sync, with a post-build verification command. |

## 3. Surface-by-surface walk (threat model §2)

**Authentication.** Argon2id via `@node-rs/argon2`; enumeration-safe copy identical for unknown
email and wrong password, with a dummy-hash verify so timing matches; per-identifier and per-IP
rate limits on sign-in, sign-up, and reset, counted from `audit_logs`; session tokens are random,
stored only as SHA-256 hashes, sliding idle expiry (14d) under a hard absolute cap (30d), revocable
individually and en masse; reset tokens are single-use, hashed, 30-minute TTL, and invalidated on
password change. Cookies: `httpOnly`, `sameSite=lax`, `secure` in production, path-scoped.
*Phase 10 change:* `pending_purge` users may authenticate **only** inside their recovery window and
`requireUser()` funnels them to `/restore`; an expired window fails exactly like bad credentials
(no new enumeration oracle).

**Authorization / IDOR.** Covered in §1. Verified again this phase by the purge sweep and the
export archive test (another user's rows never appear in an export).

**Injection.** No string-built SQL: every query is a Drizzle parameterized template (F5 is the one
identifier exception). No `eval`, no `new Function`, no `dangerouslySetInnerHTML`, no `innerHTML`
anywhere in `src/` (grep-verified). Zod parses at every boundary, stripping unknown fields.

**XSS / CSP.** React escaping everywhere; production CSP is nonce-based with `strict-dynamic`,
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`; `style-src` still allows
`'unsafe-inline'` (Tailwind/Recharts inline styles) — accepted, documented, and the reason
`script-src` carries no inline allowance.

**CSV import.** Size/row/column caps enforced while streaming; encoding whitelist with a
windows-1252 fallback; uploaded files are **never stored** (only confirmed rows plus metadata);
per-user upload rate limit (30/hour); commits are idempotent by content hash and reversible.

**CSV export (formula injection).** The Phase 4 transactions export and the Phase 10 archive share
one escaping contract: user-influenced cells starting `= + - @ TAB CR` get a leading apostrophe;
app-generated fixed-grammar cells (dates, signed decimals, enums, uuids, JSON) are `raw()` and
exempt so legitimate negative amounts are not corrupted. Unit tests pin every leader; the archive
integration test uses a hostile tag (`=SUM(A1:A9)`) and a hostile description.

**AI path.** One chokepoint (`aiComplete`). Privacy Mode, missing consent, or `AI_DISABLED=1`
refuse *before* an adapter is constructed — network-asserted in e2e (spec B6). Payloads are
pre-aggregated; `ai_requests` stores metadata only (never prompts, never financial rows). Tool
registry is fixed, arguments are Zod-validated, and the **server** injects the user id — a prompt
cannot widen scope. Every numeric claim is re-verified against deterministic math before display,
with a golden "wrong number" provider proving the rejection path. Injection fixtures ship in CI.
*Phase 10 change:* F1's per-user budget.

**Logging / operator exposure.** New `scrubForLogging` redacts credentials and raw financial detail
(amounts, balances, descriptions, notes, titles, merchant names, emails, `diff` blobs) by key,
recursively, with depth and length caps — unit-tested. `audit_logs` stores salted hashes for IP and
identifiers, never raw values; the purge record carries a subject hash and row **counts** only.

**Supply chain.** Lockfile committed; runtime dependency tree is small (13 direct) and audits clean;
the production image installs with `--ignore-scripts` and ships only traced files.

## 4. Limitations of this review

- **L1** Solo review — no independent reviewer. Risk R3 ("self-built auth has a flaw") remains open
  in the register and is a launch-checklist item for external review before public launch.
- **L2** No dynamic testing (DAST/pen-test) was performed; findings come from code review, the
  automated suites, and targeted probes.
- **L3** The Docker image was **not built** in this environment (no Docker available), so the
  hardening claims about the runtime image are by construction, not by scan. Verify before first
  deploy — see [deployment.md](deployment.md).
