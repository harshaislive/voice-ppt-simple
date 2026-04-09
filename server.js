require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// Initialize database
const { initializeDatabase, getDatabase, saveDatabase } = require('./server/db/init');
const stateStore = require('./server/services/stateStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// API routes
app.use('/api/session', sessionRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/narrate', narrationRoutes);
app.use('/api/slide', slidesRoutes);
app.use('/api/autoplex', autoplexRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/cms', cmsRoutes);

// TTS endpoint
app.post('/api/tts', async (req, res) => {
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
app.post('/api/files/index', async (req, res) => {
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
app.post('/api/retrieve', async (req, res) => {
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
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('join-session', (sessionId) => {
        socket.join(sessionId);
        console.log(`Client ${socket.id} joined session ${sessionId}`);
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
