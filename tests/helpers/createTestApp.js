const express = require('express');

function createTestApp({
    routeBase = '/',
    router,
    db = null,
    io = null,
    logger = null
} = {}) {
    const app = express();
    app.use(express.json());
    app.set('db', db);
    app.set('io', io || { to: () => ({ emit: () => {} }) });
    if (logger) {
        app.set('logger', logger);
    }

    if (router) {
        app.use(routeBase, router);
    }

    app.use((err, req, res, next) => {
        if (res.headersSent) {
            return next(err);
        }

        res.status(500).json({ error: err.message || 'Internal server error' });
    });

    return app;
}

module.exports = {
    createTestApp
};
