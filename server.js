require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createCorsOptions, validateRuntimeConfig } = require('./server/config/runtime');
const {
    createRateLimiter,
    hasValidSessionControl,
    requireAdminApiKey,
    securityHeaders
} = require('./server/middleware/security');

// Initialize database
const { initializeDatabase, getDatabase, saveDatabase } = require('./server/db/init');
const stateStore = require('./server/services/stateStore');
const runtimeConfig = validateRuntimeConfig();
const corsOptions = createCorsOptions(runtimeConfig.allowedOrigins);

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
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: 180, label: 'API' }));
app.use('/api/session/start', createRateLimiter({ windowMs: 60 * 1000, max: 10, label: 'Session start' }));
app.use('/api/questions', createRateLimiter({ windowMs: 60 * 1000, max: 30, label: 'Question submission' }));
app.use('/api/autoplex', createRateLimiter({ windowMs: 60 * 1000, max: 90, label: 'Presenter control' }));
app.use('/api/realtime/connect', createRateLimiter({ windowMs: 60 * 1000, max: 12, label: 'Realtime connect' }));
app.use('/api/tts', createRateLimiter({ windowMs: 60 * 1000, max: 20, label: 'TTS' }));

// Make io accessible to routes
app.set('io', io);

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

// Socket.IO connection handling
const sessionReactions = new Map();
const sessionVotes = new Map();

// Periodic check for significant reactions (every 10s)
setInterval(() => {
    for (const [sessionId, counts] of sessionReactions.entries()) {
        const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
        if (total > 0) {
            io.to(sessionId).emit('significant-reactions', { counts, total });
            
            // Store in audience_memory for AI awareness
            const dbHelper = app.get('db');
            if (dbHelper) {
                const summary = Object.entries(counts)
                    .filter(([_, count]) => count > 0)
                    .map(([emoji, count]) => `${count}x ${emoji}`)
                    .join(', ');
                
                dbHelper.run(
                    'INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
                    [sessionId, 'latest_reaction_summary', `Audience just reacted with: ${summary}`, 0.9]
                );
            }

            // Reset after reporting
            sessionReactions.set(sessionId, { '👏': 0, '❤️': 0, '💡': 0 });
        }
    }
}, 10000);

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('join-session', (payload) => {
        const sessionId = typeof payload === 'string' ? payload : payload?.sessionId;
        const controlToken = typeof payload === 'object' ? String(payload?.controlToken || '') : '';
        const db = app.get('db');

        if (!hasValidSessionControl(db, sessionId, controlToken)) {
            socket.emit('session-join-error', { error: 'Valid session control token required' });
            return;
        }

        socket.join(sessionId);
        console.log(`Client ${socket.id} joined session ${sessionId}`);

        // Send current votes if any
        if (sessionVotes.has(sessionId)) {
            socket.emit('votes-sync', { votes: sessionVotes.get(sessionId) });
        }
    });

    socket.on('presentation-audio-complete', (payload) => {
        const sessionId = payload?.sessionId;
        const slideIndex = payload?.slideIndex;
        if (!sessionId) {
            return;
        }
        autoplexRoutes.markPlaybackComplete?.(sessionId, slideIndex);
    });

    socket.on('send-reaction', (payload) => {
        const sessionId = payload?.sessionId;
        const emoji = payload?.emoji;
        if (sessionId && emoji) {
            // Track for AI awareness
            if (!sessionReactions.has(sessionId)) {
                sessionReactions.set(sessionId, { '👏': 0, '❤️': 0, '💡': 0 });
            }
            const counts = sessionReactions.get(sessionId);
            if (counts[emoji] !== undefined) {
                counts[emoji]++;
            }

            io.to(sessionId).emit('receive-reaction', { emoji });
        }
    });

    socket.on('submit-vote', (payload) => {
        const { sessionId, mcqId, option } = payload;
        if (sessionId && mcqId && option) {
            if (!sessionVotes.has(sessionId)) {
                sessionVotes.set(sessionId, {});
            }
            const votes = sessionVotes.get(sessionId);
            if (!votes[mcqId]) {
                votes[mcqId] = {};
            }
            votes[mcqId][option] = (votes[mcqId][option] || 0) + 1;

            io.to(sessionId).emit('vote-update', { mcqId, option, count: votes[mcqId][option], allVotes: votes[mcqId] });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
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
            console.log(`Voice-PPT server running on http://${HOST}:${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    })
    .catch(error => {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    });

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    saveDatabase();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    saveDatabase();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
