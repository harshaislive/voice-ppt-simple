# Phase 1: Runtime Guardrails - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 01-runtime-guardrails
**Areas discussed:** Operational route protection, Runtime fail-closed posture, Operational diagnostics

---

## Operational route protection

| Option | Description | Selected |
|--------|-------------|----------|
| Strict admin for all CMS writes and preview | `POST`/`PUT`/`DELETE` CMS routes plus preview narration require `ADMIN_API_KEY`; read-only public routes can stay open where needed | |
| Strict admin plus protected analytics | Same as strict CMS/preview protection, and analytics event ingestion also requires either session control or an internal/admin boundary | ✓ |
| Internal-only ops surface | Treat CMS, preview, and analytics as operational tools and lock all of them behind admin/internal auth immediately | |

**User's choice:** `2`
**Notes:** CMS writes and preview narration should be protected with admin auth. Analytics must not stay publicly writable; session-scoped or internal/admin protection is required.

---

## Runtime fail-closed posture

| Option | Description | Selected |
|--------|-------------|----------|
| Hard fail in production only | Development stays flexible, production refuses unsafe auth/CORS/session-control settings | |
| Hard fail in prod, guarded staging | Production fails closed, and staging should behave close to production except for explicitly marked test credentials | ✓ |
| Strict everywhere | Dev, staging, and prod all use the same strict rules unless a local-only override is explicitly enabled | |

**User's choice:** `2`
**Notes:** Production must fail closed. Staging should be close enough to production to catch auth/config mistakes early, with only clearly deliberate test allowances.

---

## Operational diagnostics

| Option | Description | Selected |
|--------|-------------|----------|
| Structured server logs only | Add consistent event-shaped logs for session lifecycle, auth failures, CMS source selection, playback/Q&A failures, and runtime decisions | |
| Structured logs plus session timeline | Do structured logging and make it possible to reconstruct a session's major events from logs or stored analytics | ✓ |
| Logs, session timeline, and release health checks | Do the above plus a small production-readiness signal set like startup config status and protected-route checks | |

**User's choice:** `2`
**Notes:** Minimum visibility for this phase is structured logging plus a reconstructable session timeline. Release health checks can wait for later production-readiness work.

---

## the agent's Discretion

- Exact logging format and field schema
- Whether the session timeline is reconstructed from logs, analytics events, or both
- The exact mechanism for explicit staging-only overrides

## Deferred Ideas

None.

---

*Phase: 01-runtime-guardrails*
*Discussion log generated: 2026-04-19*
