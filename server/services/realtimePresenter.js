const WebSocket = require('ws');
const narrationPrompt = require('../prompts/narrationPrompt');
const { buildPronunciationGuide } = require('./pronunciation');

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function deriveFoundryBaseEndpoint(value) {
  const raw = trimTrailingSlash(value);
  if (!raw) return '';
  return raw.replace(/\/api\/projects\/[^/]+$/i, '');
}

class RealtimePresenterService {
  constructor() {
    this.endpoint = deriveFoundryBaseEndpoint(
      process.env.AZURE_OPENAI_REALTIME_ENDPOINT ||
      process.env.AZURE_OPENAI_TTS_ENDPOINT ||
      process.env.AZURE_OPENAI_ENDPOINT ||
      process.env.AZURE_VOICELIVE_ENDPOINT ||
      process.env.AZURE_EXISTING_AIPROJECT_ENDPOINT
    );
    this.apiKey =
      process.env.AZURE_OPENAI_REALTIME_API_KEY ||
      process.env.AZURE_OPENAI_TTS_API_KEY ||
      process.env.AZURE_OPENAI_API_KEY ||
      process.env.AZURE_VOICELIVE_API_KEY ||
      process.env.AZURE_AI_API_KEY ||
      '';
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
                type: 'realtime',
                output_modalities: ['audio'],
                instructions,
                audio: {
                  output: {
                    voice: this.voice,
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
              response: { output_modalities: ['audio'] }
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
    if (base.includes('.services.ai.azure.com')) {
      return `${protocol}://${base}/openai/v1/realtime?model=${encodeURIComponent(this.deployment)}&api-key=${encodeURIComponent(this.apiKey)}`;
    }
    return `${protocol}://${base}/openai/realtime?api-version=2024-10-01-preview&deployment=${encodeURIComponent(this.deployment)}&api-key=${encodeURIComponent(this.apiKey)}`;
  }

  _buildPrompt(context, safeMode = false) {
    const isQA = context.slideTitle === 'User Question' || context.isQA;
    const projectLabel = String(context.projectLabel || context.deckLabel || 'this presentation').trim();
    const pronunciationGuide = buildPronunciationGuide([
      context.slideTitle,
      context.slideContent,
      context.slideNotes,
      context.knowledgeContext
    ].filter(Boolean).join('\n'));
    const pronunciationText = pronunciationGuide.length
      ? `Pronunciation is mandatory. Follow these exactly in speech: ${pronunciationGuide.join('; ')}.`
      : '';

    if (!safeMode) {
      const messages = narrationPrompt.buildMessages(context);

      const userSections = [];
      for (const message of messages) {
        if (message.role === 'system') continue;
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        userSections.push(content);
      }

      const instructions = isQA
        ? `You are answering a user question about ${projectLabel}. Be direct, calm, and grounded in the provided project knowledge. 3-5 sentences. No preamble. No "Great question". Use the participant name once if provided. If the answer is not in the knowledge docs, say you do not have enough information in this presentation and that someone from the team can follow up. Adult speaking to adult. Calm, sharp, conversational. Avoid filler sounds like "uhm", "uh", or "um".`
        : `You are a narrator for ${projectLabel}. Speak in a grounded, confident, conversational voice shaped by the provided project knowledge. Keep one consistent voice throughout. Adult speaking to adult. Let the voice feel human through cadence and sentence rhythm, not filler sounds. Avoid "uhm", "uh", or "um". Stay grounded in the provided context and never invent facts. Do not make pricing claims, comparisons, or offer framing that are not explicitly supported by the slide, notes, or knowledge docs.`;

      return {
        instructions: pronunciationGuide.length
          ? `${instructions} ${pronunciationText} Keep the written words unchanged, but speak them with these pronunciations.`
          : instructions,
        userText: [userSections.join('\n\n'), pronunciationText].filter(Boolean).join('\n\n')
      };
    }

    const userText = this._buildSafePrompt(context);
    const instructions = isQA
      ? `You are answering a user question about ${projectLabel}. Be direct, calm, and grounded. 3-5 sentences. No preamble. Adult speaking to adult. If unsure, say you do not have the information in this presentation. Avoid filler sounds like "uhm", "uh", or "um".`
      : `You are a narrator for ${projectLabel}. Be grounded, concise, and natural. Adult speaking to adult. Let the voice feel human through cadence, not filler sounds. Avoid "uhm", "uh", or "um". Stay grounded in the provided context and never invent facts.`;

    return {
      instructions: pronunciationGuide.length
        ? `${instructions} ${pronunciationText}`
        : instructions,
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
      totalSlides,
      knowledgeContext
    } = context;

    const isQA = slideTitle === 'User Question' || context.isQA;
    const pronunciationGuide = buildPronunciationGuide([
      slideTitle,
      slideContent,
      slideNotes,
      knowledgeContext
    ].filter(Boolean).join('\n'));

    const lines = [
      `Scene ${slideIndex + 1} of ${totalSlides}.`,
      `Title: ${slideTitle || ''}`,
      `On screen: ${slideContent || ''}`,
      slideNotes ? `Intent: ${slideNotes}` : '',
      participantName ? `Participant: ${participantName}. Name them once max.` : '',
      knowledgeContext ? `Project knowledge:\n${knowledgeContext}` : '',
      pendingQuestions && pendingQuestions.length
        ? `Pending user questions: ${pendingQuestions.slice(0, 3).join(' | ')}`
        : '',
      audienceContext && Object.keys(audienceContext).length
        ? `Previous scene narration: ${Object.entries(audienceContext).slice(0, 3).map(([key, value]) => value).join(' ')}`
        : ''
    ];

    if (pronunciationGuide.length) {
      lines.push(`Pronunciation is mandatory. Follow these exactly in speech: ${pronunciationGuide.join('; ')}.`);
    }

    if (isQA) {
      lines.push('Answer the user question using only the provided project knowledge. Be direct and concise (3-5 sentences).');
    } else {
      lines.push('Four beats: Hook (2-3 sentences, grab attention) → Insight (4-8 sentences, what the slide MEANS, be specific and thorough) → Implication (2-4 sentences, why it matters) → Bridge (1-2 sentences, momentum forward). Aim for 200-300 words total.');
      lines.push('Specific over vague. No filler phrases. No recapping. One consistent voice. Documentary narrator, not stage actor.');
      lines.push('Do not invent facts or numbers not in the slide or notes.');
    }

    return lines.filter(Boolean).join('\n');
  }
}

module.exports = new RealtimePresenterService();
