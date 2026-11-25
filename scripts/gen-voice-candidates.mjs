// Review round 1: same sample lines read by several candidate voices, EN + HE.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, elevenTTS } from './lib.mjs';

const lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/voice.json'), 'utf8')).lines;
const SAMPLE = ['welcome', 'praise_2', 'hint_inside', 'finish'];
const VOICES = {
  jessica: 'cgSgspJ2msm6clMCkdW9', // Playful, Bright, Warm (F)
  laura: 'FGY2WhTYpPnrIDTdsKH5',   // Enthusiast, Quirky (F)
  bella: 'hpp4J3VqNfWAUOO0d1Us',   // Professional, Bright, Warm (F)
  itai: 'JIxTgeeS5w0UQyBxEnrl',    // Upbeat Social Creator (M)
  liam: 'TX3LPaxmHKxFdv7VOQHJ',    // Energetic (M)
};
const out = path.join(ROOT, 'review/voices');
fs.mkdirSync(out, { recursive: true });
const jobs = [];
for (const [name, id] of Object.entries(VOICES))
  for (const lang of ['en', 'he']) {
    if (fs.existsSync(path.join(out, `${name}_${lang}.mp3`))) continue;
    const text = SAMPLE.map(k => lines[k][lang]).join(' ... ');
    jobs.push(elevenTTS({ voiceId: id, text, lang, settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4 } })
      .then(buf => { fs.writeFileSync(path.join(out, `${name}_${lang}.mp3`), buf); console.log('ok', name, lang); })
      .catch(e => console.error('FAIL', name, lang, e.message)));
  }
await Promise.all(jobs);
