const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createFilesystemCMSHarness } = require('../helpers/createContentLoadingHarness');

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('content project package', () => {
    let tempRoot;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-ppt-content-'));
    });

    afterEach(async () => {
        if (tempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
        jest.clearAllMocks();
    });

    test('well-formed project packages appear in the catalog with project and presentation metadata', async () => {
        const projectsDir = path.join(tempRoot, 'projects');
        await writeJson(path.join(projectsDir, 'beforest', 'project.json'), {
            slug: 'beforest',
            name: 'Beforest',
            config_json: {
                defaultPresentation: 'alpha',
                presentationSource: 'local'
            }
        });
        await writeJson(path.join(projectsDir, 'beforest', 'presentations', 'alpha.json'), {
            id: 'alpha',
            slug: 'alpha',
            title: 'Alpha',
            source: 'local',
            slides: [{ title: 'Intro', content: 'Hello.' }]
        });
        await fs.writeFile(path.join(projectsDir, 'beforest', 'product.md'), 'Product context', 'utf8');

        const cms = createFilesystemCMSHarness({
            projectsDir,
            baseDir: path.join(tempRoot, 'decks'),
            supabaseConfigured: false
        });

        const catalog = await cms.listLocalPresentations();
        const loaded = await cms.loadPresentation('alpha', { expectedSource: 'local' });

        expect(catalog).toEqual(expect.arrayContaining([
            expect.objectContaining({
                projectSlug: 'beforest',
                presentationSlug: 'alpha',
                declaredSource: 'local'
            })
        ]));
        expect(loaded).toMatchObject({
            projectSlug: 'beforest',
            presentationSlug: 'alpha'
        });
        expect(loaded.knowledgeDocs.product).toContain('Product context');
    });

    test('malformed packages do not poison the rest of the catalog scan', async () => {
        const projectsDir = path.join(tempRoot, 'projects');
        await writeJson(path.join(projectsDir, 'good', 'project.json'), {
            slug: 'good',
            name: 'Good Project',
            config_json: {
                defaultPresentation: 'good-alpha',
                presentationSource: 'local'
            }
        });
        await writeJson(path.join(projectsDir, 'good', 'presentations', 'good-alpha.json'), {
            id: 'good-alpha',
            slug: 'good-alpha',
            title: 'Good Alpha',
            slides: [{ title: 'Intro', content: 'Hello.' }]
        });

        await fs.mkdir(path.join(projectsDir, 'broken', 'presentations'), { recursive: true });
        await fs.writeFile(path.join(projectsDir, 'broken', 'project.json'), '{bad json', 'utf8');
        await writeJson(path.join(projectsDir, 'broken', 'presentations', 'broken-alpha.json'), {
            id: 'broken-alpha',
            slug: 'broken-alpha',
            title: 'Broken Alpha',
            slides: []
        });

        const cms = createFilesystemCMSHarness({
            projectsDir,
            baseDir: path.join(tempRoot, 'decks'),
            supabaseConfigured: false
        });

        const warnSpy = jest.spyOn(cms.logger, 'warn');
        const catalog = await cms.listProjectPresentations();

        expect(catalog).toHaveLength(1);
        expect(catalog[0]).toMatchObject({
            projectSlug: 'good',
            presentationSlug: 'good-alpha'
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({
            event: 'content_project_package_invalid',
            projectSlug: 'broken'
        }));
    });
});
