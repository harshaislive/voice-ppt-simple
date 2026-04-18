# Phase 5: Regression Harness - Discussion Log

**Date:** 2026-04-19
**Phase:** 05-regression-harness

## Gray Areas Discussed

### 1. Critical-path regression boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Single full presentation journey | One canonical end-to-end flow only | |
| Two high-value flows | Main presentation journey plus reconnect/restore as a second first-class regression flow | ✓ |
| Modular critical paths | Separate integration flows without any single primary journey | |

**Notes:** Phase 5 should protect two first-class flows: the main session journey and reconnect/restore.

### 2. Test environment realism

| Option | Description | Selected |
|--------|-------------|----------|
| Mostly harness-driven | Small focused helpers with minimal real route wiring | |
| Hybrid realism | Real Express routes, auth/session wiring, and in-memory runtime pieces; external providers stubbed | ✓ |
| Near-full local stack | Run almost the entire real stack inside tests | |

**Notes:** Real local credentials exist, but default regression tests should still avoid depending on live OpenAI, TTS, and Supabase.

### 3. Suite structure and speed budget

| Option | Description | Selected |
|--------|-------------|----------|
| Fast gate plus broader regression | Two-tier contract | |
| One standard regression command | One broader default command | |
| Tiered three-level contract | Smoke, standard, and extended suite levels | ✓ |

**Notes:** The regression strategy should make confidence levels explicit instead of collapsing everything into one ambiguous “tested” state.

### 4. Negative-path priorities

| Option | Description | Selected |
|--------|-------------|----------|
| Security and startup failures | Session/auth/source/startup failure paths only | |
| Runtime continuity failures | Restore/playback/Q&A/completion continuity only | |
| Both | Cover both security/startup and runtime continuity in Phase 5 | ✓ |

**Notes:** Phase 5 must protect both classes now. Live-provider release checks stay deferred to Phase 6.

## Locked Decisions

- Protect two first-class regression flows: the main presentation journey and reconnect/restore
- Use hybrid realism for the regression harness
- Keep live OpenAI/TTS/Supabase out of default regression gating even though local credentials exist
- Define a three-level suite contract: smoke, standard, extended
- Cover both security/startup failures and runtime continuity failures in Phase 5

## Deferred / Out of Scope

- Live-provider checks as part of the default regression suite
- Release-only validation and real-presentation signoff work reserved for Phase 6

---

*Discussion complete: 2026-04-19*
