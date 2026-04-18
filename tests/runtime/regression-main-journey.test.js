const { createRegressionHarness } = require('../helpers/createRegressionHarness');

describe('regression main presentation journey', () => {
    let harness;

    beforeEach(async () => {
        harness = await createRegressionHarness();
    });

    afterEach(() => {
        harness.cleanup();
    });

    test('session start, pause/resume, q&a interruption, and completion stay coherent together', async () => {
        const { VoicePPTApp } = await require('../../public/app.js');
        const app = harness.buildAppContext({
            resetSessionRuntimeState: VoicePPTApp.prototype.resetSessionRuntimeState,
            clearLivePlaybackState: VoicePPTApp.prototype.clearLivePlaybackState
        });

        await VoicePPTApp.prototype.startSession.call(app);

        expect(app.sessionId).toBeTruthy();
        expect(app.controlToken).toBeTruthy();
        expect(app.persistedSession).toMatchObject({
            presentationSlug: 'alpha',
            presentationSource: 'local',
            projectSlug: 'project-alpha',
            slideCount: 2
        });

        await VoicePPTApp.prototype.toggleAudioPause.call(app);
        expect(app.isAudioPaused).toBe(true);
        expect(app.pauseAutoplex).toHaveBeenCalledWith(true);

        app.isAudioPaused = true;
        app.pauseStartMs = performance.now();
        app._isTogglingPause = false;
        await VoicePPTApp.prototype.toggleAudioPause.call(app);
        expect(app.isAudioPaused).toBe(false);
        expect(app.pauseAutoplex).toHaveBeenLastCalledWith(false);

        VoicePPTApp.prototype.enterQuestionAnswerMode.call(app, { inline: true });
        app.restorePresentationStatus.mockClear();
        VoicePPTApp.prototype.handleQuestionAnswerReady.call(app, {
            questionId: 'q-1',
            questionText: 'What happens next?',
            submittedBy: 'Taylor',
            answerText: 'Book the next session and we will guide the setup.',
            answerTitle: 'Next step',
            answerSummary: 'Book the next session.',
            answerDetails: 'Book the next session and we will guide the setup.'
        });
        VoicePPTApp.prototype.exitQuestionAnswerMode.call(app);

        expect(app.questions.get('q-1')).toMatchObject({
            status: 'answered',
            questionText: 'What happens next?',
            answerText: 'Book the next session and we will guide the setup.'
        });
        expect(app.userQuestions).toHaveLength(1);
        expect(app.restorePresentationStatus).toHaveBeenCalled();

        const completeResponse = await app.apiFetch(`/api/session/${app.sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed', current_slide_index: 1 })
        });

        expect(completeResponse.ok).toBe(true);

        const sessionResponse = await app.apiFetch(`/api/session/${app.sessionId}`);
        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.session).toMatchObject({
            id: app.sessionId,
            status: 'completed',
            deck_id: 'alpha',
            current_slide_index: 1
        });
        expect(sessionPayload.slideCount).toBe(2);
    });
});
