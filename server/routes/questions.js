const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Submit a question
router.post('/', async (req, res) => {
    try {
        const { sessionId, questionText, submittedBy } = req.body;
        
        if (!sessionId || !questionText) {
            return res.status(400).json({ error: 'Session ID and question text are required' });
        }
        
        const db = req.app.get('db');
        
        // Verify session exists and is active
        const session = db.get(`
            SELECT id, current_slide_index FROM sessions
            WHERE id = ? AND status = 'active'
        `, [sessionId]);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found or not active' });
        }
        
        const questionId = uuidv4();
        const now = new Date().toISOString();
        
        // Insert question
        db.run(`
            INSERT INTO questions (id, session_id, question_text, submitted_by, slide_index, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [questionId, sessionId, questionText, submittedBy || 'anonymous', session.current_slide_index, now]);
        
        // Create event
        db.run(`
            INSERT INTO events (session_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, ?)
        `, [sessionId, 'question_submitted', JSON.stringify({ questionId, questionText, submittedBy }), now]);
        
        // Get pending questions count
        const pendingResult = db.get(`
            SELECT COUNT(*) as count FROM questions
            WHERE session_id = ? AND status = 'pending'
        `, [sessionId]);
        const pendingCount = pendingResult ? pendingResult.count : 0;
        
        // Emit Socket.IO event
        const io = req.app.get('io');
        io.to(sessionId).emit('question-added', {
            questionId,
            questionText,
            submittedBy,
            pendingCount
        });
        
        res.json({
            success: true,
            questionId,
            pendingCount
        });
    } catch (error) {
        console.error('Error submitting question:', error);
        res.status(500).json({ error: 'Failed to submit question' });
    }
});

// Get questions for a session
router.get('/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { status = 'pending' } = req.query;
        const db = req.app.get('db');
        
        const questions = db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = ?
            ORDER BY 
                CASE WHEN status = 'pending' THEN priority END DESC,
                created_at ASC
        `, [sessionId, status]);
        
        res.json(questions);
    } catch (error) {
        console.error('Error getting questions:', error);
        res.status(500).json({ error: 'Failed to get questions' });
    }
});

// Update question status
router.patch('/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        const { status, answerText, priority } = req.body;
        const db = req.app.get('db');
        
        // Get current question
        const question = db.get(`
            SELECT * FROM questions WHERE id = ?
        `, [questionId]);
        
        if (!question) {
            return res.status(404).json({ error: 'Question not found' });
        }
        
        // Build update
        const updates = [];
        const values = [];
        
        if (status) {
            updates.push('status = ?');
            values.push(status);
            
            if (status === 'answered') {
                updates.push('answered_at = CURRENT_TIMESTAMP');
                if (answerText) {
                    updates.push('answer_text = ?');
                    values.push(answerText);
                }
            }
        }
        
        if (priority !== undefined) {
            updates.push('priority = ?');
            values.push(priority);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }
        
        values.push(questionId);
        
        db.run(`
            UPDATE questions
            SET ${updates.join(', ')}
            WHERE id = ?
        `, values);
        
        // Create event
        const event = {
            questionId,
            updates: { status, answerText, priority }
        };
        
        db.run(`
            INSERT INTO events (session_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `, [question.session_id, 'question_updated', JSON.stringify(event)]);
        
        // Emit Socket.IO event
        const io = req.app.get('io');
        io.to(question.session_id).emit('queue-update', {
            questionId,
            status
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({ error: 'Failed to update question' });
    }
});

// Bulk update questions (for classification results)
router.post('/bulk-update', async (req, res) => {
    try {
        const { sessionId, updates } = req.body;
        
        if (!sessionId || !updates || !Array.isArray(updates)) {
            return res.status(400).json({ error: 'Session ID and updates array are required' });
        }
        
        const db = req.app.get('db');
        
        // Begin transaction
        db.run('BEGIN TRANSACTION');
        
        try {
            for (const update of updates) {
                const { questionId, status, priority, answerText } = update;
                
                if (!questionId) continue;
                
                const sets = [];
                const values = [];
                
                if (status) {
                    sets.push('status = ?');
                    values.push(status);
                    
                    if (status === 'answered') {
                        sets.push('answered_at = CURRENT_TIMESTAMP');
                        if (answerText) {
                            sets.push('answer_text = ?');
                            values.push(answerText);
                        }
                    }
                }
                
                if (priority !== undefined) {
                    sets.push('priority = ?');
                    values.push(priority);
                }
                
                if (sets.length > 0) {
                    values.push(questionId);
                    db.run(`
                        UPDATE questions
                        SET ${sets.join(', ')}
                        WHERE id = ?
                    `, values);
                }
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
        `, [sessionId, 'questions_bulk_updated', JSON.stringify({ updates })]);
        
        // Emit Socket.IO event
        const io = req.app.get('io');
        io.to(sessionId).emit('queue-update', {
            bulkUpdate: true,
            count: updates.length
        });
        
        res.json({ success: true, updated: updates.length });
    } catch (error) {
        console.error('Error bulk updating questions:', error);
        res.status(500).json({ error: 'Failed to bulk update questions' });
    }
});

module.exports = router;
