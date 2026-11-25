import * as THREE from 'three';
import { addGlitter } from './patterns';

export type ShapeId = 'classic' | 'sword' | 'rocket' | 'dino' | 'shark' | 'wand';

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
  /** parts mounted on the brush head (brush-local space: bristle tips at y=0, head slab y≈9–12.2, x −10.5…10.5) */
  headObjects?: THREE.Object3D[];
  /** the shape brings its own handle look (e.g. dinosaur skin) */
  pattern?: { pattern: 'dinoSkin'; colors: string[] };
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
      // a friendly dinosaur: skull over the brush head (the bristles are its teeth), back plates, curled spiky tail
      const skin = h.material;
      const head = new THREE.Group();
      const skullGeo = new THREE.SphereGeometry(1, 48, 32);
      const sp = skullGeo.getAttribute('position');
      for (let i = 0; i < sp.count; i++) {
        let x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
        const fx = (x + 1) / 2;                      // 0 = snout tip, 1 = back of the head
        const snout = 0.6 + 0.4 * Math.pow(fx, 0.6); // narrower snout
        x *= 17.5;
        z *= 7.6 * snout;
        y = y < 0 ? y * 1.3 : y * (5.2 + 5.6 * Math.pow(fx, 1.5)); // flat jaw line, big domed skull at the back
        // brow ridges above the eyes, nostril bumps at the front, cheek bulges
        const brow = Math.exp(-((x - 5.5) ** 2) / 10) * Math.exp(-((Math.abs(z) - 4.6) ** 2) / 3) * 2.4;
        const nose = Math.exp(-((x + 14.5) ** 2) / 3) * Math.exp(-((Math.abs(z) - 2.2) ** 2) / 1.2) * 1.2;
        const cheek = Math.exp(-((x - 8) ** 2) / 14) * Math.exp(-(y ** 2) / 6) * 1.4;
        z += Math.sign(z) * cheek;
        if (y > 0) y += brow + nose;
        sp.setXYZ(i, x, y, z);
      }
      skullGeo.computeVertexNormals();
      const skull = new THREE.Mesh(skullGeo, skin);
      skull.position.set(-2, 12.6, 0);
      head.add(skull);
      const eyeW = glossy('#ffffff'), pupilM = new THREE.MeshBasicMaterial({ color: '#141414' });
      for (const s2 of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(2.8, 20, 14), eyeW);
        eye.position.set(4.6, 19.2, 5.0 * s2);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), pupilM);
        pupil.position.set(-0.8, 0.4, 1.9 * s2);
        const shine = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        shine.position.set(-1.2, 1.2, 2.8 * s2);
        eye.add(pupil, shine);
        head.add(eye);
        const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), pupilM);
        nostril.position.set(-15.6, 15.6, 2.1 * s2);
        head.add(nostril);
        // mouth line along the jaw, two little fangs at the front, cheek spikes
        const lip = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 22, 4, 8), new THREE.MeshBasicMaterial({ color: '#1f4d22' }));
        lip.rotation.z = Math.PI / 2;
        lip.position.set(-3, 12.8, 6.4 * s2 * 0.92);
        head.add(lip);
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 10), glossy('#fffaf0'));
        fang.rotation.z = Math.PI;
        fang.position.set(-13, 11.2, 2.6 * s2);
        head.add(fang);
        for (let k = 0; k < 3; k++) {
          const cs = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3, 8), glossy('#ff8a3d'));
          cs.position.set(10 + k * 2.6, 15 + k * 1.2, 7.4 * s2);
          cs.rotation.x = s2 * 1.3;
          head.add(cs);
        }
      }
      // little horn bumps on top of the head
      for (const [x, ht, y] of [[-1, 3, 21.6], [4, 4, 23.2], [9, 4.4, 23.6], [13.5, 3.4, 22.2]] as const) {
        const bump = new THREE.Mesh(new THREE.ConeGeometry(1.7, ht, 10), glossy('#ff8a3d'));
        bump.position.set(x, y + ht / 2 - 0.8, 0);
        head.add(bump);
      }
      const headObjects = [head];
      head.traverse(c => { (c as THREE.Mesh).castShadow = true; });

      // back plates (stegosaurus style), alternating sides, biggest in the middle
      const plateShape = new THREE.Shape();
      plateShape.moveTo(-4, 0); plateShape.quadraticCurveTo(-3.5, 6, 0, 9); plateShape.quadraticCurveTo(3.5, 6, 4, 0); plateShape.closePath();
      const plateGeo = extruded(plateShape, 1.0, 0.45);
      const plateMat = glossy('#ff8a3d', { sheen: 0.6, sheenColor: new THREE.Color('#ffd08a') });
      const n = 11;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const x = L * (0.22 + 0.72 * f);
        const sc = 0.55 + 0.75 * Math.sin(Math.PI * (0.1 + 0.85 * f));
        const plate = new THREE.Mesh(plateGeo, plateMat);
        const p = surface(h, x, 0, 0.6);
        plate.scale.setScalar(sc);
        plate.position.set(x, p.y - 0.4, (i % 2 ? 1 : -1) * 0.9);
        plate.rotation.x = (i % 2 ? 1 : -1) * 0.12;
        add(plate);
      }
      // curling tapered tail with spikes
      const tailPts = [new THREE.Vector3(L - 8, 0, 0), new THREE.Vector3(L + 6, 1, 0), new THREE.Vector3(L + 18, 5, 0), new THREE.Vector3(L + 27, 12, 0), new THREE.Vector3(L + 30, 19, 0)];
      const tailCurve = new THREE.CatmullRomCurve3(tailPts);
      const tailGeo = new THREE.TubeGeometry(tailCurve, 60, 1, 18, false);
      const tp = tailGeo.getAttribute('position');
      const P = new THREE.Vector3(), V = new THREE.Vector3();
      for (let i = 0; i < tp.count; i++) {
        const ring = Math.floor(i / 19);
        const f = ring / 60;
        tailCurve.getPointAt(f, P);
        V.fromBufferAttribute(tp, i).sub(P);
        const r = Math.max(0.35, h.radius(L - 8) * 0.95 * Math.pow(1 - f, 0.85));
        V.multiplyScalar(r);
        V.y *= h.ySquash + (1 - h.ySquash) * f;
        tp.setXYZ(i, P.x + V.x, P.y + V.y, P.z + V.z);
      }
      tailGeo.computeVertexNormals();
      add(new THREE.Mesh(tailGeo, skin));
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), skin);
      tip.position.copy(tailCurve.getPointAt(1));
      add(tip);
      for (const [f, side] of [[0.62, 1], [0.62, -1], [0.8, 1], [0.8, -1]] as const) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6, 10), glossy('#f5e6c8'));
        const at = tailCurve.getPointAt(f);
        spike.position.copy(at).add(new THREE.Vector3(0, 1.2, side * 2.2));
        spike.rotation.x = side * 1.0;
        add(spike);
      }
      return { objects, headObjects, pattern: { pattern: 'dinoSkin', colors: ['#4caf50', '#2e7d32', '#c5e1a5'] } };
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
      // big glittering star standing on the back of the brush head, ribbon around the handle, little gem on the end
      const sm = gold();
      const st = new THREE.Mesh(extruded(star(14, 6), 3, 1), sm);
      const starHolder = new THREE.Group();
      starHolder.position.set(0, 12.2 + 11.4, 0);
      starHolder.add(st);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 3, 16), sm);
      stem.position.set(0, 13, 0);
      const pts: THREE.Vector3[] = [];
      const x0 = L * 0.12, x1 = L * 0.96, turns = 4.5;
      for (let i = 0; i <= 180; i++) {
        const f = i / 180;
        const x = x0 + (x1 - x0) * f;
        const th = f * turns * Math.PI * 2;
        const r = h.radius(x) + 0.5;
        pts.push(new THREE.Vector3(x, Math.cos(th) * r * h.ySquash + Math.cos(th) * 0.4, Math.sin(th) * r));
      }
      const ribbonMat = glossy('#ff5fb0', { emissive: '#ff5fb0', emissiveIntensity: 0.15 });
      addGlitter(ribbonMat, 0.7, 2);
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 1.1, 8), ribbonMat));
      const endGem = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 18), sm);
      endGem.position.set(L + 2, 0, 0);
      add(endGem);
      const headObjects = [starHolder, stem];
      for (const o of headObjects) o.traverse(c => { (c as THREE.Mesh).castShadow = true; });
      return { objects, headObjects, update: (t) => { st.rotation.y = Math.sin(t * 1.2) * 0.5; st.rotation.z = Math.sin(t * 0.8) * 0.08; } };
    }
  }
}
