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
const masterSessionService = require('../services/masterSession');
const { getLogger, getRequestLogger } = require('../middleware/logger');
const { requireSessionPlaybackControl, requireSessionControl } = require('../middleware/security');
const questionsRoute = require('./questions');

const interruptFlags = new Map();
const pauseFlags = new Map();
const playbackWaiters = new Map();
const continueWaiters = new Map();
const presentationStartTimes = new Map();
const prewarmedSlides = new Map();
const prewarmTasks = new Map();
const replayCache = new Map();
const deckAssetCache = new Map();
const pregenProgress = new Map();
const pregeneratedSessions = new Map();
const activePresentationRuns = new Map();
const playbackContracts = new Map();

const PRESENTATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const PRESENTATION_START_DELAY_MS = parseInt(process.env.PRESENTATION_START_DELAY_MS, 10) || 100;
const SLIDE_CHANGE_SETTLE_MS = parseInt(process.env.SLIDE_CHANGE_SETTLE_MS, 10) || 120;
const POST_SLIDE_HOLD_MS = parseInt(process.env.POST_SLIDE_HOLD_MS, 10) || 500;

const presentationTimeoutSweeper = setInterval(() => {
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
if (typeof presentationTimeoutSweeper.unref === 'function') {
    presentationTimeoutSweeper.unref();
}

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

async function loadPersistedReplayPlayback(db, sessionId, slideIndex, existingSlide = null) {
    let slide = existingSlide || db.get(
        'SELECT * FROM slides WHERE session_id = ? AND slide_index = ?',
        [sessionId, slideIndex]
    );

    if (!existingSlide && (!slide || (!slide.narration_audio_path && !slide.narration_audio_url)) && supabaseSession.isConfigured()) {
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
                // Supabase storage bucket may not exist - keep local copy
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
        const context = await buildNarrationContext({
            db,
            sessionId,
            slide,
            slideIndex,
            totalSlides,
            pendingQuestions
        });

        const narrationText = await modelService.generateNarration(context);

        // synthesizeDetailed is ~2x faster than streaming for full synthesis
        // Both return word boundaries from the SDK
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

        // Persist asynchronously — DB write + Supabase upload are fire-and-forget
        // Replay loads from replayCache (in-memory) or DB base64 column
        persistSlideNarration({
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
        }).catch(err => console.warn('[AutoPlex] Async persist failed:', err.message));

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

function getDeckAssetKey(deckId, slideIndex) {
    return `${deckId}:${slideIndex}`;
}

function getDeckAssetCache(deckId, slideIndex) {
    if (!deckId) return null;
    return deckAssetCache.get(getDeckAssetKey(deckId, slideIndex)) || null;
}

function setDeckAssetCache(deckId, slideIndex, payload) {
    if (!deckId) return;
    deckAssetCache.set(getDeckAssetKey(deckId, slideIndex), {
        ...payload,
        createdAt: Date.now()
    });
}

function updatePreGenProgress(sessionId, completed, total, status = 'generating') {
    pregenProgress.set(sessionId, { completed, total, status });
}

function getPreGenProgress() {
    return pregenProgress;
}

async function preGenerateAllSlides(db, sessionId, slides, sessionMetadata) {
    if (!slides || slides.length === 0) {
        updatePreGenProgress(sessionId, 0, 0, 'no-slides');
        return [];
    }

    const totalSlides = slides.length;
    updatePreGenProgress(sessionId, 0, totalSlides, 'starting');
    console.log(`[PreGen] Starting pre-generation check for session ${sessionId}, ${totalSlides} slides`);

    try {
        // --- MASTER SESSION OPTIMIZATION ---
        // If this deck has a master session, we can skip all LLM/TTS generation
        // and just "pre-warm" the caches from the master assets.
        const deckId = sessionMetadata.presentationSlug || sessionMetadata.deckId || sessionMetadata.projectSlug;
        const bypassMaster = sessionMetadata.bypassMaster === true;

        if (deckId) {
            const cachedDeckAssets = slides.map((slide, i) => {
                const cached = getDeckAssetCache(deckId, i);
                if (!cached) return null;
                setPrewarmedSlide(sessionId, i, cached);
                setReplayCache(sessionId, i, cached);
                return { ...slide, narration: cached.text, audio: cached };
            }).filter(Boolean);

            if (cachedDeckAssets.length === totalSlides) {
                pregeneratedSessions.set(sessionId, cachedDeckAssets);
                updatePreGenProgress(sessionId, totalSlides, totalSlides, 'complete');
                console.log(`[PreGen] Reused in-memory deck asset cache for ${deckId}`);
                return cachedDeckAssets;
            }
        }

        if (deckId && !bypassMaster) {
            console.log(`[PreGen] Checking for master assets for deck: ${deckId}`);
            const masterData = await masterSessionService.getMasterAssets(deckId);
            if (masterData && masterData.assets && masterData.assets.size > 0) {
                console.log(`[PreGen] Found ${masterData.assets.size} master assets for ${deckId}. Starting parallel pre-warm.`);
                
                const assetIndices = Array.from({ length: totalSlides }, (_, i) => i);
                const loadPromises = assetIndices.map(async (i) => {
                    const slide = slides[i];
                    const masterAsset = masterData.assets.get(i);
                    
                    if (masterAsset) {
                        try {
                            const cached = await loadPersistedReplayPlayback(db, sessionId, i, masterAsset);
                            if (cached) {
                                setPrewarmedSlide(sessionId, i, cached);
                                setReplayCache(sessionId, i, cached);
                                setDeckAssetCache(deckId, i, cached);
                                updatePreGenProgress(sessionId, i + 1, totalSlides, 'persisting');
                                return { index: i, slide, cached };
                            }
                        } catch (err) {
                            console.warn(`[PreGen] Failed to load master asset for slide ${i}:`, err.message);
                        }
                    }
                    return null;
                });

                const results = await Promise.all(loadPromises);
                const pregeneratedSlides = results
                    .filter(r => r !== null)
                    .sort((a, b) => a.index - b.index)
                    .map(r => ({ ...r.slide, narration: r.cached.text, audio: r.cached }));

                // If we loaded assets for all slides, we are done!
                if (pregeneratedSlides.length === totalSlides) {
                    pregeneratedSessions.set(sessionId, pregeneratedSlides);
                    updatePreGenProgress(sessionId, totalSlides, totalSlides, 'complete');
                    console.log(`[PreGen] All master assets pre-warmed in parallel for ${sessionId}. Instant start ready.`);
                    return pregeneratedSlides;
                } else {
                    console.warn(`[PreGen] Loaded ${pregeneratedSlides.length}/${totalSlides} master assets. Falling back to generation for missing parts.`);
                }
            } else {
                console.log(`[PreGen] No master session linked for deck ${deckId} yet.`);
            }
        }
        // --- END MASTER SESSION OPTIMIZATION ---

        const pendingQuestions = db.all(
            'SELECT question_text FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC LIMIT 5',
            [sessionId]
        ).map(q => q.question_text);

        const contextPromises = slides.map(async (slide, index) => {
            const context = await buildNarrationContext({
                db,
                sessionId,
                slide,
                slideIndex: index,
                totalSlides,
                pendingQuestions
            });
            return { context, slide, index };
        });
        const contextResults = await Promise.all(contextPromises);

        updatePreGenProgress(sessionId, 0, totalSlides, 'generating-narration');
        const narrationPromises = contextResults.map(({ context }) =>
            modelService.generateNarration(context)
        );
        const narrations = await Promise.all(narrationPromises);
        console.log(`[PreGen] Narration generated for all ${totalSlides} slides`);

        updatePreGenProgress(sessionId, Math.floor(totalSlides * 0.3), totalSlides, 'generating-audio');
        const TTS_BATCH_SIZE = parseInt(process.env.PREGEN_TTS_BATCH_SIZE, 10) || 3;
        const audioResults = [];

        for (let batchStart = 0; batchStart < narrations.length; batchStart += TTS_BATCH_SIZE) {
            const batch = narrations.slice(batchStart, batchStart + TTS_BATCH_SIZE);
            const batchPromises = batch.map((text) =>
                ttsService.synthesizeDetailed(text, 'default')
            );
            const batchResults = await Promise.all(batchPromises);
            audioResults.push(...batchResults);

            const completed = Math.floor(((batchStart + batch.length) / totalSlides) * 0.7 * totalSlides) + Math.floor(totalSlides * 0.3);
            updatePreGenProgress(sessionId, Math.min(completed, totalSlides), totalSlides, 'generating-audio');
        }

        console.log(`[PreGen] TTS generated for all ${totalSlides} slides`);
        updatePreGenProgress(sessionId, Math.floor(totalSlides * 0.85), totalSlides, 'persisting');

        const pregeneratedSlides = [];
        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];
            const narrationText = narrations[i];
            const audioResult = audioResults[i];

            const payload = {
                text: narrationText,
                pcmBase64: audioResult.pcmBuffer.toString('base64'),
                sampleRate: audioResult.sampleRate,
                channels: audioResult.channels,
                bitsPerSample: audioResult.bitsPerSample,
                wordBoundaries: audioResult.wordBoundaries || [],
                totalPcmBytes: audioResult.pcmBuffer.length
            };

            setPrewarmedSlide(sessionId, i, payload);
            setReplayCache(sessionId, i, payload);
            setDeckAssetCache(deckId, i, payload);
            pregeneratedSlides.push({ ...slide, narration: narrationText, audio: payload });

            persistSlideNarration({
                db,
                sessionId,
                slideIndex: i,
                slide,
                narrationText,
                audioBuffer: audioResult.audioBuffer,
                pcmBuffer: audioResult.pcmBuffer,
                sampleRate: audioResult.sampleRate,
                channels: audioResult.channels,
                bitsPerSample: audioResult.bitsPerSample,
                audioSource: 'pregenerated',
                wordBoundaries: audioResult.wordBoundaries || []
            }).catch(err => console.warn('[PreGen] Async persist failed for slide', i, ':', err.message));

            updatePreGenProgress(sessionId, i + 1, totalSlides, 'persisting');
        }

        pregeneratedSessions.set(sessionId, pregeneratedSlides);
        updatePreGenProgress(sessionId, totalSlides, totalSlides, 'complete');
        console.log(`[PreGen] Pre-generation complete for session ${sessionId}`);

        return pregeneratedSlides;
    } catch (error) {
        console.error(`[PreGen] Pre-generation failed for session ${sessionId}:`, error.message);
        updatePreGenProgress(sessionId, 0, totalSlides, 'failed');
        throw error;
    }
}

function triggerPreGeneration(db, sessionId, slides, sessionMetadata) {
    const metadata = typeof sessionMetadata === 'string'
        ? (() => { try { return JSON.parse(sessionMetadata); } catch { return {}; } })()
        : (sessionMetadata || {});

    preGenerateAllSlides(db, sessionId, slides, metadata).catch(err => {
        console.error(`[PreGen] Background pre-generation failed for ${sessionId}:`, err.message);
    });
}

function waitForPlaybackCompletion(sessionId, fallbackMs, expectedSlideIndex = null) {
    return new Promise((resolve) => {
        let settled = false;
        const contract = {
            sessionId,
            expectedSlideIndex,
            status: 'waiting_for_client_playback',
            createdAt: Date.now(),
            acknowledgedAt: null,
            clientInstanceId: null,
            socketId: null
        };
        playbackContracts.set(sessionId, contract);
        // Fallback timeout - use caller's duration or minimum 3s (not 12s - too slow)
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                playbackWaiters.delete(sessionId);
                contract.status = 'timed_out';
                playbackContracts.delete(sessionId);
                resolve(false);
            }
        }, Math.max(fallbackMs || 3000, 3000));

        playbackWaiters.set(sessionId, (completedSlideIndex) => {
            if (expectedSlideIndex !== null && completedSlideIndex !== undefined && expectedSlideIndex !== completedSlideIndex) {
                return;
            }
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                playbackWaiters.delete(sessionId);
                contract.status = 'acknowledged';
                playbackContracts.delete(sessionId);
                resolve(true);
            }
        });
    });
}

