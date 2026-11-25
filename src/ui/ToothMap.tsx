import type { SideProgress } from '../game/jaws/HumanJaws';

/**
 * Mini map of the mouth. Each tooth is a disc: the half facing out = outer side,
 * the half facing the middle = inner side, the dot in the centre = chewing side.
 */
export function ToothMap({ teeth }: { teeth: SideProgress[] }) {
  const W = 220, H = 160, cx = W / 2, cy = H / 2;
  const n = teeth.length / 2;
  const col = (v: number) => (v >= 1 ? '#ffffff' : `hsl(${42 + v * 8}, ${75 - v * 45}%, ${60 + v * 20}%)`);
  return (
    <svg className="toothmap" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {teeth.map((t, idx) => {
        const upper = idx < n;
        const i = idx % n;
        const a = Math.PI * (0.1 + (0.8 * i) / (n - 1));
        const x = cx - Math.cos(a) * 90;
        const y = upper ? cy - 6 - Math.sin(a) * 58 : cy + 6 + Math.sin(a) * 58;
        const dx = x - cx, dy = y - cy;
        const rot = (Math.atan2(-dx, dy) * 180) / Math.PI;
        const molar = i < 2 || i > n - 3;
        const r = molar ? 10.5 : 8.5;
        return (
          <g key={idx} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})`} className={t.done ? 'tm-done' : ''}>
            <path d={`M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0 Z`} fill={col(t.outer)} />
            <path d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 Z`} fill={col(t.inner)} />
            <circle r={r * 0.42} fill={col(t.chewing)} stroke="rgba(90,60,30,0.25)" strokeWidth={0.8} />
            <circle r={r} fill="none" stroke={t.done ? '#ffc83d' : 'rgba(90,60,30,0.35)'} strokeWidth={t.done ? 2.2 : 1} />
          </g>
        );
      })}
    </svg>
  );
}
