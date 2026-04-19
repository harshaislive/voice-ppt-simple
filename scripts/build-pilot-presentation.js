#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const modelService = require('../server/services/model');
const ttsService = require('../server/services/tts');
const cmsService = require('../server/services/cms');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROJECT = 'beforest';
const DEFAULT_PRESENTATION = '10_percent_lifestyle';
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'pilot-presentation');

function readTextIfExists(filePath) {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trim();
}

function buildKnowledgeContext(docs = {}) {
    const sections = [];
    if (docs.soul) sections.push(`SOUL:\n${docs.soul}`);
    if (docs.agents) sections.push(`PROJECT RULES:\n${docs.agents}`);
    if (docs.flow) sections.push(`PRESENTATION FLOW:\n${docs.flow}`);
    if (docs.product) sections.push(`PRODUCT KNOWLEDGE:\n${docs.product}`);
    if (docs.design) sections.push(`DESIGN CONTEXT:\n${docs.design}`);
    if (docs.cta) sections.push(`CALL TO ACTION:\n${docs.cta}`);
    return sections.join('\n\n').slice(0, 18000);
}

async function resolveSupabaseTarget() {
    const catalog = await cmsService.listPresentations();
    const supabaseTargets = catalog.filter((presentation) => presentation.source === 'supabase');

    if (supabaseTargets.length === 0) {
        throw new Error('No Supabase-backed presentations found in the current catalog');
    }

    if (supabaseTargets.length > 1) {
        throw new Error('Multiple Supabase-backed presentations found; set PILOT_PRESENTATION_SLUG explicitly');
    }

    return supabaseTargets[0];
}

async function loadPresentation(projectSlug, presentationSlug, source) {
    if (source === 'supabase') {
        const resolvedTarget = presentationSlug
            ? { presentationSlug }
            : await resolveSupabaseTarget();
        const presentation = await cmsService.loadPresentation(resolvedTarget.presentationSlug, {
            expectedSource: 'supabase'
        });

        return {
            projectSlug: presentation.projectSlug || projectSlug || DEFAULT_PROJECT,
            projectConfig: {},
            projectDir: '',
            presentation,
            docs: presentation.knowledgeDocs || {}
        };
    }

    const resolvedProjectSlug = projectSlug || DEFAULT_PROJECT;
    const projectDir = path.join(ROOT, 'content', 'projects', resolvedProjectSlug);
    const presentationPath = path.join(projectDir, 'presentations', `${presentationSlug}.json`);
    if (!fs.existsSync(presentationPath)) {
        throw new Error(`Presentation not found: ${presentationPath}`);
    }

    const projectConfig = JSON.parse(readTextIfExists(path.join(projectDir, 'project.json')) || '{}');
    const presentation = JSON.parse(readTextIfExists(presentationPath));
    const docs = {
        agents: readTextIfExists(path.join(projectDir, 'AGENTS.md')),
        soul: readTextIfExists(path.join(projectDir, 'soul.md')),
        flow: readTextIfExists(path.join(projectDir, 'flow.md')),
        product: readTextIfExists(path.join(projectDir, 'product.md')),
        design: readTextIfExists(path.join(projectDir, 'design.md')),
        cta: readTextIfExists(path.join(projectDir, 'cta', 'contact.md'))
    };

    return {
        projectSlug: resolvedProjectSlug,
        projectConfig,
        projectDir,
        presentation,
        docs
    };
}

function getSlideStyle(index, totalSlides) {
    if (index === 0) return 'hook';
    if (index === totalSlides - 1) return 'closer';
    return 'conversational';
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function cleanOutputDir(outputDir) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    ensureDir(outputDir);
    ensureDir(path.join(outputDir, 'audio'));
}

