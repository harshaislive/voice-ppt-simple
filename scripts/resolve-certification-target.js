require('dotenv').config();

const cmsService = require('../server/services/cms');

async function main() {
    const catalog = await cmsService.listPresentations();
    const supabaseTargets = catalog.filter((presentation) => presentation.source === 'supabase');

    if (supabaseTargets.length === 0) {
        console.error('No Supabase-backed presentations found in the current catalog.');
        process.exit(1);
    }

    if (supabaseTargets.length > 1) {
        console.error('Multiple Supabase-backed presentations found. Resolve the certification target explicitly.');
        console.log(JSON.stringify(supabaseTargets, null, 2));
        process.exit(1);
    }

    const target = supabaseTargets[0];
    console.log(JSON.stringify({
        presentationSlug: target.presentationSlug || target.id,
        title: target.title || '',
        source: target.source,
        declaredSource: target.declaredSource || target.source,
        projectSlug: target.projectSlug || null,
        availableSources: target.availableSources || [target.source]
    }, null, 2));
}

main().catch((error) => {
    console.error(`Failed to resolve certification target: ${error.message}`);
    process.exit(1);
});
