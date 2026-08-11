// M8: all sound is synthesized with WebAudio — no recorded assets.
// Filtered noise bursts for digging/steps/explosions, little oscillator
// phrases for mob voices, positional playback through PannerNodes.

import * as THREE from 'three';
import { Block } from './blocks';
import type { VaultFamily } from './vaults';
import { BossMusicEngine, type BossMusicCue } from './boss_music';

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
    case Block.CarvedVaultBrick: case Block.MossyVaultBrick:
    case Block.EmberBrick: case Block.GildedVaultBrick:
    case Block.SoulLantern: case Block.EmberBrazier: case Block.GildedLamp:
    case Block.WallTrap: case Block.WallTrapUp:
    case Block.LuminousLimestone: case Block.PearlTile: case Block.IvoryColumn:
    case Block.SpectralMarble: case Block.JadeMosaic: case Block.FurnaceCeramic:
    case Block.OpalBrick: case Block.ClockworkGrate: case Block.VaultMosaic:
      return 'stone';
    case Block.Sand:
      return 'sand';
    case Block.Glass: case Block.CrystalBlock: case Block.PrismBrick:
    case Block.PrismLamp: case Block.RuneGlass:
      return 'glass';
    case Block.Wool:
      return 'wool';
    default:
      return 'grass'; // dirt, grass, leaves, plants, snow...
  }
}

// Encounter mix. A boss score is a dense, compressed, SUSTAINED signal while
// gunshots and explosions are short transients with far higher peaks — matched
// on paper, the music still reads as background noise underneath a fight. So
// the encounter mix pushes the score up and pulls the fight down harder than a
// naive "slightly louder" balance would: combined with the score's own makeup
// gain (MUSIC_MAKEUP_GAIN in boss_music.ts) the track finally sits ON TOP of
// the boss fight instead of behind it.
export const ENCOUNTER_MUSIC_BOOST = 1.28;
export const ENCOUNTER_EFFECTS_DUCK = 0.74;
export const ENCOUNTER_AMBIENCE_DUCK = 0.34;
/** Bus ceiling for the music path. Above 1 on purpose: the bus feeds a master
 *  at 0.5, so headroom is available and the score needs it to compete. */
const MUSIC_BUS_CEILING = 1.6;
/** Default music slider position. Higher than it used to be for the same
 *  reason: at 0.65 the boss score was inaudible next to the fight. */
export const DEFAULT_MUSIC_VOLUME = 0.85;

