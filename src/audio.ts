// M8: all sound is synthesized with WebAudio — no recorded assets.
// Filtered noise bursts for digging/steps/explosions, little oscillator
// phrases for mob voices, positional playback through PannerNodes.

import * as THREE from 'three';
import { Block } from './blocks';

export type Material = 'stone' | 'wood' | 'grass' | 'sand' | 'glass' | 'wool';

/** Sound material category for a block id. */
export function materialOf(block: number): Material {
  switch (block) {
    case Block.Stone: case Block.Cobblestone: case Block.Sandstone:
    case Block.Bedrock: case Block.CoalOre: case Block.IronOre:
    case Block.GoldOre: case Block.RedstoneOre: case Block.DiamondOre:
    case Block.Furnace: case Block.FurnaceLit:
      return 'stone';
    case Block.OakLog: case Block.BirchLog: case Block.SpruceLog:
    case Block.JungleLog: case Block.CherryLog:
    case Block.JunglePlanks: case Block.CherryPlanks:
    case Block.OakPlanks: case Block.CraftingTable: case Block.Torch:
    case Block.TorchPX: case Block.TorchNX: case Block.TorchPZ:
    case Block.TorchNZ:
    case Block.Lever: case Block.LeverOn:
    case Block.FallTrap: case Block.FallTrapOpen:
      return 'wood';
    case Block.RespawnBeacon: case Block.WaypointTotem:
    case Block.VaultBrick: case Block.VaultChest:
    case Block.WallTrap: case Block.WallTrapUp:
      return 'stone';
    case Block.Sand:
      return 'sand';
    case Block.Glass: case Block.CrystalBlock:
      return 'glass';
    case Block.Wool:
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
  private noiseBuf: AudioBuffer | null = null;
  private readonly listenerPos = new THREE.Vector3();

  /** Create/resume the context. Must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) {
      type AC = typeof AudioContext;
      const Ctor: AC = window.AudioContext ??
        (window as unknown as { webkitAudioContext: AC }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
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
    if (!pos || !this.ctx) return this.master!;
    const panner = new PannerNode(this.ctx, {
      distanceModel: 'linear',
      refDistance: 2,
      maxDistance: 32,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    panner.connect(this.master!);
    return panner;
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
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  /** Oscillator sweep. */
  private tone(opts: {
    type: OscillatorType; from: number; to: number; dur: number; gain: number;
    pos?: THREE.Vector3; delay?: number; vibrato?: number; attack?: number;
  }): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    if (opts.vibrato) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = opts.vibrato;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = opts.from * 0.06;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + opts.dur);
    }
    const gain = this.ctx.createGain();
    const attack = opts.attack ?? 0.01;
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
    osc.connect(gain).connect(this.out(opts.pos));
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

  eatTick(): void {
    this.noise({ freq: 1300, dur: 0.07, gain: 0.3, q: 0.8 });
    this.tone({ type: 'triangle', from: 320, to: 180, dur: 0.06, gain: 0.12 });
  }

  splash(): void {
    this.noise({ freq: 1500, dur: 0.4, gain: 0.35, slideTo: 400, q: 0.7 });
  }

  poof(pos?: THREE.Vector3): void {
    this.noise({ freq: 900, dur: 0.3, gain: 0.3, slideTo: 300, q: 0.6, pos });
  }

  explosion(pos?: THREE.Vector3): void {
    this.noise({ freq: 350, dur: 1.1, gain: 0.9, slideTo: 60, type: 'lowpass', pos });
    this.tone({ type: 'sine', from: 90, to: 30, dur: 0.8, gain: 0.6, pos });
  }

  /** Gunshot: a soft body "thump" + a brief click — deliberately low on harsh
   *  high frequencies so rapid fire isn't piercing/painful to listen to. */
  gun(pos?: THREE.Vector3): void {
    // Low-passed body (the punch), sliding down — no shrill hiss.
    this.noise({ freq: 820, dur: 0.07, gain: 0.3, slideTo: 180, type: 'lowpass', q: 0.7, pos });
    // A short, gentle mid click for definition (bandpass, low gain).
    this.noise({ freq: 1500, dur: 0.025, gain: 0.1, type: 'bandpass', q: 1, pos });
    // Soft triangle thump (much smoother than the old square wave).
    this.tone({ type: 'triangle', from: 170, to: 55, dur: 0.07, gain: 0.15, pos });
  }

  /** Glider deploy: an airy upward whoosh as the wings catch. */
  glide(): void {
    this.noise({ freq: 500, dur: 0.55, gain: 0.22, slideTo: 1700, type: 'bandpass', q: 0.6 });
  }

  /** Glider breaks: a short snap + falling whoosh. */
  gliderBreak(): void {
    this.noise({ freq: 2200, dur: 0.07, gain: 0.28, slideTo: 600, type: 'bandpass', q: 0.9 });
    this.tone({ type: 'triangle', from: 320, to: 90, dur: 0.18, gain: 0.16 });
  }

  /** Healing consumable: a soft warm two-note "patch up" chime + a gentle
   *  sparkle, so a Bandage/Medkit reads as restorative (kid-friendly, low gain). */
  heal(): void {
    this.tone({ type: 'triangle', from: 420, to: 620, dur: 0.18, gain: 0.1 });
    this.tone({ type: 'triangle', from: 620, to: 820, dur: 0.22, gain: 0.09, delay: 0.12 });
    this.noise({ freq: 900, dur: 0.4, gain: 0.03, slideTo: 1600, type: 'bandpass', q: 0.7 });
  }

  /** Lifesteal: you STOLE a heart — a warm little triangle up-chirp (LOW gain,
   *  kid-friendly; same soft recipe as the rest of the kit). */
  heartSteal(): void {
    this.tone({ type: 'triangle', from: 330, to: 640, dur: 0.2, gain: 0.11 });
    this.tone({ type: 'triangle', from: 500, to: 980, dur: 0.16, gain: 0.06, delay: 0.09 });
  }

  /** Lifesteal: you LOST a heart — a soft downward chirp, sad but gentle. */
  heartLoss(): void {
    this.tone({ type: 'triangle', from: 460, to: 190, dur: 0.26, gain: 0.11 });
    this.noise({ freq: 300, dur: 0.12, gain: 0.04, slideTo: 130, type: 'lowpass', q: 0.6 });
  }

  /** Entering a vault (Milestone D): a low, ominous synth pad — soft attack,
   *  gentle gain, nothing shrill (same kid-safe recipe as the rest). */
  vaultSting(): void {
    this.tone({ type: 'sine', from: 82, to: 66, dur: 2.4, gain: 0.13, attack: 0.7 });
    this.tone({ type: 'sine', from: 123, to: 99, dur: 2.4, gain: 0.08, attack: 1.0 });
    this.noise({ freq: 180, dur: 1.6, gain: 0.05, slideTo: 70, type: 'lowpass', q: 0.6 });
  }

  /** VAULT CLEARED: a warm rising triangle fanfare (triumphant, still soft). */
  vaultClear(): void {
    this.tone({ type: 'triangle', from: 330, to: 440, dur: 0.16, gain: 0.12 });
    this.tone({ type: 'triangle', from: 440, to: 587, dur: 0.16, gain: 0.12, delay: 0.14 });
    this.tone({ type: 'triangle', from: 587, to: 880, dur: 0.3, gain: 0.13, delay: 0.28 });
    this.noise({ freq: 500, dur: 0.35, gain: 0.05, slideTo: 900, type: 'bandpass', q: 0.7, delay: 0.28 });
  }

  caveAmbience(): void {
    // eerie detuned pad
    const base = 110 + Math.random() * 80;
    this.tone({ type: 'sine', from: base, to: base * 0.8, dur: 3.5, gain: 0.12, attack: 1.2 });
    this.tone({ type: 'sine', from: base * 1.02, to: base * 0.78, dur: 3.5, gain: 0.1, attack: 1.5 });
  }

  /** Mob voices: zombie groans, hurt yelps, creeper hiss, explosions. */
  mob(name: string, pos: THREE.Vector3): void {
    switch (name) {
      case 'zombie':
        this.tone({ type: 'sawtooth', from: 95, to: 65, dur: 0.85, gain: 0.26, pos, vibrato: 4, attack: 0.15 });
        this.noise({ freq: 300, dur: 0.8, gain: 0.08, pos, q: 0.7 });
        break;
      case 'brute': // a deep, slow boss groan — bigger and lower than a zombie
        this.tone({ type: 'sawtooth', from: 62, to: 40, dur: 1.3, gain: 0.3, pos, vibrato: 3, attack: 0.25 });
        this.noise({ freq: 160, dur: 1.1, gain: 0.1, slideTo: 60, type: 'lowpass', q: 0.7, pos });
        break;
      case 'hiss':
        this.noise({ freq: 1800, dur: 1.5, gain: 0.45, slideTo: 4200, q: 0.6, pos });
        break;
      case 'mobHurt':
        this.tone({ type: 'square', from: 350, to: 180, dur: 0.12, gain: 0.2, pos });
        break;
      case 'spit': // a soft wet blip as the gob launches
        this.tone({ type: 'triangle', from: 420, to: 160, dur: 0.14, gain: 0.14, pos });
        this.noise({ freq: 700, dur: 0.08, gain: 0.05, slideTo: 250, type: 'lowpass', q: 0.7, pos });
        break;
      case 'skitter': // a quick chittery rattle (two fast soft clicks)
        this.tone({ type: 'triangle', from: 640, to: 480, dur: 0.05, gain: 0.09, pos });
        this.tone({ type: 'triangle', from: 560, to: 400, dur: 0.05, gain: 0.08, pos, delay: 0.07 });
        break;
      case 'poof':
        this.poof(pos);
        break;
      case 'explosion':
        this.explosion(pos);
        break;
    }
  }
}
