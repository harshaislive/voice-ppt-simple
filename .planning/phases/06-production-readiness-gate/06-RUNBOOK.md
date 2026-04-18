# Phase 6 Runbook

## Scope

This runbook executes the Phase 6 production-readiness gate for the single current Supabase-backed presentation.

## Inputs

- environment under test: staging-like or production
- working application deployment for that environment
- valid Azure and Supabase credentials in `.env` or environment configuration
- access to the application URL and `/api/health`

## Commands

### 1. Resolve the certified target

```bash
node scripts/resolve-certification-target.js
```

Expected result:
- exactly one JSON object
- `source: "supabase"`
- non-empty `presentationSlug`

### 2. Run automated baseline

```bash
npm run test:extended
```

Expected result:
- all suites green

### 3. Run provider preflight

```bash
node scripts/check-azure-config.js
node scripts/verify-azure-tts.js
```

Expected result:
- Azure endpoint probe succeeds
- realtime or speech path is available
- TTS verification succeeds with passing synthesis checks

### 4. Check runtime health

```bash
curl -s http://<host>/api/health
```

Expected result:
- `status: "ok"`
- expected provider flags are present for the environment

## Staging-Like Walkthrough

1. Open the app against the staging-like environment.
2. Start the session using the certified `presentationSlug`.
3. Record:
   - startup screenshot
   - active narration screenshot
   - Q&A screenshot
   - completion screenshot
4. During the run, verify:
   - the intended presentation loads
   - narration starts cleanly
   - pause works
   - resume works
   - at least one representative question is answered credibly
   - the session reaches completion
5. Capture any relevant logs tied to the session.

## Production Confirmation

1. Repeat a shorter pass against production with the same target slug.
2. Reconfirm:
   - the target slug is unchanged
   - startup works
   - narration starts
   - one representative Q&A works
   - the session ends cleanly
3. Capture a smaller but still sufficient evidence set.

## Evidence Pack

Minimum evidence set:

- target resolution output from `scripts/resolve-certification-target.js`
- `npm run test:extended` output summary
- `scripts/check-azure-config.js` output
- `scripts/verify-azure-tts.js` output
- `/api/health` response
- staging-like screenshots
- production confirmation screenshots
- operator notes on Q&A grounding and conversational quality
- selected runtime log excerpts tied to the certified session

## Failure Handling

If any of the following occur, stop and mark `NO-GO`:

- target resolution ambiguity
- provider preflight failure
- health check missing required services
- wrong-source presentation load
- narration reliability failure
- Q&A trust failure
- missing analytics or session trace evidence

## Output

Complete [06-ACCEPTANCE-RECORD.md](/home/harsha-mudumba/ai_projects/ai-ppt-predictive-17april26/voice-ppt-simple/.planning/phases/06-production-readiness-gate/06-ACCEPTANCE-RECORD.md) after both passes.
