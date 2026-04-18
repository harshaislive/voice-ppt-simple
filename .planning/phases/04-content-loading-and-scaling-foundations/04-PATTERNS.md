# Phase 4: Content Loading and Scaling Foundations - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 10
**Analogs found:** 8 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/services/cms.js` | service | content resolution / IO | `server/services/cms.js` | exact |
| `server/routes/session.js` | route | request-response / persistence | `server/routes/session.js` | exact |
| `public/app.js` | client orchestrator | catalog selection / session bootstrap | `public/app.js` | exact |
| `server/services/masterSession.js` | service | canonical lookup / cache | `server/services/masterSession.js` | exact |
| `server/services/supabaseSession.js` | service | persistence adapter | `server/services/supabaseSession.js` | exact |
| `server/routes/cms.js` | route | catalog/read surface | `server/routes/cms.js` | exact |
| `server/routes/questions.js` | route | presentation reload / contextual lookup | `server/routes/questions.js` | exact |
| `server/routes/autoplex.js` | route | session runtime / replay reload | `server/routes/autoplex.js` | exact |
| `tests/helpers/createContentLoadingHarness.js` | test helper | service/route harness | `tests/helpers/createPlaybackContractHarness.js` | partial |
| `tests/runtime/content-*.test.js` | test | integration | none | no analog |

## Pattern Assignments

### `server/services/cms.js` (service, content resolution / IO)

**Analog:** `server/services/cms.js`

**Current hybrid load shape**:
```javascript
if (this.isSupabaseConfigured()) {
  const remote = await this.loadPresentationFromSupabase(identifier);
  if (remote) {
    result = remote;
  }
}
if (!result) {
  result = await this.loadPresentationFromLocal(identifier);
}
```

**Use for:** explicit source declaration, loader contract normalization, and fail-closed source enforcement.

---

### `server/routes/session.js` (route, request-response / persistence)

**Analog:** `server/routes/session.js`

**Current startup identity shape**:
```javascript
const { deckId = 'beforest_pitch' } = req.body;
presentation = await cmsService.loadPresentation(deckId);
db.run(`INSERT INTO sessions (id, deck_id, ...) VALUES (?, ?, ...)`, [
  sessionId,
  presentation?.presentationSlug || deckId
]);
```

**Use for:** canonical `presentationSlug` handoff, compatibility metadata, and startup failure behavior.

---

### `public/app.js` (client orchestrator, catalog selection / session bootstrap)

**Analog:** `public/app.js`

**Current opportunistic selection shape**:
```javascript
const selectedPresentation = this.presentationCatalog.find(p => p.id === requestedDeckId || p.presentationSlug === requestedDeckId)
  || this.presentationCatalog.find(p => p.source === 'supabase')
  || this.presentationCatalog[0];
```

**Use for:** removing arbitrary selection fallback, preserving explicit slug choice, and showing clearer operator/client errors.

---

### `server/services/masterSession.js` (service, canonical lookup / cache)

**Analog:** `server/services/masterSession.js`

**Current legacy identity assumption**:
```javascript
const presentations = await supabaseSession.request('presentations', {
  slug: `eq.${deckId}`,
  select: 'master_session_id'
});
```

**Use for:** migrating master-session lookup to canonical presentation slug while keeping cache semantics.

---

### `server/services/supabaseSession.js` (service, persistence adapter)

**Analog:** `server/services/supabaseSession.js`

**Current persisted compatibility shape**:
```javascript
const session = {
  id: sessionData.id,
  deck_id: sessionData.deckId,
  metadata: JSON.stringify(sessionData.metadata || {})
};
```

**Use for:** preserving database compatibility while promoting canonical runtime metadata.

---

### `server/routes/cms.js` (route, catalog/read surface)

**Analog:** `server/routes/cms.js`

**Current list/load surface**:
```javascript
const presentations = await cmsService.listPresentations();
const presentation = await cmsService.loadPresentation(req.params.id);
```

**Use for:** surfacing source declarations and operator-visible load errors consistently.

---

### `server/routes/questions.js` and `server/routes/autoplex.js` (routes, contextual reload / runtime reload)

**Analog:** `server/routes/questions.js`, `server/routes/autoplex.js`

**Current reload assumption**:
```javascript
const deckId = sessionMetadata.deckId || sessionMetadata.presentationSlug || sessionMetadata.projectSlug;
const presentation = await cmsService.loadPresentation(deckId);
```

**Use for:** moving downstream reload paths to prefer canonical `presentationSlug` first and stop using `projectSlug` as an implicit presentation ID.

## Anti-Patterns to Avoid

- Selecting the first Supabase or first available presentation when the requested slug is missing.
- Treating `projectSlug` as a valid fallback presentation identifier.
- Quietly switching source during session start after a declared source mismatch.
- Documenting a project package model without making loader and runtime enforce it.

---

*Phase: 04-content-loading-and-scaling-foundations*
*Pattern map generated: 2026-04-19*
