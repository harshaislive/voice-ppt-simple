const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');
const { createPlaybackContractHarness } = require('../helpers/createPlaybackContractHarness');

describe('playback advance sequencing', () => {
    test('normal slide advance prefers client completion acknowledgment', async () => {
        const harness = await createPlaybackContractHarness();
        const client = await harness.connectClient('session-advance', 'client-advance');

        const waitPromise = harness.waitForPlaybackCompletion('session-advance', 100, 4);
        client.emit('presentation-audio-complete', {
            sessionId: 'session-advance',
            slideIndex: 4,
            clientInstanceId: 'client-advance'
        });

        await expect(waitPromise).resolves.toBe(true);
        client.close();
        await harness.close();
    });

    test('missing acknowledgment uses guarded fallback instead of hanging forever', async () => {
        const harness = await createPlaybackContractHarness();
        await expect(harness.waitForPlaybackCompletion('session-fallback', 30, 5)).resolves.toBe(false);
        await harness.close();
    });

    test('manual jump remains an explicit override path', async () => {
        process.env.DISABLE_SESSION_CONTROL = 'true';
        jest.resetModules();
        jest.doMock('../../server/services/questionClassifier', () => ({
            classifyQuestions: jest.fn().mockResolvedValue([])
        }));
        jest.doMock('../../server/services/slideEngine', () => ({
            decideNextAction: jest.fn().mockResolvedValue({
                action: 'jump_to_slide',
                targetSlide: 2,
                reason: 'operator-selected-slide'
            })
        }));
        jest.doMock('../../server/services/supabaseSession', () => ({
            isConfigured: () => false
        }));

        const slidesRouter = require('../../server/routes/slides');
        const io = { to: () => ({ emit: jest.fn() }) };
        const db = {
            get(query) {
                if (query.includes('SELECT control_token_hash FROM sessions')) {
                    return { control_token_hash: null };
                }
                if (query.includes('FROM sessions s')) {
                    return {
                        id: 'session-1',
                        current_slide_index: 0,
                        slide_content: 'Intro',
                        status: 'presenting'
                    };
                }
                if (query.includes('COUNT(*) as count FROM slides')) {
                    return { count: 3 };
                }
                if (query.includes('SELECT * FROM slides')) {
                    return { id: 'slide-3', slide_index: 2, title: 'Slide 3' };
                }
                return null;
            },
            all(query) {
                if (query.includes('FROM questions')) {
                    return [];
                }
                return [];
            },
            run: jest.fn()
        };

        const app = createTestApp({ routeBase: '/api/slide', router: slidesRouter, db, io });
        const response = await request(app)
            .post('/api/slide/advance')
            .set('x-session-control-token', 'anything')
            .send({ sessionId: 'session-1', targetSlide: 2 });

        expect(response.status).toBe(200);
        expect(response.body.decision.reason).toBe('manual-override');
        delete process.env.DISABLE_SESSION_CONTROL;
    });
});
