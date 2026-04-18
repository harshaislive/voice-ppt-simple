const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cmsService = require('../services/cms');
const analyticsService = require('../services/analytics');
const supabaseSession = require('../services/supabaseSession');
const { getLogger, getRequestLogger } = require('../middleware/logger');
const {
    generateSessionControlToken,
    hashToken,
    requireAdminApiKey,
    requireSessionControl
} = require('../middleware/security');

const startupLogger = getLogger().child({ subsystem: 'session' });

// Import pre-generation progress tracker from autoplex
let pregenProgress = null;
function getPreGenProgress() {
    if (!pregenProgress) {
        try {
            const autoplexModule = require('./autoplex');
            pregenProgress = autoplexModule.getPreGenProgress?.();
        } catch {}
    }
    return pregenProgress || new Map();
}

// Log Supabase session service status on startup
if (supabaseSession.isConfigured()) {
    startupLogger.info({ event: 'source_session_persistence_configured', mode: 'supabase' });
} else {
    startupLogger.info({ event: 'source_session_persistence_configured', mode: 'sqlite' });
}

// Public config - no auth required
router.get('/config', (req, res) => {
    res.json({
        passcodeRequired: !!process.env.DEFAULT_PASSCODE
    });
});

// Get pre-generation progress for loading screen.
// This must be declared before `/:id` so it is not captured by the generic session route.
router.get('/pregen-progress/:sessionId', (req, res) => {
    const progressMap = getPreGenProgress();
    const progress = progressMap.get(req.params.sessionId);
    res.json(progress || { completed: 0, total: 0, status: 'pending' });
});

