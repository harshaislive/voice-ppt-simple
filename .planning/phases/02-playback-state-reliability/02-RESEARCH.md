# Phase 2: Playback State Reliability - Research

**Researched:** 2026-04-19
**Domain:** Browser/server playback coordination, Web Audio pause/resume behavior, Socket.IO session restore, slide completion sequencing [VERIFIED: codebase]
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAY-01 | Controller can start, pause, resume, and stop a presentation without playback state drifting between UI, socket events, and server runtime [VERIFIED: .planning/REQUIREMENTS.md] | Introduce one explicit playback contract with server-owned session/slide phase and client-owned audio lifecycle acknowledgment, then route all pause/resume/stop transitions through that contract. [VERIFIED: public/app.js] [VERIFIED: public/services/socket.js] [VERIFIED: server/routes/autoplex.js] |
| PLAY-02 | Narration audio streams complete cleanly without abrupt cutoffs, duplicate chunks, or continued playback after pause/stop [VERIFIED: .planning/REQUIREMENTS.md] | Tighten `StreamAudioPlayer` source reset, queue flush, pause state, and active slide ownership so late chunks and stale scheduled audio cannot bleed into the next state. [VERIFIED: public/services/audio.js] [VERIFIED: public/app.js] |
| PLAY-03 | Slide advancement only occurs after narration state is complete, intentionally skipped, or explicitly overridden by controller action [VERIFIED: .planning/REQUIREMENTS.md] | Replace implicit `audio-end` + client polling assumptions with an explicit completion handshake plus guarded server fallback logic and clearer slide-advance responsibility. [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/slides.js] |
| PLAY-04 | Session restore and reconnect resume the correct presentation state without replaying stale audio or losing control authority [VERIFIED: .planning/REQUIREMENTS.md] | Make restore conservative: recover state and authority, clear stale playback state, and require explicit replay/resume instead of auto-replaying current narration. [VERIFIED: public/app.js] [VERIFIED: public/services/socket.js] [VERIFIED: server/routes/session.js] |
</phase_requirements>

## Summary

Phase 2 should preserve the current brownfield architecture and make playback ownership explicit rather than trying to replace the presentation loop. Right now the browser, `StreamAudioPlayer`, Socket.IO event stream, and `server/routes/autoplex.js` each infer completion and pause state independently. That is the root cause of drift. [VERIFIED: public/app.js] [VERIFIED: public/services/audio.js] [VERIFIED: public/services/socket.js] [VERIFIED: server/routes/autoplex.js]

The browser already has the only trustworthy signal for actual rendered playback completion because it owns the Web Audio queue and knows whether scheduled chunks are still pending. The server should therefore own the presentation/session phase while the client owns the audio lifecycle acknowledgment. The right change is not "server-only truth" or "client-only truth"; it is a narrower contract between them. [VERIFIED: public/services/audio.js] [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js]

Pause/resume is currently brittle because the browser both suspends local playback and separately asks the server to pause `autoplex`, while replay/history flows can clear interrupts and reset local audio state in overlapping ways. Phase 2 should formalize hard-freeze semantics: one pause action freezes progression and audio, one resume action continues the same slide, and replay/jump/history should be clearly separate transitions. [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js]

Reconnect/restore is currently too aggressive. `restoreSession()` can reconnect, replay the current slide, and resume `autoplex` automatically. That is directly at odds with the locked decision for conservative restore. Phase 2 should restore state and controls without replaying or resuming audio unless the controller explicitly asks. [VERIFIED: public/app.js] [VERIFIED: public/services/socket.js]

