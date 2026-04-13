class StreamAudioPlayer {
    constructor() {
        this.audioContext = null;
        this.nextStartTime = 0;
        this.isPlaying = false;
        this.sampleRate = 24000;
        this.playbackRate = 0.9;
        this.gainNode = null;
        this.activeSources = [];
        this.chunkQueue = [];
        this.bufferTimer = null;
        this.isBuffering = false;
    }

    _ensureContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0;
            this.gainNode.connect(this.audioContext.destination);
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    playChunk(pcmBase64, sampleRate, channels) {
        this._ensureContext();
        
        if (!this.isPlaying && !this.isBuffering) {
            this.isBuffering = true;
            this.chunkQueue = [];
            if (this.bufferTimer) clearTimeout(this.bufferTimer);
            this.bufferTimer = setTimeout(() => {
                this.isBuffering = false;
                this.bufferTimer = null;
                this._flushQueue();
            }, 250);
        }

        if (this.isBuffering) {
            this.chunkQueue.push({ pcmBase64, sampleRate, channels });
        } else {
            this._processChunk(pcmBase64, sampleRate, channels);
        }
    }

    _flushQueue() {
        while (this.chunkQueue.length > 0) {
            const chunk = this.chunkQueue.shift();
            this._processChunk(chunk.pcmBase64, chunk.sampleRate, chunk.channels);
        }
    }

    _processChunk(pcmBase64, sampleRate, channels) {
        const pcm = this._base64ToArrayBuffer(pcmBase64);
        const float32 = this._pcm16ToFloat32(pcm);
        const source = this.audioContext.createBufferSource();
        const buffer = this.audioContext.createBuffer(channels || 1, float32.length, sampleRate || this.sampleRate);
        buffer.getChannelData(0).set(float32);
        source.buffer = buffer;
        source.playbackRate.value = this.playbackRate;
        source.connect(this.gainNode);

        const now = this.audioContext.currentTime;
        const startTime = Math.max(now, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + (buffer.duration / this.playbackRate);
        this.isPlaying = true;
        this.activeSources.push(source);

        source.onended = () => {
            this.activeSources = this.activeSources.filter((item) => item !== source);
            if (this.activeSources.length === 0) {
                this.isPlaying = false;
            }
        };
    }

    reset() {
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        this.isBuffering = false;
        this.chunkQueue = [];
        this.activeSources.forEach((source) => {
            try { source.stop(); } catch {}
        });
        this.activeSources = [];
        this.nextStartTime = 0;
        this.isPlaying = false;
    }

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    _pcm16ToFloat32(buffer) {
        const view = new DataView(buffer);
        const float32 = new Float32Array(view.byteLength / 2);
        for (let i = 0; i < float32.length; i++) {
            const sample = view.getInt16(i * 2, true);
            float32[i] = sample < 0 ? sample / 32768 : sample / 32767;
        }
        return float32;
    }
}

class AzureVoiceSession {
    constructor(app) {
        this.app = app;
        this.peer = null;
        this.dataChannel = null;
        this.localStream = null;
        this.remoteAudio = document.getElementById('audio-player');
        this.connected = false;
        this.connecting = false;
        this.pendingToolCalls = new Set();
        this.supported = Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
        if (this.remoteAudio) {
            this.remoteAudio.autoplay = true;
            this.remoteAudio.playsInline = true;
        }
    }

    async connect() {
        if (this.connected || this.connecting) {
            return true;
        }

        this.connecting = true;
        this.app.setStatus('Connecting voice', 'paused', 'Opening Azure realtime session');

        try {
            const configRes = await this.app.apiFetch('/api/realtime/config');
            const config = await configRes.json();
            if (!config.enabled) {
                throw new Error('Azure realtime voice is not configured');
            }

            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
            } catch (err) {
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    this.app.handleMicPermissionError();
                }
                throw err;
            }

            this.peer = new RTCPeerConnection();
            this.localStream.getTracks().forEach((track) => this.peer.addTrack(track, this.localStream));

            this.peer.ontrack = (event) => {
                if (this.remoteAudio) {
                    this.remoteAudio.srcObject = event.streams[0];
                    this.remoteAudio.play().catch(() => {});
                }
            };

            this.peer.onconnectionstatechange = () => {
                if (this.peer.connectionState === 'connected') {
                    this.connected = true;
                    this.app.onVoiceSessionConnected();
                }
                if (['failed', 'closed', 'disconnected'].includes(this.peer.connectionState)) {
                    this.app.onVoiceSessionDisconnected();
                }
            };

            this.dataChannel = this.peer.createDataChannel('realtime-events');
            this.dataChannel.onopen = () => {
                this.syncSlideContext();
                this.requestResponse({
                    instructions: 'Greet the attendee right away in one short sentence, mention that you can answer questions or move between slides, then pause for their reply.'
                });
                this.app.setStatus('Mic is live', 'paused', 'The presenter is opening the conversation');
            };
            this.dataChannel.onmessage = (event) => this.handleEvent(event.data);

            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);

            const connectRes = await this.app.apiFetch('/api/realtime/connect', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.app.sessionId,
                    sdp: offer.sdp,
                    slideContext: this.app.getCurrentSlideContext()
                })
            });

            const connectBody = await connectRes.json();
            if (!connectRes.ok) {
                throw new Error(connectBody.error || 'Realtime connect failed');
            }

            await this.peer.setRemoteDescription({ type: 'answer', sdp: connectBody.sdp });
            this.connected = true;
            this.connecting = false;
            return true;
        } catch (error) {
            console.error('Azure realtime voice connect failed:', error);
            await this.disconnect();
            this.connecting = false;
            return false;
        }
    }

    async disconnect() {
        this.connected = false;
        this.connecting = false;
        if (this.dataChannel) {
            try { this.dataChannel.close(); } catch {}
        }
        if (this.peer) {
            try { this.peer.close(); } catch {}
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach((track) => track.stop());
        }
        if (this.remoteAudio) {
            this.remoteAudio.srcObject = null;
        }
        this.dataChannel = null;
        this.peer = null;
        this.localStream = null;
    }

    syncSlideContext() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        const context = this.app.getCurrentSlideContext();
        this.dataChannel.send(JSON.stringify({
            type: 'session.update',
            session: {
                instructions: this.app.buildVoiceInstructions(context),
                tool_choice: 'auto',
                tools: this.app.getRealtimeTools(),
                output_modalities: ['audio'],
                audio: {
                    input: {
                        transcription: { model: 'whisper-1' },
                        turn_detection: {
                            type: 'server_vad',
                            threshold: 0.45,
                            prefix_padding_ms: 250,
                            silence_duration_ms: 500,
                            create_response: false,
                            interrupt_response: true
                        }
                    }
                }
            }
        }));
    }

    handleEvent(rawEvent) {
        let event;
        try {
            event = JSON.parse(rawEvent);
        } catch {
            return;
        }

        switch (event.type) {
            case 'input_audio_buffer.speech_started':
                this.app.onVoiceTurnState('Listening', 'paused', 'Ask your question now. Tap the mic again to return to the presentation.');
                break;
            case 'input_audio_buffer.speech_stopped':
                this.app.onVoiceTurnState('Thinking', 'paused', 'Azure is preparing a spoken response');
                break;
            case 'response.output_audio_transcript.delta':
                this.app.handleNarrationDelta({ delta: event.delta, append: true });
                break;
            case 'conversation.item.input_audio_transcription.completed':
                this.app.showVoiceTranscript(event.transcript || '');
                this.requestResponse();
                break;
            case 'response.function_call_arguments.done':
                this.handleFunctionCall(event);
                break;
            case 'response.output_item.done':
                if (event.item?.type === 'function_call') {
                    this.handleFunctionCall({
                        call_id: event.item.call_id,
                        name: event.item.name,
                        arguments: event.item.arguments
                    });
                }
                break;
            case 'response.created':
                this.app.onVoiceTurnState('Answering now', 'live', 'Azure realtime voice is responding');
                break;
            case 'response.done':
                this.app.onVoiceTurnState('Mic is live', 'paused', 'Ask another question, or tap the mic again to return to the presentation.');
                this.app.showTranscript(false);
                break;
            case 'error':
                console.error('Realtime voice event error:', event);
                this.app.onVoiceTurnState('Voice error', 'paused', event.error?.message || 'Realtime voice failed');
                break;
            default:
                break;
        }
    }

    requestResponse(options = {}) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        this.dataChannel.send(JSON.stringify({
            type: 'response.create',
            response: {
                output_modalities: ['audio'],
                instructions: options.instructions || undefined
            }
        }));
    }

    async handleFunctionCall(event) {
        const callId = event.call_id;
        const name = event.name;
        if (!callId || !name || this.pendingToolCalls.has(callId)) {
            return;
        }

        this.pendingToolCalls.add(callId);

        let args = {};
        try {
            args = event.arguments ? JSON.parse(event.arguments) : {};
        } catch {
            args = {};
        }

        try {
            const output = await this.app.executeRealtimeTool(name, args);
            this.sendToolResult(callId, output);
        } catch (error) {
            this.sendToolResult(callId, {
                ok: false,
                error: error.message || 'Tool execution failed'
            });
        } finally {
            this.pendingToolCalls.delete(callId);
        }
    }

    sendToolResult(callId, output) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        this.dataChannel.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(output)
            }
        }));

        this.dataChannel.send(JSON.stringify({
            type: 'response.create',
            response: {
                output_modalities: ['audio']
            }
        }));
    }
}

