function createDocumentStub() {
    const elements = new Map();

    function makeElement(id) {
        return {
            id,
            textContent: '',
            innerHTML: '',
            disabled: false,
            style: {},
            classList: {
                add: jest.fn(),
                remove: jest.fn(),
                toggle: jest.fn()
            },
            replaceChildren: jest.fn(),
            appendChild: jest.fn(),
            querySelector: jest.fn(() => null)
        };
    }

    return {
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, makeElement(id));
            }
            return elements.get(id);
        },
        createElement() {
            return makeElement('created');
        },
        createTextNode(text) {
            return { textContent: text };
        },
        addEventListener: jest.fn()
    };
}

function importVoicePPTAppModule() {
    return require('../../public/app.js');
}

function importAudioModule() {
    return require('../../public/services/audio.js');
}

module.exports = {
    createDocumentStub,
    importAudioModule,
    importVoicePPTAppModule
};
