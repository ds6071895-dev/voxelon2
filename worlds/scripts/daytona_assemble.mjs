// Cloud mastering step for scripts/daytona_trailer.py: join the picture
// partitions from the shared volume in timeline order, compose the score,
// encode the master and verify it. Deliverables stay in /app/final for download;
// the orchestrator clears the volume only once they are safely on the local disk.
// node scripts/daytona_assemble.mjs /app/assemble.json
import { cp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finishTrailer } from './finish_trailer.mjs';
import { expectedFrames, run } from './release_tools.mjs';

const { run: id, parts } = JSON.parse(await readFile(process.argv[2], 'utf8'));
const media = `/media/${id}`;
const work = '/app/final';
await rm(work, { recursive: true, force: true });
await mkdir(path.join(work, 'video'), { recursive: true });
await cp(path.join(media, 'stills'), work, { recursive: true });
const manifests = await Promise.all(parts.map(async p => JSON.parse(await readFile(path.join(media, p, 'picture-manifest.json'), 'utf8'))));
const manifest = manifests[0];
const selected = manifests.flatMap(m => m.selected);
if (JSON.stringify(selected) !== JSON.stringify(manifest.shots.map((_, i) => i))) throw new Error(`Partitions must cover every shot once, in order: ${selected}`);
for (const m of manifests) {
  for (const key of ['width', 'height', 'fps', 'duration', 'seed']) if (m[key] !== manifest[key]) throw new Error(`Partition ${key} mismatch`);
  if (JSON.stringify(m.shots) !== JSON.stringify(manifest.shots)) throw new Error('Partition shot lists differ');
  if (m.frameCount !== expectedFrames(m, m.selected)) throw new Error('Partition frame count does not match its shots');
}
const total = manifests.reduce((n, m) => n + m.frameCount, 0);
const ivf = path.join(work, 'video/worlds-release-picture.ivf');
const out = await open(ivf, 'w');
let first = null;
for (const [i, p] of parts.entries()) {
  const bytes = await readFile(path.join(media, p, 'video/worlds-release-picture.ivf'));
  const header = Buffer.from(bytes.subarray(0, 32));
  if (header.toString('latin1', 0, 4) !== 'DKIF' || header.readUInt32LE(24) !== manifests[i].frameCount) throw new Error(`Bad IVF header in ${p}`);
  if (first && !header.subarray(0, 24).equals(first.subarray(0, 24))) throw new Error(`IVF encoding mismatch in ${p}`);
  if (!first) { first = header; header.writeUInt32LE(total, 24); await out.write(header); }
  await out.write(bytes.subarray(32));
}
await out.close();
const stills = JSON.parse(await readFile(path.join(work, 'screenshots-manifest.json'), 'utf8'));
Object.assign(manifest, { screenshots: stills.screenshots, frameCount: total, cloud: 'Daytona', run: id });
delete manifest.selected; delete manifest.picture;
await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
await finishTrailer(work, manifest, process.env.FFMPEG ?? 'ffmpeg');
await run(process.execPath, ['scripts/verify_release.mjs', work]);
await run(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(work, manifest.video), '-vf', 'fps=1/4,scale=384:216,tile=6x5', '-frames:v', '1', path.join(work, 'review.png')]);
// Intermediates and stems stay behind; only deliverables are published.
await rm(ivf);
for (const f of ['trailer-mix-premaster.wav', 'orchestra.wav', 'percussion.wav', 'atmosphere.wav', 'effects.wav']) await rm(path.join(work, 'audio', f), { force: true });
console.log(`Assembled ${total} frames from ${parts.length} partitions; deliverables in ${work}`);
