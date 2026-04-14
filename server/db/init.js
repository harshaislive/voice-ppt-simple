const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const DatabaseHelper = require('../services/dbHelper');

const DB_PATH = process.env.DB_PATH || './voice-ppt.db';

let db = null;
let dbHelper = null;

function ensureColumn(tableName, columnName, columnDefinition) {
    const columns = db.exec(`PRAGMA table_info(${tableName})`);
    const existingColumns = columns[0]?.values?.map((row) => row[1]) || [];

    if (!existingColumns.includes(columnName)) {
        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
}

async function initializeDatabase() {
    console.log('Initializing database...');
    
    try {
        // Initialize sql.js
        const SQL = await initSqlJs();
        
        // Try to load existing database
        if (fs.existsSync(DB_PATH)) {
            const buffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(buffer);
            console.log('Loaded existing database');
        } else {
            db = new SQL.Database();
            console.log('Created new database');
        }
        
        // Enable foreign keys
        db.run("PRAGMA foreign_keys = ON;");
        
        // Read and execute migrations
        const migrationsPath = path.join(__dirname, 'migrations.sql');
        const migrations = fs.readFileSync(migrationsPath, 'utf8');
        
        // Execute all statements
        db.run(migrations);
        ensureColumn('sessions', 'control_token_hash', 'TEXT');
        ensureColumn('slides', 'image', 'TEXT');
        ensureColumn('slides', 'narration_text', 'TEXT');
        ensureColumn('slides', 'narration_audio_path', 'TEXT');
        ensureColumn('slides', 'narration_audio_url', 'TEXT');
        ensureColumn('slides', 'narration_audio_duration_ms', 'INTEGER');
        ensureColumn('slides', 'narration_audio_source', 'TEXT');
        ensureColumn('slides', 'narration_metadata_json', 'TEXT');
        ensureColumn('slides', 'narration_generated_at', 'DATETIME');
        ensureColumn('questions', 'answer_title', 'TEXT');
        ensureColumn('questions', 'answer_summary', 'TEXT');
        ensureColumn('questions', 'answer_details', 'TEXT');
        ensureColumn('questions', 'answer_audio_path', 'TEXT');
        ensureColumn('questions', 'answer_audio_url', 'TEXT');
        ensureColumn('questions', 'answer_audio_duration_ms', 'INTEGER');

        // Create database helper
        dbHelper = new DatabaseHelper(db);
        
        // Save database to file
        saveDatabase();
        
        console.log('Database initialized successfully');
        console.log(`Database location: ${path.resolve(DB_PATH)}`);
        
        return { db, dbHelper };
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

function saveDatabase() {
    if (!db) return;
    
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

function getDatabase() {
    return { db, dbHelper };
}

// Run if called directly
if (require.main === module) {
    initializeDatabase().catch(console.error);
}

module.exports = { initializeDatabase, getDatabase, saveDatabase };
