const express = require('express');
const cmsService = require('../services/cms');
const { requireAdminApiKey } = require('../middleware/security');
const { getRequestLogger } = require('../middleware/logger');

const router = express.Router();
router.use(express.json());

router.get('/presentations', async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const presentations = await cmsService.listPresentations();
        logger.info({
            event: 'source_cms_presentations_listed',
            count: presentations.length,
            source: cmsService.isSupabaseConfigured() ? 'hybrid' : 'local'
        });
        res.json({
            presentations,
            source: cmsService.isSupabaseConfigured() ? 'hybrid' : 'local'
        });
    } catch (error) {
        logger.error({ event: 'cms_presentations_list_failed', err: error.message });
        res.status(500).json({ error: 'Failed to list presentations' });
    }
});

router.post('/presentations', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const { title, id, slides, projectSlug } = req.body;
        if (!title || typeof title !== 'string' || title.length > 255) {
            return res.status(400).json({ error: 'Invalid title' });
        }
        if (slides && !Array.isArray(slides)) {
            return res.status(400).json({ error: 'Slides must be an array' });
        }
        if (slides && slides.length > 500) {
            return res.status(400).json({ error: 'Too many slides (max 500)' });
        }
        const presentation = await cmsService.createPresentation(req.body);
        logger.info({ event: 'cms_presentation_created', presentationId: presentation?.id || id || projectSlug || title });
        res.status(201).json({ presentation });
    } catch (error) {
        logger.error({ event: 'cms_presentation_create_failed', err: error.message });
        res.status(500).json({ error: 'Failed to create presentation' });
    }
});

router.get('/presentations/:id', async (req, res) => {
    try {
        const presentation = await cmsService.loadPresentation(req.params.id);
        if (!presentation) {
            return res.status(404).json({ error: 'Presentation not found' });
        }
        res.json({ presentation });
    } catch (error) {
        console.error('Error loading CMS presentation:', error);
        res.status(500).json({ error: 'Failed to load presentation' });
    }
});

router.put('/presentations/:id', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const { title, slides } = req.body;
        if (title && (typeof title !== 'string' || title.length > 255)) {
            return res.status(400).json({ error: 'Invalid title' });
        }
        if (slides && !Array.isArray(slides)) {
            return res.status(400).json({ error: 'Slides must be an array' });
        }
        if (slides && slides.length > 500) {
            return res.status(400).json({ error: 'Too many slides (max 500)' });
        }
        const presentation = await cmsService.updatePresentation(req.params.id, req.body);
        logger.info({ event: 'cms_presentation_updated', presentationId: req.params.id });
        res.json({ presentation });
    } catch (error) {
        logger.error({ event: 'cms_presentation_update_failed', presentationId: req.params.id, err: error.message });
        res.status(500).json({ error: 'Failed to update presentation' });
    }
});

router.delete('/presentations/:id', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        await cmsService.deletePresentation(req.params.id);
        logger.info({ event: 'cms_presentation_deleted', presentationId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        logger.error({ event: 'cms_presentation_delete_failed', presentationId: req.params.id, err: error.message });
        res.status(500).json({ error: 'Failed to delete presentation' });
    }
});

router.put('/presentations/:id/slides/:slideIndex', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const slideIndex = parseInt(req.params.slideIndex, 10);
        if (isNaN(slideIndex) || slideIndex < 0) {
            return res.status(400).json({ error: 'Invalid slide index' });
        }
        const { title, content, notes, image } = req.body;
        if (title && typeof title !== 'string') {
            return res.status(400).json({ error: 'Invalid title' });
        }
        if (content && typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid content' });
        }
        const slides = await cmsService.updateSlide(req.params.id, req.params.slideIndex, req.body);
        logger.info({ event: 'cms_slide_updated', presentationId: req.params.id, slideIndex });
        res.json({ slides });
    } catch (error) {
        logger.error({ event: 'cms_slide_update_failed', presentationId: req.params.id, slideIndex: req.params.slideIndex, err: error.message });
        res.status(500).json({ error: 'Failed to update CMS slide' });
    }
});

router.delete('/presentations/:id/slides/:slideIndex', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const slides = await cmsService.deleteSlide(req.params.id, req.params.slideIndex);
        logger.info({ event: 'cms_slide_deleted', presentationId: req.params.id, slideIndex: req.params.slideIndex });
        res.json({ slides });
    } catch (error) {
        logger.error({ event: 'cms_slide_delete_failed', presentationId: req.params.id, slideIndex: req.params.slideIndex, err: error.message });
        res.status(500).json({ error: 'Failed to delete slide' });
    }
});

router.get('/projects/:slug', async (req, res) => {
    try {
        const project = await cmsService.loadProject(req.params.slug);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({ project });
    } catch (error) {
        console.error('Error loading CMS project:', error);
        res.status(500).json({ error: 'Failed to load project' });
    }
});

router.get('/projects/:slug/cta-blocks', async (req, res) => {
    try {
        const blocks = await cmsService.getCtaBlocks(req.params.slug);
        res.json({ ctaBlocks: blocks });
    } catch (error) {
        console.error('Error loading CTA blocks:', error);
        res.status(500).json({ error: 'Failed to load CTA blocks' });
    }
});

router.get('/projects/:slug/loading-quotes', async (req, res) => {
    try {
        const quotes = await cmsService.getLoadingQuotes(req.params.slug);
        res.json(quotes);
    } catch (error) {
        console.error('Error loading loading quotes:', error);
        res.status(500).json({ error: 'Failed to load loading quotes' });
    }
});

router.post('/projects/:slug/docs/:docType', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const result = await cmsService.saveKnowledgeDoc(req.params.slug, req.params.docType, req.body.content);
        logger.info({ event: 'cms_knowledge_doc_saved', projectSlug: req.params.slug, docType: req.params.docType });
        res.json(result);
    } catch (error) {
        logger.error({ event: 'cms_knowledge_doc_save_failed', projectSlug: req.params.slug, docType: req.params.docType, err: error.message });
        res.status(500).json({ error: 'Failed to save knowledge doc' });
    }
});

router.delete('/projects/:slug/docs/:docType', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        await cmsService.deleteKnowledgeDoc(req.params.slug, req.params.docType);
        logger.info({ event: 'cms_knowledge_doc_deleted', projectSlug: req.params.slug, docType: req.params.docType });
        res.json({ success: true });
    } catch (error) {
        logger.error({ event: 'cms_knowledge_doc_delete_failed', projectSlug: req.params.slug, docType: req.params.docType, err: error.message });
        res.status(500).json({ error: 'Failed to delete knowledge doc' });
    }
});

router.delete('/knowledge-docs/:id', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        await cmsService.deleteKnowledgeDocById(req.params.id);
        logger.info({ event: 'cms_knowledge_doc_deleted_by_id', docId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        logger.error({ event: 'cms_knowledge_doc_delete_by_id_failed', docId: req.params.id, err: error.message });
        res.status(500).json({ error: 'Failed to delete knowledge doc' });
    }
});

router.post('/preview-narration', requireAdminApiKey, async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'cms' });
    try {
        const { text, voice = 'default' } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Text is required for preview' });
        }

        const ttsService = require('../services/tts');
        const audioBuffer = await ttsService.synthesize(text, voice);
        
        res.set({
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.length
        });
        logger.info({ event: 'cms_preview_narration_generated', voice });
        res.send(audioBuffer);
    } catch (error) {
        logger.error({ event: 'cms_preview_narration_failed', err: error.message });
        res.status(500).json({ error: 'Failed to generate preview audio' });
    }
});

module.exports = router;