async function buildSlideAsset({ slide, slideIndex, totalSlides, knowledgeContext, voice }) {
    const narrationText = await modelService.generateNarration({
        slideTitle: slide.title,
        slideContent: slide.content,
        slideNotes: slide.notes || '',
        pendingQuestions: [],
        audienceContext: {},
        style: getSlideStyle(slideIndex, totalSlides),
        slideIndex,
        totalSlides,
        participantName: '',
        knowledgeContext
    });

    const ttsResult = await ttsService.synthesizeDetailed(narrationText, voice);

    return {
        narrationText,
        audioBuffer: ttsResult.audioBuffer,
        wordBoundaries: Array.isArray(ttsResult.wordBoundaries) ? ttsResult.wordBoundaries : [],
        durationMs: ttsResult.pcmBuffer
            ? Math.round(
                (ttsResult.pcmBuffer.length / ((ttsResult.sampleRate || 24000) * (ttsResult.channels || 1) * (ttsResult.bitsPerSample || 16) / 8)) * 1000
            )
            : 0,
        sampleRate: ttsResult.sampleRate || 24000,
        channels: ttsResult.channels || 1,
        bitsPerSample: ttsResult.bitsPerSample || 16
    };
}

async function main() {
    const source = String(process.env.PILOT_SOURCE || 'supabase').trim().toLowerCase();
    const projectSlug = process.env.PILOT_PROJECT_SLUG || DEFAULT_PROJECT;
    const presentationSlug = process.env.PILOT_PRESENTATION_SLUG || (source === 'supabase' ? '' : DEFAULT_PRESENTATION);
    const outputDir = process.env.PILOT_OUTPUT_DIR
        ? path.resolve(process.env.PILOT_OUTPUT_DIR)
        : DEFAULT_OUTPUT_DIR;
    const voice = process.env.PILOT_VOICE || 'default';

    const loaded = await loadPresentation(projectSlug, presentationSlug, source);
    const { presentation, docs } = loaded;
    const knowledgeContext = buildKnowledgeContext(docs);
    const slides = Array.isArray(presentation.slides) ? presentation.slides : [];

    if (!slides.length) {
        throw new Error(`Presentation "${presentationSlug}" has no slides`);
    }

    cleanOutputDir(outputDir);

    const manifest = {
        metadata: {
            generatedAt: new Date().toISOString(),
            projectSlug: loaded.projectSlug || projectSlug,
            presentationSlug: presentation.presentationSlug || presentation.slug || presentation.id || presentationSlug,
            title: presentation.title || presentation.presentationSlug || presentation.slug || presentation.id,
            description: presentation.description || '',
            slideCount: slides.length,
            voice,
            ttsProvider: ttsService.provider || 'unknown',
            source
        },
        slides: []
    };

    for (let index = 0; index < slides.length; index++) {
        const slide = slides[index];
        process.stdout.write(`\n[${index + 1}/${slides.length}] Building "${slide.title}"\n`);

        const built = await buildSlideAsset({
            slide,
            slideIndex: index,
            totalSlides: slides.length,
            knowledgeContext,
            voice
        });

        const audioFileName = `slide-${String(index + 1).padStart(2, '0')}.wav`;
        const audioDiskPath = path.join(outputDir, 'audio', audioFileName);
        fs.writeFileSync(audioDiskPath, built.audioBuffer);

        manifest.slides.push({
            id: slide.id || `slide-${index + 1}`,
            index,
            title: slide.title,
            content: slide.content,
            notes: slide.notes || '',
            image: slide.image || '',
            narrationText: built.narrationText,
            audioPath: `audio/${audioFileName}`,
            durationMs: built.durationMs,
            sampleRate: built.sampleRate,
            channels: built.channels,
            bitsPerSample: built.bitsPerSample,
            wordBoundaries: built.wordBoundaries
        });
    }

    fs.writeFileSync(
        path.join(outputDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
    );

    fs.writeFileSync(
        path.join(outputDir, 'README.md'),
        [
            '# Pilot Presentation Package',
            '',
            'This folder is a self-contained presentation package for the simplified pilot flow.',
            '',
            `- Project: \`${loaded.projectSlug || projectSlug}\``,
            `- Presentation: \`${manifest.metadata.presentationSlug}\``,
            `- Source: \`${source}\``,
            `- Generated: \`${manifest.metadata.generatedAt}\``,
            `- Voice: \`${voice}\``,
            `- TTS Provider: \`${manifest.metadata.ttsProvider}\``,
            '',
            'Use it with:',
            '',
            '```bash',
            'npm run build:pilot',
            'npm start',
            '```',
            '',
            'Then open `/pilot` in the browser.'
        ].join('\n')
    );

    process.stdout.write(`\nPilot package written to ${outputDir}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
