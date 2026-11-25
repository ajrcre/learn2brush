import { useEffect, useMemo, useRef, useState } from 'react';
import { Game } from './game/Game';
import { useStore } from './state/store';
import { nextGoal, type Item } from './config/economy';
import { useT } from './i18n/ui';
import { audio, haptic } from './audio/audio';
import { Customizer, Swatch } from './ui/Customizer';
import { looks } from './ui/looks';
import type { HintKind } from './game/Game';

const SFX = ['scrub_loop', 'electric_loop', 'foam_loop', 'squeeze', 'bubble_pop', 'food_pop', 'tooth_ding', 'spit', 'applause', 'star_tick', 'fanfare', 'tap', 'locked', 'whoosh'];
const VOICE = ['welcome', 'choose', 'paste_instruct', 'paste_good', 'paste_too_much', 'paste_too_little', 'brush_start', 'hint_inside', 'hint_outside', 'hint_chewing', 'hint_circles', 'hint_rotate', 'hint_food', 'praise_1', 'praise_2', 'praise_3', 'halfway', 'almost', 'spit', 'finish', 'stars', 'unlock', 'locked', 'fact_twice', 'fact_baby'];

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
          {(screen === 'choose' || screen === 'shop') && <Customizer game={game} mode={screen} top={<TopBar back={() => useStore.getState().go('home')} />} />}
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
  const [overall, setOverall] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [view, setView] = useState(game.view);
  const state = useRef({ lastDone: performance.now(), start: performance.now(), halfway: false, almost: false, rotated: false, foodHint: false, circles: false, food: 0, finished: false, doneCount: 0 });
  const electric = useStore(s => s.profile.equipped.brushType === 'type_electric');

  useEffect(() => {
    const s = state.current;
    void audio.say('brush_start', { priority: true });
    const offs = [
      game.on('progress', (list, o) => {
        setOverall(o); setDoneCount(list.filter(x => x.done).length);
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
      game.on('hints', (kind: HintKind | null) => {
        if (!kind) return;
        const line = kind === 'food' ? 'hint_food' : kind === 'inner' ? 'hint_inside' : kind === 'chewing' ? 'hint_chewing' : 'hint_outside';
        void audio.say(line, { cooldown: 8 });
        void audio.sfx('tooth_ding', 0.35, 1.4);
      }),
      game.on('autoTurn', () => { void audio.sfx('whoosh', 0.7); setView(game.view); }),
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
    // the helper arrows carry the "where to brush" hints; the voice adds one technique tip
    const iv = setInterval(() => {
      const elapsed = (performance.now() - s.start) / 1000;
      if (!s.finished && !s.circles && elapsed > 14 && !electric) { s.circles = true; void audio.say('hint_circles'); }
    }, 1500);
    return () => {
      offs.forEach(f => f()); clearInterval(iv);
      void audio.loop('scrub_loop', false); void audio.loop('electric_loop', false); void audio.loop('foam_loop', false);
    };
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: 'front' | 'upper' | 'lower') => { void audio.sfx('whoosh', 0.6); game.setView(v); setView(v); state.current.rotated = true; };
  return (
    <div className="overlay brush">
      <TopBar back={() => go('home')} />
      <div className="sparkle-meter" aria-label={`${doneCount}/${game.jaws.teeth.length}`}>
        <span className="tooth-ico">🦷</span>
        <div className="track"><div style={{ width: `${overall * 100}%` }} /></div>
        <span className="tooth-ico">✨</span>
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
