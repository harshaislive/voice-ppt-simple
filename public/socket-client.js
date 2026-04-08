class SocketClient {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
    }

    connect(sessionId) {
        if (this.socket) this.disconnect();

        this.socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000
        });

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.socket.emit('join-session', sessionId);
            this.app.setStatus('Connected', 'live');
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            this.app.setStatus('Disconnected', '');
        });

        this.socket.on('presentation-start', (data) => {
            this.app.setStatus('Presenting', 'live');
            this.app.slides = new Array(data.totalSlides).fill(null);
        });

        this.socket.on('slide-change', (data) => {
            this.app.updateSlide(data);
        });

        this.socket.on('narration-delta', (data) => {
            this.app.handleNarrationDelta(data);
        });

        this.socket.on('narration-text', (data) => {
            document.getElementById('transcript-text').textContent = data.text;
            this.app.showTranscript(true);
        });

        this.socket.on('audio-chunk', (data) => {
            this.app.handleAudioChunk(data);
        });

        this.socket.on('audio-end', (data) => {
            this.app.handleAudioEnd();
        });

        this.socket.on('qa-start', (data) => {
            this.app.isQAPhase = true;
            this.app.setStatus('Q&A', 'paused');
            this.app.expandQAPanel();
        });

        this.socket.on('answering-question', (data) => {
            this.app.setStatus(`Q&A ${data.questionIndex}/${data.totalQuestions}`, 'live');
        });

        this.socket.on('answer-delta', (data) => {
            this.app.handleNarrationDelta({ delta: data.delta, full: data.full });
        });

        this.socket.on('answer-text', (data) => {
            this.app.showAnswer(data.questionId, data.answer, data.question);
        });

        this.socket.on('qa-end', (data) => {
            this.app.setStatus('Q&A Complete', 'paused');
            this.app.showTranscript(false);
            this.app.stopWaveform();
        });

        this.socket.on('question-added', (data) => {
            this.app.addQuestionToList(data.questionId, data.questionText);
        });

        this.socket.on('presentation-end', (data) => {
            this.app.setStatus('Complete', '');
            this.app.showCompletion(data);
            this.app.stopWaveform();
        });

        this.socket.on('presentation-error', (data) => {
            this.app.setStatus('Error', '');
            console.error('Presentation error:', data.error);
        });
    }

    disconnect() {
        if (this.socket) { this.socket.disconnect(); this.socket = null; }
        this.isConnected = false;
    }
}