const MATERIAL_FREQ: Record<Material, number> = {
  stone: 700, wood: 380, grass: 950, sand: 2400, glass: 3200, wool: 500,
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private bossScore: BossMusicEngine | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly listenerPos = new THREE.Vector3();
  private effectsVolume = GameAudio.savedVolume('effects', 0.8);
  private musicVolume = GameAudio.savedVolume('music', DEFAULT_MUSIC_VOLUME);
  private encounterMix = false;

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
      this.master.connect(this.ctx.destination);
      this.effectsBus = this.ctx.createGain();
      this.ambienceBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.effectsBus.gain.value = this.effectsVolume;
      this.ambienceBus.gain.value = this.effectsVolume * 0.7;
      this.musicBus.gain.value = this.musicVolume;
      this.effectsBus.connect(this.master);
      this.ambienceBus.connect(this.master);
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private applyBusMix(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const music = Math.min(MUSIC_BUS_CEILING,
      this.musicVolume * (this.encounterMix ? ENCOUNTER_MUSIC_BOOST : 1));
    const effects = this.effectsVolume * (this.encounterMix ? ENCOUNTER_EFFECTS_DUCK : 1);
    const ambience = this.effectsVolume * (this.encounterMix ? ENCOUNTER_AMBIENCE_DUCK : 0.7);
    this.musicBus?.gain.setTargetAtTime(music, now, 0.08);
    this.effectsBus?.gain.setTargetAtTime(effects, now, 0.08);
    this.ambienceBus?.gain.setTargetAtTime(ambience, now, 0.1);
  }

  private setEncounterMix(active: boolean): void {
    if (this.encounterMix === active) return;
    this.encounterMix = active;
    this.applyBusMix();
  }

  setEffectsVolume(value: number): void {
    this.effectsVolume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.8));
    this.applyBusMix();
    try { localStorage.setItem('voxelon.audio.effects', String(this.effectsVolume)); } catch { /* ignore */ }
  }

  setMusicVolume(value: number): void {
    this.musicVolume = Math.max(0, Math.min(1,
      Number.isFinite(value) ? value : DEFAULT_MUSIC_VOLUME));
    this.applyBusMix();
    try { localStorage.setItem('voxelon.audio.music', String(this.musicVolume)); } catch { /* ignore */ }
  }

  getEffectsVolume(): number { return this.effectsVolume; }
  getMusicVolume(): number { return this.musicVolume; }

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
    if (!pos || !this.ctx) return this.effectsBus ?? this.master!;
    const panner = new PannerNode(this.ctx, {
      distanceModel: 'linear',
      refDistance: 2,
      maxDistance: 32,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    panner.connect(this.effectsBus ?? this.master!);
    return panner;
  }

  /** Start a long-form, bar-aligned adaptive score for this dungeon boss.
   *  IDEMPOTENT: if that boss's score is already running this is a no-op, so a
   *  re-sent vaultEnter, a reconnect or a knockback that flickers the vault
   *  bounds cannot rewind a five-minute track back to bar one. */
  startVaultMusic(family: VaultFamily, phase: 1 | 2 | 3 = 1): void {
    this.resume();
    if (!this.ctx || !this.musicBus) return;
    this.setEncounterMix(true);
    this.bossScore ??= new BossMusicEngine(this.ctx, this.musicBus);
    if (this.bossScore.playing(family)) return; // already scored — let it run
    this.bossScore.start(family, phase);
  }

  /** Is a boss score currently playing (optionally for a specific family)? */
  vaultMusicPlaying(family?: VaultFamily): boolean {
    return this.bossScore?.playing(family) ?? false;
  }

  /** Change orchestration at the next scheduler boundary without restarting. */
  setVaultMusicPhase(phase: 1 | 2 | 3, lowHealth = false): void {
    this.bossScore?.setPhase(phase, lowHealth);
  }

  /** Fire a score-synchronised encounter stinger. */
  vaultMusicCue(kind: BossMusicCue): void {
    this.bossScore?.cue(kind);
    if (kind === 'reset' || kind === 'victory') this.setEncounterMix(false);
  }

  stopVaultMusic(fade = 0.4): void {
    this.bossScore?.stop(fade);
    this.setEncounterMix(false);
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

  /** Hit confirmation for the SHOOTER: a crisp, tiny tick that cuts through
   *  sustained fire. Deliberately dry and short (under 60ms) so an SMG burst
   *  reads as a run of distinct hits instead of a smear. A kill drops a second,
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
   *  high frequencies so rapid fire isn't piercing/painful to listen to.
   *  `weight` scales the report so a shotgun booms and an SMG snaps, without
   *  any of them turning into the hiss the old shot used to be. */
  gun(pos?: THREE.Vector3, weight = 1): void {
    const w = Math.max(0.4, Math.min(2.6, weight));
    // Low-passed body (the punch), sliding down — no shrill hiss.
    this.noise({
      freq: 820 / w, dur: 0.07 * w, gain: 0.3 * Math.min(1.6, w),
      slideTo: 180 / w, type: 'lowpass', q: 0.7, pos,
    });
    // A short, gentle mid click for definition (bandpass, low gain).
    this.noise({ freq: 1500, dur: 0.025, gain: 0.1, type: 'bandpass', q: 1, pos });
    // Soft triangle thump (much smoother than the old square wave).
    this.tone({
      type: 'triangle', from: 170 / w, to: 55 / w, dur: 0.07 * w, gain: 0.15 * w, pos,
    });
    // Heavy weapons get a tail: the room answering the shot.
    if (w > 1.3) {
      this.noise({
        freq: 300, dur: 0.34 * w, gain: 0.07 * w, slideTo: 90,
        type: 'lowpass', q: 0.5, delay: 0.03, pos,
      });
    }
  }

  /** Working the action: racking a pump/bolt, dropping and seating magazines.
   *  Small, dry, mechanical — these land on the animation, not the trigger. */
  gunAction(kind: 'cycle' | 'magOut' | 'magIn' | 'shellDrop'): void {
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
      case 'shellDrop':
        this.noise({ freq: 3200, dur: 0.03, gain: 0.05, type: 'bandpass', q: 2, delay: 0.12 });
        break;
    }
  }

  // --- Grappling hook --------------------------------------------------------
  // Four beats, because the hook is four beats: the launch, the bite, the reel
  // and the release. Each one is short and low-mid so chaining swings never
  // turns into a shriek.

  /** Launch: a rising "thwip" as the line pays out. */
  grappleFire(): void {
    this.noise({ freq: 380, dur: 0.16, gain: 0.2, slideTo: 1500, type: 'bandpass', q: 0.8 });
    this.tone({ type: 'triangle', from: 220, to: 520, dur: 0.12, gain: 0.09 });
  }

  /** The hook bites: a solid metal thunk with a short ring. */
  grappleHit(pos?: THREE.Vector3): void {
    this.noise({ freq: 700, dur: 0.09, gain: 0.26, slideTo: 140, type: 'lowpass', q: 0.7, pos });
    this.tone({ type: 'triangle', from: 260, to: 90, dur: 0.13, gain: 0.18, pos });
    this.tone({ type: 'sine', from: 1450, to: 900, dur: 0.22, gain: 0.05, pos });
  }

  /** Reeling: a low winch whir under the flight (called once per pull). */
  grappleReel(): void {
    this.tone({ type: 'sawtooth', from: 120, to: 210, dur: 0.55, gain: 0.05, attack: 0.08 });
    this.noise({ freq: 240, dur: 0.6, gain: 0.05, slideTo: 700, type: 'lowpass', q: 0.6 });
  }

  /** Let go at speed: a snap of tension plus the wind of the launch. */
  grappleRelease(): void {
    this.tone({ type: 'triangle', from: 520, to: 180, dur: 0.1, gain: 0.1 });
    this.noise({ freq: 700, dur: 0.42, gain: 0.16, slideTo: 2000, type: 'bandpass', q: 0.5 });
  }

  /** Glider deploy: sailcloth cracking taut, then the wings catching the air. */
  glide(): void {
    this.noise({ freq: 900, dur: 0.09, gain: 0.3, slideTo: 260, type: 'bandpass', q: 0.8 });
    this.noise({ freq: 320, dur: 0.6, gain: 0.24, slideTo: 1500, type: 'bandpass', q: 0.5,
      delay: 0.05 });
    this.tone({ type: 'triangle', from: 140, to: 260, dur: 0.35, gain: 0.09, attack: 0.05 });
  }

  /** One gust of the wind bed while gliding. Called on a short repeat by the
   *  flight loop with `level` 0..1 for airspeed, so the rush swells as you dive
   *  and drops back to a whisper on a level cruise. */
  glideWind(level: number): void {
    const l = Math.max(0, Math.min(1, level));
    this.noise({
      freq: 380 + l * 520, dur: 0.42, gain: 0.03 + l * 0.09,
      slideTo: 200 + l * 420, type: 'lowpass', q: 0.5,
    });
  }

  /** Glider breaks: a short snap + falling whoosh. */
  gliderBreak(): void {
    this.noise({ freq: 2200, dur: 0.07, gain: 0.28, slideTo: 600, type: 'bandpass', q: 0.9 });
    this.tone({ type: 'triangle', from: 320, to: 90, dur: 0.18, gain: 0.16 });
  }

  /** Starting to apply a healing consumable: a wrapper tear (bandage) or a
   *  case latch pop (medkit) — the sound that says "you are committed now". */
  healStart(medkit = false): void {
    if (medkit) {
      this.tone({ type: 'square', from: 260, to: 150, dur: 0.05, gain: 0.07 });
      this.noise({ freq: 700, dur: 0.09, gain: 0.14, slideTo: 220, type: 'lowpass', q: 0.7 });
      this.tone({ type: 'triangle', from: 180, to: 120, dur: 0.12, gain: 0.09, delay: 0.06 });
    } else {
      // Gauze tearing: a short rising noise rip with a papery body.
      this.noise({ freq: 900, dur: 0.22, gain: 0.11, slideTo: 2600, type: 'bandpass', q: 0.5 });
      this.noise({ freq: 400, dur: 0.14, gain: 0.06, slideTo: 180, type: 'lowpass', q: 0.6 });
    }
  }

  /** One "work" beat while the wrap is being pressed in: a soft, quiet pat.
   *  Pitch rises with `step` so the channel feels like it is going somewhere. */
  healBeat(step = 0): void {
    const f = 300 + step * 55;
    this.noise({ freq: f, dur: 0.07, gain: 0.07, slideTo: f * 0.5, type: 'lowpass', q: 0.7 });
    this.tone({ type: 'triangle', from: f * 1.5, to: f, dur: 0.06, gain: 0.05 });
  }

  /** Healing consumable applied: a warm rising three-note resolve + a soft
   *  sparkle tail, so a Bandage/Medkit lands as relief (kid-friendly, low gain). */
  heal(medkit = false): void {
    const g = medkit ? 0.12 : 0.1;
    this.tone({ type: 'triangle', from: 392, to: 523, dur: 0.16, gain: g });
    this.tone({ type: 'triangle', from: 523, to: 659, dur: 0.18, gain: g * 0.9, delay: 0.1 });
    this.tone({ type: 'triangle', from: 659, to: 784, dur: 0.3, gain: g * 0.85, delay: 0.2 });
    if (medkit) {
      this.tone({ type: 'sine', from: 196, to: 262, dur: 0.5, gain: 0.07 }); // warm floor
    }
    this.noise({ freq: 1100, dur: 0.5, gain: 0.03, slideTo: 2200, type: 'bandpass', q: 0.7, delay: 0.12 });
  }

  /** Each point of health the heal buff restores: a tiny glassy sparkle. */
  healTick(pitch = 1): void {
    this.tone({ type: 'sine', from: 880 * pitch, to: 1320 * pitch, dur: 0.09, gain: 0.045 });
  }

  /** An interrupted application (slot switched away, killed mid-wrap). */
  healCancel(): void {
    this.tone({ type: 'triangle', from: 360, to: 190, dur: 0.14, gain: 0.08 });
    this.noise({ freq: 500, dur: 0.08, gain: 0.05, slideTo: 200, type: 'lowpass', q: 0.6 });
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

  /** WARFARE COMMAND: a technology authorized. A confident four-note rise with
   *  a mechanical latch underneath — this is the payoff for a whole boss fight,
   *  so it is the biggest sound in the kit that still stays soft. */
  warfareAuthorized(): void {
    // The latch: a short filtered click, like a breaker being thrown.
    this.noise({ freq: 900, dur: 0.07, gain: 0.07, slideTo: 260, type: 'lowpass', q: 1.1 });
    // The rise: root, fifth, octave, then a held major tenth on top.
    this.tone({ type: 'triangle', from: 294, to: 294, dur: 0.12, gain: 0.11 });
    this.tone({ type: 'triangle', from: 440, to: 440, dur: 0.12, gain: 0.11, delay: 0.10 });
    this.tone({ type: 'triangle', from: 587, to: 587, dur: 0.14, gain: 0.12, delay: 0.20 });
    this.tone({ type: 'triangle', from: 740, to: 880, dur: 0.42, gain: 0.13, delay: 0.31, attack: 0.02 });
    // A soft sine pad an octave down gives the chord some body.
    this.tone({ type: 'sine', from: 147, to: 220, dur: 0.55, gain: 0.07, delay: 0.20, attack: 0.08 });
    this.noise({ freq: 600, dur: 0.4, gain: 0.04, slideTo: 1400, type: 'bandpass', q: 0.8, delay: 0.31 });
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
