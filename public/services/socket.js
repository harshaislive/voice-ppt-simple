export class SocketClient {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
        this.isReady = false;
        this._connectTimeoutId = null;
        this._disconnecting = false;
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

            this.socket.on('question-answer-ready', (data) => {
                this.app.handleQuestionAnswerReady(data);
            });

            this.socket.on('queue-update', (data) => {
                this.app.handleQueueUpdate(data);
            });

            this.socket.on('presentation-end', (data) => {
                this.app.sessionStatus = 'completed';
                this.app.setStatus('Complete', '', 'Presentation finished');
                this.app.showCompletion(data);
                this.app.stopWaveform();
            });

            this.socket.on('presentation-wrapup', (data) => {
                this.app.startWrapUp(data);
            });

            this.socket.on('qa-slides-ready', (data) => {
                this.app.renderQASlides(data.questions);
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

            this.socket.on('receive-reaction', (data) => {
                if (data?.emoji) {
                    this.app.spawnReaction(data.emoji);
                }
            });

            this.socket.on('significant-reactions', (data) => {
                this.app.handleSignificantReactions(data);
            });

            this.socket.on('votes-sync', (data) => {
                this.app.handleVotesSync(data);
            });

            this.socket.on('vote-update', (data) => {
                this.app.handleVoteUpdate(data);
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
    }

    sendReaction(emoji) {
        if (this.socket && this.isConnected && this.isReady) {
            this.socket.emit('send-reaction', { emoji, sessionId: this.app.sessionId });
        }
    }

    submitVote(mcqId, option) {
        if (this.socket && this.isConnected && this.isReady) {
            this.socket.emit('submit-vote', { sessionId: this.app.sessionId, mcqId, option });
        }
    }

    notifyPlaybackComplete(sessionId, slideIndex) {
        if (!this.socket || !this.isConnected || !this.isReady || !sessionId) {
            return;
        }
        this.socket.emit('presentation-audio-complete', { sessionId, slideIndex });
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
