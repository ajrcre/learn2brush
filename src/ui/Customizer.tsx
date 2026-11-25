import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { useStore } from '../state/store';
import { CATALOG, isVisible, type Category, type Item } from '../config/economy';
import { useT } from '../i18n/ui';
import { audio, haptic } from '../audio/audio';
import { looks } from './looks';

const TABS: { cat: Category; icon: string; key: 'jaw' | 'brushType' | 'shape' | 'handle' | 'bristles' | 'paste' }[] = [
  { cat: 'handle', icon: '🎨', key: 'handle' },
  { cat: 'shape', icon: '🗡️', key: 'shape' },
  { cat: 'bristles', icon: '✨', key: 'bristles' },
  { cat: 'paste', icon: '🧴', key: 'paste' },
  { cat: 'brushType', icon: '🪥', key: 'brushType' },
  { cat: 'jaw', icon: '😁', key: 'jaw' },
];

/** CSS preview of an item's colours / pattern for the swipe cards. */
function swatchBackground(it: Item): string {
  const c = it.colors;
  const grid = 'repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 1px, transparent 1px 9px), repeating-linear-gradient(90deg, rgba(0,0,0,.14) 0 1px, transparent 1px 9px)';
  switch (it.pattern) {
    case 'flames': return 'radial-gradient(ellipse 60% 75% at 50% 100%, #fff3a0 0 15%, #ffc21a 28%, #ff6a00 45%, #b31200 62%, #2a0a05 80%)';
    case 'tiger': return 'repeating-linear-gradient(115deg, #f28c28 0 8px, #1b1b1b 8px 12px)';
    case 'zebra': return 'repeating-linear-gradient(100deg, #fff 0 7px, #111 7px 12px)';
    case 'leopard': return 'radial-gradient(circle, #b8792a 0 3px, #2e1a0b 4px 6px, transparent 7px) 0 0/17px 17px, radial-gradient(circle, #b8792a 0 2px, #2e1a0b 3px 5px, transparent 6px) 8px 9px/17px 17px, #e6b450';
    case 'dalmatian': return 'radial-gradient(circle, #111 0 4px, transparent 5px) 0 0/18px 18px, radial-gradient(circle, #111 0 3px, transparent 4px) 9px 10px/18px 18px, #fafafa';
    case 'pixelGrass': return `${grid}, linear-gradient(#6fb846 0 22%, #4e8a30 22% 36%, #7a5230 36% 70%, #5f3f24 70%)`;
    case 'pixelGem': return `${grid}, conic-gradient(#36e2d4 0 25%, #1d2b3a 0 50%, #a9fff6 0 75%, #24384a 0) 0 0/18px 18px`;
    case 'pixelLava': return `${grid}, conic-gradient(#ff6a00 0 25%, #8c1a05 0 50%, #ffd54a 0 75%, #ff3d00 0) 0 0/18px 18px`;
    case 'galaxy': return 'radial-gradient(circle at 30% 30%, #fff 0 1.5px, transparent 2.5px) 0 0/13px 13px, radial-gradient(circle at 70% 60%, #e04fd6 0 20%, transparent 55%), linear-gradient(135deg, #0b0a2e, #4b1d8f)';
    case 'glitter': return `radial-gradient(circle, #fff 0 1.5px, transparent 2.5px) 0 0/8px 8px, radial-gradient(circle, rgba(255,255,255,.7) 0 1px, transparent 2px) 4px 4px/8px 8px, linear-gradient(135deg, ${c[0]}, ${c[1] ?? c[0]})`;
  }
  if (it.cat === 'paste' && it.stripes === 'even' && c.length > 1) {
    const w = 7;
    return `repeating-linear-gradient(45deg, ${c.map((col, i) => `${col} ${i * w}px ${(i + 1) * w}px`).join(', ')})`;
  }
  return c.length > 1 ? `linear-gradient(135deg, ${c.join(',')})` : c[0];
}

export function Swatch({ it, size = 'md' }: { it: Item; size?: 'md' | 'lg' }) {
  const square = it.pattern?.startsWith('pixel');
  const sparkly = it.sparkle || (it.glitter ?? 0) > 0;
  return <span className={`swatch ${size} ${sparkly ? 'sparkle' : ''} ${square ? 'square' : ''} ${it.glow ? 'glow' : ''}`} style={{ background: swatchBackground(it), ['--glow' as string]: it.colors[0] }} />;
}

/**
 * Big swipe carousel: swipe the strip (or the 3D brush) left/right to try items.
 * Owned items are put on straight away; locked items are previewed on the 3D brush with their star price.
 */
