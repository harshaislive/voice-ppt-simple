const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const ttsService = require('../services/tts');
const modelService = require('../services/model');
const questionClassifier = require('../services/questionClassifier');
const slideEngine = require('../services/slideEngine');
const realtimePresenter = require('../services/realtimePresenter');
const analyticsService = require('../services/analytics');
const { requireSessionControl } = require('../middleware/security');

const interruptFlags = new Map();
const pauseFlags = new Map();
const playbackWaiters = new Map();
const continueWaiters = new Map();
const presentationStartTimes = new Map();

const PRESENTATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [sessionId, startTime] of presentationStartTimes.entries()) {
        if (now - startTime > PRESENTATION_TIMEOUT_MS) {
            const io = global.autoplexIo;
            if (io) {
                io.to(sessionId).emit('presentation-error', { error: 'Presentation timed out after 2 hours' });
                io.to(sessionId).emit('presentation-end', { totalSlides: 0, totalQuestionsAnswered: 0 });
            }
            presentationStartTimes.delete(sessionId);
            interruptFlags.delete(sessionId);
            pauseFlags.delete(sessionId);
        }
    }
}, 5 * 60 * 1000);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function markInterrupted(sessionId) {
    interruptFlags.set(sessionId, Date.now());
}

function clearInterrupt(sessionId) {
    interruptFlags.delete(sessionId);
}

function isInterrupted(sessionId) {
    return interruptFlags.has(sessionId);
}

function setPaused(sessionId, paused) {
    if (paused) {
        pauseFlags.set(sessionId, true);
    } else {
        pauseFlags.delete(sessionId);
    }
}

function isPaused(sessionId) {
    return pauseFlags.has(sessionId);
}

function hasRenderableAudio(result) {
    return Boolean(result && Number(result.totalPcmBytes || 0) > 0);
}

function waitForPlaybackCompletion(sessionId, fallbackMs) {
    return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                playbackWaiters.delete(sessionId);
                resolve(false);
            }
        }, Math.max(fallbackMs || 0, 1500));

        playbackWaiters.set(sessionId, () => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                playbackWaiters.delete(sessionId);
                resolve(true);
            }
        });
    });
}

function markPlaybackComplete(sessionId) {
    const waiter = playbackWaiters.get(sessionId);
    if (waiter) {
        waiter();
    }
}

function waitForContinue(sessionId, io, payload = {}) {
    return new Promise((resolve) => {
        continueWaiters.set(sessionId, () => {
            continueWaiters.delete(sessionId);
            resolve(true);
        });

        io.to(sessionId).emit('slide-turn-ready', payload);
    });
}

function markContinue(sessionId) {
    const waiter = continueWaiters.get(sessionId);
    if (waiter) {
        waiter();
    }
}

function getParticipantName(db, sessionId) {
    return getSessionMetadata(db, sessionId).participantName || '';
}

function getSessionMetadata(db, sessionId) {
    const row = db.get('SELECT metadata FROM sessions WHERE id = ?', [sessionId]);
    if (!row?.metadata) {
        return {};
    }

    try {
        return JSON.parse(row.metadata);
    } catch {
        return {};
    }
}

function buildKnowledgeContext(metadata = {}) {
    const sections = [];
    const knowledgeDocs = metadata.knowledgeDocs || {};

    // 1. Load the global Agent Framework (Constitution) from root
    try {
        const frameworkPath = path.join(__dirname, '..', '..', 'AGENTS.md');
        if (fs.existsSync(frameworkPath)) {
            const framework = fs.readFileSync(frameworkPath, 'utf8');
            sections.push(`AGENT FRAMEWORK / CONSTITUTION:\n${framework}`);
        }
    } catch (err) {
        console.error('Failed to read global AGENTS.md:', err.message);
    }

    if (knowledgeDocs.soul) {
        sections.push(`PROJECT SOUL: ${stringifyDoc(knowledgeDocs.soul)}`);
    }
    if (knowledgeDocs.agents) {
        sections.push(`PROJECT RULES: ${stringifyDoc(knowledgeDocs.agents)}`);
    }
    if (knowledgeDocs.product) {
        sections.push(`PRODUCT: ${stringifyDoc(knowledgeDocs.product)}`);
    }
    if (knowledgeDocs.flow) {
        sections.push(`FLOW: ${stringifyDoc(knowledgeDocs.flow)}`);
    }
    if (knowledgeDocs.design) {
        sections.push(`DESIGN: ${stringifyDoc(knowledgeDocs.design)}`);
    }
    if (knowledgeDocs.cta) {
        sections.push(`CTA: ${stringifyDoc(knowledgeDocs.cta)}`);
    }

    return sections.join('\n\n').slice(0, 4000);
}

