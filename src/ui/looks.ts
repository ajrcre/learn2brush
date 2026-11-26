import type { BrushLook } from '../game/Brush';
import type { PasteLook } from '../game/Paste';
import type { PatternId } from '../game/patterns';
import type { ShapeId } from '../game/brushShapes';
import type { Profile } from '../state/store';
import { item, isVisible, useUpgrade, DEFAULT_EQUIPPED, type Category, type Item } from '../config/economy';

/** Equipped item for a category; falls back to the free default if it's hidden (still in review). */
function pick(eq: Record<Category, string>, cat: Category): Item {
  const it = item(eq[cat]);
  return it && isVisible(it) ? it : item(DEFAULT_EQUIPPED[cat]);
}

/** 3D looks for the equipped items, optionally overridden (e.g. a locked item being "tried on"). */
export function looks(p: Profile, override: Partial<Record<Category, string>> = {}): { brush: BrushLook; paste: PasteLook } {
  const eq = { ...DEFAULT_EQUIPPED, ...p.equipped, ...override };
  const h = override.handle ? item(override.handle) : pick(eq, 'handle');
  const b = override.bristles ? item(override.bristles) : pick(eq, 'bristles');
  const pa = override.paste ? item(override.paste) : pick(eq, 'paste');
  const sh = override.shape ? item(override.shape) : pick(eq, 'shape');
  const type = (override.brushType ? item(override.brushType) : pick(eq, 'brushType')).id === 'type_electric' ? 'electric' : 'manual';
  const hu = useUpgrade(h), pu = useUpgrade(pa);
  const defaultAccent = h.colors.length > 1 ? h.colors[1] : h.colors[0].toLowerCase() === '#f2f4f7' ? '#7fd3f0' : h.colors[0];
  return {
    brush: {
      type,
      handle: h.colors,
      pattern: hu ? (h.pattern as PatternId | undefined) : undefined,
      glitter: hu ? h.glitter : 0,
      sparkle: h.sparkle,
      accent: h.accent ?? defaultAccent,
      head: hu ? h.head : undefined,
      shape: (sh.shape as ShapeId | undefined) ?? 'classic',
      bristles: b.colors,
      bristleGlitter: b.glitter,
      bristleGlow: b.glow,
    },
    paste: {
      colors: pa.colors,
      sparkle: pa.sparkle,
      glitter: pu ? pa.glitter : 0,
      glow: pa.glow,
      stripes: pa.stripes ?? 'legacy',
    },
  };
}

/** Which jaws to show: the equipped (or tried-on) animal, or kid teeth while that animal isn't available yet. */
export function jawFor(p: Profile, override?: string): string {
  const it = item(override ?? p.equipped.jaw ?? DEFAULT_EQUIPPED.jaw);
  return it && it.cat === 'jaw' && isVisible(it) && !it.comingSoon ? it.id : DEFAULT_EQUIPPED.jaw;
}
