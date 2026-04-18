# Phase 6 Release Checklist

## Goal

Certify one named real Supabase-backed presentation through a staging-like pass and a short production confirmation pass, with durable evidence and an explicit go/no-go decision.

## Certified Target

1. Run `node scripts/resolve-certification-target.js`.
2. Record the returned `presentationSlug`, `title`, `projectSlug`, and `source` in the acceptance artifact before any live run starts.
3. If the script returns zero or multiple Supabase-backed targets, stop the release gate and resolve the target explicitly before continuing.

## Automated Baseline

1. Run `npm run test:extended`.
2. If the suite fails, stop the release gate.
3. Record the command result and timestamp in the acceptance artifact.

## Provider Preflight

1. Run `node scripts/check-azure-config.js`.
2. Run `node scripts/verify-azure-tts.js`.
3. Record pass/fail, timings, and any provider errors in the acceptance artifact.
4. If either command fails, treat it as a blocker for the live certification pass.

## Runtime Readiness

1. Confirm the environment is using the intended runtime class for the pass:
   - staging-like for the first certification run
   - production for the short confirmation run
2. Confirm `/api/health` returns healthy service status for:
   - database
   - Azure OpenAI
   - Azure Speech
   - Supabase
3. Record the health payload or a redacted snapshot of it in the acceptance artifact.

## Staging-Like Certification Pass

1. Start a session for the named target `presentationSlug`.
2. Confirm the session metadata reflects the intended `presentationSlug` and Supabase source.
3. Run the presentation through the critical path:
   - session start
   - narration start
   - pause
   - resume
   - at least one representative Q&A interruption
   - completion
4. Confirm the critical path uses real providers and real content.
5. Capture evidence:
   - screenshots of startup, active narration, Q&A, and completion
   - provider check outputs
   - selected runtime logs
   - health output
   - notes on answer quality and trust

## Production Confirmation Pass

1. Repeat a short pass against the same named `presentationSlug`.
2. Confirm:
   - target identity is unchanged
   - startup succeeds
   - narration starts correctly
   - at least one representative Q&A works
   - completion or intentional stop path behaves correctly
3. Capture fresh evidence for the production pass.

## Blocker Policy

Release is blocked immediately by:

- session start failure
- wrong presentation or wrong source loaded
- narration not starting, cutting off, or losing pause/resume trust
- Q&A not answering, answering ungroundedly, or sounding obviously broken
- analytics or session timeline evidence missing for the certified run
- completion flow breaking or leaving the session in a bad state
- provider preflight failure

## Sign-Off

1. Complete `06-ACCEPTANCE-RECORD.md`.
2. Mark final decision as:
   - `GO`
   - `NO-GO`
3. List every known risk that is not a blocker.
4. If `NO-GO`, list the exact blockers and the next required action.
