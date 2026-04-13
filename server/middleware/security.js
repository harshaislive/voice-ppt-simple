const crypto = require('crypto');

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function generateSessionControlToken() {
    return crypto.randomBytes(24).toString('hex');
}

function extractSessionControlToken(req) {
    const headerToken = req.get('x-session-control-token');
    if (headerToken) {
        return headerToken.trim();
    }

    const authHeader = req.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    return '';
}

function timingSafeCompare(left, right) {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function resolveSessionId(req, options = {}) {
    const keys = options.keys || ['sessionId', 'id'];

    for (const key of keys) {
        if (req.body && req.body[key]) {
            return req.body[key];
        }
    }

    for (const key of keys) {
        if (req.params && req.params[key]) {
            return req.params[key];
        }
    }

    for (const key of keys) {
        if (req.query && req.query[key]) {
            return req.query[key];
        }
    }

    return null;
}

function hasValidSessionControl(db, sessionId, providedToken) {
    if (!db || !sessionId || !providedToken) {
        return false;
    }

    const session = db.get('SELECT control_token_hash FROM sessions WHERE id = ?', [sessionId]);
    if (!session || !session.control_token_hash) {
        return false;
    }

    return timingSafeCompare(session.control_token_hash, hashToken(providedToken));
}

function requireSessionControl(options = {}) {
    return (req, res, next) => {
        try {
            const db = req.app.get('db');
            const sessionId = resolveSessionId(req, options);
            const providedToken = extractSessionControlToken(req);

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID is required' });
            }

            if (!hasValidSessionControl(db, sessionId, providedToken)) {
                return res.status(403).json({ error: 'Valid session control token required' });
            }

            req.sessionId = sessionId;
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireSlideSessionControl() {
    return (req, res, next) => {
        try {
            const db = req.app.get('db');
            const slideId = req.params.slideId;
            const providedToken = extractSessionControlToken(req);
            const slide = db.get('SELECT session_id FROM slides WHERE id = ?', [slideId]);

            if (!slide) {
                return res.status(404).json({ error: 'Slide not found' });
            }

            if (!hasValidSessionControl(db, slide.session_id, providedToken)) {
                return res.status(403).json({ error: 'Valid session control token required' });
            }

            req.sessionId = slide.session_id;
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireAdminApiKey(req, res, next) {
    const configuredKey = String(process.env.ADMIN_API_KEY || '').trim();
    if (!configuredKey) {
        return res.status(503).json({ error: 'ADMIN_API_KEY is not configured' });
    }

    const providedKey = String(req.get('x-admin-api-key') || '').trim();
    if (!providedKey || !timingSafeCompare(configuredKey, providedKey)) {
        return res.status(403).json({ error: 'Valid admin API key required' });
    }

    next();
}

function createRateLimiter({ windowMs, max, keyGenerator, label }) {
    const store = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            if (entry.resetAt <= now) {
                store.delete(key);
            }
        }
    }, windowMs);

    return (req, res, next) => {
        const now = Date.now();
        const key = typeof keyGenerator === 'function' ? keyGenerator(req) : req.ip;
        const current = store.get(key);

        if (!current || current.resetAt <= now) {
            store.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        current.count += 1;
        if (current.count > max) {
            res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
            return res.status(429).json({
                error: `${label || 'Request'} rate limit exceeded`
            });
        }

        next();
    };
}

function securityHeaders(req, res, next) {
    res.set({
        'Referrer-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });
    next();
}

module.exports = {
    createRateLimiter,
    extractSessionControlToken,
    generateSessionControlToken,
    hashToken,
    hasValidSessionControl,
    requireAdminApiKey,
    requireSessionControl,
    requireSlideSessionControl,
    securityHeaders
};
