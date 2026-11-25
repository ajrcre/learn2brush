import * as THREE from 'three';

/**
 * Procedural tooth geometry. Units are millimetres.
 * Local frame: +y = towards the biting edge (crown), +z = outer (cheek/lip) side, +x = along the arch.
 * y = 0 is the neck (cemento-enamel junction); the root continues below and is hidden in the gum.
 */
export type ToothKind = 'incisor' | 'canine' | 'molar';

export interface ToothSpec {
  kind: ToothKind;
  w: number; // crown width along arch
  t: number; // crown thickness (outer↔inner)
  h: number; // crown height above neck
}

export const SIDE_OUTER = 0;
export const SIDE_INNER = 1;
export const SIDE_CHEWING = 2;
export const SIDE_NONE = 3;

const U = 56; // segments around
const V_WALL = 30; // rings along the wall
const V_CAP = 18; // rings on the cap

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Simple deterministic PRNG so each tooth gets stable natural variation. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

/** Width (x) and thickness (z) scale factors, as a function of normalised height q = y/h. */
function profile(kind: ToothKind, q: number, rootDepthQ: number): [number, number, number] {
  // returns [sx, sz, superellipseExponent]
  if (q < 0) {
    const r = Math.min(1, -q / rootDepthQ);
    const sx = THREE.MathUtils.lerp(0.74, 0.35, r);
    const sz = THREE.MathUtils.lerp(0.8, 0.4, r);
    return [sx, sz, 2.2];
  }
  const bulge = Math.sin(Math.min(q / 0.42, 1) * Math.PI * 0.5);
  switch (kind) {
    case 'incisor': {
      const sx = 0.74 + 0.26 * bulge + 0.04 * smooth(0.5, 1, q);
      const sz = (0.8 + 0.2 * smooth(0, 0.3, q)) * (1 - 0.62 * smooth(0.3, 1.0, q));
      return [sx, sz, 2.6 + 1.2 * smooth(0.2, 1, q)];
    }
    case 'canine': {
      const taper = smooth(0.45, 1.0, q);
      const sx = (0.74 + 0.26 * bulge) * (1 - 0.35 * taper);
      const sz = (0.8 + 0.2 * smooth(0, 0.3, q)) * (1 - 0.35 * taper);
      return [sx, sz, 2.3];
    }
    case 'molar': {
      const sx = (0.78 + 0.22 * bulge) * (1 - 0.06 * smooth(0.5, 1, q));
      const sz = (0.8 + 0.2 * bulge) * (1 - 0.1 * smooth(0.45, 1, q));
      return [sx, sz, 3.0];
    }
  }
}

function capHeight(kind: ToothKind, h: number) {
  return kind === 'canine' ? 0.42 * h : kind === 'incisor' ? 0.14 * h : 0.2 * h;
}

/** Occlusal relief for molars: cusps with a central fissure. u,w ∈ [-1,1]. */
function cuspField(kind: ToothKind, u: number, w: number, rand: () => number, cusps: number[][]) {
  if (kind !== 'molar') return 0;
  let f = 0;
  for (const [cu, cw, a] of cusps) {
    const d2 = (u - cu) ** 2 / 0.16 + (w - cw) ** 2 / 0.2;
    f += a * Math.exp(-d2);
  }
  // central fissure along the arch direction + small cross fissure
  f -= 0.55 * Math.exp(-(w * w) / 0.02) * (1 - 0.6 * u * u);
  f -= 0.25 * Math.exp(-(u * u) / 0.015) * (1 - w * w);
  void rand;
  return f;
}

export interface ToothGeometryResult {
  geometry: THREE.BufferGeometry;
  /** side per vertex (0 outer,1 inner,2 chewing,3 none) */
  sides: Uint8Array;
}

