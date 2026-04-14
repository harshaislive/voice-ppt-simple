# Voice-PPT Status — Compact Reference

## Current Branch
`realtime-ppt-wip` — pushed and up to date

---

## Bugs Fixed (This Session)

| # | Bug | Fix |
|---|-----|-----|
| 1 | Slides don't auto-advance | **FIXED.** 3 root causes: (a) `openSlideTurnOverlay` never removed `hidden` from `#slide-turn-overlay`, so the "Your Turn" overlay with mic/continue buttons was invisible; (b) `footer-continue-btn` had `class="hidden"` but `.hidden { display: none !important }` overrides `.visible { display: flex }` — now toggles both `hidden` and `visible` classes; (c) `runWrapUp` emitted `presentation-end` referencing out-of-scope `slides`/`allQuestions`, causing a ReferenceError that crashed the flow after wrap-up, preventing Q&A and `logSessionEnd`. |
| 2 | Mic button and ? FAB overlap on mobile | Changed `.help-fab` mobile from `bottom: 24px` to `bottom: 90px` so it sits above the footer |
| 3 | Local fallback files override Supabase | Deleted `content/projects/beforest/presentations/beforest_pitch.json` and `ten_percent_club.json` |
| 4 | Q&A answers truncated at ~750 words | Increased `decideNextAction` `max_completion_tokens` 500→2000 in `server/services/model.js` |
| 5 | Dead `knowledge_docs` row (`doc_type: "images"`, 0 content) | Added `DELETE /api/cms/knowledge-docs/:id` endpoint in `server/routes/cms.js` + `deleteKnowledgeDocById` in `server/services/cms.js` |
| 6 | Analytics `ended_at` always null | **FIXED.** Root cause was Bug #1(c): `runWrapUp` crashed with ReferenceError before `logSessionEnd` was ever reached. Also added `await` to `logSessionEnd` call. |
| 7 | Continue button outside mic dock, below it | Moved `#footer-continue-btn` inside `.immersive-dock` beside mic button in `index.html`; removed `margin-top: 8px` |
| 8 | Stray `</div>` in footer HTML | Removed duplicate closing div after `.footer-left` |

---

## Slide Auto-Advance Investigation (Closed)

**Root causes found and fixed:**

1. **`openSlideTurnOverlay()` never showed the overlay** — It only updated status text and toggled the footer button's `visible` class, but never removed `hidden` from `#slide-turn-overlay`. The "Your Turn" card with mic/continue/type-a-question was invisible.

2. **`footer-continue-btn` stayed invisible** — The button had `class="hidden"` in HTML. `openSlideTurnOverlay` added `visible` but didn't remove `hidden`. Since `.hidden { display: none !important }` overrides `.footer-continue-btn.visible { display: flex }`, the footer continue button was never clickable either. Fix: toggle both classes.

3. **`runWrapUp` crashed with ReferenceError** — `io.to(sessionId).emit('presentation-end', { totalSlides: slides.length, ... })` at the end of `runWrapUp` referenced `slides` and `allQuestions` which are local to `runPresentation`, not `runWrapUp`. This ReferenceError killed the entire presentation flow after the last slide's wrap-up, preventing Q&A and the `logSessionEnd` PATCH that writes `ended_at`.

---

## All Fixes Pushed This Session (chronological)

1. ✅ `model.js` — `max_completion_tokens` 500→2000 for `decideNextAction`
2. ✅ `cms.js` — added `deleteKnowledgeDocById(id)` method
3. ✅ `cms.js` — added `escapeFilter` to prevent `or:` filter SQL injection on slug lookups
4. ✅ `cms.js` — `loadPresentationFromSupabase`: added `order: 'slide_index.asc'` to slides query
5. ✅ `cms.js` — `loadPresentationFromSupabase`: query parameter format fixed for Supabase PostgREST
6. ✅ `routes/cms.js` — added `DELETE /api/cms/knowledge-docs/:id`
7. ✅ `analytics.js` — `logSessionStart` and `logSessionEnd` now log results to console
8. ✅ `index.html` — moved continue button inside `.immersive-dock` beside mic
9. ✅ `index.html` — removed stray `</div>` after `.footer-left`
10. ✅ `styles.css` — `footer-continue-btn`: removed `margin-top: 8px` so it sits beside mic
11. ✅ `styles.css` — `.help-fab` mobile: `bottom: 24px` → `bottom: 90px` to avoid overlap with footer
12. ✅ Deleted local fallbacks: `beforest_pitch.json`, `ten_percent_club.json`
13. ✅ `app.js` — bound `footer-continue-btn` click to `continuePresentationFlow()`
14. ✅ `ui.js` — `openSlideTurnOverlay()` shows footer continue button; `closeSlideTurnOverlay()` hides it
15. ✅ `ui.js` — `openSlideTurnOverlay()` now removes `hidden` from `#slide-turn-overlay` so the overlay is actually visible; toggles `hidden`/`visible` classes on `footer-continue-btn` properly (CSS `.hidden { display: none !important }` was overriding `.visible`)
16. ✅ `autoplex.js` — removed duplicate `presentation-end` emit from `runWrapUp` that referenced out-of-scope `slides`/`allQuestions` (was causing ReferenceError that killed the flow after wrap-up)
17. ✅ `autoplex.js` — added `await` to `analyticsService.logSessionEnd()` call

---

## Env / Deployment

- `HOST=0.0.0.0` (not hardcoded Tailscale IP) in `.env`
- `DEFAULT_PASSCODE` env var for passcode-protected sessions
- Docker + docker-compose for Coolify deployment
- Supabase: `fjnkpphjtlaeijjcbejb.supabase.co`
- Storage bucket: `presentation-images` (public)
- `10_percent_lifestyle` UUID: `7543341d-535e-4699-97d6-ab2018ffebb3`
- Image URLs confirmed HTTP 200

---

## Frontend File Structure

```
public/
  index.html         — start screen, hero, footer dock, slide-turn-overlay, help FAB
  styles.css         — all styles, mobile breakpoint at 720px
  app.js             — VoicePPTApp class, event binding, session management
  services/
    socket.js        — Socket.IO events → app methods
    ui.js            — UIManager: overlay, status, transcript, mic state
    audio.js         — StreamAudioPlayer with gain 1.5 + DynamicsCompressor
    voice.js         — Azure Realtime WebRTC voice mode
```

---

## Backend File Structure

```
server/
  server.js          — Express, PORT/HOST fallback, health endpoint
  routes/
    autoplex.js      — runPresentation, waitForContinue, markContinue, narrateSlide, Q&A, wrapup
    session.js       — start/stop, passcode, config endpoint
    cms.js           — CRUD for presentations, slides, docs, CTA blocks
    slides.js       — slide advancement, audio-complete notification
    questions.js    — Q&A queue management
  services/
    cms.js           — Supabase hybrid CMS, loadPresentation, listPresentations (remote-first merge)
    realtimePresenter.js — Azure Realtime voice, generateNarrationAudio
    model.js         — GPT narration, classification, next-step decisions
    analytics.js     — logSessionStart/End/Event → Supabase
    tts.js          — Azure TTS websocket
  middleware/
    security.js      — rate limiter, session control, token hashing
  prompts/
    narrationPrompt.js — STORYTELLER_SYSTEM_PROMPT, QA_SYSTEM_PROMPT, buildSlidePrompt, buildQAPrompt
```
