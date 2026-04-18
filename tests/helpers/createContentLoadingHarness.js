const request = require('supertest');
const { createTestApp } = require('./createTestApp');

function summarizePresentation(presentation = {}, source) {
    const resolvedSource = source || presentation.source || 'local';
    return {
        id: presentation.presentationSlug || presentation.id,
        title: presentation.title || presentation.presentationSlug || presentation.id,
        source: resolvedSource,
        declaredSource: presentation.declaredSource || resolvedSource,
        resolvedSource,
        availableSources: [resolvedSource],
        projectSlug: presentation.projectSlug || null,
        presentationSlug: presentation.presentationSlug || presentation.id
    };
}

function clonePresentation(presentation) {
    return presentation ? JSON.parse(JSON.stringify(presentation)) : null;
}

function createCMSServiceHarness({
    localPresentation = null,
    remotePresentation = null,
    supabaseConfigured = true
} = {}) {
    const cmsService = require('../../server/services/cms');
    const harness = Object.create(cmsService);
    harness._presentationCache = new Map();
    harness.isSupabaseConfigured = jest.fn(() => supabaseConfigured);
    harness.loadPresentationFromLocal = jest.fn(async (identifier) => {
        if (!localPresentation) return null;
        if ([localPresentation.id, localPresentation.presentationSlug].includes(identifier)) {
            return clonePresentation(localPresentation);
        }
        return null;
    });
    harness.loadPresentationFromSupabase = jest.fn(async (identifier) => {
        if (!remotePresentation) return null;
        if ([remotePresentation.id, remotePresentation.presentationSlug].includes(identifier)) {
            return clonePresentation(remotePresentation);
        }
        return null;
    });
    harness.listLocalPresentations = jest.fn(async () => (
        localPresentation ? [summarizePresentation(localPresentation, 'local')] : []
    ));
    harness.listSupabasePresentations = jest.fn(async () => (
        remotePresentation ? [summarizePresentation(remotePresentation, 'supabase')] : []
    ));
    return harness;
}

function createFilesystemCMSHarness({
    projectsDir,
    baseDir,
    supabaseConfigured = false
} = {}) {
    const cmsService = require('../../server/services/cms');
    const harness = Object.create(cmsService);
    harness._presentationCache = new Map();
    if (projectsDir) harness.projectsDir = projectsDir;
    if (baseDir) harness.baseDir = baseDir;
    harness.isSupabaseConfigured = jest.fn(() => supabaseConfigured);
    return harness;
}

function createDbStub() {
    const runs = [];
    return {
        runs,
        run: jest.fn((sql, params = []) => {
            runs.push({ sql, params });
            return {};
        }),
        get: jest.fn(() => ({ count: 0 })),
        all: jest.fn(() => [])
    };
}

function createSessionRouterApp({ cmsServiceMock, logger = null } = {}) {
    jest.resetModules();
    jest.doMock('../../server/services/cms', () => cmsServiceMock);
    jest.doMock('../../server/services/analytics', () => ({
        logSessionStart: jest.fn()
    }));
    jest.doMock('../../server/services/supabaseSession', () => ({
        isConfigured: jest.fn(() => false),
        createSession: jest.fn(),
        createSlides: jest.fn()
    }));
    jest.doMock('../../server/routes/autoplex', () => ({
        triggerPreGeneration: jest.fn(),
        getPreGenProgress: jest.fn(() => new Map())
    }));

    const router = require('../../server/routes/session');
    const db = createDbStub();
    const app = createTestApp({ routeBase: '/api/session', router, db, logger });
    return { app, db };
}

function createCMSRouterApp({ cmsServiceMock }) {
    jest.resetModules();
    jest.doMock('../../server/services/cms', () => cmsServiceMock);
    jest.doMock('../../server/services/tts', () => ({
        synthesize: jest.fn().mockResolvedValue(Buffer.from('audio'))
    }));
    const router = require('../../server/routes/cms');
    const app = createTestApp({ routeBase: '/api/cms', router });
    return { app };
}

async function postSessionStart(app, payload) {
    return request(app)
        .post('/api/session/start')
        .send(payload);
}

module.exports = {
    createCMSServiceHarness,
    createFilesystemCMSHarness,
    createCMSRouterApp,
    createDbStub,
    createSessionRouterApp,
    postSessionStart
};
