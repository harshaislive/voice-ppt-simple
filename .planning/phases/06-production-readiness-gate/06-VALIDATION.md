---
phase: 6
slug: production-readiness-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for release checklist creation, live-provider preflight, and real-presentation certification.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Automated baseline** | Jest runtime suites via `npm run test:extended` |
| **Live provider checks** | `node scripts/check-azure-config.js`, `node scripts/verify-azure-tts.js` |
| **Health surface** | `GET /api/health` |
| **Manual certification** | Staging-like walkthrough then short production pass |
| **Evidence target** | Checklist + captured evidence + acceptance/sign-off artifact |

---

## Sampling Rate

- **Before live certification:** Run the automated extended suite and provider checks
- **For each certification environment:** Capture one full evidence-backed walkthrough
- **Before release:** Both staging-like and production confirmation records must exist
- **Max ambiguity:** zero on target slug, environment, and go/no-go status

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure / Reliable Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|----------------------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | TEST-03 | T-6-01 | Release checklist, runbook, target resolution, and evidence contract are explicit and reusable | documentation / operational | `npm run test:extended && node scripts/check-azure-config.js && node scripts/verify-azure-tts.js` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 2 | REL-01 | T-6-02 | One named real Supabase-backed presentation passes staging-like certification and short production confirmation with evidence and blocker triage | live certification | `npm run test:extended` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ blocked*

---

## Wave 0 Requirements

- [ ] Explicit release checklist document
- [ ] Explicit runbook for staging-like and production certification passes
- [ ] Explicit target-resolution step for the sole current Supabase presentation slug
- [ ] Acceptance/sign-off artifact template or equivalent durable record
- [ ] Evidence capture contract for logs, screenshots, provider outputs, and blocker notes

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The named real presentation sounds trustworthy in a real run | REL-01 | Conversational quality and grounding trust cannot be reduced to unit assertions | Run the certified presentation end to end, ask representative prospect questions, and capture notes/screenshots on answer quality and trust |
| The checklist is usable by an operator under release pressure | TEST-03 | Documentation quality and operational clarity are human workflow properties | Follow the runbook cold in staging-like first, then production, and record any ambiguity or missing steps |
| The release decision is explicit and auditable | TEST-03, REL-01 | Sign-off quality depends on recorded human judgment plus evidence | Complete the acceptance artifact with environment, target slug, evidence references, blockers, and go/no-go outcome |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Wave 0 covers all missing release-discipline artifacts
- [ ] Automated extended suite is part of the release baseline
- [ ] Live provider checks are explicit and separate from default regression gating
- [ ] Certification requires named target slug, evidence, and go/no-go record
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
