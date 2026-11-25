import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { DEFAULT_EQUIPPED, REWARDS, STARTER, item, type Category, type Lang } from '../config/economy';

export type Screen = 'home' | 'choose' | 'paste' | 'brush' | 'celebrate' | 'shop';

export interface Profile {
  stars: number;
  owned: string[];
  equipped: Record<Category, string>;
  lastBrushDay?: string;
  streak: number;
  sessions: number;
  lastSessionStars?: number;
}

export interface SessionResult {
  teeth: number; food: number; pasteRight: boolean; firstOfDay: boolean; streakBonus: number; steady: boolean; total: number;
}

interface State {
  lang: Lang;
  screen: Screen;
  profile: Profile;
  loaded: boolean;
  sound: boolean;
  debugUnlockAll: boolean;
  lastResult?: SessionResult;
  setLang: (l: Lang) => void;
  go: (s: Screen) => void;
  equip: (cat: Category, id: string) => void;
  buy: (id: string) => boolean;
  owns: (id: string) => boolean;
  finishSession: (r: { teeth: number; food: number; pasteRight: boolean; seconds: number }) => SessionResult;
  setSound: (on: boolean) => void;
  setDebug: (on: boolean) => void;
  resetProfile: () => void;
  load: () => Promise<void>;
}

const KEY = 'l2b-profile-v1';
const today = () => new Date().toISOString().slice(0, 10);
const fresh = (): Profile => ({ stars: 0, owned: [...STARTER], equipped: { ...DEFAULT_EQUIPPED }, streak: 0, sessions: 0 });

async function persist(p: Profile) {
  try { await idbSet(KEY, p); } catch { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }
}

const initialLang = (): Lang => {
  try { const s = localStorage.getItem('l2b-lang'); if (s === 'he' || s === 'en') return s; } catch { /* ignore */ }
  return navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en';
};

export const useStore = create<State>((set, get) => ({
  lang: initialLang(),
  screen: 'home',
  profile: fresh(),
  loaded: false,
  sound: true,
  debugUnlockAll: new URLSearchParams(location.search).has('unlockall'),
  setLang: (lang) => { set({ lang }); try { localStorage.setItem('l2b-lang', lang); } catch { /* ignore */ } },
  go: (screen) => set({ screen }),
  owns: (id) => get().debugUnlockAll || get().profile.owned.includes(id),
  equip: (cat, id) => {
    if (!get().owns(id)) return;
    const profile = { ...get().profile, equipped: { ...get().profile.equipped, [cat]: id } };
    set({ profile }); persist(profile);
  },
  buy: (id) => {
    const p = get().profile;
    const it = item(id);
    if (p.owned.includes(id) || p.stars < it.price || it.comingSoon) return false;
    const profile = { ...p, stars: p.stars - it.price, owned: [...p.owned, id], equipped: { ...p.equipped, [it.cat]: id } };
    set({ profile }); persist(profile);
    return true;
  },
  finishSession: ({ teeth, food, pasteRight, seconds }) => {
    const p = get().profile;
    const d = today();
    const firstOfDay = p.lastBrushDay !== d;
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const streak = firstOfDay ? (p.lastBrushDay === yesterday ? p.streak + 1 : 1) : p.streak;
    const streakBonus = firstOfDay && streak >= 2 ? Math.min(streak, REWARDS.streakCap) : 0;
    const steady = seconds >= REWARDS.steadySeconds;
    const total = teeth * REWARDS.perTooth + food * REWARDS.perFood + (pasteRight ? REWARDS.pasteRight : 0)
      + (firstOfDay ? REWARDS.firstBrushOfDay : 0) + streakBonus + (steady ? REWARDS.steadyBonus : 0);
    const profile: Profile = { ...p, stars: p.stars + total, lastBrushDay: d, streak, sessions: p.sessions + 1, lastSessionStars: total };
    const result = { teeth, food, pasteRight, firstOfDay, streakBonus, steady, total };
    set({ profile, lastResult: result }); persist(profile);
    return result;
  },
  setSound: (sound) => set({ sound }),
  setDebug: (debugUnlockAll) => set({ debugUnlockAll }),
  resetProfile: () => { const profile = fresh(); set({ profile }); persist(profile); },
  load: async () => {
    let p: Profile | undefined;
    try { p = await idbGet(KEY); } catch { try { const s = localStorage.getItem(KEY); if (s) p = JSON.parse(s); } catch { /* ignore */ } }
    if (p) set({ profile: { ...fresh(), ...p, equipped: { ...DEFAULT_EQUIPPED, ...p.equipped } } });
    set({ loaded: true });
  },
}));
