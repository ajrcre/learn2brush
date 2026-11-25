import type { BrushLook } from '../game/Brush';
import type { PasteLook } from '../game/Paste';
import type { Profile } from '../state/store';
import { item, type Category } from '../config/economy';

/** 3D looks for the equipped items, optionally overridden (e.g. a locked item being "tried on"). */
export function looks(p: Profile, override: Partial<Record<Category, string>> = {}): { brush: BrushLook; paste: PasteLook } {
  const eq = { ...p.equipped, ...override };
  const h = item(eq.handle), b = item(eq.bristles), pa = item(eq.paste);
  return {
    brush: {
      type: eq.brushType === 'type_electric' ? 'electric' : 'manual',
      handle: h.colors,
      accent: h.colors.length > 1 ? h.colors[1] : h.colors[0].toLowerCase() === '#f2f4f7' ? '#7fd3f0' : h.colors[0],
      bristles: b.colors,
      sparkle: h.sparkle,
    },
    paste: { colors: pa.colors, sparkle: pa.sparkle },
  };
}
