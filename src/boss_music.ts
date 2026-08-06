import type { VaultFamily } from './vaults';

export type BossMusicPhase = 1 | 2 | 3;
export type BossMusicCue = 'summon' | 'poise' | 'phase' | 'enrage' | 'victory' | 'reset'
  | 'door' | 'movement' | 'army' | 'healing' | 'interrupt' | 'combo';

type Degree = number | null;
type Timbre = 'choir' | 'reed' | 'brass' | 'glass' | 'clock' | 'bass';

export interface BossScoreProfile {
  readonly title: string;
  readonly boss: string;
  readonly bpm: number;
  readonly rootMidi: number;
  readonly scale: readonly number[];
  readonly motif: readonly Degree[];
  readonly bass: readonly Degree[];
  readonly chords: readonly (readonly number[])[];
  readonly swing: number;
  readonly reverb: number;
  readonly delay: number;
}

/**
 * Five fully separate musical identities. The values are intentionally data-driven
 * so future bosses can be added without rewriting the scheduler.
 */
export const BOSS_SCORE_PROFILES: Record<VaultFamily, BossScoreProfile> = {
  crypt: {
    title: 'Ossuary Oath', boss: 'Bone Warden', bpm: 76, rootMidi: 38,
    scale: [0, 1, 3, 5, 6, 8, 10],
    motif: [0, null, 2, 1, 4, null, 3, 1, 0, null, 5, 4, 2, 1, -1, null],
    bass: [0, null, null, null, -1, null, null, null, 0, null, null, null, -2, null, -1, null],
    chords: [[0, 2, 4], [-1, 1, 4], [0, 3, 5], [-2, 1, 4]],
    swing: 0.02, reverb: 0.62, delay: 0.08,
  },
  mire: {
    title: 'Crown Beneath the Mire', boss: 'Mire Queen', bpm: 92, rootMidi: 41,
    scale: [0, 2, 3, 5, 7, 8, 10],
    motif: [0, 2, null, 1, 3, null, 2, 5, 4, null, 2, 1, 0, -1, null, 2],
    bass: [0, null, -1, null, 0, null, 2, null, -2, null, -1, null, 0, null, 1, null],
    chords: [[0, 2, 4], [2, 4, 6], [-1, 1, 4], [0, 3, 5]],
    swing: 0.17, reverb: 0.46, delay: 0.18,
  },
  ember: {
    title: 'Heart of the Furnace', boss: 'Ember Colossus', bpm: 132, rootMidi: 36,
    scale: [0, 2, 3, 5, 7, 8, 11],
    motif: [0, null, 0, 2, null, 1, 4, null, 0, 5, null, 4, 2, 1, null, -1],
    bass: [0, null, 0, -1, null, 0, 2, null, 0, null, -2, null, -1, 0, null, 1],
    chords: [[0, 2, 4], [0, 3, 5], [-1, 2, 4], [0, 2, 6]],
    swing: 0, reverb: 0.2, delay: 0.06,
  },
  crystal: {
    title: 'Refraction Prophecy', boss: 'Crystal Seer', bpm: 108, rootMidi: 47,
    scale: [0, 2, 4, 6, 7, 9, 11],
    motif: [0, 2, 4, 6, 5, 3, 1, 4, 2, 5, 7, 6, 4, 1, 3, 5],
    bass: [0, null, null, null, 3, null, null, null, -1, null, null, null, 4, null, null, null],
    chords: [[0, 2, 4], [3, 5, 7], [1, 4, 6], [-1, 2, 5]],
    swing: 0.04, reverb: 0.72, delay: 0.32,
  },
  gilded: {
    title: 'The Brass Equation', boss: 'Gilded Artificer', bpm: 120, rootMidi: 42,
    scale: [0, 2, 3, 5, 7, 8, 11],
    motif: [0, 2, 1, 4, 3, 5, 2, 6, 4, 1, 5, 3, 0, 4, 2, -1],
    bass: [0, null, 0, null, -1, null, 2, null, 0, null, -2, null, -1, null, 1, null],
    chords: [[0, 2, 4], [1, 3, 5], [-1, 2, 4], [0, 3, 6]],
    swing: 0.06, reverb: 0.28, delay: 0.14,
  },
};

/**
 * Every score follows a 96-bar macro arrangement. At the profile tempos this is
 * roughly 2:55–5:03 before the exact musical cycle repeats. The final eight bars
 * deliberately resolve toward the opening harmony, so the boundary is seamless
 * even while long reverb and delay tails continue across it.
 */
export const BOSS_SCORE_LOOP_BARS = 96;
const STEPS_PER_BAR = 16;
export const BOSS_SCORE_LOOP_STEPS = BOSS_SCORE_LOOP_BARS * STEPS_PER_BAR;
const SECTION_BARS = 8;

export function bossScoreLoopSeconds(family: VaultFamily): number {
  return BOSS_SCORE_LOOP_BARS * 4 * 60 / BOSS_SCORE_PROFILES[family].bpm;
}

interface ArrangementShape {
  readonly name: string;
  readonly energy: number;
  readonly melody: number;
  readonly rhythm: number;
  readonly harmony: number;
  readonly octaveLift: number;
  readonly counterline: boolean;
  readonly breakdown: boolean;
}

