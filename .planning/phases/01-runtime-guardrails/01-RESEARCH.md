# Phase 1: Runtime Guardrails - Research

**Researched:** 2026-04-19
**Domain:** Express runtime hardening, operational authorization, structured diagnostics [VERIFIED: codebase]
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Operational route protection
- **D-01:** CMS write routes and preview narration are operational surfaces, not public product APIs, and must require `ADMIN_API_KEY`.
- **D-02:** Analytics ingestion must not remain public; it should require either valid session control for session-scoped events or an explicit admin/internal path for operational events.
- **D-03:** Read-only CMS/project listing routes may remain open only where they are genuinely needed by the client product surface; mutation and preview capabilities must be protected.

### Runtime fail-closed posture
- **D-04:** Production must fail closed on unsafe auth, CORS, session-control, and required provider configuration.
- **D-05:** Staging should behave close to production, with only explicitly marked test credentials or overrides allowed.
- **D-06:** `DISABLE_SESSION_CONTROL` should not be available as an unrestricted escape hatch outside clearly non-production local development.

### Operational diagnostics
- **D-07:** Diagnostics should use structured server-side logs rather than ad hoc `console.log` messages.
- **D-08:** The system must support reconstructing a session timeline across major lifecycle events: session start, auth failures, source selection, presentation lifecycle, Q&A lifecycle, and session end.
- **D-09:** Logs should be actionable for operators but should minimize sensitive participant and prompt content where possible.

### Claude's Discretion
- Exact structured logging format and field names, as long as they are consistent across routes and services.
- Whether session timelines are reconstructed purely from logs, from analytics events, or from a hybrid of both, as long as the result is inspectable and coherent.
- The specific staging override mechanism, as long as it is explicit, limited, and clearly impossible to mistake for production-safe behavior.

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | CMS mutation, preview, analytics, and other sensitive endpoints enforce the correct admin or session-control authorization [VERIFIED: .planning/REQUIREMENTS.md] | Protect mutating CMS and preview routes with `requireAdminApiKey`; require `requireSessionControl` or a distinct admin path for analytics writes; preserve only genuinely needed read routes as public. [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js] [VERIFIED: server/middleware/security.js] |
| OPS-02 | Production runtime boots only with safe configuration for auth, CORS, AI providers, and persistence dependencies [VERIFIED: .planning/REQUIREMENTS.md] | Tighten `validateRuntimeConfig()` and `createCorsOptions()` so production and staging fail closed, and remove unrestricted `DISABLE_SESSION_CONTROL` bypass outside local development. [VERIFIED: server/config/runtime.js] [VERIFIED: server/middleware/security.js] |
| OPS-03 | Operators can inspect actionable logs or metrics for session lifecycle, playback failures, Q&A failures, and source-of-truth decisions [VERIFIED: .planning/REQUIREMENTS.md] | Replace ad hoc console logging with structured server logs, add per-session child loggers and redaction, and log source selection plus lifecycle events at route/service boundaries. [VERIFIED: server.js] [VERIFIED: server/services/analytics.js] [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/autoplex.js] [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] |
</phase_requirements>

## Summary

Phase 1 should stay inside the existing Express + Socket.IO architecture and harden the two existing policy chokepoints: `server/middleware/security.js` for auth/session rules and `server/config/runtime.js` for environment/CORS/provider startup rules. That matches the current composition root in `server.js`, which already validates runtime config at boot and mounts middleware before routes. [VERIFIED: server.js] [VERIFIED: server/config/runtime.js] [VERIFIED: server/middleware/security.js]

The highest-risk gaps are already concrete in the codebase: CMS writes and preview narration are public, analytics event ingestion is public, development and empty-production CORS paths are permissive, and `DISABLE_SESSION_CONTROL=true` bypasses all async session checks. These are direct blockers for `OPS-01` and `OPS-02`. [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js] [VERIFIED: server/config/runtime.js] [VERIFIED: server/middleware/security.js]

For diagnosability, the codebase is heavily `console.*`-driven across routes and services, with prompt/context logging already leaking more detail than Phase 1 should preserve. The planning target should be a small structured logging layer, not a large observability platform: request/session child loggers, stable event names, consistent metadata keys, and redaction for tokens, participant identifiers, and prompt-heavy payloads. [VERIFIED: server.js] [VERIFIED: server/services/analytics.js] [VERIFIED: server/services/model.js] [VERIFIED: .planning/codebase/CONCERNS.md] [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md]

