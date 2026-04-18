function withRuntimeEnv(overrides, run) {
    const originalEnv = { ...process.env };
    const runtimeModulePath = require.resolve('../../server/config/runtime');
    const securityModulePath = require.resolve('../../server/middleware/security');

    Object.keys(process.env).forEach((key) => {
        delete process.env[key];
    });

    Object.assign(process.env, originalEnv, overrides);

    delete require.cache[runtimeModulePath];
    delete require.cache[securityModulePath];

    try {
        return run({
            runtime: require('../../server/config/runtime'),
            security: require('../../server/middleware/security')
        });
    } finally {
        delete require.cache[runtimeModulePath];
        delete require.cache[securityModulePath];
        Object.keys(process.env).forEach((key) => {
            delete process.env[key];
        });
        Object.assign(process.env, originalEnv);
    }
}

module.exports = {
    withRuntimeEnv
};
