export class AzureVoiceSession {
    constructor(app) {
        this.app = app;
        this.peer = null;
        this.dataChannel = null;
        this.localStream = null;
        this.remoteAudio = document.getElementById('audio-player');
        this.connected = false;
        this.connecting = false;
        this.pendingToolCalls = new Set();
        this.supported = Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
        this.voice = 'alloy';
        if (this.remoteAudio) {
            this.remoteAudio.autoplay = true;
            this.remoteAudio.playsInline = true;
        }
    }

    async connect() {
        if (this.connected || this.connecting) {
            return true;
        }

        this.connecting = true;
        this.app.setStatus('Connecting voice', 'paused', 'Opening Azure realtime session');

        try {
            const configRes = await this.app.apiFetch('/api/realtime/config');
            const config = await configRes.json();
            if (!config.enabled) {
                throw new Error('Azure realtime voice is not configured');
            }
            this.voice = config.voice || 'alloy';

            if (navigator.permissions?.query) {
                try {
                    const permission = await navigator.permissions.query({ name: 'microphone' });
                    if (permission.state === 'denied') {
                        this.app.handleMicPermissionError();
                        throw new Error('Microphone access is denied');
                    }
                } catch {
                    // Ignore browsers that do not support microphone permission queries cleanly.
                }
            }

            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
            } catch (err) {
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    this.app.handleMicPermissionError();
                }
                throw err;
            }

            this.peer = new RTCPeerConnection();
            this.localStream.getTracks().forEach((track) => this.peer.addTrack(track, this.localStream));

            this.peer.ontrack = (event) => {
                if (this.remoteAudio) {
                    this.remoteAudio.srcObject = event.streams[0];
                    this.remoteAudio.play().catch(() => {});
                }
            };

            this.peer.onconnectionstatechange = () => {
                if (this.peer.connectionState === 'connected') {
                    this.connected = true;
                    this.app.onVoiceSessionConnected();
                }
                if (['failed', 'closed', 'disconnected'].includes(this.peer.connectionState)) {
                    this.app.onVoiceSessionDisconnected();
                }
            };

            this.dataChannel = this.peer.createDataChannel('realtime-events');
            this.dataChannel.onopen = () => {
                this.syncSlideContext();
                this.app.setStatus('Mic is live', 'paused', 'Ask your question now. Tap again to end voice mode.');
            };
            this.dataChannel.onmessage = (event) => this.handleEvent(event.data);

            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);

            const connectRes = await this.app.apiFetch('/api/realtime/connect', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.app.sessionId,
                    sdp: offer.sdp,
                    slideContext: this.app.getCurrentSlideContext()
                })
            });

            const connectBody = await connectRes.json();
            if (!connectRes.ok) {
                throw new Error(connectBody.error || 'Realtime connect failed');
            }

            await this.peer.setRemoteDescription({ type: 'answer', sdp: connectBody.sdp });
            this.connected = true;
            this.connecting = false;
            return true;
        } catch (error) {
            console.error('Azure realtime voice connect failed:', error);
            await this.disconnect();
            this.connecting = false;
            return false;
        }
    }

    async disconnect() {
        this.connected = false;
        this.connecting = false;
        if (this.dataChannel) {
            try { this.dataChannel.close(); } catch {}
        }
        if (this.peer) {
            try { this.peer.close(); } catch {}
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach((track) => track.stop());
        }
        if (this.remoteAudio) {
            this.remoteAudio.srcObject = null;
        }
        this.dataChannel = null;
        this.peer = null;
        this.localStream = null;
    }

    syncSlideContext() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        const context = this.app.getCurrentSlideContext();
        this.dataChannel.send(JSON.stringify({
            type: 'session.update',
            session: {
                instructions: this.app.buildVoiceInstructions(context),
                tool_choice: 'auto',
                tools: this.app.getRealtimeTools(),
                output_modalities: ['audio'],
                audio: {
                    output: {
                        voice: this.voice
                    },
                    input: {
                        transcription: { model: 'whisper-1' },
                        turn_detection: {
                            type: 'server_vad',
                            threshold: 0.45,
                            prefix_padding_ms: 250,
                            silence_duration_ms: 600,
                            create_response: true,
                            interrupt_response: true
                        }
                    }
                }
            }
        }));
    }

    handleEvent(rawEvent) {
        let event;
        try {
            event = JSON.parse(rawEvent);
        } catch {
            return;
        }

        switch (event.type) {
            case 'input_audio_buffer.speech_started':
                this.app.onVoiceTurnState('Listening', 'paused', 'Ask your question now. Tap the mic again to return to the presentation.');
                break;
            case 'input_audio_buffer.speech_stopped':
                this.app.onVoiceTurnState('Thinking', 'paused', 'Azure is preparing a spoken response');
                break;
            case 'response.output_audio_transcript.delta':
                this.app.handleNarrationDelta({ delta: event.delta, append: true });
                break;
            case 'conversation.item.input_audio_transcription.completed':
                this.app.showVoiceTranscript(event.transcript || '');
                break;
            case 'response.function_call_arguments.done':
                this.handleFunctionCall(event);
                break;
            case 'response.output_item.done':
                if (event.item?.type === 'function_call') {
                    this.handleFunctionCall({
                        call_id: event.item.call_id,
                        name: event.item.name,
                        arguments: event.item.arguments
                    });
                }
                break;
            case 'response.created':
                this.app.onVoiceTurnState('Answering now', 'live', 'Azure realtime voice is responding');
                break;
            case 'response.done':
                this.app.onVoiceTurnState('Mic is live', 'paused', 'Ask another question, or tap the mic again to return to the presentation.');
                this.app.showTranscript(false);
                break;
            case 'error':
                console.error('Realtime voice event error:', event);
                this.app.onVoiceTurnState('Voice error', 'paused', event.error?.message || 'Realtime voice failed');
                break;
            default:
                break;
        }
    }

    requestResponse(options = {}) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        this.dataChannel.send(JSON.stringify({
            type: 'response.create',
            response: {
                output_modalities: ['audio'],
                instructions: options.instructions || undefined
            }
        }));
    }

    async handleFunctionCall(event) {
        const callId = event.call_id;
        const name = event.name;
        if (!callId || !name || this.pendingToolCalls.has(callId)) {
            return;
        }

        this.pendingToolCalls.add(callId);

        let args = {};
        try {
            args = event.arguments ? JSON.parse(event.arguments) : {};
        } catch {
            args = {};
        }

        try {
            const output = await this.app.executeRealtimeTool(name, args);
            this.sendToolResult(callId, output);
        } catch (error) {
            this.sendToolResult(callId, {
                ok: false,
                error: error.message || 'Tool execution failed'
            });
        } finally {
            this.pendingToolCalls.delete(callId);
        }
    }

    sendToolResult(callId, output) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        this.dataChannel.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(output)
            }
        }));

        this.dataChannel.send(JSON.stringify({
            type: 'response.create',
            response: {
                output_modalities: ['audio']
            }
        }));
    }
}
