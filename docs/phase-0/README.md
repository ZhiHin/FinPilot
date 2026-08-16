# FinPilot — Phase 0: Product Foundation

**Status:** Reviewed and approved 2026-08-16 with five amendments (applied — see below). Phase 1 complete — see [../progress/phase-1.md](../progress/phase-1.md).
**Date:** 2026-08-16
**Working name:** FinPilot (name, logo, and brand tokens are isolated so they can be replaced)

## Review amendments (2026-08-16, applied)

1. **Incremental migrations** — the 38-table ERD stays the target model, but each phase migrates
   only its own domain's tables; Phase 1 = `users`, `user_preferences`, `sessions`,
   `password_reset_tokens`, `audit_logs`. (ERD doc §5.1; ADR-017; backlog §2.)
2. **Milestones** — Core MVP = Phases 1–6, AI Beta = Phases 7–8, Production V1 = Phases 9–10;
   acceptance criteria regrouped per milestone. (Spec §5–6; backlog §1.)
3. **Provider-independent AI** — `AIProvider` stays unbound; first adapter selected in Phase 8 via
   configuration/env; Anthropic is a provisional candidate only; no provider code in Phase 1.
   (Spec A14; ADR-012.)
4. **Authentication confirmed** — self-managed email/password + DB sessions with the full Phase 1
   hardening list; social login/MFA/passkeys remain future-ready architecture only. (Backlog E3.)
5. **Authorization** — service-layer scoping from the authenticated server-side user id only, with
   required isolation/tamper/unauthenticated integration tests; **PostgreSQL RLS recorded as a
   security decision to reconsider before Production V1 release.** (ADR-010; backlog §2.7.)

Phase 0 produces the product and architecture documentation only. No application code, scaffolding,
or migrations exist yet; Phase 1 begins implementation after this document set is reviewed.

## Document map

| # | Document | Contents |
|---|----------|----------|
| 1 | [01-product-specification.md](01-product-specification.md) | Assumptions, non-goals, persona and jobs-to-be-done, end-to-end user journeys, feature priority table (MVP / post-MVP / future), MVP acceptance criteria, sample dataset definition |
| 2 | [02-ux-architecture.md](02-ux-architecture.md) | Sitemap, route map, complete screen inventory with states, written wireframes for the seven key screens |
| 3 | [03-design-system.md](03-design-system.md) | Design direction, design-token proposal (color, type, spacing, radii, shadows, chart palette, semantic states), component inventory |
| 4 | [04-domain-model-and-erd.md](04-domain-model-and-erd.md) | Domain model, Mermaid ERD, table-by-table constraints and indexes, migration strategy, DBeaver workflow, seed-data plan |
| 5 | [05-technical-architecture.md](05-technical-architecture.md) | Stack, application boundaries, data-flow diagrams, AI/analytics architecture (deterministic vs generative), architecture decision records (ADR-001…ADR-016) |
| 6 | [06-risk-and-privacy.md](06-risk-and-privacy.md) | Privacy analysis (PDPA-oriented), threat model, failure-mode analysis, risk register |
| 7 | [07-phase-1-backlog.md](07-phase-1-backlog.md) | Phased backlog summary for Phases 1–10, detailed Phase 1 backlog with user stories, acceptance criteria, and test plan |

## How the documents relate

- The **product specification** is the source of truth for scope. Anything not in its MVP table is out
  of scope for Phases 1–10 unless the backlog explicitly schedules it.
- The **UX architecture** and **design system** define every screen Phase 1's application shell must
  eventually host, so the shell is built once, correctly.
- The **domain model** is the contract for Phase 1's migrations. Later phases add columns/tables only
  through new migrations, never by editing shipped ones.
- The **technical architecture** ADRs are binding until superseded by a new ADR.
- The **risk register** items marked `P1` have mitigations that land in Phase 1 and appear as backlog items.

## Phase 0 exit criteria

- [x] Assumptions and non-goals recorded (spec §1–2)
- [x] Persona, jobs-to-be-done, and user journeys written (spec §3–4)
- [x] Sitemap, route map, and screen inventory complete (UX doc)
- [x] Written wireframes for Overview, Transactions, Budget, Goals, Recurring, Scenario Lab, AI Insights (UX doc §4)
- [x] Design direction and token proposal (design system doc)
- [x] Domain model and Mermaid ERD covering all required tables (ERD doc)
- [x] Technical architecture, data-flow diagrams, and ADRs (architecture doc)
- [x] AI/analytics architecture with deterministic vs generative responsibilities (architecture doc §6)
- [x] Privacy, threat, failure-mode, and risk analysis (risk doc)
- [x] Migration strategy and DBeaver workflow (ERD doc §5–6)
- [x] Phase 1 backlog with acceptance criteria (backlog doc)
- [x] MVP acceptance criteria and sample dataset defined (spec §6–7)
