const fs = require('fs').promises;
const path = require('path');

class CMSService {
    constructor() {
        this.baseDir = path.join(__dirname, '..', 'decks');
        this.projectsDir = path.join(__dirname, '..', '..', 'content', 'projects');
        this.supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
        this.supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        this.supabaseSchema = process.env.SUPABASE_SCHEMA || 'public';
    }

    isSupabaseConfigured() {
        const configured = Boolean(this.supabaseUrl && this.supabaseServiceRoleKey);
        if (!configured) {
            console.warn(`[CMS] isSupabaseConfigured: false — supabaseUrl=${!!this.supabaseUrl}, serviceRoleKey=${!!this.supabaseServiceRoleKey}`);
        }
        return configured;
    }

    async listPresentations() {
        const local = await this.listLocalPresentations();
        if (!this.isSupabaseConfigured()) {
            console.warn('[CMS] listPresentations: Supabase not configured, using local only');
            return local;
        }

        try {
            const remote = await this.listSupabasePresentations();
            const merged = new Map();
            [...local, ...remote].forEach((item) => {
                merged.set(item.id, item);
            });
            console.log(`[CMS] listPresentations: ${remote.length} remote + ${local.length} local = ${merged.size} total`);
            return Array.from(merged.values());
        } catch (error) {
            console.error('CMS listPresentations failed, using local fallback:', error.message);
            return local;
        }
    }

    async loadPresentation(identifier) {
        if (this.isSupabaseConfigured()) {
            try {
                const remote = await this.loadPresentationFromSupabase(identifier);
                if (remote) {
                    console.log(`[CMS] loadPresentation: using Supabase for '${identifier}'`);
                    return remote;
                }
            } catch (error) {
                console.error('CMS remote presentation load failed, using local fallback:', error.message);
            }
        } else {
            console.warn('[CMS] loadPresentation: Supabase not configured, using local');
        }

        return this.loadPresentationFromLocal(identifier);
    }

    async loadProject(projectSlug) {
        if (this.isSupabaseConfigured()) {
            try {
                const remote = await this.loadProjectFromSupabase(projectSlug);
                if (remote) {
                    return remote;
                }
            } catch (error) {
                console.error('CMS remote project load failed, using local fallback:', error.message);
            }
        }

        return this.loadProjectFromLocal(projectSlug);
    }

    async listLocalPresentations() {
        const projectPresentations = await this.listProjectPresentations();
        if (projectPresentations.length > 0) {
            return projectPresentations;
        }

        const files = await fs.readdir(this.baseDir);
        const jsonFiles = files.filter((file) => file.endsWith('.json'));
        const decks = [];

        for (const file of jsonFiles) {
            const deckPath = path.join(this.baseDir, file);
            const raw = await fs.readFile(deckPath, 'utf8');
            const parsed = JSON.parse(raw);
            decks.push({
                id: parsed.id || path.basename(file, '.json'),
                title: parsed.title || parsed.name || this.humanize(path.basename(file, '.json')),
                source: 'local',
                projectSlug: parsed.projectSlug || null,
                presentationSlug: parsed.id || path.basename(file, '.json')
            });
        }

        return decks;
    }

    async loadPresentationFromLocal(identifier) {
        const projectPresentation = await this.loadPresentationFromProjectFiles(identifier);
        if (projectPresentation) {
            return projectPresentation;
        }

        const directPath = path.join(this.baseDir, `${identifier}.json`);
        const raw = await fs.readFile(directPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            id: parsed.id || identifier,
            title: parsed.title || parsed.name || this.humanize(identifier),
            source: 'local',
            projectSlug: parsed.projectSlug || null,
            presentationSlug: parsed.id || identifier,
            slides: Array.isArray(parsed.slides) ? parsed.slides : [],
            knowledgeDocs: parsed.knowledgeDocs || {},
            deckSchema: parsed.deckSchema || null,
            flowConfig: parsed.flowConfig || null,
            designConfig: parsed.designConfig || null
        };
    }

