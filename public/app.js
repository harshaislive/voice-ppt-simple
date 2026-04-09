class StreamAudioPlayer {
    constructor() {
        this.audioContext = null;
        this.nextStartTime = 0;
        this.isPlaying = false;
        this.sampleRate = 24000;
        this.playbackRate = 0.9;
        this.gainNode = null;
        this.activeSources = [];
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
            const configRes = await fetch('/api/realtime/config');
            const config = await configRes.json();
            if (!config.enabled) {
                throw new Error('Azure realtime voice is not configured');
            }

            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

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
                this.app.setStatus('Mic is live', 'paused', 'Ask a question, or tap the mic again to return to the presentation.');
            };
            this.dataChannel.onmessage = (event) => this.handleEvent(event.data);

            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);

            const connectRes = await fetch('/api/realtime/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                this.requestResponse();
                this.app.onVoiceTurnState('Thinking', 'paused', 'Azure is preparing a spoken response');
                break;
            case 'response.output_audio_transcript.delta':
                this.app.handleNarrationDelta({ delta: event.delta, append: true });
                break;
            case 'conversation.item.input_audio_transcription.completed':
                this.app.showVoiceTranscript(event.transcript || '');
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

    requestResponse() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

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
        this.wrapUpTimer = null;
        this.wrapUpEndsAt = 0;
        this.wrapUpSelections = {};
        this.wrapUpMcqs = [];
        this.wrapUpIndex = 0;
        this.subtitleBuffer = '';
        this.subtitleReady = false;
        this.presentationCatalog = [];

        this.waveformCanvas = document.getElementById('waveform');
        this.waveformCtx = this.waveformCanvas ? this.waveformCanvas.getContext('2d') : null;
        this.waveformData = new Array(64).fill(0);
        this.waveformAnimFrame = null;

        this.bindEvents();
        this.loadPresentationCatalog();
        this.setupSpeechRecognitionFallback();
        this.resizeWaveform();
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
        document.getElementById('wrapup-prev').addEventListener('click', () => this.changeWrapUpCard(-1));
        document.getElementById('wrapup-next').addEventListener('click', () => this.changeWrapUpCard(1));
        window.addEventListener('resize', () => this.resizeWaveform());
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
            const res = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deckId, participantName })
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to start');
            }

            this.sessionId = data.sessionId;
            this.totalSlides = data.slideCount || 0;
            this.participantName = data.participantName || participantName;
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
        this.socketClient.connect(this.sessionId);
    }

    async primeInitialSlide() {
        if (!this.sessionId) {
            return;
        }

        try {
            const res = await fetch(`/api/session/${this.sessionId}`);
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
            await fetch('/api/autoplex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        this.resetSubtitleState();
        document.getElementById('slide-counter').textContent = `${data.slideIndex + 1} / ${data.totalSlides || '?'}`;
        document.getElementById('slide-title').textContent = data.slide ? data.slide.title : '';
        document.getElementById('slide-subtitle').textContent = data.slide ? data.slide.content : '';

        const stage = document.querySelector('.slide-visual-shell');
        const image = data.slide && data.slide.image ? `url(${data.slide.image})` : 'none';
        stage.style.backgroundImage = image;

        if (!this.voiceModeEnabled) {
            this.streamPlayer.reset();
            this.stopWaveform();
        }

        if (this.azureVoice.connected) {
            this.azureVoice.syncSlideContext();
        }
    }

    handleNarrationDelta(data) {
        if (data.append) {
            this.subtitleBuffer = `${this.subtitleBuffer} ${data.delta || ''}`.trim();
        } else {
            this.subtitleBuffer = String(data.full || data.delta || '').trim();
        }
        this.renderSubtitle();
    }

    handleAudioChunk(data) {
        if (this.voiceModeEnabled && this.azureVoice.connected) {
            return;
        }
        this.subtitleReady = true;
        this.renderSubtitle();
        this.streamPlayer.playChunk(data.chunk, data.sampleRate, data.channels);
        this.startWaveform();
    }

    handleAudioEnd() {
        this.showTranscript(false);
        this.subtitleReady = false;
        setTimeout(() => {
            if (!this.streamPlayer.isPlaying) {
                this.stopWaveform();
            }
        }, 400);
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

    async submitQuestion(forcedText, options = {}) {
        const input = document.getElementById('question-input');
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
            this.setStatus('Question queued', 'paused', 'Presenter will answer shortly');
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

    async requestInterrupt() {
        this.streamPlayer.reset();
        this.stopWaveform();
        this.showTranscript(false);

        if (!this.sessionId) {
            return;
        }

        try {
            await fetch('/api/autoplex/interrupt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            await fetch(`/api/autoplex/${paused ? 'pause' : 'resume'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    buildVoiceInstructions(context) {
        return [
            'You are the live presenter of a deck.',
            'Answer the user in a natural spoken voice with short, emotionally intelligent sentences.',
            'Do not speak first when the mic opens.',
            'Wait for the attendee to ask a question before answering.',
            'Do not narrate the whole slide unless the user asks.',
            'Treat interruptions as live audience questions and answer immediately.',
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
        button.classList.toggle('listening', this.isListening || (this.voiceModeEnabled && this.azureVoice.connected));
        button.classList.toggle('armed', this.voiceModeEnabled && !this.azureVoice.connected);
        label.textContent = this.voiceModeEnabled ? 'End Voice' : this.isListening ? 'Listening...' : 'Interrupt';
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

        (mcq.options || []).forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wrapup-option';
            button.textContent = option;
            if (this.wrapUpSelections[mcq.id] === option) {
                button.classList.add('is-selected');
            }
            button.addEventListener('click', () => {
                this.wrapUpSelections[mcq.id] = option;
                Array.from(options.children).forEach((node) => node.classList.remove('is-selected'));
                button.classList.add('is-selected');
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
        const t = performance.now() / 1000;
        const playing = this.streamPlayer.isPlaying || this.voiceModeEnabled;
        for (let i = 0; i < this.waveformData.length; i++) {
            const base = playing ? Math.sin(t * 1.7 + i * 0.25) * 0.12 : 0;
            const wave = playing ? Math.sin(t * 4 + i * 0.55) * 0.22 : 0;
            const target = playing ? base + wave + Math.random() * 0.12 + 0.18 : 0.02;
            this.waveformData[i] += (target - this.waveformData[i]) * (playing ? 0.14 : 0.08);
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
