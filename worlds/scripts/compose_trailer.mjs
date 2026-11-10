// Worlds Rising: an original 124-second orchestral-hybrid trailer score in
// D minor at 120 BPM (a bar is two seconds, so every cut lands on a downbeat).
// Dependency-free synthesis: string ensembles and spiccato, brass and "braams",
// horns, a formant choir, taiko, timpani, anvils, bells and pizzicato, then a
// stereo convolution hall (FFT overlap-add with a synthetic impulse) and a
// shaped master. No recordings, samples or stock music. Sound effects are cued
// from src/trailer/timeline.json, so they land exactly on the picture.
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
const bus = { strings: make(), brass: make(), choir: make(), keys: make(), low: make(), perc: make(), fx: make(), sfx: make() };
const events = [];

let seed = 20270201;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const hz = m => 440 * 2 ** ((m - 69) / 12);
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const gains = pan => [Math.cos((pan + 1) * Math.PI / 4), Math.sin((pan + 1) * Math.PI / 4)];
const bar = n => n * BAR;
const shot = id => { const s = timeline.shots.find(x => x.id.startsWith(id)); if (!s) throw new Error(`No shot ${id}`); return s.start; };

// ── oscillators and filters ─────────────────────────────────────────────
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const saw = (phase, dt) => 2 * phase - 1 - blep(phase, dt);
class SVF {
  constructor() { this.lp = 0; this.bp = 0; this.hp = 0; }
  run(x, cutoff, q) {
    const f = 2 * Math.sin(Math.PI * Math.min(cutoff, RATE * .45) / RATE);
    this.lp += f * this.bp;
    this.hp = x - this.lp - q * this.bp;
    this.bp += f * this.hp;
    return this.lp;
  }
}
function env(t, dur, a, d, s, r) {
  if (t < 0) return 0;
  let v = t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : s;
  if (t > dur) v *= Math.max(0, 1 - (t - dur) / r);
  return v;
}
function add(target, start, i, v, l, r) {
  const k = start + i;
  if (k >= 0 && k < N) { target[0][k] += v * l; target[1][k] += v * r; }
}

/** The workhorse: detuned saw ensemble, two-pole low-pass with an envelope,
 *  optional vibrato, growl (drive) and sub. Strings, brass and horns are presets. */
function ensemble(target, midi, at, dur, o = {}) {
  const {
    amp = .1, pan = 0, voices = 5, detune = .12, attack = .05, decay = .3, sustain = .85, release = .4,
    cutoff = 2000, cutoffEnv = 0, cutoffAttack = 0, q = .5, vibrato = 0, vibratoRate = 5.2, drive = 0, sub = 0, width = .6,
  } = o;
  const start = Math.round(at * RATE), length = Math.round((dur + release * 2.5) * RATE);
  const f0 = hz(midi);
  const phases = Array.from({ length: voices }, () => rnd());
  const spread = Array.from({ length: voices }, (_, v) => voices === 1 ? 0 : (v / (voices - 1) - .5) * 2);
  const fl = [new SVF(), new SVF()], fr = [new SVF(), new SVF()];
  const norm = 1 / Math.sqrt(voices);
  for (let i = 0; i < length; i++) {
    if (start + i >= N) break;
    if (start + i < 0) continue;
    const t = i / RATE, e = env(t, dur, attack, decay, sustain, release);
    if (e <= 1e-5 && t > dur) break;
    const vib = vibrato ? 1 + vibrato * Math.sin(TAU * vibratoRate * t + midi) * smooth((t - .15) / .5) : 1;
    let L = 0, R = 0;
    for (let v = 0; v < voices; v++) {
      const f = f0 * vib * 2 ** (spread[v] * detune / 12);
      const dt = f / RATE; phases[v] = (phases[v] + dt) % 1;
      const s = saw(phases[v], dt), p = spread[v] * width;
      L += s * (1 - p) * .5; R += s * (1 + p) * .5;
    }
    L *= norm; R *= norm;
    if (sub) { const sv = Math.sin(TAU * f0 * .5 * t) * sub; L += sv; R += sv; }
    const open = cutoffAttack ? smooth(t / cutoffAttack) : 1;
    const c = cutoff + cutoffEnv * open;
    let yl = fl[1].run(fl[0].run(L, c, q), c, q), yr = fr[1].run(fr[0].run(R, c, q), c, q);
    if (drive) { yl = Math.tanh(yl * (1 + drive * 3)) / (1 + drive); yr = Math.tanh(yr * (1 + drive * 3)) / (1 + drive); }
    const [gl, gr] = gains(pan);
    const k = start + i;
    target[0][k] += yl * e * amp * gl * 1.41; target[1][k] += yr * e * amp * gr * 1.41;
  }
  events.push({ bus: o.busName ?? 'ensemble', midi, at: +at.toFixed(3), duration: +dur.toFixed(3) });
}
const strings = (midi, at, dur, o = {}) => ensemble(bus.strings, midi, at, dur, {
  voices: 7, detune: .16, attack: .35, decay: .6, sustain: .9, release: .9, cutoff: 1900, cutoffEnv: 4200, cutoffAttack: .8, q: .45,
  vibrato: .0045, amp: .045, busName: 'strings', ...o,
});
const spicc = (midi, at, o = {}) => ensemble(bus.strings, midi, at, .07, {
  voices: 5, detune: .14, attack: .004, decay: .08, sustain: .15, release: .06, cutoff: 1400, cutoffEnv: 5200, q: .6, amp: .05, busName: 'spiccato', ...o,
});
const brass = (midi, at, dur, o = {}) => ensemble(bus.brass, midi, at, dur, {
  voices: 5, detune: .1, attack: .12, decay: .4, sustain: .8, release: .45, cutoff: 450, cutoffEnv: 2600, cutoffAttack: .35, q: .55,
  vibrato: .0025, drive: .4, amp: .07, busName: 'brass', ...o,
});
const horn = (midi, at, dur, o = {}) => ensemble(bus.brass, midi, at, dur, {
  voices: 4, detune: .08, attack: .07, decay: .3, sustain: .85, release: .35, cutoff: 700, cutoffEnv: 1100, cutoffAttack: .25, q: .5,
  vibrato: .005, vibratoRate: 5.5, drive: .15, amp: .075, busName: 'horn', ...o,
});
/** The trailer "braam": massive low brass with a slow filter swell and growl. */
function braam(at, root = 38, len = 3, amp = 1) {
  [[root, .12], [root + 12, .1], [root + 19, .06], [root + 24, .05], [root - 12, .09]].forEach(([m, a], i) => ensemble(bus.brass, m, at, len, {
    voices: 6, detune: .22, attack: .05, decay: 1.2, sustain: .55, release: 1.4, cutoff: 220, cutoffEnv: 1500, cutoffAttack: .5, q: .7,
    drive: .9, sub: i === 0 ? .5 : 0, amp: a * amp, pan: (i - 2) * .25, busName: 'braam', width: .9,
  }));
  boom(at, .55 * amp, 2.6);
}

