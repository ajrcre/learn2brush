import { useEffect, useMemo, useRef, useState } from 'react';
import { Game } from './game/Game';
import type { SideProgress } from './game/jaws/HumanJaws';
import type { BrushLook } from './game/Brush';
import type { PasteLook } from './game/Paste';
import { useStore, type Profile } from './state/store';
import { CATALOG, item, nextGoal, type Category, type Item } from './config/economy';
import { useT } from './i18n/ui';
import { audio, haptic } from './audio/audio';
import { ToothMap } from './ui/ToothMap';

const SFX = ['scrub_loop', 'electric_loop', 'foam_loop', 'squeeze', 'bubble_pop', 'food_pop', 'tooth_ding', 'spit', 'applause', 'star_tick', 'fanfare', 'tap', 'locked', 'whoosh'];
const VOICE = ['welcome', 'choose', 'paste_instruct', 'paste_good', 'paste_too_much', 'paste_too_little', 'brush_start', 'hint_inside', 'hint_outside', 'hint_chewing', 'hint_circles', 'hint_rotate', 'hint_food', 'praise_1', 'praise_2', 'praise_3', 'halfway', 'almost', 'spit', 'finish', 'stars', 'unlock', 'locked', 'fact_twice', 'fact_baby'];

function looks(p: Profile): { brush: BrushLook; paste: PasteLook } {
  const h = item(p.equipped.handle), b = item(p.equipped.bristles), pa = item(p.equipped.paste);
  return {
    brush: { type: p.equipped.brushType === 'type_electric' ? 'electric' : 'manual', handle: h.colors, accent: h.colors.length > 1 ? h.colors[1] : shade(h.colors[0]), bristles: b.colors, sparkle: h.sparkle },
    paste: { colors: pa.colors, sparkle: pa.sparkle },
  };
}
function shade(hex: string) {
  if (hex.toLowerCase() === '#f2f4f7') return '#7fd3f0';
  return hex;
}

let gameSingleton: Game | null = null;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const { screen, lang, profile, loaded, load, sound } = useStore();
  const t = useT();

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.title = lang === 'he' ? 'לוֹמְדִים לְצַחְצֵחַ – Learn2Brush' : 'Learn2Brush – a tooth-brushing game for kids';
    audio.lang = lang;
    audio.preload([], VOICE);
  }, [lang]);
  useEffect(() => { audio.setEnabled(sound); }, [sound]);

  useEffect(() => {
    if (!canvasRef.current || gameSingleton) return;
    const l = looks(useStore.getState().profile);
    gameSingleton = new Game(canvasRef.current, l.brush, l.paste);
    gameSingleton.start();
    (window as unknown as { __game: Game }).__game = gameSingleton;
    setGame(gameSingleton);
    requestAnimationFrame(() => requestAnimationFrame(() => { (window as unknown as { __ready: boolean }).__ready = true; }));
  }, []);

  // keep the 3D brush/paste in sync with the equipped items
  const eq = profile.equipped;
  useEffect(() => {
    if (!game) return;
    const l = looks(profile);
    game.setBrushLook(l.brush);
    game.setPasteLook(l.paste);
  }, [game, eq.brushType, eq.handle, eq.bristles, eq.paste]); // eslint-disable-line react-hooks/exhaustive-deps

  // map UI screens to 3D phases
  useEffect(() => {
    if (!game) return;
    const map = { home: 'home', choose: 'customize', shop: 'customize', paste: 'paste', brush: 'brush', celebrate: 'done' } as const;
    if (screen === 'celebrate' && game.phase === 'spit') return; // keep the spit animation running
    game.setPhase(map[screen]);
  }, [game, screen]);

  // first touch anywhere unlocks audio (iOS) and greets
  useEffect(() => {
    const once = () => {
      audio.unlock();
      audio.preload(SFX, VOICE);
      if (useStore.getState().screen === 'home') void audio.say('welcome', { priority: true });
      window.removeEventListener('pointerdown', once);
    };
    window.addEventListener('pointerdown', once);
    return () => window.removeEventListener('pointerdown', once);
  }, []);

  return (
    <div className={`app screen-${screen}`}>
      <canvas ref={canvasRef} className="stage" />
      {loaded && game && (
        <>
          {screen === 'home' && <Home />}
          {(screen === 'choose' || screen === 'shop') && <Locker mode={screen} />}
          {screen === 'paste' && <PasteStep game={game} />}
          {screen === 'brush' && <BrushStep game={game} />}
          {screen === 'celebrate' && <Celebrate />}
        </>
      )}
      {!loaded && <div className="loading">{t('title')}</div>}
    </div>
  );
}

