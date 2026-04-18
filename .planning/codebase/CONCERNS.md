# Codebase Concerns

**Analysis Date:** 2026-04-19

## Tech Debt

**Single-file orchestration in presentation runtime:**
- Issue: Presentation control, audio replay, pre-generation, caching, timeout handling, Supabase sync, and Socket.IO wiring are concentrated in very large files instead of smaller bounded modules.
- Files: `server/routes/autoplex.js`, `public/app.js`, `server/services/cms.js`, `server/services/tts.js`
- Impact: Small changes can create regressions in unrelated flows, local reasoning is expensive, and recovery from race conditions or playback bugs depends on editing fragile shared state.
- Fix approach: Split orchestration into narrower services by concern: session lifecycle, narration generation, playback/replay, pre-generation cache, and transport/socket adapters. Keep route files thin and move state mutation rules behind explicit service APIs.

**Mixed persistence model across SQLite, Supabase, filesystem, and in-memory caches:**
- Issue: The runtime treats local `sql.js`, Supabase, on-disk generated audio, and process memory as overlapping sources of truth with partial fallbacks.
- Files: `server/routes/session.js`, `server/routes/questions.js`, `server/routes/autoplex.js`, `server/services/supabaseSession.js`, `server/services/masterSession.js`, `server/services/stateStore.js`
- Impact: Debugging stale reads, missing slides, replay mismatches, or restart recovery problems is difficult because data ownership is not strict.
- Fix approach: Define one canonical owner per data class. Use explicit sync jobs or write-through adapters instead of ad hoc fallback reads spread across routes.

## Known Bugs

**Analytics event endpoint accepts arbitrary session IDs without session auth:**
- Symptoms: Any caller can submit analytics events for any `sessionId`, regardless of controller ownership.
- Files: `server/routes/analytics.js`
- Trigger: `POST /api/analytics/event` with any `sessionId` and `eventType`.
- Workaround: None in code. Add `requireSessionControl` or an internal-only auth boundary before exposing this endpoint.

**CMS mutation endpoints are publicly callable:**
- Symptoms: Presentation records, slides, and knowledge docs can be created, updated, previewed, or deleted without admin authentication.
- Files: `server/routes/cms.js`
- Trigger: Call `POST`, `PUT`, or `DELETE` routes under `/api/cms/...`; no `requireAdminApiKey` or other middleware is applied.
- Workaround: None in code. Protect all mutating CMS routes and preview TTS routes behind admin auth immediately.

## Security Considerations

**Session control secret is persisted in browser storage and replayed on every API call:**
- Risk: The control token is returned to the browser and stored in `sessionStorage`, with fallback reads from `localStorage`; any XSS or shared-device leakage exposes full session control.
- Files: `server/routes/session.js`, `public/app.js`, `public/services/socket.js`
- Current mitigation: Server stores only `control_token_hash` in persistence via `server/middleware/security.js`.
- Recommendations: Move control to secure, httpOnly cookies or short-lived server-issued session credentials. Remove `localStorage` fallback for controller secrets and shorten session restoration scope.

**Operational auth can be globally disabled by environment flag:**
- Risk: Setting `DISABLE_SESSION_CONTROL=true` bypasses controller validation for all session control checks.
- Files: `server/middleware/security.js`
- Current mitigation: None besides environment discipline.
- Recommendations: Remove the bypass in production code, or gate it behind an explicit non-production assertion that fails hard when `NODE_ENV=production`.

**Development CORS is fully open and production falls back to permissive behavior when validation is bypassed:**
- Risk: Non-production accepts any origin via `origin: true`, and `createCorsOptions` also returns permissive settings when `allowedOrigins` is empty.
- Files: `server/config/runtime.js`, `server.js`
- Current mitigation: `validateRuntimeConfig()` throws in production when `ALLOWED_ORIGINS` is unset.
- Recommendations: Keep CORS policy strict by construction, not by startup convention. Return explicit deny behavior for empty production origin lists and narrow local defaults when possible.

**Prompt/logging pipeline captures participant and deck context in logs and remote analytics:**
- Risk: Participant names, prompt snippets, slide context, and event content are logged or forwarded to Supabase analytics without minimization.
- Files: `server/services/model.js`, `server/services/analytics.js`, `server/routes/session.js`, `public/app.js`
- Current mitigation: None beyond using server-side env credentials.
- Recommendations: Remove prompt preview logs, reduce participant-name logging, define retention rules for analytics content, and redact freeform user text before logging.

## Performance Bottlenecks

**Every mutating database call rewrites the full `sql.js` database file synchronously:**
- Problem: `DatabaseHelper.run`, `exec`, `prepare().run`, and `transaction` call `saveDatabase()`, which exports the entire database and writes it with `fs.writeFileSync`.
- Files: `server/services/dbHelper.js`, `server/db/init.js`
- Cause: `sql.js` is in-memory; persistence is implemented as full-file export on each write.
- Improvement path: Batch writes with debounce/checkpointing, move to a real server-side SQLite driver, or isolate hot event/question writes into an append-friendly store.

