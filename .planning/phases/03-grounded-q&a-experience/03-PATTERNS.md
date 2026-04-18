# Phase 3: Grounded Q&A Experience - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 10
**Analogs found:** 8 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/routes/questions.js` | route | request-response / async background | `server/routes/questions.js` | exact |
| `server/prompts/narrationPrompt.js` | prompt | prompt assembly | `server/prompts/narrationPrompt.js` | exact |
| `server/services/questionClassifier.js` | service | pure logic / model-assisted | `server/services/questionClassifier.js` | exact |
| `server/routes/autoplex.js` | route | event-driven | `server/routes/autoplex.js` | exact |
| `public/app.js` | client orchestrator | event-driven | `public/app.js` | exact |
| `public/services/socket.js` | client service | event-driven | `public/services/socket.js` | exact |
| `public/services/ui.js` | client service | DOM rendering | `public/services/ui.js` | exact |
| `tests/helpers/createQuestionFlowHarness.js` | test helper | route/runtime harness | `tests/helpers/createPlaybackContractHarness.js` | partial |
| `tests/runtime/qa-grounding.test.js` | test | integration | none | no analog |
| `tests/runtime/qa-experience.test.js` | test | integration/UI | none | no analog |
| `tests/runtime/qa-isolation.test.js` | test | integration | `tests/runtime/playback-restore.test.js` | partial |

## Pattern Assignments

### `server/routes/questions.js` (route, request-response / async background)

**Analog:** `server/routes/questions.js`

**Context assembly shape**:
```javascript
function buildQuestionKnowledgeContext({ sessionMetadata = {}, presentation = null, currentSlide = null, slides = [] } = {}) {
  const sections = [];
  if (currentSlide) {
    sections.push(`CURRENT SLIDE:\nTitle: ${currentSlide.title || ''}\nVisible text: ${currentSlide.content || ''}`);
  }
  if (slides.length > 0) {
    sections.push(`FULL PRESENTATION CONTENT:\n${slides.map(...).join('\n\n')}`);
  }
}
```

**Background answer generation shape**:
```javascript
setImmediate(async () => {
  const answerContext = await loadQuestionAnswerContext(db, sessionId);
  const answer = await modelService.generateNarrationStream({ knowledgeContext: answerContext.knowledgeContext }, () => {});
});
```

**Use for:** grounding boundary work, answer-ready payload shaping, and explicit unsupported-answer behavior.

---

### `server/prompts/narrationPrompt.js` (prompt, prompt assembly)

**Analog:** `server/prompts/narrationPrompt.js`

**Current Q&A voice shape**:
```javascript
const QA_SYSTEM_PROMPT = `You are answering a question from the audience.
- Answer the question directly. No preamble, no "Great question."
- 3-5 sentences max.
- Speak like a real person, not a press release.
`;
```

**Use for:** tightening answer voice toward a conversational closer without inventing a new prompt system.

---

### `server/services/questionClassifier.js` (service, pure logic / model-assisted)

**Analog:** `server/services/questionClassifier.js`

**Current interrupt coupling shape**:
```javascript
if (relevance > 0.4) {
  priority += 2;
  shouldAnswerNow = true;
}
```

**Use for:** separating “important” from “interrupt right now.”

---

### `server/routes/autoplex.js` (route, event-driven)

**Analog:** `server/routes/autoplex.js`

**Inline Q&A lifecycle shape**:
```javascript
io.to(sessionId).emit('qa-start', { totalQuestions: questions.length, inline: true });
io.to(sessionId).emit('answering-question', { questionIndex, totalQuestions });
io.to(sessionId).emit('answer-delta', { delta });
io.to(sessionId).emit('answer-text', { questionId, answer, question });
io.to(sessionId).emit('qa-end', { totalAnswered: questions.length, inline: true });
```

**Use for:** keeping Q&A mode transitions explicit and compatible with Phase 2 playback contracts.

---

### `public/app.js` (client orchestrator, event-driven)

**Analog:** `public/app.js`

**Answer thread rendering shape**:
```javascript
this.renderQuestionAnswer(node, {
  questionId: id,
  answerTitle,
  answerSummary,
  answerDetails,
  answerAudioUrl
});
```

**Q&A status shape**:
```javascript
if (this.isQAPhase) {
  this.setStatus('Q&A', 'paused', 'Answering questions');
}
```

**Use for:** answer presentation polish and explicit Q&A state ownership.

---

### `public/services/socket.js` (client service, event-driven)

**Analog:** `public/services/socket.js`

**Q&A lifecycle event shape**:
```javascript
this.socket.on('qa-start', (data) => { this.app.isQAPhase = true; });
this.socket.on('answer-delta', (data) => { this.app.handleNarrationDelta({ delta: data.delta, append: true }); });
this.socket.on('qa-end', () => { this.app.isQAPhase = false; this.app.restorePresentationStatus(); });
```

**Use for:** explicit mode enter/exit, transcript handling, and cleanup.

---

### `public/services/ui.js` (client service, DOM rendering)

**Analog:** `public/services/ui.js`

**Mechanical answer split shape**:
```javascript
const pieces = String(text || '')
  .split(/(?<=[.!?])\s+|,\s+/)
  .map((part) => part.trim())
  .filter(Boolean);
```

**Use for:** reducing overly segmented answer rendering while preserving the current visual lane.

---

### `tests/helpers/createQuestionFlowHarness.js` (test helper, route/runtime harness)

**Analog:** `tests/helpers/createPlaybackContractHarness.js`

**Harness shape to mirror**:
```javascript
// Minimal in-memory DB + io emitter capture + route/service injection
```

**Use for:** focused runtime Q&A tests without booting the full app.

## Anti-Patterns to Avoid

- Passing the full deck into every answer prompt as the default grounding basis.
- Using `shouldAnswerNow` as a synonym for “this question is important.”
- Rendering summary, details, and animated fragments for the same answer by default.
- Letting Q&A deltas write into narration state without an explicit Q&A-mode boundary.

---

*Phase: 03-grounded-q&a-experience*
*Pattern map generated: 2026-04-19*
