import * as THREE from 'three';
import { buildToothGeometry, isGrinder, rng, SIDE_CHEWING, SIDE_INNER, SIDE_NONE, SIDE_OUTER, type ToothSpec } from './toothGeometry';
import { createEnamelMaterial, createGumMaterial } from '../materials';
import { HUMAN, isToothSlot, type ArchDesign, type JawDesign, type Slot } from './designs';

export interface Tooth {
  index: number;
  jaw: 'upper' | 'lower';
  spec: ToothSpec;
  mesh: THREE.Mesh;
  sides: Uint8Array;
  dirt: Float32Array;
  initial: Float32Array;
  /** cached sums of initial dirt per side */
  initialSum: Float32Array;
  done: boolean;
  sideDone: [boolean, boolean, boolean];
  glow: number;
}

export interface SideProgress { outer: number; inner: number; chewing: number; done: boolean }

function makeArch(points: [number, number][], totalLen: number, widen: number) {
  const pts = points.map(([x, z]) => new THREE.Vector3(x * widen, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const scale = totalLen / curve.getLength();
  const scaled = new THREE.CatmullRomCurve3(pts.map(p => p.clone().multiplyScalar(scale)), false, 'centripetal');
  scaled.arcLengthDivisions = 800;
  return scaled;
}

/** Full arch order (patient's right back → midline → left back); bare-gum slots that meet at the midline become one. */
function fullArch(arch: ArchDesign): Slot[] {
  const order: Slot[] = [...arch.half.slice().reverse(), ...arch.half];
  const merged: Slot[] = [];
  for (const s of order) {
    const prev = merged[merged.length - 1];
    if (prev && !isToothSlot(prev) && prev.kind === s.kind) merged[merged.length - 1] = { ...prev, w: prev.w + s.w + arch.spacing };
    else merged.push(s);
  }
  return merged;
}

/** Code-built teeth and gums for one mouth (human, goat, …), laid out from a JawDesign. */
export class Jaws {
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly teeth: Tooth[] = [];
  readonly gums: THREE.Mesh[] = [];
  readonly toothMeshes: THREE.Mesh[] = [];
  readonly gumMat: THREE.MeshPhysicalMaterial;
  /** Arch centre z offset used for "outward" direction (in jaw local space). */
  readonly archCenter: THREE.Vector3;

  constructor(readonly design: JawDesign = HUMAN, seed = 7) {
    this.archCenter = new THREE.Vector3(0, 0, design.archCenterZ);
    this.gumMat = createGumMaterial(design.gumTint);
    this.root.add(this.upper, this.lower);
    this.buildJaw('upper', design.upper, seed);
    this.buildJaw('lower', design.lower, seed + 101);
    this.upper.position.y = design.bite;
    this.lower.position.y = -design.bite;
  }

  private buildJaw(which: 'upper' | 'lower', arch: ArchDesign, seed: number) {
    const group = which === 'upper' ? this.upper : this.lower;
    const up = which === 'upper' ? -1 : 1; // crown direction
    const order = fullArch(arch);
    const widths = order.map(s => s.w);
    const total = widths.reduce((a, b) => a + b, 0) + arch.spacing * (order.length - 1);
    const curve = makeArch(this.design.archPoints, total, arch.widen);
    const L = curve.getLength();
    const centers: number[] = [];
    let s = 0;
    for (let i = 0; i < order.length; i++) {
      centers.push(s + widths[i] / 2);
      s += widths[i] + arch.spacing;
    }

    const rand = rng(seed);
    order.forEach((spec, i) => {
      if (!isToothSlot(spec)) return;
      const u = centers[i] / L;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const n = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      if (n.dot(p.clone().sub(this.archCenter)) < 0) n.negate();
      const yAxis = new THREE.Vector3(0, up, 0);
      const xAxis = new THREE.Vector3().crossVectors(yAxis, n).normalize();
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, n);
      const { geometry, sides } = buildToothGeometry(spec, seed * 31 + i * 7 + 1);
      const mat = createEnamelMaterial(this.design.incisal[spec.kind] ?? 0.2, this.design.enamelTint);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // flare: front teeth lean outward, back teeth slightly inward
      const flare = this.design.flare[spec.kind] ?? 0;
      const tilt = new THREE.Matrix4().makeRotationX(flare + (rand() - 0.5) * 0.04);
      const twist = new THREE.Matrix4().makeRotationY((rand() - 0.5) * 0.08);
      mesh.matrix.copy(new THREE.Matrix4().makeTranslation(p.x, 0, p.z).multiply(basis).multiply(tilt).multiply(twist));
      mesh.matrixWorldNeedsUpdate = true;
      group.add(mesh);
      const vc = geometry.getAttribute('position').count;
      const tooth: Tooth = {
        index: this.teeth.length,
        jaw: which,
        spec,
        mesh,
        sides,
        dirt: (geometry.getAttribute('dirt') as THREE.BufferAttribute).array as Float32Array,
        initial: new Float32Array(vc),
        initialSum: new Float32Array(3),
        done: false,
        sideDone: [false, false, false],
        glow: 0,
      };
      mesh.userData.tooth = tooth;
      this.teeth.push(tooth);
      this.toothMeshes.push(mesh);
    });

    const gum = this.buildGum(curve, order, centers, up, arch.spacing);
    group.add(gum);
    this.gums.push(gum);
  }

  private buildGum(curve: THREE.CatmullRomCurve3, order: Slot[], centers: number[], up: number, spacing: number) {
    const L = curve.getLength();
    const extra = 5.5;
    const S = 420, P = 44;
    const bottom = -6.5;
    const pos = new Float32Array((S + 1) * P * 3 + 6);
    const gumT = new Float32Array((S + 1) * P + 2);
    const padT = new Float32Array((S + 1) * P + 2);
    const tmp = new THREE.Vector3();

    const nearestThickness = (s: number) => {
      // interpolate neck thickness between neighbouring teeth
      let best = 0, bestD = 1e9;
      for (let i = 0; i < centers.length; i++) {
        const d = Math.abs(s - centers[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      const i0 = best;
      const i1 = s > centers[i0] ? Math.min(i0 + 1, centers.length - 1) : Math.max(i0 - 1, 0);
      const span = Math.abs(centers[i1] - centers[i0]) || 1;
      const f = Math.min(1, Math.abs(s - centers[i0]) / span);
      return THREE.MathUtils.lerp(order[i0].t, order[i1].t, f) * 0.8;
    };
    /** gum margin height at arc position s, and how much of a dental pad it is */
    const crest = (s: number): [number, number] => {
      // gum margin is low at the tooth centre, high between teeth (papilla)
      let d = 1e9;
      let base = 0.45;
      // bare-gum stretches (gap / pad) rise to their own ridge height, easing down by the neighbouring teeth
      let g = 0, gh = 0, pad = 0;
      for (let i = 0; i < centers.length; i++) {
        const slot = order[i];
        const half = slot.w / 2;
        const dc = Math.abs(s - centers[i]);
        if (!isToothSlot(slot)) {
          const ramp = Math.min(4.5, half * 0.5);
          const k = 1 - THREE.MathUtils.smoothstep(dc, half - ramp, half + spacing / 2);
          if (k > g) { g = k; gh = slot.h; pad = slot.kind === 'pad' ? k : 0; }
          continue;
        }
        d = Math.min(d, Math.abs(dc - half - spacing / 2));
        if (dc < half) base = isGrinder(slot.kind) ? 0.35 : 0.5;
      }
      return [THREE.MathUtils.lerp(base + 1.7 * Math.exp(-((d / 1.15) ** 2)), gh, g), pad];
    };

    let vi = 0;
    for (let k = 0; k <= S; k++) {
      const sArc = -extra + (k / S) * (L + 2 * extra);
      const sc = THREE.MathUtils.clamp(sArc, 0, L);
      const u = sc / L;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      // extend straight beyond the ends
      if (sArc < 0) p.addScaledVector(tan, sArc);
      if (sArc > L) p.addScaledVector(tan, sArc - L);
      const n = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      if (n.dot(tmp.copy(p).sub(this.archCenter)) < 0) n.negate();
      // end rounding
      const over = sArc < 0 ? -sArc / extra : sArc > L ? (sArc - L) / extra : 0;
      const endScale = Math.sqrt(Math.max(0, 1 - over * over));
      const halfW = (nearestThickness(sc) / 2 + 1.1) * Math.max(endScale, 0.0001);
      const [top, pad] = crest(sc);
      const yc = (top + bottom) / 2;
      const hh = ((top - bottom) / 2) * Math.max(endScale, 0.0001);
      const yMid = over > 0 ? THREE.MathUtils.lerp(yc, yc - 2, over) : yc;
      for (let j = 0; j < P; j++) {
        const a = (j / P) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        const pe = sn > 0 ? 3.2 : 2.4; // flatter top shoulders
        const nn = halfW * Math.sign(c) * Math.pow(Math.abs(c), 2 / pe);
        // bulge outward a bit at the bottom (alveolar ridge shape)
        const yy = yMid + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / pe);
        const x = p.x + n.x * nn;
        const z = p.z + n.z * nn;
        pos[vi * 3] = x; pos[vi * 3 + 1] = yy * up; pos[vi * 3 + 2] = z;
        gumT[vi] = THREE.MathUtils.clamp((yy - bottom) / (top - bottom), 0, 1);
        padT[vi] = pad;
        vi++;
      }
    }
    const idx: number[] = [];
    for (let k = 0; k < S; k++) {
      for (let j = 0; j < P; j++) {
        const a = k * P + j, b = k * P + ((j + 1) % P), c = (k + 1) * P + j, d = (k + 1) * P + ((j + 1) % P);
        if (up > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, vi * 3), 3));
    g.setAttribute('gumT', new THREE.BufferAttribute(gumT.subarray(0, vi), 1));
    g.setAttribute('padT', new THREE.BufferAttribute(padT.subarray(0, vi), 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure normals point outwards; flip if the winding came out inverted
    const nrm = g.getAttribute('normal');
    const probe = Math.floor(S / 2) * P + Math.floor(P / 4); // top-ish vertex at the front
    if (nrm.getY(probe) * up < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(g, this.gumMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.userData.gum = true;
    return mesh;
  }

  /** Seed fresh plaque: a light film everywhere plus heavier deposits at the gumline, in fissures and between teeth. */
  resetDirt(seed: number) {
    const rand = rng(seed);
    for (const tooth of this.teeth) {
      const g = tooth.mesh.geometry;
      const pos = g.getAttribute('position');
      const crown = g.getAttribute('crownT');
      const { w } = tooth.spec;
      const ox = rand() * 50, oz = rand() * 50;
      tooth.initialSum.fill(0);
      for (let k = 0; k < pos.count; k++) {
        const side = tooth.sides[k];
        if (side === SIDE_NONE) { tooth.dirt[k] = 0; tooth.initial[k] = 0; continue; }
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const q = crown.getX(k);
        const gumline = Math.exp(-((q - 0.12) ** 2) / 0.02);
        const between = Math.exp(-((Math.abs(x) - w / 2) ** 2) / 1.2);
        const fissure = side === SIDE_CHEWING ? 0.5 : 0;
        const blotch = 0.5 + 0.5 * Math.sin(x * 0.9 + ox) * Math.cos(z * 1.1 + oz) * Math.sin(y * 0.7 + ox);
        const d = Math.min(1, 0.28 + 0.55 * gumline + 0.4 * between + fissure * 0.6 + 0.45 * blotch * blotch);
        tooth.dirt[k] = d;
        tooth.initial[k] = d;
        tooth.initialSum[side] += d;
      }
      (g.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true;
      tooth.done = false;
      tooth.sideDone = [false, false, false];
      tooth.glow = 0;
    }
  }

  private tmpM = new THREE.Matrix4();
  private tmpP = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private tmpNM = new THREE.Matrix3();

  /**
   * Clean around a world-space contact point. Only surfaces facing roughly the same way as the
   * contact normal are cleaned, so brushing the outside doesn't clean the inside.
   * Returns the amount of dirt removed.
   */
  clean(worldPoint: THREE.Vector3, worldNormal: THREE.Vector3, radius: number, amount: number): number {
    let removed = 0;
    for (const tooth of this.teeth) {
      const mesh = tooth.mesh;
      const sphere = mesh.geometry.boundingSphere!;
      this.tmpM.copy(mesh.matrixWorld).invert();
      const lp = this.tmpP.copy(worldPoint).applyMatrix4(this.tmpM);
      if (lp.distanceTo(sphere.center) > sphere.radius + radius) continue;
      this.tmpNM.getNormalMatrix(this.tmpM);
      const ln = this.tmpN.copy(worldNormal).applyMatrix3(this.tmpNM).normalize();
      const pos = mesh.geometry.getAttribute('position');
      const nrm = mesh.geometry.getAttribute('normal');
      let touched = false;
      const r2 = radius * radius;
      for (let k = 0; k < pos.count; k++) {
        if (tooth.dirt[k] <= 0) continue;
        const dx = pos.getX(k) - lp.x, dy = pos.getY(k) - lp.y, dz = pos.getZ(k) - lp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const facing = nrm.getX(k) * ln.x + nrm.getY(k) * ln.y + nrm.getZ(k) * ln.z;
        if (facing < -0.1) continue;
        // generous: surfaces at an angle to the brush still get cleaned a bit
        const fall = (1 - (d2 / r2) * 0.6) * Math.min(1, 0.3 + Math.max(0, facing) * 1.4);
        const before = tooth.dirt[k];
        const after = Math.max(0, before - amount * fall);
        tooth.dirt[k] = after;
        removed += before - after;
        touched = true;
      }
      if (touched) (mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true;
    }
    return removed;
  }

  /** Per-side cleanliness (0..1) for a tooth. */
  sideProgress(tooth: Tooth): SideProgress {
    const rem = [0, 0, 0];
    for (let k = 0; k < tooth.dirt.length; k++) {
      const s = tooth.sides[k];
      if (s < 3) rem[s] += tooth.dirt[k];
    }
    const f = (s: number) => (tooth.initialSum[s] > 0 ? 1 - rem[s] / tooth.initialSum[s] : 1);
    return { outer: f(SIDE_OUTER), inner: f(SIDE_INNER), chewing: f(SIDE_CHEWING), done: tooth.done };
  }

  setOpacityHidden(group: 'upper' | 'lower', hidden: boolean) {
    (group === 'upper' ? this.upper : this.lower).visible = !hidden;
  }

  /** Free GPU resources (when swapping to another animal's jaws). */
  dispose() {
    this.root.removeFromParent();
    for (const t of this.teeth) { t.mesh.geometry.dispose(); (t.mesh.material as THREE.Material).dispose(); }
    for (const g of this.gums) g.geometry.dispose();
    this.gumMat.dispose();
  }
}
