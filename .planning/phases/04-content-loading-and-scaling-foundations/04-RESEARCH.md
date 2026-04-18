# Phase 4: Content Loading and Scaling Foundations - Research

**Researched:** 2026-04-19
**Domain:** Presentation source-of-truth rules, identity normalization, project-package onboarding, and fail-closed content loading [VERIFIED: codebase]
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Source precedence
- **D-01:** Each presentation or project should declare its own source of truth.
- **D-02:** Runtime must follow that explicit declaration rather than guessing from environment or availability.
- **D-03:** Local and Supabase may both exist, but each presentation should have one authoritative source at runtime.

### Presentation identity
- **D-04:** Presentation slug is the canonical runtime identity.
- **D-05:** Project slug groups related docs, config, and presentation assets.
- **D-06:** Existing `deckId` and `deck_id` usage should normalize around presentation slug rather than remaining primary identity.

### New-project onboarding
- **D-07:** New client-facing presentations should follow a project-first content package pattern.
- **D-08:** Adding a new presentation should not require edits to core loading logic.
- **D-09:** Local and Supabase-backed presentations may coexist, but the packaging model should stay explicit and repeatable.

### Fallback and failure visibility
- **D-10:** If a presentation declares a specific source and that source is missing, inconsistent, or unavailable, runtime should fail closed.
- **D-11:** Operators should see explicit source mismatch and missing-content errors.
- **D-12:** Silent critical-path fallback that hides wrong-source usage should be removed.

### the agent's Discretion
- The exact config field and schema used to declare source of truth, as long as it is explicit and enforced.
- The exact compatibility path for legacy `deckId` and `deck_id` fields, as long as presentation slug becomes the canonical contract.
- The exact project-package folder and metadata shape, as long as onboarding becomes consistent and loader-driven instead of code-driven.
- The exact operator-facing error payloads and logs, as long as wrong-source startup is diagnosable and no longer silently masked.

### Deferred Ideas (OUT OF SCOPE)
- Building a full CMS authoring workflow for new presentation creation.
- Replacing legacy local decks in one migration sweep.
- Expanding into personalization or analytics redesign.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMS-01 | Session startup loads the correct presentation, project documents, and knowledge context from Supabase or local fallback without mismatched content [VERIFIED: .planning/REQUIREMENTS.md] | Introduce an explicit source declaration and a single loader contract that returns canonical presentation and project metadata instead of opportunistic merging and silent fallback. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: public/app.js] |
| CMS-02 | New presentation projects can be added through content/configuration patterns without code changes to core presentation logic [VERIFIED: .planning/REQUIREMENTS.md] | Standardize the project package shape around `project.json`, presentation JSON files, and knowledge docs, then make listing and session start consume that shape consistently. [VERIFIED: content/projects/beforest/project.json] [VERIFIED: server/services/cms.js] |
| CMS-03 | Content-loading failures surface clear operational errors instead of silent fallback behavior that hides incorrect source usage [VERIFIED: .planning/REQUIREMENTS.md] | Replace critical-path “best effort” fallback with explicit mismatch detection, structured diagnostics, and clear startup errors when declared source content is not available. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/cms.js] |
</phase_requirements>

## Summary

Phase 4 should tighten the existing loading spine rather than invent a second content system. The codebase already centralizes most presentation and project loading in `server/services/cms.js`, but the service still behaves like a hybrid convenience layer: it lists merged local and Supabase presentations, prefers Supabase at load time when configured, and falls back to local content if the remote path fails. That behavior is fast for experimentation, but it conflicts directly with the user’s decision that each presentation must declare an authoritative source and fail visibly if that source is wrong or unavailable. [VERIFIED: server/services/cms.js]