/** Formant choir ("ah", "oh", "oo"). */
function choir(midi, at, dur, o = {}) {
  const { amp = .05, pan = 0, attack = .6, release = 1.4, vowel = 0 } = o;
  const start = Math.round(at * RATE), length = Math.round((dur + release * 2) * RATE), f0 = hz(midi), [l, r] = gains(pan);
  const forms = [[800, 1150, 2900], [450, 800, 2830], [325, 700, 2530]][vowel];
  const filters = forms.map(() => new SVF()), phases = [rnd(), rnd(), rnd(), rnd()];
  for (let i = 0; i < length && start + i < N; i++) {
    if (start + i < 0) continue;
    const t = i / RATE, e = env(t, dur, attack, .4, .9, release);
    let s = 0;
    for (let v = 0; v < 4; v++) {
      const f = f0 * 2 ** ((v - 1.5) * .09 / 12) * (1 + .005 * Math.sin(TAU * (4.8 + v * .3) * t + v));
      const dt = f / RATE; phases[v] = (phases[v] + dt) % 1; s += saw(phases[v], dt);
    }
    let out = 0;
    for (let k = 0; k < forms.length; k++) { filters[k].run(s, forms[k], .1); out += filters[k].bp * [1, .65, .3][k]; }
    add(bus.choir, start, i, out * e * amp * .35, l, r);
  }
}

/** Bells and celesta: FM-ish inharmonic partials. */
function bell(midi, at, o = {}) {
  const { amp = .05, pan = 0, decay = 2.4 } = o;
  const start = Math.round(at * RATE), n = Math.round(decay * 1.6 * RATE), f = hz(midi), [l, r] = gains(pan);
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, p = TAU * f * t;
    const s = Math.sin(p + 1.8 * Math.sin(p * 3.5) * Math.exp(-t * 7)) * Math.exp(-t * 2.6 / decay) + .35 * Math.sin(p * 2.76) * Math.exp(-t * 5);
    add(bus.keys, start, i, s * amp * Math.min(1, t * 900), l, r);
  }
}
/** Pizzicato: a damped plucked string. */
function pizz(midi, at, o = {}) {
  const { amp = .12, pan = 0, decay = .45 } = o;
  const start = Math.round(at * RATE), n = Math.round(decay * 2.2 * RATE), f = hz(midi), [l, r] = gains(pan);
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, p = TAU * f * t;
    const s = (Math.sin(p) + .45 * Math.sin(2 * p) * Math.exp(-t * 9) + .2 * Math.sin(3 * p) * Math.exp(-t * 16)) * Math.exp(-t * 2.4 / decay);
    add(bus.strings, start, i, (s + (rnd() * 2 - 1) * Math.exp(-t * 300) * .3) * amp * Math.min(1, t * 1200), l, r);
  }
}

// ── percussion ───────────────────────────────────────────────────────────
function taiko(at, amp = .8, pitch = 1, pan = 0) {
  const start = Math.round(at * RATE), n = Math.round(1.1 * RATE), [l, r] = gains(pan), slap = new SVF();
  let phase = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    phase += TAU * (52 * pitch + 95 * pitch * Math.exp(-t * 26)) / RATE;
    slap.run(rnd() * 2 - 1, 900 * pitch, .9);
    const body = Math.sin(phase) * Math.exp(-t * 4.2) + .35 * Math.sin(phase * 1.52) * Math.exp(-t * 9);
    const v = (body + slap.bp * 1.6 * Math.exp(-t * 32)) * Math.min(1, t * 2000);
    add(bus.perc, start, i, Math.tanh(v * 1.4) * amp, l, r);
  }
}
const smallTaiko = (at, amp = .35, pan = 0) => taiko(at, amp, 1.9, pan);
function timpani(at, midi = 38, amp = .6) {
  const start = Math.round(at * RATE), n = Math.round(1.8 * RATE), f = hz(midi);
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, p = TAU * f * t * (1 + .04 * Math.exp(-t * 20));
    const s = Math.sin(p) * Math.exp(-t * 1.9) + .5 * Math.sin(p * 1.5) * Math.exp(-t * 3) + .25 * Math.sin(p * 1.98) * Math.exp(-t * 4) + (rnd() * 2 - 1) * Math.exp(-t * 60) * .4;
    add(bus.perc, start, i, s * amp, 1, 1);
  }
}
function timpRoll(from, to, midi = 38, peak = .5) {
  for (let t = from; t < to; t += .045) timpani(t, midi, .07 + peak * ((t - from) / (to - from)) ** 2);
}
function snare(at, amp = .3, pan = 0) {
  const start = Math.round(at * RATE), n = Math.round(.3 * RATE), [l, r] = gains(pan), f = new SVF();
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, noise = rnd() * 2 - 1;
    f.run(noise, 6000, .6);
    const v = (noise - f.lp * .5) * Math.exp(-t * 18) * .8 + Math.sin(TAU * (210 - 60 * t) * t) * Math.exp(-t * 24) * .5;
    add(bus.perc, start, i, v * amp, l, r);
  }
}
function snareRoll(from, to, peak = .3) { for (let t = from; t < to; t += BEAT / 8) snare(t, .04 + peak * ((t - from) / (to - from)) ** 2, Math.sin(t * 9) * .3); }
function anvil(at, amp = .22, pan = 0) {
  const start = Math.round(at * RATE), n = Math.round(1.2 * RATE), [l, r] = gains(pan);
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    const s = [1, 2.76, 5.4, 8.93].reduce((m, k, j) => m + Math.sin(TAU * 520 * k * t) * Math.exp(-t * (4 + j * 3)) / (j + 1), 0);
    add(bus.perc, start, i, s * amp * Math.min(1, t * 3000), l, r);
  }
}
function crash(at, amp = .3, length = 3.5) {
  const start = Math.round(at * RATE), n = Math.round(length * RATE);
  let a = 0, b = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, noise = rnd() * 2 - 1;
    a += .35 * (noise - a); b += .08 * (noise - b);
    add(bus.perc, start, i, (noise - a * .8 - b * .2) * Math.exp(-t * 1.5) * Math.min(1, t * 400) * amp, 1, .95);
  }
}
/** Reverse cymbal / swell ending exactly at `at + duration`. */
function swell(at, duration, amp = .25) {
  const start = Math.round(at * RATE), n = Math.round(duration * RATE);
  let a = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, k = t / duration, noise = rnd() * 2 - 1; a += .25 * (noise - a);
    add(bus.fx, start, i, (noise - a) * k ** 3 * amp, 1, 1);
  }
}
/** Shepard-ish riser: noise sweep plus rising tones, peaking at `at + duration`. */
function riser(at, duration, amp = .2) {
  const start = Math.round(at * RATE), n = Math.round(duration * RATE), f = new SVF();
  const ph = [0, 0, 0];
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE, k = t / duration;
    const noise = f.run(rnd() * 2 - 1, 300 + 9000 * k * k, .5);
    let tone = 0;
    for (let j = 0; j < 3; j++) { ph[j] += TAU * (110 * 2 ** (j + k * 2)) / RATE; tone += Math.sin(ph[j]) / (j + 1); }
    add(bus.fx, start, i, (noise * 1.3 + tone * .2) * k * k * amp, .95, .95);
  }
}
function boom(at, amp = .8, length = 2.6) {
  const start = Math.round(at * RATE), n = Math.round(length * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < N; i++) {
    const t = i / RATE;
    phase += TAU * (34 + 80 * Math.exp(-t * 8)) / RATE;
    add(bus.low, start, i, (Math.sin(phase) * Math.exp(-t * 1.5) + (rnd() * 2 - 1) * .1 * Math.exp(-t * 10)) * amp, 1, 1);
  }
}
/** The trailer hit: boom + taiko + crash + a brass/strings stab on `chord`. */
function hit(at, chord, amp = 1) {
  boom(at, .7 * amp); taiko(at, .9 * amp); taiko(at, .6 * amp, .8); crash(at, .32 * amp); anvil(at, .1 * amp);
  if (chord) {
    CH[chord].slice(1).forEach((m, i) => { brass(m, at, .6, { amp: .06 * amp, attack: .01, cutoffAttack: .05, pan: (i - 1.5) * .3 }); strings(m + 12, at, .5, { amp: .04 * amp, attack: .01, cutoffAttack: .05 }); });
    brass(CH[chord][0], at, .9, { amp: .1 * amp, attack: .01, cutoffAttack: .08, sub: .4 });
  }
}