const ARRANGEMENT: readonly ArrangementShape[] = [
  { name: 'awakening', energy: 0.58, melody: 0.55, rhythm: 0.48, harmony: 0.90, octaveLift: 0, counterline: false, breakdown: true },
  { name: 'procession', energy: 0.78, melody: 0.78, rhythm: 0.75, harmony: 0.92, octaveLift: 0, counterline: false, breakdown: false },
  { name: 'first-oath', energy: 0.92, melody: 0.96, rhythm: 0.92, harmony: 1.00, octaveLift: 0, counterline: true, breakdown: false },
  { name: 'shadow-answer', energy: 0.73, melody: 0.70, rhythm: 0.66, harmony: 1.08, octaveLift: 0, counterline: true, breakdown: true },
  { name: 'iron-chorus', energy: 1.04, melody: 1.00, rhythm: 1.08, harmony: 1.02, octaveLift: 1, counterline: true, breakdown: false },
  { name: 'hollow-centre', energy: 0.62, melody: 0.60, rhythm: 0.50, harmony: 1.14, octaveLift: 0, counterline: false, breakdown: true },
  { name: 'the-hunt', energy: 0.94, melody: 0.90, rhythm: 1.00, harmony: 0.98, octaveLift: 0, counterline: true, breakdown: false },
  { name: 'fracture', energy: 1.10, melody: 1.05, rhythm: 1.13, harmony: 1.02, octaveLift: 1, counterline: true, breakdown: false },
  { name: 'false-victory', energy: 0.70, melody: 0.74, rhythm: 0.60, harmony: 1.18, octaveLift: 1, counterline: false, breakdown: true },
  { name: 'ascension', energy: 1.08, melody: 1.08, rhythm: 1.10, harmony: 1.06, octaveLift: 1, counterline: true, breakdown: false },
  { name: 'final-form', energy: 1.18, melody: 1.14, rhythm: 1.18, harmony: 1.02, octaveLift: 1, counterline: true, breakdown: false },
  { name: 'return-to-seal', energy: 0.66, melody: 0.62, rhythm: 0.56, harmony: 0.94, octaveLift: 0, counterline: false, breakdown: true },
];

/** Forty-eight two-bar harmonic destinations per boss, ending on a stable
 * dominant-to-tonic return. These paths are intentionally boss-specific. */
const HARMONY_PATHS: Record<VaultFamily, readonly number[]> = {
  crypt:   [0,0,1,0, 2,1,3,0, 0,2,1,3, 2,0,3,1, 0,1,2,0, 3,2,1,0, 0,3,1,2, 0,2,3,1, 2,1,3,0, 0,2,1,3, 2,0,1,3, 1,0,0,0],
  mire:    [0,2,1,0, 3,2,0,1, 0,1,3,2, 2,0,1,3, 0,2,3,1, 2,3,1,0, 1,0,2,3, 0,3,2,1, 2,0,3,1, 0,2,1,3, 2,1,3,0, 1,0,0,0],
  ember:   [0,0,2,1, 3,0,1,2, 0,3,2,1, 2,0,3,1, 0,2,1,3, 3,2,1,0, 0,1,3,2, 0,2,3,1, 3,0,2,1, 0,3,1,2, 2,0,1,3, 1,0,0,0],
  crystal: [0,1,2,3, 1,3,0,2, 0,2,1,3, 2,0,3,1, 0,3,1,2, 1,2,3,0, 2,1,0,3, 0,3,2,1, 1,3,0,2, 0,2,3,1, 2,1,3,0, 1,0,0,0],
  gilded:  [0,1,0,2, 3,1,2,0, 0,2,1,3, 1,0,3,2, 0,1,2,3, 2,1,3,0, 0,3,1,2, 0,2,3,1, 1,3,2,0, 0,1,3,2, 2,0,1,3, 1,0,0,0],
};

