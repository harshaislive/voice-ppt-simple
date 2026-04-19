const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const analyticsService = require('../services/analytics');
const ttsService = require('../services/tts');
const cmsService = require('../services/cms');
const supabaseSession = require('../services/supabaseSession');
const { getRequestLogger } = require('../middleware/logger');
const {
    extractSessionControlToken,
    hasValidSessionControlAsync,
    requireSessionControl
} = require('../middleware/security');

const GENERATED_QA_DIR = path.join(__dirname, '..', '..', 'public', 'generated', 'qa');

function buildAnswerMeta(questionText, answerText) {
    const trimmedAnswer = String(answerText || '').trim();
    const summary = trimmedAnswer.length > 220 ? `${trimmedAnswer.slice(0, 217).trimEnd()}...` : trimmedAnswer;

    return {
        answerTitle: 'Answer',
        answerSummary: summary,
        answerDetails: trimmedAnswer,
        metadataJson: {
            question_length: String(questionText || '').trim().length,
            answer_length: trimmedAnswer.length
        }
    };
}

function stringifyDoc(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function buildQuestionKnowledgeContext({ sessionMetadata = {}, presentation = null, currentSlide = null, slides = [] } = {}) {
    const sections = [];
    const sessionDocs = sessionMetadata.knowledgeDocs || {};
    const presentationDocs = presentation?.knowledgeDocs || {};
    const docs = { ...presentationDocs, ...sessionDocs };

    sections.push(`GROUNDING RULES:
- Treat the current slide as the primary source of truth.
- Use supporting project knowledge only when it directly answers the question.
- If the answer is not supported by the current slide or supporting project knowledge, say so naturally and do not invent details.`);

    if (currentSlide) {
        sections.push(`CURRENT SLIDE (PRIMARY SOURCE):\nTitle: ${currentSlide.title || ''}\nVisible text: ${currentSlide.content || ''}${currentSlide.notes ? `\nPresenter notes: ${currentSlide.notes}` : ''}`);
    }

    const supportingSections = [];
    if (docs.product) supportingSections.push(`PRODUCT KNOWLEDGE:\n${stringifyDoc(docs.product)}`);
    if (docs.cta) supportingSections.push(`CALL TO ACTION:\n${stringifyDoc(docs.cta)}`);
    if (docs.agents) supportingSections.push(`PROJECT RULES:\n${stringifyDoc(docs.agents)}`);
    if (docs.flow) supportingSections.push(`PRESENTATION FLOW:\n${stringifyDoc(docs.flow)}`);
    if (docs.soul) supportingSections.push(`PROJECT SOUL:\n${stringifyDoc(docs.soul)}`);
    if (docs.design) supportingSections.push(`DESIGN CONTEXT:\n${stringifyDoc(docs.design)}`);

    if (supportingSections.length > 0) {
        sections.push(`SUPPORTING PROJECT KNOWLEDGE:\n${supportingSections.join('\n\n')}`);
    }

    if (slides.length > 0) {
        sections.push(`PRESENTATION MAP:\n${slides.map((slide, index) => `Slide ${index + 1}: "${slide.title || ''}"`).join('\n')}`);
    }

    return sections.join('\n\n').slice(0, 16000);
}

function buildPilotQuestionPolicy({ currentSlideIndex = 0, totalSlides = 0 } = {}) {
    const slideNumber = Number(currentSlideIndex || 0) + 1;
    const allowLinks = slideNumber >= 9 || slideNumber >= Math.max(1, totalSlides);

    if (allowLinks) {
        return `PILOT Q&A POLICY:
- You know the viewer is near the close of the presentation.
- Answer with the same assertive, authoritative, approachable tone as the slides.
- If next-step intent is clear, you may offer the trial stay naturally.
- If you mention a destination, keep it brief and direct.`;
    }

    return `PILOT Q&A POLICY:
- You know the viewer is still inside the presentation, not at the final call-to-action yet.
- Answer the question clearly, but do not send them away from the presentation.
- Do not include links, URLs, domains, booking paths, or external next-step instructions yet.
- If they ask about next steps too early, tell them calmly to stay with the presentation a little longer before deciding.
- Sound firm, protective, and authoritative, never evasive or salesy.`;
}

function stripLinksFromAnswer(text = '') {
    return String(text || '')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
        .replace(/https?:\/\/[^\s]+/gi, '')
        .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

router.post('/pilot-response', async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'qa', sessionId: req.body?.sessionId });
    try {
        const {
            sessionId,
            presentationSlug,
            projectSlug,
            questionId,
            prompt,
            answer,
            slideIndex
        } = req.body || {};

        if (!String(sessionId || '').trim() || !String(questionId || '').trim() || !String(prompt || '').trim()) {
            return res.status(400).json({ error: 'sessionId, questionId, and prompt are required' });
        }

        await analyticsService.logEvent(
            String(sessionId).trim(),
            'pilot_interstitial_response',
            Number.isFinite(Number(slideIndex)) ? Number(slideIndex) : null,
            String(answer || '').trim(),
            {
                questionId: String(questionId).trim(),
                prompt: String(prompt).trim(),
                presentationSlug: String(presentationSlug || '').trim(),
                projectSlug: String(projectSlug || '').trim()
            }
        );

        logger.info({
            event: 'pilot_interstitial_response_saved',
            questionId: String(questionId).trim(),
            slideIndex: Number.isFinite(Number(slideIndex)) ? Number(slideIndex) : null
        });

        res.json({ success: true });
    } catch (error) {
        logger.error({ event: 'pilot_interstitial_response_failed', err: error.message });
        res.status(500).json({ error: 'Failed to save pilot response' });
    }
});

