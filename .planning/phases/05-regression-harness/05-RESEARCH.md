# Phase 5: Regression Harness - Research

**Researched:** 2026-04-19
**Domain:** Regression test architecture, harness reuse, suite-tier strategy, and high-value negative-path coverage [VERIFIED: codebase]
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Critical-path regression boundary
- **D-01:** Phase 5 should protect two first-class regression flows rather than one giant undifferentiated suite.
- **D-02:** The first critical flow is the main presentation journey: start session, play slides, interrupt with Q&A, resume or advance, and complete the session.
- **D-03:** The second critical flow is reconnect/restore: restore mid-session without replay drift, stale state corruption, or controller confusion.

### Test environment realism
- **D-04:** The regression harness should use a hybrid realism model.
- **D-05:** Core regression flows should exercise real Express routes, auth/session wiring, and in-memory runtime pieces wherever practical.
- **D-06:** External providers such as OpenAI, TTS, and Supabase should still be stubbed or simulated by default in regression tests, even though real credentials exist locally.

### Suite structure and speed budget
- **D-07:** Phase 5 should define a three-level testing contract.
- **D-08:** There should be a smoke suite for fast iteration, a standard regression suite for normal development confidence, and an extended suite for heavier pre-ship or phase-level verification.
- **D-09:** The regression harness should make it obvious which command belongs to which confidence level so “tested” has a concrete meaning.

### Negative-path priorities
- **D-10:** Phase 5 must cover both security/startup failures and runtime continuity failures.
- **D-11:** Security/startup failures include session-control auth, admin/auth boundaries, wrong-source content loading, and invalid session-start paths.
- **D-12:** Runtime continuity failures include reconnect/restore drift, stale playback state, Q&A interruption/resume corruption, and broken completion flow.
- **D-13:** Live-provider checks and true release-only verification remain deferred to Phase 6 even though local credentials are available.

### the agent's Discretion
- The exact plan split between harness foundation, critical-flow integration, and negative-path protection, as long as the three-level contract remains explicit.
- The exact fixtures and helper strategy, as long as Phase 5 reuses the repo’s current harness style instead of introducing an entirely different test architecture.
- The exact mapping of test files into smoke, standard, and extended commands, as long as the confidence levels are concrete and maintainable.
- The exact boundary between standard negative-path coverage and Phase 6 release-only checks, as long as the live-provider work stays out of default gating.

### Deferred Ideas (OUT OF SCOPE)
- Default regression against live OpenAI, TTS, or Supabase
- Full release checklist and live presentation signoff
- Production-readiness walkthrough on one real customer presentation
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Automated coverage protects the end-to-end presentation lifecycle, including session start, playback, interruption, resume, and completion [VERIFIED: .planning/REQUIREMENTS.md] | Build two integration-level regression flows on top of the existing focused runtime helpers: one for the main presentation journey and one for reconnect/restore continuity. [VERIFIED: tests/helpers/createTestApp.js] [VERIFIED: tests/helpers/createPlaybackContractHarness.js] [VERIFIED: tests/helpers/createQuestionFlowHarness.js] [VERIFIED: tests/runtime/playback-*.test.js] [VERIFIED: tests/runtime/qa-*.test.js] |
| TEST-02 | Automated negative-path coverage protects session control, admin authorization, and persistence fallback behavior [VERIFIED: .planning/REQUIREMENTS.md] | Extend the current auth/content/runtime tests into a more explicit negative-path gate that covers startup denial, wrong-source loading, reconnect drift, and completion corruption risks at the regression level. [VERIFIED: tests/runtime/cms-auth.test.js] [VERIFIED: tests/runtime/analytics-auth.test.js] [VERIFIED: tests/runtime/session-control-auth.test.js] [VERIFIED: tests/runtime/content-fail-closed.test.js] |
</phase_requirements>

## Summary

Phase 5 should not replace the current test architecture; it should organize and extend it. The repo already has a meaningful base of focused runtime tests across auth, runtime config, diagnostics, playback, Q&A, and content loading. Those are valuable because they are fast, bounded, and mostly readable. The gap is not “no tests”; the gap is that there is still no regression layer proving the critical runtime slices compose together the way the product actually runs. [VERIFIED: tests/runtime/] [VERIFIED: tests/helpers/]

