const {
    createCMSServiceHarness,
    createSessionRouterApp,
    postSessionStart
} = require('../helpers/createContentLoadingHarness');
const { importVoicePPTAppModule } = require('../helpers/createAutoplexControlHarness');

function createLoggerStub() {
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(() => logger)
    };
    return logger;
}

describe('content fail-closed diagnostics', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('client selection helper does not substitute another presentation for a missing requested slug', async () => {
        const { selectPresentationFromCatalog } = await importVoicePPTAppModule();
        const catalog = [
            { id: 'alpha', presentationSlug: 'alpha', source: 'local' },
            { id: 'beta', presentationSlug: 'beta', source: 'supabase' }
        ];

        expect(selectPresentationFromCatalog(catalog, 'missing')).toBeNull();
    });

    test('session start exposes explicit fail-closed diagnostics for wrong-source requests', async () => {
        const logger = createLoggerStub();
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
        const { app } = createSessionRouterApp({ cmsServiceMock, logger });

        const response = await postSessionStart(app, {
            deckId: 'alpha',
            presentationSlug: 'alpha',
            presentationSource: 'supabase',
            participantName: 'Alex'
        });

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
            success: false,
            code: 'PRESENTATION_SOURCE_UNAVAILABLE',
            presentationSlug: 'alpha',
            requestedSource: 'supabase'
        });
        expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
            event: 'source_presentation_missing',
            presentationSlug: 'alpha',
            requestedSource: 'supabase',
            code: 'PRESENTATION_SOURCE_UNAVAILABLE'
        }));
    });
});
