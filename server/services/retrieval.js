const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class RetrievalService {
    constructor() {
        this.chunkSize = 500; // characters per chunk
        this.overlap = 50; // overlap between chunks
    }
    
    async indexDocument(filename, content, title = null, description = null) {
        try {
            const db = require('./stateStore').db;
            if (!db) {
                throw new Error('Database not available');
            }
            
            const documentId = uuidv4();
            const contentHash = crypto.createHash('md5').update(content).digest('hex');
            const fileType = this.detectFileType(filename);
            
            // Insert document
            db.run(`
                INSERT INTO documents (id, filename, file_type, title, description, content_hash, indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [documentId, filename, fileType, title || filename, description, contentHash]);
            
            // Chunk content
            const chunks = this.chunkText(content);
            
            // Insert chunks
            chunks.forEach((chunk, i) => {
                const metadata = JSON.stringify({
                    chunkIndex: i,
                    totalChunks: chunks.length,
                    filename,
                    documentId
                });
                
                db.run(`
                    INSERT INTO document_chunks (document_id, chunk_index, chunk_text, metadata, created_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [documentId, i, chunk, metadata]);
            });
            
            console.log(`Indexed document: ${filename} (${chunks.length} chunks)`);
            
            return documentId;
        } catch (error) {
            console.error('Document indexing error:', error);
            throw error;
        }
    }
    
    async retrieve(query, sessionId = null, limit = 5) {
        try {
            const db = require('./stateStore').db;
            if (!db) {
                throw new Error('Database not available');
            }
            
            // Use LIKE for simple full-text search (since FTS5 is not available)
            const results = db.all(`
                SELECT 
                    dc.id,
                    dc.chunk_text,
                    dc.metadata,
                    dc.document_id,
                    d.filename,
                    d.title,
                    d.file_type
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE dc.chunk_text LIKE ?
                ORDER BY dc.chunk_index
                LIMIT ?
            `, [`%${query}%`, limit]);
            
            // Format results
            const formattedResults = results.map(result => ({
                id: result.id,
                text: result.chunk_text,
                score: 1.0, // Simple scoring
                document: {
                    id: result.document_id,
                    filename: result.filename,
                    title: result.title,
                    fileType: result.file_type
                },
                metadata: JSON.parse(result.metadata || '{}')
            }));
            
            // Store in session memory if sessionId provided
            if (sessionId && formattedResults.length > 0) {
                const memoryKey = `retrieval_${Date.now()}`;
                const memoryValue = JSON.stringify({
                    query,
                    resultCount: formattedResults.length,
                    topResult: formattedResults[0].text.substring(0, 100)
                });
                
                db.run(`
                    INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [sessionId, memoryKey, memoryValue, 0.7]);
            }
            
            return formattedResults;
        } catch (error) {
            console.error('Retrieval error:', error);
            return [];
        }
    }
    
    chunkText(text) {
        const chunks = [];
        let start = 0;
        
        while (start < text.length) {
            const end = Math.min(start + this.chunkSize, text.length);
            let chunkEnd = end;
            
            // Try to break at sentence or word boundary
            if (end < text.length) {
                const periodIndex = text.lastIndexOf('.', end);
                const spaceIndex = text.lastIndexOf(' ', end);
                
                if (periodIndex > start + this.chunkSize * 0.5) {
                    chunkEnd = periodIndex + 1;
                } else if (spaceIndex > start + this.chunkSize * 0.5) {
                    chunkEnd = spaceIndex;
                }
            }
            
            chunks.push(text.substring(start, chunkEnd).trim());
            start = chunkEnd - this.overlap;
            
            // Ensure we're making progress
            if (start >= text.length - this.overlap) {
                break;
            }
        }
        
        return chunks.filter(chunk => chunk.length > 10); // Filter out very small chunks
    }
    
    detectFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const typeMap = {
            'txt': 'text',
            'md': 'markdown',
            'pdf': 'pdf',
            'doc': 'document',
            'docx': 'document',
            'ppt': 'presentation',
            'pptx': 'presentation',
            'csv': 'spreadsheet',
            'json': 'json',
            'xml': 'xml',
            'html': 'html'
        };
        
        return typeMap[ext] || 'text';
    }
    
    async getDocumentChunks(documentId) {
        try {
            const db = require('./stateStore').db;
            if (!db) {
                return [];
            }
            
            const chunks = db.all(`
                SELECT * FROM document_chunks
                WHERE document_id = ?
                ORDER BY chunk_index
            `, [documentId]);
            
            return chunks.map(chunk => ({
                ...chunk,
                metadata: JSON.parse(chunk.metadata || '{}')
            }));
        } catch (error) {
            console.error('Error getting document chunks:', error);
            return [];
        }
    }
    
    async deleteDocument(documentId) {
        try {
            const db = require('./stateStore').db;
            if (!db) {
                return false;
            }
            
            // Delete chunks first (foreign key constraint)
            db.run('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);
            
            // Delete document
            db.run('DELETE FROM documents WHERE id = ?', [documentId]);
            
            return true;
        } catch (error) {
            console.error('Error deleting document:', error);
            return false;
        }
    }
}

module.exports = new RetrievalService();
