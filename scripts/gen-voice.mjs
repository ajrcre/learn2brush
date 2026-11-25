// Record every spoken line in the chosen voice. Hebrew keeps its Nikud except the words listed in
// assets/voice.json "plainWords"; a line can override with "he_tts".
// usage: node scripts/gen-voice.mjs <outDir> [lineId ...]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, elevenTTS } from './lib.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/voice.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/voice.json'), 'utf8')).lines;
const [outDir = path.join(ROOT, 'review/voice-r2'), ...only] = process.argv.slice(2);

/** Remove Hebrew points and cantillation marks, keep letters and punctuation (maqaf becomes a space). */
export const stripNikud = (s) => s.replace(/[֑-ׇֽֿׁׂׅׄ]/g, '').replace(/־/g, ' ');

/** Hebrew text for the TTS: Nikud kept, except words the reviewer found read correctly only without it. */
const ttsHebrew = (he) => {
  if (cfg.hebrewText === 'plain') return stripNikud(he);
  let out = he;
  for (const [withNikud, plain] of Object.entries(cfg.plainWords ?? {})) out = out.split(withNikud).join(plain);
  return out;
};

const jobs = [];
for (const [id, l] of Object.entries(lines)) {
  if (only.length && !only.includes(id)) continue;
  for (const lang of ['en', 'he']) {
    const text = lang === 'en' ? l.en : (l.he_tts ?? ttsHebrew(l.he));
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
