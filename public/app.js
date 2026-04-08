class StreamAudioPlayer {
    constructor() {
        this.audioContext = null;
        this.nextStartTime = 0;
        this.isPlaying = false;
        this.sampleRate = 24000;
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
        source.connect(this.gainNode);

        const now = this.audioContext.currentTime;
        const startTime = Math.max(now, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + buffer.duration;
        this.isPlaying = true;
        this.activeSources.push(source);

        source.onended = () => {
            this.activeSources = this.activeSources.filter(s => s !== source);
            if (this.activeSources.length === 0) {
                this.isPlaying = false;
            }
        };
    }

    reset() {
        this.activeSources.forEach(s => { try { s.stop(); } catch {} });
        this.activeSources = [];
        this.nextStartTime = 0;
        this.isPlaying = false;
    }

    setVolume(v) {
        this._ensureContext();
        this.gainNode.gain.value = Math.max(0, Math.min(1, v));
    }

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    _pcm16ToFloat32(buffer) {
        const view = new DataView(buffer);
        const float32 = new Float32Array(view.byteLength / 2);
        for (let i = 0; i < float32.length; i++) {
            const s = view.getInt16(i * 2, true);
            float32[i] = s < 0 ? s / 32768 : s / 32767;
        }
        return float32;
    }
}

class VoicePPTApp {
    constructor() {
        this.sessionId = null;
        this.slides = [];
        this.currentSlideIndex = 0;
        this.isQAPhase = false;
        this.questions = [];
        this.streamPlayer = new StreamAudioPlayer();

        this.waveformCanvas = document.getElementById('waveform');
        this.waveformCtx = this.waveformCanvas ? this.waveformCanvas.getContext('2d') : null;
        this.waveformData = new Array(64).fill(0);
        this.waveformAnimFrame = null;

        this.socketClient = null;
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('start-presentation').addEventListener('click', () => this.startSession());
        document.getElementById('submit-question').addEventListener('click', () => this.submitQuestion());
        document.getElementById('question-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuestion(); }
        });
        document.getElementById('qa-grip').addEventListener('click', () => this.toggleQAPanel());
        document.getElementById('restart-btn').addEventListener('click', () => location.reload());

        window.addEventListener('resize', () => this.resizeWaveform());
        this.resizeWaveform();
    }

    async startSession() {
        const deckId = document.getElementById('deck-select').value;
        const btn = document.getElementById('start-presentation');
        btn.disabled = true;
        btn.querySelector('span:last-child').textContent = 'Starting...';

        try {
            const res = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deckId })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to start');

            this.sessionId = data.sessionId;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = deckId.replace(/_/g, ' ');

            this.connectSocket();
            this.enableInput();
            setTimeout(() => this.triggerAutoPlex(), 400);
        } catch (err) {
            console.error(err);
            btn.disabled = false;
            btn.querySelector('span:last-child').textContent = 'Start Presentation';
        }
    }

    connectSocket() {
        this.socketClient = new SocketClient(this);
        this.socketClient.connect(this.sessionId);
    }

    async triggerAutoPlex() {
        try {
            await fetch('/api/autoplex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId })
            });
        } catch (err) { console.error('AutoPlex trigger failed:', err); }
    }

    enableInput() {
        document.getElementById('question-input').disabled = false;
        document.getElementById('submit-question').disabled = false;
    }

    updateSlide(data) {
        this.currentSlideIndex = data.slideIndex;
        const total = data.totalSlides || '?';
        document.getElementById('slide-counter').textContent = `${data.slideIndex + 1} / ${total}`;

        const titleEl = document.getElementById('slide-title');
        const subEl = document.getElementById('slide-subtitle');
        const bgEl = document.getElementById('slide-bg');

        this.streamPlayer.reset();

        titleEl.textContent = data.slide ? data.slide.title : '';
        subEl.textContent = data.slide ? data.slide.content : '';

        if (data.slide && data.slide.image) {
            bgEl.style.backgroundImage = `url(${data.slide.image})`;
        } else {
            bgEl.style.backgroundImage = 'none';
        }

        titleEl.style.animation = 'none';
        subEl.style.animation = 'none';
        void titleEl.offsetWidth;
        titleEl.style.animation = '';
        subEl.style.animation = '';
    }

    handleNarrationDelta(data) {
        const bar = document.getElementById('transcript-bar');
        bar.classList.add('visible', 'speaking');
        document.getElementById('transcript-text').textContent = data.full || data.delta;
    }

    handleAudioChunk(data) {
        this.streamPlayer.playChunk(data.chunk, data.sampleRate, data.channels);
        this.startWaveform();
    }

    handleAudioEnd() {
        this.showTranscript(false);
        setTimeout(() => { if (!this.streamPlayer.isPlaying) this.stopWaveform(); }, 1000);
    }

    showTranscript(speaking) {
        const bar = document.getElementById('transcript-bar');
        if (speaking) bar.classList.add('visible', 'speaking');
        else bar.classList.remove('speaking');
    }

    async submitQuestion() {
        const input = document.getElementById('question-input');
        const text = input.value.trim();
        if (!text || !this.sessionId) return;

        try {
            const res = await fetch('/api/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, questionText: text, submittedBy: 'Audience' })
            });
            const data = await res.json();
            if (data.success) { input.value = ''; this.addQuestionToList(data.questionId, text); }
        } catch (err) { console.error('Question submit error:', err); }
    }

    addQuestionToList(id, text) {
        this.questions.push({ id, text });
        document.getElementById('qa-count').textContent = this.questions.length;
        const list = document.getElementById('qa-list');
        const empty = list.querySelector('.qa-empty');
        if (empty) empty.remove();

        const div = document.createElement('div');
        div.className = 'qa-item';
        div.id = 'q-' + id;
        div.innerHTML = `<div class="qa-question">${this.escapeHtml(text)}</div><div class="qa-meta">Just now</div>`;
        list.appendChild(div);
        list.scrollTop = list.scrollHeight;
        this.expandQAPanel();
    }

    showAnswer(questionId, answer, questionText) {
        const item = document.getElementById('q-' + questionId);
        if (item) {
            item.classList.add('answered');
            const d = document.createElement('div');
            d.className = 'qa-answer';
            d.textContent = answer;
            item.appendChild(d);
        }
        document.getElementById('transcript-text').textContent = `A: ${answer}`;
        this.showTranscript(true);
    }

    toggleQAPanel() { document.getElementById('qa-panel').classList.toggle('collapsed'); }
    expandQAPanel() { document.getElementById('qa-panel').classList.remove('collapsed'); }

    setStatus(text, state) {
        document.getElementById('status-text').textContent = text;
        const dot = document.getElementById('status-dot');
        dot.className = 'status-dot';
        if (state === 'live') dot.classList.add('live');
        else if (state === 'paused') dot.classList.add('paused');
        if (text === 'Presenting' || text.startsWith('Q&A')) dot.classList.add('live');
    }

    showCompletion(data) {
        document.getElementById('completion-summary').textContent =
            `${data.totalSlides} slides narrated. ${data.totalQuestionsAnswered} questions answered.`;
        document.getElementById('completion-overlay').classList.remove('hidden');
        this.stopWaveform();
    }

    resizeWaveform() {
        if (!this.waveformCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.waveformCanvas.getBoundingClientRect();
        this.waveformCanvas.width = rect.width * dpr;
        this.waveformCanvas.height = rect.height * dpr;
        this.waveformCtx.scale(dpr, dpr);
    }

    startWaveform() {
        if (this.waveformAnimFrame) return;
        this.waveformCanvas.classList.add('active');
        const animate = () => {
            this.updateWaveformData();
            this.drawWaveformFrame();
            this.waveformAnimFrame = requestAnimationFrame(animate);
        };
        animate();
    }

    stopWaveform() {
        if (this.waveformAnimFrame) { cancelAnimationFrame(this.waveformAnimFrame); this.waveformAnimFrame = null; }
        this.waveformData = new Array(64).fill(0);
        this.drawWaveformFrame();
        setTimeout(() => { if (!this.waveformAnimFrame) this.waveformCanvas.classList.remove('active'); }, 500);
    }

    updateWaveformData() {
        const t = performance.now() / 1000;
        const playing = this.streamPlayer.isPlaying;
        for (let i = 0; i < this.waveformData.length; i++) {
            const base = playing ? Math.sin(t * 2 + i * 0.3) * 0.15 : 0;
            const wave = playing ? Math.sin(t * 5 + i * 0.5) * 0.25 : 0;
            const random = playing ? Math.random() * 0.15 : 0;
            const target = playing ? base + wave + random + 0.2 : 0.02;
            this.waveformData[i] += (target - this.waveformData[i]) * (playing ? 0.15 : 0.08);
        }
    }

    drawWaveformFrame() {
        if (!this.waveformCtx) return;
        const ctx = this.waveformCtx;
        const w = this.waveformCanvas.getBoundingClientRect().width;
        const h = this.waveformCanvas.getBoundingClientRect().height;
        ctx.clearRect(0, 0, w, h);

        const barCount = this.waveformData.length;
        const barWidth = (w / barCount) * 0.6;
        const gap = (w / barCount) * 0.4;

        for (let i = 0; i < barCount; i++) {
            const val = Math.min(Math.abs(this.waveformData[i]), 1);
            const barH = Math.max(val * h * 0.8, 2);
            const x = i * (barWidth + gap) + gap / 2;
            const y = (h - barH) / 2;
            ctx.fillStyle = this.isQAPhase
                ? `rgba(167, 139, 250, ${0.4 + val * 0.6})`
                : `rgba(110, 231, 183, ${0.3 + val * 0.7})`;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
            ctx.fill();
        }
    }

    escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new VoicePPTApp(); });