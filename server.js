require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createCorsOptions, validateRuntimeConfig } = require('./server/config/runtime');
const {
    createRateLimiter,
    hasValidSessionControl,
    hasValidSessionControlAsync,
    requireAdminApiKey,
    securityHeaders
} = require('./server/middleware/security');
const { createLogger } = require('./server/middleware/logger');

// Initialize database
const { initializeDatabase, getDatabase, saveDatabase } = require('./server/db/init');
const stateStore = require('./server/services/stateStore');
const runtimeConfig = validateRuntimeConfig();
const corsOptions = createCorsOptions(runtimeConfig.allowedOrigins);
const logger = createLogger();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: corsOptions
});

// Middleware
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pilot-package', express.static(path.join(__dirname, 'pilot-presentation')));
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: 180, label: 'API' }));
app.use('/api/session/start', createRateLimiter({ windowMs: 60 * 1000, max: 10, label: 'Session start' }));
app.use('/api/questions', createRateLimiter({ windowMs: 60 * 1000, max: 30, label: 'Question submission' }));
app.use('/api/autoplex', createRateLimiter({ windowMs: 60 * 1000, max: 90, label: 'Presenter control' }));
app.use('/api/realtime/connect', createRateLimiter({ windowMs: 60 * 1000, max: 12, label: 'Realtime connect' }));
app.use('/api/tts', createRateLimiter({ windowMs: 60 * 1000, max: 20, label: 'TTS' }));

// Make io accessible to routes
app.set('io', io);
app.set('logger', logger);

// Database initialization
let db = null;
let dbHelper = null;

// Import routes
const sessionRoutes = require('./server/routes/session');
const questionsRoutes = require('./server/routes/questions');
const narrationRoutes = require('./server/routes/narration');
const slidesRoutes = require('./server/routes/slides');
const autoplexRoutes = require('./server/routes/autoplex');
const realtimeRoutes = require('./server/routes/realtime');
const cmsRoutes = require('./server/routes/cms');
const analyticsRoutes = require('./server/routes/analytics');

// API routes
app.use('/api/session', sessionRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/narrate', narrationRoutes);
app.use('/api/slide', slidesRoutes);
app.use('/api/autoplex', autoplexRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check
app.get('/pilot', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pilot.html'));
});

app.get('/reel-style', (_req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('<title>Voice-PPT</title>', '<title>Beforest Reel Style</title>');
    html = html.replace('</head>', '    <link rel="stylesheet" href="/reel-style.css">\n</head>');
    html = html.replace('<body>', '<body class="theme-reel">');
    res.type('html').send(html);
});

app.get('/api/health', (req, res) => {
    const db = req.app.get('db');
    const hasDb = !!(db && db.get);
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            database: hasDb ? 'connected' : 'disconnected',
            azureOpenAI: !!(
                (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_VOICELIVE_ENDPOINT || process.env.AZURE_EXISTING_AIPROJECT_ENDPOINT) &&
                (process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_VOICELIVE_API_KEY || process.env.AZURE_AI_API_KEY)
            ),
            azureSpeech: !!(
                (process.env.AZURE_SPEECH_KEY || process.env.AZURE_AI_SPEECH_KEY || process.env.AZURE_COGSERVICES_KEY) &&
                (process.env.AZURE_SPEECH_REGION || process.env.AZURE_LOCATION || process.env.AZURE_REGION)
            ),
            supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
        }
    });
});

// TTS endpoint
app.post('/api/tts', requireAdminApiKey, async (req, res) => {
    try {
        const { text, voice } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        const ttsService = require('./server/services/tts');
        const audioBuffer = await ttsService.synthesize(text, voice);
        
        res.set({
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.length
        });
        
        res.send(audioBuffer);
    } catch (error) {
        console.error('TTS error:', error);
        res.status(500).json({ error: 'TTS synthesis failed' });
    }
});

