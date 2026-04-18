const modelService = require('./model');

class QuestionClassifier {
    constructor() {
        this.categories = {
            CLARIFICATION: 'clarification',
            EXPANSION: 'expansion',
            CONTRADICTION: 'contradiction',
            EXAMPLE: 'example',
            APPLICATION: 'application',
            GENERAL: 'general'
        };
        
        this.priorityMapping = {
            clarification: 5,
            contradiction: 8,
            expansion: 3,
            example: 4,
            application: 6,
            general: 2
        };
    }

    isInterruptWorthyQuestion(question) {
        const lowerQuestion = String(question || '').toLowerCase();
        if (!lowerQuestion.trim()) {
            return false;
        }

        return [
            /but you said/,
            /contradiction/,
            /how does this reconcile/,
            /\bi'?m confused\b/,
            /\bi am confused\b/,
            /what do you mean/,
            /can you explain/,
            /clarify/,
            /\bprice\b/,
            /\bcost\b/,
            /\bpricing\b/,
            /\bbook\b/,
            /\bbooking\b/,
            /\btrial\b/,
            /\bcontact\b/,
            /\bemail\b/,
            /next step/,
            /how do i proceed/,
            /what happens next/
        ].some((pattern) => pattern.test(lowerQuestion));
    }
    
    async classifyQuestions(questions, slideContent) {
        if (!questions || questions.length === 0) {
            return [];
        }
        
        try {
            // Use AI model for classification
            const aiClassifications = await modelService.classifyQuestions(questions, slideContent);
            
            // Merge with rule-based classifications
            const classifications = questions.map((question, index) => {
                const aiResult = aiClassifications[index] || {};
                const ruleBased = this.ruleBasedClassification(question, slideContent);
                const interruptWorthy = this.isInterruptWorthyQuestion(question);
                
                // Prioritize AI classification if confident
                if (aiResult.confidence && aiResult.confidence > 0.7) {
                    return {
                        question,
                        category: aiResult.category || this.categories.GENERAL,
                        priority: aiResult.priority || this.priorityMapping[aiResult.category] || 5,
                        shouldAnswerNow: interruptWorthy,
                        confidence: aiResult.confidence,
                        reasoning: aiResult.reasoning || 'AI classification'
                    };
                }
                
                // Fallback to rule-based
                return ruleBased;
            });
            
            // Adjust priorities based on order
            return this.adjustPriorities(classifications);
        } catch (error) {
            console.error('Classification error:', error);
            return questions.map(question => 
                this.ruleBasedClassification(question, slideContent)
            );
        }
    }
    
    ruleBasedClassification(question, slideContent) {
        const lowerQuestion = question.toLowerCase();
        const lowerContent = (slideContent || '').toLowerCase();
        
        let category = this.categories.GENERAL;
        let priority = 5;
        let shouldAnswerNow = this.isInterruptWorthyQuestion(question);
        let reasoning = 'Rule-based classification';
        
        // Check for clarification questions
        if (lowerQuestion.includes('what do you mean') || 
            lowerQuestion.includes('can you explain') ||
            lowerQuestion.includes('clarify')) {
            category = this.categories.CLARIFICATION;
            priority = 6;
            reasoning = 'Clarification question about content';
        }
        
        // Check for contradiction questions
        else if (lowerQuestion.includes('but you said') ||
                 lowerQuestion.includes('contradiction') ||
                 lowerQuestion.includes('how does this reconcile')) {
            category = this.categories.CONTRADICTION;
            priority = 9;
            shouldAnswerNow = true;
            reasoning = 'Potential contradiction needs addressing';
        }
        
        // Check for example requests
        else if (lowerQuestion.includes('can you give an example') ||
                 lowerQuestion.includes('for instance') ||
                 lowerQuestion.includes('such as')) {
            category = this.categories.EXAMPLE;
            priority = 4;
            shouldAnswerNow = false;
            reasoning = 'Example request can be deferred';
        }
        
        // Check for expansion requests
        else if (lowerQuestion.includes('tell me more') ||
                 lowerQuestion.includes('expand on') ||
                 lowerQuestion.includes('go deeper')) {
            category = this.categories.EXPANSION;
            priority = 3;
            shouldAnswerNow = false;
            reasoning = 'Expansion request can be addressed later';
        }
        
        // Check for application questions
        else if (lowerQuestion.includes('how would i') ||
                 lowerQuestion.includes('in my case') ||
                 lowerQuestion.includes('application')) {
            category = this.categories.APPLICATION;
            priority = 6;
            reasoning = 'Application question relevant but not urgent';
        }
        
        // Check relevance to current slide
        const questionWords = lowerQuestion.split(/\s+/);
        const contentWords = lowerContent.split(/\s+/);
        const commonWords = questionWords.filter(word => 
            contentWords.includes(word) && word.length > 3
        );
        
        const relevance = commonWords.length / Math.max(questionWords.length, 1);
        if (relevance > 0.4) {
            priority += 2;
            reasoning = 'Highly relevant to current slide';
        }
        
        return {
            question,
            category,
            priority,
            shouldAnswerNow,
            confidence: 0.8,
            reasoning
        };
    }
    
    adjustPriorities(classifications) {
        // Sort by priority descending
        const sorted = [...classifications].sort((a, b) => b.priority - a.priority);
        
        // Adjust priorities based on sequence
        return classifications.map((classification, index) => {
            const sortedIndex = sorted.findIndex(c => c.question === classification.question);
            const positionFactor = (sorted.length - sortedIndex) / sorted.length;
            
            // Boost priority for questions that are already high
            let adjustedPriority = classification.priority;
            if (classification.priority >= 7) {
                adjustedPriority = Math.min(10, adjustedPriority + 2);
            }
            
            // Adjust based on position
            adjustedPriority = Math.round(adjustedPriority * (0.8 + 0.4 * positionFactor));
            
            // Update shouldAnswerNow based on adjusted priority
            const shouldAnswerNow = Boolean(classification.shouldAnswerNow);
            
            return {
                ...classification,
                priority: adjustedPriority,
                shouldAnswerNow,
                confidence: Math.max(0.6, classification.confidence - (index * 0.05))
            };
        });
    }
    
    categorizeQuestionsBatch(questions, slideContent) {
        const results = {
            clarification: [],
            expansion: [],
            contradiction: [],
            example: [],
            application: [],
            general: []
        };
        
        questions.forEach(question => {
            const classification = this.ruleBasedClassification(question, slideContent);
            results[classification.category].push({
                question,
                priority: classification.priority,
                shouldAnswerNow: classification.shouldAnswerNow
            });
        });
        
        return results;
    }
    
    getCategoryInfo() {
        return {
            categories: this.categories,
            priorityMapping: this.priorityMapping
        };
    }
}

module.exports = new QuestionClassifier();