The most important identity problem is that presentation selection and persistence still speak multiple dialects. The browser loads a catalog, picks by `id` or `presentationSlug`, then falls back to the first Supabase item or first available item. Session start accepts only `deckId`, stores `presentationSlug` inside metadata, and writes `presentation?.presentationSlug || deckId` into `sessions.deck_id` and `vpp_sessions.deck_id`. Downstream services like `masterSessionService`, `autoplex`, and question loading still treat `deckId` as the durable lookup key. Phase 4 should keep compatibility fields for now, but define one canonical identity contract centered on presentation slug and make every boundary translate into that contract explicitly. [VERIFIED: public/app.js] [VERIFIED: server/routes/session.js] [VERIFIED: server/services/masterSession.js] [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/questions.js] [VERIFIED: server/services/supabaseSession.js]

The most important onboarding opportunity is that the repo already contains the beginnings of the target package model. `content/projects/beforest/` has `project.json`, modular docs like `AGENTS.md`, `flow.md`, `product.md`, and a presentation JSON under `presentations/`. That is almost the product shape the user wants for scaling to many client-facing presentations. The gap is not a missing folder layout; the gap is that runtime selection, listing, and restore logic do not consistently honor that package shape as the canonical source and identity contract. [VERIFIED: content/projects/beforest/project.json] [VERIFIED: server/services/cms.js]

The most important failure-visibility issue is that both server and client currently try to be helpful by choosing “something that works.” `cmsService.loadPresentation()` silently falls back from Supabase to local. `loadPresentationCatalog()` and `startSession()` in the browser fall back to the first Supabase item or first available item. `session.js` logs a warning if presentation load fails, then still starts a session shell with `unknown` source metadata. Those behaviors optimize for resilience, but they are exactly how the wrong deck, wrong docs, or wrong project context can get served without anyone realizing it. Phase 4 should remove that ambiguity from the session-start path. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: public/app.js]

## Recommended Plan Shape

1. Lock the loader contract first: explicit source declaration, canonical selection result, and focused tests for source mismatch. [Inference from codebase]
2. Normalize identity second: make presentation slug the canonical runtime identifier while keeping compatibility shims for existing `deckId`/`deck_id` paths. [Inference from codebase]
3. Standardize project-package onboarding third: ensure catalog and runtime both treat project packages as the first-class brownfield content model. [Inference from codebase]
4. Finish with fail-closed diagnostics and operator guidance so wrong-source startup becomes visible and actionable. [Inference from codebase]

## Patterns

### Pattern 1: Central Loader Service Owns Content Selection
**What:** Keep `server/services/cms.js` as the single presentation and project loading seam, but upgrade it from “best-effort hybrid fetcher” to “explicit source contract resolver.” [Inference from codebase]
**When to use:** session start, CMS preview/read routes, session restore, question-context reloads. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/questions.js]
**Example:**
```javascript
presentation = await cmsService.loadPresentation(deckId);
slides = presentation.slides || [];
```

### Pattern 2: Canonical Identity In Metadata, Compatibility In Storage
**What:** Introduce canonical `presentationSlug` and `projectSlug` metadata at runtime, while temporarily continuing to populate legacy `deckId` and `deck_id` fields for existing consumers. [Inference from codebase]
**When to use:** session start, persisted session metadata, master-session lookups, replay and Q&A context loading. [VERIFIED: server/routes/session.js] [VERIFIED: server/services/supabaseSession.js] [VERIFIED: server/services/masterSession.js]
**Example:**
```javascript
const metadata = JSON.stringify({
  presentationSlug: presentation?.presentationSlug || deckId,
  projectSlug: presentation?.projectSlug || null
});
```

### Pattern 3: Project Package As First-Class Content Boundary
**What:** Treat `content/projects/<project>/project.json` plus `presentations/*.json` and knowledge docs as the standard local package model for new work. [Inference from codebase]
**When to use:** catalog listing, project loading, documentation, onboarding validation. [VERIFIED: content/projects/beforest/project.json] [VERIFIED: server/services/cms.js]
**Example:**
```javascript
const projectConfig = await this.readJson(path.join(projectDir, 'project.json'));
const presentationsDir = path.join(projectDir, 'presentations');
```

