---
phase: 2
slug: playback-state-reliability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for playback reliability feedback during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x + Supertest 7.x + Socket.IO client 4.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/runtime/playback-contract.test.js tests/runtime/playback-pause-resume.test.js --runInBand` |
| **Full suite command** | `npm test -- --runInBand tests/runtime/*.test.js` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused test file for the modified slice
- **After every plan wave:** Run all `tests/runtime/playback-*.test.js` suites
- **Before `$gsd-verify-work`:** Full runtime suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure / Reliable Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|----------------------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | PLAY-01 | T-2-01 | Playback contract defines server-owned session phase and client-owned audio ack with no ambiguous completion path | integration | `npx jest tests/runtime/playback-contract.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | PLAY-01, PLAY-02 | T-2-02 | Hard freeze pause stops client audio and server progression; resume continues same slide without stale chunks | unit/integration | `npx jest tests/runtime/playback-pause-resume.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 3 | PLAY-02, PLAY-03 | T-2-03 | Slide completion requires client ack or guarded fallback, and no double-advance occurs | integration | `npx jest tests/runtime/playback-advance.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 4 | PLAY-04 | T-2-04 | Restore/reconnect recovers state and control without auto-replay or stale audio restart | integration | `npx jest tests/runtime/playback-restore.test.js --runInBand` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/createPlaybackContractHarness.js` — minimal harness for socket/client/server playback state transitions
- [ ] `tests/helpers/createAutoplexControlHarness.js` — harness for pause/resume/replay/restore control behavior
- [ ] `tests/runtime/playback-contract.test.js` — explicit contract and acknowledgment coverage
- [ ] `tests/runtime/playback-pause-resume.test.js` — hard-freeze pause/resume and stale-chunk cleanup coverage
- [ ] `tests/runtime/playback-advance.test.js` — completion, fallback, and slide-advance sequencing coverage
- [ ] `tests/runtime/playback-restore.test.js` — reconnect and restore behavior coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pause/resume feels like a real freeze to a prospect | PLAY-01, PLAY-02 | Audio timing and UX perception are user-visible and browser-dependent | Start a live narration, pause mid-sentence, confirm audio halts immediately, then resume and verify the same slide continues without replaying the beginning |
| Reconnect does not auto-replay or auto-resume | PLAY-04 | Browser refresh and websocket recovery remain environment-sensitive | Refresh or disconnect the controller mid-session, restore the session, and verify the current state returns without narration restarting until the operator explicitly resumes or replays |
| Slide completion never jumps early on long narration | PLAY-03 | Real audio chunk timing and browser scheduling still need one end-to-end check | Run a long slide narration and confirm advance occurs only after full playback completion or explicit override |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
