const narrationPrompt = require('../../server/prompts/narrationPrompt');
const { importVoicePPTAppModule } = require('../helpers/createAutoplexControlHarness');

describe('qa experience', () => {
    test('answer presentation hides redundant summary and default title', async () => {
        const { buildQuestionAnswerPresentation } = await importVoicePPTAppModule();

        const presentation = buildQuestionAnswerPresentation({
            answerTitle: 'Answer',
            answerSummary: 'This is a concise answer...',
            answerDetails: 'This is a concise answer with one extra sentence to make the truncation obvious.'
        });

        expect(presentation.shouldShowTitle).toBe(false);
        expect(presentation.primaryText).toContain('This is a concise answer');
        expect(presentation.secondaryText).toBe('');
    });

    test('answer presentation can keep a meaningful non-default title without splitting the body mechanically', async () => {
        const { buildQuestionAnswerPresentation } = await importVoicePPTAppModule();

        const presentation = buildQuestionAnswerPresentation({
            answerTitle: 'Next step',
            answerSummary: 'Book the trial stay.',
            answerDetails: 'Book the trial stay at the bungalow so you can experience the rhythm before committing.'
        });

        expect(presentation.shouldShowTitle).toBe(true);
        expect(presentation.titleText).toBe('Next step');
        expect(presentation.primaryText).toContain('experience the rhythm');
    });

    test('qa prompt stays warm, direct, and conversion-aware without canned filler', () => {
        const messages = narrationPrompt.buildMessages({
            slideTitle: 'User Question',
            slideContent: 'How do I move forward from here?',
            slideNotes: 'Current slide title: Membership. Visible text: Trial stay available.',
            knowledgeContext: 'SUPPORTING PROJECT KNOWLEDGE:\nCALL TO ACTION:\nBook at https://example.com/book'
        });

        expect(messages[0].content).toContain('calm, sharp closer');
        expect(messages[0].content).toContain('No preamble, no "Great question."');
        expect(messages[messages.length - 1].content).toContain('End with one clear next action when useful');
    });
});
