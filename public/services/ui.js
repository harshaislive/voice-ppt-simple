export class UIManager {
    constructor(app) {
        this.app = app;
        this.loadingQuotes = [];
        this.currentQuoteIndex = 0;
        this.loadingTimer = null;
    }

    async showLoadingScreen(quotes) {
        this.loadingQuotes = quotes;
        const overlay = document.getElementById('loading-overlay');
        const quoteText = document.getElementById('loading-quote-text');
        const quoteAuthor = document.getElementById('loading-quote-author');
        const progressFill = document.getElementById('loading-progress-fill');
        
        if (!overlay) return;
        
        overlay.classList.remove('hidden');
        this.currentQuoteIndex = Math.floor(Math.random() * this.loadingQuotes.length);
        this._updateQuote();

        // Start progress bar animation (simulated for 12 seconds)
        let progress = 0;
        const duration = 12000;
        const interval = 100;
        const step = (interval / duration) * 100;

        if (this.loadingTimer) clearInterval(this.loadingTimer);
        
        return new Promise((resolve) => {
            this.loadingTimer = setInterval(() => {
                progress += step;
                if (progressFill) progressFill.style.width = `${Math.min(progress, 100)}%`;
                
                // Switch quote every 4 seconds
                if (Math.floor(progress) % 33 === 0 && progress > 5 && progress < 90) {
                    this.currentQuoteIndex = (this.currentQuoteIndex + 1) % this.loadingQuotes.length;
                    this._updateQuote();
                }

                if (progress >= 100) {
                    clearInterval(this.loadingTimer);
                    setTimeout(() => {
                        overlay.classList.add('hidden');
                        resolve();
                    }, 500);
                }
            }, interval);
        });
    }

    _updateQuote() {
        const quoteText = document.getElementById('loading-quote-text');
        const quoteAuthor = document.getElementById('loading-quote-author');
        const quote = this.loadingQuotes[this.currentQuoteIndex];
        
        if (quoteText) {
            quoteText.style.opacity = 0;
            setTimeout(() => {
                quoteText.textContent = `"${quote.text}"`;
                quoteText.style.opacity = 1;
            }, 500);
        }
        if (quoteAuthor) {
            quoteAuthor.style.opacity = 0;
            setTimeout(() => {
                quoteAuthor.textContent = quote.author;
                quoteAuthor.style.opacity = 0.4;
            }, 500);
        }
    }

    renderTranscriptWaiting(containerId, hint = '') {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'transcript-reel transcript-reel-waiting';

        const meta = document.createElement('div');
        meta.className = 'transcript-reel-meta';
        meta.textContent = 'Composing';

        const lines = document.createElement('div');
        lines.className = 'transcript-reel-lines';
        const phrases = [
            'finding the next line',
            'setting the room tone',
            'forming the opening beat'
        ];
        phrases.forEach((phrase, index) => {
            const pill = document.createElement('span');
            pill.className = 'transcript-reel-pill';
            pill.style.animationDelay = `${index * 220}ms`;
            pill.textContent = phrase;
            lines.appendChild(pill);
        });

        wrap.append(meta, lines);
        container.appendChild(wrap);
    }

    renderTranscriptReel(containerId, data = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const state = data.state || 'waiting';
        const phrase = String(data.phrase || '').trim();
        if (state === 'waiting' || !phrase) {
            this.renderTranscriptWaiting(containerId, data.note || '');
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = `transcript-reel transcript-reel-${state}`;

        const meta = document.createElement('div');
        meta.className = 'transcript-reel-meta';
        meta.textContent = data.headline || 'Speaking';

        const phraseEl = document.createElement('div');
        phraseEl.className = 'transcript-reel-phrase';
        phraseEl.textContent = phrase;

        wrap.append(meta, phraseEl);
        container.appendChild(wrap);
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
            el.textContent = transcript.trim() || '';
        }
    }

    renderAnswerReel(target, text = '') {
        const container = typeof target === 'string' ? document.getElementById(target) : target;
        if (!container) return;
        container.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'qa-answer-reel';

        const pieces = String(text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .split(/(?<=[.!?])\s+|,\s+/)
            .map((part) => part.trim())
            .filter(Boolean);

        const fallbackPieces = pieces.length > 0 ? pieces : [String(text || '').trim()].filter(Boolean);

        fallbackPieces.forEach((piece, index) => {
            const span = document.createElement('span');
            span.className = 'qa-answer-piece';
            span.style.animationDelay = `${index * 120}ms`;
            span.textContent = piece;
            wrap.appendChild(span);
        });

        container.appendChild(wrap);
    }

    updateMicState(isListening, voiceModeEnabled, azureConnected) {
        const button = document.getElementById('interrupt-mic');
        const label = document.getElementById('interrupt-label');
        const slideTurnMic = document.getElementById('slide-turn-mic');
        const slideTurnMicLabel = document.getElementById('slide-turn-mic-label');
        const wrapupMic = document.getElementById('wrapup-mic');
        const wrapupMicLabel = document.getElementById('wrapup-mic-label');

        if (button) {
            button.classList.remove('listening', 'armed');
        }
        
        if (label) {
            label.textContent = 'Questions';
        }

        if (slideTurnMic) {
            slideTurnMic.classList.remove('is-live');
        }
        
        if (slideTurnMicLabel) {
            slideTurnMicLabel.textContent = 'Queue Question';
        }

        if (wrapupMic) {
            wrapupMic.classList.remove('listening');
        }

        if (wrapupMicLabel) {
            wrapupMicLabel.textContent = 'Questions';
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
        if (statusDetail) statusDetail.textContent = 'Type a question to queue it';
        if (overlay) overlay.classList.remove('hidden');
        if (turnDetail && data && data.pendingQuestionCount > 0) {
            turnDetail.textContent = `${data.pendingQuestionCount} question${data.pendingQuestionCount > 1 ? 's' : ''} queued — they will be answered after the slide`;
        } else if (turnDetail) {
            turnDetail.textContent = 'Type a question. The answer will appear between slides.';
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
