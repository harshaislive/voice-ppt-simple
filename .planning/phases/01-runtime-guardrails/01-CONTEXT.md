# Phase 1: Runtime Guardrails - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 locks down exposed runtime boundaries and makes the existing system diagnosable before deeper playback or Q&A fixes. This phase covers authorization for sensitive operational routes, fail-closed runtime behavior for production and staging, and the minimum diagnostics needed to trust future changes.

</domain>

<decisions>
## Implementation Decisions

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

### the agent's Discretion
- Exact structured logging format and field names, as long as they are consistent across routes and services.
- Whether session timelines are reconstructed purely from logs, from analytics events, or from a hybrid of both, as long as the result is inspectable and coherent.
- The specific staging override mechanism, as long as it is explicit, limited, and clearly impossible to mistake for production-safe behavior.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` — Phase 1 goal, requirements, success criteria, and intended plan slices
- `.planning/REQUIREMENTS.md` — `OPS-01`, `OPS-02`, and `OPS-03` define the required outcomes for this phase
- `.planning/PROJECT.md` — Product priorities and constraints: client experience first, reliability before broad expansion

### Security and route boundaries
- `server/routes/cms.js` — Publicly exposed CMS mutation and preview endpoints that need operational protection
- `server/routes/analytics.js` — Current analytics ingestion surface that lacks session/auth enforcement
- `server/middleware/security.js` — Session control, admin API key checks, and the current `DISABLE_SESSION_CONTROL` bypass
- `server/routes/session.js` — Existing session-control and admin patterns already used by runtime routes

### Runtime configuration
- `server/config/runtime.js` — Current production validation and CORS behavior; central file for fail-closed policy
- `server.js` — Middleware wiring, route mounting, rate limiting, and startup validation flow

### Existing risk analysis
- `.planning/codebase/CONCERNS.md` — Security, config, analytics, and logging concerns already identified for this codebase
- `.planning/codebase/ARCHITECTURE.md` — Request flow and route/service boundaries relevant to Phase 1 changes
- `.planning/codebase/CONVENTIONS.md` — Existing backend conventions and startup behavior patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `requireAdminApiKey` in `server/middleware/security.js`: Existing admin gate that can be reused for CMS write and preview surfaces.
- `requireSessionControl` in `server/middleware/security.js`: Existing session-scoped authorization middleware that can be applied to analytics/session-bound endpoints.
- `validateRuntimeConfig()` in `server/config/runtime.js`: Existing central validation point for provider, CORS, and remote CMS requirements.
- `analyticsService` in `server/services/analytics.js`: Existing event/session logging surface that can be reshaped into a more explicit session-timeline source.

### Established Patterns
- Thin Express route modules delegate most logic to services; Phase 1 should preserve that shape rather than embedding large policy logic directly in `server.js`.
- Runtime validation already happens at process startup in `server.js`, so stricter fail-closed behavior should extend this path rather than inventing a second config gate.
- Authorization today is middleware-based and request-scoped; Phase 1 should continue that pattern for consistency.

### Integration Points
- `server.js` route mounting and middleware ordering will need adjustment if CMS/analytics protection is tightened globally.
- `server/routes/cms.js` and `server/routes/analytics.js` are the direct entry points for Phase 1 authorization changes.
- `server/middleware/security.js` is the control point for session/admin policy and environment-specific bypass behavior.
- `server/services/analytics.js`, `server/routes/session.js`, `server/routes/questions.js`, and `server/routes/autoplex.js` are the main sources for constructing session timelines and structured diagnostics.

</code_context>

<specifics>
## Specific Ideas

- CMS writes and preview narration should be treated as operational tooling, not casually exposed public endpoints.
- Analytics should stay usable for the product, but not at the cost of letting arbitrary callers post events for any `sessionId`.
- Staging should feel close enough to production that auth/config issues show up there instead of during launch prep.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-runtime-guardrails*
*Context gathered: 2026-04-19*