**Presentation runtime keeps multiple unbounded process-local caches and waiter maps:**
- Problem: Replay buffers, deck assets, pre-generation tasks, active runs, and pause/interrupt state are stored in `Map` instances with only partial cleanup.
- Files: `server/routes/autoplex.js`, `server/services/cms.js`, `server/services/masterSession.js`, `server/services/stateStore.js`
- Cause: Long-lived single-process orchestration relies on in-memory bookkeeping and timed cleanup.
- Improvement path: Add explicit eviction policies, lifecycle cleanup on session completion, metrics around map size, and durable job state for long-running presentation work.

**Retrieval uses `%LIKE%` scans over chunk text with no full-text index:**
- Problem: Document retrieval scales linearly with `document_chunks` size and returns simple substring matches.
- Files: `server/services/retrieval.js`
- Cause: Query path uses `WHERE dc.chunk_text LIKE ?` and orders by chunk index only.
- Improvement path: Use SQLite FTS or a dedicated retrieval index, then apply scoring and query normalization.

## Fragile Areas

**AutoPlex presentation state machine:**
- Files: `server/routes/autoplex.js`
- Why fragile: It mixes timers, socket events, pause/interrupt flags, audio replay, pre-generation, master session caching, and Supabase sync inside one module with many shared `Map` objects and cross-function invariants.
- Safe modification: Change one flow at a time, exercise start, interrupt, continue, replay, timeout, and session-end paths together, and inspect cleanup of every map keyed by `sessionId`.
- Test coverage: No automated tests detected for this route.

**Session restore and browser-side runtime recovery:**
- Files: `public/app.js`, `public/services/socket.js`, `server/routes/session.js`
- Why fragile: Recovery depends on stored controller state, socket readiness, replay ordering, and server-side session status being mutually consistent.
- Safe modification: Treat session restore as a separate flow from clean startup and verify reconnect, expired session, missing session, and socket join-failure scenarios explicitly.
- Test coverage: No automated tests detected.

**Supabase/local CMS hybrid loading:**
- Files: `server/services/cms.js`, `server/services/supabaseSession.js`, `server/routes/cms.js`
- Why fragile: Remote and local deck/project loading paths merge and fall back silently, making behavior dependent on partial configuration and network health.
- Safe modification: Add source-of-truth assertions and structured logging for which storage path was used before changing load/write behavior.
- Test coverage: No automated tests detected.

## Scaling Limits

**Single-process server state:**
- Current capacity: One Node process owns rate-limits, active presentation state, replay cache, and timeout cleanup in memory.
- Limit: Horizontal scaling breaks controller coordination and rate limiting because state is not shared across instances.
- Scaling path: Move session/runtime coordination into shared storage or a job system, and replace in-memory rate limiting with a distributed store.

**Audio and event-heavy sessions on `sql.js`:**
- Current capacity: Suitable for low concurrency and modest session/event volume.
- Limit: High write rates amplify synchronous full-database persistence and increase request latency.
- Scaling path: Replace `sql.js` with server-side SQLite/Postgres and use async persistence for event streams and generated artifact metadata.

## Dependencies at Risk

**`sql.js`:**
- Risk: The project uses a browser-oriented in-memory SQLite runtime on the server, then emulates durability with whole-file exports.
- Impact: Write amplification, restart sensitivity, and operational complexity around persistence.
- Migration plan: Move to a native SQLite driver or Postgres-backed persistence layer while keeping the current schema shape.

## Missing Critical Features

**Automated test suite:**
- Problem: `package.json` defines `"test": "echo \"Error: no test specified\" && exit 1"` and no `*.test.*` or `*.spec.*` files were detected.
- Blocks: Safe refactoring of `server/routes/autoplex.js`, `public/app.js`, auth flows, and persistence behavior.

**Authenticated admin boundary for CMS and preview tooling:**
- Problem: Operational endpoints for CMS mutation and narration preview are not protected.
- Blocks: Safe exposure of this server outside a trusted internal network.

## Test Coverage Gaps

**End-to-end presentation lifecycle:**
- What's not tested: Session creation, socket join, autoplex playback, interruption, question answering, resume, and presentation completion.
- Files: `server/routes/session.js`, `server/routes/autoplex.js`, `server/routes/questions.js`, `public/app.js`, `public/services/socket.js`
- Risk: Regressions in sequencing and state cleanup will only appear during manual demo runs.
- Priority: High

**Security-critical route protection:**
- What's not tested: Session control enforcement, admin API key enforcement, and unauthenticated access attempts against CMS and analytics endpoints.
- Files: `server/middleware/security.js`, `server/routes/cms.js`, `server/routes/analytics.js`, `server.js`
- Risk: Access-control gaps can persist unnoticed because there is no automated negative-path coverage.
- Priority: High

**Persistence and fallback consistency:**
- What's not tested: SQLite/Supabase parity, restart recovery, replay asset loading, and missing-remote fallback behavior.
- Files: `server/services/supabaseSession.js`, `server/services/cms.js`, `server/services/masterSession.js`, `server/db/init.js`
- Risk: Data divergence and restore failures will surface only under production-like outages or restarts.
- Priority: High

---

*Concerns audit: 2026-04-19*
