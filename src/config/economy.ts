/** Star rewards and the unlock catalogue. Tune prices here. */
export type Lang = 'en' | 'he';
export type Category = 'jaw' | 'brushType' | 'shape' | 'handle' | 'bristles' | 'paste';
export type Localized = Record<Lang, string>;

export interface Item {
  id: string;
  cat: Category;
  price: number; // 0 = owned from the start
  name: Localized;
  /** colours used for rendering + swatch */
  colors: string[];
  sparkle?: boolean;
  comingSoon?: boolean;
  emoji?: string;
  /** handle: surface pattern (see game/patterns.ts) */
  pattern?: string;
  /** 0..1 glitter flakes (handle / paste / bristles) */
  glitter?: number;
  /** glow-in-the-dark strength (paste / bristles) */
  glow?: number;
  /** shape category: which handle shape */
  shape?: string;
  /** paste stripes: 'even' spiral stripes, 'legacy' = original striped paste */
  stripes?: 'legacy' | 'even';
  /** accent colour for fins / plates / grip; head colour */
  accent?: string;
  head?: string;
  /** 'review' = new item waiting for approval: hidden unless the game runs with ?review */
  status?: 'review';
  /** the item exists but its upgraded look (pattern/glitter) is still in review */
  upgrade?: 'review';
}

export const REWARDS = {
  perTooth: 1,
  perFood: 1,
  perBug: 1,
  /** brushing round length in seconds (dentists recommend 2 minutes) */
  roundSeconds: 120,
  pasteRight: 3,
  firstBrushOfDay: 5,
  /** bonus = min(streakDays, streakCap) when streak ≥ 2 */
  streakCap: 7,
  /** reward a calm, thorough session (≥ this many seconds of brushing) */
  steadySeconds: 60,
  steadyBonus: 3,
};

/** Items still waiting for approval only show when the game runs with ?review */
export const REVIEW_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('review');
/** Animal jaws still in review: playable with ?review, "coming soon" otherwise. (The goat and the alligator are live.) */
const JAW_SOON = !REVIEW_MODE;

