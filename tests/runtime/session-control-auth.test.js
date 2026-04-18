const request = require('supertest');
const { io: Client } = require('socket.io-client');
const { createTestApp } = require('../helpers/createTestApp');
const { createSessionControlServer } = require('../helpers/createSessionControlServer');

describe('Session control guards', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.DISABLE_SESSION_CONTROL;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    function createDb() {
        const { hashToken } = require('../../server/middleware/security');
        const session = {
            id: 'session-1',
            deck_id: 'deck-1',
            control_token_hash: hashToken('valid-token'),
            current_slide_index: 0,
            status: 'active',
            metadata: JSON.stringify({ participantName: 'Taylor' })
        };

        return {
            get(query, params) {
                if (query.includes('SELECT control_token_hash FROM sessions')) {
                    return { control_token_hash: session.control_token_hash };
                }
                if (query.includes('FROM sessions s')) {
                    return { ...session, pending_questions: 0, slide_count: 1 };
                }
                if (query.includes('SELECT COUNT(*) as count FROM slides')) {
                    return { count: 1 };
                }
                return null;
            },
            all(query) {
                if (query.includes('FROM slides')) {
                    return [{ id: 'slide-1', session_id: 'session-1', slide_index: 0, title: 'Intro', content: 'Hello' }];
                }
                if (query.includes('FROM questions')) {
                    return [];
                }
                return [];
            },
            run() {}
        };
    }

    function loadSessionRouter() {
        jest.doMock('../../server/services/cms', () => ({
            loadPresentation: jest.fn().mockResolvedValue({ slides: [] })
        }));
        jest.doMock('../../server/services/analytics', () => ({
            logSessionStart: jest.fn(),
            logSessionEnd: jest.fn()
        }));
        jest.doMock('../../server/services/supabaseSession', () => ({
            isConfigured: () => false
        }));

        return require('../../server/routes/session');
    }

    test('GET /api/session/:id rejects missing token and allows valid token', async () => {
        const router = loadSessionRouter();
        const app = createTestApp({ routeBase: '/api/session', router, db: createDb() });

        const denied = await request(app).get('/api/session/session-1');
        expect(denied.status).toBe(403);

        const allowed = await request(app)
            .get('/api/session/session-1')
            .set('x-session-control-token', 'valid-token');

        expect(allowed.status).toBe(200);
        expect(allowed.body.session.id).toBe('session-1');
    });

    test('Socket join-session rejects invalid token', async () => {
        const server = await createSessionControlServer({ db: createDb() });
        const client = new Client(server.url, {
            transports: ['websocket'],
            forceNew: true
        });

        const result = await new Promise((resolve, reject) => {
            client.on('connect', () => {
                client.emit('join-session', { sessionId: 'session-1' });
            });
            client.on('session-join-error', resolve);
            client.on('session-joined', () => reject(new Error('unexpected join success')));
        });

        expect(result.error).toMatch(/session control token/i);

        client.close();
        await server.close();
    });
});
