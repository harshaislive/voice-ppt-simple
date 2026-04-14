require('dotenv').config();
const ttsService = require('../server/services/tts');

const TEST_PHRASES = [
  'Hello, this is a test of the text to speech system.',
  'The quick brown fox jumps over the lazy dog.',
  'Azure TTS is working correctly.'
];

async function verifyVoice(voice, phrase) {
  const startTime = Date.now();
  try {
    const audioBuffer = await ttsService.synthesize(phrase, voice);
    const duration = Date.now() - startTime;
    return {
      voice,
      phrase,
      success: true,
      durationMs: duration,
      audioSize: audioBuffer ? audioBuffer.length : 0
    };
  } catch (error) {
    return {
      voice,
      phrase,
      success: false,
      durationMs: Date.now() - startTime,
      error: error.message
    };
  }
}

async function main() {
  console.log('Azure TTS Voice Verification');
  console.log('============================\n');

  const provider = ttsService.provider || 'none';
  console.log(`Provider: ${provider}`);
  console.log(`Configured voice: ${ttsService.ttsVoice || ttsService.speechVoice || 'default'}\n`);

  const healthOk = await ttsService.healthCheck();
  console.log(`Health check: ${healthOk ? 'PASS' : 'FAIL'}\n`);

  console.log('Testing synthesis...\n');

  const voices = ['default', 'female', 'male'];
  const results = [];

  for (const voice of voices) {
    for (const phrase of TEST_PHRASES) {
      results.push(await verifyVoice(voice, phrase));
    }
  }

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.success ? 'PASS' : 'FAIL';
    console.log(`[${status}] voice=${result.voice} phrase="${result.phrase}" duration=${result.durationMs}ms`);
    if (result.success) {
      passed++;
    } else {
      failed++;
      console.log(`       Error: ${result.error}`);
    }
  }

  console.log(`\n----------------------------`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Verification failed:', error.message);
  process.exit(1);
});