function stringifyDoc(value) {
    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

router.post('/', requireSessionControl(), async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    const db = req.app.get('db');
    const io = req.app.get('io');

    clearInterrupt(sessionId);
    res.json({ success: true, message: 'Auto-presentation started' });

    global.autoplexIo = io;
    try {
        await runPresentation(db, io, sessionId);
    } catch (err) {
        console.error('Auto-present error:', err);
        io.to(sessionId).emit('presentation-error', { error: err.message });
    } finally {
        clearInterrupt(sessionId);
        presentationStartTimes.delete(sessionId);
    }
});

router.post('/interrupt', requireSessionControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    markInterrupted(sessionId);
    res.json({ success: true, interrupted: true });
});

router.post('/pause', requireSessionControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    setPaused(sessionId, true);
    res.json({ success: true, paused: true });
});

router.post('/resume', requireSessionControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    clearInterrupt(sessionId);
    setPaused(sessionId, false);
    res.json({ success: true, paused: false });
});

router.post('/continue', requireSessionControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    clearInterrupt(sessionId);
    markContinue(sessionId);
    res.json({ success: true, continued: true });
});

async function runPresentation(db, io, sessionId) {
    const session = db.get('SELECT * FROM sessions WHERE id = ? AND status IN (\'active\', \'presenting\')', [sessionId]);
    if (!session) {
        io.to(sessionId).emit('presentation-error', { error: 'Session not found' });
        return;
    }
    presentationStartTimes.set(sessionId, Date.now());
    const participantName = getParticipantName(db, sessionId);

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

    await sleep(180);

    let currentSlideIndex = 0;

    while (currentSlideIndex < slides.length) {
        await waitWhilePaused(db, io, sessionId);
        const slide = slides[currentSlideIndex];

        db.run('UPDATE sessions SET current_slide_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [currentSlideIndex, sessionId]);

        io.to(sessionId).emit('slide-change', {
            slideIndex: currentSlideIndex,
            totalSlides: slides.length,
            slide: { title: slide.title, content: slide.content, image: slide.image, notes: slide.notes },
            reason: 'auto-advance'
        });

        await sleep(120);

        let updatedPendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
            [sessionId]
        );

        const narrationResult = await narrateSlide({
            db,
            io,
            sessionId,
            slide,
            slideIndex: currentSlideIndex,
            totalSlides: slides.length,
            pendingQuestions: updatedPendingQuestions.slice(0, 5).map((q) => q.question_text)
        });
        const narrationText = narrationResult.text;

        updatedPendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
            [sessionId]
        );

        await waitWhilePaused(db, io, sessionId);
        if (!narrationResult.audioHandled) {
            await streamAudio(io, sessionId, narrationText, currentSlideIndex, { isQA: false });
        }

        analyticsService.logEvent(sessionId, 'ai_narration', currentSlideIndex, narrationText);

        db.run(
            'INSERT INTO events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [sessionId, 'narration_generated', JSON.stringify({ slideIndex: currentSlideIndex, narrationLength: narrationText.length })]
        );

        await sleep(900);

        await waitForContinue(sessionId, io, {
            slideIndex: currentSlideIndex,
            totalSlides: slides.length,
            slide: { title: slide.title, content: slide.content, image: slide.image, notes: slide.notes },
            pendingQuestionCount: updatedPendingQuestions.length
        });

        updatedPendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
            [sessionId]
        );

        currentSlideIndex += 1;
    }

    await runWrapUp(db, io, sessionId, session.deck_id, participantName);

    const allQuestions = db.all(
        'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
        [sessionId]
    );

    if (allQuestions.length > 0) {
        io.to(sessionId).emit('qa-start', { totalQuestions: allQuestions.length });
        await sleep(180);

        for (let q = 0; q < allQuestions.length; q++) {
            await waitWhilePaused(db, io, sessionId);
            const question = allQuestions[q];

            io.to(sessionId).emit('answering-question', {
                questionIndex: q + 1,
                totalQuestions: allQuestions.length,
                question: question.question_text
            });

            await sleep(120);

            let answer = '';
            try {
                if (realtimePresenter.isConfigured()) {
                    const realtimeResult = await realtimePresenter.generateNarrationAudio({
                        slideTitle: 'Audience Question',
                        slideContent: question.question_text,
                        slideNotes: 'Answer this question concisely, warmly, honestly, and like a real presenter speaking directly to one person in the room.',
                        pendingQuestions: [],
                        audienceContext: {},
                        participantName,
                        slideIndex: slides.length + q,
                        totalSlides: slides.length + allQuestions.length,
                        style: 'conversational'
                    }, {
                        onTranscriptDelta: (delta, full) => {
                            io.to(sessionId).emit('answer-delta', {
                                questionId: question.id,
                                delta,
                                full,
                                questionIndex: q + 1,
                                totalQuestions: allQuestions.length
                            });
                        },
                        onAudioChunk: (chunk) => {
                            io.to(sessionId).emit('audio-chunk', {
                                chunk: chunk.toString('base64'),
                                slideIndex: slides.length + q,
                                sampleRate: 24000,
                                channels: 1,
                                bitsPerSample: 16,
                                isQA: true,
                                questionIndex: q + 1
                            });
                        }
                    });
                    answer = realtimeResult.transcript || question.question_text;
                    if (hasRenderableAudio(realtimeResult)) {
                        io.to(sessionId).emit('audio-end', {
                            slideIndex: slides.length + q,
                            format: 'wav',
                            isQA: true,
                            questionIndex: q + 1
                        });
                        const answerDurationSec = realtimeResult.totalPcmBytes / (24000 * 2);
                        await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(answerDurationSec * 1000) + 1800, 2500));
                    } else {
                        console.warn('Realtime presenter returned no audio for queued QA; falling back to TTS stream');
                    }
                } else {
                    answer = await modelService.generateNarrationStream({
                        slideTitle: 'Audience Question',
                        slideContent: question.question_text,
                        slideNotes: 'Answer this question concisely, warmly, and like a real presenter speaking directly to one person in the room.',
                        pendingQuestions: [],
                        participantName,
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
                }
            } catch (err) {
                answer = 'Thank you. Let me answer that directly. The short version is that it depends on context, and I would rather be precise than pretend certainty.';
            }

            io.to(sessionId).emit('answer-text', {
                questionId: question.id,
                question: question.question_text,
                answer,
                questionIndex: q + 1,
                totalQuestions: allQuestions.length
            });

            analyticsService.logEvent(sessionId, 'ai_answer', slides.length + q, answer, { questionId: question.id, questionText: question.question_text });

            if (!realtimePresenter.isConfigured()) {
                await streamAudio(io, sessionId, answer, slides.length + q, {
                    isQA: true,
                    questionIndex: q + 1
                });
            }

            db.run('UPDATE questions SET status = \'answered\', answered_at = CURRENT_TIMESTAMP, answer_text = ? WHERE id = ?', [answer, question.id]);
            io.to(sessionId).emit('queue-update', {
                questionId: question.id,
                status: 'answered'
            });

            await sleep(320);
        }

        io.to(sessionId).emit('qa-end', { totalAnswered: allQuestions.length });
    }

    db.run('UPDATE sessions SET status = \'completed\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);
    setPaused(sessionId, false);

    const questionsAsked = db.get('SELECT COUNT(*) as c FROM questions WHERE session_id = ?', [sessionId])?.c || 0;
    analyticsService.logSessionEnd(sessionId, questionsAsked);

    io.to(sessionId).emit('presentation-end', {
        totalSlides: slides.length,
        totalQuestionsAnswered: allQuestions.length
    });
}

