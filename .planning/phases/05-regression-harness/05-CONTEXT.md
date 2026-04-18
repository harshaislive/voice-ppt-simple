# Phase 5: Regression Harness - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 adds a trustworthy regression harness around the runtime behaviors that keep breaking during iteration. This phase is about automated verification strategy and test architecture: defining the must-not-break journeys, the right level of runtime realism, the suite contract people will actually run, and the failure paths that must be locked down before production-readiness verification. It does not replace Phase 6’s live-provider and release-readiness checks.

</domain>

<decisions>
## Implementation Decisions

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
- The exact split of plans between harness foundation, critical-flow integration, and negative-path suites, as long as the three-level contract remains clear.
- The exact helpers, in-memory adapters, and fixture strategy, as long as the tests stay realistic enough to catch regressions without depending on live providers by default.
- The exact command names and Jest grouping approach, as long as smoke, standard, and extended levels are explicit and maintainable.
- The exact distribution of specific failure cases across standard versus extended suites, as long as both security/startup and runtime continuity categories are protected in Phase 5.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` — Phase 5 goal, requirements, success criteria, and intended plan slices
- `.planning/REQUIREMENTS.md` — `TEST-01` and `TEST-02` define the required outcomes for this phase
- `.planning/PROJECT.md` — Reliability and verification still take priority over broader feature expansion

### Existing runtime test surface
- `tests/runtime/` — Current focused runtime suites for auth, playback, Q&A, content loading, runtime config, and diagnostics
- `tests/helpers/` — Existing harnesses for playback contracts, Q&A flow, logger wiring, session control, and content loading
- `jest.config.js` and `package.json` — Current test runner shape and available script surface

### Runtime seams the harness should cover
- `server/routes/session.js` — Session start, load, restore, and state mutation
- `server/routes/autoplex.js` — Presentation start, playback sequencing, replay, and completion
- `server/routes/questions.js` — Question submission, Q&A generation flow, and pending/answered lifecycle
- `public/app.js` and `public/services/socket.js` — Client runtime orchestration that already has focused playback and Q&A coverage

### Adjacent prior phase context
- `.planning/phases/02-playback-state-reliability/02-CONTEXT.md` and summaries — Playback ownership and restore behavior already locked
- `.planning/phases/03-grounded-q&a-experience/03-CONTEXT.md` and summaries — Q&A grounding and interruption semantics already locked
- `.planning/phases/04-content-loading-and-scaling-foundations/04-CONTEXT.md` and summaries — Explicit source selection and canonical presentation identity already locked

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/helpers/createPlaybackContractHarness.js` and `tests/helpers/createQuestionFlowHarness.js` already prove the repo can support narrow runtime harnesses without full app boot.
- `tests/helpers/createContentLoadingHarness.js` shows a newer pattern for route-plus-service testing around content selection and fail-closed startup.
- `tests/helpers/createTestApp.js` and `tests/helpers/createSessionControlServer.js` provide the base Express/auth harnesses that Phase 5 can build on.

### Established Patterns
- The repo already prefers small focused runtime suites per behavior area; Phase 5 should layer on top of that rather than replacing it with one monolithic E2E test.
- Current tests intentionally stub external providers and keep network calls local; this aligns with the chosen hybrid realism model.
- Several critical behaviors are already protected in isolation: playback completion contracts, restore behavior, Q&A isolation, source resolution, runtime config, and auth guards.

### Integration Points
- The missing layer is cross-slice regression: proving that session start, playback, interruption, restore, and completion still compose correctly together.
- The current command surface only exposes one generic `npm test`; Phase 5 needs to decide how smoke, standard, and extended suites are grouped and invoked.
- Security/startup and runtime continuity failures are both now in scope for the regression harness, which means Phase 5 must cover negative paths as first-class tests, not just happy-path presentation flow.

</code_context>

<specifics>
## Specific Ideas

- “Tested” should stop meaning “I ran some narrow suites” and start meaning one of three explicit confidence levels.
- The regression harness should catch the real fear pattern in this repo: fixing one runtime area and silently breaking another.
- Real local credentials are available, but they should not become the default regression dependency because that makes the suite slower, costlier, and less deterministic.
- Two high-value integration flows are enough for this phase if they are chosen carefully and backed by strong negative-path coverage.

</specifics>

<deferred>
## Deferred Ideas

- Live OpenAI/TTS/Supabase verification as part of default regression gating
- Full release-readiness and manual verification checklist work
- One real customer-facing presentation validation pass

</deferred>

---

*Phase: 05-regression-harness*
*Context gathered: 2026-04-19*
