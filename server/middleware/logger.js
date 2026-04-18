const pino = require('pino');

const REDACT_PATHS = [
    'authorization',
    'headers.authorization',
    'req.headers.authorization',
    'x-admin-api-key',
    'headers.x-admin-api-key',
    'req.headers.x-admin-api-key',
    'adminApiKey',
    'controlToken',
    'providedToken',
    'participantName',
    'submittedBy',
    'questionText',
    'prompt',
    'knowledgeContext',
    'slideContent',
    'slideNotes'
];

function createLogger(options = {}) {
    const {
        level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        stream,
        enabled = true
    } = options;

    return pino({
        level,
        enabled,
        base: undefined,
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: {
            paths: REDACT_PATHS,
            censor: '[Redacted]'
        }
    }, stream);
}

let sharedLogger = createLogger();

function setLogger(logger) {
    sharedLogger = logger;
    return sharedLogger;
}

function getLogger() {
    return sharedLogger;
}

function createChildLogger(bindings = {}) {
    return sharedLogger.child(bindings);
}

function getRequestLogger(req, bindings = {}) {
    const appLogger = req?.app?.get?.('logger');
    const logger = appLogger || sharedLogger;
    return Object.keys(bindings).length ? logger.child(bindings) : logger;
}

module.exports = {
    REDACT_PATHS,
    createChildLogger,
    createLogger,
    getLogger,
    getRequestLogger,
    setLogger
};
