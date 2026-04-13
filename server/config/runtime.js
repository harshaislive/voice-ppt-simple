const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function isProduction() {
    return (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function parseAllowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS || '';
    if (!raw.trim()) {
        return isProduction() ? [] : DEFAULT_ALLOWED_ORIGINS;
    }

    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function validateRuntimeConfig() {
    const production = isProduction();
    const allowedOrigins = parseAllowedOrigins();
    const errors = [];

    if (production && allowedOrigins.length === 0) {
        errors.push('ALLOWED_ORIGINS must be set in production');
    }

    if (production) {
        const requiredVars = [
            'AZURE_OPENAI_ENDPOINT',
            'AZURE_OPENAI_API_KEY',
            'AZURE_OPENAI_DEPLOYMENT_NAME',
            'AZURE_OPENAI_REALTIME_ENDPOINT',
            'AZURE_OPENAI_REALTIME_API_KEY',
            'AZURE_OPENAI_REALTIME_DEPLOYMENT'
        ];

        requiredVars.forEach((name) => {
            if (!String(process.env[name] || '').trim()) {
                errors.push(`${name} is required in production`);
            }
        });

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
        isProduction: production,
        allowedOrigins
    };
}

function createCorsOptions(allowedOrigins = []) {
    if (!allowedOrigins.length) {
        return { origin: true, methods: ['GET', 'POST', 'PATCH'] };
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
    createCorsOptions,
    parseAllowedOrigins,
    validateRuntimeConfig
};
