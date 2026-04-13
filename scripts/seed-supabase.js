require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || 'public';
const PROJECTS_DIR = path.join(__dirname, '..', 'content', 'projects');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
}

async function main() {
    const projectDirs = await fs.readdir(PROJECTS_DIR);

    for (const projectDirName of projectDirs) {
        const projectDir = path.join(PROJECTS_DIR, projectDirName);
        const stat = await fs.stat(projectDir);
        if (!stat.isDirectory()) {
            continue;
        }

        const project = await readJson(path.join(projectDir, 'project.json'));
        const projectRow = await upsertProject(project);
        const knowledgeDocs = await readKnowledgeDocs(projectDir);

        for (const [docType, value] of Object.entries(knowledgeDocs)) {
            await upsertKnowledgeDoc(projectRow.id, docType, value);
        }

        const presentationsDir = path.join(projectDir, 'presentations');
        let presentationFiles = [];
        try {
            presentationFiles = (await fs.readdir(presentationsDir)).filter((file) => file.endsWith('.json'));
        } catch {
            presentationFiles = [];
        }

        for (const file of presentationFiles) {
            const presentation = await readJson(path.join(presentationsDir, file));
            const presentationRow = await upsertPresentation(projectRow.id, projectDir, presentation);
            await replaceSlides(presentationRow.id, presentation.slides || []);
        }

        const images = await readOptionalJson(path.join(projectDir, 'images.json'));
        for (const image of images || []) {
            await upsertImage(projectRow.id, image);
        }
    }

    console.log('Supabase seed complete.');
}

async function upsertProject(project) {
    const payload = {
        slug: project.slug,
        name: project.name,
        status: project.status || 'active',
        config_json: project.config_json || {}
    };

    const rows = await request('projects', 'POST', [payload], 'slug');
    return rows[0];
}

async function upsertKnowledgeDoc(projectId, docType, value) {
    const payload = {
        project_id: projectId,
        doc_type: docType,
        title: docType,
        content: typeof value === 'string' ? value : null,
        content_json: typeof value === 'string' ? {} : (value || {}),
        version: 1
    };

    await request('knowledge_docs', 'POST', [payload], 'project_id,doc_type');
}

async function upsertPresentation(projectId, projectDir, presentation) {
    const deckSchema = await readOptionalJson(path.join(projectDir, 'content_schema.json'));
    const flowText = await readOptionalText(path.join(projectDir, 'flow.md'));
    const designText = await readOptionalText(path.join(projectDir, 'design.md'));

    const payload = {
        project_id: projectId,
        slug: presentation.slug || presentation.id,
        title: presentation.title,
        status: presentation.status || 'published',
        deck_schema_json: deckSchema || {},
        flow_json: flowText ? { markdown: flowText } : {},
        design_json: designText ? { markdown: designText } : {}
    };

    const rows = await request('presentations', 'POST', [payload], 'slug');
    return rows[0];
}

async function replaceSlides(presentationId, slides) {
    await request(`slides?presentation_id=eq.${presentationId}`, 'DELETE');

    if (!slides.length) {
        return;
    }

    const payload = slides.map((slide, index) => ({
        presentation_id: presentationId,
        slide_index: index,
        layout_type: slide.layout || 'immersive',
        content_json: {
            title: slide.title || '',
            content: slide.content || '',
            image: slide.image || null,
            notes: slide.notes || ''
        },
        notes: slide.notes || ''
    }));

    await request('slides', 'POST', payload);
}

async function upsertImage(projectId, image) {
    const payload = {
        project_id: projectId,
        storage_path: image.path || image.url || '',
        title: image.title || image.id || 'Image',
        context: image.context || '',
        metadata_json: image
    };

    await request('images', 'POST', [payload], 'project_id,storage_path');
}
async function readKnowledgeDocs(projectDir) {
    const docs = {
        agents: await readOptionalText(path.join(projectDir, 'AGENTS.md')),
        product: await readOptionalText(path.join(projectDir, 'product.md')),
        flow: await readOptionalText(path.join(projectDir, 'flow.md')),
        design: await readOptionalText(path.join(projectDir, 'design.md')),
        soul: await readOptionalText(path.join(projectDir, 'soul.md')),
        cta: await readOptionalText(path.join(projectDir, 'cta', 'contact.md')),
        images: await readOptionalJson(path.join(projectDir, 'images.json'))
    };
    return docs;
}

async function request(target, method, body, onConflict) {
    const separator = target.includes('?') ? '&' : '?';
    const url = `${SUPABASE_URL}/rest/v1/${target}${onConflict ? `${separator}on_conflict=${encodeURIComponent(onConflict)}` : ''}`;
    const response = await fetch(url, {
        method,
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Prefer: method === 'POST'
                ? 'resolution=merge-duplicates,return=representation'
                : 'return=representation',
            'Accept-Profile': SUPABASE_SCHEMA,
            'Content-Profile': SUPABASE_SCHEMA
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase request failed for ${target}: ${response.status} ${text}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : [];
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
    try {
        return await readJson(filePath);
    } catch {
        return null;
    }
}

async function readOptionalText(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return '';
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