async function loadQuestionAnswerContext(db, sessionId) {
    const context = {
        session: null,
        metadata: {},
        slides: [],
        currentSlide: null,
        presentation: null,
        knowledgeContext: ''
    };

    let session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    let slides = session ? db.all('SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC', [sessionId]) : [];

    if (!session && supabaseSession.isConfigured()) {
        try {
            session = await supabaseSession.getSession(sessionId);
            if (session) {
                slides = await supabaseSession.getSlides(sessionId);
            }
        } catch (error) {
            console.warn('[Questions] Failed to load session context from Supabase:', error.message);
        }
    }

    if (!session) {
        return context;
    }

    let metadata = {};
    try {
        metadata = JSON.parse(session.metadata || '{}');
    } catch {
        metadata = {};
    }

    let presentation = null;
    const presentationSlug = metadata.presentationSlug || metadata.deckId || session.deck_id || null;
    if (presentationSlug) {
        try {
            presentation = await cmsService.loadPresentation(presentationSlug, {
                expectedSource: metadata.declaredSource || metadata.sourceType || null
            });
        } catch (error) {
            console.warn('[Questions] Failed to load presentation context:', error.message);
        }
    }

    if ((!slides || slides.length === 0) && presentation?.slides) {
        slides = presentation.slides.map((slide, index) => ({
            id: slide.id || `${sessionId}-${index}`,
            slide_index: index,
            title: slide.title || '',
            content: slide.content || '',
            notes: slide.notes || ''
        }));
    }

    const currentSlideIndex = Number(session.current_slide_index || 0);
    const currentSlide = slides.find((slide) => Number(slide.slide_index) === currentSlideIndex) || slides[currentSlideIndex] || null;

    context.session = session;
    context.metadata = metadata;
    context.slides = slides;
    context.currentSlide = currentSlide;
    context.presentation = presentation;
    context.knowledgeContext = buildQuestionKnowledgeContext({
        sessionMetadata: metadata,
        presentation,
        currentSlide,
        slides
    });

    return context;
}

