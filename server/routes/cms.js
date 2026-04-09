const express = require('express');
const cmsService = require('../services/cms');

const router = express.Router();

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

router.get('/presentations/:id', async (req, res) => {
    try {
        const presentation = await cmsService.loadPresentation(req.params.id);
        res.json({
            presentation
        });
    } catch (error) {
        console.error('Error loading CMS presentation:', error);
        res.status(404).json({ error: 'Presentation not found' });
    }
});

router.get('/projects/:slug', async (req, res) => {
    try {
        const project = await cmsService.loadProject(req.params.slug);
        res.json({ project });
    } catch (error) {
        console.error('Error loading CMS project:', error);
        res.status(404).json({ error: 'Project not found' });
    }
});

module.exports = router;