async function runWrapUp(db, io, sessionId, deckId, participantName) {
    const mcqs = buildWrapUpMcqs(deckId);
    const durationMs = 60000;
    const deadline = Date.now() + durationMs;
    const promptText = [
        participantName ? `${participantName}, that brings us to the end of the deck.` : 'That brings us to the end of the deck.',
        'I will stay with you for one more minute.',
        'If you want to ask anything live, hit the mic icon at the bottom.',
        'You can also answer the quick prompts on screen while you think about your questions.'
    ].join(' ');

    const audienceMemory = db.all(
        'SELECT key, value FROM audience_memory WHERE session_id = ? ORDER BY updated_at DESC LIMIT 8',
        [sessionId]
    ).reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});

    db.run('UPDATE sessions SET status = \'wrapup\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);

    io.to(sessionId).emit('presentation-wrapup', {
        endsAt: deadline,
        durationMs,
        promptText,
        mcqs
    });

    io.to(sessionId).emit('narration-text', {
        text: promptText,
        slideIndex: -1,
        isWrapUp: true
    });

    if (realtimePresenter.isConfigured()) {
        try {
            const result = await realtimePresenter.generateNarrationAudio({
                slideTitle: 'Wrap Up',
                slideContent: promptText,
                slideNotes: 'Invite the attendee to ask questions using the mic icon. Sound calm, warm, and clearly indicate they have one minute.',
                pendingQuestions: [],
                audienceContext: audienceMemory,
                participantName,
                slideIndex: 0,
                totalSlides: 1,
                style: 'conversational'
            }, {
                onTranscriptDelta: (delta, full) => {
                    io.to(sessionId).emit('narration-delta', {
                        delta,
                        full,
                        slideIndex: -1,
                        isWrapUp: true
                    });
                },
                onAudioChunk: (chunk) => {
                    io.to(sessionId).emit('audio-chunk', {
                        chunk: chunk.toString('base64'),
                        slideIndex: -1,
                        sampleRate: 24000,
                        channels: 1,
                        bitsPerSample: 16,
                        isWrapUp: true
                    });
                }
            });
            if (hasRenderableAudio(result)) {
                io.to(sessionId).emit('audio-end', {
                    slideIndex: -1,
                    format: 'wav',
                    isWrapUp: true
                });
                const durationFromAudio = result.totalPcmBytes / (24000 * 2);
                await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(durationFromAudio * 1000) + 2000, 3000));
            } else {
                console.warn('Realtime presenter returned no audio for wrap-up; falling back to TTS stream');
                await streamAudio(io, sessionId, promptText, -1, { isWrapUp: true });
            }
        } catch (error) {
            await streamAudio(io, sessionId, promptText, -1, { isWrapUp: true });
        }
    } else {
        await streamAudio(io, sessionId, promptText, -1, { isWrapUp: true });
    }

    while (Date.now() < deadline) {
        await waitWhilePaused(db, io, sessionId);
        await sleep(250);
    }

    io.to(sessionId).emit('presentation-wrapup-ended', {
        endedAt: Date.now()
    });
}