function markPlaybackComplete(sessionId, slideIndex, meta = {}) {
    const contract = playbackContracts.get(sessionId);
    if (contract) {
        if (contract.expectedSlideIndex !== null && slideIndex !== contract.expectedSlideIndex) {
            return false;
        }

        if (contract.status === 'acknowledged') {
            return false;
        }

        contract.clientInstanceId = meta.clientInstanceId || contract.clientInstanceId;
        contract.socketId = meta.socketId || contract.socketId;
        contract.acknowledgedAt = Date.now();
    }

    const waiter = playbackWaiters.get(sessionId);
    if (waiter) {
        waiter(slideIndex);
        return true;
    }

    return false;
}

function getPlaybackContract(sessionId) {
    return playbackContracts.get(sessionId) || null;
}

function resetPlaybackContracts() {
    playbackContracts.clear();
    playbackWaiters.clear();
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

function createPresentationRun(sessionId) {
    const existingRun = activePresentationRuns.get(sessionId);
    if (existingRun) {
        return { runId: existingRun.runId, alreadyRunning: true };
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activePresentationRuns.set(sessionId, { runId, startedAt: Date.now() });
    return { runId, alreadyRunning: false };
}

function clearPresentationRun(sessionId, runId) {
    const activeRun = activePresentationRuns.get(sessionId);
    if (activeRun && activeRun.runId === runId) {
        activePresentationRuns.delete(sessionId);
    }
}

function isPresentationRunActive(sessionId, runId) {
    return activePresentationRuns.get(sessionId)?.runId === runId;
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

    // Emit audio in chunks to mimic real streaming — client starts playback after
    // first chunk arrives rather than waiting for full base64 decode of giant chunk.
    // This dramatically improves first-byte time vs single large emission.
    const rawBytes = Buffer.from(cached.pcmBase64, 'base64');
    const chunkSize = 80000; // bytes per chunk (~1.67s of audio at 24kHz)
    const interChunkDelay = parseInt(process.env.TTS_CHUNK_DELAY_MS, 10) || 8;

    for (let offset = 0; offset < rawBytes.length; offset += chunkSize) {
        const chunk = rawBytes.slice(offset, offset + chunkSize);
        io.to(sessionId).emit('audio-chunk', {
            chunk: chunk.toString('base64'),
            slideIndex,
            sampleRate: cached.sampleRate || 24000,
            channels: cached.channels || 1,
            bitsPerSample: cached.bitsPerSample || 16,
            ...options
        });
        if (interChunkDelay > 0 && offset + chunkSize < rawBytes.length) {
            await sleep(interChunkDelay);
        }
    }

    io.to(sessionId).emit('audio-end', {
        slideIndex,
        format: 'wav',
        ...options
    });

    const audioDurationSec = Number(cached.totalPcmBytes || 0) / (((cached.sampleRate || 24000) * (cached.bitsPerSample || 16) / 8) * (cached.channels || 1));
    // Client audio player has ~93ms overhead (60ms buffer flush + 30ms scheduling + jitter)
    // Prewarmed audio has word boundaries — use accurate duration if available
    let waitMs;
    if (Array.isArray(cached.wordBoundaries) && cached.wordBoundaries.length > 0) {
        const lastWord = cached.wordBoundaries[cached.wordBoundaries.length - 1];
        const actualDurationMs = (lastWord.offsetMs || 0) + (lastWord.durationMs || 0);
        waitMs = Math.max(actualDurationMs + 5000, 10000);
    } else {
        waitMs = Math.max(
            Math.ceil(audioDurationSec * 1000) + 6000,
            options.isQA ? 8000 : 12000
        );
    }
    await waitForPlaybackCompletion(sessionId, waitMs, slideIndex);
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

    console.log('[KnowledgeContext] Building context. Available docs:', Object.keys(knowledgeDocs));
    if (knowledgeDocs.soul) {
        console.log('[KnowledgeContext] Soul doc length:', String(knowledgeDocs.soul).length, 'chars');
    }

    try {
        const frameworkPath = path.join(__dirname, '..', '..', 'AGENTS.md');
        if (fs.existsSync(frameworkPath)) {
            const framework = fs.readFileSync(frameworkPath, 'utf8');
            sections.push(`AGENT FRAMEWORK / CONSTITUTION:\n${framework}`);
        }
    } catch (err) {
        console.error('Failed to read global AGENTS.md:', err.message);
    }

    const docKeys = ['soul', 'agents', 'product', 'flow', 'design', 'cta'];
    const docLabels = {
        soul: 'PROJECT SOUL',
        agents: 'PROJECT RULES',
        product: 'PRODUCT',
        flow: 'FLOW',
        design: 'DESIGN',
        cta: 'CTA'
    };
    for (const key of docKeys) {
        if (knowledgeDocs[key]) {
            sections.push(`${docLabels[key]}: ${stringifyDoc(knowledgeDocs[key])}`);
        }
    }

    const result = sections.join('\n\n').slice(0, 16000);
    console.log('[KnowledgeContext] Total context length:', result.length, 'chars');
    return result;
}

async function buildFullQAContext(sessionMetadata, slides) {
    const sections = [];
    let knowledgeDocs = sessionMetadata.knowledgeDocs || {};
    
    // Always attempt to reload CMS knowledge to ensure we have the absolute latest Supabase docs
    const deckId = sessionMetadata.deckId || sessionMetadata.presentationSlug || sessionMetadata.projectSlug;
    if (deckId) {
        try {
            const presentation = await cmsService.loadPresentation(deckId);
            if (presentation?.knowledgeDocs && Object.keys(presentation.knowledgeDocs).length > 0) {
                knowledgeDocs = { ...knowledgeDocs, ...presentation.knowledgeDocs };
                console.log(`[QAContext] Reloaded knowledge from CMS for ${deckId}. Total docs:`, Object.keys(knowledgeDocs).length);
            }
        } catch (error) {
            console.warn('[Autoplex] Failed to reload QA knowledge docs from CMS:', error.message);
        }
    }

    try {
        const frameworkPath = path.join(__dirname, '..', '..', 'AGENTS.md');
        if (fs.existsSync(frameworkPath)) {
            sections.push(`AGENT FRAMEWORK / CONSTITUTION:\n${fs.readFileSync(frameworkPath, 'utf8')}`);
        }
    } catch {}

    if (knowledgeDocs && Object.keys(knowledgeDocs).length > 0) {
        if (knowledgeDocs.soul) sections.push(`PROJECT SOUL:\n${stringifyDoc(knowledgeDocs.soul)}`);
        if (knowledgeDocs.agents) sections.push(`PROJECT RULES:\n${stringifyDoc(knowledgeDocs.agents)}`);
        if (knowledgeDocs.product) sections.push(`PRODUCT KNOWLEDGE:\n${stringifyDoc(knowledgeDocs.product)}`);
        if (knowledgeDocs.flow) sections.push(`PRESENTATION FLOW:\n${stringifyDoc(knowledgeDocs.flow)}`);
        if (knowledgeDocs.design) sections.push(`DESIGN CONTEXT:\n${stringifyDoc(knowledgeDocs.design)}`);
        if (knowledgeDocs.cta) sections.push(`CALL TO ACTION:\n${stringifyDoc(knowledgeDocs.cta)}`);
    }

    if (slides && slides.length > 0) {
        sections.push(`FULL PRESENTATION CONTENT:\nThis is everything currently in the deck. Use this to answer questions about specific slides, claims, or content the participant has seen.\n`);
        slides.forEach((slide, i) => {
            sections.push(`Slide ${i + 1}: "${slide.title}"\n${slide.content || ''}${slide.notes ? `\nPresenter notes: ${slide.notes}` : ''}`);
        });
    }

    return sections.join('\n\n').slice(0, 16000);
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

async function buildNarrationContext({ db, sessionId, slide, slideIndex, totalSlides, pendingQuestions }) {
    const sessionMetadata = getSessionMetadata(db, sessionId);
    const participantName = getParticipantName(db, sessionId);

    let knowledgeContext = buildKnowledgeContext(sessionMetadata);
    if (!knowledgeContext || knowledgeContext.length < 200) {
        const deckId = sessionMetadata.presentationSlug || sessionMetadata.deckId || sessionMetadata.projectSlug;
        if (deckId) {
            try {
                const presentation = await cmsService.loadPresentation(deckId);
                if (presentation?.knowledgeDocs && Object.keys(presentation.knowledgeDocs).length > 0) {
                    knowledgeContext = buildKnowledgeContext({ ...sessionMetadata, knowledgeDocs: presentation.knowledgeDocs });
                }
            } catch (err) {
                console.warn('[NarrationContext] Failed to reload knowledge from CMS:', err.message);
            }
        }
    }

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
        projectLabel: sessionMetadata.presentationTitle || sessionMetadata.presentationSlug || sessionMetadata.deckId || sessionMetadata.projectSlug || '',
        pendingQuestions,
        audienceContext: audienceMemory,
        participantName,
        knowledgeContext,
        slideIndex,
        totalSlides,
        style: slideIndex === 0 ? 'hook' : slideIndex === totalSlides - 1 ? 'closer' : 'conversational'
    };
}

router.post('/', requireSessionPlaybackControl(), async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'presentation', sessionId: req.body?.sessionId });
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    const db = req.app.get('db');
    const io = req.app.get('io');
    const { runId, alreadyRunning } = createPresentationRun(sessionId);

    if (alreadyRunning) {
        return res.status(202).json({
            success: true,
            alreadyRunning: true,
            message: 'Auto-presentation already running'
        });
    }

    clearInterrupt(sessionId);
    res.json({ success: true, message: 'Auto-presentation started' });

    global.autoplexIo = io;
    try {
        logger.info({ event: 'presentation_start_requested' });
        await runPresentation(db, io, sessionId, runId);
    } catch (err) {
        logger.error({ event: 'presentation_failed', err: err.message });
        io.to(sessionId).emit('presentation-error', { error: err.message });
    } finally {
        clearInterrupt(sessionId);
        continueWaiters.delete(sessionId);
        playbackWaiters.delete(sessionId);
        clearPresentationRun(sessionId, runId);
        presentationStartTimes.delete(sessionId);
    }
});