### Pattern 4: Fail Closed On Declared Source Mismatch
**What:** When the requested presentation declares `source: supabase` or `source: local`, the runtime should stop and return a clear error if that source cannot satisfy the request. [Inference from codebase]
**When to use:** session start, CMS presentation load, restore paths that reload presentation context. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/autoplex.js]
**Example:**
```javascript
if (!result) {
  result = await this.loadPresentationFromLocal(identifier);
}
```

## Anti-Patterns to Avoid

- **Merged-catalog ambiguity:** listing local and Supabase records without clear authority encourages the client to pick an arbitrary “best” presentation. [VERIFIED: server/services/cms.js] [VERIFIED: public/app.js]
- **Silent source fallback:** server load should not quietly switch from requested source to another source in the critical session-start path. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js]
- **Identity by whichever field is available:** `deckId`, `presentationSlug`, `projectSlug`, and database `deck_id` cannot remain interchangeable forever. [VERIFIED: public/app.js] [VERIFIED: server/routes/questions.js] [VERIFIED: server/routes/autoplex.js]
- **Session shell without trusted presentation content:** starting a session after failed presentation load risks wrong analytics, wrong docs, and empty or mismatched slide sets. [VERIFIED: server/routes/session.js]

## Common Pitfalls

### Pitfall 1: Canonical identity changes that break brownfield consumers
**What goes wrong:** Replacing `deckId` in one pass can break master-session lookup, replay, Q&A context reload, or stored session assumptions. [VERIFIED: server/services/masterSession.js] [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/questions.js]
**How to avoid:** Introduce a canonical runtime contract first, keep compatibility aliases temporarily, and migrate readers to prefer `presentationSlug` explicitly. [VERIFIED: codebase]

### Pitfall 2: Catalog cleanup without session-start cleanup
**What goes wrong:** The home screen chooses the right item, but `/api/session/start` still accepts ambiguous identifiers and recreates mismatch risk server-side. [VERIFIED: public/app.js] [VERIFIED: server/routes/session.js]
**How to avoid:** Change client and server selection rules together, with tests around both catalog choice and session-start enforcement. [VERIFIED: codebase]

### Pitfall 3: Declared-source rules without operator diagnostics
**What goes wrong:** Runtime starts failing closed, but operators cannot tell whether the problem was missing Supabase content, a wrong slug, or a project-package mismatch. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js]
**How to avoid:** Log requested slug, expected source, resolved source, and mismatch reason consistently at the loader and session boundaries. [VERIFIED: codebase]

### Pitfall 4: Project-package documentation without loader validation
**What goes wrong:** The repo documents the package shape, but invalid `project.json` or missing presentations still slip through until runtime. [VERIFIED: content/projects/beforest/project.json] [VERIFIED: server/services/cms.js]
**How to avoid:** Add focused loader tests and package validation helpers so onboarding errors fail early. [VERIFIED: codebase]

## Validation Architecture

### Feedback loops needed
- Fast loop: focused Jest runtime tests for catalog/source resolution, canonical identity mapping, and fail-closed startup behavior.
- Wave loop: run all Phase 4 runtime suites after each plan wave.
- Manual loop: one operator-path browser pass to confirm new project-package selection is understandable and wrong-source failures are explicit.

### Critical observables
- Requested presentation slug, declared source, resolved source, and mismatch/failure reason.
- Session metadata fields written at startup, including canonical presentation slug and project slug.
- Catalog item selection rules on the client when multiple sources exist.
- Whether question/replay/master-session reloads use canonical presentation identity after startup.

### Minimum instrumentation expectation
- Structured logs for presentation resolution, project resolution, source mismatch, and fail-closed session-start rejection.
- Focused tests that cover explicit-source selection, slug normalization, project-package listing, and operator-visible errors.

---

*Phase: 04-content-loading-and-scaling-foundations*
*Research completed: 2026-04-19*
