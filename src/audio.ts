// M8: all sound is synthesized with WebAudio — no recorded assets.
// Filtered noise bursts for digging/steps/explosions, little oscillator
// phrases for mob voices, positional playback through PannerNodes.

import * as THREE from 'three';
import { Block } from './blocks';
import type { VaultFamily } from './vaults';
import { BossMusicEngine, type BossMusicCue } from './boss_music';

export type Material = 'stone' | 'wood' | 'grass' | 'sand' | 'glass' | 'wool';

/** Ambience families. Several biomes share one voice — a snowy taiga and a
 *  snowy plain sound the same, and there is no reason to write both. */
export type BiomeSound =
  | 'forest' | 'jungle' | 'plains' | 'swamp' | 'desert'
  | 'mountain' | 'snow' | 'ocean' | 'ashlands' | 'crystal' | 'none';

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

  /** Head-relative competitive cues for Duels. All route through the effects
   * bus, so the existing volume slider remains authoritative. */
  duelCue(kind: 'countdown' | 'fight' | 'lead' | 'final30' | 'sudden' | 'victory' | 'defeat' |
    'gain' | 'loss' | 'promotion' | 'rankPromotion' | 'demotion' | 'placement' | 'unlock'): void {
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
      case 'gain':
        this.tone({ type: 'triangle', from: 440, to: 590, dur: 0.13, gain: 0.08 });
        this.tone({ type: 'triangle', from: 590, to: 740, dur: 0.16, gain: 0.07, delay: 0.1 });
        break;
      case 'loss':
        this.tone({ type: 'triangle', from: 340, to: 225, dur: 0.24, gain: 0.08 });
        break;
      case 'promotion':
        for (const [i, f] of [440, 554, 659].entries()) this.tone({ type: 'triangle', from: f, to: f * 1.04, dur: 0.22, gain: 0.085, delay: i * 0.1 });
        break;
      case 'rankPromotion':
        for (const [i, f] of [330, 440, 554, 740].entries()) this.tone({ type: 'square', from: f, to: f * 1.05, dur: 0.25, gain: 0.065, delay: i * 0.1 });
        break;
      case 'demotion':
        this.tone({ type: 'triangle', from: 410, to: 255, dur: 0.3, gain: 0.075 });
        this.tone({ type: 'sine', from: 255, to: 220, dur: 0.16, gain: 0.055, delay: 0.2 });
        break;
      case 'placement':
        for (const [i, f] of [294, 392, 523, 698].entries()) this.tone({ type: 'triangle', from: f, to: f * 1.08, dur: 0.28, gain: 0.085, delay: i * 0.13 });
        break;
      case 'unlock':
        this.tone({ type: 'sine', from: 740, to: 980, dur: 0.35, gain: 0.075 });
        this.tone({ type: 'triangle', from: 494, to: 740, dur: 0.3, gain: 0.07, delay: 0.1 });
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

  // --- Helicopters: hull hits and the fast rope --------------------------------

  /** A round bites the airframe: a hard metal slap with a short ring on top.
   *  `armorish` is for a graze that mostly skidded off. */
  heliHit(pos?: THREE.Vector3, heavy = false): void {
    this.noise({ freq: 900, dur: 0.07, gain: heavy ? 0.24 : 0.16, slideTo: 200,
      type: 'lowpass', q: 0.8, pos });
    this.tone({ type: 'square', from: heavy ? 340 : 420, to: 120, dur: 0.09,
      gain: heavy ? 0.13 : 0.09, pos });
    this.tone({ type: 'sine', from: 1900, to: 1200, dur: 0.16, gain: 0.04, pos });
  }

  /** The rope goes out of the door: a winch clatter, then the line falling. */
  ropeDeploy(pos?: THREE.Vector3): void {
    this.tone({ type: 'square', from: 190, to: 130, dur: 0.09, gain: 0.1, pos });
    this.noise({ freq: 520, dur: 0.5, gain: 0.16, slideTo: 130, type: 'lowpass', q: 0.7, pos });
    this.noise({ freq: 260, dur: 0.7, gain: 0.07, slideTo: 900, type: 'bandpass',
      q: 0.5, delay: 0.06, pos });
  }

  /** Gloves close on the line. Short, dry, and it has to land on the frame you
   *  attached — this is the "I'm on" confirmation. */
  ropeGrab(): void {
    this.noise({ freq: 420, dur: 0.1, gain: 0.2, slideTo: 130, type: 'lowpass', q: 0.7 });
    this.tone({ type: 'triangle', from: 300, to: 150, dur: 0.1, gain: 0.11 });
  }

  /** One tick of the descent bed, called on a short repeat while sliding.
   *  `level` is 0..1 of the slide's ramp, so the friction hiss and the wind
   *  both wind up exactly as the descent does. */
  ropeSlide(level: number): void {
    const l = Math.max(0, Math.min(1, level));
    // Rope-through-gloves friction: mid-band hiss that opens up with speed.
    this.noise({ freq: 700 + l * 900, dur: 0.2, gain: 0.05 + l * 0.1,
      slideTo: 380 + l * 700, type: 'bandpass', q: 0.7 });
    // Air past the ears underneath it.
    this.noise({ freq: 300 + l * 260, dur: 0.24, gain: 0.03 + l * 0.06,
      slideTo: 170 + l * 220, type: 'lowpass', q: 0.5 });
  }

  /** Boots hit the deck at the bottom of the line. */
  ropeLand(pos?: THREE.Vector3): void {
    this.noise({ freq: 300, dur: 0.16, gain: 0.24, slideTo: 90, type: 'lowpass', q: 0.7, pos });
    this.tone({ type: 'triangle', from: 150, to: 62, dur: 0.16, gain: 0.16, pos });
    this.noise({ freq: 1400, dur: 0.09, gain: 0.05, slideTo: 700, type: 'bandpass', q: 0.9, pos });
  }

  /** Bounce Pad: spring compression, a rubbery launch note, then air rushing by. */
  /** TREASURY ALARM: two low war horns over a swell of air. Deliberately the
   *  lowest, longest cue in the game — it has to carry from underground and read
   *  as "come home now", not as another pickup chime. */
  raidHorn(): void {
    this.tone({ type: 'sawtooth', from: 108, to: 114, dur: 0.9, gain: 0.19, attack: 0.09 });
    this.tone({ type: 'triangle', from: 163, to: 169, dur: 0.85, gain: 0.14, attack: 0.09 });
    this.tone({ type: 'square', from: 218, to: 226, dur: 0.7, gain: 0.08, attack: 0.07 });
    this.tone({ type: 'sawtooth', from: 146, to: 153, dur: 0.95, gain: 0.17, attack: 0.09, delay: 0.48 });
    this.tone({ type: 'triangle', from: 219, to: 226, dur: 0.9, gain: 0.12, attack: 0.09, delay: 0.48 });
    this.noise({ freq: 280, dur: 1.3, gain: 0.09, slideTo: 155, type: 'lowpass', q: 0.8 });
  }

  /** A short civic chime for a broadcast or an election result landing in the
   *  inbox. Bright and brief — it must never be mistaken for the raid horn. */
  dispatchChime(): void {
    this.tone({ type: 'triangle', from: 784, to: 1046, dur: 0.16, gain: 0.1, attack: 0.01 });
    this.tone({ type: 'sine', from: 1046, to: 1318, dur: 0.22, gain: 0.08, delay: 0.1 });
  }

  bouncePad(): void {
    this.noise({ freq: 540, dur: 0.08, gain: 0.2, slideTo: 170, type: 'lowpass', q: 0.8 });
    this.tone({ type: 'sine', from: 150, to: 640, dur: 0.34, gain: 0.2, attack: 0.015 });
    this.tone({ type: 'triangle', from: 95, to: 280, dur: 0.22, gain: 0.13 });
    this.noise({ freq: 320, dur: 0.48, gain: 0.13, slideTo: 1500, type: 'bandpass', q: 0.5,
      delay: 0.04 });
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

  // --- Bedwars axe melee -----------------------------------------------------
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

  /** A bed goes down. The loudest thing in the mode, because it is the moment
   *  the match changes shape: a splintering crack over a falling sub-bass. */
  bedBreak(pos?: THREE.Vector3): void {
    this.noise({ freq: 1600, dur: 0.22, gain: 0.30, slideTo: 260, type: 'bandpass', q: 0.6, pos });
    this.noise({ freq: 320, dur: 0.5, gain: 0.20, slideTo: 70, type: 'lowpass', q: 0.7, pos });
    this.tone({ type: 'triangle', from: 220, to: 55, dur: 0.7, gain: 0.20, pos });
    this.tone({ type: 'sine', from: 110, to: 40, dur: 1.1, gain: 0.14, attack: 0.02, pos });
  }

  /** Falling past the island bottom: a doppler-down whistle. Deliberately long
   *  — the 22-block drop is a beat the player is meant to feel end. */
  voidFall(): void {
    this.tone({ type: 'sine', from: 900, to: 120, dur: 1.1, gain: 0.12, attack: 0.03 });
    this.noise({ freq: 700, dur: 1.1, gain: 0.09, slideTo: 90, type: 'bandpass', q: 1.1 });
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

  /**
   * Surface ambience for a biome. Called on the same slow timer that plays the
   * cave pad, but for columns that CAN see the sky — so the open world stops
   * being silent between footsteps. Everything here is synthesised from the
   * same tone/noise primitives as the rest of the game's audio; there are no
   * assets to load.
   *
   * `night` swaps the daytime voice of a place for its nocturnal one: birdsong
   * becomes owls and crickets, and the wind on a summit keeps blowing either
   * way.
   */
  biomeAmbience(biome: BiomeSound, night: boolean): void {
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    /** Two or three quick notes: a bird call, a frog, a chime. */
    const call = (
      type: OscillatorType, f: number, spread: number, count: number,
      gain: number, dur: number
    ) => {
      for (let i = 0; i < count; i++) {
        const up = Math.random() < 0.55;
        const a = f * rand(0.92, 1.08);
        const b = a * (up ? rand(1.15, 1.5) : rand(0.66, 0.87));
        this.tone({
          type, from: a, to: b, dur, gain, attack: 0.02,
          delay: i * rand(0.1, 0.26) + Math.random() * spread,
        });
      }
    };
    /** A long filtered hiss: wind, surf, rustling leaves. */
    const bed = (freq: number, slideTo: number, gain: number, dur: number,
                 q = 0.6, type: BiquadFilterType = 'bandpass') =>
      this.noise({ freq, dur, gain, slideTo, q, type });

    switch (biome) {
      case 'forest':
        if (night) {
          // Owl: two soft low hoots, then crickets.
          call('sine', 420, 0.1, 2, 0.07, 0.34);
          call('square', 2600, 0.7, 4, 0.012, 0.05);
        } else {
          call('sine', 1900, 0.5, 3, 0.05, 0.14);
          bed(900, 1500, 0.03, 2.6, 0.5);
        }
        break;
      case 'jungle':
        if (night) call('square', 3100, 0.9, 6, 0.014, 0.06);
        else {
          call('triangle', 1250, 0.4, 4, 0.055, 0.2); // whooping bird
          call('sawtooth', 2400, 0.8, 3, 0.012, 0.09);
        }
        bed(700, 1100, 0.035, 3.2, 0.5);
        break;
      case 'plains':
        if (night) call('square', 2800, 0.8, 5, 0.012, 0.05);
        else {
          call('sine', 2300, 0.6, 3, 0.04, 0.11);
          bed(600, 900, 0.03, 3.0, 0.4);
        }
        break;
      case 'swamp':
        // Frogs: short descending croaks, plus a low wet drone.
        call('sawtooth', 190, 0.5, 3, 0.07, 0.16);
        this.tone({ type: 'sine', from: 74, to: 62, dur: 3.4, gain: 0.05, attack: 1.4 });
        if (night) call('square', 2500, 0.9, 4, 0.01, 0.06);
        break;
      case 'desert':
        bed(480, 300, 0.05, 3.8, 0.4, 'lowpass');
        if (night) this.tone({ type: 'sine', from: 130, to: 110, dur: 3.0, gain: 0.04, attack: 1.2 });
        break;
      case 'mountain':
        // Thin, cold, high wind — the loudest bed in the game.
        bed(1400, 700, 0.07, 4.5, 0.35);
        bed(320, 220, 0.045, 4.0, 0.5, 'lowpass');
        break;
      case 'snow':
        bed(900, 500, 0.045, 4.2, 0.4);
        break;
      case 'ocean':
        // Surf: a slow swell that rises and falls.
        bed(400, 900, 0.055, 2.4, 0.35);
        bed(900, 350, 0.05, 2.8, 0.35);
        break;
      case 'ashlands':
        // Low volcanic rumble with the odd sputter of a lava pool.
        this.tone({ type: 'sine', from: 48, to: 38, dur: 4.0, gain: 0.09, attack: 1.6 });
        this.noise({ freq: 260, dur: 0.7, gain: 0.035, slideTo: 90, type: 'lowpass', q: 0.7,
          delay: rand(0.3, 1.8) });
        break;
      case 'crystal': {
        // Struck glass: a bell chord out of a pentatonic scale.
        const root = [523, 587, 659, 784, 880][(Math.random() * 5) | 0];
        for (let i = 0; i < 3; i++) {
          this.tone({ type: 'sine', from: root * (i === 0 ? 1 : i === 1 ? 1.5 : 2),
            to: root * (i === 0 ? 1 : i === 1 ? 1.5 : 2) * 0.998,
            dur: rand(1.6, 2.6), gain: 0.035, attack: 0.01, delay: i * rand(0.1, 0.4) });
        }
        break;
      }
    }
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