export function buildToothGeometry(spec: ToothSpec, seed: number): ToothGeometryResult {
  const rand = rng(seed);
  const { kind, w, t, h } = spec;
  const root = h * 0.9;
  const capH = capHeight(kind, h);
  const yTop = h - capH;
  const rootQ = root / h;

  // natural variation
  const jitterX = 1 + (rand() - 0.5) * 0.06;
  const jitterZ = 1 + (rand() - 0.5) * 0.06;
  const cusps: number[][] =
    kind === 'molar'
      ? [
          [-0.45, 0.42, 1.0 + rand() * 0.2],
          [0.45, 0.42, 0.9 + rand() * 0.2],
          [-0.42, -0.45, 0.85 + rand() * 0.2],
          [0.42, -0.45, 0.8 + rand() * 0.2],
        ]
      : [];

  const ringCount = V_WALL + 1 + V_CAP;
  const vertCount = ringCount * U + 2; // + top apex + bottom apex
  const pos = new Float32Array(vertCount * 3);
  const crownT = new Float32Array(vertCount);

  const ringEdge: [number, number][] = []; // last wall ring xz for cap
  let vi = 0;
  const put = (x: number, y: number, z: number) => {
    pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
    crownT[vi] = Math.max(0, y / h);
    vi++;
  };

  // wall rings from root bottom to yTop
  for (let j = 0; j <= V_WALL; j++) {
    const v = j / V_WALL;
    // bias ring density towards the crown
    const vb = 1 - Math.pow(1 - v, 1.6);
    const y = -root + vb * (yTop + root);
    const q = y / h;
    const [sx, sz, p] = profile(kind, q, rootQ);
    const hx = (w / 2) * sx * jitterX;
    const hz = (t / 2) * sz * jitterZ;
    // slight outer convexity near the neck (cervical bulge on primary teeth)
    const cerv = 0.25 * Math.exp(-((q - 0.12) ** 2) / 0.01);
    for (let i = 0; i < U; i++) {
      const a = (i / U) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      let z = hz * Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      if (z > 0) z += cerv * s * s;
      put(x, y, z);
      if (j === V_WALL) ringEdge.push([x, z]);
    }
  }
  // cap rings
  const lastHx = Math.max(...ringEdge.map(e => Math.abs(e[0])));
  const lastHz = Math.max(...ringEdge.map(e => Math.abs(e[1])));
  const cuspAmp = kind === 'molar' ? h * 0.16 : 0;
  for (let j = 1; j <= V_CAP; j++) {
    const s = j / V_CAP;
    const r = Math.cos(s * Math.PI * 0.5);
    let yBase: number;
    if (kind === 'canine') yBase = yTop + capH * (1 - Math.pow(r, 1.35));
    else yBase = yTop + capH * Math.sin(s * Math.PI * 0.5);
    for (let i = 0; i < U; i++) {
      const [ex, ez] = ringEdge[i];
      const x = ex * r, z = ez * r;
      const u = x / lastHx, ww = z / lastHz;
      let y = yBase + cuspAmp * cuspField(kind, u, ww, rand, cusps) * smooth(0, 0.35, s);
      if (kind === 'incisor') y += h * 0.035 * Math.cos(u * Math.PI * 1.5) * smooth(0.2, 0.8, s) * (1 - u * u);
      put(x, y, z);
    }
  }
  const topY = kind === 'molar' ? h - capH * 0.4 : h;
  put(0, topY, 0); // apex top
  put(0, -root - 0.4, 0); // apex bottom

  const apexTop = vi - 2;
  const apexBottom = vi - 1;

  const idx: number[] = [];
  for (let j = 0; j < ringCount - 1; j++) {
    for (let i = 0; i < U; i++) {
      const a = j * U + i;
      const b = j * U + ((i + 1) % U);
      const c = (j + 1) * U + i;
      const d = (j + 1) * U + ((i + 1) % U);
      idx.push(a, c, b, b, c, d);
    }
  }
  const lastRing = (ringCount - 1) * U;
  for (let i = 0; i < U; i++) idx.push(lastRing + i, apexTop, lastRing + ((i + 1) % U));
  for (let i = 0; i < U; i++) idx.push(i, (i + 1) % U, apexBottom);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('crownT', new THREE.BufferAttribute(crownT, 1));
  g.setIndex(idx);
  g.computeVertexNormals();

  // classify sides
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const sides = new Uint8Array(vertCount);
  const chewStart = kind === 'molar' ? 0.62 : kind === 'canine' ? 0.8 : 0.86;
  for (let k = 0; k < vertCount; k++) {
    const y = pos[k * 3 + 1];
    const ny = nrm.getY(k), nz = nrm.getZ(k);
    if (y < 0.15) sides[k] = SIDE_NONE;
    else if (y > h * chewStart && ny > 0.45) sides[k] = SIDE_CHEWING;
    else sides[k] = nz >= 0 ? SIDE_OUTER : SIDE_INNER;
  }
  g.setAttribute('dirt', new THREE.BufferAttribute(new Float32Array(vertCount), 1));
  g.computeBoundingSphere();
  return { geometry: g, sides };
}
