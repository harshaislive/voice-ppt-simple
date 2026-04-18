const request = require('supertest');
const { hashToken } = require('../../server/middleware/security');
const {
    createCMSServiceHarness,
    createSessionRouterApp,
    postSessionStart
} = require('./createContentLoadingHarness');
const { createDocumentStub } = require('./createAutoplexControlHarness');

function createStorageStub() {
    const store = new Map();
    return {
        getItem: jest.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: jest.fn((key, value) => store.set(key, String(value))),
        removeItem: jest.fn((key) => store.delete(key)),
        clear: jest.fn(() => store.clear())
    };
}

function createLoggerStub() {
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(() => logger)
    };
    return logger;
}

function createInMemorySessionDb() {
    const sessions = new Map();
    const slidesBySession = new Map();
    const questionsBySession = new Map();
    const events = [];

    function getSession(id) {
        return sessions.get(id) || null;
    }

    function getSlides(id) {
        return slidesBySession.get(id) || [];
    }

    return {
        sessions,
        slidesBySession,
        questionsBySession,
        events,
        run(sql, params = []) {
            if (sql.includes('INSERT INTO sessions')) {
                const [id, deckId, controlTokenHash, createdAt, updatedAt, metadata] = params;
                sessions.set(id, {
                    id,
                    deck_id: deckId,
                    control_token_hash: controlTokenHash,
                    current_slide_index: 0,
                    status: 'active',
                    created_at: createdAt,
                    updated_at: updatedAt,
                    metadata
                });
                return {};
            }

            if (sql.includes('INSERT INTO slides')) {
                const [id, sessionId, deckId, slideIndex, title, content, image, notes, createdAt] = params;
                const slides = getSlides(sessionId).slice();
                slides.push({
                    id,
                    session_id: sessionId,
                    deck_id: deckId,
                    slide_index: slideIndex,
                    title,
                    content,
                    image,
                    notes,
                    created_at: createdAt
                });
                slidesBySession.set(sessionId, slides);
                return {};
            }

            if (sql.includes('INSERT INTO events')) {
                const [sessionId, eventType, eventData, createdAt] = params;
                events.push({
                    session_id: sessionId,
                    event_type: eventType,
                    event_data: eventData,
                    created_at: createdAt || new Date().toISOString()
                });
                return {};
            }

            if (sql.includes('UPDATE sessions')) {
                const sessionId = params[params.length - 1];
                const session = getSession(sessionId);
                if (!session) return {};
                const next = { ...session, updated_at: new Date().toISOString() };
                const setMatch = sql.match(/SET\s+([\s\S]+?)\s*,\s*updated_at\s*=\s*CURRENT_TIMESTAMP/i);
                const assignedFields = setMatch
                    ? setMatch[1]
                        .split(',')
                        .map((clause) => clause.trim().split(/\s*=\s*/)[0].trim())
                        .filter(Boolean)
                    : [];
                assignedFields.forEach((field, index) => {
                    if (field === 'current_slide_index') {
                        next.current_slide_index = params[index];
                    }
                    if (field === 'status') {
                        next.status = params[index];
                    }
                });
                if (assignedFields.length === 0 && sql.includes('status = ?')) {
                    next.status = params[0];
                }
                sessions.set(sessionId, next);
                return {};
            }

            return {};
        },
        get(sql, params = []) {
            if (sql.includes('SELECT control_token_hash FROM sessions')) {
                const session = getSession(params[0]);
                return session ? { control_token_hash: session.control_token_hash } : null;
            }

            if (sql.includes('SELECT id FROM sessions WHERE id = ?')) {
                const session = getSession(params[0]);
                return session ? { id: session.id } : null;
            }

            if (sql.includes('SELECT COUNT(*) as count FROM slides WHERE session_id = ?')) {
                return { count: getSlides(params[0]).length };
            }

            if (sql.includes('SELECT s.*,') && sql.includes('FROM sessions s')) {
                const session = getSession(params[0]);
                if (!session) return null;
                const slides = getSlides(params[0]);
                const questions = questionsBySession.get(params[0]) || [];
                return {
                    ...session,
                    pending_questions: questions.filter((question) => question.status === 'pending').length,
                    slide_count: slides.length
                };
            }

            return null;
        },
        all(sql, params = []) {
            if (sql.includes('SELECT * FROM slides WHERE session_id = ?')) {
                return getSlides(params[0]).slice().sort((a, b) => a.slide_index - b.slide_index);
            }

            if (sql.includes('SELECT * FROM questions')) {
                const questions = questionsBySession.get(params[0]) || [];
                return questions
                    .filter((question) => !sql.includes('status = \'pending\'') || question.status === 'pending')
                    .slice();
            }

            return [];
        }
    };
}

