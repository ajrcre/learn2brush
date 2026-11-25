// Pronunciation lab: the same problem words written several ways, so the reviewer can pick what sounds right.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, elevenTTS, geminiTTS } from './lib.mjs';

export const WORDS = {
  mtz: {
    nikud: 'קָדִימָה, מְצַחְצְחִים!', plain: 'קדימה, מצחצחים!', split: 'קָדִימָה, מְצַחְ-צְחִים!', plene: 'קָדִימָה, מְצַחְצְחִיים!', latin: 'Kadima, metsachtsechim!',
  },
  shkoach: {
    nikud: 'לֹא לִשְׁכֹּחַ אֶת הַצַּד הַפְּנִימִי!', plain: 'לא לשכוח את הצד הפנימי!', split: 'לֹא לִשְׁ-כּוֹ-אַח אֶת הַצַּד הַפְּנִימִי!', plene: 'לֹא לִשְׁכּוֹאַח אֶת הַצַּד הַפְּנִימִי!', latin: "Lo lishko'ach et hatsad hapnimi!",
  },
  kavod: {
    nikud: 'כֹּל הַכָּבוֹד!', plain: 'כל הכבוד!', split: 'כֹּל הַכָּ-בוֹד!', plene: 'כּוֹל הַכָּבוֹוד!', latin: 'Kol hakavod!',
  },
};
const out = path.join(ROOT, 'review/voicelab');
fs.mkdirSync(out, { recursive: true });
const jobs = [];
for (const [w, d] of Object.entries(WORDS)) {
  for (const v of ['nikud', 'plain', 'split', 'plene', 'latin']) {
    const f = path.join(out, `${w}_el_${v}.mp3`);
    if (fs.existsSync(f)) continue;
    jobs.push(elevenTTS({ voiceId: 'cgSgspJ2msm6clMCkdW9', text: d[v], lang: 'he', settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3 } })
      .then(b => fs.writeFileSync(f, b)).then(() => console.log('ok', w, v)).catch(e => console.error('FAIL', w, v, e.message)));
  }
  for (const voice of ['Leda', 'Puck']) {
    jobs.push(geminiTTS({ text: d.nikud, voice, style: 'Say cheerfully:' })
      .then(b => fs.writeFileSync(path.join(out, `${w}_gem_${voice.toLowerCase()}.mp3`), b)).then(() => console.log('ok', w, voice)).catch(e => console.error('FAIL', w, voice, e.message)));
  }
}
await Promise.all(jobs);
