const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');

describe('Analytics auth guards', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.DISABLE_SESSION_CONTROL;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    function createDb() {
        return {
            get(query, params) {
                if (query.includes('SELECT control_token_hash FROM sessions')) {
                    return {
                        control_token_hash: require('../../server/middleware/security').hashToken('valid-token')
                    };
                }

                return null;
            }
        };
    }

    function loadRouter(logEvent = jest.fn().mockResolvedValue()) {
        jest.doMock('../../server/services/analytics', () => ({
            logEvent
        }));

        return require('../../server/routes/analytics');
    }

    test('POST /api/analytics/event rejects missing session control', async () => {
        const router = loadRouter();
        const app = createTestApp({ routeBase: '/api/analytics', router, db: createDb() });

        const response = await request(app)
            .post('/api/analytics/event')
            .send({ sessionId: 'session-1', eventType: 'slide_view' });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/session control token/i);
    });

    test('POST /api/analytics/event allows valid session control', async () => {
        const logEvent = jest.fn().mockResolvedValue();
        const router = loadRouter(logEvent);
        const app = createTestApp({ routeBase: '/api/analytics', router, db: createDb() });

        const response = await request(app)
            .post('/api/analytics/event')
            .set('x-session-control-token', 'valid-token')
            .send({ sessionId: 'session-1', eventType: 'slide_view' });

        expect(response.status).toBe(200);
        expect(logEvent).toHaveBeenCalledWith('session-1', 'slide_view', undefined, undefined, undefined);
    });
});
