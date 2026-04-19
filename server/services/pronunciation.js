const PRONUNCIATION_OVERRIDES = [
  {
    pattern: /\bPoomaale\s*2\.0\b/gi,
    spoken: 'Poo-maa-lay two point oh',
    guide: 'Poomaale 2.0 -> pronounce exactly "Poo-maa-lay two point oh"; never shorten it to "Poo-mal"'
  },
  {
    pattern: /\bHammiyala\b/gi,
    spoken: 'Ham-mee-yaa-laa',
    guide: 'Hammiyala -> pronounce exactly "Ham-mee-yaa-laa"'
  },
  {
    pattern: /\bBeforest\b/gi,
    spoken: 'Bee-forest',
    guide: 'Beforest -> pronounce exactly "Bee-forest"'
  },
  {
    pattern: /\bCoorg\b/gi,
    spoken: 'Koorg',
    guide: 'Coorg -> pronounce exactly "Koorg"'
  }
];

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function applyPronunciationOverrides(text = '') {
  let output = String(text || '');
  for (const entry of PRONUNCIATION_OVERRIDES) {
    output = output.replace(entry.pattern, entry.spoken);
  }
  return output;
}

function buildPronunciationGuide(text = '') {
  const source = String(text || '');
  const guides = [];

  for (const entry of PRONUNCIATION_OVERRIDES) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(source)) {
      guides.push(entry.guide);
    }
  }

  return guides;
}

function buildPronunciationSsml(text = '', voiceName = '') {
  const source = String(text || '');
  if (!source.trim()) {
    return '';
  }

  const replacements = [];
  for (const entry of PRONUNCIATION_OVERRIDES) {
    entry.pattern.lastIndex = 0;
    let match;
    while ((match = entry.pattern.exec(source)) !== null) {
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
        spoken: entry.spoken
      });
      if (!entry.pattern.global) break;
    }
  }

  replacements.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping = [];
  let lastEnd = -1;
  for (const item of replacements) {
    if (item.start < lastEnd) continue;
    nonOverlapping.push(item);
    lastEnd = item.end;
  }

  let cursor = 0;
  let body = '';
  for (const item of nonOverlapping) {
    body += escapeXml(source.slice(cursor, item.start));
    body += `<sub alias="${escapeXml(item.spoken)}">${escapeXml(item.original)}</sub>`;
    cursor = item.end;
  }
  body += escapeXml(source.slice(cursor));

  const voiceAttr = escapeXml(voiceName || '');
  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">',
    voiceAttr ? `<voice name="${voiceAttr}">${body}</voice>` : body,
    '</speak>'
  ].join('');
}

module.exports = {
  applyPronunciationOverrides,
  buildPronunciationGuide,
  buildPronunciationSsml
};
