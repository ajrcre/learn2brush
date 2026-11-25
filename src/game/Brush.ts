import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './jaws/toothGeometry';
import { createPatternMaterial, addGlitter, setPattern, type PatternId } from './patterns';
import { buildShape, type ShapeId } from './brushShapes';

export type BrushType = 'manual' | 'electric';

export interface BrushLook {
  type: BrushType;
  handle: string[]; // pattern colours (1 colour = solid)
  accent: string; // grip / fins / plates colour
  bristles: string[]; // 1 colour, or per-row colours
  /** legacy shimmer for items whose sparkle upgrade is still in review */
  sparkle?: boolean;
  pattern?: PatternId;
  /** 0..1 real glitter flakes on the handle */
  glitter?: number;
  shape?: ShapeId;
  /** head colour (defaults to the first handle colour) */
  head?: string;
  bristleGlitter?: number;
  bristleGlow?: number;
}

type Profile = [number, number][];
const MANUAL_PROFILE: Profile = [[0, 2.2], [6, 2.0], [16, 2.6], [30, 3.8], [45, 5.2], [60, 5.8], [75, 5.4], [90, 5.9], [105, 6.3], [115, 5.6], [119, 3.5], [120, 0.01]];
const ELECTRIC_PROFILE: Profile = [[0, 3.0], [8, 2.6], [30, 3.2], [45, 5.0], [52, 9.5], [60, 11], [110, 11.5], [150, 11], [158, 8], [160, 0.01]];
const radiusFn = (prof: Profile) => (x: number) => {
  if (x <= prof[0][0]) return prof[0][1];
  for (let i = 1; i < prof.length; i++) {
    if (x <= prof[i][0]) {
      const [x0, r0] = prof[i - 1], [x1, r1] = prof[i];
      return r0 + ((x - x0) / (x1 - x0)) * (r1 - r0);
    }
  }
  return prof[prof.length - 1][1];
};

/**
 * Procedural toothbrush. Local frame: bristle tips centred at the origin, bristles point to −Y
 * (into the tooth), handle extends along +X.
 */
export class Brush {
  readonly group = new THREE.Group();
  /** rotates around Y for the electric head oscillation */
  readonly head = new THREE.Group();
  /** toothpaste attaches here: sits on top of bristle tips (+Y is away from tooth when brushing, so paste sits at −Y tips) */
  readonly pasteAnchor = new THREE.Group();
  readonly bristleLen = 9;
  look: BrushLook;
  private parts: THREE.Object3D[] = [];
  private handleMat?: THREE.MeshPhysicalMaterial;
  private timeUniforms: { value: number }[] = [];
  private shapeUpdate?: (t: number) => void;
  private t = 0;

  constructor(look: BrushLook) {
    this.look = look;
    this.group.add(this.head);
    this.build();
  }

  setLook(look: BrushLook) {
    this.look = look;
    this.build();
  }

  private clear() {
    for (const p of this.parts) {
      p.removeFromParent();
      p.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
    }
    this.parts = [];
    this.timeUniforms = [];
    this.shapeUpdate = undefined;
  }

  private add(parent: THREE.Object3D, o: THREE.Object3D) {
    parent.add(o);
    this.parts.push(o);
    o.traverse(c => {
      (c as THREE.Mesh).castShadow = true;
      const mat = (c as THREE.Mesh).material as THREE.Material | undefined;
      const u = mat?.userData;
      if (u?.uniforms?.uTime) this.timeUniforms.push(u.uniforms.uTime);
      if (u?.glitter?.uTime) this.timeUniforms.push(u.glitter.uTime);
    });
  }

