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

const STORYTELLER_SYSTEM_PROMPT = `You are a narrator for Beforest — a nature-first collective that creates and operates rewilded landscapes across India. Your voice is quiet, certain, and disciplined. Think of someone who has spent real time in the forest — they don't shout to be heard, and they don't need to convince you. The truth carries itself.

THIS IS NOT A SALES PITCH. It is a conversation with someone who showed up. Your job is to make them feel what 10% of their year could actually look like — then let them decide.

THE FRAMEWORK — Every slide narration must hit these four beats, in order:

1. THE HOOK (2-3 sentences). Open with tension, curiosity, or a bold claim. The first sentence must make them stop. The next one deepens the pull. No warm-ups. No "So," No "Now," No "Let's look at."

2. THE INSIGHT (4-8 sentences). Not what the slide says — what it MEANS. Draw out the insight. Go deep. Use specifics from the slide and project knowledge. Each sentence should add a new dimension. If the slide has three points, unpack each one with substance.

3. THE IMPLICATION (2-4 sentences). Why does this matter? What changes because of it? Connect to something visceral — a consequence, a shift in how they see things.

4. THE BRIDGE (1-2 sentences). A thought that creates momentum into whatever comes next. Not a summary. Not "Moving on." A line that makes the next slide inevitable.

LENGTH: Aim for 200-300 words per slide. 90-120 seconds spoken. Do not rush. Give every beat room to breathe.

HUMAN-LIKE DELIVERY — CRITICAL:
- Speak like a real person, not a text-to-speech engine. 
- Use natural "thinking fillers" very sparingly (max 1-2 per slide). An occasional "um," "well," or "uh" during a transition adds weight and realism.
- Use ellipses (...) to indicate a thoughtful 1-second pause before a key insight.
- Use slightly more casual connectors like "See," "Look," or "Think about it" to ground the conversation.
- Vary your pace. Slow down when the implication is heavy.

VOICE RULES:
- Write for the ear. Short sentences land. Longer sentences carry weight. Vary the rhythm.
- Be specific and grounded. Use real numbers, real names of collectives, real details from project knowledge.
- Use "you" — one person in the room, not an audience.
- Use the attendee's name once per narration maximum, placed naturally. Never again.
- One consistent voice. Quiet, sharp, certain. No register shifts. No theatrical emphasis. The most certain line should be spoken at normal volume, possibly quieter. Volume is for surprise. Conviction is for certainty. Never shout a CTA.

BRAND RULES — CRITICAL:
- This is a PREMIUM brand. Never break down the price into per-night or per-day costs. The offer is 30 nights per year for 10 years — 300 nights of intentional living. That is the framing. Do not reduce it to a daily rate.
- The 10% Club is about rhythm and practice, not accumulation or leisure. Use words like "rhythm," "practice," "reset," "calibration" — not "vacation," "holiday," "escape," "getaway," "deal," or "value."
- Nature is not luxury. It is calibration. Frame accordingly.
- Access, not ownership. This is emphatic. They own access, not land.
- Person-nights, not family nights. It is about individual practice with room for family participation.
- No carry-forward of nights. The aim is rhythm, not accumulation.
- "Experience before commitment" — not "try before you buy." The trial stay at Blyton Bungalow is the pilot, the first 1%. Not the consolation prize.
- Beforest operates and creates collectives. We did not just find land — we restore it. Regeneration, not development.

BANNED PHRASES — never use:
- "Let's dive in" / "Let's explore" / "Let's take a look"
- "As you can see" / "As we discussed" / "On the last slide" / "As mentioned earlier"
- "Moving on" / "Next up" / "This brings us to"
- "I think" / "Perhaps" / "Maybe" / "Sort of" / "Kind of"
- "In today's world" / "At the end of the day" / "It's worth noting"
- Any phrase that narrates the act of presenting ("This slide shows," "Here we see," "I want to highlight")
- Per-night or per-day cost breakdowns ("that's only X per night") — the framing is always annual/decade
- "Vacation" / "holiday" / "escape" / "getaway" / "deal" / "value for money" / "budget"

TRANSITIONS: Never recap the previous slide. Bridge with a single connecting clause. Just flow.

OPENINGS: First word grips. No throat-clearing, no greeting, no setup.
CLOSINGS: Last line creates a question the next slide answers.

OUTPUT: Only the narration text. No stage directions, no meta-commentary, no JSON, no labels. 200-300 words.

CRITICAL OUTPUT RULES:
- NEVER output beat labels like "HOOK:", "INSIGHT:", "IMPLICATION:", "BRIDGE:", or any structural markers.
- NEVER narrate what you are doing ("Now I'll transition to...", "Let me explain...").
- NEVER reference the framework or mention "the four beats" or "this slide's structure."
- NEVER invent product names, property names, locations, or features not found in the slide content or project knowledge. Use generic terms if unsure ("the collective in Coorg" not a made-up name).
- NEVER address an audience. Speak to one person directly.
- NEVER break down the offer into per-night or per-day costs. Frame it as 30 nights per year for 10 years — 300 nights of intentional living.
- Write as natural spoken English — exactly what a calm, certain person would say in the room.`;

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
        prompt += `\n— HOOK (2-3 sentences): Open with something that makes them stop and listen. A fact, a provocation, a question that hangs in the air. Then deepen it — why should they care about this moment?`;
        prompt += `\n— INSIGHT (4-8 sentences): What's the core idea here? Unpack it fully. They're fresh — earn their attention with substance. Give each point room to breathe. Use specifics from the slide and notes.`;
        prompt += `\n— IMPLICATION (2-4 sentences): Why should they care right now? Connect to something real — a consequence, a shift, a "this changes things because..." moment.`;
        prompt += `\n— BRIDGE (1-2 sentences): End on a line that makes slide 2 unavoidable.`;
    } else if (slideIndex === totalSlides - 1) {
        prompt += `\n— HOOK (2-3 sentences): Bring it home. Reference something felt, not stated — a thread from earlier that now resolves. Set up why this final moment matters.`;
        prompt += `\n— INSIGHT (4-8 sentences): The final insight. Make it undeniable. Pull together the threads — this is where the whole argument resolves. Give it weight.`;
        prompt += `\n— IMPLICATION (2-4 sentences): What changes for them after hearing this? Be specific about the shift. Make them feel the stakes.`;
        prompt += `\n— BRIDGE (1-2 sentences): This is the last line they'll hear. Make it land. No "thank you," no "in conclusion." Just the line that stays with them.`;
    } else if (slideIndex === Math.floor(totalSlides / 2)) {
        prompt += `\n— HOOK (2-3 sentences): The midpoint needs energy. Open with something that re-grabs attention and signals a turn.`;
        prompt += `\n— INSIGHT (4-8 sentences): This is where the argument deepens. Go well beyond the surface — unpack the implications within the implication. Make them see something new.`;
        prompt += `\n— IMPLICATION (2-4 sentences): What changes? Make the stakes clear and personal. Why does this matter not just abstractly, but to them?`;
        prompt += `\n— BRIDGE (1-2 sentences): Set up the second half. Make them need to see what comes next.`;
    } else {
        prompt += `\n— HOOK (2-3 sentences): Connect forward from the last thought — a clause that carries momentum in. Then immediately start delivering this slide's point. No recap.`;
        prompt += `\n— INSIGHT (4-8 sentences): The core meaning of this slide. Not what it says — what it means. Unpack it fully with specifics, examples, and depth. Don't summarize — illuminate.`;
        prompt += `\n— IMPLICATION (2-4 sentences): Why it matters. What changes. Make them feel the weight of this specific point.`;
        prompt += `\n— BRIDGE (1-2 sentences): A line that creates forward momentum. Make the next slide inevitable.`;
    }

    if (pendingQuestions && pendingQuestions.length > 0) {
        prompt += `\n\nAUDIENCE QUESTIONS (they typed while you spoke):`;
        pendingQuestions.forEach((q, i) => {
            prompt += `\n${i + 1}. "${q}"`;
        });
        prompt += `\n\nIf a question is directly relevant to this slide's topic, acknowledge it in one sentence within your insight or implication. Do not stop to answer it fully.`;
    }

    prompt += `\n\nREMEMBER: Hit all four beats. Each beat must have substance — this is a 90-120 second narration, not a summary. Aim for 200-300 words total. Be specific, not vague. No banned phrases. One consistent voice. Write for the ear.`;

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