// ── harmony ──────────────────────────────────────────────────────────────
// [bass, then a mid voicing], D minor.
const CH = {
  Dm: [38, 50, 53, 57, 62], Bb: [34, 46, 50, 53, 58], F: [41, 48, 53, 57, 60], C: [36, 48, 52, 55, 60],
  Gm: [43, 50, 55, 58, 62], A: [45, 49, 52, 57, 61], Am: [45, 48, 52, 57, 60], Eb: [39, 51, 55, 58, 63],
  D: [38, 50, 54, 57, 62], G: [43, 50, 55, 59, 62], Bbmaj: [34, 50, 53, 57, 62], Csus: [36, 48, 53, 55, 60],
};
// The theme: two 4-bar phrases (beat, midi, length) over Dm-Bb-F-C and Dm-Bb-Gm-A.
const THEME_A = [
  [[0, 74, 1.5], [1.5, 69, .5], [2, 74, 1], [3, 77, 1]],
  [[0, 77, 1.5], [1.5, 74, .5], [2, 70, 2]],
  [[0, 72, 1.5], [1.5, 69, .5], [2, 72, 1], [3, 77, 1]],
  [[0, 76, 3], [3, 72, 1]],
];
const THEME_B = [
  [[0, 81, 1.5], [1.5, 79, .5], [2, 77, 1], [3, 74, 1]],
  [[0, 77, 1.5], [1.5, 74, .5], [2, 70, 1], [3, 74, 1]],
  [[0, 79, 2], [2, 77, 1], [3, 74, 1]],
  [[0, 73, 3], [3, 76, 1]],
];
const PROG_A = ['Dm', 'Bb', 'F', 'C'], PROG_B = ['Dm', 'Bb', 'Gm', 'A'];

function pad(b, name, o = {}) {
  const at = bar(b), dur = (o.bars ?? 1) * BAR;
  CH[name].slice(1).forEach((m, i) => strings(m + (o.up ?? 0), at, dur + .02, { amp: o.amp ?? .04, pan: (i - 1.5) * .4, attack: o.attack ?? .35 }));
  if (o.low !== false) strings(CH[name][0] + 12, at, dur + .02, { amp: (o.amp ?? .04) * 1.1, cutoff: 700, cutoffEnv: 600 });
}
function lowBrass(b, name, o = {}) {
  const at = bar(b), dur = (o.bars ?? 1) * BAR;
  brass(CH[name][0], at, dur * .97, { amp: (o.amp ?? .08) * .8, sub: .15 });
  brass(CH[name][0] + 7, at, dur * .97, { amp: (o.amp ?? .08) * .6 });
}
/** Driving spiccato 16ths: root-octave-fifth-octave. */
function ostinato(b, name, o = {}) {
  const [root] = CH[name], at = bar(b), pat = o.pattern ?? [0, 12, 7, 12, 0, 12, 7, 15];
  for (let s = 0; s < 16; s++) {
    const m = root + 12 + pat[s % pat.length] + (o.oct ?? 0) * 12;
    spicc(m, at + s * BEAT / 4, { amp: (o.amp ?? .05) * (s % 4 === 0 ? 1.25 : 1), pan: s % 2 ? .3 : -.3 });
  }
}
function melody(b, notes, voice, o = {}) {
  const at = bar(b);
  for (const [beat, midi, len] of notes) {
    if (voice === 'horn') {
      horn(midi - 12 + (o.shift ?? 0), at + beat * BEAT, len * BEAT * .95, { amp: o.amp ?? .08, pan: -.15 });
      horn(midi - 24 + (o.shift ?? 0), at + beat * BEAT, len * BEAT * .95, { amp: (o.amp ?? .08) * .55, pan: .15 });
    } else if (voice === 'strings') {
      strings(midi + (o.shift ?? 0), at + beat * BEAT, len * BEAT * .98, { amp: o.amp ?? .05, attack: .08, cutoffAttack: .2, vibrato: .006 });
      strings(midi - 12 + (o.shift ?? 0), at + beat * BEAT, len * BEAT * .98, { amp: (o.amp ?? .05) * .7, attack: .08, cutoffAttack: .2 });
    } else if (voice === 'bell') bell(midi + 12 + (o.shift ?? 0), at + beat * BEAT, { amp: o.amp ?? .04, pan: .2 });
    else if (voice === 'choir') choir(midi - 12 + (o.shift ?? 0), at + beat * BEAT, len * BEAT, { amp: o.amp ?? .05, attack: .15, release: .6, vowel: 1 });
  }
}
/** Taiko grooves by intensity. */
function drums(b, level) {
  const at = bar(b), q = n => at + n * BEAT;
  if (level === 1) { taiko(q(0), .65); taiko(q(2), .5); smallTaiko(q(3.5), .25); return; }
  if (level === 2) {
    taiko(q(0), .8); taiko(q(1.5), .5); taiko(q(2), .7); taiko(q(3), .55);
    for (let s = 0; s < 8; s++) smallTaiko(q(s * .5), s % 2 ? .18 : .26, s % 2 ? .4 : -.4);
    snare(q(1), .18); snare(q(3), .2);
    return;
  }
  if (level >= 3) {
    taiko(q(0), .9); taiko(q(.75), .45); taiko(q(1.5), .6); taiko(q(2), .85); taiko(q(2.75), .45); taiko(q(3), .6); taiko(q(3.5), .6);
    for (let s = 0; s < 16; s++) smallTaiko(q(s * .25), s % 4 === 0 ? .3 : .16, s % 2 ? .45 : -.45);
    snare(q(1), .26); snare(q(3), .28);
    if (level >= 4) { timpani(q(0), CH.Dm[0] + 12, .35); anvil(q(1), .07, -.3); anvil(q(3), .07, .3); }
  }
}

// ── arrangement ──────────────────────────────────────────────────────────
const B = s => s / BAR; // seconds → bars
const T = {
  open: 0, pillars: shot('02'), disaster: shot('05'), party: shot('08'), bridge: shot('11'), duels: shot('13'),
  parkour: shot('14'), rats: shot('16'), capes: shot('18'), tiers: shot('19'), reel: shot('20'), logo: shot('21'), rpg: shot('22'),
};

