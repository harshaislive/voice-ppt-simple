const autoplex = require('../../server/routes/autoplex');

describe('master asset bypass rules', () => {
    test('personalized sessions bypass master assets', () => {
        expect(autoplex.shouldBypassMasterAssets({}, 'Harsha')).toBe(true);
        expect(autoplex.shouldBypassMasterAssets({ participantName: 'Taylor' }, '')).toBe(true);
    });

    test('explicit bypass flag still bypasses master assets', () => {
        expect(autoplex.shouldBypassMasterAssets({ bypassMaster: true }, '')).toBe(true);
    });

    test('anonymous sessions may still use master assets', () => {
        expect(autoplex.shouldBypassMasterAssets({}, '')).toBe(false);
        expect(autoplex.shouldBypassMasterAssets({ participantName: '   ' }, '')).toBe(false);
    });
});
