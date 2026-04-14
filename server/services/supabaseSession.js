const { v4: uuidv4 } = require('uuid');

class SupabaseSessionService {
    constructor() {
        this.supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
        this.supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        this.initialized = false;
    }

    isConfigured() {
        return Boolean(this.supabaseUrl && this.supabaseServiceRoleKey);
    }

    async request(table, params = {}, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                query.append(key, String(value));
            }
        }

        const url = `${this.supabaseUrl}/rest/v1/${table}?${query.toString()}`;
        const method = options.method || 'GET';
        const headers = {
            apikey: this.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Prefer: options.prefer || 'return=representation',
            'Accept-Profile': 'public'
        };

        const fetchOptions = { method, headers };
        if (options.body) {
            fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Supabase ${table} request failed: ${response.status} ${text}`);
        }

        if (response.status === 204) return null;

        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    async ensureTablesExist() {
        if (!this.isConfigured()) {
            console.log('[SupabaseSession] Not configured, skipping table creation');
            return false;
        }

        try {
            // Check if tables exist by trying to query them
            await this.request('vpp_sessions', { select: 'id', limit: '1' });
            this.initialized = true;
            console.log('[SupabaseSession] Tables verified');
            return true;
        } catch (error) {
            console.log('[SupabaseSession] Tables may not exist, will create on first use');
            return false;
        }
    }

    async createSession(sessionData) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const now = new Date().toISOString();
        const session = {
            id: sessionData.id,
            deck_id: sessionData.deckId,
            control_token_hash: sessionData.controlTokenHash,
            current_slide_index: sessionData.currentSlideIndex || 0,
            status: sessionData.status || 'active',
            metadata: typeof sessionData.metadata === 'string' ? sessionData.metadata : JSON.stringify(sessionData.metadata || {}),
            created_at: now,
            updated_at: now
        };

        const result = await this.request('vpp_sessions', {}, {
            method: 'POST',
            body: [session],
            prefer: 'return=representation'
        });

        console.log('[SupabaseSession] Created session:', session.id);
        return result[0];
    }

    async getSession(sessionId) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const rows = await this.request('vpp_sessions', {
            id: `eq.${sessionId}`,
            select: '*'
        });

        return rows && rows.length > 0 ? rows[0] : null;
    }

    async updateSession(sessionId, updates) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const setClause = {};
        const allowedFields = ['current_slide_index', 'status', 'metadata', 'updated_at'];
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                setClause[key] = key === 'metadata' && typeof value !== 'string' ? JSON.stringify(value) : value;
            }
        }
        setClause.updated_at = new Date().toISOString();

        const result = await this.request('vpp_sessions', {
            id: `eq.${sessionId}`
        }, {
            method: 'PATCH',
            body: setClause,
            prefer: 'return=representation'
        });

        console.log('[SupabaseSession] Updated session:', sessionId, setClause);
        return result && result.length > 0 ? result[0] : null;
    }

    async createSlides(sessionId, slides) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const now = new Date().toISOString();
        const slideRows = slides.map((slide, index) => ({
            id: uuidv4(),
            session_id: sessionId,
            slide_index: index,
            title: slide.title || '',
            content: slide.content || '',
            image: slide.image || null,
            notes: slide.notes || null
        }));

        if (slideRows.length === 0) return [];

        const result = await this.request('vpp_session_slides', {}, {
            method: 'POST',
            body: slideRows,
            prefer: 'return=representation'
        });

        console.log('[SupabaseSession] Created', result.length, 'slides for session:', sessionId);
        return result;
    }

    async getSlides(sessionId) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const rows = await this.request('vpp_session_slides', {
            session_id: `eq.${sessionId}`,
            select: '*',
            order: 'slide_index.asc'
        });

        return rows || [];
    }

    async getSessionWithSlides(sessionId) {
        const [session, slides] = await Promise.all([
            this.getSession(sessionId),
            this.getSlides(sessionId)
        ]);

        if (!session) return null;

        return {
            session,
            slides
        };
    }
}

module.exports = new SupabaseSessionService();