**Primary recommendation:** split the phase into four slices: 1) define and test the playback contract and state machine boundaries, 2) repair pause/resume/audio lifecycle behavior in the client and server, 3) harden completion/advance sequencing with ack + fallback, and 4) make reconnect/restore conservative and state-safe. [VERIFIED: codebase]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session and slide phase ownership | API / Backend [VERIFIED: codebase] | Browser client [VERIFIED: codebase] | `server/routes/autoplex.js` already owns the long-running presentation loop and session status transitions. [VERIFIED: server/routes/autoplex.js] |
| Actual audio playback lifecycle | Browser client [VERIFIED: codebase] | Socket transport [VERIFIED: codebase] | The Web Audio queue, active sources, and scheduled playback window exist only in `public/services/audio.js`. [VERIFIED: public/services/audio.js] |
| Playback acknowledgment | Browser client [VERIFIED: codebase] | API / Backend [VERIFIED: codebase] | The client currently emits `presentation-audio-complete`; this should become an explicit contract instead of an inferred side effect. [VERIFIED: public/services/socket.js] [VERIFIED: public/app.js] [VERIFIED: server.js] |
| Pause/resume orchestration | Browser client [VERIFIED: codebase] | API / Backend [VERIFIED: codebase] | The user interacts in the browser, but `autoplex` must freeze progression server-side at the same time. [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js] |
| Replay/history flow | API / Backend [VERIFIED: codebase] | Browser client [VERIFIED: codebase] | Replay depends on server-side cached/generated audio while the browser handles rendered playback and sequence continuation. [VERIFIED: server/routes/autoplex.js] [VERIFIED: public/app.js] |
| Restore/reconnect authority | API / Backend [VERIFIED: codebase] | Browser client [VERIFIED: codebase] | Session state and control authority come from the server, but stale playback state must be cleared in the browser before any explicit resume. [VERIFIED: server/routes/session.js] [VERIFIED: public/app.js] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| socket.io | 4.7.2 in repo [VERIFIED: package.json] | Existing realtime transport for playback events, room join, and completion acknowledgments. [VERIFIED: server.js] | Phase 2 should tighten the current event contract rather than replace the transport layer. [VERIFIED: public/services/socket.js] [VERIFIED: server.js] |
| Web Audio API | browser-native [VERIFIED: public/services/audio.js] | Client-side chunk scheduling, pause/resume, and playback timing. [VERIFIED: public/services/audio.js] | This is already the real audio authority in the product, so Phase 2 should formalize around it instead of bypassing it. [VERIFIED: public/services/audio.js] |
| express | 4.18.2 in repo [VERIFIED: package.json] | Existing control routes and session restore API. [VERIFIED: server.js] | Slide control, restore, and pause/resume already depend on the current Express route surface. [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/session.js] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jest | 30.x in repo [VERIFIED: package.json] | Current backend/runtime test runner. [VERIFIED: jest.config.js] | Extend it with playback state tests for completion, restore, and contract behavior. [VERIFIED: tests/runtime/session-diagnostics.test.js] |
| supertest | 7.x in repo [VERIFIED: package.json] | HTTP test assertions against runtime routes. [VERIFIED: package.json] | Use for restore, session, and slide control behavior without booting the full app. |
| socket.io-client | 4.x in repo [VERIFIED: package.json] | Client/socket integration assertions. [VERIFIED: package.json] | Use where playback acknowledgment or reconnect behavior needs a real Socket.IO round-trip. |

## Architecture Patterns

### System Architecture Diagram
```text
Controller browser
  -> local Web Audio state machine (`public/services/audio.js`) [VERIFIED]
  -> app orchestration (`public/app.js`) [VERIFIED]
  -> socket event contract (`public/services/socket.js`) [VERIFIED]

Socket / HTTP control
  -> join-session / playback completion / presentation events [VERIFIED: server.js]
  -> pause/resume/replay/advance/session restore routes [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/slides.js]

Server presentation loop
  -> in-memory maps for pause, interrupt, replay, waiters [VERIFIED: server/routes/autoplex.js]
  -> session row updates + slide-change events [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/session.js]
```

### Recommended Project Structure
```text
public/
├── app.js                         # Browser playback contract, UI state, restore semantics
├── services/
│   ├── audio.js                   # Actual playback lifecycle authority
│   └── socket.js                  # Narrow explicit playback event contract

server/
├── routes/
│   ├── autoplex.js                # Presentation loop, pause/replay/completion state
│   ├── session.js                 # Session restore semantics
│   └── slides.js                  # Explicit jump/advance overrides

tests/
├── helpers/
│   ├── createPlaybackContractHarness.js
│   └── createAutoplexControlHarness.js
└── runtime/
    ├── playback-contract.test.js
    ├── playback-pause-resume.test.js
    ├── playback-advance.test.js
    └── playback-restore.test.js
```

