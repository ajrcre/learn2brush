import * as THREE from 'three';
import { Stage, detectQuality } from './Stage';
import { Jaws, type SideProgress } from './jaws/Jaws';
import { SIDE_CHEWING, SIDE_INNER, SIDE_OUTER } from './jaws/toothGeometry';
import { Brush, type BrushLook } from './Brush';
import { Paste, createTube, type PasteLook } from './Paste';
import { Foam, Sparkles } from './Effects';
import { FoodBits } from './Food';
import { HelperArrows } from './HelperArrows';
import { SugarBugs } from './SugarBugs';

export type HintKind = 'outer' | 'inner' | 'chewing' | 'food' | 'bug';
export interface ScreenPos { x: number; y: number }

export type Phase = 'home' | 'customize' | 'paste' | 'brush' | 'spit' | 'done';
export type View = 'front' | 'upper' | 'lower';

export interface GameEvents {
  progress: (teeth: SideProgress[], overall: number) => void;
  toothDone: (index: number, doneCount: number, at: ScreenPos) => void;
  allClean: () => void;
  foodRemoved: (removed: number, total: number, at: ScreenPos) => void;
  bugPopped: (popped: number, total: number, at: ScreenPos) => void;
  brushing: (active: boolean) => void;
  pasteAmount: (amount: number) => void;
  bubblePop: () => void;
  rotated: () => void;
  /** helper arrows appeared (kind of the main spot) or were hidden (null) */
  hints: (kind: HintKind | null) => void;
  /** the jaws are turning by themselves to show a missed spot */
  autoTurn: () => void;
}

type Handlers = { [K in keyof GameEvents]?: GameEvents[K][] };

const damp = (a: number, b: number, k: number, dt: number) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-k * dt));

export class Game {
  readonly stage: Stage;
  jaws = new Jaws();
  readonly brush: Brush;
  readonly paste: Paste;
  readonly foam = new Foam();
  readonly food = new FoodBits();
  readonly sparkles = new Sparkles();
  readonly helpers = new HelperArrows(3);
  readonly bugs = new SugarBugs();
  private idle = 0;
  private hintState: 'none' | 'turning' | 'shown' = 'none';
  private turnTimer = 0;
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
  private readonly cleanSnap = 0.8;

