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
            notes: slide.notes || null,
            narration_text: slide.narrationText || null,
            narration_audio_path: slide.narrationAudioPath || null,
            narration_audio_url: slide.narrationAudioUrl || null,
            narration_audio_duration_ms: Number.isFinite(slide.narrationAudioDurationMs) ? slide.narrationAudioDurationMs : null,
            narration_audio_source: slide.narrationAudioSource || 'local',
            narration_metadata_json: slide.narrationMetadataJson || {},
            narration_generated_at: slide.narrationGeneratedAt || null
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

    async updateSlideNarration(sessionId, slideIndex, updates) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const payload = {
            narration_generated_at: new Date().toISOString()
        };
        const allowed = [
            'narration_text',
            'narration_audio_path',
            'narration_audio_url',
            'narration_audio_duration_ms',
            'narration_audio_source',
            'narration_metadata_json',
            'narration_generated_at'
        ];

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                payload[key] = updates[key];
            }
        }

        const result = await this.request('vpp_session_slides', {
            session_id: `eq.${sessionId}`,
            slide_index: `eq.${slideIndex}`
        }, {
            method: 'PATCH',
            body: payload,
            prefer: 'return=representation'
        });

        return result && result.length > 0 ? result[0] : null;
    }

    async createQuestionAnswer(answerData) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const now = new Date().toISOString();
        const row = {
            id: answerData.id || uuidv4(),
            session_id: answerData.sessionId,
            question_id: answerData.questionId,
            question_text: answerData.questionText || '',
            submitted_by: answerData.submittedBy || null,
            slide_index: typeof answerData.slideIndex === 'number' ? answerData.slideIndex : null,
            status: answerData.status || 'answered',
            priority: Number.isFinite(answerData.priority) ? answerData.priority : 0,
            answer_title: answerData.answerTitle || null,
            answer_summary: answerData.answerSummary || null,
            answer_text: answerData.answerText || '',
            answer_details: answerData.answerDetails || null,
            answer_audio_path: answerData.answerAudioPath || null,
            answer_audio_url: answerData.answerAudioUrl || null,
            answer_audio_duration_ms: Number.isFinite(answerData.answerAudioDurationMs) ? answerData.answerAudioDurationMs : null,
            audio_source: answerData.audioSource || 'local',
            metadata_json: answerData.metadataJson || {},
            created_at: now,
            updated_at: now,
            answered_at: answerData.answeredAt || now
        };

        const result = await this.request('vpp_session_questions', {}, {
            method: 'POST',
            body: [row],
            prefer: 'return=representation'
        });

        return result[0];
    }

    async updateQuestionAnswer(questionId, updates) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const payload = { updated_at: new Date().toISOString() };
        const allowed = [
            'status',
            'answer_title',
            'answer_summary',
            'answer_text',
            'answer_details',
            'answer_audio_path',
            'answer_audio_url',
            'answer_audio_duration_ms',
            'audio_source',
            'answered_at',
            'priority',
            'metadata_json'
        ];

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                payload[key] = updates[key];
            }
        }

        const result = await this.request('vpp_session_questions', {
            question_id: `eq.${questionId}`
        }, {
            method: 'PATCH',
            body: payload,
            prefer: 'return=representation'
        });

        return result && result.length > 0 ? result[0] : null;
    }

    async uploadQuestionAudio({ sessionId, questionId, audioBuffer, contentType = 'audio/wav' }) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
            throw new Error('Audio buffer is required');
        }

        const bucket = process.env.SUPABASE_QA_AUDIO_BUCKET || 'qa-audio';
        const objectPath = `sessions/${sessionId}/${questionId}.wav`;
        const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`;
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                apikey: this.supabaseServiceRoleKey,
                Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
                'Content-Type': contentType,
                'x-upsert': 'true'
            },
            body: audioBuffer
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Supabase storage upload failed: ${response.status} ${text}`);
        }

        const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
        return {
            bucket,
            objectPath,
            publicUrl
        };
    }

    async uploadSlideAudio({ sessionId, slideIndex, slideTitle = '', audioBuffer, contentType = 'audio/wav' }) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
            throw new Error('Audio buffer is required');
        }

        const bucket = process.env.SUPABASE_SLIDE_AUDIO_BUCKET || 'slide-audio';
        const safeTitle = String(slideTitle || 'slide').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'slide';
        const objectPath = `sessions/${sessionId}/slides/${String(slideIndex).padStart(2, '0')}-${safeTitle}.wav`;
        const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`;
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                apikey: this.supabaseServiceRoleKey,
                Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
                'Content-Type': contentType,
                'x-upsert': 'true'
            },
            body: audioBuffer
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Supabase slide audio upload failed: ${response.status} ${text}`);
        }

        const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
        return {
            bucket,
            objectPath,
            publicUrl
        };
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

    async getSlide(slideId) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const rows = await this.request('vpp_session_slides', {
            id: `eq.${slideId}`,
            select: '*',
            limit: '1'
        });

        return rows && rows.length > 0 ? rows[0] : null;
    }

    async getSlideByIndex(sessionId, slideIndex) {
        if (!this.isConfigured()) {
            throw new Error('Supabase not configured');
        }

        const rows = await this.request('vpp_session_slides', {
            session_id: `eq.${sessionId}`,
            slide_index: `eq.${slideIndex}`,
            select: '*',
            limit: '1'
        });

        return rows && rows.length > 0 ? rows[0] : null;
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
