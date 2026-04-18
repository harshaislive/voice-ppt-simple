const { createDocumentStub, importVoicePPTAppModule } = require('../helpers/createAutoplexControlHarness');

describe('qa isolation', () => {
    beforeEach(() => {
        global.document = createDocumentStub();
        global.window = { location: { search: '', origin: 'http://localhost' } };
        global.localStorage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };
        global.sessionStorage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };
        global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
        global.cancelAnimationFrame = (id) => clearTimeout(id);
        global.performance = { now: () => 1000 };
    });

    test('enterQuestionAnswerMode resets shared transcript state and marks QA ownership', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();

        const app = {
            isQAPhase: false,
            voiceModeEnabled: false,
            voiceTurnState: 'idle',
            activeTranscriptMode: 'narration',
            stopQuestionAnswerAudioPlayback: jest.fn(),
            resetSubtitleState: jest.fn(),
            setStatus: jest.fn()
        };

        VoicePPTApp.prototype.enterQuestionAnswerMode.call(app, { inline: true });

        expect(app.isQAPhase).toBe(true);
        expect(app.voiceTurnState).toBe('thinking');
        expect(app.activeTranscriptMode).toBe('qa');
        expect(app.stopQuestionAnswerAudioPlayback).toHaveBeenCalled();
        expect(app.resetSubtitleState).toHaveBeenCalled();
        expect(app.setStatus).toHaveBeenCalledWith('Thinking', 'paused', 'Interrupt received. Building answer.');
    });

    test('handleNarrationDelta ignores narration deltas while QA mode owns the transcript', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();

        const app = {
            isQAPhase: true,
            activeTranscriptMode: 'qa',
            subtitleBuffer: '',
            fullNarrationTranscript: '',
            narrationSourceText: '',
            renderSubtitle: jest.fn(),
            refreshTranscriptReel: jest.fn()
        };

        VoicePPTApp.prototype.handleNarrationDelta.call(app, { delta: 'slide narration', append: true, isQA: false });
        expect(app.fullNarrationTranscript).toBe('');

        VoicePPTApp.prototype.handleNarrationDelta.call(app, { delta: 'answer text', append: true, isQA: true });
        expect(app.fullNarrationTranscript).toBe('answer text');
        expect(app.activeTranscriptMode).toBe('qa');
    });

    test('exitQuestionAnswerMode clears QA ownership and restores presentation status', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();

        const app = {
            isQAPhase: true,
            voiceModeEnabled: false,
            voiceTurnState: 'answering',
            activeTranscriptMode: 'qa',
            stopQuestionAnswerAudioPlayback: jest.fn(),
            resetSubtitleState: jest.fn(),
            showTranscript: jest.fn(),
            stopWaveform: jest.fn(),
            restorePresentationStatus: jest.fn()
        };

        VoicePPTApp.prototype.exitQuestionAnswerMode.call(app);

        expect(app.isQAPhase).toBe(false);
        expect(app.voiceTurnState).toBe('idle');
        expect(app.activeTranscriptMode).toBe('idle');
        expect(app.stopQuestionAnswerAudioPlayback).toHaveBeenCalled();
        expect(app.resetSubtitleState).toHaveBeenCalled();
        expect(app.restorePresentationStatus).toHaveBeenCalled();
    });
});
