import * as THREE from 'three';
import { GLITTER_GLSL } from '../patterns';

/**
 * Animal heads around the jaws. The head is a shell that starts at the gum line and grows away
 * from the teeth (the snout above the top teeth, the chin below the bottom ones), so every tooth
 * stays in view and can still be brushed. Head meshes are tagged `userData.head`: they block taps
 * and arrows but are never brushed.
 */
export interface HeadOptions {
  /** outline distance from the middle of the arch to the skin (just outside the gum) */
  offset: number;
  /** how far the head carries on behind the back teeth */
  back: number;
  /** where the skin starts, measured from the jaw's gum line (y = 0) away from the teeth */
  lip: number;
  /** height of the wall before the top curves over */
  wall: number;
  /** dome height at the front tip and at the back */
  domeFront: number;
  domeBack: number;
  /** distance from the gum line to the roof of the mouth / mouth floor */
  palate: number;
}

export interface JawArch {
  curve: THREE.CatmullRomCurve3;
  group: THREE.Group;
  /** +1: skin grows upwards (top jaw), −1: downwards (bottom jaw) */
  away: 1 | -1;
}

export interface SkinColors { top: string; dark: string; belly: string }

/** Reptile skin: scales with dark blotches, a pale belly underneath. */
export function createSkinMaterial(c: SkinColors, scale = 0.42) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.3, sheenColor: new THREE.Color(c.belly) });
  const u = { uTop: { value: new THREE.Color(c.top) }, uDark: { value: new THREE.Color(c.dark) }, uBelly: { value: new THREE.Color(c.belly) }, uScale: { value: scale } };
  m.customProgramCacheKey = () => 'l2b-skin';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPos; varying vec3 vSkinN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPos = position; vSkinN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTop; uniform vec3 uDark; uniform vec3 uBelly; uniform float uScale;