// Cold open (bars 0-3): a sub drone, low strings, two braams under the statements.
{
  strings(26 + 12, 0, 8, { amp: .05, attack: 2.5, cutoff: 500, cutoffEnv: 500 });
  strings(50, .5, 7.5, { amp: .03, attack: 2, cutoff: 900 });
  strings(57, 2, 6, { amp: .025, attack: 2.4, cutoff: 1100 });
  choir(62, 1, 7, { amp: .03, attack: 2.5, vowel: 2 });
  choir(69, 4.5, 3.5, { amp: .025, attack: 2, vowel: 2 });
  for (let i = 0; i < 8; i++) bell([74, 69, 77, 74, 81, 77, 74, 69][i], 1.2 + i * .62, { amp: .02 * (1 - i * .08), decay: 3, pan: (i % 2 ? .4 : -.4) });
  timpRoll(5.6, 8, 38, .55); snareRoll(6, 8, .22); swell(5, 3, .3);
}

// Lucky Pillars (bars 4-9): the theme arrives — heroic, driving.
for (let b = B(T.pillars); b < B(T.disaster); b++) {
  const k = b - B(T.pillars), name = PROG_A[k % 4];
  pad(b, name, { amp: .04 });
  lowBrass(b, name, { amp: .07 });
  ostinato(b, name, { amp: .05 });
  drums(b, k < 2 ? 2 : 3);
  melody(b, THEME_A[k % 4], 'horn', { amp: .085 });
  if (k >= 2) melody(b, THEME_A[k % 4], 'strings', { amp: .035, shift: 12 });
  if (k === 0) choir(62, bar(b), BAR * 2, { amp: .04, attack: .4, vowel: 0 });
}
hit(T.pillars, 'Dm', 1.1);

// Disaster City (bars 10-15): darker and heavier, a braam on every other bar.
for (let b = B(T.disaster); b < B(T.party); b++) {
  const k = b - B(T.disaster), name = ['Dm', 'Gm', 'Bb', 'A', 'Dm', 'Eb'][k];
  pad(b, name, { amp: .035, up: -12 });
  ostinato(b, name, { amp: .055, pattern: [0, 0, 12, 0, 0, 13, 0, 12] });
  drums(b, 4);
  if (k % 2 === 0) braam(bar(b), CH[name][0], 1.9, .85);
  else lowBrass(b, name, { amp: .09 });
  CH[name].slice(1, 4).forEach((m, i) => choir(m + 12, bar(b), BAR, { amp: .03, pan: (i - 1) * .4, attack: .3, vowel: 1 }));
  if (k === 5) { snareRoll(bar(b) + BAR / 2, bar(b + 1), .3); riser(bar(b), BAR, .2); }
}
hit(T.disaster, 'Dm', 1.15);

// Party Games (bars 16-21): the lift into F major, bouncing and bright.
for (let b = B(T.party); b < B(T.bridge); b++) {
  const k = b - B(T.party), name = ['F', 'C', 'Dm', 'Bb', 'F', 'Csus'][k];
  pad(b, name, { amp: .035 });
  const [root] = CH[name], at = bar(b);
  [[0, 0], [.5, 12], [1, 7], [1.5, 12], [2, 0], [2.5, 12], [3, 7], [3.5, 16]].forEach(([beat, iv]) => pizz(root + 12 + iv, at + beat * BEAT, { amp: .1, pan: beat % 1 ? .35 : -.35 }));
  ostinato(b, name, { amp: .05, oct: 1, pattern: [0, 7, 12, 7, 4, 7, 12, 16] });
  lowBrass(b, name, { amp: .07 });
  drums(b, 2);
  CH[name].slice(1).forEach((m, i) => [0, 1.5, 2.5].forEach(beat => brass(m + 12, at + beat * BEAT, .3 * BEAT, { amp: .03, attack: .01, cutoffAttack: .04, pan: (i - 1.5) * .3 })));
  const tune = [[[0, 77, 1], [1, 81, .5], [1.5, 84, .5], [2, 81, 1], [3, 77, 1]], [[0, 79, 1.5], [1.5, 76, .5], [2, 72, 2]],
    [[0, 74, 1], [1, 77, .5], [1.5, 81, .5], [2, 86, 1.5], [3.5, 84, .5]], [[0, 82, 1.5], [1.5, 81, .5], [2, 77, 2]]][k % 4];
  melody(b, tune, 'bell', { amp: .05 });
  melody(b, tune, 'strings', { amp: .045 });
  if (k >= 2) melody(b, tune, 'horn', { amp: .07 });
  if (k === 5) { snareRoll(at + BAR / 2, at + BAR, .3); riser(at, BAR, .22); }
}
hit(T.party, 'F', 1);

// The Bridge + Duels (bars 22-28): the theme again with full brass, then a ticking standoff.
for (let b = B(T.bridge); b < B(T.parkour); b++) {
  const k = b - B(T.bridge);
  if (b < B(T.duels)) {
    const name = PROG_B[k % 4];
    pad(b, name, { amp: .04 });
    lowBrass(b, name, { amp: .08 });
    ostinato(b, name, { amp: .05 });
    drums(b, 3);
    melody(b, THEME_B[k % 4], 'horn', { amp: .09 });
    melody(b, THEME_B[k % 4], 'strings', { amp: .035, shift: 12 });
  } else {
    const d = b - B(T.duels), name = ['Dm', 'Dm', 'Bb'][d];
    pad(b, name, { amp: .03, up: -12, low: true });
    for (let s = 0; s < 16; s++) spicc(CH[name][0] + 12, bar(b) + s * BEAT / 4, { amp: .06, cutoff: 600 });
    for (let s = 0; s < 8; s++) anvil(bar(b) + s * BEAT / 2, .03, s % 2 ? .5 : -.5);
    taiko(bar(b), .7); taiko(bar(b) + 1.5 * BEAT, .45); taiko(bar(b) + 2 * BEAT, .6); taiko(bar(b) + 3.5 * BEAT, .45);
    brass(CH[name][0], bar(b), BAR, { amp: .08, sub: .4, cutoff: 260, cutoffEnv: 700 });
    strings(74 + d * 3, bar(b), BAR, { amp: .02, attack: .8 });
    if (d === 2) { snareRoll(bar(b), bar(b + 1), .32); riser(bar(b), BAR, .22); timpRoll(bar(b) + BAR / 2, bar(b + 1), 38, .5); }
  }
}
hit(T.bridge, 'Dm', 1); hit(T.duels, 'Bb', .9);

// Parkour (bars 29-32): the peak — theme in octaves, choir, taiko frenzy.
for (let b = B(T.parkour); b < B(T.rats); b++) {
  const k = b - B(T.parkour), name = PROG_A[k];
  pad(b, name, { amp: .045 });
  lowBrass(b, name, { amp: .09 });
  ostinato(b, name, { amp: .055 });
  drums(b, 4);
  melody(b, THEME_A[k], 'horn', { amp: .1 });
  melody(b, THEME_A[k], 'strings', { amp: .045, shift: 12 });
  melody(b, THEME_A[k], 'choir', { amp: .045, shift: 12 });
}
hit(T.parkour, 'Dm', 1.15);

