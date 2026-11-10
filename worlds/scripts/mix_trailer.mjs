import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseDirectory, requireFiles, run } from './release_tools.mjs';

const command = (ffmpeg, args, collect = false) => run(ffmpeg, args, { collect });

export async function mixTrailer(directory, ffmpeg = process.env.FFMPEG ?? 'ffmpeg') {
  await requireFiles(directory, ['worlds-rising.wav', 'effects.wav']);
  const file = name => path.join(directory, name);
  const quiet = ['-hide_banner', '-loglevel', 'warning', '-y'];
  await command(ffmpeg, [...quiet, '-i', file('worlds-rising.wav'), '-i', file('effects.wav'), '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.89', '-ar', '48000', '-c:a', 'pcm_s24le', file('trailer-mix-premaster.wav')]);
  // This score's dynamics are too wide for linear loudnorm, which silently falls
  // back to dynamic mode and overshoots after AAC. So: measure, apply one fixed
  // gain, and catch the peaks with a limiter run at 4x to see intersample peaks.
  const measure = async name => {
    const analysis = await command(ffmpeg, ['-hide_banner', '-i', file(name), '-af', 'loudnorm=I=-14:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], true);
    const match = analysis.match(/\{\s*"input_i"[\s\S]*?\}/);
    if (!match) throw new Error('FFmpeg did not return loudness measurements.');
    return JSON.parse(match[0]);
  };
  // The limiter shaves about 0.6 LU off the integrated level; the gain makes that up.
  const master = stats => `volume=${(-14 - Number(stats.input_i) + .6).toFixed(2)}dB,aresample=192000,alimiter=limit=0.63:attack=2:release=60:level=disabled,aresample=48000`;
  const loudness = await measure('trailer-mix-premaster.wav');
  await command(ffmpeg, [...quiet, '-i', file('trailer-mix-premaster.wav'), '-af', master(loudness), '-ar', '48000', '-c:a', 'pcm_s24le', file('trailer-final-mix.wav')]);
  const listening = await measure('worlds-rising.wav');
  await command(ffmpeg, [...quiet, '-i', file('worlds-rising.wav'), '-af', master(listening), '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-metadata', 'title=Worlds Rising', file('worlds-rising.m4a')]);
  await writeFile(file('loudness.json'), JSON.stringify(loudness, null, 2));
  return loudness;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2] ?? path.join(releaseDirectory, 'audio'));
  await mixTrailer(directory);
  console.log(`Final trailer mix and listening copy: ${directory}`);
}
