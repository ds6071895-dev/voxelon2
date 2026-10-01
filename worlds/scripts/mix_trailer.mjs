import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function command(ffmpeg, args, collect = false) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn(ffmpeg, args, { stdio: collect ? ['ignore', 'ignore', 'pipe'] : 'inherit' });
    if (collect) proc.stderr.on('data', b => { stderr += b; });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve(stderr) : reject(new Error(`FFmpeg exited ${code}: ${stderr}`)));
  });
}

export async function mixTrailer(directory, ffmpeg = process.env.FFMPEG ?? 'ffmpeg') {
  const file = name => path.join(directory, name);
  const quiet = ['-hide_banner', '-loglevel', 'warning', '-y'];
  await command(ffmpeg, [...quiet, '-i', file('worlds-awaken.wav'), '-i', file('effects.wav'), '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.89', '-ar', '48000', '-c:a', 'pcm_s24le', file('trailer-mix-premaster.wav')]);
  const analysis = await command(ffmpeg, ['-hide_banner', '-i', file('trailer-mix-premaster.wav'), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], true);
  const match = analysis.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error('FFmpeg did not return loudness measurements.');
  const loudness = JSON.parse(match[0]);
  const filter = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`;
  await command(ffmpeg, [...quiet, '-i', file('trailer-mix-premaster.wav'), '-af', filter, '-ar', '48000', '-c:a', 'pcm_s24le', file('trailer-final-mix.wav')]);
  await command(ffmpeg, [...quiet, '-i', file('worlds-awaken.wav'), '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-metadata', 'title=Worlds Awaken', file('worlds-awaken.m4a')]);
  await writeFile(file('loudness.json'), JSON.stringify(loudness, null, 2));
  return loudness;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2] ?? 'release-media/audio');
  await mixTrailer(directory);
  console.log(`Final trailer mix and listening copy: ${directory}`);
}
