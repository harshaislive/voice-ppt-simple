const {
    createCMSServiceHarness,
    createSessionRouterApp,
    postSessionStart
} = require('../helpers/createContentLoadingHarness');
const { importVoicePPTAppModule } = require('../helpers/createAutoplexControlHarness');

describe('content identity', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('session startup persists canonical presentationSlug alongside compatibility deckId fields', async () => {
        const cmsServiceMock = createCMSServiceHarness({
            localPresentation: {
                id: 'alpha',
                title: 'Alpha Local',
                source: 'local',
                declaredSource: 'local',
                presentationSlug: 'alpha',
                projectSlug: 'beforest',
                slides: [{ title: 'Intro', content: 'Hello.' }]
            },
            supabaseConfigured: false
        });
        const { app, db } = createSessionRouterApp({ cmsServiceMock });

        const response = await postSessionStart(app, {
            deckId: 'alpha',
            presentationSlug: 'alpha',
            presentationSource: 'local',
            participantName: 'Alex'
        });

        expect(response.status).toBe(200);
        expect(response.body.presentationSlug).toBe('alpha');
        expect(response.body.deckId).toBe('alpha');

        const sessionInsert = db.runs.find((entry) => entry.sql.includes('INSERT INTO sessions'));
        const metadata = JSON.parse(sessionInsert.params[5]);
        expect(metadata.presentationSlug).toBe('alpha');
        expect(metadata.deckId).toBe('alpha');
        expect(metadata.projectSlug).toBe('beforest');
    });

    test('client catalog selection is canonical and does not substitute another presentation for a missing slug', async () => {
        const { selectPresentationFromCatalog } = await importVoicePPTAppModule();
        const catalog = [
            { id: 'alpha', presentationSlug: 'alpha', source: 'local' },
            { id: 'beta', presentationSlug: 'beta', source: 'supabase' }
        ];

        expect(selectPresentationFromCatalog(catalog, 'beta')).toMatchObject({
            presentationSlug: 'beta',
            source: 'supabase'
        });
        expect(selectPresentationFromCatalog(catalog, 'missing')).toBeNull();
    });

    test('question context reload prefers presentationSlug and not projectSlug as presentation identity', async () => {
        jest.resetModules();
        const loadPresentation = jest.fn().mockResolvedValue({
            id: 'alpha',
            presentationSlug: 'alpha',
            projectSlug: 'beforest',
            source: 'local',
            slides: [{ title: 'Intro', content: 'Hello.' }],
            knowledgeDocs: {}
        });
        jest.doMock('../../server/services/cms', () => ({
            loadPresentation
        }));

        const questionsRoute = require('../../server/routes/questions');
        const db = {
            get: jest.fn(() => ({
                id: 'session-1',
                deck_id: 'legacy-alpha',
                current_slide_index: 0,
                metadata: JSON.stringify({
                    presentationSlug: 'alpha',
                    projectSlug: 'beforest'
                })
            })),
            all: jest.fn(() => [])
        };

        await questionsRoute.loadQuestionAnswerContext(db, 'session-1');

        expect(loadPresentation).toHaveBeenCalledWith('alpha', expect.objectContaining({
            expectedSource: null
        }));
        expect(loadPresentation).not.toHaveBeenCalledWith('beforest', expect.anything());
    });
});
