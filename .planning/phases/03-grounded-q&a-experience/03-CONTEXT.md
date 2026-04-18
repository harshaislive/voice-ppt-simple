# Phase 3: Grounded Q&A Experience - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 makes audience questions feel more natural while keeping answers grounded in the right presentation context and preventing Q&A from corrupting presentation state. This phase covers answer grounding boundaries, answer tone, interrupt policy, and how Q&A mode should differ from slide narration without expanding into broader product features.

</domain>

<decisions>
## Implementation Decisions

### Grounding scope
- **D-01:** Q&A should be slide-first by default.
- **D-02:** Answers should use the current slide and its notes as the primary source of truth.
- **D-03:** Project knowledge documents may be used only when they clearly support the answer beyond the current slide.
- **D-04:** If the answer is not supported by the current slide or clearly supported project knowledge, the system should say so naturally instead of filling gaps.

### Answer style and tone
- **D-05:** Q&A voice should optimize for a conversational closer style.
- **D-06:** Answers should feel natural and warm, but still pointed toward conversion and next steps when relevant.
- **D-07:** The system should avoid robotic phrasing and overly structured, mechanical answer presentation.

### Timing and interruption policy
- **D-08:** The presentation should only interrupt immediately for explicit interrupt-worthy questions.
- **D-09:** Interrupt-worthy questions include objections, contradictions, pricing or next-step asks, or direct confusion that blocks the current slide.
- **D-10:** Other questions should queue instead of interrupting automatically.

### Q&A playback separation
- **D-11:** Q&A should stay in the same visual lane as the current presentation experience rather than switching into a separate dedicated mode.
- **D-12:** Q&A state must still be clearly distinct in status, audio ownership, and transcript behavior.
- **D-13:** The implementation should make answer mode feel behaviorally separate from narration mode even if the UI shell remains largely shared.

### the agent's Discretion
- The exact prompt structure and context-pruning mechanics, as long as answers stay slide-first and do not overreach beyond grounded sources.
- The exact textual and visual presentation of answers in the existing UI, as long as the result feels more natural and less mechanical.
- The exact heuristics or model/classifier path for deciding which questions are interrupt-worthy, as long as only clearly urgent questions interrupt automatically.
- The exact transcript/audio state boundaries between presentation narration and Q&A, as long as they are explicit and do not leave the session inconsistent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` — Phase 3 goal, requirements, success criteria, and intended plan slices
- `.planning/REQUIREMENTS.md` — `QA-01`, `QA-02`, and `QA-03` define the required outcomes for this phase
- `.planning/PROJECT.md` — Product priorities and constraints: client experience first, targeted polish rather than a full UI rebuild

### Backend Q&A grounding and generation
- `server/routes/questions.js` — Current question submission, context assembly, answer generation, persistence, and answer-ready event flow
- `server/prompts/narrationPrompt.js` — Current Q&A system prompt and narration/answer prompt construction
- `server/services/model.js` — Current model entrypoint for generated narration and Q&A text
- `server/services/questionClassifier.js` — Existing question classification path that may influence queueing and priority decisions

### Client Q&A experience and playback behavior
- `public/app.js` — Current question submission, answer rendering, question audio handling, transcript updates, and Q&A state transitions
- `public/services/socket.js` — Runtime events for Q&A start, answer streaming, answer completion, and queue updates
- `public/services/ui.js` — Existing answer/thread UI helpers and Q&A drawer behavior
- `public/index.html` — Current Q&A shell and answer surface in the presentation interface

### Adjacent runtime behavior
- `.planning/phases/02-playback-state-reliability/02-CONTEXT.md` — Phase 2 decisions around playback ownership, pause/resume, and restore that Q&A must not violate
- `.planning/phases/02-playback-state-reliability/02-playback-state-reliability-04-SUMMARY.md` — Recent restore/playback behavior that should remain stable while Q&A is improved
- `server/routes/autoplex.js` — Presentation orchestration and interrupt hooks that Q&A must integrate with safely

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/routes/questions.js`: Already builds a large answer context from session metadata, project docs, current slide, and full deck. This should be refined and bounded rather than replaced blindly.
- `server/prompts/narrationPrompt.js`: Already has a stronger-than-default Q&A voice prompt, which means the remaining problems are likely prompt discipline plus UI/rendering behavior rather than a blank-slate tone problem.
- `public/app.js`: Already has question queueing, answered-question rendering, answer audio playback, and Q&A-related status handling; this is the natural place for targeted polish.
- `public/services/socket.js`: Already separates `qa-start`, `answering-question`, `answer-delta`, `answer-text`, and `qa-end`, so the transport shape exists for explicit Q&A state boundaries.

### Established Patterns
- The product already treats questions as part of the live presentation loop rather than a separate chat application; Phase 3 should improve that experience without introducing a second product surface.
- Answer persistence already stores both summary and full details; the mechanical feel may come partly from how those layers are populated and rendered.
- The current backend uses one general model service and one shared prompt module for both narration and Q&A; Phase 3 should tighten boundaries without requiring an architectural rewrite.

### Integration Points
- `server/routes/questions.js` and `server/prompts/narrationPrompt.js` define whether answers are truly grounded or quietly over-broad.
- `server/services/questionClassifier.js` and `server/routes/autoplex.js` affect when questions interrupt versus queue.
- `public/app.js` and `public/services/socket.js` define whether Q&A feels like a clear interaction state or a blurry extension of slide narration.
- Phase 2 playback contracts now provide a more stable base, so Q&A isolation work should build on those guardrails rather than duplicate them.

</code_context>

<specifics>
## Specific Ideas

- A good answer should sound like a confident person helping a prospect move forward, not like a support bot or a lecture transcript.
- The system should earn trust by being willing to say "that is not in this presentation" instead of stretching weak context into a fake answer.
- Questions should only break the flow when they are genuinely blocking or high-intent; otherwise the presentation should preserve momentum.
- Q&A should feel distinct enough that the user can tell the system has shifted modes, without forcing a heavy visual mode switch.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-grounded-q&a-experience*
*Context gathered: 2026-04-19*