function TopBar({ back }: { back?: () => void }) {
  const { lang, setLang, profile, sound, setSound } = useStore();
  const t = useT();
  return (
    <div className="topbar">
      {back ? <button className="round" onClick={() => { void audio.sfx('tap'); back(); }} aria-label={t('back')}>{lang === 'he' ? '→' : '←'}</button> : <span />}
      <div className="star-pill" aria-label={t('stars')}>⭐ <b>{profile.stars}</b></div>
      <div className="row">
        <button className="round" onClick={() => setSound(!sound)} aria-label={t('sound')}>{sound ? '🔊' : '🔇'}</button>
        <button className="round lang" onClick={() => { void audio.sfx('tap'); setLang(lang === 'he' ? 'en' : 'he'); }}>{lang === 'he' ? 'EN' : 'עב'}</button>
      </div>
    </div>
  );
}

function Home() {
  const t = useT();
  const { go, profile } = useStore();
  const goal = nextGoal(profile.stars, profile.owned);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone;
  return (
    <div className="overlay home">
      <TopBar />
      <div className="hero">
        <h1>{t('title')}</h1>
        <p>{t('tagline')}</p>
      </div>
      <div className="bottom">
        {goal && <GoalBar goal={goal} stars={profile.stars} />}
        <div className="row center gap">
          <button className="big play" onClick={() => { audio.unlock(); void audio.sfx('tap'); go('choose'); void audio.say('choose', { priority: true }); }}>
            <span className="icon">🪥</span>{t('play')}
          </button>
          <button className="big shop" onClick={() => { audio.unlock(); void audio.sfx('tap'); go('shop'); }}>
            <span className="icon">🎁</span>{t('shop')}
          </button>
        </div>
        {isIOS && <p className="hint">{t('installHint')}</p>}
      </div>
    </div>
  );
}

function GoalBar({ goal, stars }: { goal: Item; stars: number }) {
  const t = useT();
  const lang = useStore(s => s.lang);
  const pct = Math.min(1, stars / goal.price);
  return (
    <div className="goal">
      <span className="goal-icon">{goal.emoji ?? <Swatch it={goal} />}</span>
      <div className="goal-bar"><div style={{ width: `${pct * 100}%` }} /></div>
      <span className="goal-text">{t('nextPrize')}: {goal.name[lang]} · ⭐{goal.price}</span>
    </div>
  );
}

function Swatch({ it }: { it: Item }) {
  const bg = it.colors.length > 1 ? `linear-gradient(135deg, ${it.colors.join(',')})` : it.colors[0];
  return <span className={`swatch ${it.sparkle ? 'sparkle' : ''}`} style={{ background: bg }} />;
}

const TABS: { cat: Category; icon: string; key: 'jaw' | 'brushType' | 'handle' | 'bristles' | 'paste' }[] = [
  { cat: 'jaw', icon: '😁', key: 'jaw' },
  { cat: 'brushType', icon: '🪥', key: 'brushType' },
  { cat: 'handle', icon: '🎨', key: 'handle' },
  { cat: 'bristles', icon: '✨', key: 'bristles' },
  { cat: 'paste', icon: '🧴', key: 'paste' },
];

