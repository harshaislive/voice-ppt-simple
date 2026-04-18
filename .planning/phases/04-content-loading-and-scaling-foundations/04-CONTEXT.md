# Phase 4: Content Loading and Scaling Foundations - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 makes presentation and project loading explicit, scalable, and safer across multiple client-facing presentations. This phase covers source-of-truth rules, canonical presentation identity, the standardized onboarding shape for new presentations, and how source/load failures should behave. It does not expand into new product features or a new CMS product.

</domain>

<decisions>
## Implementation Decisions

### Source precedence
- **D-01:** Source-of-truth should be declared per presentation or project instead of relying on one global default.
- **D-02:** The runtime must follow that explicit source declaration rather than guessing from environment or availability.
- **D-03:** Local and Supabase may both exist in the system, but each presentation should have one declared authoritative source at runtime.

### Presentation identity model
- **D-04:** Presentation slug should be the canonical runtime identity.
- **D-05:** Project slug should group related docs, configuration, and presentation assets around that canonical presentation identity.
- **D-06:** Existing `deckId` / `deck_id` usage should be normalized around presentation slug rather than remaining the primary identity model.

### New-project onboarding shape
- **D-07:** New presentations should follow a project-first content package model.
- **D-08:** Every new client-facing presentation should live under a project with explicit content/docs/config structure, regardless of whether the source is local or Supabase-backed.
- **D-09:** Adding a new presentation should not require core logic surgery or one-off runtime branching.

### Fallback and failure visibility
- **D-10:** If a presentation declares a specific source of truth and that source is missing, inconsistent, or unavailable, the runtime should fail closed instead of silently falling back.
- **D-11:** Operator-visible errors should make source mismatch or missing project content explicit.
- **D-12:** Silent fallback behavior that hides wrong-source usage should be removed from the critical session-start path.

### the agent's Discretion
- The exact schema or config field used to declare a presentation’s source of truth, as long as the declaration is explicit and runtime-enforced.
- The exact normalization path from current `deckId` / `presentationSlug` / `projectSlug` usage to the canonical identity model, as long as the resulting contract is unambiguous.
- The exact project-package file structure and validation rules, as long as new presentations follow one explicit repeatable pattern.
- The exact error/reporting surfaces for source mismatch, as long as operators can diagnose incorrect content selection quickly and fallback is not silently masking errors.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` — Phase 4 goal, requirements, success criteria, and intended plan slices
- `.planning/REQUIREMENTS.md` — `CMS-01`, `CMS-02`, and `CMS-03` define the required outcomes for this phase
- `.planning/PROJECT.md` — Product priorities and constraints: reliability first, client experience first, brownfield hardening over rewrite

### Content loading and source selection
- `server/services/cms.js` — Current presentation/project listing and load precedence across local files and Supabase
- `server/routes/cms.js` — Public presentation/project APIs that expose the current content model to the client
- `server/routes/session.js` — Session-start path that chooses presentation/project content and persists source metadata
- `server/routes/questions.js` — Session-aware project knowledge loading that already depends on the current presentation identity

### Client presentation selection and restore
- `public/app.js` — Client catalog loading, selected presentation choice, session startup, project slug persistence, and restore behavior
- `server/services/masterSession.js` — Existing master-session asset lookup keyed by deck identity
- `server/services/supabaseSession.js` — Cross-session persistence fields that still reflect `deck_id` / slide/session source coupling

### Adjacent prior phase context
- `.planning/phases/03-grounded-q&a-experience/03-CONTEXT.md` — Phase 3 standardized slide-first answer behavior and Q&A state rules that depend on correct project/presentation loading
- `.planning/phases/03-grounded-q&a-experience/03-grounded-q&a-experience-01-SUMMARY.md` — Recent grounding work that should not be undermined by wrong-source content loading
- `.planning/codebase/CONCERNS.md` — Earlier mapping notes about mixed persistence ownership and source ambiguity

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/cms.js`: Already centralizes local/Supabase presentation and project loading, so Phase 4 should tighten and clarify this service rather than bypassing it.
- `server/routes/session.js`: Already records source metadata into session metadata at startup, which gives Phase 4 a place to make source selection explicit and auditable.
- `public/app.js`: Already loads a presentation catalog and persists `projectSlug`, `deckId`, and presentation metadata during session startup; this is the client seam where identity normalization will matter.
- `server/routes/cms.js`: Already exposes project and presentation loading through one HTTP surface, which can become more explicit about source and failure states.

### Established Patterns
- The current system supports legacy local deck JSONs, project packages under `content/projects/`, and Supabase-backed presentations simultaneously; Phase 4 should decide how these coexist instead of pretending only one path exists.
- Session startup already tries to attach project docs and source metadata to session state; the issue is not missing metadata, but conflicting identity/source conventions.
- The client currently prefers requested presentation slug, then Supabase-sourced catalog items, then first available presentation; that fallback order is a real current behavior that Phase 4 must either formalize or remove.

### Integration Points
- `server/services/cms.js` and `server/routes/session.js` together define the real source-of-truth path for session start.
- `public/app.js` and `/api/cms/presentations` together define how the operator/client chooses which presentation to run.
- `server/services/masterSession.js` and `server/services/supabaseSession.js` still encode older `deckId` assumptions that will need normalization around the canonical identity model.
- Phase 3 grounding and project-doc loading now assume the right project/presentation is selected, which raises the cost of silent source mismatch.

</code_context>

<specifics>
## Specific Ideas

- The runtime should stop “helpfully” choosing a different source than the one the presentation declares. Wrong content is worse than a visible failure.
- A presentation needs one stable identity all the way through catalog selection, session start, persistence, restore, and analytics.
- New presentation onboarding should feel like adding a well-formed content package, not teaching the app another special case.
- If a source mismatch happens, the operator should know exactly what was requested, what source was expected, and why startup failed.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-content-loading-and-scaling-foundations*
*Context gathered: 2026-04-19*
