require('dotenv').config();
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const model = require('../server/services/model');
const narrationPrompt = require('../server/prompts/narrationPrompt');

const FIXTURE = {
    slideTitle: 'Rhythm of Practice',
    slideContent: 'The forest does not rush to grow. It follows seasons.',
    slideNotes: 'Emphasize the patience required for meaningful change.',
    pendingQuestions: [],
    audienceContext: {},
    participantName: 'TestUser',
    knowledgeContext: 'This is a test context.',
    slideIndex: 1,
    totalSlides: 10,
    style: 'conversational'
};

async function benchmark(name, fn) {
    const start = Date.now();
    const result = await fn();
    const elapsed = Date.now() - start;
    console.log(`  ${name}: ${elapsed}ms`);
    return { result, elapsed };
}

async function run() {
    console.log('='.repeat(70));
    console.log('DETAILED PIPELINE ANALYSIS');
    console.log('='.repeat(70));

    // --- Stage 1: Prompt building ---
    console.log('\n[STAGE 1] Prompt construction');
    const s1 = Date.now();
    const messages = narrationPrompt.buildMessages(FIXTURE);
    const s1_total = Date.now() - s1;
    const promptSize = messages.reduce((s, m) => s + JSON.stringify(m.content).length, 0);
    console.log(`  Messages: ${messages.length}, prompt size: ${promptSize} chars`);
    console.log(`  Time: ${s1_total}ms`);

    // --- Stage 2: Model call (non-streaming) ---
    console.log('\n[STAGE 2] Model.generateNarration');
    const { result: narration, elapsed: model_time } = await benchmark('generateNarration', () =>
        model.generateNarration(FIXTURE)
    );
    console.log(`  Narration length: ${narration.length} chars (${narration.split(' ').length} words)`);

    // --- Stage 3: TTS synthesis ---
    console.log('\n[STAGE 3] TTS.synthesizeDetailed (non-streaming)');
    const { elapsed: tts_time } = await benchmark('synthesizeDetailed', () => {
        const tts = require('../server/services/tts');
        return tts.synthesizeDetailed(narration, 'default');
    });

    // --- Stage 4: Word boundary accuracy ---
    const tts = require('../server/services/tts');
    const synthResult = await tts.synthesizeDetailed(narration, 'default');
    const wb = synthResult.wordBoundaries || [];
    const lastWB = wb[wb.length - 1];
    const actualMs = lastWB ? lastWB.offsetMs + Math.max(lastWB.durationMs, 0) : 0;
    const audioLenBytes = synthResult.pcmBuffer.length;
    const audioLenSec = audioLenBytes / (synthResult.sampleRate * 2); // 16bit mono = 48000 bytes/sec
    console.log(`  Audio: ${audioLenBytes} bytes = ${audioLenSec.toFixed(1)}s`);
    console.log(`  Word boundaries: ${wb.length}, last offset: ${actualMs}ms`);
    console.log(`  Accuracy check: audio=${Math.round(audioLenSec*1000)}ms vs lastWB=${actualMs}ms`);

    // --- Stage 5: Stream audio via TTS (for comparison) ---
    console.log('\n[STAGE 5] TTS.synthesizeStream (chunked)');
    let chunks = 0, wbStream = [];
    const { elapsed: stream_time } = await benchmark('synthesizeStream', () =>
        tts.synthesizeStream(narration, 'default', (chunk) => { chunks++; }, {
            onWordBoundaries: (wb) => { wbStream = wb; }
        })
    );
    console.log(`  Chunks: ${chunks}, word boundaries: ${wbStream.length}`);

    // --- Stage 6: Full sequential prewarm (model + TTS) ---
    console.log('\n[STAGE 6] Full sequential prewarm');
    const { elapsed: prewarm_time } = await benchmark('model + TTS', async () => {
        const n = await model.generateNarration(FIXTURE);
        const t = await tts.synthesizeDetailed(n, 'default');
        return { narration: n, tts: t };
    });
    const prewarm_audio = prewarm_time > 0; // just marker

    // --- Stage 7: Model streaming + TTS (parallel-ish) ---
    console.log('\n[STAGE 7] Model streaming + TTS sequential');
    const { elapsed: stream_warm_time } = await benchmark('stream nar + TTS', async () => {
        let narText = '';
        await model.generateNarrationStream(FIXTURE, (d, f) => { narText = f || d; });
        const t = await tts.synthesizeDetailed(narText, 'default');
        return { narration: narText, tts: t };
    });

    // --- Stage 8: Concurrent prewarm (fire model + TTS together) ---
    console.log('\n[STAGE 8] Concurrent prewarm (model AND TTS in parallel)');
    const { elapsed: concurrent_time } = await benchmark('concurrent warm', async () => {
        // This is actually what we WANT but can't do because
        // TTS needs the narration text first
        // But let's measure the TTS cost if we already had the text
        const narText = await model.generateNarration(FIXTURE);
        // Parallel: start TTS while doing other work (simulate)
        const ttsStart = Date.now();
        const t = await tts.synthesizeDetailed(narText, 'default');
        console.log(`  (TTS alone: ${Date.now() - ttsStart}ms)`);
        return { narration: narText, tts: t };
    });

    // --- Analysis ---
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Prompt construction: ${s1_total}ms`);
    console.log(`Model (non-stream): ${model_time}ms`);
    console.log(`Model (stream): ~${stream_warm_time - (tts_time)}ms (derived)`);
    console.log(`TTS (detailed): ${tts_time}ms`);
    console.log(`TTS (stream): ${stream_time}ms`);
    console.log(`Full sequential prewarm: ${prewarm_time}ms`);
    console.log(`Audio duration: ${audioLenSec.toFixed(1)}s`);
    console.log(`Word boundary accurate duration: ${actualMs}ms`);
    console.log(`\nPlayback overhead:`);
    console.log(`  Old wait time formula: audio + 6500ms`);
    console.log(`    = ${(audioLenSec * 1000 + 6500).toFixed(0)}ms`);
    console.log(`  New wait time formula: max(wordBoundary+2500, audio+5500, 10000)`);
    console.log(`    = ${Math.max(actualMs + 2500, audioLenSec * 1000 + 5500, 10000).toFixed(0)}ms`);

    // Key insight
    const totalPrewarm = prewarm_time;
    const playbackWait = Math.max(actualMs + 2500, audioLenSec * 1000 + 5500, 10000);
    const ratio = playbackWait / totalPrewarm;
    console.log(`\nCRITICAL: Playback wait (${playbackWait.toFixed(0)}ms) vs prewarm (${totalPrewarm}ms) = ${ratio.toFixed(1)}x`);
    console.log(`-> Server prewarms WHILE client is playing. Ideal ratio should be ~1.0 (prewarm done just as client finishes)`);

    if (ratio < 1) {
        console.log(`-> WARNING: Client finishes BEFORE prewarm is ready! Next slide will stall.`);
    } else if (ratio > 2) {
        console.log(`-> SLOW: Server is waiting too long after audio ends before advancing.`);
    } else {
        console.log(`-> GOOD: Prewarm timing is well-matched to playback.`);
    }
}

run().catch(console.error);