import type { ToothSpec } from './toothGeometry';
import { HUMAN_GUM, type GumColors } from '../materials';

/**
 * Everything that makes one set of jaws different from another.
 * Teeth are listed as half an arch, from the middle of the mouth to the back (mm).
 */
export interface Species {
  id: string;
  upper: ToothSpec[];
  lower: ToothSpec[];
  /** arch outline seen from above (x, z), from the right back corner round the front to the left back corner; it is scaled to fit the teeth */
  arch: [number, number][];
  /** lower arch width relative to the upper one */
  lowerWiden: number;
  /** space between neighbouring teeth */
  gap: number;
  /** distance from the middle (bite) plane to each gum line */
  open: number;
  /** moves the arch forwards (+) or back (−) so it turns around its middle */
  zShift: number;
  /** box (w, h) the camera keeps on screen while brushing */
  frame: { w: number; h: number };
  /** the brush handle points away from this point (content space) */
  center: [number, number, number];
  /** default turn (yaw) for the front view, so long snouts show their side */
  frontYaw: number;
  enamel: string;
  gum: GumColors;
  /** how far the gum reaches beyond the tooth necks */
  gumDepth: number;
  /** extra gum on each side of the teeth */
  gumWidth: number;
  /** a second row of baby teeth lying folded back behind the first (sharks) */
  spareRow?: boolean;
  /** the animal's head around the jaws (see heads.ts) */
  head?: 'alligator' | 'goat' | 'lion';
}

const HUMAN_ARCH: [number, number][] = [
  [-20, -14], [-19, -6], [-16.6, 1.5], [-12.2, 7.6], [-6.6, 11.3], [0, 12.6],
  [6.6, 11.3], [12.2, 7.6], [16.6, 1.5], [19, -6], [20, -14],
];

const mirror = (half: [number, number][]): [number, number][] => [...half, ...half.slice(0, -1).reverse().map(([x, z]) => [-x, z] as [number, number])];

const gap = (w: number, t: number, pad?: number): ToothSpec => ({ kind: 'incisor', w, t, h: 0, gap: true, pad });

