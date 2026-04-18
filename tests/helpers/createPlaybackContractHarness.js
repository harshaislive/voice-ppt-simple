const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const autoplex = require('../../server/routes/autoplex');

async function createPlaybackContractHarness() {
    autoplex.resetPlaybackContracts();

    const server = http.createServer();
    const io = new Server(server, {
        cors: { origin: true }
    });

    io.on('connection', (socket) => {
        socket.on('join-session', (payload = {}) => {
            socket.data.clientInstanceId = payload.clientInstanceId || '';
            socket.data.sessionId = payload.sessionId || '';
            if (payload.sessionId) {
                socket.join(payload.sessionId);
            }
            socket.emit('session-joined', {
                sessionId: payload.sessionId,
                isController: true,
                playbackContractVersion: 1
            });
        });

        socket.on('presentation-audio-complete', (payload = {}) => {
            autoplex.markPlaybackComplete(payload.sessionId, payload.slideIndex, {
                clientInstanceId: payload.clientInstanceId || socket.data.clientInstanceId || '',
                socketId: socket.id
            });
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    return {
        waitForPlaybackCompletion(sessionId, fallbackMs, expectedSlideIndex) {
            return autoplex.waitForPlaybackCompletion(sessionId, fallbackMs, expectedSlideIndex);
        },
        getPlaybackContract(sessionId) {
            return autoplex.getPlaybackContract(sessionId);
        },
        async connectClient(sessionId, clientInstanceId = 'client-1') {
            const client = new Client(`http://127.0.0.1:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            await new Promise((resolve, reject) => {
                client.on('connect', () => {
                    client.emit('join-session', { sessionId, clientInstanceId });
                });
                client.on('session-joined', resolve);
                client.on('connect_error', reject);
            });

            return client;
        },
        async close() {
            autoplex.resetPlaybackContracts();
            await new Promise((resolve) => io.close(resolve));
            await new Promise((resolve) => server.close(resolve));
        }
    };
}

module.exports = {
    createPlaybackContractHarness
};
