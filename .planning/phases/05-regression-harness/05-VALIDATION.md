---
phase: 5
slug: regression-harness
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for regression harness foundation, critical-path integration, and negative-path protection.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npm run test:smoke` |
| **Standard regression command** | `npm run test:regression` |
| **Extended command** | `npm run test:extended` |
| **Estimated runtime target** | smoke: < 30s, standard: < 2m, extended: < 5m |

---

## Sampling Rate

- **After every task commit:** Run the relevant focused tier for that slice
- **After every plan wave:** Run the standard regression tier
- **Before `$gsd-verify-work`:** Standard and extended tiers must be green
- **Max feedback latency:** smoke < 30s, standard < 2m

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure / Reliable Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|----------------------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | TEST-01, TEST-02 | T-5-01 | Shared harnesses and tiered commands make regression confidence explicit and runnable | integration / tooling | `npm run test:smoke` | ✅ [05-regression-harness-01-SUMMARY.md](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/.planning/phases/05-regression-harness/05-regression-harness-01-SUMMARY.md) | ✅ green |
| 5-02-01 | 02 | 2 | TEST-01 | T-5-02 | Main presentation journey and reconnect/restore flow are protected as first-class regressions | integration | `npm run test:regression` | ✅ [05-regression-harness-02-SUMMARY.md](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/.planning/phases/05-regression-harness/05-regression-harness-02-SUMMARY.md) | ✅ green |
| 5-03-01 | 03 | 3 | TEST-02 | T-5-03 | Security/startup and runtime continuity failure paths are protected in the regression contract | integration / negative-path | `npm run test:extended` | ✅ [05-regression-harness-03-SUMMARY.md](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/.planning/phases/05-regression-harness/05-regression-harness-03-SUMMARY.md) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Shared backend/session orchestration harness for integrated runtime flows
- [x] Explicit `npm` scripts or equivalent Jest grouping for smoke, standard, and extended tiers
- [x] Main journey regression suite
- [x] Restore/reconnect regression suite
- [x] Negative-path regression suite for startup/security and runtime continuity failures

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The tiered suite contract is understandable to humans | TEST-01, TEST-02 | Naming and confidence semantics remain partly operational/documentation quality | Ask a teammate or future-self question: “What do I run for quick confidence, normal regression, and pre-ship?” The repo should answer that directly through commands and docs |
| Regression flows reflect the real operator fear pattern | TEST-01 | “Did this suite actually reduce fear?” is partly experiential | After Phase 5, make a small change in playback or Q&A logic and confirm the regression tiers make it obvious what should be run before shipping |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Smoke/standard/extended contract is explicit in scripts or documented command surface
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
