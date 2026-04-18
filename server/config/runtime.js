const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://ubuntu-small-openclaw.tail05d15d.ts.net', 'http://100.102.10.108:3000', 'https://office-pc.tail05d15d.ts.net'];

function classifyRuntimeEnvironment() {
    const raw = String(process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();

    if (['local', 'development', 'dev'].includes(raw)) {
        return 'development';
    }

    if (['staging', 'preview', 'preprod'].includes(raw)) {
        return 'staging';
    }

    if (raw === 'production') {
        return 'production';
    }

    return 'development';
}

function isLocalDevelopment() {
    return classifyRuntimeEnvironment() === 'development';
}

function isProductionClassEnvironment() {
    return ['staging', 'production'].includes(classifyRuntimeEnvironment());
}

function isProduction() {
    return classifyRuntimeEnvironment() === 'production';
}

function hasNamedStagingOverride() {
    return classifyRuntimeEnvironment() === 'staging' && process.env.STAGING_ALLOW_INSECURE_TEST_OVERRIDE === 'true';
}

function parseAllowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS || '';
    if (!raw.trim()) {
        return isProductionClassEnvironment() ? [] : DEFAULT_ALLOWED_ORIGINS;
    }

    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function validateRuntimeConfig() {
    const environment = classifyRuntimeEnvironment();
    const production = environment === 'production';
    const productionClass = isProductionClassEnvironment();
    const allowedOrigins = parseAllowedOrigins();
    const errors = [];

    if (productionClass && allowedOrigins.length === 0) {
        errors.push(`ALLOWED_ORIGINS must be set in ${environment}`);
    }

    if (productionClass && !hasNamedStagingOverride()) {
        const requiredGroups = [
            {
                names: ['AZURE_OPENAI_ENDPOINT', 'AZURE_VOICELIVE_ENDPOINT', 'AZURE_EXISTING_AIPROJECT_ENDPOINT'],
                message: `Azure chat endpoint is required in ${environment}`
            },
            {
                names: ['AZURE_OPENAI_API_KEY', 'AZURE_VOICELIVE_API_KEY', 'AZURE_AI_API_KEY'],
                message: `Azure API key is required in ${environment}`
            },
            {
                names: ['AZURE_OPENAI_DEPLOYMENT_NAME', 'AZURE_CHAT_DEPLOYMENT'],
                message: `Azure chat deployment is required in ${environment}`
            }
        ];

        requiredGroups.forEach((group) => {
            const found = group.names.some((name) => String(process.env[name] || '').trim());
            if (!found) {
                errors.push(group.message);
            }
        });

        const hasRealtimeConfig = (
            String(process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || process.env.AZURE_OPENAI_TTS_DEPLOYMENT || '').trim() &&
            String(process.env.AZURE_OPENAI_REALTIME_ENDPOINT || process.env.AZURE_OPENAI_TTS_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_VOICELIVE_ENDPOINT || '').trim() &&
            String(process.env.AZURE_OPENAI_REALTIME_API_KEY || process.env.AZURE_OPENAI_TTS_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_VOICELIVE_API_KEY || '').trim()
        );

        const hasSpeechSdkConfig = (
            String(process.env.AZURE_SPEECH_KEY || process.env.AZURE_AI_SPEECH_KEY || process.env.AZURE_COGSERVICES_KEY || '').trim() &&
            String(process.env.AZURE_SPEECH_REGION || process.env.AZURE_LOCATION || process.env.AZURE_REGION || '').trim()
        );

        if (!hasRealtimeConfig && !hasSpeechSdkConfig) {
            errors.push(`Either realtime Azure OpenAI TTS config or Azure Speech SDK config is required in ${environment}`);
        }

        if (process.env.CMS_REMOTE_REQUIRED === 'true') {
            ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].forEach((name) => {
                if (!String(process.env[name] || '').trim()) {
                    errors.push(`${name} is required when CMS_REMOTE_REQUIRED=true`);
                }
            });
        }
    }

    if (errors.length > 0) {
        const error = new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
        error.code = 'INVALID_RUNTIME_CONFIG';
        throw error;
    }

    return {
        environment,
        isLocalDevelopment: isLocalDevelopment(),
        isProduction: production,
        isProductionClass: productionClass,
        allowedOrigins
    };
}

function createCorsOptions(allowedOrigins = []) {
    const productionClass = isProductionClassEnvironment();
    
    if (!productionClass) {
        return { origin: true, methods: ['GET', 'POST', 'PATCH'] };
    }

    if (!allowedOrigins.length) {
        return {
            origin(origin, callback) {
                if (!origin) {
                    return callback(null, true);
                }

                return callback(new Error('Origin not allowed by CORS'));
            },
            methods: ['GET', 'POST', 'PATCH']
        };
    }

    return {
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PATCH']
    };
}

module.exports = {
    classifyRuntimeEnvironment,
    createCorsOptions,
    hasNamedStagingOverride,
    isLocalDevelopment,
    parseAllowedOrigins,
    validateRuntimeConfig
};
