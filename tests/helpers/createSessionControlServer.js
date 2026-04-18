const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { hasValidSessionControlAsync } = require('../../server/middleware/security');

async function createSessionControlServer({ db, logger = null } = {}) {
    const app = express();
    app.set('db', db);
    if (logger) {
        app.set('logger', logger);
    }

    const server = http.createServer(app);
    const io = new Server(server, {
        cors: { origin: true }
    });

    io.on('connection', (socket) => {
        socket.on('join-session', async (payload = {}) => {
            const sessionId = typeof payload === 'string' ? payload : payload.sessionId;
            const controlToken = typeof payload === 'object' ? String(payload.controlToken || '') : '';
            const valid = await hasValidSessionControlAsync(app.get('db'), sessionId, controlToken);

            if (!valid) {
                socket.emit('session-join-error', { error: 'Valid session control token required' });
                return;
            }

            socket.join(sessionId);
            socket.emit('session-joined', { sessionId, isController: true });
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    return {
        app,
        io,
        server,
        url: `http://127.0.0.1:${address.port}`,
        close: async () => {
            await new Promise((resolve) => io.close(resolve));
            await new Promise((resolve) => server.close(resolve));
        }
    };
}

module.exports = {
    createSessionControlServer
};
