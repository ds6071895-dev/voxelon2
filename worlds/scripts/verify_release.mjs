// Verify deliverables, not just source: decode the MP4, check frame count,
// loudness and long black gaps, and validate the screenshot PNG dimensions.
import { readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? 'release-media');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const video = path.join(directory, manifest.video);
const result = await new Promise((resolve, reject) => {
  let output = '';
  const p = spawn(ffmpeg, ['-hide_banner', '-i', video, '-vf', 'blackdetect=d=0.5:pic_th=0.99:pix_th=0.03', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', b => { output += b; });
  p.on('error', reject);
  p.on('exit', code => code === 0 ? resolve(output) : reject(new Error(output)));
});
const frames = [...result.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
if (Number(frames) !== manifest.duration * manifest.fps) throw new Error(`Decoded ${frames} frames; expected ${manifest.duration * manifest.fps}.`);
if (!result.includes(`${manifest.width}x${manifest.height}`)) throw new Error('Unexpected video dimensions.');
const longBlack = [...result.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].filter(m => Number(m[3]) > .8 && Number(m[1]) > 1 && Number(m[2]) < manifest.duration - 1);
if (longBlack.length) throw new Error(`Unexpected long black gaps: ${longBlack.map(m => m[0]).join(', ')}`);
const loudness = JSON.parse(result.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] ?? '{}');
if (!Number.isFinite(Number(loudness.input_i)) || Math.abs(Number(loudness.input_i) + 14) > 1) throw new Error(`Unexpected loudness: ${loudness.input_i} LUFS.`);
if (Number(loudness.input_tp) > -.5) throw new Error(`Unexpected encoded true peak: ${loudness.input_tp} dBTP.`);
const screenshots = JSON.parse(await readFile(path.join(directory, 'screenshots-manifest.json'), 'utf8').catch(() => JSON.stringify(manifest))).screenshots;
if (screenshots.length < 8) throw new Error('Missing promotional screenshots.');
for (const s of screenshots) {
  const bytes = await readFile(path.join(directory, s.file));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${s.file}`);
  if (bytes.readUInt32BE(16) !== s.width || bytes.readUInt32BE(20) !== s.height) throw new Error(`Wrong screenshot dimensions: ${s.file}`);
  if (bytes.length < 20000) throw new Error(`Suspiciously empty screenshot: ${s.file}`);
}
const logo = await readFile(path.join(directory, 'worlds-title-logo.svg'), 'utf8');
if (!logo.includes('wl-ink') || !logo.includes('M11 0V66Q11 89 34 89')) throw new Error('Logo does not match the title-screen lockup.');
const report = { decodedFrames: Number(frames), seconds: manifest.duration, width: manifest.width, height: manifest.height, fps: manifest.fps, screenshots: screenshots.length, integratedLUFS: Number(loudness.input_i), truePeakDBTP: Number(loudness.input_tp), bytes: (await stat(video)).size, longBlackGaps: longBlack.length };
await writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
console.log('Verified release media:', report);
