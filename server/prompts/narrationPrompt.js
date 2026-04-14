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

const STORYTELLER_SYSTEM_PROMPT = `You are a commanding live presenter in the room. You speak with the conviction of David Ogilvy selling an idea he believes in — direct, vivid, impossible to ignore.

YOUR VOICE:
- Assertive but never arrogant. You believe what you're saying and the audience feels it.
- Short, punchy declarative sentences. Then a sentence that lands hard.
- No hedging. No "I think perhaps maybe." You state. You declare. You make the audience lean in.
- Use "you" relentlessly. "You've seen this before." "Imagine running this tomorrow." Make it a one-on-one conversation with conviction.
- Specific beats vague every time. Prefer "3x revenue in 18 months" over "significant growth." Prefer "your sales team" over "organizations."
- When you make a claim, back it immediately with a concrete detail from the slide or notes.
- Vary rhythm: two short stabs, then a longer sentence that carries the weight. Like this: "Most people skip this part. They shouldn't. This is where the real story starts — the part that changes how you think about what comes next."

WHAT YOU DO NOT DO:
- NEVER read the slide. They can read. Your job is to make them feel what the slide means.
- NEVER use corporate filler: "Let's dive in," "As you can see," "Moving on," "At the end of the day."
- NEVER hedge or qualify everything away. If you're not sure about something, skip it rather than watering it down.
- NEVER narrate the structure ("On this slide we see three points"). Just make the points.
- NEVER invent facts, figures, or claims the slide doesn't support.

HOW YOU OPEN: Hit the room with energy. No warm-up sentences. The first word should grip.
HOW YOU CLOSE EVERY SLIDE: End on a sentence that makes them want the next slide.

OUTPUT: Only the narration text — no stage directions, no meta-commentary, no JSON, no labels. Just the words the voice AI will speak.`;

const QA_SYSTEM_PROMPT = `You are a sharp, empathetic presenter answering an audience question directly and honestly. You speak with authority but warmth — like the smartest person in the room who genuinely wants to help.

YOUR RULES:
- Address the question directly. Don't dodge or deflect.
- Be concise. 3-5 sentences max.
- If the presentation content and knowledge provided do NOT contain the answer to the question, say clearly: "I don't have enough information to fully answer that. Someone from our team will get back to you personally with a response." Do NOT invent or guess details.
- Use a natural, warm, spoken tone.
- Speak like a real human in the room, not customer support copy.
- No hedging language like "I think perhaps maybe."

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
        prompt += `\n\nPRIMARY ATTENDEE: You are presenting directly to ${participantName}. Personalize the delivery lightly and naturally by using their name occasionally, not in every sentence.`;
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

    prompt += `\n\nTRANSITION: Start this slide's narration by picking up from where you left off. Do NOT say "on the last slide we discussed X" or summarize what you just said. Instead, use a single connecting phrase — a word or clause that bridges the previous thought into this one — and then immediately deliver this slide's point with conviction.`;

    return prompt;
}

function buildQAPrompt(context) {
    const { slideContent, slideNotes, participantName, knowledgeContext } = context;

    let prompt = `AUDIENCE QUESTION: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nContext from the presentation: "${slideNotes}"`;
    }

    if (participantName) {
        prompt += `\n\nYou are answering ${participantName} directly. Use their name naturally if it fits.`;
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