async function loadPilotQuestionAnswerContext({
    presentationSlug = '',
    projectSlug = '',
    currentSlideIndex = 0,
    currentSlide = null,
    slides = []
} = {}) {
    const context = {
        session: null,
        metadata: {
            presentationSlug: String(presentationSlug || '').trim(),
            projectSlug: String(projectSlug || '').trim()
        },
        slides: Array.isArray(slides) ? slides : [],
        currentSlide: currentSlide || null,
        presentation: null,
        knowledgeContext: ''
    };

    let presentation = null;
    if (context.metadata.presentationSlug) {
        try {
            presentation = await cmsService.loadPresentation(context.metadata.presentationSlug);
        } catch (error) {
            console.warn('[Questions] Failed to load pilot presentation context:', error.message);
        }
    }

    const normalizedSlides = Array.isArray(context.slides) && context.slides.length > 0
        ? context.slides.map((slide, index) => ({
            id: slide.id || `pilot-slide-${index + 1}`,
            slide_index: Number.isFinite(Number(slide.slide_index)) ? Number(slide.slide_index) : index,
            title: slide.title || '',
            content: slide.content || '',
            notes: slide.notes || ''
        }))
        : Array.isArray(presentation?.slides)
            ? presentation.slides.map((slide, index) => ({
                id: slide.id || `pilot-slide-${index + 1}`,
                slide_index: index,
                title: slide.title || '',
                content: slide.content || '',
                notes: slide.notes || ''
            }))
            : [];

    const slideIndex = Number.isFinite(Number(currentSlideIndex)) ? Number(currentSlideIndex) : 0;
    const resolvedCurrentSlide = currentSlide
        ? {
            id: currentSlide.id || `pilot-slide-${slideIndex + 1}`,
            slide_index: slideIndex,
            title: currentSlide.title || '',
            content: currentSlide.content || '',
            notes: currentSlide.notes || ''
        }
        : normalizedSlides.find((slide) => Number(slide.slide_index) === slideIndex) || normalizedSlides[slideIndex] || null;

    context.presentation = presentation;
    context.slides = normalizedSlides;
    context.currentSlide = resolvedCurrentSlide;
    context.knowledgeContext = buildQuestionKnowledgeContext({
        sessionMetadata: context.metadata,
        presentation,
        currentSlide: resolvedCurrentSlide,
        slides: normalizedSlides
    });

    return context;
}

async function loadSessionForQuestions(db, sessionId) {
    let session = db.get(`
        SELECT id, deck_id, control_token_hash, current_slide_index, status, created_at, updated_at, metadata
        FROM sessions
        WHERE id = ?
    `, [sessionId]);

    if (session) {
        return session;
    }

    if (!supabaseSession.isConfigured()) {
        return null;
    }

    try {
        return await supabaseSession.getSession(sessionId);
    } catch (error) {
        console.warn('[Questions] Failed to load session from Supabase:', error.message);
        return null;
    }
}