// Start a new presentation session
router.post('/start', async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'session' });
    try {
        const { deckId = 'beforest_pitch', participantName = '', passcode = '', bypassMaster = false } = req.body;
        const db = req.app.get('db');
        
        const configuredPasscode = process.env.DEFAULT_PASSCODE;
        const passcodeRequired = !!configuredPasscode;
        
        if (passcodeRequired && !passcode) {
            return res.status(403).json({ success: false, error: 'Passcode required', passcodeRequired: true });
        }
        
        if (passcodeRequired && passcode !== configuredPasscode) {
            return res.status(403).json({ success: false, error: 'Wrong passcode', passcodeRequired: true });
        }
        
        const sessionId = uuidv4();
        const controlToken = generateSessionControlToken();
        const controlTokenHash = hashToken(controlToken);
        const now = new Date().toISOString();
        const normalizedParticipantName = String(participantName || '').trim().slice(0, 60);
        
        // Load deck slides from CMS or local fallback
        let presentation;
        let slides = [];
        
        try {
            presentation = await cmsService.loadPresentation(deckId);
            slides = presentation.slides || [];
            logger.info({
                event: 'source_presentation_selected',
                sourceType: presentation?.source || 'unknown',
                presentationSlug: presentation?.presentationSlug || deckId
            });
        } catch (error) {
            logger.warn({ event: 'source_presentation_missing', deckId, err: error.message });
            presentation = null;
        }
        
        const metadata = JSON.stringify({
            participantName: normalizedParticipantName,
            sourceType: presentation?.source || 'unknown',
            presentationTitle: presentation?.title || deckId,
            presentationSlug: presentation?.presentationSlug || deckId,
            projectSlug: presentation?.projectSlug || null,
            knowledgeDocs: presentation?.knowledgeDocs || {},
            deckSchema: presentation?.deckSchema || null,
            flowConfig: presentation?.flowConfig || null,
            designConfig: presentation?.designConfig || null,
            bypassMaster: Boolean(bypassMaster)
        });

        // Write to SQLite (for current server operations)
        db.run(`
            INSERT INTO sessions (id, deck_id, control_token_hash, current_slide_index, status, created_at, updated_at, metadata)
            VALUES (?, ?, ?, 0, 'active', ?, ?, ?)
        `, [sessionId, presentation?.presentationSlug || deckId, controlTokenHash, now, now, metadata]);
        
        // Write to Supabase (for persistent cross-server persistence)
        if (supabaseSession.isConfigured()) {
            try {
                await supabaseSession.createSession({
                    id: sessionId,
                    deckId: presentation?.presentationSlug || deckId,
                    controlTokenHash,
                    currentSlideIndex: 0,
                    status: 'active',
                    metadata
                });
                
                if (slides.length > 0) {
                    await supabaseSession.createSlides(sessionId, slides);
                }
                logger.info({ event: 'source_session_supabase_synced', sessionId, slideCount: slides.length });
            } catch (err) {
                logger.error({ event: 'session_persistence_sync_failed', sessionId, err: err.message });
            }
        }
        
        // Insert slides to SQLite
        slides.forEach((slide, index) => {
            db.run(`
                INSERT INTO slides (id, session_id, deck_id, slide_index, title, content, image, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [uuidv4(), sessionId, presentation?.presentationSlug || deckId, index, slide.title, slide.content, slide.image || null, slide.notes || null, now]);
        });
        
        // Analytics log session start
        analyticsService.logSessionStart(
            sessionId,
            presentation?.projectSlug,
            presentation?.presentationSlug || deckId,
            normalizedParticipantName,
            slides.length
        );

        // Create initial event
        db.run(`
            INSERT INTO events (session_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, ?)
        `, [sessionId, 'session_started', JSON.stringify({
            deckId: presentation?.presentationSlug || deckId,
            slideCount: slides.length,
            participantName: normalizedParticipantName,
            sourceType: presentation?.source || 'unknown',
            projectSlug: presentation?.projectSlug
        }), now]);
        
        // Trigger background pre-generation of all slides
        if (slides.length > 0) {
            const autoplexModule = require('./autoplex');
            autoplexModule.triggerPreGeneration?.(db, sessionId, slides, metadata);
        }

        logger.info({
            event: 'session_start',
            sessionId,
            slideCount: slides.length,
            sourceType: presentation?.source || 'unknown',
            projectSlug: presentation?.projectSlug || null
        });
        
        res.json({
            success: true,
            sessionId,
            controlToken,
            deckId: presentation?.presentationSlug || deckId,
            projectSlug: presentation?.projectSlug || null,
            presentationTitle: presentation?.title || deckId,
            participantName: normalizedParticipantName,
            slideCount: slides.length,
            status: 'active',
            pregenStatus: 'starting',
            passcodeRequired
        });
    } catch (error) {
        logger.error({ event: 'session_start_failed', err: error.message });
        res.status(500).json({ error: 'Failed to start session' });
    }
});

// Get session state
router.get('/:id', requireSessionControl({ keys: ['id'] }), async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'session', sessionId: req.params.id });
    try {
        const { id } = req.params;
        const db = req.app.get('db');
        
        let session = db.get(`
            SELECT s.*, 
                   (SELECT COUNT(*) FROM questions q WHERE q.session_id = s.id AND q.status = 'pending') as pending_questions,
                   (SELECT COUNT(*) FROM slides sl WHERE sl.session_id = s.id) as slide_count
            FROM sessions s
            WHERE s.id = ?
        `, [id]);
        let slides = session
            ? db.all(`SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC`, [id])
            : [];
        let fromSupabase = false;

        if (session) {
            logger.info({ event: 'source_session_loaded', source: 'sqlite' });
        }

        // Fall back to Supabase only when the local session is absent.
        if (!session && supabaseSession.isConfigured()) {
            try {
                const supabaseData = await supabaseSession.getSessionWithSlides(id);
                if (supabaseData && supabaseData.session) {
                    session = supabaseData.session;
                    slides = supabaseData.slides || [];
                    fromSupabase = true;
                    logger.info({ event: 'source_session_loaded', source: 'supabase' });
                }
            } catch (err) {
                logger.warn({ event: 'source_session_load_failed', source: 'supabase', err: err.message });
            }
        }
        
        // If Supabase returned a session but no slides, fall back to SQLite for slides
        if (session && (!slides || slides.length === 0)) {
            const sqliteSlides = db.all(`SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC`, [id]);
            if (sqliteSlides && sqliteSlides.length > 0) {
                slides = sqliteSlides;
                logger.info({ event: 'source_slides_loaded', source: 'sqlite_fallback', slideCount: slides.length });
            }
        }
        
        if (!session) {
            logger.warn({ event: 'session_load_missing' });
            return res.status(404).json({ error: 'Session not found' });
        }
        
        // Get current slide
        const currentSlide = slides.find(s => s.slide_index === session.current_slide_index) || null;
        
        // Prefer fresh local pending questions when the local session exists.
        let pendingQuestions = db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 10
        `, [id]);

        if ((!pendingQuestions || pendingQuestions.length === 0) && fromSupabase && supabaseSession.isConfigured()) {
            try {
                pendingQuestions = await supabaseSession.getQuestions(id, 'pending');
            } catch (error) {
                logger.warn({ event: 'qa_pending_load_failed', source: 'supabase', err: error.message });
            }
        }

        if (!pendingQuestions || pendingQuestions.length === 0) {
            pendingQuestions = db.all(`
                SELECT * FROM questions
                WHERE session_id = ? AND status = 'pending'
                ORDER BY priority DESC, created_at ASC
                LIMIT 10
            `, [id]);
        }

        let participantName = '';
        try {
            participantName = JSON.parse(session.metadata || '{}').participantName || '';
        } catch {
            participantName = '';
        }
        
        logger.info({ event: 'session_load', status: session.status, fromSupabase, slideCount: slides.length });
        res.json({
            session,
            currentSlide,
            pendingQuestions,
            participantName,
            slideCount: slides.length,
            slides
        });
    } catch (error) {
        logger.error({ event: 'session_load_failed', err: error.message });
        res.status(500).json({ error: 'Failed to get session' });
    }
});

