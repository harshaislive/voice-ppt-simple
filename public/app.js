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
        this.narrationSourceText = '';
        this.wordBoundaries = [];
        this.transcriptChunks = [];
        this.transcriptChunkIndex = -1;
        this.transcriptChunkTimers = [];
        this.pendingPlaybackStartAt = null;
        this.transcriptChunkMode = 'waiting';
        this.slideDeck = [];
        this.presentationCatalog = [];
        this.loadingQuotes = [];
        this.awaitingPlaybackComplete = false;
        this.awaitingSlideContinue = false;

        this.waveformCanvas = document.getElementById('waveform');
        this.waveformCtx = this.waveformCanvas ? this.waveformCanvas.getContext('2d') : null;
        this.waveformData = new Array(64).fill(0);
        this.waveformAnimFrame = null;

        this.bindEvents();
        this.streamPlayer.onStreamStart = ({ startedAtMs }) => {
            this.pendingPlaybackStartAt = startedAtMs;
            this.syncTranscriptReelPlayback();
        };
        this.loadSessionConfig();
        this.loadPresentationCatalog();
        this.loadLoadingQuotes();
        this.setupSpeechRecognitionFallback();
        this.resizeWaveform();
    }

    async loadLoadingQuotes() {
        try {
            const res = await fetch('/api/cms/projects/beforest/loading-quotes');
            if (res.ok) {
                this.loadingQuotes = await res.json();
            } else {
                this.loadingQuotes = [
                    { text: "10% isn't about subtraction — it's about protection.", author: "Beforest" },
                    { text: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" }
                ];
            }
        } catch (err) {
            console.warn('Failed to load loading quotes:', err);
        }
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
            await this.loadSessionSlides();
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
        const on = (id, event, handler) => {
            const el = document.getElementById(id);
            if (!el) return null;
            el.addEventListener(event, handler);
            return el;
        };

        on('history-fab', 'click', () => {
            const scrubber = document.getElementById('scrubber-container');
            if (scrubber) scrubber.classList.toggle('hidden');
        });

        on('start-presentation', 'click', () => this.startSession());
        on('participant-name', 'keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.startSession(); }
        });
        on('submit-question', 'click', () => this.submitQuestion());
        on('question-input', 'keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuestion(); }
        });
        on('chat-toggle', 'click', () => this.ui.toggleQuestionDrawer(true));
        on('qa-close', 'click', () => this.ui.toggleQuestionDrawer(false));
        on('qa-scrim', 'click', () => this.ui.toggleQuestionDrawer(false));
        on('restart-btn', 'click', () => location.reload());
        on('interrupt-mic', 'click', () => this.openQuestionComposer());
        on('slide-turn-mic', 'click', () => this.openQuestionComposer());
        on('wrapup-mic', 'click', () => this.openQuestionComposer());
        on('slide-turn-continue', 'click', () => this.continuePresentationFlow());
        on('footer-continue-btn', 'click', () => this.continuePresentationFlow());
        on('slide-question-send', 'click', () => this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' }));
        on('slide-question-input', 'keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' });
            }
        });
        on('wrapup-prev', 'click', () => this.changeWrapUpCard(-1));
        on('wrapup-next', 'click', () => this.changeWrapUpCard(1));
        
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.getAttribute('data-emoji');
                this.socketClient.sendReaction(emoji);
                this.spawnReaction(emoji);
                this.userReactions.push({ emoji, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
                this.logEvent('reaction', emoji);
            });
        });

        on('help-fab', 'click', () => {
            const overlay = document.getElementById('help-modal-overlay');
            if (overlay) overlay.classList.add('open');
        });
        on('help-modal-close', 'click', () => {
            const overlay = document.getElementById('help-modal-overlay');
            if (overlay) overlay.classList.remove('open');
        });
        on('help-modal-overlay', 'click', (e) => {
            const overlay = document.getElementById('help-modal-overlay');
            if (overlay && e.target === overlay) {
                overlay.classList.remove('open');
            }
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

            const p = data.presentations.find(pres => pres.source === 'supabase') || data.presentations[0];
            const titleEl = document.getElementById('home-start-title');
            const subEl = document.getElementById('home-start-sub');
            if (titleEl) titleEl.innerHTML = p.startTitle ? p.startTitle.replace(/\n/g, '<br>') : 'THE 10% LIFE';
            if (subEl) subEl.textContent = p.startSubtitle || '';

            const heroEl = document.getElementById('start-hero');
            if (heroEl && p.startImage) {
                heroEl.style.backgroundImage = `url(${p.startImage})`;
                console.log('Hero image set:', p.startImage);
            } else {
                if (heroEl) {
                    heroEl.style.backgroundImage = '';
                }
            }

        } catch (err) { console.error('Catalog load failed:', err); }
    }

    async loadSessionSlides() {
        if (!this.sessionId) return;
        try {
            const res = await this.apiFetch(`/api/slides/${this.sessionId}`);
            if (!res.ok) return;
            const slides = await res.json();
            if (Array.isArray(slides)) {
                this.slideDeck = slides;
                this.renderScrubber();
            }
        } catch (err) {
            console.warn('Failed to load session slides:', err);
        }
    }

    setupSpeechRecognitionFallback() {
        this.recognition = null;
    }

    async startSession() {
        const supabasePres = this.presentationCatalog.find(p => p.source === 'supabase');
        const deckId = supabasePres?.id || this.presentationCatalog[0]?.id || '10_percent_lifestyle';
        const participantName = (document.getElementById('participant-name').value || '').trim();
        const passcodeEl = document.getElementById('session-passcode');
        const passcode = passcodeEl ? (passcodeEl.value || '').trim() : '';
        if (!participantName) { document.getElementById('participant-name').focus(); this.setStatus('Add your name', 'paused', 'Presenter uses it to personalize'); return; }
        if (passcodeEl && passcodeEl.offsetParent !== null && !passcode) { passcodeEl.focus(); this.setStatus('Enter passcode', 'paused', 'A passcode is required for this presentation'); return; }
        const btn = document.getElementById('start-presentation');
        btn.disabled = true; btn.querySelector('span').textContent = 'Starting...';
        try {
            const res = await this.apiFetch('/api/session/start', { method: 'POST', body: JSON.stringify({ deckId, participantName, passcode }) });
            const data = await res.json();
            if (!data.success) {
                if (data.error === 'Wrong passcode') {
                    passcodeEl.value = '';
                    passcodeEl.focus();
                    this.setStatus('Wrong passcode', 'paused', 'Check with the presenter for the correct code');
                    btn.disabled = false; btn.querySelector('span').textContent = 'Begin Experience';
                    return;
                }
                if (data.error === 'Passcode required') {
                    passcodeEl.focus();
                    this.setStatus('Passcode required', 'paused', 'Enter the passcode to join');
                    btn.disabled = false; btn.querySelector('span').textContent = 'Begin Experience';
                    return;
                }
                throw new Error(data.error || 'Failed to start');
            }

            // Start the loading experience (The 10% Breath)
            const loadingPromise = this.ui.showLoadingScreen(this.loadingQuotes);

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
            const prewarmPromise = this.apiFetch('/api/autoplex/prewarm', {
                method: 'POST',
                body: JSON.stringify({ sessionId: this.sessionId, slideIndex: 0 })
            }).catch(err => {
                console.warn('Initial narration prewarm failed:', err);
                return null;
            });
            
            // Prime initial slide while loading
            await this.primeInitialSlide();
            await this.loadSessionSlides();
            this.socketClient.connect(this.sessionId, this.controlToken);
            document.getElementById('question-input').disabled = false;
            document.getElementById('submit-question').disabled = false;

            // Wait for both the visible loading breath and the first-slide AI prewarm.
            await Promise.all([loadingPromise, prewarmPromise]);

            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = data.presentationTitle || deckId.replace(/_/g, ' ');
            
            this.setStatus('Ready', 'live', 'Type questions anytime');
            this.syncQuestionCount();
            setTimeout(() => this.triggerAutoPlex(), 250);
        } catch (err) { console.error(err); btn.disabled = false; btn.querySelector('span').textContent = 'Begin Experience'; }
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
        if (notesEl) notesEl.textContent = '';
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
        this.renderScrubber();
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
        this.narrationSourceText = this.fullNarrationTranscript.trim();
        this.refreshTranscriptReel();
    }

    handleAudioChunk(data) {
        if (this.voiceModeEnabled && this.azureVoice.connected) return;
        this.awaitingPlaybackComplete = true; this.subtitleReady = true;
        this.renderSubtitle();
        this.streamPlayer.playChunk(data.chunk, data.sampleRate, data.channels);
        this.startWaveform();
    }

    handleWordBoundaries(data) {
        this.wordBoundaries = Array.isArray(data?.words) ? data.words : [];
        this.refreshTranscriptReel();
        this.syncTranscriptReelPlayback();
    }

    handleAudioEnd() {
        this.showTranscript(false);
        this.subtitleReady = false;
        this.waitForPlaybackFinish();
    }

    waitForPlaybackFinish() {
        const poll = () => {
            if (this.streamPlayer.hasPendingPlayback()) { setTimeout(poll, 120); return; }
            this.stopWaveform();
            this.clearTranscriptChunkTimers();
            if (this.transcriptChunks.length > 0) {
                this.transcriptChunkIndex = this.transcriptChunks.length - 1;
                this.transcriptChunkMode = 'complete';
            } else {
                this.transcriptChunkIndex = -1;
            }
            this.pendingPlaybackStartAt = null;
            this.renderFullTranscription();
            if (this.awaitingPlaybackComplete) { this.awaitingPlaybackComplete = false; this.socketClient.notifyPlaybackComplete(this.sessionId); }
        };
        setTimeout(poll, 120);
    }

    showVoiceTranscript(text) {
        if (!text) return;
        this.subtitleBuffer = String(text).trim();
        this.subtitleReady = true;
        this.renderSubtitle();
    }

    renderSubtitle() {
        const cleaned = this.subtitleBuffer.replace(/\s+/g, ' ').trim();
        if (!cleaned) return this.ui.renderSubtitle('', false);
        const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
        let compact = sentences.slice(-2).join(' ').trim();
        if (compact.length > 180) compact = compact.slice(-180).trimStart();
        this.ui.renderSubtitle(compact, this.subtitleReady);
    }

    renderFullTranscription() {
        if (this.transcriptChunkMode === 'waiting' || !this.transcriptChunks.length) {
            this.ui.renderTranscriptWaiting('full-transcription');
            return;
        }

        const index = Math.max(0, Math.min(this.transcriptChunkIndex, this.transcriptChunks.length - 1));
        const chunk = this.transcriptChunks[index] || this.transcriptChunks[0];
        this.ui.renderTranscriptReel('full-transcription', {
            state: this.transcriptChunkMode === 'complete' ? 'complete' : 'live',
            headline: this.transcriptChunkMode === 'complete' ? 'Complete' : 'Speaking',
            phrase: chunk?.text || ''
        });
    }

    syncTranscriptReelPlayback() {
        if (!this.transcriptChunks.length || !this.pendingPlaybackStartAt) {
            this.transcriptChunkMode = 'waiting';
            this.renderFullTranscription();
            return;
        }

        this.clearTranscriptChunkTimers();
        this.transcriptChunkMode = 'live';
        const now = performance.now();

        this.transcriptChunks.forEach((chunk, index) => {
            const startMs = Number(chunk.startMs || 0);
            const timer = setTimeout(() => {
                this.transcriptChunkIndex = index;
                this.transcriptChunkMode = 'live';
                this.renderFullTranscription();
            }, Math.max(0, Math.round(this.pendingPlaybackStartAt + startMs - now)));
            this.transcriptChunkTimers.push(timer);
        });
    }

    clearTranscriptChunkTimers() {
        this.transcriptChunkTimers.forEach(timer => clearTimeout(timer));
        this.transcriptChunkTimers = [];
    }

    finalizeSubtitleText(text) {
        const clean = String(text || '').trim();
        if (clean) {
            this.narrationSourceText = clean;
            this.fullNarrationTranscript = clean;
            this.refreshTranscriptReel();
        }
    }

    resetSubtitleState() {
        this.subtitleBuffer = '';
        this.subtitleReady = false;
        this.fullNarrationTranscript = '';
        this.narrationSourceText = '';
        this.wordBoundaries = [];
        this.transcriptChunks = [];
        this.transcriptChunkIndex = -1;
        this.pendingPlaybackStartAt = null;
        this.transcriptChunkMode = 'waiting';
        this.clearTranscriptChunkTimers();
        this.ui.renderSubtitle('', false);
        this.renderFullTranscription();
    }

    refreshTranscriptReel() {
        const sourceText = this.narrationSourceText.trim();
        if (this.wordBoundaries.length > 0) {
            this.transcriptChunks = this.chunkWordBoundaries(this.wordBoundaries);
        } else if (sourceText) {
            this.transcriptChunks = this.chunkTranscriptText(sourceText);
        } else {
            this.transcriptChunks = [];
        }
        this.transcriptChunkIndex = -1;
        this.transcriptChunkMode = this.pendingPlaybackStartAt ? 'live' : 'waiting';
        this.renderFullTranscription();
        if (this.pendingPlaybackStartAt) {
            this.syncTranscriptReelPlayback();
        }
    }

    chunkTranscriptText(text, maxWords = 20) {
        const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        const chunks = [];
        let i = 0;
        while (i < words.length) {
            let end = Math.min(i + maxWords, words.length);
            for (let j = end - 1; j > i + 2; j--) {
                if (/[.!?]["')\]]?$/.test(words[j])) {
                    end = j + 1;
                    break;
                }
            }
            const slice = words.slice(i, end);
            const startMs = chunks.length === 0 ? 0 : chunks[chunks.length - 1].endMs + 120;
            const durationMs = Math.max(1400, slice.length * 320);
            chunks.push({
                text: slice.join(' '),
                startMs,
                endMs: startMs + durationMs
            });
            i = end;
        }
        return chunks;
    }

    chunkWordBoundaries(boundaries = [], maxWords = 20) {
        const words = boundaries.filter(Boolean);
        const chunks = [];
        for (let i = 0; i < words.length; i += maxWords) {
            const slice = words.slice(i, i + maxWords);
            if (!slice.length) continue;
            const startMs = Number(slice[0].offsetMs || 0);
            const last = slice[slice.length - 1];
            const endMs = Number(last.offsetMs || startMs) + Number(last.durationMs || 0) + 220;
            chunks.push({
                text: slice.map(item => String(item.word || '').trim()).filter(Boolean).join(' '),
                startMs,
                endMs
            });
        }
        return chunks;
    }

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

    handleMicPermissionError() { this.openQuestionComposer(); }

    async submitQuestion(forcedText, options = {}) {
        const input = options.source === 'slide-turn' ? document.getElementById('slide-question-input') : document.getElementById('question-input');
        const text = (typeof forcedText === 'string' ? forcedText : input.value).trim();
        if (!text || !this.sessionId) return;
        this.pendingQuestionText = text;
        try {
            const res = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, questionText: text, submittedBy: options.submittedBy || 'Audience' }) });
            if (!(await res.json()).success) throw new Error('Failed');
            input.value = ''; this.pendingQuestionText = null;
            this.setStatus('Question queued', 'paused', 'Answered after the current slide');
            this.userQuestions.push({ text, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
            this.ui.toggleQuestionDrawer(true);
        } catch (err) { console.error(err); this.setStatus('Question failed', 'paused', 'Retry'); }
    }

    renderScrubber() {
        const filmstrip = document.getElementById('scrubber-filmstrip');
        if (!filmstrip) return;
        filmstrip.innerHTML = '';

        if (!Array.isArray(this.slideDeck) || this.slideDeck.length === 0) return;

        // Update Prev/Next buttons
        const prevBtn = document.getElementById('scrubber-prev');
        const nextBtn = document.getElementById('scrubber-next');
        if (prevBtn) prevBtn.disabled = this.currentSlideIndex <= 0;
        // Next is only enabled for slides that are NOT future (i.e. already seen but before current, or current)
        // Actually, if we are at current, next should be disabled because future is locked.
        if (nextBtn) nextBtn.disabled = true; // We'll update this if we track a "viewed slide index"

        this.slideDeck.forEach((slide, index) => {
            const isFuture = index > this.currentSlideIndex;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'scrubber-thumb';
            if (index === this.currentSlideIndex) button.classList.add('active');
            if (isFuture) button.classList.add('disabled');
            
            if (slide?.image) {
                button.style.backgroundImage = `url(${slide.image})`;
            } else {
                button.classList.add('no-image');
            }
            
            const slideTitle = slide?.title ? String(slide.title) : 'Untitled slide';
            const label = isFuture ? 'Locked' : (index === this.currentSlideIndex ? 'Current' : 'Review');
            
            button.setAttribute('aria-label', `${label} slide ${index + 1}: ${slideTitle}`);
            button.title = isFuture ? 'Wait for narration' : `${label} slide ${index + 1}: ${slideTitle}`;
            
            button.innerHTML = `
                <span class="scrubber-thumb-index">${index + 1}</span>
                <span class="scrubber-thumb-title">${this.escapeHtml(slideTitle)}</span>
                <span class="scrubber-thumb-label">${label}</span>
            `;
            
            if (!isFuture) {
                button.addEventListener('click', () => this.handleScrubberSelect(index));
            } else {
                button.disabled = true;
            }
            filmstrip.appendChild(button);
        });
    }

    async handleScrubberSelect(index) {
        if (!this.sessionId || index < 0 || index >= this.slideDeck.length) return;
        try {
            await this.replaySlide(index);
        } catch (err) {
            console.warn('Replay request failed, falling back to direct jump:', err);
            if (index !== this.currentSlideIndex) {
                await this.jumpToSlide(index);
            }
        }
    }

    async navigateScrubber(direction) {
        const targetIndex = this.currentSlideIndex + direction;
        // Navigation is only allowed for already reached slides
        if (targetIndex >= 0 && targetIndex <= this.currentSlideIndex) {
            await this.handleScrubberSelect(targetIndex);
        }
    }

    async replaySlide(index) {
        const res = await this.apiFetch('/api/autoplex/replay-slide', {
            method: 'POST',
            body: JSON.stringify({ sessionId: this.sessionId, slideIndex: index })
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
            throw new Error(data?.error || 'Replay failed');
        }
        this.setStatus(data.cached ? 'Replaying' : 'Jumped', data.cached ? 'live' : 'paused', `Slide ${index + 1}`);
        return data;
    }

    async jumpToSlide(index) {
        try {
            await this.apiFetch('/api/slide/advance', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    targetSlide: index
                })
            });
            this.setStatus('Jumped', 'paused', `Slide ${index + 1}`);
        } catch (err) {
            console.error('Failed to jump to slide:', err);
        }
    }

    addQuestionToList(id, text, by) {
        if (this.questions.has(id)) return;
        this.questions.set(id, { id, text, status: 'pending' });
        this.syncQuestionCount();
        const list = document.getElementById('qa-list');
        const empty = list.querySelector('.qa-empty-state'); if (empty) empty.remove();
        const item = document.createElement('div'); item.className = 'qa-card is-pending'; item.id = `q-${id}`;
        item.innerHTML = `
            <div class="qa-card-meta">
                <span>${this.escapeHtml(by)}</span>
                <span>Just Now</span>
            </div>
            <div class="qa-card-question">${this.escapeHtml(text)}</div>
        `;
        list.appendChild(item); list.scrollTop = list.scrollHeight;
    }

    markQuestionAnswered(id, ans, txt) {
        if (!this.questions.has(id)) this.addQuestionToList(id, txt, 'Audience');
        const target = document.getElementById(`q-${id}`); if (!target) return;
        const q = this.questions.get(id); if (q) q.status = 'answered';
        target.classList.remove('is-pending'); target.classList.add('is-answered');
        let node = target.querySelector('.qa-card-answer'); if (!node) { node = document.createElement('div'); node.className = 'qa-card-answer'; target.appendChild(node); }
        this.ui.renderAnswerReel(node, ans);
        this.syncQuestionCount();
    }

    handleQueueUpdate(data) {
        if (data.questionId && data.status === 'answered') {
            const q = this.questions.get(data.questionId); if (q) q.status = 'answered';
            const item = document.getElementById(`q-${data.questionId}`); if (item) { item.classList.remove('is-pending'); item.classList.add('is-answered'); }
        }
        this.syncQuestionCount();
    }

    syncQuestionCount() {
        const total = this.questions.size;
        const pending = Array.from(this.questions.values()).filter(q => q.status !== 'answered').length;
        this.ui.syncQuestionCount(total, pending);
    }

    async handleInterruptMic() {
        this.openQuestionComposer();
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

    openQuestionComposer() {
        this.ui.toggleQuestionDrawer(true);
        const input = document.getElementById('question-input');
        if (input) input.focus();
        this.setStatus('Questions', 'paused', 'Type a question to queue it');
    }

    restorePresentationStatus() {
        if (this.voiceModeEnabled) { this.setStatus('Questions', 'paused', 'Type a question to queue it'); return; }
        if (this.wrapUpEndsAt > Date.now()) { this.setStatus('Final questions', 'paused', 'Type a question to queue it'); return; }
        if (this.awaitingSlideContinue) { this.setStatus('Your turn', 'paused', 'Type a question or continue'); return; }
        if (this.isQAPhase) { this.setStatus('Q&A', 'paused', 'Answering questions'); return; }
        this.setStatus('Presenting', 'live', 'Narration live');
    }

    startWrapUp(data = {}) {
        this.wrapUpSelections = {}; this.wrapUpMcqs = Array.isArray(data.mcqs) ? data.mcqs : []; this.wrapUpIndex = 0;
        this.wrapUpEndsAt = Number(data.endsAt) || (Date.now() + 60000);
        this.renderWrapUpMcqs();
        document.getElementById('wrapup-message').textContent = data.promptText || 'One minute for questions.';
        document.getElementById('wrapup-panel').classList.remove('hidden'); document.getElementById('completion-overlay').classList.remove('hidden');
        this.setStatus('Final questions', 'paused', 'Type a question to queue it');
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
        document.getElementById('completion-overlay').classList.remove('hidden');
        this.stopWaveform();
        this.loadCtaBlocks();
    }

    async loadCtaBlocks() {
        const projectSlug = 'beforest';
        try {
            const res = await fetch(`/api/cms/projects/${projectSlug}/cta-blocks`);
            const data = await res.json();
            const blocks = data.ctaBlocks || [];
            if (blocks.length === 0) return;
            const container = document.getElementById('cta-blocks');
            const section = document.getElementById('completion-cta');
            container.innerHTML = '';
            const icons = {
                calendar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
                tree: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14l-5-5-5 5"/><path d="M13 20V8"/><path d="M9 20v-4H5l7-7 7 7h-4v4"/></svg>',
                mail: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
                globe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
            };
            blocks.forEach(block => {
                const el = document.createElement('a');
                el.href = block.url;
                el.target = block.url.startsWith('http') ? '_blank' : '_self';
                el.rel = 'noopener noreferrer';
                el.className = 'cta-block';
                el.innerHTML = `
                    <div class="cta-block-left">
                        <div class="cta-block-icon">${icons[block.icon] || icons.globe}</div>
                        <div class="cta-block-label">${block.label}</div>
                    </div>
                    <div class="cta-block-arrow">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>`;
                container.appendChild(el);
            });
            section.classList.remove('hidden');
        } catch (err) {
            console.warn('Could not load CTA blocks:', err);
        }
    }

    renderWrapUpMcqs() {
        const container = document.getElementById('wrapup-mcqs'); container.innerHTML = '';
        document.getElementById('wrapup-progress').textContent = '';
        document.getElementById('wrapup-prev').style.display = 'none';
        document.getElementById('wrapup-next').style.display = 'none';
        
        if (!this.wrapUpMcqs || !this.wrapUpMcqs.length) return;
        
        // Compact list of all MCQs
        this.wrapUpMcqs.forEach((mcq) => {
            const card = document.createElement('div'); card.className = 'wrapup-card compact-mcq';
            const title = document.createElement('div'); title.className = 'wrapup-card-title compact-title'; title.textContent = mcq.prompt; card.appendChild(title);
            const options = document.createElement('div'); options.className = 'wrapup-options compact-options';
            const votes = this.votes.get(mcq.id) || {}; const total = Object.values(votes).reduce((s,v)=>s+v,0);
            
            (mcq.options || []).forEach((opt, idx) => {
                const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'wrapup-option compact-option';
                const count = votes[opt] || 0; const pct = total > 0 ? (count/total)*100 : 0;
                btn.innerHTML = `<span class="option-text">${opt}</span><div class="option-bar-bg"><div class="option-bar" style="width:${pct}%;"></div></div><span class="option-count">${count > 0 ? count : ''}</span>`;
                if (this.wrapUpSelections[mcq.id] === opt) btn.classList.add('is-selected');
                btn.addEventListener('click', () => { if (this.wrapUpSelections[mcq.id] === opt) return; this.wrapUpSelections[mcq.id] = opt; this.socketClient.submitVote(mcq.id, opt); this.renderWrapUpMcqs(); });
                options.appendChild(btn);
            });
            card.appendChild(options); container.appendChild(card);
        });
    }

    renderQASlides(questions) {
        const container = document.getElementById('wrapup-qa-slides');
        if (!container) return;
        
        container.innerHTML = '';
        if (!questions || !questions.length) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        // Create a horizontal scrollable list of QA cards
        const scrollArea = document.createElement('div');
        scrollArea.className = 'qa-slides-scroll';
        
        questions.forEach((q, idx) => {
            if (!q.answer_text) return; // Only show answered ones
            const card = document.createElement('div');
            card.className = 'qa-slide-card';
            card.innerHTML = `
                <div class="qa-slide-header"><span class="qa-eyebrow">Question ${idx + 1}</span></div>
                <div class="qa-slide-q">"${this.escapeHtml(q.question_text)}"</div>
                <div class="qa-slide-a">${this.escapeHtml(q.answer_text)}</div>
            `;
            scrollArea.appendChild(card);
        });
        
        if (scrollArea.children.length > 0) {
            const title = document.createElement('h3');
            title.className = 'qa-slides-title';
            title.textContent = 'Audience Questions';
            container.appendChild(title);
            container.appendChild(scrollArea);
        }
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
    onVoiceSessionConnected() { this.voiceModeEnabled = false; this.updateMicState(); this.setStatus('Questions', 'paused', 'Type a question to queue it'); }
    onVoiceSessionDisconnected() { this.voiceModeEnabled = false; this.updateMicState(); this.restorePresentationStatus(); }

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
