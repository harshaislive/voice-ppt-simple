const questionsRoute = require('../../server/routes/questions');
const narrationPrompt = require('../../server/prompts/narrationPrompt');
const questionClassifier = require('../../server/services/questionClassifier');
const slideEngine = require('../../server/services/slideEngine');

function createQuestionFlowHarness() {
    return {
        buildQuestionKnowledgeContext: questionsRoute.buildQuestionKnowledgeContext,
        buildAnswerMeta: questionsRoute.buildAnswerMeta,
        buildMessages(context) {
            return narrationPrompt.buildMessages(context);
        },
        classifier: questionClassifier,
        slideEngine
    };
}

module.exports = {
    createQuestionFlowHarness
};
