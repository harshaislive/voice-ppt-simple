export class UIManager {
    constructor(app) {
        this.app = app;
        this.loadingQuotes = [];
        this.currentQuoteIndex = 0;
        this.loadingTimer = null;
    }

    showLoadingScreen(quotes) {
        const fallbackQuotes = [
            { text: "10% isn't about subtraction - it's about protection.", author: 'Beforest' },
            { text: 'Nature does not hurry, yet everything is accomplished.', author: 'Lao Tzu' }
        ];
        this.loadingQuotes = Array.isArray(quotes) && quotes.length > 0 ? quotes : fallbackQuotes;
        const overlay = document.getElementById('loading-overlay');
        const quoteText = document.getElementById('loading-quote-text');
        const quoteAuthor = document.getElementById('loading-quote-author');
        const progressFill = document.getElementById('loading-progress-fill');
        const progressLabel = document.getElementById('loading-progress-label');
        
        if (!overlay) return;
        
        overlay.classList.remove('hidden');
        this.currentQuoteIndex = Math.floor(Math.random() * this.loadingQuotes.length);
        this._updateQuote();

        // Reset progress to 0% — real pre-generation progress will drive the bar.
        if (this.loadingTimer) clearInterval(this.loadingTimer);
        this.loadingTimer = null;
        if (progressFill) progressFill.style.width = '0%';
        if (progressLabel) progressLabel.textContent = 'Initializing presentation...';

        // Rotate quotes while waiting — but don't fake progress.
        this.loadingTimer = setInterval(() => {
            this.currentQuoteIndex = (this.currentQuoteIndex + 1) % this.loadingQuotes.length;
            this._updateQuote();
        }, 5000);
    }

    hideLoadingScreen() {
        const overlay = document.getElementById('loading-overlay');
        const progressFill = document.getElementById('loading-progress-fill');
        if (this.loadingTimer) {
            clearInterval(this.loadingTimer);
            this.loadingTimer = null;
        }
        if (progressFill) {
            progressFill.style.width = '100%';
        }
        if (overlay) {
            setTimeout(() => overlay.classList.add('hidden'), 160);
        }
    }

    updateLoadingProgress(progress) {
        const progressFill = document.getElementById('loading-progress-fill');
        const progressLabel = document.getElementById('loading-progress-label');
        if (!progressFill) return;
        
        const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
        
        // Prevent progress bar from going backwards (important for parallel pre-gen stability)
        const currentWidth = parseFloat(progressFill.style.width) || 0;
        if (percent > currentWidth) {
            progressFill.style.width = `${Math.min(percent, 100)}%`;
        }
        
        if (progressLabel) {
            const statusMessages = {
                'starting': 'Initializing presentation...',
                'generating-narration': 'Generating narration...',
                'generating-audio': 'Synthesizing audio...',
                'persisting': 'Saving slides...',
                'complete': 'Ready to present!',
                'failed': 'Some slides may load during presentation',
                'no-slides': 'No slides to load'
            };
            progressLabel.textContent = statusMessages[progress.status] || `Preparing... ${Math.max(percent, Math.round(currentWidth))}%`;
        }
    }

    _updateQuote() {
        const quoteText = document.getElementById('loading-quote-text');
        const quoteAuthor = document.getElementById('loading-quote-author');
        const quote = this.loadingQuotes[this.currentQuoteIndex];
        if (!quote) return;
        
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

        const state = data.state || 'waiting';
        const phrase = String(data.phrase || '').trim();
        if (state === 'waiting' || !phrase) {
            this.renderTranscriptWaiting(containerId, data.note || '');
            return;
        }

        // Check if we already have a transcript reel - reuse it
        let wrap = container.querySelector('.transcript-reel');
        let meta = container.querySelector('.transcript-reel-meta');
        let phraseEl = container.querySelector('.transcript-reel-phrase');

        if (!wrap) {
            // First time - create elements
            wrap = document.createElement('div');
            wrap.className = `transcript-reel transcript-reel-${state}`;

            meta = document.createElement('div');
            meta.className = 'transcript-reel-meta';

            phraseEl = document.createElement('div');
            phraseEl.className = 'transcript-reel-phrase';

            wrap.append(meta, phraseEl);
            container.appendChild(wrap);
        } else {
            // Reuse existing
            wrap.className = `transcript-reel transcript-reel-${state}`;
        }

        // Update content
        meta.textContent = data.headline || 'Speaking';
        phraseEl.textContent = phrase;
    }

    setStatus(text, state, detail = '') {
        const statusText = document.getElementById('status-text');
        const statusDetail = document.getElementById('status-detail');
        const dot = document.getElementById('status-dot');
        const app = document.getElementById('app');

        if (statusText) statusText.textContent = text;
        if (statusDetail) statusDetail.textContent = detail;
        
        if (dot) {
            dot.className = 'status-dot';
            if (state === 'live') {
                dot.classList.add('live');
                if (app) app.classList.add('narration-active');
            } else if (state === 'paused') {
                dot.classList.add('paused');
                if (app) app.classList.remove('narration-active');
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
            // Auto-scroll to bottom so latest narration is always visible
            el.scrollTop = el.scrollHeight;
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
    }

    toggleQuestionDrawer(forceOpen) {
        const panel = document.getElementById('qa-panel');
        const scrim = document.getElementById('qa-scrim');
        if (!panel || !scrim) return;

        const open = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        scrim.classList.toggle('hidden', !open);
        
        if (open) {
            this.app.clearQuestionBadge?.();
            const input = document.getElementById('question-input');
            if (input) input.focus();
        }
    }

    renderEmptyHistory(containerId, message = 'No slide history is available yet.') {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const empty = document.createElement('div');
        empty.className = 'scrubber-empty-state';
        empty.textContent = message;
        container.appendChild(empty);
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
