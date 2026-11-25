// Voice review round 1b: corrected Nikud; ElevenLabs v3 (stock + the account's cloned Hebrew voices) vs Gemini TTS.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, elevenTTS, geminiTTS } from './lib.mjs';

const lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/voice.json'), 'utf8')).lines;
export const SAMPLE = ['welcome', 'praise_1', 'brush_start', 'paste_too_much', 'hint_inside', 'finish'];
const VOICES = [
  { key: 'jessica', engine: 'eleven', id: 'cgSgspJ2msm6clMCkdW9' },
  { key: 'bella', engine: 'eleven', id: 'hpp4J3VqNfWAUOO0d1Us' },
  { key: 'itai', engine: 'eleven', id: 'JIxTgeeS5w0UQyBxEnrl' },
  { key: 'shahar', engine: 'eleven', id: 'HaVJ0GFcHbEJSLEdbVO0' },
  { key: 'rotem', engine: 'eleven', id: 'NXeYBXzhT56Qm6YE3UWt' },
  { key: 'gemini_leda', engine: 'gemini', id: 'Leda' },
  { key: 'gemini_puck', engine: 'gemini', id: 'Puck' },
  { key: 'gemini_sulafat', engine: 'gemini', id: 'Sulafat' },
];
const out = path.join(ROOT, 'review/voices2');
fs.mkdirSync(out, { recursive: true });
await Promise.all(VOICES.flatMap(v => ['en', 'he'].map(async lang => {
  const f = path.join(out, `${v.key}_${lang}.mp3`);
  if (fs.existsSync(f)) return;
  const text = SAMPLE.map(k => lines[k][lang]).join(v.engine === 'gemini' ? '\n' : ' ... ');
  try {
    const buf = v.engine === 'eleven'
      ? await elevenTTS({ voiceId: v.id, text, lang, settings: { stability: 0.5, similarity_boost: 0.8, style: 0.35 } })
      : await geminiTTS({ text, voice: v.id });
    fs.writeFileSync(f, buf);
    console.log('ok', v.key, lang);
  } catch (e) { console.error('FAIL', v.key, lang, e.message.slice(0, 200)); }
})));