export const SPECIES: Record<string, Species> = {
  jaw_human: {
    id: 'jaw_human',
    // primary (baby) dentition
    upper: [
      { kind: 'incisor', w: 6.5, t: 5.0, h: 6.0 },
      { kind: 'incisor', w: 5.1, t: 4.0, h: 5.6 },
      { kind: 'canine', w: 7.0, t: 6.0, h: 6.6 },
      { kind: 'molar', w: 7.3, t: 8.5, h: 5.1 },
      { kind: 'molar', w: 8.2, t: 9.5, h: 5.7 },
    ],
    lower: [
      { kind: 'incisor', w: 4.2, t: 3.8, h: 5.0 },
      { kind: 'incisor', w: 4.6, t: 4.0, h: 5.2 },
      { kind: 'canine', w: 5.2, t: 4.8, h: 6.0 },
      { kind: 'molar', w: 7.7, t: 7.0, h: 5.5 },
      { kind: 'molar', w: 9.9, t: 8.7, h: 5.5 },
    ],
    arch: HUMAN_ARCH,
    lowerWiden: 0.94,
    gap: 0.55, // primary dentition has natural spacing
    open: 6.5,
    zShift: 0,
    frame: { w: 54, h: 44 },
    center: [0, 0, -6],
    frontYaw: 0,
    enamel: '#ffffff',
    gum: HUMAN_GUM,
    gumDepth: 6.5,
    gumWidth: 1.1,
  },

  // Goats have no top front teeth: they bite grass against a tough gum pad.
  // A long gap, then tall ridged grinding teeth at the back.
  jaw_goat: {
    id: 'jaw_goat',
    upper: [
      gap(13.4, 9, 3.4), // dental pad
      gap(7, 5.5), // gap before the cheek teeth
      { kind: 'grinder', w: 7.4, t: 8.4, h: 6.4 },
      { kind: 'grinder', w: 7.8, t: 8.8, h: 6.8 },
      { kind: 'grinder', w: 8.2, t: 9.0, h: 6.8 },
    ],
    lower: [
      { kind: 'incisor', w: 3.3, t: 2.6, h: 6.0, lean: 0.55 },
      { kind: 'incisor', w: 3.3, t: 2.6, h: 6.0, lean: 0.5 },
      { kind: 'incisor', w: 3.2, t: 2.6, h: 5.6, lean: 0.45 },
      { kind: 'incisor', w: 3.0, t: 2.6, h: 5.2, lean: 0.4 },
      gap(7, 5),
      { kind: 'grinder', w: 7.0, t: 6.8, h: 6.6 },
      { kind: 'grinder', w: 7.4, t: 7.0, h: 7.0 },
      { kind: 'grinder', w: 8.6, t: 7.2, h: 7.0 },
    ],
    arch: mirror([[-12.5, -30], [-12, -20], [-11, -10], [-9.6, -2], [-7.4, 5], [-4, 9.4], [0, 10.6]]),
    lowerWiden: 0.9,
    gap: 0.5,
    open: 7.2,
    zShift: 10.5,
    frame: { w: 60, h: 64 },
    center: [0, 0, -4],
    frontYaw: 0.45,
    head: 'goat',
    enamel: '#f6ecd2',
    gum: { base: '#d98088', ridge: '#eda2a6', margin: '#d36f7e', pigment: 0.65, pigmentColor: '#3a2a2a' },
    gumDepth: 6.5,
    gumWidth: 1.1,
  },

  // Big stabbing fangs at the corners, tiny front teeth, and scissor-like cheek teeth for meat.
  jaw_lion: {
    id: 'jaw_lion',
    upper: [
      { kind: 'incisor', w: 3.2, t: 3.6, h: 4.2 },
      { kind: 'incisor', w: 3.4, t: 3.8, h: 4.6 },
      { kind: 'incisor', w: 4.2, t: 4.6, h: 5.8, lean: -0.05 },
      { kind: 'fang', w: 7.6, t: 8.4, h: 14.5, curve: 2.4 },
      gap(3.2, 6),
      { kind: 'carnassial', w: 6.4, t: 4.4, h: 6.2 },
      { kind: 'carnassial', w: 10.5, t: 5.2, h: 7.6 },
    ],
    lower: [
      { kind: 'incisor', w: 2.8, t: 3.2, h: 3.8 },
      { kind: 'incisor', w: 3.0, t: 3.4, h: 4.0 },
      { kind: 'incisor', w: 3.2, t: 3.6, h: 4.4 },
      { kind: 'fang', w: 7.0, t: 7.6, h: 12.5, curve: 2.0 },
      gap(6.2, 5.5),
      { kind: 'carnassial', w: 7.6, t: 4.4, h: 6.4 },
      { kind: 'carnassial', w: 9.6, t: 4.8, h: 7.0 },
    ],
    arch: mirror([[-18.5, -14], [-18, -5], [-16.2, 2.5], [-12, 8.4], [-6.2, 11.8], [0, 12.6]]),
    lowerWiden: 0.92,
    gap: 0.6,
    open: 11.5,
    zShift: 1,
    frame: { w: 72, h: 76 },
    center: [0, 0, -5],
    frontYaw: 0.3,
    head: 'lion',
    enamel: '#fbf0d8',
    gum: { base: '#d77d8b', ridge: '#eb9ea6', margin: '#cc6a7c', pigment: 0.8, pigmentColor: '#2b1d1f' },
    gumDepth: 6.5,
    gumWidth: 1.1,
  },

  // A long snout full of round, pointy pegs. Top and bottom teeth fit between each other.
  jaw_alligator: {
    id: 'jaw_alligator',
    upper: [
      { kind: 'cone', w: 4.0, t: 4.0, h: 5.4, curve: 0.6 },
      { kind: 'cone', w: 4.4, t: 4.4, h: 6.4, curve: 0.8 },
      { kind: 'cone', w: 5.4, t: 5.4, h: 9.0, curve: 1.2 },
      { kind: 'cone', w: 4.4, t: 4.4, h: 6.0, curve: 0.8 },
      { kind: 'cone', w: 4.6, t: 4.6, h: 6.6, curve: 0.8 },
      { kind: 'cone', w: 5.2, t: 5.2, h: 8.2, curve: 1.0 },
      { kind: 'cone', w: 4.6, t: 4.6, h: 6.0, curve: 0.8 },
      { kind: 'cone', w: 4.4, t: 4.4, h: 5.0, curve: 0.6 },
    ],
    lower: [
      { kind: 'cone', w: 4.0, t: 4.0, h: 5.6, curve: 0.6 },
      { kind: 'cone', w: 5.2, t: 5.2, h: 8.6, curve: 1.1 },
      { kind: 'cone', w: 4.2, t: 4.2, h: 5.6, curve: 0.7 },
      { kind: 'cone', w: 5.2, t: 5.2, h: 8.4, curve: 1.1 },
      { kind: 'cone', w: 4.2, t: 4.2, h: 6.0, curve: 0.7 },
      { kind: 'cone', w: 4.4, t: 4.4, h: 6.4, curve: 0.8 },
      { kind: 'cone', w: 4.4, t: 4.4, h: 6.0, curve: 0.8 },
      { kind: 'cone', w: 4.2, t: 4.2, h: 5.0, curve: 0.6 },
    ],
    arch: mirror([[-12, -34], [-11.6, -22], [-10.8, -10], [-9.8, 0], [-8.4, 8], [-5.4, 13.4], [0, 15]]),
    lowerWiden: 0.88,
    gap: 1.7,
    open: 8.5,
    zShift: 10,
    frame: { w: 58, h: 62 },
    center: [0, 0, -6],
    frontYaw: 0.5,
    head: 'alligator',
    enamel: '#fff4e0',
    gum: { base: '#e2b0a0', ridge: '#f0cbb8', margin: '#d79484' },
    gumDepth: 6.5,
    gumWidth: 1.1,
  },

  // Flat triangle teeth with saw edges, and spare teeth waiting behind them.
  jaw_shark: {
    id: 'jaw_shark',
    upper: [
      { kind: 'blade', w: 7.0, t: 2.6, h: 8.4 },
      { kind: 'blade', w: 7.2, t: 2.6, h: 8.6 },
      { kind: 'blade', w: 6.8, t: 2.6, h: 8.0 },
      { kind: 'blade', w: 6.2, t: 2.4, h: 7.2 },
      { kind: 'blade', w: 5.6, t: 2.4, h: 6.4 },
      { kind: 'blade', w: 5.0, t: 2.2, h: 5.4 },
    ],
    lower: [
      { kind: 'blade', w: 5.0, t: 2.4, h: 8.2 },
      { kind: 'blade', w: 5.2, t: 2.4, h: 8.2 },
      { kind: 'blade', w: 5.0, t: 2.4, h: 7.6 },
      { kind: 'blade', w: 4.8, t: 2.2, h: 7.0 },
      { kind: 'blade', w: 4.6, t: 2.2, h: 6.2 },
      { kind: 'blade', w: 4.2, t: 2.0, h: 5.4 },
    ],
    arch: mirror([[-20, -11], [-19.4, -4], [-17, 3], [-11.8, 9], [-5.8, 12.2], [0, 13]]),
    lowerWiden: 0.92,
    gap: 0.8,
    open: 9.5,
    zShift: 0,
    frame: { w: 56, h: 50 },
    center: [0, 0, -5],
    frontYaw: 0,
    enamel: '#fdfdfb',
    gum: { base: '#cf8f98', ridge: '#e2aab0', margin: '#c17d89' },
    gumDepth: 6.5,
    gumWidth: 3.6,
    spareRow: true,
  },
};

export const speciesFor = (id: string): Species => SPECIES[id] ?? SPECIES.jaw_human;
