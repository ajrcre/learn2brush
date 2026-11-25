/** Star rewards and the unlock catalogue. Tune prices here. */
export type Lang = 'en' | 'he';
export type Category = 'jaw' | 'brushType' | 'handle' | 'bristles' | 'paste';
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

export const CATALOG: Item[] = [
  // jaws — the big goals
  { id: 'jaw_human', cat: 'jaw', price: 0, name: { en: 'Kid teeth', he: 'שִׁנַּיִם שֶׁל יְלָדִים' }, colors: ['#ffffff'], emoji: '😁' },
  { id: 'jaw_goat', cat: 'jaw', price: 150, name: { en: 'Goat', he: 'עֵז' }, colors: ['#e8dcc8'], emoji: '🐐', comingSoon: true },
  { id: 'jaw_lion', cat: 'jaw', price: 350, name: { en: 'Lion', he: 'אַרְיֵה' }, colors: ['#e3a948'], emoji: '🦁', comingSoon: true },
  { id: 'jaw_alligator', cat: 'jaw', price: 700, name: { en: 'Alligator', he: 'תַּנִּין' }, colors: ['#5f8f3e'], emoji: '🐊', comingSoon: true },
  { id: 'jaw_shark', cat: 'jaw', price: 1200, name: { en: 'Shark', he: 'כָּרִישׁ' }, colors: ['#6b8fa8'], emoji: '🦈', comingSoon: true },
  // brush type
  { id: 'type_manual', cat: 'brushType', price: 0, name: { en: 'Classic brush', he: 'מִבְרֶשֶׁת רְגִילָה' }, colors: ['#ffffff'], emoji: '🪥' },
  { id: 'type_electric', cat: 'brushType', price: 300, name: { en: 'Electric brush', he: 'מִבְרֶשֶׁת חַשְׁמַלִּית' }, colors: ['#7cf3ff'], emoji: '⚡' },
  // handles
  { id: 'handle_white', cat: 'handle', price: 0, name: { en: 'Snow white', he: 'לָבָן' }, colors: ['#f2f4f7'] },
  { id: 'handle_sky', cat: 'handle', price: 40, name: { en: 'Sky blue', he: 'תְּכֵלֶת' }, colors: ['#3fa9f5'] },
  { id: 'handle_pink', cat: 'handle', price: 40, name: { en: 'Bubblegum', he: 'וָרֹד' }, colors: ['#ff6fae'] },
  { id: 'handle_mint', cat: 'handle', price: 40, name: { en: 'Mint', he: 'מֶנְטָה' }, colors: ['#3ccf9a'] },
  { id: 'handle_sun', cat: 'handle', price: 60, name: { en: 'Sunshine', he: 'שֶׁמֶשׁ' }, colors: ['#ffc83d'] },
  { id: 'handle_galaxy', cat: 'handle', price: 150, name: { en: 'Galaxy', he: 'גָּלַקְסְיָה' }, colors: ['#2b1b6e', '#6a3bd1', '#e04fd6'], sparkle: true },
  { id: 'handle_rainbow', cat: 'handle', price: 220, name: { en: 'Rainbow', he: 'קֶשֶׁת' }, colors: ['#ff4d4d', '#ffb13d', '#ffe53d', '#4ddb6a', '#3fa9f5', '#8b5cf6'] },
  // bristles
  { id: 'bristles_white', cat: 'bristles', price: 0, name: { en: 'White', he: 'לָבָן' }, colors: ['#f7f7f2'] },
  { id: 'bristles_blue', cat: 'bristles', price: 30, name: { en: 'Blue', he: 'כָּחֹל' }, colors: ['#57b6ff'] },
  { id: 'bristles_pink', cat: 'bristles', price: 30, name: { en: 'Pink', he: 'וָרֹד' }, colors: ['#ff8cc6'] },
  { id: 'bristles_twotone', cat: 'bristles', price: 60, name: { en: 'Two-tone', he: 'דּוּ-צִבְעִי' }, colors: ['#f7f7f2', '#3ccf9a'] },
  { id: 'bristles_rainbow', cat: 'bristles', price: 200, name: { en: 'Rainbow', he: 'קֶשֶׁת' }, colors: ['#ff6b6b', '#ffb13d', '#ffe53d', '#4ddb6a', '#57b6ff', '#a78bfa'] },
  // toothpaste
  { id: 'paste_white', cat: 'paste', price: 0, name: { en: 'Classic', he: 'קְלָאסִית' }, colors: ['#f6f8fa'] },
  { id: 'paste_mint', cat: 'paste', price: 30, name: { en: 'Mint', he: 'מֶנְטָה' }, colors: ['#7fe3c0'] },
  { id: 'paste_bubblegum', cat: 'paste', price: 30, name: { en: 'Bubblegum', he: 'מַסְטִיק' }, colors: ['#ff9ccc'] },
  { id: 'paste_berry', cat: 'paste', price: 50, name: { en: 'Berry', he: 'פֵּרוֹת יַעַר' }, colors: ['#b57bff'] },
  { id: 'paste_striped', cat: 'paste', price: 100, name: { en: 'Striped', he: 'פַּסִּים' }, colors: ['#f6f8fa', '#ff4d6d', '#3fa9f5'] },
  { id: 'paste_sparkle', cat: 'paste', price: 180, name: { en: 'Sparkle', he: 'נוֹצֶצֶת' }, colors: ['#9ad8ff'], sparkle: true },
];

export const item = (id: string) => CATALOG.find(i => i.id === id)!;
export const STARTER = CATALOG.filter(i => i.price === 0).map(i => i.id);
export const DEFAULT_EQUIPPED: Record<Category, string> = {
  jaw: 'jaw_human', brushType: 'type_manual', handle: 'handle_white', bristles: 'bristles_white', paste: 'paste_white',
};

export function nextGoal(stars: number, owned: string[]): Item | undefined {
  return CATALOG.filter(i => !owned.includes(i.id) && i.price > 0).sort((a, b) => a.price - b.price).find(i => i.price > stars)
    ?? CATALOG.filter(i => !owned.includes(i.id) && i.price > 0).sort((a, b) => a.price - b.price)[0];
}
