const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cmsService = require('../services/cms');
const analyticsService = require('../services/analytics');
const {
    generateSessionControlToken,
    hashToken,
    requireAdminApiKey,
    requireSessionControl
} = require('../middleware/security');

// Public config - no auth required
router.get('/config', (req, res) => {
    res.json({
        passcodeRequired: !!process.env.DEFAULT_PASSCODE
    });
});

// Start a new presentation session
router.post('/start', async (req, res) => {
    try {
        const { deckId = 'beforest_pitch', participantName = '', passcode = '' } = req.body;
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
        const now = new Date().toISOString();
        const normalizedParticipantName = String(participantName || '').trim().slice(0, 60);
        // Load deck slides from CMS or local fallback
        try {
            const presentation = await cmsService.loadPresentation(deckId);
            const metadata = JSON.stringify({
                participantName: normalizedParticipantName,
                sourceType: presentation.source,
                presentationTitle: presentation.title,
                presentationSlug: presentation.presentationSlug,
                projectSlug: presentation.projectSlug,
                knowledgeDocs: presentation.knowledgeDocs || {},
                deckSchema: presentation.deckSchema || null,
                flowConfig: presentation.flowConfig || null,
                designConfig: presentation.designConfig || null
            });

            db.run(`
                INSERT INTO sessions (id, deck_id, control_token_hash, current_slide_index, status, created_at, updated_at, metadata)
                VALUES (?, ?, ?, 0, 'active', ?, ?, ?)
            `, [sessionId, presentation.presentationSlug || deckId, hashToken(controlToken), now, now, metadata]);
            
            // Insert slides
            presentation.slides.forEach((slide, index) => {
                db.run(`
                    INSERT INTO slides (id, session_id, deck_id, slide_index, title, content, image, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [uuidv4(), sessionId, presentation.presentationSlug || deckId, index, slide.title, slide.content, slide.image || null, slide.notes || null, now]);
            });
            
            // Analytics log session start
            analyticsService.logSessionStart(
                sessionId,
                presentation.projectSlug,
                presentation.presentationSlug || deckId,
                normalizedParticipantName,
                presentation.slides.length
            );

            // Create initial event
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, ?)
            `, [sessionId, 'session_started', JSON.stringify({
                deckId: presentation.presentationSlug || deckId,
                slideCount: presentation.slides.length,
                participantName: normalizedParticipantName,
                sourceType: presentation.source,
                projectSlug: presentation.projectSlug
            }), now]);
            
            res.json({
                success: true,
                sessionId,
                controlToken,
                deckId: presentation.presentationSlug || deckId,
                presentationTitle: presentation.title,
                projectSlug: presentation.projectSlug || null,
                participantName: normalizedParticipantName,
                slideCount: presentation.slides.length,
                status: 'active',
                passcodeRequired
            });
        } catch (error) {
            console.warn(`Presentation ${deckId} not found, creating empty session`);
            const metadata = JSON.stringify({
                participantName: normalizedParticipantName
            });

            db.run(`
                INSERT INTO sessions (id, deck_id, control_token_hash, current_slide_index, status, created_at, updated_at, metadata)
                VALUES (?, ?, ?, 0, 'active', ?, ?, ?)
            `, [sessionId, deckId, hashToken(controlToken), now, now, metadata]);
            
            res.json({
                success: true,
                sessionId,
                controlToken,
                deckId,
                projectSlug: null,
                participantName: normalizedParticipantName,
                slideCount: 0,
                status: 'active',
                warning: 'Deck not found',
                passcodeRequired
            });
        }
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

// Get session state
router.get('/:id', requireSessionControl({ keys: ['id'] }), (req, res) => {
    try {
        const { id } = req.params;
        const db = req.app.get('db');
        
        const session = db.get(`
            SELECT s.*, 
                   (SELECT COUNT(*) FROM questions q WHERE q.session_id = s.id AND q.status = 'pending') as pending_questions,
                   (SELECT COUNT(*) FROM slides sl WHERE sl.session_id = s.id) as slide_count
            FROM sessions s
            WHERE s.id = ?
        `, [id]);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        // Get current slide
        const currentSlide = db.get(`
            SELECT * FROM slides
            WHERE session_id = ? AND slide_index = ?
        `, [id, session.current_slide_index]);
        
        // Get pending questions
        const pendingQuestions = db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 10
        `, [id]);

        let participantName = '';
        try {
            participantName = JSON.parse(session.metadata || '{}').participantName || '';
        } catch {
            participantName = '';
        }
        
        res.json({
            session,
            currentSlide,
            pendingQuestions,
            participantName
        });
    } catch (error) {
        console.error('Error getting session:', error);
        res.status(500).json({ error: 'Failed to get session' });
    }
});

// Update session state
router.patch('/:id', requireSessionControl({ keys: ['id'] }), (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const db = req.app.get('db');
        
        // Build update query dynamically
        const allowedFields = ['current_slide_index', 'status'];
        const setClauses = [];
        const values = [];
        
        for (const [field, value] of Object.entries(updates)) {
            if (allowedFields.includes(field)) {
                setClauses.push(`${field} = ?`);
                values.push(value);
            }
        }
        
        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        values.push(id);
        
        db.run(`
            UPDATE sessions
            SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, values);
        
        // Create event
        db.run(`
            INSERT INTO events (session_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `, [id, 'session_updated', JSON.stringify(updates)]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating session:', error);
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
