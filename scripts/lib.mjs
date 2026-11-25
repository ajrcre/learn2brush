// Build-time helpers. API keys are read from env and never shipped to the client.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MANIFEST = path.join(ROOT, 'assets/manifest.json');

export function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return { items: {} }; }
}
export function saveManifest(m) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}
export function hash(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 10);
}
/** Record an asset generation: prompt/settings/version/status. Keeps prior status unless inputs changed. */
export function record(m, id, entry) {
  const prev = m.items[id];
  const h = hash(entry.inputs);
  const changed = !prev || prev.hash !== h;
  m.items[id] = {
    ...prev,
    ...entry,
    hash: h,
    version: changed ? (prev?.version ?? 0) + 1 : prev.version,
    status: changed ? 'pending-review' : prev.status,
    generatedAt: changed ? new Date().toISOString() : prev.generatedAt,
  };
  return changed;
}

// ElevenLabs allows 3 concurrent requests on this plan.
let active = 0; const queue = [];
export function limit(fn, max = 3) {
  return new Promise((resolve, reject) => {
    const run = async () => { active++; try { resolve(await fn()); } catch (e) { reject(e); } finally { active--; queue.shift()?.(); } };
    active < max ? run() : queue.push(run);
  });
}

async function retry(fn, tries = 5) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { err = e; await new Promise(r => setTimeout(r, 1500 * 2 ** i)); }
  }
  throw err;
}

export async function elevenTTS({ voiceId, text, lang, model = 'eleven_v3', settings }) {
  return limit(() => retry(async () => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, language_code: lang, voice_settings: settings }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }));
}

export async function elevenSFX({ text, duration, influence = 0.5, loop = false }) {
  return limit(() => retry(async () => {
    const body = { text, prompt_influence: influence };
    if (duration) body.duration_seconds = duration;
    if (loop) body.loop = true;
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`SFX ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }));
}

export async function geminiImage({ prompt, model = 'gemini-3-pro-image', aspectRatio = '16:9' }) {
  return retry(async () => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
      }),
    });
    if (!res.ok) throw new Error(`IMG ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const j = await res.json();
    const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) throw new Error('No image in response: ' + JSON.stringify(j).slice(0, 400));
    return { buf: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType };
  });
}
