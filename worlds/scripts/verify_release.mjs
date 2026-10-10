// Verify deliverables, not just source: decode the MP4, check frame count,
// loudness and long black gaps, and validate the screenshot PNG dimensions.
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './browser_session.mjs';
import { canonicalLogo, expectedFrames, mediaPath, releaseDirectory, requireFiles, run, verifyGallery } from './release_tools.mjs';

if (process.argv.length > 3) throw new Error('Usage: node scripts/verify_release.mjs [output directory]');
const directory = path.resolve(process.argv[2] ?? releaseDirectory);
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
if (manifest.selected?.length) throw new Error('Cannot verify a picture partition as a completed release');
const frameCount = expectedFrames(manifest);
if (manifest.frameCount !== frameCount) throw new Error('Manifest frame count does not match its shot timeline');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const video = mediaPath(directory, manifest.video);
await requireFiles(directory, [manifest.video, ...Object.values(manifest.audio ?? { music: 'audio/worlds-awaken.wav', listening: 'audio/worlds-awaken.m4a', mix: 'audio/trailer-final-mix.wav' })]);
const result = await run(ffmpeg, ['-hide_banner', '-i', video, '-vf', 'blackdetect=d=0.5:pic_th=0.99:pix_th=0.03', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { collect: true });
const frames = [...result.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
if (Number(frames) !== frameCount) throw new Error(`Decoded ${frames} frames; expected ${frameCount}.`);
if (!result.includes(`${manifest.width}x${manifest.height}`)) throw new Error('Unexpected video dimensions.');
const longBlack = [...result.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].filter(m => Number(m[3]) > .8 && Number(m[1]) > 1 && Number(m[2]) < manifest.duration - 1);
if (longBlack.length) throw new Error(`Unexpected long black gaps: ${longBlack.map(m => m[0]).join(', ')}`);
const loudness = JSON.parse(result.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] ?? '{}');
if (!Number.isFinite(Number(loudness.input_i)) || Math.abs(Number(loudness.input_i) + 14) > 1) throw new Error(`Unexpected loudness: ${loudness.input_i} LUFS.`);
if (Number(loudness.input_tp) > -.5) throw new Error(`Unexpected encoded true peak: ${loudness.input_tp} dBTP.`);
const stillManifestText = await readFile(path.join(directory, 'screenshots-manifest.json'), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
const stillManifest = stillManifestText ? JSON.parse(stillManifestText) : manifest;
const screenshots = stillManifest.screenshots;
if (!Array.isArray(screenshots)) throw new Error('Missing screenshot manifest');
if (stillManifest.seed !== manifest.seed || JSON.stringify(stillManifest.shots) !== JSON.stringify(manifest.shots)) throw new Error('Screenshot and video manifests describe different scenes');
if (manifest.screenshots?.length && JSON.stringify(manifest.screenshots) !== JSON.stringify(screenshots)) throw new Error('Screenshot manifests disagree');
if (screenshots.length < 8) throw new Error('Missing promotional screenshots.');
if (new Set(screenshots.map(s => s.file)).size !== screenshots.length) throw new Error('Duplicate screenshot paths');
for (const s of screenshots) {
  if (!Number.isInteger(s.shot) || !manifest.shots[s.shot] || !Number.isFinite(s.time) || s.time < 0 || s.time > manifest.shots[s.shot].duration) throw new Error(`Invalid screenshot scene: ${s.file}`);
  const bytes = await readFile(mediaPath(directory, s.file));
  if (bytes.length < 24) throw new Error(`Truncated PNG: ${s.file}`);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${s.file}`);
  if (bytes.readUInt32BE(16) !== s.width || bytes.readUInt32BE(20) !== s.height) throw new Error(`Wrong screenshot dimensions: ${s.file}`);
  if (bytes.length < 20000) throw new Error(`Suspiciously empty screenshot: ${s.file}`);
}
const logo = await readFile(path.join(directory, 'worlds-title-logo.svg'), 'utf8');
const title = await readFile(path.join(root, 'index.html'), 'utf8');
const wordmark = title.slice(title.indexOf('class="w-wordmark"'));
if (canonicalLogo(logo) !== canonicalLogo(wordmark)) throw new Error('Logo does not match the complete title-screen lockup');
const links = await verifyGallery(directory);
for (const file of [manifest.video, ...screenshots.map(s => s.file)]) if (!links.includes(file)) throw new Error(`Gallery omits deliverable: ${file}`);
const report = { decodedFrames: Number(frames), expectedFrames: frameCount, seconds: manifest.duration, width: manifest.width, height: manifest.height, fps: manifest.fps, screenshots: screenshots.length, integratedLUFS: Number(loudness.input_i), truePeakDBTP: Number(loudness.input_tp), bytes: (await stat(video)).size, longBlackGaps: longBlack.length };
await writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
console.log('Verified release media:', report);
