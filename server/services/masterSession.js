const supabaseSession = require('./supabaseSession');

class MasterSessionService {
    async getMasterAssets(deckId) {
        if (!supabaseSession.isConfigured()) return null;

        try {
            // 1. Find the presentation to get its master_session_id
            // Use query string for filters in .request()
            const presentations = await supabaseSession.request(`presentations?slug=eq.${deckId}&select=master_session_id`);

            if (!presentations || presentations.length === 0 || !presentations[0].master_session_id) {
                return null;
            }

            const masterSessionId = presentations[0].master_session_id;
            console.log(`[MasterSession] Found master session ${masterSessionId} for deck ${deckId}`);

            // 2. Fetch all slides for that master session
            const slides = await supabaseSession.getSlides(masterSessionId);
            
            if (!slides || slides.length === 0) {
                console.warn(`[MasterSession] Master session ${masterSessionId} has no slides`);
                return null;
            }

            // 3. Map slides by index for easy lookup
            const assets = new Map();
            slides.forEach(slide => {
                if (slide.narration_text && (slide.narration_audio_path || slide.narration_audio_url)) {
                    assets.set(slide.slide_index, {
                        ...slide // Spread all properties including audio paths and metadata
                    });
                }
            });

            return {
                masterSessionId,
                assets
            };
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

            console.log(`[MasterSession] Sealed session ${sessionId} as master for deck ${deckId}`);
            return result;
        } catch (error) {
            console.error(`[MasterSession] Failed to seal session ${sessionId} as master:`, error.message);
            throw error;
        }
    }
}

module.exports = new MasterSessionService();
