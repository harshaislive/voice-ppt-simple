const fs = require('fs').promises;
const path = require('path');
const ttsService = require('./tts');
const cmsService = require('./cms');

class ManifestGenerator {
    constructor() {
        this.outputDir = path.join(__dirname, '..', '..', 'published');
        this.audioDir = path.join(this.outputDir, 'audio');
    }

    async ensureDirs() {
        await fs.mkdir(this.outputDir, { recursive: true });
        await fs.mkdir(this.audioDir, { recursive: true });
    }

    async generateNarrationText(slide, context) {
        const { OpenAI } = require('openai');
        
        const openai = new OpenAI({
            apiKey: process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_VOICELIVE_API_KEY,
            baseURL: process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_VOICELIVE_ENDPOINT,
            defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview' },
            defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_VOICELIVE_API_KEY || '' }
        });

        const soulContext = context.knowledgeDocs?.soul || '';
        const productContext = context.knowledgeDocs?.product || '';
        
        const systemPrompt = `You are narrating a presentation. Write spoken narration for the slide provided.
${soulContext ? `\nVoice/Persona guidelines:\n${soulContext}` : ''}
${productContext ? `\nProduct/domain knowledge:\n${productContext}` : ''}

Rules:
- Write as if speaking aloud
- Keep it concise (2-4 sentences max)
- Reference what's on screen naturally
- No markdown, no formatting, just plain text
- Do not add introductions or conclusions`;

        const response = await openai.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Slide title: ${slide.title}\nSlide content: ${slide.content || ''}\nSlide notes: ${slide.notes || ''}\n\nWrite narration for this slide.` }
            ],
            temperature: 0.7,
            max_tokens: 300
        });

        return response.choices[0].message.content.trim();
    }

    async generateAudioForSlide(text, slideIndex, deckId) {
        const fileName = `${deckId}-slide-${String(slideIndex).padStart(2, '0')}.wav`;
        const filePath = path.join(this.audioDir, fileName);
        
        try {
            const result = await ttsService.synthesizeDetailed(text, 'default');
            await fs.writeFile(filePath, result.audioBuffer);
            
            const audioDurationMs = Math.round((result.pcmBuffer.length / (result.sampleRate * result.channels * result.bitsPerSample / 8)) * 1000);
            
            return {
                audioUrl: `/published/audio/${fileName}`,
                audioPath: filePath,
                durationMs: audioDurationMs,
                wordBoundaries: result.wordBoundaries || []
            };
        } catch (error) {
            console.error(`[Manifest] Audio generation failed for slide ${slideIndex}:`, error.message);
            return {
                audioUrl: null,
                audioPath: null,
                durationMs: 0,
                wordBoundaries: []
            };
        }
    }

    async generateManifest(deckId, options = {}) {
        console.log(`[Manifest] Generating manifest for deck: ${deckId}`);
        
        await this.ensureDirs();
        
        const presentation = await cmsService.loadPresentation(deckId);
        if (!presentation) {
            throw new Error(`Presentation not found: ${deckId}`);
        }

        const slides = presentation.slides || [];
        if (slides.length === 0) {
            throw new Error(`No slides found for deck: ${deckId}`);
        }

        const manifest = {
            id: deckId,
            title: presentation.title,
            generatedAt: new Date().toISOString(),
            totalSlides: slides.length,
            slides: [],
            metadata: {
                startTitle: presentation.startTitle || null,
                startSubtitle: presentation.startSubtitle || null,
                startImage: presentation.startImage || null
            }
        };

        let cumulativeTimeMs = 0;

        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];
            console.log(`[Manifest] Processing slide ${i + 1}/${slides.length}: ${slide.title}`);

            let narrationText = slide.narration_text || '';
            
            if (!narrationText && options.generateNarration !== false) {
                try {
                    narrationText = await this.generateNarrationText(slide, {
                        knowledgeDocs: presentation.knowledgeDocs || {}
                    });
                    console.log(`[Manifest] Generated narration for slide ${i + 1}: ${narrationText.substring(0, 50)}...`);
                } catch (error) {
                    console.error(`[Manifest] Narration generation failed for slide ${i + 1}:`, error.message);
                    narrationText = slide.notes || slide.content || slide.title;
                }
            }

            let audioInfo = { audioUrl: null, audioPath: null, durationMs: 0, wordBoundaries: [] };
            
            if (options.generateAudio !== false && narrationText) {
                audioInfo = await this.generateAudioForSlide(narrationText, i, deckId);
            }

            const slideManifest = {
                index: i,
                title: slide.title || '',
                content: slide.content || '',
                image: slide.image || null,
                notes: slide.notes || '',
                narration_text: narrationText,
                audio_url: audioInfo.audioUrl,
                audio_path: audioInfo.audioPath,
                duration_ms: audioInfo.durationMs,
                word_boundaries: audioInfo.wordBoundaries,
                start_ms: cumulativeTimeMs,
                end_ms: cumulativeTimeMs + audioInfo.durationMs,
                layout: slide.layout || 'immersive'
            };

            manifest.slides.push(slideManifest);
            cumulativeTimeMs += audioInfo.durationMs;
        }

        manifest.total_duration_ms = cumulativeTimeMs;

        const manifestPath = path.join(this.outputDir, `${deckId}-manifest.json`);
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        
        console.log(`[Manifest] Manifest generated: ${manifestPath}`);
        console.log(`[Manifest] Total slides: ${manifest.totalSlides}, Total duration: ${Math.round(manifest.total_duration_ms / 1000)}s`);

        return {
            manifest,
            manifestPath,
            audioFiles: manifest.slides.filter(s => s.audio_url).map(s => s.audio_path)
        };
    }

    async getManifest(deckId) {
        const manifestPath = path.join(this.outputDir, `${deckId}-manifest.json`);
        
        try {
            const raw = await fs.readFile(manifestPath, 'utf8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    async listPublished() {
        try {
            await this.ensureDirs();
            const files = await fs.readdir(this.outputDir);
            return files
                .filter(f => f.endsWith('-manifest.json'))
                .map(f => f.replace('-manifest.json', ''));
        } catch {
            return [];
        }
    }
}

module.exports = new ManifestGenerator();
