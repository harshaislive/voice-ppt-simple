# Phase 1: Runtime Guardrails - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 13
**Analogs found:** 10 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/middleware/security.js` | middleware | request-response | `server/middleware/security.js` | exact |
| `server/config/runtime.js` | config | request-response | `server/config/runtime.js` | exact |
| `server/routes/cms.js` | route | CRUD | `server/routes/cms.js` | exact |
| `server/routes/analytics.js` | route | request-response | `server/routes/analytics.js` | exact |
| `server/routes/session.js` | route | request-response | `server/routes/session.js` | exact |
| `server/routes/autoplex.js` | route | event-driven | `server/routes/autoplex.js` | exact |
| `server/routes/questions.js` | route | request-response | `server/routes/slides.js` | partial |
| `server/services/analytics.js` | service | event-driven | `server/services/analytics.js` | exact |
| `server.js` | config | event-driven | `server.js` | exact |
| `package.json` | config | batch | `package.json` | exact |
| `server/middleware/logger.js` | middleware | request-response | none | no analog |
| `tests/runtime/runtime-config.test.js` | test | request-response | none | no analog |
| `tests/runtime/cms-auth.test.js` | test | request-response | none | no analog |
| `tests/runtime/analytics-auth.test.js` | test | request-response | none | no analog |
| `tests/runtime/session-diagnostics.test.js` | test | request-response | none | no analog |
| `jest.config.js` | config | batch | none | no analog |

## Pattern Assignments

### `server/middleware/security.js` (middleware, request-response)

**Analog:** `server/middleware/security.js`

**Imports and helper layout** (lines 1-4):
```javascript
const crypto = require('crypto');
const supabaseSession = require('../services/supabaseSession');

function hashToken(token) {
```

**Session resolution + fail response pattern** (lines 41-63, 144-167):
```javascript
function resolveSessionId(req, options = {}) {
    const keys = options.keys || ['sessionId', 'id'];
    // body -> params -> query lookup
}

function requireSessionControl(options = {}) {
    return async (req, res, next) => {
        try {
            const db = req.app.get('db');
            const sessionId = resolveSessionId(req, options);
            const providedToken = extractSessionControlToken(req);

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID is required' });
            }

            if (!(await hasValidSessionControlAsync(db, sessionId, providedToken))) {
                return res.status(403).json({ error: 'Valid session control token required' });
            }

            req.sessionId = sessionId;
            next();
        } catch (error) {
            next(error);
        }
    };
}
```

**Admin key gate** (lines 212-223):
```javascript
function requireAdminApiKey(req, res, next) {
    const configuredKey = String(process.env.ADMIN_API_KEY || '').trim();
    if (!configuredKey) {
        return res.status(503).json({ error: 'ADMIN_API_KEY is not configured' });
    }

    const providedKey = String(req.get('x-admin-api-key') || '').trim();
    if (!providedKey || !timingSafeCompare(configuredKey, providedKey)) {
        return res.status(403).json({ error: 'Valid admin API key required' });
    }

    next();
}
```

**Use for:** centralizing stricter staging/local bypass rules and reusing middleware rather than inlining auth checks in routes.

---

### `server/config/runtime.js` (config, request-response)

**Analog:** `server/config/runtime.js`

**Environment parsing pattern** (lines 1-17):
```javascript
const DEFAULT_ALLOWED_ORIGINS = [/* local defaults */];

