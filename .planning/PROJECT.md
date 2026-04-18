# Voice-PPT

## What This Is

Voice-PPT is an AI-led sales presentation platform that lets prospects experience a consistent, on-demand pitch without scheduling a live 1:1 call. It combines slide narration, grounded Q&A, and audience/session tracking so the team can convert clients faster while scaling the same presentation model across multiple projects.

This existing codebase already runs realtime presentations backed by Supabase/local content, but the current milestone is about making that experience trustworthy enough for real client-facing use. The focus is reliability, verification, and small UX improvements that make the product feel polished rather than fragile.

## Core Value

Every prospect gets a reliable, grounded, high-converting presentation experience without needing a live sales rep on the call.

## Requirements

### Validated

- ✓ AI-led presentation sessions can start, stream narration, and advance through slide-based decks — existing
- ✓ Audience questions can be answered using current slide context plus project knowledge documents — existing
- ✓ Presentation content and project context can load from Supabase-backed CMS data or local content files — existing
- ✓ Session activity, realtime events, and analytics data can be captured during presentation runs — existing

### Active

- [ ] Playback controls remain synchronized across play, pause, resume, replay, and slide transitions
- [ ] Audio generation and playback complete reliably without abrupt cutoffs, overlap, or orphaned streams
- [ ] Q&A feels conversational and grounded instead of mechanical
- [ ] Critical presentation flows are covered by repeatable automated and manual verification
- [ ] The platform is safe and production-ready for multiple client-facing presentation projects

### Out of Scope

- Rebuilding the visual presentation experience from scratch — the current UI direction is acceptable and only needs targeted polish
- Native mobile apps — web delivery is the current product surface
- Broad feature expansion unrelated to conversion reliability — this milestone is about trust, stability, and launch readiness
- A generic slide-authoring product — current scope is presentation delivery, orchestration, and conversion support

## Context

This is a brownfield Node.js application with a static browser client in `public/`, an Express/Socket.IO backend rooted at `server.js`, and orchestration-heavy services/routes under `server/routes/` and `server/services/`. Presentation projects are content-driven, with persona, guardrails, flow, product knowledge, and CTA documents loaded from project content and optionally sourced from Supabase.

The business goal is to replace time-consuming 1:1 sales calls with AI-led presentations that are always available, consistent, easier to optimize, and easier to instrument. The product serves two audiences: internal sales operators who need confidence and scalability, and prospects/end clients whose presentation experience comes first.

Current pain points are concentrated in runtime reliability and confidence: playback controls drift out of sync, audio can continue unexpectedly or stop abruptly, Q&A feels too robotic, and manual fixes frequently cause regressions elsewhere. The codebase map also surfaced operational concerns around auth coverage, large orchestration files, mixed persistence ownership, and the absence of automated tests.

## Constraints

- **Tech stack**: Preserve the current Node.js/Express/Socket.IO/Supabase architecture for this milestone — reliability work should harden the existing system before major rewrites
- **Client experience**: Prospect-facing behavior is the top priority — internal tooling matters, but not at the expense of presentation quality
- **Brownfield reality**: Existing validated capabilities must keep working while reliability is improved — regressions are more costly than slower feature expansion
- **Verification**: Changes need repeatable proof — manual testing alone is not enough for this product's current fragility
- **Scalability**: The platform must support additional presentation projects without brittle, presentation-specific code paths
- **Security**: Production readiness requires closing exposed admin/session boundaries before wider rollout

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Prioritize reliability and verification before broad feature expansion | The current blocker is lack of trust in runtime behavior, not lack of ideas | — Pending |
| Keep the current presentation UI direction and limit this milestone to targeted polish | The product already has a usable visual foundation; the higher risk is behavior, not styling | — Pending |
| Treat Voice-PPT as a sales conversion platform, not just a narration engine | Roadmap decisions should optimize conversion consistency, grounded Q&A, and analytics, not only slide playback | — Pending |
| Optimize for both operators and prospects, with client experience first | Internal efficiency matters, but the product succeeds only if end clients trust and engage with the presentation | — Pending |
| Harden the current brownfield architecture incrementally instead of rewriting it upfront | Large rewrites would delay confidence-building and increase risk while the current system still lacks test coverage | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-19 after initialization*