class VoicePPTApp {
    constructor() {
        this.sessionId = null;
        this.controlToken = '';
        this.currentSlideIndex = 0;
        this.currentSlide = null;
        this.totalSlides = 0;
        this.participantName = '';
        this.isQAPhase = false;
        this.questions = new Map();
        this.pendingQuestionText = null;
        this.socketClient = null;
        this.streamPlayer = new StreamAudioPlayer();
        this.recognition = null;
        this.isListening = false;
        this.voiceModeEnabled = false;
        this.voiceTurnState = 'idle';
        this.currentStatus = { text: 'Connecting', state: '', detail: 'Preparing voice session' };
        this.azureVoice = new AzureVoiceSession(this);
        this.votes = new Map();
        this.userReactions = [];
        this.userQuestions = [];
        this.wrapUpTimer = null;
        this.wrapUpEndsAt = 0;
        this.wrapUpSelections = {};
        this.wrapUpMcqs = [];
        this.wrapUpIndex = 0;
        this.subtitleBuffer = '';
        this.subtitleReady = false;
        this.fullNarrationTranscript = '';
        this.presentationCatalog = [];
        this.awaitingPlaybackComplete = false;
        this.awaitingSlideContinue = false;

        this.waveformCanvas = document.getElementById('waveform');
        this.waveformCtx = this.waveformCanvas ? this.waveformCanvas.getContext('2d') : null;
        this.waveformData = new Array(64).fill(0);
        this.waveformAnimFrame = null;

        this.bindEvents();
        this.loadPresentationCatalog();
        this.setupSpeechRecognitionFallback();
        this.resizeWaveform();
    }

    buildApiHeaders(extraHeaders = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...extraHeaders
        };

        if (this.controlToken) {
            headers['X-Session-Control-Token'] = this.controlToken;
        }