async function persistQuestionAnswer({ db, io, question, answerText, audioResult, sessionId }) {
    const meta = buildAnswerMeta(question.question_text, answerText);
    const answeredAt = new Date().toISOString();
    const audioBuffer = audioResult?.audioBuffer || null;
    const audioDurationMs = audioResult?.pcmBuffer
        ? Math.max(0, Math.round((audioResult.pcmBuffer.length / ((audioResult.sampleRate || 24000) * (audioResult.channels || 1) * (audioResult.bitsPerSample || 16) / 8)) * 1000))
        : null;

    let answerAudioPath = null;
    let answerAudioUrl = null;
    let audioSource = 'none';

    if (audioBuffer && audioBuffer.length > 0) {
        const relativeDir = path.join(GENERATED_QA_DIR, sessionId);
        await fs.mkdir(relativeDir, { recursive: true });
        const fileName = `${question.id}.wav`;
        const filePath = path.join(relativeDir, fileName);
        await fs.writeFile(filePath, audioBuffer);
        answerAudioPath = `generated/qa/${sessionId}/${fileName}`;
        answerAudioUrl = `/${answerAudioPath}`;
        audioSource = 'local';

        if (supabaseSession.isConfigured()) {
            try {
                const upload = await supabaseSession.uploadQuestionAudio({
                    sessionId,
                    questionId: question.id,
                    audioBuffer
                });
                answerAudioUrl = upload.publicUrl;
                audioSource = 'supabase';
            } catch (error) {
                console.warn('[Questions] Supabase audio upload failed, using local file:', error.message);
            }
        }
    }

    db.run(`
        UPDATE questions
        SET status = 'answered',
            answered_at = ?,
            answer_text = ?,
            answer_title = ?,
            answer_summary = ?,
            answer_details = ?,
            answer_audio_path = ?,
            answer_audio_url = ?,
            answer_audio_duration_ms = ?
        WHERE id = ?
    `, [
        answeredAt,
        answerText,
        meta.answerTitle,
        meta.answerSummary,
        meta.answerDetails,
        answerAudioPath,
        answerAudioUrl,
        audioDurationMs,
        question.id
    ]);

    const questionAnswer = {
        id: uuidv4(),
        sessionId,
        questionId: question.id,
        questionText: question.question_text,
        submittedBy: question.submitted_by,
        slideIndex: question.slide_index,
        status: 'answered',
        priority: question.priority || 0,
        answerTitle: meta.answerTitle,
        answerSummary: meta.answerSummary,
        answerText,
        answerDetails: meta.answerDetails,
        answerAudioPath,
        answerAudioUrl,
        answerAudioDurationMs: audioDurationMs,
        audioSource,
        metadataJson: meta.metadataJson,
        answeredAt
    };

    db.run(`
        INSERT OR REPLACE INTO question_answers (
            id, session_id, question_id, question_text, submitted_by, slide_index, status,
            answer_title, answer_summary, answer_text, answer_details,
            answer_audio_path, answer_audio_url, answer_audio_duration_ms, audio_source,
            metadata_json, created_at, updated_at, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        questionAnswer.id,
        questionAnswer.sessionId,
        questionAnswer.questionId,
        questionAnswer.questionText,
        questionAnswer.submittedBy,
        questionAnswer.slideIndex,
        questionAnswer.status,
        questionAnswer.answerTitle,
        questionAnswer.answerSummary,
        questionAnswer.answerText,
        questionAnswer.answerDetails,
        questionAnswer.answerAudioPath,
        questionAnswer.answerAudioUrl,
        questionAnswer.answerAudioDurationMs,
        questionAnswer.audioSource,
        JSON.stringify(questionAnswer.metadataJson || {}),
        answeredAt,
        answeredAt,
        answeredAt
    ]);

    if (supabaseSession.isConfigured()) {
        try {
            await supabaseSession.updateQuestionAnswer(question.id, {
                status: 'answered',
                answer_title: questionAnswer.answerTitle,
                answer_summary: questionAnswer.answerSummary,
                answer_text: questionAnswer.answerText,
                answer_details: questionAnswer.answerDetails,
                answer_audio_path: questionAnswer.answerAudioPath,
                answer_audio_url: questionAnswer.answerAudioUrl,
                answer_audio_duration_ms: questionAnswer.answerAudioDurationMs,
                audio_source: questionAnswer.audioSource,
                metadata_json: questionAnswer.metadataJson,
                answered_at: questionAnswer.answeredAt
            }) || await supabaseSession.createQuestionAnswer(questionAnswer);
        } catch (error) {
            console.warn('[Questions] Failed to persist answer thread to Supabase:', error.message);
        }
    }

    io.to(sessionId).emit('question-answer-ready', {
        questionId: question.id,
        questionText: question.question_text,
        submittedBy: question.submitted_by,
        answerText,
        answerTitle: meta.answerTitle,
        answerSummary: meta.answerSummary,
        answerDetails: meta.answerDetails,
        answerAudioUrl,
        answerAudioPath,
        answerAudioDurationMs: audioDurationMs,
        audioSource,
        status: 'answered'
    });

    return questionAnswer;
}

// Submit a question
router.post('/', async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'qa' });
    try {
        const { sessionId, questionText, submittedBy } = req.body;
        
        if (!sessionId || !questionText) {
            return res.status(400).json({ error: 'Session ID and question text are required' });
        }
        
        const db = req.app.get('db');
        
        // Verify session exists and is active
        let session = await loadSessionForQuestions(db, sessionId);
        if (session && !['active', 'presenting', 'completed'].includes(String(session.status || ''))) {
            session = null;
        }
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found or not accepting questions' });
        }
        
        const questionId = uuidv4();
        const now = new Date().toISOString();
        
        // Insert question
        db.run(`
            INSERT INTO questions (id, session_id, question_text, submitted_by, slide_index, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [questionId, sessionId, questionText, submittedBy || 'anonymous', session.current_slide_index, now]);

        if (supabaseSession.isConfigured()) {
            supabaseSession.createQuestionRecord({
                sessionId,
                questionId,
                questionText,
                submittedBy: submittedBy || 'anonymous',
                slideIndex: session.current_slide_index,
                status: 'pending',
                priority: 0
            }).catch((error) => {
                console.warn('[Questions] Failed to persist pending question to Supabase:', error.message);
            });
        }
        
        // Analytics
        analyticsService.logEvent(sessionId, 'user_question', session.current_slide_index, questionText, { submittedBy: submittedBy || 'anonymous', questionId });
        logger.info({ event: 'qa_question_submitted', sessionId, questionId, slideIndex: session.current_slide_index });

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

        // Run parallel thread to generate answer
        setImmediate(async () => {
            const backgroundLogger = req.app.get('logger')?.child({ subsystem: 'qa', sessionId, questionId }) || logger.child({ sessionId, questionId });
            try {
                backgroundLogger.info({ event: 'qa_generation_started' });
                const modelService = require('../services/model');
                const answerContext = await loadQuestionAnswerContext(db, sessionId);
                backgroundLogger.info({
                    event: 'qa_context_loaded',
                    slideCount: answerContext.slides?.length || 0,
                    knowledgeContextLength: answerContext.knowledgeContext?.length || 0
                });

                const answer = await modelService.generateNarrationStream({
                    slideTitle: 'User Question',
                    slideContent: questionText,
                    slideNotes: answerContext.currentSlide
                        ? `Current slide: "${answerContext.currentSlide.title || ''}". Visible text: "${answerContext.currentSlide.content || ''}"${answerContext.currentSlide.notes ? `\nPresenter notes: ${answerContext.currentSlide.notes}` : ''}`
                        : 'Answer directly and use the presentation knowledge if available.',
                    pendingQuestions: [],
                    participantName: submittedBy,
                    slideIndex: answerContext.session ? Number(answerContext.session.current_slide_index || 0) : 0,
                    totalSlides: answerContext.slides ? answerContext.slides.length : (Number(answerContext.session?.current_slide_index || 0) + 10),
                    style: 'conversational',
                    knowledgeContext: answerContext.knowledgeContext
                }, () => {}); // ignoring stream deltas

                backgroundLogger.info({ event: 'qa_generation_completed', answerLength: answer?.length || 0 });

                let audioResult = null;
                // Skip audio synthesis for question answers as requested for a faster, text-first experience
                /*
                try {
                    audioResult = await ttsService.synthesizeDetailed(answer, 'default');
                } catch (ttsErr) {
                    console.warn('[Background AI] Failed to synthesize answer audio:', ttsErr.message);
                }
                */

                await persistQuestionAnswer({
                    db,
                    io,
                    question: {
                        id: questionId,
                        question_text: questionText,
                        submitted_by: submittedBy || 'anonymous',
                        slide_index: session.current_slide_index,
                        priority: 0
                    },
                    answerText: answer,
                    audioResult,
                    sessionId
                });

                backgroundLogger.info({ event: 'qa_answer_ready' });
            } catch (err) {
                backgroundLogger.error({ event: 'qa_generation_failed', err: err.message });
                // Emit a fallback event so the UI shows something
                io.to(sessionId).emit('question-answer-ready', {
                    questionId,
                    questionText,
                    submittedBy: submittedBy || 'anonymous',
                    answerText: 'I apologize, but I was unable to generate a complete answer to your question. Please try rephrasing or ask something else.',
                    answerTitle: 'Answer unavailable',
                    answerSummary: 'Answer generation failed',
                    answerDetails: '',
                    answerAudioUrl: null,
                    answerAudioPath: null,
                    answerAudioDurationMs: null,
                    audioSource: 'none',
                    status: 'answered'
                });
            }
        });
        
        res.json({
            success: true,
            questionId,
            pendingCount
        });
    } catch (error) {
        logger.error({ event: 'qa_submit_failed', err: error.message });
        res.status(500).json({ error: 'Failed to submit question' });
    }
});

