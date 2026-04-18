# Architecture

**Analysis Date:** 2026-04-19

## Pattern Overview

**Overall:** Modular monolith with a static browser client, an Express/Socket.IO backend, and content-driven presentation context.

**Key Characteristics:**
- `server.js` is the single composition root for HTTP, WebSocket, database bootstrap, middleware, and route mounting.
- Route handlers in `server/routes/*.js` stay relatively thin and delegate orchestration, AI, CMS, persistence, and playback concerns to `server/services/*.js`.
- Presentation behavior is data-driven: project knowledge and slide content live under `content/projects/*`, while session state and generated artifacts are stored in SQLite first and optionally mirrored to Supabase via `server/services/supabaseSession.js`.

## Layers

**Browser Client Layer:**
- Purpose: Render the presentation UI, manage playback state, submit user actions, and consume realtime events.
- Location: `public/app.js`, `public/index.html`, `public/services/*.js`, `public/styles.css`
- Contains: App bootstrap, DOM coordination, Web Audio playback, realtime socket wiring, voice session control, loading/progress UI.
- Depends on: REST endpoints under `/api/*`, Socket.IO server events from `server.js`, browser APIs, and the global Socket.IO client script.
- Used by: End users opening the static site served from `public/` via `express.static()` in `server.js`.

**HTTP API Layer:**
- Purpose: Expose session lifecycle, narration, slide control, QA, CMS, analytics, realtime token exchange, and admin utilities.
- Location: `server/routes/session.js`, `server/routes/questions.js`, `server/routes/narration.js`, `server/routes/slides.js`, `server/routes/autoplex.js`, `server/routes/realtime.js`, `server/routes/cms.js`, `server/routes/analytics.js`
- Contains: Request validation, auth/rate-limit enforcement, DB lookups, service coordination, Socket.IO emission points, and JSON responses.
- Depends on: `server/middleware/security.js`, `server/services/*.js`, Express request-scoped `db` and `io` objects attached in `server.js`.
- Used by: `public/app.js`, `public/services/socket.js`, and any admin/integration callers.

**Domain Services Layer:**
- Purpose: Hold business logic for presentation generation, question answering, AI prompting, persistence fallback, and session orchestration.
- Location: `server/services/*.js`
- Contains: `cms.js` for content loading, `model.js` for Azure OpenAI access, `tts.js` and `realtimePresenter.js` for audio generation, `slideEngine.js` for next-step decisions, `questionClassifier.js`, `analytics.js`, `masterSession.js`, `retrieval.js`, `pronunciation.js`, `stateStore.js`.
- Depends on: Prompt builders in `server/prompts/*.js`, data helpers like `server/services/dbHelper.js`, filesystem access, Azure/OpenAI APIs, and Supabase REST/storage APIs.
- Used by: Route modules and startup code in `server.js`.

**Persistence Layer:**
- Purpose: Persist mutable runtime state, generated narration artifacts, question/answer history, and remote durability.
- Location: `server/db/init.js`, `server/db/migrations.sql`, `server/services/dbHelper.js`, `server/services/supabaseSession.js`
- Contains: sql.js database bootstrap, schema upgrades, helper query methods, Supabase session/slide/question sync, and storage upload methods.
- Depends on: Filesystem for local DB persistence and generated audio, Supabase REST/storage when configured.
- Used by: `server.js`, route modules, and service modules such as `server/services/masterSession.js` and `server/routes/questions.js`.

**Content and Prompt Layer:**
- Purpose: Supply presentation structure, persona/rules content, and prompt templates without hardcoding deck knowledge into application logic.
- Location: `content/projects/beforest/*`, `server/decks/*.json`, `AGENTS.md`, `server/prompts/*.js`
- Contains: Project docs like `content/projects/beforest/soul.md`, `content/projects/beforest/product.md`, `content/projects/beforest/flow.md`, slide JSON under `content/projects/beforest/presentations/*.json`, and prompt builders used by `server/services/model.js`.
- Depends on: `server/services/cms.js` and `server/routes/realtime.js` for loading/compiling these documents into runtime context.
- Used by: Session startup, narration generation, question answering, and realtime voice interruption handling.

## Data Flow

**Session Start and Deck Materialization:**

1. `public/app.js` starts or restores a session by calling `POST /api/session/start` in `server/routes/session.js`.
2. `server/routes/session.js` loads a presentation through `server/services/cms.js`, writes a session plus slide rows into SQLite through `req.app.get('db')`, and optionally mirrors them through `server/services/supabaseSession.js`.
3. The same route triggers background pre-generation through `server/routes/autoplex.js`, then returns `sessionId`, `controlToken`, slide count, and presentation metadata to the browser.

**Presentation Playback and Realtime Updates:**

1. `public/services/socket.js` joins the Socket.IO room with `sessionId` and `controlToken`.
2. `server.js` validates the join using `hasValidSessionControlAsync()` from `server/middleware/security.js` and joins the socket to the session room.
3. `server/routes/autoplex.js` emits `presentation-start`, `slide-change`, `narration-delta`, `audio-chunk`, `audio-end`, `qa-start`, and `presentation-end`, while `public/app.js` and `public/services/audio.js` update UI state and stream PCM audio locally.

