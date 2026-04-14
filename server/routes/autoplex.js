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
const cmsService = require('../services/cms');
const supabaseSession = require('../services/supabaseSession');
const { requireSessionControl } = require('../middleware/security');

const interruptFlags = new Map();
const pauseFlags = new Map();
const playbackWaiters = new Map();
const continueWaiters = new Map();
const presentationStartTimes = new Map();
const prewarmedSlides = new Map();
const prewarmTasks = new Map();
const replayCache = new Map();

const PRESENTATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const PRESENTATION_START_DELAY_MS = parseInt(process.env.PRESENTATION_START_DELAY_MS, 10) || 250;
const SLIDE_CHANGE_SETTLE_MS = parseInt(process.env.SLIDE_CHANGE_SETTLE_MS, 10) || 80;
const POST_SLIDE_HOLD_MS = parseInt(process.env.POST_SLIDE_HOLD_MS, 10) || 300;

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

function pcm16ToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
    const dataSize = pcmBuffer.length;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
    buffer.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(buffer, 44);

    return buffer;
}

function extractPcmFromWav(wavBuffer) {
    if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length < 44) {
        throw new Error('Invalid WAV buffer');
    }

    if (wavBuffer.toString('ascii', 0, 4) !== 'RIFF' || wavBuffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Unsupported WAV container');
    }

    let offset = 12;
    let fmtChunk = null;
    let dataChunk = null;

    while (offset + 8 <= wavBuffer.length) {
        const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
        const chunkSize = wavBuffer.readUInt32LE(offset + 4);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkSize;

        if (chunkEnd > wavBuffer.length) {
            break;
        }

        if (chunkId === 'fmt ') {
            fmtChunk = {
                audioFormat: wavBuffer.readUInt16LE(chunkStart),
                channels: wavBuffer.readUInt16LE(chunkStart + 2),
                sampleRate: wavBuffer.readUInt32LE(chunkStart + 4),
                bitsPerSample: wavBuffer.readUInt16LE(chunkStart + 14)
            };
        } else if (chunkId === 'data') {
            dataChunk = wavBuffer.subarray(chunkStart, chunkEnd);
        }

        offset = chunkEnd + (chunkSize % 2);
    }

    if (!fmtChunk || !dataChunk) {
        throw new Error('WAV buffer is missing fmt or data chunk');
    }

    if (fmtChunk.audioFormat !== 1) {
        throw new Error(`Unsupported WAV format: ${fmtChunk.audioFormat}`);
    }

    return {
        pcmBuffer: dataChunk,
        sampleRate: fmtChunk.sampleRate,
        channels: fmtChunk.channels,
        bitsPerSample: fmtChunk.bitsPerSample
    };
}

function getPersistedReplayPath(narrationAudioPath) {
    if (!narrationAudioPath || typeof narrationAudioPath !== 'string') {
        return null;
    }

    const normalized = narrationAudioPath.replace(/^\/+/, '');
    return path.join(__dirname, '..', '..', 'public', normalized);
}

