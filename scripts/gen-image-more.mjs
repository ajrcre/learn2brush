// Generate extra variants (numbered after existing ones) for given ids.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, geminiImage } from './lib.mjs';
import { IMAGES } from './images.config.mjs';
const [id, nStr] = process.argv.slice(2);
const n = Number(nStr || 3);
const out = path.join(ROOT, 'review/images');
const existing = fs.readdirSync(out).filter(f => f.startsWith(id + '_v')).length;
await Promise.all(Array.from({ length: n }, async (_, i) => {
  const { buf } = await geminiImage(IMAGES[id]);
  fs.writeFileSync(path.join(out, `${id}_v${existing + i + 1}.jpg`), buf);
  console.log('ok', id, existing + i + 1);
}));
