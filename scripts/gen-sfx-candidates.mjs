import fs from 'node:fs';
import path from 'node:path';
import { ROOT, elevenSFX } from './lib.mjs';
import { SFX } from './sfx.config.mjs';
const VARIANTS = Number(process.env.VARIANTS || 2);
const only = process.argv.slice(2);
const out = path.join(ROOT, 'review/sfx');
fs.mkdirSync(out, { recursive: true });
await Promise.all(Object.entries(SFX).filter(([id]) => !only.length || only.includes(id)).flatMap(([id, cfg]) =>
  Array.from({ length: VARIANTS }, (_, i) => {
    const f = path.join(out, `${id}_v${i + 1}.mp3`);
    if (fs.existsSync(f) && !only.length) return null;
    return elevenSFX(cfg).then(b => { fs.writeFileSync(f, b); console.log('ok', id, i + 1); })
      .catch(e => console.error('FAIL', id, e.message));
  })));
