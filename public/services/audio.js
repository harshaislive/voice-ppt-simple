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
        this._iosAudioUnlocked = false;
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

        // iOS Safari requires explicit user gesture to unlock audio
        // Try multiple times because iOS is picky about when resume() works
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                // Double-check it actually resumed
                if (this.audioContext.state === 'suspended') {
                    // Try again after small delay (iOS quirk)
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

    // Call this method on user interaction (tap/click) to unlock iOS audio
    unlockIOSAudio() {
        if (!this.audioContext) {
            this._ensureContext();
        } else {
            this._resumeContext();
        }
        // Also create a silent buffer to help iOS unlock
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
            }, 60);
        }

        if (this.isBuffering) {
            this.chunkQueue.push({ pcmBase64, sampleRate, channels });
        } else {
            this._processChunk(pcmBase64, sampleRate, channels);
        }
    }

    _flushQueue() {
        // Minimal scheduling buffer for faster first-byte playback
        const schedulingBuffer = 0.03;
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
        // Clear buffer timer
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        this.isBuffering = false;
        this.chunkQueue = [];

        // Stop all active sources immediately by disconnecting them
        // Do this BEFORE clearing activeSources array
        this.activeSources.forEach((source) => {
            // Clear onended callback first to prevent race
            source.onended = null;
            try {
                source.stop(0);
            } catch (e) {
                // ignore if already stopped
            }
            try {
                source.disconnect();
            } catch (e) {
                // ignore if already disconnected
            }
        });
        this.activeSources = [];
        this.nextStartTime = 0;

        // Set isPlaying to false LAST, after all sources are stopped
        this.isPlaying = false;
        this._streamStartNotified = false;
    }

    // Clear pending chunks without stopping active sources - for pause functionality
    clearPendingChunks() {
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        this.isBuffering = false;
        this.chunkQueue = [];
        this.nextStartTime = 0;
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

    async playPregeneratedAudio(pcmBase64, sampleRate, channels, wordBoundaries = []) {
        await this._ensureContext();
        
        const pcm = this._base64ToArrayBuffer(pcmBase64);
        const float32 = this._pcm16ToFloat32(pcm);
        const buffer = this.audioContext.createBuffer(channels || 1, float32.length, sampleRate || this.sampleRate);
        buffer.getChannelData(0).set(float32);
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = this.playbackRate;
        source.connect(this.gainNode);
        
        const schedulingBuffer = 0.03;
        const startTime = this.audioContext.currentTime + schedulingBuffer;
        source.start(startTime);
        
        this.isPlaying = true;
        this.activeSources.push(source);
        
        if (!this._streamStartNotified) {
            this._streamStartNotified = true;
            this.onStreamStart?.({
                audioContextStartTime: startTime,
                startedAtMs: performance.now() + (schedulingBuffer * 1000)
            });
        }
        
        source.onended = () => {
            this.activeSources = this.activeSources.filter((item) => item !== source);
            if (this.activeSources.length === 0) {
                this.isPlaying = false;
            }
        };
        
        return {
            duration: buffer.duration,
            durationMs: Math.round(buffer.duration * 1000),
            wordBoundaries
        };
    }
}
