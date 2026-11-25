import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addGlitter } from './patterns';

export type ShapeId = 'classic' | 'sword' | 'rocket' | 'dino' | 'shark' | 'wand' | 'unicorn' | 'blocky';

/** Where things can be attached: handle-local space, X along the handle (0 = neck, length = end), +Y = back of the handle. */
export interface HandleInfo {
  length: number;
  /** half-width (z) of the handle at x */
  radius: (x: number) => number;
  /** handle cross-section is squashed in Y by this factor */
  ySquash: number;
  material: THREE.Material;
  accent: string;
}

export interface ShapeParts {
  objects: THREE.Object3D[];
  update?: (t: number) => void;
  /** sword: x below this renders as a metal blade */
  bladeEnd?: number;
  /** replaces the handle geometry (blocky) */
  handleGeometry?: THREE.BufferGeometry;
}

const gold = () => {
  const m = new THREE.MeshPhysicalMaterial({ color: '#f2c14e', metalness: 1, roughness: 0.25, clearcoat: 0.6 });
  addGlitter(m, 0.5, 1.4);
  return m;
};
const glossy = (color: string, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, ...extra });

function extruded(shape: THREE.Shape, depth: number, bevel = 0.5) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** Point on the handle surface at x, angle θ (0 = top/back, π/2 = side +z). */
function surface(h: HandleInfo, x: number, theta: number, inset = 0.3) {
  const r = h.radius(x);
  const y = Math.cos(theta) * r * h.ySquash;
  const z = Math.sin(theta) * r;
  const d = Math.hypot(y, z);
  const k = Math.max(0, d - inset) / (d || 1);
  return new THREE.Vector3(x, y * k, z * k);
}

