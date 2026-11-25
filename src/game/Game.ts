import * as THREE from 'three';
import { Stage, detectQuality } from './Stage';
import { HumanJaws, type SideProgress } from './jaws/HumanJaws';
import { SIDE_CHEWING, SIDE_INNER, SIDE_OUTER } from './jaws/toothGeometry';
import { Brush, type BrushLook } from './Brush';
import { Paste, createTube, type PasteLook } from './Paste';
import { Foam, Sparkles } from './Effects';
import { FoodBits } from './Food';

export type Phase = 'home' | 'customize' | 'paste' | 'brush' | 'spit' | 'done';
export type View = 'front' | 'upper' | 'lower';

export interface GameEvents {
  progress: (teeth: SideProgress[], overall: number) => void;
  toothDone: (index: number, doneCount: number) => void;
  allClean: () => void;
  foodRemoved: (removed: number, total: number) => void;
  brushing: (active: boolean) => void;
  pasteAmount: (amount: number) => void;
  bubblePop: () => void;
  rotated: () => void;
}

type Handlers = { [K in keyof GameEvents]?: GameEvents[K][] };

const damp = (a: number, b: number, k: number, dt: number) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-k * dt));

export class Game {
  readonly stage: Stage;
  readonly jaws = new HumanJaws();
  readonly brush: Brush;
  readonly paste: Paste;
  readonly foam = new Foam();
  readonly food = new FoodBits();
  readonly sparkles = new Sparkles();
  private tube = createTube('#3fb6ff');

  /** rotates with user drag */
  private model = new THREE.Group();
  /** offset so the focused jaw is centred */
  private content = new THREE.Group();

  phase: Phase = 'home';
  view: View = 'front';
  private yaw = 0.35; private pitch = 0.12;
  private yawT = 0.35; private pitchT = 0.12;
  private focusUpper = 1; private focusLower = 1; // 1 = shown in place, 0 = slid away
  private contentY = 0;

  private handlers: Handlers = {};
  private raf = 0;
  private last = 0;
  private running = false;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerDown = false;
  private mode: 'none' | 'brush' | 'rotate' = 'none';
  private lastPx = { x: 0, y: 0 };
  private pointerSpeed = 0;
  private contact = false;
  private hitPoint = new THREE.Vector3();
  private hitNormal = new THREE.Vector3(0, 0, 1);
  private hitIsTooth = false;
  private brushPos = new THREE.Vector3();
  private brushQuat = new THREE.Quaternion();
  private progressTimer = 0;
  private elapsed = 0;
  private spitT = 0;
  private turntable = 0;
  private squeezing = false;
  brushingTime = 0;
  private doneCount = 0;
  private wasActive = false;
  private readonly cleanSnap = 0.9;