router.post('/pilot', async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'qa' });
    try {
        const {
            questionText,
            submittedBy,
            presentationSlug,
            projectSlug,
            currentSlideIndex,
            currentSlide,
            slides
        } = req.body || {};

        if (!String(questionText || '').trim()) {
            return res.status(400).json({ error: 'Question text is required' });
        }

        const modelService = require('../services/model');
        const answerContext = await loadPilotQuestionAnswerContext({
            presentationSlug,
            projectSlug,
            currentSlideIndex,
            currentSlide,
            slides
        });
        const resolvedSlideIndex = Number(answerContext.currentSlide?.slide_index || currentSlideIndex || 0);
        const totalSlides = answerContext.slides?.length || 1;
        const allowLinks = resolvedSlideIndex + 1 >= 9 || resolvedSlideIndex + 1 >= totalSlides;
        const pilotQuestionPolicy = buildPilotQuestionPolicy({
            currentSlideIndex: resolvedSlideIndex,
            totalSlides
        });

        let answer = await modelService.generateNarrationStream({
            slideTitle: 'User Question',
            slideContent: String(questionText || '').trim(),
            slideNotes: answerContext.currentSlide
                ? `Current slide: "${answerContext.currentSlide.title || ''}". Visible text: "${answerContext.currentSlide.content || ''}"${answerContext.currentSlide.notes ? `\nPresenter notes: ${answerContext.currentSlide.notes}` : ''}\n\n${pilotQuestionPolicy}`
                : `Answer directly and use the presentation knowledge if available.\n\n${pilotQuestionPolicy}`,
            pendingQuestions: [],
            participantName: submittedBy || 'Guest',
            slideIndex: resolvedSlideIndex,
            totalSlides,
            style: 'conversational',
            knowledgeContext: answerContext.knowledgeContext
        }, () => {});

        if (!allowLinks) {
            answer = stripLinksFromAnswer(answer);
        }

        const meta = buildAnswerMeta(questionText, answer);
        logger.info({
            event: 'pilot_qa_answer_ready',
            presentationSlug: String(presentationSlug || '').trim(),
            projectSlug: String(projectSlug || '').trim(),
            slideIndex: resolvedSlideIndex,
            allowLinks
        });

        res.json({
            success: true,
            questionId: uuidv4(),
            answerText: answer,
            answerTitle: meta.answerTitle,
            answerSummary: meta.answerSummary,
            answerDetails: meta.answerDetails,
            answerAudioUrl: null,
            answerAudioPath: null,
            answerAudioDurationMs: null,
            audioSource: 'none'
        });
    } catch (error) {
        logger.error({ event: 'pilot_qa_failed', err: error.message });
        res.status(500).json({ error: 'Failed to answer question' });
    }
});

