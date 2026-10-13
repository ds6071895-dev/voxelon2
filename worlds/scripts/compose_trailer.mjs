// Worlds Awaken: an original 40-bar score at 120 BPM, A minor -> D minor -> C major.
// Dependency-free subtractive synthesis (band-limited saws, resonant filters,
// FM bells, synthesized drums), sidechain ducking and a stereo reverb. No
// recordings, samples or stock music. The sound effects are cued from
// src/trailer/timeline.json, so they land exactly on the picture.
// node scripts/compose_trailer.mjs [output directory]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseDirectory } from './release_tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const timeline = JSON.parse(await readFile(path.join(here, '../src/trailer/timeline.json'), 'utf8'));
const output = path.resolve(process.argv[2] ?? path.join(releaseDirectory, 'audio'));
await mkdir(output, { recursive: true });

const RATE = 48000, SECONDS = timeline.duration, N = RATE * SECONDS, TAU = Math.PI * 2;
const BPM = timeline.bpm, BEAT = 60 / BPM, BAR = BEAT * 4;
const make = () => [new Float32Array(N), new Float32Array(N)];
// Buses: each is routed through its own sidechain/reverb treatment before the sum.
const bus = { pad: make(), lead: make(), arp: make(), bass: make(), drums: make(), fx: make(), sfx: make() };
const duck = new Float32Array(N).fill(1);
const events = [];

let seed = 20261101;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const hz = m => 440 * 2 ** ((m - 69) / 12);
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const gains = pan => [Math.cos((pan + 1) * Math.PI / 4), Math.sin((pan + 1) * Math.PI / 4)];

// ── oscillators ──────────────────────────────────────────────────────────
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const sawSample = (phase, dt) => 2 * phase - 1 - blep(phase, dt);
const squareSample = (phase, dt, width = .5) => {
  let v = phase < width ? 1 : -1;
  v += blep(phase, dt); v -= blep((phase + 1 - width) % 1, dt);
  return v;
};

/** Chamberlin state-variable filter; returns { lp, bp } per sample. */
class SVF {
  constructor() { this.lp = 0; this.bp = 0; }
  run(x, cutoff, q) {
    const f = 2 * Math.sin(Math.PI * Math.min(cutoff, RATE * .45) / RATE);
    this.lp += f * this.bp;
    const hp = x - this.lp - q * this.bp;
    this.bp += f * hp;
    return this.lp;
  }
}

function adsr(t, dur, a, d, s, r) {
  if (t < 0) return 0;
  let v;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * (t - a) / d;
  else v = s;
  if (t > dur) v *= Math.max(0, 1 - (t - dur) / r);
  return v;
}

function add(target, start, i, v, l, r) {
  const k = start + i;
  if (k >= 0 && k < N) { target[0][k] += v * l; target[1][k] += v * r; }
}

/** Detuned band-limited saw stack through a swept low-pass. */
function synth(target, midi, at, dur, o = {}) {
  const {
    amp = .1, pan = 0, voices = 5, detune = .16, attack = .01, decay = .3, sustain = .7, release = .2,
    cutoff = 2400, cutoffEnv = 0, cutoffDecay = .25, q = .35, sub = 0, shape = 'saw', vibrato = 0, drift = 0,
  } = o;
  const start = Math.round(at * RATE), length = Math.round((dur + release * 3) * RATE);
  const f0 = hz(midi), [l, r] = gains(pan);
  const phases = Array.from({ length: voices }, () => rnd()), filter = new SVF(), filter2 = new SVF();
  const spread = Array.from({ length: voices }, (_, v) => voices === 1 ? 0 : (v / (voices - 1) - .5) * 2);
  const norm = 1 / Math.sqrt(voices);
  for (let i = 0; i < length && start + i < N; i++) {
    if (start + i < 0) continue;
    const t = i / RATE, env = adsr(t, dur, attack, decay, sustain, release);
    if (env <= 1e-5 && t > dur) break;
    const vib = vibrato ? 1 + vibrato * Math.sin(TAU * 5.3 * t) * smooth(t / .4) : 1;
    let s = 0;
    for (let v = 0; v < voices; v++) {
      const f = f0 * vib * 2 ** (spread[v] * detune / 12 + (drift ? drift * Math.sin(t * 1.3 + v) / 12 : 0));
      const dt = f / RATE; phases[v] = (phases[v] + dt) % 1;
      s += shape === 'square' ? squareSample(phases[v], dt) : sawSample(phases[v], dt);
    }
    s *= norm;
    if (sub) s += Math.sin(TAU * f0 * .5 * t) * sub;
    const c = cutoff + cutoffEnv * Math.exp(-t / cutoffDecay);
    s = filter2.run(filter.run(s, c, q), c, q);
    add(target, start, i, s * env * amp, l, r);
  }
  events.push({ bus: o.busName ?? 'synth', midi, at: +at.toFixed(3), duration: +dur.toFixed(3) });
}

/** Sine-ish plucked piano/harp/marimba hybrid with a hammer transient. */
function pluck(target, midi, at, dur, o = {}) {
  const { amp = .1, pan = 0, bright = 1, decay = 2.2, bell = 0 } = o;
  const start = Math.round(at * RATE), length = Math.round(Math.min(dur + decay, 4) * RATE), f = hz(midi), [l, r] = gains(pan);
  for (let i = 0; i < length && start + i < N; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * (3.2 / Math.max(.3, decay)) * (1 + midi / 90)) * Math.min(1, t * 700);
    const p = TAU * f * t;
    let s = Math.sin(p) + .5 * bright * Math.sin(2 * p) * Math.exp(-t * 5) + .22 * bright * Math.sin(3 * p) * Math.exp(-t * 8) + .08 * Math.sin(4.01 * p) * Math.exp(-t * 12);
    if (bell) s += bell * Math.sin(TAU * f * 3.51 * t) * Math.exp(-t * 6);
    s += (rnd() * 2 - 1) * Math.exp(-t * 90) * .22;
    add(target, start, i, s * env * amp, l, r);
  }
}