**Question Handling and Grounded Answering:**

1. A question is submitted to `server/routes/questions.js`, which loads session, slide, and project knowledge context through SQLite/Supabase plus `server/services/cms.js`.
2. The route composes the grounding bundle from `knowledgeDocs`, current slide notes, and full deck content using `buildQuestionKnowledgeContext()` in `server/routes/questions.js`.
3. The answer and optional audio are persisted locally and optionally uploaded via `server/services/supabaseSession.js`, then emitted back to clients for inline playback and history rendering.

**State Management:**
- Server state is split across persistent session data in SQLite/Supabase and transient in-memory maps used mainly by `server/routes/autoplex.js` for interrupts, pauses, pre-generation progress, replay caches, and active presentation runs.
- Browser state is held inside the `VoicePPTApp` class in `public/app.js`, with specialized service objects handling sockets, audio playback, voice mode, and DOM updates.

## Key Abstractions

**Presentation Session:**
- Purpose: The runtime unit that ties a participant, a deck, current slide index, auth token hash, metadata, generated assets, and QA history together.
- Examples: `server/routes/session.js`, `server/db/migrations.sql`, `server/services/supabaseSession.js`
- Pattern: Session-first orchestration; nearly every route resolves a `sessionId` and then derives slide/question behavior from that state.

**Knowledge Context Bundle:**
- Purpose: Merge slide-local content with project documents and global agent constitution so narration and answers stay grounded.
- Examples: `server/routes/questions.js`, `server/routes/realtime.js`, `content/projects/beforest/*.md`, `AGENTS.md`
- Pattern: String assembly from structured metadata plus Markdown documents, then truncation to bounded prompt sizes before model calls.

**Playback Orchestrator:**
- Purpose: Coordinate automated deck progression, interruption handling, pre-generation, replay, and end-of-session transitions.
- Examples: `server/routes/autoplex.js`, `server/routes/slides.js`, `server/services/slideEngine.js`, `public/services/socket.js`
- Pattern: Event-driven orchestration using in-memory session maps on the server and Socket.IO room broadcasts to keep clients synchronized.

**Dual Persistence Adapter:**
- Purpose: Treat SQLite as the immediate operational store and Supabase as an optional cross-server durability layer.
- Examples: `server/db/init.js`, `server/services/supabaseSession.js`, `server/routes/session.js`, `server/routes/questions.js`
- Pattern: Local-first writes and reads with remote fallback or mirror operations when Supabase credentials are available.

## Entry Points

**Backend Process Entry Point:**
- Location: `server.js`
- Triggers: `npm start`, `npm run dev`, or direct `node server.js`
- Responsibilities: Validate runtime config, create the Express/HTTP/Socket.IO server, initialize the sql.js database, register middleware and routes, expose `/api/health`, and manage graceful shutdown.

**Database Bootstrap Entry Point:**
- Location: `server/db/init.js`
- Triggers: Imported by `server.js` and invoked directly by `npm run db:init`
- Responsibilities: Create/load the sql.js database, run migrations from `server/db/migrations.sql`, ensure additive columns exist, and persist the database file.

**Browser App Entry Point:**
- Location: `public/app.js`
- Triggers: Loaded by `public/index.html`
- Responsibilities: Restore/start sessions, load presentation catalog and quotes, bind UI events, connect sockets, manage playback/transcript state, and call REST APIs for session and slide control.

**Content Loading Entry Point:**
- Location: `server/services/cms.js`
- Triggers: Session startup, CMS routes, and any presentation lookup
- Responsibilities: Resolve presentations from `content/projects/*` or legacy `server/decks/*.json`, merge project docs, and optionally source the same data from Supabase with a TTL cache.

## Error Handling

**Strategy:** Fail open in development for AI features when possible, but keep request-level errors isolated and return explicit HTTP or socket errors.

**Patterns:**
- Route handlers use `try/catch` and return JSON errors, as seen in `server/routes/session.js`, `server/routes/slides.js`, and `server/routes/realtime.js`.
- `server/services/model.js` falls back to mock implementations when Azure is not configured outside production, while `server/config/runtime.js` fails startup in production if required env groups are missing.
- Supabase operations in `server/services/cms.js`, `server/services/supabaseSession.js`, and related routes log and degrade to local-only behavior instead of stopping the request path.

## Cross-Cutting Concerns

**Logging:** Console-based logging throughout the backend, with service- and route-prefixed messages in files such as `server/routes/session.js`, `server/routes/autoplex.js`, and `server/services/cms.js`.

**Validation:** Runtime config validation lives in `server/config/runtime.js`; request authorization and session ownership checks live in `server/middleware/security.js`; targeted field validation appears inline in route handlers.

**Authentication:** Session-scoped control tokens are created and hashed in `server/middleware/security.js`, enforced on slide/session/realtime routes, and complemented by `ADMIN_API_KEY` checks for admin-only endpoints in `server.js`.

---

*Architecture analysis: 2026-04-19*
