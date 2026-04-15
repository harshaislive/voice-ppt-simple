const express = require('express');
const router = express.Router();
const manifestGenerator = require('../services/manifestGenerator');

/**
 * POST /api/publish
 * Generates a complete manifest + audio for a presentation deck
 * Body: { deckId, generateNarration?: boolean, generateAudio?: boolean }
 */
router.post('/', async (req, res) => {
    try {
        const { deckId, generateNarration = true, generateAudio = true } = req.body;
        
        if (!deckId) {
            return res.status(400).json({ error: 'deckId is required' });
        }

        console.log(`[Publish] Starting publish for deck: ${deckId}`);
        
        const result = await manifestGenerator.generateManifest(deckId, {
            generateNarration,
            generateAudio
        });

        res.json({
            success: true,
            deckId,
            totalSlides: result.manifest.totalSlides,
            totalDurationMs: result.manifest.total_duration_ms,
            audioFilesGenerated: result.audioFiles.length,
            manifestPath: result.manifestPath
        });
    } catch (error) {
        console.error('[Publish] Failed:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/publish/:deckId
 * Returns the manifest for a published deck
 */
router.get('/:deckId', async (req, res) => {
    try {
        const manifest = await manifestGenerator.getManifest(req.params.deckId);
        
        if (!manifest) {
            return res.status(404).json({ error: 'Manifest not found. Publish the deck first.' });
        }

        res.json(manifest);
    } catch (error) {
        console.error('[Publish] Failed to get manifest:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/publish
 * Lists all published decks
 */
router.get('/', async (req, res) => {
    try {
        const published = await manifestGenerator.listPublished();
        res.json({ published });
    } catch (error) {
        console.error('[Publish] Failed to list published:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
