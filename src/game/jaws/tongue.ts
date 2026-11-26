import * as THREE from 'three';
import { NOISE_GLSL } from '../materials';

/**
 * A long, slimy tongue (Venom) that slides out of the throat, over the bottom front teeth, and
 * then writhes around in front of the mouth like a snake. It lives in the bottom jaw's group.
 *
 * The tongue follows a path: a fixed curve inside the mouth (from deep in the throat, along the
 * mouth floor, out between the front teeth) and then a free part that is re-bent every frame by
 * waves running down its length. It grows out of the throat along that path and gets slurped back.
 *
 * Modes (see `update`):
 * - 'show': out all the time, hanging down over the chin and writhing (home, shop, all clean)
 * - 'in': pulled back down the throat and hidden
 * - 'pester' (harder level, while brushing): comes out every few seconds and lashes from side to
 *   side right in front of the teeth, hiding them and knocking the brush off (`near`). Brushing the
 *   tongue itself tickles it (`tickle`) and it hides for a while.
 * It is never cleaned.
 */
export type TongueMode = 'in' | 'show' | 'pester';

export interface TongueOptions {
  /** bottom jaw: tongue mesh is added to this group (bottom gum line at y = 0, teeth point +y) */
  lower: THREE.Group;
  /** distance from the bite plane to each gum line */
  open: number;
  /** z of the back teeth and of the outside of the front teeth (lower group space) */
  backZ: number;
  frontZ: number;
  /** height (lower group space) where the tongue leaves the mouth, between the top and bottom front teeth */
  lipY: number;
  /** depth of the mouth floor below the gum line */
  floor: number;
  /** the arches the teeth stand on (x, z; the same for both groups), for licking along the teeth */
  lowerArch: THREE.Curve<THREE.Vector3>;
  upperArch: THREE.Curve<THREE.Vector3>;
}

/** An arch sampled evenly: points and outward directions in x/z, to walk along the front of the teeth. */
class ArchTrack {
  private readonly p: THREE.Vector2[] = [];
  private readonly n: THREE.Vector2[] = [];
  readonly length: number;
  constructor(curve: THREE.Curve<THREE.Vector3>, private readonly samples = 160) {
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const q = curve.getPointAt(u), t = curve.getTangentAt(u);
      this.p.push(new THREE.Vector2(q.x, q.z));
      this.n.push(new THREE.Vector2(-t.z, t.x).normalize()); // outward (lip/cheek side)
    }
    this.length = curve.getLength();
  }
  /** point `off` mm outside the arch, `a` mm along it from the middle (+ = towards the end of the arch) */
  at(a: number, off: number, out: THREE.Vector2, nrm: THREE.Vector2) {
    const f = THREE.MathUtils.clamp(0.5 + a / this.length, 0, 1) * this.samples;
    const i = Math.min(this.samples - 1, Math.floor(f)), r = f - i;
    nrm.lerpVectors(this.n[i], this.n[i + 1], r).normalize();
    out.lerpVectors(this.p[i], this.p[i + 1], r).addScaledVector(nrm, off);
  }
}

const RINGS = 90;
const AROUND = 20;
/** free part (outside the mouth) at full length, mm */
const FREE = 40;
/** half width / half thickness at the root */
const W = 4.4, T = 1.7;