// Update session state
router.patch('/:id', requireSessionControl({ keys: ['id'] }), async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'session', sessionId: req.params.id });
    try {
        const { id } = req.params;
        const updates = req.body;
        const db = req.app.get('db');
        const session = db.get('SELECT id FROM sessions WHERE id = ?', [id]);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            return res.status(400).json({ error: 'Request body must be an object' });
        }
        
        // Build update query dynamically
        const allowedFields = ['current_slide_index', 'status'];
        const setClauses = [];
        const values = [];
        const sanitizedUpdates = {};
        const totalSlides = db.get('SELECT COUNT(*) as count FROM slides WHERE session_id = ?', [id])?.count || 0;
        const allowedStatuses = new Set(['active', 'presenting', 'completed']);
        
        for (const [field, value] of Object.entries(updates)) {
            if (!allowedFields.includes(field)) {
                continue;
            }

            if (field === 'current_slide_index') {
                if (!Number.isInteger(value) || value < 0) {
                    return res.status(400).json({ error: 'current_slide_index must be a non-negative integer' });
                }

                if (totalSlides > 0 && value >= totalSlides) {
                    return res.status(400).json({ error: `current_slide_index must be less than ${totalSlides}` });
                }
            }

            if (field === 'status') {
                if (typeof value !== 'string' || !allowedStatuses.has(value)) {
                    return res.status(400).json({ error: 'status must be one of: active, presenting, completed' });
                }
            }

            setClauses.push(`${field} = ?`);
            values.push(value);
            sanitizedUpdates[field] = value;
        }
        
        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        values.push(id);
        
        // Update SQLite
        db.run(`
            UPDATE sessions
            SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, values);
        
        // Update Supabase (fire and forget - SQLite is source of truth for writes)
        if (supabaseSession.isConfigured()) {
            supabaseSession.updateSession(id, sanitizedUpdates).catch(err => {
                logger.error({ event: 'session_update_sync_failed', err: err.message });
            });
        }
        
        // Create event
        db.run(`
            INSERT INTO events (session_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `, [id, 'session_updated', JSON.stringify(sanitizedUpdates)]);
        
        logger.info({
            event: sanitizedUpdates.status === 'completed' ? 'session_end' : 'session_updated',
            updates: sanitizedUpdates
        });

        res.json({ success: true });
    } catch (error) {
        logger.error({ event: 'session_update_failed', err: error.message });
        res.status(500).json({ error: 'Failed to update session' });
    }
});

// Get all sessions
router.get('/', requireAdminApiKey, (req, res) => {
    try {
        const db = req.app.get('db');
        const sessions = db.all(`
            SELECT s.*,
                   (SELECT COUNT(*) FROM questions q WHERE q.session_id = s.id AND q.status = 'pending') as pending_questions,
                   (SELECT COUNT(*) FROM slides sl WHERE sl.session_id = s.id) as slide_count
            FROM sessions s
            ORDER BY s.created_at DESC
            LIMIT 50
        `);
        
        res.json(sessions);
    } catch (error) {
        console.error('Error listing sessions:', error);
        res.status(500).json({ error: 'Failed to list sessions' });
    }
});

module.exports = router;
