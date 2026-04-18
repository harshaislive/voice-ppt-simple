# Phase 4: Content Loading and Scaling Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 04-content-loading-and-scaling-foundations
**Areas discussed:** Source precedence, Presentation identity model, New-project onboarding shape, Fallback and failure visibility

---

## Source precedence

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase-first with explicit local fallback | Use Supabase as the default source in production-like flows, but allow local fallback when the requested presentation is missing or Supabase is unavailable | |
| Environment-based authority | Local is authoritative in development, Supabase is authoritative in staging/production, and fallback rules differ by environment | |
| Per-presentation explicit source | Each presentation/project declares its source of truth, and the runtime follows that declaration instead of a global default | ✓ |

**User's choice:** `3`
**Notes:** Each presentation should declare its authoritative source explicitly. The runtime should follow that declaration rather than relying on one global source rule.

---

## Presentation identity model

| Option | Description | Selected |
|--------|-------------|----------|
| Presentation slug is canonical | One stable presentation slug identifies the runnable presentation; project slug groups related docs/config around it | ✓ |
| Project slug is canonical | The project is the main identity, and presentations are variants or children under that project | |
| Deck ID stays canonical | Keep the existing deck/deckId concept as the primary identity and normalize everything else around it | |

**User's choice:** `1`
**Notes:** Presentation slug should become the canonical runtime identity. Project slug remains the grouping/container concept around it.

---

## New-project onboarding shape

| Option | Description | Selected |
|--------|-------------|----------|
| Project-first content package | Every new presentation lives under a project with explicit docs/config/content structure, whether sourced locally or from Supabase | ✓ |
| Supabase-first publishing model | New presentations are created in Supabase/CMS first; local files are only for development fallback or legacy content | |
| Dual-path supported | Support both project-file and Supabase-first onboarding equally as first-class long-term paths | |

**User's choice:** `1`
**Notes:** New presentations should follow one explicit project-first packaging pattern rather than keeping multiple long-term first-class onboarding models.

---

## Fallback and failure visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Fail closed on requested source | If a presentation is declared to come from a specific source and that source is unavailable or inconsistent, fail with a clear operator-visible error instead of silently falling back | ✓ |
| Fallback with loud diagnostics | Allow fallback to another source, but make it explicit in logs and responses so operators know the session is not using the intended content | |
| Soft fallback for launch resilience | Prefer serving something over failing; log mismatches, but don’t block session startup unless nothing can load | |

**User's choice:** `1`
**Notes:** Wrong-source content should not quietly load. If the declared source is missing or inconsistent, startup should fail clearly rather than masking the problem.

---

## the agent's Discretion

- Exact source declaration schema and validation rules
- Exact identifier normalization steps from `deckId`/`deck_id` toward presentation slug
- Exact project-package structure for onboarding new presentations
- Exact operator-facing error and diagnostics shape for source/load mismatches

## Deferred Ideas

None.

---

*Phase: 04-content-loading-and-scaling-foundations*
*Discussion log generated: 2026-04-19*
