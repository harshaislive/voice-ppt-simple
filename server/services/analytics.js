const cmsService = require('./cms');
const { getLogger } = require('../middleware/logger');

class AnalyticsService {
    isConfigured() {
        return cmsService.isSupabaseConfigured();
    }

    async logSessionStart(sessionId, projectSlug, presentationSlug, participantName, totalSlides) {
        const logger = getLogger().child({ subsystem: 'analytics', sessionId });
        if (!this.isConfigured()) return;
        try {
            await cmsService.request('analytics_sessions', { on_conflict: 'session_id' }, {
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
            logger.info({ event: 'session_start_analytics_persisted', projectSlug, presentationSlug, totalSlides });
        } catch (err) {
            logger.error({ event: 'session_start_analytics_failed', err: err.message });
        }
    }

    async logSessionEnd(sessionId, questionsAsked) {
        const logger = getLogger().child({ subsystem: 'analytics', sessionId });
        if (!this.isConfigured()) return;
        try {
            await cmsService.request(`analytics_sessions`, { session_id: `eq.${sessionId}` }, {
                method: 'PATCH',
                body: {
                    ended_at: new Date().toISOString(),
                    questions_asked: questionsAsked
                }
            });
            logger.info({ event: 'session_end_analytics_persisted', questionsAsked });
        } catch (err) {
            logger.error({ event: 'session_end_analytics_failed', err: err.message });
        }
    }

    async logEvent(sessionId, eventType, slideIndex, content, metadata = {}) {
        const logger = getLogger().child({ subsystem: 'analytics', sessionId });
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
            logger.info({ event: 'analytics_event_persisted', eventType, slideIndex });
        } catch (err) {
            logger.error({ event: 'analytics_event_persist_failed', eventType, slideIndex, err: err.message });
        }
    }
}

module.exports = new AnalyticsService();
