const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const ttsService = require('../services/tts');
const modelService = require('../services/model');
const { requireSessionControl } = require('../middleware/security');

// Generate narration for current slide with progressive streaming
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

        // Emit narration-start immediately so UI can show "generating" state
        io.to(sessionId).emit('narration-start', {
            slideIndex: session.current_slide_index,
            slideTitle: session.slide_title
        });

        // Stream narration text chunks progressively so user sees text immediately
        // This is non-blocking - we emit deltas as they arrive from the AI
        // Note: generateNarrationStream returns parsed text, callback receives raw streaming deltas
        const parsedNarrationText = await modelService.generateNarrationStream(context, (delta, partial) => {
            io.to(sessionId).emit('narration-delta', {
                delta,
                partial,
                slideIndex: session.current_slide_index
            });
        });

        // Use the parsed narration text for TTS and storage
        const fullNarrationText = parsedNarrationText;

        // AI narration is complete - emit full text event
        io.to(sessionId).emit('narration-text', {
            text: fullNarrationText,
            slideIndex: session.current_slide_index
        });

        // Store narration in memory
        db.run(`
            INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [sessionId, `last_narration_${session.current_slide_index}`, fullNarrationText, 0.9]);

        // Emit TTS start event so UI can show audio is being generated
        io.to(sessionId).emit('tts-start', {
            slideIndex: session.current_slide_index
        });

        // Fire TTS synthesis in background - don't await for HTTP response
        // This lets us return to client faster while audio streams via socket.io
        ttsService.synthesizeStream(
            fullNarrationText,
            'default',
            (chunk, meta) => {
                io.to(sessionId).emit('audio-chunk', {
                    chunk: chunk.toString('base64'),
                    format: 'pcm',
                    sampleRate: meta?.sampleRate || 24000,
                    channels: meta?.channels || 1,
                    bitsPerSample: meta?.bitsPerSample || 16,
                    slideIndex: session.current_slide_index
                });
            }
        ).then(() => {
            // TTS streaming complete - emit final event
            io.to(sessionId).emit('tts-complete', {
                slideIndex: session.current_slide_index
            });
            db.run(`
                INSERT INTO events (session_id, event_type, event_data, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [sessionId, 'narration_generated', JSON.stringify({
                slideIndex: session.current_slide_index,
                narrationLength: fullNarrationText.length
            })]);
        }).catch((ttsError) => {
            console.error('TTS generation failed:', ttsError);
            io.to(sessionId).emit('tts-error', {
                slideIndex: session.current_slide_index,
                error: 'Audio generation failed'
            });
        });

        // Return immediately after text is ready - TTS streams in background via socket.io
        res.json({
            success: true,
            narration: fullNarrationText,
            slideIndex: session.current_slide_index
        });
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