// Rat and Seek (bars 33-36): sneaky pizzicato, then the build into the capes.
for (let b = B(T.rats); b < B(T.capes); b++) {
  const k = b - B(T.rats), name = ['Dm', 'A', 'Dm', 'A'][k], at = bar(b);
  const [root] = CH[name];
  [[0, 0], [.75, 7], [1.5, 12], [2, 0], [2.75, 7], [3.5, 10]].forEach(([beat, iv]) => { pizz(root + 12 + iv, at + beat * BEAT, { amp: .2 }); pizz(root + iv, at + beat * BEAT, { amp: .12 }); });
  for (let s = 0; s < 8; s++) spicc(root + 24 + (s % 2 ? 7 : 0), at + s * BEAT / 2, { amp: .035, pan: s % 2 ? .4 : -.4 });
  taiko(at, .45); taiko(at + 1.5 * BEAT, .3);
  [[0, 74], [.5, 76], [1, 77], [1.5, 76], [2.5, 73], [3, 74]].forEach(([beat, m]) => pizz(m - (k % 2 ? 0 : 12) + 12, at + beat * BEAT, { amp: .06, pan: .3, decay: .3 }));
  smallTaiko(at, .3); smallTaiko(at + 2 * BEAT, .25); snare(at + 3 * BEAT, .12);
  strings(CH[name][0] + 12, at, BAR, { amp: .03, cutoff: 600 });
  if (k === 3) { snareRoll(at, at + BAR, .35); timpRoll(at, at + BAR, 38, .6); riser(at, BAR, .28); swell(at + BAR * .3, BAR * .7, .3); }
}
hit(T.rats, 'Dm', .9);

// Capes (bars 37-41): halftime majesty — Bb-F-C-Dm, soaring strings, choir, bells.
{
  const prog = ['Bb', 'F', 'C', 'Dm', 'Bbmaj'];
  for (let b = B(T.capes); b < B(T.reel); b++) {
    const k = b - B(T.capes), name = prog[k], at = bar(b);
    pad(b, name, { amp: .05, attack: .5 });
    CH[name].slice(1).forEach((m, i) => choir(m + 12, at, BAR, { amp: .035, pan: (i - 1.5) * .35, attack: .5, vowel: 0 }));
    brass(CH[name][0], at, BAR, { amp: .07, sub: .4 });
    taiko(at, .7); taiko(at + 2.5 * BEAT, .4);
    const line = [[[0, 77, 2], [2, 74, 1], [3, 77, 1]], [[0, 81, 3], [3, 79, 1]], [[0, 79, 2], [2, 76, 2]], [[0, 77, 4]], [[0, 81, 4]]][k];
    melody(b, line, 'strings', { amp: .05 });
    for (let s = 0; s < 8; s++) bell(CH[name][1 + (s % 4)] + 24, at + s * BEAT / 2, { amp: .012, decay: 1.6, pan: s % 2 ? .5 : -.5 });
  }
  hit(T.capes, 'Bb', .9);
  braam(T.capes + 2, 34, 3.5, .9);
  hit(T.tiers, 'Dm', .8);
  // The tiers: rising bells, the legendary one a gold chord.
  [[.5, 74], [1.1, 77], [1.7, 81]].forEach(([dt, m]) => { bell(m + 12, T.tiers + dt, { amp: .06, decay: 2 }); bell(m, T.tiers + dt, { amp: .04, decay: 2 }); });
  [86, 89, 93, 98].forEach((m, i) => bell(m, T.tiers + 2.3 + i * .03, { amp: .05, decay: 3 }));
  riser(T.reel - 2, 2, .25); snareRoll(T.reel - 1.5, T.reel, .35);
}

// The reel (bars 42-43): every poster a stab, climbing to the logo.
{
  const stabs = ['Dm', 'Bb', 'F', 'C', 'Gm', 'A', 'Bb', 'C'];
  stabs.forEach((name, i) => {
    const at = T.reel + i * .5;
    CH[name].slice(1).forEach((m, j) => brass(m + 12, at, .38, { amp: .05, attack: .01, cutoffAttack: .05, pan: (j - 1.5) * .3 }));
    brass(CH[name][0], at, .45, { amp: .09, attack: .01, sub: .3, cutoffAttack: .05 });
    taiko(at, .75); if (i % 2) snare(at, .3);
  });
  strings(62, T.reel, 4, { amp: .04, attack: .3 }); strings(69, T.reel + 2, 2, { amp: .04 });
  timpRoll(T.reel + 2, T.logo, 38, .6); swell(T.reel + 1, 3, .35);
}

// The logo (bars 44-46): the resolve — a huge D major with choir, then the ring-out.
{
  const at = T.logo;
  hit(at, 'D', 1.3);
  CH.D.slice(1).concat([66, 69, 74]).forEach((m, i) => { strings(m, at, 4.5, { amp: .05, attack: .05, release: 2 }); choir(m + 12, at, 4, { amp: .04, pan: (i - 3) * .25, attack: .2, release: 2, vowel: 0 }); });
  brass(38, at, 4, { amp: .1, sub: .5, attack: .02 }); brass(45, at, 4, { amp: .07, attack: .02 }); brass(50, at, 4, { amp: .06, attack: .02 });
  melody(B(at), [[0, 74, 1.5], [1.5, 78, .5], [2, 81, 2]], 'horn', { amp: .1 });
  melody(B(at) + 1, [[0, 86, 4]], 'horn', { amp: .08 });
  [98, 93, 90, 86, 93, 90, 86, 81, 90, 86, 81, 78].forEach((m, i) => bell(m, at + 1.2 + i * .2, { amp: .03 * Math.exp(-i * .08), decay: 3, pan: ((i * 37) % 11 - 5) / 6 }));
}

