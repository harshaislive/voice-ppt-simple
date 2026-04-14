export class UIManager {
    constructor(app) {
        this.app = app;
    }

    setStatus(text, state, detail = '') {
        const statusText = document.getElementById('status-text');
        const statusDetail = document.getElementById('status-detail');
        const dot = document.getElementById('status-dot');

        if (statusText) statusText.textContent = text;
        if (statusDetail) statusDetail.textContent = detail;
        
        if (dot) {
            dot.className = 'status-dot';
            if (state === 'live') {
                dot.classList.add('live');
            } else if (state === 'paused') {
                dot.classList.add('paused');
            }
        }
    }

    showTranscript(speaking) {
        // Removed transcript bar
    }

    renderSubtitle(text, ready) {
        // Subtitle rendering moved to read-along accordion
    }

    updateFullTranscriptionDisplay(transcript) {
        const el = document.getElementById('full-transcription');
        if (el) {
            el.textContent = transcript.trim() || 'No transcription yet...';
        }
    }

    updateMicState(isListening, voiceModeEnabled, azureConnected) {
        const button = document.getElementById('interrupt-mic');
        const label = document.getElementById('interrupt-label');
        const wrapupMic = document.getElementById('wrapup-mic');
        const wrapupMicLabel = document.getElementById('wrapup-mic-label');

        const active = isListening || (voiceModeEnabled && azureConnected);

        if (button) {
            button.classList.toggle('listening', active);
            button.classList.toggle('armed', voiceModeEnabled && !azureConnected);
        }
        
        if (label) {
            label.textContent = voiceModeEnabled ? 'End Voice' : isListening ? 'Listening...' : 'Interrupt';
        }

        if (wrapupMic) {
            wrapupMic.classList.toggle('listening', active);
        }

        if (wrapupMicLabel) {
            wrapupMicLabel.textContent = voiceModeEnabled ? 'End Voice' : isListening ? 'Listening...' : 'Ask Anything';
        }
    }

    toggleQuestionDrawer(forceOpen) {
        const panel = document.getElementById('qa-panel');
        const scrim = document.getElementById('qa-scrim');
        if (!panel || !scrim) return;

        const open = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        scrim.classList.toggle('hidden', !open);
        
        if (open) {
            const input = document.getElementById('question-input');
            if (input) input.focus();
        }
    }

    syncQuestionCount(total, pending) {
        const qaCount = document.getElementById('qa-count');
        const qaBadge = document.getElementById('qa-count-badge');
        const dockCount = document.getElementById('dock-queue-count');

        if (qaCount) qaCount.textContent = total;
        if (qaBadge) {
            qaBadge.textContent = pending;
            qaBadge.classList.toggle('is-zero', pending === 0);
        }
        if (dockCount) {
            dockCount.textContent = `${pending} queued`;
        }
    }
}
