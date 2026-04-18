# Phase 3: Grounded Q&A Experience - Research

**Researched:** 2026-04-19
**Domain:** Q&A grounding boundaries, interrupt classification, answer presentation, and narration/Q&A state separation [VERIFIED: codebase]
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QA-01 | Audience can ask questions and receive answers grounded in the current slide, project context, and Supabase-backed knowledge documents [VERIFIED: .planning/REQUIREMENTS.md] | Narrow the current `knowledgeContext` assembly so slide title/content/notes remain primary, project docs are injected as supporting references, and unsupported asks are handled explicitly instead of by broad full-deck inference. [VERIFIED: server/routes/questions.js] [VERIFIED: server/prompts/narrationPrompt.js] |
| QA-02 | Q&A responses render with a more natural conversational feel in text and audio, avoiding obviously robotic presentation [VERIFIED: .planning/REQUIREMENTS.md] | Tighten the Q&A prompt toward a warm closer voice and simplify client answer rendering so the answer reads like one coherent reply instead of a rigid summary/details stack plus animated fragments. [VERIFIED: server/prompts/narrationPrompt.js] [VERIFIED: public/app.js] [VERIFIED: public/services/ui.js] |
| QA-03 | Q&A playback and presentation narration do not overlap or leave the session in an inconsistent state [VERIFIED: .planning/REQUIREMENTS.md] | Build on Phase 2 playback ownership to give Q&A explicit transcript/audio state boundaries and make interrupt decisions less eager than the current relevance-heavy classifier. [VERIFIED: public/services/socket.js] [VERIFIED: public/app.js] [VERIFIED: server/services/questionClassifier.js] [VERIFIED: server/routes/autoplex.js] |
</phase_requirements>

## Summary

Phase 3 should refine the existing Q&A loop, not replace it. The current backend already has the core ingredients: question persistence, session-aware context loading, project knowledge docs, prompt-based answers, question classification, and Socket.IO delivery. The problem is that the assembled answer context is too broad, the interrupt policy is too willing to escalate slide-relevant questions, and the client presentation of answers still feels mechanically segmented. [VERIFIED: server/routes/questions.js] [VERIFIED: server/services/questionClassifier.js] [VERIFIED: public/app.js] [VERIFIED: public/services/ui.js]

The most important grounding issue is in `buildQuestionKnowledgeContext()`. It currently appends current slide details, full presentation content, and multiple project documents into one large string. That gives the model enough information to answer broadly, but it weakens the slide-first discipline the user chose. Phase 3 should treat current slide title/content/notes as the default answer boundary, use project docs only as explicit supporting references, and make unsupported answers fail honestly. [VERIFIED: server/routes/questions.js]

The most important tone issue is split across prompt and rendering. The prompt already bans obvious filler like "Great question," but the UI still renders title, summary, details, and animated answer pieces that can make a normal answer feel over-produced. Phase 3 should keep the current visual lane and answer cards, but simplify what gets rendered and how the transcript/status framing behaves so the experience feels like one human answer rather than a machine-generated bundle. [VERIFIED: server/prompts/narrationPrompt.js] [VERIFIED: public/app.js] [VERIFIED: public/services/ui.js]

The most important interruption issue is in `questionClassifier`. Right now it boosts `shouldAnswerNow` both for certain categories and for generic slide relevance above a threshold. That conflicts with the user’s “interrupt only for explicit interrupt-worthy questions” decision. Phase 3 should narrow auto-interrupt to a smaller class of urgent cases and let relevance alone influence priority without forcing inline interruption. [VERIFIED: server/services/questionClassifier.js]

The most important runtime isolation issue is that Q&A uses many of the same transcript/status/audio surfaces as narration. Phase 2 stabilized playback ownership, but Q&A events like `qa-start`, `answer-delta`, `answer-text`, and `qa-end` still feed into shared transcript and status handlers. Phase 3 should make the mode transition explicit without creating a new UI surface: same lane, different ownership and state rules. [VERIFIED: public/services/socket.js] [VERIFIED: public/app.js] [VERIFIED: .planning/phases/02-playback-state-reliability/02-CONTEXT.md]

## Recommended Plan Shape

1. Tighten backend grounding and interrupt criteria first, because every later Q&A improvement depends on reliable context boundaries and better queueing rules. [Inference from codebase]
2. Improve the answer prompt and client answer presentation next, because the user’s “mechanical” complaint is partly content and partly rendering. [Inference from codebase]
3. Finish by isolating Q&A transcript/audio state from narration state, because that work should build on the stricter interrupt policy and the explicit playback contracts from Phase 2. [Inference from codebase]

## Patterns

### Pattern 1: Slide-First Context With Explicit Support Docs
**What:** Construct answer context so the current slide is the primary source, then append only the project knowledge sections that are genuinely relevant support. [Inference from codebase]
**When to use:** Question answering, answer prompt construction, fallback messaging for unsupported asks. [VERIFIED: server/routes/questions.js] [VERIFIED: server/prompts/narrationPrompt.js]
**Example:**
```javascript
if (currentSlide) {
  sections.push(`CURRENT SLIDE:\nTitle: ${currentSlide.title || ''}\nVisible text: ${currentSlide.content || ''}`);
}
if (docs.product) sections.push(`PRODUCT KNOWLEDGE:\n${stringifyDoc(docs.product)}`);
```

