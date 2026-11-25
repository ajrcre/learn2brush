import * as THREE from 'three';
import { NOISE_GLSL } from './materials';

export interface PasteLook {
  colors: string[]; // 1 = solid, 3 = striped (base + 2 stripes)
  sparkle?: boolean;
}

/** Toothpaste ribbon sitting on the bristle tips. Grows with `amount` (0..1.3, 0.35–0.65 ≈ pea-size). */
export class Paste {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshPhysicalMaterial;
  look: PasteLook;
  amount = 0;
  /** how much paste remains during brushing (1 → 0) */
  remaining = 1;
  private uniforms = { uTime: { value: 0 }, uSparkle: { value: 0 } };
  private builtFor = -1;

  constructor(look: PasteLook) {
    this.look = look;
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.32,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      sheen: 0.5,
      sheenColor: new THREE.Color(0xffffff),
    });
    this.material.customProgramCacheKey = () => 'l2b-paste';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uSparkle; varying vec3 vObjPos;\n${NOISE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uSparkle > 0.5) {
  float g = l2b_noise(vObjPos * 6.0 + vec3(0.0, uTime * 0.6, 0.0));
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.8) * smoothstep(0.86, 0.95, g) * 2.5;
}`);
    };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.castShadow = true;
    this.setLook(look);
  }

  setLook(look: PasteLook) {
    this.look = look;
    this.uniforms.uSparkle.value = look.sparkle ? 1 : 0;
    this.builtFor = -1;
    this.rebuild();
  }

  setAmount(a: number) {
    this.amount = a;
    this.rebuild();
  }

  private rebuild() {
    const visible = this.amount * this.remaining;
    const key = Math.round(visible * 200);
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.mesh.visible = visible > 0.01;
    if (!this.mesh.visible) return;
    const len = 2 + visible * 15; // mm along the head
    const radius = 1.9 + Math.min(visible, 1) * 0.5;
    const pts: THREE.Vector3[] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = 8.5 - f * len; // starts at the head tip, runs towards the handle
      pts.push(new THREE.Vector3(x, -radius * 0.75 - Math.sin(f * Math.PI) * 0.4, Math.sin(f * Math.PI * 3) * 1.1 * Math.min(1, visible * 2)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 64, radius, 20, false);
    // swirl ridges + rounded end caps by tapering the radius near the ends
    const pos = tube.getAttribute('position');
    const tmp = new THREE.Vector3();
    const P = new THREE.Vector3();
    const colors = new Float32Array(pos.count * 3);
    const cols = this.look.colors.map(c => new THREE.Color(c));
    const ringVerts = 21;
    for (let i = 0; i < pos.count; i++) {
      const seg = Math.floor(i / ringVerts);
      const j = i % ringVerts;
      const f = seg / 64;
      curve.getPointAt(f, P);
      tmp.fromBufferAttribute(pos, i).sub(P);
      const ang = (j / (ringVerts - 1)) * Math.PI * 2;
      const twist = ang + f * len * 0.9;
      const ridge = 1 + 0.07 * Math.cos(twist * 4);
      const e = Math.min(f, 1 - f) / 0.12;
      const cap = e >= 1 ? 1 : Math.sqrt(Math.max(0.02, Math.sin(e * Math.PI * 0.5)));
      const tipNarrow = f > 0.85 ? 1 - (f - 0.85) * 2.2 : 1;
      tmp.multiplyScalar(ridge * cap * tipNarrow);
      pos.setXYZ(i, P.x + tmp.x, P.y + tmp.y, P.z + tmp.z);
      let c = cols[0];
      if (cols.length >= 3) {
        const stripe = Math.sin(twist * 3);
        if (stripe > 0.55) c = cols[1];
        else if (stripe < -0.55) c = cols[2];
      }
      colors.set([c.r, c.g, c.b], i * 3);
    }
    tube.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tube.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = tube;
  }

  /** Use paste while brushing; returns how much foam it can make (0..1). */
  consume(dt: number, rate: number) {
    if (this.remaining <= 0) return 0.25;
    this.remaining = Math.max(0, this.remaining - dt * rate);
    this.rebuild();
    return 0.3 + 0.7 * Math.min(1, this.amount);
  }

  update(dt: number) {
    this.uniforms.uTime.value += dt;
  }
}

/** A friendly toothpaste tube for the squeeze step. */
export function createTube(color: string) {
  const g = new THREE.Group();
  const prof: [number, number][] = [[0, 0.01], [0.5, 2.6], [3, 3.4], [5, 5.8], [8, 9.5], [12, 10.5], [60, 11], [66, 10.8]];
  const lathe = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 40);
  // flatten the far end like a crimped tube
  const pos = lathe.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = THREE.MathUtils.smoothstep(y, 20, 66);
    pos.setZ(i, pos.getZ(i) * (1 - 0.85 * f));
    pos.setX(i, pos.getX(i) * (1 + 0.35 * f));
  }
  lathe.computeVertexNormals();
  const body = new THREE.Mesh(lathe, new THREE.MeshPhysicalMaterial({ color: '#f7f9fb', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 }));
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(11.1, 10.9, 14, 40, 1, true), new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.8 }));
  band.position.y = 24;
  band.scale.z = 0.86;
  g.add(band);
  const crimp = new THREE.Mesh(new THREE.BoxGeometry(31, 4, 3.4), new THREE.MeshPhysicalMaterial({ color: '#e8ecef', roughness: 0.4 }));
  crimp.position.y = 67;
  g.add(crimp);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 4, 24), body.material);
  nozzle.position.y = -1.2;
  g.add(nozzle);
  g.traverse(o => { (o as THREE.Mesh).castShadow = true; });
  return { group: g, band };
}
