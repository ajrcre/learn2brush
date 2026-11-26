import * as THREE from 'three';
import type { Jaws, Tooth } from './jaws/Jaws';
import { FLAT_TOP, rng } from './jaws/toothGeometry';

type Kind = 'crumb' | 'spinach' | 'seed' | 'popcorn' | 'chocolate';

interface Bit {
  kind: Kind;
  mesh: THREE.Mesh;
  tooth: Tooth;
  hp: number;
  falling: boolean;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
}

function displaced(geo: THREE.BufferGeometry, amt: number, seed: number) {
  const r = rng(seed);
  const pos = geo.getAttribute('position');
  const o = [r() * 10, r() * 10, r() * 10];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 3 + o[0]) * Math.sin(y * 3.4 + o[1]) * Math.sin(z * 2.7 + o[2]);
    const k = 1 + n * amt;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeMesh(kind: Kind, seed: number): THREE.Mesh {
  switch (kind) {
    case 'crumb': {
      const g = displaced(new THREE.IcosahedronGeometry(1.1, 2), 0.35, seed);
      return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#c99a5b', roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color('#f3d9a8') }));
    }
    case 'chocolate': {
      const g = displaced(new THREE.SphereGeometry(1.4, 20, 14), 0.2, seed);
      g.scale(1.2, 0.5, 1);
      return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#4b2a17', roughness: 0.35, clearcoat: 0.6 }));
    }
    case 'seed': {
      const g = new THREE.SphereGeometry(0.55, 14, 10);
      g.scale(1, 0.62, 0.62);
      return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#d7b347', roughness: 0.4, clearcoat: 0.5 }));
    }
    case 'popcorn': {
      const g = new THREE.SphereGeometry(1.6, 18, 10, 0, Math.PI * 1.1, 0, Math.PI * 0.45);
      g.scale(1, 0.6, 1);
      displaced(g, 0.15, seed);
      return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#f4e3b8', roughness: 0.5, side: THREE.DoubleSide, transmission: 0, sheen: 0.6, sheenColor: new THREE.Color('#fff4d6') }));
    }
    case 'spinach': {
      const shape = new THREE.Shape();
      const r = rng(seed);
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const rad = 1.6 * (0.8 + r() * 0.35);
        const x = Math.cos(a) * rad * 1.2, y = Math.sin(a) * rad * 0.8;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      const g = new THREE.ShapeGeometry(shape, 8);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 0.9) * 0.6 + Math.cos(pos.getY(i) * 1.3) * 0.3);
      g.computeVertexNormals();
      return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#2f6f2b', roughness: 0.45, clearcoat: 0.5, side: THREE.DoubleSide }));
    }
  }
}

/** Food leftovers stuck between teeth and on chewing surfaces. Brush them off; they fall away. */
export class FoodBits {
  readonly group = new THREE.Group(); // parented to the jaw root
  readonly fallGroup = new THREE.Group(); // parented to the scene (world space)
  private bits: Bit[] = [];
  onRemoved?: (worldPos: THREE.Vector3) => void;

  get remaining() { return this.bits.filter(b => !b.falling).length; }
  get total() { return this.bits.length; }

  reset(jaws: Jaws, seed: number, count = 7) {
    for (const b of this.bits) b.mesh.removeFromParent();
    this.bits = [];
    const r = rng(seed);
    const kinds: Kind[] = ['crumb', 'spinach', 'seed', 'popcorn', 'chocolate', 'crumb', 'seed', 'spinach'];
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      let ti = Math.floor(r() * jaws.teeth.length);
      while (used.has(ti)) ti = (ti + 1) % jaws.teeth.length;
      used.add(ti);
      const tooth = jaws.teeth[ti];
      const kind = kinds[i % kinds.length];
      const mesh = makeMesh(kind, seed + i);
      mesh.castShadow = true;
      mesh.scale.setScalar(1.6); // big enough to spot easily
      // place in tooth-local space, then convert to jaw-root space
      const { w, t, h, kind: tk } = tooth.spec;
      const local = new THREE.Vector3();
      const localN = new THREE.Vector3();
      const onTop = FLAT_TOP.includes(tk) && (kind === 'seed' || kind === 'popcorn' || kind === 'crumb' || r() < 0.4);
      if (onTop) {
        local.set((r() - 0.5) * w * 0.3, h * 0.92, (r() - 0.5) * t * 0.2);
        localN.set(0, 1, 0);
      } else {
        const outer = r() < 0.6;
        local.set((r() < 0.5 ? -1 : 1) * w * 0.5, h * 0.25, (outer ? 1 : -1) * t * 0.42);
        localN.set(0, 0.3, outer ? 1 : -1).normalize();
      }
      tooth.mesh.updateMatrixWorld();
      const toRoot = new THREE.Matrix4().copy(tooth.mesh.matrix);
      const parent = tooth.mesh.parent!; // upper/lower group
      toRoot.premultiply(new THREE.Matrix4().compose(parent.position, parent.quaternion, parent.scale));
      mesh.position.copy(local).applyMatrix4(toRoot);
      const nWorld = localN.clone().transformDirection(toRoot);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nWorld);
      mesh.rotateY(r() * Math.PI * 2);
      mesh.userData.food = true;
      mesh.userData.normal = nWorld;
      this.group.add(mesh);
      this.bits.push({ kind, mesh, tooth, hp: kind === 'spinach' || kind === 'chocolate' ? 1.4 : 0.9, falling: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), age: 0 });
    }
  }

  meshes() { return this.bits.filter(b => !b.falling).map(b => b.mesh); }

  private wp = new THREE.Vector3();

  /** Brush contact in world space. Returns number of bits knocked loose this frame. */
  brush(worldPoint: THREE.Vector3, radius: number, amount: number, scene: THREE.Object3D): number {
    let n = 0;
    for (const b of this.bits) {
      if (b.falling) continue;
      b.mesh.getWorldPosition(this.wp);
      const d = this.wp.distanceTo(worldPoint);
      if (d > radius) continue;
      b.hp -= amount * (1 - d / radius * 0.5);
      // wiggle while being brushed
      b.mesh.rotation.z += (Math.random() - 0.5) * 0.3;
      if (b.hp <= 0) {
        b.falling = true;
        const worldQ = b.mesh.getWorldQuaternion(new THREE.Quaternion());
        const nW = (b.mesh.userData.normal as THREE.Vector3).clone().transformDirection(this.group.matrixWorld);
        scene.add(this.fallGroup);
        this.fallGroup.add(b.mesh);
        b.mesh.position.copy(this.wp);
        b.mesh.quaternion.copy(worldQ);
        b.vel.copy(nW).multiplyScalar(40).add(new THREE.Vector3((Math.random() - 0.5) * 30, 25, 20));
        b.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
        this.onRemoved?.(this.wp.clone());
        n++;
      }
    }
    return n;
  }

  update(dt: number) {
    for (const b of this.bits) {
      if (!b.falling || !b.mesh.parent) continue;
      b.age += dt;
      b.vel.y -= 260 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      const s = Math.max(0, 1 - b.age / 1.4);
      b.mesh.scale.setScalar(s * 1.6);
      if (b.age > 1.4) b.mesh.removeFromParent();
    }
  }
}
