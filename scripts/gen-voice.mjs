// Record every spoken line in the chosen voice. Hebrew Nikud is stripped before TTS (see assets/voice.json),
// unless a line has an explicit "he_tts" override.
// usage: node scripts/gen-voice.mjs <outDir> [lineId ...]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, elevenTTS } from './lib.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/voice.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/voice.json'), 'utf8')).lines;
const [outDir = path.join(ROOT, 'review/voice-r2'), ...only] = process.argv.slice(2);

/** Remove Hebrew points and cantillation marks, keep letters and punctuation (maqaf becomes a space). */
export const stripNikud = (s) => s.replace(/[֑-ׇֽֿׁׂׅׄ]/g, '').replace(/־/g, ' ');

const jobs = [];
for (const [id, l] of Object.entries(lines)) {
  if (only.length && !only.includes(id)) continue;
  for (const lang of ['en', 'he']) {
    const text = lang === 'en' ? l.en : (l.he_tts ?? (cfg.hebrewText === 'plain' ? stripNikud(l.he) : l.he));
    const f = path.join(outDir, lang, `${id}.mp3`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && !only.length) continue; // resume: skip clips already recorded
    jobs.push(elevenTTS({ voiceId: cfg.voiceId, text, lang, model: cfg.model, settings: cfg.settings })
      .then(b => { fs.writeFileSync(f, b); process.stdout.write('.'); })
      .catch(e => console.error('\nFAIL', id, lang, e.message)));
  }
}
await Promise.all(jobs);
console.log('\n' + jobs.length + ' clips →', outDir);
