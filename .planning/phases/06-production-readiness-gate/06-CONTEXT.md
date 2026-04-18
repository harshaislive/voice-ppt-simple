# Phase 6: Production Readiness Gate - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 defines and executes the release gate for one real client-facing presentation. This phase is about final verification discipline: choosing the certified presentation target, deciding how far the gate uses real providers and real environments, defining the evidence and sign-off artifacts required to pass, and locking the blocker policy that controls release. It does not reopen core playback, Q&A, or content-loading design decisions unless the production gate exposes a concrete blocker.

</domain>

<decisions>
## Implementation Decisions

### Certification target
- **D-01:** Phase 6 should certify one real client-facing presentation rather than a synthetic test fixture.
- **D-02:** The certification target should use the existing Supabase-backed presentation that currently exists in the project.
- **D-03:** This target must be treated as an explicit named certification target during planning and execution, not as an implicit “whatever Supabase returns” runtime fallback.
- **D-04:** The production gate should use a two-environment flow: a staging-like run first, then a short final pass in production before release.

### Release gate depth
- **D-05:** The Phase 6 gate should use real providers for the critical path.
- **D-06:** Real OpenAI, TTS, and Supabase should be used for the core presentation journey in the certified run.
- **D-07:** Edge cases and wider failure classes do not need a fully live-provider gate if the critical-path certification run is real.

### Evidence required to pass
- **D-08:** Phase 6 must require more than a checklist; it needs a durable release sign-off record.
- **D-09:** The pass bar is a checklist plus captured evidence, including logs, screenshots, timing notes, and selected provider/runtime outputs from the certified run.
- **D-10:** Each certified presentation must produce an acceptance artifact that records go/no-go status, evidence, and explicit known risks.

### Blocker policy
- **D-11:** Core journey failures are release blockers: session start, narration flow, play/pause/resume, answerability, and completion must work.
- **D-12:** Trust failures are also release blockers: grounding failures, analytics or session-timeline gaps, wrong-source loading, and obvious conversational quality breakdowns must stop release.
- **D-13:** Missing evidence or unresolved live-provider edge cases are not automatically blockers unless they create a core-journey or trust failure in the certified presentation.

### the agent's Discretion
- The exact checklist structure, runbook format, and sign-off artifact shape, as long as the evidence is explicit and reusable.
- The exact staging-like environment definition, as long as it is close enough to production to make the certification meaningful before the short production pass.
- The exact method used to resolve and record the single Supabase presentation slug, as long as the target is explicit and stable throughout planning and execution.
- The exact ordering of manual operator checks, automated checks, and evidence capture, as long as the result is a repeatable release gate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` — Phase 6 goal, requirements, success criteria, and intended plan slices
- `.planning/REQUIREMENTS.md` — `TEST-03` and `REL-01` define the required outcomes for this phase
- `.planning/PROJECT.md` — Reliability, verification, and client experience remain the core milestone priorities
- `.planning/STATE.md` — Confirms all prior hardening phases are complete and Phase 6 is the remaining milestone gate

### Existing runtime confidence surface
- `.planning/phases/05-regression-harness/05-CONTEXT.md` and summaries — The smoke/standard/extended contract already covers default non-live regression confidence
- `package.json` — Current runnable verification commands that Phase 6 should incorporate into the release process
- `tests/runtime/` — Existing automated runtime and negative-path suites that form the pre-live verification baseline

### Runtime and provider verification seams
- `server/routes/session.js` — Session start/load and canonical presentation metadata used in certification
- `server/routes/questions.js` and `server/routes/autoplex.js` — Q&A, narration progression, interruption, and completion seams that the gate must verify
- `server/config/runtime.js` — Production/staging fail-closed config behavior the gate must respect
- `server/services/tts.js`, `server/services/model.js`, and `server/services/stateStore.js` — Live provider and persistence health boundaries that matter in certification
- `server.js` — `/api/health` and top-level runtime startup behavior

### Existing operational references
- `.planning/codebase/TESTING.md` — Current verification conventions, including `scripts/verify-azure-tts.js`
- `scripts/verify-azure-tts.js` — Existing live TTS verification script pattern
- `content/projects/beforest/` — Local project package example, useful as a structural reference even though the certified target is the sole current Supabase-backed presentation

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 5 already established a clear automated confidence contract, so Phase 6 does not need to invent a new regression surface for non-live checks.
- The server already exposes runtime health and structured logging surfaces that can feed evidence capture during certification.
- The repo already contains operational verification script patterns such as `scripts/verify-azure-tts.js`, which can inform the runbook and live-check style.

### Established Patterns
- Prior phases intentionally kept live providers out of default test gating; Phase 6 is the explicit place where live-provider checks become first-class.
- The runtime now preserves canonical `presentationSlug` and source metadata through startup, restore, and downstream lookups, which means the certified target can be tracked explicitly.
- Fail-closed behavior, structured diagnostics, and integrated regression flows are already in place, so the release gate should build on those instead of duplicating them.

### Integration Points
- Planning must resolve the exact sole Supabase presentation slug and carry it through the checklist, live run, and sign-off artifact.
- The release gate needs a staging-like pass plus a short production pass, which means environment-specific steps and evidence requirements must be explicit.
- The final certified run must cover the real presentation journey end to end: startup, narration, Q&A, analytics/session trace, and completion.

</code_context>

<specifics>
## Specific Ideas

- “Production ready” now means a named real presentation passes a disciplined gate, not just that the regression suites are green.
- The certified run should prove trust, not just uptime: the system has to sound grounded, load the right source, answer credibly, and leave usable evidence behind.
- The sole current Supabase presentation is acceptable as the certification target, but planning must resolve and record its exact slug so the gate is explicit.
- A short production pass is acceptable after a staging-like certification run, as long as both are part of the same release gate story.

</specifics>

<deferred>
## Deferred Ideas

- Certifying multiple presentations in the same milestone
- Turning the release sign-off process into a full operator admin UI
- Expanding default automated gating to depend on live providers for every routine code change

</deferred>

---

*Phase: 06-production-readiness-gate*
*Context gathered: 2026-04-19*