/** Formant "ah" choir-ish pad: saw stack through two band-passes. */
function choir(target, midi, at, dur, o = {}) {
  const { amp = .06, pan = 0, attack = .6, release = 1.2, vowel = 0 } = o;
  const start = Math.round(at * RATE), length = Math.round((dur + release * 2) * RATE), f0 = hz(midi), [l, r] = gains(pan);
  const forms = [[800, 1150, 2900], [400, 800, 2600], [350, 1700, 2700]][vowel] ?? [800, 1150, 2900];
  const filters = forms.map(() => new SVF()), phases = [rnd(), rnd(), rnd()];
  for (let i = 0; i < length && start + i < N; i++) {
    const t = i / RATE, env = adsr(t, dur, attack, .3, .9, release);
    let s = 0;
    for (let v = 0; v < 3; v++) {
      const f = f0 * 2 ** ((v - 1) * .1 / 12) * (1 + .004 * Math.sin(TAU * 5.2 * t + v));
      const dt = f / RATE; phases[v] = (phases[v] + dt) % 1; s += sawSample(phases[v], dt);
    }
    let out = 0;
    for (let k = 0; k < forms.length; k++) { filters[k].run(s, forms[k], .12); out += (filters[k].bp) * [1, .7, .35][k]; }
    add(target, start, i, out * env * amp * .5, l, r);
  }
}

// ── drums ────────────────────────────────────────────────────────────────
function kick(at, amp = .9) {
  const start = Math.round(at * RATE), n = Math.round(.55 * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    phase += TAU * (44 + 130 * Math.exp(-t * 38)) / RATE;
    const click = (rnd() * 2 - 1) * Math.exp(-t * 220) * .35;
    const v = (Math.sin(phase) * Math.exp(-t * 6.5) + click) * Math.min(1, t * 1500) * amp;
    add(bus.drums, start, i, v, 1, 1);
  }
  // Sidechain: everything melodic breathes around the kick.
  const dn = Math.round(.26 * RATE);
  for (let i = 0; i < dn && start + i < N; i++) duck[start + i] = Math.min(duck[start + i], 1 - .62 * Math.exp(-i / RATE / .085) * (amp > .5 ? 1 : .5));
}
function snare(at, amp = .5, pan = 0) {
  const start = Math.round(at * RATE), n = Math.round(.45 * RATE), [l, r] = gains(pan), filter = new SVF();
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, noise = rnd() * 2 - 1;
    filter.run(noise, 5500, .6);
    const body = Math.sin(TAU * (190 - 50 * t) * t) * Math.exp(-t * 20);
    const v = (noise - filter.lp * .6) * Math.exp(-t * 13) * .8 + body * .6;
    add(bus.drums, start, i, v * amp, l, r);
  }
}
function clap(at, amp = .4) {
  const start = Math.round(at * RATE), n = Math.round(.4 * RATE), f = new SVF();
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    const burst = Math.exp(-((t * 1000) % 11) * .35) * (t < .033 ? 1 : 0) + Math.exp(-t * 18);
    f.run(rnd() * 2 - 1, 1500, .8);
    add(bus.drums, start, i, f.bp * 1.4 * burst * amp, .9, 1.1);
  }
}
function hat(at, amp = .16, open = false, pan = 0) {
  const start = Math.round(at * RATE), n = Math.round((open ? .32 : .07) * RATE), [l, r] = gains(pan);
  let last = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, noise = rnd() * 2 - 1, hp = noise - last; last = noise;
    add(bus.drums, start, i, hp * Math.exp(-t * (open ? 11 : 60)) * amp, l, r);
  }
}
function tom(at, midi = 45, amp = .6, pan = 0) {
  const start = Math.round(at * RATE), n = Math.round(.5 * RATE), [l, r] = gains(pan);
  let phase = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    phase += TAU * (hz(midi) * (1 + .6 * Math.exp(-t * 18))) / RATE;
    add(bus.drums, start, i, Math.sin(phase) * Math.exp(-t * 8) * amp, l, r);
  }
}
function crash(at, amp = .35, length = 2.8) {
  const start = Math.round(at * RATE), n = Math.round(length * RATE);
  let a = 0, b = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, noise = rnd() * 2 - 1;
    a += .35 * (noise - a); b += .08 * (noise - b);
    const hp = noise - a * .8 - b * .2;
    add(bus.drums, start, i, hp * Math.exp(-t * 1.8) * Math.min(1, t * 400) * amp, 1, 1);
  }
}
/** Rising noise + tone sweep that peaks at `at + duration`. */
function riser(at, duration, amp = .2) {
  const start = Math.round(at * RATE), n = Math.round(duration * RATE), filter = new SVF();
  let phase = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, k = t / duration;
    const noise = filter.run(rnd() * 2 - 1, 300 + 9000 * k * k, .5);
    phase += TAU * (110 * 2 ** (k * 3)) / RATE;
    const v = (noise * 1.4 + Math.sin(phase) * .25) * k * k * amp;
    add(bus.fx, start, i, v, .9, .9);
  }
}
/** Reverse-cymbal style swell. */
function swell(at, duration, amp = .2) {
  const start = Math.round(at * RATE), n = Math.round(duration * RATE);
  let a = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, k = t / duration; const noise = rnd() * 2 - 1; a += .25 * (noise - a);
    add(bus.fx, start, i, (noise - a) * k * k * k * amp, 1, 1);
  }
}
function boom(at, amp = .8, length = 2.4) {
  const start = Math.round(at * RATE), n = Math.round(length * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    phase += TAU * (38 + 70 * Math.exp(-t * 9)) / RATE;
    add(bus.fx, start, i, (Math.sin(phase) * Math.exp(-t * 1.9) + (rnd() * 2 - 1) * .12 * Math.exp(-t * 9)) * amp, 1, 1);
  }
}

