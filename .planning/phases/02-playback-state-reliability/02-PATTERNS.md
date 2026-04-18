# Phase 2: Playback State Reliability - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 11
**Analogs found:** 9 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `public/app.js` | client orchestrator | event-driven | `public/app.js` | exact |
| `public/services/audio.js` | client service | stream / event-driven | `public/services/audio.js` | exact |
| `public/services/socket.js` | client service | event-driven | `public/services/socket.js` | exact |
| `server/routes/autoplex.js` | route | event-driven | `server/routes/autoplex.js` | exact |
| `server/routes/session.js` | route | request-response | `server/routes/session.js` | exact |
| `server/routes/slides.js` | route | request-response | `server/routes/slides.js` | exact |
| `server.js` | config | event-driven | `server.js` | exact |
| `tests/runtime/session-diagnostics.test.js` | test | integration | `tests/runtime/session-diagnostics.test.js` | exact |
| `tests/helpers/createSessionControlServer.js` | test helper | event-driven | `tests/helpers/createSessionControlServer.js` | partial |
| `tests/runtime/playback-contract.test.js` | test | integration | none | no analog |
| `tests/runtime/playback-pause-resume.test.js` | test | integration | none | no analog |
| `tests/runtime/playback-advance.test.js` | test | integration | none | no analog |
| `tests/runtime/playback-restore.test.js` | test | integration | none | no analog |

## Pattern Assignments

### `public/app.js` (client orchestrator, event-driven)

**Analog:** `public/app.js`

**Restore flow shape**:
```javascript
const connectPromise = this.socketClient.connect(this.sessionId, this.controlToken);
const socketReady = await connectPromise;
if (['active', 'presenting'].includes(String(data.session.status || ''))) {
    const restoredSlideIndex = Math.max(0, Number(data.session.current_slide_index || 0));
    if (socketReady) {
        await this.replaySlide(restoredSlideIndex);
        await this.pauseAutoplex(false);
    }
}
```

**Completion polling shape**:
```javascript
handleAudioEnd(data = {}) {
    this.showTranscript(false);
    this.subtitleReady = false;
    this.waitForPlaybackFinish(data);
}
```

**Pause toggle shape**:
```javascript
await this.streamPlayer.pause();
this.isAudioPaused = true;
this.pauseStartMs = performance.now();
await this.pauseAutoplex(true);
```

**Use for:** keeping browser orchestration in one place while replacing implicit playback assumptions with explicit phase transitions.

---

### `public/services/audio.js` (client service, stream/event-driven)

**Analog:** `public/services/audio.js`

**Pending playback check**:
```javascript
hasPendingPlayback() {
    const hasScheduledAudio = this.audioContext && this.nextStartTime > this.audioContext.currentTime;
    const hasActiveSources = this.activeSources.length > 0;
    const hasQueuedChunks = this.chunkQueue.length > 0;
    const isCurrentlyBuffering = this.isBuffering;
    return hasScheduledAudio || hasActiveSources || hasQueuedChunks || isCurrentlyBuffering;
}
```

**Pause/resume shape**:
```javascript
pause() { /* suspend context, mute gain, stop buffering */ }
resume() { /* resume context, restore gain, flush queue */ }
```

**Reset shape**:
```javascript
reset() {
    this._stopAllSources();
    this._clearBuffers();
    this._isPaused = false;
}
```

**Use for:** making audio lifecycle state explicit and preventing late chunks or stale scheduled sources from leaking across transitions.

---

### `public/services/socket.js` (client service, event-driven)

**Analog:** `public/services/socket.js`

**Join and ready handshake**:
```javascript
this.socket.on('connect', () => {
    this.socket.emit('join-session', { sessionId, controlToken, clientInstanceId: this.app.clientInstanceId });
});

this.socket.on('session-joined', (data) => {
    if (data?.sessionId === sessionId) {
        this.isReady = true;
    }
});
```

**Playback completion acknowledgment**:
```javascript
notifyPlaybackComplete(sessionId, slideIndex) {
    this.socket.emit('presentation-audio-complete', { sessionId, slideIndex });
}
```

**Use for:** narrowing the client/server playback contract rather than creating side-channel control paths in `app.js`.

---

### `server/routes/autoplex.js` (route, event-driven)

**Analog:** `server/routes/autoplex.js`

**Pause/replay control shape**:
```javascript
router.post('/pause', requireSessionPlaybackControl(), (req, res) => {
    setPaused(sessionId, true);
    res.json({ success: true, paused: true });
});
```

**Cached playback + completion wait shape**:
```javascript
io.to(sessionId).emit('audio-end', { slideIndex, format: 'wav', ...options });
await waitForPlaybackCompletion(sessionId, waitMs);
```

**Presentation loop shape**:
```javascript
while (currentSlideIndex < slides.length) {
    await waitWhilePaused(db, io, sessionId);
    // emit slide-change
    // narrate / stream / wait
}
```

**Use for:** centralizing server-owned session/slide phase and guarded completion fallback logic.

---

### `server/routes/session.js` (route, request-response)

**Analog:** `server/routes/session.js`

**Restore payload source**:
```javascript
router.get('/:id', requireSessionControl({ keys: ['id'] }), async (req, res) => {
    // returns session, currentSlide, pendingQuestions, slideCount, slides
});
```

**Use for:** conservative restore and reconnect state hydration without auto-replay semantics.

---

### `server/routes/slides.js` (route, request-response)

**Analog:** `server/routes/slides.js`

**Explicit override shape**:
```javascript
router.post('/advance', requireSessionPlaybackControl(), async (req, res) => {
    const { sessionId, direction = 'next', targetSlide = null } = req.body;
    // decide next action and emit slide-change
});
```

**Use for:** keeping explicit jump/advance overrides separate from passive narration completion.

---

### `tests/runtime/session-diagnostics.test.js` (test, integration)

**Analog:** `tests/runtime/session-diagnostics.test.js`

**Capture logger pattern**:
```javascript
const { lines, logger } = createCaptureLogger();
setLogger(logger);
```

**Minimal in-memory DB pattern**:
```javascript
const db = {
    get(query, params) { /* return session/slide rows */ },
    all(query) { /* return arrays */ },
    run(query, params) { /* mutate in-memory state */ }
};
```

**Use for:** building focused runtime playback tests without booting the full production runtime.

## Anti-Patterns to Avoid

- Mutating playback state from both `app.js` and `socket.js` without a single contract boundary.
- Treating replay, restore, and live narration as the same transition.
- Letting `audio-end` imply rendered completion without consulting local playback state.
- Mixing manual slide overrides with automatic completion paths without an explicit reason/state field.

---

*Phase: 02-playback-state-reliability*
*Pattern map generated: 2026-04-19*