function buildWrapUpMcqs(deckId) {
    const shared = [
        {
            id: 'confidence',
            prompt: 'How clear does the core idea feel now?',
            options: ['Very clear', 'Mostly clear', 'Still fuzzy']
        },
        {
            id: 'next_step',
            prompt: 'What do you want to explore next?',
            options: ['Market opportunity', 'Business model', 'Execution plan', 'Risks']
        },
        {
            id: 'action',
            prompt: 'What is your likely next move after this?',
            options: ['Ask follow-up questions', 'Review the deck again', 'Discuss with team', 'Pass for now']
        }
    ];

    if (deckId === 'ten_percent_club') {
        return [
            {
                id: 'resonance',
                prompt: 'What resonated most in the 10% Club story?',
                options: ['The mission', 'The member experience', 'The growth angle', 'The community angle']
            },
            ...shared
        ];
    }

    return [
        {
            id: 'resonance',
            prompt: 'What resonated most in this deck?',
            options: ['The vision', 'The problem framing', 'The solution', 'The traction']
        },
        ...shared
    ];
}

async function applyQuestionClassification(db, sessionId, pendingQuestions, classificationResults) {
    if (!pendingQuestions.length || !classificationResults.length) {
        return;
    }

    db.run('BEGIN TRANSACTION');

    try {
        classificationResults.forEach((result, index) => {
            const question = pendingQuestions[index];
            if (!question) {
                return;
            }

            db.run('UPDATE questions SET priority = ? WHERE id = ?', [result.priority || 0, question.id]);
        });
        db.run('COMMIT');
    } catch (error) {
        db.run('ROLLBACK');
        throw error;
    }

    db.run(
        'INSERT INTO events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [sessionId, 'questions_classified', JSON.stringify({ count: classificationResults.length })]
    );
}