function installBrowserGlobals() {
    const document = createDocumentStub();
    const localStorage = createStorageStub();
    const sessionStorage = createStorageStub();

    global.document = document;
    global.window = { location: { search: '', origin: 'http://localhost:3000' } };
    global.localStorage = localStorage;
    global.sessionStorage = sessionStorage;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    global.cancelAnimationFrame = (id) => clearTimeout(id);
    global.performance = { now: () => 1000 };

    return { document, localStorage, sessionStorage };
}

function uninstallBrowserGlobals() {
    delete global.document;
    delete global.window;
    delete global.localStorage;
    delete global.sessionStorage;
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
}

function seedStartScreen(document, participantName = 'Taylor') {
    document.getElementById('participant-name').value = participantName;
    document.getElementById('session-passcode').value = '';
    document.getElementById('session-passcode').offsetParent = null;

    const startButton = document.getElementById('start-presentation');
    startButton.disabled = false;
    startButton.querySelector = jest.fn(() => ({ textContent: 'Begin Experience' }));

    document.getElementById('start-screen');
    document.getElementById('present-view');
    document.getElementById('deck-label').textContent = '';
    document.getElementById('chat-badge').setAttribute = jest.fn();
    document.getElementById('qa-list');
    document.getElementById('scrubber-filmstrip');
}

function createApiFetch(app, getControlToken = () => '') {
    return async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        const path = url.startsWith('/api/') ? url : `/api${url}`;
        let req = request(app)[method.toLowerCase()](path);
        const controlToken = getControlToken();
        if (controlToken) {
            req = req.set('x-session-control-token', controlToken);
        }
        if (options.body) {
            req = req.set('Content-Type', 'application/json').send(JSON.parse(options.body));
        }
        const response = await req;
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            json: async () => response.body
        };
    };
}

