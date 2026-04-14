const WebSocket = require('ws');
const { AzureOpenAI } = require('openai');
const axios = require('axios');
const sdk = require('microsoft-cognitiveservices-speech-sdk');

const TTS_PROVIDERS = {
  AZURE_REALTIME: 'azure-realtime',
  AZURE_SPEECH: 'azure-speech',
  AZURE_SDK: 'azure-sdk',
  KITTENTTS: 'kittentts'
};

const DEFAULT_AUDIO_META = {
  sampleRate: 24000,
  channels: 1,
  bitsPerSample: 16
};

const VOICE_MAP_SDK = {
  default: 'hi-IN-AartiNeural',
  female: 'hi-IN-AartiNeural',
  male: 'hi-IN-ArjunNeural'
};

const VOICE_MAP_REALTIME = {
  default: 'alloy',
  female: 'alloy',
  male: 'echo',
  alloy: 'alloy',
  echo: 'echo',
  fable: 'fable',
  onyx: 'onyx',
  nova: 'nova',
  shimmer: 'shimmer'
};

const VOICE_MAP_KITTENTTS = {
  default: 'default',
  female: 'female',
  male: 'male'
};

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function deriveFoundryBaseEndpoint(value) {
  const raw = trimTrailingSlash(value);
  if (!raw) return '';
  return raw.replace(/\/api\/projects\/[^/]+$/i, '');
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

class TTSService {
  constructor() {
    this.failClosed = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    this.ttsEndpoint = deriveFoundryBaseEndpoint(
      process.env.AZURE_OPENAI_TTS_ENDPOINT ||
      process.env.AZURE_OPENAI_REALTIME_ENDPOINT ||
      process.env.AZURE_OPENAI_ENDPOINT ||
      process.env.AZURE_VOICELIVE_ENDPOINT ||
      process.env.AZURE_EXISTING_AIPROJECT_ENDPOINT
    );
    this.ttsApiKey =
      process.env.AZURE_OPENAI_TTS_API_KEY ||
      process.env.AZURE_OPENAI_REALTIME_API_KEY ||
      process.env.AZURE_OPENAI_API_KEY ||
      process.env.AZURE_VOICELIVE_API_KEY ||
      process.env.AZURE_AI_API_KEY ||
      '';
    this.ttsDeployment =
      process.env.AZURE_OPENAI_TTS_DEPLOYMENT ||
      process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT ||
      process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
      'gpt-realtime-mini';
    this.ttsVoice = process.env.AZURE_OPENAI_TTS_VOICE || process.env.AZURE_OPENAI_REALTIME_VOICE || 'alloy';
    this.speechKey =
      process.env.AZURE_SPEECH_KEY ||
      process.env.AZURE_AI_SPEECH_KEY ||
      process.env.AZURE_COGSERVICES_KEY ||
      process.env.AZURE_OPENAI_API_KEY ||
      '';
    this.speechRegion =
      process.env.AZURE_SPEECH_REGION ||
      process.env.AZURE_LOCATION ||
      process.env.AZURE_REGION ||
      '';
    this.speechVoice = process.env.AZURE_SPEECH_VOICE || process.env.AZURE_OPENAI_TTS_SPEECH_VOICE || '';
    this.kittenttsUrl = process.env.KITTENTTS_URL || 'http://localhost:8080/tts';
    this.timeout = parseInt(process.env.TTS_TIMEOUT_MS, 10) || 30000;
    this.provider = this._detectProvider();
    this._ttsClient = null;
  }

  _detectProvider() {
    const env = String(process.env.TTS_PROVIDER || '').toLowerCase().replace(/[_\s]/g, '-');
    if (env) {
      if (env === 'azure-realtime' || env === 'realtime') return TTS_PROVIDERS.AZURE_REALTIME;
      if (env === 'azure-speech' || env === 'speech') return TTS_PROVIDERS.AZURE_SPEECH;
      if (env === 'azure-sdk' || env === 'azure-speech-sdk' || env === 'speech-sdk') return TTS_PROVIDERS.AZURE_SDK;
      if (env === 'kittentts' || env === 'kitten') return TTS_PROVIDERS.KITTENTTS;
    }

    if (this.speechKey && this.speechRegion) return TTS_PROVIDERS.AZURE_SDK;
    if (this.ttsEndpoint && this.ttsApiKey) return TTS_PROVIDERS.AZURE_REALTIME;
    if (process.env.KITTENTTS_URL) return TTS_PROVIDERS.KITTENTTS;
    return null;
  }

  supportsWordBoundaries() {
    return this.provider === TTS_PROVIDERS.AZURE_SDK;
  }

  prefersManagedNarration() {
    return this.supportsWordBoundaries();
  }

  _getTtsClient() {
    if (this._ttsClient) return this._ttsClient;
    if (!this.ttsEndpoint || !this.ttsApiKey) return null;

    this._ttsClient = new AzureOpenAI({
      apiKey: this.ttsApiKey,
      endpoint: this.ttsEndpoint,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
    });
    return this._ttsClient;
  }

  _buildRealtimeWsUrl() {
    const base = this.ttsEndpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const protocol = this.ttsEndpoint.startsWith('https') ? 'wss' : 'ws';
    if (base.includes('.services.ai.azure.com')) {
      return `${protocol}://${base}/openai/v1/realtime?model=${encodeURIComponent(this.ttsDeployment)}&api-key=${encodeURIComponent(this.ttsApiKey)}`;
    }
    return `${protocol}://${base}/openai/realtime?api-version=2024-10-01-preview&deployment=${encodeURIComponent(this.ttsDeployment)}&api-key=${encodeURIComponent(this.ttsApiKey)}`;
  }

  _mapVoice(voice, provider) {
    if (provider === TTS_PROVIDERS.KITTENTTS) {
      return VOICE_MAP_KITTENTTS[voice] || voice;
    }
    if (provider === TTS_PROVIDERS.AZURE_SDK) {
      return this.speechVoice || VOICE_MAP_SDK[voice] || VOICE_MAP_SDK.default;
    }
    return VOICE_MAP_REALTIME[voice] || this.ttsVoice;
  }

  async synthesize(text, voice = 'default') {
    const result = await this.synthesizeDetailed(text, voice);
    return result.audioBuffer;
  }

  async synthesizeDetailed(text, voice = 'default') {
    if (!text) throw new Error('Text is required');

    try {
      switch (this.provider) {
        case TTS_PROVIDERS.AZURE_REALTIME:
          return await this._synthesizeViaRealtime(text, voice);
        case TTS_PROVIDERS.AZURE_SPEECH:
          return await this._synthesizeViaSpeech(text, voice);
        case TTS_PROVIDERS.AZURE_SDK:
          return await this._synthesizeViaSpeechSdk(text, voice);
        case TTS_PROVIDERS.KITTENTTS:
          return await this._synthesizeViaKittenTTS(text, voice);
        default:
          if (this.failClosed) {
            throw new Error('No TTS provider configured');
          }
          console.warn('No TTS provider configured, generating placeholder audio');
          return this._placeholderResult(text);
      }
    } catch (error) {
      console.error('TTS synthesis error:', error.message);
      if (this.failClosed) {
        throw error;
      }
      return this._placeholderResult(text);
    }
  }

  _placeholderResult(text) {
    const audioBuffer = this.generatePlaceholderWav(text);
    const { pcmBuffer, sampleRate, channels, bitsPerSample } = extractPcmFromWav(audioBuffer);
    return {
      audioBuffer,
      pcmBuffer,
      sampleRate,
      channels,
      bitsPerSample,
      wordBoundaries: []
    };
  }

  async _synthesizeViaRealtime(text, voice) {
    const mappedVoice = this._mapVoice(voice, TTS_PROVIDERS.AZURE_REALTIME);
    const wsUrl = this._buildRealtimeWsUrl();

    return new Promise((resolve, reject) => {
      let timedOut = false;
      const audioChunks = [];
      let sessionCreated = false;

      const ws = new WebSocket(wsUrl, {
        headers: { 'api-key': this.ttsApiKey }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        ws.close();
        reject(new Error('Realtime TTS connection timed out'));
      }, this.timeout);

      ws.on('message', (raw) => {
        let event;
        try { event = JSON.parse(raw); } catch { return; }

        switch (event.type) {
          case 'session.created':
            sessionCreated = true;
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                type: 'realtime',
                output_modalities: ['audio'],
                instructions: 'Read the provided text aloud naturally and clearly. One consistent voice throughout. Do not add commentary, introductions, or extra words. Only read the text exactly as given.',
                audio: {
                  output: {
                    voice: mappedVoice,
                    format: {
                      type: 'audio/pcm',
                      rate: 24000
                    }
                  }
                }
              }
            }));
            break;

          case 'session.updated':
            ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text }]
              }
            }));
            ws.send(JSON.stringify({
              type: 'response.create',
              response: { output_modalities: ['audio'] }
            }));
            break;

          case 'response.audio.delta':
          case 'response.output_audio.delta':
            if (event.delta) {
              audioChunks.push(Buffer.from(event.delta, 'base64'));
            }
            break;

          case 'response.done': {
            clearTimeout(timer);
            ws.close();
            if (audioChunks.length === 0) {
              resolve(this._placeholderResult(text));
              return;
            }

            const pcmBuffer = Buffer.concat(audioChunks);
            resolve({
              audioBuffer: pcm16ToWav(pcmBuffer, DEFAULT_AUDIO_META.sampleRate, DEFAULT_AUDIO_META.channels, DEFAULT_AUDIO_META.bitsPerSample),
              pcmBuffer,
              sampleRate: DEFAULT_AUDIO_META.sampleRate,
              channels: DEFAULT_AUDIO_META.channels,
              bitsPerSample: DEFAULT_AUDIO_META.bitsPerSample,
              wordBoundaries: []
            });
            break;
          }

          case 'error':
            clearTimeout(timer);
            ws.close();
            reject(new Error(event.error?.message || 'Realtime TTS error'));
            break;

          default:
            break;
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Realtime TTS WebSocket error: ${err.message}`));
      });

      ws.on('close', () => {
        clearTimeout(timer);
        if (!timedOut && audioChunks.length === 0 && !sessionCreated) {
          reject(new Error('Realtime TTS connection closed before session created'));
        }
      });
    });
  }

  async _synthesizeViaSpeech(text, voice) {
    const client = this._getTtsClient();
    if (!client) throw new Error('Azure OpenAI credentials not configured for TTS');

    const mappedVoice = this._mapVoice(voice, TTS_PROVIDERS.AZURE_SPEECH);
    const response = await client.audio.speech.create({
      model: this.ttsDeployment,
      voice: mappedVoice,
      input: text,
      response_format: 'wav'
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (!audioBuffer.length) {
      throw new Error('Empty audio response from Azure Speech API');
    }

    const { pcmBuffer, sampleRate, channels, bitsPerSample } = extractPcmFromWav(audioBuffer);
    return {
      audioBuffer,
      pcmBuffer,
      sampleRate,
      channels,
      bitsPerSample,
      wordBoundaries: []
    };
  }

  async _synthesizeViaSpeechSdk(text, voice) {
    if (!this.speechKey || !this.speechRegion) {
      throw new Error('Azure Speech SDK credentials are not configured');
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.speechKey, this.speechRegion);
    speechConfig.speechSynthesisVoiceName = this._mapVoice(voice, TTS_PROVIDERS.AZURE_SDK);
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary, 'true');

    return new Promise((resolve, reject) => {
      const wordBoundaries = [];
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

      synthesizer.wordBoundary = (_sender, event) => {
        const word = String(event.text || '').trim();
        if (!word) return;
        wordBoundaries.push({
          word,
          textOffset: Number(event.textOffset || 0),
          wordLength: Number(event.wordLength || word.length),
          offsetMs: Math.max(0, Math.round(Number(event.audioOffset || 0) / 10000)),
          durationMs: 0
        });
      };

      synthesizer.speakTextAsync(
        text,
        (result) => {
          try {
            if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
              throw new Error(result.errorDetails || 'Azure Speech SDK synthesis failed');
            }

            const audioBuffer = Buffer.from(result.audioData);
            const { pcmBuffer, sampleRate, channels, bitsPerSample } = extractPcmFromWav(audioBuffer);

            for (let i = 0; i < wordBoundaries.length; i++) {
              const current = wordBoundaries[i];
              const next = wordBoundaries[i + 1];
              current.durationMs = Math.max(0, (next?.offsetMs || current.offsetMs) - current.offsetMs);
            }

            resolve({
              audioBuffer,
              pcmBuffer,
              sampleRate,
              channels,
              bitsPerSample,
              wordBoundaries
            });
          } catch (error) {
            reject(error);
          } finally {
            synthesizer.close();
          }
        },
        (error) => {
          synthesizer.close();
          reject(new Error(`Azure Speech SDK error: ${error}`));
        }
      );
    });
  }

  async _synthesizeViaKittenTTS(text, voice) {
    const mappedVoice = this._mapVoice(voice, TTS_PROVIDERS.KITTENTTS);

    const response = await axios({
      method: 'POST',
      url: this.kittenttsUrl,
      data: { text, voice: mappedVoice, format: 'wav' },
      responseType: 'arraybuffer',
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' }
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Empty audio response from KittenTTS');
    }

    const audioBuffer = Buffer.from(response.data);
    const { pcmBuffer, sampleRate, channels, bitsPerSample } = extractPcmFromWav(audioBuffer);
    return {
      audioBuffer,
      pcmBuffer,
      sampleRate,
      channels,
      bitsPerSample,
      wordBoundaries: []
    };
  }

  generatePlaceholderWav(text) {
    const sampleRate = 44100;
    const bitsPerSample = 16;
    const channels = 1;
    const duration = Math.min(text.length * 0.1, 5);
    const numSamples = Math.floor(sampleRate * duration);
    const dataSize = numSamples * channels * (bitsPerSample / 8);

    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
    buffer.writeUInt16LE(channels * bitsPerSample / 8, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 44; i < buffer.length; i++) {
      buffer[i] = 0;
    }

    return buffer;
  }

  async synthesizeStream(text, voice, onAudioChunk, handlers = {}) {
    if (!text) throw new Error('Text is required');
    if (typeof voice === 'function') {
      handlers = onAudioChunk || {};
      onAudioChunk = voice;
      voice = 'default';
    }
    if (typeof onAudioChunk !== 'function') {
      onAudioChunk = () => {};
    }

    if (this.provider === TTS_PROVIDERS.AZURE_REALTIME) {
      return await this._streamViaRealtime(text, voice, onAudioChunk, handlers);
    }

    const result = await this.synthesizeDetailed(text, voice);
    handlers.onWordBoundaries?.(result.wordBoundaries || [], {
      sampleRate: result.sampleRate,
      channels: result.channels,
      bitsPerSample: result.bitsPerSample
    });
    onAudioChunk(result.pcmBuffer, {
      sampleRate: result.sampleRate,
      channels: result.channels,
      bitsPerSample: result.bitsPerSample
    });
    return result.audioBuffer;
  }

  async _streamViaRealtime(text, voice, onAudioChunk, handlers = {}) {
    const mappedVoice = this._mapVoice(voice, TTS_PROVIDERS.AZURE_REALTIME);
    const wsUrl = this._buildRealtimeWsUrl();

    return new Promise((resolve, reject) => {
      let timedOut = false;
      const audioChunks = [];
      let sessionCreated = false;

      const ws = new WebSocket(wsUrl, {
        headers: { 'api-key': this.ttsApiKey }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        ws.close();
        reject(new Error('Realtime TTS stream timed out'));
      }, this.timeout);

      ws.on('message', (raw) => {
        let event;
        try { event = JSON.parse(raw); } catch { return; }

        switch (event.type) {
          case 'session.created':
            sessionCreated = true;
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                type: 'realtime',
                output_modalities: ['audio'],
                instructions: 'Read the provided text aloud naturally and clearly. One consistent voice throughout. Do not add commentary, introductions, or extra words. Only read the text exactly as given.',
                audio: {
                  output: {
                    voice: mappedVoice,
                    format: {
                      type: 'audio/pcm',
                      rate: 24000
                    }
                  }
                }
              }
            }));
            break;

          case 'session.updated':
            ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
            }));
            ws.send(JSON.stringify({
              type: 'response.create',
              response: { output_modalities: ['audio'] }
            }));
            break;

          case 'response.audio.delta':
          case 'response.output_audio.delta':
            if (event.delta) {
              const chunk = Buffer.from(event.delta, 'base64');
              audioChunks.push(chunk);
              onAudioChunk(chunk, { ...DEFAULT_AUDIO_META });
            }
            break;

          case 'response.done': {
            clearTimeout(timer);
            ws.close();
            const pcmBuffer = audioChunks.length > 0 ? Buffer.concat(audioChunks) : Buffer.alloc(0);
            if (!pcmBuffer.length) {
              resolve(this.generatePlaceholderWav(text));
              return;
            }
            handlers.onWordBoundaries?.([], { ...DEFAULT_AUDIO_META });
            resolve(pcm16ToWav(pcmBuffer, DEFAULT_AUDIO_META.sampleRate, DEFAULT_AUDIO_META.channels, DEFAULT_AUDIO_META.bitsPerSample));
            break;
          }

          case 'error':
            clearTimeout(timer);
            ws.close();
            reject(new Error(event.error?.message || 'Realtime TTS stream error'));
            break;

          default:
            break;
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Realtime TTS stream WebSocket error: ${err.message}`));
      });

      ws.on('close', () => {
        clearTimeout(timer);
        if (!timedOut && audioChunks.length === 0 && !sessionCreated) {
          reject(new Error('Realtime TTS stream closed before session created'));
        }
      });
    });
  }

  async synthesizeWithFallback(text, voice = 'default') {
    try {
      return await this.synthesize(text, voice);
    } catch (error) {
      console.warn('Primary TTS failed, using fallback');
      return this.generatePlaceholderWav(text);
    }
  }

  async healthCheck() {
    switch (this.provider) {
      case TTS_PROVIDERS.AZURE_REALTIME:
      case TTS_PROVIDERS.AZURE_SPEECH:
        return !!(this.ttsEndpoint && this.ttsApiKey);
      case TTS_PROVIDERS.AZURE_SDK:
        return !!(this.speechKey && this.speechRegion);
      case TTS_PROVIDERS.KITTENTTS:
        try {
          const url = this.kittenttsUrl.replace(/\/tts$/, '/health');
          await axios.get(url, { timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      default:
        return false;
    }
  }
}

module.exports = new TTSService();
