---
phase: 4
slug: content-loading-and-scaling-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for source selection, canonical identity, project-package onboarding, and fail-closed content loading.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/runtime/content-source-resolution.test.js tests/runtime/content-identity.test.js --runInBand` |
| **Full suite command** | `npm test -- --runInBand tests/runtime/content-*.test.js` |
| **Estimated runtime** | ~40 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused test file for the modified slice
- **After every plan wave:** Run all `tests/runtime/content-*.test.js` suites
- **Before `$gsd-verify-work`:** Full Phase 4 runtime suite must be green
- **Max feedback latency:** 40 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure / Reliable Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|----------------------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | CMS-01, CMS-03 | T-4-01 | Loader honors explicit source declaration and rejects wrong-source startup | integration | `npx jest tests/runtime/content-source-resolution.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 2 | CMS-01 | T-4-02 | Canonical `presentationSlug` flows through session start, restore, and downstream lookups while legacy aliases remain compatible | integration | `npx jest tests/runtime/content-identity.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 4-03-01 | 03 | 3 | CMS-02 | T-4-03 | Project packages load consistently from explicit package metadata without core-logic edits | integration | `npx jest tests/runtime/content-project-package.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 4-04-01 | 04 | 4 | CMS-03 | T-4-04 | Operators receive explicit mismatch and fail-closed diagnostics instead of silent fallback | integration | `npx jest tests/runtime/content-fail-closed.test.js --runInBand` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/createContentLoadingHarness.js` — minimal harness for CMS/session/client selection paths
- [ ] `tests/runtime/content-source-resolution.test.js` — explicit source declaration and selection coverage
- [ ] `tests/runtime/content-identity.test.js` — canonical slug and compatibility-field coverage
- [ ] `tests/runtime/content-project-package.test.js` — project package listing/loading coverage
- [ ] `tests/runtime/content-fail-closed.test.js` — fail-closed diagnostics and wrong-source startup coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operators can tell which presentation source is active | CMS-03 | Log shape and startup errors need a quick human sanity check | Start one valid session and inspect logs/response metadata for requested slug, declared source, resolved source, and project slug |
| Wrong-source content is blocked clearly instead of silently swapped | CMS-01, CMS-03 | User-facing failure copy and operator clarity are easier to evaluate live | Request a presentation whose declared source is unavailable and confirm session start fails with an explicit error rather than loading another deck |
| Adding a new project package feels configuration-driven | CMS-02 | Onboarding ergonomics remain partly qualitative | Duplicate an existing project package, change slugs/titles, and verify it appears in catalog/loading without core-code edits |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 40s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
