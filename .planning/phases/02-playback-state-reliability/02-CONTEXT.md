# Phase 2: Playback State Reliability - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 removes playback desync, abrupt audio behavior, and slide-transition race conditions from the existing presentation loop. This phase covers control ownership between browser and server, pause/resume semantics, slide completion rules, and reconnect behavior for the active controller session.

</domain>

<decisions>
## Implementation Decisions

### Playback authority
- **D-01:** Playback state should use a hybrid authority model with an explicit contract.
- **D-02:** The server owns session state and slide state.
- **D-03:** The client owns actual audio playback state and playback acknowledgments.
- **D-04:** Coordination between server and client should happen through a narrow, explicit event contract rather than implicit timing assumptions.

### Pause and resume semantics
- **D-05:** Pause means a hard freeze.
- **D-06:** A hard freeze must stop new server-side progression and stop current browser audio.
- **D-07:** Resume should continue the same slide from the paused point if possible rather than skipping ahead or restarting by default.

### Slide completion and advance rules
- **D-08:** Slide completion should prefer active controller client playback acknowledgment.
- **D-09:** The system must keep a guarded server-side timeout fallback so a session cannot hang forever if the client acknowledgment is lost.
- **D-10:** Advancing to the next slide should require either valid client completion, an explicit controller override, or the guarded fallback path.

### Reconnect and restore behavior
- **D-11:** Reconnect should restore session state and controller controls, but must not automatically replay narration.
- **D-12:** Reconnect should not automatically resume current-slide playback; the user must explicitly resume or replay.
- **D-13:** Restore behavior should prioritize preventing stale or duplicate audio over being aggressively automatic.

### the agent's Discretion
- The exact playback-state event names and payload shape, as long as the ownership contract is explicit and consistent.
- The guarded fallback timeout thresholds and failure-handling behavior, as long as they prevent hangs without masking playback bugs.
- The exact mechanics of resuming from the paused point, as long as the user-facing result behaves like a real continuation of the same slide rather than an accidental restart.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` — Phase 2 goal, requirements, success criteria, and intended plan slices
- `.planning/REQUIREMENTS.md` — `PLAY-01`, `PLAY-02`, `PLAY-03`, and `PLAY-04` define the required outcomes for this phase
- `.planning/PROJECT.md` — Product priorities and constraints: client experience first, reliability before broad expansion

### Client playback state
- `public/app.js` — Main browser-side orchestration for slide updates, audio handling, pause/resume, replay, restore, and completion acknowledgment
- `public/services/audio.js` — Web Audio playback queue, pause/resume behavior, timeline tracking, and source reset logic
- `public/services/socket.js` — Client-side runtime event contract and reconnect/join handling

### Server playback state
- `server/routes/autoplex.js` — Presentation loop, pause flags, replay flow, playback completion waiters, and slide progression
- `server/routes/session.js` — Session startup, restore, and persisted session state
- `server/routes/slides.js` — Existing slide navigation/control behaviors that may interact with presentation state
- `server/middleware/security.js` — Session control enforcement that must remain intact during reconnect/control changes

### Existing diagnostics and coverage
- `tests/runtime/session-diagnostics.test.js` — Current structured diagnostics harness that can be extended for playback state transitions
- `.planning/codebase/CONCERNS.md` — Existing notes about fragmented playback ownership and orchestration risk
- `.planning/phases/01-runtime-guardrails/02-runtime-guardrails-01-SUMMARY.md` — Prior phase hardening established auth/test/logging foundations now available to Phase 2

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public/services/audio.js`: Already tracks queue state, pause/resume state, and playback timing; this should be refined rather than replaced casually.
- `public/services/socket.js`: Already centralizes most client runtime event handling; it is the natural place to tighten the playback event contract.
- `server/routes/autoplex.js`: Already owns the long-running presentation loop, pause flags, replay handling, and completion waiters; this is the main server control point.
- `server/routes/session.js`: Already persists session state and restore data, so reconnect behavior should build on this path instead of inventing a second restore system.

### Established Patterns
- The browser currently acknowledges playback completion back to the server through Socket.IO; Phase 2 should formalize this instead of replacing it with pure timer logic.
- Presentation progression is currently event-driven with in-memory maps on the server; Phase 2 should tighten these semantics before attempting architecture changes.
- Replays, pauses, and restores already exist as separate concepts in the product; Phase 2 should clarify their boundaries rather than blending them further.

### Integration Points
- `public/app.js` and `public/services/audio.js` form the current client-side playback state machine, even if that machine is implicit and brittle.
- `public/services/socket.js` and `server/routes/autoplex.js` define the live coordination boundary where most desync risk lives.
- `server/routes/session.js` and persisted session data affect restore/reconnect semantics and controller authority.
- Existing runtime tests and structured logs from Phase 1 provide the first base for making playback changes observable and verifiable.

</code_context>

<specifics>
## Specific Ideas

- The product should behave like there is one clear agreement about playback status, not three different interpretations racing each other.
- Pause/resume should feel dependable to the prospect and operator, even if that means stricter rules about what can continue automatically.
- Reconnect should be safe and non-surprising; the system should avoid restarting audio on its own after a connection wobble.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-playback-state-reliability*
*Context gathered: 2026-04-19*
