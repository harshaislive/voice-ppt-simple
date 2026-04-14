export class UIManager {
    constructor(app) {
        this.app = app;
    }

    static MIC_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>';
    static CLOSE_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

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
        const icon = document.getElementById('interrupt-icon');
        const wrapupMic = document.getElementById('wrapup-mic');
        const wrapupMicLabel = document.getElementById('wrapup-mic-label');
        const wrapupMicIcon = document.getElementById('wrapup-mic-icon');

        const active = isListening || (voiceModeEnabled && azureConnected);
        const canEndVoice = voiceModeEnabled || active;

        if (button) {
            button.classList.toggle('listening', active);
            button.classList.toggle('armed', voiceModeEnabled && !azureConnected);
            button.setAttribute('aria-label', canEndVoice ? 'End voice mode' : 'Interrupt and speak');
        }
        
        if (label) {
            label.textContent = voiceModeEnabled ? 'End Voice' : isListening ? 'Listening...' : 'Interrupt';
        }

        if (icon) {
            icon.innerHTML = canEndVoice ? UIManager.CLOSE_ICON : UIManager.MIC_ICON;
        }

        if (wrapupMic) {
            wrapupMic.classList.toggle('listening', active);
            wrapupMic.setAttribute('aria-label', canEndVoice ? 'End voice mode' : 'Speak to agent');
        }

        if (wrapupMicLabel) {
            wrapupMicLabel.textContent = voiceModeEnabled ? 'End Voice' : isListening ? 'Listening...' : 'Ask Anything';
        }

        if (wrapupMicIcon) {
            wrapupMicIcon.innerHTML = canEndVoice ? UIManager.CLOSE_ICON : UIManager.MIC_ICON;
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
