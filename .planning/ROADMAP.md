# Roadmap: Voice-PPT

## Overview

This roadmap hardens an existing AI-led presentation platform into a production-ready conversion system. The phases move from securing and observing the runtime, to stabilizing playback and Q&A behavior, to making presentation loading scalable, and finally to building the verification and release discipline needed to trust the system under real client traffic.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4, 5, 6): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Runtime Guardrails** - Lock down sensitive endpoints and establish operational visibility
- [x] **Phase 2: Playback State Reliability** - Make narration, controls, and slide progression deterministic
- [x] **Phase 3: Grounded Q&A Experience** - Improve conversational quality without breaking session state (completed 2026-04-18)
- [x] **Phase 4: Content Loading and Scaling Foundations** - Make multi-presentation loading safer and more explicit (completed 2026-04-19)
- [ ] **Phase 5: Regression Harness** - Add automated coverage around critical flows and failure paths
- [ ] **Phase 6: Production Readiness Gate** - Verify one real presentation flow end to end and lock release confidence

## Phase Details

### Phase 1: Runtime Guardrails
**Goal**: Close exposed runtime boundaries and make the system diagnosable before deeper behavior changes
**Depends on**: Nothing (first phase)
**Requirements**: [OPS-01, OPS-02, OPS-03]
**Success Criteria** (what must be TRUE):
  1. Sensitive CMS, preview, analytics, and session-control routes reject unauthorized access
  2. Production boot fails fast when required auth, CORS, AI, or persistence config is unsafe
  3. Operators can trace session lifecycle and playback/Q&A failures through explicit logs or metrics
**Plans**: 4 plans

Plans:
- [x] 01-01: Audit and secure exposed admin/session endpoints
- [x] 01-02: Tighten runtime configuration validation and unsafe fallbacks
- [x] 01-03: Add shared structured logger foundation and redaction safeguards
- [x] 01-04: Instrument session lifecycle routes and analytics with structured diagnostics

### Phase 2: Playback State Reliability
**Goal**: Remove playback desync, abrupt audio behavior, and slide-transition race conditions from the core presentation loop
**Depends on**: Phase 1
**Requirements**: [PLAY-01, PLAY-02, PLAY-03, PLAY-04]
**Success Criteria** (what must be TRUE):
  1. Play, pause, resume, replay, and stop actions keep browser and server state synchronized
  2. Narration audio completes or stops intentionally without double playback or mid-stream corruption
  3. Slide progression follows explicit playback completion rules instead of hidden timing races
  4. Session restore reconnects cleanly without replaying stale audio or losing controller authority
**Plans**: 4 plans

Plans:
- [x] 02-01: Document and simplify playback state ownership across client and server
- [x] 02-02: Fix pause/resume/stop semantics and audio lifecycle cleanup
- [x] 02-03: Harden slide-advance and interruption sequencing
- [x] 02-04: Stabilize reconnect and session-restore flows

### Phase 3: Grounded Q&A Experience
**Goal**: Make audience questions feel more natural while keeping answers grounded and operationally safe
**Depends on**: Phase 2
**Requirements**: [QA-01, QA-02, QA-03]
**Success Criteria** (what must be TRUE):
  1. Questions consistently use the correct slide and project knowledge context
  2. Q&A text and audio feel more conversational and less mechanical to a real prospect
  3. Q&A interactions do not interfere with active presentation narration or leave session state inconsistent
**Plans**: 3 plans

Plans:
- [ ] 03-01: Tighten Q&A grounding and context assembly
- [ ] 03-02: Improve answer presentation and conversational tone in the client UI
- [ ] 03-03: Isolate Q&A playback from presentation playback state

### Phase 4: Content Loading and Scaling Foundations
**Goal**: Make presentation/project loading explicit, scalable, and safer for multiple client-facing presentations
**Depends on**: Phase 3
**Requirements**: [CMS-01, CMS-02, CMS-03]
**Success Criteria** (what must be TRUE):
  1. Session startup loads the intended presentation and project context from the correct source every time
  2. Adding a new presentation project follows a documented content/config pattern instead of code surgery
  3. Source selection, fallback behavior, and content-loading failures are visible and diagnosable
**Plans**: 4 plans

Plans:
- [x] 04-01: Enforce explicit source-of-truth rules for presentation loading
- [x] 04-02: Normalize canonical presentation identity across client and server
- [x] 04-03: Standardize project-package onboarding for new presentations
- [x] 04-04: Improve fail-closed diagnostics and operator-visible loading errors

### Phase 5: Regression Harness
**Goal**: Build automated coverage around the runtime behaviors that currently regress during manual iteration
**Depends on**: Phase 4
**Requirements**: [TEST-01, TEST-02]
**Success Criteria** (what must be TRUE):
  1. Automated tests cover session start, playback lifecycle, interruption, resume, Q&A, and completion paths
  2. Automated negative-path tests protect session authorization and admin-only surfaces
  3. The team can run a repeatable test command before shipping changes to critical runtime code
**Plans**: 3 plans

Plans:
- [ ] 05-01: Introduce a test harness for backend/session orchestration
- [ ] 05-02: Add critical-path integration coverage for presentation and Q&A flows
- [ ] 05-03: Add auth and fallback regression tests to protect known risk areas

### Phase 6: Production Readiness Gate
**Goal**: Prove the system is ready for real client-facing use with repeatable release checks and one end-to-end validated presentation
**Depends on**: Phase 5
**Requirements**: [TEST-03, REL-01]
**Success Criteria** (what must be TRUE):
  1. A manual verification checklist exists and is used before release
  2. One real presentation project passes the full narration, playback, Q&A, and analytics workflow
  3. Remaining launch blockers are explicit, triaged, and either fixed or consciously deferred
**Plans**: 2 plans

Plans:
- [ ] 06-01: Create release verification checklist and runbook
- [ ] 06-02: Execute production-readiness pass on a real presentation and close blockers

## Progress

**Execution Order:**
Phases execute in numeric order: 3 -> 3.1 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Runtime Guardrails | 4/4 | Complete | 2026-04-19 |
| 2. Playback State Reliability | 4/4 | Complete | 2026-04-19 |
| 3. Grounded Q&A Experience | 3/3 | Complete   | 2026-04-18 |
| 4. Content Loading and Scaling Foundations | 4/4 | Complete   | 2026-04-19 |
| 5. Regression Harness | 0/3 | Not started | - |
| 6. Production Readiness Gate | 0/2 | Not started | - |