function isProduction() {
    return (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function parseAllowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS || '';
    if (!raw.trim()) {
        return isProduction() ? [] : DEFAULT_ALLOWED_ORIGINS;
    }

    return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}
```

**Startup validation pattern** (lines 19-85):
```javascript
function validateRuntimeConfig() {
    const production = isProduction();
    const allowedOrigins = parseAllowedOrigins();
    const errors = [];

    if (production && allowedOrigins.length === 0) {
        errors.push('ALLOWED_ORIGINS must be set in production');
    }

    if (errors.length > 0) {
        const error = new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
        error.code = 'INVALID_RUNTIME_CONFIG';
        throw error;
    }

    return {
        isProduction: production,
        allowedOrigins
    };
}
```

**CORS policy shape** (lines 87-109):
```javascript
function createCorsOptions(allowedOrigins = []) {
    const production = isProduction();

    if (!production) {
        return { origin: true, methods: ['GET', 'POST', 'PATCH'] };
    }

    return {
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PATCH']
    };
}
```

**Use for:** extending `production` into explicit environment classification and keeping all boot-time fail-closed logic in one module.

---

### `server/routes/cms.js` (route, CRUD)

**Analog:** `server/routes/cms.js`

**Imports and router setup** (lines 1-5):
```javascript
const express = require('express');
const cmsService = require('../services/cms');

const router = express.Router();
router.use(express.json());
```

**Public read handler pattern** (lines 7-18, 114-145):
```javascript
router.get('/presentations', async (req, res) => {
    try {
        const presentations = await cmsService.listPresentations();
        res.json({
            presentations,
            source: cmsService.isSupabaseConfigured() ? 'hybrid' : 'local'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to list presentations' });
    }
});
```

**Mutation handler pattern** (lines 20-38, 53-71, 147-175):
```javascript
router.post('/presentations', async (req, res) => {
    try {
        const { title, slides } = req.body;
        if (!title || typeof title !== 'string' || title.length > 255) {
            return res.status(400).json({ error: 'Invalid title' });
        }
        if (slides && !Array.isArray(slides)) {
            return res.status(400).json({ error: 'Slides must be an array' });
        }
        const presentation = await cmsService.createPresentation(req.body);
        res.status(201).json({ presentation });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create presentation' });
    }
});
```

**Binary preview response pattern** (lines 177-196):
```javascript
router.post('/preview-narration', async (req, res) => {
    try {
        const { text, voice = 'default' } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Text is required for preview' });
        }

        const ttsService = require('../services/tts');
        const audioBuffer = await ttsService.synthesize(text, voice);

        res.set({
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.length
        });
        res.send(audioBuffer);
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate preview audio' });
    }
});
```

**Use for:** splitting public read endpoints from admin-only mutation and preview endpoints while preserving the existing validation and service-delegation style.

---

### `server/routes/analytics.js` (route, request-response)

**Analog:** `server/routes/analytics.js`

**Imports pattern** (lines 1-4):
```javascript
const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analytics');
const { requireSessionControl } = require('../middleware/security');
```

**Minimal ingest handler shape** (lines 6-18):
```javascript
router.post('/event', async (req, res) => {
    try {
        const { sessionId, eventType, slideIndex, content, metadata } = req.body;
        if (!sessionId || !eventType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        await analyticsService.logEvent(sessionId, eventType, slideIndex, content, metadata);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to log event' });
    }
});
```

**Auth assignment to copy from elsewhere:** apply route-level middleware like `requireSessionControl({ keys: ['sessionId'] })` in the same style used in `server/routes/slides.js` lines 173-200.

---

### `server/routes/session.js` (route, request-response)

**Analog:** `server/routes/session.js`

**Imports and mixed service dependencies** (lines 1-12):
```javascript
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cmsService = require('../services/cms');
const analyticsService = require('../services/analytics');
const supabaseSession = require('../services/supabaseSession');
const {
    generateSessionControlToken,
    hashToken,
    requireAdminApiKey,
    requireSessionControl
} = require('../middleware/security');
```

**Session bootstrap pattern** (lines 48-176):
```javascript
router.post('/start', async (req, res) => {
    try {
        const { deckId = 'beforest_pitch', participantName = '' } = req.body;
        const db = req.app.get('db');
        const sessionId = uuidv4();
        const controlToken = generateSessionControlToken();
        const controlTokenHash = hashToken(controlToken);

        // load CMS data, write SQLite, optionally sync Supabase
        // log analytics and create local event record

        res.json({
            success: true,
            sessionId,
            controlToken,
            slideCount: slides.length,
            status: 'active'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start session' });
    }
});
```

**Protected read pattern** (lines 179-280):
```javascript
router.get('/:id', requireSessionControl({ keys: ['id'] }), async (req, res) => {
    try {
        const { id } = req.params;
        const db = req.app.get('db');
        let session = db.get(`SELECT ... FROM sessions s WHERE s.id = ?`, [id]);
        let slides = session ? db.all(`SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC`, [id]) : [];

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({ session, currentSlide, pendingQuestions, participantName, slideCount: slides.length, slides });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get session' });
    }
});
```

**Use for:** lifecycle logging anchors such as session start, auth failure, source selection, and session fetch diagnostics.

---

### `server/routes/autoplex.js` (route, event-driven)

**Analog:** `server/routes/autoplex.js`

**High-dependency route module pattern** (lines 1-15):
```javascript
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const ttsService = require('../services/tts');
const modelService = require('../services/model');
const analyticsService = require('../services/analytics');
const { requireSessionPlaybackControl, requireSessionControl } = require('../middleware/security');
```

**Long-lived in-memory state pattern** (lines 16-48):
```javascript
const interruptFlags = new Map();
const pauseFlags = new Map();
const playbackWaiters = new Map();
const continueWaiters = new Map();
const presentationStartTimes = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [sessionId, startTime] of presentationStartTimes.entries()) {
        if (now - startTime > PRESENTATION_TIMEOUT_MS) {
            // emit lifecycle failure and clean up maps
        }
    }
}, 5 * 60 * 1000);
```

**Use for:** attaching structured lifecycle events around playback start/timeout/end without changing the existing event-driven control flow shape.

---

### `server/routes/questions.js` (route, request-response)

**Analog:** `server/routes/slides.js`

**Why this analog:** it is the clearest current example of route-level `requireSessionControl` / `requireSessionPlaybackControl` application in front of mixed DB + service logic.

**Auth-wrapped handler pattern from `server/routes/slides.js`** (lines 8-18, 173-203):
```javascript
router.post('/advance', requireSessionPlaybackControl(), async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        // route logic
    } catch (error) {
        res.status(500).json({ error: 'Failed to advance slide' });
    }
});

