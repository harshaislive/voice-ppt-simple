const request = require('supertest');
const { Writable } = require('stream');
const { createLogger, setLogger } = require('../../server/middleware/logger');
const { createLoggerTestApp } = require('../helpers/createLoggerTestApp');
const { createTestApp } = require('../helpers/createTestApp');

function createCaptureLogger() {
    const lines = [];
    const stream = new Writable({
        write(chunk, enc, callback) {
            const line = chunk.toString().trim();
            if (line) {
                lines.push(JSON.parse(line));
            }
            callback();
        }
    });

    return {
        lines,
        logger: createLogger({ level: 'info', stream })
    };
}

describe('session diagnostics', () => {
    afterEach(() => {
        setLogger(createLogger());
        jest.clearAllMocks();
    });

    test('base logger emits structured JSON with child bindings and redaction', async () => {
        const { lines, logger } = createCaptureLogger();
        setLogger(logger);

        const app = createLoggerTestApp();
        app.set('logger', logger);

        const response = await request(app).post('/logs/base').send({});
        expect(response.status).toBe(200);

        const entry = lines.find((line) => line.event === 'test_log');
        expect(entry.sessionId).toBe('session-123');
        expect(entry.subsystem).toBe('diagnostics');
        expect(entry.participantName).toBe('[Redacted]');
        expect(entry.prompt).toBe('[Redacted]');
        expect(entry.authorization).toBe('[Redacted]');
    });

    test('auth denial logs are structured and do not expose raw admin keys', async () => {
        process.env.ADMIN_API_KEY = 'real-admin-key';
        const { lines, logger } = createCaptureLogger();
        setLogger(logger);

        const app = createLoggerTestApp();
        app.set('logger', logger);

        const response = await request(app)
            .post('/logs/admin')
            .set('x-admin-api-key', 'wrong-key')
            .send({});

        expect(response.status).toBe(403);
        const denial = lines.find((line) => line.event === 'auth_admin_denied');
        expect(denial.subsystem).toBe('security');
        expect(JSON.stringify(denial)).not.toContain('wrong-key');
        delete process.env.ADMIN_API_KEY;
    });

    test('session lifecycle logs include start, source load, qa failure, and session end', async () => {
        jest.resetModules();
        process.env.ADMIN_API_KEY = 'real-admin-key';

        const { lines, logger } = createCaptureLogger();
        setLogger(logger);

        jest.doMock('../../server/services/cms', () => ({
            loadPresentation: jest.fn().mockResolvedValue({
                title: 'Deck 1',
                presentationSlug: 'deck-1',
                projectSlug: 'project-1',
                source: 'supabase',
                slides: [{ title: 'Intro', content: 'Hello', notes: 'Start here' }]
            })
        }));
        jest.doMock('../../server/services/analytics', () => ({
            logSessionStart: jest.fn(),
            logSessionEnd: jest.fn(),
            logEvent: jest.fn()
        }));
        jest.doMock('../../server/services/supabaseSession', () => ({
            isConfigured: () => false
        }));
        jest.doMock('../../server/services/tts', () => ({
            synthesizeDetailed: jest.fn()
        }));
        jest.doMock('../../server/services/model', () => ({
            generateNarrationStream: jest.fn().mockRejectedValue(new Error('boom'))
        }));
        jest.doMock('../../server/routes/autoplex', () => ({
            triggerPreGeneration: jest.fn()
        }));

        const sessionRouter = require('../../server/routes/session');
        const questionsRouter = require('../../server/routes/questions');

        const sessionState = {
            session: null,
            slides: [],
            questions: []
        };

        const db = {
            get(query, params) {
                if (query.includes('SELECT control_token_hash FROM sessions')) {
                    return sessionState.session ? { control_token_hash: sessionState.session.control_token_hash } : null;
                }
                if (query.includes('FROM sessions s')) {
                    return sessionState.session
                        ? { ...sessionState.session, pending_questions: 0, slide_count: sessionState.slides.length }
                        : null;
                }
                if (query.includes('SELECT id FROM sessions WHERE id = ?')) {
                    return sessionState.session ? { id: sessionState.session.id } : null;
                }
                if (query.includes('SELECT COUNT(*) as count FROM slides')) {
                    return { count: sessionState.slides.length };
                }
                if (query.includes('SELECT COUNT(*) as count FROM questions')) {
                    return { count: sessionState.questions.filter((q) => q.status === 'pending').length };
                }
                if (query.includes('FROM sessions')) {
                    return sessionState.session;
                }
                return null;
            },
            all(query) {
                if (query.includes('FROM slides')) {
                    return sessionState.slides;
                }
                if (query.includes('FROM questions')) {
                    return sessionState.questions;
                }
                return [];
            },
            run(query, params) {
                if (query.includes('INSERT INTO sessions')) {
                    sessionState.session = {
                        id: params[0],
                        deck_id: params[1],
                        control_token_hash: params[2],
                        current_slide_index: 0,
                        status: 'active',
                        metadata: params[5]
                    };
                    return;
                }
                if (query.includes('INSERT INTO slides')) {
                    sessionState.slides.push({
                        id: params[0],
                        session_id: params[1],
                        deck_id: params[2],
                        slide_index: params[3],
                        title: params[4],
                        content: params[5],
                        image: params[6],
                        notes: params[7]
                    });
                    return;
                }
                if (query.includes('UPDATE sessions')) {
                    sessionState.session = {
                        ...sessionState.session,
                        current_slide_index: params[0] ?? sessionState.session.current_slide_index,
                        status: params[1] || sessionState.session.status
                    };
                    return;
                }
                if (query.includes('INSERT INTO questions')) {
                    sessionState.questions.push({
                        id: params[0],
                        session_id: params[1],
                        question_text: params[2],
                        submitted_by: params[3],
                        slide_index: params[4],
                        created_at: params[5],
                        status: 'pending',
                        priority: 0
                    });
                }
            }
        };

        const io = { to: () => ({ emit: () => {} }) };
        const sessionApp = createTestApp({ routeBase: '/api/session', router: sessionRouter, db, io, logger });
        const qaApp = createTestApp({ routeBase: '/api/questions', router: questionsRouter, db, io, logger });

        const startResponse = await request(sessionApp)
            .post('/api/session/start')
            .send({ deckId: 'deck-1', participantName: 'Taylor' });
        expect(startResponse.status).toBe(200);

        const controlToken = startResponse.body.controlToken;

        const loadResponse = await request(sessionApp)
            .get(`/api/session/${startResponse.body.sessionId}`)
            .set('x-session-control-token', controlToken);
        expect(loadResponse.status).toBe(200);

        const qaResponse = await request(qaApp)
            .post('/api/questions')
            .send({
                sessionId: startResponse.body.sessionId,
                questionText: 'Will this scale?',
                submittedBy: 'Taylor'
            });
        expect(qaResponse.status).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 25));

        const patchResponse = await request(sessionApp)
            .patch(`/api/session/${startResponse.body.sessionId}`)
            .set('x-session-control-token', controlToken)
            .send({ status: 'completed' });
        expect(patchResponse.status).toBe(200);

        expect(lines.some((line) => line.event === 'session_start')).toBe(true);
        expect(lines.some((line) => line.event === 'source_session_loaded')).toBe(true);
        expect(lines.some((line) => line.event === 'qa_generation_failed')).toBe(true);
        expect(lines.some((line) => line.event === 'session_end')).toBe(true);

        const qaFailure = lines.find((line) => line.event === 'qa_generation_failed');
        expect(qaFailure.subsystem).toBe('qa');
        expect(qaFailure.sessionId).toBe(startResponse.body.sessionId);

        delete process.env.ADMIN_API_KEY;
    });
});