export class Tongue {
  readonly mesh: THREE.Mesh;
  private readonly inside: THREE.CatmullRomCurve3;
  /** 0 = pulled in, 1 = all the way out */
  private ext = 0;
  private time = Math.random() * 10;
  private mode: TongueMode = 'show';
  /** 0 = 'show' shape (hanging down), 1 = 'pester' shape (lashing across the teeth) */
  private pest = 0;
  /** pester rhythm: out or in, and how long until it switches */
  private pestOut = false;
  private cycle = 0;
  /** seconds it stays hidden after being tickled */
  private tickled = 0;
  /** extra fast shaking (just tickled) */
  private wiggle = 0;
  /** ring centres and half widths of the last frame (lower group space), for `near` */
  private readonly spine = Array.from({ length: RINGS + 1 }, () => new THREE.Vector3());
  private readonly halfW = new Float32Array(RINGS + 1);
  private readonly pos: Float32Array;
  // per-frame polyline of the whole path: points, "up" of the tongue's flat top, cumulative length
  private readonly N_IN = 40;
  private readonly N_FREE = 60;
  private readonly pts: THREE.Vector3[];
  private readonly ups: THREE.Vector3[];
  private readonly arc: Float32Array;
  private readonly lowerTrack: ArchTrack;
  private readonly upperTrack: ArchTrack;
  private readonly lipY: number;
  private readonly open: number;

