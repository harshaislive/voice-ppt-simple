export function buildPlaybackAckKey(sessionId, slideIndex) {
    if (!sessionId || !Number.isInteger(slideIndex)) {
        return '';
    }

    return `${sessionId}:${slideIndex}`;
}

export function shouldSendPlaybackAck({ sessionId, slideIndex, isConnected, isReady, lastAckKey }) {
    const nextKey = buildPlaybackAckKey(sessionId, slideIndex);
    if (!nextKey || !isConnected || !isReady) {
        return false;
    }

    return nextKey !== lastAckKey;
}

export class SocketClient {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
        this.isReady = false;
        this._connectTimeoutId = null;
        this._disconnecting = false;
        this._lastPlaybackAckKey = '';
    }

    connect(sessionId, controlToken) {
        if (this.socket) this.disconnect();

        // Expecting io to be globally available via <script src="/socket.io/socket.io.js"></script>
        if (typeof io === 'undefined') {
            console.error('Socket.IO (io) is not defined. Ensure /socket.io/socket.io.js is loaded.');
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            let resolved = false;
            const resolveOnce = (value) => {
                if (resolved) return;
                resolved = true;
                if (this._connectTimeoutId) {
                    clearTimeout(this._connectTimeoutId);
                    this._connectTimeoutId = null;
                }
                resolve(value);
            };
            const failConnect = (status, detail) => {
                this.app.setStatus(status, '', detail);
                resolveOnce(false);
                this.disconnect();
            };

            this.socket = io({
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 1000
            });
            this._disconnecting = false;

            this.socket.on('connect', () => {
                this.isConnected = true;
                this.isReady = false;
                this.socket.emit('join-session', {
                    sessionId,
                    controlToken,
                    clientInstanceId: this.app.clientInstanceId
                });
                this.app.setStatus('Connected', 'live', 'Joining presentation room');
            });

            this.socket.on('connect_error', (err) => {
                this.isConnected = false;
                this.isReady = false;
                failConnect('Disconnected', err?.message || 'Could not connect to presentation room');
            });

            this.socket.on('session-joined', (data) => {
                if (data?.sessionId === sessionId) {
                    this.isReady = true;
                    resolveOnce(true);
                }
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.isReady = false;
                if (!this._disconnecting) {
                    this.app.setStatus('Disconnected', '', 'Socket connection lost');
                }
            });

            this.socket.on('session-join-error', (data) => {
                this.isReady = false;
                failConnect('Access denied', data?.error || 'Could not join presentation room');
            });

            this.socket.on('presentation-start', (data) => {
                this.resetPlaybackAck();
                this.app.isQAPhase = false;
                this.app.sessionStatus = 'presenting';
                if (data?.totalSlides) {
                    this.app.totalSlides = data.totalSlides;
                }
                if (!this.app.voiceModeEnabled) {
                    this.app.restorePresentationStatus();
                }
            });

            this.socket.on('slide-change', (data) => {
                this.resetPlaybackAck(data?.slideIndex);
                this.app.updateSlide(data);
            });

            this.socket.on('slide-turn-ready', (data) => {
                // Auto-advance: no overlay popup, slides transition seamlessly
            });

            this.socket.on('narration-delta', (data) => {
                this.app.handleNarrationDelta({ delta: data.delta, append: true });
            });

            this.socket.on('narration-text', (data) => {
                this.app.handleNarrationText(data);
            });

            this.socket.on('audio-chunk', (data) => {
                this.app.handleAudioChunk(data);
            });

            this.socket.on('word-boundaries', (data) => {
                this.app.handleWordBoundaries(data);
            });

            this.socket.on('audio-end', (data) => {
                this.app.handleAudioEnd(data);
            });

            this.socket.on('qa-start', (data) => {
                this.app.enterQuestionAnswerMode?.(data);
            });

            this.socket.on('answering-question', (data) => {
                this.app.voiceTurnState = 'answering';
                if (!this.app.voiceModeEnabled) {
                    this.app.setStatus('Answering now', 'live', `Question ${data.questionIndex} of ${data.totalQuestions}`);
                }
            });

            this.socket.on('answer-delta', (data) => {
                if (this.app.handleQuestionAnswerDelta) {
                    this.app.handleQuestionAnswerDelta(data);
                    return;
                }
                this.app.handleNarrationDelta({ delta: data.delta, append: true, isQA: true });
            });

            this.socket.on('answer-text', (data) => {
                if (this.app.handleQuestionAnswerText) {
                    this.app.handleQuestionAnswerText(data);
                    return;
                }
                this.app.markQuestionAnswered(data.questionId, data.answer, data.question);
                this.app.finalizeSubtitleText(data.answer);
            });

            this.socket.on('qa-end', (data) => {
                if (this.app.exitQuestionAnswerMode) {
                    this.app.exitQuestionAnswerMode(data);
                    return;
                }
                this.app.isQAPhase = false;
                if (!this.app.voiceModeEnabled) {
                    this.app.restorePresentationStatus();
                }
                this.app.showTranscript(false);
                this.app.stopWaveform();
            });

            this.socket.on('question-added', (data) => {
                this.app.addQuestionToList(data.questionId, data.questionText, data.submittedBy || 'You');
                this.app.voiceTurnState = 'thinking';
                if (!this.app.voiceModeEnabled) {
                    this.app.setStatus('Thinking', 'paused', 'Question received and being prioritized');
                }
            });

            this.socket.on('question-answer-ready', (data) => {
                this.app.handleQuestionAnswerReady(data);
            });

            this.socket.on('queue-update', (data) => {
                this.app.handleQueueUpdate(data);
            });

            this.socket.on('presentation-end', (data) => {
                this.resetPlaybackAck();
                this.app.sessionStatus = 'completed';
                this.app.setStatus('Complete', '', 'Presentation finished');
                this.app.showCompletion(data);
                this.app.stopWaveform();
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

            this._connectTimeoutId = setTimeout(() => {
                failConnect('Disconnected', 'Timed out joining presentation room');
            }, 2500);
        });
    }

    disconnect() {
        if (this._connectTimeoutId) {
            clearTimeout(this._connectTimeoutId);
            this._connectTimeoutId = null;
        }
        if (this.socket) {
            this._disconnecting = true;
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.isReady = false;
        this._lastPlaybackAckKey = '';
    }

    resetPlaybackAck(slideIndex = null) {
        if (Number.isInteger(slideIndex) && this.app?.sessionId) {
            const nextKey = buildPlaybackAckKey(this.app.sessionId, slideIndex);
            if (this._lastPlaybackAckKey === nextKey) {
                this._lastPlaybackAckKey = '';
            }
            return;
        }

        this._lastPlaybackAckKey = '';
    }

    notifyPlaybackComplete(sessionId, slideIndex) {
        if (!shouldSendPlaybackAck({
            sessionId,
            slideIndex,
            isConnected: this.isConnected,
            isReady: this.isReady,
            lastAckKey: this._lastPlaybackAckKey
        })) {
            return false;
        }

        this._lastPlaybackAckKey = buildPlaybackAckKey(sessionId, slideIndex);
        this.socket.emit('presentation-audio-complete', {
            sessionId,
            slideIndex,
            clientInstanceId: this.app?.clientInstanceId || ''
        });
        return true;
    }

    async goToSlide(index) {
        if (!this.app.sessionId) return;
        try {
            await this.app.apiFetch('/api/slide/advance', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: this.app.sessionId,
                    targetSlide: index
                })
            });
        } catch (err) {
            console.error('Failed to go to slide:', err);
        }
    }
}