  constructor(canvas: HTMLCanvasElement, brushLook: BrushLook, pasteLook: PasteLook) {
    this.stage = new Stage(canvas, detectQuality());
    const { scene } = this.stage;
    this.content.add(this.jaws.root, this.foam.group, this.food.group);
    this.model.add(this.content);
    scene.add(this.model);
    scene.add(this.sparkles.group);
    this.brush = new Brush(brushLook);
    this.paste = new Paste(pasteLook);
    this.brush.pasteAnchor.add(this.paste.mesh);
    scene.add(this.brush.group);
    scene.add(this.tube.group);
    this.tube.group.visible = false;
    this.foam.setTint(pasteLook.colors[0]);
    this.foam.onPop = () => this.emit('bubblePop');
    this.food.onRemoved = (p) => {
      this.sparkles.burst(p, 6, 6);
      this.emit('foodRemoved', this.food.total - this.food.remaining, this.food.total);
    };
    this.jaws.resetDirt(1);
    for (const t of this.jaws.teeth) { t.dirt.fill(0); (t.mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true; }

    this.bindInput(canvas);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    this.setPhase('home');
  }

  on<K extends keyof GameEvents>(k: K, fn: GameEvents[K]) {
    const list = ((this.handlers as Record<string, unknown[]>)[k] ??= []);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }
  private emit<K extends keyof GameEvents>(k: K, ...args: Parameters<GameEvents[K]>) {
    for (const fn of (this.handlers[k] ?? []) as ((...a: unknown[]) => void)[]) fn(...args);
  }

  setBrushLook(look: BrushLook) { this.brush.setLook(look); this.brush.pasteAnchor.add(this.paste.mesh); }
  setPasteLook(look: PasteLook) {
    this.paste.setLook(look);
    this.foam.setTint(look.colors[0]);
    const band = this.tube.band.material as THREE.MeshPhysicalMaterial;
    band.color.set(look.colors.length > 1 ? look.colors[1] : look.colors[0]);
  }

  setPhase(p: Phase) {
    this.phase = p;
    const showJaws = p === 'home' || p === 'brush' || p === 'spit' || p === 'done';
    this.model.visible = showJaws;
    this.brush.group.visible = p !== 'home' && p !== 'done' && p !== 'spit';
    this.tube.group.visible = p === 'paste';
    this.paste.mesh.visible = p === 'paste' || (p === 'customize' && this.paste.amount > 0);
    if (p === 'customize') {
      this.paste.setAmount(0);
    }
    if (p === 'paste') {
      this.paste.remaining = 1;
      this.paste.setAmount(0);
    }
    if (p === 'brush') this.startBrushing();
    if (p === 'spit') { this.spitT = 0; this.mode = 'none'; this.contact = false; }
    if (p === 'home' || p === 'done') this.setView('front');
  }

  /** New brushing session: dirty teeth, food, clear foam. */
  private startBrushing() {
    const seed = Math.floor(Math.random() * 1e6);
    this.jaws.resetDirt(seed);
    this.food.reset(this.jaws, seed + 5, 7);
    this.foam.clear();
    this.doneCount = 0;
    this.brushingTime = 0;
    this.setView('front');
    this.yawT = 0; this.pitchT = 0.12;
    this.pushProgress();
  }

  setView(v: View) {
    this.view = v;
    if (v === 'front') { this.yawT = 0; this.pitchT = 0.12; }
    if (v === 'upper') { this.yawT = 0; this.pitchT = -1.05; }
    if (v === 'lower') { this.yawT = 0; this.pitchT = 1.05; }
  }

  // ---------- squeeze step ----------
  private squeezeStart = 0;
  private squeezeBase = 0;
  setSqueezing(on: boolean) {
    if (on && !this.squeezing) { this.squeezeStart = performance.now(); this.squeezeBase = this.paste.amount; }
    this.squeezing = on;
  }
  get pasteAmount() { return this.paste.amount; }

  startSpit() { this.setPhase('spit'); }

  // ---------- input ----------
  private bindInput(canvas: HTMLCanvasElement) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'brush' && this.phase !== 'home' && this.phase !== 'done') return;
      canvas.setPointerCapture(e.pointerId);
      this.pointerDown = true;
      this.setNdc(e);
      this.lastPx = { x: e.clientX, y: e.clientY };
      if (this.phase === 'brush' && this.pick()) this.mode = 'brush';
      else this.mode = 'rotate';
    });
    canvas.addEventListener('pointermove', (e) => {
      this.setNdc(e);
      const dx = e.clientX - this.lastPx.x, dy = e.clientY - this.lastPx.y;
      this.lastPx = { x: e.clientX, y: e.clientY };
      if (!this.pointerDown) return;
      if (this.mode === 'rotate') {
        const h = canvas.clientHeight || 1;
        this.yawT += (dx / h) * 3.2;
        this.pitchT = THREE.MathUtils.clamp(this.pitchT + (dy / h) * 3.2, -1.25, 1.25);
        this.emit('rotated');
      } else if (this.mode === 'brush') {
        this.pointerSpeed = Math.min(1, this.pointerSpeed + Math.hypot(dx, dy) / 40);
      }
    });
    const up = (e: PointerEvent) => {
      this.pointerDown = false;
      this.mode = 'none';
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  private touchOffsetPx = 0;
  private setNdc(e: PointerEvent) {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    // lift the contact point above a finger so it doesn't hide the brush head
    this.touchOffsetPx = e.pointerType === 'touch' ? 34 : 0;
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top - this.touchOffsetPx) / r.height) * 2 - 1));
  }

  /** Raycast teeth / gums / food. */
  private pick(): boolean {
    this.ray.setFromCamera(this.ndc, this.stage.camera);
    const targets: THREE.Object3D[] = [...this.jaws.toothMeshes.filter(m => m.parent!.visible), ...this.jaws.gums.filter(g => g.parent!.visible), ...this.food.meshes()];
    const hits = this.ray.intersectObjects(targets, false);
    const h = hits[0];
    if (!h || !h.face) return false;
    this.hitPoint.copy(h.point);
    this.hitNormal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (this.hitNormal.dot(this.ray.ray.direction) > 0) this.hitNormal.negate();
    this.hitIsTooth = !!h.object.userData.tooth || !!h.object.userData.food;
    return true;
  }

  // ---------- loop ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.stage.render(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private resize() {
    const c = this.stage.canvas;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.stage.resize(w, h);
  }

  /** Distance needed to fit a box of (w,h) mm on screen. */
  private fitDistance(w: number, h: number) {
    const cam = this.stage.camera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const dh = h / 2 / Math.tan(vfov / 2);
    const dw = w / 2 / (Math.tan(vfov / 2) * cam.aspect);
    return Math.max(dh, dw);
  }

  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 0, 160);

  private update(dt: number) {
    this.elapsed += dt;
    const cam = this.stage.camera;
    const portrait = cam.aspect < 0.9;

    // ---- camera framing per phase ----
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    if (this.phase === 'customize') {
      // brush shown in the upper part of the screen, above the selection panel
      const d = this.fitDistance(portrait ? 125 : 175, 60);
      const visH = 2 * d * tanHalf;
      const cx = portrait ? 50 : 58;
      this.camTarget.set(cx, -visH * 0.27, 0);
      this.camPos.set(cx, -visH * 0.27 + 25, d);
    } else if (this.phase === 'paste') {
      const d = this.fitDistance(portrait ? 62 : 90, 70);
      const visH = 2 * d * tanHalf;
      this.camTarget.set(2, 6 - visH * 0.1, 0);
      this.camPos.set(2, 6 - visH * 0.1 + d * 0.55, d * 0.85);
    } else {
      const both = this.focusUpper > 0.5 && this.focusLower > 0.5;
      const w = 54, h = both ? 44 : 40;
      // reserve room for UI bars
      this.camTarget.set(0, portrait ? -2 : 0, 0);
      this.camPos.set(0, portrait ? -2 : 0, this.fitDistance(w * 1.12, h * (portrait ? 1.5 : 1.3)));
    }
    cam.position.x = damp(cam.position.x, this.camPos.x, 4, dt);
    cam.position.y = damp(cam.position.y, this.camPos.y, 4, dt);
    cam.position.z = damp(cam.position.z, this.camPos.z, 4, dt);
    cam.lookAt(this.camTarget);

    // ---- model rotation / focus ----
    if (this.phase === 'home' || this.phase === 'done' || this.phase === 'spit') {
      if (this.mode !== 'rotate') { this.turntable += dt * 0.35; this.yawT = Math.sin(this.turntable) * 0.6; }
    }
    this.yaw = damp(this.yaw, this.yawT, 8, dt);
    this.pitch = damp(this.pitch, this.pitchT, 8, dt);
    this.model.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    const fu = this.phase === 'brush' && this.view === 'lower' ? 0 : 1;
    const fl = this.phase === 'brush' && this.view === 'upper' ? 0 : 1;
    this.focusUpper = damp(this.focusUpper, fu, 6, dt);
    this.focusLower = damp(this.focusLower, fl, 6, dt);
    this.jaws.upper.position.y = 6.5 + (1 - this.focusUpper) * 80;
    this.jaws.lower.position.y = -6.5 - (1 - this.focusLower) * 80;
    this.jaws.upper.visible = this.focusUpper > 0.05;
    this.jaws.lower.visible = this.focusLower > 0.05;
    const cy = this.view === 'upper' && this.phase === 'brush' ? -6.5 : this.view === 'lower' && this.phase === 'brush' ? 6.5 : 0;
    this.contentY = damp(this.contentY, cy, 6, dt);
    this.content.position.y = this.contentY;
    this.model.updateMatrixWorld(true);

    // ---- brush ----
    this.brush.update(dt, this.contact);
    this.paste.update(dt);
    if (this.phase === 'customize') this.updateShowcase(dt);
    else if (this.phase === 'paste') this.updatePaste(dt);
    else if (this.phase === 'brush') this.updateBrushing(dt);
    else if (this.phase === 'spit') this.updateSpit(dt);

    // tooth glow decay
    for (const t of this.jaws.teeth) {
      if (t.glow > 0) {
        t.glow = Math.max(0, t.glow - dt * 1.2);
        (t.mesh.material as THREE.MeshPhysicalMaterial & { userData: { uniforms: { uGlow: { value: number } } } }).userData.uniforms.uGlow.value = Math.sin(t.glow * Math.PI) * 0.8;
      }
    }
    this.foam.update(dt);
    this.food.update(dt);
    this.sparkles.update(dt);
  }

  private updateShowcase(dt: number) {
    const g = this.brush.group;
    // bristles up, gently rocking, viewed at an angle
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI + 0.35 + Math.sin(this.elapsed * 0.8) * 0.12, Math.sin(this.elapsed * 0.5) * 0.25, 0.05));
    g.quaternion.slerp(q, 1 - Math.exp(-6 * dt));
    g.position.lerp(new THREE.Vector3(0, 0, 0), 1 - Math.exp(-6 * dt));
  }

  private updatePaste(dt: number) {
    const g = this.brush.group;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI - 0.25, 0.08, 0.04));
    g.quaternion.slerp(q, 1 - Math.exp(-8 * dt));
    g.position.lerp(new THREE.Vector3(0, 0, 0), 1 - Math.exp(-8 * dt));
    if (this.squeezing) {
      // wall-clock based so slow devices squeeze at the same speed
      this.paste.setAmount(Math.min(1.3, this.squeezeBase + ((performance.now() - this.squeezeStart) / 1000) * 0.42));
      this.emit('pasteAmount', this.paste.amount);
    }
    // tube follows the end of the ribbon
    const len = 2 + this.paste.amount * 15;
    const nozzleLocal = new THREE.Vector3(8.5 - len, -4.6 - (this.squeezing ? 0 : 2.5), 0);
    const nozzleWorld = g.localToWorld(nozzleLocal.clone());
    const tg = this.tube.group;
    tg.position.lerp(nozzleWorld, 1 - Math.exp(-10 * dt));
    tg.rotation.set(0.15, 0, -1.05);
    const squash = this.squeezing ? 0.94 + Math.sin(this.elapsed * 20) * 0.01 : 1;
    tg.scale.set(0.5 / squash, 0.5 * squash, 0.5);
  }

  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();

  private updateBrushing(dt: number) {
    this.brushingTime += dt;
    const g = this.brush.group;
    const cam = this.stage.camera;
    this.pointerSpeed = Math.max(0, this.pointerSpeed - dt * 3);
    let target: THREE.Vector3;
    let normal: THREE.Vector3;
    this.contact = false;
    if (this.mode === 'brush' && this.pointerDown && this.pick()) {
      this.contact = true;
      target = this.hitPoint;
      normal = this.hitNormal;
    } else {
      // park the brush at the lower right, near the jaws' depth, bristles facing the jaws
      const ndcPark = new THREE.Vector3(cam.aspect < 0.9 ? 0.55 : 0.62, cam.aspect < 0.9 ? -0.45 : -0.35, 0.5).unproject(cam);
      const dir = ndcPark.sub(cam.position).normalize();
      target = cam.position.clone().addScaledVector(dir, cam.position.length() * 0.92);
      normal = new THREE.Vector3(-0.55, 0.1, 1).normalize();
    }
    // orientation: brush +Y = surface normal, handle (+X) points out of the mouth & towards the viewer
    const archCenter = this.content.localToWorld(this.tmpV.set(0, 0, -6));
    const out = target.clone().sub(archCenter);
    out.y *= 0.3;
    out.normalize().add(new THREE.Vector3(0, 0, 0.9)).add(new THREE.Vector3(0.35, 0, 0));
    const x = out.addScaledVector(normal, -out.dot(normal));
    if (x.lengthSq() < 1e-4) x.set(1, 0, 0).addScaledVector(normal, -normal.x);
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, normal).normalize();
    this.tmpM.makeBasis(x, normal, z);
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    this.brushQuat.slerp(this.tmpQ, 1 - Math.exp(-14 * dt));
    this.brushPos.lerp(target, 1 - Math.exp(-(this.contact ? 30 : 8) * dt));
    g.quaternion.copy(this.brushQuat);
    g.position.copy(this.brushPos);
    // manual brush: automatic scrubbing motion along the surface
    if (this.contact && this.brush.look.type === 'manual') {
      const t = this.elapsed * Math.PI * 2 * 3.2;
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
      const az = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      g.position.addScaledVector(ax, Math.sin(t) * 1.6).addScaledVector(az, Math.cos(t) * 0.9);
    }
    if (this.contact && this.brush.look.type === 'electric') {
      g.position.addScaledVector(normal, Math.sin(this.elapsed * 90) * 0.08);
    }

    if (this.contact !== this.wasActive) { this.wasActive = this.contact; this.emit('brushing', this.contact); }

    if (this.contact) {
      // paste smears into foam on first contact
      if (this.paste.mesh.visible) this.paste.mesh.visible = false;
      const electric = this.brush.look.type === 'electric';
      if (this.hitIsTooth) {
        const rate = (electric ? 2.6 : 1.7) * (0.75 + 0.5 * this.pointerSpeed);
        this.jaws.clean(this.hitPoint, this.hitNormal, electric ? 5.4 : 5.8, rate * dt);
      }
      this.food.brush(this.hitPoint, 6.5, dt * (electric ? 2.2 : 1.5), this.stage.scene);
      const intensity = this.paste.consume(dt, 0.011);
      const lp = this.content.worldToLocal(this.hitPoint.clone());
      const inv = new THREE.Matrix4().copy(this.content.matrixWorld).invert();
      const ln = this.hitNormal.clone().transformDirection(inv);
      this.foam.spawn(lp, ln, intensity, dt);
    }

    this.progressTimer += dt;
    if (this.progressTimer > 0.2) {
      this.progressTimer = 0;
      this.pushProgress();
    }
  }

  private pushProgress() {
    const list: SideProgress[] = [];
    let sum = 0;
    for (const t of this.jaws.teeth) {
      const p = this.jaws.sideProgress(t);
      if (!t.done) {
        const vals = [p.outer, p.inner, p.chewing];
        for (let s = 0; s < 3; s++) {
          if (!t.sideDone[s] && vals[s] >= this.cleanSnap) {
            t.sideDone[s] = true;
            // snap the rest of that side clean so it looks finished
            for (let k = 0; k < t.dirt.length; k++) if (t.sides[k] === s) t.dirt[k] = 0;
            (t.mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true;
          }
        }
        if (t.sideDone.every(Boolean)) {
          t.done = true;
          t.glow = 1;
          this.doneCount++;
          const c = t.mesh.geometry.boundingSphere!.center.clone().applyMatrix4(t.mesh.matrixWorld);
          this.sparkles.burst(c, 12, 9);
          this.emit('toothDone', t.index, this.doneCount);
        }
      }
      const q = this.jaws.sideProgress(t);
      const capped = { outer: t.sideDone[0] ? 1 : Math.min(q.outer / this.cleanSnap, 0.99), inner: t.sideDone[1] ? 1 : Math.min(q.inner / this.cleanSnap, 0.99), chewing: t.sideDone[2] ? 1 : Math.min(q.chewing / this.cleanSnap, 0.99), done: t.done };
      list.push(capped);
      sum += (capped.outer + capped.inner + capped.chewing) / 3;
    }
    const overall = sum / this.jaws.teeth.length;
    this.emit('progress', list, overall);
    if (this.phase === 'brush' && this.doneCount === this.jaws.teeth.length) {
      this.phase = 'spit'; // stop brushing immediately; App drives the rest
      this.contact = false;
      this.emit('brushing', false);
      this.emit('allClean');
    }
  }

  /** Which side still has the most dirt — used for voice hints. */
  dirtiestSide(): 'outer' | 'inner' | 'chewing' {
    const rem = [0, 0, 0];
    for (const t of this.jaws.teeth) {
      if (t.done) continue;
      for (let k = 0; k < t.dirt.length; k++) { const s = t.sides[k]; if (s < 3 && !t.sideDone[s]) rem[s] += t.dirt[k]; }
    }
    const i = rem.indexOf(Math.max(...rem));
    return i === SIDE_INNER ? 'inner' : i === SIDE_CHEWING ? 'chewing' : i === SIDE_OUTER ? 'outer' : 'outer';
  }

  private updateSpit(dt: number) {
    this.spitT += dt;
    this.foam.washing = Math.min(1, this.spitT / 2.2);
    // knock off any remaining food
    if (this.spitT > 0.3) this.food.brush(new THREE.Vector3(), 1e6, 10, this.stage.scene);
  }

  /** Debug helper: clean everything instantly (used by tests and the review toggle). */
  debugCleanAll() {
    for (const t of this.jaws.teeth) { t.dirt.fill(0); (t.mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true; }
    this.pushProgress();
  }

  /** Screen position (px) of a tooth's side, for automated tests. */
  debugToothScreen(index: number, side: 'outer' | 'inner' | 'chewing') {
    const t = this.jaws.teeth[index];
    const { h, t: th } = t.spec;
    const local = side === 'chewing' ? new THREE.Vector3(0, h * 0.95, 0) : new THREE.Vector3(0, h * 0.5, (side === 'outer' ? 1 : -1) * th * 0.5);
    const w = local.applyMatrix4(t.mesh.matrixWorld).project(this.stage.camera);
    const c = this.stage.canvas;
    return { x: (w.x * 0.5 + 0.5) * c.clientWidth, y: (-w.y * 0.5 + 0.5) * c.clientHeight };
  }
}
