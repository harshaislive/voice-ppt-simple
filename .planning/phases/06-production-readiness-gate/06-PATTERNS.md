# Phase 6: Production Readiness Gate - Patterns

## Pattern Map

### Pattern 1: Operational script preflight before manual runtime walkthrough
**Use for:** validating Azure/provider readiness before the certified session run.

**Reference files:**
- [scripts/check-azure-config.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/scripts/check-azure-config.js)
- [scripts/verify-azure-tts.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/scripts/verify-azure-tts.js)

**Why it matters:** Phase 6 needs live-provider proof, and these scripts already encode the current repo convention for real Azure checks.

### Pattern 2: Health endpoint and fail-closed runtime classification
**Use for:** environment readiness checks in staging-like and production runs.

**Reference files:**
- [server.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server.js)
- [server/config/runtime.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server/config/runtime.js)

**Why it matters:** The release gate should verify both startup correctness and service readiness before a human walkthrough begins.

### Pattern 3: Canonical presentation identity through session startup
**Use for:** resolving and recording the named Supabase certification target.

**Reference files:**
- [server/services/cms.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server/services/cms.js)
- [server/routes/session.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server/routes/session.js)
- [public/app.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/public/app.js)

**Why it matters:** The release artifact must certify one explicit `presentationSlug`, not an inferred default.

### Pattern 4: Structured runtime evidence via logs and analytics
**Use for:** tying the release decision to actual session events, not memory.

**Reference files:**
- [server/routes/analytics.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server/routes/analytics.js)
- [server/routes/session.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server/routes/session.js)
- [server/routes/autoplex.js](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/server/routes/autoplex.js)

**Why it matters:** The gate requires captured evidence for session lifecycle, narration, Q&A, and completion.

## Recommended Reuse

- Reuse the existing runtime suite as the automated preflight baseline instead of inventing a separate release test stack.
- Reuse the Azure verification script pattern for live provider checks.
- Reuse canonical `presentationSlug` metadata everywhere release docs, checklists, and acceptance artifacts refer to the target presentation.
- Reuse structured logs and analytics events as evidence references rather than relying on ad hoc notes alone.

## Anti-Patterns

- Certifying a presentation by title or human memory without recording the exact slug
- Running live-provider checks ad hoc without adding them to the repeatable runbook
- Treating screenshots alone as sufficient evidence without environment, log, and command references
- Letting Phase 6 plans drift back into broad runtime redesign instead of release verification
