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
        this.unreadAnswerCount = 0;
        this.maxViewedSlideIndex = 0;
        this.notifiedAnswerIds = new Set();
        
        this.wrapUpTimer = null;
        this.wrapUpEndsAt = 0;
        this.wrapUpSelections = {};
        this.wrapUpMcqs = [];
        this.wrapUpIndex = 0;
        
        this.subtitleBuffer = '';
        this.subtitleReady = false;
        this.fullNarrationTranscript = '';
        this.narrationSourceText = '';
        this.pendingNarrationText = '';
        this.wordBoundaries = [];
        this.transcriptChunks = [];
        this.transcriptChunkIndex = -1;
        this.transcriptChunkTimers = [];
        this.activeTranscriptWordIndex = -1;
        this.pendingPlaybackStartAt = null;
        this.totalAudioDurationMs = 0;
        this.transcriptChunkMode = 'waiting';
        this.slideDeck = [];
        this.presentationCatalog = [];
        this.loadingQuotes = [];
        this.awaitingPlaybackComplete = false;
        this.awaitingSlideContinue = false;

        this.isAudioPaused = false;
        this.pauseStartMs = null;
        this.forceFreshSession = false;
        this.currentSlideEnteredAt = null;
        this.sessionMemory = this.createEmptySessionMemory();
        this.pendingSlideAdvance = null;
        this.microCommitmentPromptsShown = new Set();
        this.microCommitmentResumeGuardIndex = -1;


        this.questionAudioPlayer = document.getElementById('audio-player');
        this.activeQuestionAudioButton = null;
        this.questionAudioPausedNarration = false;
        this.slideAudioStarted = false;
        this.activeAudioSlideIndex = null;

        this.bindEvents();
        this.bindQuestionAudioControls();
        this.streamPlayer.onStreamStart = ({ startedAtMs }) => {
            console.log('[StreamStart] Audio started at:', startedAtMs);
            this.pendingPlaybackStartAt = startedAtMs;
            this._progressDebugLogged = false;
            this._firstProgressLogged = false;
            this.syncTranscriptReelPlayback();
            this.startTranscriptProgress();
        };
        this.streamPlayer.onTimelineUpdate = ({ startedAtMs, endsAtMs }) => {
            if (Number.isFinite(startedAtMs) && !this.pendingPlaybackStartAt) {
                this.pendingPlaybackStartAt = startedAtMs;
            }
            if (Number.isFinite(startedAtMs) && Number.isFinite(endsAtMs) && endsAtMs > startedAtMs) {
                this.totalAudioDurationMs = Math.max(this.totalAudioDurationMs, Math.round(endsAtMs - startedAtMs));
            }
        };
        this.loadLoadingQuotes();
        this.setupSpeechRecognitionFallback();

        // Testing Hook: skip to completion screen via URL (?state=end)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('state') && urlParams.get('state') === 'end') {
            console.log('[Test] Skipping to completion screen');
            this._skipToCompletion();
        } else {
            this.loadSessionConfig();
            this.loadPresentationCatalog();
        }
    }

    async loadLoadingQuotes() {
        try {
            const res = await fetch('/api/cms/projects/beforest/loading-quotes');
            if (res.ok) {
                const quotes = await res.json();
                this.loadingQuotes = Array.isArray(quotes) && quotes.length > 0 ? quotes : [
                    { text: "10% isn't about subtraction - it's about protection.", author: "Beforest" },
                    { text: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" }
                ];
            } else {
                this.loadingQuotes = [
                    { text: "10% isn't about subtraction - it's about protection.", author: "Beforest" },
                    { text: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" }
                ];
            }
        } catch (err) {
            console.warn('Failed to load loading quotes:', err);
            this.loadingQuotes = [
                { text: "10% isn't about subtraction - it's about protection.", author: "Beforest" },
                { text: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" }
            ];
        }
    }

    async _skipToCompletion() {
        try {
            if (this.presentationCatalog.length === 0) {
                await this.loadPresentationCatalog();
            }

            if (this.presentationCatalog.length > 0) {
                const pres = this.presentationCatalog.find(p => p.source === 'supabase') || this.presentationCatalog[0];
                const presId = pres.id || pres.slug || 'beforest';
                try {
                    const detailRes = await fetch(`/api/cms/presentations/${encodeURIComponent(presId)}`);
                    if (detailRes.ok) {
                        const detailData = await detailRes.json();
                        if (detailData.presentation && Array.isArray(detailData.presentation.slides)) {
                            this.slideDeck = detailData.presentation.slides;
                        }
                    }
                } catch (e) {
                    console.warn('[Test] Could not load presentation detail for slides:', e);
                }
            }
        } catch (err) {
            console.error('[Test] _skipToCompletion failed:', err);
        }

        const ss = document.getElementById('start-screen');
        if (ss) {
            ss.classList.add('hidden');
            ss.style.display = 'none';
        }
        document.getElementById('present-view')?.classList.remove('hidden');
        this.showCompletion({ totalSlides: this.slideDeck.length || 0, totalQuestionsAnswered: 0 });
    }

    resetSessionRuntimeState() {
        this.captureCurrentSlideEngagement();
        this.currentSlideIndex = 0;
        this.currentSlide = null;
        this.currentSlideEnteredAt = null;
        this.questions = new Map();
        this.userQuestions = [];
        this.unreadAnswerCount = 0;
        this.maxViewedSlideIndex = 0;
        this.userReactions = [];
        this.wrapUpSelections = {};
        this.wrapUpMcqs = [];
        this.wrapUpIndex = 0;
        this.sessionMemory = this.createEmptySessionMemory();
        this.pendingSlideAdvance = null;
        this.microCommitmentPromptsShown = new Set();
        this.microCommitmentResumeGuardIndex = -1;
        this.notifiedAnswerIds.clear();
        this.updateHistoryBadge();
        const qaList = document.getElementById('qa-list');
        if (qaList) {
            qaList.innerHTML = '';
        }
        const filmstrip = document.getElementById('scrubber-filmstrip');
        if (filmstrip) {
            filmstrip.innerHTML = '';
        }
    }

    createEmptySessionMemory() {
        return {
            slideMoments: [],
            totalSlideDwellMs: 0,
            microCommitments: [],
            interests: {
                returns: 0,
                philosophy: 0,
                operations: 0,
                stay: 0,
                community: 0,
                trust: 0
            }
        };
    }

    bumpInterestBucket(bucket, weight = 1) {
        if (!bucket) return;
        if (!this.sessionMemory?.interests) {
            this.sessionMemory = this.createEmptySessionMemory();
        }
        if (!Object.prototype.hasOwnProperty.call(this.sessionMemory.interests, bucket)) {
            this.sessionMemory.interests[bucket] = 0;
        }
        this.sessionMemory.interests[bucket] += weight;
    }

    inferInterestBucketsFromText(text = '') {
        const value = String(text || '').toLowerCase();
        if (!value) return [];

        const bucketMatchers = {
            returns: ['return', 'returns', 'price', 'pricing', 'cost', 'invest', 'investment', 'yield', 'roi', 'membership', 'lakhs', 'money'],
            philosophy: ['why', 'purpose', 'philosophy', 'vision', 'soul', 'ethos', 'belief', 'meaning', '10%', 'lifestyle'],
            operations: ['how', 'operate', 'operations', 'model', 'process', 'ownership', 'legal', 'structure', 'works', 'timeline'],
            stay: ['stay', 'visit', 'book', 'retreat', 'trip', 'experience', 'come', 'travel', 'night', 'weekend'],
            community: ['community', 'collective', 'members', 'membership', 'people', 'join', 'who else', 'network'],
            trust: ['proof', 'risk', 'safe', 'guarantee', 'credible', 'team', 'trust', 'track record']
        };

        return Object.entries(bucketMatchers)
            .filter(([, terms]) => terms.some((term) => value.includes(term)))
            .map(([bucket]) => bucket);
    }

    captureCurrentSlideEngagement() {
        if (!this.currentSlide || !this.currentSlideEnteredAt || !this.sessionMemory) return;

        const dwellMs = Math.max(0, Date.now() - this.currentSlideEnteredAt);
        if (dwellMs < 300) return;

        this.sessionMemory.slideMoments.push({
            slideIndex: this.currentSlideIndex,
            title: this.currentSlide.title || `Slide ${this.currentSlideIndex + 1}`,
            dwellMs
        });
        this.sessionMemory.totalSlideDwellMs += dwellMs;

        if (dwellMs > 45000) this.bumpInterestBucket('trust', 1);
        if (dwellMs > 70000) this.bumpInterestBucket('operations', 1);
    }

    getPrimaryInterestBucket() {
        const entries = Object.entries(this.sessionMemory?.interests || {}).sort((a, b) => b[1] - a[1]);
        return entries[0]?.[1] > 0 ? entries[0][0] : null;
    }

    getMostEngagedSlideMoment() {
        const slideMoments = Array.isArray(this.sessionMemory?.slideMoments) ? this.sessionMemory.slideMoments : [];
        if (!slideMoments.length) return null;
        return slideMoments.slice().sort((a, b) => b.dwellMs - a.dwellMs)[0];
    }

    buildCompletionSummary(data = {}) {
        const totalSlides = data.totalSlides || this.slideDeck.length || 0;
        const answeredQuestions = data.totalQuestionsAnswered || Array.from(this.questions.values()).filter(q => q.status === 'answered').length;
        const participantName = String(this.participantName || '').trim();
        const firstName = participantName ? participantName.split(/\s+/)[0] : '';
        const prefix = firstName ? `${firstName}, ` : '';
        const engagedSlide = this.getMostEngagedSlideMoment();
        const primaryInterest = this.getPrimaryInterestBucket();
        const lastMicroCommitment = Array.isArray(this.sessionMemory?.microCommitments) && this.sessionMemory.microCommitments.length
            ? this.sessionMemory.microCommitments[this.sessionMemory.microCommitments.length - 1]
            : null;
        const interestCopy = {
            returns: 'You kept steering toward the economics, not just the aesthetics.',
            philosophy: 'You stayed with the why behind the model, not only the mechanics.',
            operations: 'You leaned into how this actually works in practice.',
            stay: 'You responded most to the lived experience, not the brochure version.',
            community: 'You were reading for the people and the collective shape of the thing.',
            trust: 'You spent the most attention on signals of credibility and proof.'
        };

        const lines = [];
        lines.push(`${prefix}you moved through ${totalSlides} slides and opened ${answeredQuestions} meaningful thread${answeredQuestions === 1 ? '' : 's'}.`);
        if (engagedSlide?.title) {
            lines.push(`You lingered longest on “${engagedSlide.title},” which usually signals where the real decision is getting made.`);
        }
        if (primaryInterest && interestCopy[primaryInterest]) {
            lines.push(interestCopy[primaryInterest]);
        }
        if (lastMicroCommitment?.label) {
            lines.push(`By the end, you were clearly leaning toward ${lastMicroCommitment.label.toLowerCase()}.`);
        }

        return lines.join(' ');
    }

    buildCompletionMemoryPills(data = {}) {
        const answeredQuestions = data.totalQuestionsAnswered || Array.from(this.questions.values()).filter(q => q.status === 'answered').length;
        const engagedSlide = this.getMostEngagedSlideMoment();
        const primaryInterest = this.getPrimaryInterestBucket();
        const selectedWrapUp = Object.values(this.wrapUpSelections || {}).filter(Boolean);
        const primaryInterestLabel = {
            returns: 'Numbers',
            philosophy: 'Why',
            operations: 'How It Works',
            stay: 'Experience',
            community: 'Collective Fit',
            trust: 'Proof'
        };

        const pills = [];
        if (engagedSlide?.title) {
            pills.push({ label: 'Longest pause', value: engagedSlide.title });
        }
        if (primaryInterest) {
            pills.push({ label: 'Signal', value: primaryInterestLabel[primaryInterest] || primaryInterest });
        }
        if (answeredQuestions > 0) {
            pills.push({ label: 'Questions opened', value: String(answeredQuestions) });
        }
        if (selectedWrapUp.length > 0) {
            pills.push({ label: 'Last choice', value: selectedWrapUp[selectedWrapUp.length - 1] });
        }
        const microCommitments = Array.isArray(this.sessionMemory?.microCommitments) ? this.sessionMemory.microCommitments : [];
        if (microCommitments.length > 0 && pills.length < 3) {
            pills.push({ label: 'Thread chosen', value: microCommitments[microCommitments.length - 1].label });
        }
        return pills.slice(0, 3);
    }

    renderCompletionMemoryPills(pills = []) {
        const strip = document.getElementById('completion-memory-strip');
        if (!strip) return;
        strip.innerHTML = '';
        if (!pills.length) return;

        pills.forEach((pill) => {
            const el = document.createElement('div');
            el.className = 'completion-memory-pill';
            el.innerHTML = `<span>${this.escapeHtml(pill.label)}</span><strong>${this.escapeHtml(pill.value)}</strong>`;
            strip.appendChild(el);
        });
    }

    personalizeCtaBlocks(blocks = []) {
        const primaryInterest = this.getPrimaryInterestBucket();
        const selectedWrapUp = Object.values(this.wrapUpSelections || []).filter(Boolean).join(' ').toLowerCase();
        const microCommitmentLabels = Array.isArray(this.sessionMemory?.microCommitments)
            ? this.sessionMemory.microCommitments.map((item) => String(item.label || '').toLowerCase()).join(' ')
            : '';

        const scoreBlock = (block) => {
            const text = `${block.label || ''} ${block.url || ''}`.toLowerCase();
            let score = 0;

            if (primaryInterest === 'returns' && /call|contact|invest|numbers|capital|membership/.test(text)) score += 4;
            if (primaryInterest === 'operations' && /call|contact|how|collective|model/.test(text)) score += 4;
            if (primaryInterest === 'stay' && /stay|visit|retreat|experience|book/.test(text)) score += 5;
            if (primaryInterest === 'community' && /collective|join|community|members/.test(text)) score += 5;
            if (primaryInterest === 'philosophy' && /story|about|collective|visit|experience/.test(text)) score += 3;
            if (/call|contact/.test(text)) score += 1;
            if (/join|collective/.test(text) && /collective|community/.test(selectedWrapUp)) score += 3;
            if (/stay|visit|retreat|experience/.test(text) && /stay|visit|experience/.test(selectedWrapUp)) score += 3;
            if (/call|contact|numbers|investment/.test(text) && /numbers|returns/.test(microCommitmentLabels)) score += 2;
            if (/stay|visit|retreat|experience/.test(text) && /visit|stay|experience/.test(microCommitmentLabels)) score += 2;
            if (/collective|join|community/.test(text) && /collective|community/.test(microCommitmentLabels)) score += 2;

            return score;
        };

        return blocks
            .map((block, index) => ({ block, index, score: scoreBlock(block) }))
            .sort((a, b) => (b.score - a.score) || (a.index - b.index))
            .map((item, index) => {
                if (index !== 0) return item.block;
                if (primaryInterest === 'returns') return { ...item.block, label: 'Talk through the numbers' };
                if (primaryInterest === 'operations') return { ...item.block, label: 'See how the model works' };
                if (primaryInterest === 'stay') return { ...item.block, label: 'Experience it in person' };
                if (primaryInterest === 'community') return { ...item.block, label: 'Find your collective fit' };
                return item.block;
            });
    }

    buildMicroCommitmentChoices() {
        const currentTitle = String(this.currentSlide?.title || '').toLowerCase();
        const currentContent = String(this.currentSlide?.content || '').toLowerCase();
        const currentNotes = String(this.currentSlide?.notes || '').toLowerCase();
        const combined = `${currentTitle} ${currentContent} ${currentNotes}`;
        const options = [];
        const push = (id, label, bucket) => {
            if (options.some((item) => item.id === id)) return;
            options.push({ id, label, bucket });
        };

        push('returns', 'Show me the numbers', 'returns');
        push('operations', 'How does it work?', 'operations');

        if (/stay|retreat|visit|experience|forest|place/.test(combined)) {
            push('stay', 'What does it feel like?', 'stay');
        } else {
            push('community', 'Who is this for?', 'community');
        }

        if (/philosophy|soul|why|collective|life|lifestyle/.test(combined)) {
            push('philosophy', 'Why does this matter?', 'philosophy');
        }

        return options.slice(0, 3);
    }

    shouldOpenMicroCommitment(slideIndex) {
        if (this.isQAPhase || this.wrapUpEndsAt > Date.now()) return false;
        if (this.totalSlides < 4) return false;
        if (slideIndex < 1 || slideIndex >= this.totalSlides - 1) return false;
        if (slideIndex <= this.microCommitmentResumeGuardIndex) return false;
        if (this.microCommitmentPromptsShown.has(slideIndex)) return false;
        return (slideIndex + 1) % 2 === 0;
    }

    recordMicroCommitment(choice = {}) {
        if (!choice?.id || !choice?.label) return;
        if (!Array.isArray(this.sessionMemory.microCommitments)) {
            this.sessionMemory.microCommitments = [];
        }
        this.sessionMemory.microCommitments.push({
            id: choice.id,
            label: choice.label,
            bucket: choice.bucket || '',
            slideIndex: this.currentSlideIndex,
            timestamp: Date.now()
        });
        if (choice.bucket) {
            this.bumpInterestBucket(choice.bucket, 4);
        }
    }

    prepareMicroCommitmentTurn(slideIndex, payload = {}) {
        this.pendingSlideAdvance = { completedSlideIndex: slideIndex };
        this.microCommitmentPromptsShown.add(slideIndex);
        const pendingQuestionCount = Array.from(this.questions.values()).filter((q) => q.status !== 'answered').length;
        this.openSlideTurnOverlay({
            ...payload,
            pendingQuestionCount,
            choiceOptions: this.buildMicroCommitmentChoices()
        });
    }

    async finalizePendingSlideAdvance() {
        if (!this.pendingSlideAdvance) return false;
        const { completedSlideIndex } = this.pendingSlideAdvance;
        this.pendingSlideAdvance = null;
        this.awaitingSlideContinue = false;
        this.ui.closeSlideTurnOverlay();
        this.updateMicState();
        this.setStatus('Presenting', 'live', 'Narration live');
        this.socketClient.notifyPlaybackComplete(this.sessionId, completedSlideIndex);
        return true;
    }

    handleSlideTurnChoice(event) {
        const button = event.target?.closest?.('.slide-turn-choice');
        if (!button) return;
        const choice = {
            id: button.dataset.choiceId || '',
            label: button.dataset.choiceLabel || button.textContent || '',
            bucket: button.dataset.choiceBucket || ''
        };
        this.recordMicroCommitment(choice);
        this.ui.openSlideTurnOverlay({
            pendingQuestionCount: Array.from(this.questions.values()).filter((q) => q.status !== 'answered').length,
            choiceOptions: this.buildMicroCommitmentChoices(),
            selectedChoiceId: choice.id,
            selectedChoiceLabel: choice.label
        });
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

    setStartScreenMode(mode = 'form') {
        const recoveryMsg = document.getElementById('session-recovery-msg');
        const startForm = document.getElementById('start-form');
        const showRecovery = mode === 'recovery';

        if (recoveryMsg) recoveryMsg.classList.toggle('hidden', !showRecovery);
        if (startForm) startForm.classList.toggle('hidden', showRecovery);
    }

    getPersistedSession() {
        try {
            const raw = localStorage.getItem(VoicePPTApp.STORAGE_KEYS.SESSION);
            if (!raw) {
                console.log('[Session] No persisted session in localStorage');
                return null;
            }
            const session = JSON.parse(raw);
            const age = Date.now() - (session.storedAt || 0);
            console.log('[Session] Found persisted session:', session.sessionId, 'participant:', session.participantName, 'age:', Math.round(age / 1000 / 60), 'min, ttl:', Math.round(VoicePPTApp.SESSION_TTL_MS / 1000 / 60), 'min');
            if (age > VoicePPTApp.SESSION_TTL_MS) {
                console.log('[Session] Session expired, clearing');
                this.clearPersistedSession();
                return null;
            }
            return session;
        } catch (err) {
            console.error('[Session] Error reading persisted session:', err);
            return null;
        }
    }

    async restorePersistedSession(session) {
        console.log('[Session] Attempting to restore session:', session.sessionId, 'participant:', session.participantName);
        try {
            const res = await this.apiFetch(`/api/session/${session.sessionId}`);
            console.log('[Session] Restore response status:', res.status);
            
            // 404 = session truly gone, clear localStorage
            if (res.status === 404) {
                console.log('[Session] Session not found on server (404), clearing localStorage');
                this.clearPersistedSession();
                return false;
            }
            
            if (!res.ok) {
                console.log('[Session] Restore failed - HTTP', res.status, '- keeping session for retry');
                return false;
            }
            
            const data = await res.json();
            console.log('[Session] Restore response data - status:', data.session?.status);
            if (!data.session || !['active', 'presenting', 'wrapup', 'completed'].includes(data.session.status)) {
                console.log('[Session] Restore failed - bad status:', data.session?.status, '- clearing');
                this.clearPersistedSession();
                return false;
            }
            this.resetSessionRuntimeState();
            this.sessionId = session.sessionId;
            this.controlToken = session.controlToken || '';
            this.participantName = session.participantName || data.participantName || '';
            this.totalSlides = data.session.slide_count || session.slideCount || 0;
            const restoredSlideIndex = Number(data.session.current_slide_index || 0);
            this.maxViewedSlideIndex = Math.max(this.maxViewedSlideIndex, restoredSlideIndex);
            // Resumed sessions should continue smoothly. Skip guided-choice pauses
            // for the restored slide and the very next slide completion.
            this.microCommitmentResumeGuardIndex = restoredSlideIndex + 1;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = session.presentationTitle || session.deckId || '';
            await this.primeInitialSlide();
            await this.loadSessionSlides();
            await this.loadSessionQuestions();
            await this.socketClient.connect(this.sessionId, this.controlToken);
            document.getElementById('question-input').disabled = false;
            document.getElementById('submit-question').disabled = false;
            this.setStatus('Resumed', 'live', 'Session restored');
            this.syncQuestionCount();
            console.log('[Session] Restore successful!');
            return true;
        } catch (err) {
            console.error('[Session] Restore failed with error:', err, '- keeping session for retry');
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
            
            // Pre-fill name if we have it from a previous session
            if (persistedSession?.participantName) {
                const nameInput = document.getElementById('participant-name');
                if (nameInput) nameInput.value = persistedSession.participantName;
            }
            
            if (persistedSession) {
                console.log('[Session] Have persisted session, showing recovery choice');
                this.setStartScreenMode('recovery');
            } else {
                console.log('[Session] No persisted session found');
                this.setStartScreenMode('form');
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
        on('scrubber-close', 'click', () => {
            const scrubber = document.getElementById('scrubber-container');
            if (scrubber) scrubber.classList.add('hidden');
            this.resumePresentationAfterHistory();
        });
        on('scrubber-prev', 'click', () => this.navigateScrubber(-1));
        on('scrubber-next', 'click', () => this.navigateScrubber(1));
        on('scrubber-container', 'click', (e) => {
            if (e.target.id === 'scrubber-container') {
                e.target.classList.add('hidden');
                this.resumePresentationAfterHistory();
            }
        });

        on('start-presentation', 'click', () => this.startSession());
        on('participant-name', 'keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.startSession(); }
        });
        on('submit-question', 'click', () => this.submitQuestion());
        on('question-input', 'keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuestion(); }
        });
        on('chat-toggle', 'click', () => this.ui.toggleQuestionDrawer(true));
        on('qa-close', 'click', () => this.ui.toggleQuestionDrawer(false));
        on('qa-scrim', 'click', () => this.ui.toggleQuestionDrawer(false));
        on('restart-btn', 'click', () => location.reload());
        on('chat-widget-toggle', 'click', () => this.toggleChatWidget());
        on('slide-pause-btn', 'click', () => this.toggleAudioPause());
        on('interrupt-mic', 'click', () => this.openQuestionComposer());
        on('slide-turn-mic', 'click', () => this.openQuestionComposer());
        on('wrapup-mic', 'click', () => this.openQuestionComposer());
        on('slide-turn-continue', 'click', () => this.continuePresentationFlow());
        on('footer-continue-btn', 'click', () => this.continuePresentationFlow());
        on('slide-question-send', 'click', () => this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' }));
        on('slide-question-input', 'keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' });
            }
        });
        document.getElementById('slide-turn-choices')?.addEventListener('click', (event) => this.handleSlideTurnChoice(event));
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

        on('resume-session', 'click', () => {
            const persisted = this.getPersistedSession();
            if (persisted) this.restorePersistedSession(persisted);
        });
        on('new-session', 'click', () => {
            this.clearPersistedSession();
            this.setStartScreenMode('form');
            this.resetSessionRuntimeState();
            this.forceFreshSession = true; // Flag to bypass master assets
            // Refresh catalog to ensure fresh state
            this.loadPresentationCatalog();
            document.getElementById('participant-name')?.focus();
        });
    }

    bindQuestionAudioControls() {
        if (!this.questionAudioPlayer) return;

        this.questionAudioPlayer.addEventListener('play', () => {
            this.updateQuestionAudioButtonState(this.activeQuestionAudioButton, true);
        });
        this.questionAudioPlayer.addEventListener('pause', () => {
            this.updateQuestionAudioButtonState(this.activeQuestionAudioButton, false);
        });
        this.questionAudioPlayer.addEventListener('ended', () => {
            this.updateQuestionAudioButtonState(this.activeQuestionAudioButton, false);
            if (this.activeQuestionAudioButton) {
                this.activeQuestionAudioButton.dataset.playing = 'false';
            }
            this.activeQuestionAudioButton = null;
            this.resumeMainNarrationAfterQuestionAudio();
        });
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
        
        // Find the reaction bar on the screen to use as the origin point
        const reactionButtons = document.querySelectorAll('.reaction-btn');
        let sourceRect = null;
        
        // Try to find the button for this specific emoji
        for (const btn of reactionButtons) {
            if (btn.getAttribute('data-emoji') === emoji) {
                sourceRect = btn.getBoundingClientRect();
                break;
            }
        }
        
        // Fallback to the first button or a reasonable position
        if (!sourceRect && reactionButtons.length > 0) {
            sourceRect = reactionButtons[0].getBoundingClientRect();
        }

        const stageRect = container.getBoundingClientRect();

        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'floating-reaction';
            el.textContent = emoji;
            el.style.color = color;
            
            let startX, startBottom;

            if (sourceRect) {
                // Position relative to the source button, but adjusted for the stage container
                startX = (sourceRect.left + sourceRect.width / 2) - stageRect.left + (Math.random() * 40 - 20);
                startBottom = stageRect.bottom - sourceRect.top - 10;
            } else {
                // Old fallback logic
                startX = window.innerWidth > 720 ? (window.innerWidth - 100 + (Math.random() * 60 - 30)) : (window.innerWidth / 2 + (Math.random() * 100 - 50));
                startBottom = 100;
            }

            const drift = (Math.random() * 120 - 60) + 'px';
            const rotation = (Math.random() * 40 - 20) + 'deg';
            const scale = 0.8 + Math.random() * 1.2;
            const duration = 1.5 + Math.random() * 1;
            const delay = Math.random() * 0.2;
            
            el.style.left = `${startX}px`;
            el.style.bottom = `${startBottom}px`;
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
            const res = await this.apiFetch(`/api/session/${this.sessionId}`);
            if (!res.ok) return;
            const data = await res.json();
            const slides = Array.isArray(data.slides) ? data.slides : [];
            this.slideDeck = slides;
            if (slides.length > 0) {
                this.renderScrubber();
            } else if (this.ui?.renderEmptyHistory) {
                this.ui.renderEmptyHistory('scrubber-filmstrip');
            }
        } catch (err) {
            console.warn('Failed to load session slides:', err);
        }
    }

    async loadSessionQuestions() {
        if (!this.sessionId) return;
        try {
            const [sessionRes, answeredRes] = await Promise.all([
                this.apiFetch(`/api/session/${this.sessionId}`),
                this.apiFetch(`/api/questions/${this.sessionId}?status=answered`)
            ]);

            if (sessionRes.ok) {
                const sessionData = await sessionRes.json();
                const pending = Array.isArray(sessionData.pendingQuestions) ? sessionData.pendingQuestions : [];
                pending.forEach((question) => {
                    if (!this.questions.has(question.id)) {
                        this.addQuestionToList(question.id, question.question_text, question.submitted_by || 'Audience', {
                            status: question.status,
                            answerTitle: question.answer_title,
                            answerSummary: question.answer_summary,
                            answerDetails: question.answer_details,
                            answerAudioUrl: question.answer_audio_url,
                            answerAudioPath: question.answer_audio_path,
                            answerAudioDurationMs: question.answer_audio_duration_ms,
                            audioSource: question.audio_source
                        });
                    }
                });
            }

            if (answeredRes.ok) {
                const answered = await answeredRes.json();
                if (Array.isArray(answered)) {
                    answered.forEach((question) => {
                        this.handleQuestionAnswerReady({
                            questionId: question.id,
                            questionText: question.question_text,
                            submittedBy: question.submitted_by,
                            answerText: question.answer_text,
                            answerTitle: question.answer_title,
                            answerSummary: question.answer_summary,
                            answerDetails: question.answer_details,
                            answerAudioUrl: question.answer_audio_url,
                            answerAudioPath: question.answer_audio_path,
                            answerAudioDurationMs: question.answer_audio_duration_ms,
                            audioSource: question.audio_source,
                            suppressNotification: true
                        });
                    });
                }
            }
        } catch (err) {
            console.warn('Failed to load session questions:', err);
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

        // iOS Safari requires user gesture to unlock audio - call BEFORE async operations
        this.streamPlayer?.unlockIOSAudio();

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const bypassMaster = this.forceFreshSession || urlParams.get('force_fresh') === 'true' || urlParams.has('fresh');
            
            const res = await this.apiFetch('/api/session/start', { 
                method: 'POST', 
                body: JSON.stringify({ deckId, participantName, passcode, bypassMaster }) 
            });
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
            this.ui.showLoadingScreen(this.loadingQuotes);

            this.sessionId = data.sessionId; this.controlToken = data.controlToken || '';
            this.totalSlides = data.slideCount || 0; this.participantName = data.participantName || participantName;
            this.resetSessionRuntimeState();
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

            // Start polling pre-generation progress IMMEDIATELY — don't wait for other ops.
            const preGenPromise = this.waitForPreGeneration();

            // Run setup tasks in parallel with pre-gen polling.
            await Promise.all([
                this.primeInitialSlide(),
                this.loadSessionSlides(),
                Promise.resolve(this.socketClient.connect(this.sessionId, this.controlToken)),
            ]);

            document.getElementById('question-input').disabled = false;
            document.getElementById('submit-question').disabled = false;

            // Wait for pre-generation to finish (may already be done).
            await preGenPromise;
            
            this.ui.hideLoadingScreen();
            await this.loadSessionQuestions();
            
            this.setStatus('Ready', 'live', 'Type questions anytime');
            this.syncQuestionCount();
            await this.triggerAutoPlex();
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
            if (Array.isArray(data?.slides) && data.slides.length > 0) {
                this.slideDeck = data.slides;
            }
            // updateSlide must be called BEFORE renderScrubber so maxViewedSlideIndex is set
            if (data?.currentSlide) this.updateSlide({ slideIndex: data.session?.current_slide_index || 0, totalSlides: data.session?.slide_count || this.totalSlides, slide: data.currentSlide });
            // Now render scrubber with proper accessibility state
            this.renderScrubber();
        } catch (err) { console.error('Initial slide fetch failed:', err); }
    }

    async triggerAutoPlex() {
        try { await this.apiFetch('/api/autoplex', { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); } catch (err) { console.error('AutoPlex trigger failed:', err); }
    }

    async waitForPreGeneration() {
        const maxWait = 30000;
        const pollInterval = 300;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            try {
                const res = await this.apiFetch(`/api/session/pregen-progress/${this.sessionId}`);
                if (res.ok) {
                    const progress = await res.json();
                    console.log('[PreGen] Progress:', progress);
                    
                    // Update loading screen with progress
                    if (this.ui.updateLoadingProgress) {
                        this.ui.updateLoadingProgress(progress);
                    }
                    
                    if (progress.status === 'complete') {
                        console.log('[PreGen] Pre-generation complete!');
                        return true;
                    }
                    if (progress.status === 'failed') {
                        console.warn('[PreGen] Pre-generation failed, proceeding anyway');
                        return false;
                    }
                    if (progress.status === 'no-slides') {
                        return true;
                    }
                }
            } catch (err) {
                console.warn('[PreGen] Progress poll failed:', err.message);
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
        console.warn('[PreGen] Pre-generation timeout after', maxWait, 'ms, proceeding anyway');
        return false;
    }

    updateSlide(data) {
        this.captureCurrentSlideEngagement();
        this.currentSlideIndex = data.slideIndex;
        this.totalSlides = data.totalSlides || this.totalSlides;
        this.maxViewedSlideIndex = Math.max(this.maxViewedSlideIndex, this.currentSlideIndex);
        this.currentSlide = data.slide || null;
        this.currentSlideEnteredAt = Date.now();
        this.slideAudioStarted = false;
        this.activeAudioSlideIndex = null;

        // Keep slideDeck in sync so scrubber always has data
        if (data.slide) {
            if (!Array.isArray(this.slideDeck)) this.slideDeck = [];
            if (this.slideDeck[data.slideIndex]) {
                this.slideDeck[data.slideIndex] = { ...this.slideDeck[data.slideIndex], ...data.slide };
            } else {
                this.slideDeck[data.slideIndex] = data.slide;
            }
        }

        this.ui.closeSlideTurnOverlay();
        this.resetSubtitleState();
        this.fullNarrationTranscript = '';
        this.ui.updateFullTranscriptionDisplay('');
        document.getElementById('slide-counter').textContent = `${data.slideIndex + 1} / ${data.totalSlides || this.totalSlides || this.slideDeck.length || '?'}`;
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
        if (!this.voiceModeEnabled) { this.streamPlayer.reset();  }
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

    handleNarrationText(data = {}) {
        const text = String(data?.text || '').trim();
        if (!text) return;

        if (!this.slideAudioStarted && !data?.isQA && !data?.isWrapUp) {
            this.pendingNarrationText = text;
            return;
        }

        this.pendingNarrationText = '';
        this.narrationSourceText = text;
        this.fullNarrationTranscript = text;
        if (this.wordBoundaries.length > 0 || this.transcriptChunks.length === 0) {
            this.refreshTranscriptReel();
        }
        this.subtitleReady = true;
        this.renderSubtitle();
    }

    handleAudioChunk(data) {
        if (this.voiceModeEnabled && this.azureVoice.connected) return;

        // --- SLIDE MISMATCH PROTECTION ---
        // If we receive audio for a slide that isn't the current one, and it's not a replay/QA/wrapup,
        // we should ignore it to prevent "ghost" narration from old loops.
        const isBackgroundPhase = data?.isQA || data?.isWrapUp || data?.isReplay;
        if (!isBackgroundPhase && typeof data?.slideIndex === 'number' && data.slideIndex !== this.currentSlideIndex) {
            console.log(`[Audio] Ignoring chunk for slide ${data.slideIndex} because app is at ${this.currentSlideIndex}`);
            return;
        }

        // Reset audio player when slide changes to avoid stale state issues
        if (typeof data?.slideIndex === 'number' && data.slideIndex !== this.activeAudioSlideIndex) {
            // Reset the audio player completely and clear paused state
            this.streamPlayer.reset();
            this.streamPlayer.resume();  // Clear any paused state
            this.isAudioPaused = false;
            this.pendingPlaybackStartAt = null;
            this.pauseStartMs = null;
            // Reset UI to play state
            const btn = document.getElementById('slide-pause-btn');
            const iconPause = btn?.querySelector('.icon-pause');
            const iconPlay = btn?.querySelector('.icon-play');
            if (btn) btn.classList.remove('is-paused');
            if (iconPause) iconPause.style.display = 'block';
            if (iconPlay) iconPlay.style.display = 'none';
        }
        
        this.awaitingPlaybackComplete = true; this.subtitleReady = true;
        this.slideAudioStarted = true;
        if (typeof data?.slideIndex === 'number') {
            this.activeAudioSlideIndex = data.slideIndex;
        }
        this.renderSubtitle();
        if (this.pendingNarrationText) {
            this.narrationSourceText = this.pendingNarrationText;
            this.fullNarrationTranscript = this.pendingNarrationText;
            if (this.wordBoundaries.length > 0 || this.transcriptChunks.length === 0) {
                this.refreshTranscriptReel();
            }
            this.pendingNarrationText = '';
        }
        
        this.streamPlayer.playChunk(data.chunk, data.sampleRate, data.channels);
        
    }

    handleWordBoundaries(data) {
        this.wordBoundaries = Array.isArray(data?.words) ? data.words : [];
        console.log('[WordBoundaries] Received', this.wordBoundaries.length, 'words for slide', data?.slideIndex);
        
        // Calculate actual duration from word boundaries
        if (this.wordBoundaries.length > 0) {
            const lastWord = this.wordBoundaries[this.wordBoundaries.length - 1];
            const actualDuration = (lastWord.offsetMs || 0) + (lastWord.durationMs || 0);
            console.log('[WordBoundaries] Last word offset:', lastWord.offsetMs, 'duration:', lastWord.durationMs, 'total:', actualDuration);
            // Only update if more accurate (longer) than estimated
            if (actualDuration > this.totalAudioDurationMs) {
                this.totalAudioDurationMs = actualDuration;
                console.log('[WordBoundaries] Updated totalAudioDurationMs to:', this.totalAudioDurationMs);
            }
        }
        
        this.refreshTranscriptReel();
        this.syncTranscriptReelPlayback();
    }

    handleAudioEnd(data = {}) {
        this.showTranscript(false);
        this.subtitleReady = false;
        this.waitForPlaybackFinish(data);
    }

    waitForPlaybackFinish(data = {}) {
        const completedSlideIndex = typeof data?.slideIndex === 'number'
            ? data?.slideIndex
            : (typeof this.activeAudioSlideIndex === 'number' ? this.activeAudioSlideIndex : this.currentSlideIndex);

        let pollCount = 0;
        const MAX_POLLS = 1500; // ~3 minutes (1500 * 120ms) - narrations can be long

        console.log(`[waitForPlaybackFinish] Starting for slide ${completedSlideIndex}, totalPolls=0, hasPending=${this.streamPlayer.hasPendingPlayback()}`);

        const poll = () => {
            pollCount++;
            const hasPending = this.streamPlayer.hasPendingPlayback();

            if (pollCount % 20 === 0 || pollCount <= 5) {
                console.log(`[waitForPlaybackFinish] poll=${pollCount}, hasPending=${hasPending}, slideAudioStarted=${this.slideAudioStarted}`);
            }

            if (pollCount > MAX_POLLS) {
                console.warn(`[Audio] Playback poll exceeded max iterations, forcing completion`);
                this.awaitingPlaybackComplete = false;

                this.stopTranscriptProgress();
                this.clearTranscriptChunkTimers();
                this.pendingPlaybackStartAt = null;
                this.activeAudioSlideIndex = null;
                this.socketClient.notifyPlaybackComplete(this.sessionId, completedSlideIndex);
                return;
            }

            // If slide changed while we were waiting, bail out to avoid sending completion for wrong slide
            if (typeof data?.slideIndex === 'number' && data.slideIndex !== this.currentSlideIndex && !data?.isQA && !data?.isWrapUp) {
                console.log(`[Audio] Slide changed during poll: was ${data.slideIndex}, now ${this.currentSlideIndex}. Bailing.`);
                this.awaitingPlaybackComplete = false;
                return;
            }

            if (hasPending) { setTimeout(poll, 120); return; }
            if (!this.slideAudioStarted && pollCount < 30) { setTimeout(poll, 120); return; }


            console.log(`[waitForPlaybackFinish] Completed after ${pollCount} polls. hasPending=${hasPending}, slideAudioStarted=${this.slideAudioStarted}`);
            this.stopTranscriptProgress();
            this.clearTranscriptChunkTimers();
            if (this.transcriptChunks.length > 0) {
                this.transcriptChunkIndex = this.transcriptChunks.length - 1;
                this.transcriptChunkMode = 'complete';
                this.activeTranscriptWordIndex = this.transcriptChunks[this.transcriptChunkIndex]?.words?.length
                    ? this.transcriptChunks[this.transcriptChunkIndex].words.length - 1
                    : -1;
            } else {
                this.transcriptChunkIndex = -1;
                this.activeTranscriptWordIndex = -1;
            }
            this.pendingPlaybackStartAt = null;
            this.activeAudioSlideIndex = null;

            // Set progress to 100% before rendering
            const fill = document.getElementById('narration-progress-fill');
            if (fill) fill.style.width = '100%';

            this.renderFullTranscription();
            if (this.awaitingPlaybackComplete) {
                this.awaitingPlaybackComplete = false;
                if (this.shouldOpenMicroCommitment(completedSlideIndex)) {
                    this.prepareMicroCommitmentTurn(completedSlideIndex);
                } else {
                    this.socketClient.notifyPlaybackComplete(this.sessionId, completedSlideIndex);
                }
            }

            this.streamPlayer.reset();
            this.streamPlayer.resume();
            this.isAudioPaused = false;
            const btn = document.getElementById('slide-pause-btn');
            const iconPause = btn?.querySelector('.icon-pause');
            const iconPlay = btn?.querySelector('.icon-play');
            if (btn) btn.classList.remove('is-paused');
            if (iconPause) iconPause.style.display = 'none';
            if (iconPlay) iconPlay.style.display = 'block';
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

        if (this.transcriptChunkMode === 'live') {
            this.syncTranscriptFrameWithPlayback();
        }

        const index = Math.max(0, Math.min(this.transcriptChunkIndex, this.transcriptChunks.length - 1));
        const chunk = this.transcriptChunks[index] || this.transcriptChunks[0];
        this.ui.renderTranscriptReel('full-transcription', {
            state: this.transcriptChunkMode === 'complete' ? 'complete' : 'live',
            headline: this.transcriptChunkMode === 'complete' ? 'Complete' : 'Speaking',
            phrase: chunk?.text || '',
            words: Array.isArray(chunk?.words) ? chunk.words.map((item) => item.word) : [],
            activeWordIndex: this.transcriptChunkMode === 'live' ? this.activeTranscriptWordIndex : -1
        });
    }

    syncTranscriptReelPlayback() {
        if (!this.transcriptChunks.length || !this.pendingPlaybackStartAt) {
            this.transcriptChunkMode = this.transcriptChunks.length ? 'complete' : 'waiting';
            if (this.transcriptChunks.length) {
                this.transcriptChunkIndex = this.transcriptChunks.length - 1;
            }
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

    startTranscriptProgress() {
        this.stopTranscriptProgress();
        this._transcriptProgressRaf = requestAnimationFrame(() => this._updateTranscriptProgress());
    }

    stopTranscriptProgress() {
        if (this._transcriptProgressRaf) {
            cancelAnimationFrame(this._transcriptProgressRaf);
            this._transcriptProgressRaf = null;
        }
    }

    stopWaveform() {
        // No-op - waveform visualization not implemented
    }

    _updateTranscriptProgress() {
        this.updateTranscriptProgress();
        if (!this.isAudioPaused && (this.streamPlayer.isPlaying || this.pendingPlaybackStartAt)) {
            this._transcriptProgressRaf = requestAnimationFrame(() => this._updateTranscriptProgress());
        }
    }

    updateTranscriptProgress() {
        const fill = document.getElementById('narration-progress-fill');
        if (!fill) return;

        if (this.isAudioPaused) {
            return;
        }

        if (!this.pendingPlaybackStartAt || this.totalAudioDurationMs <= 0) {
            fill.style.width = '0%';
            return;
        }

        const now = performance.now();
        const elapsed = now - this.pendingPlaybackStartAt;
        const totalDuration = this.totalAudioDurationMs;

        const progress = Math.min(Math.max(elapsed / totalDuration, 0), 1) * 100;
        fill.style.width = `${progress}%`;
        this.renderFullTranscription();
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
        this.pendingNarrationText = '';
        this.wordBoundaries = [];
        this.transcriptChunks = [];
        this.transcriptChunkIndex = -1;
        this.activeTranscriptWordIndex = -1;
        this.pendingPlaybackStartAt = null;
        this.totalAudioDurationMs = 0;
        this.transcriptChunkMode = 'waiting';
        this.slideAudioStarted = false;
        this.activeAudioSlideIndex = null;
        this.clearTranscriptChunkTimers();
        this.stopTranscriptProgress();
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
        this.activeTranscriptWordIndex = -1;
        this.transcriptChunkMode = this.pendingPlaybackStartAt ? 'live' : (this.transcriptChunks.length ? 'complete' : 'waiting');
        if (!this.pendingPlaybackStartAt && this.transcriptChunks.length > 0) {
            this.transcriptChunkIndex = this.transcriptChunks.length - 1;
            this.activeTranscriptWordIndex = this.transcriptChunks[this.transcriptChunkIndex]?.words?.length
                ? this.transcriptChunks[this.transcriptChunkIndex].words.length - 1
                : -1;
        }
        
        // Update total duration as more text/chunks arrive
        if (this.transcriptChunks.length > 0) {
            const lastChunk = this.transcriptChunks[this.transcriptChunks.length - 1];
            const estimatedDuration = lastChunk ? (lastChunk.endMs || 0) : 0;
            
            // Only use estimate if we don't have accurate word boundaries yet,
            // or if the estimate is significantly larger than what we have.
            if (this.wordBoundaries.length === 0) {
                if (estimatedDuration > this.totalAudioDurationMs) {
                    this.totalAudioDurationMs = estimatedDuration;
                }
            }
        }
        
        this.renderFullTranscription();
        if (this.pendingPlaybackStartAt) {
            this.syncTranscriptReelPlayback();
        }
    }

    chunkTranscriptText(text) {
        const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        const chunks = [];
        let currentStartMs = 0;
        let phraseWords = [];
        let phraseStartMs = 0;

        const flushPhrase = () => {
            if (!phraseWords.length) return;
            const lastWord = phraseWords[phraseWords.length - 1];
            chunks.push({
                text: phraseWords.map((item) => item.word).join(' '),
                words: phraseWords.map((item) => ({ ...item })),
                startMs: phraseStartMs,
                endMs: lastWord.endMs
            });
            phraseWords = [];
        };

        words.forEach((word) => {
            let durationMs = 420;
            if (/[.,!?:;]["')\]]?$/.test(word)) {
                durationMs += 280;
            }
            const wordStartMs = currentStartMs;
            const wordEndMs = currentStartMs + durationMs;
            if (!phraseWords.length) {
                phraseStartMs = wordStartMs;
            }
            phraseWords.push({ word, startMs: wordStartMs, endMs: wordEndMs });
            currentStartMs = wordEndMs;

            const phraseText = phraseWords.map((item) => item.word).join(' ');
            const endsPhrase = /[.!?]["')\]]?$/.test(word);
            const softBreak = /[,;:]["')\]]?$/.test(word);
            if (endsPhrase || phraseWords.length >= 8 || phraseText.length >= 52 || (softBreak && phraseWords.length >= 5)) {
                flushPhrase();
            }
        });

        flushPhrase();
        return chunks;
    }

    chunkWordBoundaries(boundaries = [], maxWords = 30) {
        const words = boundaries.filter(Boolean);
        const chunks = [];
        for (let i = 0; i < words.length; i += maxWords) {
            const slice = words.slice(i, i + maxWords);
            if (!slice.length) continue;
            const startMs = Number(slice[0].offsetMs || 0);
            const last = slice[slice.length - 1];
            const endMs = Number(last.offsetMs || startMs) + Number(last.durationMs || 0) + 250;
            chunks.push({
                text: slice.map(item => String(item.word || '').trim()).filter(Boolean).join(' '),
                words: slice.map((item) => ({
                    word: String(item.word || '').trim(),
                    startMs: Number(item.offsetMs || 0),
                    endMs: Number(item.offsetMs || 0) + Number(item.durationMs || 0)
                })).filter((item) => item.word),
                startMs,
                endMs
            });
        }
        return chunks;
    }

    syncTranscriptFrameWithPlayback() {
        if (!this.pendingPlaybackStartAt || !this.transcriptChunks.length) return;

        const playbackMs = Math.max(0, performance.now() - this.pendingPlaybackStartAt);
        let chunkIndex = this.transcriptChunks.findIndex((chunk) => playbackMs >= chunk.startMs && playbackMs < chunk.endMs);
        if (chunkIndex === -1) {
            chunkIndex = this.transcriptChunks.reduce((acc, chunk, index) => (playbackMs >= chunk.startMs ? index : acc), -1);
        }
        if (chunkIndex < 0) chunkIndex = 0;

        this.transcriptChunkIndex = chunkIndex;
        const words = this.transcriptChunks[chunkIndex]?.words || [];
        let wordIndex = -1;
        if (words.length > 0) {
            wordIndex = words.findIndex((word) => playbackMs >= word.startMs && playbackMs < word.endMs);
            if (wordIndex === -1) {
                wordIndex = words.reduce((acc, word, index) => (playbackMs >= word.startMs ? index : acc), -1);
            }
            if (wordIndex < 0) wordIndex = 0;
        }
        this.activeTranscriptWordIndex = wordIndex;
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
        const dateEl = document.getElementById('folio-date');
        if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    handleMicPermissionError() { this.openQuestionComposer(); }

    async submitQuestion(forcedText, options = {}) {
        // Unlock iOS audio on any user interaction
        this.streamPlayer?.unlockIOSAudio();

        const input = options.source === 'slide-turn' ? document.getElementById('slide-question-input') : document.getElementById('question-input');
        const button = options.source === 'slide-turn' ? document.getElementById('slide-question-send') : document.getElementById('submit-question');
        const text = (typeof forcedText === 'string' ? forcedText : input.value).trim();
        if (!text || !this.sessionId) return;
        this.pendingQuestionText = text;
        this.inferInterestBucketsFromText(text).forEach((bucket) => this.bumpInterestBucket(bucket, 2));
        try {
            if (input) input.blur();
            if (button) button.disabled = true;
            const res = await this.apiFetch('/api/questions', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    questionText: text,
                    submittedBy: options.submittedBy || 'Audience'
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
            input.value = '';
            this.pendingQuestionText = null;
            this.setStatus('Question sent', 'paused', 'Watch Field Notes for the live answer');
            this.userQuestions.push({ id: null, text, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
            this.ui.toggleQuestionDrawer(true, { focusInput: false });
        } catch (err) {
            console.error(err);
            this.setStatus('Question failed', 'paused', 'Retry');
        } finally {
            if (button) button.disabled = false;
        }
    }

    renderScrubber() {
        const filmstrip = document.getElementById('scrubber-filmstrip');
        const prevBtn = document.getElementById('scrubber-prev');
        const nextBtn = document.getElementById('scrubber-next');
        if (!filmstrip) return;

        if (!Array.isArray(this.slideDeck) || this.slideDeck.length === 0) {
            filmstrip.innerHTML = '';
            if (this.ui?.renderEmptyHistory) {
                this.ui.renderEmptyHistory('scrubber-filmstrip');
            }
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            return;
        }

        // Skip full rebuild if deck size hasn't changed — just update active thumb and disabled state
        const existingCount = filmstrip.dataset.slideCount;
        const accessibleIndex = Math.max(this.currentSlideIndex, this.maxViewedSlideIndex);
        if (existingCount === String(this.slideDeck.length)) {
            filmstrip.querySelectorAll('.scrubber-thumb').forEach((btn, i) => {
                btn.classList.toggle('active', i === this.currentSlideIndex);
                // Update disabled state: future slides (index > accessibleIndex) should be locked
                const isFuture = i > accessibleIndex;
                btn.classList.toggle('disabled', isFuture);
                btn.disabled = isFuture;
            });
            if (prevBtn) prevBtn.disabled = this.currentSlideIndex <= 0;
            if (nextBtn) nextBtn.disabled = this.currentSlideIndex >= accessibleIndex;
            return;
        }

        // Full rebuild — deck size changed
        filmstrip.innerHTML = '';
        filmstrip.dataset.slideCount = String(this.slideDeck.length);

        if (prevBtn) prevBtn.disabled = this.currentSlideIndex <= 0;
        if (nextBtn) nextBtn.disabled = this.currentSlideIndex >= accessibleIndex;
        this.slideDeck.forEach((slide, index) => {
            const isFuture = index > accessibleIndex;
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
            
            let actionIcon = '';
            if (isFuture) {
                actionIcon = '<svg class="scrubber-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
            } else if (index === this.currentSlideIndex) {
                actionIcon = '<svg class="scrubber-action-icon scrubber-icon-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>';
            } else {
                actionIcon = '<svg class="scrubber-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>';
            }

            button.setAttribute('aria-label', `Slide ${index + 1}: ${slideTitle}`);
            button.title = isFuture ? 'Locked' : `Replay slide ${index + 1}: ${slideTitle}`;
            
            button.innerHTML = `
                <div class="scrubber-thumb-overlay">
                    ${actionIcon}
                </div>
                <span class="scrubber-thumb-index">${index + 1}</span>
                <span class="scrubber-thumb-title">${this.escapeHtml(slideTitle)}</span>
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

        // Selecting a previously viewed slide is always allowed
        // Selecting a future slide temporarily unlocks it
        if (index > this.maxViewedSlideIndex) {
            this.maxViewedSlideIndex = index;
        }

        try {
            await this.replaySlide(index);
        } catch (err) {
            console.warn('Replay request failed, falling back to direct jump:', err);
            if (index !== this.currentSlideIndex) {
                await this.jumpToSlide(index);
            }
        }

        // Close the scrubber modal and resume presentation
        const scrubber = document.getElementById('scrubber-container');
        if (scrubber) scrubber.classList.add('hidden');
        this.resumePresentationAfterHistory();

        // Re-render scrubber to update locked/unlocked state after action
        this.renderScrubber();
    }

    async navigateScrubber(direction) {
        const targetIndex = this.currentSlideIndex + direction;
        if (targetIndex >= 0 && targetIndex <= this.maxViewedSlideIndex) {
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

    addQuestionToList(id, text, by, meta = {}) {
        if (this.questions.has(id)) return;
        this.questions.set(id, { id, text, status: 'pending', meta: { ...meta } });
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

    markQuestionAnswered(id, ans, txt, meta = {}) {
        if (!this.questions.has(id)) this.addQuestionToList(id, txt, 'Audience', meta);
        const target = document.getElementById(`q-${id}`); if (!target) return;
        const q = this.questions.get(id); if (q) { q.status = 'answered'; q.meta = { ...(q.meta || {}), ...meta }; }
        target.classList.remove('is-pending'); target.classList.add('is-answered');
        let node = target.querySelector('.qa-card-answer');
        if (!node) {
            node = document.createElement('div');
            node.className = 'qa-card-answer';
            target.appendChild(node);
        } else {
            // Already rendered - check if content changed
            const existingSummary = node.querySelector('.qa-answer-thread-summary');
            const existingDetails = node.querySelector('.qa-answer-thread-details');
            const newSummary = meta.answerSummary || ans;
            const newDetails = meta.answerDetails || ans;
            if (existingSummary && existingDetails &&
                existingSummary.textContent === newSummary &&
                existingDetails.textContent === newDetails) {
                // Content unchanged, skip re-render to avoid flicker
                return;
            }
        }

        const answerTitle = meta.answerTitle || this.getQuestionAnswerMeta(id)?.answerTitle || 'Answer';
        const answerSummary = meta.answerSummary || this.getQuestionAnswerMeta(id)?.answerSummary || ans;
        const answerDetails = meta.answerDetails || ans;
        const answerAudioUrl = meta.answerAudioUrl || this.getQuestionAnswerMeta(id)?.answerAudioUrl || '';
        this.renderQuestionAnswer(node, {
            questionId: id,
            answerTitle,
            answerSummary,
            answerDetails,
            answerAudioUrl
        });
        this.syncQuestionCount();
        this.registerQuestionAnswerNotification(id, meta.suppressNotification);
    }

    handleQuestionAnswerReady(data) {
        const questionId = data?.questionId;
        if (!questionId) return;
        const meta = {
            answerTitle: data.answerTitle,
            answerSummary: data.answerSummary,
            answerDetails: data.answerDetails,
            answerAudioUrl: data.answerAudioUrl,
            answerAudioPath: data.answerAudioPath,
            answerAudioDurationMs: data.answerAudioDurationMs,
            audioSource: data.audioSource,
            suppressNotification: data.suppressNotification
        };

        if (!this.questions.has(questionId)) {
            this.addQuestionToList(questionId, data.questionText || 'Question', data.submittedBy || 'Audience', meta);
        }
        this.markQuestionAnswered(questionId, data.answerText || '', data.questionText || '', meta);
        if (this.sessionId && !this.userQuestions.some((item) => item.id === questionId)) {
            this.userQuestions.push({
                id: questionId,
                questionText: data.questionText || '',
                answerText: data.answerText || '',
                answerTitle: data.answerTitle || '',
                answerSummary: data.answerSummary || '',
                answerAudioUrl: data.answerAudioUrl || '',
                timestamp: Date.now()
            });
        }
    }

    registerQuestionAnswerNotification(questionId, suppressNotification = false) {
        if (!questionId || this.notifiedAnswerIds.has(questionId)) return;
        this.notifiedAnswerIds.add(questionId);
        if (suppressNotification) return;
        this.incrementHistoryBadge();
    }

    incrementHistoryBadge() {
        this.unreadAnswerCount = Math.min((this.unreadAnswerCount || 0) + 1, 9);
        this.updateHistoryBadge();
    }

    clearHistoryBadge() {
        this.unreadAnswerCount = 0;
        this.updateHistoryBadge();
    }

    clearQuestionBadge() {
        this.clearHistoryBadge();
    }

    updateHistoryBadge() {
        const badge = document.getElementById('chat-badge');
        if (!badge) return;
        const count = Number(this.unreadAnswerCount || 0);
        badge.textContent = count >= 9 ? '9+' : String(count);
        badge.classList.toggle('hidden', count <= 0);
        badge.setAttribute('aria-hidden', count <= 0 ? 'true' : 'false');
    }

    getQuestionAnswerMeta(id) {
        return this.questions.get(id)?.meta || {};
    }

    renderQuestionAnswer(target, payload = {}) {
        const container = typeof target === 'string' ? document.getElementById(target) : target;
        if (!container) return;
        container.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'qa-answer-thread';

        const header = document.createElement('div');
        header.className = 'qa-answer-thread-header';

        const title = document.createElement('div');
        title.className = 'qa-answer-thread-title';
        const titleText = String(payload.answerTitle || 'Answer').trim();
        title.textContent = titleText;

        const controls = document.createElement('button');
        controls.type = 'button';
        controls.className = 'qa-answer-audio-btn';
        controls.dataset.questionId = payload.questionId || '';
        controls.dataset.audioUrl = payload.answerAudioUrl || '';
        controls.dataset.playing = 'false';
        controls.innerHTML = `
            <svg class="qa-answer-audio-icon qa-answer-audio-play" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <svg class="qa-answer-audio-icon qa-answer-audio-pause" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        `;
        controls.disabled = !payload.answerAudioUrl;
        controls.addEventListener('click', () => this.toggleQuestionAnswerAudio(controls));

        header.appendChild(title);
        header.appendChild(controls);

        const summaryText = String(payload.answerSummary || '').trim();
        const detailsText = String(payload.answerDetails || payload.answerSummary || '').trim();
        
        // Avoid showing summary if it's just a truncated version of the details
        const summaryIsTruncatedDetails = detailsText.length > summaryText.length && 
                                        summaryText.endsWith('...') && 
                                        detailsText.startsWith(summaryText.slice(0, -3).trim());
        
        const shouldShowSummary = summaryText && 
                                summaryText !== detailsText && 
                                !summaryIsTruncatedDetails;

        const summary = document.createElement('div');
        summary.className = 'qa-answer-thread-summary';
        summary.textContent = summaryText;

        const details = document.createElement('div');
        details.className = 'qa-answer-thread-details';
        details.textContent = detailsText;

        if (shouldShowTitle || payload.answerAudioUrl) {
            wrap.appendChild(header);
        }
        if (shouldShowSummary) {
            wrap.appendChild(summary);
        }
        if (detailsText) {
            wrap.appendChild(details);
        }
        container.appendChild(wrap);
    }

    toggleQuestionAnswerAudio(button) {
        if (!this.questionAudioPlayer || !button) return;
        const audioUrl = button.dataset.audioUrl;
        if (!audioUrl) return;

        const isActive = this.activeQuestionAudioButton === button && !this.questionAudioPlayer.paused;
        if (isActive) {
            this.questionAudioPlayer.pause();
            return;
        }

        if (this.activeQuestionAudioButton && this.activeQuestionAudioButton !== button) {
            this.updateQuestionAudioButtonState(this.activeQuestionAudioButton, false);
        }

        this.activeQuestionAudioButton = button;
        this.pauseMainNarrationForQuestionAudio();
        this.questionAudioPlayer.src = audioUrl;
        this.questionAudioPlayer.currentTime = 0;
        this.questionAudioPlayer.play().catch((err) => {
            console.warn('Question answer audio failed:', err);
            this.updateQuestionAudioButtonState(button, false);
            this.resumeMainNarrationAfterQuestionAudio();
        });
    }

    pauseMainNarrationForQuestionAudio() {
        const context = this.streamPlayer?.audioContext;
        const hasActiveNarration = this.streamPlayer?.isPlaying || this.streamPlayer?.hasPendingPlayback?.();
        if (!context || context.state !== 'running' || !hasActiveNarration || this.questionAudioPausedNarration) {
            return;
        }

        this.questionAudioPausedNarration = true;
        this.toggleAudioPause();
    }

    resumeMainNarrationAfterQuestionAudio() {
        if (!this.questionAudioPausedNarration) return;

        this.questionAudioPausedNarration = false;
        const context = this.streamPlayer?.audioContext;
        if (context && context.state === 'suspended') {
            this.toggleAudioPause();
        }
    }

    updateQuestionAudioButtonState(button, playing) {
        if (!button) return;
        button.dataset.playing = playing ? 'true' : 'false';
        const play = button.querySelector('.qa-answer-audio-play');
        const pause = button.querySelector('.qa-answer-audio-pause');
        if (play) play.style.display = playing ? 'none' : 'block';
        if (pause) pause.style.display = playing ? 'block' : 'none';
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
        if (this.pendingSlideAdvance) {
            await this.finalizePendingSlideAdvance();
            return;
        }
        this.streamPlayer.reset();
        this.resetSubtitleState();
        try { await this.apiFetch('/api/autoplex/continue', { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); this.ui.closeSlideTurnOverlay(); this.setStatus('Presenting', 'live', 'Narration live'); }
        catch (err) { console.error(err); }
    }

    async requestInterrupt() {
        this.streamPlayer.reset();  this.showTranscript(false);
        if (!this.sessionId) return;
        try { await this.apiFetch('/api/autoplex/interrupt', { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); } catch (err) { console.error(err); }
    }

    async pauseAutoplex(p) { if (!this.sessionId) return; try { await this.apiFetch(`/api/autoplex/${p ? 'pause' : 'resume'}`, { method: 'POST', body: JSON.stringify({ sessionId: this.sessionId }) }); } catch (err) { console.error(err); } }

    async resumePresentationAfterHistory() {
        if (!this.sessionId) return;
        try {
            await this.pauseAutoplex(false);
            this.restorePresentationStatus();
        } catch (err) {
            console.error('Failed to resume after history:', err);
        }
    }

    toggleAudioPause() {
        if (!this.streamPlayer || !this.streamPlayer.audioContext) return;

        // Guard against rapid double-clicks
        if (this._isTogglingPause) return;
        this._isTogglingPause = true;
        setTimeout(() => { this._isTogglingPause = false; }, 300);

        const btn = document.getElementById('slide-pause-btn');
        const iconPause = btn?.querySelector('.icon-pause');
        const iconPlay = btn?.querySelector('.icon-play');

        // If we are currently paused, resume regardless of AudioContext state.
        // The pause path stops sources and marks the stream player paused; it does not
        // necessarily suspend the AudioContext.
        if (this.isAudioPaused) {
            this.streamPlayer.resume();
            this.isAudioPaused = false;
            this.pauseStartMs = null;
            if (btn) btn.classList.remove('is-paused');
            if (iconPause) iconPause.style.display = 'block';
            if (iconPlay) iconPlay.style.display = 'none';
            this.pauseAutoplex(false);
            return;
        }

        // If audio is running, pause it
        if (this.streamPlayer.audioContext.state === 'running') {
            // Use the audio player's pause() method - it sets _isPaused = true
            // which blocks all new chunks from being processed
            this.streamPlayer.pause();
            this.isAudioPaused = true;
            this.pauseStartMs = performance.now();
            this.clearTranscriptChunkTimers();
            this.stopTranscriptProgress();

            if (btn) btn.classList.add('is-paused');
            if (iconPause) iconPause.style.display = 'none';
            if (iconPlay) iconPlay.style.display = 'block';
            this.pauseAutoplex(true);
        }
        // Fallback for browsers that really suspend the AudioContext
        else if (this.streamPlayer.audioContext.state === 'suspended') {
            this.streamPlayer.audioContext.resume().then(() => {
                // Use the audio player's resume() method - it sets _isPaused = false
                // which allows chunks to be processed again
                this.streamPlayer.resume();
                this.isAudioPaused = false;
                this.pauseStartMs = null;
                if (btn) btn.classList.remove('is-paused');
                if (iconPause) iconPause.style.display = 'block';
                if (iconPlay) iconPlay.style.display = 'none';
                this.pauseAutoplex(false);
            });
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

    openSlideTurnOverlay(data = {}) { this.awaitingSlideContinue = true; this.ui.openSlideTurnOverlay(data); this.updateMicState(); }

    openQuestionComposer() {
        this.ui.toggleQuestionDrawer(true);
        const input = document.getElementById('question-input');
        if (input) input.focus();
        this.setStatus('Q&A', 'paused', 'Ask anything — I\'ll answer');
    }

    restorePresentationStatus() {
        if (this.voiceModeEnabled) { this.setStatus('Q&A', 'paused', 'Ask anything — I\'ll answer'); return; }
        if (this.wrapUpEndsAt > Date.now()) { this.setStatus('Final questions', 'paused', 'Ask anything — answers appear in Field Notes'); return; }
        if (this.awaitingSlideContinue) { this.setStatus('Your turn', 'paused', 'Type a question or continue'); return; }
        if (this.isQAPhase) { this.setStatus('Q&A', 'paused', 'Answering questions'); return; }
        this.setStatus('Presenting', 'live', 'Narration live');
    }

    startWrapUp(data = {}) {
        console.log('[WrapUp] startWrapUp called with data:', data);
        try {
            this.wrapUpSelections = {}; this.wrapUpMcqs = Array.isArray(data.mcqs) ? data.mcqs : []; this.wrapUpIndex = 0;
            this.wrapUpEndsAt = Number(data.endsAt) || (Date.now() + 60000);
            this.renderWrapUpMcqs();
            const wrapupPanel = document.getElementById('wrapup-panel');
            const completionOverlay = document.getElementById('completion-overlay');
            const wrapupMessage = document.getElementById('wrapup-message');
            if (!wrapupPanel) console.error('[WrapUp] wrapup-panel element not found!');
            if (!completionOverlay) console.error('[WrapUp] completion-overlay element not found!');
            if (!wrapupMessage) console.error('[WrapUp] wrapup-message element not found!');
            if (wrapupMessage) wrapupMessage.textContent = data.promptText || 'One minute for questions.';
            if (wrapupPanel) wrapupPanel.classList.remove('hidden');
            if (completionOverlay) completionOverlay.classList.remove('hidden');
            this.setStatus('Final questions', 'paused', 'Ask anything — answers appear in Field Notes');
            if (this.wrapUpTimer) clearInterval(this.wrapUpTimer);
            this.wrapUpTimer = setInterval(() => {
                const timerEl = document.getElementById('wrapup-timer');
                const deadlineEl = document.getElementById('wrapup-deadline');
                const rem = Math.max(0, this.wrapUpEndsAt - Date.now()); const sec = Math.ceil(rem / 1000);
                if (timerEl) timerEl.textContent = `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
                if (deadlineEl) deadlineEl.textContent = `Agent ends in ${sec}s`;
                if (rem <= 0) { clearInterval(this.wrapUpTimer); this.wrapUpTimer = null; }
            }, 1000);
            console.log('[WrapUp] startWrapUp completed successfully');
        } catch (err) {
            console.error('[WrapUp] Error in startWrapUp:', err);
        }
    }

    finishWrapUp() { this.wrapUpEndsAt = 0; if (this.wrapUpTimer) { clearInterval(this.wrapUpTimer); this.wrapUpTimer = null; } document.getElementById('wrapup-timer').textContent = '0:00'; }

    toggleChatWidget(force) {
        const toggle = document.getElementById('chat-widget-toggle');
        const panel = document.getElementById('qa-panel');
        const show = typeof force === 'boolean'
            ? force
            : Boolean(panel?.classList.contains('hidden'));
        if (toggle) toggle.setAttribute('aria-expanded', show ? 'true' : 'false');
        this.ui.toggleQuestionDrawer(show);
    }

    showCompletion(data) {
        this.isFinalState = true;
        const summaryEl = document.getElementById('completion-summary');
        this.captureCurrentSlideEngagement();
        const completionSummary = this.buildCompletionSummary(data);
        if (summaryEl) summaryEl.textContent = completionSummary;
        this.renderCompletionMemoryPills(this.buildCompletionMemoryPills(data));
        
        const activity = { 
            participantName: this.participantName, 
            deckTitle: document.getElementById('deck-label').textContent, 
            totalSlides: data.totalSlides, 
            questionsAnswered: data.totalQuestionsAnswered, 
            userQuestions: this.userQuestions, 
            userReactions: this.userReactions, 
            wrapUpSelections: this.wrapUpSelections,
            sessionMemory: this.sessionMemory,
            completionSummary,
            timestamp: new Date().toISOString() 
        };
        localStorage.setItem(`digest_${this.sessionId}`, JSON.stringify(activity));
        
        const overlay = document.getElementById('completion-overlay');
        if (overlay) overlay.classList.remove('hidden');
        
        // Random image selection from presentation slides
        const hero = document.getElementById('completion-hero');
        if (hero) {
            const allImages = (this.slideDeck || [])
                .map(s => s.image)
                .filter(img => img && img.startsWith('http'));
            
            if (allImages.length > 0) {
                const randomImg = allImages[Math.floor(Math.random() * allImages.length)];
                hero.style.backgroundImage = `url(${randomImg})`;
            } else if (this.currentSlide?.image) {
                hero.style.backgroundImage = `url(${this.currentSlide.image})`;
            }
        }

        this.loadCtaBlocks();

        this.setStatus('Engagement', 'paused', 'Dialogue remains open');
    }

    async loadCtaBlocks() {
        const projectSlug = 'beforest';
        try {
            const res = await fetch(`/api/cms/projects/${projectSlug}/cta-blocks`);
            const data = await res.json();
            const blocksData = data.ctaBlocks || [];
            const blocks = blocksData.length > 0 ? blocksData : [
                { label: 'Book a discovery call', url: 'https://beforest.co/contact', icon: 'calendar' },
                { label: 'Join a collective', url: 'https://beforest.co/collectives', icon: 'tree' }
            ];
            const personalizedBlocks = this.personalizeCtaBlocks(blocks);
            const container = document.getElementById('cta-blocks');
            if (!container) return;
            container.innerHTML = '';
            
            const icons = {
                calendar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
                tree: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14l-5-5-5 5"/><path d="M13 20V8"/><path d="M9 20v-4H5l7-7 7 7h-4v4"/></svg>',
                mail: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
                globe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
            };

            personalizedBlocks.forEach(block => {
                const el = document.createElement('a');
                el.href = block.url;
                el.target = block.url.startsWith('http') ? '_blank' : '_self';
                el.rel = 'noopener noreferrer';
                el.className = 'cta-block';
                el.innerHTML = `
                    <div class="cta-block-left" style="display:flex; align-items:center; gap:12px;">
                        <div class="cta-block-icon" style="opacity:0.6;">${icons[block.icon] || icons.globe}</div>
                        <div class="cta-block-label">${block.label}</div>
                    </div>
                    <div class="cta-block-arrow">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>`;
                container.appendChild(el);
            });
            const section = document.getElementById('completion-cta');
            if (section) section.classList.remove('hidden');
        } catch (err) {
            console.warn('Could not load CTA blocks:', err);
        }
    }

    renderWrapUpMcqs() {
        const container = document.getElementById('wrapup-mcqs');
        if (!container) return;
        container.innerHTML = '';

        // Reset nav — we drive navigation via dots+auto-advance, not prev/next text buttons
        const progressEl = document.getElementById('wrapup-progress');
        const prevBtn = document.getElementById('wrapup-prev');
        const nextBtn = document.getElementById('wrapup-next');
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';

        if (!this.wrapUpMcqs || !this.wrapUpMcqs.length) {
            if (progressEl) progressEl.textContent = '';
            return;
        }

        const total = this.wrapUpMcqs.length;
        const idx = Math.min(this.wrapUpIndex, total - 1);
        const mcq = this.wrapUpMcqs[idx];

        // --- Dot progress ---
        if (progressEl) {
            progressEl.innerHTML = '';
            progressEl.className = 'wrapup-dots';
            for (let i = 0; i < total; i++) {
                const dot = document.createElement('span');
                dot.className = 'wrapup-dot' + (i === idx ? ' active' : (i < idx ? ' done' : ''));
                progressEl.appendChild(dot);
            }
        }

        // --- Single Typeform card ---
        const card = document.createElement('div');
        card.className = 'wrapup-card typeform-card';
        card.style.animation = 'typeformEnter 400ms cubic-bezier(0.2, 1, 0.3, 1) both';

        const qNum = document.createElement('span');
        qNum.className = 'typeform-qnum';
        qNum.textContent = `${idx + 1} / ${total}`;

        const title = document.createElement('div');
        title.className = 'wrapup-card-title typeform-title';
        title.textContent = mcq.prompt;

        const options = document.createElement('div');
        options.className = 'wrapup-options typeform-options';

        const votes = this.votes.get(mcq.id) || {};
        const voteTotal = Object.values(votes).reduce((s, v) => s + v, 0);
        const selected = this.wrapUpSelections[mcq.id];
        const hasAnswered = !!selected;

        (mcq.options || []).forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wrapup-option typeform-option' + (selected === opt ? ' is-selected' : '');

            const count = votes[opt] || 0;
            const pct = voteTotal > 0 ? Math.round((count / voteTotal) * 100) : 0;

            btn.innerHTML = `
                <span class="typeform-opt-letter">${'ABCDEF'[mcq.options.indexOf(opt)]}</span>
                <span class="option-text">${opt}</span>
                ${hasAnswered ? `<span class="typeform-pct">${pct}%</span>
                <div class="typeform-bar-wrap"><div class="typeform-bar" style="width:${pct}%"></div></div>` : ''}
            `;

            btn.addEventListener('click', () => {
                if (this.wrapUpSelections[mcq.id] === opt) return;
                this.wrapUpSelections[mcq.id] = opt;
                this.inferInterestBucketsFromText(`${mcq.prompt} ${opt}`).forEach((bucket) => this.bumpInterestBucket(bucket, 3));
                this.socketClient.submitVote(mcq.id, opt);
                this.renderWrapUpMcqs();
                // Auto-advance after brief pause to let selection register visually
                if (idx < total - 1) {
                    setTimeout(() => { this.wrapUpIndex = idx + 1; this.renderWrapUpMcqs(); }, 700);
                } else {
                    // All done — reveal CTA blocks after a breath
                    setTimeout(() => {
                        const ctaSection = document.getElementById('completion-cta');
                        if (ctaSection) { ctaSection.style.opacity = '0'; ctaSection.classList.remove('hidden'); setTimeout(() => { ctaSection.style.transition = 'opacity 0.6s ease'; ctaSection.style.opacity = '1'; }, 50); }
                        const wrapupPanel = document.getElementById('wrapup-panel');
                        if (wrapupPanel) { wrapupPanel.style.transition = 'opacity 0.4s ease'; wrapupPanel.style.opacity = '0'; setTimeout(() => wrapupPanel.classList.add('hidden'), 400); }
                    }, 900);
                }
            });
            options.appendChild(btn);
        });

        card.append(qNum, title, options);
        container.appendChild(card);
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
            title.textContent = 'Your Q&A';
            container.appendChild(title);
            container.appendChild(scrollArea);
        }
    }

    changeWrapUpCard(dir) { if (!this.wrapUpMcqs.length) return; const next = this.wrapUpIndex + dir; if (next >= 0 && next < this.wrapUpMcqs.length) { this.wrapUpIndex = next; this.renderWrapUpMcqs(); } }


    onVoiceTurnState(t, s, d) { this.setStatus(t, s, d); }
    onVoiceSessionConnected() { this.voiceModeEnabled = false; this.updateMicState(); this.setStatus('Q&A', 'paused', 'Ask anything — I\'ll answer'); }
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
