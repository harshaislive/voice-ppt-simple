# Phase 6: Production Readiness Gate - Research

**Researched:** 2026-04-19
**Domain:** Release gating, live-provider verification, evidence capture, and real-presentation certification workflow [VERIFIED: codebase]
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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
- The exact checklist, runbook, and sign-off file shapes, as long as the release evidence is explicit and reusable.
- The exact staging-like environment definition, as long as it is close enough to production to make the certification meaningful.
- The exact method used to resolve and record the single Supabase presentation slug, as long as it becomes explicit before the live run starts.
- The exact ordering of automated baselines, live checks, and manual operator steps, as long as the result is repeatable.

### Deferred Ideas (OUT OF SCOPE)
- Certifying multiple presentations in the same milestone
- Building a release-management UI
- Making live-provider checks part of the default day-to-day regression suite
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-03 | A repeatable manual verification checklist exists for release confidence across narration, Q&A, and multi-presentation flows [VERIFIED: .planning/REQUIREMENTS.md] | Build a release checklist and runbook that starts from the existing automated suite, layers in live Azure/Supabase checks, and captures explicit evidence and operator notes. [VERIFIED: package.json] [VERIFIED: server.js] [VERIFIED: scripts/check-azure-config.js] [VERIFIED: scripts/verify-azure-tts.js] |
| REL-01 | The system can pass a production-readiness gate for at least one real client-facing presentation project before rollout [VERIFIED: .planning/REQUIREMENTS.md] | Resolve the exact sole Supabase presentation slug, run a staging-like certification followed by a short production pass, and record blockers or sign-off in a durable acceptance artifact. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: public/app.js] |
</phase_requirements>

## Summary

Phase 6 should build on the confidence stack that already exists, not reinvent it. Phase 5 now gives the repo explicit smoke, regression, and extended commands, which means the release gate can treat automated coverage as the baseline rather than as the final proof. The remaining gap is live-provider trust and operator-ready evidence: the codebase still lacks a formal runbook, a certification checklist, and a sign-off artifact for a real presentation. [VERIFIED: package.json] [VERIFIED: .planning/phases/05-regression-harness/05-VALIDATION.md]

The codebase already contains two useful operational verification entrypoints. `scripts/check-azure-config.js` probes live Azure chat and realtime endpoints, and `scripts/verify-azure-tts.js` exercises real synthesis through `server/services/tts.js`. These are not sufficient on their own for release confidence, but they are the right starting pattern for Phase 6 because they validate provider health against the actual environment instead of mocks. [VERIFIED: scripts/check-azure-config.js] [VERIFIED: scripts/verify-azure-tts.js] [VERIFIED: server/services/tts.js]

The runtime is now prepared for an explicit real-presentation certification pass. `server/services/cms.js` can list and load Supabase-backed presentations with canonical `presentationSlug` metadata, and `server/routes/session.js` persists that canonical identity through session startup. That means the Phase 6 gate can and should resolve the sole Supabase presentation slug explicitly before the live run, record it in the runbook and acceptance artifact, and then certify that named target instead of relying on an implicit catalog default. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js] [VERIFIED: public/app.js]

The most important structural decision for Phase 6 is to separate “release discipline” from “new behavior work.” This phase should not sprawl back into rewriting playback, Q&A, or content loading. Instead, the checklist and live run should exercise the already-hardened seams: startup and passcode behavior, narration continuity, play/pause/resume, urgent Q&A interruption, answer quality, analytics/session event capture, completion, and restore if the certified flow requires it. Any failures discovered there become explicit blockers or deferred risks, not silent regressions. [VERIFIED: .planning/phases/02-playback-state-reliability/02-CONTEXT.md] [VERIFIED: .planning/phases/03-grounded-q&a-experience/03-CONTEXT.md] [VERIFIED: .planning/phases/04-content-loading-and-scaling-foundations/04-CONTEXT.md]

The two-environment gate is justified by the current runtime model. `server/config/runtime.js` treats staging and production as production-class environments with fail-closed configuration, while `server.js` exposes `/api/health` and startup logs that can confirm environment readiness before a session run. That makes a staging-like certification pass meaningful, and a short production pass afterward becomes a confirmation step rather than the only validation event. [VERIFIED: server/config/runtime.js] [VERIFIED: server.js]

## Recommended Plan Shape

1. Create the release checklist, runbook, evidence pack, and explicit target-resolution workflow first, because the live certification run should not be improvised during execution. [Inference from codebase]
2. Execute the real presentation certification second, using the automated suites plus live Azure/Supabase checks as preconditions, then capture go/no-go status and blockers in a durable acceptance record. [Inference from codebase]

## Patterns