router.post('/interrupt', requireSessionPlaybackControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    markInterrupted(sessionId);
    res.json({ success: true, interrupted: true });
});

router.post('/pause', requireSessionPlaybackControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    setPaused(sessionId, true);
    res.json({ success: true, paused: true });
});

router.post('/resume', requireSessionPlaybackControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    clearInterrupt(sessionId);
    setPaused(sessionId, false);
    res.json({ success: true, paused: false });
});

router.post('/continue', requireSessionPlaybackControl(), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    clearInterrupt(sessionId);
    markContinue(sessionId);
    res.json({ success: true, continued: true });
});

router.post('/prewarm', requireSessionPlaybackControl(), async (req, res) => {
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

router.post('/replay-slide', requireSessionPlaybackControl(), async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'presentation', sessionId: req.body?.sessionId });
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
        const deckId = slide.deck_id || session.deck_id;

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

        // Keep the deck paused, but clear interrupt so replay generation can emit text/audio.
        clearInterrupt(sessionId);

        const cached = getReplayCache(sessionId, resolvedSlideIndex)
            || getDeckAssetCache(deckId, resolvedSlideIndex)
            || getPrewarmedSlide(sessionId, resolvedSlideIndex)
            || await loadPersistedReplayPlayback(db, sessionId, resolvedSlideIndex);
        if (cached) {
            if (!getReplayCache(sessionId, resolvedSlideIndex)) {
                setReplayCache(sessionId, resolvedSlideIndex, cached);
            }
            setDeckAssetCache(deckId, resolvedSlideIndex, cached);
            await emitCachedPlayback(io, sessionId, resolvedSlideIndex, cached, { isReplay: true });
        } else {
            const totalSlides = db.get('SELECT COUNT(*) as count FROM slides WHERE session_id = ?', [sessionId])?.count || 0;
            const pendingQuestions = db.all(
                'SELECT * FROM questions WHERE session_id = ? AND status = \'pending\' ORDER BY priority DESC, created_at ASC',
                [sessionId]
            ).slice(0, 5).map((q) => q.question_text);

            const narrationResult = await narrateSlide({
                db,
                io,
                sessionId,
                slide,
                slideIndex: resolvedSlideIndex,
                totalSlides,
                pendingQuestions,
                options: { isReplay: true }
            });

            const streamedAudio = narrationResult?.audioHandled
                ? narrationResult
                : await streamAudio(io, sessionId, narrationResult.text, resolvedSlideIndex, { isReplay: true });

            if (streamedAudio) {
                await persistSlideNarration({
                    db,
                    sessionId,
                    slideIndex: resolvedSlideIndex,
                    slide,
                    narrationText: narrationResult.text,
                    audioBuffer: streamedAudio.audioBuffer,
                    pcmBuffer: streamedAudio.pcmBuffer,
                    sampleRate: streamedAudio.sampleRate,
                    channels: streamedAudio.channels,
                    bitsPerSample: streamedAudio.bitsPerSample,
                    audioSource: 'replay-fallback',
                    wordBoundaries: streamedAudio.wordBoundaries || []
                });
            }
        }

        return res.json({ success: true, cached: !!cached, slideIndex: resolvedSlideIndex });
    } catch (error) {
        logger.error({ event: 'presentation_replay_failed', slideIndex: resolvedSlideIndex, err: error.message });
        res.status(500).json({ error: 'Failed to replay slide' });
    }
});

