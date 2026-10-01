// Worlds Awaken: an original 47-bar score, 120 BPM, D minor.
// Dependency-free additive/FM synthesis. No recordings, samples or stock music.
// node scripts/compose_trailer.mjs [output directory]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'release-media/audio');
await mkdir(output, { recursive: true });
const RATE = 48000, SECONDS = 94, N = RATE * SECONDS, TAU = Math.PI * 2;
const stems = Object.fromEntries(['melody', 'atmosphere', 'percussion', 'effects'].map(k => [k, [new Float32Array(N), new Float32Array(N)]]));
let state = 202611;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const events = [];

function envelope(t, duration, attack, release) {
  const a = Math.min(1, t / attack), r = Math.min(1, (duration - t) / release);
  return Math.max(0, a * a * (3 - 2 * a) * r);
}

function note(bus, midi, at, duration, amp, voice = 'strings', pan = 0) {
  const start = Math.round(at * RATE), length = Math.min(Math.round(duration * RATE), N - start);
  if (length <= 0 || start < 0) return;
  const freq = hz(midi), phase = random() * TAU;
  const l = Math.sqrt((1 - pan) / 2), r = Math.sqrt((1 + pan) / 2);
  const [left, right] = stems[bus];
  const attack = voice === 'pluck' ? .006 : voice === 'brass' ? .055 : .3;
  const release = voice === 'pluck' ? .15 : .35;
  for (let i = 0; i < length; i++) {
    const t = i / RATE, p = TAU * freq * t;
    let wave;
    if (voice === 'strings') {
      // Detuned desks, gentle bow noise and a rounded harmonic spectrum.
      const vibrato = .022 * Math.sin(TAU * 5.1 * t + phase);
      wave = (Math.sin(p + vibrato) + .44 * Math.sin(p * 1.003 + phase)
        + .29 * Math.sin(2 * p + vibrato) + .12 * Math.sin(3 * p) + .065 * Math.sin(4 * p)) / 1.9;
    } else if (voice === 'brass') {
      const swell = Math.min(1, t / .18) * (.82 + .18 * Math.sin(Math.PI * t / duration));
      wave = Math.tanh((Math.sin(p + .07 * Math.sin(p * 2)) + .43 * Math.sin(2 * p)
        + .2 * Math.sin(3 * p) + .09 * Math.sin(4 * p)) * 1.3) * swell;
    } else if (voice === 'choir') {
      // Smooth vowel-like formants rather than a harsh saw wave.
      wave = (Math.sin(p + .014 * Math.sin(t * 29)) + .2 * Math.sin(2 * p)
        + .22 * Math.sin(3 * p) + .12 * Math.sin(5 * p)) * .68;
    } else if (voice === 'pluck') {
      wave = (Math.sin(p) + .32 * Math.sin(2 * p) + .14 * Math.sin(3 * p)) * Math.exp(-t * 7);
    } else {
      wave = (Math.sin(p) + .22 * Math.sin(2 * p + .4 * Math.sin(t * 2))) * .8;
    }
    const v = wave * envelope(t, duration, attack, release) * amp;
    left[start + i] += v * l; right[start + i] += v * r;
  }
  events.push({ bus, midi, at, duration, voice });
}

function drum(at, amp = .25, kind = 'low', pan = 0) {
  const duration = kind === 'cymbal' ? 2.4 : kind === 'snare' ? .35 : 1.2;
  const start = Math.round(at * RATE), n = Math.min(N - start, Math.round(duration * RATE));
  const [left, right] = stems.percussion;
  const l = Math.sqrt((1 - pan) / 2), r = Math.sqrt((1 + pan) / 2);
  let phase = 0, smoothNoise = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, noise = random() * 2 - 1;
    smoothNoise += .07 * (noise - smoothNoise);
    let v;
    if (kind === 'cymbal') v = (noise - smoothNoise) * Math.exp(-t * 2.5) * Math.min(1, t * 200);
    else if (kind === 'snare') v = (noise * .6 + Math.sin(TAU * 185 * t) * .35) * Math.exp(-t * 17) * Math.min(1, t * 700);
    else {
      phase += TAU * (kind === 'low' ? 47 + 105 * Math.exp(-t * 32) : 95 + 95 * Math.exp(-t * 30)) / RATE;
      v = (Math.sin(phase) * Math.exp(-t * 5) + smoothNoise * .4 * Math.exp(-t * 20)) * Math.min(1, t * 900);
    }
    left[start + i] += v * amp * l; right[start + i] += v * amp * r;
  }
}

