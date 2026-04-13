const express = require('express');
const { requireSessionControl } = require('../middleware/security');

const router = express.Router();

function getRealtimeConfig(req) {
    const endpoint = (process.env.AZURE_OPENAI_REALTIME_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    const apiKey = process.env.AZURE_OPENAI_REALTIME_API_KEY || process.env.AZURE_OPENAI_API_KEY || '';
    const deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'gpt-realtime-mini';
    const voice = process.env.AZURE_OPENAI_REALTIME_VOICE || process.env.AZURE_OPENAI_TTS_VOICE || 'alloy';

    return { endpoint, apiKey, deployment, voice };
}

router.get('/config', (req, res) => {
    const { endpoint, deployment, voice } = getRealtimeConfig(req);
    res.json({
        enabled: Boolean(endpoint && deployment),
        deployment,
        voice
    });
});

router.post('/connect', requireSessionControl(), async (req, res) => {
    const { sessionId, sdp, slideContext } = req.body;
    if (!sessionId || !sdp) {
        return res.status(400).json({ error: 'sessionId and sdp are required' });
    }

    const { endpoint, apiKey, deployment, voice } = getRealtimeConfig(req);
    if (!endpoint || !apiKey) {
        return res.status(400).json({ error: 'Azure Realtime credentials are not configured' });
    }

    const db = req.app.get('db');
    const groundedContext = getGroundedSlideContext(db, sessionId, slideContext);

    const sessionConfig = {
        type: 'realtime',
        model: deployment,
        instructions: buildRealtimeInstructions(groundedContext),
        tool_choice: 'auto',
        tools: [
            {
                type: 'function',
                name: 'advance_slide',
                description: 'Move the presentation one slide forward or backward when the attendee explicitly asks to navigate.',
                parameters: {
                    type: 'object',
                    properties: {
                        direction: {
                            type: 'string',
                            enum: ['next', 'previous']
                        }
                    },
                    required: ['direction'],
                    additionalProperties: false
                }
            },
            {
                type: 'function',
                name: 'go_to_slide',
                description: 'Jump to a specific slide number when the attendee clearly asks for a particular slide.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_number: {
                            type: 'integer',
                            minimum: 1
                        }
                    },
                    required: ['slide_number'],
                    additionalProperties: false
                }
            },
            {
                type: 'function',
                name: 'resume_presentation',
                description: 'Resume the live presentation flow when the attendee asks to continue or stop the interruption.',
                parameters: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            }
        ],
        output_modalities: ['audio'],
        audio: {
            input: {
                transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.45,
                    prefix_padding_ms: 250,
                    silence_duration_ms: 500,
                    create_response: false,
                    interrupt_response: true
                }
            },
            output: {
                voice
            }
        }
    };

    try {
        const secretResponse = await fetch(`${endpoint}/openai/v1/realtime/client_secrets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey
            },
            body: JSON.stringify({ session: sessionConfig })
        });

        if (!secretResponse.ok) {
            const errorText = await secretResponse.text();
            return res.status(secretResponse.status).json({ error: `Failed to mint client secret: ${errorText}` });
        }

        const secretJson = await secretResponse.json();
        const ephemeralKey = secretJson?.client_secret?.value || secretJson?.value;
        if (!ephemeralKey) {
            return res.status(500).json({ error: 'Azure did not return an ephemeral client secret' });
        }

        const callResponse = await fetch(`${endpoint}/openai/v1/realtime/calls`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp'
            },
            body: sdp
        });

        if (!callResponse.ok) {
            const errorText = await callResponse.text();
            return res.status(callResponse.status).json({ error: `Failed to establish WebRTC call: ${errorText}` });
        }

        const answerSdp = await callResponse.text();
        return res.json({ sdp: answerSdp });
    } catch (error) {
        console.error('Realtime WebRTC connect error:', error);
        return res.status(500).json({ error: 'Failed to connect realtime voice session' });
    }
});

function getGroundedSlideContext(db, sessionId, fallback = {}) {
    if (!db || !sessionId) {
        return fallback || {};
    }

    const session = db.get(`
        SELECT s.id, s.deck_id, s.current_slide_index, s.metadata,
               sl.title, sl.content, sl.notes, sl.custom_prompt,
               (SELECT COUNT(*) FROM slides WHERE session_id = s.id) AS total_slides
    FROM sessions s
    LEFT JOIN slides sl ON sl.session_id = s.id AND sl.slide_index = s.current_slide_index
    WHERE s.id = ?
    `, [sessionId]);

    if (!session) {
        return fallback || {};
    }

    const metadata = parseMetadata(session.metadata);

    const nextSlide = db.get(`
        SELECT title, content
        FROM slides
        WHERE session_id = ? AND slide_index = ?
    `, [sessionId, (session.current_slide_index || 0) + 1]);

    const memory = db.all(`
        SELECT key, value
        FROM audience_memory
        WHERE session_id = ?
        ORDER BY updated_at DESC
        LIMIT 4
    `, [sessionId]);

    return {
        deckLabel: fallback.deckLabel || session.deck_id,
        participantName: fallback.participantName || metadata.participantName || '',
        knowledgeContext: buildKnowledgeContext(metadata),
        title: session.title || fallback.title,
        subtitle: session.content || fallback.subtitle,
        notes: session.notes || fallback.notes,
        customPrompt: session.custom_prompt || fallback.customPrompt,
        slideIndex: typeof session.current_slide_index === 'number' ? session.current_slide_index : fallback.slideIndex,
        totalSlides: session.total_slides || fallback.totalSlides,
        nextSlideTitle: nextSlide?.title || '',
        nextSlideContent: nextSlide?.content || '',
        recentMemory: memory.map((item) => `${item.key}: ${item.value}`).join('\n')
    };
}

function buildRealtimeInstructions(slideContext = {}) {
    const { deckLabel, participantName, knowledgeContext, title, subtitle, notes, customPrompt, slideIndex, totalSlides, nextSlideTitle, nextSlideContent, recentMemory } = slideContext;

    if (customPrompt) {
        return customPrompt;
    }

    const slideLabel = title ? `Current slide ${slideIndex + 1 || '?'}/${totalSlides || '?'}, "${title}".` : 'The presentation is live.';
    const subtitleText = subtitle ? `Visible text: ${subtitle}` : '';
    const notesText = notes ? `Presenter notes for this slide: ${notes}` : '';
    const nextSlideText = nextSlideTitle ? `The next slide is "${nextSlideTitle}"${nextSlideContent ? ` with visible text: ${nextSlideContent}` : ''}.` : '';
    const memoryText = recentMemory ? `Recent presentation memory:\n${recentMemory}` : '';

    return [
        'You are the live voice presenter for an interactive presentation.',
        'Do not speak first.',
        'When the mic opens, wait silently for the attendee to ask a question or make a request.',
        'Do not proactively explain the current slide unless the attendee explicitly asks you to.',
        'Speak naturally, conversationally, and with emotional intelligence.',
        'Keep answers concise and verbal-first. Do not sound like you are reading prose.',
        'If the user interrupts, answer immediately in the context of the current slide.',
        'When the attendee explicitly asks to change slides or resume the deck, use the available navigation tool instead of only talking about it.',
        'If you need to reference the slide, do it briefly and in spoken language.',
        'Ground every answer in the provided deck context and presenter notes.',
        'Do not invent facts, claims, numbers, locations, or product details that are not present in the provided context.',
        'If the user asks for something not grounded in the current deck context, say you do not have that detail in this presentation and answer cautiously.',
        participantName ? `You are speaking to ${participantName}. Use their name naturally once in a while, but do not overuse it.` : '',
        knowledgeContext ? `Project knowledge and rules: ${knowledgeContext}` : '',
        deckLabel ? `Deck: ${deckLabel}.` : '',
        slideLabel,
        subtitleText,
        notesText,
        nextSlideText,
        memoryText,
        'You are allowed to continue the presentation only when asked. Otherwise focus on the user interruption.'
    ].filter(Boolean).join(' ');
}

function parseMetadata(rawMetadata) {
    if (!rawMetadata) {
        return {};
    }

    try {
        return JSON.parse(rawMetadata);
    } catch {
        return {};
    }
}

function buildKnowledgeContext(metadata = {}) {
    const knowledgeDocs = metadata.knowledgeDocs || {};
    return [
        knowledgeDocs.agents ? `AGENT RULES: ${stringifyDoc(knowledgeDocs.agents)}` : '',
        knowledgeDocs.product ? `PRODUCT: ${stringifyDoc(knowledgeDocs.product)}` : '',
        knowledgeDocs.flow ? `FLOW: ${stringifyDoc(knowledgeDocs.flow)}` : '',
        knowledgeDocs.design ? `DESIGN: ${stringifyDoc(knowledgeDocs.design)}` : '',
        knowledgeDocs.cta ? `CTA: ${stringifyDoc(knowledgeDocs.cta)}` : ''
    ].filter(Boolean).join('\n\n').slice(0, 4000);
}

function stringifyDoc(value) {
    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

module.exports = router;
