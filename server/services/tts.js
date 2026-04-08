const WebSocket = require('ws');
const { AzureOpenAI } = require('openai');
const axios = require('axios');

const TTS_PROVIDERS = {
  AZURE_REALTIME: 'azure-realtime',
  AZURE_SPEECH: 'azure-speech',
  KITTENTTS: 'kittentts'
};

const AZURE_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

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

class TTSService {
  constructor() {
    this.provider = this._detectProvider();
    this.ttsEndpoint = (process.env.AZURE_OPENAI_TTS_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    this.ttsApiKey = process.env.AZURE_OPENAI_TTS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '';
    this.ttsDeployment = process.env.AZURE_OPENAI_TTS_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-realtime-mini';
    this.ttsVoice = process.env.AZURE_OPENAI_TTS_VOICE || 'alloy';
    this.kittenttsUrl = process.env.KITTENTTS_URL || 'http://localhost:8080/tts';
    this.timeout = parseInt(process.env.TTS_TIMEOUT_MS, 10) || 30000;
    this._ttsClient = null;
  }

  _detectProvider() {
    const env = process.env.TTS_PROVIDER;
    if (env) {
      const normalized = env.toLowerCase().replace(/[_\s-]/g, '-');
      if (normalized === 'azure-realtime' || normalized === 'realtime') return TTS_PROVIDERS.AZURE_REALTIME;
      if (normalized === 'azure-speech' || normalized === 'speech') return TTS_PROVIDERS.AZURE_SPEECH;
      if (normalized === 'kittentts' || normalized === 'kitten') return TTS_PROVIDERS.KITTENTTS;
    }
    if (process.env.AZURE_OPENAI_TTS_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT) {
      return TTS_PROVIDERS.AZURE_REALTIME;
    }
    return null;
  }

  _getTtsClient() {
    if (this._ttsClient) return this._ttsClient;
    if (!this.ttsEndpoint || !this.ttsApiKey) return null;

    this._ttsClient = new AzureOpenAI({
      apiKey: this.ttsApiKey,
      endpoint: this.ttsEndpoint,
      apiVersion: '2024-08-01-preview'
    });
    return this._ttsClient;
  }

  _buildRealtimeWsUrl() {
    const base = this.ttsEndpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const protocol = this.ttsEndpoint.startsWith('https') ? 'wss' : 'ws';
    return `${protocol}://${base}/openai/realtime?api-version=2024-10-01-preview&deployment=${this.ttsDeployment}`;
  }

  _mapVoice(voice, provider) {
    if (provider === TTS_PROVIDERS.KITTENTTS) {
      return VOICE_MAP_KITTENTTS[voice] || voice;
    }
    return VOICE_MAP_REALTIME[voice] || this.ttsVoice;
  }

  async synthesize(text, voice = 'default') {
    if (!text) throw new Error('Text is required');

    try {
      switch (this.provider) {
        case TTS_PROVIDERS.AZURE_REALTIME:
          return await this._synthesizeViaRealtime(text, voice);
        case TTS_PROVIDERS.AZURE_SPEECH:
          return await this._synthesizeViaSpeech(text, voice);
        case TTS_PROVIDERS.KITTENTTS:
          return await this._synthesizeViaKittenTTS(text, voice);
        default:
          console.warn('No TTS provider configured, generating placeholder audio');
          return this.generatePlaceholderWav(text);
      }
    } catch (error) {
      console.error('TTS synthesis error:', error.message);
      return this.generatePlaceholderWav(text);
    }
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

      ws.on('open', () => {
        // no-op; wait for session.created event
      });

      ws.on('message', (raw) => {
        let event;
        try { event = JSON.parse(raw); } catch { return; }

        switch (event.type) {
          case 'session.created':
            sessionCreated = true;
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
                instructions: 'Read the provided text aloud in a natural, professional voice. Do not add any commentary, introduction, or extra words. Only read the text exactly as given.',
                voice: mappedVoice,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: null
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
              response: { modalities: ['text', 'audio'] }
            }));
            break;

          case 'response.audio.delta':
          case 'response.output_audio.delta':
            if (event.delta) {
              audioChunks.push(Buffer.from(event.delta, 'base64'));
            }
            break;

          case 'response.done':
            clearTimeout(timer);
            ws.close();
            if (audioChunks.length > 0) {
              const pcm = Buffer.concat(audioChunks);
              resolve(pcm16ToWav(pcm, 24000, 1, 16));
            } else {
              resolve(this.generatePlaceholderWav(text));
            }
            break;

          case 'error':
            clearTimeout(timer);
            ws.close();
            reject(new Error(event.error?.message || 'Realtime TTS error'));
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

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty audio response from Azure Speech API');
    }
    return buffer;
  }

  async _synthesizeViaKittenTTS(text, voice) {
    const mappedVoice = this._mapVoice(voice, TTS_PROVIDERS.KITTENTTS);

    const response = await axios({
      method: 'POST',
      url: this.kittenttsUrl,
      data: { text, voice: mappedVoice, format: 'wav' },
      responseType: 'arraybuffer',
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/wav' }
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Empty audio response from KittenTTS');
    }
    return Buffer.from(response.data);
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

    console.log('Generated placeholder WAV:', { textLength: text.length, duration, bufferSize: buffer.length });
    return buffer;
  }

  async synthesizeStream(text, voice, onAudioChunk) {
    if (!text) throw new Error('Text is required');
    if (typeof voice === 'function') { onAudioChunk = voice; voice = 'default'; }
    if (!onAudioChunk) onAudioChunk = () => {};

    if (this.provider === TTS_PROVIDERS.AZURE_REALTIME) {
      return await this._streamViaRealtime(text, voice, onAudioChunk);
    }

    const wav = await this.synthesize(text, voice);
    onAudioChunk(wav);
    return wav;
  }

  async _streamViaRealtime(text, voice, onAudioChunk) {
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

      ws.on('open', () => {});

      ws.on('message', (raw) => {
        let event;
        try { event = JSON.parse(raw); } catch { return; }

        switch (event.type) {
          case 'session.created':
            sessionCreated = true;
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
                instructions: 'Read the provided text aloud in a natural, professional voice. Do not add any commentary, introduction, or extra words. Only read the text exactly as given.',
                voice: mappedVoice,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: null
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
              response: { modalities: ['text', 'audio'] }
            }));
            break;

          case 'response.audio.delta':
          case 'response.output_audio.delta':
            if (event.delta) {
              const chunk = Buffer.from(event.delta, 'base64');
              audioChunks.push(chunk);
              onAudioChunk(chunk);
            }
            break;

          case 'response.done':
            clearTimeout(timer);
            ws.close();
            if (audioChunks.length > 0) {
              const pcm = Buffer.concat(audioChunks);
              resolve(pcm16ToWav(pcm, 24000, 1, 16));
            } else {
              resolve(this.generatePlaceholderWav(text));
            }
            break;

          case 'error':
            clearTimeout(timer);
            ws.close();
            reject(new Error(event.error?.message || 'Realtime TTS stream error'));
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
      case TTS_PROVIDERS.KITTENTTS:
        try {
          const url = this.kittenttsUrl.replace(/\/tts$/, '/health');
          await axios.get(url, { timeout: 5000 });
          return true;
        } catch { return false; }
      default:
        return false;
    }
  }
}

module.exports = new TTSService();