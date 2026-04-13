const express = require('express');
const cmsService = require('../services/cms');

const router = express.Router();
router.use(express.json());

router.get('/presentations', async (req, res) => {
    try {
        const presentations = await cmsService.listPresentations();
        res.json({
            presentations,
            source: cmsService.isSupabaseConfigured() ? 'hybrid' : 'local'
        });
    } catch (error) {
        console.error('Error listing CMS presentations:', error);
        res.status(500).json({ error: 'Failed to list presentations' });
    }
});

router.post('/presentations', async (req, res) => {
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
        res.status(201).json({ presentation });
    } catch (error) {
        console.error('Error creating CMS presentation:', error);
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

router.put('/presentations/:id', async (req, res) => {
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
        res.json({ presentation });
    } catch (error) {
        console.error('Error updating CMS presentation:', error);
        res.status(500).json({ error: 'Failed to update presentation' });
    }
});

router.delete('/presentations/:id', async (req, res) => {
    try {
        await cmsService.deletePresentation(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting CMS presentation:', error);
        res.status(500).json({ error: 'Failed to delete presentation' });
    }
});

router.put('/presentations/:id/slides/:slideIndex', async (req, res) => {
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
        res.json({ slides });
    } catch (error) {
        console.error('Error updating CMS slide:', error);
        res.status(500).json({ error: 'Failed to update CMS slide' });
    }
});

router.delete('/presentations/:id/slides/:slideIndex', async (req, res) => {
    try {
        const slides = await cmsService.deleteSlide(req.params.id, req.params.slideIndex);
        res.json({ slides });
    } catch (error) {
        console.error('Error deleting CMS slide:', error);
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

router.post('/projects/:slug/docs/:docType', async (req, res) => {
    try {
        const result = await cmsService.saveKnowledgeDoc(req.params.slug, req.params.docType, req.body.content);
        res.json(result);
    } catch (error) {
        console.error('Error saving CMS knowledge doc:', error);
        res.status(500).json({ error: 'Failed to save knowledge doc' });
    }
});

router.delete('/projects/:slug/docs/:docType', async (req, res) => {
    try {
        await cmsService.deleteKnowledgeDoc(req.params.slug, req.params.docType);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting CMS knowledge doc:', error);
        res.status(500).json({ error: 'Failed to delete knowledge doc' });
    }
});

router.post('/preview-narration', async (req, res) => {
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
        res.send(audioBuffer);
    } catch (error) {
        console.error('Error generating preview narration:', error);
        res.status(500).json({ error: 'Failed to generate preview audio' });
    }
});

module.exports = router;
