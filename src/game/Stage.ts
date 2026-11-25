import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer, EffectPass, RenderPass, SMAAEffect, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'high' | 'medium' | 'low';

export function detectQuality(): Quality {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || matchMedia('(pointer:coarse)').matches;
  if (mobile && (mem <= 3 || cores <= 4)) return 'low';
  if (mobile) return 'medium';
  return 'high';
}

/** Renderer, lights, environment and post-processing. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 5, 2000);
  readonly composer: EffectComposer;
  readonly key: THREE.DirectionalLight;
  private ao?: N8AOPostPass;
  quality: Quality;

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality = detectQuality()) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.scene.background = makeGradientBackground();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();

    // soft studio key + fill + rim
    this.key = new THREE.DirectionalLight(0xfff3e6, 2.4);
    this.key.position.set(40, 90, 110);
    this.key.castShadow = quality !== 'low';
    this.key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = this.key.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 400;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.25;
    this.key.shadow.radius = 4;
    this.scene.add(this.key);
    const fill = new THREE.DirectionalLight(0xdfeaff, 0.7);
    fill.position.set(-80, 10, 60);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(0, 40, -120);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xf2c6c6, 0.35));

    this.camera.position.set(0, 0, 160);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality !== 'low') {
      this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      this.ao.configuration.aoRadius = 3.5;
      this.ao.configuration.distanceFalloff = 1.2;
      this.ao.configuration.intensity = 2.2;
      this.ao.configuration.color = new THREE.Color(0x3a1c1c);
      this.ao.configuration.halfRes = quality !== 'high';
      this.ao.configuration.gammaCorrection = false;
      this.ao.setQualityMode(quality === 'high' ? 'Medium' : 'Low');
      this.composer.addPass(this.ao);
    }
    const effects = [
      new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.92, luminanceSmoothing: 0.15, mipmapBlur: true }),
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
      new VignetteEffect({ darkness: 0.25, offset: 0.35 }),
      new SMAAEffect(),
    ];
    this.composer.addPass(new EffectPass(this.camera, ...effects));
  }

  private bgTex?: THREE.Texture;

  /** Use an approved painted backdrop (if present), scaled to cover the viewport. */
  async loadBackground(url: string) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image')) return;
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.bgTex = tex;
      this.scene.background = tex;
      this.fitBackground();
    } catch { /* keep gradient */ }
  }

  private fitBackground() {
    const tex = this.bgTex;
    const img = tex?.image as { width: number; height: number } | undefined;
    if (!tex || !img) return;
    const viewAspect = this.camera.aspect;
    const imgAspect = img.width / img.height;
    if (viewAspect > imgAspect) {
      tex.repeat.set(1, imgAspect / viewAspect);
      tex.offset.set(0, (1 - tex.repeat.y) / 2);
    } else {
      tex.repeat.set(viewAspect / imgAspect, 1);
      tex.offset.set((1 - tex.repeat.x) / 2, 0);
    }
  }

  resize(w: number, h: number) {
    const maxDpr = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1.25;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitBackground();
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}

/** Fallback backdrop until the approved painted background is available. */
export function makeGradientBackground(top = '#cfeff0', bottom = '#9fd3ea') {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
