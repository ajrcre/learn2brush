import * as THREE from 'three';
import { NOISE_GLSL } from './materials';

/**
 * Procedural surface patterns for brush handles (and shape add-ons), plus a glitter-flake effect
 * that really sparkles (view-dependent flakes that also twinkle over time, bright enough to bloom).
 * Pattern space: object space in mm; x runs along the handle (0 → length), the handle axis is X.
 */
export type PatternId =
  | 'solid' | 'gradient' | 'rainbow' | 'flames' | 'tiger' | 'zebra' | 'leopard' | 'dalmatian'
  | 'pixelGrass' | 'pixelGem' | 'pixelLava' | 'galaxy' | 'glitter' | 'dinoSkin';

const PATTERN_INDEX: Record<PatternId, number> = {
  solid: 0, gradient: 1, rainbow: 2, flames: 3, tiger: 4, zebra: 5, leopard: 6, dalmatian: 7,
  pixelGrass: 8, pixelGem: 9, pixelLava: 10, galaxy: 11, glitter: 12, dinoSkin: 13,
};

export interface PatternOptions {
  pattern: PatternId;
  colors: string[];
  /** 0..1 glitter flake strength */
  glitter?: number;
  /** handle length along X in mm, for gradients/flames */
  length: number;
  /** sword: x below this is shiny metal blade (0 = none) */
  bladeEnd?: number;
  metalness?: number;
}

const HELPERS = /* glsl */ `
vec3 l2b_hash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float l2b_hash1(vec3 p){ return l2b_hash3(p).x; }
// 3D Worley: distance to nearest feature point (F1)
float l2b_worley(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); float d = 8.0;
  for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) for (int z=-1;z<=1;z++){
    vec3 g = vec3(float(x),float(y),float(z));
    vec3 o = l2b_hash3(i + g);
    d = min(d, length(g + o - f));
  }
  return d;
}
vec3 l2b_hsv(float h, float s, float v){ vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
/** Sparkly flakes: returns emissive sparkle given a flake-space position, view-space normal and view dir. */
vec3 l2b_glitter(vec3 p, vec3 n, vec3 viewDir, float time, vec3 tint){
  vec3 cell = floor(p);
  vec3 h = l2b_hash3(cell);
  vec3 h2 = l2b_hash3(cell + 17.0);
  float inFlake = step(0.35, h.z) * smoothstep(0.45, 0.22, length(fract(p) - 0.5));
  vec3 fn = normalize(n + (h2 - 0.5) * 1.6);
  vec3 L1 = normalize(vec3(0.35, 0.7, 0.6));
  vec3 L2 = normalize(vec3(-0.6, 0.2, 0.75));
  vec3 r = reflect(-viewDir, fn);
  float s = pow(max(dot(r, L1), 0.0), 28.0) + 0.6 * pow(max(dot(r, L2), 0.0), 28.0);
  float twinkle = pow(0.5 + 0.5 * sin(time * (3.0 + h.x * 5.0) + h.y * 40.0), 6.0);
  float amt = inFlake * (s * 9.0 + twinkle * 4.0);
  return mix(vec3(1.0), tint, 0.35) * amt;
}
`;

export const GLITTER_GLSL = NOISE_GLSL + HELPERS;

export interface PatternUniforms {
  uTime: { value: number };
  uPattern: { value: number };
  uC0: { value: THREE.Color }; uC1: { value: THREE.Color }; uC2: { value: THREE.Color }; uC3: { value: THREE.Color };
  uNColors: { value: number };
  uLen: { value: number };
  uGlitter: { value: number };
  uBladeEnd: { value: number };
}

