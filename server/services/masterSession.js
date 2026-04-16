const supabaseSession = require('./supabaseSession');

class MasterSessionService {
    constructor() {
        // In-memory TTL cache — master assets change rarely; avoids 2 Supabase
        // round-trips (presentations + vpp_session_slides) on every session start.
        this._cache = new Map(); // deckId -> { data, expiresAt }
        this._cacheTtlMs = 5 * 60 * 1000; // 5 minutes
    }

    async getMasterAssets(deckId) {
        if (!supabaseSession.isConfigured()) return null;

        // Return cached result if still fresh
        const cached = this._cache.get(deckId);
        if (cached && cached.expiresAt > Date.now()) {
            console.log(`[MasterSession] Cache hit for deck ${deckId}`);
            return cached.data;
        }

        try {
            // 1. Find the presentation to get its master_session_id
            const presentations = await supabaseSession.request(`presentations?slug=eq.${deckId}&select=master_session_id`);

            if (!presentations || presentations.length === 0 || !presentations[0].master_session_id) {
                // Cache null result too so we don't hammer Supabase on missing masters
                this._cache.set(deckId, { data: null, expiresAt: Date.now() + this._cacheTtlMs });
                return null;
            }

            const masterSessionId = presentations[0].master_session_id;
            console.log(`[MasterSession] Found master session ${masterSessionId} for deck ${deckId}`);

            // 2. Fetch all slides for that master session
            const slides = await supabaseSession.getSlides(masterSessionId);

            if (!slides || slides.length === 0) {
                console.warn(`[MasterSession] Master session ${masterSessionId} has no slides`);
                this._cache.set(deckId, { data: null, expiresAt: Date.now() + this._cacheTtlMs });
                return null;
            }

            // 3. Map slides by index for easy lookup
            const assets = new Map();
            slides.forEach(slide => {
                if (slide.narration_text && (slide.narration_audio_path || slide.narration_audio_url)) {
                    assets.set(slide.slide_index, { ...slide });
                }
            });

            const result = { masterSessionId, assets };
            this._cache.set(deckId, { data: result, expiresAt: Date.now() + this._cacheTtlMs });
            return result;
        } catch (error) {
            console.error(`[MasterSession] Failed to fetch master assets for ${deckId}:`, error.message);
            return null;
        }
    }

    async sealAsMaster(deckId, sessionId) {
        if (!supabaseSession.isConfigured()) throw new Error('Supabase not configured');

        try {
            const result = await supabaseSession.request(`presentations?slug=eq.${deckId}`, {
                method: 'PATCH',
                body: { master_session_id: sessionId }
            });

            // Invalidate cache so next load picks up the new master immediately
            this._cache.delete(deckId);
            console.log(`[MasterSession] Sealed session ${sessionId} as master for deck ${deckId}`);
            return result;
        } catch (error) {
            console.error(`[MasterSession] Failed to seal session ${sessionId} as master:`, error.message);
            throw error;
        }
    }
}

module.exports = new MasterSessionService();
