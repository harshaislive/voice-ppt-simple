const express = require('express');
const router = express.Router();
const questionClassifier = require('../services/questionClassifier');
const slideEngine = require('../services/slideEngine');
const supabaseSession = require('../services/supabaseSession');
const { requireSessionControl, requireSessionPlaybackControl, requireSlideSessionControl } = require('../middleware/security');

// Advance slide
router.post('/advance', requireSessionPlaybackControl(), async (req, res) => {
    try {
        const { sessionId, direction = 'next', targetSlide = null } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        
        const db = req.app.get('db');
        const io = req.app.get('io');
        
        // Get current session state
        const session = db.get(`
            SELECT s.*, sl.title as current_slide_title, sl.content as slide_content, sl.notes as slide_notes
            FROM sessions s
            LEFT JOIN slides sl ON sl.session_id = s.id AND sl.slide_index = s.current_slide_index
            WHERE s.id = ? AND s.status IN ('active', 'presenting')
        `, [sessionId]);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found or not active' });
        }
        
        // Get pending questions
        const pendingQuestions = db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
        `, [sessionId]);
        
        // Classify questions if any
        let classificationResults = [];
        if (pendingQuestions.length > 0) {
            classificationResults = await questionClassifier.classifyQuestions(
                pendingQuestions.map(q => q.question_text),
                session.slide_content
            );
            
            // Update question priorities based on classification.
            // Do not mark questions answered here because this route only decides whether
            // to advance; answering happens through the QA flow.
            const updates = classificationResults.map((result, index) => ({
                questionId: pendingQuestions[index].id,
                priority: result.priority
            }));
            
            // Apply updates in transaction
            db.run('BEGIN TRANSACTION');
            
            try {
                for (const update of updates) {
                    db.run(`
                        UPDATE questions
                        SET priority = ?
                        WHERE id = ?
                    `, [update.priority, update.questionId]);
                }
                
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            
            // Create event
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [sessionId, 'questions_classified', JSON.stringify({ count: updates.length })]);
        }
        
        // Get updated pending questions
        const updatedPending = db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 5
        `, [sessionId]);
        
        // Decide next action using slide engine
        const decision = await slideEngine.decideNextAction({
            sessionId,
            currentSlideIndex: session.current_slide_index,
            pendingQuestions: updatedPending,
            direction,
            targetSlide,
            classificationResults
        });
        
        let newSlideIndex = session.current_slide_index;
        
        if (decision.action === 'advance' || decision.action === 'jump_to_slide') {
            // Get total slides
            const totalResult = db.get(`
                SELECT COUNT(*) as count FROM slides WHERE session_id = ?
            `, [sessionId]);
            const totalSlides = totalResult ? totalResult.count : 0;
            
            if (decision.action === 'jump_to_slide' && Number.isInteger(decision.targetSlide) && decision.targetSlide >= 0 && decision.targetSlide < totalSlides) {
                newSlideIndex = decision.targetSlide;
            } else if (direction === 'next' && session.current_slide_index < totalSlides - 1) {
                newSlideIndex = session.current_slide_index + 1;
            } else if ((direction === 'prev' || direction === 'previous') && session.current_slide_index > 0) {
                newSlideIndex = session.current_slide_index - 1;
            } else if (targetSlide !== null && targetSlide >= 0 && targetSlide < totalSlides) {
                newSlideIndex = targetSlide;
            }
            
            // Update session
            db.run(`
                UPDATE sessions
                SET current_slide_index = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [newSlideIndex, sessionId]);
            
            // Get new slide info
            const newSlide = db.get(`
                SELECT * FROM slides
                WHERE session_id = ? AND slide_index = ?
            `, [sessionId, newSlideIndex]);
            
            // Create event
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [sessionId, 'slide_changed', JSON.stringify({
                from: session.current_slide_index,
                to: newSlideIndex,
                slideTitle: newSlide ? newSlide.title : null,
                reason: decision.reason
            })]);
            
            // Emit slide change
            io.to(sessionId).emit('slide-change', {
                slideIndex: newSlideIndex,
                totalSlides,
                slide: newSlide,
                reason: decision.reason
            });
            
            res.json({
                success: true,
                action: decision.action,
                slideIndex: newSlideIndex,
                slide: newSlide,
                decision,
                classificationResults
            });
        } else {
            // No slide change, just answer questions or pause
            res.json({
                success: true,
                action: decision.action,
                slideIndex: session.current_slide_index,
                decision,
                classificationResults
            });
        }
    } catch (error) {
        console.error('Error advancing slide:', error);
        res.status(500).json({ error: 'Failed to advance slide' });
    }
});

// Get slides for a session
router.get('/:sessionId', requireSessionControl({ keys: ['sessionId'] }), (req, res) => {
    try {
        const { sessionId } = req.params;
        const db = req.app.get('db');
        
        const slides = db.all(`
            SELECT * FROM slides
            WHERE session_id = ?
            ORDER BY slide_index ASC
        `, [sessionId]);

        if ((!slides || slides.length === 0) && supabaseSession.isConfigured()) {
            supabaseSession.getSlides(sessionId)
                .then((remoteSlides) => res.json(Array.isArray(remoteSlides) ? remoteSlides : []))
                .catch((error) => {
                    console.warn('[Slides] Failed to load slides from Supabase:', error.message);
                    res.json([]);
                });
            return;
        }

        res.json(slides);
    } catch (error) {
        console.error('Error getting slides:', error);
        res.status(500).json({ error: 'Failed to get slides' });
    }
});

// Update slide content
router.patch('/:slideId', requireSlideSessionControl(), (req, res) => {
    try {
        const { slideId } = req.params;
        const updates = req.body;
        const db = req.app.get('db');
        
        // Build update
        const allowedFields = ['title', 'content', 'notes'];
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
        
        values.push(slideId);
        
        db.run(`
            UPDATE slides
            SET ${setClauses.join(', ')}
            WHERE id = ?
        `, values);
        
        // Get session ID for event
        const slide = db.get('SELECT session_id FROM slides WHERE id = ?', [slideId]);
        
        if (slide) {
            // Create event
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [slide.session_id, 'slide_updated', JSON.stringify({ slideId, updates })]);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating slide:', error);
        res.status(500).json({ error: 'Failed to update slide' });
    }
});

module.exports = router;
