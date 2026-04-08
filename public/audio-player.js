class AudioPlayer {
    constructor(app) {
        this.app = app;
        this.audioElement = document.getElementById('audio-player');
    }

    playBuffer(arrayBuffer) {
        try {
            const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            this.audioElement.src = url;
            this.audioElement.load();
            this.audioElement.play().catch(() => {});
        } catch (e) { console.error('Audio play error:', e); }
    }

    playBase64(base64Data) { return this.playBuffer(this.app.base64ToArrayBuffer ? this.app.base64ToArrayBuffer(base64Data) : this._base64ToArrayBuffer(base64Data)); }

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    stop() { this.audioElement.pause(); this.audioElement.currentTime = 0; }
}