import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './jaws/toothGeometry';

export type BrushType = 'manual' | 'electric';

export interface BrushLook {
  type: BrushType;
  handle: string[]; // 1 colour = solid, 2+ = gradient along the handle
  accent: string; // rubber grip colour
  bristles: string[]; // 1 colour, or per-row colours
  sparkle?: boolean;
}

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
  }

  private add(parent: THREE.Object3D, o: THREE.Object3D) {
    parent.add(o);
    this.parts.push(o);
    o.traverse(c => { (c as THREE.Mesh).castShadow = true; });
  }

  private plastic(colors: string[], opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
    const m = new THREE.MeshPhysicalMaterial({
      color: colors.length === 1 ? colors[0] : 0xffffff,
      vertexColors: colors.length > 1,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      ...opts,
    });
    return m;
  }

  private gradientColors(g: THREE.BufferGeometry, colors: string[], axis: 'x' | 'y', min: number, max: number) {
    const pos = g.getAttribute('position');
    const arr = new Float32Array(pos.count * 3);
    const cols = colors.map(c => new THREE.Color(c));
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const v = axis === 'x' ? pos.getX(i) : pos.getY(i);
      const f = THREE.MathUtils.clamp((v - min) / (max - min), 0, 1) * (cols.length - 1);
      const i0 = Math.floor(f), i1 = Math.min(i0 + 1, cols.length - 1);
      tmp.copy(cols[i0]).lerp(cols[i1], f - i0);
      arr.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  private build() {
    this.clear();
    const L = this.look;
    const headTop = this.bristleLen; // bristle base plane
    if (L.type === 'manual') {
      // head: rounded slab
      const head = new THREE.Mesh(new RoundedBoxGeometry(21, 3.2, 9.5, 4, 1.4), this.plastic(L.handle.slice(0, 1)));
      head.position.set(0, headTop + 1.6, 0);
      this.add(this.head, head);
      // neck + handle via lathe around X, flattened in Z
      const prof: THREE.Vector2[] = [];
      const pts: [number, number][] = [
        [0, 2.2], [6, 2.0], [16, 2.6], [30, 3.8], [45, 5.2], [60, 5.8], [75, 5.4], [90, 5.9], [105, 6.3], [115, 5.6], [119, 3.5], [120, 0.01],
      ];
      for (const [x, r] of pts) prof.push(new THREE.Vector2(r, x));
      const lathe = new THREE.LatheGeometry(prof, 28);
      lathe.rotateZ(-Math.PI / 2); // lathe axis Y → X
      lathe.scale(1, 0.62, 1);
      if (L.handle.length > 1) this.gradientColors(lathe, L.handle, 'x', 10, 120);
      const handle = new THREE.Mesh(lathe, this.plastic(L.handle));
      this.handleMat = handle.material as THREE.MeshPhysicalMaterial;
      handle.position.set(9.5, headTop + 1.8, 0);
      handle.rotation.z = 0.12; // classic angled neck
      this.add(this.group, handle);
      // rubber grip inserts
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 26, 6, 16), new THREE.MeshPhysicalMaterial({ color: L.accent, roughness: 0.75, sheen: 0.4, sheenColor: new THREE.Color(L.accent) }));
      grip.rotation.z = Math.PI / 2;
      grip.scale.set(1, 1, 0.5);
      grip.position.set(9.5 + 62 * Math.cos(0.12), headTop + 1.8 + 62 * Math.sin(0.12) + 3.4, 0);
      grip.rotation.set(0, 0, Math.PI / 2 + 0.12);
      this.add(this.group, grip);
      const thumb = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), grip.material);
      thumb.scale.set(1.8, 0.45, 1);
      thumb.position.set(9.5 + 28 * Math.cos(0.12), headTop + 1.8 + 28 * Math.sin(0.12) + 3.6, 0);
      this.add(this.group, thumb);
      this.buildBristles('rect');
    } else {
      // electric: round oscillating head on a slim neck + chunky body
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 3, 40), this.plastic(['#f4f6f8']));
      disc.position.set(0, headTop + 1.5, 0);
      this.add(this.head, disc);
      const neckProf: [number, number][] = [[0, 3.0], [8, 2.6], [30, 3.2], [45, 5.0], [52, 9.5], [60, 11], [110, 11.5], [150, 11], [158, 8], [160, 0.01]];
      const lathe = new THREE.LatheGeometry(neckProf.map(([x, r]) => new THREE.Vector2(r, x)), 36);
      lathe.rotateZ(-Math.PI / 2);
      lathe.scale(1, 0.92, 1);
      const colors = ['#f4f6f8', '#f4f6f8', ...L.handle];
      this.gradientColors(lathe, colors, 'x', 40, 160);
      const body = new THREE.Mesh(lathe, this.plastic(colors));
      this.handleMat = body.material as THREE.MeshPhysicalMaterial;
      body.position.set(4, headTop + 2.6, 0);
      body.rotation.z = 0.06;
      this.add(this.group, body);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.6, 28), new THREE.MeshPhysicalMaterial({ color: L.accent, roughness: 0.6 }));
      btn.position.set(4 + 75, headTop + 2.6 + 75 * 0.06 + 10.2, 0);
      this.add(this.group, btn);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: '#7cf3ff' }));
      led.position.set(4 + 95, headTop + 2.6 + 95 * 0.06 + 10.4, 0);
      this.add(this.group, led);
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
    if (this.handleMat && this.look.sparkle) {
      this.handleMat.emissive.setHSL((this.t * 0.1) % 1, 0.7, 0.08);
    }
  }
}
