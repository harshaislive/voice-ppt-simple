const controllers = new Map();

function normalize(value) {
    return String(value || '').trim();
}

function claimController(sessionId, clientInstanceId, socketId) {
    const normalizedSessionId = normalize(sessionId);
    const normalizedClientId = normalize(clientInstanceId);
    const normalizedSocketId = normalize(socketId);
    if (!normalizedSessionId || !normalizedClientId || !normalizedSocketId) {
        return { isController: false, controllerClientId: null };
    }

    const existing = controllers.get(normalizedSessionId);
    if (!existing || existing.clientInstanceId === normalizedClientId) {
        controllers.set(normalizedSessionId, {
            clientInstanceId: normalizedClientId,
            socketId: normalizedSocketId
        });
        return { isController: true, controllerClientId: normalizedClientId };
    }

    return { isController: false, controllerClientId: existing.clientInstanceId };
}

function getController(sessionId) {
    return controllers.get(normalize(sessionId)) || null;
}

function isControllerSocket(sessionId, socketId) {
    const controller = getController(sessionId);
    return Boolean(controller && controller.socketId === normalize(socketId));
}

function isControllerClient(sessionId, clientInstanceId) {
    const controller = getController(sessionId);
    return Boolean(controller && controller.clientInstanceId === normalize(clientInstanceId));
}

function releaseBySocket(socketId) {
    const normalizedSocketId = normalize(socketId);
    for (const [sessionId, controller] of controllers.entries()) {
        if (controller.socketId === normalizedSocketId) {
            controllers.delete(sessionId);
        }
    }
}

module.exports = {
    claimController,
    getController,
    isControllerSocket,
    isControllerClient,
    releaseBySocket
};
