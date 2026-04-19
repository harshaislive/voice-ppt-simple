const state = {
    manifest: null,
    slideIndex: 0,
    words: [],
    activeWordIndex: -1
};

const els = {
    deckTitle: document.getElementById('pilot-deck-title'),
    badge: document.getElementById('pilot-title-badge'),
    counter: document.getElementById('pilot-counter'),
    image: document.getElementById('pilot-image'),
    title: document.getElementById('slide-title'),
    content: document.getElementById('slide-content'),
    liveTranscript: document.getElementById('live-transcript'),
    fullTranscript: document.getElementById('full-transcript'),
    progressFill: document.getElementById('progress-fill'),
    audio: document.getElementById('slide-audio'),
    playBtn: document.getElementById('play-btn'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn')
};

function getCurrentSlide() {
    return state.manifest?.slides?.[state.slideIndex] || null;
}

function renderWordTranscript(slide) {
    const words = Array.isArray(slide.wordBoundaries) ? slide.wordBoundaries : [];
    state.words = words;
    state.activeWordIndex = -1;

    if (!words.length) {
        els.fullTranscript.textContent = slide.narrationText || '';
        els.liveTranscript.textContent = slide.narrationText || '';
        return;
    }

    const fragment = document.createDocumentFragment();
    words.forEach((item, index) => {
        const span = document.createElement('span');
        span.className = 'pilot-word';
        span.dataset.wordIndex = String(index);
        span.textContent = item.word;
        fragment.appendChild(span);
        if (index < words.length - 1) {
            fragment.appendChild(document.createTextNode(' '));
        }
    });

    els.fullTranscript.innerHTML = '';
    els.fullTranscript.appendChild(fragment);
    els.liveTranscript.textContent = '';
}

function updateTranscriptFromAudio() {
    const slide = getCurrentSlide();
    if (!slide) return;

    const duration = Number(slide.durationMs || 0);
    if (duration > 0) {
        const progress = Math.min((els.audio.currentTime * 1000) / duration, 1) * 100;
        els.progressFill.style.width = `${progress}%`;
    }

    if (!state.words.length) {
        return;
    }

    const currentMs = Math.max(0, Math.round(els.audio.currentTime * 1000));
    let activeIndex = state.words.findIndex((word) => currentMs >= word.offsetMs && currentMs < (word.offsetMs + word.durationMs));
    if (activeIndex === -1) {
        activeIndex = state.words.reduce((acc, word, index) => (
            currentMs >= word.offsetMs ? index : acc
        ), -1);
    }

    if (activeIndex === state.activeWordIndex) {
        return;
    }

    state.activeWordIndex = activeIndex;
    const spokenWords = state.words.slice(0, activeIndex + 1).map((word) => word.word).join(' ');
    els.liveTranscript.textContent = spokenWords;

    els.fullTranscript.querySelectorAll('.pilot-word').forEach((node) => {
        const index = Number(node.dataset.wordIndex);
        node.classList.toggle('is-active', index === activeIndex);
        node.classList.toggle('is-spoken', index < activeIndex);
    });
}

function renderSlide() {
    const slide = getCurrentSlide();
    if (!slide) return;

    els.deckTitle.textContent = state.manifest.metadata.title;
    els.badge.textContent = state.manifest.metadata.presentationSlug;
    els.counter.textContent = `${slide.index + 1} / ${state.manifest.slides.length}`;
    els.title.textContent = slide.title;
    els.content.textContent = slide.content;
    els.image.style.backgroundImage = slide.image ? `url(${slide.image})` : 'none';
    els.audio.src = `/pilot-package/${slide.audioPath}`;
    els.audio.currentTime = 0;
    els.progressFill.style.width = '0%';
    renderWordTranscript(slide);
    updateControls();
}

function updateControls() {
    els.prevBtn.disabled = state.slideIndex === 0;
    els.nextBtn.disabled = state.slideIndex >= state.manifest.slides.length - 1;
    els.playBtn.textContent = els.audio.paused ? 'Play' : 'Pause';
}

function nextSlide(autoPlay = true) {
    if (state.slideIndex >= state.manifest.slides.length - 1) {
        els.audio.pause();
        updateControls();
        return;
    }
    state.slideIndex += 1;
    renderSlide();
    if (autoPlay) {
        void els.audio.play();
        updateControls();
    }
}

async function loadManifest() {
    const response = await fetch('/pilot-package/manifest.json', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Failed to load pilot package');
    }
    state.manifest = await response.json();
    renderSlide();
}

els.playBtn.addEventListener('click', async () => {
    if (els.audio.paused) {
        await els.audio.play();
    } else {
        els.audio.pause();
    }
    updateControls();
});

els.prevBtn.addEventListener('click', () => {
    if (state.slideIndex === 0) return;
    state.slideIndex -= 1;
    renderSlide();
});

els.nextBtn.addEventListener('click', () => {
    nextSlide(false);
});

els.audio.addEventListener('timeupdate', updateTranscriptFromAudio);
els.audio.addEventListener('play', updateControls);
els.audio.addEventListener('pause', updateControls);
els.audio.addEventListener('ended', () => nextSlide(true));

loadManifest().catch((error) => {
    els.title.textContent = 'Pilot package missing';
    els.content.textContent = error.message;
});
