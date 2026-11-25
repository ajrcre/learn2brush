import type { Lang } from '../config/economy';

/**
 * Web Audio player for sound effects, loops and voice lines.
 * Files live in /sfx/<id>.mp3 and /audio/<lang>/<id>.mp3 (only approved assets are copied there).
 * Missing files fail silently so the game still works before assets are approved.
 */
class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private voiceSrc?: AudioBufferSourceNode;
  private voiceBusyUntil = 0;
  private lastVoice = new Map<string, number>();
  enabled = true;
  lang: Lang = 'en';

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  private load(url: string) {
    if (!this.buffers.has(url)) {
      this.buffers.set(url, (async () => {
        try {
          if (!this.ctx) return null;
          const res = await fetch(url);
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('audio')) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch { return null; }
      })());
    }
    return this.buffers.get(url)!;
  }

  preload(ids: string[], voiceIds: string[]) {
    if (!this.ctx) return;
    ids.forEach(id => this.load(`/sfx/${id}.mp3`));
    voiceIds.forEach(id => this.load(`/audio/${this.lang}/${id}.mp3`));
  }

  async sfx(id: string, volume = 1, rate = 1) {
    if (!this.ctx || !this.master) return;
    const buf = await this.load(`/sfx/${id}.mp3`);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  async loop(id: string, on: boolean, volume = 0.6) {
    if (!this.ctx || !this.master) return;
    const cur = this.loops.get(id);
    if (on && cur) { cur.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05); return; }
    if (!on) {
      if (cur) { cur.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); const s = cur.src; setTimeout(() => { try { s.stop(); } catch { /* */ } }, 400); this.loops.delete(id); }
      return;
    }
    const placeholder = { src: this.ctx.createBufferSource(), gain: this.ctx.createGain() };
    this.loops.set(id, placeholder);
    const buf = await this.load(`/sfx/${id}.mp3`);
    if (!buf || this.loops.get(id) !== placeholder) return;
    const { src, gain } = placeholder;
    src.buffer = buf; src.loop = true;
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    src.connect(gain).connect(this.master);
    src.start();
  }

  /**
   * Speak a line. `priority` lines interrupt; others are skipped if something is already playing.
   * The same line isn't repeated within `cooldown` seconds.
   */
  async say(id: string, opts: { priority?: boolean; cooldown?: number } = {}) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const cd = opts.cooldown ?? 6;
    if ((this.lastVoice.get(id) ?? -1e9) + cd > now) return;
    if (!opts.priority && now < this.voiceBusyUntil) return;
    const buf = await this.load(`/audio/${this.lang}/${id}.mp3`);
    if (!buf) return;
    if (opts.priority && this.voiceSrc) { try { this.voiceSrc.stop(); } catch { /* */ } }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 1.1;
    src.connect(g).connect(this.master);
    src.start();
    this.voiceSrc = src;
    this.lastVoice.set(id, this.ctx.currentTime);
    this.voiceBusyUntil = this.ctx.currentTime + buf.duration + 0.4;
    // duck loops while talking
    for (const l of this.loops.values()) {
      const v = l.gain.gain.value;
      l.gain.gain.setTargetAtTime(v * 0.45, this.ctx.currentTime, 0.05);
      l.gain.gain.setTargetAtTime(v, this.ctx.currentTime + buf.duration, 0.2);
    }
  }
}

export const audio = new AudioEngine();

export function haptic(ms: number | number[]) {
  try { navigator.vibrate?.(ms); } catch { /* not supported (iOS) */ }
}