        return headers;
    }

    apiFetch(url, options = {}) {
        const nextOptions = { ...options };
        nextOptions.headers = this.buildApiHeaders(options.headers || {});
        return fetch(url, nextOptions);
    }

    bindEvents() {
        document.getElementById('start-presentation').addEventListener('click', () => this.startSession());
        document.getElementById('participant-name').addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.startSession();
            }
        });
        document.getElementById('submit-question').addEventListener('click', () => this.submitQuestion());
        document.getElementById('question-input').addEventListener('keypress', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.submitQuestion();
            }
        });
        document.getElementById('chat-toggle').addEventListener('click', () => this.toggleQuestionDrawer(true));
        document.getElementById('qa-close').addEventListener('click', () => this.toggleQuestionDrawer(false));
        document.getElementById('qa-scrim').addEventListener('click', () => this.toggleQuestionDrawer(false));
        document.getElementById('restart-btn').addEventListener('click', () => location.reload());
        document.getElementById('interrupt-mic').addEventListener('click', () => this.handleInterruptMic());
        document.getElementById('slide-turn-mic').addEventListener('click', () => this.handleInterruptMic());
        document.getElementById('slide-turn-continue').addEventListener('click', () => this.continuePresentationFlow());
        document.getElementById('slide-question-send').addEventListener('click', () => this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' }));
        document.getElementById('slide-question-input').addEventListener('keypress', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' });
            }
        });
        document.getElementById('wrapup-prev').addEventListener('click', () => this.changeWrapUpCard(-1));
        document.getElementById('wrapup-next').addEventListener('click', () => this.changeWrapUpCard(1));

        const accordionToggle = document.getElementById('accordion-toggle');
        if (accordionToggle) {
            accordionToggle.addEventListener('click', () => {
                const accordion = document.getElementById('read-along-accordion');
                accordion.classList.toggle('is-open');
            });
        }

        // Mic permission modal events
        document.getElementById('mic-retry-btn').addEventListener('click', () => {
            document.getElementById('mic-permission-modal').classList.add('hidden');
            this.handleInterruptMic();
        });
        document.getElementById('mic-close-btn').addEventListener('click', () => {
            document.getElementById('mic-permission-modal').classList.add('hidden');
        });
        
        // Reaction Buttons
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.getAttribute('data-emoji');
                this.socketClient?.sendReaction(emoji);
                // Local feedback
                this.spawnReaction(emoji);
                this.userReactions.push({ emoji, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
            });
        });

        window.addEventListener('resize', () => this.resizeWaveform());
    }

    spawnReaction(emoji) {
        const container = document.querySelector('.presentation-stage');
        if (!container) return;

        // Map emoji to brand colors
        const colorMap = {
            '👏': '#344736', // Forest Green
            '❤️': '#86312b', // Rich Red
            '💡': '#ffc083'  // Warm Yellow
        };
        const color = colorMap[emoji] || '#342e29';

        // Create a burst of 3-5 emojis
        const count = 3 + Math.floor(Math.random() * 3);
        
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'floating-reaction';
            el.textContent = emoji;
            el.style.color = color;
            
            // Randomize start position slightly around the button area or bottom center
            const startX = window.innerWidth > 720 
                ? (window.innerWidth - 100 + (Math.random() * 60 - 30)) // Near right side on desktop
                : (window.innerWidth / 2 + (Math.random() * 100 - 50)); // Centerish on mobile
                
            const drift = (Math.random() * 120 - 60) + 'px';
            const rotation = (Math.random() * 40 - 20) + 'deg';
            const scale = 0.8 + Math.random() * 1.2;
            const duration = 1.5 + Math.random() * 1;
            const delay = Math.random() * 0.2;

            el.style.left = `${startX}px`;
            el.style.bottom = '100px';
            el.style.setProperty('--drift', drift);
            el.style.setProperty('--rotation', rotation);
            el.style.setProperty('--scale', scale);
            el.style.animation = `float-and-fade ${duration}s ease-out ${delay}s forwards`;

            container.appendChild(el);

            // Cleanup
            setTimeout(() => el.remove(), (duration + delay) * 1000);
        }
    }

    handleSignificantReactions(data) {
        const { counts, total } = data;
        const topEmoji = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (topEmoji && topEmoji[1] > 0) {
            this.setStatus('Vibe check', 'paused', `High engagement! ${topEmoji[1]} people just reacted with ${topEmoji[0]}`);
            setTimeout(() => this.restorePresentationStatus(), 4000);
        }
    }

    handleVotesSync(data) {
        const { votes } = data;
        if (votes) {
            Object.entries(votes).forEach(([mcqId, mcqVotes]) => {
                this.votes.set(mcqId, mcqVotes);
            });
            this.renderWrapUpMcqs();
        }
    }

    handleVoteUpdate(data) {
        const { mcqId, allVotes } = data;
        this.votes.set(mcqId, allVotes);
        this.renderWrapUpMcqs();
    }

    async loadPresentationCatalog() {
        try {
            const res = await fetch('/api/cms/presentations');
            const data = await res.json();
            if (!Array.isArray(data.presentations) || data.presentations.length === 0) {
                return;
            }

            this.presentationCatalog = data.presentations;
            const select = document.getElementById('deck-select');
            const previous = select.value;
            select.innerHTML = '';

            data.presentations.forEach((presentation) => {
                const option = document.createElement('option');
                option.value = presentation.id;
                option.textContent = presentation.title;
                select.appendChild(option);
            });

            const exists = data.presentations.some((presentation) => presentation.id === previous);
            if (exists) {
                select.value = previous;
            }
        } catch (error) {
            console.error('Presentation catalog load failed:', error);
        }
    }

    setupSpeechRecognitionFallback() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
            return;
        }

        this.recognition = new Recognition();
        this.recognition.lang = 'en-US';
        this.recognition.interimResults = true;
        this.recognition.continuous = false;

        this.recognition.onstart = () => {
            this.isListening = true;
            this.updateMicState();
            this.setStatus('Listening', 'paused', 'Browser speech recognition fallback is active');
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.updateMicState();
            if (!this.voiceModeEnabled) {
                this.restorePresentationStatus();
            }
        };

        this.recognition.onresult = (event) => {
            const transcript = Array.from(event.results).map((result) => result[0]?.transcript || '').join(' ').trim();
            document.getElementById('question-input').value = transcript;
            const last = event.results[event.results.length - 1];
            if (last?.isFinal && transcript) {
                this.submitQuestion(transcript, { interrupt: true, submittedBy: 'Voice Interrupt' });
            }
        };

        this.recognition.onerror = () => {
            this.isListening = false;
            this.updateMicState();
            this.setStatus('Mic unavailable', 'paused', 'Type your question on the right');
        };
    }

    async startSession() {
        const deckId = document.getElementById('deck-select').value;
        const nameInput = document.getElementById('participant-name');
        const participantName = (nameInput.value || '').trim();
        const btn = document.getElementById('start-presentation');

        if (!participantName) {
            nameInput.focus();
            this.setStatus('Add your name', 'paused', 'The presenter uses it to personalize the session');
            return;
        }

        btn.disabled = true;
        btn.querySelector('span:last-child').textContent = 'Starting...';

        try {
            const res = await this.apiFetch('/api/session/start', {
                method: 'POST',
                body: JSON.stringify({ deckId, participantName })
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to start');
            }

            this.sessionId = data.sessionId;
            this.controlToken = data.controlToken || '';
            this.totalSlides = data.slideCount || 0;
            this.participantName = data.participantName || participantName;
            this.awaitingSlideContinue = false;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = data.presentationTitle || deckId.replace(/_/g, ' ');

            await this.primeInitialSlide();
            this.connectSocket();
            this.enableInput();
            setTimeout(() => this.triggerAutoPlex(), 250);
        } catch (error) {
            console.error(error);
            btn.disabled = false;
            btn.querySelector('span:last-child').textContent = 'Start Presentation';
        }
    }

    connectSocket() {
        this.socketClient = new SocketClient(this);
        this.socketClient.connect(this.sessionId, this.controlToken);
    }

    async primeInitialSlide() {
        if (!this.sessionId) {
            return;
        }

        try {
            const res = await this.apiFetch(`/api/session/${this.sessionId}`);
            const data = await res.json();
            const metadata = this.parseSessionMetadata(data?.session?.metadata);
            this.participantName = data?.participantName || metadata.participantName || this.participantName;
            if (data?.currentSlide) {
                this.updateSlide({
                    slideIndex: data.session?.current_slide_index || 0,
                    totalSlides: data.session?.slide_count || this.totalSlides,
                    slide: data.currentSlide
                });
            }
        } catch (error) {
            console.error('Initial slide fetch failed:', error);
        }
    }

    async triggerAutoPlex() {
        try {
            await this.apiFetch('/api/autoplex', {
                method: 'POST',
                body: JSON.stringify({ sessionId: this.sessionId })
            });
        } catch (error) {
            console.error('AutoPlex trigger failed:', error);
        }
    }

    enableInput() {
        document.getElementById('question-input').disabled = false;
        document.getElementById('submit-question').disabled = false;
        this.setStatus('Ready', 'live', 'Ask anytime with text or mic');
        this.syncQuestionCount();
    }

    updateSlide(data) {
        this.currentSlideIndex = data.slideIndex;
        this.totalSlides = data.totalSlides || this.totalSlides;
        this.currentSlide = data.slide || null;
        this.closeSlideTurnOverlay();
        this.resetSubtitleState();
        this.fullNarrationTranscript = '';
        this.updateFullTranscriptionDisplay();
        document.getElementById('slide-counter').textContent = `${data.slideIndex + 1} / ${data.totalSlides || '?'}`;
        document.getElementById('slide-title').textContent = data.slide ? data.slide.title : '';
        document.getElementById('slide-subtitle').textContent = data.slide ? data.slide.content : '';
        
        const notesEl = document.getElementById('slide-notes');
        if (notesEl) {
            notesEl.innerHTML = data.slide && data.slide.notes 
                ? `<p>${data.slide.notes.replace(/\n/g, '<br>')}</p>`
                : '';
        }

        const stage = document.querySelector('.slide-visual-shell');
        const imageUrl = data.slide && data.slide.image ? data.slide.image : null;
        
        if (stage) {
            if (imageUrl) {
                stage.classList.add('blur-up');
                const img = new Image();
                img.onload = () => {
                    stage.style.backgroundImage = `url(${imageUrl})`;
                    stage.classList.remove('blur-up');
                    this.analyzeImageBrightness(imageUrl);
                };
                img.src = imageUrl;
            } else {
                stage.style.backgroundImage = 'none';
                stage.classList.remove('blur-up');
            }
        }

        // Reset scroll position
        const main = document.querySelector('.slide-main');
        if (main) main.scrollTop = 0;

        if (!this.voiceModeEnabled) {
            this.streamPlayer.reset();
            this.stopWaveform();
        }

        if (this.azureVoice.connected) {
            this.azureVoice.syncSlideContext();
        }
        this.updateFolio();
    }

    handleNarrationDelta(data) {
        if (data.append) {
            this.subtitleBuffer = `${this.subtitleBuffer} ${data.delta || ''}`.trim();
            this.fullNarrationTranscript = `${this.fullNarrationTranscript}${data.delta || ''}`;
        } else {
            this.subtitleBuffer = String(data.full || data.delta || '').trim();
            this.fullNarrationTranscript = String(data.full || data.delta || '');
        }
        this.renderSubtitle();
        this.updateFullTranscriptionDisplay();
    }

    handleAudioChunk(data) {
        if (this.voiceModeEnabled && this.azureVoice.connected) {
            return;
        }
        this.awaitingPlaybackComplete = true;
        this.subtitleReady = true;
        this.renderSubtitle();
        this.streamPlayer.playChunk(data.chunk, data.sampleRate, data.channels);
        this.startWaveform();
    }

    handleAudioEnd() {
        this.showTranscript(false);
        this.subtitleReady = false;
        this.waitForPlaybackFinish();
    }

    waitForPlaybackFinish() {
        const poll = () => {
            if (this.streamPlayer.isPlaying) {
                setTimeout(poll, 120);
                return;
            }

            this.stopWaveform();
            if (this.awaitingPlaybackComplete) {
                this.awaitingPlaybackComplete = false;
                this.socketClient?.notifyPlaybackComplete(this.sessionId);
            }
        };

        setTimeout(poll, 120);
    }

    showTranscript(speaking) {
        const bar = document.getElementById('transcript-bar');
        bar.classList.toggle('visible', speaking);
    }

    showVoiceTranscript(text) {
        if (!text) {
            return;
        }
        this.subtitleBuffer = String(text).trim();
        this.subtitleReady = true;
        this.renderSubtitle();
    }

    renderSubtitle() {
        const text = this.compactSubtitle(this.subtitleBuffer);
        document.getElementById('transcript-text').textContent = text;
        this.showTranscript(Boolean(text) && this.subtitleReady);
    }

    updateFullTranscriptionDisplay() {
        const el = document.getElementById('full-transcription');
        if (el) {
            el.textContent = this.fullNarrationTranscript.trim() || 'No transcription yet...';
        }
    }

    setSubtitleText(text, ready = false) {
        this.subtitleBuffer = String(text || '').trim();
        if (ready) {
            this.subtitleReady = true;
        }
        this.renderSubtitle();
    }

    finalizeSubtitleText(text) {
        if (this.subtitleBuffer.trim()) {
            return;
        }
        this.setSubtitleText(text);
    }

    resetSubtitleState() {
        this.subtitleBuffer = '';
        this.subtitleReady = false;
        document.getElementById('transcript-text').textContent = '';
        this.showTranscript(false);
    }

    compactSubtitle(text) {
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (!cleaned) {
            return '';
        }
        const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
        const lastTwo = sentences.slice(-2).join(' ');
        const compact = (lastTwo || cleaned).trim();
        return compact.length > 180 ? compact.slice(-180).trimStart() : compact;
    }

    async analyzeImageBrightness(imageUrl) {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 10; 
            canvas.height = 10;
            ctx.drawImage(img, 0, 0, 10, 10);
            const imageData = ctx.getImageData(0, 0, 10, 10).data;
            let totalBrightness = 0;
            for (let i = 0; i < imageData.length; i += 4) {
                totalBrightness += (imageData[i] + imageData[i+1] + imageData[i+2]) / 3;
            }
            const avgBrightness = totalBrightness / (imageData.length / 4);
            const copy = document.querySelector('.slide-copy');
            if (avgBrightness > 128) {
                copy.classList.remove('theme-dark');
                copy.classList.add('theme-light');
            } else {
                copy.classList.remove('theme-light');
                copy.classList.add('theme-dark');
            }
        };
    }

    updateFolio() {
        const dateEl = document.getElementById('folio-date');
        const deckEl = document.getElementById('folio-deck');
        const pageEl = document.getElementById('folio-page');
        
        if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        if (deckEl) deckEl.textContent = document.getElementById('deck-label').textContent;
        if (pageEl) pageEl.textContent = `PAGE ${this.currentSlideIndex + 1} OF ${this.totalSlides || '?'}`;
    }

    handleMicPermissionError() {
        document.getElementById('mic-permission-modal').classList.remove('hidden');
    }

    async submitQuestion(forcedText, options = {}) {
        const input = options.source === 'slide-turn'
            ? document.getElementById('slide-question-input')
            : document.getElementById('question-input');
        const text = (typeof forcedText === 'string' ? forcedText : input.value).trim();
        if (!text || !this.sessionId) {
            return;
        }

        if (options.interrupt) {
            await this.requestInterrupt();
            this.setStatus('Thinking', 'paused', 'Routing your interruption to the presenter');
        }

        this.pendingQuestionText = text;

        try {
            const res = await fetch('/api/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    questionText: text,
                    submittedBy: options.submittedBy || (options.interrupt ? 'Voice Interrupt' : 'Audience')
                })
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to submit question');
            }

            input.value = '';
            this.pendingQuestionText = null;
            if (options.queueForEnd) {
                this.setStatus('Saved for final Q&A', 'paused', 'The presenter will answer this after the last slide');
                document.getElementById('slide-turn-note').textContent = 'Saved. This question is now queued for the final Q&A.';
            } else {
                this.setStatus('Question queued', 'paused', 'Presenter will answer shortly');
            }
            this.userQuestions.push({ text, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
            this.toggleQuestionDrawer(true);
        } catch (error) {
            console.error('Question submit error:', error);
            this.pendingQuestionText = null;
            this.setStatus('Question failed', 'paused', 'Please retry');
        }
    }

    addQuestionToList(id, text, submittedBy = 'Audience') {
        if (this.questions.has(id)) {
            return;
        }

        this.questions.set(id, { id, text, status: 'pending' });
        this.syncQuestionCount();
        const list = document.getElementById('qa-list');
        const empty = list.querySelector('.qa-empty');
        if (empty) {
            empty.remove();
        }

        const item = document.createElement('div');
        item.className = 'qa-item pending';
        item.id = `q-${id}`;
        item.innerHTML = `<div class="qa-question">${this.escapeHtml(text)}</div><div class="qa-meta">${this.escapeHtml(submittedBy)} · just now</div>`;
        list.appendChild(item);
        list.scrollTop = list.scrollHeight;
    }

    markQuestionAnswered(questionId, answer, questionText) {
        const item = document.getElementById(`q-${questionId}`);
        if (!item) {
            this.addQuestionToList(questionId, questionText || 'Question', 'Audience');
        }

        const target = document.getElementById(`q-${questionId}`);
        if (!target) {
            return;
        }

        const question = this.questions.get(questionId);
        if (question) {
            question.status = 'answered';
        }

        target.classList.remove('pending');
        target.classList.add('answered');

        let answerNode = target.querySelector('.qa-answer');
        if (!answerNode) {
            answerNode = document.createElement('div');
            answerNode.className = 'qa-answer';
            target.appendChild(answerNode);
        }
        answerNode.textContent = answer;
        this.syncQuestionCount();
    }

    handleQueueUpdate(data) {
        if (data.questionId && data.status === 'answered') {
            const question = this.questions.get(data.questionId);
            if (question) {
                question.status = 'answered';
            }
            const item = document.getElementById(`q-${data.questionId}`);
            if (item) {
                item.classList.remove('pending');
                item.classList.add('answered');
            }
        }
        this.syncQuestionCount();
    }

    toggleQuestionDrawer(forceOpen) {
        const panel = document.getElementById('qa-panel');
        const scrim = document.getElementById('qa-scrim');
        const open = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        scrim.classList.toggle('hidden', !open);
        if (open) {
            document.getElementById('question-input').focus();
        }
    }

    syncQuestionCount() {
        const total = this.questions.size;
        const pending = Array.from(this.questions.values()).filter((q) => q.status !== 'answered').length;
        document.getElementById('qa-count').textContent = total;
        document.getElementById('qa-count-badge').textContent = pending;
        document.getElementById('qa-count-badge').classList.toggle('is-zero', pending === 0);
    }

    async handleInterruptMic() {
        if (this.voiceModeEnabled) {
            await this.stopVoiceMode();
            return;
        }

        await this.requestInterrupt();
        await this.pauseAutoplex(true);

        const connected = await this.azureVoice.connect();
        if (connected) {
            this.voiceModeEnabled = true;
            this.updateMicState();
            return;
        }

        await this.pauseAutoplex(false);

        if (!this.recognition) {
            document.getElementById('question-input').focus();
            this.setStatus('Type your interruption', 'paused', 'Azure voice is unavailable. Speech recognition is not supported here.');
            return;
        }

        try {
            this.recognition.start();
        } catch (error) {
            console.error('Speech recognition start failed:', error);
            this.setStatus('Mic unavailable', 'paused', 'Type your question on the right');
        }
    }

    async stopVoiceMode() {
        this.voiceModeEnabled = false;
        await this.azureVoice.disconnect();
        await this.pauseAutoplex(false);
        this.updateMicState();
        this.restorePresentationStatus();
    }

    async continuePresentationFlow() {
        if (!this.sessionId) {
            return;
        }

        try {
            await this.apiFetch('/api/autoplex/continue', {
                method: 'POST',
                body: JSON.stringify({ sessionId: this.sessionId })
            });
            this.closeSlideTurnOverlay();
            this.setStatus('Presenting', 'live', 'Voice narration is live');
        } catch (error) {
            console.error('Continue presentation failed:', error);
        }
    }

    async requestInterrupt() {
        this.streamPlayer.reset();
        this.stopWaveform();
        this.showTranscript(false);

        if (!this.sessionId) {
            return;
        }

        try {
            await this.apiFetch('/api/autoplex/interrupt', {
                method: 'POST',
                body: JSON.stringify({ sessionId: this.sessionId })
            });
        } catch (error) {
            console.error('Interrupt request failed:', error);
        }
    }

    async pauseAutoplex(paused) {
        if (!this.sessionId) {
            return;
        }
        try {
            await this.apiFetch(`/api/autoplex/${paused ? 'pause' : 'resume'}`, {
                method: 'POST',
                body: JSON.stringify({ sessionId: this.sessionId })
            });
        } catch (error) {
            console.error('Autoplex pause toggle failed:', error);
        }
    }

    getCurrentSlideContext() {
        return {
            deckLabel: document.getElementById('deck-label').textContent,
            participantName: this.participantName,
            title: this.currentSlide?.title || document.getElementById('slide-title').textContent,
            subtitle: this.currentSlide?.content || document.getElementById('slide-subtitle').textContent,
            notes: this.currentSlide?.notes || '',
            slideIndex: this.currentSlideIndex,
            totalSlides: this.totalSlides
        };
    }

    openSlideTurnOverlay(data = {}) {
        this.awaitingSlideContinue = true;
        document.getElementById('slide-turn-overlay').classList.remove('hidden');
        document.getElementById('slide-turn-detail').textContent = 'Ask the presenter a question, or continue to the next slide.';
        document.getElementById('slide-question-input').value = '';
        this.updateMicState();
    }

    closeSlideTurnOverlay() {
        this.awaitingSlideContinue = false;
        const overlay = document.getElementById('slide-turn-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    getRealtimeTools() {
        return [
            {
                type: 'function',
                name: 'advance_slide',
                description: 'Move the presentation one slide forward or backward when the attendee asks.',
                parameters: {
                    type: 'object',
                    properties: {
                        direction: {
                            type: 'string',
                            enum: ['next', 'previous']
                        }
                    },
                    required: ['direction'],
                    additionalProperties: false
                }
            },
            {
                type: 'function',
                name: 'go_to_slide',
                description: 'Jump to a specific slide number when the attendee references one.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_number: {
                            type: 'integer',
                            minimum: 1
                        }
                    },
                    required: ['slide_number'],
                    additionalProperties: false
                }
            },
            {
                type: 'function',
                name: 'resume_presentation',
                description: 'Resume the main presentation flow and leave interruption mode.',
                parameters: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            }
        ];
    }

    async advanceSlideByVoice(direction) {
        if (!this.sessionId) {
            return false;
        }

        try {
            const res = await this.apiFetch('/api/slide/advance', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    direction
                })
            });
            if (!res.ok) {
                return false;
            }

            const data = await res.json();
            if (data?.slide) {
                this.updateSlide({
                    slideIndex: data.slideIndex,
                    totalSlides: this.totalSlides,
                    slide: data.slide
                });
            }
            return Boolean(data?.success);
        } catch (error) {
            console.error('Voice slide advance failed:', error);
            return false;
        }
    }

    async goToSlideByVoice(slideNumber) {
        if (!this.sessionId) {
            return false;
        }

        const targetSlide = Number(slideNumber) - 1;
        if (!Number.isInteger(targetSlide) || targetSlide < 0) {
            return false;
        }

        try {
            const res = await this.apiFetch('/api/slide/advance', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    targetSlide
                })
            });
            if (!res.ok) {
                return false;
            }

            const data = await res.json();
            if (data?.slide) {
                this.updateSlide({
                    slideIndex: data.slideIndex,
                    totalSlides: this.totalSlides,
                    slide: data.slide
                });
            }
            return Boolean(data?.success);
        } catch (error) {
            console.error('Voice go-to-slide failed:', error);
            return false;
        }
    }

    async executeRealtimeTool(name, args = {}) {
        switch (name) {
            case 'advance_slide': {
                const direction = args.direction === 'previous' ? 'previous' : 'next';
                if (direction === 'next') {
                    await this.stopVoiceMode();
                    await this.continuePresentationFlow();
                    return {
                        ok: true,
                        action: 'advance_slide',
                        direction,
                        handoff: 'presentation'
                    };
                }

                const moved = await this.advanceSlideByVoice(direction);
                if (moved) {
                    this.setStatus('Moved back', 'paused', 'Returned to the previous slide');
                    this.azureVoice.syncSlideContext();
                }
                return {
                    ok: moved,
                    action: 'advance_slide',
                    direction,
                    current_slide_index: this.currentSlideIndex,
                    current_slide_title: this.currentSlide?.title || ''
                };
            }
            case 'go_to_slide': {
                const moved = await this.goToSlideByVoice(args.slide_number);
                if (moved) {
                    this.setStatus('Jumped to slide', 'paused', `Now on slide ${this.currentSlideIndex + 1}`);
                    this.azureVoice.syncSlideContext();
                }
                return {
                    ok: moved,
                    action: 'go_to_slide',
                    requested_slide_number: args.slide_number,
                    current_slide_index: this.currentSlideIndex,
                    current_slide_title: this.currentSlide?.title || ''
                };
            }
            case 'resume_presentation':
                await this.stopVoiceMode();
                await this.continuePresentationFlow();
                return {
                    ok: true,
                    action: 'resume_presentation'
                };
            default:
                return {
                    ok: false,
                    error: `Unknown tool: ${name}`
                };
        }
    }

    buildVoiceInstructions(context) {
        return [
            'You are the live presenter of a deck.',
            'Answer the user in a natural spoken voice with short, emotionally intelligent sentences.',
            'When the mic opens, greet the attendee briefly and naturally, then continue the conversation.',
            'Wait for the attendee to ask a question before answering.',
            'Do not narrate the whole slide unless the user asks.',
            'Treat interruptions as live audience questions and answer immediately.',
            'If the attendee explicitly asks to change slides, jump to a numbered slide, or continue the presentation, use the available navigation tool.',
            'Only use the provided deck context and notes. Do not invent facts.',
            'If the deck does not provide an answer, say that clearly and stay cautious.',
            context.participantName ? `The attendee you are speaking to is ${context.participantName}. Use their name naturally once in a while, not in every response.` : '',
            context.deckLabel ? `Deck: ${context.deckLabel}.` : '',
            context.title ? `Current slide title: ${context.title}.` : '',
            context.subtitle ? `Visible slide text: ${context.subtitle}.` : '',
            context.notes ? `Presenter notes: ${context.notes}.` : '',
            `You are on slide ${Number.isInteger(context.slideIndex) ? context.slideIndex + 1 : '?'} of ${context.totalSlides || '?'}.`,
            'Keep the conversation grounded in the current slide.'
        ].filter(Boolean).join(' ');
    }

    parseSessionMetadata(rawMetadata) {
        if (!rawMetadata) {
            return {};
        }
        if (typeof rawMetadata === 'object') {
            return rawMetadata;
        }
        try {
            return JSON.parse(rawMetadata);
        } catch {
            return {};
        }
    }

    onVoiceSessionConnected() {
        this.voiceModeEnabled = true;
        this.updateMicState();
        this.setStatus('Mic is live', 'paused', 'Ask a question, or tap the mic again to return to the presentation.');
    }

    onVoiceSessionDisconnected() {
        const wasEnabled = this.voiceModeEnabled;
        this.voiceModeEnabled = false;
        this.updateMicState();
        if (wasEnabled) {
            this.pauseAutoplex(false);
            this.setStatus('Voice ended', 'paused', 'Returning to presentation mode');
        }
    }

    onVoiceTurnState(text, state, detail) {
        this.setStatus(text, state, detail);
    }

    updateMicState() {
        const button = document.getElementById('interrupt-mic');
        const label = document.getElementById('interrupt-label');
        const slideTurnMic = document.getElementById('slide-turn-mic');
        const slideTurnMicLabel = document.getElementById('slide-turn-mic-label');
        button.classList.toggle('listening', this.isListening || (this.voiceModeEnabled && this.azureVoice.connected));
        button.classList.toggle('armed', this.voiceModeEnabled && !this.azureVoice.connected);
        label.textContent = this.voiceModeEnabled ? 'End Voice' : this.isListening ? 'Listening...' : 'Interrupt';
        if (slideTurnMic) {
            slideTurnMic.classList.toggle('is-live', this.isListening || (this.voiceModeEnabled && this.azureVoice.connected));
        }
        if (slideTurnMicLabel) {
            slideTurnMicLabel.textContent = this.voiceModeEnabled ? 'End Voice Session' : 'Talk To Presenter';
        }
    }

    setStatus(text, state, detail = '') {
        this.currentStatus = { text, state, detail };
        document.getElementById('status-text').textContent = text;
        document.getElementById('status-detail').textContent = detail;
        const dot = document.getElementById('status-dot');
        dot.className = 'status-dot';
        if (state === 'live') {
            dot.classList.add('live');
        } else if (state === 'paused') {
            dot.classList.add('paused');
        }
    }

    restorePresentationStatus() {
        if (this.voiceModeEnabled) {
            this.setStatus('Mic is live', 'paused', 'Ask a question, or tap the mic again to return to the presentation.');
            return;
        }
        if (this.wrapUpEndsAt > Date.now()) {
            this.setStatus('Final questions', 'paused', 'Hit the mic icon or use the quick prompts before we close');
            return;
        }
        if (this.awaitingSlideContinue) {
            this.setStatus('Your turn', 'paused', 'Ask now, save a question for later, or continue to the next slide');
            return;
        }
        if (this.isQAPhase) {
            this.setStatus('Q&A', 'paused', 'Audience interruptions are being answered');
            return;
        }
        this.setStatus('Presenting', 'live', 'Voice narration is live');
    }

    startWrapUp(data = {}) {
        this.wrapUpSelections = {};
        this.wrapUpMcqs = Array.isArray(data.mcqs) ? data.mcqs : [];
        this.wrapUpIndex = 0;
        this.wrapUpEndsAt = Number(data.endsAt) || (Date.now() + 60000);
        this.renderWrapUpMcqs();
        document.getElementById('wrapup-message').textContent = data.promptText || 'You have one minute to ask questions. Hit the mic icon at the bottom if you want to interrupt live.';
        document.getElementById('wrapup-panel').classList.remove('hidden');
        document.getElementById('completion-overlay').classList.remove('hidden');
        this.setStatus('Final questions', 'paused', 'Hit the mic icon or use the quick prompts before we close');
        this.tickWrapUpTimer();
        if (this.wrapUpTimer) {
            clearInterval(this.wrapUpTimer);
        }
        this.wrapUpTimer = setInterval(() => this.tickWrapUpTimer(), 1000);
    }

    finishWrapUp() {
        this.wrapUpEndsAt = 0;
        if (this.wrapUpTimer) {
            clearInterval(this.wrapUpTimer);
            this.wrapUpTimer = null;
        }
        document.getElementById('wrapup-timer').textContent = '0:00';
        document.getElementById('wrapup-deadline').textContent = 'Agent has ended';
        document.getElementById('wrapup-message').textContent = 'The final question window has closed.';
    }

    showCompletion(data) {
        document.getElementById('completion-summary').textContent = `${data.totalSlides} slides narrated. ${data.totalQuestionsAnswered} questions answered.`;
        if (!this.wrapUpEndsAt || this.wrapUpEndsAt <= Date.now()) {
            document.getElementById('wrapup-panel').classList.add('hidden');
        }
        
        // Store activity for digest
        const activity = {
            participantName: this.participantName,
            deckTitle: document.getElementById('deck-label').textContent,
            totalSlides: data.totalSlides,
            questionsAnswered: data.totalQuestionsAnswered,
            userQuestions: this.userQuestions,
            userReactions: this.userReactions,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem(`digest_${this.sessionId}`, JSON.stringify(activity));
        
        const storyBtn = document.createElement('button');
        storyBtn.className = 'btn-primary story-btn';
        storyBtn.innerHTML = '<span>📖</span> <span>View Your Session Story</span>';
        storyBtn.style.marginTop = '20px';
        storyBtn.onclick = () => window.location.href = `digest.html?sessionId=${this.sessionId}`;
        
        const summaryCont = document.getElementById('completion-summary');
        summaryCont.parentNode.insertBefore(storyBtn, summaryCont.nextSibling);

        document.getElementById('completion-overlay').classList.remove('hidden');
        this.stopWaveform();
    }

    tickWrapUpTimer() {
        const remainingMs = Math.max(0, this.wrapUpEndsAt - Date.now());
        const totalSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        document.getElementById('wrapup-timer').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
        document.getElementById('wrapup-deadline').textContent = `Agent ends in ${totalSeconds} seconds`;
        if (remainingMs <= 0 && this.wrapUpTimer) {
            clearInterval(this.wrapUpTimer);
            this.wrapUpTimer = null;
        }
    }

    renderWrapUpMcqs() {
        const container = document.getElementById('wrapup-mcqs');
        container.innerHTML = '';
        const mcq = this.wrapUpMcqs[this.wrapUpIndex];
        document.getElementById('wrapup-progress').textContent = this.wrapUpMcqs.length
            ? `${this.wrapUpIndex + 1} / ${this.wrapUpMcqs.length}`
            : '0 / 0';
        document.getElementById('wrapup-prev').disabled = this.wrapUpIndex <= 0;
        document.getElementById('wrapup-next').disabled = this.wrapUpIndex >= this.wrapUpMcqs.length - 1;

        if (!mcq) {
            return;
        }

        const card = document.createElement('div');
        card.className = 'wrapup-card';

        const title = document.createElement('div');
        title.className = 'wrapup-card-title';
        title.textContent = mcq.prompt;
        card.appendChild(title);

        const options = document.createElement('div');
        options.className = 'wrapup-options';

        const votes = this.votes.get(mcq.id) || {};
        const totalVotes = Object.values(votes).reduce((sum, v) => sum + v, 0);

        (mcq.options || []).forEach((option, idx) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wrapup-option';
            
            const voteCount = votes[option] || 0;
            const percentage = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
            
            // Brand colors for bars
            const colors = ['#344736', '#86312b', '#ffc083', '#002140'];
            const color = colors[idx % colors.length];

            button.innerHTML = `
                <span class="option-text">${option}</span>
                <div class="option-bar-bg">
                    <div class="option-bar" style="width: ${percentage}%; background-color: ${color}"></div>
                </div>
                <span class="option-count">${voteCount}</span>
            `;

            if (this.wrapUpSelections[mcq.id] === option) {
                button.classList.add('is-selected');
            }

            button.addEventListener('click', () => {
                if (this.wrapUpSelections[mcq.id] === option) return;
                this.wrapUpSelections[mcq.id] = option;
                this.socketClient?.submitVote(mcq.id, option);
                this.renderWrapUpMcqs();
            });
            options.appendChild(button);
        });

        card.appendChild(options);
        container.appendChild(card);
    }

    changeWrapUpCard(direction) {
        if (!this.wrapUpMcqs.length) {
            return;
        }
        const nextIndex = this.wrapUpIndex + direction;
        if (nextIndex < 0 || nextIndex >= this.wrapUpMcqs.length) {
            return;
        }
        this.wrapUpIndex = nextIndex;
        this.renderWrapUpMcqs();
    }

    resizeWaveform() {
        if (!this.waveformCanvas || !this.waveformCtx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const rect = this.waveformCanvas.getBoundingClientRect();
        this.waveformCanvas.width = Math.max(1, rect.width * dpr);
        this.waveformCanvas.height = Math.max(1, rect.height * dpr);
        this.waveformCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.waveformCtx.scale(dpr, dpr);
        this.drawWaveformFrame();
    }

    startWaveform() {
        if (this.waveformAnimFrame) {
            return;
        }
        this.waveformCanvas.classList.add('active');
        const animate = () => {
            this.updateWaveformData();
            this.drawWaveformFrame();
            this.waveformAnimFrame = requestAnimationFrame(animate);
        };
        animate();
    }

    stopWaveform() {
        if (this.waveformAnimFrame) {
            cancelAnimationFrame(this.waveformAnimFrame);
            this.waveformAnimFrame = null;
        }
        this.waveformData = new Array(64).fill(0);
        this.drawWaveformFrame();
        setTimeout(() => {
            if (!this.waveformAnimFrame) {
                this.waveformCanvas.classList.remove('active');
            }
        }, 250);
    }

    updateWaveformData() {
        if (this.streamPlayer.analyserNode && this.streamPlayer.isPlaying) {
            const dataArray = new Uint8Array(this.streamPlayer.analyserNode.frequencyBinCount);
            this.streamPlayer.analyserNode.getByteFrequencyData(dataArray);
            
            for (let i = 0; i < Math.min(this.waveformData.length, dataArray.length); i++) {
                const val = dataArray[i] / 255.0;
                this.waveformData[i] += (val - this.waveformData[i]) * 0.2;
            }
        } else {
            const t = performance.now() / 1000;
            const playing = this.streamPlayer.isPlaying || this.voiceModeEnabled;
            for (let i = 0; i < this.waveformData.length; i++) {
                const base = playing ? Math.sin(t * 1.7 + i * 0.25) * 0.12 : 0;
                const wave = playing ? Math.sin(t * 4 + i * 0.55) * 0.22 : 0;
                const target = playing ? base + wave + Math.random() * 0.12 + 0.18 : 0.02;
                this.waveformData[i] += (target - this.waveformData[i]) * (playing ? 0.14 : 0.08);
            }
        }
    }

    drawWaveformFrame() {
        if (!this.waveformCtx || !this.waveformCanvas) {
            return;
        }

        const ctx = this.waveformCtx;
        const width = this.waveformCanvas.getBoundingClientRect().width;
        const height = this.waveformCanvas.getBoundingClientRect().height;
        ctx.clearRect(0, 0, width, height);

        const barCount = this.waveformData.length;
        const slot = width / barCount;
        const barWidth = slot * 0.52;

        for (let i = 0; i < barCount; i++) {
            const value = Math.min(Math.abs(this.waveformData[i]), 1);
            const barHeight = Math.max(value * height * 0.82, 2);
            const x = i * slot + (slot - barWidth) / 2;
            const y = (height - barHeight) / 2;
            ctx.fillStyle = this.voiceModeEnabled
                ? `rgba(159, 216, 209, ${0.3 + value * 0.6})`
                : this.isQAPhase
                    ? `rgba(159, 216, 209, ${0.32 + value * 0.6})`
                    : `rgba(241, 194, 125, ${0.26 + value * 0.64})`;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
            ctx.fill();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new VoicePPTApp();
});
