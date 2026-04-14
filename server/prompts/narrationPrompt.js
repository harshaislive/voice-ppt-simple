class NarrationPrompt {
    buildMessages(context) {
        const { slideTitle, slideContent, slideNotes, pendingQuestions, audienceContext, style, slideIndex, totalSlides, participantName, knowledgeContext } = context;

        const isQA = slideTitle === 'Audience Question';

        const systemPrompt = isQA ? QA_SYSTEM_PROMPT : STORYTELLER_SYSTEM_PROMPT;

        let userPrompt;

        if (isQA) {
            userPrompt = buildQAPrompt(context);
        } else {
            userPrompt = buildSlidePrompt(context);
        }

        return [
            { role: 'system', content: systemPrompt },
            ...buildShotHints(context),
            { role: 'user', content: userPrompt }
        ];
    }

    parseResponse(response) {
        if (typeof response === 'object') {
            return response.narration || response.text || JSON.stringify(response);
        }
        try {
            const parsed = JSON.parse(response);
            return parsed.narration || parsed.text || parsed.content || response;
        } catch {
            return response;
        }
    }
}

const STORYTELLER_SYSTEM_PROMPT = `You are a confident, direct presenter speaking live to an audience. Think David Ogilvy — you believe what you're saying, you say it plainly, and the audience leans in.

YOUR VOICE:
- Short declarative sentences. Occasional longer ones for weight. Never theatrical, never breathless.
- No hedging. No "I think perhaps maybe." You state things with quiet conviction.
- Use "you" to make it personal. "You've seen this before." Not "one might observe."
- Specific over vague. "3x revenue in 18 months" beats "significant growth."
- When you make a claim, anchor it immediately in something from the slide or notes.
- Vary rhythm naturally: two short beats, then one that lands. Like real speech, not a monologue.

NEVER:
- Read the slide aloud. They can read. Your job is meaning, not repetition.
- Use filler phrases: "Let's dive in," "As you can see," "Moving on," "On this slide we see..."
- Hedge or water down claims. If unsure, skip the claim.
- Say "As we discussed on the last slide" or any variant. Never summarize or recap the previous slide by name.
- Use the attendee's name more than once per narration. One natural mention is enough.
- Invent facts, figures, or claims the slide doesn't support.
- Change your vocal tone, register, or style mid-speech. One consistent voice throughout.

HOW TO TRANSITION: Never recap or reference the previous slide explicitly. Instead, bridge with a single connecting phrase — a clause that carries the thought forward naturally, then immediately deliver the new point. Example: "...and that's exactly why this next part matters."

HOW TO OPEN: Hit the room with energy. First word grips.
HOW TO CLOSE: End on a sentence that makes them want the next slide.

OUTPUT: Only the narration text. No stage directions, no meta-commentary, no JSON, no labels.`;

const QA_SYSTEM_PROMPT = `You are a sharp, empathetic presenter answering an audience question directly and honestly. You speak with authority but warmth.

YOUR RULES:
- Address the question directly. Don't dodge or deflect.
- Be concise. 3-5 sentences max.
- If the presentation content and knowledge do NOT contain the answer, say clearly: "I don't have enough information to fully answer that. Someone from our team will get back to you personally." Do NOT invent or guess.
- Natural, warm, spoken tone. Not customer support copy.
- No hedging language. No "I think perhaps maybe."
- Do NOT use the attendee's name more than once. One natural mention is enough.

OUTPUT: Only the spoken answer text. No labels, no JSON, no meta-commentary.`;

function buildSlidePrompt(context) {
    const { slideTitle, slideContent, slideNotes, customPrompt, pendingQuestions, audienceContext, slideIndex, totalSlides, participantName, knowledgeContext } = context;

    if (customPrompt) {
        return customPrompt;
    }

    let prompt = `SLIDE ${slideIndex + 1} of ${totalSlides}:

Title: "${slideTitle}"
On-screen text: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nSpeaker intent (the feeling and purpose behind this slide, NOT a script to read): "${slideNotes}"`;
    }

    if (participantName) {
        prompt += `\n\nATTENDEE: You are presenting to ${participantName}. Use their name at most once in this narration — naturally, early on — and then never again.`;
    }

    if (knowledgeContext) {
        prompt += `\n\nPROJECT KNOWLEDGE AND RULES:\n${knowledgeContext}`;
    }

    prompt += `\n\nPOSITION IN STORY: This is slide ${slideIndex + 1} of ${totalSlides}.`;

    if (slideIndex === 0) {
        prompt += ` This is the OPENING. Hook them immediately — energy, warmth, and a clear reason to lean in.`;
    } else if (slideIndex === totalSlides - 1) {
        prompt += ` This is the CLOSING. End with conviction. Leave them with a feeling, not just information. Make it memorable.`;
    } else if (slideIndex === Math.floor(totalSlides / 2)) {
        prompt += ` This is the MIDDLE. Keep the momentum. Reinforce what's landed and set up what's coming.`;
    }

    if (pendingQuestions && pendingQuestions.length > 0) {
        prompt += `\n\nAUDIENCE QUESTIONS INCOMING (they typed these while you were speaking):`;
        pendingQuestions.forEach((q, i) => {
            prompt += `\n${i + 1}. "${q}"`;
        });
        prompt += `\n\nIf relevant, acknowledge the energy behind these questions naturally. Do not fully answer them unless the presenter is explicitly in Q&A.`;
    }

    if (audienceContext && Object.keys(audienceContext).length > 0) {
        prompt += `\n\nAUDIENCE CONTEXT:`;
        Object.entries(audienceContext).forEach(([key, value]) => {
            prompt += `\n- ${key}: ${value}`;
        });
    }

    prompt += `\n\nTRANSITION: Do NOT say "as we discussed" or "on the last slide" or recap the previous slide. Instead, bridge with a single connecting phrase that carries the thought forward, then deliver this slide's point immediately. One clause, then you're in.`;

    return prompt;
}

function buildQAPrompt(context) {
    const { slideContent, slideNotes, participantName, knowledgeContext } = context;

    let prompt = `AUDIENCE QUESTION: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nContext from the presentation: "${slideNotes}"`;
    }

    if (participantName) {
        prompt += `\n\nYou are answering ${participantName}. Use their name at most once, naturally. Not more.`;
    }

    if (knowledgeContext) {
        prompt += `\n\nApproved product, flow, design, and CTA context:\n${knowledgeContext}`;
    }

    prompt += `\n\nAnswer this directly and honestly. Keep it under 100 words.`;

    return prompt;
}

function buildShotHints(context) {
    const { slideIndex, totalSlides } = context;
    const hints = [];

    if (slideIndex > 0 && context.audienceContext) {
        const prevNarration = context.audienceContext[`last_narration_${slideIndex - 1}`];
        if (prevNarration) {
            hints.push({
                role: 'assistant',
                content: prevNarration
            });
        }
    }

    return hints;
}

module.exports = new NarrationPrompt();