// The RPG (bars 47-61): its own act. The Worlds chord dies to black, then a
// heartbeat, a sunset, a lone hero, a rising cut and a slam into the title.
{
  const at = T.rpg, dusk = shot('23'), hero = shot('24'), rise = shot('25'), title = shot('26'), slam = title + .6;
  // Black (bars 47-48): a sub drone and a far-off music box playing the theme in the dark.
  boom(at, .9, 3.2);
  strings(26 + 12, at, 20, { amp: .05, attack: 2, cutoff: 300, cutoffEnv: 500, release: 1 });
  [[74, 0], [69, .9], [74, 1.35], [77, 1.8]].forEach(([m, dt]) => bell(m + 12, at + 1 + dt, { amp: .028, decay: 3.2, pan: .25 }));
  // Sunset (bars 49-51): low strings bloom, the choir breathes, a solo horn sings the theme slowly.
  strings(45, dusk, 12, { amp: .035, attack: 2.5, cutoff: 800, cutoffEnv: 1200, cutoffAttack: 6 });
  strings(50, dusk + 1, 11, { amp: .03, attack: 3, cutoff: 900, cutoffEnv: 1500, cutoffAttack: 6 });
  strings(53, dusk + 2, 10, { amp: .025, attack: 3 });
  choir(50, dusk + .5, 5.5, { amp: .035, attack: 2.5, vowel: 2 });
  choir(57, dusk + 2.5, 3.5, { amp: .03, attack: 2, vowel: 2 });
  horn(62, dusk + 1.0, 1.4, { amp: .07 }); horn(57, dusk + 2.4, .55, { amp: .06 }); horn(62, dusk + 3.0, .9, { amp: .07 }); horn(65, dusk + 4.0, 1.8, { amp: .075 });
  for (let b = 0; b < 3; b++) taiko(dusk + b * BAR, .45 + b * .08, .7);
  // The hero (bars 52-54): spiccato ostinato creeping in, choir "ah", taiko pulse, a braam per phrase.
  for (let b = B(hero); b < B(rise); b++) {
    const k = b - B(hero), name = ['Dm', 'Bb', 'Gm'][k], a = bar(b);
    pad(b, name, { amp: .035 + k * .01, attack: .4 });
    CH[name].slice(1).forEach((m, i) => choir(m + 12, a, BAR, { amp: .025 + k * .008, pan: (i - 1.5) * .35, attack: .5, vowel: 0 }));
    for (let s = 0; s < 16; s++) spicc(CH[name][1 + (s % 4 === 3 ? 2 : s % 2)] + 12, a + s * BEAT / 4, { amp: (.018 + k * .012) * (s % 4 === 0 ? 1.4 : 1), pan: s % 2 ? .3 : -.3 });
    taiko(a, .55 + k * .1, .8); taiko(a + 2 * BEAT, .45 + k * .1, .8);
    if (k === 2) for (let s = 0; s < 8; s++) smallTaiko(a + s * BEAT / 2, .14 + s * .02, s % 2 ? .4 : -.4);
  }
  braam(hero, 38, 3.5, .8); braam(hero + 4, 43, 2, .9);
  melody(B(hero), [[0, 74, 2], [2, 77, 2]], 'horn', { amp: .07 });
  melody(B(hero) + 1, [[0, 81, 3], [3, 79, 1]], 'horn', { amp: .08 });
  melody(B(hero) + 2, [[0, 77, 2], [2, 76, 2]], 'horn', { amp: .085 });
  // The rising cut (bars 55-56): a hit on every cut, everything climbing, then nothing.
  [0, 1, 2, 2.5, 3, 3.25, 3.5].forEach((dt, i) => {
    const t = rise + dt, name = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'A'][i];
    CH[name].slice(1).forEach((m, j) => brass(m + 12, t, .3, { amp: .05 + i * .006, attack: .01, cutoffAttack: .05, pan: (j - 1.5) * .3 }));
    brass(CH[name][0], t, .4, { amp: .09, attack: .01, sub: .4, cutoffAttack: .05 });
    taiko(t, .7 + i * .04); timpani(t, CH[name][0], .4);
  });
  [62, 65, 69, 74].forEach((m, i) => choir(m, rise + i * .9, 4 - i * .9, { amp: .04, attack: .4, release: .2, vowel: 0 }));
  strings(62, rise, 3.9, { amp: .045, attack: .3, release: .1 }); strings(74, rise + 2, 1.9, { amp: .04, attack: .5, release: .1 });
  riser(rise, 3.9, .3); snareRoll(rise + 1, rise + 3.9, .4); timpRoll(rise + 2, rise + 3.9, 38, .6); swell(rise + 1.5, 2.4, .4);
  // The title (bars 57-61): the slam, the date on a second hit, the theme in full, then the long ring.
  braam(slam, 38, 5, 1.4); hit(slam, 'Dm', 1.4); crash(slam, .4, 4); boom(slam, 1, 3.4);
  CH.Dm.slice(1).concat([62, 69, 74]).forEach((m, i) => { choir(m + 12, slam, 6, { amp: .045, pan: (i - 3) * .25, attack: .1, release: 3, vowel: 0 }); strings(m, slam, 6.5, { amp: .045, attack: .05, release: 3 }); });
  const date = slam + 2.4;
  hit(date, 'Bb', 1.1); taiko(date, .9); timpani(date, 34, .6);
  melody(B(slam) + 1, [[0, 74, 1.5], [1.5, 69, .5], [2, 74, 1], [3, 77, 1]], 'horn', { amp: .1 });
  melody(B(slam) + 2, [[0, 81, 2], [2, 79, 1], [3, 77, 1]], 'horn', { amp: .1 });
  melody(B(slam) + 3, [[0, 74, 4]], 'horn', { amp: .09 });
  [86, 81, 77, 74, 81, 77, 74, 69].forEach((m, i) => bell(m, slam + 4.6 + i * .22, { amp: .03 * Math.exp(-i * .1), decay: 3.5, pan: ((i * 37) % 11 - 5) / 6 }));
  // Full orchestra under the theme: Dm-Bb-F-A, driving taiko, then it opens out.
  ['Dm', 'Bb', 'F', 'A'].forEach((name, i) => {
    const b = B(slam) + 1 + i, t = bar(b);
    pad(b, name, { amp: .055, attack: .2 }); lowBrass(b, name, { amp: .08 });
    if (i < 3) { ostinato(b, name, { amp: .045 }); drums(b, i === 2 ? 3 : 2); } else { taiko(t, .8); timpRoll(t, t + BAR - .2, 38, .5); }
    CH[name].slice(1).forEach((m, j) => choir(m + 12, t, BAR, { amp: .035, pan: (j - 1.5) * .35, attack: .3, vowel: 0 }));
  });
  hit(slam + 8.6, 'Dm', 1.2); boom(slam + 8.6, .7, 2.5);
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
  braam: t => braam(t, 38, 3.2, 1),
  swing: (t, p) => sfxNoise(t, .26, .34, 500, 3600, p, 7, 1),
  hit: (t, p) => { sfxNoise(t, .14, .55, 1800, 5000, p, 24); sfxTone(t, 190, 70, .22, .5, p, 'sine', 14); },
  block: (t, p) => { sfxNoise(t, .09, .32, 300, 900, p, 40); sfxTone(t, 170, 95, .1, .3, p, 'sine', 30); },
  pop: (t, p) => { sfxTone(t, 600, 1400, .09, .2, p, 'sine', 20); sfxTone(t + .05, 1800, 2400, .2, .08, p, 'sine', 14); },
  shot: (t, p) => { sfxNoise(t, .2, .6, 900, 6500, p, 20); sfxTone(t, 220, 55, .18, .55, p, 'sine', 18); sfxNoise(t + .02, .35, .12, 300, 1400, p, 7); },
  ping: (t, p) => { sfxTone(t, 2400, 2400, .18, .16, p, 'sine', 18); sfxTone(t, 3600, 3600, .12, .07, p, 'sine', 22); },
  death: t => { sfxTone(t, 520, 120, .5, .22, 0, 'saw', 5); sfxNoise(t, .4, .3, 3000, 400, 0, 6); },
  bow: (t, p) => { sfxTone(t, 380, 140, .12, .3, p, 'saw', 22); sfxNoise(t + .02, .3, .22, 900, 3500, p, 9, 1); },
  bowdraw: (t, p) => sfxNoise(t, 1.2, .1, 200, 900, p, 1.5, 1),
  whiz: (t, p) => { sfxTone(t, 1800, 700, .25, .12, p, 'sine', 6); sfxNoise(t, .25, .25, 2000, 6000, p, 8, 1); },
  fall: t => sfxTone(t, 1500, 240, 1.0, .12, 0, 'sine', 2.5),
  goal: t => { [587.3, 740, 880, 1174.7].forEach((f, i) => sfxTone(t + i * .09, f, f, .9, .15, (i - 1.5) * .25, 'sine', 3.2)); sfxNoise(t, 1, .2, 800, 7000, 0, 3, 1); },
  coin: (t, p) => { sfxTone(t, 1760, 1760, .14, .12, p, 'square', 14); sfxTone(t + .06, 2349, 2349, .3, .12, p, 'square', 8); },
  bonk: (t, p) => { sfxTone(t, 320, 150, .16, .45, p, 'sine', 20); sfxNoise(t, .08, .3, 600, 2000, p, 40); },
  whoosh: (t, p) => sfxNoise(t, .7, .36, 300, 5200, p, 3.4, 1),
  impact: t => { sfxTone(t, 90, 30, 1.2, .55, 0, 'sine', 3); sfxNoise(t, .6, .3, 200, 2400, 0, 6); },
  roar: t => {
    const s0 = Math.round(t * RATE), n = Math.round(1.6 * RATE), f = new SVF(); let ph = 0;
    for (let i = 0; i < n && s0 + i < N; i++) {
      const tt = i / RATE, k = tt / 1.6, e = Math.sin(Math.PI * Math.min(1, k)) ** .8;
      ph += TAU * (82 + 40 * Math.sin(k * 9) + 30 * (1 - k)) / RATE;
      const raw = (((ph / TAU) % 1) * 2 - 1) * .7 + (rnd() * 2 - 1) * .5;
      f.run(raw, 420 + 500 * Math.sin(k * 5), .25);
      add(bus.sfx, s0, i, Math.tanh(f.lp * 3) * e * .5, 1, 1);
    }
  },
  fire: t => { sfxNoise(t, 1.4, .5, 300, 3200, 0, 1.8, 1); sfxTone(t, 90, 40, 1.2, .3, 0, 'sine', 2); },
  boom: t => { sfxTone(t, 100, 28, 1.3, .8, 0, 'sine', 3); sfxNoise(t, .8, .5, 150, 2800, 0, 5); },
  debris: t => { for (let i = 0; i < 14; i++) sfxNoise(t + .05 + i * .07 + rnd() * .05, .12, .18, 400, 2200, (rnd() - .5) * 1.4, 30); },
  thunder: t => { sfxNoise(t, .25, .7, 2000, 8000, 0, 12); sfxNoise(t + .05, 2.6, .5, 60, 500, 0, 1.4); sfxTone(t, 60, 30, 2.4, .3, 0, 'sine', 1.6); },
  meteorfall: (t, p) => { sfxTone(t, 2200, 300, 1.8, .14, p, 'sine', .8); sfxNoise(t, 1.8, .3, 300, 2600, p, .9, 1); },
  groan: (t, p) => {
    const s0 = Math.round(t * RATE), n = Math.round(.9 * RATE), f = new SVF(), [l, r] = gains(p); let ph = 0;
    for (let i = 0; i < n && s0 + i < N; i++) {
      const tt = i / RATE, k = tt / .9; ph += TAU * (110 - 30 * k + 6 * Math.sin(tt * 30)) / RATE;
      f.run(((ph / TAU) % 1) * 2 - 1, 500 + 300 * Math.sin(k * Math.PI), .2);
      add(bus.sfx, s0, i, f.bp * Math.sin(Math.PI * k) * .9, l, r);
    }
  },
  crumble: (t, p) => { for (let i = 0; i < 5; i++) sfxNoise(t + i * .05, .15, .2, 200, 1200, p, 25); },
  jump: (t, p) => sfxTone(t, 300, 900, .2, .15, p, 'sine', 8),
  firework: (t, p) => { sfxTone(t - .5, 400, 2400, .5, .06, p, 'sine', 1); sfxNoise(t, .1, .6, 1500, 6000, p, 30); for (let i = 0; i < 12; i++) sfxNoise(t + .15 + i * .06, .05, .12, 3000, 8000, (rnd() - .5) * 1.5, 50); },
  cheer: t => { for (let i = 0; i < 18; i++) sfxNoise(t + i * .03, .9, .09, 900 + (i * 211) % 1800, 1600 + (i * 331) % 2200, ((i * 29) % 13 - 6) / 7, 2.5, 1); },
  squeak: (t, p) => { sfxTone(t, 2300, 3300, .07, .14, p, 'sine', 20); sfxTone(t + .1, 2900, 3700, .06, .12, p, 'sine', 24); },
  meow: t => { sfxTone(t, 520, 760, .45, .16, 0, 'saw', 3.2); sfxTone(t + .3, 760, 420, .4, .12, 0, 'saw', 3.5); },
  cage: t => { for (let i = 0; i < 6; i++) sfxTone(t + i * .035, 900 + (i * 173) % 700, 500, .25, .1, (i - 2.5) * .15, 'square', 14); sfxNoise(t, .3, .25, 1800, 6000, 0, 12); },
  chime: t => { [784, 988, 1175, 1568].forEach((f, i) => sfxTone(t + i * .08, f, f, 1.2, .1, (i - 1.5) * .2, 'sine', 2.4)); },
  wind: t => sfxNoise(t, 5, .12, 200, 900, 0, .35, 1),
  tier: (t, p) => sfxNoise(t, .5, .12, 2000, 9000, p, 6, 1),
  tierGold: t => { sfxNoise(t, 1.2, .16, 3000, 10000, 0, 3, 1); sfxTone(t, 1174.7, 1174.7, 1.5, .06, 0, 'sine', 2); },
  riser: t => riser(t, 2.4, .12),
  heartbeat: t => { sfxTone(t, 62, 34, .28, .75, 0, 'sine', 9); sfxTone(t + .22, 58, 32, .32, .55, 0, 'sine', 8); },
  shimmer: t => { for (let i = 0; i < 10; i++) sfxTone(t + i * .2, 2349 * 2 ** ((i % 5) / 5), 2349 * 2 ** ((i % 5) / 5), 1.2, .04, ((i * 7) % 9 - 4) / 5, 'sine', 3); },
};
const panOf = i => ((i * 53) % 9 - 4) / 9;
let cueCount = 0;
for (const s of timeline.shots) for (const [local, kind] of s.cues ?? []) {
  const fn = SFX[kind];
  if (!fn) throw new Error(`Unknown sound cue ${kind} in ${s.id}`);
  fn(s.start + local, panOf(cueCount++));
}