// ── arrangement ──────────────────────────────────────────────────────────
const bar = n => n * BAR;
// Section map (bars). Each = [name, firstBar, lastBarExclusive].
const S = {
  intro: [0, 2], bedwars: [2, 12], bridge: [12, 18], duels: [18, 23], parkour: [23, 29], rats: [29, 35], reel: [35, 37], logo: [37, 40],
};
const inSection = b => Object.entries(S).find(([, [a, z]]) => b >= a && b < z)?.[0];
// Chords as MIDI (root, third, fifth, seventh/extension), voiced mid-register.
const CH = {
  Am: [57, 60, 64, 67], F: [53, 57, 60, 64], C: [48, 55, 60, 64], G: [55, 59, 62, 67],
  Dm: [50, 57, 62, 65], Bb: [46, 53, 58, 62], Fm: [53, 56, 60, 65], Csus: [48, 55, 60, 65], Cmaj: [48, 52, 55, 59], Em: [52, 55, 59, 64], Gsus: [55, 60, 62, 67],
};
const ROOT = { Am: 33, F: 29, C: 36, G: 31, Dm: 38, Bb: 34, Em: 28, Gsus: 31 };
const progression = {
  bedwars: ['Am', 'F', 'C', 'G'], bridge: ['Am', 'F', 'C', 'G'], duels: ['Am', 'Am', 'F', 'G', 'Am'],
  parkour: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb'], rats: ['C', 'Am', 'F', 'G', 'C', 'Am'], reel: ['F', 'G'], logo: ['C', 'C', 'C'],
};
const barChord = b => {
  const name = inSection(b);
  if (name === 'intro') return b === 0 ? 'Am' : 'F';
  const [first] = S[name]; return progression[name][(b - first) % progression[name].length];
};

// Theme in A minor, one chord per bar (beat positions in quarter notes).
const THEME = {
  Am: [[0, 76, 1], [1, 81, 1], [2, 84, 1.5], [3.5, 83, .5]],
  F: [[0, 81, 1.5], [1.5, 79, .5], [2, 77, 1], [3, 81, 1]],
  C: [[0, 79, 1], [1, 76, 1], [2, 79, 1.5], [3.5, 81, .5]],
  G: [[0, 83, 2], [2, 81, 1], [3, 79, 1]],
};
// Parkour restates it a fourth up with the rhythm pushed.
const THEME_UP = {
  Dm: [[0, 81, .5], [.5, 86, 1], [1.5, 89, 1], [2.5, 88, .5], [3, 86, 1]],
  Bb: [[0, 86, .5], [.5, 84, 1], [1.5, 82, 1], [2.5, 84, .5], [3, 86, 1]],
  F: [[0, 84, .5], [.5, 81, 1], [1.5, 84, 1], [2.5, 89, .5], [3, 88, 1]],
  C: [[0, 88, 1.5], [1.5, 86, .5], [2, 84, 1], [3, 83, 1]],
};