    async listProjectPresentations() {
        try {
            const projectDirs = await fs.readdir(this.projectsDir);
            const presentations = [];

            for (const projectDirName of projectDirs) {
                const projectDir = path.join(this.projectsDir, projectDirName);
                const stat = await fs.stat(projectDir);
                if (!stat.isDirectory()) {
                    continue;
                }

                const projectConfig = await this.readJson(path.join(projectDir, 'project.json'));
                const presentationsDir = path.join(projectDir, 'presentations');
                let files = [];
                try {
                    files = (await fs.readdir(presentationsDir)).filter((file) => file.endsWith('.json'));
                } catch {
                    files = [];
                }

                for (const file of files) {
                    const presentation = await this.readJson(path.join(presentationsDir, file));
                    presentations.push({
                        id: presentation.slug || presentation.id || path.basename(file, '.json'),
                        title: presentation.title || this.humanize(path.basename(file, '.json')),
                        source: 'local',
                        projectSlug: projectConfig.slug || projectDirName,
                        presentationSlug: presentation.slug || presentation.id || path.basename(file, '.json')
                    });
                }
            }

            return presentations;
        } catch {
            return [];
        }
    }

    async loadProjectFromLocal(projectSlug) {
        const projectDir = path.join(this.projectsDir, projectSlug);
        const projectConfig = await this.readJson(path.join(projectDir, 'project.json'));
        const knowledgeDocs = await this.readProjectDocs(projectDir);
        const presentations = await this.listProjectPresentations();

        return {
            slug: projectConfig.slug || projectSlug,
            name: projectConfig.name || this.humanize(projectSlug),
            source: 'local',
            config: projectConfig.config_json || {},
            knowledgeDocs,
            presentations: presentations.filter((presentation) => presentation.projectSlug === (projectConfig.slug || projectSlug))
        };
    }

