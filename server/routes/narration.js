const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const ttsService = require('../services/tts');
const modelService = require('../services/model');
const { requireSessionControl } = require('../middleware/security');

// Generate narration for current slide
router.post('/', requireSessionControl(), async (req, res) => {
    try {
        const { sessionId, style = 'professional', regenerate = false } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        
        const db = req.app.get('db');
        const io = req.app.get('io');
        
        // Get session and current slide
        const session = db.get(`
            SELECT s.*, sl.title as slide_title, sl.content as slide_content, sl.notes as slide_notes, sl.custom_prompt as slide_custom_prompt
            FROM sessions s
            LEFT JOIN slides sl ON sl.session_id = s.id AND sl.slide_index = s.current_slide_index
            WHERE s.id = ? AND s.status = 'active'
        `, [sessionId]);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found or not active' });
        }
        
        if (!session.slide_content) {
            return res.status(400).json({ error: 'No slide content available' });
        }
        
        // Get pending questions for context
        const pendingQuestions = db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 3
        `, [sessionId]);
        
        // Get audience memory
        const audienceMemory = db.all(`
            SELECT key, value FROM audience_memory
            WHERE session_id = ?
            ORDER BY confidence DESC, updated_at DESC
            LIMIT 10
        `, [sessionId]);
        
        // Prepare context for narration generation
        const context = {
            slideTitle: session.slide_title,
            slideContent: session.slide_content,
            slideNotes: session.slide_notes,
            customPrompt: session.slide_custom_prompt,
            pendingQuestions: pendingQuestions.map(q => q.question_text),
            audienceContext: audienceMemory.reduce((acc, item) => {
                acc[item.key] = item.value;
                return acc;
            }, {}),
            style,
            slideIndex: session.current_slide_index
        };
        
        // Generate narration plan using model
        io.to(sessionId).emit('narration-start', {
            slideIndex: session.current_slide_index,
            slideTitle: session.slide_title
        });
        
        const narrationText = await modelService.generateNarration(context);
        
        // Emit narration text
        io.to(sessionId).emit('narration-text', {
            text: narrationText,
            slideIndex: session.current_slide_index
        });
        
        // Store narration in memory
        db.run(`
            INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [sessionId, `last_narration_${session.current_slide_index}`, narrationText, 0.9]);
        
        // Generate TTS audio
        try {
            const audioBuffer = await ttsService.synthesize(narrationText);
            
            // Emit audio stream (as base64 for simplicity)
            const audioBase64 = audioBuffer.toString('base64');
            io.to(sessionId).emit('audio-stream', {
                data: audioBase64,
                format: 'wav',
                slideIndex: session.current_slide_index
            });
            
            // Create event
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [sessionId, 'narration_generated', JSON.stringify({
                slideIndex: session.current_slide_index,
                narrationLength: narrationText.length,
                audioLength: audioBuffer.length
            })]);
            
            res.json({
                success: true,
                narration: narrationText,
                audioBase64,
                slideIndex: session.current_slide_index
            });
        } catch (ttsError) {
            console.error('TTS generation failed:', ttsError);
            
            // Still return narration text even if TTS fails
            res.json({
                success: true,
                narration: narrationText,
                slideIndex: session.current_slide_index,
                warning: 'Audio generation failed'
            });
        }
    } catch (error) {
        console.error('Error generating narration:', error);
        res.status(500).json({ error: 'Failed to generate narration' });
    }
});

// Get narration history
router.get('/:sessionId', requireSessionControl({ keys: ['sessionId'] }), (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 10 } = req.query;
        const db = req.app.get('db');
        
        const narrations = db.all(`
            SELECT * FROM audience_memory
            WHERE session_id = ? AND key LIKE 'last_narration_%'
            ORDER BY updated_at DESC
            LIMIT ?
        `, [sessionId, parseInt(limit)]);
        
        const formatted = narrations.map(item => ({
            slideIndex: parseInt(item.key.replace('last_narration_', '')),
            narration: item.value,
            confidence: item.confidence,
            timestamp: item.updated_at
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error('Error getting narrations:', error);
        res.status(500).json({ error: 'Failed to get narrations' });
    }
});

module.exports = router;
