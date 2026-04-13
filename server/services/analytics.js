const cmsService = require('./cms');

class AnalyticsService {
    isConfigured() {
        return cmsService.isSupabaseConfigured();
    }

    async logSessionStart(sessionId, projectSlug, presentationSlug, participantName, totalSlides) {
        if (!this.isConfigured()) return;
        try {
            const result = await cmsService.request('analytics_sessions', { on_conflict: 'session_id' }, {
                method: 'POST',
                body: [{
                    session_id: sessionId,
                    project_slug: projectSlug,
                    presentation_slug: presentationSlug,
                    participant_name: participantName,
                    total_slides: totalSlides
                }],
                prefer: 'resolution=merge-duplicates,return=representation'
            });
            console.log(`[Analytics] logSessionStart: sessionId=${sessionId}, projectSlug=${projectSlug}, result=`, result);
        } catch (err) {
            console.error('Analytics logSessionStart failed:', err.message);
        }
    }

    async logSessionEnd(sessionId, questionsAsked) {
        if (!this.isConfigured()) return;
        try {
            const result = await cmsService.request(`analytics_sessions`, { session_id: `eq.${sessionId}` }, {
                method: 'PATCH',
                body: {
                    ended_at: new Date().toISOString(),
                    questions_asked: questionsAsked
                }
            });
            console.log(`[Analytics] logSessionEnd: sessionId=${sessionId}, questionsAsked=${questionsAsked}, result=`, result);
        } catch (err) {
            console.error('Analytics logSessionEnd failed:', err.message);
        }
    }

    async logEvent(sessionId, eventType, slideIndex, content, metadata = {}) {
        if (!this.isConfigured()) return;
        try {
            await cmsService.request('analytics_events', {}, {
                method: 'POST',
                body: [{
                    session_id: sessionId,
                    event_type: eventType,
                    slide_index: slideIndex,
                    content: typeof content === 'string' ? content : JSON.stringify(content),
                    metadata_json: metadata
                }]
            });
        } catch (err) {
            console.error('Analytics logEvent failed:', err.message);
        }
    }
}

module.exports = new AnalyticsService();
