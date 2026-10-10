// One local/cloud master-encoding contract, driven by the capture manifest.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mixTrailer } from './mix_trailer.mjs';
import { expectedFrames, releaseDirectory, requireFiles, run, videoFile, writeGallery } from './release_tools.mjs';

export async function finishTrailer(directory, manifest, ffmpeg = process.env.FFMPEG ?? 'ffmpeg') {
  if (manifest.selected?.length) throw new Error('Assemble picture partitions before encoding a full trailer');
  const frames = expectedFrames(manifest);
  if (manifest.frameCount !== frames) throw new Error(`Picture frame count ${manifest.frameCount}; expected ${frames}`);
  const audio = path.join(directory, 'audio');
  try { await requireFiles(directory, ['audio/worlds-awaken.wav', 'audio/effects.wav']); }
  catch { await run(process.execPath, ['scripts/compose_trailer.mjs', audio]); }
  const loudness = await mixTrailer(audio, ffmpeg);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-i', path.join(directory, 'video/worlds-release-picture.ivf'), '-i', path.join(audio, 'trailer-final-mix.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', String(manifest.duration), '-movflags', '+faststart', '-metadata', 'title=Worlds — November 2026 Release Trailer', '-metadata', 'comment=Original score: Worlds Awaken. Staged in-engine cinematic.', path.join(directory, videoFile)]);
  // Effects and the other stems are mastering inputs retained in cloud storage;
  // the downloadable manifest names only final audio deliverables.
  Object.assign(manifest, { loudness, video: videoFile, audio: { music: 'audio/worlds-awaken.wav', listening: 'audio/worlds-awaken.m4a', mix: 'audio/trailer-final-mix.wav' } });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeGallery(directory, manifest);
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2] ?? releaseDirectory);
  await finishTrailer(directory, JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')));
}