// File indexing endpoint
app.post('/api/files/index', requireAdminApiKey, async (req, res) => {
    try {
        const { filename, content, title, description } = req.body;
        
        if (!filename || !content) {
            return res.status(400).json({ error: 'Filename and content are required' });
        }
        
        const retrievalService = require('./server/services/retrieval');
        const documentId = await retrievalService.indexDocument(filename, content, title, description);
        
        res.json({ success: true, documentId });
    } catch (error) {
        console.error('File indexing error:', error);
        res.status(500).json({ error: 'File indexing failed' });
    }
});

// Retrieval endpoint
app.post('/api/retrieve', requireAdminApiKey, async (req, res) => {
    try {
        const { query, sessionId, limit = 5 } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        
        const retrievalService = require('./server/services/retrieval');
        const results = await retrievalService.retrieve(query, sessionId, limit);
        
        res.json({ results });
    } catch (error) {
        console.error('Retrieval error:', error);
        res.status(500).json({ error: 'Retrieval failed' });
    }
});

io.on('connection', (socket) => {
    logger.info({ event: 'socket_client_connected', subsystem: 'realtime', socketId: socket.id });
    
    socket.on('join-session', async (payload) => {
        const sessionId = typeof payload === 'string' ? payload : payload?.sessionId;
        const controlToken = typeof payload === 'object' ? String(payload?.controlToken || '') : '';
        const clientInstanceId = typeof payload === 'object' ? String(payload?.clientInstanceId || '') : '';
        const db = app.get('db');
        const socketLogger = logger.child({ subsystem: 'realtime', socketId: socket.id, sessionId });

        if (!(await hasValidSessionControlAsync(db, sessionId, controlToken))) {
            socketLogger.warn({ event: 'auth_socket_join_denied' });
            socket.emit('session-join-error', { error: 'Valid session control token required' });
            return;
        }

        socket.join(sessionId);
        socket.data.clientInstanceId = clientInstanceId;
        socket.data.sessionId = sessionId;
        socketLogger.info({ event: 'session_socket_joined' });
        socket.emit('session-joined', { sessionId, isController: true, playbackContractVersion: 1 });
    });

    socket.on('presentation-audio-complete', (payload) => {
        const sessionId = payload?.sessionId;
        const slideIndex = payload?.slideIndex;
        if (!sessionId) {
            return;
        }
        if (socket.data?.sessionId && socket.data.sessionId !== sessionId) {
            return;
        }
        autoplexRoutes.markPlaybackComplete?.(sessionId, slideIndex, {
            clientInstanceId: payload?.clientInstanceId || socket.data?.clientInstanceId || '',
            socketId: socket.id
        });
    });
    
    socket.on('disconnect', () => {
        logger.info({ event: 'socket_client_disconnected', subsystem: 'realtime', socketId: socket.id });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    const requestLogger = req?.app?.get('logger') || logger;
    requestLogger.error({ event: 'server_unhandled_error', subsystem: 'server', err: err.message });
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize database and start server
initializeDatabase()
    .then(database => {
        db = database.db;
        dbHelper = database.dbHelper;
        
        // Initialize state store
        stateStore.initialize(dbHelper);
        
        // Make database available to routes
        app.set('db', dbHelper);
        app.set('rawDb', db);
        
        const PORT = process.env.PORT || 3000;
        const HOST = process.env.HOST || '0.0.0.0';
        server.listen(PORT, HOST, () => {
            logger.info({
                event: 'server_started',
                subsystem: 'server',
                host: HOST,
                port: Number(PORT),
                environment: runtimeConfig.environment
            });
        });
    })
    .catch(error => {
        logger.error({ event: 'server_boot_failed', subsystem: 'server', err: error.message });
        process.exit(1);
    });

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info({ event: 'server_shutdown_requested', subsystem: 'server', signal: 'SIGTERM' });
    saveDatabase();
    server.close(() => {
        logger.info({ event: 'server_closed', subsystem: 'server', signal: 'SIGTERM' });
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info({ event: 'server_shutdown_requested', subsystem: 'server', signal: 'SIGINT' });
    saveDatabase();
    server.close(() => {
        logger.info({ event: 'server_closed', subsystem: 'server', signal: 'SIGINT' });
        process.exit(0);
    });
});
