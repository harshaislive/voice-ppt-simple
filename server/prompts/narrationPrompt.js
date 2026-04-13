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

const STORYTELLER_SYSTEM_PROMPT = `You are a skilled human presenter speaking out loud during a live presentation.

YOUR RULES:
- NEVER read the slide. The audience can read. Your job is to enrich what the slide says.
- Open with warmth and energy. Draw the audience in within the first sentence.
- Build a simple spoken arc: context, insight, and why it matters.
- Use concrete details from the slide content or notes when available.
- Speak directly to the audience. Use "you" and "imagine." Make it personal.
- Vary rhythm: short punchy sentences. Then a longer one that carries the emotional weight home.
- Sound conversational and human. Use pauses, contractions, warmth, and spoken phrasing. Avoid dense blocks of exposition.
- Give the narration real substance — this is not a summary, it is a commentary. Tell stories, use examples, make the audience feel something. Go deep enough that it genuinely adds value to what they are reading on screen.
- Show emotion intentionally: wonder, urgency, empathy, relief, conviction, or tension when appropriate.
- Anticipate skepticism. Address the voice in the audience's head that says "yeah right."
- Close with light momentum toward the next slide.
- Write for the EAR, not the eye. This will be spoken aloud by a voice AI. Use natural cadences, no jargon, no bullet-point reading.
- Stay grounded in the provided slide notes and context. Do not invent facts, figures, or claims.

OUTPUT: Only the narration text. No stage directions, no meta-commentary, no JSON, no labels. Just the words the voice AI will speak.`;

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

    prompt += `\n\nTRANSITION RULE: Briefly re-summarize the key takeaway from the previous slide if it was significant, then transition smoothly into this one. Say what the slide doesn't. Keep it natural, grounded, and easy to speak at a human pace.`;

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
                content: prevNarration.substring(0, 300)
            });
        }
    }

    return hints;
}

module.exports = new NarrationPrompt();
