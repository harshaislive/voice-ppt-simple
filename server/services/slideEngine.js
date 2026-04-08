const modelService = require('./model');

class SlideEngine {
    constructor() {
        this.maxQuestionsBeforePause = 5;
        this.highPriorityThreshold = 8;
    }
    
    async decideNextAction(context) {
        const {
            sessionId,
            currentSlideIndex,
            pendingQuestions,
            direction,
            targetSlide,
            classificationResults
        } = context;
        
        try {
            // If there are no pending questions, advance slide
            if (pendingQuestions.length === 0) {
                return {
                    action: 'advance',
                    direction: direction || 'next',
                    reason: 'No pending questions'
                };
            }
            
            // Check for high priority questions
            const highPriorityQuestions = pendingQuestions.filter(q => 
                (q.priority || 0) >= this.highPriorityThreshold
            );
            
            if (highPriorityQuestions.length > 0) {
                return {
                    action: 'answer_questions',
                    questionIds: highPriorityQuestions.map(q => q.id),
                    reason: 'High priority questions need immediate attention'
                };
            }
            
            // If there are many questions, consider pausing to address them
            if (pendingQuestions.length >= this.maxQuestionsBeforePause) {
                return {
                    action: 'pause_for_questions',
                    questionIds: pendingQuestions.slice(0, 3).map(q => q.id),
                    reason: `Too many questions (${pendingQuestions.length})`
                };
            }
            
            // Use AI model for complex decision making
            const aiDecision = await modelService.decideNextAction({
                sessionId,
                currentSlideIndex,
                pendingQuestions,
                classificationResults,
                direction,
                targetSlide
            });
            
            // Validate AI decision
            if (this.validateDecision(aiDecision)) {
                return aiDecision;
            }
            
            // Fallback to rule-based decision
            return this.ruleBasedDecision(context);
            
        } catch (error) {
            console.error('Slide engine error:', error);
            return this.ruleBasedDecision(context);
        }
    }
    
    ruleBasedDecision(context) {
        const { pendingQuestions, direction } = context;
        
        // Default: advance slide
        if (pendingQuestions.length === 0) {
            return {
                action: 'advance',
                direction: direction || 'next',
                reason: 'No pending questions'
            };
        }
        
        // Check question priorities from classification
        const urgentQuestions = pendingQuestions.filter(q => 
            q.priority && q.priority >= 7
        );
        
        if (urgentQuestions.length > 0) {
            return {
                action: 'answer_questions',
                questionIds: urgentQuestions.map(q => q.id),
                reason: 'Urgent questions detected'
            };
        }
        
        // Check if questions are related to current slide
        const slideRelatedQuestions = pendingQuestions.filter(q => 
            q.slide_index === context.currentSlideIndex
        );
        
        if (slideRelatedQuestions.length > 0) {
            return {
                action: 'answer_questions',
                questionIds: slideRelatedQuestions.slice(0, 2).map(q => q.id),
                reason: 'Questions related to current slide'
            };
        }
        
        // Default: continue with presentation
        return {
            action: 'advance',
            direction: direction || 'next',
            reason: 'Proceeding with presentation flow'
        };
    }
    
    validateDecision(decision) {
        const validActions = ['advance', 'pause_for_questions', 'answer_questions', 'jump_to_slide'];
        
        if (!decision || !decision.action) {
            return false;
        }
        
        if (!validActions.includes(decision.action)) {
            return false;
        }
        
        // Additional validation per action
        switch (decision.action) {
            case 'answer_questions':
                return decision.questionIds && Array.isArray(decision.questionIds) && decision.questionIds.length > 0;
            case 'jump_to_slide':
                return decision.targetSlide !== undefined && typeof decision.targetSlide === 'number';
            default:
                return true;
        }
    }
    
    async analyzeAudienceEngagement(sessionId, db) {
        try {
            // Get recent questions
            const recentQuestions = db.prepare(`
                SELECT * FROM questions
                WHERE session_id = ?
                ORDER BY created_at DESC
                LIMIT 10
            `).all(sessionId);
            
            // Get audience memory
            const audienceMemory = db.prepare(`
                SELECT * FROM audience_memory
                WHERE session_id = ?
                ORDER BY updated_at DESC
                LIMIT 20
            `).all(sessionId);
            
            // Calculate engagement metrics
            const metrics = {
                questionFrequency: recentQuestions.length,
                averagePriority: recentQuestions.reduce((sum, q) => sum + (q.priority || 0), 0) / recentQuestions.length || 0,
                answeredQuestions: recentQuestions.filter(q => q.status === 'answered').length,
                memorySize: audienceMemory.length
            };
            
            // Store engagement metrics
            db.prepare(`
                INSERT INTO audience_memory (session_id, key, value, confidence, created_at, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(
                sessionId,
                'engagement_metrics',
                JSON.stringify(metrics),
                0.9
            );
            
            return metrics;
        } catch (error) {
            console.error('Error analyzing engagement:', error);
            return null;
        }
    }
    
    getSlideTransitionRules() {
        return {
            // How many slides to advance in different situations
            default: 1,
            urgentQuestion: 0, // Pause for urgent questions
            manyQuestions: 0,
            lowEngagement: 2, // Speed up if engagement is low
            complexSlide: 0, // Stay on complex slides
            summarySlide: 1 // Move quickly through summaries
        };
    }
}

module.exports = new SlideEngine();