async function createRegressionHarness({
    localPresentation,
    remotePresentation = null,
    supabaseConfigured = false
} = {}) {
    jest.resetModules();

    const presentation = localPresentation || {
        id: 'alpha',
        presentationSlug: 'alpha',
        projectSlug: 'project-alpha',
        title: 'Alpha Presentation',
        source: 'local',
        declaredSource: 'local',
        slides: [
            { title: 'Intro', content: 'Welcome to Alpha.', notes: 'Open with the core pitch.' },
            { title: 'Offer', content: 'Membership gives 30 nights per year.', notes: 'Cover access and next steps.' }
        ]
    };

    const cmsServiceMock = createCMSServiceHarness({
        localPresentation: presentation,
        remotePresentation,
        supabaseConfigured
    });
    const logger = createLoggerStub();
    const db = createInMemorySessionDb();
    const { app } = createSessionRouterApp({ cmsServiceMock, logger });
    app.set('db', db);

    const globals = installBrowserGlobals();
    seedStartScreen(globals.document);

    return {
        app,
        db,
        logger,
        cmsServiceMock,
        globals,
        presentation,
        createApiFetch(getControlToken) {
            return createApiFetch(app, getControlToken);
        },
        async startRealSession(payload = {}) {
            return postSessionStart(app, {
                deckId: presentation.id,
                presentationSlug: presentation.presentationSlug,
                participantName: 'Taylor',
                ...payload
            });
        },
        buildAppContext(overrides = {}) {
            const context = {
                sessionId: null,
                controlToken: '',
                participantName: '',
                totalSlides: 0,
                currentProjectSlug: '',
                slideDeck: [],
                presentationCatalog: [presentation],
                loadingQuotes: [],
                currentSlideIndex: 0,
                currentSlide: null,
                questions: new Map(),
                userQuestions: [],
                unreadAnswerCount: 0,
                maxViewedSlideIndex: 0,
                notifiedAnswerIds: new Set(),
                sessionStatus: 'idle',
                awaitingSlideContinue: false,
                isQAPhase: false,
                voiceModeEnabled: false,
                voiceTurnState: 'idle',
                activeTranscriptMode: 'idle',
                pendingPlaybackStartAt: 100,
                isAudioPaused: false,
                pauseStartMs: null,
                setStatus: jest.fn(),
                ui: {
                    showLoadingScreen: jest.fn(),
                    hideLoadingScreen: jest.fn(),
                    syncQuestionCount: jest.fn(),
                    closeSlideTurnOverlay: jest.fn(),
                    toggleQuestionDrawer: jest.fn()
                },
                renderSubtitle: jest.fn(),
                refreshTranscriptReel: jest.fn(),
                clearTranscriptChunkTimers: jest.fn(),
                stopTranscriptProgress: jest.fn(),
                syncTranscriptReelPlayback: jest.fn(),
                startTranscriptProgress: jest.fn(),
                syncSlidePauseButton: jest.fn(),
                setQuestionInputsEnabled: jest.fn(),
                syncQuestionCount: jest.fn(),
                updateHistoryBadge: jest.fn(),
                resetSubtitleState: jest.fn(),
                showTranscript: jest.fn(),
                stopWaveform: jest.fn(),
                addQuestionToList: jest.fn(function addQuestionToList(questionId, questionText, submittedBy, meta) {
                    this.questions.set(questionId, {
                        id: questionId,
                        questionText,
                        submittedBy,
                        status: 'pending',
                        meta
                    });
                }),
                markQuestionAnswered: jest.fn(function markQuestionAnswered(questionId, answerText, questionText, meta) {
                    const current = this.questions.get(questionId) || {};
                    this.questions.set(questionId, {
                        ...current,
                        id: questionId,
                        questionText,
                        answerText,
                        status: 'answered',
                        meta
                    });
                }),
                stopQuestionAnswerAudioPlayback: jest.fn(),
                restorePresentationStatus: jest.fn(),
                loadSessionSlides: jest.fn().mockResolvedValue(presentation.slides),
                loadSessionQuestions: jest.fn().mockResolvedValue([]),
                applyStartupReadiness: jest.fn(),
                waitForPreGeneration: jest.fn().mockResolvedValue(),
                primeInitialSlide: jest.fn().mockResolvedValue(),
                triggerAutoPlex: jest.fn().mockResolvedValue(),
                streamPlayer: {
                    unlockIOSAudio: jest.fn(),
                    reset: jest.fn(),
                    audioContext: { state: 'running' },
                    isPlaying: true,
                    hasPendingPlayback: jest.fn(() => true),
                    pause: jest.fn().mockResolvedValue(),
                    resume: jest.fn().mockResolvedValue(),
                    shiftPlaybackWindow: jest.fn()
                },
                socketClient: {
                    connect: jest.fn().mockResolvedValue(true),
                    resetPlaybackAck: jest.fn()
                },
                pauseAutoplex: jest.fn().mockResolvedValue(),
                apiFetch: null,
                getRequestedDeckId() {
                    return '';
                },
                persistSession(data) {
                    this.persistedSession = data;
                },
                clearPersistedSession: jest.fn(),
                getRuntimeSessionStorage() {
                    return sessionStorage;
                },
                extractProjectSlugFromSession(data) {
                    try {
                        return JSON.parse(data?.session?.metadata || '{}').projectSlug || '';
                    } catch {
                        return '';
                    }
                }
            };

            context.apiFetch = createApiFetch(app, () => context.controlToken);
            return Object.assign(context, overrides);
        },
        cleanup() {
            uninstallBrowserGlobals();
            jest.resetModules();
            jest.clearAllMocks();
        }
    };
}

module.exports = {
    createRegressionHarness,
    createLoggerStub,
    createInMemorySessionDb
};