function star(outer: number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

export function buildShape(shape: ShapeId, h: HandleInfo): ShapeParts {
  const L = h.length;
  const objects: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D) => { objects.push(o); o.traverse(c => { (c as THREE.Mesh).castShadow = true; }); return o; };

  switch (shape) {
    case 'classic': return { objects };

    case 'sword': {
      const bladeEnd = L * 0.42;
      const gm = gold();
      // flat double-edged blade around the neck
      const bl = new THREE.Shape();
      bl.moveTo(-4, 0); bl.lineTo(2, 4.6); bl.lineTo(bladeEnd, 5.6); bl.lineTo(bladeEnd, -5.6); bl.lineTo(2, -4.6); bl.closePath();
      const bladeGeo = new THREE.ExtrudeGeometry(bl, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 1.1, bevelSegments: 2 });
      bladeGeo.translate(0, 0, -0.8);
      bladeGeo.rotateX(Math.PI / 2); // lie flat: width along z
      const blade = new THREE.Mesh(bladeGeo, new THREE.MeshPhysicalMaterial({ color: '#dfe5ec', metalness: 1, roughness: 0.15, clearcoat: 1 }));
      add(blade);
      // cross-guard with round ends
      const guard = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 36), gm);
      guard.position.set(bladeEnd + 2, 0, 0);
      add(guard);
      for (const z of [-18, 18]) { const b = new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 14), gm); b.position.set(bladeEnd + 2, 0, z); add(b); }
      // wrapped grip
      const wrap = glossy('#7a4a2a', { roughness: 0.7, clearcoat: 0.1 });
      for (let x = bladeEnd + 7; x < L - 8; x += 4.2) {
        const r = h.radius(x) + 0.25;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.75, 8, 28), wrap);
        ring.rotation.y = Math.PI / 2;
        ring.scale.set(1, h.ySquash + 0.05, 1);
        ring.position.x = x;
        add(ring);
      }
      // gem pommel
      const gemMat = glossy('#e0245e', { emissive: '#7a0020', emissiveIntensity: 0.4, metalness: 0.2 });
      addGlitter(gemMat, 0.8, 2);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(6, 0), gemMat);
      gem.position.set(L + 2.5, 0, 0);
      gem.scale.set(1.2, 1, 1);
      add(gem);
      return { objects, bladeEnd, update: (t) => { gem.rotation.x = t * 0.8; } };
    }

    case 'rocket': {
      const finShape = new THREE.Shape();
      finShape.moveTo(0, 0); finShape.lineTo(26, 0); finShape.lineTo(30, 15); finShape.lineTo(18, 15); finShape.closePath();
      const finGeo = extruded(finShape, 1.2, 0.4);
      const finMat = glossy('#ff3b3b');
      for (const th of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
        const g = new THREE.Group();
        const p = surface(h, L - 22, th, 0.8);
        g.position.set(L - 26, p.y, p.z);
        g.rotation.x = -th;
        const fin = new THREE.Mesh(finGeo, finMat);
        g.add(fin);
        add(g);
      }
      // porthole
      const px = L * 0.55;
      const top = surface(h, px, 0, -0.1);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 1, 10, 32), new THREE.MeshPhysicalMaterial({ color: '#cfd6de', metalness: 1, roughness: 0.25 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(top);
      add(ring);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(4.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glossy('#7fd3ff', { roughness: 0.05, emissive: '#2a7fb8', emissiveIntensity: 0.3 }));
      glass.scale.set(1, 0.35, 1);
      glass.position.copy(top);
      add(glass);
      // engine flame
      const flame = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(5.2, 22, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ff6a00', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      const inner = new THREE.Mesh(new THREE.ConeGeometry(2.4, 10, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.rotation.z = Math.PI / 2; inner.rotation.z = Math.PI / 2;
      outer.position.x = 11; inner.position.x = 6;
      flame.add(outer, inner);
      flame.position.set(L, 0, 0);
      add(flame);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.6, 4, 24), new THREE.MeshPhysicalMaterial({ color: '#9aa4ae', metalness: 1, roughness: 0.3 }));
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.set(L - 0.5, 0, 0);
      add(nozzle);
      return { objects, update: (t) => { const f = 1 + 0.18 * Math.sin(t * 31) + 0.1 * Math.sin(t * 17); flame.scale.set(f, 1 / Math.sqrt(f), 1 / Math.sqrt(f)); } };
    }

    case 'dino': {
      const plateMat = glossy('#3fcf5f', { sheen: 0.6, sheenColor: new THREE.Color('#b8ffb0') });
      const n = 9;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const x = L * (0.3 + 0.62 * f);
        const ht = 5 + 8 * Math.sin(Math.PI * (0.15 + 0.85 * f));
        const plate = new THREE.Mesh(new THREE.ConeGeometry(3.8, ht, 4), plateMat);
        plate.scale.set(1, 1, 0.45);
        const p = surface(h, x, 0, 0.5);
        plate.position.set(x, p.y + ht / 2 - 0.3, 0);
        plate.rotation.y = Math.PI / 4;
        add(plate);
      }
      // curling tail tip
      const tail = new THREE.Mesh(new THREE.ConeGeometry(5.4, 22, 20), plateMat);
      tail.rotation.z = -Math.PI / 2 + 0.45;
      tail.position.set(L + 8, 4, 0);
      add(tail);
      return { objects };
    }

    case 'shark': {
      const dorsal = new THREE.Shape();
      dorsal.moveTo(0, 0); dorsal.lineTo(26, 0); dorsal.quadraticCurveTo(13, 5, 4, 23); dorsal.quadraticCurveTo(5, 8, 0, 0);
      const fin = new THREE.Mesh(extruded(dorsal, 1.4), h.material);
      const p = surface(h, L * 0.42, 0, 0.6);
      fin.position.set(L * 0.42 - 10, p.y, 0);
      add(fin);
      const tailShape = new THREE.Shape();
      tailShape.moveTo(0, 0); tailShape.lineTo(17, 20); tailShape.lineTo(10, 0); tailShape.lineTo(14, -13); tailShape.closePath();
      const tail = new THREE.Mesh(extruded(tailShape, 1.4), h.material);
      tail.position.set(L - 4, 0, 0);
      add(tail);
      // friendly eyes and gill slits near the head end
      const eyeW = glossy('#ffffff'), eyeB = new THREE.MeshBasicMaterial({ color: '#111' }), gillM = new THREE.MeshBasicMaterial({ color: '#3a4a58' });
      for (const s of [-1, 1]) {
        const e = surface(h, L * 0.16, (Math.PI / 2) * s, -0.2);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), eyeW);
        eye.position.copy(e);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10), eyeB);
        pupil.position.set(0.4, 0.3, 1.2 * s);
        eye.add(pupil);
        add(eye);
        for (let g = 0; g < 3; g++) {
          const gp = surface(h, L * 0.24 + g * 2.6, (Math.PI / 2) * s, -0.15);
          const gill = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.2, 0.4), gillM);
          gill.position.copy(gp);
          add(gill);
        }
      }
      for (const s of [-1, 1]) {
        const pec = new THREE.Shape();
        pec.moveTo(0, 0); pec.lineTo(10, 0); pec.lineTo(3, 8); pec.closePath();
        const m = new THREE.Mesh(extruded(pec, 1), h.material);
        const q = surface(h, L * 0.3, Math.PI / 2 * s + 0.6 * s, 0.6);
        m.position.set(L * 0.3 - 4, q.y, q.z);
        m.rotation.set(Math.PI / 2 * s, 0, 0);
        m.rotation.z = -0.4;
        add(m);
      }
      return { objects };
    }

    case 'wand': {
      const sm = gold();
      const st = new THREE.Mesh(extruded(star(13, 5.6), 3, 1), sm);
      st.position.set(L + 12, 0, 0);
      st.rotation.y = Math.PI / 2;
      add(st);
      // spiral ribbon around the handle
      const pts: THREE.Vector3[] = [];
      const x0 = L * 0.28, x1 = L * 0.96, turns = 3.5;
      for (let i = 0; i <= 160; i++) {
        const f = i / 160;
        const x = x0 + (x1 - x0) * f;
        const th = f * turns * Math.PI * 2;
        const r = h.radius(x) + 0.5;
        pts.push(new THREE.Vector3(x, Math.cos(th) * r * h.ySquash + Math.cos(th) * 0.4, Math.sin(th) * r));
      }
      const ribbonMat = glossy('#ff5fb0', { emissive: '#ff5fb0', emissiveIntensity: 0.15 });
      addGlitter(ribbonMat, 0.7, 2);
      const ribbon = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 1.1, 8), ribbonMat);
      add(ribbon);
      return { objects, update: (t) => { st.rotation.x = Math.sin(t * 1.5) * 0.4; } };
    }

    case 'unicorn': {
      const prof: THREE.Vector2[] = [];
      for (let i = 0; i <= 30; i++) { const f = i / 30; prof.push(new THREE.Vector2(Math.max(0.05, 6.2 * (1 - f) ** 0.9), f * 32)); }
      const horn = new THREE.LatheGeometry(prof, 40);
      const pos = horn.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const a = Math.atan2(z, x);
        const k = 1 - 0.13 * (0.5 + 0.5 * Math.sin(a * 2 - y * 1.3));
        pos.setXYZ(i, x * k, y, z * k);
      }
      horn.computeVertexNormals();
      const hornMat = new THREE.MeshPhysicalMaterial({ color: '#fff4d6', roughness: 0.2, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6, metalness: 0.2 });
      addGlitter(hornMat, 0.6, 2);
      const hm = new THREE.Mesh(horn, hornMat);
      hm.rotation.z = -Math.PI / 2;
      hm.position.set(L - 2, 0, 0);
      add(hm);
      const mane = ['#ff8cc6', '#b57bff', '#57b6ff', '#6ee7b7', '#ffe066'];
      mane.forEach((c, i) => {
        const x = L * (0.68 + i * 0.065);
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(3.6, 16, 12), glossy(c, { roughness: 0.5, sheen: 1, sheenColor: new THREE.Color(c) }));
        const p = surface(h, x, 0, 0.6);
        tuft.scale.set(1.6, 0.8, 0.9);
        tuft.rotation.z = 0.5;
        tuft.position.set(x, p.y + 1.8, 0);
        add(tuft);
      });
      return { objects };
    }

    case 'blocky': {
      // chunky stepped square handle (pixel style)
      const parts: THREE.BufferGeometry[] = [];
      const step = 7.5;
      for (let x = 0; x < L; x += step) {
        const r = h.radius(x + step / 2);
        const w = Math.max(3, Math.round((r * 2) / 1.5) * 1.5 + 1);
        const ht = Math.max(3, Math.round((r * 2 * h.ySquash) / 1.5) * 1.5 + 1);
        const b = new THREE.BoxGeometry(step, ht, w);
        b.translate(x + step / 2, 0, 0);
        parts.push(b);
      }
      const geo = mergeGeometries(parts)!;
      geo.computeVertexNormals();
      // a pixel gem on the end
      const gemMat = glossy('#36e2d4', { emissive: '#0f8f86', emissiveIntensity: 0.5, roughness: 0.3 });
      addGlitter(gemMat, 0.7, 1.5);
      const gem = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 7), gemMat);
      gem.position.set(L + 4, 0, 0);
      gem.rotation.x = Math.PI / 4;
      add(gem);
      return { objects, handleGeometry: geo, update: (t) => { gem.rotation.x = Math.PI / 4 + t * 0.6; } };
    }
  }
}