varying vec3 vSkinPos; varying vec3 vSkinN;
${GLITTER_GLSL}
float l2b_scale;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vSkinPos;
  l2b_scale = l2b_worley(p * uScale);
  float blotch = smoothstep(0.5, 0.68, l2b_fbm(p * 0.09 + 3.0));
  vec3 col = mix(uTop, uDark, blotch * 0.75);
  col = mix(col, uBelly, smoothstep(-0.35, -0.75, normalize(vSkinN).y));
  col *= 0.72 + 0.28 * smoothstep(0.05, 0.42, l2b_scale);
  diffuseColor.rgb = col;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = l2b_bump(normal, -vViewPosition, smoothstep(0.0, 0.5, l2b_scale), 0.5);`);
  };
  return m;
}

/** Points around the outside of one jaw, seen from above: arch + straight run behind the back teeth, closed across the back. */
function outline(arch: JawArch, o: HeadOptions, n = 120) {
  const { curve } = arch;
  const pts: THREE.Vector2[] = [];
  const tan0 = curve.getTangentAt(0), tan1 = curve.getTangentAt(1);
  const out = (t: THREE.Vector3) => new THREE.Vector3(-t.z, 0, t.x).normalize();
  const steps = 10;
  // right side, from behind the back teeth forward
  for (let i = steps; i > 0; i--) {
    const p = curve.getPointAt(0).addScaledVector(tan0, -(o.back * i) / steps).addScaledVector(out(tan0), o.offset);
    pts.push(new THREE.Vector2(p.x, p.z));
  }
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u).addScaledVector(out(curve.getTangentAt(u)), o.offset);
    pts.push(new THREE.Vector2(p.x, p.z));
  }
  for (let i = 1; i <= steps; i++) {
    const p = curve.getPointAt(1).addScaledVector(tan1, (o.back * i) / steps).addScaledVector(out(tan1), o.offset);
    pts.push(new THREE.Vector2(p.x, p.z));
  }
  // back edge, left → right
  const a = pts[pts.length - 1], b = pts[0];
  for (let i = 1; i < steps; i++) pts.push(a.clone().lerp(b, i / steps));
  return pts;
}

/** Shell: a wall from the lip line, then a roof that rounds over towards the middle line. */
function shell(pts: THREE.Vector2[], o: HeadOptions, away: number, mat: THREE.Material) {
  let zMin = Infinity, zMax = -Infinity;
  for (const p of pts) { zMin = Math.min(zMin, p.y); zMax = Math.max(zMax, p.y); }
  const R = 16; // rings over the roof
  const rings: { r: number; y: (z: number) => number }[] = [{ r: 1, y: () => o.lip }, { r: 1, y: () => o.lip + o.wall }];
  for (let k = 1; k <= R; k++) {
    const a = (k / R) * Math.PI * 0.5;
    const r = Math.cos(a);
    rings.push({ r: Math.max(r, 0.002), y: (z) => o.lip + o.wall + THREE.MathUtils.lerp(o.domeBack, o.domeFront, THREE.MathUtils.smoothstep(z, zMin, zMax)) * Math.sin(a) });
  }
  const P = pts.length;
  const pos = new Float32Array(rings.length * P * 3);
  rings.forEach((ring, k) => {
    pts.forEach((p, j) => {
      const i = (k * P + j) * 3;
      pos[i] = p.x * ring.r; // round over towards the middle line (x = 0)
      pos[i + 1] = ring.y(p.y) * away;
      pos[i + 2] = p.y;
    });
  });
  const idx: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < P; j++) {
    const a = k * P + j, b = k * P + ((j + 1) % P), c = (k + 1) * P + j, d = (k + 1) * P + ((j + 1) % P);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make the roof normal point away from the teeth; flip the winding if it came out inside-out
  const top = (rings.length - 2) * P + Math.floor(P * 0.3);
  if (g.getAttribute('normal').getY(top) * away < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return { mesh: m, zMin, zMax };
}

/** Roof of the mouth / mouth floor inside the arch, fading into a dark throat at the back. */
function mouthCap(pts: THREE.Vector2[], y: number, mat: THREE.Material, back: number, colors: [string, string]) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x * 0.98, p.y)));
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  const pos = g.getAttribute('position');
  let zMin = Infinity;
  for (let i = 0; i < pos.count; i++) zMin = Math.min(zMin, pos.getZ(i));
  const front = new THREE.Color(colors[0]), throat = new THREE.Color(colors[1]);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - THREE.MathUtils.smoothstep(pos.getZ(i), zMin + back * 0.3, zMin + back * 3);
    c.copy(front).lerp(throat, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

const tag = (o: THREE.Object3D) => { o.traverse(c => { c.userData.head = true; if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = true; }); return o; };

/** Alligator: long flat snout with raised eyes and nostrils on top, pale chin underneath. */
export function buildAlligatorHead(upper: JawArch, lower: JawArch) {
  const skin = createSkinMaterial({ top: '#5d8a3a', dark: '#36542a', belly: '#e9e0b0' });
  const mouth = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, clearcoat: 0.25, side: THREE.DoubleSide });
  const mouthColors: [string, string] = ['#ecc2a8', '#2e100d'];
  const meshes: THREE.Mesh[] = [];

  const top: HeadOptions = { offset: 3.9, back: 13, lip: 2.4, wall: 4.4, domeFront: 2.6, domeBack: 7.5, palate: 2.2 };
  const uPts = outline(upper, top);
  const u = shell(uPts, top, upper.away, skin);
  const palate = mouthCap(uPts, top.palate * upper.away, mouth, top.back, mouthColors);
  upper.group.add(tag(u.mesh), tag(palate));
  meshes.push(u.mesh, palate);

  // raised eyes near the back of the head, nostrils on a bump at the tip of the snout
  const crown = top.lip + top.wall + top.domeBack;
  const halfBack = Math.max(...uPts.filter(p => p.y < u.zMin + top.back).map(p => Math.abs(p.x)));
  const eyeball = new THREE.MeshPhysicalMaterial({ color: '#d9c22e', roughness: 0.2, clearcoat: 1, emissive: '#5a4a00', emissiveIntensity: 0.25 });
  const slit = new THREE.MeshBasicMaterial({ color: '#111111' });
  for (const s of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(3.6, 24, 16), skin);
    socket.scale.set(1, 0.75, 1.15);
    socket.position.set(s * halfBack * 0.42, crown - 1.6, u.zMin + top.back * 0.55);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), eyeball);
    eye.position.set(s * 0.9, 1.6, 0.9);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), slit);
    pupil.scale.set(0.28, 1.5, 0.6);
    pupil.position.set(s * 0.5, 0.25, 1.8);
    eye.add(pupil);
    socket.add(eye);
    upper.group.add(tag(socket));
    meshes.push(socket);
  }
  const tipZ = u.zMax;
  const noseY = top.lip + top.wall + top.domeFront;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14), skin);
  nose.scale.set(1.3, 0.7, 1);
  nose.position.set(0, noseY + 0.2, tipZ - 4.2);
  for (const s of [-1, 1]) {
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), slit);
    hole.scale.set(1, 0.6, 1.4);
    hole.position.set(s * 1.1, 1.7, 0.6);
    nose.add(hole);
  }
  upper.group.add(tag(nose));
  meshes.push(nose);
  // a few bony bumps along the snout
  for (let i = 0; i < 6; i++) {
    const z = THREE.MathUtils.lerp(u.zMin + top.back * 1.2, tipZ - 10, i / 5);
    for (const s of [-1, 1]) {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), skin);
      bump.scale.set(1, 0.6, 1.4);
      const f = THREE.MathUtils.smoothstep(z, u.zMin, u.zMax);
      bump.position.set(s * (2.2 + i * 0.1), top.lip + top.wall + THREE.MathUtils.lerp(top.domeBack, top.domeFront, f) * 0.96, z);
      upper.group.add(tag(bump));
      meshes.push(bump);
    }
  }

  // bottom jaw: flatter, pale underneath
  const bot: HeadOptions = { offset: 3.4, back: 9, lip: 2.4, wall: 3.6, domeFront: 1.6, domeBack: 3.4, palate: 2.4 };
  const lPts = outline(lower, bot);
  const l = shell(lPts, bot, lower.away, skin);
  const floor = mouthCap(lPts, bot.palate * lower.away, mouth, bot.back, mouthColors);
  lower.group.add(tag(l.mesh), tag(floor));
  meshes.push(l.mesh, floor);

  return meshes;
}

export interface FurColors {
  coat: string;
  /** colour towards the tip of the muzzle */
  muzzle: string;
  /** white stripe down the middle of the face (top surfaces only), from `blazeFrom` (z) forwards */
  blaze?: string;
}

export interface FurOptions {
  /** the coat blends into the muzzle colour over the last `muzzleLen` mm before `tipZ` */
  tipZ?: number;
  muzzleLen?: number;
  blazeFrom?: number;
  blazeWidth?: number;
}

/** Short soft fur: a fine strand texture, matte with a fuzzy sheen; optional pale muzzle and white blaze. */
export function createFurMaterial(c: FurColors, o: FurOptions = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.82, sheen: 0.8, sheenRoughness: 0.55, sheenColor: new THREE.Color(c.coat).lerp(new THREE.Color('#ffffff'), 0.5), specularIntensity: 0.3 });
  const u = {
    uCoat: { value: new THREE.Color(c.coat) }, uMuzzle: { value: new THREE.Color(c.muzzle) }, uBlaze: { value: new THREE.Color(c.blaze ?? c.coat) },
    uTipZ: { value: o.tipZ ?? 1e4 }, uMuzzleLen: { value: o.muzzleLen ?? 1 },
    uBlazeFrom: { value: c.blaze ? o.blazeFrom ?? -1e4 : 1e4 }, uBlazeWidth: { value: o.blazeWidth ?? 2.5 },
  };
  m.customProgramCacheKey = () => 'l2b-fur';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFurPos; varying vec3 vFurN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPos = position; vFurN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uCoat; uniform vec3 uMuzzle; uniform vec3 uBlaze;
uniform float uTipZ; uniform float uMuzzleLen; uniform float uBlazeFrom; uniform float uBlazeWidth;
varying vec3 vFurPos; varying vec3 vFurN;
${GLITTER_GLSL}
float l2b_fur;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vFurPos;
  // fine strands running front-to-back, plus a little clumping
  l2b_fur = l2b_noise(vec3(p.x * 2.6, p.y * 2.6, p.z * 0.55)) * 0.65 + l2b_noise(p * 1.3) * 0.35;
  vec3 col = uCoat * (0.94 + 0.12 * l2b_fbm(p * 0.12));
  float edge = uBlazeWidth * (0.85 + 0.3 * l2b_noise(p * 0.5));
  float blaze = (1.0 - smoothstep(edge, edge + 0.9, abs(p.x))) * smoothstep(0.2, 0.45, normalize(vFurN).y) * smoothstep(uBlazeFrom, uBlazeFrom + 3.0, p.z);
  col = mix(col, uBlaze, blaze);
  col = mix(col, uMuzzle, smoothstep(uTipZ - uMuzzleLen, uTipZ - uMuzzleLen * 0.35, p.z));
  col *= 0.86 + 0.2 * l2b_fur;
  diffuseColor.rgb = col;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = l2b_bump(normal, -vViewPosition, l2b_fur, 0.35);`);
  };
  return m;
}