  private plastic(color: string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, ...opts });
  }

  /** Handle: lathe body + pattern material + shape add-ons. */
  private buildHandle(profile: Profile, segments: number, ySquash: number, at: THREE.Vector3, tilt: number) {
    const L = this.look;
    const length = profile[profile.length - 1][0];
    const shape = L.shape ?? 'classic';
    const pattern = L.pattern ?? (L.handle.length > 1 ? 'gradient' : 'solid');
    const mat = createPatternMaterial({ pattern, colors: L.handle, glitter: L.glitter ?? 0, length });
    const info = { length, radius: radiusFn(profile), ySquash, material: mat, accent: L.accent };
    const parts = buildShape(shape, info);
    mat.userData.uniforms.uBladeEnd.value = parts.bladeEnd ?? 0;
    if (parts.pattern) setPattern(mat, parts.pattern.pattern, parts.pattern.colors);
    const geo = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(r, x)), segments);
    geo.rotateZ(-Math.PI / 2); // lathe axis Y → X
    geo.scale(1, ySquash, 1);
    const handle = new THREE.Mesh(geo, mat);
    handle.position.copy(at);
    handle.rotation.z = tilt;
    this.handleMat = mat;
    for (const o of parts.objects) handle.add(o);
    this.add(this.group, handle);
    for (const o of parts.headObjects ?? []) this.add(this.head, o);
    this.shapeUpdate = parts.update;
    return { handle, shape };
  }

  private build() {
    this.clear();
    const L = this.look;
    const headTop = this.bristleLen; // bristle base plane
    const headColor = L.shape === 'dino' ? '#2e7d32' : (L.head ?? L.handle[0]);
    if (L.type === 'manual') {
      const head = new THREE.Mesh(new RoundedBoxGeometry(21, 3.2, 9.5, 4, 1.4), this.plastic(headColor));
      head.position.set(0, headTop + 1.6, 0);
      this.add(this.head, head);
      const { shape } = this.buildHandle(MANUAL_PROFILE, 28, 0.62, new THREE.Vector3(9.5, headTop + 1.8, 0), 0.12);
      if (shape === 'classic') {
        // rubber grip inserts
        const gm = new THREE.MeshPhysicalMaterial({ color: L.accent, roughness: 0.75, sheen: 0.4, sheenColor: new THREE.Color(L.accent) });
        const grip = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 26, 6, 16), gm);
        grip.scale.set(1, 1, 0.5);
        grip.position.set(9.5 + 62 * Math.cos(0.12), headTop + 1.8 + 62 * Math.sin(0.12) + 3.4, 0);
        grip.rotation.set(0, 0, Math.PI / 2 + 0.12);
        this.add(this.group, grip);
        const thumb = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), gm);
        thumb.scale.set(1.8, 0.45, 1);
        thumb.position.set(9.5 + 28 * Math.cos(0.12), headTop + 1.8 + 28 * Math.sin(0.12) + 3.6, 0);
        this.add(this.group, thumb);
      }
      this.buildBristles('rect');
    } else {
      // electric: round oscillating head on a slim neck + chunky body
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 3, 40), this.plastic('#f4f6f8'));
      disc.position.set(0, headTop + 1.5, 0);
      this.add(this.head, disc);
      const { handle, shape } = this.buildHandle(ELECTRIC_PROFILE, 36, 0.92, new THREE.Vector3(4, headTop + 2.6, 0), 0.06);
      if (shape === 'classic' || shape === 'dino' || shape === 'wand') {
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.6, 28), new THREE.MeshPhysicalMaterial({ color: L.accent, roughness: 0.6 }));
        btn.position.set(75, 10.4, 0);
        handle.add(btn);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: '#7cf3ff' }));
        led.position.set(95, 10.6, 0);
        handle.add(led);
      }
      this.buildBristles('round');
    }
    this.group.add(this.pasteAnchor);
    this.pasteAnchor.position.set(0, 0, 0);
  }

  /** Thin fibres grouped in tufts: InstancedMesh, so it's cheap but reads as real bristles. */
  private buildBristles(shape: 'rect' | 'round') {
    const L = this.look;
    const rand = rng(42);
    const tufts: { x: number; z: number; row: number }[] = [];
    if (shape === 'rect') {
      const rows = 4, cols = 10;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) tufts.push({ x: -8.6 + (c * 17.2) / (cols - 1), z: -3.3 + (r * 6.6) / (rows - 1), row: r === 0 || r === rows - 1 ? 0 : 1 });
    } else {
      tufts.push({ x: 0, z: 0, row: 1 });
      for (const [ring, n] of [[2.4, 7], [4.4, 13]] as const)
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          tufts.push({ x: Math.cos(a) * ring, z: Math.sin(a) * ring, row: ring > 3 ? 0 : 1 });
        }
    }
    const perTuft = 14;
    const fiber = new THREE.CylinderGeometry(0.13, 0.15, 1, 5, 1, false);
    fiber.translate(0, 0.5, 0);
    // rounded tip
    const tip = new THREE.SphereGeometry(0.13, 5, 3);
    const fiberGeo = mergeGeometries([fiber, tip.translate(0, 0, 0)])!;
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, clearcoat: 0.4, transmission: 0, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) });
    if (L.bristleGlitter || L.bristleGlow) addGlitter(mat, L.bristleGlitter ?? 0, 3, true, L.bristleGlow ?? 0);
    const count = tufts.length * perTuft;
    const inst = new THREE.InstancedMesh(fiberGeo, mat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    const palette = L.bristles.map(c => new THREE.Color(c));
    let k = 0;
    tufts.forEach((tf, ti) => {
      for (let f = 0; f < perTuft; f++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.55;
        const x = tf.x + Math.cos(a) * r, z = tf.z + Math.sin(a) * r;
        const len = this.bristleLen * (0.94 + rand() * 0.08) * (shape === 'rect' && tf.row === 0 ? 0.96 : 1);
        e.set((rand() - 0.5) * 0.08 + (z - tf.z) * 0.05, 0, (rand() - 0.5) * 0.08 - (x - tf.x) * 0.05);
        q.setFromEuler(e);
        // fibres hang from the head (y = bristleLen) down to tips at y ≈ 0
        m4.compose(new THREE.Vector3(x, this.bristleLen - len, z), q, new THREE.Vector3(1, len, 1));
        inst.setMatrixAt(k, m4);
        if (palette.length === 1) col.copy(palette[0]);
        else if (palette.length === 2) col.copy(palette[tf.row === 0 ? 1 : 0]);
        else col.copy(palette[ti % palette.length]);
        col.offsetHSL(0, 0, (rand() - 0.5) * 0.06);
        inst.setColorAt(k, col);
        k++;
      }
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.add(this.head, inst);
  }

  /** Animate: electric head oscillation or manual idle wobble. `active` = brushing contact. */
  update(dt: number, active: boolean) {
    this.t += dt;
    if (this.look.type === 'electric') {
      const amp = active ? 0.45 : 0.25;
      this.head.rotation.y = Math.sin(this.t * 2 * Math.PI * 18) * amp;
    } else {
      this.head.rotation.y = 0;
    }
    for (const u of this.timeUniforms) u.value = this.t;
    this.shapeUpdate?.(this.t);
    if (this.handleMat && this.look.sparkle && !this.look.glitter) {
      this.handleMat.emissive.setHSL((this.t * 0.1) % 1, 0.7, 0.08);
    }
  }
}
