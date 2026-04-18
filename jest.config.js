module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    clearMocks: true,
    restoreMocks: true
};