export const CATALOG: Item[] = [
  // jaws — the big goals (3D models: src/game/jaws/species.ts)
  { id: 'jaw_human', cat: 'jaw', price: 0, name: { en: 'Kid teeth', he: 'שִׁנַּיִם שֶׁל יְלָדִים' }, colors: ['#ffffff'], emoji: '😁' },
  { id: 'jaw_goat', cat: 'jaw', price: 150, name: { en: 'Goat', he: 'עֵז' }, colors: ['#e8dcc8'], emoji: '🐐' },
  { id: 'jaw_lion', cat: 'jaw', price: 350, name: { en: 'Lion', he: 'אַרְיֵה' }, colors: ['#e3a948'], emoji: '🦁', comingSoon: JAW_SOON },
  { id: 'jaw_alligator', cat: 'jaw', price: 700, name: { en: 'Alligator', he: 'תַּנִּין' }, colors: ['#5f8f3e'], emoji: '🐊' },
  { id: 'jaw_venom', cat: 'jaw', price: 900, name: { en: 'Venom', he: 'וֶנוֹם' }, colors: ['#15171f'], emoji: '👅', comingSoon: JAW_SOON },
  { id: 'jaw_shark', cat: 'jaw', price: 1200, name: { en: 'Shark', he: 'כָּרִישׁ' }, colors: ['#6b8fa8'], emoji: '🦈', comingSoon: JAW_SOON },
  // brush type
  { id: 'type_manual', cat: 'brushType', price: 0, name: { en: 'Classic brush', he: 'מִבְרֶשֶׁת רְגִילָה' }, colors: ['#ffffff'], emoji: '🪥' },
  { id: 'type_electric', cat: 'brushType', price: 300, name: { en: 'Electric brush', he: 'מִבְרֶשֶׁת חַשְׁמַלִּית' }, colors: ['#7cf3ff'], emoji: '⚡' },
  // shapes
  { id: 'shape_classic', cat: 'shape', price: 0, name: { en: 'Classic', he: 'רְגִילָה' }, colors: ['#ffffff'], emoji: '🪥', shape: 'classic' },
  { id: 'shape_rocket', cat: 'shape', price: 120, name: { en: 'Rocket', he: 'טִיל' }, colors: ['#ffffff'], emoji: '🚀', shape: 'rocket' },
  { id: 'shape_dino', cat: 'shape', price: 300, name: { en: 'Dinosaur', he: 'דִּינוֹזָאוּר' }, colors: ['#ffffff'], emoji: '🦖', shape: 'dino' },
  { id: 'shape_shark', cat: 'shape', price: 160, name: { en: 'Shark', he: 'כָּרִישׁ' }, colors: ['#ffffff'], emoji: '🦈', shape: 'shark' },
  { id: 'shape_wand', cat: 'shape', price: 180, name: { en: 'Magic wand', he: 'שַׁרְבִיט קֶסֶם' }, colors: ['#ffffff'], emoji: '🪄', shape: 'wand' },
  { id: 'shape_sword', cat: 'shape', price: 250, name: { en: 'Sword', he: 'חֶרֶב' }, colors: ['#ffffff'], emoji: '🗡️', shape: 'sword' },
  // handles
  { id: 'handle_white', cat: 'handle', price: 0, name: { en: 'Snow white', he: 'לָבָן' }, colors: ['#f2f4f7'] },
  { id: 'handle_sky', cat: 'handle', price: 40, name: { en: 'Sky blue', he: 'תְּכֵלֶת' }, colors: ['#3fa9f5'] },
  { id: 'handle_pink', cat: 'handle', price: 40, name: { en: 'Bubblegum', he: 'וָרֹד' }, colors: ['#ff6fae'] },
  { id: 'handle_mint', cat: 'handle', price: 40, name: { en: 'Mint', he: 'מֶנְטָה' }, colors: ['#3ccf9a'] },
  { id: 'handle_sun', cat: 'handle', price: 60, name: { en: 'Sunshine', he: 'שֶׁמֶשׁ' }, colors: ['#ffc83d'] },
  { id: 'handle_galaxy', cat: 'handle', price: 150, name: { en: 'Galaxy', he: 'גָּלַקְסְיָה' }, colors: ['#2b1b6e', '#6a3bd1', '#e04fd6'], sparkle: true, pattern: 'galaxy', glitter: 0.6, accent: '#e04fd6', head: '#6a3bd1' },
  { id: 'handle_rainbow', cat: 'handle', price: 220, name: { en: 'Rainbow', he: 'קֶשֶׁת' }, colors: ['#ff4d4d', '#ffb13d', '#ffe53d', '#4ddb6a', '#3fa9f5', '#8b5cf6'], pattern: 'rainbow', head: '#ff4d4d', accent: '#8b5cf6' },
  { id: 'handle_dalmatian', cat: 'handle', price: 90, name: { en: 'Dalmatian', he: 'דַּלְמָטִי' }, colors: ['#fafafa'], pattern: 'dalmatian', accent: '#222222', head: '#fafafa' },
  { id: 'handle_tiger', cat: 'handle', price: 100, name: { en: 'Tiger', he: 'נָמֵר' }, colors: ['#f28c28'], pattern: 'tiger', accent: '#1b1b1b', head: '#f28c28' },
  { id: 'handle_zebra', cat: 'handle', price: 100, name: { en: 'Zebra', he: 'זֶבְּרָה' }, colors: ['#ffffff'], pattern: 'zebra', accent: '#111111', head: '#ffffff' },
  { id: 'handle_flames', cat: 'handle', price: 120, name: { en: 'Flames', he: 'לֶהָבוֹת' }, colors: ['#2a0a05'], pattern: 'flames', accent: '#ff6a00', head: '#ff5a1f' },
  { id: 'handle_leopard', cat: 'handle', price: 120, name: { en: 'Leopard', he: 'בַּרְדְּלָס' }, colors: ['#e6b450'], pattern: 'leopard', accent: '#3b2410', head: '#e6b450' },
  { id: 'handle_pinkglitter', cat: 'handle', price: 140, name: { en: 'Pink glitter', he: 'נֹצֶץ וָרֹד' }, colors: ['#ff6fae', '#ffb3d6'], pattern: 'glitter', glitter: 1, accent: '#ff6fae', head: '#ff6fae' },
  { id: 'handle_pixelgrass', cat: 'handle', price: 150, name: { en: 'Pixel grass', he: 'פִּיקְסֶל דֶּשֶׁא' }, colors: ['#5da13a'], pattern: 'pixelGrass', accent: '#7a5230', head: '#5da13a' },
  { id: 'handle_goldglitter', cat: 'handle', price: 160, name: { en: 'Gold glitter', he: 'נֹצֶץ זָהָב' }, colors: ['#e7b53c', '#ffe08a'], pattern: 'glitter', glitter: 1, accent: '#b8860b', head: '#e7b53c' },
  { id: 'handle_pixelgem', cat: 'handle', price: 200, name: { en: 'Pixel gems', he: 'פִּיקְסֶל יַהֲלוֹמִים' }, colors: ['#1d2b3a'], pattern: 'pixelGem', glitter: 0.5, accent: '#36e2d4', head: '#36e2d4' },
  { id: 'handle_pixellava', cat: 'handle', price: 220, name: { en: 'Pixel lava', he: 'פִּיקְסֶל לָבָה' }, colors: ['#8c1a05'], pattern: 'pixelLava', accent: '#ff6a00', head: '#ff6a00' },
  // bristles
  { id: 'bristles_white', cat: 'bristles', price: 0, name: { en: 'White', he: 'לָבָן' }, colors: ['#f7f7f2'] },
  { id: 'bristles_blue', cat: 'bristles', price: 30, name: { en: 'Blue', he: 'כָּחֹל' }, colors: ['#57b6ff'] },
  { id: 'bristles_pink', cat: 'bristles', price: 30, name: { en: 'Pink', he: 'וָרֹד' }, colors: ['#ff8cc6'] },
  { id: 'bristles_twotone', cat: 'bristles', price: 60, name: { en: 'Two-tone', he: 'דּוּ-צִבְעִי' }, colors: ['#f7f7f2', '#3ccf9a'] },
  { id: 'bristles_rainbow', cat: 'bristles', price: 200, name: { en: 'Rainbow', he: 'קֶשֶׁת' }, colors: ['#ff6b6b', '#ffb13d', '#ffe53d', '#4ddb6a', '#57b6ff', '#a78bfa'] },
  { id: 'bristles_neon', cat: 'bristles', price: 90, name: { en: 'Neon', he: 'נֵאוֹן' }, colors: ['#7dff5a', '#ff4fd8'], glow: 0.5 },
  { id: 'bristles_glitter', cat: 'bristles', price: 120, name: { en: 'Glitter', he: 'נוֹצְצִים' }, colors: ['#f2f6ff'], glitter: 1, sparkle: true },
  // toothpaste
  { id: 'paste_white', cat: 'paste', price: 0, name: { en: 'Classic', he: 'קְלָאסִית' }, colors: ['#f6f8fa'] },
  { id: 'paste_mint', cat: 'paste', price: 30, name: { en: 'Mint', he: 'מֶנְטָה' }, colors: ['#7fe3c0'] },
  { id: 'paste_bubblegum', cat: 'paste', price: 30, name: { en: 'Bubblegum', he: 'מַסְטִיק' }, colors: ['#ff9ccc'] },
  { id: 'paste_berry', cat: 'paste', price: 50, name: { en: 'Berry', he: 'פֵּרוֹת יַעַר' }, colors: ['#b57bff'] },
  { id: 'paste_striped', cat: 'paste', price: 100, name: { en: 'Striped', he: 'פַּסִּים' }, colors: ['#f6f8fa', '#ff4d6d', '#3fa9f5'], stripes: 'legacy' },
  { id: 'paste_sparkle', cat: 'paste', price: 180, name: { en: 'Sparkle', he: 'נוֹצֶצֶת' }, colors: ['#9ad8ff'], sparkle: true, glitter: 1 },
  { id: 'paste_candy', cat: 'paste', price: 80, name: { en: 'Candy cane', he: 'סֻכָּרִיַּת מַקֵּל' }, colors: ['#ffffff', '#ff2e4c'], stripes: 'even' },
  { id: 'paste_flame', cat: 'paste', price: 100, name: { en: 'Flame', he: 'לֶהָבָה' }, colors: ['#ff3d00', '#ff9100', '#ffd54a'], stripes: 'even', glow: 0.2 },
  { id: 'paste_rainbow', cat: 'paste', price: 120, name: { en: 'Rainbow', he: 'קֶשֶׁת' }, colors: ['#ff4d4d', '#ffb13d', '#ffe53d', '#4ddb6a', '#3fa9f5', '#8b5cf6'], stripes: 'even' },
  { id: 'paste_unicorn', cat: 'paste', price: 120, name: { en: 'Unicorn swirl', he: 'מְעַרְבֹּלֶת חַד־קֶרֶן' }, colors: ['#ffc2e2', '#c9b6ff', '#a8e6ff', '#fff3b0'], stripes: 'even', glitter: 0.5 },
  { id: 'paste_glow', cat: 'paste', price: 140, name: { en: 'Glow in the dark', he: 'זוֹהֶרֶת בַּחֹשֶׁךְ' }, colors: ['#7dff5a'], glow: 0.9 },
  { id: 'paste_galaxy', cat: 'paste', price: 160, name: { en: 'Galaxy', he: 'גָּלַקְסְיָה' }, colors: ['#2b1b6e', '#6a3bd1', '#e04fd6'], stripes: 'even', glitter: 1 },
];

export const isVisible = (i: Item) => i.status !== 'review' || REVIEW_MODE;
/** Use the item's new (pattern/glitter) look? */
export const useUpgrade = (i: Item) => i.upgrade !== 'review' || REVIEW_MODE;

export const item = (id: string) => CATALOG.find(i => i.id === id)!;
export const STARTER = CATALOG.filter(i => i.price === 0).map(i => i.id);
export const DEFAULT_EQUIPPED: Record<Category, string> = {
  jaw: 'jaw_human', brushType: 'type_manual', shape: 'shape_classic', handle: 'handle_white', bristles: 'bristles_white', paste: 'paste_white',
};

export function nextGoal(stars: number, owned: string[]): Item | undefined {
  const open = CATALOG.filter(i => isVisible(i) && !i.comingSoon && !owned.includes(i.id) && i.price > 0).sort((a, b) => a.price - b.price);
  return open.find(i => i.price > stars) ?? open[0];
}
