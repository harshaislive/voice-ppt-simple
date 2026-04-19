const { importAudioModule, importVoicePPTAppModule } = require('../helpers/createAutoplexControlHarness');

describe('playback pause and resume', () => {
    test('pause stops current playback and resume continues the same slide contract', async () => {
        const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
            fn();
            return 0;
        });
        const originalPerformanceNow = performance.now;
        let now = 1000;
        performance.now = jest.fn(() => now);
        const { VoicePPTApp } = await importVoicePPTAppModule();
        const pause = jest.fn().mockResolvedValue();
        const resume = jest.fn().mockResolvedValue();
        const shiftPlaybackWindow = jest.fn();
        const replaySlide = jest.fn();
        const pauseAutoplex = jest.fn().mockResolvedValue();

        const app = {
            streamPlayer: {
                audioContext: { state: 'running' },
                isPlaying: true,
                hasPendingPlayback: () => true,
                pause,
                resume,
                shiftPlaybackWindow
            },
            pendingPlaybackStartAt: 100,
            totalAudioDurationMs: 5000,
            isAudioPaused: false,
            pauseStartMs: null,
            pausedPlaybackOffsetMs: 0,
            syncSlidePauseButton: jest.fn(),
            clearTranscriptChunkTimers: jest.fn(),
            stopTranscriptProgress: jest.fn(),
            syncTranscriptReelPlayback: jest.fn(),
            syncTranscriptFrameWithPlayback: jest.fn(),
            renderFullTranscription: jest.fn(),
            startTranscriptProgress: jest.fn(),
            pauseAutoplex,
            replaySlide,
            _isTogglingPause: false,
            getCurrentPlaybackOffsetMs: VoicePPTApp.prototype.getCurrentPlaybackOffsetMs
        };

        await VoicePPTApp.prototype.toggleAudioPause.call(app);
        expect(pause).toHaveBeenCalled();
        expect(pauseAutoplex).toHaveBeenCalledWith(true);
        expect(app.isAudioPaused).toBe(true);
        expect(app.pausedPlaybackOffsetMs).toBe(900);

        now = 1600;
        app._isTogglingPause = false;
        await VoicePPTApp.prototype.toggleAudioPause.call(app);
        expect(resume).toHaveBeenCalled();
        expect(shiftPlaybackWindow).not.toHaveBeenCalled();
        expect(pauseAutoplex).toHaveBeenLastCalledWith(false);
        expect(replaySlide).not.toHaveBeenCalled();
        expect(app.pendingPlaybackStartAt).toBe(700);
        expect(app.pauseStartMs).toBeNull();
        expect(app.pausedPlaybackOffsetMs).toBe(0);
        performance.now = originalPerformanceNow;
        timeoutSpy.mockRestore();
    });

    test('stream player shifts playback window by pause duration before flushing resume work', async () => {
        const { StreamAudioPlayer } = await importAudioModule();
        const player = new StreamAudioPlayer();
        const originalPerformanceNow = performance.now;
        let now = 1000;
        performance.now = jest.fn(() => now);
        player._resumeContext = jest.fn().mockResolvedValue();
        player.shiftPlaybackWindow = jest.fn();
        player._pausedAtMs = 1000;
        player.chunkQueue = [{ pcmBase64: 'abc', sampleRate: 24000, channels: 1 }];

        const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
            fn();
            return 0;
        });
        player._flushQueue = jest.fn();

        now = 1600;
        await player.resume();

        expect(player.shiftPlaybackWindow).toHaveBeenCalledWith(600);
        expect(player._pausedAtMs).toBeNull();
        expect(player._flushQueue).toHaveBeenCalled();

        performance.now = originalPerformanceNow;
        timeoutSpy.mockRestore();
    });

    test('reset clears queued and active playback state', async () => {
        const { StreamAudioPlayer } = await importAudioModule();
        const player = new StreamAudioPlayer();
        const source = { onended: null, stop: jest.fn(), disconnect: jest.fn() };
        player.activeSources = [source];
        player.chunkQueue = [{ chunk: 'a' }];
        player.isPlaying = true;
        player.isBuffering = true;
        player._isPaused = true;

        player.reset();

        expect(player.getPlaybackState()).toMatchObject({
            isPaused: false,
            isPlaying: false,
            hasPendingPlayback: false,
            activeSources: 0,
            queuedChunks: 0
        });
    });

    test('slide changes clear stale paused playback state', async () => {
        const { VoicePPTApp } = await importVoicePPTAppModule();
        const app = {
            voiceModeEnabled: false,
            currentSlideIndex: 2,
            activeAudioSlideIndex: 0,
            streamPlayer: {
                reset: jest.fn(),
                resume: jest.fn(),
                playChunk: jest.fn()
            },
            socketClient: {
                resetPlaybackAck: jest.fn()
            },
            isAudioPaused: true,
            pendingPlaybackStartAt: 50,
            pauseStartMs: 20,
            syncSlidePauseButton: jest.fn(),
            renderSubtitle: jest.fn(),
            refreshTranscriptReel: jest.fn(),
            wordBoundaries: [],
            transcriptChunks: [],
            pendingNarrationText: '',
            awaitingPlaybackComplete: false,
            subtitleReady: false,
            slideAudioStarted: false
        };

        VoicePPTApp.prototype.handleAudioChunk.call(app, {
            slideIndex: 1,
            chunk: 'abc',
            sampleRate: 24000,
            channels: 1,
            isReplay: true
        });

        expect(app.streamPlayer.reset).toHaveBeenCalled();
        expect(app.streamPlayer.resume).toHaveBeenCalled();
        expect(app.socketClient.resetPlaybackAck).toHaveBeenCalledWith(1);
        expect(app.isAudioPaused).toBe(false);
    });
});
