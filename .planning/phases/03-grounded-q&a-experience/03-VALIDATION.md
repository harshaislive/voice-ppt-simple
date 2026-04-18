---
phase: 3
slug: grounded-q-and-a-experience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for Q&A grounding, tone, and runtime isolation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/runtime/qa-grounding.test.js tests/runtime/qa-experience.test.js --runInBand` |
| **Full suite command** | `npm test -- --runInBand tests/runtime/qa-*.test.js` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused test file for the modified slice
- **After every plan wave:** Run all `tests/runtime/qa-*.test.js` suites
- **Before `$gsd-verify-work`:** Full runtime suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure / Reliable Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|----------------------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | QA-01 | T-3-01 | Answers use slide-first grounding and do not overreach beyond supported project context | integration | `npx jest tests/runtime/qa-grounding.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | QA-02 | T-3-02 | Answer payloads and UI rendering produce one coherent conversational answer rather than a mechanical bundle | integration/UI | `npx jest tests/runtime/qa-experience.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 3 | QA-03 | T-3-03 | Q&A mode owns transcript/audio/status cleanly and returns to narration without overlap or stale state | integration | `npx jest tests/runtime/qa-isolation.test.js --runInBand` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/createQuestionFlowHarness.js` — minimal harness for Q&A context assembly, classifier behavior, and runtime events
- [ ] `tests/runtime/qa-grounding.test.js` — grounding boundary and unsupported-answer coverage
- [ ] `tests/runtime/qa-experience.test.js` — answer payload/rendering and conversational presentation coverage
- [ ] `tests/runtime/qa-isolation.test.js` — Q&A start/end, transcript ownership, and non-overlap coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Answer tone feels like a confident closer, not a bot | QA-02 | Conversational feel remains partly subjective and product-facing | Ask 3-5 realistic prospect questions during a live session and confirm the answers sound warm, direct, and commercially useful without canned filler |
| Unsupported questions fail honestly | QA-01 | Real knowledge gaps depend on the specific presentation content loaded | Ask about a feature or pricing detail that is not on the current slide or in project docs and confirm the answer says so naturally instead of improvising |
| Q&A does not blur with narration mode | QA-03 | Mode clarity is visible in the live browser experience | Trigger an inline urgent question mid-session, watch the answer stream, then confirm status, transcript, and audio ownership return cleanly to narration state afterward |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