  constructor(canvas: HTMLCanvasElement, brushLook: BrushLook, pasteLook: PasteLook) {
    this.stage = new Stage(canvas, detectQuality());
    const { scene } = this.stage;
    this.content.add(this.jaws.root, this.foam.group, this.food.group, this.helpers.group);
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
      this.emit('foodRemoved', this.food.total - this.food.remaining, this.food.total, this.toScreen(p));
    };
    this.bugs.onPopped = (p) => {
      this.sparkles.burst(p, 10, 7);
      this.emit('bugPopped', this.bugs.total - this.bugs.remaining, this.bugs.total, this.toScreen(p));
    };
    this.jaws.resetDirt(1);
    for (const t of this.jaws.teeth) { t.dirt.fill(0); (t.mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true; }

    this.bindInput(canvas);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    void this.stage.loadBackground('/img/bg.jpg');
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

  /** Swap in another animal's teeth (between rounds). */
  setJaw(id: string) {
    if (this.jaws.id === id) return;
    const old = this.jaws;
    this.food.reset(old, 0, 0);
    this.bugs.reset(old, 0, 0);
    this.foam.clear();
    this.clearHints();
    old.dispose();
    this.jaws = new Jaws(id);
    this.content.add(this.jaws.root);
    this.jaws.resetDirt(1);
    for (const t of this.jaws.teeth) { t.dirt.fill(0); (t.mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true; }
    this.doneCount = 0;
    this.setView(this.view);
    this.updateModel(100);
  }

  /** In the customiser's teeth tab, show the jaws instead of the brush. */
  private showcaseJaw = false;
  setShowcaseJaw(id: string | null) {
    this.showcaseJaw = !!id;
    if (id) this.setJaw(id);
    this.syncVisibility();
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
    this.syncVisibility();
    this.tube.group.visible = p === 'paste';
    this.paste.mesh.visible = p === 'paste';
    if (p === 'customize') this.setShowcasePaste(false);
    this.clearHints();
    if (p === 'paste') {
      this.paste.remaining = 1;
      this.paste.setAmount(0);
    }
    if (p === 'brush') this.startBrushing();
    if (p === 'spit') { this.spitT = 0; this.mode = 'none'; this.contact = false; this.bugs.clear(); }
    if (p === 'home' || p === 'done') this.setView('front');
  }

  private syncVisibility() {
    const p = this.phase;
    const jawShowcase = p === 'customize' && this.showcaseJaw;
    this.model.visible = p === 'home' || p === 'brush' || p === 'spit' || p === 'done' || jawShowcase;
    this.brush.group.visible = p !== 'home' && p !== 'done' && p !== 'spit' && !jawShowcase;
  }

  /** In the customiser, show a blob of paste on the brush so the colour can be previewed. */
  private showcasePaste = false;
  setShowcasePaste(on: boolean) {
    this.showcasePaste = on;
    if (this.phase !== 'customize') return;
    this.paste.remaining = 1;
    this.paste.setAmount(on ? 0.55 : 0);
    this.paste.mesh.visible = on;
  }

  /** New brushing session: dirty teeth, food, clear foam. */
  private startBrushing() {
    const seed = Math.floor(Math.random() * 1e6);
    this.jaws.resetDirt(seed);
    this.food.reset(this.jaws, seed + 5, 6);
    this.bugs.reset(this.jaws, seed + 9, 6);
    this.foam.clear();
    this.doneCount = 0;
    this.brushingTime = 0;
    this.setView('front');
    this.idle = 0;
    this.clearHints();
    this.pushProgress();
  }

  setView(v: View) {
    this.view = v;
    if (v === 'front') { this.yawT = this.jaws.species.frontYaw; this.pitchT = 0.12; }
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
    const targets: THREE.Object3D[] = [...this.jaws.toothMeshes.filter(m => m.parent!.visible), ...this.jaws.gums.filter(g => g.parent!.visible), ...this.jaws.occluders.filter(o => o.parent!.visible), ...this.food.meshes()];
    const hits = this.ray.intersectObjects(targets, false);
    const h = hits[0];
    if (!h || !h.face || h.object.userData.head) return false; // the head can't be brushed (drag turns it)
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
    const frame = this.jaws.species.frame;
    if (this.phase === 'customize' && this.showcaseJaw) {
      // jaws sit in the band between the category buttons and the carousel
      const d = this.fitDistance(frame.w * (portrait ? 1.25 : 2.2), frame.h * (portrait ? 3.1 : 4.8));
      const visH = 2 * d * tanHalf;
      const lift = portrait ? 0.1 : 0.17;
      this.camTarget.set(0, -visH * lift, 0);
      this.camPos.set(0, -visH * lift, d);
    } else if (this.phase === 'customize') {
      // brush shown in the upper part of the screen, above the selection panel
      // brush sits in the empty band between the category buttons and the carousel
      // frame the whole brush including shape parts on the end (star, flame, horn)
      const electric = this.brush.look.type === 'electric';
      const d = this.fitDistance((portrait ? 180 : 215) + (electric ? 45 : 0), portrait ? 150 : 125);
      const visH = 2 * d * tanHalf;
      const cx = (portrait ? 70 : 68) + (electric ? 22 : 0);
      const lift = portrait ? 0.07 : 0.1;
      this.camTarget.set(cx, -visH * lift, 0);
      this.camPos.set(cx, -visH * lift + 25, d);
    } else if (this.phase === 'paste') {
      const d = this.fitDistance(portrait ? 62 : 90, 70);
      const visH = 2 * d * tanHalf;
      this.camTarget.set(2, 6 - visH * 0.1, 0);
      this.camPos.set(2, 6 - visH * 0.1 + d * 0.55, d * 0.85);
    } else {
      const both = this.focusUpper > 0.5 && this.focusLower > 0.5;
      // seen from above/below, long snouts need room for their whole length
      const topDown = this.phase === 'brush' && this.view !== 'front';
      const w = frame.w, h = both ? frame.h : Math.max(frame.h - 4 - (frame.h - 44) * 0.5, topDown ? this.jaws.depth * 0.9 : 0);
      // reserve room for UI bars
      this.camTarget.set(0, portrait ? -2 : 0, 0);
      this.camPos.set(0, portrait ? -2 : 0, this.fitDistance(w * 1.12, h * (portrait ? 1.5 : 1.3)));
    }
    cam.position.x = damp(cam.position.x, this.camPos.x, 4, dt);
    cam.position.y = damp(cam.position.y, this.camPos.y, 4, dt);
    cam.position.z = damp(cam.position.z, this.camPos.z, 4, dt);
    cam.lookAt(this.camTarget);

    this.updateModel(dt);

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
    this.helpers.update(dt);
    this.bugs.update(dt, this.stage.camera);
  }

  private updateModel(dt: number) {
    if (this.phase === 'home' || this.phase === 'done' || this.phase === 'spit' || (this.phase === 'customize' && this.showcaseJaw)) {
      if (this.mode !== 'rotate') { this.turntable += dt * 0.35; this.yawT = this.jaws.species.frontYaw * 0.5 + Math.sin(this.turntable) * 0.6; }
    }
    this.yaw = damp(this.yaw, this.yawT, 8, dt);
    this.pitch = damp(this.pitch, this.pitchT, 8, dt);
    this.model.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    const fu = this.phase === 'brush' && this.view === 'lower' ? 0 : 1;
    const fl = this.phase === 'brush' && this.view === 'upper' ? 0 : 1;
    this.focusUpper = damp(this.focusUpper, fu, 6, dt);
    this.focusLower = damp(this.focusLower, fl, 6, dt);
    const open = this.jaws.species.open;
    this.jaws.upper.position.y = open + (1 - this.focusUpper) * 80;
    this.jaws.lower.position.y = -open - (1 - this.focusLower) * 80;
    this.jaws.upper.visible = this.focusUpper > 0.05;
    this.jaws.lower.visible = this.focusLower > 0.05;
    const cy = this.view === 'upper' && this.phase === 'brush' ? -open : this.view === 'lower' && this.phase === 'brush' ? open : 0;
    this.contentY = damp(this.contentY, cy, 6, dt);
    this.content.position.y = this.contentY;
    this.model.updateMatrixWorld(true);

  }

  private updateShowcase(dt: number) {
    const g = this.brush.group;
    // bristles up, gently rocking, viewed at an angle
    // bristles up when choosing toothpaste; otherwise show the back of the handle (where shape parts sit)
    const q = this.showcasePaste
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI + 0.45 + Math.sin(this.elapsed * 0.8) * 0.1, Math.sin(this.elapsed * 0.5) * 0.2, 0.1))
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55 + Math.sin(this.elapsed * 0.8) * 0.1, Math.sin(this.elapsed * 0.5) * 0.2, -0.1));
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
      normal = new THREE.Vector3(-1, 0.2, 0.3).normalize();
    }
    // orientation: brush +Y = surface normal, handle (+X) points out of the mouth & towards the viewer
    const archCenter = this.content.localToWorld(this.tmpV.set(...this.jaws.species.center));
    const out = target.clone().sub(archCenter);
    out.y *= 0.3;
    out.normalize().add(new THREE.Vector3(0.45, 0, 0.3));
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
        // tuned so a full clean takes about a minute for a 5-7 year old
        const rate = (electric ? 4.6 : 3.6) * (0.8 + 0.4 * this.pointerSpeed);
        this.jaws.clean(this.hitPoint, this.hitNormal, electric ? 7.5 : 8, rate * dt);
      }
      this.food.brush(this.hitPoint, 8, dt * (electric ? 3.2 : 2.4), this.stage.scene);
      this.bugs.brush(this.hitPoint, 7.5);
      const intensity = this.paste.consume(dt, 0.011);
      const lp = this.content.worldToLocal(this.hitPoint.clone());
      const inv = new THREE.Matrix4().copy(this.content.matrixWorld).invert();
      const ln = this.hitNormal.clone().transformDirection(inv);
      this.foam.spawn(lp, ln, intensity, dt);
    }

    this.updateHints(dt);

    this.progressTimer += dt;
    if (this.progressTimer > 0.2) {
      this.progressTimer = 0;
      this.pushProgress();
    }
  }

  /** World position → CSS pixels on the canvas. */
  toScreen(world: THREE.Vector3): ScreenPos {
    const v = world.clone().project(this.stage.camera);
    const r = this.stage.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  /** End the round early (2-minute timer ran out). */
  timeUp() {
    if (this.phase !== 'brush') return;
    this.contact = false;
    this.emit('brushing', false);
    this.startSpit();
  }

  get teethDone() { return this.doneCount; }

  // ---------- helper arrows ----------
  private clearHints() {
    if (this.hintState !== 'none' || this.helpers.visible) { this.helpers.hide(); this.emit('hints', null); }
    this.hintState = 'none';
  }

  private updateHints(dt: number) {
    if (this.contact || this.mode === 'rotate') { this.idle = 0; this.clearHints(); return; }
    this.idle += dt;
    const wait = this.brushingTime < 10 ? 6 : 3.5;
    if (this.hintState === 'none' && this.idle > wait) this.showHints(false);
    else if (this.hintState === 'turning') {
      this.turnTimer -= dt;
      if (this.turnTimer <= 0) this.showHints(true);
    }
  }

  private hintCandidates() {
    // spots are kept in the mesh's local space so they stay valid when the jaws turn
    type Cand = { kind: HintKind; priority: number; mesh: THREE.Object3D; space: THREE.Object3D; spots: { p: THREE.Vector3; n: THREE.Vector3 }[] };
    const cands: Cand[] = [];
    for (const b of this.bugs.live()) {
      cands.push({ kind: 'bug', priority: 2e6, mesh: b.tooth.mesh, space: b.tooth.mesh, spots: [{ p: b.group.position.clone(), n: b.normal.clone() }] });
    }
    for (const m of this.food.meshes()) {
      const n = (m.userData.normal as THREE.Vector3).clone();
      cands.push({ kind: 'food', priority: 1e6, mesh: m, space: this.food.group, spots: [{ p: m.position.clone(), n }] });
    }
    const kinds: HintKind[] = ['outer', 'inner', 'chewing'];
    for (const t of this.jaws.teeth) {
      if (t.done || !t.mesh.parent!.visible) continue;
      const pos = t.mesh.geometry.getAttribute('position');
      const nrm = t.mesh.geometry.getAttribute('normal');
      for (let s = 0; s < 3; s++) {
        if (t.sideDone[s]) continue;
        const ids: number[] = [];
        let rem = 0;
        for (let k = 0; k < t.dirt.length; k++) if (t.sides[k] === s && t.dirt[k] > 0.05) { ids.push(k); rem += t.dirt[k]; }
        if (rem < 1) continue;
        ids.sort((a, b) => t.dirt[b] - t.dirt[a]);
        const step = Math.max(1, Math.floor(ids.length / 10));
        const spots = [];
        for (let i = 0; i < ids.length && spots.length < 10; i += step) {
          const k = ids[i];
          spots.push({ p: new THREE.Vector3().fromBufferAttribute(pos, k), n: new THREE.Vector3().fromBufferAttribute(nrm, k) });
        }
        cands.push({ kind: kinds[s], priority: rem, mesh: t.mesh, space: t.mesh, spots });
      }
    }
    return cands.sort((a, b) => b.priority - a.priority).slice(0, 14);
  }

  /** A spot of this candidate that the child can see and tap right now, or null. */
  private visibleSpot(c: { mesh: THREE.Object3D; space: THREE.Object3D; spots: { p: THREE.Vector3; n: THREE.Vector3 }[] }) {
    const cam = this.stage.camera;
    if (!c.mesh.parent?.visible) return null;
    const targets: THREE.Object3D[] = [...this.jaws.toothMeshes.filter(m => m.parent!.visible), ...this.jaws.gums.filter(g => g.parent!.visible), ...this.jaws.occluders.filter(o => o.parent!.visible), ...this.food.meshes()];
    for (const local of c.spots) {
      const sp = { p: local.p.clone().applyMatrix4(c.space.matrixWorld), n: local.n.clone().transformDirection(c.space.matrixWorld) };
      const toCam = cam.position.clone().sub(sp.p).normalize();
      if (sp.n.dot(toCam) < 0.15) continue;
      const ndc = sp.p.clone().project(cam);
      // keep clear of the top bar and the bottom buttons
      if (Math.abs(ndc.x) > 0.85 || ndc.y > 0.62 || ndc.y < -0.55) continue;
      this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
      const h = this.ray.intersectObjects(targets, false)[0];
      if (!h || h.object !== c.mesh || h.point.distanceTo(sp.p) >= 2) continue;
      // the whole arrow (out to its tail) must be in clear view, not tucked behind other teeth
      // lay the arrow mostly across the screen so its shape reads clearly (not end-on to the camera)
      const n = sp.n.clone().addScaledVector(toCam, -sp.n.dot(toCam));
      if (n.lengthSq() < 0.05) n.copy(cam.up);
      n.normalize().addScaledVector(toCam, 0.35).normalize();
      const tail = sp.p.clone().addScaledVector(n, 18);
      const tailNdc = tail.clone().project(cam);
      if (Math.abs(tailNdc.x) > 0.9 || tailNdc.y > 0.7 || tailNdc.y < -0.6) continue;
      this.ray.set(cam.position, tail.clone().sub(cam.position).normalize());
      const th = this.ray.intersectObjects(targets, false)[0];
      if (th && th.distance < cam.position.distanceTo(tail) - 0.5) continue;
      return { p: sp.p, n };
    }
    return null;
  }

  private withPose<T>(view: View, yaw: number, pitch: number, fn: () => T): T {
    const saved = { view: this.view, yaw: this.yaw, pitch: this.pitch, yawT: this.yawT, pitchT: this.pitchT, fu: this.focusUpper, fl: this.focusLower, cy: this.contentY };
    this.view = view; this.yawT = yaw; this.pitchT = pitch;
    this.updateModel(100);
    this.model.updateMatrixWorld(true);
    const r = fn();
    Object.assign(this, { view: saved.view, yaw: saved.yaw, pitch: saved.pitch, yawT: saved.yawT, pitchT: saved.pitchT, focusUpper: saved.fu, focusLower: saved.fl, contentY: saved.cy });
    this.updateModel(0);
    this.model.updateMatrixWorld(true);
    return r;
  }

  private showHints(afterTurn: boolean) {
    const cands = this.hintCandidates();
    if (!cands.length) { this.hintState = 'shown'; return; }
    const chosen: { kind: HintKind; p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (const c of cands) {
      const v = this.visibleSpot(c);
      if (!v || chosen.some(o => o.p.distanceTo(v.p) < 9)) continue;
      chosen.push({ kind: c.kind, ...v });
      if (chosen.length >= 3) break;
    }
    if (chosen.length) {
      const inv = new THREE.Matrix4().copy(this.content.matrixWorld).invert();
      this.helpers.show(chosen.map(o => ({ point: o.p.clone().applyMatrix4(inv), normal: o.n.clone().transformDirection(inv) })));
      this.hintState = 'shown';
      this.emit('hints', chosen[0].kind);
      return;
    }
    if (afterTurn) { this.hintState = 'shown'; this.emit('hints', cands[0].kind); return; }
    // nothing visible: turn the jaws by themselves to show the most important spot
    const views: View[] = cands[0].kind === 'inner' || cands[0].kind === 'chewing'
      ? (this.jaws.teeth.find(t => t.mesh === cands[0].mesh)?.jaw === 'upper' ? ['upper', 'front', 'lower'] : ['lower', 'front', 'upper'])
      : ['front', 'upper', 'lower'];
    for (const v of views) {
      const base = v === 'front' ? 0.12 : v === 'upper' ? -1.05 : 1.05;
      for (const yaw of [0, -0.6, 0.6, -1.1, 1.1]) {
        const ok = this.withPose(v, yaw, base, () => cands.slice(0, 4).some(c => this.visibleSpot(c)));
        if (ok) {
          this.view = v; this.yawT = yaw; this.pitchT = base;
          this.hintState = 'turning';
          this.turnTimer = 1.0;
          this.emit('autoTurn');
          return;
        }
      }
    }
    this.hintState = 'shown';
    this.emit('hints', cands[0].kind);
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
          this.emit('toothDone', t.index, this.doneCount, this.toScreen(c));
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

  /**
   * Automated check: for each tooth side, is there a reachable pose (view preset + drag rotation)
   * where a tap lands directly on that side of that tooth? Returns unreachable entries.
   */
  debugReachability() {
    const saved = { view: this.view, yawT: this.yawT, pitchT: this.pitchT };
    const poses: [View, number, number][] = [];
    for (const v of ['front', 'upper', 'lower'] as View[])
      for (const yaw of [-1.4, -0.9, -0.45, 0, 0.45, 0.9, 1.4])
        for (const dp of [-0.25, 0, 0.25]) poses.push([v, yaw, dp]);
    const sides = ['outer', 'inner', 'chewing'] as const;
    const reach: boolean[][] = this.jaws.teeth.map(() => [false, false, false]);
    for (const [v, yaw, dp] of poses) {
      this.setView(v);
      this.yawT = yaw;
      this.pitchT = THREE.MathUtils.clamp(this.pitchT + dp, -1.25, 1.25);
      this.updateModel(100);
      this.model.updateMatrixWorld(true);
      const targets = [...this.jaws.toothMeshes.filter(m => m.parent!.visible), ...this.jaws.gums.filter(g => g.parent!.visible), ...this.jaws.occluders.filter(o => o.parent!.visible)];
      this.jaws.teeth.forEach((t, ti) => {
        if (!t.mesh.parent!.visible) return;
        const pos = t.mesh.geometry.getAttribute('position');
        sides.forEach((_, si) => {
          if (reach[ti][si]) return;
          // try several vertices of this side
          for (let k = 0; k < pos.count; k += 7) {
            if (t.sides[k] !== si) continue;
            const w = new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(t.mesh.matrixWorld);
            const ndc = w.clone().project(this.stage.camera);
            if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.9) continue;
            this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.stage.camera);
            const h = this.ray.intersectObjects(targets, false)[0];
            if (h && h.object === t.mesh && h.face && t.sides[h.face.a] === si) { reach[ti][si] = true; break; }
          }
        });
      });
    }
    this.view = saved.view; this.yawT = saved.yawT; this.pitchT = saved.pitchT;
    const missing: string[] = [];
    reach.forEach((r, ti) => r.forEach((ok, si) => { if (!ok) missing.push(`${ti}:${sides[si]}`); }));
    return missing;
  }

  /** Simulate brushing one side of one tooth directly (bypasses the pointer). */
  debugBrushSide(index: number, side: 'outer' | 'inner' | 'chewing', seconds = 2) {
    const t = this.jaws.teeth[index];
    const si = side === 'outer' ? SIDE_OUTER : side === 'inner' ? SIDE_INNER : SIDE_CHEWING;
    const pos = t.mesh.geometry.getAttribute('position');
    const nrm = t.mesh.geometry.getAttribute('normal');
    const steps = Math.round(seconds * 30);
    const ids: number[] = [];
    for (let k = 0; k < pos.count; k++) if (t.sides[k] === si) ids.push(k);
    for (let i = 0; i < steps; i++) {
      const k = ids[Math.floor((i / steps) * ids.length)];
      const p = new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(t.mesh.matrixWorld);
      const n = new THREE.Vector3().fromBufferAttribute(nrm, k).transformDirection(t.mesh.matrixWorld);
      this.jaws.clean(p, n, 5.8, 1.7 / 30);
    }
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
