const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');

describe('CMS auth guards', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.ADMIN_API_KEY = 'test-admin-key';
    });

    afterEach(() => {
        delete process.env.ADMIN_API_KEY;
        jest.clearAllMocks();
    });

    function loadRouter() {
        jest.doMock('../../server/services/cms', () => ({
            isSupabaseConfigured: () => false,
            listPresentations: jest.fn().mockResolvedValue([{ id: 'deck-1', title: 'Deck 1' }]),
            createPresentation: jest.fn().mockResolvedValue({ id: 'deck-2', title: 'Deck 2' }),
            loadPresentation: jest.fn().mockResolvedValue({ id: 'deck-1', title: 'Deck 1' }),
            updatePresentation: jest.fn().mockResolvedValue({ id: 'deck-1', title: 'Deck 1' }),
            deletePresentation: jest.fn().mockResolvedValue(true),
            updateSlide: jest.fn().mockResolvedValue([]),
            deleteSlide: jest.fn().mockResolvedValue([]),
            loadProject: jest.fn().mockResolvedValue({ slug: 'project-1' }),
            getCtaBlocks: jest.fn().mockResolvedValue([]),
            getLoadingQuotes: jest.fn().mockResolvedValue([]),
            saveKnowledgeDoc: jest.fn().mockResolvedValue({ success: true }),
            deleteKnowledgeDoc: jest.fn().mockResolvedValue(true),
            deleteKnowledgeDocById: jest.fn().mockResolvedValue(true)
        }));
        jest.doMock('../../server/services/tts', () => ({
            synthesize: jest.fn().mockResolvedValue(Buffer.from('audio'))
        }));

        return require('../../server/routes/cms');
    }

    test('POST /api/cms/presentations requires admin auth', async () => {
        const router = loadRouter();
        const app = createTestApp({ routeBase: '/api/cms', router });

        const response = await request(app)
            .post('/api/cms/presentations')
            .send({ title: 'Deck 2', slides: [] });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/admin api key/i);
    });

    test('POST /api/cms/preview-narration requires admin auth', async () => {
        const router = loadRouter();
        const app = createTestApp({ routeBase: '/api/cms', router });

        const response = await request(app)
            .post('/api/cms/preview-narration')
            .send({ text: 'Preview me' });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/admin api key/i);
    });

    test('GET /api/cms/presentations remains public', async () => {
        const router = loadRouter();
        const app = createTestApp({ routeBase: '/api/cms', router });

        const response = await request(app).get('/api/cms/presentations');

        expect(response.status).toBe(200);
        expect(response.body.presentations).toHaveLength(1);
    });
});
