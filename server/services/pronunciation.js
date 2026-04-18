const PRONUNCIATION_OVERRIDES = [
  {
    pattern: /\bPoomaale\s*2\.0\b/gi,
    spoken: 'Poo maa lay two point oh',
    guide: 'Poomaale 2.0 -> "Poo maa lay two point oh"'
  },
  {
    pattern: /\bHammiyala\b/gi,
    spoken: 'Ham mee yaa laa',
    guide: 'Hammiyala -> "Ham mee yaa laa"'
  },
  {
    pattern: /\bBeforest\b/gi,
    spoken: 'Bee forest',
    guide: 'Beforest -> "Bee forest"'
  }
];

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

module.exports = {
  applyPronunciationOverrides,
  buildPronunciationGuide
};
