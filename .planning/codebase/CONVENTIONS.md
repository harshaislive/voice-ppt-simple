# Coding Conventions

**Analysis Date:** 2026-04-19

## Naming Patterns

**Files:**
- Server files use lowercase camelCase or lowercase nouns by responsibility, for example `server/services/slideEngine.js`, `server/services/stateStore.js`, `server/routes/session.js`, and `server/config/runtime.js`.
- Frontend service modules use lowercase nouns in `public/services/`, for example `public/services/audio.js`, `public/services/socket.js`, and `public/services/ui.js`.
- Prompt builder files use descriptive camelCase names ending in `Prompt`, for example `server/prompts/narrationPrompt.js`, `server/prompts/classifyQuestionsPrompt.js`, and `server/prompts/nextStepPrompt.js`.
- Script files use kebab-case CLI names, for example `scripts/check-azure-config.js`, `scripts/verify-azure-tts.js`, `scripts/benchmark-pipeline.js`, and `scripts/seed-supabase.js`.

**Functions:**
- Internal helpers use camelCase, for example `parseAllowedOrigins()` in `server/config/runtime.js`, `extractSessionControlToken()` in `server/middleware/security.js`, and `buildTestContext()` in `scripts/benchmark-pipeline.js`.
- Route-local helpers are usually declared as function declarations near the top of the file, for example `getPreGenProgress()` in `server/routes/session.js`.
- Async workflow methods use verb-first names, for example `generateNarration()`, `generateNarrationStream()`, `classifyQuestions()`, and `decideNextAction()` in `server/services/model.js`.

**Variables:**
- Mutable locals use camelCase with explicit domain names, for example `allowedOrigins` in `server/config/runtime.js`, `pendingQuestions` in `server/routes/session.js`, and `questionAudioPausedNarration` in `public/app.js`.
- Environment-derived constants use uppercase snake case only for true constants, for example `DEFAULT_ALLOWED_ORIGINS` in `server/config/runtime.js`, `TEST_PHRASES` in `scripts/verify-azure-tts.js`, and `FIXTURE` in `scripts/benchmark-detailed.js`.
- Maps and sets are named after the collection type or purpose, for example `progressMap` in `server/routes/session.js`, `store` in `server/middleware/security.js`, and `notifiedAnswerIds` in `public/app.js`.

**Types:**
- No TypeScript or JSDoc typedef system is used. Shape contracts are implicit in object literals and JSON payload handling in files such as `server/routes/session.js`, `server/routes/autoplex.js`, and `public/app.js`.

## Code Style

**Formatting:**
- No formatter config was detected. The repository has no `.prettierrc`, `prettier.config.*`, `eslint.config.*`, or `biome.json`.
- Server-side CommonJS files consistently use 4-space indentation and semicolons, for example `server.js`, `server/routes/session.js`, and `server/services/model.js`.
- Frontend ES module files also use 4-space indentation and semicolons, for example `public/app.js`, `public/services/socket.js`, and `public/services/ui.js`.
- Strings are primarily single-quoted in JavaScript. Template literals are used for logs, SQL fragments, DOM text, and endpoint composition, for example in `server/routes/session.js`, `server/services/realtimePresenter.js`, and `public/services/ui.js`.
- Long files are accepted without decomposition. Representative large modules are `public/app.js`, `server/routes/autoplex.js`, `server/services/cms.js`, and `server/services/tts.js`.

**Linting:**
- No lint tool or lint script is configured in `package.json`.
- `package.json` only defines `start`, `dev`, `db:init`, `cms:seed`, and a placeholder `test` script.
- Consistency is maintained by local style habits rather than automated enforcement.

## Import Organization

**Order:**
1. Core or third-party packages first, for example `express`, `uuid`, `openai`, and `cors` in `server.js`, `server/routes/session.js`, and `server/services/model.js`.
2. Relative internal modules second, for example `../services/cms`, `../services/analytics`, and `../middleware/security` in `server/routes/session.js`.
3. Dynamic `require()` calls are used inside functions for expensive or cyclic dependencies, for example `require('./autoplex')` in `server/routes/session.js`, `require('../prompts/narrationPrompt')` in `server/services/model.js`, and `require('./server/services/tts')` inside `server.js` route handlers.

**Path Aliases:**
- Not detected. All imports use relative paths in `server/` and browser-relative module paths in `public/`.

## Error Handling

**Patterns:**
- Express handlers wrap most async logic in `try/catch` and return a JSON error payload with an HTTP status, for example `server/routes/session.js`, `server/routes/slides.js`, `server/routes/narration.js`, and `server/routes/questions.js`.
- Guard clauses are preferred for invalid input, for example `return res.status(400).json({ error: 'Query is required' });` in `server.js` and field validation in `server/routes/session.js`.
- Services generally log and either throw in production or fall back in development. `server/services/model.js` uses `this.failClosed` to throw when misconfigured in production and return mock output otherwise.
- Cross-system writes treat SQLite as the primary write path and remote persistence as best-effort. `server/routes/session.js` writes locally first, then calls `supabaseSession.createSession()` or `updateSession()` and logs remote failures without aborting the request.
- Global fallbacks exist at the app boundary through the unhandled error middleware and the 404 JSON handler in `server.js`.

## Logging

**Framework:** `console`

