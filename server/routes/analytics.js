const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analytics');
const { requireSessionControl } = require('../middleware/security');
const { getRequestLogger } = require('../middleware/logger');

router.post('/event', requireSessionControl({ keys: ['sessionId'] }), async (req, res) => {
    const logger = getRequestLogger(req, { subsystem: 'analytics', sessionId: req.body?.sessionId });
    try {
        const { sessionId, eventType, slideIndex, content, metadata } = req.body;
        if (!sessionId || !eventType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        await analyticsService.logEvent(sessionId, eventType, slideIndex, content, metadata);
        logger.info({ event: 'analytics_event_ingested', eventType, slideIndex });
        res.json({ success: true });
    } catch (err) {
        logger.error({ event: 'analytics_event_ingest_failed', err: err.message });
        res.status(500).json({ error: 'Failed to log event' });
    }
});

module.exports = router;