### Pattern 2: Priority And Interrupt Are Not The Same Decision
**What:** Keep question priority scoring, but gate auto-interrupt behind a narrower urgency policy than “relevant to the current slide.” [Inference from codebase]
**When to use:** Question classification, inline interruption, queue handling. [VERIFIED: server/services/questionClassifier.js] [VERIFIED: server/routes/autoplex.js]
**Example:**
```javascript
if (lowerQuestion.includes('but you said')) {
  shouldAnswerNow = true;
}
if (relevance > 0.4) {
  priority += 2;
  shouldAnswerNow = true;
}
```

### Pattern 3: Same Surface, Distinct Runtime Mode
**What:** Reuse the existing presentation/transcript area and answer cards, but make Q&A own its own status wording, transcript lifecycle, and answer-audio behavior. [Inference from codebase]
**When to use:** `qa-start`, answer streaming, answer completion, return to narration. [VERIFIED: public/services/socket.js] [VERIFIED: public/app.js]
**Example:**
```javascript
this.socket.on('qa-start', (data) => {
  this.app.isQAPhase = true;
  this.app.setStatus('Thinking', 'paused', data.inline ? 'Interrupt received. Building answer.' : 'Opening question mode');
});
```

### Pattern 4: Honest Unsupported Answer Fallback
**What:** When the answer cannot be grounded in current slide or supporting docs, answer naturally and explicitly rather than stretching context. [Inference from codebase]
**When to use:** Missing pricing detail, unsupported feature questions, out-of-scope asks. [VERIFIED: server/prompts/narrationPrompt.js]
**Example:**
```text
If the presentation content doesn't contain the answer, say so honestly and naturally.
```

## Anti-Patterns to Avoid

- **Full-deck-by-default grounding:** current Q&A context should not quietly treat every slide as equal evidence for every answer. [VERIFIED: server/routes/questions.js]
- **Relevance implies interrupt:** “related to this slide” is too broad for auto-interrupt under the user’s chosen policy. [VERIFIED: server/services/questionClassifier.js]
- **Summary/details duplication:** rendering both short summary and full details by default can make answers feel templated rather than conversational. [VERIFIED: public/app.js]
- **Narration and Q&A sharing implicit transcript state:** answer mode should not piggyback on narration transcript behavior without explicit reset/restore rules. [VERIFIED: public/services/socket.js] [VERIFIED: public/app.js]

## Common Pitfalls

### Pitfall 1: Context assembly that looks grounded but encourages overreach
**What goes wrong:** The model receives current slide, full deck, and all docs at once, so it answers confidently from broad context instead of staying anchored to the slide. [VERIFIED: server/routes/questions.js]
**How to avoid:** Make current slide the default, separate support docs clearly, and add explicit unsupported-answer behavior. [VERIFIED: codebase]

### Pitfall 2: Interrupt logic that optimizes for relevance instead of momentum
**What goes wrong:** A merely relevant question breaks flow because `shouldAnswerNow` is tied to slide keyword overlap or boosted priority. [VERIFIED: server/services/questionClassifier.js]
**How to avoid:** Separate urgency from relevance and reserve auto-interrupt for blocking, objection, contradiction, pricing, or next-step questions. [VERIFIED: codebase]

### Pitfall 3: Mechanical tone caused by both prompt and renderer
**What goes wrong:** Even a decent answer feels robotic because the UI breaks it into summary/details/animated fragments and the transcript/status framing stays too system-like. [VERIFIED: public/app.js] [VERIFIED: public/services/ui.js]
**How to avoid:** Keep one coherent answer thread, reduce duplicated answer layers, and align status copy with the conversational closer voice. [VERIFIED: codebase]

### Pitfall 4: Q&A mode that never fully owns the interaction state
**What goes wrong:** Answer streaming competes with narration transcript/status/audio surfaces, leaving partial transcript or unclear return-to-slide behavior. [VERIFIED: public/services/socket.js] [VERIFIED: public/app.js]
**How to avoid:** Give Q&A explicit mode entry, answer transcript ownership, and explicit cleanup/restore rules on `qa-end`. [VERIFIED: codebase]

## Validation Architecture

### Feedback loops needed
- Fast loop: focused Jest suites for grounding boundaries, interrupt policy, answer rendering, and Q&A state isolation.
- Wave loop: route-plus-client runtime tests that validate classification, answer-ready payloads, and Q&A mode transitions together.
- Manual loop: one browser pass for conversational feel because “mechanical” is partly experiential.

### Critical observables
- Which context blocks were included in a generated answer request.
- Whether unsupported questions produce honest fallback language instead of broad invented answers.
- Whether priority and auto-interrupt diverge in the right cases.
- Whether Q&A start/end leave transcript, status, and answer audio in a clean state.

### Minimum instrumentation expectation
- Structured logs for question classification, chosen interruption path, context scope used for answer generation, and Q&A mode enter/exit.
- Focused tests that prove slide-first grounding, stricter interrupt policy, natural answer rendering, and non-overlapping state transitions.

---

*Phase: 03-grounded-q&a-experience*
*Research completed: 2026-04-19*