async function readPersistedNarrationBuffer({ narrationAudioPath, narrationAudioUrl }) {
    const localPath = getPersistedReplayPath(narrationAudioPath);
    if (localPath && fs.existsSync(localPath)) {
        return fs.promises.readFile(localPath);
    }

    if (narrationAudioUrl && typeof fetch === 'function') {
        const response = await fetch(narrationAudioUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch narration audio: ${response.status}`);
        }
        return Buffer.from(await response.arrayBuffer());
    }

    return null;
}

async function loadPersistedReplayPlayback(db, sessionId, slideIndex) {
    let slide = db.get(
        'SELECT * FROM slides WHERE session_id = ? AND slide_index = ?',
        [sessionId, slideIndex]
    );

    if ((!slide || (!slide.narration_audio_path && !slide.narration_audio_url)) && supabaseSession.isConfigured()) {
        try {
            const remoteSlide = await supabaseSession.getSlideByIndex(sessionId, slideIndex);
            if (remoteSlide) {
                slide = {
                    ...slide,
                    ...remoteSlide
                };
            }
        } catch (error) {
            console.warn('[AutoPlex] Failed to load persisted replay slide from Supabase:', error.message);
        }
    }

    if (!slide || (!slide.narration_audio_path && !slide.narration_audio_url)) {
        return null;
    }

    const narrationText = slide.narration_text || slide.narration_metadata_json?.transcriptText || slide.content || '';
    const metadata = typeof slide.narration_metadata_json === 'string'
        ? (() => {
            try {
                return JSON.parse(slide.narration_metadata_json);
            } catch {
                return {};
            }
        })()
        : (slide.narration_metadata_json || {});
    const audioBuffer = await readPersistedNarrationBuffer({
        narrationAudioPath: slide.narration_audio_path,
        narrationAudioUrl: slide.narration_audio_url
    });

    if (!audioBuffer || audioBuffer.length === 0) {
        return null;
    }

    const { pcmBuffer, sampleRate, channels, bitsPerSample } = extractPcmFromWav(audioBuffer);
    const wordBoundaries = Array.isArray(metadata.wordBoundaries) ? metadata.wordBoundaries : [];

    return {
        text: narrationText,
        pcmBase64: pcmBuffer.toString('base64'),
        sampleRate,
        channels,
        bitsPerSample,
        wordBoundaries,
        totalPcmBytes: pcmBuffer.length
    };
}

function shouldUseRealtimePresenter() {
    return realtimePresenter.isConfigured() && !ttsService.prefersManagedNarration();
}

function shouldStreamNarrationText() {
    return !ttsService.prefersManagedNarration();
}

function syncSessionState(sessionId, updates) {
    if (!supabaseSession.isConfigured() || !sessionId || !updates) {
        return;
    }

    supabaseSession.updateSession(sessionId, updates).catch((error) => {
        console.error('[AutoPlex] Failed to sync session state to Supabase:', error.message);
    });
}

async function persistSlideNarration({ db, sessionId, slideIndex, slide = null, narrationText = '', audioBuffer = null, pcmBuffer = null, sampleRate = 24000, channels = 1, bitsPerSample = 16, audioSource = 'local', wordBoundaries = [] }) {
    if (!sessionId || slideIndex === undefined || slideIndex === null) {
        return null;
    }

    const now = new Date().toISOString();
    const slideTitle = slide?.title || '';
    const wavBuffer = Buffer.isBuffer(audioBuffer) && audioBuffer.length > 0
        ? audioBuffer
        : (Buffer.isBuffer(pcmBuffer) && pcmBuffer.length > 0 ? pcm16ToWav(pcmBuffer, sampleRate, channels, bitsPerSample) : null);
    const audioDurationMs = Buffer.isBuffer(pcmBuffer) && pcmBuffer.length > 0
        ? Math.max(0, Math.round((pcmBuffer.length / ((sampleRate || 24000) * (channels || 1) * (bitsPerSample || 16) / 8)) * 1000))
        : null;
    const metadataJson = {
        slideTitle,
        slideIndex,
        slideContent: slide?.content || '',
        slideNotes: slide?.notes || '',
        transcriptText: narrationText || '',
        wordBoundaryCount: Array.isArray(wordBoundaries) ? wordBoundaries.length : 0
    };

    let narrationAudioPath = null;
    let narrationAudioUrl = null;
    let narrationAudioSource = audioSource || 'local';

    if (wavBuffer) {
        const localDir = path.join(__dirname, '..', '..', 'public', 'generated', 'slides', sessionId);
        await fs.promises.mkdir(localDir, { recursive: true });
        const fileName = `${String(slideIndex).padStart(2, '0')}.wav`;
        const filePath = path.join(localDir, fileName);
        await fs.promises.writeFile(filePath, wavBuffer);
        narrationAudioPath = `generated/slides/${sessionId}/${fileName}`;
        narrationAudioUrl = `/${narrationAudioPath}`;

        if (supabaseSession.isConfigured()) {
            try {
                const upload = await supabaseSession.uploadSlideAudio({
                    sessionId,
                    slideIndex,
                    slideTitle,
                    audioBuffer: wavBuffer
                });
                narrationAudioPath = upload.objectPath;
                narrationAudioUrl = upload.publicUrl;
                narrationAudioSource = 'supabase';
            } catch (error) {
                console.warn('[AutoPlex] Failed to upload slide narration audio to Supabase, keeping local copy:', error.message);
            }
        }
    }

    db.run(`
        UPDATE slides
        SET narration_text = ?,
            narration_audio_path = ?,
            narration_audio_url = ?,
            narration_audio_duration_ms = ?,
            narration_audio_source = ?,
            narration_metadata_json = ?,
            narration_generated_at = ?
        WHERE session_id = ? AND slide_index = ?
    `, [
        narrationText || '',
        narrationAudioPath,
        narrationAudioUrl,
        audioDurationMs,
        narrationAudioSource,
        JSON.stringify(metadataJson),
        now,
        sessionId,
        slideIndex
    ]);

    if (supabaseSession.isConfigured()) {
        try {
            await supabaseSession.updateSlideNarration(sessionId, slideIndex, {
                narration_text: narrationText || '',
                narration_audio_path: narrationAudioPath,
                narration_audio_url: narrationAudioUrl,
                narration_audio_duration_ms: audioDurationMs,
                narration_audio_source: narrationAudioSource,
                narration_metadata_json: metadataJson,
                narration_generated_at: now
            });
        } catch (error) {
            console.warn('[AutoPlex] Failed to persist slide narration metadata to Supabase:', error.message);
        }
    }

    return {
        narrationAudioPath,
        narrationAudioUrl,
        narrationAudioSource,
        audioDurationMs,
        metadataJson
    };
}

function getPrewarmKey(sessionId, slideIndex) {
    return `${sessionId}:${slideIndex}`;
}

function getPrewarmedSlide(sessionId, slideIndex) {
    return prewarmedSlides.get(getPrewarmKey(sessionId, slideIndex)) || null;
}

function setPrewarmedSlide(sessionId, slideIndex, payload) {
    prewarmedSlides.set(getPrewarmKey(sessionId, slideIndex), {
        ...payload,
        createdAt: Date.now()
    });
}

function getPrewarmTask(sessionId, slideIndex) {
    return prewarmTasks.get(getPrewarmKey(sessionId, slideIndex)) || null;
}

function setPrewarmTask(sessionId, slideIndex, task) {
    prewarmTasks.set(getPrewarmKey(sessionId, slideIndex), task);
}

function consumePrewarmedSlide(sessionId, slideIndex) {
    const key = getPrewarmKey(sessionId, slideIndex);
    const value = prewarmedSlides.get(key) || null;
    if (value) {
        prewarmedSlides.delete(key);
    }
    return value;
}

async function prewarmSlideAudio({ db, sessionId, slideIndex, slide, totalSlides, pendingQuestions = [] }) {
    if (!slide) {
        throw new Error('Slide is required for prewarm');
    }

    const existing = getPrewarmedSlide(sessionId, slideIndex);
    if (existing) {
        return existing;
    }

    const inFlight = getPrewarmTask(sessionId, slideIndex);
    if (inFlight) {
        return inFlight;
    }

    const task = (async () => {
        const context = buildNarrationContext({
            db,
            sessionId,
            slide,
            slideIndex,
            totalSlides,
            pendingQuestions
        });

        const narrationText = await modelService.generateNarration(context);
        const audioResult = await ttsService.synthesizeDetailed(narrationText, 'default');
        const payload = {
            text: narrationText,
            pcmBase64: audioResult.pcmBuffer.toString('base64'),
            sampleRate: audioResult.sampleRate,
            channels: audioResult.channels,
            bitsPerSample: audioResult.bitsPerSample,
            wordBoundaries: audioResult.wordBoundaries || [],
            totalPcmBytes: audioResult.pcmBuffer.length
        };

        setPrewarmedSlide(sessionId, slideIndex, payload);
        setReplayCache(sessionId, slideIndex, payload);

        await persistSlideNarration({
            db,
            sessionId,
            slideIndex,
            slide,
            narrationText,
            audioBuffer: audioResult.audioBuffer,
            pcmBuffer: audioResult.pcmBuffer,
            sampleRate: audioResult.sampleRate,
            channels: audioResult.channels,
            bitsPerSample: audioResult.bitsPerSample,
            audioSource: 'prewarmed',
            wordBoundaries: audioResult.wordBoundaries || []
        });

        return payload;
    })();

    setPrewarmTask(sessionId, slideIndex, task);
    try {
        return await task;
    } finally {
        prewarmTasks.delete(getPrewarmKey(sessionId, slideIndex));
    }
}

function getReplayKey(sessionId, slideIndex) {
    return `${sessionId}:${slideIndex}`;
}

function getReplayCache(sessionId, slideIndex) {
    return replayCache.get(getReplayKey(sessionId, slideIndex)) || null;
}

function setReplayCache(sessionId, slideIndex, payload) {
    replayCache.set(getReplayKey(sessionId, slideIndex), {
        ...payload,
        createdAt: Date.now()
    });
}

function waitForPlaybackCompletion(sessionId, fallbackMs, expectedSlideIndex = null) {
    return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                playbackWaiters.delete(sessionId);
                resolve(false);
            }
        }, Math.max(fallbackMs || 0, 5000));

        playbackWaiters.set(sessionId, (completedSlideIndex) => {
            if (expectedSlideIndex !== null && completedSlideIndex !== undefined && expectedSlideIndex !== completedSlideIndex) {
                return;
            }
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                playbackWaiters.delete(sessionId);
                resolve(true);
            }
        });
    });
}

function markPlaybackComplete(sessionId, slideIndex) {
    const waiter = playbackWaiters.get(sessionId);
    if (waiter) {
        waiter(slideIndex);
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

async function emitCachedPlayback(io, sessionId, slideIndex, cached, options = {}) {
    io.to(sessionId).emit('narration-text', {
        text: cached.text,
        slideIndex,
        ...options
    });

    if (Array.isArray(cached.wordBoundaries) && cached.wordBoundaries.length > 0) {
        io.to(sessionId).emit('word-boundaries', {
            slideIndex,
            words: cached.wordBoundaries,
            ...options
        });
    }

    io.to(sessionId).emit('audio-chunk', {
        chunk: cached.pcmBase64,
        slideIndex,
        sampleRate: cached.sampleRate || 24000,
        channels: cached.channels || 1,
        bitsPerSample: cached.bitsPerSample || 16,
        ...options
    });

    io.to(sessionId).emit('audio-end', {
        slideIndex,
        format: 'wav',
        ...options
    });

    const audioDurationSec = Number(cached.totalPcmBytes || 0) / (((cached.sampleRate || 24000) * (cached.bitsPerSample || 16) / 8) * (cached.channels || 1));
    const waitMs = Math.max(
        Math.ceil(audioDurationSec * 1000) + (options.isQA ? 3000 : 3500),
        options.isQA ? 5000 : 6500
    );
    await waitForPlaybackCompletion(sessionId, waitMs);
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

    return sections.join('\n\n').slice(0, 8000);
}

async function buildFullQAContext(sessionMetadata, slides) {
    const sections = [];
    
    try {
        const frameworkPath = path.join(__dirname, '..', '..', 'AGENTS.md');
        if (fs.existsSync(frameworkPath)) {
            sections.push(`AGENT FRAMEWORK / CONSTITUTION:\n${fs.readFileSync(frameworkPath, 'utf8')}`);
        }
    } catch {}

    if (sessionMetadata.knowledgeDocs) {
        const docs = sessionMetadata.knowledgeDocs;
        if (docs.soul) sections.push(`PROJECT SOUL:\n${docs.soul}`);
        if (docs.agents) sections.push(`PROJECT RULES:\n${docs.agents}`);
        if (docs.product) sections.push(`PRODUCT KNOWLEDGE:\n${docs.product}`);
        if (docs.flow) sections.push(`PRESENTATION FLOW:\n${docs.flow}`);
        if (docs.design) sections.push(`DESIGN CONTEXT:\n${docs.design}`);
        if (docs.cta) sections.push(`CALL TO ACTION:\n${docs.cta}`);
    }

    if (slides && slides.length > 0) {
        sections.push(`FULL PRESENTATION CONTENT:\nThis is everything currently in the deck. Use this to answer questions about specific slides, claims, or content the attendee has seen.\n`);
        slides.forEach((slide, i) => {
            sections.push(`Slide ${i + 1}: "${slide.title}"\n${slide.content || ''}${slide.notes ? `\nPresenter notes: ${slide.notes}` : ''}`);
        });
    }

    return sections.join('\n\n');
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

function buildNarrationContext({ db, sessionId, slide, slideIndex, totalSlides, pendingQuestions }) {
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

    return {
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
    };
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

router.post('/prewarm', requireSessionControl(), async (req, res) => {
    const { sessionId, slideIndex = 0 } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    try {
        const db = req.app.get('db');
        const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const slides = db.all('SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC', [sessionId]);
        const targetSlide = slides[slideIndex];
        if (!targetSlide) {
            return res.status(404).json({ error: 'Slide not found' });
        }

        if (getPrewarmedSlide(sessionId, slideIndex)) {
            return res.json({ success: true, prewarmed: true, cached: true, slideIndex });
        }

        const pendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC LIMIT 5',
            [sessionId]
        ).map((q) => q.question_text);

        const prewarmed = await prewarmSlideAudio({
            db,
            sessionId,
            slideIndex,
            slide: targetSlide,
            totalSlides: slides.length,
            pendingQuestions
        });

        res.json({
            success: true,
            prewarmed: true,
            slideIndex,
            hasWordBoundaries: (prewarmed.wordBoundaries || []).length > 0
        });
    } catch (error) {
        console.error('Prewarm failed:', error);
        res.status(500).json({ error: 'Failed to prewarm slide' });
    }
});

router.post('/replay-slide', requireSessionControl(), async (req, res) => {
    const { sessionId, slideIndex } = req.body;
    if (!sessionId && !req.body.sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    const resolvedSlideIndex = Number.isInteger(slideIndex) ? slideIndex : parseInt(slideIndex, 10);
    if (Number.isNaN(resolvedSlideIndex) || resolvedSlideIndex < 0) {
        return res.status(400).json({ error: 'Valid slideIndex is required' });
    }

    try {
        const db = req.app.get('db');
        const io = req.app.get('io');
        const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const slide = db.get('SELECT * FROM slides WHERE session_id = ? AND slide_index = ?', [sessionId, resolvedSlideIndex]);
        if (!slide) {
            return res.status(404).json({ error: 'Slide not found' });
        }

        // Freeze the live flow while the audience is inspecting history.
        setPaused(sessionId, true);
        markInterrupted(sessionId);

        db.run('UPDATE sessions SET current_slide_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [resolvedSlideIndex, sessionId]);
        syncSessionState(sessionId, { current_slide_index: resolvedSlideIndex });
        io.to(sessionId).emit('slide-change', {
            slideIndex: resolvedSlideIndex,
            totalSlides: db.get('SELECT COUNT(*) as count FROM slides WHERE session_id = ?', [sessionId])?.count || 0,
            slide,
            reason: 'replay'
        });

        const cached = getReplayCache(sessionId, resolvedSlideIndex)
            || getPrewarmedSlide(sessionId, resolvedSlideIndex)
            || await loadPersistedReplayPlayback(db, sessionId, resolvedSlideIndex);
        if (cached) {
            if (!getReplayCache(sessionId, resolvedSlideIndex)) {
                setReplayCache(sessionId, resolvedSlideIndex, cached);
            }
            await emitCachedPlayback(io, sessionId, resolvedSlideIndex, cached, { isReplay: true });
        }

        return res.json({ success: true, cached: !!cached, slideIndex: resolvedSlideIndex });
    } catch (error) {
        console.error('Replay slide failed:', error);
        res.status(500).json({ error: 'Failed to replay slide' });
    }
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
    syncSessionState(sessionId, { status: 'presenting', current_slide_index: 0 });

    io.to(sessionId).emit('presentation-start', {
        totalSlides: slides.length,
        deckTitle: session.deck_id
    });

    await sleep(PRESENTATION_START_DELAY_MS);

    let currentSlideIndex = 0;
    console.log(`[AutoPlex] Starting presentation for session ${sessionId}. Total slides: ${slides.length}`);

    while (currentSlideIndex < slides.length) {
        await waitWhilePaused(db, io, sessionId);
        const slide = slides[currentSlideIndex];
        console.log(`[AutoPlex] Narrating slide ${currentSlideIndex + 1}/${slides.length}: ${slide.title}`);

        db.run('UPDATE sessions SET current_slide_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [currentSlideIndex, sessionId]);
        syncSessionState(sessionId, { current_slide_index: currentSlideIndex, status: 'presenting' });

        io.to(sessionId).emit('slide-change', {
            slideIndex: currentSlideIndex,
            totalSlides: slides.length,
            slide: { title: slide.title, content: slide.content, image: slide.image, notes: slide.notes },
            reason: 'auto-advance'
        });

        await sleep(SLIDE_CHANGE_SETTLE_MS);

        let updatedPendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
            [sessionId]
        );

        let prewarmed = consumePrewarmedSlide(sessionId, currentSlideIndex);
        if (!prewarmed) {
            const inFlightPrewarm = getPrewarmTask(sessionId, currentSlideIndex);
            if (inFlightPrewarm) {
                try {
                    await inFlightPrewarm;
                    prewarmed = consumePrewarmedSlide(sessionId, currentSlideIndex);
                } catch (error) {
                    console.warn(`[AutoPlex] In-flight prewarm failed for slide ${currentSlideIndex + 1}:`, error.message);
                }
            }
        }
        const narrationResult = prewarmed
            ? { text: prewarmed.text, audioHandled: true, prewarmed: true, prewarmedAudio: prewarmed }
            : await narrateSlide({
                db,
                io,
                sessionId,
                slide,
                slideIndex: currentSlideIndex,
                totalSlides: slides.length,
                pendingQuestions: updatedPendingQuestions.slice(0, 5).map((q) => q.question_text)
            });
        const narrationText = narrationResult.text;

        // Background pre-warm for the NEXT slide
        const nextSlideIndex = currentSlideIndex + 1;
        if (nextSlideIndex < slides.length && !getPrewarmedSlide(sessionId, nextSlideIndex)) {
            console.log(`[AutoPlex] Background pre-warming next slide ${nextSlideIndex + 1}/${slides.length}`);
            const nextSlide = slides[nextSlideIndex];
            
            // Fire and forget pre-warm
            (async () => {
                try {
                    const nextPendingQuestions = db.all(
                        'SELECT question_text FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC LIMIT 5',
                        [sessionId]
                    ).map(q => q.question_text);

                    await prewarmSlideAudio({
                        db,
                        sessionId,
                        slideIndex: nextSlideIndex,
                        slide: nextSlide,
                        totalSlides: slides.length,
                        pendingQuestions: nextPendingQuestions
                    });
                    
                    console.log(`[AutoPlex] Pre-warm complete for slide ${nextSlideIndex + 1}`);
                } catch (err) {
                    console.warn(`[AutoPlex] Background pre-warm failed for slide ${nextSlideIndex + 1}:`, err.message);
                }
            })();
        } else if (nextSlideIndex === slides.length && !getPrewarmedSlide(sessionId, 'wrapup')) {
            console.log(`[AutoPlex] Background pre-warming wrap-up phase`);
            (async () => {
                try {
                    const promptText = [
                        participantName ? `${participantName}, that brings us to the end of the deck.` : 'That brings us to the end of the deck.',
                        'I will stay with you for one more minute.',
                        'If you have any questions, type them in the questions panel.',
                        'You can also answer the quick prompts on screen while you think about your questions.'
                    ].join(' ');
                    
                    const audioResult = await ttsService.synthesizeDetailed(promptText, 'default');
                    setPrewarmedSlide(sessionId, 'wrapup', {
                        text: promptText,
                        pcmBase64: audioResult.pcmBuffer.toString('base64'),
                        sampleRate: audioResult.sampleRate,
                        channels: audioResult.channels,
                        bitsPerSample: audioResult.bitsPerSample,
                        wordBoundaries: audioResult.wordBoundaries || [],
                        totalPcmBytes: audioResult.pcmBuffer.length
                    });
                    await persistSlideNarration({
                        db,
                        sessionId,
                        slideIndex: slides.length,
                        slide: { title: 'Wrap Up', content: promptText, notes: '' },
                        narrationText: promptText,
                        audioBuffer: audioResult.audioBuffer,
                        pcmBuffer: audioResult.pcmBuffer,
                        sampleRate: audioResult.sampleRate,
                        channels: audioResult.channels,
                        bitsPerSample: audioResult.bitsPerSample,
                        audioSource: 'prewarmed',
                        wordBoundaries: audioResult.wordBoundaries || []
                    });
                    console.log(`[AutoPlex] Pre-warm complete for wrap-up phase`);
                } catch (err) {
                    console.warn(`[AutoPlex] Background pre-warm failed for wrap-up phase:`, err.message);
                }
            })();
        }

        updatedPendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
            [sessionId]
        );

        await waitWhilePaused(db, io, sessionId);
        if (narrationResult.prewarmedAudio) {
            await playPrewarmedAudio(io, sessionId, currentSlideIndex, narrationResult.prewarmedAudio, { isQA: false });
        } else if (!narrationResult.audioHandled) {
            const streamedAudio = await streamAudio(io, sessionId, narrationText, currentSlideIndex, { isQA: false });
            if (streamedAudio) {
                await persistSlideNarration({
                    db,
                    sessionId,
                    slideIndex: currentSlideIndex,
                    slide,
                    narrationText,
                    audioBuffer: streamedAudio.audioBuffer,
                    pcmBuffer: streamedAudio.pcmBuffer,
                    sampleRate: streamedAudio.sampleRate,
                    channels: streamedAudio.channels,
                    bitsPerSample: streamedAudio.bitsPerSample,
                    audioSource: 'streamed',
                    wordBoundaries: streamedAudio.wordBoundaries || []
                });
            }
        }

        analyticsService.logEvent(sessionId, 'ai_narration', currentSlideIndex, narrationText);

        db.run(
            'INSERT INTO events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [sessionId, 'narration_generated', JSON.stringify({ slideIndex: currentSlideIndex, narrationLength: narrationText.length })]
        );

        await sleep(POST_SLIDE_HOLD_MS);

        updatedPendingQuestions = db.all(
            'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
            [sessionId]
        );

        currentSlideIndex += 1;
    }

    await runWrapUp(db, io, sessionId, session.deck_id, participantName);

    const sessionMetadata = getSessionMetadata(db, sessionId);
    const qaKnowledgeContext = await buildFullQAContext(sessionMetadata, slides);

    const allQuestions = db.all(
        'SELECT * FROM questions WHERE session_id = ? ORDER BY created_at ASC',
        [sessionId]
    );

    if (allQuestions.length > 0) {
        io.to(sessionId).emit('qa-slides-ready', { questions: allQuestions });
        await sleep(180);
    }

    db.run('UPDATE sessions SET status = \'completed\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);
    syncSessionState(sessionId, { status: 'completed', current_slide_index: Math.max(0, slides.length - 1) });
    setPaused(sessionId, false);

    const questionsAsked = db.get('SELECT COUNT(*) as c FROM questions WHERE session_id = ?', [sessionId])?.c || 0;
    await analyticsService.logSessionEnd(sessionId, questionsAsked);

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
        'If you have any questions, type them in the questions panel.',
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
    syncSessionState(sessionId, { status: 'wrapup' });

    io.to(sessionId).emit('presentation-wrapup', {
        endsAt: deadline,
        durationMs,
        promptText,
        mcqs
    });

    const prewarmed = consumePrewarmedSlide(sessionId, 'wrapup');

    if (prewarmed) {
        io.to(sessionId).emit('narration-text', {
            text: prewarmed.text,
            slideIndex: -1,
            isWrapUp: true
        });
        await playPrewarmedAudio(io, sessionId, -1, prewarmed, { isWrapUp: true });
    } else if (shouldUseRealtimePresenter()) {
        try {
            const result = await realtimePresenter.generateNarrationAudio({
                slideTitle: 'Wrap Up',
                slideContent: promptText,
                slideNotes: 'Invite the attendee to ask questions using the questions panel. Sound calm, warm, and clearly indicate they have one minute.',
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
                await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(durationFromAudio * 1000) + 3500, 6500));
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

    const sessionMetadata = getSessionMetadata(db, sessionId);
    const ctaContent = sessionMetadata?.knowledgeDocs?.cta || null;

    io.to(sessionId).emit('presentation-wrapup-ended', {
        endedAt: Date.now()
    });

    await sleep(300);

    if (ctaContent) {
        const ctaText = typeof ctaContent === 'string'
            ? ctaContent
            : typeof ctaContent?.content === 'string'
                ? ctaContent.content
                : typeof ctaContent?.text === 'string'
                    ? ctaContent.text
                    : '';
        const trimmedCta = ctaText.trim();
        if (!trimmedCta) {
            return;
        }
        const closingLines = [
            `That's our story. Thank you for your time and attention, ${participantName || 'everyone'}.`,
            trimmedCta
        ].join(' ');
        io.to(sessionId).emit('narration-text', { text: closingLines, slideIndex: -1, isWrapUp: true });

        if (shouldUseRealtimePresenter()) {
            try {
                const result = await realtimePresenter.generateNarrationAudio({
                    slideTitle: 'Closing',
                    slideContent: closingLines,
                    slideNotes: 'Speak this closing with warmth and gratitude. Then clearly state the CTA.',
                    pendingQuestions: [],
                    audienceContext: {},
                    participantName,
                    slideIndex: 0,
                    totalSlides: 1,
                    style: 'closer'
                }, {
                    onTranscriptDelta: (delta, full) => {
                        io.to(sessionId).emit('narration-delta', { delta, full, slideIndex: -1, isWrapUp: true });
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
                    io.to(sessionId).emit('audio-end', { slideIndex: -1, format: 'wav', isWrapUp: true });
                }
            } catch {}
        } else {
            await streamAudio(io, sessionId, closingLines, -1, { isWrapUp: true });
        }
    }
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
    const context = buildNarrationContext({ db, sessionId, slide, slideIndex, totalSlides, pendingQuestions });

    let narrationText = '';

    if (shouldUseRealtimePresenter()) {
        try {
            const result = await realtimePresenter.generateNarrationAudio(context, {
                onTranscriptDelta: (delta, full) => {
                    if (isInterrupted(sessionId)) return;
                    io.to(sessionId).emit('narration-delta', {
                        delta,
                        full,
                        slideIndex
                    });
                },
                onAudioChunk: (chunk) => {
                    if (isInterrupted(sessionId)) return;
                    io.to(sessionId).emit('audio-chunk', {
                        chunk: chunk.toString('base64'),
                        slideIndex,
                        sampleRate: 24000,
                        channels: 1,
                        bitsPerSample: 16
                    });
                }
            });
            narrationText = result.transcript || slide.content;
            if (hasRenderableAudio(result)) {
                io.to(sessionId).emit('audio-end', {
                    slideIndex,
                    format: 'wav'
                });
                const narrationDurationSec = result.totalPcmBytes / (24000 * 2);
                await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(narrationDurationSec * 1000) + 3500, 6500));
                const realtimePcmBuffer = Array.isArray(result.audioChunks) && result.audioChunks.length > 0
                    ? Buffer.concat(result.audioChunks)
                    : Buffer.alloc(0);
                await persistSlideNarration({
                    db,
                    sessionId,
                    slideIndex,
                    slide,
                    narrationText,
                    pcmBuffer: realtimePcmBuffer,
                    sampleRate: 24000,
                    channels: 1,
                    bitsPerSample: 16,
                    audioSource: 'realtime'
                });
                return {
                    text: narrationText,
                    audioHandled: true,
                    audioBuffer: pcm16ToWav(realtimePcmBuffer, 24000, 1, 16),
                    pcmBuffer: realtimePcmBuffer,
                    sampleRate: 24000,
                    channels: 1,
                    bitsPerSample: 16,
                    wordBoundaries: []
                };
            }
            console.warn('Realtime presenter returned no audio for slide narration; falling back to TTS stream');
        } catch (err) {
            console.error('Realtime presenter failed for slide narration, falling back:', err.message);
            narrationText = '';
        }
    }

    try {
        if (shouldStreamNarrationText()) {
            narrationText = await modelService.generateNarrationStream(context, (delta, full) => {
                if (isInterrupted(sessionId)) {
                    return;
                }
                io.to(sessionId).emit('narration-delta', {
                    delta,
                    full,
                    slideIndex
                });
            });
        } else {
            narrationText = await modelService.generateNarration(context);
        }
    } catch (err) {
        console.error('Narration generation failed for slide', slideIndex, err);
        narrationText = slide.content;
        if (shouldStreamNarrationText()) {
            io.to(sessionId).emit('narration-delta', { delta: narrationText, full: narrationText, slideIndex });
        }
    }

    if (!isInterrupted(sessionId) && shouldStreamNarrationText()) {
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
        const collectedChunks = [];
        let lastWordBoundaries = [];

        await ttsService.synthesizeStream(text, 'default', (pcmChunk, audioMeta = {}) => {
            if (isInterrupted(sessionId)) {
                return;
            }

            totalPcmBytes += pcmChunk.length;
            collectedChunks.push(Buffer.from(pcmChunk));
            io.to(sessionId).emit('audio-chunk', {
                chunk: pcmChunk.toString('base64'),
                slideIndex,
                sampleRate: audioMeta.sampleRate || 24000,
                channels: audioMeta.channels || 1,
                bitsPerSample: audioMeta.bitsPerSample || 16,
                ...options
            });
        }, {
            onWordBoundaries: (wordBoundaries = []) => {
                if (isInterrupted(sessionId) || !Array.isArray(wordBoundaries) || wordBoundaries.length === 0) {
                    return;
                }

                lastWordBoundaries = wordBoundaries;

                io.to(sessionId).emit('word-boundaries', {
                    slideIndex,
                    words: wordBoundaries,
                    ...options
                });
            }
        });

        io.to(sessionId).emit('audio-end', {
            slideIndex,
            format: 'wav',
            ...options
        });

        const audioDurationSec = totalPcmBytes / (24000 * 2);
        const waitMs = Math.max(
            Math.ceil(audioDurationSec * 1000) + (options.isQA ? 4000 : 4500),
            options.isQA ? 6000 : 7500
        );
        await waitForPlaybackCompletion(sessionId, waitMs);

        if (slideIndex >= 0 && !options.isQA && !options.isWrapUp && collectedChunks.length > 0) {
            const pcmBuffer = Buffer.concat(collectedChunks);
            setReplayCache(sessionId, slideIndex, {
                text,
                pcmBase64: pcmBuffer.toString('base64'),
                sampleRate: 24000,
                channels: 1,
                bitsPerSample: 16,
                wordBoundaries: lastWordBoundaries || [],
                totalPcmBytes: pcmBuffer.length
            });
        }

        const pcmBuffer = collectedChunks.length > 0 ? Buffer.concat(collectedChunks) : Buffer.alloc(0);
        return {
            audioBuffer: pcmBuffer.length > 0 ? pcm16ToWav(pcmBuffer, 24000, 1, 16) : null,
            pcmBuffer,
            sampleRate: 24000,
            channels: 1,
            bitsPerSample: 16,
            wordBoundaries: lastWordBoundaries || [],
            totalPcmBytes: pcmBuffer.length
        };
    } catch (err) {
        console.error('TTS stream failed for slide', slideIndex, err);
        io.to(sessionId).emit('audio-end', {
            slideIndex,
            format: 'wav',
            ...options
        });
        await sleep(options.isQA ? 700 : 500);
        return null;
    }
}

async function playPrewarmedAudio(io, sessionId, slideIndex, prewarmed, options = {}) {
    await emitCachedPlayback(io, sessionId, slideIndex, prewarmed, options);
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
    const knowledgeContext = await buildFullQAContext(sessionMetadata, slides);

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
            if (shouldUseRealtimePresenter()) {
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
                    await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(answerDurationSec * 1000) + 3000, 5000));
                } else {
                    console.warn('Realtime presenter returned no audio for inline QA; falling back to TTS stream');
                }
            } else if (shouldStreamNarrationText()) {
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
            } else {
                answer = await modelService.generateNarration({
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

        if (/I don't have enough information|I don't have that information|I don't have enough|I don't know enough|don't have that detail/i.test(answer)) {
            analyticsService.logEvent(sessionId, 'unanswered_question', currentSlideIndex, answer, { questionId: question.id, questionText: question.question_text });
            db.run('UPDATE questions SET status = \'unanswered\', answered_at = CURRENT_TIMESTAMP, answer_text = ? WHERE id = ?', [answer, question.id]);
        }

        if (!shouldUseRealtimePresenter()) {
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