/** Customiser + prize shop in one: owned items equip, locked items show price; affordable ones can be unlocked. */
function Locker({ mode }: { mode: 'choose' | 'shop' }) {
  const t = useT();
  const { lang, profile, owns, equip, buy, go, debugUnlockAll, setDebug } = useStore();
  const [tab, setTab] = useState<Category>(mode === 'shop' ? 'jaw' : 'handle');
  const [confirm, setConfirm] = useState<Item | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const items = CATALOG.filter(i => i.cat === tab);

  const tap = (it: Item) => {
    if (owns(it.id)) {
      if (it.comingSoon) { void audio.sfx('locked'); return; }
      void audio.sfx('tap'); equip(it.cat, it.id); haptic(10); return;
    }
    if (it.comingSoon || profile.stars < it.price) { void audio.sfx('locked'); void audio.say('locked'); haptic([20, 40, 20]); return; }
    void audio.sfx('tap');
    setConfirm(it);
  };
  const doBuy = (it: Item) => {
    if (buy(it.id)) {
      void audio.sfx('fanfare');
      void audio.say('unlock', { priority: true });
      haptic([30, 50, 80]);
      setBurst(it.id);
      setTimeout(() => setBurst(null), 1600);
    }
    setConfirm(null);
  };

  return (
    <div className="overlay locker">
      <TopBar back={() => go('home')} />
      <h2 className="screen-title">{mode === 'shop' ? `🎁 ${t('shop')}` : t('choose')}</h2>
      <div className="panel">
        <div className="tabs" role="tablist">
          {TABS.map(tb => (
            <button key={tb.cat} role="tab" aria-selected={tab === tb.cat} className={tab === tb.cat ? 'on' : ''} onClick={() => { void audio.sfx('tap'); setTab(tb.cat); }}>
              <span className="icon">{tb.icon}</span><span className="lbl">{t(tb.key)}</span>
            </button>
          ))}
        </div>
        <div className="grid">
          {items.map(it => {
            const own = owns(it.id);
            const equipped = profile.equipped[it.cat] === it.id;
            const afford = profile.stars >= it.price;
            return (
              <button key={it.id} className={`card ${equipped ? 'equipped' : ''} ${own ? 'own' : 'locked'} ${afford && !own && !it.comingSoon ? 'afford' : ''} ${burst === it.id ? 'burst' : ''}`} onClick={() => tap(it)}>
                <span className="art">{it.emoji && (it.cat === 'jaw' || it.cat === 'brushType') ? <span className="emoji">{it.emoji}</span> : <Swatch it={it} />}</span>
                <span className="name">{it.name[lang]}</span>
                {!own && <span className="price">{it.comingSoon ? `🔒 ${t('soon')}` : `🔒 ⭐${it.price}`}</span>}
                {equipped && <span className="check">✔</span>}
              </button>
            );
          })}
        </div>
        <label className="debug"><input type="checkbox" checked={debugUnlockAll} onChange={e => setDebug(e.target.checked)} /> {t('unlockAll')}</label>
      </div>
      {mode === 'choose' && (
        <div className="bottom">
          <button className="big go" onClick={() => { void audio.sfx('whoosh'); go('paste'); void audio.say('paste_instruct', { priority: true }); }}>{t('next')} ▶</button>
        </div>
      )}
      {confirm && (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <span className="art big">{confirm.emoji ?? <Swatch it={confirm} />}</span>
            <h3>{confirm.name[lang]}</h3>
            <button className="big go" onClick={() => doBuy(confirm)}>🔓 ⭐{confirm.price}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PasteStep({ game }: { game: Game }) {
  const t = useT();
  const go = useStore(s => s.go);
  const [amount, setAmount] = useState(0);
  const [holding, setHolding] = useState(false);
  const verdict = amount < 0.3 ? 'little' : amount > 0.78 ? 'much' : 'good';
  useEffect(() => game.on('pasteAmount', a => setAmount(a)), [game]);
  const start = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    audio.unlock();
    setHolding(true);
    game.setSqueezing(true);
    void audio.sfx('squeeze');
    haptic(15);
  };
  const end = () => {
    if (!holding) return;
    setHolding(false);
    game.setSqueezing(false);
    const a = game.pasteAmount;
    if (a < 0.3) void audio.say('paste_too_little', { priority: true, cooldown: 1 });
    else if (a > 0.78) void audio.say('paste_too_much', { priority: true, cooldown: 1 });
    else void audio.say('paste_good', { priority: true, cooldown: 1 });
  };
  (window as unknown as { __pasteRight: boolean }).__pasteRight = verdict === 'good';
  return (
    <div className="overlay paste">
      <TopBar back={() => go('choose')} />
      <div className="bottom">
        <div className={`meter ${verdict}`}>
          <div className="zone" style={{ insetInlineStart: `${(0.3 / 1.3) * 100}%`, width: `${((0.78 - 0.3) / 1.3) * 100}%` }}><span>🫛 {t('peaSize')}</span></div>
          <div className="fill" style={{ width: `${(amount / 1.3) * 100}%` }} />
        </div>
        <div className="row center gap">
          <button className={`big squeeze ${holding ? 'holding' : ''}`} onPointerDown={start} onPointerUp={end} onPointerCancel={end} onContextMenu={e => e.preventDefault()}>
            <span className="icon">🧴</span>{t('hold')}
          </button>
          {amount >= 0.3 && !holding && (
            <button className="big go" onClick={() => { void audio.sfx('whoosh'); go('brush'); }}>{t('go')} ▶</button>
          )}
        </div>
      </div>
    </div>
  );
}

const PRAISE = ['praise_1', 'praise_2', 'praise_3'];

function BrushStep({ game }: { game: Game }) {
  const t = useT();
  const { go, finishSession } = useStore();
  const [teeth, setTeeth] = useState<SideProgress[]>(() => game.jaws.teeth.map(() => ({ outer: 0, inner: 0, chewing: 0, done: false })));
  const [overall, setOverall] = useState(0);
  const [view, setView] = useState(game.view);
  const state = useRef({ lastDone: performance.now(), start: performance.now(), halfway: false, almost: false, rotated: false, foodHint: false, circles: false, food: 0, finished: false, doneCount: 0 });
  const electric = useStore(s => s.profile.equipped.brushType === 'type_electric');

  useEffect(() => {
    const s = state.current;
    void audio.say('brush_start', { priority: true });
    const offs = [
      game.on('progress', (list, o) => {
        setTeeth(list); setOverall(o);
        if (o >= 0.5 && !s.halfway) { s.halfway = true; void audio.say('halfway'); }
      }),
      game.on('toothDone', (_i, n) => {
        s.lastDone = performance.now();
        s.doneCount = n;
        void audio.sfx('tooth_ding', 0.7, 0.95 + Math.random() * 0.15);
        haptic(25);
        if (n >= game.jaws.teeth.length - 3 && !s.almost && n < game.jaws.teeth.length) { s.almost = true; void audio.say('almost'); }
        else if (n % 4 === 0) void audio.say(PRAISE[Math.floor(Math.random() * PRAISE.length)], { cooldown: 4 });
      }),
      game.on('foodRemoved', (n) => { s.food = n; void audio.sfx('food_pop'); if (n === 1) void audio.say('praise_2'); }),
      game.on('brushing', on => {
        void audio.loop(electric ? 'electric_loop' : 'scrub_loop', on, electric ? 0.45 : 0.7);
        void audio.loop('foam_loop', on, 0.25);
        if (on && electric) haptic(200);
      }),
      game.on('bubblePop', () => { if (Math.random() < 0.4) void audio.sfx('bubble_pop', 0.25, 0.8 + Math.random() * 0.6); }),
      game.on('rotated', () => { s.rotated = true; }),
      game.on('allClean', () => {
        if (s.finished) return;
        s.finished = true;
        void audio.loop('scrub_loop', false); void audio.loop('electric_loop', false); void audio.loop('foam_loop', false);
        void audio.say('spit', { priority: true });
        setTimeout(() => { game.startSpit(); void audio.sfx('spit'); }, 900);
        setTimeout(() => {
          void audio.sfx('applause', 0.8);
          void audio.say('finish', { priority: true });
          const seconds = (performance.now() - s.start) / 1000;
          finishSession({ teeth: game.jaws.teeth.length, food: s.food, pasteRight: !!(window as unknown as { __pasteRight: boolean }).__pasteRight, seconds });
          go('celebrate');
        }, 3200);
      }),
    ];
    // voice hints
    const iv = setInterval(() => {
      const now = performance.now();
      const since = (now - s.lastDone) / 1000;
      const elapsed = (now - s.start) / 1000;
      if (s.finished) return;
      if (!s.circles && elapsed > 14 && !electric) { s.circles = true; void audio.say('hint_circles'); return; }
      if (!s.foodHint && elapsed > 25 && game.food.remaining > 0) { s.foodHint = true; void audio.say('hint_food'); return; }
      if (since > 12 && elapsed > 10) {
        const side = game.dirtiestSide();
        if (side === 'inner' && !s.rotated) void audio.say('hint_rotate', { cooldown: 25 });
        else void audio.say(side === 'inner' ? 'hint_inside' : side === 'chewing' ? 'hint_chewing' : 'hint_outside', { cooldown: 15 });
      }
    }, 1500);
    return () => {
      offs.forEach(f => f()); clearInterval(iv);
      void audio.loop('scrub_loop', false); void audio.loop('electric_loop', false); void audio.loop('foam_loop', false);
    };
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: 'front' | 'upper' | 'lower') => { void audio.sfx('whoosh', 0.6); game.setView(v); setView(v); state.current.rotated = true; };
  const done = teeth.filter(x => x.done).length;
  return (
    <div className="overlay brush">
      <TopBar back={() => go('home')} />
      <div className="progress-wrap">
        <ToothMap teeth={teeth} />
        <div className="progress"><div style={{ width: `${overall * 100}%` }} /><span>{done}/{teeth.length}</span></div>
      </div>
      <div className="views">
        <button className={view === 'upper' ? 'on' : ''} onClick={() => pick('upper')} aria-label={t('top')}><ViewIcon kind="upper" /></button>
        <button className={view === 'front' ? 'on' : ''} onClick={() => pick('front')} aria-label={t('front')}><ViewIcon kind="front" /></button>
        <button className={view === 'lower' ? 'on' : ''} onClick={() => pick('lower')} aria-label={t('bottom')}><ViewIcon kind="lower" /></button>
      </div>
    </div>
  );
}

function ViewIcon({ kind }: { kind: 'upper' | 'front' | 'lower' }) {
  const teethRow = (y: number, flip: boolean) => (
    <g transform={`translate(0 ${y}) ${flip ? 'scale(1 -1)' : ''}`}>
      {[-15, -5, 5, 15].map(x => <rect key={x} x={x - 4.2} y={0} width={8.4} height={9} rx={3} fill="#fff" stroke="#c9a9a9" strokeWidth={1} />)}
    </g>
  );
  return (
    <svg viewBox="-24 -24 48 48" width="40" height="40" aria-hidden>
      {(kind === 'upper' || kind === 'front') && (<><rect x={-22} y={-20} width={44} height={9} rx={4.5} fill="#f08a96" />{teethRow(-11, false)}</>)}
      {(kind === 'lower' || kind === 'front') && (<><rect x={-22} y={11} width={44} height={9} rx={4.5} fill="#f08a96" />{teethRow(11, true)}</>)}
      {kind !== 'front' && <path d={kind === 'upper' ? 'M -6 14 L 0 6 L 6 14' : 'M -6 -14 L 0 -6 L 6 -14'} stroke="#2f80ed" strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function Celebrate() {
  const t = useT();
  const { go, lastResult, profile, lang } = useStore();
  const r = lastResult;
  const rows = useMemo(() => r ? [
    { k: t('teethClean'), v: r.teeth, icon: '🦷' },
    { k: t('foodBits'), v: r.food, icon: '🍞' },
    ...(r.pasteRight ? [{ k: t('pasteBonus'), v: 3, icon: '🫛' }] : []),
    ...(r.firstOfDay ? [{ k: t('dayBonus'), v: 5, icon: '🌞' }] : []),
    ...(r.streakBonus ? [{ k: t('streakBonus'), v: r.streakBonus, icon: '🔥' }] : []),
    ...(r.steady ? [{ k: t('steadyBonus'), v: 3, icon: '🐢' }] : []),
  ] : [], [r, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!r) return;
    let n = 0;
    const iv = setInterval(() => {
      n++;
      setShown(n);
      void audio.sfx('star_tick', 0.5, 1 + Math.min(n, 40) * 0.015);
      if (n >= r.total) { clearInterval(iv); setTimeout(() => void audio.say('stars'), 300); }
    }, Math.max(40, 1600 / r.total));
    return () => clearInterval(iv);
  }, [r]);
  const goal = nextGoal(profile.stars, profile.owned);
  return (
    <div className="overlay celebrate">
      <TopBar />
      <div className="confetti" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.25}s`, background: ['#ffd54a', '#ff6fae', '#3fa9f5', '#3ccf9a', '#b57bff'][i % 5] }} />)}</div>
      <div className="result-card">
        <h2>✨ {t('greatJob')} ✨</h2>
        <ul>
          {rows.map(row => <li key={row.k}><span>{row.icon} {row.k}</span><b>+{row.v} ⭐</b></li>)}
        </ul>
        <div className="total">{t('total')}: <b className="count">+{shown} ⭐</b></div>
        {goal && <GoalBar goal={goal} stars={profile.stars} />}
      </div>
      <div className="bottom row center gap">
        <button className="big go" onClick={() => { void audio.sfx('tap'); go('choose'); }}>🔁 {t('again')}</button>
        <button className="big shop" onClick={() => { void audio.sfx('tap'); go('shop'); }}>🎁 {t('shop')}</button>
        <button className="big" onClick={() => { void audio.sfx('tap'); go('home'); }}>🏠 {t('home')}</button>
      </div>
    </div>
  );
}