**Primary recommendation:** Keep the current Express/Socket.IO stack, centralize Phase 1 changes in `server/config/runtime.js` and `server/middleware/security.js`, add `pino`-based structured logs with session-scoped child loggers, and add a thin Jest + Supertest negative-path suite for auth/runtime guardrails. [VERIFIED: codebase] [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] [CITED: https://jestjs.io/docs/getting-started] [CITED: https://github.com/forwardemail/supertest]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CMS mutation protection | API / Backend [VERIFIED: codebase] | Frontend Server - none [VERIFIED: codebase] | These routes are Express handlers under `/api/cms`, so auth belongs in route middleware, not the browser. [VERIFIED: server/routes/cms.js] |
| Preview narration protection | API / Backend [VERIFIED: codebase] | AI provider boundary [VERIFIED: codebase] | Preview narration is a server route invoking TTS, so access control must occur before the provider call. [VERIFIED: server/routes/cms.js] [VERIFIED: server/services/tts.js] |
| Analytics authorization | API / Backend [VERIFIED: codebase] | Storage / Supabase [VERIFIED: codebase] | The trust boundary is the ingest route; Supabase persistence should only receive already-authorized events. [VERIFIED: server/routes/analytics.js] [VERIFIED: server/services/analytics.js] |
| Runtime fail-closed boot checks | API / Backend [VERIFIED: codebase] | External providers [VERIFIED: codebase] | Startup validation executes in `server.js` through `validateRuntimeConfig()`. [VERIFIED: server.js] [VERIFIED: server/config/runtime.js] |
| CORS policy | API / Backend [VERIFIED: codebase] | Browser / Client [CITED: https://expressjs.com/en/resources/middleware/cors.html] | The server emits CORS headers, but browsers enforce them; non-browser clients ignore them. [CITED: https://expressjs.com/en/resources/middleware/cors.html] |
| Session control enforcement | API / Backend [VERIFIED: codebase] | Socket transport [VERIFIED: codebase] | HTTP routes and Socket.IO join logic both depend on the same session-control middleware logic. [VERIFIED: server/middleware/security.js] [VERIFIED: server.js] |
| Session timeline diagnostics | API / Backend [VERIFIED: codebase] | Storage / Analytics [VERIFIED: codebase] | The server owns lifecycle events and can emit structured logs and analytics events with a shared session identifier. [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/autoplex.js] [VERIFIED: server/services/analytics.js] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 4.18.2 in repo; 5.1.0 latest on npm, published about 5-6 months before crawl [VERIFIED: package.json] [VERIFIED: npm registry] | Existing HTTP API and middleware composition root. [VERIFIED: server.js] | Phase 1 should preserve the current Express app shape and harden middleware rather than add a second runtime layer. [VERIFIED: server.js] |
| socket.io | 4.7.2 in repo; 4.8.1 latest on npm, published about 10 months before crawl [VERIFIED: package.json] [VERIFIED: npm registry] | Existing realtime join and room transport. [VERIFIED: server.js] | Session authorization already spans HTTP and Socket.IO, so keeping one transport is lower risk than changing realtime infrastructure. [VERIFIED: server.js] [CITED: https://socket.io/docs/v4/rooms/] |
| cors | 2.8.5 in repo and latest on npm, published about 7 years before crawl [VERIFIED: package.json] [VERIFIED: npm registry] | Existing CORS middleware. [VERIFIED: server.js] | The package already supports static and dynamic origin validation, which is enough for fail-closed origin allowlists in this phase. [CITED: https://expressjs.com/en/resources/middleware/cors.html] |
| pino | 9.9.4 latest on npm, published about 16 hours before crawl [VERIFIED: npm registry] | Recommended structured JSON logger for server diagnostics. [VERIFIED: npm registry] | Child loggers, bindings, and redaction directly fit the session-scoped timeline requirement without hand-rolling a logger format. [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | 13.1.1 latest on npm, published about 15 days before crawl [VERIFIED: npm registry] | Dev-only readable log formatting. [VERIFIED: npm registry] | Use only for local development or CI log readability, not production log transport. [VERIFIED: npm registry] |
| jest | 30.1.3 latest on npm, published about 4 days before crawl [VERIFIED: npm registry] | Test runner for negative-path auth/runtime tests. [VERIFIED: npm registry] | Use for Phase 1 route and config coverage because the repo currently has no test harness. [VERIFIED: package.json] [CITED: https://jestjs.io/docs/getting-started] |
| supertest | 7.1.4 latest on npm, published about 2 months before crawl [VERIFIED: npm registry] | HTTP assertions against the Express app. [VERIFIED: npm registry] | Use for auth guard, fail-closed, and health-route tests without binding fixed ports. [CITED: https://github.com/forwardemail/supertest] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pino` [VERIFIED: npm registry] | Keep `console.*` only [VERIFIED: codebase] | Lower install cost, but no child loggers, no structured bindings, and no built-in redaction discipline. [VERIFIED: server.js] [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] |
| Jest + Supertest [VERIFIED: npm registry] | Node's built-in `node:test` plus manual HTTP assertions [ASSUMED] | Lighter dependency footprint, but weaker brownfield familiarity and less direct guidance for this CommonJS Express setup. [ASSUMED] |

**Installation:**
```bash
npm install pino
npm install --save-dev pino-pretty jest supertest
```

**Version verification:** Direct `npm view` calls hung under sandboxed network restrictions during this session, so version and publish-date checks were verified from npm package pages instead. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram
```text
Client browser / operator tools
  -> HTTP /api/cms, /api/analytics, /api/session, /api/health [VERIFIED: server.js]
  -> Socket.IO join-session [VERIFIED: server.js]

HTTP request / socket event
  -> Global middleware: security headers, CORS, JSON, rate limits [VERIFIED: server.js]
  -> Route auth gate:
       - requireAdminApiKey for operational CMS writes and preview [VERIFIED: server/middleware/security.js]
       - requireSessionControl for session-scoped analytics and control routes [VERIFIED: server/middleware/security.js]
  -> Route handler
  -> Service layer:
       - cmsService [VERIFIED: server/routes/cms.js]
       - analyticsService [VERIFIED: server/routes/analytics.js]
       - ttsService / autoplex / session flows [VERIFIED: server.js]
  -> Persistence / provider edge:
       - SQLite helper [VERIFIED: server.js]
       - optional Supabase sync [VERIFIED: server/services/analytics.js]
       - Azure/OpenAI/Speech providers [VERIFIED: server/config/runtime.js]
  -> Structured log event with requestId/sessionId/route/outcome [Inference from codebase + CITED: https://github.com/pinojs/pino/blob/main/docs/api.md]
```

### Recommended Project Structure
```text
server/
├── config/
│   └── runtime.js          # Startup policy, env classification, CORS allowlists
├── middleware/
│   ├── security.js         # Admin/session authorization and route guards
│   └── logger.js           # Base logger, request logger, child logger helpers
├── routes/
│   ├── cms.js              # Public reads + admin-protected writes/preview
│   ├── analytics.js        # Session-protected ingest + optional admin ingest
│   └── session.js          # Session lifecycle logging anchors
└── services/
    └── analytics.js        # Timeline/event sink with minimized payloads

tests/
├── runtime-config.test.js  # validateRuntimeConfig() fail-closed cases
├── cms-auth.test.js        # admin-required mutations and preview
└── analytics-auth.test.js  # session/admin enforcement on event ingest
```

### Pattern 1: Central Policy Modules
**What:** Put all environment classification and fail-closed rules in `server/config/runtime.js`, and all auth/session gate rules in `server/middleware/security.js`. [VERIFIED: codebase]
**When to use:** Any change affecting production/staging boot behavior, CORS, `ADMIN_API_KEY`, or session-control bypass logic. [VERIFIED: server/config/runtime.js] [VERIFIED: server/middleware/security.js]
**Example:**
```javascript
// Source: server.js + server/config/runtime.js + server/middleware/security.js
const runtimeConfig = validateRuntimeConfig();
const corsOptions = createCorsOptions(runtimeConfig.allowedOrigins);

app.use(securityHeaders);
app.use(cors(corsOptions));
app.use('/api/cms', cmsRoutes);
```

### Pattern 2: Route-Class Authorization
**What:** Split routes into public read, admin operational, and session-scoped operational classes, then apply middleware at router or sub-router granularity. [Inference from codebase]
**When to use:** CMS and analytics routes where some endpoints stay public but write/preview/event paths do not. [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js]
**Example:**
```javascript
// Source: Express middleware pattern + current security middleware
router.get('/presentations', listPresentations); // public read if product needs it
router.post('/presentations', requireAdminApiKey, createPresentation);
router.post('/preview-narration', requireAdminApiKey, previewNarration);
router.post('/event', requireSessionControl({ keys: ['sessionId'] }), logSessionEvent);
```
// Source: https://expressjs.com/en/guide/using-middleware

### Pattern 3: Session-Scoped Child Loggers
**What:** Create a base logger per request or route, then spawn child loggers with `sessionId`, `route`, and subsystem bindings so every lifecycle event can be correlated. [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md]
**When to use:** Session start/end, source selection, auth failure, playback transitions, Q&A transitions, and provider failure handling. [VERIFIED: server/routes/session.js] [VERIFIED: server/routes/autoplex.js]
**Example:**
```javascript
// Source: pino child logger API
const baseLogger = pino({
    redact: ['req.headers.authorization', 'req.headers.x-admin-api-key', 'participantName', 'content']
});

const sessionLogger = baseLogger.child({
    sessionId,
    route: '/api/session/start',
    subsystem: 'session'
});

sessionLogger.info({ event: 'session_started', slideCount, sourceType }, 'session lifecycle');
```
// Source: https://github.com/pinojs/pino/blob/main/docs/api.md

### Anti-Patterns to Avoid
- **Per-route ad hoc auth decisions:** Do not duplicate token/key checks inline across handlers; keep auth in middleware so policy changes stay centralized. [VERIFIED: server/middleware/security.js]
- **Fail-open fallback CORS:** Do not return `origin: true` when production allowlists are empty; explicit deny is safer. [VERIFIED: server/config/runtime.js] [CITED: https://expressjs.com/en/resources/middleware/cors.html]
- **Global operational bypass:** Do not let `DISABLE_SESSION_CONTROL=true` short-circuit production or staging policy. [VERIFIED: server/middleware/security.js]
- **Prompt-heavy or participant-heavy logs:** Do not continue logging prompt previews or raw analytics content where a summary or event code is enough. [VERIFIED: server/services/model.js] [VERIFIED: server/services/analytics.js]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured JSON logging | Custom `console.log(JSON.stringify(...))` wrappers [VERIFIED: codebase] | `pino` child loggers + redaction [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] | Built-in bindings, levels, redaction, and child logger inheritance fit session timelines directly. [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] |
| CORS allowlist evaluation | Manual header writing [ASSUMED] | `cors` middleware dynamic `origin` callback [CITED: https://expressjs.com/en/resources/middleware/cors.html] | The existing package already handles origin validation and preflight behavior. [CITED: https://expressjs.com/en/resources/middleware/cors.html] |
| HTTP auth negative-path harness | Hand-run curl scripts only [VERIFIED: package.json] | Jest + Supertest [CITED: https://jestjs.io/docs/getting-started] [CITED: https://github.com/forwardemail/supertest] | Phase 1 needs repeatable unauthorized-path coverage before deeper runtime changes. [VERIFIED: .planning/REQUIREMENTS.md] |

**Key insight:** Phase 1 is a boundary-hardening phase, so custom infrastructure adds risk without increasing product value; use focused middleware and logging/test libraries instead. [Inference from requirements + codebase]

## Common Pitfalls

### Pitfall 1: Treating CORS as Authorization
**What goes wrong:** A route looks "protected" because browsers cannot read its response cross-origin, but non-browser clients can still call it directly. [CITED: https://expressjs.com/en/resources/middleware/cors.html]
**Why it happens:** CORS sets response headers and is enforced by browsers, not by the server for all clients. [CITED: https://expressjs.com/en/resources/middleware/cors.html]
**How to avoid:** Keep auth in `requireAdminApiKey` / `requireSessionControl`; treat CORS as browser policy only. [VERIFIED: server/middleware/security.js]
**Warning signs:** Public POST routes with input validation but no auth middleware. [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js]

### Pitfall 2: Protecting HTTP but Forgetting Socket Join Paths
**What goes wrong:** Session control is tightened on REST endpoints while Socket.IO `join-session` still becomes the easier bypass path. [VERIFIED: server.js]
**Why it happens:** HTTP and socket surfaces are mounted separately in `server.js`. [VERIFIED: server.js]
**How to avoid:** Reuse the same session-control helper for both HTTP and socket joins, and log failures from both paths with a shared event schema. [VERIFIED: server.js] [VERIFIED: server/middleware/security.js]
**Warning signs:** Unauthorized join attempts only show up as ad hoc console messages or not at all. [VERIFIED: server.js]

### Pitfall 3: Logging Too Much Sensitive Context
**What goes wrong:** Prompt previews, participant names, tokens, and freeform event `content` leak into logs or analytics. [VERIFIED: server/services/model.js] [VERIFIED: server/services/analytics.js]
**Why it happens:** The current codebase logs directly from many routes/services and analytics persists arbitrary `content`. [VERIFIED: server/services/analytics.js] [VERIFIED: server/services/model.js]
**How to avoid:** Log event codes and short summaries, redact known sensitive paths, and keep raw prompt/user text out of standard info logs. [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md]
**Warning signs:** `console.log` statements printing prompt previews, participant names, or provider payload fragments. [VERIFIED: server/services/model.js] [VERIFIED: server/routes/session.js]

### Pitfall 4: Tightening Production but Leaving Staging Ambiguous
**What goes wrong:** Staging quietly behaves like development, so auth/config problems surface only at production boot. [VERIFIED: server/config/runtime.js]
**Why it happens:** The current runtime only distinguishes `production` vs everything else. [VERIFIED: server/config/runtime.js]
**How to avoid:** Introduce explicit environment classification such as local/dev, staging, production, and attach clear override rules to staging only when named and auditable. [Inference from locked decisions D-04, D-05, D-06]
**Warning signs:** `NODE_ENV !== 'production'` paths implicitly allow wide-open origins or disabled session control. [VERIFIED: server/config/runtime.js] [VERIFIED: server/middleware/security.js]

## Code Examples

Verified patterns from official sources and the current codebase:

### Dynamic CORS Allowlist
```javascript
// Source: https://expressjs.com/en/resources/middleware/cors.html
const corsOptions = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
    }
};
```

### Socket.IO Room Join
```javascript
// Source: https://socket.io/docs/v4/rooms/
io.on('connection', (socket) => {
    socket.join(sessionId);
    io.to(sessionId).emit('session-joined');
});
```

### Pino Child Logger With Redaction
```javascript
// Source: https://github.com/pinojs/pino/blob/main/docs/api.md
const logger = pino({
    redact: ['req.headers.authorization', 'req.headers.x-admin-api-key', 'participantName']
});

const child = logger.child({ sessionId, subsystem: 'analytics' });
child.info({ event: 'analytics_ingest_authorized' }, 'analytics event accepted');
```

### Graceful Shutdown Hook
```javascript
// Source: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
process.on('SIGTERM', () => {
    server.close(() => {
        process.exit(0);
    });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad hoc `console.*` diagnostics [VERIFIED: codebase] | Structured JSON logging with child bindings and redaction [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] | Mature current practice, verified from current Pino docs [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] | Easier correlation by `sessionId`, safer log hygiene, machine-readable timelines. [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] |
| Binary `production` vs non-production boot policy [VERIFIED: server/config/runtime.js] | Explicit environment classification with staging near production [Inference from locked decisions] | Project-specific recommendation for this phase [Inference from locked decisions] | Staging catches auth/CORS/provider failures earlier. [Inference from locked decisions] |
| Public operational POST routes with validation only [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js] | Middleware-protected operational surfaces [VERIFIED: server/middleware/security.js] | Already partially used for `/api/tts`, `/api/files/index`, and `/api/retrieve` [VERIFIED: server.js] | Keeps route protection consistent and auditable. [VERIFIED: server.js] |

**Deprecated/outdated:**
- Relying on CORS as an access-control mechanism is outdated and incorrect because non-browser clients ignore it. [CITED: https://expressjs.com/en/resources/middleware/cors.html]
- Logging raw prompt previews in normal runtime flows is outdated for operator diagnostics because it increases leakage without improving traceability. [VERIFIED: server/services/model.js]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Jest + Supertest is the best fit for this brownfield CommonJS repo versus `node:test`. [ASSUMED] | Standard Stack | Low - planner could swap test runner without changing the runtime hardening design. |

## Open Questions (RESOLVED)

1. **Analytics endpoint shape**
   Resolved outcome: keep `/api/analytics/event` as the session-scoped ingest route protected by `requireSessionControl({ keys: ['sessionId'] })`, and only add a distinct admin-only analytics route if the implementation finds an actual operational event path that is not tied to a session. This avoids mixed unauthenticated behavior while preserving room for explicit internal/admin events. [Resolved from locked decisions D-02 and checker feedback]

2. **Staging identification**
   Resolved outcome: add one explicit environment classifier in `server/config/runtime.js` that derives a runtime class from `APP_ENV` when present, otherwise from `NODE_ENV`, with `local`/`development` treated as local development, `staging`/`preview`/`preprod` treated as production-class staging, and `production` treated as production. All fail-closed and bypass rules must depend on that classifier instead of raw `NODE_ENV === 'production'` checks. [Resolved from locked decisions D-04, D-05, D-06 and checker feedback]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Server runtime, tests [VERIFIED: package.json] | Yes [VERIFIED: local environment] | v24.13.1 [VERIFIED: local environment] | None |
| npm | Dependency install and test scripts [VERIFIED: package.json] | Yes [VERIFIED: local environment] | 11.8.0 [VERIFIED: local environment] | None |
| Jest | Validation architecture [VERIFIED: research] | No repo install detected [VERIFIED: package.json] | - | Add as dev dependency [CITED: https://jestjs.io/docs/getting-started] |
| Supertest | HTTP negative-path tests [VERIFIED: research] | No repo install detected [VERIFIED: package.json] | - | Add as dev dependency [CITED: https://github.com/forwardemail/supertest] |

**Missing dependencies with no fallback:**
- None for planning. [VERIFIED: local environment]

**Missing dependencies with fallback:**
- Jest and Supertest are absent, but can be added in the same phase or in Wave 0 test setup. [VERIFIED: package.json] [CITED: https://jestjs.io/docs/getting-started] [CITED: https://github.com/forwardemail/supertest]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected in repo; recommend Jest 30.1.3 plus Supertest 7.1.4. [VERIFIED: package.json] [VERIFIED: npm registry] |
| Config file | none - see Wave 0 [VERIFIED: repo scan] |
| Quick run command | `npx jest tests/runtime/cms-auth.test.js tests/runtime/analytics-auth.test.js tests/runtime/runtime-config.test.js --runInBand` [Inference from planned layout] |
| Full suite command | `npm test` after replacing placeholder script with `jest --runInBand` or equivalent. [VERIFIED: package.json] [CITED: https://jestjs.io/docs/getting-started] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | CMS mutations and preview reject missing/invalid admin key; analytics rejects missing/invalid session control or admin authorization. [VERIFIED: .planning/REQUIREMENTS.md] | integration | `npx jest tests/runtime/cms-auth.test.js tests/runtime/analytics-auth.test.js --runInBand` | No - Wave 0 [VERIFIED: repo scan] |
| OPS-02 | Runtime config fails boot or validation when production/staging auth, CORS, or provider requirements are unsafe. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npx jest tests/runtime/runtime-config.test.js --runInBand` | No - Wave 0 [VERIFIED: repo scan] |
| OPS-03 | Structured logs emit session lifecycle and failure events with expected keys and redaction. [VERIFIED: .planning/REQUIREMENTS.md] | unit/integration | `npx jest tests/runtime/session-diagnostics.test.js --runInBand` | No - Wave 0 [VERIFIED: repo scan] |

### Sampling Rate
- **Per task commit:** `npx jest tests/runtime/runtime-config.test.js --runInBand` plus any touched auth/logging test file. [Inference from phase scope]
- **Per wave merge:** `npx jest tests/runtime/*.test.js --runInBand` limited to Phase 1 tests while the repo still lacks a broader harness. [Inference from phase scope]
- **Phase gate:** All Phase 1 guardrail tests green before `/gsd-verify-work`. [Inference from requirements]

### Wave 0 Gaps
- [ ] `tests/runtime/runtime-config.test.js` - fail-closed config coverage for `validateRuntimeConfig()`. [VERIFIED: server/config/runtime.js]
- [ ] `tests/runtime/cms-auth.test.js` - unauthorized CMS mutation and preview cases. [VERIFIED: server/routes/cms.js]
- [ ] `tests/runtime/analytics-auth.test.js` - unauthorized analytics ingest cases. [VERIFIED: server/routes/analytics.js]
- [ ] `tests/runtime/session-diagnostics.test.js` - structured logging and redaction assertions. [VERIFIED: research]
- [ ] `jest.config.js` - explicit Node test environment for this CommonJS repo. [CITED: https://jestjs.io/docs/getting-started]
- [ ] Framework install: `npm install --save-dev jest supertest` - no test framework is currently present. [VERIFIED: package.json] [VERIFIED: npm registry]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes [Inference from route auth requirements] | `requireAdminApiKey` for operational surfaces. [VERIFIED: server/middleware/security.js] |
| V3 Session Management | yes [Inference from session-control design] | `requireSessionControl`, hashed control tokens, and explicit non-production-only overrides. [VERIFIED: server/middleware/security.js] |
| V4 Access Control | yes [Inference from route boundary phase] | Route-class authorization on CMS, analytics, session, and socket join paths. [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js] [VERIFIED: server.js] |
| V5 Input Validation | yes [VERIFIED: codebase] | Existing route-guard validation plus fail-closed config validation. [VERIFIED: server/routes/cms.js] [VERIFIED: server/config/runtime.js] |
| V6 Cryptography | yes [VERIFIED: codebase] | Node `crypto` hashing and timing-safe comparison for control/admin tokens. [VERIFIED: server/middleware/security.js] |

### Known Threat Patterns for Express + Socket.IO operational surfaces

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated CMS mutation | Tampering | `requireAdminApiKey` on all CMS writes and preview narration. [VERIFIED: server/routes/cms.js] [VERIFIED: server/middleware/security.js] |
| Forged analytics events for arbitrary `sessionId` | Spoofing / Tampering | `requireSessionControl({ keys: ['sessionId'] })` or a dedicated admin path. [VERIFIED: server/routes/analytics.js] [VERIFIED: server/middleware/security.js] |
| Session-control bypass via env flag | Elevation of Privilege | Fail closed outside local development; reject unrestricted bypass in staging/production. [VERIFIED: server/middleware/security.js] |
| Sensitive context leakage in logs | Information Disclosure | Structured logger with redaction; minimize prompt and participant content. [VERIFIED: server/services/model.js] [VERIFIED: server/services/analytics.js] [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md] |
| Socket room join without consistent auth telemetry | Repudiation | Log join allow/deny with `sessionId`, socket id, and reason codes. [VERIFIED: server.js] [CITED: https://socket.io/docs/v4/rooms/] |

## Sources

### Primary (HIGH confidence)
- Codebase files inspected this session: `server.js`, `server/config/runtime.js`, `server/middleware/security.js`, `server/routes/cms.js`, `server/routes/analytics.js`, `server/routes/session.js`, `server/routes/questions.js`, `server/routes/autoplex.js`, `server/services/analytics.js`, `.planning/REQUIREMENTS.md`, `.planning/phases/01-runtime-guardrails/01-CONTEXT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`. [VERIFIED: codebase]
- npm package pages/snippets for `express`, `socket.io`, `cors`, `pino`, `pino-pretty`, `jest`, `supertest`. [VERIFIED: npm registry]
- Express CORS middleware docs: https://expressjs.com/en/resources/middleware/cors.html [CITED: https://expressjs.com/en/resources/middleware/cors.html]
- Express health checks and graceful shutdown docs: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html [CITED: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html]
- Socket.IO rooms docs: https://socket.io/docs/v4/rooms/ [CITED: https://socket.io/docs/v4/rooms/]
- Pino API docs: https://github.com/pinojs/pino/blob/main/docs/api.md [CITED: https://github.com/pinojs/pino/blob/main/docs/api.md]
- Jest getting started docs: https://jestjs.io/docs/getting-started [CITED: https://jestjs.io/docs/getting-started]
- Supertest README: https://github.com/forwardemail/supertest [CITED: https://github.com/forwardemail/supertest]

### Secondary (MEDIUM confidence)
- None. Primary sources were sufficient. [VERIFIED: research process]

### Tertiary (LOW confidence)
- None besides the single explicit assumption about Jest vs `node:test`. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - current repo stack is directly verified, and added packages were verified from official npm/docs pages. [VERIFIED: package.json] [VERIFIED: npm registry]
- Architecture: HIGH - route wiring, middleware chokepoints, and startup flow are explicit in code. [VERIFIED: server.js]
- Pitfalls: HIGH - each pitfall maps to a current code gap or official framework guidance. [VERIFIED: server/routes/cms.js] [VERIFIED: server/routes/analytics.js] [VERIFIED: server/config/runtime.js] [CITED: https://expressjs.com/en/resources/middleware/cors.html]

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 for codebase facts; npm version checks should be refreshed before implementation if package additions are planned. [VERIFIED: codebase] [VERIFIED: npm registry]
