-- Voice-PPT Database Schema
-- Version: 1.0.1 (sql.js compatible)

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    current_slide_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT
);

-- Slides table
CREATE TABLE IF NOT EXISTS slides (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    deck_id TEXT NOT NULL,
    slide_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, slide_index)
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    submitted_by TEXT,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    slide_index INTEGER,
    answered_at DATETIME,
    answer_text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Audience memory for tracking conversation context
CREATE TABLE IF NOT EXISTS audience_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, key)
);

-- Documents for indexing and retrieval
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    title TEXT,
    description TEXT,
    content_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    indexed_at DATETIME
);

-- Document chunks for retrieval
CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, chunk_index)
);

-- Events table for audit trail and replay
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_slides_session ON slides(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(session_id, status);
CREATE INDEX IF NOT EXISTS idx_audience_memory_session ON audience_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

-- Simple text index for document chunks (instead of FTS5)
CREATE INDEX IF NOT EXISTS idx_document_chunks_text ON document_chunks(chunk_text);