interface VoiceOptions {
  at: number;
  duration: number;
  gain: number;
  pan?: number;
  wet?: number;
  cutoff?: number;
  attack?: number;
  release?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function degreeToMidi(profile: BossScoreProfile, degree: number, octave = 0): number {
  const count = profile.scale.length;
  const wrapped = ((degree % count) + count) % count;
  const scaleOctave = Math.floor(degree / count);
  return profile.rootMidi + profile.scale[wrapped] + (scaleOctave + octave) * 12;
}

function hashUnit(value: number): number {
  const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Native WebAudio adaptive boss-score engine. It produces original music in the
 * browser, needs no downloads, and keeps phase changes aligned to a shared pulse. Each boss runs through a 96-bar, exact-repeat macro form before returning seamlessly to bar one.
 */
export class BossMusicEngine {
  private readonly scoreGain: GainNode;
  private readonly dryGain: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbReturn: GainNode;
  private readonly delay: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly delayReturn: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly sources = new Set<AudioScheduledSourceNode>();

  private family: VaultFamily = 'crypt';
  private phase: BossMusicPhase = 1;
  private lowHealth = false;
  private running = false;
  private timer: number | null = null;
  private nextStepAt = 0;
  private absoluteStep = 0;
  private runId = 0;
  private currentBar = 0;
  private currentSection = 0;
  private currentSectionBar = 0;
  private readonly lastCueAt: Partial<Record<BossMusicCue, number>> = {};
  private victoryEnding = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.scoreGain = ctx.createGain();
    this.scoreGain.gain.value = 0.0001;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.92;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.createImpulse(2.35, 2.7);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.35;

    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.24;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.24;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.18;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.012;
    this.compressor.release.value = 0.28;

    this.dryGain.connect(this.scoreGain);
    this.reverb.connect(this.reverbReturn).connect(this.scoreGain);
    this.delay.connect(this.delayReturn).connect(this.scoreGain);
    this.delay.connect(this.delayFeedback).connect(this.delay);
    this.scoreGain.connect(this.compressor).connect(destination);

    this.noiseBuffer = this.createNoiseBuffer(2);
  }

  start(family: VaultFamily, phase: BossMusicPhase = 1): void {
    this.stop(0.05);
    this.runId++;
    this.family = family;
    this.phase = phase;
    this.lowHealth = false;
    this.victoryEnding = false;
    for (const key of Object.keys(this.lastCueAt) as BossMusicCue[]) delete this.lastCueAt[key];
    this.running = true;
    this.absoluteStep = 0;
    this.nextStepAt = this.ctx.currentTime + 0.06;
    this.applyProfileMix();

    const now = this.ctx.currentTime;
    this.scoreGain.gain.cancelScheduledValues(now);
    this.scoreGain.gain.setValueAtTime(0.0001, now);
    this.scoreGain.gain.exponentialRampToValueAtTime(1, now + 0.42);

    this.timer = window.setInterval(() => this.schedule(), 80);
    this.schedule();
  }

  setPhase(phase: BossMusicPhase, lowHealth = false): void {
    this.phase = phase;
    this.lowHealth = lowHealth;
  }

  cue(kind: BossMusicCue): void {
    if (kind === 'reset') {
      this.stop(0.45);
      return;
    }
    if (!this.running) return;

    const musicalKind: BossMusicCue = kind === 'army' ? 'summon'
      : kind === 'door' || kind === 'combo' ? 'phase'
      : kind === 'movement' || kind === 'interrupt' ? 'poise'
      : kind === 'healing' ? 'summon' : kind;
    const cueTime = this.ctx.currentTime;
    const minimumGap = musicalKind === 'victory' ? 1.5 : musicalKind === 'phase' ? 0.45 : 0.18;
    const last = this.lastCueAt[kind] ?? -Infinity;
    if (cueTime - last < minimumGap) return;
    if (musicalKind === 'victory' && this.victoryEnding) return;
    this.lastCueAt[kind] = cueTime;
    if (musicalKind === 'victory') this.victoryEnding = true;

    const profile = BOSS_SCORE_PROFILES[this.family];
    const now = cueTime + 0.025;
    const root = midiToHz(profile.rootMidi + 12);

    if (musicalKind === 'summon') {
      this.lowBoom(now, 0.22);
      this.playTimbre(this.family === 'crystal' ? 'glass' : 'choir', root, {
        at: now + 0.04, duration: 0.7, gain: 0.11, wet: 0.65,
      });
      this.playTimbre('choir', root * 1.5, {
        at: now + 0.11, duration: 0.62, gain: 0.07, pan: 0.25, wet: 0.7,
      });
    } else if (musicalKind === 'poise') {
      this.glassHit(root * 4, now, 0.14, 0.08, -0.2);
      this.glassHit(root * 6, now + 0.055, 0.2, 0.055, 0.2);
    } else if (musicalKind === 'phase') {
      this.lowBoom(now, 0.28);
      [0, 2, 4, 7].forEach((degree, index) => {
        const frequency = midiToHz(degreeToMidi(profile, degree, 1));
        this.playTimbre(this.signatureTimbre(), frequency, {
          at: now + index * 0.09, duration: 0.42, gain: 0.09, pan: index % 2 ? 0.24 : -0.24,
          wet: profile.reverb,
        });
      });
    } else if (musicalKind === 'enrage') {
      for (let i = 0; i < 3; i++) this.lowBoom(now + i * 0.13, 0.2 + i * 0.035);
      this.playTimbre('brass', root / 2, {
        at: now, duration: 0.75, gain: 0.14, wet: 0.18, cutoff: 1600,
      });
    } else if (musicalKind === 'victory') {
      const capturedRun = this.runId;
      [0, 2, 4, 7, 9].forEach((degree, index) => {
        const frequency = midiToHz(degreeToMidi(profile, degree, 1));
        this.playTimbre(this.family === 'crystal' ? 'glass' : 'brass', frequency, {
          at: now + index * 0.12, duration: 0.75 - index * 0.04,
          gain: 0.085, pan: -0.35 + index * 0.17, wet: 0.7,
        });
      });
      window.setTimeout(() => {
        if (capturedRun === this.runId) this.stop(1.2);
      }, 760);
    }
  }

  stop(fade = 0.4): void {
    this.running = false;
    this.victoryEnding = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    const now = this.ctx.currentTime;
    const end = now + Math.max(0.03, fade);
    this.scoreGain.gain.cancelScheduledValues(now);
    this.scoreGain.gain.setValueAtTime(Math.max(0.0001, this.scoreGain.gain.value), now);
    this.scoreGain.gain.exponentialRampToValueAtTime(0.0001, end);

    const oldSources = [...this.sources];
    this.sources.clear();
    for (const source of oldSources) {
      try { source.stop(end + 0.02); } catch { /* already ended */ }
    }
  }

  private schedule(): void {
    if (!this.running || this.ctx.state !== 'running') return;
    const profile = BOSS_SCORE_PROFILES[this.family];
    const stepSeconds = 60 / profile.bpm / 4;
    if (this.nextStepAt < this.ctx.currentTime - stepSeconds) {
      // A heavily throttled tab may miss part of the score. Recover on the next
      // sixteenth rather than trying to burst-schedule an audible backlog.
      this.nextStepAt = this.ctx.currentTime + 0.04;
    }

    while (this.nextStepAt <= this.ctx.currentTime + 0.32) {
      const cycleStep = this.absoluteStep % BOSS_SCORE_LOOP_STEPS;
      const step = cycleStep % STEPS_PER_BAR;
      const bar = Math.floor(cycleStep / STEPS_PER_BAR);
      const swingOffset = (step & 1) ? stepSeconds * profile.swing : 0;
      this.scheduleStep(profile, this.nextStepAt + swingOffset, step, bar, stepSeconds);
      this.absoluteStep = (this.absoluteStep + 1) % BOSS_SCORE_LOOP_STEPS;
      this.nextStepAt += stepSeconds;
    }
  }

  private scheduleStep(
    profile: BossScoreProfile,
    at: number,
    step: number,
    bar: number,
    stepSeconds: number,
  ): void {
    this.currentBar = bar;
    this.currentSection = Math.floor(bar / SECTION_BARS);
    this.currentSectionBar = bar % SECTION_BARS;

    const shape = ARRANGEMENT[this.currentSection];
    const phase = this.phase;
    const phaseEnergy = phase === 1 ? 0.78 : phase === 2 ? 0.98 : 1.13;
    const healthEnergy = this.lowHealth ? 1.10 : 1;
    const intensity = shape.energy * phaseEnergy * healthEnergy;
    const motifDegree = this.arrangedMotifDegree(profile, step, bar, shape);
    const bassDegree = this.arrangedBassDegree(profile, step, bar);

    // Two-bar harmonic rhythm gives every track a full 48-chord journey. Chords
    // are re-articulated midway through energetic bars, but breakdown sections
    // breathe across the whole bar.
    if (step === 0 || (step === 8 && phase >= 2 && !shape.breakdown)) {
      const slot = Math.floor(bar / 2) % HARMONY_PATHS[this.family].length;
      const chordOffset = step === 8 && this.currentSectionBar % 2 === 1 ? 1 : 0;
      const chordIndex = (HARMONY_PATHS[this.family][slot] + chordOffset) % profile.chords.length;
      const duration = stepSeconds * (shape.breakdown && step === 0 ? 15.7 : 7.6);
      this.padChord(profile, profile.chords[chordIndex], at, duration,
        0.030 * intensity * shape.harmony);
    }

    if (bassDegree !== null && (!shape.breakdown || step % 4 === 0 || phase >= 2)) {
      const frequency = midiToHz(degreeToMidi(profile, bassDegree, -1));
      const length = shape.breakdown ? 5.8 : phase === 3 ? 2.55 : 3.35;
      this.bassNote(frequency, at, stepSeconds * length, 0.080 * intensity);
    }

    switch (this.family) {
      case 'crypt': this.scheduleCrypt(profile, at, step, stepSeconds, motifDegree, intensity); break;
      case 'mire': this.scheduleMire(profile, at, step, stepSeconds, motifDegree, intensity); break;
      case 'ember': this.scheduleEmber(profile, at, step, stepSeconds, motifDegree, intensity); break;
      case 'crystal': this.scheduleCrystal(profile, at, step, stepSeconds, motifDegree, intensity); break;
      case 'gilded': this.scheduleGilded(profile, at, step, stepSeconds, motifDegree, intensity); break;
    }

    this.scheduleLongFormLayers(profile, shape, at, step, stepSeconds, motifDegree, intensity);

    if (this.lowHealth) {
      if (step % 8 === 0 || step % 8 === 2) this.lowBoom(at, step % 8 === 0 ? 0.19 : 0.12);
      if (motifDegree !== null && (step & 1) === 0) {
        const frequency = midiToHz(degreeToMidi(profile, motifDegree + 6, 1));
        this.playTimbre(this.signatureTimbre(), frequency, {
          at: at + stepSeconds * 0.45, duration: stepSeconds * 0.9,
          gain: 0.030, pan: step % 4 ? 0.32 : -0.32, wet: profile.reverb,
        });
      }
    }
  }

  /** Transform the 16-step signature into 24 distinct four-bar phrases without
   * losing recognisability. Every transformation is deterministic and repeats
   * exactly at the 96-bar boundary. */
  private arrangedMotifDegree(
    profile: BossScoreProfile,
    step: number,
    bar: number,
    shape: ArrangementShape,
  ): Degree {
    const phrase = Math.floor(bar / 4);
    const variant = phrase % 8;
    const rotations = [0, 4, 8, 12, 2, 10, 6, 14];
    let index = (step + rotations[variant]) % profile.motif.length;
    if (variant === 3 || variant === 6) index = profile.motif.length - 1 - index;
    let degree = profile.motif[index];

    // Sparse sections retain the important downbeats and let the ambience carry
    // the phrase. Energetic sections answer rests with selected motif echoes.
    const keep = hashUnit(bar * 31.17 + step * 7.13 + this.family.charCodeAt(0));
    if (degree !== null && keep > shape.melody) degree = null;
    if (degree === null && shape.melody > 0.98 && step % 4 === 2) {
      degree = profile.motif[(index + 5) % profile.motif.length];
    }
    if (degree === null) return null;

    const transpose = [0, 1, 0, -1, 2, 0, -2, 1][variant];
    const phraseLift = shape.octaveLift && ((step + phrase) % 5 === 0) ? profile.scale.length : 0;
    return degree + transpose + phraseLift;
  }

  private arrangedBassDegree(profile: BossScoreProfile, step: number, bar: number): Degree {
    const phrase = Math.floor(bar / 4);
    const rotation = [0, 0, 8, 4, 0, 12][phrase % 6];
    const degree = profile.bass[(step + rotation) % profile.bass.length];
    if (degree === null) return null;
    return degree + [0, 0, -1, 1, 0, -2][phrase % 6];
  }

  private scheduleLongFormLayers(
    profile: BossScoreProfile,
    shape: ArrangementShape,
    at: number,
    step: number,
    stepSeconds: number,
    degree: Degree,
    intensity: number,
  ): void {
    // A restrained counter-melody appears in selected macro sections and only
    // after the fight has developed, preventing the first minute from feeling
    // overcrowded.
    if (shape.counterline && this.phase >= 2 && degree !== null && [2, 6, 10, 14].includes(step)) {
      const answerDegree = degree + (this.family === 'crystal' ? 4 : this.family === 'mire' ? 3 : 2);
      const frequency = midiToHz(degreeToMidi(profile, answerDegree, shape.octaveLift));
      this.playTimbre(this.signatureTimbre(), frequency, {
        at: at + stepSeconds * 0.18,
        duration: stepSeconds * (shape.breakdown ? 2.8 : 1.55),
        gain: 0.020 * intensity,
        pan: step % 8 < 4 ? 0.46 : -0.46,
        wet: Math.min(0.86, profile.reverb + 0.12),
        cutoff: 2400 + this.phase * 450,
      });
    }

    // Section-opening impacts make the arrangement readable during a long fight.
    // The first bar intentionally has no impact, keeping encounter fade-in clean.
    if (step === 0 && this.currentSectionBar === 0 && this.currentBar > 0) {
      this.sectionImpact(profile, at, intensity, this.currentSection);
    }

    // Seven-bar buildup plus a one-bar fill leads naturally into the next
    // eight-bar section. The last fill resolves instead of rising, allowing the
    // exact loop boundary to disappear.
    if (this.currentSectionBar === 7) {
      if (step === 12 && this.currentBar < BOSS_SCORE_LOOP_BARS - 1) {
        this.noiseSweep(at, stepSeconds * 3.8, 350, 5200, 0.018 * intensity,
          this.currentSection & 1 ? 0.45 : -0.45);
      }
      if (step === 15) this.sectionFill(at, stepSeconds, intensity);
    }

    // Phase three gets a quiet, syncopated high ostinato only in the broadest
    // sections. It is deliberately absent from breakdowns to preserve contrast.
    if (this.phase === 3 && !shape.breakdown && shape.rhythm > 1 && degree !== null && (step & 1)) {
      const frequency = midiToHz(degreeToMidi(profile, degree + 7, 1));
      this.playTimbre(this.family === 'crystal' ? 'glass' : this.family === 'gilded' ? 'clock' : 'reed', frequency, {
        at, duration: stepSeconds * 0.55, gain: 0.013 * intensity,
        pan: (step % 4 < 2 ? -1 : 1) * 0.52, wet: profile.reverb,
        cutoff: 3600,
      });
    }
  }

  private scheduleCrypt(
    profile: BossScoreProfile, at: number, step: number, stepSeconds: number,
    degree: Degree, intensity: number,
  ): void {
    const shape = ARRANGEMENT[this.currentSection];
    if ((step === 0 || step === 8) && shape.rhythm > 0.52) this.lowBoom(at, 0.18 * intensity);
    if ((step === 4 || step === 12 || (this.phase === 3 && step % 4 === 2)) && shape.rhythm > 0.58) {
      this.boneClack(at, 0.052 * intensity, step % 8 ? 0.25 : -0.25);
    }
    if (degree !== null && (this.phase >= 2 || step % 4 === 0)) {
      const frequency = midiToHz(degreeToMidi(profile, degree, 1));
      this.playTimbre('choir', frequency, {
        at, duration: stepSeconds * 2.8, gain: 0.052 * intensity,
        pan: step % 8 < 4 ? -0.22 : 0.22, wet: 0.72, cutoff: 1900,
      });
    }
    if (step === 14) this.glassHit(midiToHz(profile.rootMidi + 36), at, stepSeconds * 3.4, 0.045, 0.1);
  }

  private scheduleMire(
    profile: BossScoreProfile, at: number, step: number, stepSeconds: number,
    degree: Degree, intensity: number,
  ): void {
    const shape = ARRANGEMENT[this.currentSection];
    if ([0, 6, 10, 14].includes(step) && shape.rhythm > 0.54) this.lowBoom(at, 0.145 * intensity);
    if ([3, 7, 11, 15].includes(step)) this.noiseHit(at, 0.1, 480, 0.032 * intensity, 'bandpass', step % 4 ? 0.28 : -0.28);
    if (degree !== null && (step & 1 || this.phase >= 2)) {
      const frequency = midiToHz(degreeToMidi(profile, degree, 1));
      this.playTimbre('reed', frequency, {
        at, duration: stepSeconds * (step & 1 ? 1.6 : 2.4), gain: 0.052 * intensity,
        pan: -0.3 + (step % 5) * 0.15, wet: 0.5, cutoff: 1400 + this.phase * 350,
      });
    }
    if (this.phase >= 2 && step % 4 === 2) {
      this.insectTrill(midiToHz(degreeToMidi(profile, 5 + (step % 3), 2)), at, stepSeconds * 1.6, 0.024);
    }
  }

  private scheduleEmber(
    profile: BossScoreProfile, at: number, step: number, stepSeconds: number,
    degree: Degree, intensity: number,
  ): void {
    const shape = ARRANGEMENT[this.currentSection];
    if ([0, 3, 6, 10, 13].includes(step) && shape.rhythm > 0.56) this.lowBoom(at, 0.2 * intensity);
    if (step === 4 || step === 12) {
      this.noiseHit(at, 0.105, 1550, 0.07 * intensity, 'bandpass', step === 4 ? -0.18 : 0.18);
      this.metalHit(at, 0.06 * intensity, 90);
    }
    if (this.phase >= 2 && (step & 1)) this.noiseHit(at, 0.035, 4700, 0.022, 'highpass', 0.3);
    if (degree !== null && (this.phase >= 2 || [0, 6, 10, 13].includes(step))) {
      const frequency = midiToHz(degreeToMidi(profile, degree, 1));
      this.playTimbre('brass', frequency, {
        at, duration: stepSeconds * 1.9, gain: 0.071 * intensity,
        pan: step % 4 < 2 ? -0.16 : 0.16, wet: 0.18, cutoff: 1800 + this.phase * 900,
      });
    }
  }

  private scheduleCrystal(
    profile: BossScoreProfile, at: number, step: number, stepSeconds: number,
    degree: Degree, intensity: number,
  ): void {
    const shape = ARRANGEMENT[this.currentSection];
    if (degree !== null) {
      const octave = step % 5 === 0 ? 2 + shape.octaveLift : 1;
      const frequency = midiToHz(degreeToMidi(profile, degree, octave));
      this.glassHit(frequency, at, stepSeconds * (this.phase === 1 ? 3.4 : 2.2), 0.045 * intensity,
        -0.7 + (step / 15) * 1.4);
      if (this.phase === 3 && step % 3 === 0) {
        this.glassHit(frequency * 1.5, at + stepSeconds * 0.34, stepSeconds * 2.4, 0.026, 0.45);
      }
    }
    if (step === 0 || (this.phase >= 2 && step === 8)) this.lowBoom(at, 0.1 * intensity);
    if ([2, 5, 9, 14].includes(step)) this.crystalClick(at, 0.032 * intensity, step % 2 ? 0.5 : -0.5);
  }

  private scheduleGilded(
    profile: BossScoreProfile, at: number, step: number, stepSeconds: number,
    degree: Degree, intensity: number,
  ): void {
    const shape = ARRANGEMENT[this.currentSection];
    if (shape.rhythm > 0.52 || (step & 1) === 0) {
      this.clockTick(at, 0.022 * intensity, step & 1 ? 0.45 : -0.45, step & 1 ? 3100 : 2300);
    }
    if (step === 0 || step === 8) this.lowBoom(at, 0.155 * intensity);
    if ([3, 7, 11, 15].includes(step)) this.metalHit(at, 0.035 * intensity, step & 4 ? 160 : 120);
    if (degree !== null && (this.phase >= 2 || [0, 5, 10, 13].includes(step))) {
      const frequency = midiToHz(degreeToMidi(profile, degree, 1));
      this.playTimbre(step % 3 === 0 ? 'brass' : 'clock', frequency, {
        at, duration: stepSeconds * (step % 3 === 0 ? 1.7 : 0.85), gain: 0.052 * intensity,
        pan: step % 4 < 2 ? -0.28 : 0.28, wet: 0.26, cutoff: 2300 + this.phase * 550,
      });
    }
  }

  private padChord(
    profile: BossScoreProfile,
    chord: readonly number[],
    at: number,
    duration: number,
    gain: number,
  ): void {
    chord.forEach((degree, index) => {
      const frequency = midiToHz(degreeToMidi(profile, degree, 0));
      this.playTimbre(this.family === 'crystal' ? 'glass' : 'choir', frequency, {
        at: at + index * 0.018,
        duration,
        gain: gain / Math.sqrt(chord.length),
        pan: -0.42 + index * 0.42,
        wet: profile.reverb,
        attack: this.family === 'crystal' ? 0.025 : 0.22,
        release: Math.min(1.1, duration * 0.42),
        cutoff: this.family === 'ember' ? 1300 : 2100,
      });
    });
  }

  private sectionImpact(
    profile: BossScoreProfile,
    at: number,
    intensity: number,
    section: number,
  ): void {
    this.lowBoom(at, 0.18 * intensity);
    const root = midiToHz(profile.rootMidi + 12 + (section % 3 === 0 ? 7 : 0));
    if (this.family === 'ember' || this.family === 'gilded') {
      this.metalHit(at + 0.025, 0.044 * intensity, this.family === 'ember' ? 82 : 126);
    } else if (this.family === 'crystal') {
      this.glassHit(root * 3, at + 0.02, 1.25, 0.052 * intensity, -0.38);
      this.glassHit(root * 4.5, at + 0.085, 1.05, 0.034 * intensity, 0.38);
    } else {
      this.playTimbre(this.signatureTimbre(), root, {
        at: at + 0.03, duration: 0.9, gain: 0.050 * intensity,
        wet: Math.min(0.9, profile.reverb + 0.12), cutoff: 1700,
      });
    }
  }

  private sectionFill(at: number, stepSeconds: number, intensity: number): void {
    const count = this.family === 'ember' ? 4 : this.family === 'gilded' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const t = at + i * stepSeconds * 0.18;
      if (this.family === 'crypt') this.boneClack(t, 0.025 * intensity * (1 + i * 0.12), -0.5 + i / count);
      else if (this.family === 'mire') this.noiseHit(t, 0.045, 520 + i * 170, 0.021 * intensity, 'bandpass', -0.5 + i / count);
      else if (this.family === 'ember') this.metalHit(t, 0.019 * intensity, 74 + i * 12);
      else if (this.family === 'crystal') this.crystalClick(t, 0.018 * intensity, -0.6 + i * 0.3);
      else this.clockTick(t, 0.016 * intensity, -0.55 + i * 0.25, 2100 + i * 330);
    }
  }