function riser(at, duration, amp) {
  const start = Math.round(at * RATE), n = Math.min(N - start, Math.round(duration * RATE));
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, k = t / duration, noise = random() * 2 - 1;
    low += (.02 + .12 * k) * (noise - low);
    const v = (low * .8 + Math.sin(TAU * (55 * t + 55 * t * t / duration)) * .2) * k * k * amp;
    stems.atmosphere[0][start + i] += v * .7; stems.atmosphere[1][start + i] += v * .7;
  }
}

const chords = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 57, 60], [48, 55, 60, 64]];
const motif = [[74, 0, 1], [77, 1, 1], [81, 2, 2], [79, 4, 1], [76, 5, 1], [74, 6, 2]];
for (let bar = 0; bar < 37; bar++) {
  const at = bar * 2;
  const chord = chords[Math.floor(bar / 2) % 4];
  const section = at < 8 ? 0 : at < 32 ? 1 : at < 50 ? 2 : at < 62 ? 3 : 4;
  const power = [.45, .7, .95, .65, 1][section];
  chord.forEach((m, i) => note('atmosphere', m, at, 2.35, .09 * power, 'strings', (i - 1.5) * .32));
  note('atmosphere', chord[0] - 12, at, 2.15, .10 * power, 'pad', 0);
  if (section === 2 || section === 4) chord.slice(1).forEach((m, i) => note('atmosphere', m + 12, at, 2.3, .045, 'choir', (i - 1) * .35));
  if (section > 0) {
    // String ostinato: eight pulses to a bar, with rat-section plucked variation.
    for (let step = 0; step < 8; step++) {
      const m = chord[[0, 2, 1, 2, 0, 3, 1, 2][step]] + (section === 3 ? 12 : 0);
      note('melody', m, at + step * .25, .24, .062 * power, section === 3 ? 'pluck' : 'strings', step % 2 ? .25 : -.25);
    }
    drum(at, .27 * power);
    drum(at + 1, .20 * power, 'low', -.12);
    drum(at + .75, .10 * power, 'high', .35);
    drum(at + 1.5, .14 * power, 'snare', .12);
    if (section >= 2) { drum(at + 1.75, .08, 'high', -.35); drum(at + .5, .07, 'high', .35); }
  }
}

// Opening motif, then brass statements and a nimble manor variation.
for (const at of [2, 10, 22, 34, 42, 54, 62, 66, 70]) {
  const heroic = at >= 32 && at < 50 || at >= 62;
  for (const [m, beat, beats] of motif) {
    const midi = at === 54 ? m + 12 : m - (at < 8 ? 12 : 0);
    note('melody', midi, at + beat * .5, beats * .5 + .12, heroic ? .135 : .085,
      at === 54 ? 'pluck' : heroic ? 'brass' : 'strings', -.08);
    if (heroic) note('melody', midi - 12, at + beat * .5, beats * .5 + .12, .055, 'brass', .15);
  }
}
for (const at of [8, 20, 32, 44, 50, 62, 76, 82]) { drum(at, .24, 'cymbal', .15); drum(at, .35); }
for (const [at, duration] of [[6, 2], [18, 2], [30, 2], [40, 4], [60, 2], [72, 2]]) riser(at, duration, .19);
// A genuinely major final chord under the November reveal; reverb decays to black.
for (const [i, m] of [38, 50, 57, 62, 66, 69, 74].entries()) {
  note('melody', m, 76, 5.3, .075, i < 2 ? 'pad' : 'brass', (i - 3) * .14);
  note('atmosphere', m, 76, 5.8, .06, 'strings', (3 - i) * .18);
}
// Release-date anticipation, then a mysterious, spacious cape-teaser coda.
riser(74, 2, .23);
for (const at of [82, 86, 90]) {
  [38, 50, 57, 62, 65].forEach((m, i) => note('atmosphere', m, at, 3.8, .055, 'choir', (i - 2) * .25));
  for (const [m, beat, beats] of motif) note('melody', m, at + beat * .5, beats * .5 + .2, .065, 'pluck', -.1);
  drum(at, .12, 'low');
}