  constructor(o: TongueOptions) {
    const { backZ: zb, frontZ: zf, lipY, floor } = o;
    this.lowerTrack = new ArchTrack(o.lowerArch);
    this.upperTrack = new ArchTrack(o.upperArch);
    this.lipY = lipY;
    this.open = o.open;
    this.inside = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -floor - 4.5, zb - 3), // down the throat, hidden under the mouth floor
      new THREE.Vector3(0, -floor - 0.5, zb + 2),
      new THREE.Vector3(0, -floor + 2.2, THREE.MathUtils.lerp(zb, zf, 0.4)), // lying on the mouth floor
      new THREE.Vector3(0, lipY - 3.2, zf - 6),
      new THREE.Vector3(0, lipY - 0.6, zf - 1),
      new THREE.Vector3(0, lipY - 1.4, zf + 3.5), // out over the bottom front teeth
    ], false, 'centripetal');
    const n = this.N_IN + this.N_FREE + 1;
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());
    this.ups = Array.from({ length: n }, () => new THREE.Vector3());
    this.arc = new Float32Array(n);

    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((RINGS + 1) * AROUND * 3 + 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    // along (0 root → 1 tip) and around (0..1): the shader uses them for the groove and the paler underside
    const uv = new Float32Array(((RINGS + 1) * AROUND + 1) * 2);
    for (let k = 0; k <= RINGS; k++) for (let j = 0; j < AROUND; j++) uv.set([k / RINGS, j / AROUND], (k * AROUND + j) * 2);
    uv.set([1, 0], (RINGS + 1) * AROUND * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let k = 0; k < RINGS; k++) for (let j = 0; j < AROUND; j++) {
      const a = k * AROUND + j, b = k * AROUND + ((j + 1) % AROUND), c = a + AROUND, d = b + AROUND;
      idx.push(a, c, b, b, c, d);
    }
    const tip = (RINGS + 1) * AROUND;
    for (let j = 0; j < AROUND; j++) idx.push(RINGS * AROUND + j, tip, RINGS * AROUND + ((j + 1) % AROUND));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, createTongueMaterial());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // it changes shape every frame
    this.mesh.visible = false;
    this.mesh.userData.head = true;
    this.mesh.userData.tongue = true;
    o.lower.add(this.mesh);
  }

  /** Bend the path for this moment: fixed inside the mouth, writhing outside it. */
  private layPath() {
    const t = this.time;
    const { pts, ups, arc } = this;
    for (let i = 0; i <= this.N_IN; i++) {
      this.inside.getPointAt(i / this.N_IN, pts[i]);
      ups[i].set(0, 1, 0);
    }
    for (let i = 1; i <= this.N_IN; i++) arc[i] = arc[i - 1] + pts[i].distanceTo(pts[i - 1]);
    // free part: a "turtle" walks out of the mouth, turning a little at each step
    const dir = this.inside.getTangentAt(1).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
    const side = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const ds = FREE / this.N_FREE;
    // slow overall moods: hang and sway, curl the tip up
    const sway = Math.sin(t * 0.7) * 0.6 + Math.sin(t * 0.31 + 1) * 0.4;
    const curl = 0.5 + 0.5 * Math.sin(t * 0.45 + 2);
    for (let i = 1; i <= this.N_FREE; i++) {
      const s = i / this.N_FREE; // 0 at the lips → 1 at the tip
      // turning per mm: a wave that runs from the root to the tip, bigger towards the tip
      const shake = this.wiggle * 0.09 * Math.sin(t * 31 + s * 12);
      const yaw = (0.05 * Math.sin(7 * s - t * 2.6) * (0.25 + s) + 0.022 * sway + shake) * ds;
      const droop = 0.05 * (1 - s) * (1 - s) + 0.012; // hangs down over the chin
      const lift = (0.075 * curl * THREE.MathUtils.smoothstep(s, 0.45, 1) + 0.03 * Math.sin(5 * s - t * 3.1 + 1) * s);
      const pitch = (droop - lift) * ds;
      side.crossVectors(dir, up).normalize();
      q.setFromAxisAngle(up, yaw);
      dir.applyQuaternion(q);
      q.setFromAxisAngle(side, -pitch);
      dir.applyQuaternion(q).normalize();
      up.applyQuaternion(q);
      // roll a little around its own length
      q.setFromAxisAngle(dir, 0.012 * Math.sin(t * 1.3 + s * 3) * ds * 4);
      up.applyQuaternion(q);
      up.addScaledVector(dir, -up.dot(dir)).normalize();
      const k = this.N_IN + i;
      pts[k].copy(pts[k - 1]).addScaledVector(dir, ds);
      ups[k].copy(up);
    }
    if (this.pest > 0) this.layPester();
    for (let k = this.N_IN + 1; k < pts.length; k++) arc[k] = arc[k - 1] + pts[k].distanceTo(pts[k - 1]);
  }

  /**
   * Pester shape, blended over the free part: the tongue licks along the front of the teeth, just
   * outside them, swinging from one side through "straight out" to the other side, and rising over
   * the top teeth or sinking over the bottom ones. It lies broad side on, so it really hides them.
   */
  private layPester() {
    const t = this.time, pe = this.pest;
    const { pts, ups } = this;
    // which way it lies (−1 … 1; near 0 it sticks straight out), and how high its tip reaches
    const lash = Math.tanh(2.2 * Math.sin(t * 0.55 + 0.6));
    const high = Math.sin(t * 0.83) * 0.7 + Math.sin(t * 0.37 + 2) * 0.3;
    const start = pts[this.N_IN];
    const lo = new THREE.Vector2(), hi = new THREE.Vector2(), nl = new THREE.Vector2(), nh = new THREE.Vector2();
    const p = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3();
    const ds = FREE / this.N_FREE;
    for (let i = 1; i <= this.N_FREE; i++) {
      const s = i / this.N_FREE, mm = i * ds;
      // height: from the lips up over the top teeth or down over the bottom ones, with a ripple
      const y = THREE.MathUtils.clamp(this.lipY + high * 11 * THREE.MathUtils.smoothstep(mm, 3, 20) + 1.4 * Math.sin(9 * s - t * 4), 3, 2 * this.open - 3);
      // along the arch, just outside the teeth (a little further out at the top: those teeth flare)
      const along = lash * mm * 0.85;
      this.lowerTrack.at(along, 5.2, lo, nl);
      this.upperTrack.at(along, 6, hi, nh);
      const top = THREE.MathUtils.smoothstep(y, this.lipY - 4, this.lipY + 4);
      lo.lerp(hi, top); nl.lerp(nh, top).normalize();
      n.set(nl.x, 0, nl.y);
      // sticking out towards the viewer when it swings through the middle; wriggling in and out
      const forward = mm * (1 - Math.abs(lash)) * 0.9;
      const wriggle = (0.9 * Math.sin(8 * s - t * 3.6) * s + this.wiggle * 1.2 * Math.sin(t * 31 + s * 12));
      p.set(lo.x, y, lo.y).addScaledVector(n, forward + wriggle);
      // blend in from the lips over the first few mm, so it leaves the mouth smoothly
      const k = this.N_IN + i;
      p.lerp(start.clone().addScaledVector(n, mm), 1 - THREE.MathUtils.smoothstep(mm, 0, 6));
      pts[k].lerp(p, pe);
      // broad side towards the viewer when it lies along the teeth, flat on top when it sticks out
      u.set(0, 1, 0).lerp(n, Math.abs(lash));
      ups[k].lerp(u, pe).normalize();
    }
  }

  /** point, tangent and up at arc length `s` along the path */
  private sample(s: number, p: THREE.Vector3, tan: THREE.Vector3, up: THREE.Vector3) {
    const { pts, ups, arc } = this;
    const last = pts.length - 1;
    let i = 0;
    while (i < last - 1 && arc[i + 1] < s) i++;
    const f = THREE.MathUtils.clamp((s - arc[i]) / Math.max(1e-6, arc[i + 1] - arc[i]), 0, 1);
    p.lerpVectors(pts[i], pts[i + 1], f);
    tan.subVectors(pts[i + 1], pts[i]).normalize();
    up.lerpVectors(ups[i], ups[i + 1], f);
  }

  /**
   * Per frame. 'show': out and writhing; 'in': hidden in the throat; 'pester': in and out on its own,
   * lashing across the front of the teeth while it's out.
   */
  update(dt: number, mode: TongueMode) {
    this.time += dt;
    if (mode !== this.mode) {
      // a pestering round starts with the mouth clear, then the tongue shows up after a moment
      if (mode === 'pester') { this.pestOut = false; this.cycle = 2.5 + Math.random() * 1.5; this.tickled = 0; }
      this.mode = mode;
    }
    let out = mode === 'show';
    if (mode === 'pester') {
      if (this.tickled > 0) {
        this.tickled -= dt;
        if (this.tickled <= 0) { this.pestOut = false; this.cycle = 1 + Math.random() * 2; }
      } else if ((this.cycle -= dt) <= 0) {
        this.pestOut = !this.pestOut;
        this.cycle = this.pestOut ? 4 + Math.random() * 2.5 : 3 + Math.random() * 2.5;
      }
      out = this.pestOut && this.tickled <= 0;
    }
    // only change shape while it's tucked away, so it never jumps from one pose to the other
    const shape = mode === 'pester' ? 1 : 0;
    this.pest = this.ext < 0.15 ? shape : THREE.MathUtils.lerp(this.pest, shape, 1 - Math.exp(-0.8 * dt));
    this.wiggle = Math.max(0, this.wiggle - dt * 1.2);
    // slithers out slowly, gets slurped back in quickly
    this.ext = THREE.MathUtils.lerp(this.ext, out ? 1 : 0, 1 - Math.exp(-(out ? 1.6 : 7) * dt));
    if (!out && this.ext < 0.01) this.ext = 0;
    this.mesh.visible = this.ext > 0.01;
    if (!this.mesh.visible) return;
    this.layPath();
    const len = this.ext * this.arc[this.arc.length - 1]; // it grows out of the throat
    const p = new THREE.Vector3(), tan = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
    const pos = this.pos;
    for (let k = 0; k <= RINGS; k++) {
      const s = (k / RINGS) * len;
      this.sample(s, p, tan, up);
      side.crossVectors(tan, up).normalize();
      up.crossVectors(side, tan).normalize();
      // narrows towards a rounded point; measured from the tip so the tip stays pointy while it grows
      const fromTip = len - s;
      const narrow = 0.28 + 0.72 * THREE.MathUtils.smoothstep(fromTip, 0, 30);
      const round = fromTip < 3.5 ? Math.sqrt(Math.max(0, 1 - (1 - fromTip / 3.5) ** 2)) : 1;
      const w = W * narrow * round, th = T * (0.55 + 0.45 * narrow) * round;
      this.spine[k].copy(p);
      this.halfW[k] = w;
      for (let j = 0; j < AROUND; j++) {
        const a = (j / AROUND) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        // flat oval with a shallow groove down the middle of the top
        const groove = sn > 0 ? 0.35 * Math.exp(-((c / 0.28) ** 2)) * th : 0;
        const x = w * Math.sign(c) * Math.pow(Math.abs(c), 0.8);
        const y = th * Math.sign(sn) * Math.pow(Math.abs(sn), 0.9) - groove;
        const i3 = (k * AROUND + j) * 3;
        pos[i3] = p.x + side.x * x + up.x * y;
        pos[i3 + 1] = p.y + side.y * x + up.y * y;
        pos[i3 + 2] = p.z + side.z * x + up.z * y;
      }
    }
    this.sample(len, p, tan, up);
    pos.set([p.x + tan.x * 0.3, p.y + tan.y * 0.3, p.z + tan.z * 0.3], (RINGS + 1) * AROUND * 3);
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
    // so taps can hit it (the box was first measured when the tongue was still all zeros)
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }

  /** Out far enough to get in the way (pester mode). */
  get blocking() { return this.mode === 'pester' && this.mesh.visible && this.ext > 0.35; }

  /**
   * Does the tongue touch the brush head? The head is taken as a line from the spot being brushed
   * (world space) out along the surface normal for `reach` mm, `margin` mm thick.
   */
  near(world: THREE.Vector3, normal: THREE.Vector3, reach = 9, margin = 2.5) {
    if (!this.blocking) return false;
    const inv = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
    const a = world.clone().applyMatrix4(inv);
    const b = world.clone().addScaledVector(normal, reach).applyMatrix4(inv);
    const seg = new THREE.Line3(a, b), c = new THREE.Vector3();
    for (let k = 0; k <= RINGS; k++) {
      seg.closestPointToPoint(this.spine[k], true, c);
      if (c.distanceTo(this.spine[k]) < this.halfW[k] + margin) return true;
    }
    return false;
  }

  /** Brushed! The tongue shakes and hides for a few seconds. Returns false if it was already hiding. */
  tickle() {
    if (this.mode !== 'pester' || this.tickled > 0) return false;
    this.tickled = 3.5 + Math.random() * 1.5;
    this.wiggle = 1;
    return true;
  }
}