async function runPresentation(db, io, sessionId, runId) {
    const logger = getLogger().child({ subsystem: 'presentation', sessionId });
    if (!isPresentationRunActive(sessionId, runId)) {
        return;
    }

    const session = db.get('SELECT * FROM sessions WHERE id = ? AND status IN (\'active\', \'presenting\')', [sessionId]);
    if (!session) {
        io.to(sessionId).emit('presentation-error', { error: 'Session not found' });
        return;
    }
    presentationStartTimes.set(sessionId, Date.now());
    const participantName = getParticipantName(db, sessionId);
    const sessionMetadata = getSessionMetadata(db, sessionId);
    const bypassMaster = sessionMetadata.bypassMaster === true;

    // Check for master assets for this deck
    let masterData = null;
    if (session.deck_id && !bypassMaster) {
        masterData = await masterSessionService.getMasterAssets(session.deck_id);
        if (masterData) {
            logger.info({ event: 'source_master_session_selected', deckId: session.deck_id, masterSessionId: masterData.masterSessionId });
        }
    }

    const slides = db.all('SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index ASC', [sessionId]);
    if (!slides.length) {
        io.to(sessionId).emit('presentation-error', { error: 'No slides found' });
        return;
    }

    const resumeSlideIndex = Math.max(0, Math.min(
        Number(session.current_slide_index || 0),
        Math.max(0, slides.length - 1)
    ));

    db.run('UPDATE sessions SET status = \'presenting\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);
    syncSessionState(sessionId, { status: 'presenting', current_slide_index: resumeSlideIndex });

    io.to(sessionId).emit('presentation-start', {
        totalSlides: slides.length,
        deckTitle: session.deck_id
    });
    logger.info({ event: 'presentation_start', totalSlides: slides.length, resumeSlideIndex });

    await sleep(PRESENTATION_START_DELAY_MS);

    if (!isPresentationRunActive(sessionId, runId)) {
        return;
    }

    const pregeneratedSlides = pregeneratedSessions.get(sessionId) || [];
    let currentSlideIndex = resumeSlideIndex;
    console.log(`[AutoPlex] Starting presentation for session ${sessionId}. Total slides: ${slides.length}, pregenerated: ${pregeneratedSlides.length}`);

    while (currentSlideIndex < slides.length) {
        if (!isPresentationRunActive(sessionId, runId)) {
            return;
        }

        await waitWhilePaused(db, io, sessionId);
        const slide = slides[currentSlideIndex];
        
        // --- DEBOUNCE / RE-ENTRY CHECK ---
        // Verify we are still the primary runner for this slide
        const sessionCheck = db.get('SELECT current_slide_index FROM sessions WHERE id = ?', [sessionId]);
        if (sessionCheck && sessionCheck.current_slide_index > currentSlideIndex) {
            console.log(`[AutoPlex] Bailing from redundant loop for slide ${currentSlideIndex + 1}. Session already at ${sessionCheck.current_slide_index + 1}.`);
            return;
        }

        console.log(`[AutoPlex] Playing slide ${currentSlideIndex + 1}/${slides.length}: ${slide.title}`);

        db.run('UPDATE sessions SET current_slide_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [currentSlideIndex, sessionId]);
        syncSessionState(sessionId, { current_slide_index: currentSlideIndex, status: 'presenting' });

        io.to(sessionId).emit('slide-change', {
            slideIndex: currentSlideIndex,
            totalSlides: slides.length,
            slide: { title: slide.title, content: slide.content, image: slide.image, notes: slide.notes },
            reason: 'auto-advance'
        });

        await sleep(SLIDE_CHANGE_SETTLE_MS);

        const masterAsset = masterData?.assets?.get(currentSlideIndex);
        let cached = null;

        if (masterAsset) {
            console.log(`[AutoPlex] Slide ${currentSlideIndex + 1}: Attempting to use master asset`);
            cached = await loadPersistedReplayPlayback(db, sessionId, currentSlideIndex, masterAsset);
            if (cached) {
                console.log(`[AutoPlex] Slide ${currentSlideIndex + 1}: Master asset loaded successfully`);
                setDeckAssetCache(session.deck_id, currentSlideIndex, cached);
            } else {
                console.warn(`[AutoPlex] Slide ${currentSlideIndex + 1}: Master asset failed to load, falling back`);
            }
        }

        if (!cached) {
            cached = getDeckAssetCache(session.deck_id, currentSlideIndex)
                || pregeneratedSlides[currentSlideIndex]?.audio
                || consumePrewarmedSlide(sessionId, currentSlideIndex)
                || getPrewarmedSlide(sessionId, currentSlideIndex)
                || await loadPersistedReplayPlayback(db, sessionId, currentSlideIndex);
        }

        if (cached) {
            if (!getReplayCache(sessionId, currentSlideIndex)) {
                setReplayCache(sessionId, currentSlideIndex, cached);
            }
            setDeckAssetCache(session.deck_id, currentSlideIndex, cached);
        io.to(sessionId).emit('narration-text', {
            text: cached.text,
            slideIndex: currentSlideIndex
        });
        logger.info({ event: 'presentation_slide_played', slideIndex: currentSlideIndex, source: 'cached' });
        await emitCachedPlayback(io, sessionId, currentSlideIndex, cached, { isQA: false });

            const narrationText = cached.text;
            analyticsService.logEvent(sessionId, 'ai_narration', currentSlideIndex, narrationText);

            db.run(
                'INSERT INTO events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [sessionId, 'narration_played', JSON.stringify({ slideIndex: currentSlideIndex, narrationLength: narrationText.length, source: 'pregenerated' })]
            );
        } else {
            console.warn(`[AutoPlex] No pre-generated audio for slide ${currentSlideIndex + 1}, falling back to on-the-fly`);
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

            const streamedAudio = await streamAudio(io, sessionId, narrationResult.text, currentSlideIndex, { isQA: false });
            logger.info({ event: 'presentation_slide_played', slideIndex: currentSlideIndex, source: 'generated' });
            if (streamedAudio) {
                await persistSlideNarration({
                    db,
                    sessionId,
                    slideIndex: currentSlideIndex,
                    slide,
                    narrationText: narrationResult.text,
                    audioBuffer: streamedAudio.audioBuffer,
                    pcmBuffer: streamedAudio.pcmBuffer,
                    sampleRate: streamedAudio.sampleRate,
                    channels: streamedAudio.channels,
                    bitsPerSample: streamedAudio.bitsPerSample,
                    audioSource: 'streamed-fallback',
                    wordBoundaries: streamedAudio.wordBoundaries || []
                });
            }

            analyticsService.logEvent(sessionId, 'ai_narration', currentSlideIndex, narrationResult.text);
        }

        await sleep(POST_SLIDE_HOLD_MS);

        if (!isPresentationRunActive(sessionId, runId)) {
            return;
        }

        currentSlideIndex += 1;
    }

    db.run('UPDATE sessions SET status = \'completed\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId]);
    syncSessionState(sessionId, { status: 'completed', current_slide_index: Math.max(0, slides.length - 1) });
    setPaused(sessionId, false);

    const questionsAsked = db.get('SELECT COUNT(*) as c FROM questions WHERE session_id = ?', [sessionId])?.c || 0;
    await analyticsService.logSessionEnd(sessionId, questionsAsked);

    io.to(sessionId).emit('presentation-end', {
        totalSlides: slides.length,
        totalQuestionsAnswered: questionsAsked
    });
    logger.info({ event: 'presentation_end', totalSlides: slides.length, totalQuestionsAnswered: questionsAsked });
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

async function narrateSlide({ db, io, sessionId, slide, slideIndex, totalSlides, pendingQuestions, options = {} }) {
    const context = await buildNarrationContext({ db, sessionId, slide, slideIndex, totalSlides, pendingQuestions });

    let narrationText = '';

    if (shouldUseRealtimePresenter()) {
        try {
            const result = await realtimePresenter.generateNarrationAudio(context, {
                onTranscriptDelta: (delta, full) => {
                    if (isInterrupted(sessionId)) return;
                    io.to(sessionId).emit('narration-delta', {
                        delta,
                        full,
                        slideIndex,
                        ...options
                    });
                },
                onAudioChunk: (chunk) => {
                    if (isInterrupted(sessionId)) return;
                    io.to(sessionId).emit('audio-chunk', {
                        chunk: chunk.toString('base64'),
                        slideIndex,
                        sampleRate: 24000,
                        channels: 1,
                        bitsPerSample: 16,
                        ...options
                    });
                }
            });
            narrationText = result.transcript || slide.content;
            if (hasRenderableAudio(result)) {
                io.to(sessionId).emit('audio-end', {
                    slideIndex,
                    format: 'wav',
                    ...options
                });
                const narrationDurationSec = result.totalPcmBytes / (24000 * 2);
                await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(narrationDurationSec * 1000) + 5500, 10000), slideIndex);
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
                    slideIndex,
                    ...options
                });
            });
        } else {
            narrationText = await modelService.generateNarration(context);
        }
    } catch (err) {
        console.error('Narration generation failed for slide', slideIndex, err);
        narrationText = slide.content;
        if (shouldStreamNarrationText()) {
            io.to(sessionId).emit('narration-delta', { delta: narrationText, full: narrationText, slideIndex, ...options });
        }
    }

    if (!isInterrupted(sessionId) && shouldStreamNarrationText()) {
        io.to(sessionId).emit('narration-text', {
            text: narrationText,
            slideIndex,
            ...options
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
        let waitMs;
        if (Array.isArray(lastWordBoundaries) && lastWordBoundaries.length > 0) {
            const lastWord = lastWordBoundaries[lastWordBoundaries.length - 1];
            const actualDurationMs = (lastWord.offsetMs || 0) + (lastWord.durationMs || 0);
            waitMs = Math.max(actualDurationMs + 5000, 10000);
        } else {
            waitMs = Math.max(
                Math.ceil(audioDurationSec * 1000) + (options.isQA ? 5000 : 7000),
                options.isQA ? 8000 : 12000
            );
        }
        await waitForPlaybackCompletion(sessionId, waitMs, slideIndex);

        if (slideIndex >= 0 && !options.isQA && !options.isWrapUp && collectedChunks.length > 0) {
            const pcmBuffer = Buffer.concat(collectedChunks);
            const payload = {
                text,
                pcmBase64: pcmBuffer.toString('base64'),
                sampleRate: 24000,
                channels: 1,
                bitsPerSample: 16,
                wordBoundaries: lastWordBoundaries || [],
                totalPcmBytes: pcmBuffer.length
            };
            setReplayCache(sessionId, slideIndex, payload);
            const session = db.get('SELECT deck_id FROM sessions WHERE id = ?', [sessionId]);
            setDeckAssetCache(session?.deck_id, slideIndex, payload);
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
    const knowledgeContext = questionsRoute.buildQuestionKnowledgeContext({
        sessionMetadata,
        currentSlide: slides[currentSlideIndex] || null,
        slides
    });

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
                    slideTitle: 'User Question',
                    slideContent: question.question_text,
                    slideNotes: [
                        `You are answering a typed user question immediately after slide ${currentSlideIndex + 1}.`,
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
                    await waitForPlaybackCompletion(sessionId, Math.max(Math.ceil(answerDurationSec * 1000) + 3000, 5000), slides.length + q);
                } else {
                    console.warn('Realtime presenter returned no audio for inline QA; falling back to TTS stream');
                }
            } else if (shouldStreamNarrationText()) {
                answer = await modelService.generateNarrationStream({
                    slideTitle: 'User Question',
                    slideContent: question.question_text,
                    slideNotes: [
                        `You are answering a typed user question immediately after slide ${currentSlideIndex + 1}.`,
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
                    slideTitle: 'User Question',
                    slideContent: question.question_text,
                    slideNotes: [
                        `You are answering a typed user question immediately after slide ${currentSlideIndex + 1}.`,
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

        const answerMeta = questionsRoute.buildAnswerMeta(question.question_text, answer);

        io.to(sessionId).emit('answer-text', {
            questionId: question.id,
            question: question.question_text,
            answer,
            answerTitle: answerMeta.answerTitle,
            answerSummary: answerMeta.answerSummary,
            answerDetails: answerMeta.answerDetails,
            questionIndex: q + 1,
            totalQuestions: questions.length
        });

        analyticsService.logEvent(sessionId, 'ai_answer', slides.length + q, answer, { questionId: question.id, questionText: question.question_text, isInterrupt: true });

        const isUnanswered = /I don't have enough information|I don't have that information|I don't have enough|I don't know enough|don't have that detail/i.test(answer);
        if (isUnanswered) {
            analyticsService.logEvent(sessionId, 'unanswered_question', currentSlideIndex, answer, { questionId: question.id, questionText: question.question_text });
            db.run('UPDATE questions SET status = \'unanswered\', answered_at = CURRENT_TIMESTAMP, answer_text = ? WHERE id = ?', [answer, question.id]);
        }

        if (!shouldUseRealtimePresenter()) {
            await streamAudio(io, sessionId, answer, slides.length + q, {
                isQA: true,
                questionIndex: q + 1
            });
        }

        if (!isUnanswered) {
            db.run(
                'UPDATE questions SET status = \'answered\', answered_at = CURRENT_TIMESTAMP, answer_text = ? WHERE id = ?',
                [answer, question.id]
            );
        }

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

router.post('/seal-master', requireSessionControl(), async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    try {
        const db = req.app.get('db');
        const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!session.deck_id) {
            return res.status(400).json({ error: 'Session has no deck_id' });
        }

        await masterSessionService.sealAsMaster(session.deck_id, sessionId);
        res.json({ success: true, message: `Session ${sessionId} sealed as master for deck ${session.deck_id}` });
    } catch (error) {
        console.error('Seal master failed:', error);
        res.status(500).json({ error: 'Failed to seal master session' });
    }
});

module.exports = router;
module.exports.markPlaybackComplete = markPlaybackComplete;
module.exports.triggerPreGeneration = triggerPreGeneration;
module.exports.getPreGenProgress = getPreGenProgress;
module.exports.waitForPlaybackCompletion = waitForPlaybackCompletion;
module.exports.getPlaybackContract = getPlaybackContract;
module.exports.resetPlaybackContracts = resetPlaybackContracts;

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
