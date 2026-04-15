#!/usr/bin/env node
require('dotenv').config();

const http = require('http');

const PORT = process.env.PORT || 3000;
const DECK_ID = process.argv[2] || '10_percent_lifestyle';

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path,
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function main() {
    console.log(`\n🎬 Publishing deck: ${DECK_ID}\n`);

    console.log('1. Publishing manifest + audio...');
    const publishRes = await request('POST', '/api/publish', { deckId: DECK_ID });
    
    if (publishRes.status !== 200) {
        console.error('❌ Publish failed:', publishRes.body);
        process.exit(1);
    }

    console.log('✅ Published!');
    console.log(`   Slides: ${publishRes.body.totalSlides}`);
    console.log(`   Duration: ${Math.round(publishRes.body.totalDurationMs / 1000)}s`);
    console.log(`   Audio files: ${publishRes.body.audioFilesGenerated}`);

    console.log('\n2. Fetching manifest...');
    const manifestRes = await request('GET', `/api/publish/${DECK_ID}`);
    
    if (manifestRes.status !== 200) {
        console.error('❌ Manifest fetch failed:', manifestRes.body);
        process.exit(1);
    }

    console.log('✅ Manifest loaded!');
    console.log(`   Title: ${manifestRes.body.title}`);
    console.log(`   Total slides: ${manifestRes.body.totalSlides}`);
    
    console.log('\n3. Slide details:');
    manifestRes.body.slides.forEach((slide, i) => {
        console.log(`   ${i + 1}. ${slide.title}`);
        console.log(`      Narration: ${slide.narration_text?.substring(0, 80)}...`);
        console.log(`      Audio: ${slide.audio_url || 'none'}`);
        console.log(`      Duration: ${Math.round(slide.duration_ms / 1000)}s`);
    });

    console.log(`\n🎉 Done! Open http://localhost:${PORT}/player.html?deck=${DECK_ID} to watch\n`);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
