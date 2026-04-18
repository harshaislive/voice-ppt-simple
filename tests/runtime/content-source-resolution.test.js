const request = require('supertest');
const {
    createCMSServiceHarness,
    createCMSRouterApp,
    createSessionRouterApp,
    postSessionStart
} = require('../helpers/createContentLoadingHarness');

describe('content source resolution', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('loader respects explicit source selection instead of silently swapping sources', async () => {
        const harness = createCMSServiceHarness({
            localPresentation: {
                id: 'alpha',
                title: 'Alpha Local',
                source: 'local',
                declaredSource: 'local',
                presentationSlug: 'alpha',
                projectSlug: 'beforest',
                slides: [{ title: 'Local Slide', content: 'Only local.' }]
            },
            remotePresentation: {
                id: 'alpha',
                title: 'Alpha Remote',
                source: 'supabase',
                declaredSource: 'supabase',
                presentationSlug: 'alpha',
                projectSlug: 'beforest',
                slides: [{ title: 'Remote Slide', content: 'Only remote.' }]
            },
            supabaseConfigured: true
        });

        const remote = await harness.loadPresentation('alpha', { expectedSource: 'supabase' });
        const local = await harness.loadPresentation('alpha', { expectedSource: 'local' });

        expect(remote.source).toBe('supabase');
        expect(remote.title).toBe('Alpha Remote');
        expect(local.source).toBe('local');
        expect(local.title).toBe('Alpha Local');
    });

    test('session start fails closed when requested source cannot satisfy the request', async () => {
        const cmsServiceMock = createCMSServiceHarness({
            localPresentation: {
                id: 'alpha',
                title: 'Alpha Local',
                source: 'local',
                declaredSource: 'local',
                presentationSlug: 'alpha',
                projectSlug: 'beforest',
                slides: [{ title: 'Local Slide', content: 'Only local.' }]
            },
            remotePresentation: null,
            supabaseConfigured: false
        });
        const { app } = createSessionRouterApp({ cmsServiceMock });

        const response = await postSessionStart(app, {
            deckId: 'alpha',
            presentationSource: 'supabase',
            participantName: 'Alex'
        });

        expect(response.status).toBe(503);
        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('PRESENTATION_SOURCE_UNAVAILABLE');
        expect(response.body.presentationSlug).toBe('alpha');
    });

    test('cms list and read surfaces include source metadata and explicit mismatch details', async () => {
        const cmsServiceMock = createCMSServiceHarness({
            localPresentation: {
                id: 'alpha',
                title: 'Alpha Local',
                source: 'local',
                declaredSource: 'local',
                presentationSlug: 'alpha',
                projectSlug: 'beforest',
                slides: [{ title: 'Local Slide', content: 'Only local.' }]
            },
            remotePresentation: {
                id: 'alpha',
                title: 'Alpha Remote',
                source: 'supabase',
                declaredSource: 'supabase',
                presentationSlug: 'alpha',
                projectSlug: 'beforest',
                slides: [{ title: 'Remote Slide', content: 'Only remote.' }]
            },
            supabaseConfigured: true
        });
        const { app } = createCMSRouterApp({ cmsServiceMock });

        const listResponse = await request(app).get('/api/cms/presentations');
        expect(listResponse.status).toBe(200);
        expect(listResponse.body.presentations[0]).toMatchObject({
            presentationSlug: 'alpha'
        });
        expect(listResponse.body.presentations[0].availableSources).toEqual(expect.arrayContaining(['local', 'supabase']));

        const readResponse = await request(app)
            .get('/api/cms/presentations/alpha')
            .query({ source: 'local' });
        expect(readResponse.status).toBe(200);
        expect(readResponse.body.presentation).toMatchObject({
            source: 'local',
            declaredSource: 'local',
            presentationSlug: 'alpha'
        });
    });
});
