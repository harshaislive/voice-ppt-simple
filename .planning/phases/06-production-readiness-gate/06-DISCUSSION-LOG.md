# Phase 6: Production Readiness Gate - Discussion Log

**Date:** 2026-04-19
**Phase:** 06-production-readiness-gate

## Gray Areas Discussed

### 1. Certification target

| Option | Description | Selected |
|--------|-------------|----------|
| One real presentation in staging-like env | Certify one real presentation in a near-prod environment only | |
| One real presentation in production env | Certify directly in production only | |
| Two-environment gate | Staging-like certification first, then short production pass | ✓ |

**Notes:** The target presentation should be the sole current Supabase-backed presentation in this project. The exact slug still needs to be resolved and recorded during planning rather than treated as an implicit fallback.

### 2. Release gate depth

| Option | Description | Selected |
|--------|-------------|----------|
| Runtime only plus spot checks | Mostly local/runtime checks with limited live-provider validation | |
| Real-provider critical path | Use real OpenAI/TTS/Supabase for the core presentation journey | ✓ |
| Full live gate | Use real providers for the main journey plus broader edge and operator checks | |

**Notes:** Live providers should be used for the certified critical path, but not every failure case needs a fully live-provider gate.

### 3. Evidence required to pass

| Option | Description | Selected |
|--------|-------------|----------|
| Operator checklist only | Manual checklist without durable evidence artifact | |
| Checklist plus captured evidence | Manual checklist with saved logs, screenshots, and notes | |
| Checklist, evidence, and acceptance record | Checklist, captured evidence, and explicit sign-off artifact | ✓ |

**Notes:** Each certified presentation needs a durable acceptance record with go/no-go status, evidence, and known risks.

### 4. Blocker policy

| Option | Description | Selected |
|--------|-------------|----------|
| Core journey blockers only | Only startup, narration, control, answerability, and completion failures block release | |
| Core journey plus trust blockers | Also block on grounding, analytics/session trace, wrong-source loading, and obvious quality breakdowns | ✓ |
| Strict launch gate | Also block on missing evidence or any non-trivial known issue | |

**Notes:** The gate should stop release on both operational breakage and trust failures, but it does not need to treat every non-core unresolved issue as an automatic blocker.

## Locked Decisions

- Certify one real Supabase-backed presentation using a two-environment gate: staging-like first, then short production pass
- Use real OpenAI, TTS, and Supabase for the critical-path certified run
- Require checklist, captured evidence, and a durable acceptance/sign-off artifact
- Block release on both core-journey failures and trust failures
- Resolve and record the exact sole Supabase presentation slug during planning and execution

## Deferred / Out of Scope

- Certifying multiple presentations in this milestone
- Making live providers part of default day-to-day regression gating
- Building a larger release-management product surface beyond the Phase 6 checklist, runbook, and sign-off artifacts

---

*Discussion complete: 2026-04-19*
