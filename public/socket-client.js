class SocketClient {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
    }

    connect(sessionId, controlToken) {
        if (this.socket) this.disconnect();

        this.socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000
        });

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.socket.emit('join-session', { sessionId, controlToken });
            this.app.setStatus('Connected', 'live', 'Joining presentation room');
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            this.app.setStatus('Disconnected', '', 'Socket connection lost');
        });

        this.socket.on('session-join-error', (data) => {
            this.app.setStatus('Access denied', '', data?.error || 'Could not join presentation room');
        });

        this.socket.on('presentation-start', (data) => {
            this.app.isQAPhase = false;
            if (!this.app.voiceModeEnabled) {
                this.app.restorePresentationStatus();
            }
        });

        this.socket.on('slide-change', (data) => {
            this.app.updateSlide(data);
        });

        this.socket.on('slide-turn-ready', (data) => {
            this.app.openSlideTurnOverlay(data);
        });

        this.socket.on('narration-delta', (data) => {
            this.app.handleNarrationDelta({ delta: data.delta, append: true });
        });

        this.socket.on('narration-text', (data) => {
            this.app.finalizeSubtitleText(data.text);
        });

        this.socket.on('audio-chunk', (data) => {
            this.app.handleAudioChunk(data);
        });

        this.socket.on('audio-end', (data) => {
            this.app.handleAudioEnd();
        });

        this.socket.on('qa-start', (data) => {
            this.app.isQAPhase = true;
            if (!this.app.voiceModeEnabled) {
                this.app.setStatus('Thinking', 'paused', data.inline ? 'Interrupt received. Building answer.' : 'Switching into audience Q&A');
            }
        });

        this.socket.on('answering-question', (data) => {
            this.app.voiceTurnState = 'answering';
            if (!this.app.voiceModeEnabled) {
                this.app.setStatus('Answering now', 'live', `Question ${data.questionIndex} of ${data.totalQuestions}`);
            }
        });

        this.socket.on('answer-delta', (data) => {
            this.app.handleNarrationDelta({ delta: data.delta, append: true });
        });

        this.socket.on('answer-text', (data) => {
            this.app.markQuestionAnswered(data.questionId, data.answer, data.question);
            this.app.finalizeSubtitleText(data.answer);
        });

        this.socket.on('qa-end', (data) => {
            this.app.isQAPhase = false;
            if (!this.app.voiceModeEnabled) {
                this.app.restorePresentationStatus();
            }
            this.app.showTranscript(false);
            this.app.stopWaveform();
        });

        this.socket.on('question-added', (data) => {
            this.app.addQuestionToList(data.questionId, data.questionText, data.submittedBy || 'Audience');
            this.app.voiceTurnState = 'thinking';
            if (!this.app.voiceModeEnabled) {
                this.app.setStatus('Thinking', 'paused', 'Question received and being prioritized');
            }
        });

        this.socket.on('queue-update', (data) => {
            this.app.handleQueueUpdate(data);
        });

        this.socket.on('presentation-end', (data) => {
            this.app.setStatus('Complete', '', 'Presentation finished');
            this.app.showCompletion(data);
            this.app.stopWaveform();
        });

        this.socket.on('presentation-wrapup', (data) => {
            this.app.startWrapUp(data);
        });

        this.socket.on('presentation-wrapup-ended', () => {
            this.app.finishWrapUp();
        });

        this.socket.on('presentation-paused', () => {
            if (!this.app.voiceModeEnabled) {
                this.app.setStatus('Paused', 'paused', 'Presentation is paused');
            }
        });

        this.socket.on('presentation-resumed', () => {
            this.app.restorePresentationStatus();
        });

        this.socket.on('presentation-error', (data) => {
            this.app.setStatus('Error', '', data.error || 'Presentation failed');
            console.error('Presentation error:', data.error);
        });
    }

    disconnect() {
        if (this.socket) { this.socket.disconnect(); this.socket = null; }
        this.isConnected = false;
    }

    notifyPlaybackComplete(sessionId) {
        if (!this.socket || !this.isConnected || !sessionId) {
            return;
        }
        this.socket.emit('presentation-audio-complete', { sessionId });
    }
}