export function Customizer({ game, mode, top }: { game: Game; mode: 'choose' | 'shop'; top: React.ReactNode }) {
  const t = useT();
  const { lang, profile, owns, equip, buy, go, debugUnlockAll, setDebug } = useStore();
  const [tab, setTab] = useState<Category>(mode === 'shop' ? 'jaw' : 'handle');
  const items = useMemo(() => CATALOG.filter(i => i.cat === tab && isVisible(i)), [tab]);
  const tabs = useMemo(() => TABS.filter(tb => CATALOG.filter(i => i.cat === tb.cat && isVisible(i)).length > 1), []);
  const equippedIndex = Math.max(0, items.findIndex(i => i.id === profile.equipped[tab]));
  const [index, setIndex] = useState(equippedIndex);
  const [burst, setBurst] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const settle = useRef<number>(0);
  const programmatic = useRef(false);
  const current = items[Math.min(index, items.length - 1)];

  const scrollToIndex = (i: number, smooth = true) => {
    const el = track.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    programmatic.current = smooth;
    el.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - el.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
  };

  // new category: jump to the equipped item
  useEffect(() => {
    setIndex(equippedIndex);
    requestAnimationFrame(() => scrollToIndex(equippedIndex, false));
    game.setShowcasePaste(tab === 'paste');
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // the centred item: put it on (owned) or try it on (locked)
  useEffect(() => {
    if (!current) return;
    if (owns(current.id) && !current.comingSoon) {
      if (profile.equipped[current.cat] !== current.id) equip(current.cat, current.id);
      const l = looks(useStore.getState().profile, { [current.cat]: current.id });
      game.setBrushLook(l.brush); game.setPasteLook(l.paste);
    } else {
      const l = looks(profile, current.cat === 'jaw' ? {} : { [current.cat]: current.id });
      game.setBrushLook(l.brush); game.setPasteLook(l.paste);
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving: show what's really equipped
  useEffect(() => () => {
    const l = looks(useStore.getState().profile);
    game.setBrushLook(l.brush); game.setPasteLook(l.paste);
    game.setShowcasePaste(false);
  }, [game]);

  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = track.current;
      if (!el) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0, bestD = Infinity;
      Array.from(el.children).forEach((c, i) => {
        const h = c as HTMLElement;
        const d = Math.abs(h.offsetLeft + h.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      });
      programmatic.current = false;
      if (best !== index) {
        setIndex(best);
        void audio.sfx(owns(items[best].id) ? 'tap' : 'locked', 0.7);
        haptic(8);
      }
    }, 90);
  };

  const step = (d: number) => {
    const i = Math.max(0, Math.min(items.length - 1, index + d));
    if (i === index) { haptic([10, 30, 10]); return; }
    scrollToIndex(i);
  };

  // swipe on the 3D brush area
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: React.PointerEvent) => {
    const s = swipe.current; swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  };

  const own = current && owns(current.id);
  const afford = current && profile.stars >= current.price;
  const doBuy = () => {
    if (!current) return;
    if (buy(current.id)) {
      void audio.sfx('fanfare');
      void audio.say('unlock', { priority: true });
      haptic([30, 50, 80]);
      setBurst(true);
      setTimeout(() => setBurst(false), 1400);
      const l = looks(useStore.getState().profile);
      game.setBrushLook(l.brush); game.setPasteLook(l.paste);
    }
  };

  return (
    <div className="overlay custom">
      {top}
      <div className="cats" role="tablist">
        {tabs.map(tb => (
          <button key={tb.cat} role="tab" aria-selected={tab === tb.cat} className={tab === tb.cat ? 'on' : ''} onClick={() => { void audio.sfx('tap'); setTab(tb.cat); }}>
            <span className="icon">{tb.icon}</span><span className="lbl">{t(tb.key)}</span>
          </button>
        ))}
      </div>
      <div className="swipe-zone" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { swipe.current = null; }} />
      <div className={`status-row ${burst ? 'burst' : ''}`}>
        {current && (own && !current.comingSoon
          ? <span className="pill ok">✔ {current.name[lang]}</span>
          : current.comingSoon
            ? <span className="pill lock">🔒 {current.name[lang]} · {t('soon')}</span>
            : afford
              ? <button className="big unlock" onClick={doBuy}>🔓 {current.name[lang]} · ⭐{current.price}</button>
              : (
                <span className="pill lock">
                  🔒 ⭐{current.price}
                  <span className="mini-bar"><span style={{ width: `${Math.min(100, (profile.stars / current.price) * 100)}%` }} /></span>
                  ⭐{profile.stars}
                </span>
              ))}
      </div>
      <div className="carousel-wrap">
        <button className="nav prev" onClick={() => step(-1)} aria-label="previous">‹</button>
        <div className="carousel" dir="ltr" ref={track} onScroll={onScroll}>
          {items.map((it, i) => {
            const o = owns(it.id);
            return (
              <button key={it.id} className={`slide ${i === index ? 'center' : ''} ${o && !it.comingSoon ? 'own' : 'locked'}`} onClick={() => scrollToIndex(i)}>
                <span className="art">{it.emoji && (it.cat === 'jaw' || it.cat === 'brushType' || it.cat === 'shape') ? <span className="emoji">{it.emoji}</span> : <Swatch it={it} size="lg" />}</span>
                <span className="name">{it.name[lang]}</span>
                {!o && <span className="lock-badge">🔒</span>}
              </button>
            );
          })}
        </div>
        <button className="nav next" onClick={() => step(1)} aria-label="next">›</button>
      </div>
      <div className="bottom custom-bottom">
        {mode === 'choose'
          ? <button className="big go" onClick={() => { void audio.sfx('whoosh'); go('paste'); void audio.say('paste_instruct', { priority: true }); }}>{t('next')} ▶</button>
          : <button className="big" onClick={() => { void audio.sfx('tap'); go('home'); }}>🏠 {t('home')}</button>}
        <label className="debug"><input type="checkbox" checked={debugUnlockAll} onChange={e => setDebug(e.target.checked)} /> {t('unlockAll')}</label>
      </div>
    </div>
  );
}