function padChord(b, name, o = {}) {
  const at = bar(b), notes = CH[name], dur = o.bars ? bar(o.bars) : BAR;
  notes.forEach((m, i) => synth(bus.pad, m + (o.up ?? 0), at, dur + .05, {
    amp: (o.amp ?? .05), pan: (i - 1.5) * .35, voices: 4, detune: .22, attack: o.attack ?? .35, decay: .5, sustain: .85, release: .6, cutoff: o.cutoff ?? 1500, q: .3, busName: 'pad', drift: .08,
  }));
}
function bassLine(b, name, style) {
  const root = ROOT[name], at = bar(b);
  const hit = (beat, m, len, amp = .26) => synth(bus.bass, m, at + beat * BEAT, len * BEAT, {
    amp, voices: 2, detune: .05, attack: .004, decay: .12, sustain: .55, release: .08, cutoff: 360, cutoffEnv: 900, cutoffDecay: .09, q: .3, sub: .8, busName: 'bass',
  });
  if (style === 'drive') for (let e = 0; e < 8; e++) hit(e * .5, root + (e % 4 === 3 ? 12 : 0), .45, e % 2 ? .2 : .27);
  else if (style === 'pulse') for (let e = 0; e < 8; e++) hit(e * .5, root, .4, .26);
  else if (style === 'sixteenth') for (let e = 0; e < 16; e++) hit(e * .25, root + ([0, 0, 12, 0, 0, 7, 0, 12][e % 8]), .22, e % 4 === 0 ? .27 : .19);
  else if (style === 'bounce') { hit(0, root, .35); hit(1.5, root + 12, .3); hit(2, root, .35); hit(3.5, root + 7, .3); }
  else if (style === 'long') hit(0, root, 3.8, .28);
}
function arpBar(b, name, o = {}) {
  const notes = CH[name], at = bar(b), pat = o.pattern ?? [0, 1, 2, 3, 2, 1, 2, 3];
  const step = o.step ?? .5;
  for (let s = 0; s < 4 / step; s++) {
    const m = notes[pat[s % pat.length]] + 12 * (o.oct ?? 1) + ((s % 8) >= 4 && o.lift ? 12 : 0);
    synth(bus.arp, m, at + s * step * BEAT, step * BEAT * .9, {
      amp: o.amp ?? .06, pan: s % 2 ? .35 : -.35, voices: 3, detune: .1, attack: .003, decay: .1, sustain: .25, release: .06, cutoff: 1400, cutoffEnv: o.bright ?? 4200, cutoffDecay: .11, q: .4, busName: 'arp',
    });
  }
}
function leadBar(b, notes, o = {}) {
  const at = bar(b);
  for (const [beat, midi, len] of notes) {
    synth(bus.lead, midi, at + beat * BEAT, len * BEAT * .96, {
      amp: o.amp ?? .09, pan: o.pan ?? 0, voices: 5, detune: .24, attack: .012, decay: .2, sustain: .8, release: .22, cutoff: o.cutoff ?? 3600, cutoffEnv: 2500, cutoffDecay: .3, q: .25, vibrato: .006, busName: 'lead',
    });
    if (o.octave) synth(bus.lead, midi - 12, at + beat * BEAT, len * BEAT * .96, { amp: (o.amp ?? .09) * .55, voices: 3, detune: .18, attack: .02, decay: .2, sustain: .8, release: .22, cutoff: 1800, cutoffEnv: 1500, cutoffDecay: .25, q: .3, busName: 'lead' });
  }
}
function drumBar(b, level) {
  const at = bar(b);
  const beat = n => at + n * BEAT;
  if (level >= 1) for (let k = 0; k < 4; k++) kick(beat(k), k === 0 ? 1 : .88);
  if (level >= 1) { clap(beat(1), .34); clap(beat(3), .38); snare(beat(1), .25); snare(beat(3), .28); }
  if (level >= 1) for (let e = 0; e < 8; e++) if (e % 2) hat(beat(e * .5), .14, e === 7, e % 4 === 1 ? -.3 : .3);
  if (level >= 2) for (let s = 0; s < 16; s++) if (s % 2 === 0 || level >= 3) hat(beat(s * .25), s % 4 === 2 ? .09 : .06, false, s % 2 ? .45 : -.45);
  if (level >= 3) kick(beat(2.5), .6);
}

// ── intro (bars 0-1): pianos over wind, then a swell into the main theme ──
{
  const wind = bus.fx; let a = 0;
  for (let i = 0; i < RATE * 4.2; i++) {
    const t = i / RATE, noise = rnd() * 2 - 1; a += .01 * (noise - a);
    const v = a * 7 * Math.sin(Math.PI * Math.min(1, t / 4.2)) * .12; wind[0][i] += v; wind[1][i] += v * .8;
  }
  [[0, 57], [.5, 64], [1, 69], [1.5, 72], [2, 76], [2.5, 72], [3, 69], [3.5, 64]].forEach(([beat, m]) => pluck(bus.lead, m, beat * BEAT, 2, { amp: .09, pan: -.2 + beat * .1, decay: 2.4, bell: .2 }));
  [[4, 53], [4.5, 60], [5, 65], [5.5, 69], [6, 72], [6.5, 77], [7, 81]].forEach(([beat, m]) => pluck(bus.lead, m, beat * BEAT, 2, { amp: .09, pan: .2 - (beat - 4) * .05, decay: 2.2, bell: .25 }));
  padChord(0, 'Am', { bars: 1, amp: .045, attack: 1.2, cutoff: 1100 });
  padChord(1, 'F', { bars: 1, amp: .06, attack: .8, cutoff: 1800 });
  swell(1, 3, .2); riser(2.4, 1.6, .22);
  tom(3.5, 45, .55); tom(3.75, 48, .6, -.2); tom(3.875, 50, .6, .2);
}

