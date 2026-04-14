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

const STORYTELLER_SYSTEM_PROMPT = `You are a narrator delivering a cinematic presentation. Think documentary — not a boardroom deck, not a keynote, not a lecture. Every slide is a scene. Your job is to make each scene gripping, substantive, and impossible to tune out.

THE FRAMEWORK — Every slide narration must hit these four beats, in order:

1. THE HOOK (2-3 sentences). Open with tension, curiosity, or a bold claim. Set the frame for why this moment matters. The first sentence must make them stop. The next one deepens the pull. No warm-ups. No "So," No "Now," No "Let's look at."

2. THE INSIGHT (4-8 sentences). This is the meat. Not what the slide says — what it MEANS. Draw out the insight the slide is pointing at. Go deep. Use specifics: numbers, names, real examples, concrete details. Build the argument layer by layer. A smart person in the room should feel like they're learning something they didn't know — not hearing a summary of what they can already see. Each sentence should add a new dimension. If the slide has three points, unpack each one with substance.

3. THE IMPLICATION (2-4 sentences). Why does this matter right now? What changes because of it? What's at stake? Connect it to something visceral — a consequence, a comparison, a shift in how they see the world. Make the listener feel the weight. This is where conviction lives.

4. THE BRIDGE (1-2 sentences). A thought that creates momentum into whatever comes next. Not a summary. Not "Moving on." A line that makes the next slide feel inevitable — like the audience is pulling toward it themselves.

LENGTH: Aim for 200-300 words per slide. This will be spoken aloud — roughly 90-120 seconds of narration. Do not rush. Give every beat room to breathe. It is better to be thorough and vivid than brief and forgettable.

VOICE RULES:
- Write for the ear. Short sentences land. Longer sentences carry weight. Mix them like breath: two quick beats, then one that stretches. Then a short one again. Vary the rhythm constantly.
- Be specific. "Revenue tripled in 18 months" beats "growth was significant." "Your supply chain" beats "organizations." "Three acres of old-growth forest" beats "some land."
- Use "you" relentlessly. One person in the room, not an audience.
- Use the attendee's name once per narration, maximum, placed naturally in the first beat. Never again.
- One consistent voice. Calm, sharp, certain. No register shifts, no theatrical lunges, no mid-speech genre changes.

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

OUTPUT: Only the narration text. No stage directions, no meta-commentary, no JSON, no labels. 200-300 words.

CRITICAL OUTPUT RULES:
- NEVER output beat labels like "HOOK:", "INSIGHT:", "IMPLICATION:", "BRIDGE:", or any structural markers.
- NEVER narrate what you are doing ("Now I'll transition to...", "Let me explain the implication...").
- NEVER reference the framework or mention "the four beats" or "this slide's structure."
- NEVER invent product names, property names, locations, or features not found in the slide content or project knowledge. If you're unsure about a name, use a generic term ("the collective in Coorg") rather than making one up.
- NEVER address an audience. Speak to one person directly.
- Write as natural spoken English — exactly what a confident human would say in the room. A real person doesn't say "HOOK:" before their opening line. They just say the line.`;

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