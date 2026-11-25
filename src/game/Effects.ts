import * as THREE from 'three';
import { NOISE_GLSL } from './materials';

const BUBBLE_VS = /* glsl */ `
attribute float aSeed;
varying vec3 vN; varying vec3 vV; varying float vSeed;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BUBBLE_FS = /* glsl */ `
uniform float uTime; uniform vec3 uTint;
varying vec3 vN; varying vec3 vV; varying float vSeed;
vec3 thinFilm(float t){ return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
void main(){
  vec3 n = normalize(vN);
  float ndv = clamp(dot(n, vV), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  vec3 film = thinFilm(ndv * 1.4 + vSeed + uTime * 0.05);
  vec3 L = normalize(vec3(0.4, 0.8, 0.6));
  vec3 H = normalize(L + vV);
  float spec = pow(max(dot(n, H), 0.0), 90.0) * 2.2;
  float spec2 = pow(max(dot(n, normalize(vec3(-0.6, -0.2, 0.7) + vV)), 0.0), 40.0) * 0.6;
  vec3 col = mix(vec3(1.0), film, 0.55) * fres * 1.2 + vec3(spec + spec2);
  col = mix(col, col * uTint, 0.25);
  float a = clamp(fres * 0.85 + spec + spec2 + 0.04, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

interface Particle { pos: THREE.Vector3; nrm: THREE.Vector3; born: number; life: number; size: number; seed: number; alive: boolean }

/** Iridescent soap bubbles + soft foam clusters, stuck to the jaws (parent = jaw root). */
export class Foam {
  readonly group = new THREE.Group();
  private bubbles: THREE.InstancedMesh;
  private foam: THREE.InstancedMesh;
  private bubbleP: Particle[] = [];
  private foamP: Particle[] = [];
  private bubbleNext = 0;
  private foamNext = 0;
  private time = 0;
  private bubbleUniforms = { uTime: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } };
  readonly foamMat: THREE.MeshPhysicalMaterial;
  /** 0..1 wash-away animation for the spit step */
  washing = 0;
  onPop?: () => void;

  constructor(readonly maxBubbles = 220, readonly maxFoam = 450) {
    const bg = new THREE.SphereGeometry(1, 18, 12);
    const seeds = new Float32Array(maxBubbles).map(() => Math.random());
    bg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    const bm = new THREE.ShaderMaterial({
      vertexShader: BUBBLE_VS,
      fragmentShader: BUBBLE_FS,
      uniforms: this.bubbleUniforms,
      transparent: true,
      depthWrite: false,
    });
    this.bubbles = new THREE.InstancedMesh(bg, bm, maxBubbles);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 10;
    this.foamMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.3,
      transmission: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    });
    this.foamMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.18;`);
    };
    const fg = new THREE.IcosahedronGeometry(1, 2);
    this.foam = new THREE.InstancedMesh(fg, this.foamMat, maxFoam);
    this.foam.frustumCulled = false;
    this.foam.castShadow = false;
    for (let i = 0; i < maxBubbles; i++) this.bubbleP.push({ pos: new THREE.Vector3(), nrm: new THREE.Vector3(), born: 0, life: 0, size: 0, seed: Math.random(), alive: false });
    for (let i = 0; i < maxFoam; i++) this.foamP.push({ pos: new THREE.Vector3(), nrm: new THREE.Vector3(), born: 0, life: 0, size: 0, seed: Math.random(), alive: false });
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxBubbles; i++) this.bubbles.setMatrixAt(i, zero);
    for (let i = 0; i < maxFoam; i++) this.foam.setMatrixAt(i, zero);
    this.group.add(this.foam, this.bubbles);
  }

  setTint(color: string) {
    const c = new THREE.Color(color);
    // foam is mostly white, lightly tinted by the paste
    this.foamMat.color.set(0xffffff).lerp(c, 0.22);
    this.bubbleUniforms.uTint.value.copy(c);
  }

  clear() {
    for (const p of this.bubbleP) p.alive = false;
    for (const p of this.foamP) p.alive = false;
    this.washing = 0;
  }

  get foamCount() { return this.foamP.reduce((n, p) => n + (p.alive ? 1 : 0), 0); }

  /** Spawn at a point in jaw-local space with local normal. intensity 0..1 */
  spawn(localPos: THREE.Vector3, localNormal: THREE.Vector3, intensity: number, dt: number) {
    const foamRate = 40 * intensity, bubbleRate = 16 * intensity;
    let nf = foamRate * dt + Math.random();
    while (nf-- >= 1) {
      const p = this.foamP[this.foamNext];
      this.foamNext = (this.foamNext + 1) % this.maxFoam;
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
      jitter.addScaledVector(localNormal, -jitter.dot(localNormal));
      p.pos.copy(localPos).add(jitter).addScaledVector(localNormal, 0.3 + Math.random() * 1.6);
      p.nrm.copy(localNormal);
      p.born = this.time; p.life = 5 + Math.random() * 6; p.size = 0.35 + Math.random() * 0.75; p.alive = true;
    }
    let nb = bubbleRate * dt + Math.random() * 0.5;
    while (nb-- >= 1) {
      const p = this.bubbleP[this.bubbleNext];
      this.bubbleNext = (this.bubbleNext + 1) % this.maxBubbles;
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
      jitter.addScaledVector(localNormal, -jitter.dot(localNormal));
      p.pos.copy(localPos).add(jitter).addScaledVector(localNormal, 1 + Math.random() * 3);
      p.nrm.copy(localNormal);
      p.born = this.time; p.life = 2.5 + Math.random() * 5; p.size = 0.5 + Math.random() * 1.5; p.alive = true;
    }
  }

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();

  update(dt: number) {
    this.time += dt;
    this.bubbleUniforms.uTime.value = this.time;
    const t = this.time;
    const wash = this.washing;
    for (let i = 0; i < this.maxBubbles; i++) {
      const p = this.bubbleP[i];
      if (!p.alive) continue;
      const age = t - p.born;
      if (age > p.life || wash > 0.6) {
        p.alive = false;
        this.bubbles.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        if (Math.random() < 0.3) this.onPop?.();
        continue;
      }
      const grow = Math.min(1, age * 5);
      const wob = 1 + 0.06 * Math.sin(t * 9 + p.seed * 20);
      const sc = p.size * grow * wob;
      this.v.copy(p.pos).addScaledVector(p.nrm, age * 0.6);
      this.v.y += age * 0.8;
      this.s.set(sc, sc * (2 - wob), sc);
      this.bubbles.setMatrixAt(i, this.m4.compose(this.v, this.q, this.s));
    }
    for (let i = 0; i < this.maxFoam; i++) {
      const p = this.foamP[i];
      if (!p.alive) continue;
      const age = t - p.born;
      if (age > p.life && wash === 0) { p.alive = false; this.foam.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); continue; }
      const grow = Math.min(1, age * 6);
      const fade = Math.min(1, (p.life - age) / 1.5); // foam slowly settles away so the teeth stay visible
      let sc = p.size * grow * Math.max(0, fade) * (1 + 0.04 * Math.sin(t * 3 + p.seed * 10));
      this.v.copy(p.pos);
      if (wash > 0) {
        sc *= Math.max(0, 1 - wash * (1.2 + p.seed));
        this.v.y -= wash * wash * 60 * (0.5 + p.seed);
        if (sc <= 0.01) { p.alive = false; this.foam.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); continue; }
      }
      this.s.setScalar(sc);
      this.foam.setMatrixAt(i, this.m4.compose(this.v, this.q, this.s));
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
    this.foam.instanceMatrix.needsUpdate = true;
  }
}

/** Little star sparkles (sprites) for clean-tooth celebrations. */
export class Sparkles {
  readonly group = new THREE.Group();
  private items: { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number }[] = [];
  private tex: THREE.Texture;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,250,220,0.9)');
    grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 9 : 32;
      g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.fill();
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
  }

  burst(at: THREE.Vector3, count = 14, spread = 8) {
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false, color: new THREE.Color().setHSL(0.12 + Math.random() * 0.1, 0.8, 0.85) }));
      s.position.copy(at);
      s.renderOrder = 20;
      const v = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.3), (Math.random() - 0.5)).normalize().multiplyScalar(spread * (0.6 + Math.random()));
      this.group.add(s);
      this.items.push({ s, v, age: 0, life: 0.7 + Math.random() * 0.5 });
    }
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const f = it.age / it.life;
      if (f >= 1) { it.s.removeFromParent(); it.s.material.dispose(); this.items.splice(i, 1); continue; }
      it.s.position.addScaledVector(it.v, dt * (1 - f));
      const sc = 4 * Math.sin(f * Math.PI);
      it.s.scale.set(sc, sc, 1);
      it.s.material.rotation += dt * 3;
      it.s.material.opacity = 1 - f * f;
    }
  }
}
