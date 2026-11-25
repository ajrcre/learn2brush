import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { useStore } from '../state/store';
import { CATALOG, type Category, type Item } from '../config/economy';
import { useT } from '../i18n/ui';
import { audio, haptic } from '../audio/audio';
import { looks } from './looks';

const TABS: { cat: Category; icon: string; key: 'jaw' | 'brushType' | 'handle' | 'bristles' | 'paste' }[] = [
  { cat: 'handle', icon: '🎨', key: 'handle' },
  { cat: 'bristles', icon: '✨', key: 'bristles' },
  { cat: 'paste', icon: '🧴', key: 'paste' },
  { cat: 'brushType', icon: '🪥', key: 'brushType' },
  { cat: 'jaw', icon: '😁', key: 'jaw' },
];

export function Swatch({ it, size = 'md' }: { it: Item; size?: 'md' | 'lg' }) {
  const bg = it.colors.length > 1 ? `linear-gradient(135deg, ${it.colors.join(',')})` : it.colors[0];
  return <span className={`swatch ${size} ${it.sparkle ? 'sparkle' : ''}`} style={{ background: bg }} />;
}

/**
 * Big swipe carousel: swipe the strip (or the 3D brush) left/right to try items.
 * Owned items are put on straight away; locked items are previewed on the 3D brush with their star price.
 */
export function Customizer({ game, mode, top }: { game: Game; mode: 'choose' | 'shop'; top: React.ReactNode }) {
  const t = useT();
  const { lang, profile, owns, equip, buy, go, debugUnlockAll, setDebug } = useStore();
  const [tab, setTab] = useState<Category>(mode === 'shop' ? 'jaw' : 'handle');
  const items = useMemo(() => CATALOG.filter(i => i.cat === tab), [tab]);
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
        {TABS.map(tb => (
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
                <span className="art">{it.emoji && (it.cat === 'jaw' || it.cat === 'brushType') ? <span className="emoji">{it.emoji}</span> : <Swatch it={it} size="lg" />}</span>
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
