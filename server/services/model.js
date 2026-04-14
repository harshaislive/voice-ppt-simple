const { AzureOpenAI } = require('openai');
const stateStore = require('./stateStore');

class ModelService {
    constructor() {
        this.failClosed = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

        if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_API_KEY) {
            console.warn('Azure OpenAI credentials not configured');
            this.client = null;
            return;
        }

        this.client = new AzureOpenAI({
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            apiVersion: '2024-08-01-preview'
        });
    }
    
    async generateNarration(context) {
        if (!this.client) {
            if (this.failClosed) {
                throw new Error('Azure OpenAI client is not configured');
            }
            return this.generateMockNarration(context);
        }
        
        try {
            const narrationPrompt = require('../prompts/narrationPrompt');
            const messages = narrationPrompt.buildMessages(context);
            
            const response = await this.client.chat.completions.create({
                model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5.4',
                messages,
                temperature: 0.9,
                max_completion_tokens: 2000
            });
            
            const raw = response.choices[0].message.content;
            return narrationPrompt.parseResponse(raw);
        } catch (error) {
            console.error('Model narration error:', error);
            if (this.failClosed) {
                throw error;
            }
            return this.generateMockNarration(context);
        }
    }
    
    async generateNarrationStream(context, onChunk) {
        if (!this.client) {
            if (this.failClosed) {
                throw new Error('Azure OpenAI client is not configured');
            }
            const text = this.generateMockNarration(context);
            onChunk(text);
            return text;
        }
        
        try {
            const narrationPrompt = require('../prompts/narrationPrompt');
            const messages = narrationPrompt.buildMessages(context);
            
            const stream = await this.client.chat.completions.create({
                model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5.4',
                messages,
                temperature: 0.9,
                max_completion_tokens: 2000,
                stream: true
            });
            
            let fullText = '';
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || '';
                if (delta) {
                    fullText += delta;
                    onChunk(delta, fullText);
                }
            }
            
            return narrationPrompt.parseResponse(fullText);
        } catch (error) {
            console.error('Model narration stream error:', error);
            if (this.failClosed) {
                throw error;
            }
            const text = this.generateMockNarration(context);
            onChunk(text);
            return text;
        }
    }
    
    async classifyQuestions(questions, slideContent) {
        if (!this.client) {
            if (this.failClosed) {
                throw new Error('Azure OpenAI client is not configured');
            }
            return this.mockClassifyQuestions(questions, slideContent);
        }
        
        try {
            const classifyPrompt = require('../prompts/classifyQuestionsPrompt');
            const messages = classifyPrompt.buildMessages(questions, slideContent);
            
            const response = await this.client.chat.completions.create({
                model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5.4',
                messages,
                temperature: 0.3,
                max_completion_tokens: 2000,
                response_format: { type: 'json_object' }
            });
            
            return JSON.parse(response.choices[0].message.content).classifications;
        } catch (error) {
            console.error('Model classification error:', error);
            if (this.failClosed) {
                throw error;
            }
            return this.mockClassifyQuestions(questions, slideContent);
        }
    }
    
    async decideNextAction(context) {
        if (!this.client) {
            if (this.failClosed) {
                throw new Error('Azure OpenAI client is not configured');
            }
            return this.mockDecideNextAction(context);
        }
        
        try {
            const nextStepPrompt = require('../prompts/nextStepPrompt');
            const messages = nextStepPrompt.buildMessages(context);
            
            const response = await this.client.chat.completions.create({
                model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5.4',
                messages,
                temperature: 0.3,
                max_completion_tokens: 2000,
                response_format: { type: 'json_object' }
            });
            
            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Model decision error:', error);
            if (this.failClosed) {
                throw error;
            }
            return this.mockDecideNextAction(context);
        }
    }
    
    // Mock implementations for development
    generateMockNarration(context) {
        const { slideTitle, slideContent, pendingQuestions } = context;
        
        let narration = `Welcome to this section on "${slideTitle}". `;
        narration += `Today we'll explore: ${slideContent.substring(0, 150)}... `;
        
        if (pendingQuestions && pendingQuestions.length > 0) {
            narration += `I see there are ${pendingQuestions.length} questions from the audience. `;
            narration += `We'll address those shortly. `;
        }
        
        narration += `Let's dive in and explore this topic in depth.`;
        
        return narration;
    }
    
    mockClassifyQuestions(questions, slideContent) {
        return questions.map((question, index) => ({
            question,
            priority: Math.floor(Math.random() * 10) + 1,
            shouldAnswerNow: index === 0 && Math.random() > 0.5,
            category: 'general',
            confidence: 0.8,
            reasoning: 'Mock classification for development'
        }));
    }
    
    mockDecideNextAction(context) {
        const { pendingQuestions, currentSlideIndex, totalSlides } = context;
        
        // If there are high priority questions, answer them
        const highPriority = pendingQuestions.filter(q => q.priority >= 8);
        if (highPriority.length > 0) {
            return {
                action: 'answer_questions',
                questionIds: highPriority.map(q => q.id),
                reason: 'High priority questions need attention'
            };
        }
        
        // Otherwise, advance slides
        return {
            action: 'advance',
            direction: 'next',
            reason: 'No urgent questions, continuing presentation'
        };
    }
}

module.exports = new ModelService();
