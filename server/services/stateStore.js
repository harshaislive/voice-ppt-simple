class StateStore {
    constructor() {
        this.db = null;
        this.cache = new Map();
        this.cacheTTL = 5000; // 5 seconds
    }
    
    initialize(db) {
        this.db = db;
    }
    
    // Session operations
    async getSession(sessionId) {
        const cacheKey = `session_${sessionId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;
        
        const session = this.db.get(`
            SELECT * FROM sessions WHERE id = ?
        `, [sessionId]);
        
        if (session) {
            this.setCache(cacheKey, session);
        }
        
        return session;
    }
    
    async updateSession(sessionId, updates) {
        const allowedFields = ['current_slide_index', 'status'];
        const setClauses = [];
        const values = [];
        
        for (const [field, value] of Object.entries(updates)) {
            if (allowedFields.includes(field)) {
                setClauses.push(`${field} = ?`);
                values.push(value);
            }
        }
        
        if (setClauses.length === 0) return false;
        
        values.push(sessionId);
        
        this.db.run(`
            UPDATE sessions
            SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, values);
        
        // Clear cache
        this.clearCache(`session_${sessionId}`);
        
        return true;
    }
    
    // Slide operations
    async getCurrentSlide(sessionId) {
        const cacheKey = `slide_${sessionId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;
        
        const slide = this.db.get(`
            SELECT sl.* FROM slides sl
            JOIN sessions s ON sl.session_id = s.id AND sl.slide_index = s.current_slide_index
            WHERE s.id = ?
        `, [sessionId]);
        
        if (slide) {
            this.setCache(cacheKey, slide);
        }
        
        return slide;
    }
    
    async getSlideByIndex(sessionId, slideIndex) {
        return this.db.get(`
            SELECT * FROM slides
            WHERE session_id = ? AND slide_index = ?
        `, [sessionId, slideIndex]);
    }
    
    async getTotalSlides(sessionId) {
        const cacheKey = `total_slides_${sessionId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached !== undefined) return cached;
        
        const result = this.db.get(`
            SELECT COUNT(*) as count FROM slides WHERE session_id = ?
        `, [sessionId]);
        
        const count = result ? result.count : 0;
        this.setCache(cacheKey, count);
        return count;
    }
    
    // Question operations
    async getPendingQuestions(sessionId, limit = 10) {
        return this.db.all(`
            SELECT * FROM questions
            WHERE session_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT ?
        `, [sessionId, limit]);
    }
    
    async updateQuestionPriority(questionId, priority) {
        this.db.run(`
            UPDATE questions SET priority = ? WHERE id = ?
        `, [priority, questionId]);
        
        this.clearCache(`questions_${questionId}`);
    }
    
    // Audience memory operations
    async getAudienceMemory(sessionId, limit = 20) {
        return this.db.all(`
            SELECT * FROM audience_memory
            WHERE session_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
        `, [sessionId, limit]);
    }
    
    async setAudienceMemory(sessionId, key, value, confidence = 1.0) {
        // Check if exists
        const existing = this.db.get(`
            SELECT id FROM audience_memory
            WHERE session_id = ? AND key = ?
        `, [sessionId, key]);
        
        if (existing) {
            // Update
            this.db.run(`
                UPDATE audience_memory
                SET value = ?, confidence = ?, updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ? AND key = ?
            `, [value, confidence, sessionId, key]);
        } else {
            // Insert
            this.db.run(`
                INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [sessionId, key, value, confidence]);
        }
        
        this.clearCache(`memory_${sessionId}`);
    }
    
    async getAudienceMemoryByKey(sessionId, key) {
        const cacheKey = `memory_${sessionId}_${key}`;
        const cached = this.getFromCache(cacheKey);
        if (cached !== undefined) return cached;
        
        const result = this.db.get(`
            SELECT value, confidence FROM audience_memory
            WHERE session_id = ? AND key = ?
        `, [sessionId, key]);
        
        if (result) {
            this.setCache(cacheKey, result.value);
        }
        
        return result ? result.value : null;
    }
    
    // Event recording
    async recordEvent(sessionId, eventType, eventData) {
        this.db.run(`
            INSERT INTO events (session_id, event_type, event_data, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `, [sessionId, eventType, JSON.stringify(eventData)]);
    }
    
    async getRecentEvents(sessionId, limit = 50) {
        return this.db.all(`
            SELECT * FROM events
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `, [sessionId, limit]);
    }
    
    // Cache management
    getFromCache(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() - item.timestamp > this.cacheTTL) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }
    
    setCache(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }
    
    clearCache(key) {
        this.cache.delete(key);
    }
    
    clearSessionCache(sessionId) {
        for (const key of this.cache.keys()) {
            if (key.includes(sessionId)) {
                this.cache.delete(key);
            }
        }
    }
    
    // Health check
    async healthCheck() {
        try {
            this.db.get('SELECT 1');
            return true;
        } catch (error) {
            console.error('Database health check failed:', error);
            return false;
        }
    }
    
    // Get statistics
    async getSessionStats(sessionId) {
        const stats = {};
        
        // Question stats
        const questionStats = this.db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
                AVG(priority) as average_priority
            FROM questions WHERE session_id = ?
        `, [sessionId]);
        
        stats.questions = questionStats || {
            total: 0,
            pending: 0,
            answered: 0,
            average_priority: 0
        };
        
        // Slide stats
        const slideStats = this.db.get(`
            SELECT 
                COUNT(*) as total_slides,
                MAX(slide_index) as max_index
            FROM slides WHERE session_id = ?
        `, [sessionId]);
        
        stats.slides = slideStats || {
            total_slides: 0,
            max_index: 0
        };
        
        // Event stats
        const eventStats = this.db.get(`
            SELECT 
                COUNT(*) as total_events,
                MIN(created_at) as first_event,
                MAX(created_at) as last_event
            FROM events WHERE session_id = ?
        `, [sessionId]);
        
        stats.events = eventStats || {
            total_events: 0,
            first_event: null,
            last_event: null
        };
        
        return stats;
    }
}

module.exports = new StateStore();