The best leverage point is the existing harness style. `createPlaybackContractHarness`, `createQuestionFlowHarness`, `createContentLoadingHarness`, `createSessionControlServer`, and `createTestApp` already form the beginnings of a coherent runtime-testing toolkit. Phase 5 should consolidate that into a clearer backend/session orchestration harness rather than introducing browser E2E tooling or a near-full local-stack test environment. The chosen hybrid realism model fits the repo’s current direction: real routes and state transitions, fake external providers. [VERIFIED: tests/helpers/createPlaybackContractHarness.js] [VERIFIED: tests/helpers/createQuestionFlowHarness.js] [VERIFIED: tests/helpers/createContentLoadingHarness.js] [VERIFIED: tests/helpers/createSessionControlServer.js] [VERIFIED: tests/helpers/createTestApp.js]

The two first-class regression flows the user chose are the right ones. The main presentation journey is the highest-value business path because it covers session start, presentation orchestration, interruption, Q&A, resume/advance, and completion. Reconnect/restore is the second because it crosses many already-fragile boundaries: session state, playback ownership, and controller continuity. Those are precisely the areas earlier phases stabilized in isolation and now need integrated proof. [VERIFIED: .planning/phases/02-playback-state-reliability/02-CONTEXT.md] [VERIFIED: .planning/phases/03-grounded-q&a-experience/03-CONTEXT.md] [VERIFIED: .planning/phases/04-content-loading-and-scaling-foundations/04-CONTEXT.md]

The suite contract is currently the weakest operational part of the test story. `package.json` exposes only `npm test`, and Jest runs every file under `tests/`. That makes it hard to answer what should run during normal iteration versus before shipping a risky runtime change. Phase 5 should introduce an explicit tiered contract, likely using file grouping and npm scripts: smoke for fast local confidence, standard for normal regression confidence, and extended for slower but broader pre-ship checks. [VERIFIED: package.json] [VERIFIED: jest.config.js]

The most important negative-path insight is that Phase 5 should treat failures as first-class regression targets, not leftovers. The repo already has individual tests for CMS/admin auth, analytics auth, session-control auth, runtime config, and content fail-closed diagnostics. That foundation should be preserved and grouped into a real negative-path gate, while Phase 5 also adds runtime continuity failures that aren’t yet represented as integrated regressions: reconnect drift, stale playback after interruption, and broken completion behavior. [VERIFIED: tests/runtime/cms-auth.test.js] [VERIFIED: tests/runtime/analytics-auth.test.js] [VERIFIED: tests/runtime/session-control-auth.test.js] [VERIFIED: tests/runtime/runtime-config.test.js] [VERIFIED: tests/runtime/content-fail-closed.test.js]

## Recommended Plan Shape

1. Build the shared regression harness and explicit smoke/standard/extended command contract first, because every later regression file should target a known tier and reuse a consistent harness base. [Inference from codebase]
2. Add the two high-value integration flows next, because those directly satisfy `TEST-01` and exercise the cross-slice journeys missing from the current suite. [Inference from codebase]
3. Finish by formalizing the negative-path regression gate, because Phase 5 must protect both startup/security failures and runtime continuity failures, not just the happy-path story. [Inference from codebase]

## Patterns

### Pattern 1: Focused Runtime Harnesses Over Full App Boot
**What:** Use small in-memory test harnesses that exercise real route/service boundaries and local socket/server behavior without invoking external providers. [Inference from codebase]
**When to use:** playback contracts, session-control checks, content-resolution routing, integration journey tests. [VERIFIED: tests/helpers/createPlaybackContractHarness.js] [VERIFIED: tests/helpers/createContentLoadingHarness.js] [VERIFIED: tests/helpers/createSessionControlServer.js]
**Example:**
```javascript
const app = createTestApp({ routeBase: '/api/session', router, db, io, logger });
const response = await request(app).post('/api/session/start').send(payload);
```

### Pattern 2: Client Runtime Logic Tested Through Exported Helpers
**What:** Keep browser-facing logic testable by exporting pure or mostly-pure helpers from `public/app.js` and using DOM stubs for runtime methods. [Inference from codebase]
**When to use:** selection helpers, restore behavior, Q&A presentation shaping, transcript ownership boundaries. [VERIFIED: public/app.js] [VERIFIED: tests/helpers/createAutoplexControlHarness.js] [VERIFIED: tests/runtime/qa-experience.test.js] [VERIFIED: tests/runtime/playback-restore.test.js]
**Example:**
```javascript
const { selectPresentationFromCatalog } = await importVoicePPTAppModule();
expect(selectPresentationFromCatalog(catalog, 'missing')).toBeNull();
```