async function narrateSlide({ db, io, sessionId, slide, slideIndex, totalSlides, pendingQuestions }) {
    const sessionMetadata = getSessionMetadata(db, sessionId);
    const participantName = getParticipantName(db, sessionId);
    const knowledgeContext = buildKnowledgeContext(sessionMetadata);
    const audienceMemory = db.all(
        'SELECT key, value FROM audience_memory WHERE session_id = ? ORDER BY updated_at DESC LIMIT 8',
        [sessionId]
    ).reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});

    let narrationText = '';

    try {
        narrationText = await modelService.generateNarrationStream({
            slideTitle: slide.title,
            slideContent: slide.content,
            slideNotes: slide.notes,
            pendingQuestions,
            audienceContext: audienceMemory,
            participantName,
            knowledgeContext,
            slideIndex,
            totalSlides,
            style: slideIndex === 0 ? 'hook' : slideIndex === totalSlides - 1 ? 'closer' : 'conversational'
        }, (delta, full) => {
            if (isInterrupted(sessionId)) {
                return;
            }
            io.to(sessionId).emit('narration-delta', {
                delta,
                full,
                slideIndex
            });
        });
    } catch (err) {
        console.error('Narration stream failed for slide', slideIndex, err);
        narrationText = slide.content;
        io.to(sessionId).emit('narration-delta', { delta: narrationText, full: narrationText, slideIndex });
    }

    if (!isInterrupted(sessionId)) {
        io.to(sessionId).emit('narration-text', {
            text: narrationText,
            slideIndex
        });
    }

    db.run(
        'INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [sessionId, `last_narration_${slideIndex}`, narrationText, 0.9]
    );

    await sleep(80);
    return { text: narrationText, audioHandled: false };
}

async function streamAudio(io, sessionId, text, slideIndex, options = {}) {
    try {
        let totalPcmBytes = 0;

        await ttsService.synthesizeStream(text, 'default', (pcmChunk) => {
            if (isInterrupted(sessionId)) {
                return;
            }

            totalPcmBytes += pcmChunk.length;
            io.to(sessionId).emit('audio-chunk', {
                chunk: pcmChunk.toString('base64'),
                slideIndex,
                sampleRate: 24000,
                channels: 1,
                bitsPerSample: 16,
                ...options
            });
        });

        io.to(sessionId).emit('audio-end', {
            slideIndex,
            format: 'wav',
            ...options
        });

        const audioDurationSec = totalPcmBytes / (24000 * 2);
        const waitMs = Math.max(Math.ceil(audioDurationSec * 1000) + (options.isQA ? 2200 : 2000), options.isQA ? 2600 : 2400);
        await waitForPlaybackCompletion(sessionId, waitMs);
    } catch (err) {
        console.error('TTS stream failed for slide', slideIndex, err);
        io.to(sessionId).emit('audio-end', {
            slideIndex,
            format: 'wav',
            ...options
        });
        await sleep(options.isQA ? 700 : 500);
    }
}