// Editorial effects at the action beats: distant impacts, wing rushes, and fire.
function effect(at, duration, kind, amp, pan = 0) {
  const start = Math.round(at * RATE), count = Math.min(N - start, Math.round(duration * RATE));
  let low = 0, phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / RATE, noise = random() * 2 - 1;
    low += .035 * (noise - low);
    phase += TAU * (70 + 50 * Math.exp(-t * 8)) / RATE;
    const v = kind === 'fire' ? (low * 2 + Math.sin(phase) * .4) * Math.exp(-t * 2)
      : kind === 'wing' ? low * Math.sin(Math.PI * t / duration) * 2
        : (noise * .15 + Math.sin(phase) * .65) * Math.exp(-t * 25);
    stems.effects[0][start + i] += v * amp * Math.sqrt((1 - pan) / 2);
    stems.effects[1][start + i] += v * amp * Math.sqrt((1 + pan) / 2);
  }
}
for (let t = 16.5; t < 20; t += .75) effect(t, .25, 'hit', .13);
for (let t = 24.5; t < 32; t += .5) for (const offset of [0, .06, .12]) effect(t + offset, .13, 'hit', .065, -.2);
for (let t = 44; t < 50; t += 1.3) effect(t, .7, 'wing', .2);
effect(47.7, 1.8, 'fire', .28);
effect(60.85, .35, 'hit', .09);
for (let t = 65.5; t < 68; t += .5) effect(t, .18, 'hit', .1);
effect(70.2, 1, 'fire', .2);

// A small diffuse hall: non-feedback cross-channel early and late reflections.
function reverb(stereo, wet) {
  const dry = stereo.map(channel => channel.slice());
  for (const [seconds, gain] of [[.041, .18], [.073, .15], [.113, .13], [.179, .12], [.257, .10], [.379, .085], [.521, .07], [.739, .052], [1.03, .035], [1.43, .022]]) {
    const delay = Math.round(seconds * RATE);
    for (let i = delay; i < N; i++) {
      stereo[0][i] += dry[1][i - delay] * gain * wet;
      stereo[1][i] += dry[0][i - delay] * gain * wet;
    }
  }
}
reverb(stems.melody, .8); reverb(stems.atmosphere, 1.1); reverb(stems.percussion, .5); reverb(stems.effects, .3);

function wav(stereo, gain = 1) {
  const bytes = 3, dataLength = N * 2 * bytes;
  const b = Buffer.alloc(44 + dataLength);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLength, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 6, 28); b.writeUInt16LE(6, 32); b.writeUInt16LE(24, 34);
  b.write('data', 36); b.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < N; i++) {
    const fade = Math.min(1, i / (RATE * .08), (N - i) / (RATE * .6));
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-.999, Math.min(.999, stereo[c][i] * gain * fade));
      b.writeIntLE(Math.round(v * 8388607), 44 + (i * 2 + c) * 3, 3);
    }
  }
  return b;
}
const music = [new Float32Array(N), new Float32Array(N)];
for (const bus of ['melody', 'atmosphere', 'percussion']) for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) music[c][i] += stems[bus][c][i];
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(music[0][i]), Math.abs(music[1][i]));
const gain = .82 / Math.max(peak, .82);
await writeFile(path.join(output, 'worlds-awaken.wav'), wav(music, gain));
for (const [name, stereo] of Object.entries(stems)) await writeFile(path.join(output, `${name}.wav`), wav(stereo, gain));
await writeFile(path.join(output, 'composition.json'), JSON.stringify({ title: 'Worlds Awaken', tempo: 120, meter: '4/4', key: 'D minor → D major', duration: SECONDS, sampleRate: RATE, bitDepth: 24, source: 'Original procedural composition; no third-party samples', events }, null, 2));
console.log(`Composed ${events.length} voices, ${SECONDS}s, stereo ${RATE} Hz / 24-bit: ${output}`);
