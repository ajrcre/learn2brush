import * as THREE from 'three';

/** Shared GLSL: cheap 3D value noise + fbm, and an arbitrary-surface bump (normal perturbation). */
export const NOISE_GLSL = /* glsl */ `
float l2b_hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float l2b_noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(l2b_hash(i+vec3(0,0,0)),l2b_hash(i+vec3(1,0,0)),f.x),
                 mix(l2b_hash(i+vec3(0,1,0)),l2b_hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(l2b_hash(i+vec3(0,0,1)),l2b_hash(i+vec3(1,0,1)),f.x),
                 mix(l2b_hash(i+vec3(0,1,1)),l2b_hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float l2b_fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*l2b_noise(p); p*=2.03; a*=0.5; } return s; }
vec3 l2b_bump(vec3 n, vec3 viewPos, float h, float scale){
  vec3 dpx = dFdx(viewPos); vec3 dpy = dFdy(viewPos);
  float hx = dFdx(h); float hy = dFdy(h);
  vec3 r1 = cross(dpy, n); vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - scale * grad);
}
`;

export interface EnamelUniforms {
  uGlow: { value: number };
  uIncisal: { value: number };
  uTime: { value: number };
}

/** Tooth enamel: wet clearcoat, cervical→incisal colour gradient, fake translucency, plaque blended by per-vertex `dirt`. */
export function createEnamelMaterial(incisal = 1): THREE.MeshPhysicalMaterial & { userData: { uniforms: EnamelUniforms } } {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    ior: 1.62,
    specularIntensity: 0.7,
    sheen: 0.25,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xfff6ea),
  });
  const uniforms: EnamelUniforms = { uGlow: { value: 0 }, uIncisal: { value: incisal }, uTime: { value: 0 } };
  m.userData.uniforms = uniforms;
  m.customProgramCacheKey = () => 'l2b-enamel';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float dirt; attribute float crownT;
varying float vDirt; varying float vCrownT; varying vec3 vObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vDirt = dirt; vCrownT = crownT; vObjPos = position;
// plaque is a real raised layer, so it reads as "stuff" sitting on the tooth
transformed += objectNormal * dirt * 0.32;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGlow; uniform float uIncisal; uniform float uTime;
varying float vDirt; varying float vCrownT; varying vec3 vObjPos;
${NOISE_GLSL}
float l2b_plaque;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float n = l2b_fbm(vObjPos * 0.45);
  vec3 cerv = vec3(0.93, 0.85, 0.70);
  vec3 mid  = vec3(0.995, 0.985, 0.96);
  vec3 inc  = vec3(0.84, 0.88, 0.93);
  vec3 enamel = mix(cerv, mid, smoothstep(0.02, 0.45, vCrownT));
  enamel = mix(enamel, inc, smoothstep(0.78, 1.0, vCrownT) * uIncisal * 0.7);
  diffuseColor.rgb = enamel * (0.965 + 0.07 * n);
  float pn = l2b_fbm(vObjPos * 0.55 + 7.0);
  float speck = l2b_noise(vObjPos * 2.2 + 11.0);
  l2b_plaque = smoothstep(0.05, 0.32, vDirt * (0.65 + 0.7 * pn));
  // sticky yellow plaque with greenish patches and darker specks: easy to tell from clean white enamel
  vec3 plaqueCol = mix(vec3(0.95, 0.80, 0.22), vec3(0.66, 0.72, 0.20), smoothstep(0.45, 0.75, pn));
  plaqueCol *= 0.82 + 0.25 * smoothstep(0.25, 0.7, speck);
  plaqueCol = mix(plaqueCol, vec3(0.45, 0.36, 0.14), smoothstep(0.82, 0.92, speck) * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, plaqueCol, l2b_plaque);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.88, l2b_plaque);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // gentle enamel waviness + soft lumpy plaque
  float hh = l2b_fbm(vObjPos * 0.7) * 0.2 + l2b_plaque * l2b_fbm(vObjPos * 1.3 + 3.0) * 1.4;
  normal = l2b_bump(normal, -vViewPosition, hh, 0.15 + l2b_plaque * 0.6);
}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.clearcoat *= (1.0 - l2b_plaque);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// fake subsurface translucency lift + celebration glow
totalEmissiveRadiance += diffuseColor.rgb * (0.05 + 0.35 * uGlow);`);
  };
  return m as never;
}

/** Gums: wet, soft, stippled, with deeper colour at the tooth margin. Uses `gumT` (0 base → 1 margin). */
export function createGumMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.46,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xff6f80),
    specularIntensity: 0.5,
  });
  m.customProgramCacheKey = () => 'l2b-gum';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float gumT; varying float vGumT; varying vec3 vObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGumT = gumT; vObjPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vGumT; varying vec3 vObjPos;
${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float n = l2b_fbm(vObjPos * 0.9);
  vec3 base   = vec3(0.78, 0.24, 0.30);
  vec3 ridge  = vec3(0.92, 0.40, 0.44);
  vec3 margin = vec3(0.74, 0.18, 0.26);
  vec3 c = mix(base, ridge, smoothstep(0.35, 0.8, vGumT));
  c = mix(c, margin, smoothstep(0.9, 1.0, vGumT));
  // faint capillary variation
  c *= 0.93 + 0.12 * n;
  diffuseColor.rgb = c;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float hh = l2b_fbm(vObjPos * 1.6);
  normal = l2b_bump(normal, -vViewPosition, hh, 0.12);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vec3(0.12, 0.03, 0.03);`);
  };
  return m;
}