/** Wet, glossy, pinkish-red tongue: bumpy papillae on top, darker groove, paler and smoother underneath. */
function createTongueMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06,
    sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color('#ff9aae'), specularIntensity: 0.9,
  });
  m.customProgramCacheKey = () => 'l2b-tongue';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTUv; varying vec3 vTPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTUv = uv; vTPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vTUv; varying vec3 vTPos;
${NOISE_GLSL}
float l2b_pap;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float a = vTUv.y * 6.28318;
  float top = smoothstep(-0.2, 0.5, sin(a));
  float groove = exp(-pow(cos(a) / 0.22, 2.0)) * top;
  l2b_pap = l2b_noise(vec3(vTUv.x * 260.0, cos(a) * 9.0, sin(a) * 9.0)) * top;
  vec3 col = mix(vec3(0.62, 0.12, 0.2), vec3(0.85, 0.24, 0.33), top);
  col = mix(col, vec3(0.42, 0.06, 0.12), groove * 0.7);
  col *= 0.88 + 0.22 * l2b_pap;
  col = mix(col, vec3(0.95, 0.42, 0.5), smoothstep(0.85, 1.0, vTUv.x) * 0.35);
  // darker deep in the throat
  col *= mix(0.35, 1.0, smoothstep(0.0, 0.25, vTUv.x));
  diffuseColor.rgb = col;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = l2b_bump(normal, -vViewPosition, l2b_pap, 0.25);`);
  };
  return m;
}