// ── main loop: per-bar layers by section ────────────────────────────────
for (let b = 2; b < 40; b++) {
  const section = inSection(b), [first, end] = S[section], k = b - first, name = barChord(b);
  const last = b === end - 1, firstBar = b === first;
  if (section === 'bedwars') {
    const build = smooth(k / 4); // opens up over the first four bars
    padChord(b, name, { amp: .05 + .02 * build, cutoff: 1300 + 1500 * build });
    bassLine(b, name, k < 2 ? 'pulse' : 'drive');
    if (k >= 1) arpBar(b, name, { amp: .04 + .03 * build, step: .25, pattern: [0, 1, 2, 3, 2, 1, 2, 1], bright: 3000 + 2000 * build });
    drumBar(b, k < 2 ? 1 : 2);
    if (k >= 2) leadBar(b, THEME[name], { amp: .085, octave: k >= 6 });
    if (k < 2) for (const [beat, midi, len] of THEME[name]) pluck(bus.lead, midi, bar(b) + beat * BEAT, len, { amp: .07, decay: 1.8, bell: .15, pan: .1 });
  } else if (section === 'bridge') {
    padChord(b, name, { amp: .065, cutoff: 2600 });
    bassLine(b, name, 'drive');
    arpBar(b, name, { amp: .06, step: .25, pattern: [0, 2, 1, 3, 2, 3, 1, 2], bright: 5000, lift: k % 2 === 1 });
    drumBar(b, 3);
    leadBar(b, THEME[name], { amp: .095, octave: true });
    if (name === 'G' || firstBar) crash(bar(b), .25);
  } else if (section === 'duels') {
    // Tension: low pulse, dark pad, ticking sixteenths, heartbeat toms.
    padChord(b, name, { amp: .05, cutoff: 900, up: -12 });
    bassLine(b, name, 'pulse');
    for (let s = 0; s < 16; s++) hat(bar(b) + s * .25 * BEAT, s % 4 === 0 ? .12 : .06, false, s % 2 ? .4 : -.4);
    kick(bar(b), .95); kick(bar(b) + 1.5 * BEAT, .7); kick(bar(b) + 2 * BEAT, .9); kick(bar(b) + 3.5 * BEAT, .65);
    snare(bar(b) + 3 * BEAT, .4); clap(bar(b) + 3 * BEAT, .25);
    // Tremolo strings: a restless, rising figure.
    CH[name].forEach((m, i) => synth(bus.arp, m + 12, bar(b), BAR * .98, { amp: .026, pan: (i - 1.5) * .3, voices: 3, detune: .3, attack: .5, decay: .6, sustain: .8, release: .5, cutoff: 2200, q: .3, busName: 'arp' }));
    for (let s = 0; s < 8; s++) {
      const m = CH[name][[0, 1, 2, 1, 0, 2, 1, 3][s]] + 12;
      synth(bus.arp, m, bar(b) + s * .5 * BEAT, .22, { amp: .04, pan: s % 2 ? .4 : -.4, voices: 2, detune: .08, attack: .003, decay: .1, sustain: .2, release: .05, cutoff: 1100, cutoffEnv: 2600, cutoffDecay: .1, q: .45, busName: 'arp' });
    }
    if (k >= 3) leadBar(b, [[0, 81, 1], [1, 84, 1], [2, 88, 1.5], [3.5, 86, .5]], { amp: .06, cutoff: 2800 });
    if (last) { snare(bar(b) + 2 * BEAT, .3); for (let s = 0; s < 8; s++) snare(bar(b) + (2 + s * .25) * BEAT, .1 + s * .045); riser(bar(b), BAR, .22); }
  } else if (section === 'parkour') {
    padChord(b, name, { amp: .06, cutoff: 3000 });
    bassLine(b, name, 'sixteenth');
    arpBar(b, name, { amp: .055, step: .25, pattern: [0, 1, 2, 3, 1, 2, 3, 2], oct: 1, bright: 6000, lift: true });
    drumBar(b, 3);
    for (let s = 0; s < 16; s++) hat(bar(b) + s * .25 * BEAT, .07, false, s % 2 ? .5 : -.5);
    leadBar(b, THEME_UP[name] ?? THEME[name], { amp: .1, octave: true, cutoff: 4200 });
    if (firstBar) crash(bar(b), .3);
    // Brass-like stabs.
    for (const beat of [0, 1.5, 2.5]) CH[name].slice(0, 3).forEach((m, i) => synth(bus.lead, m + 12, bar(b) + beat * BEAT, .32 * BEAT, { amp: .035, pan: (i - 1) * .3, voices: 3, detune: .18, attack: .006, decay: .1, sustain: .55, release: .1, cutoff: 2800, cutoffEnv: 3000, cutoffDecay: .12, q: .3, busName: 'lead' }));
  } else if (section === 'rats') {
    // Sneaky and playful: staccato plucks, pizzicato bass, brushed snares.
    const at = bar(b), c = CH[name];
    padChord(b, name, { amp: .028, cutoff: 1200 });
    const bassPat = [[0, 0], [.5, 0], [1.5, 7], [2, 0], [2.5, 12], [3.5, 7]];
    for (const [beat, iv] of bassPat) pluck(bus.bass, ROOT[name] + 12 + iv, at + beat * BEAT, .3, { amp: .22, bright: .6, decay: .5 });
    const hop = [[0, 0], [.5, 2], [1, 1], [1.5, 2], [2, 0], [2.5, 3], [3, 2], [3.5, 1]];
    for (const [beat, idx] of hop) pluck(bus.arp, c[idx] + (k >= 2 && k % 2 ? 24 : 12), at + beat * BEAT, .2, { amp: .075, pan: beat % 1 ? .4 : -.4, decay: .55, bright: 1.2 });
    kick(at, .55); kick(at + 2 * BEAT, .5); snare(at + BEAT, .16, .2); snare(at + 3 * BEAT, .18, -.2);
    for (let e = 0; e < 8; e++) hat(at + e * .5 * BEAT, .07, false, e % 2 ? .3 : -.3);
    if (k >= 2) leadBar(b, k % 2 ? [[0, 79, .5], [.5, 83, .5], [1, 86, 1], [2, 84, .5], [2.5, 83, .5], [3, 79, 1]] : [[0, 81, .5], [.5, 84, .5], [1, 88, 1], [2, 86, .5], [2.5, 84, .5], [3, 81, 1]], { amp: .05, cutoff: 3200 });
    if (b === end - 1) { for (let s = 0; s < 8; s++) tom(at + (2 + s * .25) * BEAT, 52 - s, .3 + s * .05); riser(at, BAR, .2); }
  } else if (section === 'reel') {
    // The climb: every card is a bigger chord stab.
    const stabs = k === 0 ? [[0, 'F'], [1, 'F'], [2, 'G'], [3, 'G']] : [[0, 'F'], [1, 'G'], [2, 'Am'], [3, 'Gsus']];
    const at = bar(b);
    stabs.forEach(([beat, ch], idx) => {
      CH[ch].forEach((m, i) => synth(bus.lead, m + 12, at + beat * BEAT, .8 * BEAT, { amp: .05, pan: (i - 1.5) * .3, voices: 5, detune: .25, attack: .006, decay: .15, sustain: .7, release: .2, cutoff: 3600, cutoffEnv: 2600, cutoffDecay: .2, q: .3, busName: 'lead' }));
      kick(at + beat * BEAT, .9); if (idx % 2) clap(at + beat * BEAT, .3);
    });
    padChord(b, k === 0 ? 'F' : 'Am', { amp: .08, cutoff: 3000 });
    bassLine(b, k === 0 ? 'F' : 'G', 'drive');
    for (let s = 0; s < 8; s++) hat(at + s * .5 * BEAT, .1, s === 7);
    leadBar(b, k === 0 ? [[0, 84, 1], [1, 88, 1], [2, 91, 1], [3, 93, 1]] : [[0, 91, 1], [1, 93, 1], [2, 95, 1.5], [3.5, 96, .5]], { amp: .09, octave: true, cutoff: 4800 });
    if (k === 1) { swell(at, BAR * .9, .3); for (let s = 0; s < 16; s++) snare(at + s * .25 * BEAT * 1, .08 + s * .03); }
  }
  if (firstBar && section !== 'intro' && b !== 2) boom(bar(b), .6, 1.8);
  if (last && section !== 'reel' && section !== 'logo') { swell(bar(b) + BAR * .45, BAR * .55, .22); }
}