router.get('/single/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        const db = req.app.get('db');

        let question = db.get(`
            SELECT q.*, qa.answer_title, qa.answer_summary, qa.answer_details,
                   qa.answer_audio_path, qa.answer_audio_url, qa.answer_audio_duration_ms, qa.audio_source
            FROM questions q
            LEFT JOIN question_answers qa ON qa.question_id = q.id
            WHERE q.id = ?
        `, [questionId]);

        if (!question && supabaseSession.isConfigured()) {
            question = await supabaseSession.getQuestionByQuestionId(questionId).catch(() => null);
        }

        if (!question) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const controlToken = extractSessionControlToken(req);
        if (!(await hasValidSessionControlAsync(db, question.session_id, controlToken))) {
            return res.status(403).json({ error: 'Valid session control token required' });
        }

        res.json({
            success: true,
            question: {
                id: question.id,
                session_id: question.session_id,
                question_text: question.question_text,
                submitted_by: question.submitted_by,
                slide_index: question.slide_index,
                status: question.status,
                answer_text: question.answer_text || '',
                answer_title: question.answer_title || '',
                answer_summary: question.answer_summary || '',
                answer_details: question.answer_details || '',
                answer_audio_path: question.answer_audio_path || '',
                answer_audio_url: question.answer_audio_url || '',
                answer_audio_duration_ms: question.answer_audio_duration_ms || null,
                audio_source: question.audio_source || 'none',
                answered_at: question.answered_at || null
            }
        });
    } catch (error) {
        console.error('Error getting question:', error);
        res.status(500).json({ error: 'Failed to get question' });
    }
});

