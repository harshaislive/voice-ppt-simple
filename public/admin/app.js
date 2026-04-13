document.addEventListener('DOMContentLoaded', () => {
    const listSection = document.getElementById('presentations-list');
    const editorSection = document.getElementById('editor');
    const listContainer = document.getElementById('list-container');
    const slidesContainer = document.getElementById('slides-container');
    
    const btnCreate = document.getElementById('btn-create-presentation');
    const btnBack = document.getElementById('btn-back');
    const btnSave = document.getElementById('btn-save');
    const btnAddSlide = document.getElementById('btn-add-slide');
    
    let currentPresentation = null;

    // Load presentations
    async function loadPresentations() {
        const adminKey = document.getElementById('admin-key').value;
        const headers = adminKey ? { 'X-Admin-API-Key': adminKey } : {};

        try {
            const res = await fetch('/api/cms/presentations', { headers });
            if (!res.ok) throw new Error('Failed to load presentations');
            const data = await res.json();
            renderList(data.presentations);
        } catch (err) {
            console.error(err);
            alert('Failed to load presentations');
        }
    }

    function renderList(presentations) {
        listContainer.innerHTML = '';
        (presentations || []).forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="presentation-info">
                    <div class="presentation-title">${p.title}</div>
                    <div style="font-size: 0.75rem; opacity: 0.6; margin-top: 4px;">ID: ${p.id} ${p.projectSlug ? `| Project: ${p.projectSlug}` : ''}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-edit" data-id="${p.id}" style="padding: 8px 16px;">Edit</button>
                    <button class="btn-delete danger" data-id="${p.id}" style="padding: 8px 16px;">Delete</button>
                </div>
            `;
            listContainer.appendChild(li);
        });

        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => openEditor(e.target.dataset.id));
        });
        
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(confirm('Are you sure?')) {
                    const adminKey = document.getElementById('admin-key').value;
                    try {
                        const res = await fetch(`/api/cms/presentations/${e.target.dataset.id}`, { 
                            method: 'DELETE',
                            headers: adminKey ? { 'X-Admin-API-Key': adminKey } : {}
                        });
                        if (!res.ok) throw new Error('Failed to delete');
                        loadPresentations();
                    } catch (err) {
                        alert('Failed to delete presentation');
                    }
                }
            });
        });
    }

    async function openEditor(id) {
        const adminKey = document.getElementById('admin-key').value;
        const headers = adminKey ? { 'X-Admin-API-Key': adminKey } : {};

        if (id) {
            try {
                const res = await fetch(`/api/cms/presentations/${id}`, { headers });
                const data = await res.json();
                currentPresentation = data.presentation;
                document.getElementById('pres-id').value = currentPresentation.id;
                document.getElementById('pres-id').disabled = true;
            } catch (err) {
                alert('Failed to load presentation details');
                return;
            }
        } else {
            currentPresentation = { id: `deck_${Date.now()}`, title: 'New Presentation', projectSlug: '', slides: [] };
            document.getElementById('pres-id').value = currentPresentation.id;
            document.getElementById('pres-id').disabled = false; // allow edit on create
        }

        document.getElementById('pres-title').value = currentPresentation.title || '';
        document.getElementById('pres-project').value = currentPresentation.projectSlug || '';
        
        renderSlides();
        
        listSection.classList.add('hidden');
        editorSection.classList.remove('hidden');
    }

    function renderSlides() {
        slidesContainer.innerHTML = '';
        if (!currentPresentation.slides) currentPresentation.slides = [];
        
        currentPresentation.slides.forEach((slide, index) => {
            const div = document.createElement('div');
            div.className = 'slide-editor';
            div.innerHTML = `
                <div class="slide-header">
                    <span>Slide ${index + 1}</span>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-preview-narration" data-index="${index}" style="font-size: 0.7rem; padding: 8px 16px;">Preview Narration</button>
                        <button class="danger btn-remove-slide" data-index="${index}" style="font-size: 0.7rem; padding: 8px 16px;">Remove</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Layout</label>
                    <select class="slide-layout" data-index="${index}">
                        <option value="immersive" ${slide.layout === 'immersive' ? 'selected' : ''}>Immersive</option>
                        <option value="split" ${slide.layout === 'split' ? 'selected' : ''}>Split (Text/Visual)</option>
                        <option value="content" ${slide.layout === 'content' ? 'selected' : ''}>Content Only</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Title</label>
                    <input type="text" class="slide-title" data-index="${index}" value="${slide.title || ''}">
                </div>
                <div class="form-group">
                    <label>Content (Visible on slide)</label>
                    <textarea class="slide-content" data-index="${index}" rows="3">${slide.content || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Speaker Notes (Narration source)</label>
                    <textarea class="slide-notes" data-index="${index}" rows="3">${slide.notes || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Custom AI Instruction (Override)</label>
                    <textarea class="slide-customPrompt" data-index="${index}" rows="2" placeholder="e.g. Speak with a more excited tone here...">${slide.customPrompt || ''}</textarea>
                </div>
            `;
            slidesContainer.appendChild(div);
        });

        document.querySelectorAll('.btn-remove-slide').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                currentPresentation.slides.splice(idx, 1);
                renderSlides();
            });
        });

        document.querySelectorAll('.btn-preview-narration').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.target.dataset.index);
                const slide = currentPresentation.slides[idx];
                const textToPreview = slide.notes || slide.content || slide.title;
                
                if (!textToPreview) {
                    alert('No text to preview (fill in notes, content, or title)');
                    return;
                }

                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = 'Generating...';

                const adminKey = document.getElementById('admin-key').value;

                try {
                    const res = await fetch('/api/tts', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'X-Admin-API-Key': adminKey
                        },
                        body: JSON.stringify({ text: textToPreview })
                    });
                    
                    if (!res.ok) throw new Error('Failed to generate preview');
                    
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const audio = new Audio(url);
                    audio.play();
                } catch (err) {
                    alert(err.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });
        });

        // Add change listeners
        document.querySelectorAll('.slide-title, .slide-content, .slide-notes, .slide-layout, .slide-customPrompt').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const field = e.target.className.replace('slide-', '');
                currentPresentation.slides[idx][field] = e.target.value;
            });
        });
    }

    btnCreate.addEventListener('click', () => openEditor(null));

    btnBack.addEventListener('click', () => {
        editorSection.classList.add('hidden');
        listSection.classList.remove('hidden');
        loadPresentations();
    });

    btnAddSlide.addEventListener('click', () => {
        if (!currentPresentation.slides) currentPresentation.slides = [];
        currentPresentation.slides.push({ layout: 'immersive', title: '', content: '', notes: '', customPrompt: '' });
        renderSlides();
    });

    btnSave.addEventListener('click', async () => {
        const adminKey = document.getElementById('admin-key').value;
        if (!adminKey) {
            alert('Please enter Admin API Key in the header');
            return;
        }

        const id = document.getElementById('pres-id').value;
        const title = document.getElementById('pres-title').value;
        const projectSlug = document.getElementById('pres-project').value;
        
        const method = currentPresentation.id === id && document.getElementById('pres-id').disabled ? 'PUT' : 'POST';
        const url = method === 'PUT' ? `/api/cms/presentations/${id}` : `/api/cms/presentations`;
        
        currentPresentation.id = id;
        currentPresentation.title = title;
        if (projectSlug) {
            currentPresentation.projectSlug = projectSlug;
        } else {
            delete currentPresentation.projectSlug;
        }

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': adminKey
                },
                body: JSON.stringify(currentPresentation)
            });
            
            if (!res.ok) throw new Error('Failed to save');
            
            alert('Saved successfully!');
            
            // if POST, switch to PUT mode
            if (method === 'POST') {
                document.getElementById('pres-id').disabled = true;
            }
        } catch (err) {
            alert(err.message);
        }
    });

    // Init
    loadPresentations();
});