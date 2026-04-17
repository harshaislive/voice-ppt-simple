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
        this.onTimelineUpdate = null;
        this._streamStartNotified = false;
        this._iosAudioUnlocked = false;
        this._isPaused = false;
        this.playbackStartedAtMs = null;
        this.playbackEndsAtMs = null;
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
        return this._resumeContext();
    }

    async _resumeContext() {
        if (!this.audioContext) return Promise.resolve();

        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                if (this.audioContext.state === 'suspended') {
                    await new Promise(r => setTimeout(r, 50));
                    await this.audioContext.resume();
                }
                this._iosAudioUnlocked = true;
            } catch (e) {
                console.warn('[Audio] Failed to resume AudioContext:', e);
            }
        }
        return Promise.resolve();
    }

    unlockIOSAudio() {
        if (!this.audioContext) {
            this._ensureContext();
        } else {
            this._resumeContext();
        }
        if (this.audioContext && this.audioContext.state === 'suspended') {
            const buffer = this.audioContext.createBuffer(1, 1, 22050);
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            source.start(0);
            source.stop(0);
            this._resumeContext();
        }
    }

    pause() {
        this._isPaused = true;
        this._stopAllSources();
        this._clearBuffers();
    }

    resume() {
        this._isPaused = false;
        // Reset buffering state so queued chunks get processed
        // The next chunk will trigger a fresh buffer cycle
        this.isBuffering = false;
    }

    _stopAllSources() {
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        this.isBuffering = false;

        this.activeSources.forEach((source) => {
            source.onended = null;
            try { source.stop(0); } catch {}
            try { source.disconnect(); } catch {}
        });
        this.activeSources = [];
        this.isPlaying = false;
        this.nextStartTime = 0;
        this.playbackStartedAtMs = null;
        this.playbackEndsAtMs = null;
    }

    _clearBuffers() {
        this.chunkQueue = [];
        this._streamStartNotified = false;
    }

    playChunk(pcmBase64, sampleRate, channels) {
        if (this._isPaused) return;

        this._ensureContext();

        if (!this.isPlaying && !this.isBuffering) {
            this.isBuffering = true;
            this.chunkQueue = [];
            if (this.bufferTimer) clearTimeout(this.bufferTimer);
            this.bufferTimer = setTimeout(() => {
                this.isBuffering = false;
                this.bufferTimer = null;
                this._flushQueue();
            }, 60);
        }

        if (this.isBuffering) {
            this.chunkQueue.push({ pcmBase64, sampleRate, channels });
        } else {
            this._processChunk(pcmBase64, sampleRate, channels);
        }
    }

    _flushQueue() {
        if (this._isPaused) return;

        const schedulingBuffer = 0.03;
        this.nextStartTime = this.audioContext.currentTime + schedulingBuffer;
        this.playbackStartedAtMs = performance.now() + (schedulingBuffer * 1000);
        if (!this._streamStartNotified) {
            this._streamStartNotified = true;
            this.onStreamStart?.({
                audioContextStartTime: this.nextStartTime,
                startedAtMs: this.playbackStartedAtMs
            });
        }
        this.onTimelineUpdate?.({
            startedAtMs: this.playbackStartedAtMs,
            endsAtMs: this.playbackEndsAtMs
        });

        while (this.chunkQueue.length > 0) {
            if (this._isPaused) return;
            const chunk = this.chunkQueue.shift();
            this._processChunk(chunk.pcmBase64, chunk.sampleRate, chunk.channels);
        }
    }

    _processChunk(pcmBase64, sampleRate, channels) {
        if (this._isPaused) return;

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
        const nowPerf = performance.now();
        const currentAudioTime = this.audioContext.currentTime;
        const startAtMs = nowPerf + ((startTime - currentAudioTime) * 1000);
        const endAtMs = nowPerf + ((this.nextStartTime - currentAudioTime) * 1000);
        if (!this.playbackStartedAtMs || startAtMs < this.playbackStartedAtMs) {
            this.playbackStartedAtMs = startAtMs;
        }
        this.playbackEndsAtMs = endAtMs;
        this.onTimelineUpdate?.({
            startedAtMs: this.playbackStartedAtMs,
            endsAtMs: this.playbackEndsAtMs
        });
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
        const hasScheduledAudio = this.audioContext && this.nextStartTime > this.audioContext.currentTime;
        const hasActiveSources = this.activeSources.length > 0;
        const hasQueuedChunks = this.chunkQueue.length > 0;
        const isCurrentlyBuffering = this.isBuffering;

        if (hasScheduledAudio || hasActiveSources || hasQueuedChunks || isCurrentlyBuffering) {
            return true;
        }
        return false;
    }

    reset() {
        this._stopAllSources();
        this._clearBuffers();
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

    async playPregeneratedAudio(pcmBase64, sampleRate, channels, wordBoundaries = []) {
        await this._ensureContext();

        const pcm = this._base64ToArrayBuffer(pcmBase64);
        const float32 = this._pcm16ToFloat32(pcm);
        const source = this.audioContext.createBufferSource();
        const buffer = this.audioContext.createBuffer(channels || 1, float32.length, sampleRate || this.sampleRate);
        buffer.getChannelData(0).set(float32);
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start(0);
        source.stop(0);
        this._resumeContext();
        // Track this source for proper hasPendingPlayback
        this.activeSources.push(source);
        this.isPlaying = true;
        const nowPerf = performance.now();
        this.playbackStartedAtMs = nowPerf;
        this.playbackEndsAtMs = nowPerf + (buffer.duration * 1000);
        this.onTimelineUpdate?.({
            startedAtMs: this.playbackStartedAtMs,
            endsAtMs: this.playbackEndsAtMs
        });
        source.onended = () => {
            this.activeSources = this.activeSources.filter((item) => item !== source);
            if (this.activeSources.length === 0) {
                this.isPlaying = false;
            }
        };
    }
}
