# Phase 5: Regression Harness - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 14
**Analogs found:** 11 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/helpers/createTestApp.js` | helper | route/runtime harness | `tests/helpers/createTestApp.js` | exact |
| `tests/helpers/createSessionControlServer.js` | helper | socket/auth harness | `tests/helpers/createSessionControlServer.js` | exact |
| `tests/helpers/createPlaybackContractHarness.js` | helper | socket/playback harness | `tests/helpers/createPlaybackContractHarness.js` | exact |
| `tests/helpers/createQuestionFlowHarness.js` | helper | route/prompt harness | `tests/helpers/createQuestionFlowHarness.js` | exact |
| `tests/helpers/createContentLoadingHarness.js` | helper | route/service harness | `tests/helpers/createContentLoadingHarness.js` | exact |
| `tests/helpers/createAutoplexControlHarness.js` | helper | client-runtime harness | `tests/helpers/createAutoplexControlHarness.js` | exact |
| `tests/runtime/playback-*.test.js` | tests | focused runtime | `tests/runtime/playback-*.test.js` | exact |
| `tests/runtime/qa-*.test.js` | tests | focused runtime | `tests/runtime/qa-*.test.js` | exact |
| `tests/runtime/*auth*.test.js` | tests | negative-path route coverage | `tests/runtime/*auth*.test.js` | exact |
| `tests/runtime/content-*.test.js` | tests | content/startup regression | `tests/runtime/content-*.test.js` | exact |
| `package.json` | config | command surface | `package.json` | exact |
| `jest.config.js` | config | test grouping | `jest.config.js` | exact |
| `tests/helpers/createRegressionHarness.js` | helper | integrated runtime harness | `tests/helpers/createContentLoadingHarness.js` | partial |
| `tests/runtime/regression-*.test.js` | tests | cross-slice journey flows | none | no analog |

## Pattern Assignments

### `tests/helpers/createTestApp.js` and companion helpers

**Analog:** existing helper suite

**Current pattern:**
```javascript
const app = createTestApp({ routeBase: '/api/session', router, db, io, logger });
```

**Use for:** a shared regression harness that mounts real routes with in-memory DB, logger, and socket shims rather than booting the whole app.

---

### `tests/runtime/playback-*.test.js` and `tests/runtime/qa-*.test.js`

**Analog:** existing focused slice suites

**Current pattern:**
```javascript
describe('playback restore behavior', () => {
  test('restore reconnects without auto-replaying the current slide', async () => { ... });
});
```

**Use for:** keeping slice-level assertions separate from the new integrated regression journeys.

---

### `tests/runtime/*auth*.test.js` and `tests/runtime/content-*.test.js`

**Analog:** existing negative-path route tests

**Current pattern:**
```javascript
const response = await request(app)
  .post('/api/analytics/event')
  .send({ sessionId: 'session-1', eventType: 'slide_view' });
expect(response.status).toBe(403);
```

**Use for:** a formal negative-path tier that groups startup/security and continuity failures into a clear regression contract.

---

### `package.json`

**Analog:** current single `test` command

**Current pattern:**
```json
"scripts": {
  "test": "NODE_OPTIONS=--experimental-vm-modules jest"
}
```

**Use for:** introducing smoke, standard regression, and extended commands without changing the underlying Jest stack.

## Anti-Patterns to Avoid

- Building a separate test architecture that ignores the repo’s current helpers and file style
- One giant “journey” file that hides which slice actually failed
- Leaving suite tiers implicit instead of making them concrete in command surface
- Pulling live providers into default regression runs

---

*Phase: 05-regression-harness*
*Pattern map generated: 2026-04-19*
