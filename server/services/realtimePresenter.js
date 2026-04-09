const WebSocket = require('ws');
const narrationPrompt = require('../prompts/narrationPrompt');

class RealtimePresenterService {
  constructor() {
    this.endpoint = (process.env.AZURE_OPENAI_REALTIME_ENDPOINT || process.env.AZURE_OPENAI_TTS_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    this.apiKey = process.env.AZURE_OPENAI_REALTIME_API_KEY || process.env.AZURE_OPENAI_TTS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '';
    this.deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'gpt-realtime-mini';
    this.voice = process.env.AZURE_OPENAI_REALTIME_VOICE || process.env.AZURE_OPENAI_TTS_VOICE || 'alloy';
    this.timeout = parseInt(process.env.REALTIME_PRESENTER_TIMEOUT_MS, 10) || 45000;
  }

  isConfigured() {
    return Boolean(this.endpoint && this.apiKey && this.deployment);
  }

  async generateNarrationAudio(context, handlers = {}) {
    if (!this.isConfigured()) {
      throw new Error('Azure Realtime presenter is not configured');
    }

    try {
      const { instructions, userText } = this._buildPrompt(context, false);
      return await this._runRealtimeSession(instructions, userText, handlers);
    } catch (error) {
      if (!/content filter|filtered|policy/i.test(error.message || '')) {
        throw error;
      }

      const { instructions, userText } = this._buildPrompt(context, true);
      return await this._runRealtimeSession(instructions, userText, handlers);
    }
  }

  async _runRealtimeSession(instructions, userText, handlers = {}) {
    const wsUrl = this._buildWsUrl();
    return new Promise((resolve, reject) => {
      const audioChunks = [];
      let transcript = '';
      let sessionReady = false;
      let timedOut = false;

      const ws = new WebSocket(wsUrl, {
        headers: { 'api-key': this.apiKey }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        ws.close();
        reject(new Error('Realtime presenter connection timed out'));
      }, this.timeout);

      ws.on('message', (raw) => {
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          return;
        }

        switch (event.type) {
          case 'session.created':
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
                instructions,
                voice: this.voice,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: null
              }
            }));
            break;

          case 'session.updated':
            sessionReady = true;
            ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: userText }]
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
              const chunk = Buffer.from(event.delta, 'base64');
              audioChunks.push(chunk);
              handlers.onAudioChunk?.(chunk);
            }
            break;

          case 'response.audio_transcript.delta':
          case 'response.output_audio_transcript.delta':
            if (event.delta) {
              transcript += event.delta;
              handlers.onTranscriptDelta?.(event.delta, transcript);
            }
            break;

          case 'response.done':
            clearTimeout(timer);
            ws.close();
            resolve({
              transcript: transcript.trim(),
              audioChunks,
              totalPcmBytes: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
            });
            break;

          case 'error':
            clearTimeout(timer);
            ws.close();
            reject(new Error(event.error?.message || 'Realtime presenter error'));
            break;

          default:
            break;
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Realtime presenter WebSocket error: ${error.message}`));
      });

      ws.on('close', () => {
        clearTimeout(timer);
        if (!timedOut && !sessionReady && transcript.length === 0 && audioChunks.length === 0) {
          reject(new Error('Realtime presenter connection closed before session setup'));
        }
      });
    });
  }

  _buildWsUrl() {
    const base = this.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const protocol = this.endpoint.startsWith('https') ? 'wss' : 'ws';
    return `${protocol}://${base}/openai/realtime?api-version=2024-10-01-preview&deployment=${this.deployment}`;
  }

  _buildPrompt(context, safeMode = false) {
    if (!safeMode) {
      const messages = narrationPrompt.buildMessages(context);
      const instructions = typeof messages[0]?.content === 'string'
        ? messages[0].content
        : 'You are a natural spoken presenter.';

      const promptSections = messages.slice(1).map((message) => {
        const role = message.role || 'user';
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        return `${role.toUpperCase()}:\n${content}`;
      });

      return {
        instructions,
        userText: promptSections.join('\n\n')
      };
    }

    const userText = this._buildSafePrompt(context);
    return {
      instructions: 'You are a calm, clear presenter. Speak naturally, stay grounded in the provided context, and do not invent facts.',
      userText
    };
  }

  _buildSafePrompt(context) {
    const {
      slideTitle,
      slideContent,
      slideNotes,
      pendingQuestions,
      audienceContext,
      participantName,
      slideIndex,
      totalSlides
    } = context;

    const lines = [
      `Slide ${slideIndex + 1} of ${totalSlides}.`,
      `Title: ${slideTitle || ''}`,
      `Visible text: ${slideContent || ''}`,
      slideNotes ? `Presenter notes: ${slideNotes}` : '',
      participantName ? `Primary attendee: ${participantName}. Address them naturally once in a while.` : '',
      pendingQuestions && pendingQuestions.length
        ? `Pending audience questions: ${pendingQuestions.slice(0, 3).join(' | ')}`
        : '',
      audienceContext && Object.keys(audienceContext).length
        ? `Recent context: ${Object.entries(audienceContext).slice(0, 3).map(([key, value]) => `${key}: ${value}`).join(' | ')}`
        : '',
      'Speak 3 to 5 short sentences.',
      'Stay grounded in the slide and notes.',
      'Do not invent facts or numbers.'
    ].filter(Boolean);

    return lines.join('\n');
  }
}

module.exports = new RealtimePresenterService();
