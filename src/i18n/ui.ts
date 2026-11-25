import type { Lang } from '../config/economy';
import { useStore } from '../state/store';

/** On-screen text. Hebrew uses Nikud to help early readers (the game is voice-first anyway). */
const UI = {
  title: { en: 'Learn2Brush', he: 'לוֹמְדִים לְצַחְצֵחַ' },
  tagline: { en: 'Brush every tooth till it sparkles!', he: 'מְצַחְצְחִים כׇּל שֵׁן עַד שֶׁהִיא מַבְרִיקָה!' },
  play: { en: 'Play', he: 'מְשַׂחֲקִים' },
  shop: { en: 'Prizes', he: 'פְּרָסִים' },
  choose: { en: 'Pick your brush', he: 'בּוֹחֲרִים מִבְרֶשֶׁת' },
  brushType: { en: 'Brush', he: 'מִבְרֶשֶׁת' },
  handle: { en: 'Handle', he: 'יָדִית' },
  shape: { en: 'Shape', he: 'צוּרָה' },
  bristles: { en: 'Bristles', he: 'זִיפִים' },
  paste: { en: 'Toothpaste', he: 'מִשְׁחָה' },
  jaw: { en: 'Teeth', he: 'שִׁנַּיִם' },
  next: { en: 'Next', he: 'הַבָּא' },
  hold: { en: 'Hold to squeeze', he: 'לוֹחֲצִים וּמַחֲזִיקִים' },
  peaSize: { en: 'pea-size', he: 'כְּמוֹ אֲפוּנָה' },
  go: { en: "Let's brush!", he: 'יַאלְלָה לְצַחְצֵחַ!' },
  front: { en: 'Front', he: 'קָדִימָה' },
  top: { en: 'Top teeth', he: 'שִׁנַּיִם לְמַעְלָה' },
  bottom: { en: 'Bottom teeth', he: 'שִׁנַּיִם לְמַטָּה' },
  stars: { en: 'stars', he: 'כּוֹכָבִים' },
  greatJob: { en: 'Sparkly clean!', he: 'נָקִי וּמַבְרִיק!' },
  again: { en: 'Again', he: 'עוֹד פַּעַם' },
  home: { en: 'Home', he: 'בַּיִת' },
  back: { en: 'Back', he: 'חֲזָרָה' },
  soon: { en: 'Soon', he: 'בְּקָרוֹב' },
  owned: { en: 'Mine', he: 'שֶׁלִּי' },
  nextPrize: { en: 'Next prize', he: 'הַפְּרָס הַבָּא' },
  teethClean: { en: 'Clean teeth', he: 'שִׁנַּיִם נְקִיּוֹת' },
  foodBits: { en: 'Food bits', he: 'שְׁאֵרִיּוֹת אֹכֶל' },
  bugs: { en: 'Sugar bugs', he: 'חַיְדַּקֵּי סֻכָּר' },
  pasteBonus: { en: 'Just the right paste', he: 'בְּדִיּוּק מִשְׁחָה' },
  dayBonus: { en: 'First brush today', he: 'צִחְצוּחַ רִאשׁוֹן הַיּוֹם' },
  streakBonus: { en: 'Days in a row', he: 'יָמִים בִּרְצִיפוּת' },
  steadyBonus: { en: 'Nice and steady', he: 'לְאַט וּבְיִסוּדִיּוּת' },
  total: { en: 'Total', he: 'סַךְ הַכֹּל' },
  installHint: { en: 'Tip for grown-ups: tap Share → “Add to Home Screen” to install.', he: 'טִיפּ לַהוֹרִים: שִׁתּוּף ← "הוֹסָפָה לְמָסָךְ הַבַּיִת" כְּדֵי לְהַתְקִין.' },
  unlockAll: { en: 'Review mode: unlock all', he: 'מַצַּב סְקִירָה: הַכֹּל פָּתוּחַ' },
  sound: { en: 'Sound', he: 'צְלִיל' },
} satisfies Record<string, Record<Lang, string>>;

export type UIKey = keyof typeof UI;
export const tr = (k: UIKey, lang: Lang) => UI[k][lang];
export function useT() {
  const lang = useStore(s => s.lang);
  return (k: UIKey) => UI[k][lang];
}
