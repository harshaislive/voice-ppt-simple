# Testing Patterns

**Analysis Date:** 2026-04-19

## Test Framework

**Runner:**
- Not detected.
- Config: Not detected. No `jest.config.*`, `vitest.config.*`, `playwright.config.*`, or `cypress.config.*` file exists in the repository root.

**Assertion Library:**
- Not detected.

**Run Commands:**
```bash
npm test                       # Placeholder script in `package.json`; always exits with an error
node scripts/verify-azure-tts.js
node scripts/check-azure-config.js
```

## Test File Organization

**Location:**
- No `*.test.*`, `*.spec.*`, or `__tests__/` files were detected under the repository.
- Verification is currently script-based under `scripts/` rather than organized into a test directory.

**Naming:**
- Operational verification scripts use descriptive kebab-case names, for example `scripts/verify-azure-tts.js`, `scripts/check-azure-config.js`, `scripts/benchmark-pipeline.js`, and `scripts/benchmark-detailed.js`.

**Structure:**
```text
scripts/
  verify-azure-tts.js
  check-azure-config.js
  benchmark-pipeline.js
  benchmark-detailed.js
```

## Test Structure

**Suite Organization:**
```javascript
async function main() {
  const healthOk = await ttsService.healthCheck();
  const results = [];

  for (const voice of voices) {
    for (const phrase of TEST_PHRASES) {
      results.push(await verifyVoice(voice, phrase));
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}
```
- This pattern comes from `scripts/verify-azure-tts.js`.
- The repository uses single-file executable scripts with an async `main()` or `run()` entrypoint, direct logging, and `process.exit()` status codes.

**Patterns:**
- Setup is done inline at file load with `require('dotenv').config();`, fixed fixtures, and direct service imports, for example `scripts/benchmark-detailed.js` and `scripts/check-azure-config.js`.
- There is no shared test bootstrap or reusable assertion helper.
- Verification depends on elapsed timing, service responses, and exit codes rather than structured assertions.

## Mocking

**Framework:** None

**Patterns:**
```javascript
function buildTestContext(slideIndex = 0) {
    return {
        slideTitle: 'Rhythm of Practice',
        slideContent: 'The forest does not rush to grow. It follows seasons.',
        slideNotes: 'Emphasize the patience required for meaningful change.',
        pendingQuestions: [],
        audienceContext: {},
        participantName: 'TestUser',
        knowledgeContext: 'This is a test context for benchmarking the narration pipeline.',
        slideIndex,
        totalSlides: 10,
        style: slideIndex === 0 ? 'hook' : 'conversational'
    };
}
```
- This fixture style comes from `scripts/benchmark-pipeline.js`.
- Instead of mocking modules, scripts construct representative context objects and call real services directly.
- `server/services/model.js` contains internal fallback methods such as `generateMockNarration()`, `mockClassifyQuestions()`, and `mockDecideNextAction()`, but those are production code fallbacks, not a test harness.

**What to Mock:**
- Not codified. Current verification favors hitting the real service layer, especially `server/services/tts.js`, `server/services/model.js`, and `server/services/realtimePresenter.js`.

**What NOT to Mock:**
- External provider connectivity checks intentionally avoid mocking. `scripts/check-azure-config.js` probes actual endpoints, and `scripts/verify-azure-tts.js` runs real synthesis through `ttsService`.

## Fixtures and Factories

**Test Data:**
```javascript
const FIXTURE = {
    slideTitle: 'Rhythm of Practice',
    slideContent: 'The forest does not rush to grow. It follows seasons.',
    slideNotes: 'Emphasize the patience required for meaningful change.',
    pendingQuestions: [],
    audienceContext: {},
    participantName: 'TestUser',
    knowledgeContext: 'This is a test context.',
    slideIndex: 1,
    totalSlides: 10,
    style: 'conversational'
};
```
- This pattern comes from `scripts/benchmark-detailed.js`.
- Script fixtures are plain objects embedded directly inside the script file.

**Location:**
- Co-located inside each script. No shared `fixtures/`, `factories/`, or builders directory was found.

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
Not available
```

## Test Types

**Unit Tests:**
- Not present.
- No isolated tests were found for `server/config/runtime.js`, `server/middleware/security.js`, `server/services/slideEngine.js`, or frontend modules under `public/services/`.

**Integration Tests:**
- Ad hoc script-based integration checks exist.
- `scripts/verify-azure-tts.js` verifies `server/services/tts.js` end-to-end against the configured provider.
- `scripts/check-azure-config.js` probes Azure chat and realtime endpoints using live credentials and exits non-zero on failures.
- `scripts/seed-supabase.js` functions as a data-loading operational script, not a test, but it exercises CMS data assumptions and Supabase connectivity.

**E2E Tests:**
- Not used.
- The closest approximation is manual browser testing aided by the `?state=end` shortcut in `public/app.js`, which skips to the completion screen for UI verification.

## Common Patterns

**Async Testing:**
```javascript
async function benchmark(name, fn) {
    const start = Date.now();
    const result = await fn();
    const elapsed = Date.now() - start;
    console.log(`  ${name}: ${elapsed}ms`);
    return { result, elapsed };
}
```
- This pattern comes from `scripts/benchmark-detailed.js`.
- Async checks are serialized with `await`, and timing is treated as part of the verification output.

**Error Testing:**
```javascript
try {
  const audioBuffer = await ttsService.synthesize(phrase, voice);
  return { success: true, audioSize: audioBuffer ? audioBuffer.length : 0 };
} catch (error) {
  return { success: false, error: error.message };
}
```
- This pattern comes from `scripts/verify-azure-tts.js`.
- Errors are captured into result objects, printed, then converted into a process exit code rather than assertion failures.

## Operational Verification Workflow

**Current repository practice:**
- Run `node scripts/check-azure-config.js` before relying on Azure OpenAI or realtime endpoints.
- Run `node scripts/verify-azure-tts.js` to validate voice synthesis and provider health against the current environment.
- Use `node scripts/benchmark-pipeline.js` and `node scripts/benchmark-detailed.js` when tuning narration, TTS latency, and slide pre-generation timing.
- Use `npm run db:init` and `npm run cms:seed` to validate database and CMS data paths before manual presentation testing.

**Browser verification:**
- Manual verification is expected for the presentation UI in `public/index.html`, `public/app.js`, and `public/services/*.js`.
- `public/app.js` contains a testing hook via `?state=end`, which is useful for checking the completion screen without running a full session.

## Testing Gaps

**Missing automation:**
- `package.json` does not expose a working automated test command.
- There is no CI-oriented test runner, no fixture sharing, and no snapshot or browser automation.

**High-risk untested areas:**
- `server/routes/autoplex.js` is the largest orchestration path and has no automated coverage.
- `public/app.js` contains substantial state and playback orchestration with no frontend test harness.
- Security-sensitive middleware in `server/middleware/security.js` has no unit tests for token extraction, timing-safe comparison, or rate limiting.
- Validation logic in `server/routes/session.js` is entirely manual and untested.
- Runtime configuration failure paths in `server/config/runtime.js` are untested.

**Implications for future work:**
- New code should include a real test runner before more behavior is added to `server/routes/autoplex.js`, `server/services/tts.js`, or `public/app.js`.
- Until a framework exists, preserve the current script-based verification entrypoints so operational checks remain possible.

---

*Testing analysis: 2026-04-19*