// Get questions for a session
router.get('/:sessionId', requireSessionControl({ keys: ['sessionId'] }), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { status = 'pending' } = req.query;
        const db = req.app.get('db');

        let questions = [];
        if (supabaseSession.isConfigured()) {
            try {
                questions = await supabaseSession.getQuestions(sessionId, status);
            } catch (error) {
                console.warn('[Questions] Failed to load questions from Supabase:', error.message);
            }
        }

        if (!questions || questions.length === 0) {
            questions = db.all(`
                SELECT * FROM questions
                WHERE session_id = ? AND status = ?
                ORDER BY 
                    CASE WHEN status = 'pending' THEN priority END DESC,
                    created_at ASC
            `, [sessionId, status]);
        }

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
        let question = db.get(`
            SELECT * FROM questions WHERE id = ?
        `, [questionId]);
        if (!question && supabaseSession.isConfigured()) {
            question = await supabaseSession.getQuestionByQuestionId(questionId).catch(() => null);
        }
        
        if (!question) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const controlToken = extractSessionControlToken(req);
        if (!(await hasValidSessionControlAsync(db, question.session_id, controlToken))) {
            return res.status(403).json({ error: 'Valid session control token required' });
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

        if (supabaseSession.isConfigured()) {
            const questionKey = question.question_id || question.id;
            const supabaseUpdates = {};
            if (status !== undefined) supabaseUpdates.status = status;
            if (priority !== undefined) supabaseUpdates.priority = priority;
            if (status === 'answered') {
                supabaseUpdates.answered_at = new Date().toISOString();
                if (answerText) {
                    supabaseUpdates.answer_text = answerText;
                }
            }
            supabaseSession.updateQuestionAnswer(questionKey, supabaseUpdates).catch(err => {
                console.error('[Questions] Failed to update Supabase question:', err.message);
            });
        }
        
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
router.post('/bulk-update', requireSessionControl(), async (req, res) => {
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

                    if (supabaseSession.isConfigured()) {
                        const supabaseUpdates = {};
                        if (status !== undefined) supabaseUpdates.status = status;
                        if (priority !== undefined) supabaseUpdates.priority = priority;
                        if (status === 'answered' && answerText) {
                            supabaseUpdates.answer_text = answerText;
                            supabaseUpdates.answered_at = new Date().toISOString();
                        }
                        supabaseSession.updateQuestionAnswer(questionId, supabaseUpdates).catch(err => {
                            console.error('[Questions] Failed to bulk update Supabase question:', err.message);
                        });
                    }
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

router.buildAnswerMeta = buildAnswerMeta;
router.buildQuestionKnowledgeContext = buildQuestionKnowledgeContext;
router.loadQuestionAnswerContext = loadQuestionAnswerContext;

module.exports = router;
