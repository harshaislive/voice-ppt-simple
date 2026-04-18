const { createPlaybackContractHarness } = require('../helpers/createPlaybackContractHarness');

describe('playback contract', () => {
    let harness;

    beforeEach(async () => {
        harness = await createPlaybackContractHarness();
    });

    afterEach(async () => {
        await harness.close();
    });

    test('controller client acknowledges playback completion for the active slide only', async () => {
        const client = await harness.connectClient('session-1', 'client-a');
        const waitPromise = harness.waitForPlaybackCompletion('session-1', 100, 2);

        expect(harness.getPlaybackContract('session-1')).toMatchObject({
            expectedSlideIndex: 2,
            status: 'waiting_for_client_playback'
        });

        client.emit('presentation-audio-complete', {
            sessionId: 'session-1',
            slideIndex: 2,
            clientInstanceId: 'client-a'
        });

        await expect(waitPromise).resolves.toBe(true);
        expect(harness.getPlaybackContract('session-1')).toBeNull();
        client.close();
    });

    test('stale acknowledgments do not complete the wrong slide', async () => {
        const client = await harness.connectClient('session-2', 'client-b');
        const waitPromise = harness.waitForPlaybackCompletion('session-2', 200, 3);

        client.emit('presentation-audio-complete', {
            sessionId: 'session-2',
            slideIndex: 2,
            clientInstanceId: 'client-b'
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(harness.getPlaybackContract('session-2')).toMatchObject({
            expectedSlideIndex: 3,
            status: 'waiting_for_client_playback'
        });

        client.emit('presentation-audio-complete', {
            sessionId: 'session-2',
            slideIndex: 3,
            clientInstanceId: 'client-b'
        });

        await expect(waitPromise).resolves.toBe(true);
        client.close();
    });

    test('server wait path falls back when client playback completion never arrives', async () => {
        const waitPromise = harness.waitForPlaybackCompletion('session-3', 25, 1);

        await expect(waitPromise).resolves.toBe(false);
        expect(harness.getPlaybackContract('session-3')).toBeNull();
    });
});
