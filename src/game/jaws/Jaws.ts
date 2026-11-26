import * as THREE from 'three';
import { buildToothGeometry, rng, SIDE_CHEWING, SIDE_INNER, SIDE_NONE, SIDE_OUTER, type ToothKind, type ToothSpec } from './toothGeometry';
import { createEnamelMaterial, createGumMaterial } from '../materials';
import { speciesFor, type Species } from './species';
import { buildAlligatorHead, buildGoatHead, buildLionHead, buildVenomHead } from './heads';
import { Tongue } from './tongue';

/** how strongly the biting edge looks translucent */
const INCISAL: Partial<Record<ToothKind, number>> = { incisor: 1, canine: 0.6, fang: 0.7, cone: 0.6, blade: 0.8 };
/** natural lean: front teeth tip outwards, cheek teeth slightly in */
const FLARE: Record<ToothKind, number> = { incisor: 0.2, canine: 0.12, molar: -0.04, fang: 0.06, cone: 0.1, blade: 0.04, carnassial: -0.02, grinder: -0.05 };

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

function makeArch(points: [number, number][], totalLen: number, widen: number, zShift: number) {
  const pts = points.map(([x, z]) => new THREE.Vector3(x * widen, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const scale = totalLen / curve.getLength();
  const scaled = new THREE.CatmullRomCurve3(pts.map(p => p.clone().multiplyScalar(scale).add(new THREE.Vector3(0, 0, zShift))), false, 'centripetal');
  scaled.arcLengthDivisions = 800;
  return scaled;
}

/** Outward (cheek/lip side) direction at a point of the arch. The arch runs right back → front → left back. */
function outward(tan: THREE.Vector3) {
  return new THREE.Vector3(-tan.z, 0, tan.x).normalize();
}

/** A full set of upper and lower teeth with gums, built from a species description. */
export class Jaws {
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly teeth: Tooth[] = [];
  readonly gums: THREE.Mesh[] = [];
  readonly toothMeshes: THREE.Mesh[] = [];
  readonly species: Species;
  readonly gumMat: THREE.MeshPhysicalMaterial;
  /** head parts: they hide what's behind them but can't be brushed */
  readonly occluders: THREE.Mesh[] = [];
  private arches: Partial<Record<'upper' | 'lower', THREE.CatmullRomCurve3>> = {};

  constructor(speciesId = 'jaw_human', seed = 7) {
    this.species = speciesFor(speciesId);
    this.gumMat = createGumMaterial(this.species.gum);
    this.root.add(this.upper, this.lower);
    this.buildJaw('upper', this.species.upper, seed);
    this.buildJaw('lower', this.species.lower, seed + 101);
    if (this.species.head) {
      const build = { alligator: buildAlligatorHead, goat: buildGoatHead, lion: buildLionHead, venom: buildVenomHead }[this.species.head];
      this.occluders.push(...build({ curve: this.arches.upper!, group: this.upper, away: 1 }, { curve: this.arches.lower!, group: this.lower, away: -1 }, this.species.open));
    }
    if (this.species.tongue) this.tongue = this.buildTongue();
    this.upper.position.y = this.species.open;
    this.lower.position.y = -this.species.open;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    this.depth = box.max.z - box.min.z;
    this.midY = (box.max.y + box.min.y) / 2;
  }

  /** a long tongue that comes out when nobody is brushing (not a tap target, never cleaned) */
  readonly tongue?: Tongue;

  /** Lay the tongue along the middle of the bottom jaw, leaving between the front teeth. */
  private buildTongue() {
    const sp = this.species;
    const lowerArch = this.arches.lower!;
    // tips of the front teeth: bottom ones (lower group space) and top ones (moved into lower group space)
    const tipY = (jaw: 'upper' | 'lower') => {
      const front = this.teeth.filter(t => t.jaw === jaw).sort((a, b) => b.mesh.matrix.elements[14] - a.mesh.matrix.elements[14]).slice(0, 4);
      const box = new THREE.Box3();
      for (const t of front) { t.mesh.geometry.computeBoundingBox(); box.union(t.mesh.geometry.boundingBox!.clone().applyMatrix4(t.mesh.matrix)); }
      return jaw === 'lower' ? box.max.y : box.min.y + 2 * sp.open;
    };
    const lipY = (tipY('lower') + tipY('upper')) / 2;
    return new Tongue({
      lower: this.lower,
      open: sp.open,
      backZ: lowerArch.getPointAt(0).z,
      frontZ: lowerArch.getPointAt(0.5).z + sp.lower[0].t / 2,
      lipY,
      floor: 2.6,
    });
  }

  /** Per-frame animation (the tongue). `tongueOut`: let it slither out (it hides while teeth are being brushed). */
  update(dt: number, tongueOut: boolean) {
    this.tongue?.update(dt, tongueOut);
  }

  /** front-to-back size of the arch (mm), for framing the top and bottom views */
  readonly depth: number;
  /** height of the middle of everything (a head can reach much further up than down) */
  readonly midY: number;

  get id() { return this.species.id; }

  private buildJaw(which: 'upper' | 'lower', half: ToothSpec[], seed: number) {
    const sp = this.species;
    const group = which === 'upper' ? this.upper : this.lower;
    const up = which === 'upper' ? -1 : 1; // crown direction
    // full arch order: patient's right back → midline → left back
    const order: ToothSpec[] = [...half.slice().reverse(), ...half];
    const widths = order.map(s => s.w);
    const total = widths.reduce((a, b) => a + b, 0) + sp.gap * (order.length - 1);
    const curve = makeArch(sp.arch, total, which === 'upper' ? 1.0 : sp.lowerWiden, sp.zShift);
    this.arches[which] = curve;
    const L = curve.getLength();
    const centers: number[] = [];
    let s = 0;
    for (let i = 0; i < order.length; i++) {
      centers.push(s + widths[i] / 2);
      s += widths[i] + sp.gap;
    }

    const rand = rng(seed);
    order.forEach((spec, i) => {
      if (spec.gap) return;
      const u = centers[i] / L;
      const p = curve.getPointAt(u);
      const n = outward(curve.getTangentAt(u));
      const yAxis = new THREE.Vector3(0, up, 0);
      const xAxis = new THREE.Vector3().crossVectors(yAxis, n).normalize();
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, n);
      const { geometry, sides } = buildToothGeometry(spec, seed * 31 + i * 7 + 1);
      const mat = createEnamelMaterial(INCISAL[spec.kind] ?? 0.2, sp.enamel);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // flare: incisors lean outward, molars slightly inward
      const flare = FLARE[spec.kind] + (spec.lean ?? 0);
      const tilt = new THREE.Matrix4().makeRotationX(flare + (rand() - 0.5) * 0.04);
      const twist = new THREE.Matrix4().makeRotationY((rand() - 0.5) * 0.08);
      mesh.matrix.copy(new THREE.Matrix4().makeTranslation(p.x, 0, p.z).multiply(basis).multiply(tilt).multiply(twist));
      mesh.matrixWorldNeedsUpdate = true;
      group.add(mesh);
      if (sp.spareRow) group.add(this.spareTooth(spec, mesh.matrix, mat, seed * 13 + i));
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

    const gum = this.buildGum(curve, order, centers, up);
    group.add(gum);
    this.gums.push(gum);
  }

  /** A smaller replacement tooth lying folded back inside the gum, behind a front tooth (just for show). */
  private spareTooth(spec: ToothSpec, front: THREE.Matrix4, mat: THREE.Material, seed: number) {
    const { geometry } = buildToothGeometry({ ...spec, w: spec.w * 0.78, h: spec.h * 0.72 }, seed);
    const m = new THREE.Mesh(geometry, mat);
    m.matrixAutoUpdate = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrix.copy(front).multiply(new THREE.Matrix4().makeTranslation(0, -1.2, -spec.t / 2 - 2.6)).multiply(new THREE.Matrix4().makeRotationX(-1.15));
    m.userData.spare = true;
    return m;
  }

  /** Free GPU memory when the jaws are swapped for another animal. */
  dispose() {
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.root.removeFromParent();
  }

  private buildGum(curve: THREE.CatmullRomCurve3, order: ToothSpec[], centers: number[], up: number) {
    const L = curve.getLength();
    const extra = 5.5;
    const S = 420, P = 44;
    const bottom = -this.species.gumDepth;
    const gapW = this.species.gap;
    const pos = new Float32Array((S + 1) * P * 3 + 6);
    const gumT = new Float32Array((S + 1) * P + 2);
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
    const crest = (s: number) => {
      // gum margin is low at the tooth centre, high between teeth (papilla)
      let d = 1e9;
      let base = 0.45;
      let pad = 0;
      for (let i = 0; i < centers.length; i++) {
        const half = order[i].w / 2;
        const inside = Math.abs(s - centers[i]) < half;
        if (order[i].gap) {
          // toothless stretch: low smooth gum, or a raised pad (goat) that blends into its neighbours
          if (inside) base = 0.3;
          if (order[i].pad) pad = Math.max(pad, order[i].pad! * (1 - THREE.MathUtils.smoothstep(Math.abs(s - centers[i]), half - 2, half + 2)));
          continue;
        }
        d = Math.min(d, Math.abs(Math.abs(s - centers[i]) - half - gapW / 2));
        if (inside) base = order[i].kind === 'molar' || order[i].kind === 'grinder' ? 0.35 : 0.5;
      }
      return Math.max(base, pad) + 1.7 * Math.exp(-((d / 1.15) ** 2));
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
      const n = outward(tan);
      // end rounding
      const over = sArc < 0 ? -sArc / extra : sArc > L ? (sArc - L) / extra : 0;
      const endScale = Math.sqrt(Math.max(0, 1 - over * over));
      const halfW = (nearestThickness(sc) / 2 + this.species.gumWidth) * Math.max(endScale, 0.0001);
      const top = crest(sc);
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
}