### Pattern 3: Route-Level Negative Paths With Real Middleware
**What:** Protect auth and startup boundaries by mounting the real Express router with minimal DB/logger/test doubles instead of mocking the route logic away. [Inference from codebase]
**When to use:** CMS/admin auth, analytics auth, session-control auth, session start denial, fail-closed content loading. [VERIFIED: tests/runtime/cms-auth.test.js] [VERIFIED: tests/runtime/analytics-auth.test.js] [VERIFIED: tests/runtime/session-control-auth.test.js] [VERIFIED: tests/runtime/content-source-resolution.test.js]
**Example:**
```javascript
const router = require('../../server/routes/session');
const app = createTestApp({ routeBase: '/api/session', router, db });
```

### Pattern 4: Tiered Suite Grouping By Intent
**What:** Group tests into smoke, standard, and extended tiers by runtime confidence value rather than by arbitrary directory alone. [Inference from codebase]
**When to use:** npm scripts, CI steps, pre-ship verification commands, developer guidance. [VERIFIED: package.json]
**Example:**
```json
{
  "test:smoke": "jest --runInBand tests/runtime/runtime-config.test.js tests/runtime/session-control-auth.test.js",
  "test:regression": "jest --runInBand tests/runtime/playback-*.test.js tests/runtime/qa-*.test.js"
}
```

## Anti-Patterns to Avoid

- **Monolithic E2E replacement:** the repo already has useful narrow runtime tests; replacing them with one giant flaky flow would reduce clarity and slow iteration. [VERIFIED: tests/runtime/]
- **Live-provider default gating:** having real `.env` credentials available does not make them suitable for deterministic default regression coverage. [Inference from codebase]
- **Suite contract by folklore:** Phase 5 should not leave “what to run” as an undocumented convention around `npm test`. [VERIFIED: package.json]
- **Happy-path-only regression:** Phase 5 explicitly includes startup/security and runtime continuity failure paths; these cannot be pushed entirely to Phase 6. [VERIFIED: .planning/phases/05-regression-harness/05-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Integration tests that duplicate existing slice tests instead of composing them
**What goes wrong:** New “integration” files merely restate playback or Q&A unit-like assertions without proving cross-slice behavior. [VERIFIED: tests/runtime/playback-*.test.js] [VERIFIED: tests/runtime/qa-*.test.js]
**How to avoid:** Build integrated flows around session start, autoplex/Q&A orchestration, restore, and completion rather than reasserting already-isolated helper behavior. [VERIFIED: codebase]

### Pitfall 2: Harnesses that are too fake to catch regressions
**What goes wrong:** Over-mocking route/services causes tests to pass while real middleware, DB metadata, or event sequencing still break in the app. [Inference from codebase]
**How to avoid:** Use real Express routers, in-memory DB rows, and socket lifecycle where the flow depends on middleware or session state. [VERIFIED: tests/helpers/createTestApp.js] [VERIFIED: tests/helpers/createSessionControlServer.js]

### Pitfall 3: Regression tiers that are defined but not practically usable
**What goes wrong:** Smoke, standard, and extended tiers exist on paper, but scripts, file grouping, and naming don’t make them obvious or maintainable. [VERIFIED: package.json]
**How to avoid:** Give each tier an explicit command and map files into those tiers in a way that aligns with user intent and runtime cost. [VERIFIED: codebase]

### Pitfall 4: Negative-path coverage focused only on auth while continuity failures stay implicit
**What goes wrong:** Security/startup failures are covered, but restore drift, stale playback after interruption, or bad completion flow still escape because they are considered “happy-path adjacent.” [Inference from codebase]
**How to avoid:** Treat continuity failures as explicit regression targets in the same phase, not as optional polish or release-only concerns. [VERIFIED: .planning/phases/05-regression-harness/05-CONTEXT.md]

## Validation Architecture

### Feedback loops needed
- Fast loop: smoke tier that gives sub-minute feedback on the most critical guardrails and orchestration helpers.
- Standard loop: the default regression command covering the two high-value journeys and high-risk negative-path suites.
- Extended loop: broader runtime coverage before shipping or phase completion, still stubbed for external providers.

### Critical observables
- Whether session startup, playback progression, Q&A interruption, restore, and completion can still compose together.
- Whether negative paths fail explicitly and preserve control or content invariants.
- Whether the suite tiers are clearly invokable and map to meaningful confidence levels.
- Whether new harnesses reuse existing helper patterns instead of fragmenting the test surface.

### Minimum instrumentation expectation
- Explicit npm/Jest commands for smoke, standard, and extended tiers.
- Focused integration tests for the main presentation journey and reconnect/restore journey.
- Negative-path regression suites that cover both startup/security failures and runtime continuity failures.

---

*Phase: 05-regression-harness*
*Research completed: 2026-04-19*
