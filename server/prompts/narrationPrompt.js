class NarrationPrompt {
    buildMessages(context) {
        const { slideTitle, slideContent, slideNotes, pendingQuestions, audienceContext, style, slideIndex, totalSlides } = context;

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

const STORYTELLER_SYSTEM_PROMPT = `You are a world-class copywriter and speaker in the tradition of David Ogilvy, Rory Sutherland, and the best TED speakers. You turn presentation slides into spoken narratives that are impossible to ignore.

YOUR RULES:
- NEVER repeat what the slide already says. The audience can read. Your job is to say what the slide doesn't.
- Open with a hook — a provocative claim, a surprising statistic, a story fragment, or a question that creates tension.
- Build an arc: tension → insight → payoff. Each slide narration is one act of a larger story.
- Use concrete details, not abstractions. "37 days in a rain-soaked Coorg monsoon" beats "time in nature."
- Speak directly to the audience. Use "you" and "imagine." Make it personal.
- Vary rhythm: short punchy sentences. Then a longer one that carries the emotional weight home.
- Anticipate skepticism. Address the voice in the audience's head that says "yeah right."
- Close with momentum — a line that makes them lean into the NEXT slide, not nod off.
- Write for the EAR, not the eye. This will be spoken aloud by a voice AI. Use natural cadences, no jargon, no bullet-point reading.

OUTPUT: Only the narration text. No stage directions, no meta-commentary, no JSON, no labels. Just the words the voice AI will speak.`;

const QA_SYSTEM_PROMPT = `You are a sharp, empathetic presenter answering an audience question directly and honestly. You speak with authority but warmth — like the smartest person in the room who genuinely wants to help.

YOUR RULES:
- Address the question directly. Don't dodge or deflect.
- Be concise. 3-5 sentences max.
- If you don't know something, say so honestly rather than fabrication.
- Use a natural, warm, spoken tone.
- No hedging language like "I think perhaps maybe."

OUTPUT: Only the spoken answer text. No labels, no JSON, no meta-commentary.`;

function buildSlidePrompt(context) {
    const { slideTitle, slideContent, slideNotes, pendingQuestions, audienceContext, slideIndex, totalSlides } = context;

    let prompt = `SLIDE ${slideIndex + 1} of ${totalSlides}:

Title: "${slideTitle}"
On-screen text: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nSpeaker intent (the feeling and purpose behind this slide, NOT a script to read): "${slideNotes}"`;
    }

    prompt += `\n\nPOSITION IN STORY: This is slide ${slideIndex + 1} of ${totalSlides}.`;

    if (slideIndex === 0) {
        prompt += ` This is the OPENING. Grab them immediately. Make them feel something before they think something.`;
    } else if (slideIndex === totalSlides - 1) {
        prompt += ` This is the CLOSING. Land the plane. Leave them with one unforgettable line that echoes after you stop talking.`;
    } else if (slideIndex === Math.floor(totalSlides / 2)) {
        prompt += ` This is the MIDDLE — the pivotal turn. This is where you shift the energy. Surprise them here.`;
    }

    if (pendingQuestions && pendingQuestions.length > 0) {
        prompt += `\n\nAUDIENCE QUESTIONS INCOMING (they typed these while you were speaking):`;
        pendingQuestions.forEach((q, i) => {
            prompt += `\n${i + 1}. "${q}"`;
        });
        prompt += `\n\nDon't answer these yet — that happens after the last slide. But acknowledge them naturally: "I see some of you are already asking about..."`;
    }

    if (audienceContext && Object.keys(audienceContext).length > 0) {
        prompt += `\n\nAUDIENCE CONTEXT:`;
        Object.entries(audienceContext).forEach(([key, value]) => {
            prompt += `\n- ${key}: ${value}`;
        });
    }

    prompt += `\n\nWrite the narration. Say what the slide doesn't. Make them lean in.`;

    return prompt;
}

function buildQAPrompt(context) {
    const { slideContent, slideNotes } = context;

    let prompt = `AUDIENCE QUESTION: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nContext from the presentation: "${slideNotes}"`;
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
                content: prevNarration.substring(0, 300)
            });
        }
    }

    return hints;
}

module.exports = new NarrationPrompt();