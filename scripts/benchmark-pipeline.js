require('dotenv').config();
const fs = require('fs');
const path = require('path');

const tts = require('../server/services/tts');
const model = require('../server/services/model');
const realtime = require('../server/services/realtimePresenter');
const narrationPrompt = require('../server/prompts/narrationPrompt');

const TEST_TEXT = 'Nature does not hurry, yet everything is accomplished. This is the way of quiet strength and deep patience.';

function buildTestContext(slideIndex = 0) {
    return {
        slideTitle: 'Rhythm of Practice',
        slideContent: 'The forest does not rush to grow. It follows seasons.',
        slideNotes: 'Emphasize the patience required for meaningful change.',
        pendingQuestions: [],
        audienceContext: {},
        participantName: 'TestUser',
        knowledgeContext: 'This is a test context for benchmarking the narration pipeline.',
        slideIndex,
        totalSlides: 10,
        style: slideIndex === 0 ? 'hook' : 'conversational'
    };
}

async function run() {
    console.log('='.repeat(70));
    console.log('VOICE PPT PIPELINE BENCHMARK');
    console.log('TTS Provider:', tts.provider);
    console.log('TTS Timeout:', tts.timeout + 'ms');
    console.log('prefersManagedNarration:', tts.prefersManagedNarration());
    console.log('realtime configured:', realtime.isConfigured());
    console.log('='.repeat(70));

    // Warm up
    console.log('\n[WARMUP] Warming up services...');
    const warmContext = buildTestContext(0);
    try {
        await model.generateNarration(warmContext);
    } catch(e) {}
    try {
        await tts.synthesizeDetailed(TEST_TEXT, 'default');
    } catch(e) {}
    console.log('[WARMUP] Done\n');

    // Test 1: Model narration generation (non-streaming)
    console.log('[TEST 1] Model.generateNarration (non-streaming)...');
    const ctx1 = buildTestContext(1);
    const t1_start = Date.now();
    let narration1 = '';
    try {
        narration1 = await model.generateNarration(ctx1);
        const t1_end = Date.now();
        console.log(`  -> Generated ${narration1.length} chars in ${t1_end - t1_start}ms`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    // Test 2: Model narration generation (streaming callback)
    console.log('\n[TEST 2] Model.generateNarrationStream (streaming)...');
    const ctx2 = buildTestContext(2);
    const t2_start = Date.now();
    let streamLen = 0;
    try {
        narration1 = await model.generateNarrationStream(ctx2, (delta, full) => {
            streamLen += delta.length;
        });
        const t2_end = Date.now();
        console.log(`  -> Streamed ${streamLen} chars, final text ${narration1.length} chars in ${t2_end - t2_start}ms`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    // Test 3: TTS synthesize (non-streaming via SDK)
    console.log('\n[TEST 3] TTS.synthesizeDetailed (non-streaming, SDK)...');
    const t3_start = Date.now();
    try {
        const result = await tts.synthesizeDetailed(TEST_TEXT, 'default');
        const t3_end = Date.now();
        const pcmLen = result.pcmBuffer ? result.pcmBuffer.length : 0;
        const audioSec = pcmLen / (result.sampleRate * result.channels * result.bitsPerSample / 8);
        console.log(`  -> Generated ${pcmLen} bytes PCM (~${audioSec.toFixed(1)}s audio) in ${t3_end - t3_start}ms`);
        console.log(`  -> Word boundaries: ${result.wordBoundaries ? result.wordBoundaries.length : 0}`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    // Test 4: TTS synthesizeStream
    console.log('\n[TEST 4] TTS.synthesizeStream (chunked callback)...');
    const t4_start = Date.now();
    let chunks_received = 0;
    let total_pcm = 0;
    try {
        await tts.synthesizeStream(TEST_TEXT, 'default', (pcmChunk, meta) => {
            chunks_received++;
            total_pcm += pcmChunk.length;
        });
        const t4_end = Date.now();
        console.log(`  -> Received ${chunks_received} chunks, ${total_pcm} bytes in ${t4_end - t4_start}ms`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    // Test 5: Realtime presenter (if configured)
    if (realtime.isConfigured()) {
        console.log('\n[TEST 5] RealtimePresenter.generateNarrationAudio...');
        const ctx5 = buildTestContext(3);
        const t5_start = Date.now();
        let audioChunks = 0;
        try {
            const result = await realtime.generateNarrationAudio(ctx5, {
                onAudioChunk: (chunk) => { audioChunks++; },
                onTranscriptDelta: (delta, full) => {}
            });
            const t5_end = Date.now();
            console.log(`  -> Got ${audioChunks} audio chunks, ${result.totalPcmBytes} bytes in ${t5_end - t5_start}ms`);
            console.log(`  -> Transcript: ${result.transcript ? result.transcript.substring(0, 80) + '...' : 'NONE'}`);
        } catch (e) {
            console.log('  -> ERROR:', e.message);
        }
    } else {
        console.log('\n[TEST 5] RealtimePresenter - NOT CONFIGURED, skipping');
    }

    // Test 6: Full prewarm cycle (model + TTS sequential)
    console.log('\n[TEST 6] Full prewarm cycle (model + TTS sequential)...');
    const t6_start = Date.now();
    try {
        const ctx6 = buildTestContext(4);
        const nar6 = await model.generateNarration(ctx6);
        const t6_mid = Date.now();
        const tts6 = await tts.synthesizeDetailed(nar6, 'default');
        const t6_end = Date.now();
        console.log(`  -> Narration: ${nar6.length} chars in ${t6_mid - t6_start}ms`);
        console.log(`  -> TTS: ${tts6.pcmBuffer.length} bytes in ${t6_end - t6_mid}ms`);
        console.log(`  -> Total: ${t6_end - t6_start}ms`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    // Test 7: Full prewarm cycle (model + TTS parallel via stream)
    console.log('\n[TEST 7] Full stream cycle (narration + streaming TTS)...');
    const t7_start = Date.now();
    let stream_audio_bytes = 0;
    let stream_word_count = 0;
    try {
        const ctx7 = buildTestContext(5);
        const nar7 = await model.generateNarrationStream(ctx7, (delta, full) => {});
        const t7_mid = Date.now();
        await tts.synthesizeStream(nar7, 'default', (chunk, meta) => {
            stream_audio_bytes += chunk.length;
        }, {
            onWordBoundaries: (wb) => { stream_word_count = wb.length; }
        });
        const t7_end = Date.now();
        console.log(`  -> Narration: ${nar7.length} chars in ${t7_mid - t7_start}ms`);
        console.log(`  -> Stream TTS: ${stream_audio_bytes} bytes, ${stream_word_count} words in ${t7_end - t7_mid}ms`);
        console.log(`  -> Total: ${t7_end - t7_start}ms`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    // End-to-end simulation: one slide cycle
    console.log('\n' + '='.repeat(70));
    console.log('[TEST 8] Simulate full slide cycle (prewarm + playback wait)...');
    const t8_start = Date.now();
    try {
        // Simulate prewarm
        const ctx8 = buildTestContext(5);
        const nar8 = await model.generateNarration(ctx8);
        const t8_mid = Date.now();
        const tts8 = await tts.synthesizeDetailed(nar8, 'default');
        const t8_tts_done = Date.now();
        
        // Simulate playback duration
        const audioDurationSec = tts8.pcmBuffer.length / (tts8.sampleRate * tts8.channels * tts8.bitsPerSample / 8);
        const waitMs = Math.max(Math.ceil(audioDurationSec * 1000) + 6500, 10000);
        
        console.log(`  -> Prewarm: ${t8_tts_done - t8_start}ms`);
        console.log(`  -> Audio duration: ${audioDurationSec.toFixed(1)}s`);
        console.log(`  -> Wait time: ${waitMs}ms`);
        
        await new Promise(r => setTimeout(r, waitMs));
        const t8_end = Date.now();
        console.log(`  -> Full cycle: ${t8_end - t8_start}ms (prewarm + wait)`);
    } catch (e) {
        console.log('  -> ERROR:', e.message);
    }

    console.log('\n' + '='.repeat(70));
    console.log('BENCHMARK COMPLETE');
}

run().catch(console.error);