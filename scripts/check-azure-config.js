require('dotenv').config();

function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function redact(value) {
    const text = String(value || '');
    if (!text) {
        return '(missing)';
    }
    if (text.length <= 8) {
        return '***';
    }
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function probe(name, url, options) {
    const startedAt = Date.now();
    try {
        const response = await fetch(url, options);
        const bodyText = await response.text();
        let parsed;
        try {
            parsed = JSON.parse(bodyText);
        } catch {
            parsed = bodyText;
        }

        return {
            name,
            ok: response.ok,
            status: response.status,
            durationMs: Date.now() - startedAt,
            body: parsed
        };
    } catch (error) {
        return {
            name,
            ok: false,
            status: 0,
            durationMs: Date.now() - startedAt,
            body: { error: error.message }
        };
    }
}

async function main() {
    const chatEndpoint = trimSlash(process.env.AZURE_OPENAI_ENDPOINT);
    const chatKey = process.env.AZURE_OPENAI_API_KEY || '';
    const chatDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '';

    const realtimeEndpoint = trimSlash(process.env.AZURE_OPENAI_REALTIME_ENDPOINT || process.env.AZURE_OPENAI_TTS_ENDPOINT);
    const realtimeKey = process.env.AZURE_OPENAI_REALTIME_API_KEY || process.env.AZURE_OPENAI_TTS_API_KEY || '';
    const realtimeDeployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || process.env.AZURE_OPENAI_TTS_DEPLOYMENT || '';

    console.log('Azure config check');
    console.log(JSON.stringify({
        chatEndpoint,
        chatKey: redact(chatKey),
        chatDeployment,
        realtimeEndpoint,
        realtimeKey: redact(realtimeKey),
        realtimeDeployment
    }, null, 2));

    const probes = [];

    if (chatEndpoint && chatKey && chatDeployment) {
        probes.push(probe(
            'chat-completions',
            `${chatEndpoint}/openai/deployments/${encodeURIComponent(chatDeployment)}/chat/completions?api-version=2024-08-01-preview`,
            {
                method: 'POST',
                headers: {
                    'api-key': chatKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
                    max_completion_tokens: 16
                })
            }
        ));
    }

    if (realtimeEndpoint && realtimeKey && realtimeDeployment) {
        probes.push(probe(
            'realtime-client-secrets',
            `${realtimeEndpoint}/openai/v1/realtime/client_secrets?model=${encodeURIComponent(realtimeDeployment)}`,
            {
                method: 'POST',
                headers: {
                    'api-key': realtimeKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session: {
                        type: 'realtime',
                        model: realtimeDeployment,
                        audio: {
                            output: {
                                voice: process.env.AZURE_OPENAI_REALTIME_VOICE || process.env.AZURE_OPENAI_TTS_VOICE || 'alloy'
                            }
                        }
                    }
                })
            }
        ));
    }

    const results = await Promise.all(probes);

    for (const result of results) {
        console.log(`\n[${result.name}] status=${result.status} ok=${result.ok} durationMs=${result.durationMs}`);
        console.log(JSON.stringify(result.body, null, 2));
    }

    const failed = results.some((result) => !result.ok);
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
