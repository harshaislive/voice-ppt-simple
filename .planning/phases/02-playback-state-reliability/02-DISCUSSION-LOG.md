# Phase 2: Playback State Reliability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 02-playback-state-reliability
**Areas discussed:** Playback authority, Pause and resume semantics, Slide completion and advance rules, Reconnect and restore behavior

---

## Playback authority

| Option | Description | Selected |
|--------|-------------|----------|
| Server authoritative | Server owns playback phase and slide completion; client mainly renders and acknowledges | |
| Client authoritative | Browser owns playback truth; server mainly streams and accepts control commands | |
| Hybrid with explicit contract | Server owns session/slide state, client owns actual audio playback state, and both coordinate through a narrow explicit event contract | ✓ |

**User's choice:** `3`
**Notes:** Keep ownership split, but make it explicit. Server owns session and slide state; client owns real playback state and acknowledgments.

---

## Pause and resume semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Hard freeze | Pause stops new server progression, stops current browser audio, and resume continues the same slide from the paused point if possible | ✓ |
| Soft hold | Pause stops server progression, but current audio is allowed to finish locally; resume continues from the next allowed transition point | |
| Restart current slide | Pause stops progression and clears current playback; resume restarts the current slide narration from the beginning | |

**User's choice:** `1`
**Notes:** Pause should behave like a real freeze, not a loose advisory signal. Resume should continue the same slide when technically possible.

---

## Slide completion and advance rules

| Option | Description | Selected |
|--------|-------------|----------|
| Client playback completion ack | Slide completes only when the active controller client confirms playback fully finished or the controller explicitly skips | |
| Server audio emission complete | Slide completes when the server has finished emitting audio/text, regardless of browser playback lag | |
| Timeout-backed hybrid | Prefer client completion ack, but allow a guarded server timeout fallback so the session cannot hang forever | ✓ |

**User's choice:** `3`
**Notes:** Prefer active controller playback acknowledgment, but keep a guarded fallback path so the presentation cannot deadlock on lost acknowledgments.

---

## Reconnect and restore behavior

| Option | Description | Selected |
|--------|-------------|----------|
| State restore, no auto-replay | Restore current slide/session state and controls, but do not automatically replay narration; user must explicitly resume or replay | ✓ |
| Smart auto-resume | Restore session state and automatically continue current-slide playback if the session was actively presenting | |
| Always replay current slide | Reconnect always reloads and replays the current slide so controller and audience resynchronize from a known point | |

**User's choice:** `1`
**Notes:** Restore should be conservative. It should preserve state and authority, but never auto-replay or auto-resume audio without an explicit user action.

---

## the agent's Discretion

- Exact event names and payload schema for the playback-state contract
- Timeout and fallback thresholds for deadlock prevention
- Exact implementation path for continuing the same slide from a paused point

## Deferred Ideas

None.

---

*Phase: 02-playback-state-reliability*
*Discussion log generated: 2026-04-19*
