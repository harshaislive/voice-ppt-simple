class VoicePPTPlayer {
    constructor() {
        this.deckId = null;
        this.manifest = null;
        this.currentSlideIndex = 0;
        this.isPlaying = false;
        this.participantName = '';
        this.questions = [];
        this.unreadCount = 0;

        this.audioPlayer = document.getElementById('audio-player');
        
        this.bindEvents();
        this.loadDeckFromURL();
    }

    bindEvents() {
        document.getElementById('start-btn').addEventListener('click', () => this.startPresentation());
        document.getElementById('participant-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.startPresentation();
        });

        document.getElementById('play-pause-btn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('prev-btn').addEventListener('click', () => this.prevSlide());
        document.getElementById('next-btn').addEventListener('click', () => this.nextSlide());
        
        document.getElementById('qa-toggle').addEventListener('click', () => this.toggleQADrawer());
        document.getElementById('qa-close').addEventListener('click', () => this.toggleQADrawer());
        document.getElementById('qa-submit').addEventListener('click', () => this.submitQuestion());
        document.getElementById('qa-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitQuestion();
            }
        });

        this.audioPlayer.addEventListener('ended', () => this.onAudioEnded());
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('play', () => this.updatePlayPauseIcon(true));
        this.audioPlayer.addEventListener('pause', () => this.updatePlayPauseIcon(false));
    }

    loadDeckFromURL() {
        const params = new URLSearchParams(window.location.search);
        this.deckId = params.get('deck') || '10_percent_lifestyle';
    }

    async loadManifest() {
        try {
            const res = await fetch(`/api/publish/${this.deckId}`);
            if (!res.ok) {
                throw new Error('Manifest not found. Publish the deck first via POST /api/publish');
            }
            this.manifest = await res.json();
            
            document.getElementById('presentation-title').textContent = this.manifest.title;
            document.getElementById('presentation-subtitle').textContent = this.manifest.metadata?.startSubtitle || '';
        } catch (error) {
            console.error('Failed to load manifest:', error);
            document.getElementById('presentation-title').textContent = 'Deck Not Published';
            document.getElementById('presentation-subtitle').textContent = error.message;
        }
    }

    async startPresentation() {
        const nameInput = document.getElementById('participant-name');
        this.participantName = nameInput.value.trim() || 'Guest';
        
        if (!this.manifest) {
            await this.loadManifest();
        }

        if (!this.manifest || !this.manifest.slides.length) {
            alert('No slides available. Please publish the deck first.');
            return;
        }

        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('player-view').classList.remove('hidden');

        this.currentSlideIndex = 0;
        this.loadSlide(0);
        this.play();
    }

    loadSlide(index) {
        if (index < 0 || index >= this.manifest.slides.length) return;
        
        this.currentSlideIndex = index;
        const slide = this.manifest.slides[index];

        document.getElementById('slide-title').textContent = slide.title;
        document.getElementById('slide-subtitle').textContent = slide.content;
        document.getElementById('slide-counter').textContent = `${index + 1} / ${this.manifest.totalSlides}`;

        const visual = document.getElementById('slide-visual');
        if (slide.image) {
            visual.style.backgroundImage = `url(${slide.image})`;
        } else {
            visual.style.backgroundImage = 'none';
        }

        if (slide.audio_url) {
            this.audioPlayer.src = slide.audio_url;
            this.audioPlayer.load();
        }

        document.getElementById('subtitle-text').textContent = slide.narration_text || '';
        
        document.getElementById('prev-btn').disabled = index === 0;
        document.getElementById('next-btn').disabled = index === this.manifest.slides.length - 1;
    }

    play() {
        if (this.audioPlayer.src) {
            this.audioPlayer.play().catch(err => console.warn('Play failed:', err));
        }
        this.isPlaying = true;
    }

    pause() {
        this.audioPlayer.pause();
        this.isPlaying = false;
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    updatePlayPauseIcon(isPlaying) {
        document.getElementById('play-icon').classList.toggle('hidden', isPlaying);
        document.getElementById('pause-icon').classList.toggle('hidden', !isPlaying);
    }

    prevSlide() {
        if (this.currentSlideIndex > 0) {
            this.loadSlide(this.currentSlideIndex - 1);
            if (this.isPlaying) this.play();
        }
    }

    nextSlide() {
        if (this.currentSlideIndex < this.manifest.slides.length - 1) {
            this.loadSlide(this.currentSlideIndex + 1);
            if (this.isPlaying) this.play();
        }
    }

    onAudioEnded() {
        if (this.currentSlideIndex < this.manifest.slides.length - 1) {
            this.loadSlide(this.currentSlideIndex + 1);
            this.play();
        } else {
            this.isPlaying = false;
        }
    }

    updateProgress() {
        if (!this.manifest || !this.manifest.slides.length) return;
        
        const slide = this.manifest.slides[this.currentSlideIndex];
        if (!slide || slide.duration_ms === 0) return;

        const progress = (this.audioPlayer.currentTime / (slide.duration_ms / 1000)) * 100;
        document.getElementById('progress-fill').style.width = `${Math.min(progress, 100)}%`;
    }

    toggleQADrawer() {
        const drawer = document.getElementById('qa-drawer');
        drawer.classList.toggle('hidden');
        
        if (!drawer.classList.contains('hidden')) {
            this.unreadCount = 0;
            this.updateQABadge();
        }
    }

    updateQABadge() {
        const badge = document.getElementById('qa-badge');
        if (this.unreadCount > 0) {
            badge.textContent = this.unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    async submitQuestion() {
        const input = document.getElementById('qa-input');
        const text = input.value.trim();
        
        if (!text) return;

        try {
            const res = await fetch('/api/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questionText: text,
                    submittedBy: this.participantName,
                    deckId: this.deckId
                })
            });

            const data = await res.json();
            
            if (data.success) {
                input.value = '';
                this.addQuestionToList({
                    question: text,
                    status: 'pending',
                    submittedBy: this.participantName
                });
            }
        } catch (error) {
            console.error('Failed to submit question:', error);
        }
    }

    addQuestionToList(question) {
        this.questions.unshift(question);
        this.renderQuestions();
        
        if (document.getElementById('qa-drawer').classList.contains('hidden')) {
            this.unreadCount++;
            this.updateQABadge();
        }
    }

    renderQuestions() {
        const list = document.getElementById('qa-list');
        list.innerHTML = this.questions.map(q => `
            <div class="qa-item">
                <div class="qa-question">${q.submittedBy}: ${q.question}</div>
                ${q.answer ? `<div class="qa-answer">${q.answer}</div>` : ''}
                <div class="qa-status">${q.status === 'pending' ? 'Queued for answer...' : q.status}</div>
            </div>
        `).join('');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.player = new VoicePPTPlayer();
});
