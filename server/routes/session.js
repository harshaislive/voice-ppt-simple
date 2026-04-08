const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// Start a new presentation session
router.post('/start', async (req, res) => {
    try {
        const { deckId = 'beforest_pitch' } = req.body;
        const db = req.app.get('db');
        
        const sessionId = uuidv4();
        const now = new Date().toISOString();
        
        // Create session
        db.run(`
            INSERT INTO sessions (id, deck_id, current_slide_index, status, created_at, updated_at)
            VALUES (?, ?, 0, 'active', ?, ?)
        `, [sessionId, deckId, now, now]);
        
        // Load deck slides
        const deckPath = path.join(__dirname, `../decks/${deckId}.json`);
        try {
            const deckData = await fs.readFile(deckPath, 'utf8');
            const deck = JSON.parse(deckData);
            
            // Insert slides
            deck.slides.forEach((slide, index) => {
                db.run(`
                    INSERT INTO slides (id, session_id, deck_id, slide_index, title, content, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [uuidv4(), sessionId, deckId, index, slide.title, slide.content, slide.notes || null, now]);
            });
            
            // Create initial event
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, ?)
            `, [sessionId, 'session_started', JSON.stringify({ deckId, slideCount: deck.slides.length }), now]);
            
            res.json({
                success: true,
                sessionId,
                deckId,
                slideCount: deck.slides.length,
                status: 'active'
            });
        } catch (error) {
            // Deck not found, still create session
            console.warn(`Deck ${deckId} not found, creating empty session`);
            
            res.json({
                success: true,
                sessionId,
                deckId,
                slideCount: 0,
                status: 'active',
                warning: 'Deck not found'
            });
        }
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

// Get session state
router.get('/:id', (req, res) => {
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
        
        res.json({
            session,
            currentSlide,
            pendingQuestions
        });
    } catch (error) {
        console.error('Error getting session:', error);
        res.status(500).json({ error: 'Failed to get session' });
    }
});

// Update session state
router.patch('/:id', (req, res) => {
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
router.get('/', (req, res) => {
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
