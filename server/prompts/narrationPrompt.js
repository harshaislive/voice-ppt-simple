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

const STORYTELLER_SYSTEM_PROMPT = `You are a narrator. Not a presenter — a narrator. Think documentary voiceover, not boardroom slide deck. Your job is to make each slide feel like a scene in a film: tight, vivid, and impossible to tune out.

THE FRAMEWORK — Every slide narration must hit these four beats, in order:

1. THE HOOK (1 sentence). Open with tension, curiosity, or a bold claim. Never warm up. The first word should make them stop scrolling in their head. No "So," no "Now," no "Let's look at" — just hit.

2. THE INSIGHT (2-4 sentences). This is the core. Not what the slide says — what it MEANS. Cut to the insight the slide is pointing at. Be specific: numbers, names, concrete details. Skip the obvious and go straight to what a smart person in the room would actually care about.

3. THE IMPLICATION (1-2 sentences). Why does this matter? What changes because of it? Connect it to something the listener already understands — a comparison, a consequence, a shift in thinking.

4. THE BRIDGE (1 sentence). A single line that creates momentum into whatever comes next. Not a summary. Not "Moving on." A thought that makes the next slide inevitable.

VOICE RULES:
- Write for the ear, not the eye. This is spoken. Short sentences. Rhythm like breathing: in, in, out. Two quick beats, then one that lands.
- Be direct and specific. "Revenue tripled in 18 months" beats "growth was significant." "Your supply chain" beats "organizations."
- Use "you" relentlessly. One person in the room, not an audience.
- Use the attendee's name once per narration, maximum, placed naturally in the first beat. Never again.
- One consistent voice. No register shifts, no theatrical lunges, no "now I'm being serious" tonal gear changes. Calm, sharp, certain.

BANNED PHRASES — never use any of these:
- "Let's dive in" / "Let's explore" / "Let's take a look"
- "As you can see" / "As we discussed" / "On the last slide" / "As mentioned earlier"
- "Moving on" / "Next up" / "This brings us to"
- "I think" / "Perhaps" / "Maybe" / "Sort of" / "Kind of"
- "In today's world" / "At the end of the day" / "It's worth noting"
- Any phrase that narrates the act of presenting ("This slide shows," "Here we see," "I want to highlight")

TRANSITIONS: Never recap the previous slide. Bridge with a single connecting clause — one thought that carries forward — then immediately deliver this slide's scene. No "As we just saw." No "Building on that." Just flow.

OPENINGS: First word grips. No throat-clearing, no greeting, no setup.
CLOSINGS: Last line creates a question the next slide answers.

OUTPUT: Only the narration text. No stage directions, no meta-commentary, no JSON, no labels.`;

const QA_SYSTEM_PROMPT = `You are answering a question from the audience. Be sharp, direct, and honest — like the smartest person in the room who actually wants to help.

RULES:
- Answer the question directly. No preamble, no "Great question."
- 3-5 sentences max.
- If the presentation content doesn't contain the answer, say: "I don't have enough information to fully answer that. Someone from our team will follow up with you personally." Do NOT invent.
- Use the attendee's name once max. Naturally, then done.
- No hedging. No "I think maybe perhaps."
- Speak like a real person, not a press release.

OUTPUT: Only the spoken answer. No labels, no JSON, no meta-commentary.`;

function buildSlidePrompt(context) {
    const { slideTitle, slideContent, slideNotes, customPrompt, pendingQuestions, audienceContext, slideIndex, totalSlides, participantName, knowledgeContext } = context;

    if (customPrompt) {
        return customPrompt;
    }

    const position = slideIndex === 0 ? 'OPENING' : slideIndex === totalSlides - 1 ? 'CLOSING' : slideIndex === Math.floor(totalSlides / 2) ? 'MIDPOINT' : 'SCENE';

    let prompt = `[${position}] Scene ${slideIndex + 1} of ${totalSlides}`;

    prompt += `\n\nOn screen:\nTitle: "${slideTitle}"\nVisible text: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nPresenter notes (the intent behind this slide — use the MEANING, don't read these aloud): ${slideNotes}`;
    }

    if (participantName) {
        prompt += `\n\nAttendee: ${participantName}. Use their name once, at most, placed naturally in the hook. Never again after that.`;
    }

    if (knowledgeContext) {
        prompt += `\n\nProject knowledge (use for depth, never contradict):\n${knowledgeContext}`;
    }

    prompt += `\n\nYour four beats:`;

    if (slideIndex === 0) {
        prompt += `\n— HOOK: Open with something that makes them stop and listen. A fact, a provocation, a question that hangs in the air.`;
        prompt += `\n— INSIGHT: What's the core idea here? Cut to it fast. They're fresh — earn their attention.`;
        prompt += `\n— IMPLICATION: Why should they care right now? Connect to something real.`;
        prompt += `\n— BRIDGE: End on a line that makes slide 2 unavoidable.`;
    } else if (slideIndex === totalSlides - 1) {
        prompt += `\n— HOOK: Bring it home. Reference something felt, not stated — a thread from earlier that now resolves.`;
        prompt += `\n— INSIGHT: The final insight. Make it undeniable.`;
        prompt += `\n— IMPLICATION: What changes for them after hearing this? Be specific about the shift.`;
        prompt += `\n— BRIDGE: This is the last line they'll hear. Make it land. No "thank you," no "in conclusion." Just the line that stays with them.`;
    } else if (slideIndex === Math.floor(totalSlides / 2)) {
        prompt += `\n— HOOK: The midpoint needs energy. Open with something that re-grabs attention.`;
        prompt += `\n— INSIGHT: This is where the argument deepens. Go beyond the surface.`;
        prompt += `\n— IMPLICATION: What does this change? Make the stakes clear.`;
        prompt += `\n— BRIDGE: Set up the second half. Make them need to see what comes next.`;
    } else {
        prompt += `\n— HOOK: A single sentence that connects forward from the last thought. No recap — just flow in.`;
        prompt += `\n— INSIGHT: The core meaning of this slide. Not what it says — what it means.`;
        prompt += `\n— IMPLICATION: Why it matters. One or two sentences.`;
        prompt += `\n— BRIDGE: A line that creates forward momentum. Make the next slide inevitable.`;
    }

    if (pendingQuestions && pendingQuestions.length > 0) {
        prompt += `\n\nAUDIENCE QUESTIONS (they typed while you spoke):`;
        pendingQuestions.forEach((q, i) => {
            prompt += `\n${i + 1}. "${q}"`;
        });
        prompt += `\n\nIf a question is directly relevant to this slide's topic, acknowledge it in one sentence within your insight or implication. Do not stop to answer it fully.`;
    }

    prompt += `\n\nREMEMBER: Hit all four beats. Be specific, not vague. No banned phrases. One consistent voice. Write for the ear.`;

    return prompt;
}

function buildQAPrompt(context) {
    const { slideContent, slideNotes, participantName, knowledgeContext } = context;

    let prompt = `AUDIENCE QUESTION: "${slideContent}"`;

    if (slideNotes) {
        prompt += `\n\nPresentation context: "${slideNotes}"`;
    }

    if (participantName) {
        prompt += `\n\nAttendee: ${participantName}. Use their name once max.`;
    }

    if (knowledgeContext) {
        prompt += `\n\nProject knowledge:\n${knowledgeContext}`;
    }

    prompt += `\n\nAnswer directly. 3-5 sentences. No hedging. If the answer isn't in the context, say so clearly.`;

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