  private noiseSweep(
    at: number,
    duration: number,
    from: number,
    to: number,
    gainValue: number,
    pan: number,
  ): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.85;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gainValue, at + duration * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, at);
    panner.pan.linearRampToValueAtTime(-pan, at + duration);
    source.connect(filter).connect(amp).connect(panner);
    this.connectVoice(panner, 0.66);
    source.start(at);
    source.stop(at + duration + 0.03);
    this.track(source);
  }

  private signatureTimbre(): Timbre {
    switch (this.family) {
      case 'crypt': return 'choir';
      case 'mire': return 'reed';
      case 'ember': return 'brass';
      case 'crystal': return 'glass';
      case 'gilded': return 'clock';
      default: return 'choir';
    }
  }

  private playTimbre(timbre: Timbre, frequency: number, options: VoiceOptions): void {
    if (timbre === 'glass') {
      this.glassHit(frequency, options.at, options.duration, options.gain, options.pan ?? 0);
      return;
    }
    if (timbre === 'bass') {
      this.bassNote(frequency, options.at, options.duration, options.gain);
      return;
    }

    const at = options.at;
    const duration = Math.max(0.045, options.duration);
    const attack = Math.max(0.006, options.attack ?? (timbre === 'choir' ? 0.12 : 0.018));
    const release = Math.max(0.04, options.release ?? (timbre === 'choir' ? 0.42 : 0.16));
    const peak = Math.max(0.0002, options.gain);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = timbre === 'reed' ? 3.2 : timbre === 'clock' ? 1.8 : 0.8;
    filter.frequency.setValueAtTime(options.cutoff ?? 2200, at);
    if (timbre === 'brass') {
      filter.frequency.exponentialRampToValueAtTime((options.cutoff ?? 2200) * 1.5, at + Math.min(0.16, duration * 0.25));
      filter.frequency.exponentialRampToValueAtTime(Math.max(500, options.cutoff ?? 1500), at + duration);
    }

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(peak, at + attack);
    amp.gain.exponentialRampToValueAtTime(peak * (timbre === 'choir' ? 0.72 : 0.5), at + Math.max(attack + 0.02, duration - release));
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(clamp(options.pan ?? 0, -1, 1), at);
    filter.connect(amp).connect(panner);
    this.connectVoice(panner, options.wet ?? 0.35);

    const voices: readonly [OscillatorType, number, number, number][] = timbre === 'choir'
      ? [['triangle', 1, -6, 0.66], ['sine', 2, 4, 0.22], ['sine', 0.5, 0, 0.18]]
      : timbre === 'reed'
        ? [['sawtooth', 1, -4, 0.58], ['triangle', 1, 5, 0.42], ['sine', 2, 0, 0.12]]
        : timbre === 'brass'
          ? [['sawtooth', 1, -8, 0.62], ['sawtooth', 1, 8, 0.62], ['square', 0.5, 0, 0.13]]
          : [['square', 1, -3, 0.46], ['triangle', 2, 4, 0.34], ['sine', 3, 0, 0.12]];

    for (const [type, ratio, detune, level] of voices) {
      const osc = this.ctx.createOscillator();
      const levelGain = this.ctx.createGain();
      levelGain.gain.value = level;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(24, frequency * ratio), at);
      osc.detune.setValueAtTime(detune, at);
      if (timbre === 'reed') {
        osc.detune.linearRampToValueAtTime(detune + 7, at + duration * 0.45);
        osc.detune.linearRampToValueAtTime(detune - 2, at + duration);
      }
      osc.connect(levelGain).connect(filter);
      osc.start(at);
      osc.stop(at + duration + 0.04);
      this.track(osc);
    }
  }

  private bassNote(frequency: number, at: number, duration: number, gainValue: number): void {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(520, at);
    filter.frequency.exponentialRampToValueAtTime(190, at + Math.min(duration, 0.45));

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gainValue, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(gainValue * 0.58, at + Math.max(0.04, duration * 0.32));
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    filter.connect(amp);
    this.connectVoice(amp, 0.06);

    for (const [type, ratio, level] of [['sine', 1, 0.8], ['triangle', 2, 0.28]] as const) {
      const osc = this.ctx.createOscillator();
      const levelGain = this.ctx.createGain();
      levelGain.gain.value = level;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(26, frequency * ratio), at);
      if (ratio === 1) osc.frequency.exponentialRampToValueAtTime(Math.max(24, frequency * 0.985), at + duration);
      osc.connect(levelGain).connect(filter);
      osc.start(at);
      osc.stop(at + duration + 0.03);
      this.track(osc);
    }
  }

  private glassHit(frequency: number, at: number, duration: number, gainValue: number, pan = 0): void {
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gainValue, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.06, duration));
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(clamp(pan, -1, 1), at);
    amp.connect(panner);
    this.connectVoice(panner, 0.78);

    const partials: readonly [number, number][] = [[1, 0.7], [2.01, 0.3], [3.98, 0.17], [6.12, 0.08]];
    for (const [ratio, level] of partials) {
      const osc = this.ctx.createOscillator();
      const levelGain = this.ctx.createGain();
      levelGain.gain.value = level;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency * ratio, at);
      osc.detune.setValueAtTime((hashUnit(this.absoluteStep + ratio) - 0.5) * 5, at);
      osc.connect(levelGain).connect(amp);
      osc.start(at);
      osc.stop(at + duration + 0.04);
      this.track(osc);
    }
  }

  private lowBoom(at: number, gainValue: number): void {
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, at);
    osc.frequency.exponentialRampToValueAtTime(38, at + 0.24);
    amp.gain.setValueAtTime(gainValue, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
    osc.connect(amp);
    this.connectVoice(amp, 0.08);
    osc.start(at);
    osc.stop(at + 0.35);
    this.track(osc);
    this.noiseHit(at, 0.045, 180, gainValue * 0.16, 'lowpass', 0);
  }

  private noiseHit(
    at: number,
    duration: number,
    frequency: number,
    gainValue: number,
    type: BiquadFilterType,
    pan: number,
  ): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    filter.Q.value = type === 'bandpass' ? 1.8 : 0.72;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gainValue, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(clamp(pan, -1, 1), at);
    source.connect(filter).connect(amp).connect(panner);
    this.connectVoice(panner, 0.26);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.02);
    const offset = hashUnit(this.absoluteStep * 7.17 + frequency) * maxOffset;
    source.start(at, offset, duration + 0.01);
    this.track(source);
  }

  private boneClack(at: number, gainValue: number, pan: number): void {
    this.noiseHit(at, 0.035, 2450, gainValue, 'bandpass', pan);
    this.playTimbre('clock', 940, { at, duration: 0.055, gain: gainValue * 0.42, pan, wet: 0.5, cutoff: 3200 });
  }

  private metalHit(at: number, gainValue: number, baseFrequency: number): void {
    const partials = [1, 1.41, 2.23, 3.67];
    partials.forEach((ratio, index) => {
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = index & 1 ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(baseFrequency * ratio, at);
      amp.gain.setValueAtTime(gainValue / (1 + index * 0.65), at);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.18 + index * 0.035);
      osc.connect(amp);
      this.connectVoice(amp, 0.32);
      osc.start(at);
      osc.stop(at + 0.34);
      this.track(osc);
    });
  }

  private clockTick(at: number, gainValue: number, pan: number, frequency: number): void {
    this.noiseHit(at, 0.018, frequency, gainValue, 'bandpass', pan);
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency * 0.55, at);
    amp.gain.setValueAtTime(gainValue * 0.35, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.026);
    osc.connect(amp);
    this.connectVoice(amp, 0.08);
    osc.start(at);
    osc.stop(at + 0.03);
    this.track(osc);
  }

  private crystalClick(at: number, gainValue: number, pan: number): void {
    this.glassHit(1700 + (this.absoluteStep % 5) * 170, at, 0.13, gainValue, pan);
    this.noiseHit(at, 0.022, 5600, gainValue * 0.35, 'highpass', pan);
  }

  private insectTrill(frequency: number, at: number, duration: number, gainValue: number): void {
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const amp = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, at);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(18, at);
    lfoGain.gain.value = frequency * 0.018;
    lfo.connect(lfoGain).connect(osc.frequency);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gainValue, at + 0.025);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp);
    this.connectVoice(amp, 0.46);
    osc.start(at); lfo.start(at);
    osc.stop(at + duration + 0.02); lfo.stop(at + duration + 0.02);
    this.track(osc); this.track(lfo);
  }

  private connectVoice(node: AudioNode, wet: number): void {
    const wetAmount = clamp(wet, 0, 1);
    const drySend = this.ctx.createGain();
    drySend.gain.value = 1 - wetAmount * 0.34;
    node.connect(drySend).connect(this.dryGain);

    if (wetAmount > 0.01) {
      const reverbSend = this.ctx.createGain();
      reverbSend.gain.value = wetAmount;
      node.connect(reverbSend).connect(this.reverb);
    }
    const delayAmount = BOSS_SCORE_PROFILES[this.family].delay;
    if (delayAmount > 0.01) {
      const delaySend = this.ctx.createGain();
      delaySend.gain.value = delayAmount * (0.55 + wetAmount * 0.45);
      node.connect(delaySend).connect(this.delay);
    }
  }

  private track(source: AudioScheduledSourceNode): void {
    this.sources.add(source);
    source.addEventListener('ended', () => this.sources.delete(source), { once: true });
  }

  private applyProfileMix(): void {
    const profile = BOSS_SCORE_PROFILES[this.family];
    const beat = 60 / profile.bpm;
    this.delay.delayTime.setValueAtTime(beat * (this.family === 'crystal' ? 0.75 : 0.5), this.ctx.currentTime);
    this.delayFeedback.gain.setValueAtTime(this.family === 'crystal' ? 0.32 : 0.2, this.ctx.currentTime);
    this.delayReturn.gain.setValueAtTime(0.12 + profile.delay * 0.35, this.ctx.currentTime);
    this.reverbReturn.gain.setValueAtTime(0.22 + profile.reverb * 0.35, this.ctx.currentTime);
  }

  private createNoiseBuffer(seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x6d2b79f5;
    for (let i = 0; i < length; i++) {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      data[i] = (((state ^ (state >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  private createImpulse(seconds: number, decay: number): AudioBuffer {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    let state = 0x1234abcd;
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const noise = state / 4294967296 * 2 - 1;
        data[i] = noise * (1 - i / length) ** decay * (channel === 0 ? 1 : 0.97);
      }
    }
    return impulse;
  }
}