export function createPatternMaterial(o: PatternOptions) {
  const cols = (o.colors.length ? o.colors : ['#ffffff']).map(c => new THREE.Color(c));
  while (cols.length < 4) cols.push(cols[cols.length - 1].clone());
  const metalPattern = o.pattern === 'glitter';
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: metalPattern ? 0.32 : o.pattern.startsWith('pixel') ? 0.55 : 0.22,
    metalness: o.metalness ?? (metalPattern ? 0.65 : 0),
    clearcoat: o.pattern.startsWith('pixel') ? 0.2 : 1,
    clearcoatRoughness: 0.08,
  });
  const uniforms: PatternUniforms = {
    uTime: { value: 0 },
    uPattern: { value: PATTERN_INDEX[o.pattern] },
    uC0: { value: cols[0] }, uC1: { value: cols[1] }, uC2: { value: cols[2] }, uC3: { value: cols[3] },
    uNColors: { value: Math.max(1, Math.min(4, o.colors.length)) },
    uLen: { value: o.length },
    uGlitter: { value: o.glitter ?? 0 },
    uBladeEnd: { value: o.bladeEnd ?? 0 },
  };
  m.userData.uniforms = uniforms;
  m.customProgramCacheKey = () => 'l2b-pattern';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPatPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPatPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform int uPattern; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform int uNColors; uniform float uLen; uniform float uGlitter; uniform float uBladeEnd;
