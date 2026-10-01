// All sound is synthesized with WebAudio — no recorded assets. Filtered noise
// bursts for digging/steps/gunfire, little oscillator phrases for UI cues,
// positional playback through PannerNodes.

import * as THREE from 'three';
import { Block } from './blocks';

type Material = 'stone' | 'wood' | 'grass' | 'sand' | 'glass' | 'wool';

/** Sound material category for a block id. */
export function materialOf(block: number): Material {
  switch (block) {
    case Block.Stone: case Block.Cobblestone: case Block.Sandstone:
    case Block.Terracotta: case Block.Basalt:
    case Block.CarvedVaultBrick: case Block.MossyVaultBrick:
    case Block.EmberBrick: case Block.GildedVaultBrick:
    case Block.SoulLantern: case Block.EmberBrazier: case Block.GildedLamp:
    case Block.LuminousLimestone: case Block.PearlTile: case Block.IvoryColumn:
    case Block.SpectralMarble: case Block.JadeMosaic: case Block.FurnaceCeramic:
    case Block.OpalBrick: case Block.ClockworkGrate: case Block.VaultMosaic:
      return 'stone';
    case Block.OakLog: case Block.BirchLog: case Block.SpruceLog:
    case Block.CherryLog: case Block.CherryPlanks: case Block.OakPlanks:
      return 'wood';
    case Block.Sand:
      return 'sand';
    case Block.PrismBrick: case Block.PrismLamp: case Block.RuneGlass:
      return 'glass';
    case Block.TeamWoolA: case Block.TeamWoolB:
      return 'wool';
    default:
      return 'grass'; // dirt, grass, leaves, plants, snow...
  }
}

