class ClassifyQuestionsPrompt {
    buildMessages(questions, slideContent) {
        const systemPrompt = `You are an AI assistant that classifies user questions during a presentation.
Your task is to analyze questions and determine:
1. Category (clarification, expansion, contradiction, example, application, general)
2. Priority (1-10 scale, 10 being highest)
3. Whether it should be answered now or can wait
4. Brief reasoning for your classification

Categories:
- CLARIFICATION: Questions asking for clarification of content
- EXPANSION: Questions asking to expand on topics
- CONTRADICTION: Questions pointing out contradictions or inconsistencies
- EXAMPLE: Questions requesting examples
- APPLICATION: Questions about how to apply concepts
- GENERAL: General questions

Priority Guidelines:
- 8-10: Urgent, contradiction or critical clarification
- 5-7: Important, related to current slide
- 3-4: Moderate, general interest
- 1-2: Low priority, tangential

Output ONLY valid JSON with this structure:
{
  "classifications": [
    {
      "question": "original question text",
      "category": "CATEGORY_NAME",
      "priority": 5,
      "shouldAnswerNow": false,
      "confidence": 0.9,
      "reasoning": "brief explanation"
    }
  ]
}`;

        const slideContext = `Current Slide Content: "${slideContent}"`;
        
        let questionsList = "Questions to classify:\n";
        questions.forEach((q, i) => {
            questionsList += `${i + 1}. "${q}"\n`;
        });

        const userPrompt = `${slideContext}\n\n${questionsList}\nPlease classify each question according to the guidelines.`;

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
    }
    
    parseResponse(response) {
        try {
            // If response is already parsed JSON
            if (typeof response === 'object') {
                return response.classifications || response;
            }
            
            // Try to parse as JSON
            const parsed = JSON.parse(response);
            return parsed.classifications || [];
        } catch (error) {
            console.error('Error parsing classification response:', error);
            return [];
        }
    }
    
    getExampleResponse() {
        return {
            classifications: [
                {
                    question: "Can you explain what you mean by 'sustainable returns'?",
                    category: "CLARIFICATION",
                    priority: 7,
                    shouldAnswerNow: true,
                    confidence: 0.95,
                    reasoning: "Asks for clarification of key term on current slide"
                },
                {
                    question: "How does this compare to traditional forestry investments?",
                    category: "EXPANSION",
                    priority: 5,
                    shouldAnswerNow: false,
                    confidence: 0.85,
                    reasoning: "Request for expansion, can be addressed in Q&A"
                },
                {
                    question: "I heard earlier that returns were 8%, but now you say 12%?",
                    category: "CONTRADICTION",
                    priority: 9,
                    shouldAnswerNow: true,
                    confidence: 0.98,
                    reasoning: "Points out apparent contradiction, needs immediate clarification"
                },
                {
                    question: "Could you give an example of a specific forest project?",
                    category: "EXAMPLE",
                    priority: 4,
                    shouldAnswerNow: false,
                    confidence: 0.9,
                    reasoning: "Request for example, can be deferred"
                },
                {
                    question: "How would I invest as an individual with limited capital?",
                    category: "APPLICATION",
                    priority: 6,
                    shouldAnswerNow: false,
                    confidence: 0.8,
                    reasoning: "Application question relevant but not urgent"
                }
            ]
        };
    }
    
    getCategories() {
        return {
            CLARIFICATION: "Questions asking for clarification of content",
            EXPANSION: "Questions asking to expand on topics",
            CONTRADICTION: "Questions pointing out contradictions or inconsistencies",
            EXAMPLE: "Questions requesting examples",
            APPLICATION: "Questions about how to apply concepts",
            GENERAL: "General questions"
        };
    }
}

module.exports = new ClassifyQuestionsPrompt();
