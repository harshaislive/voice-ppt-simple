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
        const slideTurnMic = document.getElementById('slide-turn-mic');
        const slideTurnMicLabel = document.getElementById('slide-turn-mic-label');

        const active = isListening || (voiceModeEnabled && azureConnected);

        if (button) {
            button.classList.toggle('listening', active);
            button.classList.toggle('armed', voiceModeEnabled && !azureConnected);
        }
        
        if (label) {
            label.textContent = voiceModeEnabled ? 'End Voice' : isListening ? 'Listening...' : 'Interrupt';
        }

        if (slideTurnMic) {
            slideTurnMic.classList.toggle('is-live', active);
        }
        
        if (slideTurnMicLabel) {
            slideTurnMicLabel.textContent = voiceModeEnabled ? 'End Voice Session' : 'Talk To Presenter';
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

    openSlideTurnOverlay(data = {}) {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        const statusDetail = document.getElementById('status-detail');
        const continueBtn = document.getElementById('footer-continue-btn');
        const overlay = document.getElementById('slide-turn-overlay');
        const turnDetail = document.getElementById('slide-turn-detail');
        if (statusDot) statusDot.className = 'status-dot your-turn';
        if (statusText) statusText.textContent = 'Your Turn';
        if (statusDetail) statusDetail.textContent = 'Tap mic or continue';
        if (overlay) overlay.classList.remove('hidden');
        if (turnDetail && data && data.pendingQuestionCount > 0) {
            turnDetail.textContent = `${data.pendingQuestionCount} question${data.pendingQuestionCount > 1 ? 's' : ''} queued — ask now or continue`;
        }
        if (continueBtn) {
            continueBtn.classList.remove('hidden');
            continueBtn.classList.add('visible');
        }
    }

    closeSlideTurnOverlay() {
        const overlay = document.getElementById('slide-turn-overlay');
        const continueBtn = document.getElementById('footer-continue-btn');
        if (overlay) overlay.classList.add('hidden');
        if (continueBtn) {
            continueBtn.classList.remove('visible');
            continueBtn.classList.add('hidden');
        }
    }
}