### Pattern 1: Explicit Event Contract Between Client and Server
**What:** Represent playback progression through explicit phase events and acknowledgments instead of combining `audio-end`, local polling, and implicit server waits. [Inference from codebase]
**When to use:** Any state transition that currently depends on timing assumptions across browser and server. [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js]
**Example:**
```javascript
// Existing contract seed in codebase
socket.emit('presentation-audio-complete', { sessionId, slideIndex });
socket.on('audio-end', (data) => {
  app.handleAudioEnd(data);
});
```

### Pattern 2: Local Audio Authority, Server Session Authority
**What:** Let the browser decide whether playback is still happening; let the server decide whether the presentation is paused, presenting, replaying, or completed. [Inference from codebase]
**When to use:** Pause/resume, replay, reconnect, and completion logic. [VERIFIED: public/services/audio.js] [VERIFIED: server/routes/autoplex.js]
**Example:**
```javascript
// Existing split already present but implicit
await this.streamPlayer.pause();
await this.pauseAutoplex(true);
```

### Pattern 3: Conservative Restore
**What:** Restore state and control, clear stale playback state, and require an explicit next action from the controller before narration restarts. [Inference from codebase]
**When to use:** Session reconnect, restore after refresh, or partial socket loss recovery. [VERIFIED: public/app.js] [VERIFIED: public/services/socket.js]
**Example:**
```javascript
// Existing restore path is too aggressive
await this.replaySlide(restoredSlideIndex);
await this.pauseAutoplex(false);
```

### Anti-Patterns to Avoid
- **Client-side completion by polling alone:** `waitForPlaybackFinish()` polling should not remain the only completion arbiter. [VERIFIED: public/app.js]
- **Auto-replay on restore:** reconnect should not automatically replay the current slide narration. [VERIFIED: public/app.js]
- **Replay and pause sharing hidden state:** replay/history should not depend on the same implicit flags as regular live progression without explicit transitions. [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js]
- **Late chunk acceptance after state change:** audio chunks for stale slides should be rejected consistently at the client contract boundary. [VERIFIED: public/app.js] [VERIFIED: public/services/audio.js]

## Common Pitfalls

### Pitfall 1: Treating `audio-end` as playback completion
**What goes wrong:** The server finishes sending chunks and emits `audio-end`, but the browser still has scheduled audio or queued chunks, so the slide advances too early. [VERIFIED: public/app.js] [VERIFIED: public/services/audio.js] [VERIFIED: server/routes/autoplex.js]
**How to avoid:** Separate "server finished emitting" from "client finished rendering" and advance only after valid client acknowledgment or guarded fallback. [VERIFIED: codebase]

### Pitfall 2: Pause that freezes one side but not the other
**What goes wrong:** The browser pauses local audio while the server keeps progression timers or waiters alive, or the server pauses while the browser still drains audio. [VERIFIED: public/app.js] [VERIFIED: server/routes/autoplex.js]
**How to avoid:** Define hard-freeze semantics and make pause/resume hit both the server and local playback contract in the same transition path. [VERIFIED: codebase]

### Pitfall 3: Restore that behaves like replay
**What goes wrong:** Refresh/reconnect immediately replays the current slide, restarts narration, or resumes autoplex without operator intent. [VERIFIED: public/app.js]
**How to avoid:** Restore state only, clear stale local playback state, and require explicit replay/resume action afterward. [VERIFIED: codebase]

## Validation Architecture

### Feedback loops needed
- Fast loop: focused Jest suites for playback contract, pause/resume, slide completion, and restore semantics.
- Wave loop: end-to-end session playback tests that combine socket events with route behavior.
- Manual loop: browser verification for pause/resume feel and reconnect safety because Web Audio timing remains user-visible.

### Critical observables
- Active playback phase and active slide index on both client and server.
- Whether stale chunks are rejected after slide or state changes.
- Whether completion acknowledgment is emitted once, late, or duplicated.
- Whether restore reconnects with state only and no automatic narration replay.

### Minimum instrumentation expectation
- Structured logs for pause, resume, replay, client completion ack, fallback completion, restore, and reconnect decisions.
- Deterministic tests for state transitions without depending on wall-clock narration duration.

---

*Phase: 02-playback-state-reliability*
*Research completed: 2026-04-19*