    async loadPresentationFromProjectFiles(identifier) {
        try {
            const projectDirs = await fs.readdir(this.projectsDir);

            for (const projectDirName of projectDirs) {
                const projectDir = path.join(this.projectsDir, projectDirName);
                const stat = await fs.stat(projectDir);
                if (!stat.isDirectory()) {
                    continue;
                }

                const projectConfig = await this.readJson(path.join(projectDir, 'project.json'));
                const presentationsDir = path.join(projectDir, 'presentations');
                let files = [];
                try {
                    files = (await fs.readdir(presentationsDir)).filter((file) => file.endsWith('.json'));
                } catch {
                    files = [];
                }

                for (const file of files) {
                    const filePath = path.join(presentationsDir, file);
                    const presentation = await this.readJson(filePath);
                    const slug = presentation.slug || presentation.id || path.basename(file, '.json');
                    if (slug !== identifier && presentation.id !== identifier) {
                        continue;
                    }

                    const knowledgeDocs = await this.readProjectDocs(projectDir);
                    return {
                        id: slug,
                        title: presentation.title || this.humanize(slug),
                        source: 'local',
                        projectSlug: projectConfig.slug || projectDirName,
                        presentationSlug: slug,
                        startTitle: presentation.startTitle || null,
                        startSubtitle: presentation.startSubtitle || null,
                        slides: Array.isArray(presentation.slides) ? presentation.slides : [],
                        knowledgeDocs,
                        deckSchema: await this.readOptionalJson(path.join(projectDir, 'content_schema.json')),
                        flowConfig: await this.readOptionalText(path.join(projectDir, 'flow.md')),
                        designConfig: await this.readOptionalText(path.join(projectDir, 'design.md')),
                        projectConfig
                    };
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    _optimizeImageUrl(url) {
        if (!url) return null;
        if (url.includes('unsplash.com')) {
            const base = url.split('?')[0];
            return `${base}?auto=format&fit=crop&w=1200&q=75`;
        }
        return url;
    }

    async listSupabasePresentations() {
        console.log('[CMS] listSupabasePresentations: starting');
        const rows = await this.request('presentations', {
            select: 'id,slug,title,project_id,status,design_json',
            status: 'eq.published',
            order: 'title.asc'
        });
        console.log(`[CMS] listSupabasePresentations: found ${rows.length} presentations`);

        const results = await Promise.all(rows.map(async (row) => {
            const slides = await this.request('slides', {
                select: 'content_json',
                presentation_id: `eq.${row.id}`,
                order: 'slide_index.asc'
            });
            const allImages = slides
                .map(s => s.content_json?.image)
                .filter(img => img && img.startsWith('http'));
            
            let startImage = null;
            if (allImages.length > 0) {
                const pick = allImages[Math.floor(Math.random() * allImages.length)];
                startImage = this._optimizeImageUrl(pick);
            }
            return {
                id: row.slug || row.id,
                title: row.title || this.humanize(row.slug || row.id),
                source: 'supabase',
                projectSlug: row.project_id || null,
                presentationSlug: row.slug || row.id,
                startTitle: row.design_json?.startTitle || null,
                startSubtitle: row.design_json?.startSubtitle || null,
                startImage
            };
        }));

        return results;
    }

    async loadPresentationFromSupabase(identifier) {
        console.log(`[CMS] loadPresentationFromSupabase: looking for '${identifier}'`);
        const presentations = await this.request('presentations', {
            select: 'id,project_id,slug,title,deck_schema_json,flow_json,design_json,status',
            slug: `eq.${this.escapeFilter(identifier)}`
        });

        const presentation = presentations[0];
        if (!presentation) {
            console.warn(`[CMS] loadPresentationFromSupabase: '${identifier}' not found in Supabase`);
            return null;
        }
        console.log(`[CMS] loadPresentationFromSupabase: found '${presentation.title}' with id=${presentation.id}`);

        const [slides, docs] = await Promise.all([
            this.request('slides', {
                select: 'id,slide_index,layout_type,content_json,notes',
                presentation_id: `eq.${presentation.id}`,
                order: 'slide_index.asc'
            }),
            this.request('knowledge_docs', {
                select: 'doc_type,title,content,content_json',
                project_id: `eq.${presentation.project_id}`
            })
        ]);

        return {
            id: presentation.slug || presentation.id,
            title: presentation.title || this.humanize(presentation.slug || presentation.id),
            source: 'supabase',
            projectSlug: presentation.project_id,
            presentationSlug: presentation.slug || presentation.id,
            slides: slides.map((slide) => this.normalizeSlide(slide)),
            knowledgeDocs: this.normalizeKnowledgeDocs(docs),
            deckSchema: presentation.deck_schema_json || null,
            flowConfig: presentation.flow_json || null,
            designConfig: presentation.design_json || null,
            startTitle: presentation.design_json?.startTitle || null,
            startSubtitle: presentation.design_json?.startSubtitle || null
        };
    }

    async loadProjectFromSupabase(projectSlug) {
        const projects = await this.request('projects', {
            select: 'id,slug,name,config_json,status',
            slug: `eq.${projectSlug}`,
            limit: '1'
        });

        const project = projects[0];
        if (!project) {
            return null;
        }

        const [docs, presentations] = await Promise.all([
            this.request('knowledge_docs', {
                select: 'doc_type,title,content,content_json',
                project_id: `eq.${project.id}`
            }),
            this.request('presentations', {
                select: 'id,slug,title,status',
                project_id: `eq.${project.id}`,
                order: 'title.asc'
            })
        ]);

        return {
            slug: project.slug,
            name: project.name,
            source: 'supabase',
            config: project.config_json || {},
            knowledgeDocs: this.normalizeKnowledgeDocs(docs),
            presentations: presentations.map((presentation) => ({
                id: presentation.slug || presentation.id,
                title: presentation.title || this.humanize(presentation.slug || presentation.id),
                source: 'supabase',
                projectSlug: project.slug,
                presentationSlug: presentation.slug || presentation.id
            }))
        };
    }

    normalizeSlide(slide) {
        const content = slide.content_json || {};
        const rawImage = content.image || content.image_url || null;
        return {
            title: content.title || slide.title || '',
            content: content.content || content.subtitle || '',
            image: this._optimizeImageUrl(rawImage),
            notes: slide.notes || content.notes || '',
            layout: slide.layout_type || content.layout || 'immersive',
            customPrompt: content.customPrompt || slide.customPrompt || null
        };
    }

    normalizeKnowledgeDocs(rows) {
        return rows.reduce((acc, row) => {
            acc[row.doc_type] = row.content_json || row.content || '';
            return acc;
        }, {});
    }

    async readProjectDocs(projectDir) {
        const agents = await this.readOptionalText(path.join(projectDir, 'AGENTS.md'));
        const product = await this.readOptionalText(path.join(projectDir, 'product.md'));
        const flow = await this.readOptionalText(path.join(projectDir, 'flow.md'));
        const design = await this.readOptionalText(path.join(projectDir, 'design.md'));
        const contact = await this.readOptionalText(path.join(projectDir, 'cta', 'contact.md'));
        const soul = await this.readOptionalText(path.join(projectDir, 'soul.md'));
        const images = await this.readOptionalJson(path.join(projectDir, 'images.json'));

        return {
            agents,
            product,
            flow,
            design,
            soul,
            cta: contact,
            images: images || []
        };
    }

    async readJson(filePath) {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }

    async readOptionalJson(filePath) {
        try {
            return await this.readJson(filePath);
        } catch {
            return null;
        }
    }

    async readOptionalText(filePath) {
        try {
            return await fs.readFile(filePath, 'utf8');
        } catch {
            return '';
        }
    }

    async request(table, params = {}, options = {}) {
        const query = new URLSearchParams(params);
        const url = `${this.supabaseUrl}/rest/v1/${table}?${query.toString()}`;
        
        const method = options.method || 'GET';
        const headers = {
            apikey: this.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Prefer: options.prefer || 'return=representation',
            'Accept-Profile': this.supabaseSchema
        };
        
        const fetchOptions = { method, headers };
        if (options.body) {
            fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Supabase ${table} request failed: ${response.status} ${text}`);
        }

        if (response.status === 204) return null;
        
        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    async getCtaBlocks(projectSlug) {
        try {
            const projects = await this.request('projects', {
                select: 'id',
                slug: `eq.${this.escapeFilter(projectSlug)}`,
                limit: '1'
            });
            if (!projects || projects.length === 0) return [];
            const projectId = projects[0].id;
            const rows = await this.request('cta_blocks', {
                select: 'id,title,content_json',
                project_id: `eq.${projectId}`,
                order: 'created_at.asc'
            });
            return rows.map(r => ({
                id: r.id,
                title: r.title,
                label: r.content_json?.label || r.title,
                url: r.content_json?.url || '#',
                icon: r.content_json?.icon || 'link',
                description: r.content_json?.description || ''
            }));
        } catch {
            return [];
        }
    }

    humanize(value) {
        return String(value || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    escapeFilter(value) {
        return String(value).replace(/,/g, '\\,');
    }

    // --- New CMS Mutation Methods ---

    async createPresentation(data) {
        const id = data.id || `deck_${Date.now()}`;
        const fileName = `${id}.json`;
        let filePath;

        if (data.projectSlug) {
            const projectDir = path.join(this.projectsDir, data.projectSlug);
            const presentationsDir = path.join(projectDir, 'presentations');
            await fs.mkdir(presentationsDir, { recursive: true });
            filePath = path.join(presentationsDir, fileName);
        } else {
            await fs.mkdir(this.baseDir, { recursive: true });
            filePath = path.join(this.baseDir, fileName);
        }

        const presentationData = {
            id,
            title: data.title || this.humanize(id),
            slides: data.slides || [],
            ...data
        };

        await fs.writeFile(filePath, JSON.stringify(presentationData, null, 2), 'utf8');

        if (this.isSupabaseConfigured()) {
            try {
                await this.savePresentationToSupabase(presentationData);
            } catch (err) {
                console.error('Failed to sync created presentation to Supabase:', err.message);
            }
        }

        return presentationData;
    }

    async updatePresentation(identifier, data) {
        let filePath = path.join(this.baseDir, `${identifier}.json`);
        let exists = false;
        try {
            await fs.access(filePath);
            exists = true;
        } catch {}

        if (!exists && data.projectSlug) {
            filePath = path.join(this.projectsDir, data.projectSlug, 'presentations', `${identifier}.json`);
        } else if (!exists) {
            try {
                const projectDirs = await fs.readdir(this.projectsDir);
                for (const projectDirName of projectDirs) {
                    const testPath = path.join(this.projectsDir, projectDirName, 'presentations', `${identifier}.json`);
                    try {
                        await fs.access(testPath);
                        filePath = testPath;
                        exists = true;
                        break;
                    } catch {}
                }
            } catch {}
        }

        const presentationData = {
            id: identifier,
            title: data.title || this.humanize(identifier),
            slides: data.slides || [],
            ...data
        };
        
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(presentationData, null, 2), 'utf8');

        if (this.isSupabaseConfigured()) {
            try {
                await this.savePresentationToSupabase(presentationData);
            } catch (err) {
                console.error('Failed to sync updated presentation to Supabase:', err.message);
            }
        }

        return presentationData;
    }

    async deletePresentation(identifier) {
        let filePath = path.join(this.baseDir, `${identifier}.json`);
        let exists = false;
        try {
            await fs.access(filePath);
            exists = true;
        } catch {}

        if (!exists) {
            try {
                const projectDirs = await fs.readdir(this.projectsDir);
                for (const projectDirName of projectDirs) {
                    const testPath = path.join(this.projectsDir, projectDirName, 'presentations', `${identifier}.json`);
                    try {
                        await fs.access(testPath);
                        filePath = testPath;
                        exists = true;
                        break;
                    } catch {}
                }
            } catch {}
        }

        if (exists) {
            await fs.unlink(filePath);
            
            if (this.isSupabaseConfigured()) {
                try {
                    await this.deletePresentationFromSupabase(identifier);
                } catch (err) {
                    console.error('Failed to delete presentation from Supabase:', err.message);
                }
            }
            
            return { success: true };
        }
        throw new Error('Presentation not found');
    }

    async updateSlide(presentationId, slideIndex, slideData) {
        const presentation = await this.loadPresentationFromLocal(presentationId);
        if (!presentation) throw new Error('Presentation not found');
        
        if (!presentation.slides) presentation.slides = [];
        
        const idx = parseInt(slideIndex, 10);
        if (isNaN(idx) || idx >= presentation.slides.length || idx < 0) {
            presentation.slides.push(slideData);
        } else {
            presentation.slides[idx] = { ...presentation.slides[idx], ...slideData };
        }
        
        await this.updatePresentation(presentationId, presentation);
        return presentation.slides;
    }
    
    async deleteSlide(presentationId, slideIndex) {
        const presentation = await this.loadPresentationFromLocal(presentationId);
        if (!presentation) throw new Error('Presentation not found');
        
        const idx = parseInt(slideIndex, 10);
        if (presentation.slides && presentation.slides.length > idx && idx >= 0) {
            presentation.slides.splice(idx, 1);
            await this.updatePresentation(presentationId, presentation);
        }
        return presentation.slides;
    }

    async saveKnowledgeDoc(projectSlug, docType, content) {
        const projectDir = path.join(this.projectsDir, projectSlug);
        await fs.mkdir(projectDir, { recursive: true });
        
        let fileName = `${docType}.md`;
        if (docType === 'images' || docType === 'content_schema' || docType === 'project') {
            fileName = `${docType}.json`;
        }
        
        if (docType === 'cta' || docType === 'contact') {
            await fs.mkdir(path.join(projectDir, 'cta'), { recursive: true });
            fileName = 'cta/contact.md';
        }
        
        const filePath = path.join(projectDir, fileName);
        await fs.writeFile(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
        return { success: true, docType };
    }

    async deleteKnowledgeDoc(projectSlug, docType) {
        const projectDir = path.join(this.projectsDir, projectSlug);
        let fileName = `${docType}.md`;
        if (docType === 'images' || docType === 'content_schema' || docType === 'project') {
            fileName = `${docType}.json`;
        }
        
        if (docType === 'cta' || docType === 'contact') {
            fileName = 'cta/contact.md';
        }
        
        const filePath = path.join(projectDir, fileName);
        try {
            await fs.unlink(filePath);
            return { success: true };
        } catch {
            throw new Error('Document not found');
        }
    }

    // --- Supabase Hybrid Helpers ---
    async savePresentationToSupabase(data) {
        let projectId;
        const projectSlug = data.projectSlug || 'default';
        const existing = await this.request('projects', { select: 'id', slug: `eq.${projectSlug}`, limit: '1' });
        
        if (existing && existing.length > 0) {
            projectId = existing[0].id;
        } else {
            const rows = await this.request('projects', { on_conflict: 'slug' }, { method: 'POST', body: [{ slug: projectSlug, name: this.humanize(projectSlug) }], prefer: 'resolution=merge-duplicates,return=representation' });
            projectId = rows[0].id;
        }
        
        const presentationPayload = {
            project_id: projectId,
            slug: data.id,
            title: data.title,
            status: 'published',
            design_json: { startTitle: data.startTitle, startSubtitle: data.startSubtitle }
        };
        const presentationRows = await this.request('presentations', { on_conflict: 'slug' }, { method: 'POST', body: [presentationPayload], prefer: 'resolution=merge-duplicates,return=representation' });
        const presentationId = presentationRows[0].id;
        
        await this.request('slides', { presentation_id: `eq.${presentationId}` }, { method: 'DELETE' });
        
        if (data.slides && data.slides.length > 0) {
            const slidePayloads = data.slides.map((slide, index) => ({
                presentation_id: presentationId,
                slide_index: index,
                layout_type: slide.layout || 'immersive',
                content_json: { title: slide.title, content: slide.content, image: slide.image, customPrompt: slide.customPrompt },
                notes: slide.notes
            }));
            await this.request('slides', {}, { method: 'POST', body: slidePayloads });
        }
    }

    async deletePresentationFromSupabase(identifier) {
        await this.request('presentations', { slug: `eq.${this.escapeFilter(identifier)}` }, { method: 'DELETE' });
    }
}

module.exports = new CMSService();