// ── the finale: a huge resolve into C major, then a long, light ring-out ──
{
  const at = bar(37);
  boom(at, .95, 3.2); crash(at, .5, 4.5);
  kick(at, 1);
  [[48, 0], [55, 0], [60, 0], [64, 0], [67, 0], [72, 0], [76, 0]].forEach(([m], i) => {
    synth(bus.pad, m, at, BAR * 3, { amp: .06, pan: (i - 3) * .22, voices: 5, detune: .3, attack: .05, decay: 1, sustain: .8, release: 2.2, cutoff: 3400, q: .3, busName: 'pad' });
  });
  [60, 64, 67, 72, 76].forEach((m, i) => choir(bus.pad, m, at, BAR * 2.4, { amp: .08, pan: (i - 2) * .35, attack: .25, release: 2, vowel: i % 2 }));
  synth(bus.bass, 36, at, BAR * 1.5, { amp: .3, voices: 2, detune: .05, attack: .01, decay: 1, sustain: .8, release: .8, cutoff: 280, q: .3, sub: 1, busName: 'bass' });
  // Final statement of the theme, majorised, then sparkling bells fall away.
  leadBar(37, [[0, 84, 1.5], [1.5, 79, .5], [2, 88, 2]], { amp: .1, octave: true, cutoff: 5000 });
  leadBar(38, [[0, 91, 2], [2, 88, 1], [3, 84, 1]], { amp: .09, octave: true, cutoff: 4400 });
  [96, 91, 88, 84, 91, 88, 84, 79, 88, 84, 79, 76].forEach((m, i) => pluck(bus.arp, m, bar(38) + BAR * .5 + i * .22, 2.5, { amp: .05 * Math.exp(-i * .09), pan: ((i * 37) % 11 - 5) / 6, decay: 3, bell: .8, bright: .6 }));
  for (let s = 0; s < 8; s++) hat(bar(38) + s * .5 * BEAT, .05);
  kick(bar(38), .55); clap(bar(38) + BEAT, .2);
}

