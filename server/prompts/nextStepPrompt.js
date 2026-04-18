class NextStepPrompt {
    buildMessages(context) {
        const {
            sessionId,
            currentSlideIndex,
            pendingQuestions,
            classificationResults,
            direction,
            targetSlide,
            audienceMemory,
            totalSlides
        } = context;
        
        const systemPrompt = `You are an AI presentation assistant deciding the next action in a presentation.
Your task is to analyze the current situation and recommend the best next action.

Available actions:
1. "advance" - Move to next/previous slide
2. "pause_for_questions" - Pause presentation to answer questions
3. "answer_questions" - Immediately answer specific questions
4. "jump_to_slide" - Jump to a specific slide

Consider these factors:
- Number and priority of pending questions
- Question categories and whether they need immediate attention
- Session context and recent user intent
- Presentation flow and momentum
- Slide content and importance

Guidelines:
- High priority questions (7+) should be answered immediately
- More than 5 pending questions may require a pause
- If questions are on-topic, address them sooner
- If questions are off-topic, defer them
- Consider the presentation flow - don't interrupt key moments

Output ONLY valid JSON:
{
  "action": "advance|pause_for_questions|answer_questions|jump_to_slide",
  "direction": "next|prev" (for advance),
  "targetSlide": number (for jump_to_slide),
  "questionIds": ["id1", "id2"] (for answer_questions),
  "reason": "explanation for decision"
}`;

        let userPrompt = `Current Presentation State:
- Session ID: ${sessionId}
- Current Slide: ${currentSlideIndex} of ${totalSlides || 'unknown'}
- Direction: ${direction || 'next'}
- Target Slide: ${targetSlide !== null ? targetSlide : 'none'}`;

        if (pendingQuestions && pendingQuestions.length > 0) {
            userPrompt += `\n\nPending Questions (${pendingQuestions.length}):`;
            pendingQuestions.forEach((q, i) => {
                userPrompt += `\n${i + 1}. [Priority: ${q.priority || 'unknown'}] "${q.question_text || q.text || 'Unknown question'}"`;
            });
        } else {
            userPrompt += `\n\nNo pending questions.`;
        }

        if (classificationResults && classificationResults.length > 0) {
            userPrompt += `\n\nClassification Results:`;
            classificationResults.forEach((c, i) => {
                userPrompt += `\n${i + 1}. Category: ${c.category}, Priority: ${c.priority}, Answer Now: ${c.shouldAnswerNow}`;
            });
        }

        if (audienceMemory && Object.keys(audienceMemory).length > 0) {
            userPrompt += `\n\nSession Context:`;
            Object.entries(audienceMemory).forEach(([key, value]) => {
                userPrompt += `\n- ${key}: ${value}`;
            });
        }

        userPrompt += `\n\nBased on this analysis, what should be the next action?`;

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
    }
    
    parseResponse(response) {
        try {
            // If response is already parsed JSON
            if (typeof response === 'object') {
                return response;
            }
            
            // Try to parse as JSON
            return JSON.parse(response);
        } catch (error) {
            console.error('Error parsing next step response:', error);
            // Return default safe action
            return {
                action: 'advance',
                direction: 'next',
                reason: 'Default fallback: continue presentation'
            };
        }
    }
    
    getExampleResponse() {
        return {
            action: "pause_for_questions",
            direction: "next",
            questionIds: ["q123", "q456"],
            reason: "Multiple high-priority questions on current slide content need addressing before proceeding"
        };
    }
    
    getActionDescriptions() {
        return {
            advance: "Continue with presentation flow",
            pause_for_questions: "Pause to address multiple questions",
            answer_questions: "Immediately answer specific questions",
            jump_to_slide: "Jump to a different slide for context"
        };
    }
    
    getDecisionCriteria() {
        return {
            questionPriorityThreshold: 7,
            maxPendingBeforePause: 5,
            slideImportanceFactors: ['title', 'summary', 'key-point'],
            engagementIndicators: ['questionFrequency', 'questionRelevance']
        };
    }
}

module.exports = new NextStepPrompt();