**Patterns:**
- Operational logging is pervasive and tagged by subsystem, for example `[Session]` in `server/routes/session.js`, `[PreGen]` and `[AutoPlex]` in `server/routes/autoplex.js`, and `[Model]` in `server/services/model.js`.
- Warnings are used for degraded but recoverable paths, for example `console.warn('Presentation ${deckId} not found, creating empty session')` in `server/routes/session.js` and fallback logs in `server/routes/autoplex.js`.
- Errors are logged with the caught error object or `error.message`, for example in `server.js`, `server/services/model.js`, and `scripts/verify-azure-tts.js`.
- Frontend logging is also direct `console.*`, for example connection and session recovery events in `public/app.js` and `public/services/socket.js`.

## Comments

**When to Comment:**
- Comments are used sparingly and mostly explain non-obvious runtime behavior, fallbacks, or sequencing requirements.
- Typical examples include route-ordering and fallback notes in `server/routes/session.js`, development CORS behavior in `server/config/runtime.js`, and testing hooks in `public/app.js`.
- Comments do not attempt full API documentation. Most functions are self-described by naming and nearby code.

**JSDoc/TSDoc:**
- Almost entirely absent.
- A rare block comment appears in `server/services/cms.js` above `invalidateCache(identifier)`, but formal API documentation is not a general pattern.

## Function Design

**Size:** Large functions and large modules are accepted when they own a workflow.
- `server/routes/autoplex.js` centralizes the presenter pipeline in one file.
- `public/app.js` keeps substantial client orchestration in a single app class.
- Smaller helper modules exist when concerns are tightly scoped, such as `server/config/runtime.js` and `server/middleware/security.js`.

**Parameters:**
- Object parameters are preferred when the call carries multiple contextual fields, for example `createRateLimiter({ windowMs, max, label })` in `server/middleware/security.js`, `modelService.decideNextAction({ ... })` in `server/services/slideEngine.js`, and `renderTranscriptReel(containerId, data = {})` in `public/services/ui.js`.
- Primitive parameters are still used for simple helpers, for example `hashToken(token)` and `extractClientInstanceId(req)` in `server/middleware/security.js`.

**Return Values:**
- Services often return plain objects with explicit keys rather than custom classes, for example the config object from `validateRuntimeConfig()` in `server/config/runtime.js` and benchmark result objects in `scripts/verify-azure-tts.js`.
- Router handlers always respond with JSON or binary payloads rather than returning values to callers.
- Validation helpers return booleans or structured state objects, for example `validateDecision()` in `server/services/slideEngine.js` and `getLocalSessionControlState()` in `server/middleware/security.js`.

## Module Design

**Exports:**
- Backend modules use CommonJS `module.exports`, either exporting singleton instances or helper collections.
- Stateful services are exported as instantiated singletons, for example `module.exports = new SlideEngine()` in `server/services/slideEngine.js`, `module.exports = new ModelService()` in `server/services/model.js`, and `module.exports = new CMSService()` in `server/services/cms.js`.
- Helper modules export named functions in an object, for example `server/middleware/security.js`, `server/config/runtime.js`, and `server/services/pronunciation.js`.
- Frontend modules use ESM named exports, for example `export class UIManager` in `public/services/ui.js` and `export class SocketClient` in `public/services/socket.js`.

**Barrel Files:**
- Not used. Callers import modules directly from concrete paths such as `./services/socket.js` or `../services/model`.

## Validation

**Input validation approach:**
- Validation is hand-written with explicit conditionals, not schema-driven.
- `server/routes/session.js` checks body shape, integer bounds, and enum membership before updating records.
- `server.js` validates required request fields on inline endpoints such as `/api/tts`, `/api/files/index`, and `/api/retrieve`.
- `server/config/runtime.js` validates production environment groups and throws one aggregated `INVALID_RUNTIME_CONFIG` error.
- `server/services/slideEngine.js` validates AI decisions with `validateDecision()` before trusting model output.

**Schema usage:**
- `server/schemas/sessionStart.json` exists, but no runtime reference to it was detected in `server/`, `public/`, or `scripts/`.
- Future code should not assume a centralized validator exists; current convention is manual validation close to the route or service boundary.

## Operational Conventions

**Persistence model:**
- Local SQLite is treated as the primary operational store for writes in `server/db/init.js`, `server/services/dbHelper.js`, and `server/routes/session.js`.
- Supabase persistence is optional and treated as a secondary sync path through `server/services/supabaseSession.js`.

**Configuration model:**
- Runtime configuration is environment-first. `require('dotenv').config();` appears at the top of `server.js`, `server/db/init.js`, and several scripts under `scripts/`.
- Production startup is expected to fail fast when critical config is missing through `validateRuntimeConfig()` in `server/config/runtime.js`.

**Security model:**
- Session control is token-based and enforced through reusable middleware in `server/middleware/security.js`.
- Admin-only endpoints rely on `x-admin-api-key` checked by `requireAdminApiKey()` in `server/middleware/security.js`.
- Basic security headers and in-memory request rate limiting are applied globally from `server.js`.

**Fallback strategy:**
- The code prefers graceful degradation over hard failure outside production. Examples include mock narration in `server/services/model.js`, SQLite-only session flow in `server/routes/session.js`, default loading quotes in `public/app.js`, and UI fallback status messages in `public/services/socket.js`.

**What to preserve when adding code:**
- Match CommonJS in `server/` and browser ESM in `public/`.
- Put request validation at the route boundary with explicit guards and JSON error responses.
- Use subsystem-prefixed `console` logging for long-running operational flows.
- Keep remote integrations best-effort unless the route explicitly requires hard failure.

---

*Convention analysis: 2026-04-19*
