const { withRuntimeEnv } = require('../helpers/createRuntimeConfigTestEnv');

describe('runtime config guardrails', () => {
    test('production without ALLOWED_ORIGINS throws INVALID_RUNTIME_CONFIG', () => {
        expect(() => withRuntimeEnv({
            APP_ENV: 'production',
            ALLOWED_ORIGINS: ''
        }, ({ runtime }) => runtime.validateRuntimeConfig())).toThrow(/INVALID_RUNTIME_CONFIG|Invalid runtime configuration/);
    });

    test('staging follows production checks unless explicit override is enabled', () => {
        expect(() => withRuntimeEnv({
            APP_ENV: 'staging',
            ALLOWED_ORIGINS: 'https://example.com'
        }, ({ runtime }) => runtime.validateRuntimeConfig())).toThrow(/Invalid runtime configuration/);

        const result = withRuntimeEnv({
            APP_ENV: 'staging',
            ALLOWED_ORIGINS: 'https://example.com',
            STAGING_ALLOW_INSECURE_TEST_OVERRIDE: 'true'
        }, ({ runtime }) => runtime.validateRuntimeConfig());

        expect(result.environment).toBe('staging');
        expect(result.isProductionClass).toBe(true);
    });

    test('DISABLE_SESSION_CONTROL is ignored outside local development', async () => {
        const allowed = await withRuntimeEnv({
            APP_ENV: 'staging',
            ALLOWED_ORIGINS: 'https://example.com',
            STAGING_ALLOW_INSECURE_TEST_OVERRIDE: 'true',
            DISABLE_SESSION_CONTROL: 'true'
        }, async ({ security }) => {
            const { hashToken, hasValidSessionControlAsync } = security;
            const db = {
                get() {
                    return { control_token_hash: hashToken('valid-token') };
                }
            };

            return hasValidSessionControlAsync(db, 'session-1', '');
        });

        expect(allowed).toBe(false);
    });

    test('createCorsOptions denies unknown origins in production-class environments', () => {
        withRuntimeEnv({
            APP_ENV: 'production',
            ALLOWED_ORIGINS: 'https://allowed.example.com',
            AZURE_OPENAI_ENDPOINT: 'https://azure.example.com',
            AZURE_OPENAI_API_KEY: 'key',
            AZURE_OPENAI_DEPLOYMENT_NAME: 'chat',
            AZURE_OPENAI_REALTIME_DEPLOYMENT: 'tts',
            AZURE_OPENAI_REALTIME_ENDPOINT: 'https://azure.example.com',
            AZURE_OPENAI_REALTIME_API_KEY: 'key'
        }, ({ runtime }) => {
            const corsOptions = runtime.createCorsOptions(runtime.parseAllowedOrigins());

            corsOptions.origin('https://blocked.example.com', (error, allowed) => {
                expect(error).toBeInstanceOf(Error);
                expect(error.message).toMatch(/Origin not allowed by CORS/);
                expect(allowed).toBeUndefined();
            });
        });
    });
});
