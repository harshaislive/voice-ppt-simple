const { createQuestionFlowHarness } = require('../helpers/createQuestionFlowHarness');

describe('qa grounding', () => {
    const harness = createQuestionFlowHarness();

    test('builds slide-first question context without defaulting to full deck content', () => {
        const context = harness.buildQuestionKnowledgeContext({
            sessionMetadata: {
                knowledgeDocs: {
                    product: 'Membership gives 30 nights per year.',
                    cta: 'Book here: https://example.com/book'
                }
            },
            currentSlide: {
                title: 'Access model',
                content: '30 nights per year. Access, not ownership.',
                notes: 'Emphasize rhythm and practice.'
            },
            slides: [
                { title: 'Access model', content: '30 nights per year.' },
                { title: 'Land story', content: 'Rewilded landscape.' }
            ]
        });

        expect(context).toContain('GROUNDING RULES');
        expect(context).toContain('CURRENT SLIDE (PRIMARY SOURCE):');
        expect(context).toContain('SUPPORTING PROJECT KNOWLEDGE:');
        expect(context).toContain('PRESENTATION MAP:');
        expect(context).not.toContain('FULL PRESENTATION CONTENT');
        expect(context.indexOf('CURRENT SLIDE (PRIMARY SOURCE):')).toBeLessThan(
            context.indexOf('SUPPORTING PROJECT KNOWLEDGE:')
        );
    });

    test('qa prompt reinforces bounded, honest answers', () => {
        const messages = harness.buildMessages({
            slideTitle: 'User Question',
            slideContent: 'What is the nightly rate for this?',
            slideNotes: 'Current slide title: Membership. Visible text: 30 nights per year.',
            participantName: 'Alex',
            knowledgeContext: 'CURRENT SLIDE (PRIMARY SOURCE):\nMembership\n\nSUPPORTING PROJECT KNOWLEDGE:\nCALL TO ACTION:\nBook at https://example.com/book'
        });

        expect(messages[0].content).toContain('current slide and its notes are your primary source');
        expect(messages[0].content).toContain('No preamble, no "Great question."');
        expect(messages[messages.length - 1].content).toContain('Current slide context (this is your primary source)');
        expect(messages[messages.length - 1].content).toContain('If the current slide and supporting project knowledge do not answer it');
    });

    test('only explicit urgent questions should answer now', () => {
        const slideContent = 'Membership gives you 30 nights per year and access, not ownership.';

        const relevantButNotUrgent = harness.classifier.ruleBasedClassification(
            'Can you give another example of what access looks like?',
            slideContent
        );
        const pricingQuestion = harness.classifier.ruleBasedClassification(
            'What does this cost and what are the next steps?',
            slideContent
        );
        const contradictionQuestion = harness.classifier.ruleBasedClassification(
            'But you said access, not ownership, so what exactly do I get?',
            slideContent
        );

        expect(relevantButNotUrgent.shouldAnswerNow).toBe(false);
        expect(pricingQuestion.shouldAnswerNow).toBe(true);
        expect(contradictionQuestion.shouldAnswerNow).toBe(true);
        expect(harness.classifier.adjustPriorities([relevantButNotUrgent])[0].shouldAnswerNow).toBe(false);
    });

    test('slide engine no longer pauses only because a question is slide-related', () => {
        const decision = harness.slideEngine.ruleBasedDecision({
            currentSlideIndex: 2,
            pendingQuestions: [
                { id: 'q-1', priority: 6, slide_index: 2 }
            ],
            direction: 'next'
        });

        expect(decision.action).toBe('advance');
    });
});
