import { StreamAudioPlayer } from './services/audio.js';
import { AzureVoiceSession } from './services/voice.js';
import { SocketClient } from './services/socket.js';
import { UIManager } from './services/ui.js';

export function shouldAutoResumeRestoredSession() {
    return false;
}

export function buildQuestionAnswerPresentation(payload = {}) {
    const titleText = String(payload.answerTitle || '').trim();
    const summaryText = String(payload.answerSummary || '').trim();
    const detailsText = String(payload.answerDetails || payload.answerSummary || '').trim();
    const hasLongerDetails = detailsText.length > summaryText.length;
    const summaryIsTruncatedDetails = summaryText
        && hasLongerDetails
        && summaryText.endsWith('...')
        && detailsText.startsWith(summaryText.slice(0, -3).trim());
    const summaryIsRedundant = !summaryText || summaryText === detailsText || summaryIsTruncatedDetails;
    const shouldShowTitle = Boolean(titleText) && titleText.toLowerCase() !== 'answer';

    return {
        shouldShowTitle,
        titleText,
        primaryText: detailsText || summaryText,
        secondaryText: summaryIsRedundant ? '' : summaryText,
        answerAudioUrl: String(payload.answerAudioUrl || '').trim()
    };
}

export function normalizePresentationSelection(presentation = {}) {
    const presentationSlug = String(presentation.presentationSlug || presentation.id || '').trim();
    const source = String(presentation.source || presentation.declaredSource || '').trim() || 'local';
    return {
        ...presentation,
        id: String(presentation.id || presentationSlug).trim(),
        presentationSlug,
        source
    };
}

export function selectPresentationFromCatalog(presentations = [], requestedIdentifier = '') {
    const normalized = presentations.map((presentation) => normalizePresentationSelection(presentation));
    const requested = String(requestedIdentifier || '').trim();
    if (requested) {
        return normalized.find((presentation) => presentation.id === requested || presentation.presentationSlug === requested) || null;
    }
    if (normalized.length === 1) {
        return normalized[0];
    }
    return normalized.find((presentation) => presentation.isDefault)
        || normalized.find((presentation) => presentation.source === 'supabase')
        || normalized[0]
        || null;
}

