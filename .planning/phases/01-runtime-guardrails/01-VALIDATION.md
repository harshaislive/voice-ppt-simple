---
phase: 1
slug: runtime-guardrails
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x + Supertest 7.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/runtime/cms-auth.test.js tests/runtime/analytics-auth.test.js tests/runtime/runtime-config.test.js --runInBand` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/runtime/runtime-config.test.js --runInBand` plus any touched auth/logging test file
- **After every plan wave:** Run `npx jest tests/runtime/*.test.js --runInBand`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | OPS-01 | T-1-01 | CMS mutations and preview reject missing or invalid admin credentials | integration | `npx jest tests/runtime/cms-auth.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | OPS-01 | T-1-02 | Analytics ingest rejects missing or invalid session/admin authorization | integration | `npx jest tests/runtime/analytics-auth.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | OPS-02 | T-1-03 | Runtime config fails closed for unsafe production/staging auth and CORS settings | unit | `npx jest tests/runtime/runtime-config.test.js --runInBand` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 3 | OPS-03 | T-1-04 | Shared logger emits structured redacted events and auth denials without leaking sensitive data | unit/integration | `npx jest tests/runtime/session-diagnostics.test.js --runInBand` | ❌ plan 03 | ⬜ pending |
| 1-04-01 | 04 | 4 | OPS-03 | T-1-05 | Session lifecycle instrumentation emits start/source/presentation/Q&A/end events with stable session bindings | integration | `npx jest tests/runtime/session-diagnostics.test.js --runInBand` | ❌ plan 04 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/runtime/runtime-config.test.js` — fail-closed coverage for `validateRuntimeConfig()`
- [ ] `tests/runtime/cms-auth.test.js` — unauthorized CMS mutation and preview cases
- [ ] `tests/runtime/analytics-auth.test.js` — unauthorized analytics ingest cases
- [ ] `tests/runtime/session-diagnostics.test.js` — structured logging and redaction assertions
- [ ] `jest.config.js` — Node/CommonJS test configuration
- [ ] `npm install --save-dev jest supertest` — install missing test framework

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Staging runtime behaves like production with only explicit test overrides | OPS-02 | Environment classification and secrets handling depend on deployment wiring | Boot the app in staging-like env settings and confirm startup rejects unsafe auth/CORS/session-control configuration while allowing only documented staging overrides |
| Session timeline is useful to operators during a real presentation run | OPS-03 | Operator usefulness and event readability require an end-to-end runtime check | Start a session, trigger auth failures and normal lifecycle events, then verify the resulting logs/timeline are readable, correlated by session, and free of raw prompt/token leakage |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
