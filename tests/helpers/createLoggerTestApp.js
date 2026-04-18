const express = require('express');
const { getRequestLogger } = require('../../server/middleware/logger');
const { requireAdminApiKey } = require('../../server/middleware/security');

function createLoggerTestApp() {
    const app = express();
    app.use(express.json());

    app.post('/logs/base', (req, res) => {
        const logger = getRequestLogger(req, { subsystem: 'diagnostics', sessionId: 'session-123' });
        logger.info({
            event: 'test_log',
            participantName: 'Jane Doe',
            prompt: 'Very long prompt',
            authorization: 'Bearer top-secret'
        });
        res.json({ success: true });
    });

    app.post('/logs/admin', requireAdminApiKey, (req, res) => {
        res.json({ success: true });
    });

    return app;
}

module.exports = {
    createLoggerTestApp
};
