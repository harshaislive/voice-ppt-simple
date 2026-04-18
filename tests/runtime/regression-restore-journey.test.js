const { createRegressionHarness } = require('../helpers/createRegressionHarness');

describe('regression restore journey', () => {
    let harness;

    beforeEach(async () => {
        harness = await createRegressionHarness();
    });

    afterEach(() => {
        harness.cleanup();
    });

    test('restore keeps canonical presentation identity and requires explicit resume', async () => {
        const startResponse = await harness.startRealSession({
            participantName: 'Taylor'
        });
        expect(startResponse.status).toBe(200);

        const startPayload = startResponse.body;
        const { VoicePPTApp } = await require('../../public/app.js');
        const app = harness.buildAppContext({
            sessionId: startPayload.sessionId,
            controlToken: startPayload.controlToken,
            pauseAutoplex: jest.fn().mockResolvedValue(),
            restorePresentationStatus: jest.fn(),
            resetSessionRuntimeState: VoicePPTApp.prototype.resetSessionRuntimeState,
            clearLivePlaybackState: VoicePPTApp.prototype.clearLivePlaybackState
        });

        const restored = await VoicePPTApp.prototype.restorePersistedSession.call(app, {
            sessionId: startPayload.sessionId,
            controlToken: startPayload.controlToken,
            participantName: 'Taylor',
            deckId: startPayload.deckId,
            presentationSlug: startPayload.presentationSlug,
            presentationSource: startPayload.presentationSource,
            projectSlug: startPayload.projectSlug,
            presentationTitle: startPayload.presentationTitle,
            slideCount: startPayload.slideCount
        });

        expect(restored).toBe(true);
        expect(app.sessionId).toBe(startPayload.sessionId);
        expect(app.currentProjectSlug).toBe('project-alpha');
        expect(app.setStatus).toHaveBeenCalledWith(
            'Session restored',
            'paused',
            'Resume or replay to continue from slide 1'
        );

        await VoicePPTApp.prototype.resumePresentationAfterHistory.call(app);
        expect(app.pauseAutoplex).toHaveBeenCalledWith(false);
        expect(app.restorePresentationStatus).toHaveBeenCalled();
    });
});
