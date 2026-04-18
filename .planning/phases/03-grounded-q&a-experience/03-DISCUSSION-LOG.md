# Phase 3: Grounded Q&A Experience - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 03-grounded-q&a-experience
**Areas discussed:** Grounding scope, Answer style and tone, Q&A timing and interruption policy, Q&A playback separation

---

## Grounding scope

| Option | Description | Selected |
|--------|-------------|----------|
| Slide-first, then project docs | Default to current slide and its notes first; use project knowledge only if it clearly supports the answer | ✓ |
| Presentation-wide, then project docs | Allow answers to use the full deck as normal context, then use project knowledge docs if needed | |
| Strict current context only | Use only the current slide plus explicitly attached current-session docs; if the answer is outside that, say so | |

**User's choice:** `1`
**Notes:** Default to current slide and notes first. Project documents can support the answer, but the system should not roam presentation-wide by default.

---

## Answer style and tone

| Option | Description | Selected |
|--------|-------------|----------|
| Concise advisor | Short, sharp, calm answers that sound human and confident | |
| Conversational closer | Natural and warm, but still pointed toward conversion and next steps when relevant | ✓ |
| Expert explainer | More detailed and educational, prioritizing clarity over brevity | |

**User's choice:** `2`
**Notes:** The answer should feel human and warm, but still conversion-oriented when appropriate rather than purely informational.

---

## Q&A timing and interruption policy

| Option | Description | Selected |
|--------|-------------|----------|
| Only explicit interrupt-worthy questions | Interrupt only for high-priority questions like objections, contradictions, pricing/next-step asks, or direct confusion blocking the current slide. Everything else queues | ✓ |
| Most relevant questions interrupt | If a question is clearly relevant to the current slide, answer it inline; less relevant questions queue | |
| Never interrupt automatically | Always queue questions and answer them only at designated Q&A points unless the controller explicitly triggers an interrupt | |

**User's choice:** `1`
**Notes:** Protect presentation momentum. Only clearly urgent or blocking questions should interrupt automatically; the rest should queue.

---

## Q&A playback separation

| Option | Description | Selected |
|--------|-------------|----------|
| Same visual lane, different state | Keep the current presentation/transcript area and answer cards, but make Q&A state clearly distinct in status, audio ownership, and transcript behavior | ✓ |
| Dedicated Q&A mode | When answering, shift into a visibly separate Q&A mode or panel | |
| Minimal distinction | Keep it mostly as-is visually; focus only on overlap/state-corruption fixes under the hood | |

**User's choice:** `1`
**Notes:** Keep the existing UI lane, but make the behavioral state change much clearer so Q&A does not feel blended into narration.

---

## the agent's Discretion

- Prompt/context shaping details that enforce slide-first grounding
- Exact answer rendering and transcript behavior within the current UI shell
- Question-priority heuristics for auto-interrupt versus queue
- Exact state boundaries for answer audio and narration audio ownership

## Deferred Ideas

None.

---

*Phase: 03-grounded-q&a-experience*
*Discussion log generated: 2026-04-19*
