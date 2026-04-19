const { createDocumentStub, importVoicePPTAppModule } = require('../helpers/createAutoplexControlHarness');

describe('playback restore behavior', () => {
    beforeEach(() => {
        global.document = createDocumentStub();
        global.window = { location: { origin: 'http://localhost:3000' } };
        global.localStorage = {
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };
        global.sessionStorage = {
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
        delete global.localStorage;
        delete global.sessionStorage;
    });

    test('restore reconnects without auto-replaying the current slide', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();
        const replaySlide = jest.fn();
        const pauseAutoplex = jest.fn();
        const setStatus = jest.fn();
        const streamReset = jest.fn();

        const app = {
            apiFetch: jest.fn().mockResolvedValue({
                status: 200,
                ok: true,
                json: async () => ({
                    session: {
                        status: 'presenting',
                        current_slide_index: 2,
                        slide_count: 5,
                        metadata: JSON.stringify({ projectSlug: 'project-1' })
                    },
                    participantName: 'Taylor'
                })
            }),
            streamPlayer: {
                unlockIOSAudio: jest.fn(),
                reset: streamReset
            },
            resetSessionRuntimeState: VoicePPTApp.prototype.resetSessionRuntimeState,
            clearLivePlaybackState: VoicePPTApp.prototype.clearLivePlaybackState,
            stopTranscriptProgress: jest.fn(),
            clearTranscriptChunkTimers: jest.fn(),
            syncSlidePauseButton: jest.fn(),
            socketClient: {
                connect: jest.fn().mockResolvedValue(true),
                resetPlaybackAck: jest.fn()
            },
            extractProjectSlugFromSession: VoicePPTApp.prototype.extractProjectSlugFromSession,
            primeInitialSlide: jest.fn(),
            loadSessionSlides: jest.fn().mockResolvedValue([]),
            loadSessionQuestions: jest.fn().mockResolvedValue([]),
            setQuestionInputsEnabled: jest.fn(),
            syncQuestionCount: jest.fn(),
            replaySlide,
            pauseAutoplex,
            setStatus,
            applyStartupReadiness: jest.fn(),
            clearPersistedSession: jest.fn(),
            questions: new Map(),
            userQuestions: [],
            notifiedAnswerIds: new Set(),
            updateHistoryBadge: jest.fn()
        };

        const restored = await VoicePPTApp.prototype.restorePersistedSession.call(app, {
            sessionId: 'session-1',
            controlToken: 'token',
            participantName: 'Taylor',
            projectSlug: 'project-1',
            deckId: 'deck-1',
            presentationTitle: 'Deck 1',
            slideCount: 5
        });

        expect(restored).toBe(true);
        expect(replaySlide).not.toHaveBeenCalled();
        expect(pauseAutoplex).not.toHaveBeenCalled();
        expect(setStatus).toHaveBeenCalledWith('Session restored', 'paused', 'Resume or replay to continue from slide 3');
        expect(streamReset).toHaveBeenCalled();
    });

    test('restore does not auto-resume narration after reconnect', async () => {
        const { VoicePPTApp, shouldAutoResumeRestoredSession } = await importVoicePPTAppModule();
        expect(shouldAutoResumeRestoredSession()).toBe(false);

        const setStatus = jest.fn();
        const app = {
            apiFetch: jest.fn().mockResolvedValue({
                status: 200,
                ok: true,
                json: async () => ({
                    session: {
                        status: 'active',
                        current_slide_index: 0,
                        slide_count: 2,
                        metadata: '{}'
                    }
                })
            }),
            streamPlayer: {
                unlockIOSAudio: jest.fn(),
                reset: jest.fn()
            },
            resetSessionRuntimeState: VoicePPTApp.prototype.resetSessionRuntimeState,
            clearLivePlaybackState: VoicePPTApp.prototype.clearLivePlaybackState,
            stopTranscriptProgress: jest.fn(),
            clearTranscriptChunkTimers: jest.fn(),
            syncSlidePauseButton: jest.fn(),
            socketClient: {
                connect: jest.fn().mockResolvedValue(true),
                resetPlaybackAck: jest.fn()
            },
            extractProjectSlugFromSession: jest.fn(() => ''),
            primeInitialSlide: jest.fn(),
            loadSessionSlides: jest.fn().mockResolvedValue([]),
            loadSessionQuestions: jest.fn().mockResolvedValue([]),
            setQuestionInputsEnabled: jest.fn(),
            syncQuestionCount: jest.fn(),
            setStatus,
            applyStartupReadiness: jest.fn(),
            clearPersistedSession: jest.fn(),
            questions: new Map(),
            userQuestions: [],
            notifiedAnswerIds: new Set(),
            updateHistoryBadge: jest.fn()
        };

        await VoicePPTApp.prototype.restorePersistedSession.call(app, {
            sessionId: 'session-2',
            controlToken: 'token',
            slideCount: 2
        });

        expect(setStatus).toHaveBeenCalledWith('Session restored', 'paused', 'Resume or replay to continue from slide 1');
    });

    test('explicit resume still works after restore', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();
        const pauseAutoplex = jest.fn().mockResolvedValue();
        const restorePresentationStatus = jest.fn();

        await VoicePPTApp.prototype.resumePresentationAfterHistory.call({
            sessionId: 'session-3',
            pauseAutoplex,
            restorePresentationStatus
        });

        expect(pauseAutoplex).toHaveBeenCalledWith(false);
        expect(restorePresentationStatus).toHaveBeenCalled();
    });

    test('resume persisted session restores then resumes the presentation loop', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();
        const persisted = { sessionId: 'session-4', controlToken: 'token' };
        const restorePersistedSession = jest.fn().mockResolvedValue(true);
        const pauseAutoplex = jest.fn().mockResolvedValue();
        const triggerAutoPlex = jest.fn().mockResolvedValue();
        const restorePresentationStatus = jest.fn();

        const resumed = await VoicePPTApp.prototype.resumePersistedSession.call({
            getPersistedSession: jest.fn(() => persisted),
            restorePersistedSession,
            pauseAutoplex,
            triggerAutoPlex,
            restorePresentationStatus,
            sessionId: 'session-4'
        });

        expect(resumed).toBe(true);
        expect(restorePersistedSession).toHaveBeenCalledWith(persisted);
        expect(pauseAutoplex).toHaveBeenCalledWith(false);
        expect(triggerAutoPlex).toHaveBeenCalled();
        expect(restorePresentationStatus).toHaveBeenCalled();
    });
});
