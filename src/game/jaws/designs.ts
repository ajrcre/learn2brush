import type { ToothKind, ToothSpec } from './toothGeometry';

/**
 * One position along a half arch (midline → back): a tooth, or a stretch of bare gum.
 * 'gap' = toothless gum ridge (a goat's diastema), 'pad' = firm dental pad where upper front teeth would be.
 * For gum slots, `h` is how far the gum ridge rises above the tooth necks and `t` its thickness.
 */
export type Slot = ToothSpec | { kind: 'gap' | 'pad'; w: number; t: number; h: number };

export const isToothSlot = (s: Slot): s is ToothSpec => s.kind !== 'gap' && s.kind !== 'pad';

export interface ArchDesign {
  /** half arch, from the midline to the back */
  half: Slot[];
  /** spacing between neighbouring slots */
  spacing: number;
  /** side-to-side scale of the arch curve */
  widen: number;
}

export interface JawDesign {
  upper: ArchDesign;
  lower: ArchDesign;
  /** the arch curve (x, z), patient's right back → front → left back; scaled to fit the slots */
  archPoints: [number, number][];
  /** forward lean of each tooth kind (radians) */
  flare: Partial<Record<ToothKind, number>>;
  /** how shiny/translucent the biting edge is per kind (see createEnamelMaterial) */
  incisal: Partial<Record<ToothKind, number>>;
  /** vertical offset of each jaw from the bite plane */
  bite: number;
  /** arch centre in jaw space: "outward" points away from it */
  archCenterZ: number;
  /** how wide a slice (mm) the brushing camera frames, so narrow muzzles aren't tiny on phones */
  frameWidth: number;
  enamelTint?: string;
  gumTint?: string;
}

/** Primary (baby) dentition, half-arch from midline to back. mm. */
export const HUMAN: JawDesign = {
  upper: {
    half: [
      { kind: 'incisor', w: 6.5, t: 5.0, h: 6.0 },
      { kind: 'incisor', w: 5.1, t: 4.0, h: 5.6 },
      { kind: 'canine', w: 7.0, t: 6.0, h: 6.6 },
      { kind: 'molar', w: 7.3, t: 8.5, h: 5.1 },
      { kind: 'molar', w: 8.2, t: 9.5, h: 5.7 },
    ],
    spacing: 0.55, // primary dentition has natural spacing
    widen: 1.0,
  },
  lower: {
    half: [
      { kind: 'incisor', w: 4.2, t: 3.8, h: 5.0 },
      { kind: 'incisor', w: 4.6, t: 4.0, h: 5.2 },
      { kind: 'canine', w: 5.2, t: 4.8, h: 6.0 },
      { kind: 'molar', w: 7.7, t: 7.0, h: 5.5 },
      { kind: 'molar', w: 9.9, t: 8.7, h: 5.5 },
    ],
    spacing: 0.55,
    widen: 0.94,
  },
  archPoints: [
    [-20, -14], [-19, -6], [-16.6, 1.5], [-12.2, 7.6], [-6.6, 11.3], [0, 12.6],
    [6.6, 11.3], [12.2, 7.6], [16.6, 1.5], [19, -6], [20, -14],
  ],
  flare: { incisor: 0.2, canine: 0.12, molar: -0.04 },
  incisal: { incisor: 1, canine: 0.6, molar: 0.2 },
  bite: 6.5,
  archCenterZ: -4,
  frameWidth: 54,
};

/**
 * A young goat (kid), 20 milk teeth like a child but laid out very differently:
 * - no upper front teeth at all: a firm dental pad instead
 * - 8 spade-shaped lower front teeth (6 incisors + 2 incisor-like canines) leaning forwards
 * - a long toothless gap, then 3 grinding cheek teeth per side, top and bottom
 * - a long, narrow, U-shaped muzzle
 * Proportions are made chunkier than real life so little fingers can brush them.
 */
export const GOAT: JawDesign = {
  upper: {
    half: [
      { kind: 'pad', w: 26.6, t: 9.5, h: 4.4 },
      { kind: 'cheek', w: 6.0, t: 6.4, h: 5.4, lobes: 2 },
      { kind: 'cheek', w: 6.8, t: 7.0, h: 5.8, lobes: 2 },
      { kind: 'cheek', w: 7.8, t: 7.4, h: 5.8, lobes: 2 },
    ],
    spacing: 0.3,
    widen: 1.0,
  },
  lower: {
    half: [
      { kind: 'spade', w: 5.0, t: 3.4, h: 6.8 },
      { kind: 'spade', w: 4.8, t: 3.3, h: 6.6 },
      { kind: 'spade', w: 4.6, t: 3.2, h: 6.3 },
      { kind: 'spade', w: 4.4, t: 3.1, h: 6.0 },
      { kind: 'gap', w: 7.0, t: 4.6, h: 1.1 },
      { kind: 'cheek', w: 5.0, t: 4.8, h: 5.0, lobes: 2 },
      { kind: 'cheek', w: 6.2, t: 5.4, h: 5.4, lobes: 2 },
      { kind: 'cheek', w: 9.0, t: 5.8, h: 5.4, lobes: 3 },
    ],
    spacing: 0.3,
    widen: 0.92,
  },
  archPoints: [
    [-13, -22], [-12.8, -13], [-12.3, -4], [-11.2, 3], [-9, 8.4], [-5.2, 11.9], [0, 13.2],
    [5.2, 11.9], [9, 8.4], [11.2, 3], [12.3, -4], [12.8, -13], [13, -22],
  ],
  flare: { spade: 0.45, cheek: -0.03 },
  incisal: { spade: 0.8, cheek: 0.2 },
  bite: 6.5,
  archCenterZ: -6,
  frameWidth: 44,
  enamelTint: '#fff9ee',
  gumTint: '#f6e6ee',
};

export const JAW_DESIGNS: Record<string, JawDesign> = { jaw_human: HUMAN, jaw_goat: GOAT };
