const express = require('express');
const router = express.Router();
const ttsService = require('../services/tts');
const modelService = require('../services/model');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

router.post('/', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

    const db = req.app.get('db');
    const io = req.app.get('io');

    res.json({ success: true, message: 'Auto-presentation started' });

    try {
        await runPresentation(db, io, sessionId);
    } catch (err) {
        console.error('Auto-present error:', err);
        io.to(sessionId).emit('presentation-error', { error: err.message });
    }
});

async function runPresentation(db, io, sessionId) {
    const session = db.get('SELECT * FROM sessions WHERE id = ? AND status = \'active\'', [sessionId]);
    if (!session) {
        io.to(sessionId).emit('presentation-error', { error: 'Session not found' });
        return;
    }

    const slides = db.all('SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC', [sessionId]);
    if (!slides.length) {
        io.to(sessionId).emit('presentation-error', { error: 'No slides found' });
        return;
    }

    db.run('UPDATE sessions SET status = \'presenting\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);

    io.to(sessionId).emit('presentation-start', {
        totalSlides: slides.length,
        deckTitle: session.deck_id
    });

    await sleep(500);

    for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];

        db.run('UPDATE sessions SET current_slide_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [i, sessionId]);

        io.to(sessionId).emit('slide-change', {
            slideIndex: i,
            totalSlides: slides.length,
            slide: { title: slide.title, content: slide.content, image: slide.image, notes: slide.notes },
            reason: 'auto-advance'
        });

        await sleep(300);

        const pendingQuestions = db.all(
            'SELECT question_text FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY created_at ASC LIMIT 5',
            [sessionId]
        ).map(r => r.question_text);

        let narrationText = '';
        try {
            narrationText = await modelService.generateNarrationStream({
                slideTitle: slide.title,
                slideContent: slide.content,
                slideNotes: slide.notes,
                pendingQuestions,
                slideIndex: i,
                totalSlides: slides.length,
                style: i === 0 ? 'hook' : i === slides.length - 1 ? 'closer' : 'professional'
            }, (delta, full) => {
                io.to(sessionId).emit('narration-delta', {
                    delta,
                    full,
                    slideIndex: i
                });
            });
        } catch (err) {
            console.error('Narration stream failed for slide', i, err);
            narrationText = slide.content;
            io.to(sessionId).emit('narration-delta', { delta: narrationText, full: narrationText, slideIndex: i });
        }

        io.to(sessionId).emit('narration-text', {
            text: narrationText,
            slideIndex: i
        });

        db.run(
            'INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
            [sessionId, 'last_narration_' + i, narrationText, 0.9]
        );

        await sleep(200);

        try {
            let totalPcmBytes = 0;
            const wav = await ttsService.synthesizeStream(narrationText, 'default', (pcmChunk) => {
                totalPcmBytes += pcmChunk.length;
                io.to(sessionId).emit('audio-chunk', {
                    chunk: pcmChunk.toString('base64'),
                    slideIndex: i,
                    sampleRate: 24000,
                    channels: 1,
                    bitsPerSample: 16
                });
            });
            io.to(sessionId).emit('audio-end', {
                slideIndex: i,
                format: 'wav'
            });
            const audioDurationSec = totalPcmBytes / (24000 * 2);
            const waitMs = Math.max(Math.ceil(audioDurationSec * 1000) + 500, 2000);
            await sleep(waitMs);
        } catch (err) {
            console.error('TTS stream failed for slide', i, err);
            const placeholder = ttsService.generatePlaceholderWav(narrationText);
            io.to(sessionId).emit('audio-end', {
                slideIndex: i,
                format: 'wav'
            });
            await sleep(3000);
        }

        db.run(
            'INSERT INTO events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [sessionId, 'narration_generated', JSON.stringify({ slideIndex: i, narrationLength: narrationText.length })]
        );
    }

    const allQuestions = db.all(
        'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY created_at ASC',
        [sessionId]
    );

    if (allQuestions.length > 0) {
        io.to(sessionId).emit('qa-start', { totalQuestions: allQuestions.length });
        await sleep(400);

        for (let q = 0; q < allQuestions.length; q++) {
            const question = allQuestions[q];

            io.to(sessionId).emit('answering-question', {
                questionIndex: q + 1,
                totalQuestions: allQuestions.length,
                question: question.question_text
            });

            await sleep(200);

            let answer = '';
            try {
                answer = await modelService.generateNarrationStream({
                    slideTitle: 'Audience Question',
                    slideContent: question.question_text,
                    slideNotes: 'Answer this question concisely and helpfully, as if you are the presenter addressing the audience member directly.',
                    pendingQuestions: [],
                    slideIndex: slides.length + q,
                    totalSlides: slides.length + allQuestions.length,
                    style: 'conversational'
                }, (delta, full) => {
                    io.to(sessionId).emit('answer-delta', {
                        questionId: question.id,
                        delta,
                        full,
                        questionIndex: q + 1,
                        totalQuestions: allQuestions.length
                    });
                });
            } catch (err) {
                answer = 'Thank you for that question. I\'ll address it in more detail after the session.';
            }

            io.to(sessionId).emit('answer-text', {
                questionId: question.id,
                question: question.question_text,
                answer,
                questionIndex: q + 1,
                totalQuestions: allQuestions.length
            });

            try {
                let totalPcmBytes = 0;
                const answerWav = await ttsService.synthesizeStream(answer, 'default', (pcmChunk) => {
                    totalPcmBytes += pcmChunk.length;
                    io.to(sessionId).emit('audio-chunk', {
                        chunk: pcmChunk.toString('base64'),
                        slideIndex: slides.length + q,
                        sampleRate: 24000,
                        channels: 1,
                        bitsPerSample: 16,
                        isQA: true,
                        questionIndex: q + 1
                    });
                });
                io.to(sessionId).emit('audio-end', {
                    slideIndex: slides.length + q,
                    format: 'wav',
                    isQA: true,
                    questionIndex: q + 1
                });
                const answerDurationSec = totalPcmBytes / (24000 * 2);
                await sleep(Math.max(Math.ceil(answerDurationSec * 1000) + 500, 1500));
            } catch (err) {
                console.error('TTS stream failed for QA', q, err);
                io.to(sessionId).emit('audio-end', {
                    slideIndex: slides.length + q,
                    format: 'wav',
                    isQA: true,
                    questionIndex: q + 1
                });
                await sleep(1500);
            }

            db.run('UPDATE questions SET status = \'answered\', answered_at = CURRENT_TIMESTAMP, answer_text = ? WHERE id = ?', [answer, question.id]);

            await sleep(1500);
        }

        io.to(sessionId).emit('qa-end', { totalAnswered: allQuestions.length });
    }

    db.run('UPDATE sessions SET status = \'completed\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);

    io.to(sessionId).emit('presentation-end', {
        totalSlides: slides.length,
        totalQuestionsAnswered: allQuestions ? allQuestions.length : 0
    });
}

module.exports = router;