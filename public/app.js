import { StreamAudioPlayer } from './services/audio.js';
import { AzureVoiceSession } from './services/voice.js';
import { SocketClient } from './services/socket.js';
import { UIManager } from './services/ui.js';

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
        
        this.ui = new UIManager(this);
        this.streamPlayer = new StreamAudioPlayer();
        this.azureVoice = new AzureVoiceSession(this);
        this.socketClient = new SocketClient(this);
        
        this.recognition = null;
        this.isListening = false;
        this.voiceModeEnabled = false;
        this.voiceTurnState = 'idle';
        
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
        this.loadSessionConfig();
        this.loadPresentationCatalog();
        this.setupSpeechRecognitionFallback();
        this.resizeWaveform();
    }

    static SESSION_TTL_MS = 24 * 60 * 60 * 1000;

    static STORAGE_KEYS = {
        SESSION: 'vpp_session',
        PASSCODE_REQUIRED: 'vpp_passcode_required'
    };

    persistSession(data) {
        const payload = {
            sessionId: data.sessionId,
            controlToken: data.controlToken,
            participantName: data.participantName,
            deckId: data.deckId,
            presentationTitle: data.presentationTitle,
            slideCount: data.slideCount,
            passcodeRequired: data.passcodeRequired,
            storedAt: Date.now()
        };
        try {
            localStorage.setItem(VoicePPTApp.STORAGE_KEYS.SESSION, JSON.stringify(payload));
            localStorage.setItem(VoicePPTApp.STORAGE_KEYS.PASSCODE_REQUIRED, String(!!data.passcodeRequired));
        } catch (err) {
            console.warn('Failed to persist session:', err);
        }
    }

    clearPersistedSession() {
        try {
            localStorage.removeItem(VoicePPTApp.STORAGE_KEYS.SESSION);
        } catch (err) {
            console.warn('Failed to clear session:', err);
        }
    }

    getPersistedSession() {
        try {
            const raw = localStorage.getItem(VoicePPTApp.STORAGE_KEYS.SESSION);
            if (!raw) return null;
            const session = JSON.parse(raw);
            const age = Date.now() - (session.storedAt || 0);
            if (age > VoicePPTApp.SESSION_TTL_MS) {
                this.clearPersistedSession();
                return null;
            }
            return session;
        } catch {
            return null;
        }
    }

    async restorePersistedSession(session) {
        try {
            const res = await this.apiFetch(`/api/session/${session.sessionId}`);
            if (!res.ok) {
                this.clearPersistedSession();
                return false;
            }
            const data = await res.json();
            if (!data.session || !['active', 'presenting', 'wrapup'].includes(data.session.status)) {
                this.clearPersistedSession();
                return false;
            }
            this.sessionId = session.sessionId;
            this.controlToken = session.controlToken || '';
            this.participantName = session.participantName || '';
            this.totalSlides = data.session.slide_count || session.slideCount || 0;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = session.presentationTitle || session.deckId || '';
            await this.primeInitialSlide();
            this.socketClient.connect(this.sessionId, this.controlToken);
            document.getElementById('question-input').disabled = false;
            document.getElementById('submit-question').disabled = false;
            this.setStatus('Resumed', 'live', 'Session restored');
            this.syncQuestionCount();
            return true;
        } catch (err) {
            console.error('Session restore failed:', err);
            this.clearPersistedSession();
            return false;
        }
    }

    async loadSessionConfig() {
        try {
            const [configRes, persistedSession] = await Promise.all([
                this.apiFetch('/api/session/config'),
                Promise.resolve(this.getPersistedSession())
            ]);
            const data = await configRes.json();
            const passcodeEl = document.getElementById('session-passcode');
            if (passcodeEl) {
                passcodeEl.style.display = data.passcodeRequired ? 'block' : 'none';
                if (!data.passcodeRequired) {
                    passcodeEl.placeholder = '';
                }
            }
            localStorage.setItem(VoicePPTApp.STORAGE_KEYS.PASSCODE_REQUIRED, String(!!data.passcodeRequired));
            if (persistedSession) {
                const restored = await this.restorePersistedSession(persistedSession);
                if (restored) return;
            }
        } catch (err) {
            console.warn('Could not load session config:', err);
        }
    }

    buildApiHeaders(extraHeaders = {}) {
        const headers = { 'Content-Type': 'application/json', ...extraHeaders };
        if (this.controlToken) headers['X-Session-Control-Token'] = this.controlToken;
        return headers;
    }

    apiFetch(url, options = {}) {
        const nextOptions = { ...options };
        nextOptions.headers = this.buildApiHeaders(options.headers || {});
        return fetch(url, nextOptions);
    }

    logEvent(eventType, content, metadata = {}) {
        if (!this.sessionId) return;
        this.apiFetch('/api/analytics/event', {
            method: 'POST',
            body: JSON.stringify({
                sessionId: this.sessionId,
                eventType,
                slideIndex: this.currentSlideIndex,
                content,
                metadata
            })
        }).catch(err => console.error('Analytics error:', err));
    }

    bindEvents() {
        document.getElementById('start-presentation').addEventListener('click', () => this.startSession());
        document.getElementById('participant-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.startSession(); }
        });
        document.getElementById('submit-question').addEventListener('click', () => this.submitQuestion());
        document.getElementById('question-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuestion(); }
        });
        document.getElementById('chat-toggle').addEventListener('click', () => this.ui.toggleQuestionDrawer(true));
        document.getElementById('qa-close').addEventListener('click', () => this.ui.toggleQuestionDrawer(false));
        document.getElementById('qa-scrim').addEventListener('click', () => this.ui.toggleQuestionDrawer(false));
        document.getElementById('restart-btn').addEventListener('click', () => location.reload());
        document.getElementById('interrupt-mic').addEventListener('click', () => this.handleInterruptMic());
        document.getElementById('slide-turn-mic').addEventListener('click', () => this.handleInterruptMic());
        document.getElementById('slide-turn-continue').addEventListener('click', () => this.continuePresentationFlow());
        document.getElementById('slide-question-send').addEventListener('click', () => this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' }));
        document.getElementById('slide-question-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' });
            }
        });
        document.getElementById('wrapup-prev').addEventListener('click', () => this.changeWrapUpCard(-1));
        document.getElementById('wrapup-next').addEventListener('click', () => this.changeWrapUpCard(1));

        const accordionToggle = document.getElementById('accordion-toggle');
        if (accordionToggle) {
            accordionToggle.addEventListener('click', () => {
                document.getElementById('read-along-accordion').classList.toggle('is-open');
            });
        }

        document.getElementById('mic-retry-btn').addEventListener('click', () => {
            document.getElementById('mic-permission-modal').classList.add('hidden');
            this.handleInterruptMic();
        });
        document.getElementById('mic-close-btn').addEventListener('click', () => {
            document.getElementById('mic-permission-modal').classList.add('hidden');
        });
        
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.getAttribute('data-emoji');
                this.socketClient.sendReaction(emoji);
                this.spawnReaction(emoji);
                this.userReactions.push({ emoji, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
                this.logEvent('reaction', emoji);
            });
        });

        window.addEventListener('resize', () => this.resizeWaveform());
    }

    // Proxy UI methods for cleaner access
    setStatus(t, s, d) { this.ui.setStatus(t, s, d); }
    showTranscript(s) { this.ui.showTranscript(s); }
    updateMicState() { this.ui.updateMicState(this.isListening, this.voiceModeEnabled, this.azureVoice.connected); }

    spawnReaction(emoji) {
        const container = document.querySelector('.presentation-stage');
        if (!container) return;
        const colorMap = { '👏': '#344736', '❤️': '#86312b', '💡': '#ffc083' };
        const color = colorMap[emoji] || '#342e29';
        const count = 3 + Math.floor(Math.random() * 3);
        
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'floating-reaction';
            el.textContent = emoji;
            el.style.color = color;
            const startX = window.innerWidth > 720 ? (window.innerWidth - 100 + (Math.random() * 60 - 30)) : (window.innerWidth / 2 + (Math.random() * 100 - 50));
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
            setTimeout(() => el.remove(), (duration + delay) * 1000);
        }
    }

    handleSignificantReactions(data) {
        const { counts } = data;
        const topEmoji = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (topEmoji && topEmoji[1] > 0) {
            this.setStatus('Vibe check', 'paused', `High engagement! ${topEmoji[1]} people just reacted with ${topEmoji[0]}`);
            setTimeout(() => this.restorePresentationStatus(), 4000);
        }
    }

    handleVotesSync(data) {
        if (data.votes) {
            Object.entries(data.votes).forEach(([id, v]) => this.votes.set(id, v));
            this.renderWrapUpMcqs();
        }
    }

    handleVoteUpdate(data) {
        this.votes.set(data.mcqId, data.allVotes);
        this.renderWrapUpMcqs();
    }

    async loadPresentationCatalog() {
        try {
            const res = await fetch('/api/cms/presentations');
            const data = await res.json();
            if (!Array.isArray(data.presentations) || data.presentations.length === 0) return;
            this.presentationCatalog = data.presentations;
            const select = document.getElementById('deck-select');
            const previous = select.value;
            select.innerHTML = '';
            
            data.presentations.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id; opt.textContent = p.title;
                select.appendChild(opt);
            });

            const updateHomeHeaders = () => {
                const selectedId = select.value;
                const p = this.presentationCatalog.find(pres => pres.id === selectedId);
                if (p) {
                    const titleEl = document.getElementById('home-start-title');
                    const subEl = document.getElementById('home-start-sub');
                    if (titleEl) titleEl.innerHTML = p.startTitle || 'Presentations<br>that speak.';
                    if (subEl) subEl.innerHTML = p.startSubtitle || 'AI-powered voice narration that brings your slides to life.';
                }
            };

            select.addEventListener('change', updateHomeHeaders);

            if (data.presentations.some(p => p.id === previous)) {
                select.value = previous;
            }
            updateHomeHeaders();

        } catch (err) { console.error('Catalog load failed:', err); }
    }

    setupSpeechRecognitionFallback() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return;
        this.recognition = new Recognition();
        this.recognition.lang = 'en-US';
        this.recognition.onstart = () => { this.isListening = true; this.updateMicState(); this.setStatus('Listening', 'paused', 'Browser speech recognition active'); };
        this.recognition.onend = () => { this.isListening = false; this.updateMicState(); if (!this.voiceModeEnabled) this.restorePresentationStatus(); };
        this.recognition.onresult = (e) => {
            const transcript = Array.from(e.results).map(r => r[0]?.transcript || '').join(' ').trim();
            const last = e.results[e.results.length - 1];
            if (last?.isFinal && transcript) this.submitQuestion(transcript, { interrupt: true, submittedBy: 'Voice Interrupt' });
        };
        this.recognition.onerror = () => { this.isListening = false; this.updateMicState(); this.setStatus('Mic unavailable', 'paused', 'Type your question'); };
    }

    async startSession() {
        const deckId = document.getElementById('deck-select').value;
        const participantName = (document.getElementById('participant-name').value || '').trim();
        const passcodeEl = document.getElementById('session-passcode');
        const passcode = passcodeEl ? (passcodeEl.value || '').trim() : '';
        if (!participantName) { document.getElementById('participant-name').focus(); this.setStatus('Add your name', 'paused', 'Presenter uses it to personalize'); return; }
        if (passcodeEl && passcodeEl.offsetParent !== null && !passcode) { passcodeEl.focus(); this.setStatus('Enter passcode', 'paused', 'A passcode is required for this presentation'); return; }
        const btn = document.getElementById('start-presentation');
        btn.disabled = true; btn.querySelector('span:last-child').textContent = 'Starting...';
        try {
            const res = await this.apiFetch('/api/session/start', { method: 'POST', body: JSON.stringify({ deckId, participantName, passcode }) });
            const data = await res.json();
            if (!data.success) {
                if (data.error === 'Wrong passcode') {
                    passcodeEl.value = '';
                    passcodeEl.focus();
                    this.setStatus('Wrong passcode', 'paused', 'Check with the presenter for the correct code');
                    btn.disabled = false; btn.querySelector('span:last-child').textContent = 'Start Presentation';
                    return;
                }
                if (data.error === 'Passcode required') {
                    passcodeEl.focus();
                    this.setStatus('Passcode required', 'paused', 'Enter the passcode to join');
                    btn.disabled = false; btn.querySelector('span:last-child').textContent = 'Start Presentation';
                    return;
                }
                throw new Error(data.error || 'Failed to start');
            }
            this.sessionId = data.sessionId; this.controlToken = data.controlToken || '';
            this.totalSlides = data.slideCount || 0; this.participantName = data.participantName || participantName;
            this.persistSession({
                sessionId: this.sessionId,
                controlToken: this.controlToken,
                participantName: this.participantName,
                deckId: data.deckId || deckId,
                presentationTitle: data.presentationTitle || deckId.replace(/_/g, ' '),
                slideCount: this.totalSlides,
                passcodeRequired: data.passcodeRequired
            });
            this.awaitingSlideContinue = false;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = data.presentationTitle || deckId.replace(/_/g, ' ');
            await this.primeInitialSlide();
            this.socketClient.connect(this.sessionId, this.controlToken);
            document.getElementById('question-input').disabled = false;
            document.getElementById('submit-question').disabled = false;
            this.setStatus('Ready', 'live', 'Ask anytime');
            this.syncQuestionCount();
            setTimeout(() => this.triggerAutoPlex(), 250);
        } catch (err) { console.error(err); btn.disabled = false; btn.querySelector('span:last-child').textContent = 'Start Presentation'; }
    }

    async primeInitialSlide() {
        if (!this.sessionId) return;
        try {
            const res = await this.apiFetch(`/api/session/${this.sessionId}`);
            const data = await res.json();
            let meta = {};
            try { meta = JSON.parse(data?.session?.metadata || '{}'); } catch {}
            this.participantName = data?.participantName || meta.participantName || this.participantName;
            if (data?.currentSlide) this.updateSlide({ slideIndex: data.session?.current_slide_index || 0, totalSlides: data.session?.slide_count || this.totalSlides, slide: data.currentSlide });
        } catch (err) { console.error('Initial slide fetch failed:', err); }
    }

    async triggerAutoPlex() {
        try { await this.apiFetch('/api/autoplex', { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); } catch (err) { console.error('AutoPlex trigger failed:', err); }
    }

    updateSlide(data) {
        this.currentSlideIndex = data.slideIndex;
        this.totalSlides = data.totalSlides || this.totalSlides;
        this.currentSlide = data.slide || null;
        this.ui.closeSlideTurnOverlay();
        this.resetSubtitleState();
        this.fullNarrationTranscript = '';
        this.ui.updateFullTranscriptionDisplay('');
        document.getElementById('slide-counter').textContent = `${data.slideIndex + 1} / ${data.totalSlides || '?'}`;
        document.getElementById('slide-title').textContent = data.slide ? data.slide.title : '';
        document.getElementById('slide-subtitle').textContent = data.slide ? data.slide.content : '';
        const notesEl = document.getElementById('slide-notes');
        if (notesEl) notesEl.innerHTML = data.slide && data.slide.notes ? `<p>${data.slide.notes.replace(/\n/g, '<br>')}</p>` : '';
        const stage = document.querySelector('.slide-visual-shell');
        const imageUrl = data.slide && data.slide.image ? data.slide.image : null;
        if (stage) {
            if (imageUrl) {
                stage.classList.add('blur-up');
                const img = new Image(); img.onload = () => { stage.style.backgroundImage = `url(${imageUrl})`; stage.classList.remove('blur-up'); this.analyzeImageBrightness(imageUrl); };
                img.src = imageUrl;
            } else { stage.style.backgroundImage = 'none'; stage.classList.remove('blur-up'); }
        }
        const main = document.querySelector('.slide-main');
        if (main) main.scrollTop = 0;
        if (!this.voiceModeEnabled) { this.streamPlayer.reset(); this.stopWaveform(); }
        if (this.azureVoice.connected) this.azureVoice.syncSlideContext();
        this.updateFolio();
    }

    handleNarrationDelta(data) {
        const delta = data.delta || '';
        if (data.append) {
            this.subtitleBuffer = `${this.subtitleBuffer} ${delta}`.trim();
            this.fullNarrationTranscript += delta;
        } else {
            this.subtitleBuffer = String(data.full || delta).trim();
            this.fullNarrationTranscript = String(data.full || delta);
        }
        this.renderSubtitle();
        this.ui.updateFullTranscriptionDisplay(this.fullNarrationTranscript);
    }

    handleAudioChunk(data) {
        if (this.voiceModeEnabled && this.azureVoice.connected) return;
        this.awaitingPlaybackComplete = true; this.subtitleReady = true;
        this.renderSubtitle();
        this.streamPlayer.playChunk(data.chunk, data.sampleRate, data.channels);
        this.startWaveform();
    }

    handleAudioEnd() { this.showTranscript(false); this.subtitleReady = false; this.waitForPlaybackFinish(); }

    waitForPlaybackFinish() {
        const poll = () => {
            if (this.streamPlayer.isPlaying) { setTimeout(poll, 120); return; }
            this.stopWaveform();
            if (this.awaitingPlaybackComplete) { this.awaitingPlaybackComplete = false; this.socketClient.notifyPlaybackComplete(this.sessionId); }
        };
        setTimeout(poll, 120);
    }

    showVoiceTranscript(text) { if (!text) return; this.subtitleBuffer = String(text).trim(); this.subtitleReady = true; this.renderSubtitle(); }

    renderSubtitle() {
        const cleaned = this.subtitleBuffer.replace(/\s+/g, ' ').trim();
        if (!cleaned) return this.ui.renderSubtitle('', false);
        const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
        let compact = sentences.slice(-2).join(' ').trim();
        if (compact.length > 180) compact = compact.slice(-180).trimStart();
        this.ui.renderSubtitle(compact, this.subtitleReady);
    }

    finalizeSubtitleText(text) { if (!this.subtitleBuffer.trim()) { this.subtitleBuffer = String(text || '').trim(); this.renderSubtitle(); } }

    resetSubtitleState() { this.subtitleBuffer = ''; this.subtitleReady = false; this.ui.renderSubtitle('', false); }

    async analyzeImageBrightness(imageUrl) {
        const img = new Image(); img.crossOrigin = "Anonymous"; img.src = imageUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            canvas.width = 10; canvas.height = 10; ctx.drawImage(img, 0, 0, 10, 10);
            const data = ctx.getImageData(0, 0, 10, 10).data;
            let brightness = 0; for (let i = 0; i < data.length; i += 4) brightness += (data[i] + data[i+1] + data[i+2]) / 3;
            const avg = brightness / (data.length / 4);
            const copy = document.querySelector('.slide-copy');
            if (avg > 128) { copy.classList.remove('theme-dark'); copy.classList.add('theme-light'); }
            else { copy.classList.remove('theme-light'); copy.classList.add('theme-dark'); }
        };
    }

    updateFolio() {
        const dateEl = document.getElementById('folio-date'); const pageEl = document.getElementById('folio-page');
        if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        if (pageEl) pageEl.textContent = `PAGE ${this.currentSlideIndex + 1} OF ${this.totalSlides || '?'}`;
    }

    handleMicPermissionError() { document.getElementById('mic-permission-modal').classList.remove('hidden'); }

    async submitQuestion(forcedText, options = {}) {
        const input = options.source === 'slide-turn' ? document.getElementById('slide-question-input') : document.getElementById('question-input');
        const text = (typeof forcedText === 'string' ? forcedText : input.value).trim();
        if (!text || !this.sessionId) return;
        if (options.interrupt) { await this.requestInterrupt(); this.setStatus('Thinking', 'paused', 'Routing interruption'); }
        this.pendingQuestionText = text;
        try {
            const res = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, questionText: text, submittedBy: options.submittedBy || 'Audience' }) });
            if (!(await res.json()).success) throw new Error('Failed');
            input.value = ''; this.pendingQuestionText = null;
            if (options.queueForEnd) this.setStatus('Saved for final Q&A', 'paused', 'Answered after last slide');
            else this.setStatus('Question queued', 'paused', 'Answered shortly');
            this.userQuestions.push({ text, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
            this.ui.toggleQuestionDrawer(true);
        } catch (err) { console.error(err); this.setStatus('Question failed', 'paused', 'Retry'); }
    }

    addQuestionToList(id, text, by) {
        if (this.questions.has(id)) return;
        this.questions.set(id, { id, text, status: 'pending' });
        this.syncQuestionCount();
        const list = document.getElementById('qa-list');
        const empty = list.querySelector('.qa-empty'); if (empty) empty.remove();
        const item = document.createElement('div'); item.className = 'qa-item pending'; item.id = `q-${id}`;
        item.innerHTML = `<div class="qa-question">${this.escapeHtml(text)}</div><div class="qa-meta">${this.escapeHtml(by)} · just now</div>`;
        list.appendChild(item); list.scrollTop = list.scrollHeight;
    }

    markQuestionAnswered(id, ans, txt) {
        if (!this.questions.has(id)) this.addQuestionToList(id, txt, 'Audience');
        const target = document.getElementById(`q-${id}`); if (!target) return;
        const q = this.questions.get(id); if (q) q.status = 'answered';
        target.classList.remove('pending'); target.classList.add('answered');
        let node = target.querySelector('.qa-answer'); if (!node) { node = document.createElement('div'); node.className = 'qa-answer'; target.appendChild(node); }
        node.textContent = ans; this.syncQuestionCount();
    }

    handleQueueUpdate(data) {
        if (data.questionId && data.status === 'answered') {
            const q = this.questions.get(data.questionId); if (q) q.status = 'answered';
            const item = document.getElementById(`q-${data.questionId}`); if (item) { item.classList.remove('pending'); item.classList.add('answered'); }
        }
        this.syncQuestionCount();
    }

    syncQuestionCount() {
        const total = this.questions.size;
        const pending = Array.from(this.questions.values()).filter(q => q.status !== 'answered').length;
        this.ui.syncQuestionCount(total, pending);
    }

    async handleInterruptMic() {
        if (this.voiceModeEnabled) { await this.stopVoiceMode(); return; }
        await this.requestInterrupt(); await this.pauseAutoplex(true);
        if (await this.azureVoice.connect()) { this.voiceModeEnabled = true; this.updateMicState(); return; }
        await this.pauseAutoplex(false);
        if (!this.recognition) { document.getElementById('question-input').focus(); this.setStatus('Type interruption', 'paused', 'Voice unavailable'); return; }
        try { this.recognition.start(); } catch (err) { console.error(err); this.setStatus('Mic unavailable', 'paused', 'Type question'); }
    }

    async stopVoiceMode() { this.voiceModeEnabled = false; await this.azureVoice.disconnect(); await this.pauseAutoplex(false); this.updateMicState(); this.restorePresentationStatus(); }

    async continuePresentationFlow() {
        if (!this.sessionId) return;
        this.streamPlayer.reset();
        this.resetSubtitleState();
        try { await this.apiFetch('/api/autoplex/continue', { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); this.ui.closeSlideTurnOverlay(); this.setStatus('Presenting', 'live', 'Narration live'); }
        catch (err) { console.error(err); }
    }

    async requestInterrupt() {
        this.streamPlayer.reset(); this.stopWaveform(); this.showTranscript(false);
        if (!this.sessionId) return;
        try { await this.apiFetch('/api/autoplex/interrupt', { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); } catch (err) { console.error(err); }
    }

    async pauseAutoplex(p) { if (!this.sessionId) return; try { await this.apiFetch(`/api/autoplex/${p ? 'pause' : 'resume'}`, { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); } catch (err) { console.error(err); } }

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

    openSlideTurnOverlay(data = {}) { this.awaitingSlideContinue = true; this.ui.openSlideTurnOverlay(data); this.updateMicState(); }

    restorePresentationStatus() {
        if (this.voiceModeEnabled) { this.setStatus('Mic live', 'paused', 'Ask question or tap mic to resume'); return; }
        if (this.wrapUpEndsAt > Date.now()) { this.setStatus('Final questions', 'paused', 'Use mic or prompts'); return; }
        if (this.awaitingSlideContinue) { this.setStatus('Your turn', 'paused', 'Ask now or continue'); return; }
        if (this.isQAPhase) { this.setStatus('Q&A', 'paused', 'Answering questions'); return; }
        this.setStatus('Presenting', 'live', 'Narration live');
    }

    startWrapUp(data = {}) {
        this.wrapUpSelections = {}; this.wrapUpMcqs = Array.isArray(data.mcqs) ? data.mcqs : []; this.wrapUpIndex = 0;
        this.wrapUpEndsAt = Number(data.endsAt) || (Date.now() + 60000);
        this.renderWrapUpMcqs();
        document.getElementById('wrapup-message').textContent = data.promptText || 'One minute for questions.';
        document.getElementById('wrapup-panel').classList.remove('hidden'); document.getElementById('completion-overlay').classList.remove('hidden');
        this.setStatus('Final questions', 'paused', 'Use mic or prompts');
        if (this.wrapUpTimer) clearInterval(this.wrapUpTimer);
        this.wrapUpTimer = setInterval(() => {
            const rem = Math.max(0, this.wrapUpEndsAt - Date.now()); const sec = Math.ceil(rem / 1000);
            document.getElementById('wrapup-timer').textContent = `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
            document.getElementById('wrapup-deadline').textContent = `Agent ends in ${sec}s`;
            if (rem <= 0) { clearInterval(this.wrapUpTimer); this.wrapUpTimer = null; }
        }, 1000);
    }

    finishWrapUp() { this.wrapUpEndsAt = 0; if (this.wrapUpTimer) { clearInterval(this.wrapUpTimer); this.wrapUpTimer = null; } document.getElementById('wrapup-timer').textContent = '0:00'; }

    showCompletion(data) {
        document.getElementById('completion-summary').textContent = `${data.totalSlides} slides, ${data.totalQuestionsAnswered} answered.`;
        const activity = { participantName: this.participantName, deckTitle: document.getElementById('deck-label').textContent, totalSlides: data.totalSlides, questionsAnswered: data.totalQuestionsAnswered, userQuestions: this.userQuestions, userReactions: this.userReactions, timestamp: new Date().toISOString() };
        localStorage.setItem(`digest_${this.sessionId}`, JSON.stringify(activity));
        document.getElementById('completion-overlay').classList.remove('hidden'); this.stopWaveform();
    }

    renderWrapUpMcqs() {
        const container = document.getElementById('wrapup-mcqs'); container.innerHTML = '';
        const mcq = this.wrapUpMcqs[this.wrapUpIndex];
        document.getElementById('wrapup-progress').textContent = this.wrapUpMcqs.length ? `${this.wrapUpIndex+1}/${this.wrapUpMcqs.length}` : '0/0';
        document.getElementById('wrapup-prev').disabled = this.wrapUpIndex <= 0;
        document.getElementById('wrapup-next').disabled = this.wrapUpIndex >= this.wrapUpMcqs.length - 1;
        if (!mcq) return;
        const card = document.createElement('div'); card.className = 'wrapup-card';
        const title = document.createElement('div'); title.className = 'wrapup-card-title'; title.textContent = mcq.prompt; card.appendChild(title);
        const options = document.createElement('div'); options.className = 'wrapup-options';
        const votes = this.votes.get(mcq.id) || {}; const total = Object.values(votes).reduce((s,v)=>s+v,0);
        (mcq.options || []).forEach((opt, idx) => {
            const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'wrapup-option';
            const count = votes[opt] || 0; const pct = total > 0 ? (count/total)*100 : 0;
            const colors = ['#344736', '#86312b', '#ffc083', '#002140'];
            btn.innerHTML = `<span class="option-text">${opt}</span><div class="option-bar-bg"><div class="option-bar" style="width:${pct}%;background:${colors[idx%colors.length]}"></div></div><span class="option-count">${count}</span>`;
            if (this.wrapUpSelections[mcq.id] === opt) btn.classList.add('is-selected');
            btn.addEventListener('click', () => { if (this.wrapUpSelections[mcq.id] === opt) return; this.wrapUpSelections[mcq.id] = opt; this.socketClient.submitVote(mcq.id, opt); this.renderWrapUpMcqs(); });
            options.appendChild(btn);
        });
        card.appendChild(options); container.appendChild(card);
    }

    changeWrapUpCard(dir) { if (!this.wrapUpMcqs.length) return; const next = this.wrapUpIndex + dir; if (next >= 0 && next < this.wrapUpMcqs.length) { this.wrapUpIndex = next; this.renderWrapUpMcqs(); } }

    resizeWaveform() {
        if (!this.waveformCanvas || !this.waveformCtx) return;
        const dpr = window.devicePixelRatio || 1; const rect = this.waveformCanvas.getBoundingClientRect();
        this.waveformCanvas.width = rect.width * dpr; this.waveformCanvas.height = rect.height * dpr;
        this.waveformCtx.setTransform(1,0,0,1,0,0); this.waveformCtx.scale(dpr, dpr);
    }

    startWaveform() { if (this.waveformAnimFrame) return; this.waveformCanvas.classList.add('active'); const anim = () => { this.updateWaveformData(); this.drawWaveformFrame(); this.waveformAnimFrame = requestAnimationFrame(anim); }; anim(); }
    stopWaveform() { if (this.waveformAnimFrame) { cancelAnimationFrame(this.waveformAnimFrame); this.waveformAnimFrame = null; } this.waveformData.fill(0); this.drawWaveformFrame(); setTimeout(() => { if (!this.waveformAnimFrame) this.waveformCanvas.classList.remove('active'); }, 250); }

    updateWaveformData() {
        const t = performance.now() / 1000; const p = this.streamPlayer.isPlaying || this.voiceModeEnabled;
        for (let i = 0; i < 64; i++) {
            const target = p ? (Math.sin(t*1.7+i*0.25)*0.12 + Math.sin(t*4+i*0.55)*0.22 + Math.random()*0.12 + 0.18) : 0.02;
            this.waveformData[i] += (target - this.waveformData[i]) * (p ? 0.14 : 0.08);
        }
    }

    drawWaveformFrame() {
        if (!this.waveformCtx) return; const ctx = this.waveformCtx; const w = this.waveformCanvas.getBoundingClientRect().width; const h = this.waveformCanvas.getBoundingClientRect().height;
        ctx.clearRect(0,0,w,h); const slot = w/64; const bw = slot*0.52;
        for (let i = 0; i < 64; i++) {
            const val = Math.min(Math.abs(this.waveformData[i]), 1); const bh = Math.max(val*h*0.82, 2);
            ctx.fillStyle = this.voiceModeEnabled ? `rgba(159,216,209,${0.3+val*0.6})` : (this.isQAPhase ? `rgba(159,216,209,${0.32+val*0.6})` : `rgba(241,194,125,${0.26+val*0.64})`);
            ctx.beginPath(); ctx.roundRect(i*slot+(slot-bw)/2, (h-bh)/2, bw, bh, bw/2); ctx.fill();
        }
    }

    onVoiceTurnState(t, s, d) { this.setStatus(t, s, d); }
    onVoiceSessionConnected() { this.voiceModeEnabled = true; this.updateMicState(); this.setStatus('Mic live', 'paused', 'Ask question'); }
    onVoiceSessionDisconnected() { const was = this.voiceModeEnabled; this.voiceModeEnabled = false; this.updateMicState(); if (was) { this.pauseAutoplex(false); this.setStatus('Voice ended', 'paused', 'Returning to presentation'); } }

    getRealtimeTools() {
        return [
            { type: 'function', name: 'advance_slide', description: 'Relative navigation', parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['next', 'previous'] } }, required: ['direction'] } },
            { type: 'function', name: 'go_to_slide', description: 'Jump to slide', parameters: { type: 'object', properties: { slide_number: { type: 'integer', minimum: 1 } }, required: ['slide_number'] } },
            { type: 'function', name: 'resume_presentation', description: 'Resume flow', parameters: { type: 'object', properties: {} } }
        ];
    }

    async executeRealtimeTool(name, args) {
        if (name === 'advance_slide') {
            const dir = args.direction === 'previous' ? 'previous' : 'next';
            if (dir === 'next') { await this.stopVoiceMode(); await this.continuePresentationFlow(); return { ok: true, handoff: 'presentation' }; }
            const moved = await this.advanceSlideByVoice(dir);
            if (moved) { this.setStatus('Moved back', 'paused', 'Previous slide'); this.azureVoice.syncSlideContext(); }
            return { ok: moved, current_slide_index: this.currentSlideIndex };
        }
        if (name === 'go_to_slide') {
            const moved = await this.goToSlideByVoice(args.slide_number);
            if (moved) { this.setStatus('Jumped', 'paused', `Slide ${this.currentSlideIndex+1}`); this.azureVoice.syncSlideContext(); }
            return { ok: moved, current_slide_index: this.currentSlideIndex };
        }
        if (name === 'resume_presentation') { await this.stopVoiceMode(); await this.continuePresentationFlow(); return { ok: true }; }
        return { ok: false, error: 'Unknown tool' };
    }

    escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new VoicePPTApp(); });
