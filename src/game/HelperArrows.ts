import * as THREE from 'three';

export interface ArrowTarget {
  /** point on the surface, in the parent group's local space */
  point: THREE.Vector3;
  /** outward surface normal, parent-local */
  normal: THREE.Vector3;
}

/**
 * Big, glossy, bouncing 3D arrows that point at spots still needing a brush.
 * Parent the group to the rotating jaw content so arrows stay glued to the teeth.
 */
export class HelperArrows {
  readonly group = new THREE.Group();
  private arrows: { mesh: THREE.Group; target: ArrowTarget | null; show: number; phase: number }[] = [];
  private mat: THREE.MeshPhysicalMaterial;
  private t = 0;
  visible = false;

  constructor(count = 3) {
    this.mat = new THREE.MeshPhysicalMaterial({
      color: '#ff5e00', emissive: '#ff2a00', emissiveIntensity: 0.25,
      roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, depthTest: false,
    });
    const rim = new THREE.MeshBasicMaterial({ color: '#fff6d8', side: THREE.BackSide, depthTest: false });
    // arrow along +Y with its tip at the origin (points towards −Y = into the surface)
    const prof: [number, number][] = [
      [0, 0.01], [0.6, 1.0], [4.2, 3.6], [4.7, 3.7], [4.7, 1.45], [14, 1.45], [14.8, 1.05], [15.1, 0.01],
    ];
    const geo = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 32);
    geo.computeVertexNormals();
    const outline = geo.clone();
    outline.scale(1.09, 1.03, 1.09);
    outline.translate(0, -0.2, 0);
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      // drawn on top so the arrow is never hidden behind a tooth
      const body = new THREE.Mesh(geo, this.mat);
      body.renderOrder = 31;
      const edge = new THREE.Mesh(outline, rim);
      edge.renderOrder = 30;
      g.add(edge, body);
      g.visible = false;
      this.group.add(g);
      this.arrows.push({ mesh: g, target: null, show: 0, phase: i * 0.7 });
    }
  }

  show(targets: ArrowTarget[]) {
    this.visible = targets.length > 0;
    this.arrows.forEach((a, i) => {
      a.target = targets[i] ?? null;
      if (a.target) { a.mesh.visible = true; a.show = Math.min(a.show, 0); }
    });
  }

  hide() {
    this.visible = false;
    for (const a of this.arrows) a.target = null;
  }

  private up = new THREE.Vector3(0, 1, 0);

  update(dt: number) {
    this.t += dt;
    this.mat.emissiveIntensity = 0.15 + 0.3 * (0.5 + 0.5 * Math.sin(this.t * 6));
    for (const a of this.arrows) {
      a.show = THREE.MathUtils.clamp(a.show + (a.target ? dt * 4 : -dt * 5), 0, 1);
      if (a.show <= 0) { a.mesh.visible = false; continue; }
      if (!a.target) continue;
      const { point, normal } = a.target;
      const bounce = 1.6 + 2.6 * Math.abs(Math.sin(this.t * 4.2 + a.phase));
      a.mesh.position.copy(point).addScaledVector(normal, bounce);
      a.mesh.quaternion.setFromUnitVectors(this.up, normal);
      a.mesh.rotateY(this.t * 1.5);
      // springy pop-in
      const s = a.show < 1 ? 1 + Math.sin(a.show * Math.PI) * 0.35 : 1;
      a.mesh.scale.setScalar(a.show * s * 1.2);
    }
  }
}