// ── convolution hall: FFT overlap-add with a synthetic stereo impulse ────
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function impulse(seconds, predelay, damping, side) {
  const len = Math.round(seconds * RATE), ir = new Float64Array(len);
  let s = 0x1234 + side * 777, lp = 0;
  const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 * 2 - 1; };
  const pre = Math.round(predelay * RATE);
  for (let i = pre; i < len; i++) {
    const t = (i - pre) / RATE;
    const k = Math.min(.85, damping * (.3 + t / seconds));
    lp = lp * k + r() * (1 - k);
    ir[i] = lp * Math.exp(-6.9 * t / seconds) * (t < .08 ? .4 + 7.5 * t : 1);
  }
  // Early reflections.
  for (const [d, a] of [[.011, .5], [.019, .35], [.027, .3], [.037, .22], [.051, .18]]) { const k = Math.round((d + side * .003) * RATE); if (k < len) ir[k] += a; }
  let e = 0; for (const v of ir) e += v * v;
  const g = 1 / Math.sqrt(e);
  for (let i = 0; i < len; i++) ir[i] *= g;
  return ir;
}
const IR_CACHE = new Map();
function convolve(stereo, seconds, wet, damping = .55, predelay = .02) {
  const key = `${seconds}:${damping}:${predelay}`;
  const fftSize = 1 << Math.ceil(Math.log2(Math.round(seconds * RATE) * 2));
  const block = fftSize - Math.round(seconds * RATE);
  let spectra = IR_CACHE.get(key);
  if (!spectra) {
    spectra = [0, 1].map(side => {
      const ir = impulse(seconds, predelay, damping, side), re = new Float64Array(fftSize), im = new Float64Array(fftSize);
      re.set(ir); fft(re, im, false); return [re, im];
    });
    IR_CACHE.set(key, spectra);
  }
  const outs = [new Float32Array(N), new Float32Array(N)];
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  for (let c = 0; c < 2; c++) {
    const [hr, hi] = spectra[c];
    for (let pos = 0; pos < N; pos += block) {
      re.fill(0); im.fill(0);
      let any = false;
      for (let i = 0; i < block && pos + i < N; i++) { const v = stereo[c][pos + i] * .8 + stereo[1 - c][pos + i] * .2; re[i] = v; if (v) any = true; }
      if (!any) continue;
      fft(re, im, false);
      for (let i = 0; i < fftSize; i++) { const a = re[i], b = im[i]; re[i] = a * hr[i] - b * hi[i]; im[i] = a * hi[i] + b * hr[i]; }
      fft(re, im, true);
      for (let i = 0; i < fftSize && pos + i < N; i++) outs[c][pos + i] += re[i];
    }
  }
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) stereo[c][i] += outs[c][i] * wet;
}
const started = Date.now();
convolve(bus.strings, 3.2, .38); convolve(bus.brass, 3.2, .32); convolve(bus.choir, 3.6, .55); convolve(bus.keys, 3.2, .5);
convolve(bus.perc, 2.4, .22, .7); convolve(bus.fx, 3.2, .35); convolve(bus.low, 1.6, .12, .8); convolve(bus.sfx, 1.6, .18, .7);
console.log(`Hall reverb in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// ── mix and master ──────────────────────────────────────────────────────
const LEVEL = { strings: 1.0, brass: 1.0, choir: 1.0, keys: .9, low: 1.0, perc: 1.0, fx: .8 };
const stems = { orchestra: ['strings', 'brass', 'choir', 'keys'], percussion: ['perc', 'low'], atmosphere: ['fx'], effects: ['sfx'] };
const sum = names => { const out = make(); for (const n of names) { const g = LEVEL[n] ?? 1; for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) out[c][i] += bus[n][c][i] * g; } return out; };
const music = sum(['strings', 'brass', 'choir', 'keys', 'low', 'perc', 'fx']);
// The dynamic shape, one point per bar (dB): a hushed open, a drop per game,
// a breath for the capes, the logo's peak, then the dark RPG coda.
const CURVE = new Array(SECONDS / BAR + 1).fill(0);
const setRange = (from, to, db) => { for (let b = Math.floor(B(from)); b <= Math.min(CURVE.length - 1, Math.ceil(B(to))); b++) CURVE[b] = db; };
setRange(0, 7.9, -6); CURVE[0] = -4;
setRange(T.party, T.bridge - .1, 0); setRange(T.rats, T.capes - 2.1, -1); setRange(T.capes, T.reel - .1, -1.5);
setRange(T.logo + 4, T.rpg - .1, -2);
// The RPG act starts hushed and climbs to the slam.
setRange(T.rpg, shot('23') - .1, -7); setRange(shot('23'), shot('24') - .1, -5); setRange(shot('24'), shot('25') - .1, -2.5);
setRange(shot('25'), SECONDS, 0); CURVE[CURVE.length - 1] = -10;
const curveGain = t => {
  const x = clamp(t / BAR, 0, CURVE.length - 1.001), i = Math.floor(x), f = smooth(x - i);
  return 10 ** ((CURVE[i] * (1 - f) + CURVE[i + 1] * f) / 20);
};
// A beat of near-silence before the RPG: the logo rings out, then darkness.
const SLAM = shot('26') + .6;
const gapGain = t => t > T.rpg - .9 && t < T.rpg ? 1 - smooth((t - (T.rpg - .9)) / .5) * .85
  // and a held breath of silence between the rising cut and the title slam.
  : t > SLAM - .75 && t < SLAM ? 1 - smooth((t - (SLAM - .75)) / .12) * .97 : 1;
for (let i = 0; i < N; i++) { const t = i / RATE, g = curveGain(t) * gapGain(t); music[0][i] *= g; music[1][i] *= g; }
// Master EQ: clear the sub rumble, tame the boom, open up presence and air.
function biquad(stereo, type, f0, db, q = .707) {
  const A = 10 ** (db / 40), w = TAU * f0 / RATE, cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'low') { const s2 = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cw + s2); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s2); a0 = (A + 1) + (A - 1) * cw + s2; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s2; }
  else if (type === 'high') { const s2 = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cw + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s2); a0 = (A + 1) - (A - 1) * cw + s2; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s2; }
  else { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
  for (const ch of stereo) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < N; i++) {
      const x = ch[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y; ch[i] = y;
    }
  }
}
biquad(music, 'hp', 32, 0); biquad(music, 'low', 140, -5); biquad(music, 'peak', 380, -2.5, .9);
biquad(music, 'peak', 3200, 3.5, .8); biquad(music, 'high', 8000, 3);
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) music[c][i] = Math.tanh(music[c][i] * 1.4) / 1.4;
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(music[0][i]), Math.abs(music[1][i]));
const gain = .9 / Math.max(peak, 1e-6);

function wav(stereo, trim = 1, fadeIn = .02, fadeOut = 1.5) {
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
await writeFile(path.join(output, 'worlds-rising.wav'), wav(music, gain));
const effects = sum(['sfx']);
let epeak = 0; for (let i = 0; i < N; i++) epeak = Math.max(epeak, Math.abs(effects[0][i]), Math.abs(effects[1][i]));
await writeFile(path.join(output, 'effects.wav'), wav(effects, Math.min(.9, .95 / Math.max(epeak, 1e-6)), .01, .3));
for (const [name, list] of Object.entries(stems)) await writeFile(path.join(output, `${name}.wav`), wav(sum(list), gain));
await writeFile(path.join(output, 'composition.json'), JSON.stringify({
  title: 'Worlds Rising', tempo: BPM, meter: '4/4', key: 'D minor → F major → D major → D minor (RPG act)', duration: SECONDS, sampleRate: RATE, bitDepth: 24,
  sections: T, source: 'Original procedural composition; no third-party samples', soundCues: cueCount, events: events.slice(0, 4000),
}, null, 2));
console.log(`Composed ${events.length} voices, ${cueCount} sound cues, ${SECONDS}s, stereo ${RATE} Hz / 24-bit: ${output}`);
