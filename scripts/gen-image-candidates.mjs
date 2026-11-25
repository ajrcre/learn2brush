import fs from 'node:fs';
import path from 'node:path';
import { ROOT, geminiImage } from './lib.mjs';
import { IMAGES } from './images.config.mjs';
const VARIANTS = Number(process.env.VARIANTS || 3);
const only = process.argv.slice(2);
const out = path.join(ROOT, 'review/images');
fs.mkdirSync(out, { recursive: true });
await Promise.all(Object.entries(IMAGES).filter(([id]) => !only.length || only.includes(id)).flatMap(([id, cfg]) =>
  Array.from({ length: VARIANTS }, async (_, i) => {
    try {
      const { buf, mime } = await geminiImage(cfg);
      const ext = mime.includes('png') ? 'png' : 'jpg';
      fs.writeFileSync(path.join(out, `${id}_v${i + 1}.${ext}`), buf); console.log('ok', id, i + 1, mime);
    } catch (e) { console.error('FAIL', id, e.message); }
  })));
