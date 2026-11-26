import * as THREE from 'three';
import type { Jaws, Tooth } from './jaws/Jaws';
import { rng, SIDE_NONE } from './jaws/toothGeometry';

const COLORS = ['#7ad83b', '#b45cf0', '#2fc4b2', '#ff7a3d'];
/** big enough to spot on a phone */
const BUG_SCALE = 1.7;

interface Bug {
  group: THREE.Group;
  body: THREE.Mesh;
  eyes: THREE.Group;
  tooth: Tooth;
  normal: THREE.Vector3; // tooth-local
  alive: boolean;
  popT: number;
  seed: number;
}

/** Shared geometry/materials so many bugs stay cheap. */
const bodyGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1.7, 3);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    // soft fuzzy bumps
    const bump = 1 + 0.12 * Math.sin(n.x * 9) * Math.sin(n.y * 8) * Math.sin(n.z * 10);
    v.multiplyScalar(bump);
    v.y *= 0.85;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
})();
const eyeWhite = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1 });
const pupil = new THREE.MeshBasicMaterial({ color: '#1a1a24' });
const eyeGeo = new THREE.SphereGeometry(0.55, 16, 12);
const pupilGeo = new THREE.SphereGeometry(0.3, 12, 10);
const hornGeo = new THREE.ConeGeometry(0.28, 0.9, 10);

function makeBug(color: string) {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.6, sheen: 1, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.25), emissive: color, emissiveIntensity: 0.12 });
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 1.4;
  body.castShadow = true;
  group.add(body);
  const eyes = new THREE.Group();
  for (const x of [-0.6, 0.6]) {
    const e = new THREE.Mesh(eyeGeo, eyeWhite);
    e.position.set(x, 0.35, 1.2);
    const p = new THREE.Mesh(pupilGeo, pupil);
    p.position.set(0, 0, 0.36);
    e.add(p);
    eyes.add(e);
  }
  for (const x of [-0.7, 0.7]) {
    const h = new THREE.Mesh(hornGeo, mat);
    h.position.set(x, 1.45, 0);
    h.rotation.z = -x * 0.5;
    body.add(h);
  }
  body.add(eyes);
  return { group, body, eyes };
}

/**
 * Cute "sugar bugs" hiding in the plaque. They wiggle, blink and peek at the camera;
 * brushing over one pops it for a bonus star.
 */
export class SugarBugs {
  private bugs: Bug[] = [];
  private t = 0;
  onPopped?: (worldPos: THREE.Vector3) => void;

  get remaining() { return this.bugs.filter(b => b.alive).length; }
  get total() { return this.bugs.length; }
  /** Live bugs, for helper-arrow hints. */
  live() { return this.bugs.filter(b => b.alive); }

  reset(jaws: Jaws, seed: number, count = 6) {
    for (const b of this.bugs) b.group.removeFromParent();
    this.bugs = [];
    const r = rng(seed);
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      let ti = Math.floor(r() * jaws.teeth.length);
      while (used.has(ti)) ti = (ti + 1) % jaws.teeth.length;
      used.add(ti);
      const tooth = jaws.teeth[ti];
      const side = i % 3; // spread bugs over outer / inner / chewing sides
      const pos = tooth.mesh.geometry.getAttribute('position');
      const nrm = tooth.mesh.geometry.getAttribute('normal');
      // pick a dirty vertex on that side, around mid-crown
      let best = -1, bestScore = -1;
      for (let k = 0; k < pos.count; k++) {
        if (tooth.sides[k] !== side || tooth.sides[k] === SIDE_NONE) continue;
        const score = tooth.dirt[k] + r() * 0.3 - Math.abs(pos.getY(k) / tooth.spec.h - 0.55);
        if (score > bestScore) { bestScore = score; best = k; }
      }
      if (best < 0) continue;
      const p = new THREE.Vector3().fromBufferAttribute(pos, best);
      const n = new THREE.Vector3().fromBufferAttribute(nrm, best).normalize();
      const { group, body, eyes } = makeBug(COLORS[i % COLORS.length]);
      group.position.copy(p).addScaledVector(n, 0.2);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      group.scale.setScalar(0.001);
      tooth.mesh.add(group);
      this.bugs.push({ group, body, eyes, tooth, normal: n, alive: true, popT: 0, seed: r() * 10 });
    }
  }

  private wp = new THREE.Vector3();

  /** Brush contact in world space; returns how many bugs popped. */
  brush(worldPoint: THREE.Vector3, radius: number): number {
    let n = 0;
    for (const b of this.bugs) {
      if (!b.alive) continue;
      b.body.getWorldPosition(this.wp);
      if (this.wp.distanceTo(worldPoint) > radius) continue;
      b.alive = false;
      b.popT = 0;
      this.onPopped?.(this.wp.clone());
      n++;
    }
    return n;
  }

  /** Remove any bugs left (end of round). */
  clear() {
    for (const b of this.bugs) if (b.alive) { b.alive = false; b.popT = 0; }
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    const camLocal = new THREE.Vector3();
    for (const b of this.bugs) {
      if (b.alive) {
        const grow = Math.min(BUG_SCALE, b.group.scale.x + dt * 4);
        b.group.scale.setScalar(grow);
        const w = this.t * 7 + b.seed;
        b.body.scale.set(1 + 0.08 * Math.sin(w), 1 - 0.1 * Math.sin(w), 1 + 0.08 * Math.sin(w));
        b.body.position.y = 1.4 + 0.25 * Math.abs(Math.sin(w * 0.5));
        // turn to peek at the viewer
        camLocal.copy(camera.position);
        b.group.worldToLocal(camLocal);
        b.body.rotation.y = THREE.MathUtils.lerp(b.body.rotation.y, Math.atan2(camLocal.x, camLocal.z), 1 - Math.exp(-5 * dt));
        // blink now and then
        const blink = (Math.sin(this.t * 1.3 + b.seed * 3) > 0.985) ? 0.15 : 1;
        b.eyes.scale.y = blink;
      } else if (b.group.parent) {
        // pop: quick swell then vanish
        b.popT += dt;
        const f = b.popT / 0.25;
        b.group.scale.setScalar(BUG_SCALE * (f < 0.4 ? 1 + f : Math.max(0, 1.4 * (1 - (f - 0.4) / 0.6))));
        if (f >= 1) b.group.removeFromParent();
      }
    }
  }
}