router.get('/:sessionId', requireSessionControl({ keys: ['sessionId'] }), (req, res) => {
    // protected read shape
});
```

**Use for:** guarding Q&A lifecycle routes and logging auth failures in the same request-middleware-first style.

---

### `server/services/analytics.js` (service, event-driven)

**Analog:** `server/services/analytics.js`

**Service class + singleton export pattern** (lines 1-63):
```javascript
const cmsService = require('./cms');

class AnalyticsService {
    isConfigured() {
        return cmsService.isSupabaseConfigured();
    }

    async logSessionStart(sessionId, projectSlug, presentationSlug, participantName, totalSlides) {
        if (!this.isConfigured()) return;
        try {
            const result = await cmsService.request('analytics_sessions', { on_conflict: 'session_id' }, {
                method: 'POST',
                body: [{ session_id: sessionId, project_slug: projectSlug, presentation_slug: presentationSlug }]
            });
        } catch (err) {
            console.error('Analytics logSessionStart failed:', err.message);
        }
    }
}

module.exports = new AnalyticsService();
```

**Event write shape** (lines 44-59):
```javascript
async logEvent(sessionId, eventType, slideIndex, content, metadata = {}) {
    if (!this.isConfigured()) return;
    try {
        await cmsService.request('analytics_events', {}, {
            method: 'POST',
            body: [{
                session_id: sessionId,
                event_type: eventType,
                slide_index: slideIndex,
                content: typeof content === 'string' ? content : JSON.stringify(content),
                metadata_json: metadata
            }]
        });
    } catch (err) {
        console.error('Analytics logEvent failed:', err.message);
    }
}
```

**Use for:** preserving the existing thin service wrapper while adding redaction/minimization and stable session timeline event names.

---

### `server.js` (config, event-driven)

**Analog:** `server.js`

**Composition-root wiring** (lines 1-20, 48-66):
```javascript
require('dotenv').config();
const { createCorsOptions, validateRuntimeConfig } = require('./server/config/runtime');
const { createRateLimiter, hasValidSessionControlAsync, requireAdminApiKey, securityHeaders } = require('./server/middleware/security');

const runtimeConfig = validateRuntimeConfig();
const corsOptions = createCorsOptions(runtimeConfig.allowedOrigins);

const sessionRoutes = require('./server/routes/session');
const cmsRoutes = require('./server/routes/cms');
const analyticsRoutes = require('./server/routes/analytics');

app.use('/api/session', sessionRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/analytics', analyticsRoutes);
```

**Middleware ordering pattern** (lines 28-39):
```javascript
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: 180, label: 'API' }));
```

**Socket auth flow** (lines 152-183):
```javascript
io.on('connection', (socket) => {
    socket.on('join-session', async (payload) => {
        const sessionId = typeof payload === 'string' ? payload : payload?.sessionId;
        const controlToken = typeof payload === 'object' ? String(payload?.controlToken || '') : '';
        const db = app.get('db');

        if (!(await hasValidSessionControlAsync(db, sessionId, controlToken))) {
            socket.emit('session-join-error', { error: 'Valid session control token required' });
            return;
        }

        socket.join(sessionId);
        socket.emit('session-joined', { sessionId, isController: true });
    });
});
```

**Error and startup pattern** (lines 185-238):
```javascript
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