export class VoicePPTApp {
    constructor() {
        this.pilotMode = false;
        this.pilotManifest = null;
        this.pilotAudio = new Audio();
        this.clientInstanceId = this.getOrCreateClientInstanceId();
        this.sessionId = null;
        this.controlToken = '';
        this.currentSlideIndex = 0;
        this.currentSlide = null;
        this.totalSlides = 0;
        this.participantName = '';
        this.currentProjectSlug = '';
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
        
        this.userQuestions = [];
        this.unreadAnswerCount = 0;
        this.maxViewedSlideIndex = 0;
        this.notifiedAnswerIds = new Set();
        this.sessionStatus = 'idle';
        this.replaySequenceActive = false;
        this.replaySequenceNextIndex = null;
        this._isContinuingReplay = false;
        
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
        this.activeTranscriptMode = 'idle';

        this.isAudioPaused = false;
        this.pauseStartMs = null;
        this.pausedPlaybackOffsetMs = 0;
        this.forceFreshSession = false;


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
            this.initializeApp();
        }
    }

    async initializeApp() {
        const pilotLoaded = await this.loadPilotManifest();
        if (pilotLoaded) {
            this.configurePilotStartScreen();
            return;
        }

        this.loadSessionConfig();
        this.loadPresentationCatalog();
    }

    async loadLoadingQuotes(projectSlug = '') {
        const resolvedProjectSlug = String(projectSlug || this.currentProjectSlug || '').trim();
        try {
            if (!resolvedProjectSlug) {
                this.loadingQuotes = this.getDefaultLoadingQuotes();
                return;
            }
            const res = await fetch(`/api/cms/projects/${encodeURIComponent(resolvedProjectSlug)}/loading-quotes`);
            if (res.ok) {
                const quotes = await res.json();
                this.loadingQuotes = Array.isArray(quotes) && quotes.length > 0 ? quotes : this.getDefaultLoadingQuotes();
            } else {
                this.loadingQuotes = this.getDefaultLoadingQuotes();
            }
        } catch (err) {
            console.warn('Failed to load loading quotes:', err);
            this.loadingQuotes = this.getDefaultLoadingQuotes();
        }
    }

    getDefaultLoadingQuotes() {
        return [
            { text: "10% isn't about subtraction - it's about protection.", author: 'Beforest' },
            { text: 'Nature does not hurry, yet everything is accomplished.', author: 'Lao Tzu' }
        ];
    }

    async _skipToCompletion() {
        try {
            if (this.presentationCatalog.length === 0) {
                await this.loadPresentationCatalog();
            }

            if (this.presentationCatalog.length > 0) {
                const pres = selectPresentationFromCatalog(this.presentationCatalog, this.getRequestedDeckId());
                const presId = pres.id || pres.slug || '';
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
        this.currentSlideIndex = 0;
        this.currentSlide = null;
        this.questions = new Map();
        this.userQuestions = [];
        this.unreadAnswerCount = 0;
        this.maxViewedSlideIndex = 0;
        this.notifiedAnswerIds.clear();
        this.sessionStatus = 'idle';
        this.replaySequenceActive = false;
        this.replaySequenceNextIndex = null;
        this._isContinuingReplay = false;
        this.updateHistoryBadge();
        const qaList = document.getElementById('qa-list');
        if (qaList) {
            qaList.innerHTML = '';
        }
        const filmstrip = document.getElementById('scrubber-filmstrip');
        if (filmstrip) {
            filmstrip.innerHTML = '';
        }
        this.clearLivePlaybackState();
    }

    clearLivePlaybackState() {
        this.pendingNarrationText = '';
        this.pendingPlaybackStartAt = null;
        this.totalAudioDurationMs = 0;
        this.wordBoundaries = [];
        this.slideAudioStarted = false;
        this.activeAudioSlideIndex = null;
        this.awaitingPlaybackComplete = false;
        this.isAudioPaused = false;
        this.pauseStartMs = null;
        this.pausedPlaybackOffsetMs = 0;
        this.stopTranscriptProgress?.();
        this.clearTranscriptChunkTimers?.();
        this.streamPlayer?.reset?.();
        this.socketClient?.resetPlaybackAck?.();
        this.syncSlidePauseButton?.({ paused: false, enabled: false });
        this.activeTranscriptMode = 'idle';
    }

    async loadPilotManifest() {
        try {
            const res = await fetch('/pilot-package/manifest.json', { cache: 'no-store' });
            if (!res.ok) {
                return false;
            }
            this.pilotManifest = await res.json();
            this.pilotMode = true;
            return true;
        } catch (err) {
            console.warn('Pilot manifest unavailable:', err);
            return false;
        }
    }

    configurePilotStartScreen() {
        const metadata = this.pilotManifest?.metadata || {};
        const firstSlide = this.pilotManifest?.slides?.[0] || null;
        this.presentationCatalog = [{
            id: metadata.presentationSlug || 'pilot-package',
            presentationSlug: metadata.presentationSlug || 'pilot-package',
            title: metadata.title || 'Pilot Presentation',
            source: metadata.source || 'local',
            projectSlug: metadata.projectSlug || '',
            startTitle: metadata.title || 'Pilot Presentation',
            startSubtitle: 'Frozen presentation package',
            startImage: firstSlide?.image || ''
        }];
        this.currentProjectSlug = metadata.projectSlug || '';
        this.setStartScreenMode('form');
        this.clearPersistedSession();

        const titleEl = document.getElementById('home-start-title');
        const subEl = document.getElementById('home-start-sub');
        if (titleEl) this.setMultilineText(titleEl, metadata.title || 'Pilot Presentation', 'Pilot Presentation');
        if (subEl) subEl.textContent = 'Frozen presentation package';

        const heroEl = document.getElementById('start-hero');
        if (heroEl && firstSlide?.image) {
            this.setBackgroundImage(heroEl, firstSlide.image);
        }

        const nameInput = document.getElementById('participant-name');
        const passcodeEl = document.getElementById('session-passcode');
        const hintEl = document.querySelector('.start-hint');
        if (nameInput) {
            nameInput.value = '';
            nameInput.style.display = 'none';
        }
        if (passcodeEl) {
            passcodeEl.value = '';
            passcodeEl.style.display = 'none';
        }
        if (hintEl) {
            hintEl.textContent = 'This pilot runs from a frozen local presentation package.';
        }
        localStorage.setItem(VoicePPTApp.STORAGE_KEYS.PASSCODE_REQUIRED, 'false');
        this.configurePilotInteractionMode();
    }

    configurePilotInteractionMode() {
        this.setQuestionInputsEnabled(true);
        const interruptBtn = document.getElementById('interrupt-mic');
        const footerContinueBtn = document.getElementById('footer-continue-btn');
        const slideTurnMic = document.getElementById('slide-turn-mic');
        const chatWidget = document.getElementById('completion-chat-widget');
        if (interruptBtn) interruptBtn.style.display = '';
        if (footerContinueBtn) footerContinueBtn.style.display = 'none';
        if (slideTurnMic) slideTurnMic.style.display = 'none';
        if (chatWidget) chatWidget.style.display = '';
    }

    static SESSION_TTL_MS = 24 * 60 * 60 * 1000;

    static STORAGE_KEYS = {
        SESSION: 'vpp_session',
        CLIENT_INSTANCE: 'vpp_client_instance',
        PASSCODE_REQUIRED: 'vpp_passcode_required'
    };

    getOrCreateClientInstanceId() {
        const fallback = `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        try {
            const existing = sessionStorage.getItem(VoicePPTApp.STORAGE_KEYS.CLIENT_INSTANCE);
            if (existing) return existing;
            sessionStorage.setItem(VoicePPTApp.STORAGE_KEYS.CLIENT_INSTANCE, fallback);
            return fallback;
        } catch {
            return fallback;
        }
    }

    getRequestedDeckId() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            return (urlParams.get('deck') || urlParams.get('presentation') || urlParams.get('slug') || '').trim();
        } catch {
            return '';
        }
    }

    getRuntimeSessionStorage() {
        try {
            return sessionStorage;
        } catch {
            return localStorage;
        }
    }

    persistSession(data) {
        const payload = {
            sessionId: data.sessionId,
            controlToken: data.controlToken,
            participantName: data.participantName,
            deckId: data.deckId,
            presentationSlug: data.presentationSlug || data.deckId,
            presentationSource: data.presentationSource || '',
            projectSlug: data.projectSlug,
            presentationTitle: data.presentationTitle,
            slideCount: data.slideCount,
            passcodeRequired: data.passcodeRequired,
            storedAt: Date.now()
        };
        try {
            this.getRuntimeSessionStorage().setItem(VoicePPTApp.STORAGE_KEYS.SESSION, JSON.stringify(payload));
            localStorage.setItem(VoicePPTApp.STORAGE_KEYS.PASSCODE_REQUIRED, String(!!data.passcodeRequired));
        } catch (err) {
            console.warn('Failed to persist session:', err);
        }
    }

    clearPersistedSession() {
        try {
            this.getRuntimeSessionStorage().removeItem(VoicePPTApp.STORAGE_KEYS.SESSION);
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
            const runtimeStorage = this.getRuntimeSessionStorage();
            const raw = runtimeStorage.getItem(VoicePPTApp.STORAGE_KEYS.SESSION) || localStorage.getItem(VoicePPTApp.STORAGE_KEYS.SESSION);
            if (!raw) {
                console.log('[Session] No persisted session in runtime storage');
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
            if (!runtimeStorage.getItem(VoicePPTApp.STORAGE_KEYS.SESSION)) {
                runtimeStorage.setItem(VoicePPTApp.STORAGE_KEYS.SESSION, raw);
                localStorage.removeItem(VoicePPTApp.STORAGE_KEYS.SESSION);
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
            this.streamPlayer?.unlockIOSAudio();
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
            if (!data.session || !['active', 'presenting', 'completed'].includes(data.session.status)) {
                console.log('[Session] Restore failed - bad status:', data.session?.status, '- clearing');
                this.clearPersistedSession();
                return false;
            }
            this.resetSessionRuntimeState();
            this.sessionId = session.sessionId;
            this.controlToken = session.controlToken || '';
            this.participantName = session.participantName || data.participantName || '';
            this.currentProjectSlug = session.projectSlug || this.extractProjectSlugFromSession(data) || '';
            this.totalSlides = data.session.slide_count || session.slideCount || 0;
            this.sessionStatus = String(data.session.status || 'active');
            this.maxViewedSlideIndex = Math.max(this.maxViewedSlideIndex, Number(data.session.current_slide_index || 0));
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('present-view').classList.remove('hidden');
            document.getElementById('deck-label').textContent = session.presentationTitle || session.deckId || '';
            this.clearLivePlaybackState();
            await this.primeInitialSlide();
            const connectPromise = this.socketClient.connect(this.sessionId, this.controlToken);
            const slidesPromise = this.loadSessionSlides();
            const questionsPromise = this.loadSessionQuestions();
            this.setQuestionInputsEnabled(true);
            const socketReady = await connectPromise;
            if (['active', 'presenting'].includes(String(data.session.status || ''))) {
                if (socketReady) {
                    const restoredSlideIndex = Math.max(0, Number(data.session.current_slide_index || 0));
                    this.setStatus(
                        'Session restored',
                        'paused',
                        shouldAutoResumeRestoredSession()
                            ? `Continuing from slide ${restoredSlideIndex + 1}`
                            : `Resume or replay to continue from slide ${restoredSlideIndex + 1}`
                    );
                } else {
                    this.applyStartupReadiness(false, 'Session restored');
                }
            } else {
                if (socketReady) {
                    this.setStatus('Session restored', 'paused', 'Review the current slide or replay when ready');
                } else {
                    this.applyStartupReadiness(false, 'Session restored');
                }
            }
            await Promise.all([slidesPromise, questionsPromise]);
            this.syncQuestionCount();
            console.log('[Session] Restore successful!');
            return true;
        } catch (err) {
            console.error('[Session] Restore failed with error:', err, '- keeping session for retry');
            return false;
        }
    }

    async resumePersistedSession() {
        const persisted = this.getPersistedSession();
        if (!persisted) return false;

        const restored = await this.restorePersistedSession(persisted);
        if (!restored || !this.sessionId) {
            return restored;
        }

        try {
            await this.pauseAutoplex(false);
            await this.triggerAutoPlex();
            this.restorePresentationStatus();
            return true;
        } catch (err) {
            console.error('Failed to resume persisted session:', err);
            return false;
        }
    }

    async loadSessionConfig() {
        try {
            const [configRes, persistedSession] = await Promise.all([
                this.apiFetch('/api/session/config'),
                Promise.resolve(this.getPersistedSession())
            ]);
            const requestedDeckId = this.getRequestedDeckId();
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
            
            if (requestedDeckId) {
                console.log('[Session] Deck link detected, forcing fresh viewer session');
                this.setStartScreenMode('form');
            } else if (persistedSession) {
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
        if (this.clientInstanceId) headers['X-Client-Instance-Id'] = this.clientInstanceId;
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
        on('slide-turn-continue', 'click', () => this.continuePresentationFlow());
        on('footer-continue-btn', 'click', () => this.continuePresentationFlow());
        on('slide-question-send', 'click', () => this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' }));
        on('slide-question-input', 'keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitQuestion(undefined, { queueForEnd: true, source: 'slide-turn' });
            }
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
            this.resumePersistedSession();
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
        this.syncSlidePauseButton({ paused: false, enabled: false });
    }

    mapPilotSlide(slide = {}, index = 0) {
        return {
            id: slide.id || `pilot-slide-${index + 1}`,
            slide_index: index,
            title: slide.title || '',
            content: slide.content || '',
            image: slide.image || '',
            notes: slide.notes || '',
            narrationText: slide.narrationText || '',
            audioPath: slide.audioPath || '',
            durationMs: Number(slide.durationMs || 0),
            wordBoundaries: Array.isArray(slide.wordBoundaries) ? slide.wordBoundaries : []
        };
    }

    buildPilotAudioUrl(slide = {}) {
        if (!slide.audioPath) return '';
        const version = encodeURIComponent(this.pilotManifest?.metadata?.generatedAt || Date.now());
        return `/pilot-package/${slide.audioPath}?v=${version}`;
    }

    syncPilotPlaybackClock() {
        if (!this.pilotAudio) return;
        this.pendingPlaybackStartAt = performance.now() - (this.pilotAudio.currentTime * 1000);
        this.slideAudioStarted = true;
        this.activeAudioSlideIndex = this.currentSlideIndex;
    }

    hydratePilotTranscript(slide) {
        this.narrationSourceText = String(slide?.narrationText || '').trim();
        this.fullNarrationTranscript = this.narrationSourceText;
        this.wordBoundaries = Array.isArray(slide?.wordBoundaries) ? slide.wordBoundaries : [];
        this.totalAudioDurationMs = Number(slide?.durationMs || 0);
        this.subtitleReady = true;
        this.refreshTranscriptReel();
        this.renderFullTranscription();
    }

    attachPilotAudioEvents() {
        if (!this.pilotAudio || this._pilotAudioEventsBound) return;
        this._pilotAudioEventsBound = true;

        this.pilotAudio.addEventListener('play', () => {
            this.isAudioPaused = false;
            this.syncPilotPlaybackClock();
            this.startTranscriptProgress();
            this.syncSlidePauseButton({ paused: false, enabled: true });
            this.setStatus('Presenting', 'live', 'Narration live');
        });

        this.pilotAudio.addEventListener('pause', () => {
            if (this.pilotAudio.ended) return;
            this.isAudioPaused = true;
            this.stopTranscriptProgress();
            this.syncTranscriptFrameWithPlayback();
            this.renderFullTranscription();
            this.syncSlidePauseButton({ paused: true, enabled: true });
            this.setStatus('Paused', 'paused', 'Presentation paused');
        });

        this.pilotAudio.addEventListener('timeupdate', () => {
            this.syncPilotPlaybackClock();
            this.renderFullTranscription();
        });

        this.pilotAudio.addEventListener('ended', () => {
            this.stopTranscriptProgress();
            const lastIndex = this.slideDeck.length - 1;
            if (this.currentSlideIndex >= lastIndex) {
                this.pendingPlaybackStartAt = null;
                this.syncSlidePauseButton({ paused: false, enabled: false });
                this.showCompletion({
                    totalSlides: this.slideDeck.length,
                    totalQuestionsAnswered: 0
                });
                return;
            }
            this.playPilotSlide(this.currentSlideIndex + 1, { autoPlay: true });
        });
    }

    async startPilotSession() {
        if (!this.pilotManifest?.slides?.length) {
            throw new Error('Pilot package not loaded');
        }

        const btn = document.getElementById('start-presentation');
        if (btn) {
            btn.disabled = true;
            btn.querySelector('span').textContent = 'Starting...';
        }

        this.clearPersistedSession();
        this.resetSessionRuntimeState();
        this.configurePilotInteractionMode();
        this.attachPilotAudioEvents();

        this.sessionId = 'pilot-local';
        this.controlToken = '';
        this.participantName = '';
        this.currentProjectSlug = this.pilotManifest.metadata?.projectSlug || '';
        this.totalSlides = Number(this.pilotManifest.metadata?.slideCount || this.pilotManifest.slides.length || 0);
        this.slideDeck = this.pilotManifest.slides.map((slide, index) => this.mapPilotSlide(slide, index));
        this.sessionStatus = 'presenting';

        await this.loadLoadingQuotes(this.currentProjectSlug);
        this.ui.showLoadingScreen(this.loadingQuotes);

        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('present-view').classList.remove('hidden');
        document.getElementById('deck-label').textContent = this.pilotManifest.metadata?.title || 'Pilot Presentation';

        this.updateSlide({
            slideIndex: 0,
            totalSlides: this.totalSlides,
            slide: this.slideDeck[0]
        });

        this.ui.hideLoadingScreen();
        await this.playPilotSlide(0, { autoPlay: true });
    }

    async playPilotSlide(index, options = {}) {
        const autoPlay = options.autoPlay !== false;
        const slide = this.slideDeck[index];
        if (!slide) return;

        this.pilotAudio.pause();
        this.pilotAudio.currentTime = 0;
        this.resetSubtitleState();
        this.updateSlide({
            slideIndex: index,
            totalSlides: this.totalSlides || this.slideDeck.length,
            slide
        });
        this.hydratePilotTranscript(slide);
        this.pilotAudio.src = this.buildPilotAudioUrl(slide);
        this.isAudioPaused = !autoPlay;
        this.syncSlidePauseButton({ paused: !autoPlay, enabled: true });
        if (autoPlay) {
            await this.pilotAudio.play();
        } else {
            this.setStatus('Ready', 'paused', `Slide ${index + 1} ready`);
        }
    }

    // Proxy UI methods for cleaner access
    setStatus(t, s, d) { this.ui.setStatus(t, s, d); }
    showTranscript(s) { this.ui.showTranscript(s); }
    updateMicState() { this.ui.updateMicState(this.isListening, this.voiceModeEnabled, this.azureVoice.connected); }

    syncSlidePauseButton({ paused = this.isAudioPaused, enabled = false } = {}) {
        const btn = document.getElementById('slide-pause-btn');
        const iconPause = btn?.querySelector('.icon-pause');
        const iconPlay = btn?.querySelector('.icon-play');
        if (!btn) return;
        btn.disabled = !enabled;
        btn.classList.toggle('is-paused', Boolean(paused) && enabled);
        btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        if (iconPause) iconPause.style.display = paused ? 'none' : 'block';
        if (iconPlay) iconPlay.style.display = paused ? 'block' : 'none';
    }

    async loadPresentationCatalog() {
        try {
            const res = await fetch('/api/cms/presentations');
            const data = await res.json();
            if (!Array.isArray(data.presentations) || data.presentations.length === 0) return;
            this.presentationCatalog = data.presentations.map((presentation) => normalizePresentationSelection(presentation));

            const requestedDeckId = this.getRequestedDeckId();
            const p = selectPresentationFromCatalog(this.presentationCatalog, requestedDeckId);
            this.currentProjectSlug = p?.projectSlug || this.currentProjectSlug || '';
            this.loadLoadingQuotes(this.currentProjectSlug);
            const titleEl = document.getElementById('home-start-title');
            const subEl = document.getElementById('home-start-sub');
            if (titleEl) this.setMultilineText(titleEl, p.startTitle, 'THE 10% LIFE');
            if (subEl) subEl.textContent = p.startSubtitle || '';

            const heroEl = document.getElementById('start-hero');
            if (heroEl) {
                this.setBackgroundImage(heroEl, p.startImage);
                if (p.startImage) {
                    console.log('Hero image set:', p.startImage);
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
                        this.addQuestionToList(question.id, question.question_text, question.submitted_by || 'You', {
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
        if (this.pilotMode) {
            try {
                await this.startPilotSession();
            } catch (err) {
                console.error('Pilot session failed to start:', err);
                this.setStatus('Pilot unavailable', 'paused', 'The local presentation package could not be opened');
                const btn = document.getElementById('start-presentation');
                if (btn) {
                    btn.disabled = false;
                    btn.querySelector('span').textContent = 'Begin Experience';
                }
            }
            return;
        }

        const requestedDeckId = this.getRequestedDeckId();
        const selectedPresentation = selectPresentationFromCatalog(this.presentationCatalog, requestedDeckId);
        if (requestedDeckId && !selectedPresentation) {
            this.setStatus('Presentation unavailable', 'paused', 'The requested presentation could not be found in this catalog');
            return;
        }
        const presentationSlug = selectedPresentation?.presentationSlug || requestedDeckId || '10_percent_lifestyle';
        const deckId = selectedPresentation?.id || presentationSlug;
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
                body: JSON.stringify({
                    deckId,
                    presentationSlug,
                    presentationSource: selectedPresentation?.source || '',
                    participantName,
                    passcode,
                    bypassMaster
                }) 
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
                if (data.code && data.presentationSlug) {
                    this.setStatus('Presentation unavailable', 'paused', data.error || 'The requested presentation could not be loaded');
                    btn.disabled = false; btn.querySelector('span').textContent = 'Begin Experience';
                    return;
                }
                throw new Error(data.error || 'Failed to start');
            }

            this.sessionId = data.sessionId; this.controlToken = data.controlToken || '';
            this.totalSlides = data.slideCount || 0; this.participantName = data.participantName || participantName;
            this.currentProjectSlug = data.projectSlug || selectedPresentation?.projectSlug || this.currentProjectSlug || '';
            await this.loadLoadingQuotes(this.currentProjectSlug);

            // Start the loading experience (The 10% Breath)
            this.ui.showLoadingScreen(this.loadingQuotes);

            this.resetSessionRuntimeState();
            this.persistSession({
                sessionId: this.sessionId,
                controlToken: this.controlToken,
                participantName: this.participantName,
                deckId: data.deckId || deckId,
                presentationSlug: data.presentationSlug || presentationSlug,
                presentationSource: data.presentationSource || selectedPresentation?.source || '',
                projectSlug: this.currentProjectSlug,
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
            const connectPromise = Promise.resolve(this.socketClient.connect(this.sessionId, this.controlToken));

            // Run setup tasks in parallel with pre-gen polling.
            const [, , socketReady] = await Promise.all([
                this.primeInitialSlide(),
                this.loadSessionSlides(),
                connectPromise,
            ]);

            this.setQuestionInputsEnabled(true);
            this.applyStartupReadiness(Boolean(socketReady));

            if (socketReady) {
                await this.triggerAutoPlex();
            }

            // Don't block first-slide playback on full-deck pre-generation.
            // Give the pregen loop a brief head start, then let playback begin
            // while the rest of the deck continues preparing in the background.
            await Promise.race([
                preGenPromise,
                new Promise((resolve) => setTimeout(resolve, 1500))
            ]);

            this.ui.hideLoadingScreen();
            await this.loadSessionQuestions();
            this.syncQuestionCount();
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
            this.currentProjectSlug = meta.projectSlug || this.currentProjectSlug || '';
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
        this.currentSlideIndex = data.slideIndex;
        this.totalSlides = data.totalSlides || this.totalSlides;
        this.maxViewedSlideIndex = Math.max(this.maxViewedSlideIndex, this.currentSlideIndex);
        this.currentSlide = data.slide || null;
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
        if (this.isQAPhase && !data?.isQA) {
            return;
        }

        this.activeTranscriptMode = data?.isQA ? 'qa' : 'narration';
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
        if (this.isQAPhase && !data?.isQA) return;

        this.activeTranscriptMode = data?.isQA ? 'qa' : 'narration';

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
        if (this.isQAPhase && !data?.isQA) return;

        // --- SLIDE MISMATCH PROTECTION ---
        // If we receive audio for a slide that isn't the current one, and it's not a replay/QA flow,
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
            this.socketClient.resetPlaybackAck(data.slideIndex);
            this.syncSlidePauseButton({ paused: false, enabled: false });
        }
        
        this.awaitingPlaybackComplete = true; this.subtitleReady = true;
        this.slideAudioStarted = true;
        if (typeof data?.slideIndex === 'number') {
            this.activeAudioSlideIndex = data.slideIndex;
        }
        this.syncSlidePauseButton({ paused: this.isAudioPaused, enabled: true });
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
        if (this.isQAPhase && !data?.isQA) return;
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
        if (this.isQAPhase && !data?.isQA) return;
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
            const isPaused = this.isAudioPaused || this.streamPlayer?._isPaused;

            if (pollCount % 20 === 0 || pollCount <= 5) {
                console.log(`[waitForPlaybackFinish] poll=${pollCount}, hasPending=${hasPending}, isPaused=${isPaused}, slideAudioStarted=${this.slideAudioStarted}`);
            }

            if (pollCount > MAX_POLLS) {
                console.warn(`[Audio] Playback poll exceeded max iterations, forcing completion`);
                this.awaitingPlaybackComplete = false;

                this.stopTranscriptProgress();
                this.clearTranscriptChunkTimers();
                this.pendingPlaybackStartAt = null;
                this.activeAudioSlideIndex = null;
                this.streamPlayer.reset();
                this.isAudioPaused = false;
                this.pauseStartMs = null;
                this.syncSlidePauseButton({ paused: false, enabled: false });
                this.socketClient.notifyPlaybackComplete(this.sessionId, completedSlideIndex);
                return;
            }

            // If slide changed while we were waiting, bail out to avoid sending completion for wrong slide
            if (typeof data?.slideIndex === 'number' && data.slideIndex !== this.currentSlideIndex && !data?.isQA && !data?.isWrapUp) {
                console.log(`[Audio] Slide changed during poll: was ${data.slideIndex}, now ${this.currentSlideIndex}. Bailing.`);
                this.awaitingPlaybackComplete = false;
                return;
            }

            if (isPaused) {
                setTimeout(poll, 120);
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
                this.socketClient.notifyPlaybackComplete(this.sessionId, completedSlideIndex);
            }

            this.streamPlayer.reset();
            this.streamPlayer.resume();
            this.isAudioPaused = false;
            this.pauseStartMs = null;
            this.syncSlidePauseButton({ paused: false, enabled: false });

            if (data?.isReplay && this.replaySequenceActive && Number.isInteger(this.replaySequenceNextIndex)) {
                setTimeout(() => {
                    this.continueReplaySequence();
                }, 180);
            }
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
            this.activeTranscriptMode = this.isQAPhase ? 'qa' : 'narration';
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
        this.activeTranscriptMode = 'idle';
        this.slideAudioStarted = false;
        this.activeAudioSlideIndex = null;
        this.isAudioPaused = false;
        this.pauseStartMs = null;
        this.clearTranscriptChunkTimers();
        this.stopTranscriptProgress();
        this.syncSlidePauseButton({ paused: false, enabled: false });
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
        if (!text) return;
        this.pendingQuestionText = text;
        try {
            if (input) input.blur();
            if (button) button.disabled = true;
            if (this.pilotMode) {
                await this.submitPilotQuestion(text, options);
                if (input) input.value = '';
                this.pendingQuestionText = null;
                this.ui.toggleQuestionDrawer(true, { focusInput: false });
                return;
            }

            if (!this.sessionId) return;
            const res = await this.apiFetch('/api/questions', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    questionText: text,
                    submittedBy: options.submittedBy || 'You'
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
            input.value = '';
            this.pendingQuestionText = null;
            this.setStatus('Question queued', 'paused', 'Answered after the current slide');
            this.userQuestions.push({ id: null, text, slideIndex: this.currentSlideIndex, timestamp: Date.now() });
            this.ui.toggleQuestionDrawer(true, { focusInput: false });
        } catch (err) {
            console.error(err);
            this.setStatus('Question failed', 'paused', 'Retry');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async submitPilotQuestion(text, options = {}) {
        const questionId = `pilot-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const submittedBy = options.submittedBy || 'You';
        this.addQuestionToList(questionId, text, submittedBy, { source: 'pilot' });
        this.setStatus('Thinking', 'paused', 'Preparing an answer');

        const res = await fetch('/api/questions/pilot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                questionText: text,
                submittedBy,
                presentationSlug: this.pilotManifest?.metadata?.presentationSlug || '',
                projectSlug: this.currentProjectSlug || this.pilotManifest?.metadata?.projectSlug || '',
                currentSlideIndex: this.currentSlideIndex,
                currentSlide: this.currentSlide ? {
                    id: this.currentSlide.id,
                    title: this.currentSlide.title,
                    content: this.currentSlide.content,
                    notes: this.currentSlide.notes
                } : null,
                slides: (this.slideDeck || []).map((slide, index) => ({
                    id: slide.id || `pilot-slide-${index + 1}`,
                    slide_index: Number.isFinite(Number(slide.slide_index)) ? Number(slide.slide_index) : index,
                    title: slide.title || '',
                    content: slide.content || '',
                    notes: slide.notes || ''
                }))
            })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed');
        }

        this.markQuestionAnswered(questionId, data.answerText || '', text, {
            answerTitle: data.answerTitle,
            answerSummary: data.answerSummary,
            answerDetails: data.answerDetails,
            answerAudioUrl: '',
            suppressNotification: true
        });
        this.userQuestions.push({
            id: questionId,
            questionText: text,
            answerText: data.answerText || '',
            answerTitle: data.answerTitle || '',
            answerSummary: data.answerSummary || '',
            answerAudioUrl: '',
            timestamp: Date.now()
        });
        this.setStatus('Q&A ready', 'paused', 'Answer added to the conversation');
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

        const accessibleIndex = Math.max(this.currentSlideIndex, this.maxViewedSlideIndex);
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

        const scrubber = document.getElementById('scrubber-container');
        if (scrubber) scrubber.classList.add('hidden');

        // Selecting a previously viewed slide is always allowed
        // Selecting a future slide temporarily unlocks it
        if (index > this.maxViewedSlideIndex) {
            this.maxViewedSlideIndex = index;
        }

        this.replaySequenceActive = this.sessionStatus === 'completed' && index < this.slideDeck.length - 1;
        this.replaySequenceNextIndex = this.replaySequenceActive
            ? index + 1
            : null;

        const targetSlide = this.slideDeck[index] || null;
        if (targetSlide && index !== this.currentSlideIndex) {
            this.updateSlide({
                slideIndex: index,
                totalSlides: this.totalSlides || this.slideDeck.length,
                slide: targetSlide
            });
        }

        if (this.pilotMode) {
            await this.playPilotSlide(index, { autoPlay: true });
            this.renderScrubber();
            return;
        }

        try {
            await this.replaySlide(index);
        } catch (err) {
            console.warn('Replay request failed, falling back to direct jump:', err);
            if (index !== this.currentSlideIndex) {
                await this.jumpToSlide(index);
                await this.resumePresentationAfterHistory();
            }
        }

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

    clearReplaySequence() {
        this.replaySequenceActive = false;
        this.replaySequenceNextIndex = null;
        this._isContinuingReplay = false;
    }

    async continueReplaySequence() {
        if (!this.replaySequenceActive || this._isContinuingReplay || !Number.isInteger(this.replaySequenceNextIndex)) {
            return;
        }

        const nextIndex = this.replaySequenceNextIndex;
        if (nextIndex < 0 || nextIndex >= this.slideDeck.length) {
            this.clearReplaySequence();
            return;
        }

        this._isContinuingReplay = true;
        this.replaySequenceNextIndex = nextIndex < this.slideDeck.length - 1 ? nextIndex + 1 : null;

        try {
            const targetSlide = this.slideDeck[nextIndex] || null;
            if (targetSlide && nextIndex !== this.currentSlideIndex) {
                this.updateSlide({
                    slideIndex: nextIndex,
                    totalSlides: this.totalSlides || this.slideDeck.length,
                    slide: targetSlide
                });
            }
            await this.replaySlide(nextIndex);
            if (!Number.isInteger(this.replaySequenceNextIndex)) {
                this.replaySequenceActive = false;
            }
        } catch (err) {
            console.error('Replay sequence failed:', err);
            this.clearReplaySequence();
        } finally {
            this._isContinuingReplay = false;
        }
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
        if (!this.questions.has(id)) this.addQuestionToList(id, txt, 'You', meta);
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
        this.scrollQuestionCardIntoView(target);
        this.syncQuestionCount();
        this.registerQuestionAnswerNotification(id, meta.suppressNotification);
    }

    scrollQuestionCardIntoView(card) {
        if (!card) return;
        const container = document.querySelector('.qa-content-area');
        if (!container) {
            card.scrollIntoView({ block: 'end', behavior: 'smooth' });
            return;
        }

        requestAnimationFrame(() => {
            const containerRect = container.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const footerBuffer = 24;
            const hiddenBottom = cardRect.bottom - containerRect.bottom + footerBuffer;
            if (hiddenBottom > 0) {
                container.scrollTo({
                    top: container.scrollTop + hiddenBottom,
                    behavior: 'smooth'
                });
                return;
            }

            const hiddenTop = containerRect.top - cardRect.top + footerBuffer;
            if (hiddenTop > 0) {
                container.scrollTo({
                    top: Math.max(0, container.scrollTop - hiddenTop),
                    behavior: 'smooth'
                });
            }
        });
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
            this.addQuestionToList(questionId, data.questionText || 'Question', data.submittedBy || 'You', meta);
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

        const presentation = buildQuestionAnswerPresentation(payload);
        const wrap = document.createElement('div');
        wrap.className = 'qa-answer-thread';

        if (presentation.shouldShowTitle) {
            const header = document.createElement('div');
            header.className = 'qa-answer-thread-header';
            const title = document.createElement('div');
            title.className = 'qa-answer-thread-title';
            title.textContent = presentation.titleText;
            header.appendChild(title);
            wrap.appendChild(header);
        }

        if (presentation.secondaryText) {
            const summary = document.createElement('div');
            summary.className = 'qa-answer-thread-summary';
            summary.replaceChildren(this.buildLinkedContent(presentation.secondaryText));
            wrap.appendChild(summary);
        }

        if (presentation.primaryText) {
            const details = document.createElement('div');
            details.className = 'qa-answer-thread-details';
            details.replaceChildren(this.buildLinkedContent(presentation.primaryText));
            wrap.appendChild(details);
        }
        container.appendChild(wrap);
    }

    stopQuestionAnswerAudioPlayback() {
        if (this.questionAudioPlayer && !this.questionAudioPlayer.paused) {
            this.questionAudioPlayer.pause();
        }
        if (this.activeQuestionAudioButton) {
            this.updateQuestionAudioButtonState(this.activeQuestionAudioButton, false);
        }
        this.activeQuestionAudioButton = null;
        this.questionAudioPausedNarration = false;
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
        void this.toggleAudioPause();
    }

    resumeMainNarrationAfterQuestionAudio() {
        if (!this.questionAudioPausedNarration) return;

        this.questionAudioPausedNarration = false;
        const context = this.streamPlayer?.audioContext;
        if (context && context.state === 'suspended') {
            void this.toggleAudioPause();
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
        if (this.pilotMode) {
            const nextIndex = this.currentSlideIndex + 1;
            if (nextIndex >= this.slideDeck.length) {
                this.showCompletion({
                    totalSlides: this.slideDeck.length,
                    totalQuestionsAnswered: 0
                });
                return;
            }
            await this.playPilotSlide(nextIndex, { autoPlay: true });
            return;
        }

        if (!this.sessionId) return;
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
        if (this.pilotMode) {
            if (this.isAudioPaused || this.pilotAudio?.ended) return;
            if (this.pilotAudio?.paused) {
                try {
                    await this.pilotAudio.play();
                } catch (err) {
                    console.warn('Pilot playback resume failed:', err);
                }
            }
            return;
        }

        if (!this.sessionId) return;
        try {
            await this.pauseAutoplex(false);
            this.restorePresentationStatus();
        } catch (err) {
            console.error('Failed to resume after history:', err);
        }
    }

    async toggleAudioPause() {
        if (this.pilotMode) {
            if (!this.pilotAudio || !this.pilotAudio.src) {
                this.syncSlidePauseButton({ paused: false, enabled: false });
                return;
            }
            if (this._isTogglingPause) return;
            this._isTogglingPause = true;
            setTimeout(() => { this._isTogglingPause = false; }, 300);

            if (this.pilotAudio.paused || this.pilotAudio.ended) {
                try {
                    await this.pilotAudio.play();
                } catch (err) {
                    console.warn('Pilot playback resume failed:', err);
                }
                return;
            }

            this.pilotAudio.pause();
            return;
        }

        if (!this.streamPlayer || !this.streamPlayer.audioContext) return;
        const hasPlayback = this.streamPlayer.isPlaying
            || this.streamPlayer.hasPendingPlayback()
            || Boolean(this.pendingPlaybackStartAt);
        if (!hasPlayback && !this.isAudioPaused) {
            this.syncSlidePauseButton({ paused: false, enabled: false });
            return;
        }

        // Guard against rapid double-clicks
        if (this._isTogglingPause) return;
        this._isTogglingPause = true;
        setTimeout(() => { this._isTogglingPause = false; }, 300);

        // If we are currently paused, resume regardless of AudioContext state.
        // The pause path stops sources and marks the stream player paused; it does not
        // necessarily suspend the AudioContext.
        if (this.isAudioPaused) {
            const resumedAtMs = performance.now();
            const pauseDurationMs = this.pauseStartMs
                ? Math.max(0, resumedAtMs - this.pauseStartMs)
                : 0;
            await this.streamPlayer.resume();
            this.isAudioPaused = false;
            if (this.pendingPlaybackStartAt) {
                this.pendingPlaybackStartAt += pauseDurationMs;
            } else if (this.pausedPlaybackOffsetMs > 0) {
                this.pendingPlaybackStartAt = resumedAtMs - this.pausedPlaybackOffsetMs;
            }
            this.pauseStartMs = null;
            this.pausedPlaybackOffsetMs = 0;
            this.syncSlidePauseButton({ paused: false, enabled: true });
            this.syncTranscriptReelPlayback();
            this.startTranscriptProgress();
            await this.pauseAutoplex(false);
            return;
        }

        // If audio is running, pause it
        if (this.streamPlayer.audioContext.state === 'running') {
            // Use the audio player's pause() method - it sets _isPaused = true
            // which blocks all new chunks from being processed
            this.pausedPlaybackOffsetMs = this.getCurrentPlaybackOffsetMs();
            await this.streamPlayer.pause();
            this.isAudioPaused = true;
            this.pauseStartMs = performance.now();
            this.clearTranscriptChunkTimers();
            this.stopTranscriptProgress();
            this.syncTranscriptFrameWithPlayback();
            this.renderFullTranscription();
            this.syncSlidePauseButton({ paused: true, enabled: true });
            await this.pauseAutoplex(true);
        }
        // Fallback for browsers that really suspend the AudioContext
        else if (this.streamPlayer.audioContext.state === 'suspended') {
            const resumedAtMs = performance.now();
            const pauseDurationMs = this.pauseStartMs
                ? Math.max(0, resumedAtMs - this.pauseStartMs)
                : 0;
            await this.streamPlayer.audioContext.resume();
            await this.streamPlayer.resume();
            this.isAudioPaused = false;
            if (this.pendingPlaybackStartAt) {
                this.pendingPlaybackStartAt += pauseDurationMs;
            } else if (this.pausedPlaybackOffsetMs > 0) {
                this.pendingPlaybackStartAt = resumedAtMs - this.pausedPlaybackOffsetMs;
            }
            this.pauseStartMs = null;
            this.pausedPlaybackOffsetMs = 0;
            this.syncSlidePauseButton({ paused: false, enabled: true });
            this.syncTranscriptReelPlayback();
            this.startTranscriptProgress();
            await this.pauseAutoplex(false);
        }
    }

    getCurrentPlaybackOffsetMs() {
        if (!this.pendingPlaybackStartAt) return 0;
        const referenceNow = this.isAudioPaused && this.pauseStartMs
            ? this.pauseStartMs
            : performance.now();
        const elapsed = Math.max(0, referenceNow - this.pendingPlaybackStartAt);
        return this.totalAudioDurationMs > 0
            ? Math.min(elapsed, this.totalAudioDurationMs)
            : elapsed;
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

    enterQuestionAnswerMode(data = {}) {
        this.isQAPhase = true;
        this.voiceTurnState = 'thinking';
        this.stopQuestionAnswerAudioPlayback();
        this.resetSubtitleState();
        this.activeTranscriptMode = 'qa';
        if (!this.voiceModeEnabled) {
            this.setStatus('Thinking', 'paused', data.inline ? 'Interrupt received. Building answer.' : 'Opening question mode');
        }
    }

    handleQuestionAnswerDelta(data = {}) {
        this.handleNarrationDelta({
            ...data,
            isQA: true,
            append: true
        });
    }

    handleQuestionAnswerText(data = {}) {
        this.markQuestionAnswered(data.questionId, data.answer || '', data.question || '', {
            answerTitle: data.answerTitle,
            answerSummary: data.answerSummary,
            answerDetails: data.answerDetails
        });
        this.finalizeSubtitleText(data.answer || '');
    }

    exitQuestionAnswerMode() {
        this.isQAPhase = false;
        this.voiceTurnState = 'idle';
        this.stopQuestionAnswerAudioPlayback();
        this.resetSubtitleState();
        this.showTranscript(false);
        this.stopWaveform();
        this.activeTranscriptMode = 'idle';
        if (!this.voiceModeEnabled) {
            this.restorePresentationStatus();
        }
    }

    restorePresentationStatus() {
        if (this.voiceModeEnabled) { this.setStatus('Q&A', 'paused', 'Ask anything — I\'ll answer'); return; }
        if (this.awaitingSlideContinue) { this.setStatus('Your turn', 'paused', 'Type a question or continue'); return; }
        if (this.isQAPhase) { this.setStatus('Q&A', 'paused', 'Answering questions'); return; }
        this.setStatus('Presenting', 'live', 'Narration live');
    }

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
        if (summaryEl) {
            if (this.pilotMode) {
                summaryEl.textContent = 'Take the first step with a Beforest hospitality trial.';
            } else {
                summaryEl.textContent = `${data.totalSlides || this.slideDeck.length} slides delivered. ${data.totalQuestionsAnswered || Array.from(this.questions.values()).filter(q => q.status === 'answered').length} questions discussed.`;
            }
        }
        
        const activity = { 
            participantName: this.participantName, 
            deckTitle: document.getElementById('deck-label').textContent, 
            totalSlides: data.totalSlides, 
            questionsAnswered: data.totalQuestionsAnswered, 
            userQuestions: this.userQuestions, 
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
                .filter(img => this.isSafeBackgroundUrl(img));
            
            if (allImages.length > 0) {
                const randomImg = allImages[Math.floor(Math.random() * allImages.length)];
                this.setBackgroundImage(hero, randomImg);
            } else if (this.currentSlide?.image) {
                this.setBackgroundImage(hero, this.currentSlide.image);
            } else {
                this.setBackgroundImage(hero, '');
            }
        }

        this.loadCtaBlocks();

        this.setStatus('Complete', 'paused', this.pilotMode ? 'Ready for your first step' : 'Your session summary is ready');
    }

    async loadCtaBlocks() {
        if (this.pilotMode) {
            this.renderPilotCtaBlock();
            return;
        }

        const projectSlug = this.getCurrentProjectSlug();
        if (!projectSlug) {
            const section = document.getElementById('completion-cta');
            if (section) section.classList.add('hidden');
            return;
        }
        try {
            const res = await fetch(`/api/cms/projects/${projectSlug}/cta-blocks`);
            const data = await res.json();
            const blocksData = data.ctaBlocks || [];
            const blocks = blocksData.length > 0 ? blocksData : [];
            const container = document.getElementById('cta-blocks');
            if (!container) return;
            container.innerHTML = '';
            
            const icons = {
                calendar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
                tree: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14l-5-5-5 5"/><path d="M13 20V8"/><path d="M9 20v-4H5l7-7 7 7h-4v4"/></svg>',
                mail: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
                globe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
            };

            blocks.forEach(block => {
                const href = this.getSafeNavigationUrl(block.url);
                if (!href) return;
                const el = document.createElement('a');
                el.href = href;
                el.target = href.startsWith('http') ? '_blank' : '_self';
                el.rel = 'noopener noreferrer';
                el.className = 'cta-block';
                const left = document.createElement('div');
                left.className = 'cta-block-left';
                left.style.display = 'flex';
                left.style.alignItems = 'center';
                left.style.gap = '12px';

                const icon = document.createElement('div');
                icon.className = 'cta-block-icon';
                icon.style.opacity = '0.6';
                icon.innerHTML = icons[block.icon] || icons.globe;

                const label = document.createElement('div');
                label.className = 'cta-block-label';
                label.textContent = String(block.label || '').trim();

                const arrow = document.createElement('div');
                arrow.className = 'cta-block-arrow';
                arrow.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';

                left.append(icon, label);
                el.append(left, arrow);
                container.appendChild(el);
            });
            const section = document.getElementById('completion-cta');
            if (section) section.classList.toggle('hidden', container.childElementCount === 0);
        } catch (err) {
            console.warn('Could not load CTA blocks:', err);
            const section = document.getElementById('completion-cta');
            if (section) section.classList.add('hidden');
        }
    }

    renderPilotCtaBlock() {
        const section = document.getElementById('completion-cta');
        const container = document.getElementById('cta-blocks');
        const footerNote = document.querySelector('.completion-footer-note p');
        const completionTitle = document.querySelector('.completion-title');
        if (!section || !container) return;

        container.innerHTML = '';
        const cta = document.createElement('a');
        cta.href = 'https://hospitality.beforest.co';
        cta.target = '_blank';
        cta.rel = 'noopener noreferrer';
        cta.className = 'cta-block';
        cta.innerHTML = `
            <div class="cta-block-left" style="display:flex;align-items:center;gap:12px;">
                <div class="cta-block-icon" style="opacity:0.6;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                </div>
                <div class="cta-block-label">Start Your Beforest Trial</div>
            </div>
            <div class="cta-block-arrow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            </div>
        `;
        container.appendChild(cta);
        section.classList.remove('hidden');
        if (completionTitle) completionTitle.textContent = 'Start Your Trial';
        if (footerNote) footerNote.textContent = 'If this feels right, take the first real step now.';
    }

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

    buildLinkedContent(text = '') {
        const fragment = document.createDocumentFragment();
        const input = String(text || '');
        const lines = input.split(/\n+/);

        lines.forEach((line, lineIndex) => {
            const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
            let cursor = 0;
            let match;

            while ((match = pattern.exec(line)) !== null) {
                if (match.index > cursor) {
                    fragment.appendChild(document.createTextNode(line.slice(cursor, match.index)));
                }

                const href = match[2] || match[3] || `mailto:${match[4]}`;
                const label = match[1] || match[3] || match[4] || href;
                const link = document.createElement('a');
                link.href = href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'qa-answer-link';
                link.textContent = label;
                fragment.appendChild(link);
                cursor = pattern.lastIndex;
            }

            if (cursor < line.length) {
                fragment.appendChild(document.createTextNode(line.slice(cursor)));
            }

            if (lineIndex < lines.length - 1) {
                fragment.appendChild(document.createElement('br'));
            }
        });

        return fragment;
    }

    setQuestionInputsEnabled(enabled) {
        const questionInput = document.getElementById('question-input');
        const submitButton = document.getElementById('submit-question');
        if (questionInput) questionInput.disabled = !enabled;
        if (submitButton) submitButton.disabled = !enabled;
    }

    extractProjectSlugFromSession(data = {}) {
        try {
            const metadata = JSON.parse(data?.session?.metadata || '{}');
            return String(metadata.projectSlug || '').trim();
        } catch {
            return '';
        }
    }

    getCurrentProjectSlug() {
        return String(this.currentProjectSlug || '').trim();
    }

    applyStartupReadiness(socketReady, title = 'Ready') {
        if (socketReady) {
            this.setStatus(title, 'live', 'Type questions anytime');
            return;
        }
        this.setStatus('Connection limited', 'paused', 'Presentation loaded, but live updates are unavailable');
    }

    setMultilineText(element, text, fallback = '') {
        if (!element) return;
        const value = String(text || fallback || '');
        element.replaceChildren();
        const lines = value.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (index > 0) element.appendChild(document.createElement('br'));
            element.appendChild(document.createTextNode(line));
        });
    }

    getSafeNavigationUrl(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        if (value.startsWith('/')) return value;
        try {
            const parsed = new URL(value, window.location.origin);
            if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
                return parsed.toString();
            }
        } catch {}
        return '';
    }

    isSafeBackgroundUrl(url) {
        const value = String(url || '').trim();
        if (!value) return false;
        try {
            const parsed = new URL(value, window.location.origin);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    setBackgroundImage(element, url) {
        if (!element) return;
        if (!this.isSafeBackgroundUrl(url)) {
            element.style.backgroundImage = '';
            return;
        }
        element.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
    }

    escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => { window.app = new VoicePPTApp(); });
}
