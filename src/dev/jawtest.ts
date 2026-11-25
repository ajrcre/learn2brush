import * as THREE from 'three';
import { Stage } from '../game/Stage';
import { HumanJaws } from '../game/jaws/HumanJaws';
const canvas = document.querySelector('canvas')!;
const stage = new Stage(canvas);
const jaws = new HumanJaws();
jaws.resetDirt(3);
stage.scene.add(jaws.root);
const params = new URLSearchParams(location.search);
const yaw = Number(params.get('yaw') ?? 0.5), pitch = Number(params.get('pitch') ?? 0.25);
const dirt = params.get('dirt') !== '0';
if (!dirt) for (const t of jaws.teeth) { t.dirt.fill(0); (t.mesh.geometry.getAttribute('dirt') as THREE.BufferAttribute).needsUpdate = true; }
jaws.root.rotation.set(pitch, yaw, 0);
const dist = Number(params.get('dist') ?? 130);
stage.camera.position.set(0, 0, dist);
stage.resize(innerWidth, innerHeight);
stage.render(0.016);
requestAnimationFrame(() => { stage.render(0.016); (window as any).__ready = true; });