### Pattern 1: Automated Baseline Before Live Certification
**What:** Treat the existing smoke/regression/extended test tiers as the pre-flight gate before any live-provider certification steps. [Inference from codebase]
**When to use:** release checklist ordering, staging-like preflight, production confirmation pass. [VERIFIED: package.json] [VERIFIED: .planning/phases/05-regression-harness/05-VALIDATION.md]
**Example:**
```bash
npm run test:extended
node scripts/check-azure-config.js
node scripts/verify-azure-tts.js
```

### Pattern 2: Live Provider Checks Through Existing Operational Scripts
**What:** Reuse the current Azure verification script style rather than inventing a second provider-check path. [Inference from codebase]
**When to use:** runbook steps, staging-like environment checks, evidence capture before the real session walkthrough. [VERIFIED: scripts/check-azure-config.js] [VERIFIED: scripts/verify-azure-tts.js]
**Example:**
```bash
node scripts/check-azure-config.js
node scripts/verify-azure-tts.js
```

### Pattern 3: Explicit Presentation Target Resolution
**What:** Resolve the certified Supabase presentation through the CMS listing/loading contract and record the canonical slug before the live run begins. [Inference from codebase]
**When to use:** runbook setup, evidence artifact, staging and production certification notes. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js]
**Example:**
```javascript
const catalog = await cmsService.listPresentations();
const target = catalog.find((presentation) => presentation.source === 'supabase');
```

### Pattern 4: Evidence-First Acceptance Record
**What:** Record environment, target slug, commands run, screenshots/logs collected, pass/fail notes, blockers, and release decision in one durable artifact per certified presentation. [Inference from codebase]
**When to use:** sign-off document, release review, blocker triage. [VERIFIED: Phase 6 locked decisions]

## Anti-Patterns to Avoid

- **Live run without explicit target identity:** the gate should not certify “the only Supabase presentation” informally; the exact slug must be recorded before testing starts. [VERIFIED: server/services/cms.js]
- **Production-only validation:** skipping the staging-like pass would make the first real fail-closed or provider issue appear directly in production. [VERIFIED: server/config/runtime.js]
- **Checklist without evidence:** a purely manual yes/no checklist does not meet the locked requirement for durable proof and sign-off. [VERIFIED: Phase 6 CONTEXT.md]
- **Using live-provider issues to reopen phase scope casually:** Phase 6 should report concrete blockers, not silently expand into a new reliability phase. [Inference from milestone structure]

## Common Pitfalls

### Pitfall 1: Provider health checks pass, but the real session journey still fails
**What goes wrong:** Azure endpoints respond and TTS works in isolation, but session start, narration sequencing, Q&A, or analytics still fail together during a real run. [Inference from codebase]
**How to avoid:** Treat provider scripts as preflight only, then run the full presentation journey through the actual app and capture evidence across the whole flow. [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/routes/questions.js]

### Pitfall 2: Certification evidence is scattered across console logs and memory
**What goes wrong:** The live run succeeds or fails, but there is no durable artifact showing what target was tested, which environment was used, what evidence was captured, or what the release decision was. [Inference from codebase]
**How to avoid:** Create a dedicated acceptance/sign-off artifact that references every checklist step and evidence item. [Inference from locked decisions]

### Pitfall 3: Wrong-source or wrong-target certification
**What goes wrong:** The team tests a presentation that happened to load, rather than the intended canonical Supabase target. [VERIFIED: server/services/cms.js] [VERIFIED: server/routes/session.js]
**How to avoid:** Resolve the sole Supabase-backed presentation slug explicitly, record it up front, and verify it appears in session metadata and evidence. [VERIFIED: server/routes/session.js]

### Pitfall 4: Release blocked by noise instead of by the agreed trust boundary
**What goes wrong:** Minor non-core issues derail release, or serious grounding/analytics/source-truth issues are waved through because the app “mostly worked.” [Inference from locked decisions]
**How to avoid:** Encode the blocker policy directly into the checklist and sign-off artifact so core-journey and trust failures are always decisive. [VERIFIED: Phase 6 CONTEXT.md]

## Validation Architecture

### Feedback loops needed
- Preflight loop: automated extended suite plus live Azure provider checks
- Certification loop: staging-like real presentation walkthrough with captured evidence
- Confirmation loop: short production pass on the same named presentation target

### Critical observables
- `/api/health` readiness and fail-closed startup behavior
- Exact certified `presentationSlug` and source for the live run
- Narration continuity, pause/resume behavior, Q&A grounding/quality, analytics/session timeline capture, and completion behavior
- Provider-check output, runtime logs, screenshots, and operator notes tied to the same run

### Minimum instrumentation expectation
- Explicit release checklist and runbook docs in the phase output
- One acceptance/sign-off artifact per certified presentation
- Structured evidence references for logs, screenshots, provider checks, and go/no-go decision

---

*Phase: 06-production-readiness-gate*
*Research completed: 2026-04-19*
