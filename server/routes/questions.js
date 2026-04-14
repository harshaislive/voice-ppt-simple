const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const analyticsService = require('../services/analytics');
const ttsService = require('../services/tts');
const cmsService = require('../services/cms');
const supabaseSession = require('../services/supabaseSession');
const {
    extractSessionControlToken,
    hasValidSessionControl,
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

    if (docs.soul) sections.push(`PROJECT SOUL:\n${stringifyDoc(docs.soul)}`);
    if (docs.agents) sections.push(`PROJECT RULES:\n${stringifyDoc(docs.agents)}`);
    if (docs.product) sections.push(`PRODUCT KNOWLEDGE:\n${stringifyDoc(docs.product)}`);
    if (docs.flow) sections.push(`PRESENTATION FLOW:\n${stringifyDoc(docs.flow)}`);
    if (docs.design) sections.push(`DESIGN CONTEXT:\n${stringifyDoc(docs.design)}`);
    if (docs.cta) sections.push(`CALL TO ACTION:\n${stringifyDoc(docs.cta)}`);

    if (currentSlide) {
        sections.push(`CURRENT SLIDE:\nTitle: ${currentSlide.title || ''}\nVisible text: ${currentSlide.content || ''}${currentSlide.notes ? `\nPresenter notes: ${currentSlide.notes}` : ''}`);
    }

    if (slides.length > 0) {
        sections.push(`FULL PRESENTATION CONTENT:\n${slides.map((slide, index) => `Slide ${index + 1}: "${slide.title || ''}"\n${slide.content || ''}${slide.notes ? `\nPresenter notes: ${slide.notes}` : ''}`).join('\n\n')}`);
    }

    return sections.join('\n\n').slice(0, 8000);
}

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
    const deckId = session.deck_id || metadata.presentationSlug || metadata.deckId || null;
    if (deckId && (!metadata.knowledgeDocs || Object.keys(metadata.knowledgeDocs).length === 0)) {
        try {
            presentation = await cmsService.loadPresentation(deckId);
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
    try {
        const { sessionId, questionText, submittedBy } = req.body;
        
        if (!sessionId || !questionText) {
            return res.status(400).json({ error: 'Session ID and question text are required' });
        }
        
        const db = req.app.get('db');
        
        // Verify session exists and is active
        let session = await loadSessionForQuestions(db, sessionId);
        if (session && !['active', 'presenting', 'wrapup', 'completed'].includes(String(session.status || ''))) {
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
            try {
                const modelService = require('../services/model');
                const answerContext = await loadQuestionAnswerContext(db, sessionId);
                const answer = await modelService.generateNarrationStream({
                    slideTitle: 'Audience Question',
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

                let audioResult = null;
                try {
                    audioResult = await ttsService.synthesizeDetailed(answer, 'default');
                } catch (ttsErr) {
                    console.warn('[Background AI] Failed to synthesize answer audio:', ttsErr.message);
                }

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
            } catch (err) {
                console.error('[Background AI] Failed to generate answer for question:', questionId, err);
            }
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
        if (!hasValidSessionControl(db, question.session_id, controlToken)) {
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

module.exports = router;
