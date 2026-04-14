export class StreamAudioPlayer {
    constructor() {
        this.audioContext = null;
        this.nextStartTime = 0;
        this.isPlaying = false;
        this.sampleRate = 24000;
        this.playbackRate = 1.0;
        this.gainNode = null;
        this.analyserNode = null;
        this.activeSources = [];
        this.chunkQueue = [];
        this.bufferTimer = null;
        this.isBuffering = false;
        this.onStreamStart = null;
        this._streamStartNotified = false;
    }

    _ensureContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.5;
            
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 256;
            
            this.gainNode.connect(compressor);
            compressor.connect(this.analyserNode);
            this.analyserNode.connect(this.audioContext.destination);
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    playChunk(pcmBase64, sampleRate, channels) {
        this._ensureContext();
        
        if (!this.isPlaying && !this.isBuffering) {
            this.isBuffering = true;
            this.chunkQueue = [];
            if (this.bufferTimer) clearTimeout(this.bufferTimer);
            this.bufferTimer = setTimeout(() => {
                this.isBuffering = false;
                this.bufferTimer = null;
                this._flushQueue();
            }, 250);
        }

        if (this.isBuffering) {
            this.chunkQueue.push({ pcmBase64, sampleRate, channels });
        } else {
            this._processChunk(pcmBase64, sampleRate, channels);
        }
    }

    _flushQueue() {
        // Add a small scheduling buffer (50ms) to ensure smooth transition from buffering to playing
        const schedulingBuffer = 0.05;
        this.nextStartTime = this.audioContext.currentTime + schedulingBuffer;
        if (!this._streamStartNotified) {
            this._streamStartNotified = true;
            this.onStreamStart?.({
                audioContextStartTime: this.nextStartTime,
                startedAtMs: performance.now() + (schedulingBuffer * 1000)
            });
        }
        
        while (this.chunkQueue.length > 0) {
            const chunk = this.chunkQueue.shift();
            this._processChunk(chunk.pcmBase64, chunk.sampleRate, chunk.channels);
        }
    }

    _processChunk(pcmBase64, sampleRate, channels) {
        const pcm = this._base64ToArrayBuffer(pcmBase64);
        const float32 = this._pcm16ToFloat32(pcm);
        const source = this.audioContext.createBufferSource();
        const buffer = this.audioContext.createBuffer(channels || 1, float32.length, sampleRate || this.sampleRate);
        buffer.getChannelData(0).set(float32);
        source.buffer = buffer;
        source.playbackRate.value = this.playbackRate;
        source.connect(this.gainNode);

        const now = this.audioContext.currentTime;
        const startTime = Math.max(now, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + (buffer.duration / this.playbackRate);
        this.isPlaying = true;
        this.activeSources.push(source);

        source.onended = () => {
            this.activeSources = this.activeSources.filter((item) => item !== source);
            if (this.activeSources.length === 0) {
                this.isPlaying = false;
            }
        };
    }

    hasPendingPlayback() {
        if (this.isBuffering) return true;
        if (this.chunkQueue.length > 0) return true;
        if (this.activeSources.length > 0) return true;
        if (this.isPlaying) return true;
        if (this.audioContext && this.nextStartTime > this.audioContext.currentTime) return true;
        return false;
    }

    reset() {
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        this.isBuffering = false;
        this.chunkQueue = [];
        this.activeSources.forEach((source) => {
            try { source.stop(); } catch {}
        });
        this.activeSources = [];
        this.nextStartTime = 0;
        this.isPlaying = false;
        this._streamStartNotified = false;
    }

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    _pcm16ToFloat32(buffer) {
        const view = new DataView(buffer);
        const float32 = new Float32Array(view.byteLength / 2);
        for (let i = 0; i < float32.length; i++) {
            const sample = view.getInt16(i * 2, true);
            float32[i] = sample < 0 ? sample / 32768 : sample / 32767;
        }
        return float32;
    }
}