async function answerQuestionsInline({ db, io, sessionId, slides, currentSlideIndex, questionIds }) {
    if (!questionIds || questionIds.length === 0) {
        return;
    }

    const placeholders = questionIds.map(() => '?').join(', ');
    const questions = db.all(
        `SELECT * FROM questions WHERE session_id = ? AND status = 'pending' AND id IN (${placeholders}) ORDER BY priority DESC, created_at ASC`,
        [sessionId, ...questionIds]
    );

    if (!questions.length) {
        return;
    }

    io.to(sessionId).emit('qa-start', { totalQuestions: questions.length, inline: true });
    await sleep(120);
    const sessionMetadata = getSessionMetadata(db, sessionId);
    const participantName = getParticipantName(db, sessionId);
    const knowledgeContext = buildKnowledgeContext(sessionMetadata);

    const audienceMemory = db.all(
        'SELECT key, value FROM audience_memory WHERE session_id = ? ORDER BY updated_at DESC LIMIT 8',
        [sessionId]
    ).reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});

    for (let q = 0; q < questions.length; q++) {
        const question = questions[q];
        const currentSlide = slides[currentSlideIndex];

        io.to(sessionId).emit('answering-question', {
            questionIndex: q + 1,
            totalQuestions: questions.length,
            question: question.question_text,
            inline: true
        });

        await sleep(100);

        let answer = '';
        try {
            if (realtimePresenter.isConfigured()) {
                const realtimeResult = await realtimePresenter.generateNarrationAudio({
                    slideTitle: 'Audience Question',
                    slideContent: question.question_text,
                    slideNotes: [
                        `You are answering a typed audience question immediately after slide ${currentSlideIndex + 1}.`,
                        currentSlide ? `Current slide title: ${currentSlide.title}.` : '',
                        currentSlide ? `Current slide visible text: ${currentSlide.content}.` : '',
                        currentSlide?.notes ? `Presenter notes: ${currentSlide.notes}.` : '',
                        'Answer only from this deck context. If the deck does not contain the answer, say that clearly and do not invent details.'
                    ].filter(Boolean).join(' '),
                    pendingQuestions: [],
                    audienceContext: audienceMemory,
                    participantName,
                    knowledgeContext,
                    slideIndex: slides.length + q,
                    totalSlides: slides.length + questions.length,
                    style: 'conversational'
                }, {
                    onTranscriptDelta: (delta, full) => {
                        io.to(sessionId).emit('answer-delta', {
                            questionId: question.id,
                            delta,
                            full,
                            questionIndex: q + 1,
                            totalQuestions: questions.length
                        });
                    },
                    onAudioChunk: (chunk) => {
                        io.to(sessionId).emit('audio-chunk', {
                            chunk: chunk.toString('base64'),
                            slideIndex: slides.length + q,
                            sampleRate: 24000,
                            channels: 1,
                            bitsPerSample: 16,
                            isQA: true,
                            questionIndex: q + 1
                        });
                    }
                });
                answer = realtimeResult.transcript || question.question_text;
                if (hasRenderableAudio(realtimeResult)) {
                    io.to(sessionId).emit('audio-end', {
                        slideIndex: slides.length + q,
                        format: 'wav',
                        isQA: true,
                        questionIndex: q + 1
                    });
                    const answerDurationSec = realtimeResult.totalPcmBytes / (24000 * 2);
                    await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(answerDurationSec * 1000) + 1800, 2400));
                } else {
                    console.warn('Realtime presenter returned no audio for inline QA; falling back to TTS stream');
                }
            } else {
                answer = await modelService.generateNarrationStream({
                    slideTitle: 'Audience Question',
                    slideContent: question.question_text,
                    slideNotes: [
                        `You are answering a typed audience question immediately after slide ${currentSlideIndex + 1}.`,
                        currentSlide ? `Current slide title: ${currentSlide.title}.` : '',
                        currentSlide ? `Current slide visible text: ${currentSlide.content}.` : '',
                        currentSlide?.notes ? `Presenter notes: ${currentSlide.notes}.` : '',
                        'Answer only from this deck context. If the deck does not contain the answer, say that clearly and do not invent details.'
                    ].filter(Boolean).join(' '),
                    pendingQuestions: [],
                    audienceContext: audienceMemory,
                    participantName,
                    knowledgeContext,
                    slideIndex: slides.length + q,
                    totalSlides: slides.length + questions.length,
                    style: 'conversational'
                }, (delta, full) => {
                    io.to(sessionId).emit('answer-delta', {
                        questionId: question.id,
                        delta,
                        full,
                        questionIndex: q + 1,
                        totalQuestions: questions.length
                    });
                });
            }
        } catch (err) {
            answer = 'That is a fair question. The short answer is yes, but the nuance depends on your context and what outcome you care about most.';
        }

        io.to(sessionId).emit('answer-text', {
            questionId: question.id,
            question: question.question_text,
            answer,
            questionIndex: q + 1,
            totalQuestions: questions.length
        });

        analyticsService.logEvent(sessionId, 'ai_answer', slides.length + q, answer, { questionId: question.id, questionText: question.question_text, isInterrupt: true });

        if (!realtimePresenter.isConfigured()) {
            await streamAudio(io, sessionId, answer, slides.length + q, {
                isQA: true,
                questionIndex: q + 1
            });
        }

        db.run(
            'UPDATE questions SET status = \'answered\', answered_at = CURRENT_TIMESTAMP, answer_text = ? WHERE id = ?',
            [answer, question.id]
        );

        db.run(
            'INSERT INTO events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [sessionId, 'question_answered_inline', JSON.stringify({ questionId: question.id, slideIndex: currentSlideIndex })]
        );

        io.to(sessionId).emit('queue-update', {
            questionId: question.id,
            status: 'answered'
        });

        await sleep(160);
    }

    io.to(sessionId).emit('qa-end', { totalAnswered: questions.length, inline: true });
}

module.exports = router;
module.exports.markPlaybackComplete = markPlaybackComplete;

async function waitWhilePaused(db, io, sessionId) {
    let emitted = false;
    while (isPaused(sessionId)) {
        if (!emitted) {
            io.to(sessionId).emit('presentation-paused', { sessionId });
            emitted = true;
        }
        db.run('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);
        await sleep(150);
    }

    if (emitted) {
        io.to(sessionId).emit('presentation-resumed', { sessionId });
    }
}