/** A horn bud: a tube along `path` that tapers to a rounded tip, with growth rings. */
function horn(path: THREE.Curve<THREE.Vector3>, r0: number, mat: THREE.Material) {
  const T = 28, R = 14;
  const g = new THREE.TubeGeometry(path, T, 1, R, false);
  const pos = g.getAttribute('position');
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const s = Math.floor(i / (R + 1)) / T;
    path.getPointAt(s, c);
    const taper = r0 * (1 - 0.82 * Math.pow(s, 0.9)) * (1 + 0.06 * Math.sin(s * 40));
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(taper).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r0 * 0.19, 10, 8), mat);
  tip.position.copy(path.getPointAt(1));
  m.add(tip);
  return m;
}

/**
 * Goat kid (Boer-style colours: reddish-brown head, white blaze, pale muzzle).
 * A long muzzle around the teeth leads back to a rounded skull that carries the eyes (sideways-slot
 * pupils), long hanging ears and little horn buds; a goatee hangs under the chin. Like the alligator,
 * every part stays above the top gum line or below the bottom one, so all teeth can still be brushed.
 */
export function buildGoatHead(upper: JawArch, lower: JawArch) {
  const meshes: THREE.Mesh[] = [];
  const add = (group: THREE.Group, ...ms: THREE.Mesh[]) => { for (const m of ms) { group.add(tag(m)); meshes.push(m); } };
  const colors: FurColors = { coat: '#a9653b', muzzle: '#efe4d6', blaze: '#f8f2e8' };

  // muzzle around the top teeth; the offset clears the thick dental pad and the wide cheek teeth
  const top: HeadOptions = { offset: 5.4, back: 10, lip: 2.0, wall: 2.6, domeFront: 7.5, domeBack: 12, palate: 2.4 };
  const uPts = outline(upper, top);
  let tipZ = -Infinity, backZ = Infinity;
  for (const p of uPts) { tipZ = Math.max(tipZ, p.y); backZ = Math.min(backZ, p.y); }
  const fur = createFurMaterial(colors, { tipZ, muzzleLen: 10, blazeFrom: backZ + 6, blazeWidth: 2.6 });
  const u = shell(uPts, top, upper.away, fur);
  const mouth = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.3, side: THREE.DoubleSide });
  const palate = mouthCap(uPts, top.palate * upper.away, mouth, top.back, ['#e7a2a6', '#3a1416']);
  add(upper.group, u.mesh, palate);
  const halfAt = (pts: THREE.Vector2[], z: number) => Math.max(...pts.filter(p => Math.abs(p.y - z) < 2.5).map(p => Math.abs(p.x)));
  const roofY = (z: number) => top.lip + top.wall + THREE.MathUtils.lerp(top.domeBack, top.domeFront, THREE.MathUtils.smoothstep(z, u.zMin, u.zMax));

  // rounded skull at the back, sitting on the muzzle (its flat underside stays well above the gum line)
  const skullHalf = halfAt(uPts, backZ + 6) + 1.5;
  const skullR = new THREE.Vector3(skullHalf, 10.5, 15);
  const skullC = new THREE.Vector3(0, roofY(backZ + 8) - 2, backZ + 11);
  const floorY = top.lip + top.wall * 0.6;
  const skullGeo = new THREE.SphereGeometry(1, 48, 32);
  {
    const sp = skullGeo.getAttribute('position');
    for (let i = 0; i < sp.count; i++) {
      const y = Math.max(skullC.y + sp.getY(i) * skullR.y, floorY);
      sp.setXYZ(i, skullC.x + sp.getX(i) * skullR.x, y, skullC.z + sp.getZ(i) * skullR.z);
    }
    skullGeo.computeVertexNormals();
  }
  add(upper.group, new THREE.Mesh(skullGeo, fur));
  /** point on the skull surface in direction d (from its centre) */
  const onSkull = (d: THREE.Vector3, lift = 0) => {
    const n = d.clone().normalize();
    return skullC.clone().add(new THREE.Vector3(n.x * skullR.x, n.y * skullR.y, n.z * skullR.z)).addScaledVector(n, lift);
  };

  // nose pad on the front of the muzzle: pink-grey, a little shiny, slanted slit nostrils and the split lip
  const noseMat = new THREE.MeshPhysicalMaterial({ color: '#7d6262', roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const holeMat = new THREE.MeshBasicMaterial({ color: '#2a1517' });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), noseMat);
  nose.scale.set(3.6, 2.5, 1.3);
  nose.position.set(0, top.lip + top.wall + top.domeFront * 0.42, tipZ - 0.9);
  for (const s of [-1, 1]) {
    const hole = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), holeMat);
    hole.scale.set(0.17, 0.42, 0.16);
    hole.position.set(s * 0.45, 0.12, 0.9);
    hole.rotation.z = -s * 0.55; // "\ /": top ends apart
    nose.add(hole);
  }
  const split = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), holeMat);
  split.scale.set(0.05, 0.42, 0.08);
  split.position.set(0, -0.68, 0.74);
  nose.add(split);
  add(upper.group, nose);

  // big golden eyes on the front corners of the skull, looking out sideways and a little forwards
  const iris = new THREE.MeshPhysicalMaterial({ color: '#e7ad2f', roughness: 0.12, clearcoat: 1, emissive: '#6a4300', emissiveIntensity: 0.3 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: '#141010' });
  const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const s of [-1, 1]) {
    const dir = new THREE.Vector3(s * 0.78, 0.32, 0.55);
    const look = new THREE.Vector3(s, 0.12, 0.62).normalize();
    const eye = new THREE.Mesh(new THREE.SphereGeometry(3.2, 28, 18), iris);
    eye.position.copy(onSkull(dir, -1.1));
    eye.lookAt(eye.position.clone().add(look)); // +z = gaze
    const pupil = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 2.7, 4, 12), pupilMat);
    pupil.rotation.z = Math.PI / 2; // goats' pupils lie sideways
    pupil.scale.set(1, 1, 0.6);
    pupil.position.set(0, 0, 3.02);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), white);
    glint.position.set(-0.9 * s, 1.2, 2.8);
    eye.add(pupil, glint);
    // furry lid over the top of the eye
    const lid = new THREE.Mesh(new THREE.SphereGeometry(3.45, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.24), fur);
    lid.rotation.x = -0.1;
    eye.add(lid);
    add(upper.group, eye);
  }

  // long ears hanging down the sides of the head, pink inside
  const earInner = new THREE.MeshPhysicalMaterial({ color: '#e9aaa2', roughness: 0.6, sheen: 0.4, sheenColor: new THREE.Color('#ffd6cc') });
  const earGeo = new THREE.SphereGeometry(1, 28, 16);
  earGeo.translate(0, -1, 0); // hangs from its top
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, fur);
    ear.scale.set(1.7, 11, 4.2);
    const inner = new THREE.Mesh(earGeo, earInner);
    inner.scale.set(0.5, 0.86, 0.72);
    inner.position.set(-0.55 * s, -0.08, 0.1); // the side facing the head
    ear.add(inner);
    ear.position.copy(onSkull(new THREE.Vector3(s, 0.35, -0.15), -1.2));
    ear.rotation.set(-0.25, 0, s * 0.62); // hang outwards and slightly back
    add(upper.group, ear);
  }

  // little horn buds on top, curving back
  const hornMat = new THREE.MeshPhysicalMaterial({ color: '#cbb894', roughness: 0.5, clearcoat: 0.25 });
  for (const s of [-1, 1]) {
    const base = onSkull(new THREE.Vector3(s * 0.32, 0.9, 0.1), -0.8);
    const path = new THREE.QuadraticBezierCurve3(base, base.clone().add(new THREE.Vector3(s * 0.5, 4.2, -0.4)), base.clone().add(new THREE.Vector3(s * 1.4, 5.4, -4.4)));
    add(upper.group, horn(path, 1.9, hornMat));
  }

  // bottom jaw: a rounded chin with a pale front, then the goatee
  const bot: HeadOptions = { offset: 4.6, back: 8, lip: 2.0, wall: 2.4, domeFront: 4, domeBack: 5.5, palate: 2.6 };
  const lPts = outline(lower, bot);
  let chinZ = -Infinity;
  for (const p of lPts) chinZ = Math.max(chinZ, p.y);
  const chinFur = createFurMaterial(colors, { tipZ: chinZ, muzzleLen: 9 });
  const l = shell(lPts, bot, lower.away, chinFur);
  const floor = mouthCap(lPts, bot.palate * lower.away, mouth, bot.back, ['#e7a2a6', '#3a1416']);
  add(lower.group, l.mesh, floor);

  const beardMat = createFurMaterial({ coat: '#8a4f2c', muzzle: '#8a4f2c' });
  const beardZ = l.zMax - 8;
  const chinY = -(bot.lip + bot.wall + THREE.MathUtils.lerp(bot.domeBack, bot.domeFront, THREE.MathUtils.smoothstep(beardZ, l.zMin, l.zMax)));
  const tufts: [number, number, number, number][] = [[0, 0, 0, 1.35], [-1.2, -1.0, -0.6, 1.1], [1.2, -0.9, -0.5, 1.1], [0, -2.6, -1.1, 0.9]];
  for (const [x, dy, dz, k] of tufts) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(1.7 * k, 8.5 * k, 14, 4), beardMat);
    tuft.rotation.x = Math.PI + 0.35; // point down, swept back a bit
    tuft.position.set(x, chinY + dy - 3.6 * k, beardZ + dz);
    add(lower.group, tuft);
  }

  return meshes;
}