initializeDatabase()
    .then(database => {
        app.set('db', database.dbHelper);
        server.listen(PORT, HOST, () => {
            console.log(`Voice-PPT server running on http://${HOST}:${PORT}`);
        });
    })
    .catch(error => {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    });
```

**Use for:** introducing request/session logger middleware at the composition root and keeping startup validation there.

---

### `package.json` (config, batch)

**Analog:** `package.json`

**Script + dependency layout** (lines 1-39):
```json
{
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "db:init": "node server/db/init.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

**Use for:** adding `pino`, `jest`, and `supertest` without changing the current CommonJS script shape.

## Shared Patterns

### Authorization Middleware
**Source:** `server/middleware/security.js` lines 144-223  
**Apply to:** `server/routes/cms.js`, `server/routes/analytics.js`, `server/routes/questions.js`, Socket.IO join path in `server.js`
```javascript
function requireSessionControl(options = {}) {
    return async (req, res, next) => {
        try {
            const db = req.app.get('db');
            const sessionId = resolveSessionId(req, options);
            const providedToken = extractSessionControlToken(req);

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID is required' });
            }

            if (!(await hasValidSessionControlAsync(db, sessionId, providedToken))) {
                return res.status(403).json({ error: 'Valid session control token required' });
            }

            req.sessionId = sessionId;
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireAdminApiKey(req, res, next) {
    const configuredKey = String(process.env.ADMIN_API_KEY || '').trim();
    if (!configuredKey) {
        return res.status(503).json({ error: 'ADMIN_API_KEY is not configured' });
    }
    // compare and reject with 403
}
```

### Runtime Validation
**Source:** `server/config/runtime.js` lines 19-109  
**Apply to:** `server/config/runtime.js`, `server.js`, runtime-config tests
```javascript
function validateRuntimeConfig() {
    const production = isProduction();
    const allowedOrigins = parseAllowedOrigins();
    const errors = [];

    if (production && allowedOrigins.length === 0) {
        errors.push('ALLOWED_ORIGINS must be set in production');
    }

    if (errors.length > 0) {
        const error = new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
        error.code = 'INVALID_RUNTIME_CONFIG';
        throw error;
    }

    return { isProduction: production, allowedOrigins };
}
```

### Composition Root Wiring
**Source:** `server.js` lines 19-39, 58-66, 185-218  
**Apply to:** `server.js`, new `server/middleware/logger.js`
```javascript
const runtimeConfig = validateRuntimeConfig();
const corsOptions = createCorsOptions(runtimeConfig.allowedOrigins);

app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

app.use('/api/session', sessionRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});
```

### Event Persistence
**Source:** `server/services/analytics.js` lines 8-59 and `server/routes/session.js` lines 133-152  
**Apply to:** `server/services/analytics.js`, `server/routes/session.js`, `server/routes/autoplex.js`, `server/routes/questions.js`
```javascript
analyticsService.logSessionStart(
    sessionId,
    presentation?.projectSlug,
    presentation?.presentationSlug || deckId,
    normalizedParticipantName,
    slides.length
);

db.run(`
    INSERT INTO events (session_id, event_type, event_data, created_at)
    VALUES (?, ?, ?, ?)
`, [sessionId, 'session_started', JSON.stringify({
    deckId: presentation?.presentationSlug || deckId,
    slideCount: slides.length,
    sourceType: presentation?.source || 'unknown'
}), now]);
```

## No Analog Found

Files with no close match in the codebase:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `server/middleware/logger.js` | middleware | request-response | No existing structured logging module; current codebase uses `console.log` inline in routes and services. |
| `tests/runtime/runtime-config.test.js` | test | request-response | No current backend test suite or Jest/Supertest examples in repo. |
| `tests/runtime/cms-auth.test.js` | test | request-response | No route authorization tests exist yet. |
| `tests/runtime/analytics-auth.test.js` | test | request-response | No analytics ingest tests or helper harness exist yet. |
| `tests/runtime/session-diagnostics.test.js` | test | request-response | No structured logging/timeline test analog exists yet. |
| `jest.config.js` | config | batch | No explicit test-runner config exists yet. |

Planner should use `01-RESEARCH.md` for the logger/test library choices and mirror current handler boundaries from the analogs above.

## Metadata

**Analog search scope:** `server/`, repo root `package.json`, `.planning/phases/01-runtime-guardrails/01-CONTEXT.md`, `.planning/phases/01-runtime-guardrails/01-RESEARCH.md`  
**Files scanned:** 10 code files + 2 phase input files  
**Pattern extraction date:** 2026-04-19