const MATERIAL_FREQ: Record<Material, number> = {
  stone: 700, wood: 380, grass: 950, sand: 2400, glass: 3200, wool: 500,
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  /** Head-relative sounds (UI cues, your own gun) enter here: dry to the
   *  effects bus plus a light reverb send. World sounds use `out(pos)`. */
  private fxIn: GainNode | null = null;
  /** Shared room: one convolver every sound sends into, so effects sit in a
   *  space instead of playing bone-dry straight into your ears. */
  private reverbIn: GainNode | null = null;
  private readonly listenerPos = new THREE.Vector3();
  private effectsVolume = GameAudio.savedVolume('effects', 0.8);

  private static savedVolume(key: string, fallback: number): number {
    try {
      const n = Number(localStorage.getItem(`voxelon.audio.${key}`));
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
    } catch { return fallback; }
  }

  /** Create/resume the context. Must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) {
      type AC = typeof AudioContext;
      const Ctor: AC = window.AudioContext ??
        (window as unknown as { webkitAudioContext: AC }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // Gentle glue on the whole mix: stacked transients (a burst of fire
      // over an explosion) get tamed rather than clipping into harsh crackle.
      const glue = new DynamicsCompressorNode(this.ctx, {
        threshold: -16, knee: 12, ratio: 3, attack: 0.004, release: 0.2,
      });
      this.master.connect(glue).connect(this.ctx.destination);
      this.effectsBus = this.ctx.createGain();
      this.effectsBus.gain.value = this.effectsVolume;
      this.effectsBus.connect(this.master);
      // Pink noise (Paul Kellet's filter), not white: white noise is mostly
      // treble and is exactly the fizzy "cheap synth" hiss. Two seconds long,
      // and every burst starts at a random offset so no two digs, steps or
      // shots are the same sample.
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      const reverb = new ConvolverNode(this.ctx, { buffer: this.roomImpulse(this.ctx, 1.7) });
      const wet = new GainNode(this.ctx, { gain: 0.9 });
      this.reverbIn = new GainNode(this.ctx, { gain: 1 });
      this.reverbIn.connect(reverb).connect(wet).connect(this.effectsBus);
      this.fxIn = new GainNode(this.ctx, { gain: 1 });
      this.fxIn.connect(this.effectsBus);
      this.fxIn.connect(new GainNode(this.ctx, { gain: 0.1 })).connect(this.reverbIn);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** A synthetic stereo room: decaying noise that darkens as it fades (high
   *  frequencies die first in a real space), decorrelated per channel for width. */
  private roomImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const pre = Math.floor(ctx.sampleRate * 0.012); // pre-delay before the first reflections
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        const k = 0.55 - t * 0.45;                  // one-pole lowpass, closing over time
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.pow(1 - t, 3.2) * 0.6;
      }
    }
    return buf;
  }

  setEffectsVolume(value: number): void {
    this.effectsVolume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.8));
    if (this.ctx) this.effectsBus?.gain.setTargetAtTime(this.effectsVolume, this.ctx.currentTime, 0.08);
    try { localStorage.setItem('voxelon.audio.effects', String(this.effectsVolume)); } catch { /* ignore */ }
  }

  updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    this.listenerPos.copy(p);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    }
  }

  /** Output chain: (panner?) -> master. */
  private out(pos?: THREE.Vector3): AudioNode {
    if (!pos || !this.ctx) return this.fxIn ?? this.effectsBus ?? this.master!;
    // Inverse falloff (how sound actually thins out) instead of a linear ramp
    // that cut to silence at 32 blocks, plus air absorption: distant sounds
    // lose their top end, so a far fight rumbles instead of ticking quietly.
    const dist = pos.distanceTo(this.listenerPos);
    const air = new BiquadFilterNode(this.ctx, {
      type: 'lowpass', Q: 0.5,
      frequency: Math.max(700, 16000 * Math.exp(-dist / 16)),
    });
    const panner = new PannerNode(this.ctx, {
      panningModel: dist < 24 ? 'HRTF' : 'equalpower',
      distanceModel: 'inverse',
      refDistance: 3,
      rolloffFactor: 1.1,
      maxDistance: 80,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    air.connect(panner).connect(this.effectsBus ?? this.master!);
    // Farther away = more room, less direct sound.
    if (this.reverbIn) {
      const send = new GainNode(this.ctx, { gain: Math.min(0.55, 0.18 + dist / 60) });
      air.connect(send).connect(this.reverbIn);
    }
    return air;
  }

  /** Band-filtered noise burst. */
  private noise(opts: {
    freq: number; dur: number; gain: number; pos?: THREE.Vector3;
    type?: BiquadFilterType; q?: number; delay?: number; slideTo?: number;
  }): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq, t0);
    if (opts.slideTo) {
      filter.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + opts.dur);
    }
    filter.Q.value = opts.q ?? 1.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
    src.connect(filter).connect(gain).connect(this.out(opts.pos));
    src.start(t0, Math.random() * (this.noiseBuf.duration - 0.5));
    src.stop(t0 + opts.dur + 0.05);
  }

  /** Oscillator sweep. */
  private tone(opts: {
    type: OscillatorType; from: number; to: number; dur: number; gain: number;
    pos?: THREE.Vector3; delay?: number; vibrato?: number; attack?: number;
  }): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    // World sounds drift a little in pitch so a repeated groan or impact never
    // sounds like the same beep fired twice. UI cues stay exact (they're
    // musical and must stay in tune).
    const drift = opts.pos ? 0.96 + Math.random() * 0.08 : 1;
    const from = opts.from * drift, to = opts.to * drift;
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + opts.dur);
    if (opts.vibrato) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = opts.vibrato;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = from * 0.06;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + opts.dur);
    }
    const gain = this.ctx.createGain();
    const attack = opts.attack ?? 0.01;
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
    // A raw square/saw is a wall of buzzy harmonics up to Nyquist — the
    // chiptune signature. Rolling it off a few octaves up keeps its bite but
    // makes it sound like an instrument rather than a beeper.
    let head: AudioNode = osc;
    if (opts.type === 'square' || opts.type === 'sawtooth') {
      head = osc.connect(new BiquadFilterNode(this.ctx, {
        type: 'lowpass', Q: 0.6,
        frequency: Math.min(9000, Math.max(from, to) * 4.5),
      }));
    }
    head.connect(gain).connect(this.out(opts.pos));
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  // --- game sounds -----------------------------------------------------------

  // Dig/place/step follow the same recipe as the softened gunshot: a low-passed
  // "thump" body carries the impact, and the material identity comes from a
  // QUIET bandpass layer — no loud raw bandpass hiss (it was painful on repeat,
  // especially sand/glass whose material frequencies sit at 2.4–3.2 kHz).

  dig(material: Material, pos?: THREE.Vector3): void {
    const f = MATERIAL_FREQ[material];
    this.noise({ freq: Math.min(f, 520), dur: 0.13, gain: 0.24, slideTo: 110, type: 'lowpass', q: 0.7, pos });
    this.noise({ freq: f * 0.7, dur: 0.08, gain: 0.07, q: 0.8, pos });
    if (material === 'stone' || material === 'wood') {
      this.tone({ type: 'triangle', from: 150, to: 65, dur: 0.09, gain: 0.14, pos });
    }
  }

  place(material: Material, pos?: THREE.Vector3): void {
    const f = MATERIAL_FREQ[material];
    this.noise({ freq: Math.min(f, 600), dur: 0.08, gain: 0.2, slideTo: 150, type: 'lowpass', q: 0.7, pos });
    this.noise({ freq: f * 0.75, dur: 0.05, gain: 0.06, q: 0.8, pos });
    this.tone({ type: 'triangle', from: 230, to: 120, dur: 0.06, gain: 0.09, pos });
  }

  step(material: Material): void {
    // Soft low pat with a little random pitch drift so repeated footsteps
    // don't machine-gun the exact same sample.
    const jitter = 0.88 + Math.random() * 0.24;
    this.noise({
      freq: Math.min(MATERIAL_FREQ[material] * 0.6, 420) * jitter,
      dur: 0.055, gain: 0.09, slideTo: 90, type: 'lowpass', q: 0.6,
    });
  }

  /** Taking damage: a soft, muffled "oof" — a low triangle thump + a brief
   *  low-passed noise body. No harsh sawtooth buzz (it was painful on repeat). */
  hurt(): void {
    this.tone({ type: 'triangle', from: 180, to: 95, dur: 0.16, gain: 0.16 });
    this.noise({ freq: 260, dur: 0.1, gain: 0.06, slideTo: 120, type: 'lowpass', q: 0.6 });
  }

  /** LOW HEALTH: a chest-thump pair, felt more than heard. `urgency` (0..1)
   *  tightens and hardens it as the bar empties, so how close you are to dying
   *  is audible while your eyes stay on the fight rather than the hearts. */
  heartbeat(urgency = 0): void {
    const u = Math.max(0, Math.min(1, urgency));
    const gain = 0.05 + u * 0.06;
    this.tone({ type: 'sine', from: 74 + u * 12, to: 40, dur: 0.16, gain });
    this.tone({ type: 'sine', from: 64 + u * 10, to: 36, dur: 0.19, gain: gain * 0.78, delay: 0.17 });
  }

  /** Hit confirmation for the SHOOTER: a crisp, tiny tick that cuts through
   *  sustained fire. Deliberately dry and short (under 60ms) so a burst reads
   *  as a run of distinct hits instead of a smear. A kill drops a second,
   *  lower note under it; a shot the target's armor ate is dulled and quieter,
   *  which is audible feedback that you're shooting a tank. Head-relative (no
   *  `pos`): it's UI, not something happening in the world. */
  hitmarker(killed = false, soaked = false): void {
    const top = soaked ? 900 : 1750;
    this.tone({
      type: 'square', from: top, to: top * 0.72,
      dur: 0.045, gain: soaked ? 0.05 : 0.085,
    });
    this.noise({ freq: soaked ? 1200 : 2600, dur: 0.02, gain: soaked ? 0.03 : 0.06, q: 1.4 });
    if (killed) {
      this.tone({ type: 'triangle', from: 620, to: 300, dur: 0.16, gain: 0.11, delay: 0.04 });
    }
  }

  /** Head-relative competitive cues for Duels. All route through the effects
   * bus, so the existing volume slider remains authoritative. */
  duelCue(kind: 'countdown' | 'fight' | 'lead' | 'final30' | 'sudden' | 'victory' | 'defeat'): void {
    switch (kind) {
      case 'countdown':
        // A struck-metal beat, not a beep: a short bright ping over a low thud.
        this.tone({ type: 'triangle', from: 520, to: 420, dur: 0.13, gain: 0.1 });
        this.tone({ type: 'sine', from: 150, to: 96, dur: 0.2, gain: 0.11 });
        this.noise({ freq: 2400, dur: 0.06, gain: 0.1, q: 1.4 });
        break;
      case 'fight':
        // The gate drops: a rising stab, a sub hit and a wash of air.
        this.tone({ type: 'square', from: 620, to: 980, dur: 0.2, gain: 0.09 });
        this.tone({ type: 'sawtooth', from: 310, to: 660, dur: 0.28, gain: 0.1, delay: 0.04 });
        this.tone({ type: 'sine', from: 120, to: 55, dur: 0.55, gain: 0.13 });
        this.noise({ freq: 1600, dur: 0.35, gain: 0.16, q: 0.5, slideTo: 300 });
        break;
      case 'lead':
        this.tone({ type: 'triangle', from: 520, to: 760, dur: 0.13, gain: 0.08 });
        break;
      case 'final30':
        this.tone({ type: 'square', from: 250, to: 210, dur: 0.14, gain: 0.08 });
        this.tone({ type: 'square', from: 250, to: 210, dur: 0.14, gain: 0.08, delay: 0.2 });
        break;
      case 'sudden':
        this.tone({ type: 'sawtooth', from: 190, to: 270, dur: 0.36, gain: 0.08 });
        this.tone({ type: 'square', from: 420, to: 315, dur: 0.24, gain: 0.07, delay: 0.16 });
        this.tone({ type: 'sine', from: 90, to: 62, dur: 0.9, gain: 0.09 });
        break;
      case 'victory':
        for (const [i, f] of [392, 523, 659, 784, 1047].entries()) {
          this.tone({ type: 'triangle', from: f, to: f * 1.03, dur: 0.3,
            gain: 0.1, delay: i * 0.1 });
          this.tone({ type: 'square', from: f * 2, to: f * 2.03, dur: 0.22,
            gain: 0.035, delay: i * 0.1 });
        }
        this.noise({ freq: 3200, dur: 0.7, gain: 0.1, q: 0.5 });
        break;
      case 'defeat':
        this.tone({ type: 'triangle', from: 330, to: 150, dur: 0.5, gain: 0.13 });
        break;
    }
  }

  /** Announcer stingers. Each beat is a short arpeggio whose interval and
   * timbre climb with how big a deal the call is, so a Godlike never sounds
   * like a Double Kill even with the music up. */
  duelAnnounce(kind: 'first_blood' | 'double_kill' | 'triple_kill' | 'quad_kill' |
    'spree' | 'rampage' | 'unstoppable' | 'godlike' | 'shutdown' | 'revenge' |
    'match_point'): void {
    const fanfare = (notes: number[], type: OscillatorType, gain: number, step = 0.075) => {
      for (const [i, f] of notes.entries()) {
        this.tone({ type, from: f, to: f * 1.02, dur: 0.2, gain, delay: i * step });
      }
    };
    switch (kind) {
      case 'first_blood':
        this.noise({ freq: 900, dur: 0.16, gain: 0.24, q: 1.1 });
        fanfare([294, 440], 'sawtooth', 0.085, 0.09);
        break;
      case 'double_kill': fanfare([440, 587], 'square', 0.075); break;
      case 'triple_kill': fanfare([440, 587, 740], 'square', 0.078); break;
      case 'quad_kill': fanfare([440, 587, 740, 880], 'square', 0.08); break;
      case 'spree': fanfare([392, 523, 659], 'triangle', 0.08); break;
      case 'rampage':
        fanfare([349, 523, 698], 'sawtooth', 0.075, 0.08);
        this.tone({ type: 'square', from: 110, to: 165, dur: 0.4, gain: 0.06 });
        break;
      case 'unstoppable':
        fanfare([330, 494, 659, 831], 'sawtooth', 0.07, 0.075);
        this.tone({ type: 'sine', from: 82, to: 123, dur: 0.55, gain: 0.075 });
        break;
      case 'godlike':
        fanfare([262, 392, 523, 784, 1047], 'sawtooth', 0.07, 0.08);
        this.tone({ type: 'sine', from: 65, to: 131, dur: 0.8, gain: 0.09 });
        this.noise({ freq: 2200, dur: 0.5, gain: 0.14, q: 0.6 });
        break;
      case 'shutdown':
        this.tone({ type: 'sawtooth', from: 520, to: 180, dur: 0.34, gain: 0.09 });
        this.noise({ freq: 480, dur: 0.22, gain: 0.2, q: 0.9 });
        break;
      case 'revenge':
        this.tone({ type: 'square', from: 210, to: 420, dur: 0.22, gain: 0.08 });
        this.tone({ type: 'triangle', from: 420, to: 630, dur: 0.24, gain: 0.07, delay: 0.14 });
        break;
      case 'match_point':
        fanfare([523, 523, 784], 'triangle', 0.08, 0.11);
        break;
    }
  }

  /** Gunshot: a soft body "thump" + a brief click — deliberately low on harsh
   *  high frequencies so rapid fire isn't piercing/painful to listen to. */
  gun(pos?: THREE.Vector3): void {
    const w = 0.85; // the Burst Rifle's weight: a crisp report, no sub or tail
    // Low-passed body (the punch), sliding down — no shrill hiss.
    this.noise({
      freq: 820 / w, dur: 0.07 * w, gain: 0.3 * w,
      slideTo: 180 / w, type: 'lowpass', q: 0.7, pos,
    });
    // A short, gentle mid click for definition (bandpass, low gain).
    this.noise({ freq: 1500, dur: 0.025, gain: 0.1, type: 'bandpass', q: 1, pos });
    // The muzzle crack: a few milliseconds of bright air, over before it can
    // turn into hiss. It is what makes a shot sound like a shot, not a thud.
    this.noise({ freq: 2800, dur: 0.012, gain: 0.12 * w, type: 'highpass', q: 0.7, pos });
    // Soft triangle thump (much smoother than a square wave).
    this.tone({
      type: 'triangle', from: 170 / w, to: 55 / w, dur: 0.07 * w, gain: 0.15 * w, pos,
    });
  }

  /** Working the action: cycling the bolt, dropping and seating magazines.
   *  Small, dry, mechanical — these land on the animation, not the trigger. */
  gunAction(kind: 'cycle' | 'magOut' | 'magIn'): void {
    switch (kind) {
      case 'cycle': // metal on metal, twice: back, then home
        this.noise({ freq: 2600, dur: 0.035, gain: 0.1, type: 'bandpass', q: 1.6 });
        this.tone({ type: 'square', from: 380, to: 190, dur: 0.045, gain: 0.05 });
        break;
      case 'magOut':
        this.noise({ freq: 1400, dur: 0.05, gain: 0.07, type: 'bandpass', q: 1.2 });
        this.tone({ type: 'triangle', from: 240, to: 120, dur: 0.07, gain: 0.05 });
        break;
      case 'magIn': // the satisfying one: a solid seated thunk
        this.noise({ freq: 700, dur: 0.07, gain: 0.13, slideTo: 200, type: 'lowpass', q: 0.8 });
        this.tone({ type: 'triangle', from: 300, to: 110, dur: 0.08, gain: 0.1 });
        break;
    }
  }

  /** Bounce Pad: spring compression, a rubbery launch note, then air rushing by. */
  bouncePad(): void {
    this.noise({ freq: 540, dur: 0.08, gain: 0.2, slideTo: 170, type: 'lowpass', q: 0.8 });
    this.tone({ type: 'sine', from: 150, to: 640, dur: 0.34, gain: 0.2, attack: 0.015 });
    this.tone({ type: 'triangle', from: 95, to: 280, dur: 0.22, gain: 0.13 });
    this.noise({ freq: 320, dur: 0.48, gain: 0.13, slideTo: 1500, type: 'bandpass', q: 0.5,
      delay: 0.04 });
  }

  /** Starting to apply the medkit: two latches thrown left-right, the lid's
   *  hinge and the zip of the inner pouch. The sound that says "you are
   *  committed". */
  healStart(): void {
    // Latch, latch: bright plastic clicks with a little body under each.
    for (const [i, f] of [[0, 2300], [1, 2000]] as const) {
      this.noise({ freq: f, dur: 0.035, gain: 0.16, q: 3, delay: i * 0.09 });
      this.tone({ type: 'square', from: 520 - i * 60, to: 240, dur: 0.04, gain: 0.06, delay: i * 0.09 });
    }
    // The lid swinging open on its hinge, then the pouch zip.
    this.tone({ type: 'triangle', from: 170, to: 125, dur: 0.18, gain: 0.08, delay: 0.2, vibrato: 18 });
    this.noise({ freq: 1400, dur: 0.26, gain: 0.07, slideTo: 3800, type: 'bandpass', q: 2.4, delay: 0.3 });
  }

  /** One "work" beat while the medkit is applied: a firm press — a padded
   *  thump plus a clicking ratchet and a rising note on a major scale, so the
   *  procedure climbs towards its end. */
  healBeat(step: number): void {
    const scale = [0, 2, 4, 7, 9, 12, 14];
    const f = 220 * 2 ** (scale[Math.min(scale.length - 1, step)] / 12);
    this.noise({ freq: 380, dur: 0.08, gain: 0.13, slideTo: 120, type: 'lowpass', q: 0.8 });
    this.noise({ freq: 3000, dur: 0.025, gain: 0.07, q: 4 });
    this.tone({ type: 'triangle', from: f * 2, to: f * 2, dur: 0.16, gain: 0.05, attack: 0.005 });
    this.tone({ type: 'sine', from: f, to: f, dur: 0.22, gain: 0.04, attack: 0.01 });
  }

  /** The medkit applied: a pressurised stim HISS, a deep double heartbeat as
   *  it takes, then a full major bloom with a sub swell and a shimmering
   *  arpeggio tail — the most rewarding non-combat sound in the kit. */
  heal(): void {
    // Stim: a pneumatic hiss falling through a band, plus the click of the
    // injector firing.
    this.noise({ freq: 5200, dur: 0.32, gain: 0.12, slideTo: 1400, type: 'bandpass', q: 0.9 });
    this.noise({ freq: 2600, dur: 0.03, gain: 0.14, q: 3 });
    // Lub-dub, lub-dub: the body taking it.
    for (const d of [0.16, 0.52]) {
      this.tone({ type: 'sine', from: 88, to: 42, dur: 0.18, gain: 0.2, delay: d });
      this.tone({ type: 'sine', from: 74, to: 36, dur: 0.2, gain: 0.15, delay: d + 0.16 });
    }
    // The bloom: C major opening upward, with a sub swell underneath.
    const chord = [261.6, 329.6, 392, 523.3, 659.3];
    chord.forEach((f, i) => {
      this.tone({ type: 'triangle', from: f, to: f, dur: 1.4 - i * 0.12, gain: 0.07, attack: 0.05, delay: 0.62 + i * 0.045 });
      this.tone({ type: 'sine', from: f * 2, to: f * 2, dur: 0.9, gain: 0.025, attack: 0.08, delay: 0.66 + i * 0.045 });
    });
    this.tone({ type: 'sine', from: 65, to: 131, dur: 1.2, gain: 0.12, attack: 0.25, delay: 0.55 });
    // A sparkling run up over the top, and the air brightening.
    [1047, 1319, 1568, 2093, 2637].forEach((f, i) =>
      this.tone({ type: 'sine', from: f, to: f * 1.01, dur: 0.22, gain: 0.03, delay: 0.8 + i * 0.07 }));
    this.noise({ freq: 1600, dur: 1.1, gain: 0.04, slideTo: 5000, type: 'bandpass', q: 0.6, delay: 0.62 });
  }

  /** Each point of health the heal buff restores: a tiny glassy sparkle.
   *  Successive points climb a pentatonic ladder, so the refill plays as a
   *  rising run you can hear filling the bar, like coins in a jar. */
  healTick(step: number): void {
    const penta = [0, 2, 4, 7, 9];
    const n = penta[step % 5] + 12 * Math.min(2, Math.floor(step / 5));
    const f = 523.3 * 2 ** (n / 12);
    this.tone({ type: 'sine', from: f, to: f * 1.005, dur: 0.14, gain: 0.04 });
    this.tone({ type: 'triangle', from: f * 2, to: f * 2, dur: 0.06, gain: 0.015 });
  }

  /** The medkit's afterglow: a slow, calm heartbeat under the regen, settling
   *  as you recover. `calm` 0..1 — how far through the buff you are. */
  healPulse(calm: number): void {
    const c = Math.max(0, Math.min(1, calm));
    const g = 0.07 * (1 - c * 0.6);
    this.tone({ type: 'sine', from: 70, to: 40, dur: 0.16, gain: g });
    this.tone({ type: 'sine', from: 60, to: 34, dur: 0.18, gain: g * 0.7, delay: 0.2 });
  }

  /** An interrupted application (slot switched away, killed mid-use). */
  healCancel(): void {
    this.tone({ type: 'triangle', from: 360, to: 190, dur: 0.14, gain: 0.08 });
    this.noise({ freq: 500, dur: 0.08, gain: 0.05, slideTo: 200, type: 'lowpass', q: 0.6 });
  }

  // --- Axe melee (The Bridge) -----------------------------------------------
  // Four beats that carry the whole combat read by ear: how charged the swing
  // was, whether it connected, whether it crit, and — the one that matters
  // most over a fourteen-block gap — that somebody is falling.

  /** The swing itself. Pitch rises with charge, so a patient full-charge cut
   *  sounds different from a spammed flick BEFORE it lands. */
  axeSwing(charge: number): void {
    const c = Math.max(0, Math.min(1, charge));
    this.noise({ freq: 420 + 520 * c, dur: 0.10 + 0.06 * c, gain: 0.10 + 0.10 * c,
      slideTo: 180, type: 'bandpass', q: 0.9 });
    this.tone({ type: 'triangle', from: 180 + 120 * c, to: 90, dur: 0.09, gain: 0.06 + 0.05 * c });
  }

  /** Contact. A crit adds a bright upper ring over the same thud, so the two
   *  read as the same weapon rather than two different ones. */
  axeHit(crit: boolean, pos?: THREE.Vector3): void {
    this.noise({ freq: 900, dur: 0.07, gain: 0.24, slideTo: 150, type: 'lowpass', q: 0.8, pos });
    this.tone({ type: 'triangle', from: 300, to: 96, dur: 0.14, gain: 0.19, pos });
    if (crit) {
      this.tone({ type: 'sine', from: 1720, to: 1180, dur: 0.20, gain: 0.09, pos });
      this.tone({ type: 'sine', from: 2400, to: 1900, dur: 0.12, gain: 0.05, pos });
    }
  }

  /** The release. A string snap over the shaft leaving; a full draw adds the
   *  low whump that says the shot was worth waiting for. */
  bowRelease(power: number): void {
    const p = Math.max(0, Math.min(1, power));
    this.noise({ freq: 1400 + 900 * p, dur: 0.09, gain: 0.12 + 0.12 * p, slideTo: 300, type: 'bandpass', q: 1.4 });
    this.tone({ type: 'triangle', from: 420 + 260 * p, to: 150, dur: 0.13, gain: 0.10 + 0.06 * p });
    if (p > 0.9) this.tone({ type: 'sine', from: 150, to: 62, dur: 0.3, gain: 0.12 });
  }

  /** An arrow arriving: a hard tock, brighter when it was a full-draw hit. */
  arrowHit(crit: boolean, pos?: THREE.Vector3): void {
    this.noise({ freq: 1100, dur: 0.06, gain: 0.2, slideTo: 200, type: 'bandpass', q: 1.1, pos });
    this.tone({ type: 'triangle', from: 520, to: 180, dur: 0.1, gain: 0.16, pos });
    if (crit) this.tone({ type: 'sine', from: 2100, to: 1500, dur: 0.18, gain: 0.08, pos });
  }

  // --- The Bridge: the whistle, the cage and the goal -------------------------

  /** One number of the 3-2-1: a clean arena beep that climbs a step each
   *  second, with a low drum under it, so the count is felt with eyes on the
   *  span. The restart after a goal plays it a touch lower. */
  bridgeCount(n: number, reset = false): void {
    const base = reset ? 440 : 523.3;
    const f = base * (n >= 3 ? 1 : n === 2 ? 1.122 : 1.26);
    this.tone({ type: 'square', from: f, to: f, dur: 0.16, gain: 0.07, attack: 0.004 });
    this.tone({ type: 'sine', from: f * 2, to: f * 2, dur: 0.12, gain: 0.03, attack: 0.004 });
    this.tone({ type: 'sine', from: 120, to: 60, dur: 0.18, gain: 0.14 });
  }

  /** GO: the hatch drops. A bright octave stab, a glassy shatter (the cage
   *  field coming down) and a whoosh — the loudest "start" in the game. */
  bridgeGo(): void {
    const f = 1046.5;
    this.tone({ type: 'square', from: f, to: f, dur: 0.34, gain: 0.07, attack: 0.004 });
    this.tone({ type: 'triangle', from: f / 2, to: f / 2, dur: 0.4, gain: 0.08, attack: 0.004 });
    this.tone({ type: 'sine', from: 150, to: 45, dur: 0.35, gain: 0.2 });
    this.noise({ freq: 5200, dur: 0.35, gain: 0.07, slideTo: 1600, type: 'bandpass', q: 1.2 });
    for (const [i, g] of [[0, 3100], [1, 3900], [2, 2500]] as const)
      this.tone({ type: 'sine', from: g, to: g * 0.94, dur: 0.22, gain: 0.03, delay: 0.02 + i * 0.035 });
    this.noise({ freq: 400, dur: 0.5, gain: 0.08, slideTo: 1800, type: 'bandpass', q: 0.6, delay: 0.05 });
  }

  /** A goal. Your side: a rising major fanfare over a crowd-like roar and a
   *  cymbal. Theirs: the same roar, but a falling minor answer — you know
   *  which way it went without looking at the board. Match point adds a bell. */
  bridgeGoal(ours: boolean, matchPoint = false): void {
    this.noise({ freq: 900, dur: 1.4, gain: 0.08, slideTo: 1400, type: 'bandpass', q: 0.35 }); // the roar
    this.noise({ freq: 6000, dur: 1.1, gain: 0.05, slideTo: 3000, type: 'highpass', q: 0.5, delay: 0.02 }); // cymbal
    this.tone({ type: 'sine', from: 110, to: 40, dur: 0.5, gain: 0.2 });
    const notes = ours ? [523.3, 659.3, 784, 1046.5] : [659.3, 587.3, 523.3, 440];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', from: f, to: f, dur: i === 3 ? 0.7 : 0.16, gain: 0.09, delay: i * 0.11 });
      this.tone({ type: 'square', from: f / 2, to: f / 2, dur: i === 3 ? 0.6 : 0.14, gain: 0.035, delay: i * 0.11 });
    });
    if (matchPoint) {
      for (let i = 0; i < 3; i++)
        this.tone({ type: 'sine', from: 1568, to: 1568, dur: 0.5, gain: 0.05, delay: 0.55 + i * 0.22 });
    }
  }

  /** You died in The Bridge: a hollow thud, a glassy shatter and a falling
   *  minor sigh. Others hear a softer, positioned version. */
  bridgeDeath(self: boolean, pos?: THREE.Vector3): void {
    const g = self ? 1 : 0.55;
    this.tone({ type: 'sine', from: 140, to: 34, dur: 0.5, gain: 0.22 * g, pos });
    this.noise({ freq: 3200, dur: 0.35, gain: 0.12 * g, slideTo: 500, type: 'bandpass', q: 0.8, pos });
    [523.3, 392, 311.1].forEach((f, i) =>
      this.tone({ type: 'triangle', from: f, to: f * 0.96, dur: 0.32, gain: 0.07 * g, delay: 0.08 + i * 0.13, pos }));
  }

  /** Back in the fight: a rising shimmer that resolves in a bright chime. */
  bridgeRespawn(self: boolean, pos?: THREE.Vector3): void {
    const g = self ? 1 : 0.55;
    this.noise({ freq: 700, dur: 0.5, gain: 0.05 * g, slideTo: 5200, type: 'bandpass', q: 0.7, pos });
    [392, 523.3, 659.3, 784].forEach((f, i) =>
      this.tone({ type: 'sine', from: f, to: f, dur: i === 3 ? 0.5 : 0.14, gain: 0.07 * g, delay: i * 0.07, pos }));
    this.tone({ type: 'sine', from: 90, to: 200, dur: 0.3, gain: 0.12 * g, pos });
  }

  // --- Dragon Chase ---------------------------------------------------------

  /** The dragon roars: a growling low sweep under a ragged, rasping breath. */
  dragonRoar(pos?: THREE.Vector3, gain = 1): void {
    this.tone({ type: 'sawtooth', from: 150, to: 58, dur: 1.5, gain: 0.16 * gain, attack: 0.12, vibrato: 11, pos });
    this.tone({ type: 'square', from: 96, to: 44, dur: 1.4, gain: 0.08 * gain, attack: 0.15, vibrato: 7, pos });
    this.noise({ freq: 700, dur: 1.5, gain: 0.2 * gain, slideTo: 260, type: 'bandpass', q: 0.5, pos });
    this.noise({ freq: 2400, dur: 1.1, gain: 0.06 * gain, slideTo: 900, type: 'bandpass', q: 0.8, pos, delay: 0.1 });
  }
  /** One beat of its wings: a heavy whump. */
  dragonWing(pos?: THREE.Vector3): void {
    this.noise({ freq: 260, dur: 0.35, gain: 0.14, slideTo: 90, type: 'lowpass', q: 0.7, pos });
    this.tone({ type: 'sine', from: 70, to: 38, dur: 0.3, gain: 0.08, pos });
  }
  /** It breathes: an intake, then the fireball leaves with a roaring whoosh. */
  dragonBreath(pos?: THREE.Vector3): void {
    this.noise({ freq: 500, dur: 0.4, gain: 0.07, slideTo: 1800, type: 'bandpass', q: 0.6, pos });
    this.noise({ freq: 1600, dur: 0.9, gain: 0.16, slideTo: 300, type: 'bandpass', q: 0.45, delay: 0.42, pos });
    this.tone({ type: 'sawtooth', from: 120, to: 70, dur: 0.6, gain: 0.07, delay: 0.42, vibrato: 14, pos });
  }
  /** A fireball comes down. */
  fireballImpact(pos?: THREE.Vector3, near = false): void {
    const g = near ? 1 : .6;
    this.tone({ type: 'sine', from: 120, to: 32, dur: 0.6, gain: 0.3 * g, pos });
    this.noise({ freq: 900, dur: 0.7, gain: 0.22 * g, slideTo: 140, type: 'lowpass', q: 0.8, pos });
    this.noise({ freq: 3000, dur: 0.45, gain: 0.07 * g, slideTo: 800, type: 'bandpass', q: 0.9, pos, delay: 0.05 });
  }
  /** You lost a life. */
  lifeLost(out: boolean): void {
    this.tone({ type: 'sine', from: 160, to: 36, dur: 0.55, gain: 0.24 });
    this.noise({ freq: 2400, dur: 0.3, gain: 0.08, slideTo: 400, type: 'bandpass', q: 0.8 });
    (out ? [392, 311.1, 261.6, 196] : [523.3, 392]).forEach((f, i) =>
      this.tone({ type: 'triangle', from: f, to: f * 0.97, dur: out ? 0.4 : 0.26, gain: 0.08, delay: 0.08 + i * 0.14 }));
  }
  /** You made it. */
  madeIt(): void {
    [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => {
      this.tone({ type: 'triangle', from: f, to: f, dur: i === 4 ? 0.9 : 0.16, gain: 0.09, delay: i * 0.1 });
      this.tone({ type: 'sine', from: f * 2, to: f * 2, dur: i === 4 ? 0.8 : 0.12, gain: 0.03, delay: i * 0.1 });
    });
    this.noise({ freq: 6000, dur: 1.2, gain: 0.05, slideTo: 3000, type: 'highpass', q: 0.5, delay: 0.3 });
  }

  /** A kill refilled you: the heal ladder run all the way up, capped by a
   *  warm two-note bell. */
  killHeal(): void {
    [0, 2, 4, 7, 9, 12, 14, 16].forEach((n, i) => {
      const f = 523.3 * 2 ** (n / 12);
      this.tone({ type: 'sine', from: f, to: f * 1.005, dur: 0.14, gain: 0.04, delay: i * 0.04 });
    });
    this.tone({ type: 'sine', from: 1046.5, to: 1046.5, dur: 0.5, gain: 0.06, delay: 0.3 });
    this.tone({ type: 'sine', from: 1568, to: 1568, dur: 0.6, gain: 0.05, delay: 0.38 });
    this.tone({ type: 'sine', from: 80, to: 55, dur: 0.22, gain: 0.14 });
  }

  /** Axe contact predicted on your own screen (the server confirms the damage
   *  a moment later). A tight, meaty chop — it has to land on the click. */
  axeContact(sprint: boolean, pos?: THREE.Vector3): void {
    this.noise({ freq: 1400, dur: 0.05, gain: 0.2, slideTo: 260, type: 'lowpass', q: 0.9, pos });
    this.tone({ type: 'triangle', from: 260, to: 90, dur: 0.11, gain: 0.18, pos });
    if (sprint) this.tone({ type: 'sine', from: 90, to: 45, dur: 0.16, gain: 0.16, pos });
  }

  /** Rat and Seek's sounds, all synthesised: squeaks, snaps, the cage, the
   *  cat, the chandelier, and the stings that mark the hunt. */
  rsCue(kind: import('./ratseek_rules').RsSound, pos?: THREE.Vector3): void {
    const t = (o: Parameters<GameAudio['tone']>[0]): void => this.tone({ ...o, pos: o.pos ?? pos });
    const n = (o: Parameters<GameAudio['noise']>[0]): void => this.noise({ ...o, pos: o.pos ?? pos });
    switch (kind) {
      case 'squeak':
        for (let i = 0; i < 3; i++) t({ type: 'sine', from: 2600 + i * 180, to: 3400 + i * 120, dur: 0.07, gain: 0.07, delay: i * 0.09, vibrato: 40 });
        break;
      case 'snap':
        n({ freq: 3200, dur: 0.05, gain: 0.3, type: 'highpass', q: 0.7 });
        t({ type: 'square', from: 900, to: 140, dur: 0.09, gain: 0.12 });
        break;
      case 'cage':
        t({ type: 'square', from: 180, to: 120, dur: 0.35, gain: 0.1 });
        n({ freq: 600, dur: 0.3, gain: 0.12, type: 'bandpass', q: 3 });
        break;
      case 'rescue':
        [523, 659, 784, 1046].forEach((f, i) => t({ type: 'triangle', from: f, to: f, dur: 0.18, gain: 0.08, delay: i * 0.09 }));
        break;
      case 'escape':
        [784, 988, 1175].forEach((f, i) => t({ type: 'sine', from: f, to: f * 1.01, dur: 0.16, gain: 0.08, delay: i * 0.07 }));
        break;
      case 'hunt':
        t({ type: 'sawtooth', from: 110, to: 70, dur: 1.1, gain: 0.12 });
        t({ type: 'square', from: 220, to: 140, dur: 0.9, gain: 0.05, delay: 0.1 });
        n({ freq: 300, dur: 1, gain: 0.08, slideTo: 90, type: 'lowpass', q: 0.5 });
        break;
      case 'intro':
        [196, 233, 294, 392].forEach((f, i) => t({ type: 'triangle', from: f, to: f, dur: 0.5, gain: 0.05, delay: i * 0.22 }));
        break;
      case 'tick': t({ type: 'square', from: 1200, to: 1200, dur: 0.05, gain: 0.05, attack: 0.002 }); break;
      case 'bell':
        t({ type: 'sine', from: 1318, to: 1310, dur: 0.6, gain: 0.07 });
        t({ type: 'sine', from: 2637, to: 2620, dur: 0.4, gain: 0.03 });
        break;
      case 'sniff':
        for (let i = 0; i < 3; i++) n({ freq: 2400, dur: 0.08, gain: 0.08, type: 'bandpass', q: 1.5, delay: i * 0.12 });
        break;
      case 'rattle':
        for (let i = 0; i < 6; i++) n({ freq: 1800 + i * 90, dur: 0.05, gain: 0.14, type: 'bandpass', q: 5, delay: i * 0.05 });
        break;
      case 'crash':
        n({ freq: 5000, dur: 0.5, gain: 0.2, slideTo: 800, type: 'bandpass', q: 0.6 });
        t({ type: 'sine', from: 90, to: 40, dur: 0.4, gain: 0.3 });
        [2400, 3100, 3700].forEach((f, i) => t({ type: 'sine', from: f, to: f * 0.9, dur: 0.3, gain: 0.04, delay: 0.02 * i }));
        break;
      case 'chain':
        for (let i = 0; i < 4; i++) n({ freq: 3600, dur: 0.04, gain: 0.07, type: 'bandpass', q: 6, delay: i * 0.07 });
        break;
      case 'pounce':
        n({ freq: 1400, dur: 0.35, gain: 0.14, slideTo: 3000, type: 'bandpass', q: 2 });
        t({ type: 'sawtooth', from: 500, to: 300, dur: 0.3, gain: 0.05 });
        break;
      case 'purr': t({ type: 'sawtooth', from: 26, to: 24, dur: 0.9, gain: 0.05, vibrato: 3 }); break;
      case 'meow': t({ type: 'triangle', from: 650, to: 420, dur: 0.45, gain: 0.07, vibrato: 12 }); break;
      case 'decoy':
        t({ type: 'sine', from: 3000, to: 3800, dur: 0.08, gain: 0.06 });
        n({ freq: 900, dur: 0.12, gain: 0.05, type: 'bandpass', q: 1 });
        break;
      case 'poof': n({ freq: 700, dur: 0.25, gain: 0.12, slideTo: 200, type: 'lowpass', q: 0.7 }); break;
      case 'cheese':
        // Bright two-note pickup chime (a rising fifth), sine with a soft octave shimmer.
        t({ type: 'sine', from: 988, to: 988, dur: 0.12, gain: 0.08, attack: 0.004 });
        t({ type: 'sine', from: 1480, to: 1480, dur: 0.22, gain: 0.08, delay: 0.07, attack: 0.004 });
        t({ type: 'triangle', from: 2960, to: 2960, dur: 0.16, gain: 0.02, delay: 0.07, attack: 0.004 });
        break;
      case 'dash':
        // A launch thump, a rising whoosh that falls away behind you, and a cheerful squeak.
        t({ type: 'sine', from: 150, to: 70, dur: 0.12, gain: 0.13, attack: 0.002 });
        n({ freq: 500, dur: 0.26, gain: 0.13, slideTo: 3200, type: 'bandpass', q: 0.7 });
        n({ freq: 3200, dur: 0.24, gain: 0.07, slideTo: 800, type: 'bandpass', q: 0.9, delay: 0.14 });
        t({ type: 'triangle', from: 950, to: 1800, dur: 0.1, gain: 0.06, attack: 0.004, delay: 0.02 });
        break;
      case 'twist':
        [440, 554, 659, 880].forEach((f, i) => t({ type: 'square', from: f, to: f, dur: 0.1, gain: 0.04, delay: i * 0.06 }));
        break;
      case 'alarm': for (let i = 0; i < 3; i++) t({ type: 'square', from: 880, to: 660, dur: 0.15, gain: 0.06, delay: i * 0.2 }); break;
      case 'click': t({ type: 'square', from: 2200, to: 1400, dur: 0.03, gain: 0.05, attack: 0.001 }); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => t({ type: 'triangle', from: f, to: f, dur: 0.3, gain: 0.08, delay: i * 0.1 })); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => t({ type: 'triangle', from: f, to: f * 0.98, dur: 0.35, gain: 0.07, delay: i * 0.14 })); break;
      case 'heartbeat': this.heartbeat(0.4); break;
      case 'drum': t({ type: 'sine', from: 120, to: 50, dur: 0.18, gain: 0.2 }); break;
    }
  }

}