// ── sound effects, placed from the timeline cues ────────────────────────
const sfxTone = (start, f0, f1, dur, amp, pan = 0, type = 'sine', decay = 6) => {
  const s0 = Math.round(start * RATE), n = Math.round(dur * RATE), [l, r] = gains(pan); let ph = 0;
  for (let i = 0; i < n && s0 + i < N; i++) {
    const t = i / RATE, k = t / dur; ph += TAU * (f0 + (f1 - f0) * k) / RATE;
    const w = type === 'saw' ? ((ph / TAU) % 1) * 2 - 1 : type === 'square' ? Math.sign(Math.sin(ph)) * .6 : Math.sin(ph);
    add(bus.sfx, s0, i, w * Math.exp(-t * decay) * Math.min(1, t * 400) * amp, l, r);
  }
};
const sfxNoise = (start, dur, amp, lo, hi, pan = 0, decay = 8, sweep = 0) => {
  const s0 = Math.round(start * RATE), n = Math.round(dur * RATE), [l, r] = gains(pan), f = new SVF();
  for (let i = 0; i < n && s0 + i < N; i++) {
    const t = i / RATE, k = t / dur, c = lo + (hi - lo) * (sweep ? Math.sin(Math.PI * k) : 1 - k);
    f.run(rnd() * 2 - 1, c, .6);
    add(bus.sfx, s0, i, f.bp * 2.2 * Math.exp(-t * decay) * Math.min(1, t * 300) * amp, l, r);
  }
};
const SFX = {
  swing: (t, p) => sfxNoise(t, .26, .34, 500, 3600, p, 7, 1),
  hit: (t, p) => { sfxNoise(t, .14, .55, 1800, 5000, p, 24); sfxTone(t, 190, 70, .22, .5, p, 'sine', 14); sfxTone(t, 1900, 1500, .12, .12, p, 'square', 30); },
  pick: (t, p) => { sfxNoise(t, .12, .45, 700, 2400, p, 28); sfxTone(t, 130, 60, .15, .4, p, 'sine', 18); },
  block: (t, p) => { sfxNoise(t, .09, .3, 300, 900, p, 40); sfxTone(t, 160, 90, .1, .28, p, 'sine', 30); },
  bedbreak: t => { sfxNoise(t, .5, .75, 400, 4200, 0, 6); sfxTone(t, 110, 28, .9, .8, 0, 'sine', 4); [0, .05, .11, .18].forEach((d, i) => sfxTone(t + d, 1400 + i * 380, 900 + i * 220, .3, .09, (i - 1.5) * .3, 'square', 14)); },
  shot: (t, p) => { sfxNoise(t, .2, .6, 900, 6500, p, 20); sfxTone(t, 220, 55, .18, .55, p, 'sine', 18); sfxNoise(t + .02, .35, .12, 300, 1400, p, 7); },
  ping: (t, p) => { sfxTone(t, 2400, 2400, .18, .16, p, 'sine', 18); sfxTone(t, 3600, 3600, .12, .07, p, 'sine', 22); },
  death: t => { sfxTone(t, 520, 120, .5, .22, 0, 'saw', 5); sfxNoise(t, .4, .3, 3000, 400, 0, 6); },
  bow: (t, p) => { sfxTone(t, 380, 140, .12, .3, p, 'saw', 22); sfxNoise(t + .02, .3, .22, 900, 3500, p, 9, 1); },
  fall: t => sfxTone(t, 1500, 240, 1.0, .12, 0, 'sine', 2.5),
  goal: t => { [523.3, 659.3, 784, 1046.5].forEach((f, i) => sfxTone(t + i * .09, f, f, .9, .15, (i - 1.5) * .25, 'sine', 3.2)); sfxNoise(t, 1, .2, 800, 7000, 0, 3, 1); },
  coin: (t, p) => { sfxTone(t, 1760, 1760, .14, .12, p, 'square', 14); sfxTone(t + .06, 2349, 2349, .3, .12, p, 'square', 8); },
  buy: t => { SFX.coin(t, -.2); SFX.coin(t + .12, .2); sfxTone(t + .25, 1320, 1320, .4, .1, 0, 'sine', 5); },
  whoosh: (t, p) => sfxNoise(t, .7, .38, 300, 5200, p, 3.4, 1),
  impact: t => { sfxTone(t, 90, 30, 1.2, .7, 0, 'sine', 3); sfxNoise(t, .6, .35, 200, 2400, 0, 6); },
  roar: t => {
    const s0 = Math.round(t * RATE), n = Math.round(1.6 * RATE), f = new SVF(); let ph = 0;
    for (let i = 0; i < n && s0 + i < N; i++) {
      const tt = i / RATE, k = tt / 1.6, env = Math.sin(Math.PI * Math.min(1, k)) ** .8;
      ph += TAU * (82 + 40 * Math.sin(k * 9) + 30 * (1 - k)) / RATE;
      const raw = (((ph / TAU) % 1) * 2 - 1) * .7 + (rnd() * 2 - 1) * .5;
      f.run(raw, 420 + 500 * Math.sin(k * 5), .25);
      add(bus.sfx, s0, i, Math.tanh(f.lp * 3) * env * .5, 1, 1);
    }
  },
  fire: t => { sfxNoise(t, 1.4, .5, 300, 3200, 0, 1.8, 1); sfxTone(t, 90, 40, 1.2, .3, 0, 'sine', 2); },
  boom: t => { sfxTone(t, 100, 28, 1.3, .8, 0, 'sine', 3); sfxNoise(t, .8, .5, 150, 2800, 0, 5); },
  squeak: (t, p) => { sfxTone(t, 2300, 3300, .07, .14, p, 'sine', 20); sfxTone(t + .1, 2900, 3700, .06, .12, p, 'sine', 24); },
  meow: t => { sfxTone(t, 520, 760, .45, .16, 0, 'saw', 3.2); sfxTone(t + .3, 760, 420, .4, .12, 0, 'saw', 3.5); },
  cage: t => { for (let i = 0; i < 6; i++) sfxTone(t + i * .035, 900 + (i * 173) % 700, 500, .25, .1, (i - 2.5) * .15, 'square', 14); sfxNoise(t, .3, .25, 1800, 6000, 0, 12); },
  chime: t => { [784, 988, 1175, 1568].forEach((f, i) => sfxTone(t + i * .08, f, f, 1.2, .1, (i - 1.5) * .2, 'sine', 2.4)); },
  cheer: t => { for (let i = 0; i < 18; i++) sfxNoise(t + i * .03, .9, .09, 900 + (i * 211) % 1800, 1600 + (i * 331) % 2200, ((i * 29) % 13 - 6) / 7, 2.5, 1); },
  riser: t => riser(t, 3.6, .1),
  shimmer: t => { for (let i = 0; i < 10; i++) sfxTone(t + i * .28, 2093 * 2 ** ((i % 5) / 5), 2093 * 2 ** ((i % 5) / 5), 1.2, .045, ((i * 7) % 9 - 4) / 5, 'sine', 3); },
};
const panOf = i => ((i * 53) % 9 - 4) / 9;
let cueCount = 0;
for (const shot of timeline.shots) for (const [local, kind] of shot.cues ?? []) {
  const fn = SFX[kind];
  if (!fn) throw new Error(`Unknown sound cue ${kind} in ${shot.id}`);
  fn(shot.start + local, panOf(cueCount++));
}

// ── mix: sidechain, reverb, sum ─────────────────────────────────────────
function applyDuck(stereo, depth = 1) {
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) stereo[c][i] *= 1 - (1 - duck[i]) * depth;
}
applyDuck(bus.pad, 1); applyDuck(bus.arp, .85); applyDuck(bus.bass, .95); applyDuck(bus.lead, .35);