varying vec3 vPatPos;
${GLITTER_GLSL}
float l2b_glow; float l2b_metal; float l2b_rough;
vec3 l2b_lin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 l2b_ramp(float t){
  t = clamp(t, 0.0, 1.0) * float(uNColors - 1);
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  return mix(uC2, uC3, t - 2.0);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vPatPos;
  float u = clamp(p.x / uLen, 0.0, 1.0);
  float a = atan(p.z, p.y);            // around the handle
  float va = a / 6.28318 + 0.5;
  float topness = cos(a);              // +1 on the back of the handle, -1 underneath
  vec3 col = uC0; l2b_glow = 0.0; l2b_metal = -1.0; l2b_rough = -1.0;
  if (uPattern == 1) { col = l2b_ramp(u); }
  else if (uPattern == 2) { col = pow(l2b_hsv(u * 1.2 + uTime * 0.04, 0.75, 1.0), vec3(2.2)); }
  else if (uPattern == 3) {
    // flames licking up from the end of the handle towards the head
    float n = l2b_fbm(vec3(p.y * 0.35, p.z * 0.35, p.x * 0.09 - uTime * 1.6));
    float n2 = l2b_noise(vec3(va * 9.0, p.x * 0.05 - uTime * 2.2, 3.0));
    float heat = (u - 0.3) * 1.25 + (n - 0.5) * 1.5 + (n2 - 0.5) * 0.5;
    vec3 base = uC0;
    col = base;
    col = mix(col, l2b_lin(vec3(0.85, 0.04, 0.0)), smoothstep(0.12, 0.2, heat));
    col = mix(col, l2b_lin(vec3(1.0, 0.32, 0.0)), smoothstep(0.36, 0.46, heat));
    col = mix(col, l2b_lin(vec3(1.0, 0.78, 0.1)), smoothstep(0.62, 0.72, heat));
    l2b_glow = smoothstep(0.3, 0.9, heat) * 0.35;
  }
  else if (uPattern == 4) {
    // tiger: orange with tapered black stripes, cream underside
    float w = l2b_fbm(p * 0.22) * 3.5;
    float s = sin(p.x * 0.5 + w + sin(a * 2.0) * 0.8);
    float taper = 0.55 + 0.25 * abs(sin(a));
    float stripe = smoothstep(taper, taper + 0.08, s);
    col = mix(l2b_lin(vec3(0.95, 0.52, 0.1)), l2b_lin(vec3(1.0, 0.92, 0.78)), smoothstep(-0.2, -0.8, topness));
    col = mix(col, l2b_lin(vec3(0.06, 0.05, 0.05)), stripe);
  }
  else if (uPattern == 5) {
    float w = l2b_fbm(p * 0.2) * 2.2;
    float s = sin(p.x * 0.62 + w + sin(a * 2.0) * 1.1);
    col = mix(l2b_lin(vec3(0.97)), l2b_lin(vec3(0.05)), smoothstep(0.05, 0.2, s));
  }
  else if (uPattern == 6) {
    // leopard rosettes
    vec3 q = p * 0.34 + l2b_fbm(p * 0.3) * 0.6;
    float d = l2b_worley(q);
    float ring = smoothstep(0.5, 0.42, d) - smoothstep(0.3, 0.22, d);
    col = l2b_lin(vec3(0.92, 0.7, 0.32));
    col = mix(col, l2b_lin(vec3(0.78, 0.5, 0.2)), smoothstep(0.32, 0.2, d));
    col = mix(col, l2b_lin(vec3(0.16, 0.09, 0.04)), ring);
  }
  else if (uPattern == 7) {
    float d = l2b_worley(p * 0.2 + l2b_fbm(p * 0.35) * 0.5);
    col = mix(l2b_lin(vec3(0.97)), l2b_lin(vec3(0.06)), smoothstep(0.38, 0.31, d));
  }
  else if (uPattern >= 8 && uPattern <= 10) {
    // pixel blocks: a chunky grid along and around the handle
    vec2 g = vec2(p.x / 2.4, va * 18.0);
    vec2 cell = floor(g);
    float r = l2b_hash1(vec3(cell, 1.0));
    float r2 = l2b_hash1(vec3(cell, 7.0));
    float edge = max(abs(fract(g.x) - 0.5), abs(fract(g.y) - 0.5));
    float cellTop = cos(((cell.y + 0.5) / 18.0 - 0.5) * 6.28318);
    if (uPattern == 8) {
      // grass block: green turf on the end of the handle with a jagged pixel edge, plus a few mossy pixels
      bool grass = (cell.x * 2.4 / uLen) > 0.68 - r2 * 0.08 - step(0.5, cellTop) * 0.05 || r2 > 0.965;
      vec3 g0 = l2b_lin(vec3(0.36, 0.63, 0.23)), g1 = l2b_lin(vec3(0.44, 0.72, 0.28)), g2 = l2b_lin(vec3(0.3, 0.54, 0.19));
      vec3 d0 = l2b_lin(vec3(0.48, 0.32, 0.19)), d1 = l2b_lin(vec3(0.55, 0.38, 0.22)), d2 = l2b_lin(vec3(0.37, 0.25, 0.14));
      col = grass ? (r < 0.33 ? g0 : r < 0.66 ? g1 : g2) : (r < 0.33 ? d0 : r < 0.66 ? d1 : d2);
      if (!grass && r2 > 0.92) col = l2b_lin(vec3(0.55));
    } else if (uPattern == 9) {
      col = r < 0.5 ? l2b_lin(vec3(0.11, 0.17, 0.23)) : r < 0.75 ? l2b_lin(vec3(0.16, 0.24, 0.31)) : r < 0.92 ? l2b_lin(vec3(0.21, 0.88, 0.83)) : l2b_lin(vec3(0.8, 1.0, 0.98));
      l2b_glow = r > 0.75 ? 0.35 : 0.0;
    } else {
      float f = fract(r + uTime * 0.25 * (0.5 + r2));
      col = f < 0.35 ? l2b_lin(vec3(0.55, 0.08, 0.02)) : f < 0.7 ? l2b_lin(vec3(1.0, 0.35, 0.02)) : f < 0.9 ? l2b_lin(vec3(1.0, 0.62, 0.05)) : l2b_lin(vec3(1.0, 0.9, 0.35));
      l2b_glow = 0.35 + f * 0.6;
    }
    col *= edge > 0.43 ? 0.8 : 1.0;   // block bevel
    l2b_rough = 0.6;
  }
  else if (uPattern == 11) {
    // galaxy: nebula clouds + stars
    float n = l2b_fbm(p * 0.12 + vec3(0.0, 0.0, uTime * 0.03));
    float n2 = l2b_fbm(p * 0.25 + 11.0);
    col = mix(l2b_lin(vec3(0.03, 0.03, 0.14)), l2b_lin(vec3(0.24, 0.08, 0.45)), smoothstep(0.35, 0.7, n));
    col = mix(col, l2b_lin(vec3(0.85, 0.25, 0.75)), smoothstep(0.6, 0.85, n2) * 0.7);
    col = mix(col, l2b_lin(vec3(0.2, 0.55, 0.95)), smoothstep(0.65, 0.9, n) * 0.4);
    vec3 sc = floor(p * 0.9);
    float star = step(0.93, l2b_hash1(sc)) * smoothstep(0.32, 0.0, length(fract(p * 0.9) - 0.5));
    float tw = 0.5 + 0.5 * sin(uTime * 4.0 + l2b_hash1(sc + 3.0) * 30.0);
    col += vec3(star * (0.6 + tw));
    l2b_glow = star * tw * 1.2 + 0.05;
  }
  else if (uPattern == 12) {
    float n = l2b_fbm(p * 0.3);
    col = mix(uC0, uC1, n);
    l2b_metal = 0.75; l2b_rough = 0.3;
  }
  else if (uPattern == 13) {
    // dinosaur skin: green scales with darker patches and a lighter belly
    float sc = l2b_worley(p * 0.55);
    float blotch = smoothstep(0.55, 0.7, l2b_fbm(p * 0.12 + 5.0));
    col = mix(uC0, uC1, blotch * 0.8);
    col = mix(col, uC2, smoothstep(-0.25, -0.75, topness) * 0.85);
    col *= 0.78 + 0.22 * smoothstep(0.05, 0.4, sc);   // darker grooves between scales
    l2b_rough = 0.5;
  }
  // sword: polished blade near the head
  if (uBladeEnd > 0.0 && p.x < uBladeEnd) {
    float fuller = smoothstep(0.35, 0.1, abs(p.z) / 4.0);
    col = mix(l2b_lin(vec3(0.86, 0.88, 0.92)), l2b_lin(vec3(0.62, 0.66, 0.72)), fuller);
    l2b_metal = 0.95; l2b_rough = 0.18; l2b_glow = 0.0;
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (l2b_rough >= 0.0) roughnessFactor = l2b_rough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (l2b_metal >= 0.0) metalnessFactor = l2b_metal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * l2b_glow;
if (uGlitter > 0.0) totalEmissiveRadiance += l2b_glitter(vPatPos * 0.8, normal, normalize(vViewPosition), uTime, diffuseColor.rgb) * uGlitter * 1.4;`);
  };
  return m as THREE.MeshPhysicalMaterial & { userData: { uniforms: PatternUniforms } };
}

/**
 * Add the glitter flakes to any physical material (toothpaste, bristles, add-ons).
 * `instanced` uses the per-instance position so instanced bristles each sparkle on their own.
 */
export function addGlitter(m: THREE.MeshPhysicalMaterial, amount: number, scale = 1.6, instanced = false, glow = 0) {
  const u = { uTime: { value: 0 }, uGlitter: { value: amount }, uSelfGlow: { value: glow } };
  m.userData.glitter = u;
  const prev = m.onBeforeCompile;
  const key = `l2b-glit-${instanced ? 1 : 0}`;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlitPos;')
      .replace('#include <begin_vertex>', instanced
        ? '#include <begin_vertex>\nvGlitPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;'
        : '#include <begin_vertex>\nvGlitPos = position;');
    // add only the helper code this shader doesn't already have
    let extra = '';
    if (!shader.fragmentShader.includes('float l2b_noise(')) extra += NOISE_GLSL;
    if (!shader.fragmentShader.includes('vec3 l2b_glitter(')) extra += HELPERS;
    if (extra) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${extra}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlitPos; uniform float uTime_g; uniform float uGlitter; uniform float uSelfGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * uSelfGlow;
totalEmissiveRadiance += l2b_glitter(vGlitPos * ${scale.toFixed(2)}, normal, normalize(vViewPosition), uTime_g, diffuseColor.rgb) * uGlitter;`);
    shader.uniforms.uTime_g = u.uTime;
  };
  return u;
}

/** Switch an existing pattern material to another pattern / colours (used when a shape brings its own skin). */
export function setPattern(m: THREE.Material, pattern: PatternId, colors: string[]) {
  const u = m.userData.uniforms as PatternUniforms | undefined;
  if (!u) return;
  u.uPattern.value = PATTERN_INDEX[pattern];
  const cols = colors.map(c => new THREE.Color(c));
  while (cols.length < 4) cols.push(cols[cols.length - 1].clone());
  u.uC0.value.copy(cols[0]); u.uC1.value.copy(cols[1]); u.uC2.value.copy(cols[2]); u.uC3.value.copy(cols[3]);
  u.uNColors.value = Math.min(4, colors.length);
  u.uGlitter.value = 0;
}
