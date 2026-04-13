const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analytics');
const { requireSessionControl } = require('../middleware/security');

router.post('/event', async (req, res) => {
    try {
        const { sessionId, eventType, slideIndex, content, metadata } = req.body;
        if (!sessionId || !eventType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        await analyticsService.logEvent(sessionId, eventType, slideIndex, content, metadata);
        res.json({ success: true });
    } catch (err) {
        console.error('Analytics event log error:', err);
        res.status(500).json({ error: 'Failed to log event' });
    }
});

module.exports = router;