/** Stereo Schroeder/Moorer reverb: 6 combs + 2 allpasses per side, low-passed tail. */
function reverb(stereo, seconds, wet, damp = .35) {
  const combs = [[.0297, .0371], [.0371, .0411], [.0411, .0437], [.0437, .0297], [.0501, .0563], [.0563, .0617]];
  const fb = Math.pow(.001, .035 / seconds);
  const dry = stereo.map(ch => ch.slice());
  const outputs = [new Float32Array(N), new Float32Array(N)];
  for (let side = 0; side < 2; side++) {
    for (const pair of combs) {
      const len = Math.round(pair[side] * RATE), buf = new Float32Array(len); let idx = 0, lp = 0;
      const src = dry[side].map((v, i) => v + dry[1 - side][i] * .35);
      for (let i = 0; i < N; i++) {
        const y = buf[idx]; lp = y * (1 - damp) + lp * damp; buf[idx] = src[i] + lp * fb; idx = (idx + 1) % len;
        outputs[side][i] += y * .2;
      }
    }
    for (const delay of [.0051, .0127]) {
      const len = Math.round(delay * RATE), buf = new Float32Array(len); let idx = 0;
      for (let i = 0; i < N; i++) {
        const x = outputs[side][i], y = buf[idx]; buf[idx] = x + y * .5; outputs[side][i] = y - x * .5 + x; idx = (idx + 1) % len;
      }
    }
  }
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) stereo[c][i] += outputs[c][i] * wet;
}
reverb(bus.pad, 3.2, .9); reverb(bus.lead, 2.2, .7); reverb(bus.arp, 1.6, .6); reverb(bus.fx, 2.2, .5); reverb(bus.drums, .9, .22); reverb(bus.sfx, 1.2, .3);

/** Delay on arp + lead: dotted-eighth ping-pong. */
function pingPong(stereo, amount) {
  const d = Math.round(BEAT * .75 * RATE);
  for (let i = d; i < N; i++) {
    stereo[0][i] += stereo[1][i - d] * amount; stereo[1][i] += stereo[0][i - d] * amount * .95;
  }
}
pingPong(bus.arp, .38); pingPong(bus.lead, .24);

const level = { pad: 1, lead: 1, arp: 1, bass: 1, drums: 1, fx: 1 };
const stems = {
  melody: [bus.lead, bus.arp], atmosphere: [bus.pad, bus.fx], percussion: [bus.drums, bus.bass], effects: [bus.sfx],
};
const sum = list => { const out = make(); for (const b of list) for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) out[c][i] += b[c][i]; return out; };
const music = sum([bus.pad, bus.lead, bus.arp, bus.bass, bus.drums, bus.fx]);
// Master dynamics: a gain curve (dB, one point per bar, interpolated) gives the
// piece a shape: a hushed opening, a drop into Bedwars, a tense Duels, a lighter
// manor and a huge finale.
const CURVE = [-14, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, .5, .5, .5, .5, .5, -2.5, -2.5, -2, -2, -1.5, .5, .5, .5, .5, .5, .5, -4.5, -4.5, -4.5, -4.5, -4.5, -3, 0, 1.5, 1.5, 1, -1];
const curveGain = t => {
  const x = clamp(t / BAR, 0, CURVE.length - 1.001), i = Math.floor(x), f = smooth(x - i);
  return 10 ** ((CURVE[i] * (1 - f) + CURVE[i + 1] * f) / 20);
};
for (let i = 0; i < N; i++) { const g = curveGain(i / RATE) * .8; music[0][i] *= g; music[1][i] *= g; }
// Gentle master: soft-knee saturation keeps peaks round, then a fixed trim.
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) music[c][i] = Math.tanh(music[c][i] * 1.25) / 1.25;
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(music[0][i]), Math.abs(music[1][i]));
const gain = .86 / Math.max(peak, .86);

function wav(stereo, trim = 1, fadeIn = .05, fadeOut = 1.2) {
  const bytes = 3, dataLength = N * 2 * bytes, b = Buffer.alloc(44 + dataLength);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLength, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 6, 28); b.writeUInt16LE(6, 32); b.writeUInt16LE(24, 34);
  b.write('data', 36); b.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < N; i++) {
    const fade = Math.min(1, i / (RATE * fadeIn), (N - i) / (RATE * fadeOut));
    for (let c = 0; c < 2; c++) b.writeIntLE(Math.round(clamp(stereo[c][i] * trim * fade, -.999, .999) * 8388607), 44 + (i * 2 + c) * 3, 3);
  }
  return b;
}
await writeFile(path.join(output, 'worlds-awaken.wav'), wav(music, gain));
const sfxMix = sum([bus.sfx]);
await writeFile(path.join(output, 'effects.wav'), wav(sfxMix, .9, .01, .3));
for (const [name, list] of Object.entries(stems)) await writeFile(path.join(output, `${name}.wav`), wav(sum(list), gain));
await writeFile(path.join(output, 'composition.json'), JSON.stringify({
  title: 'Worlds Awaken', tempo: BPM, meter: '4/4', key: 'A minor → D minor → C major', duration: SECONDS, sampleRate: RATE, bitDepth: 24,
  sections: Object.fromEntries(Object.entries(S).map(([k, [a, z]]) => [k, { startBar: a, endBar: z, start: a * BAR, end: z * BAR }])),
  source: 'Original procedural composition; no third-party samples', soundCues: cueCount, events: events.slice(0, 4000),
}, null, 2));
console.log(`Composed ${events.length} synth voices, ${cueCount} sound cues, ${SECONDS}s, stereo ${RATE} Hz / 24-bit: ${output}`);
