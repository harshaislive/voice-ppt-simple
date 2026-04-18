const { createRegressionHarness } = require('../helpers/createRegressionHarness');

describe('regression negative paths', () => {
    let harness;

    beforeEach(async () => {
        harness = await createRegressionHarness();
    });

    afterEach(() => {
        harness.cleanup();
    });

    test('wrong-source startup fails closed and missing control token cannot restore the session', async () => {
        const wrongSource = await harness.startRealSession({
            presentationSource: 'supabase'
        });

        expect(wrongSource.status).toBe(503);
        expect(wrongSource.body).toMatchObject({
            success: false,
            code: 'PRESENTATION_SOURCE_UNAVAILABLE',
            presentationSlug: 'alpha',
            requestedSource: 'supabase'
        });

        const validStart = await harness.startRealSession();
        const deniedRestore = await harness.createApiFetch(() => '')(`/api/session/${validStart.body.sessionId}`);

        expect(deniedRestore.status).toBe(403);
    });

    test('qa ownership and stale slide audio cleanup still prevent continuity drift', async () => {
        const { VoicePPTApp } = await require('../../public/app.js');
        const app = harness.buildAppContext({
            currentSlideIndex: 1,
            activeAudioSlideIndex: 2,
            fullNarrationTranscript: '',
            narrationSourceText: '',
            subtitleBuffer: '',
            streamPlayer: {
                reset: jest.fn(),
                resume: jest.fn(),
                playChunk: jest.fn(),
                audioContext: { state: 'running' },
                isPlaying: true,
                hasPendingPlayback: jest.fn(() => true),
                pause: jest.fn().mockResolvedValue(),
                shiftPlaybackWindow: jest.fn()
            }
        });

        VoicePPTApp.prototype.enterQuestionAnswerMode.call(app, { inline: true });
        VoicePPTApp.prototype.handleNarrationDelta.call(app, { delta: 'slide narration', append: true, isQA: false });
        expect(app.fullNarrationTranscript).toBe('');
        VoicePPTApp.prototype.exitQuestionAnswerMode.call(app);

        VoicePPTApp.prototype.handleAudioChunk.call(app, {
            slideIndex: 0,
            chunk: 'abc',
            sampleRate: 24000,
            channels: 1,
            isReplay: true
        });

        expect(app.streamPlayer.reset).toHaveBeenCalled();
        expect(app.socketClient.resetPlaybackAck).toHaveBeenCalledWith(0);
        expect(app.isAudioPaused).toBe(false);
    });
});
