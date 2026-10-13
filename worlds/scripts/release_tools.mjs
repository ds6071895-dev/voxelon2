import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { root, positiveInteger, selection } from './browser_session.mjs';

export const releaseDirectory = path.join(root, 'release-media/revised');
export const videoFile = 'video/worlds-november-2026-trailer.mp4';
export function captureOptions(argv) {
  const flags = new Set(['stills-only', 'video-only', 'picture-only']);
  const values = new Set(['width', 'height', 'fps', 'stills-width', 'quality', 'output', 'shots']);
  const options = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1]) || !(flags.has(match[1]) ? match[2] === undefined : values.has(match[1]) && !!match[2])) throw new Error(`Unknown, empty or duplicate capture option: ${arg}`);
    options[match[1]] = match[2] ?? true;
  }
  if (options['stills-only'] && options['video-only']) throw new Error('--stills-only and --video-only are incompatible');
  if (options['picture-only'] && !options['video-only']) throw new Error('--picture-only requires --video-only');
  if (options.shots !== undefined && !options['picture-only']) throw new Error('--shots requires --video-only --picture-only; partial pictures retain full-edit timestamps for cloud assembly');
  const width = positiveInteger('width', options.width ?? 1920, 8192);
  const height = positiveInteger('height', options.height ?? 1080, 8192);
  if (width % 2 || height % 2) throw new Error('Video dimensions must be even');
  const fps = positiveInteger('fps', options.fps ?? 30, 60);
  const stillWidth = positiveInteger('stills-width', options['stills-width'] ?? 3840, 8192);
  const quality = options.quality ?? 'balanced';
  if (!['balanced', 'max', 'high'].includes(quality)) throw new Error(`Invalid quality: ${quality}`);
  const selected = options.shots === undefined ? [] : selection('shots', options.shots, Array.from({ length: 1000 }, (_, i) => String(i))).map(Number);
  if (selected.some((n, i) => i && n <= selected[i - 1])) throw new Error('--shots must be in increasing timeline order');
  return { ...options, width, height, fps, stillWidth, quality, selected, out: path.resolve(root, options.output ?? releaseDirectory) };
}
export function expectedFrames(manifest, selected = manifest.selected ?? []) {
  const fps = positiveInteger('manifest fps', manifest.fps, 60);
  positiveInteger('manifest width', manifest.width, 8192);
  positiveInteger('manifest height', manifest.height, 8192);
  if (!Number.isFinite(manifest.duration) || manifest.duration <= 0) throw new Error('Invalid manifest duration');
  if (!Array.isArray(manifest.shots) || !manifest.shots.length) throw new Error('Manifest must declare its shots');
  let end = 0;
  for (const shot of manifest.shots) {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0 || !Number.isFinite(shot.start) || Math.abs(shot.start - end) > 1e-6) throw new Error('Invalid or discontinuous shot timeline');
    end += shot.duration;
  }
  if (Math.abs(end - manifest.duration) > 1e-6) throw new Error('Shot timeline does not match manifest duration');
  if (!Array.isArray(selected) || selected.some((n, i) => !Number.isInteger(n) || !manifest.shots[n] || (i && n <= selected[i - 1]))) throw new Error('Invalid manifest shot selection');
  const indices = selected.length ? selected : manifest.shots.map((_, i) => i);
  return indices.reduce((n, i) => n + Math.round(manifest.shots[i].duration * fps), 0);
}
export function mediaPath(directory, file) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file)) throw new Error(`Invalid media path: ${file}`);
  const resolved = path.resolve(directory, file);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error(`Media path escapes output: ${file}`);
  return resolved;
}
export async function requireFiles(directory, files) {
  for (const file of files) {
    const info = await stat(mediaPath(directory, file)).catch(() => null);
    if (!info?.isFile() || !info.size) throw new Error(`Missing or empty deliverable: ${file}`);
  }
}
export function run(command, args, { collect = false, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn(command, args, { cwd, stdio: collect ? ['ignore', 'ignore', 'pipe'] : 'inherit' });
    if (collect) proc.stderr.on('data', bytes => { stderr += bytes; });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve(stderr) : reject(new Error(`${command} exited ${code}: ${stderr}`)));
  });
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function gallery(manifest) {
  const screenshots = manifest.screenshots ?? [];
  const cards = screenshots.map(s => `<figure><a href="${escape(s.file)}"><img src="${escape(s.file)}" alt="${escape(path.basename(s.file, '.png').replace(/^\d+-/, '').replaceAll('-', ' '))}" loading="lazy"></a><figcaption>${escape(path.basename(s.file, '.png').replace(/^\d+-/, '').replaceAll('-', ' '))}</figcaption></figure>`).join('\n');
  const thumbnail = screenshots.find(s => s.file.includes('trailer-thumbnail'));
  const video = manifest.video ? `<video controls preload="metadata"${thumbnail ? ` poster="${escape(thumbnail.file)}"` : ''}><source src="${escape(manifest.video)}" type="video/mp4"></video><p>${manifest.duration}-second in-engine cinematic of all five games · Original score: Worlds Awaken</p><p><a href="${escape(manifest.video)}">Trailer MP4</a></p>` : '';
  const audio = manifest.audio ? `<h2>The original score</h2><audio controls src="${escape(manifest.audio.listening)}"></audio><p><a href="${escape(manifest.audio.music)}">48 kHz / 24-bit WAV</a></p>` : '';
  const picture = manifest.picture ? `<p><a href="${escape(manifest.picture)}">Picture partition IVF</a> · Full-edit timestamps retained for assembly</p>` : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Worlds · November 2026 release media</title><style>body{margin:0;background:#0b1423;color:#eaf1fb;font:16px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}.logo{background:#edf5ff;border-radius:14px;padding:18px;width:min(420px,80vw)}video{width:100%;border-radius:16px}audio{width:min(600px,100%)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0}figure img{width:100%;border-radius:12px}a{color:#f6c86c}</style><main><header><img class="logo" src="worlds-title-logo.svg" alt="Worlds"><h1>NOVEMBER 2026</h1></header>${video}${picture}${audio}${cards ? `<h2>Release screenshots</h2><div class="grid">${cards}</div>` : ''}</main></html>`;
}
export async function writeGallery(directory, manifest) {
  await writeFile(path.join(directory, 'index.html'), gallery(manifest));
}
export async function verifyGallery(directory) {
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  const links = [...html.matchAll(/(?:src|href|poster)="([^"]+)"/g)].map(m => m[1]);
  await requireFiles(directory, links);
  return links;
}
// The browser expands self-closing SVG elements and adds xmlns. Normalize
// those serialization differences, while comparing every tag/attribute/text.
export function canonicalLogo(markup) {
  const svg = /<svg\b[\s\S]*?<\/svg>/.exec(markup)?.[0];
  if (!svg) throw new Error('Missing logo SVG');
  return svg.replace(/<!--[\s\S]*?-->/g, '').replace(/\sxmlns="[^"]*"/g, '')
    .replace(/<([\w:-]+)([^>]*?)\s*\/>/g, '<$1$2></$1>')
    .replace(/<([\w:-]+)([^>]*)>/g, (_, tag, attrs) => {
      const pairs = [...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => `${m[1]}="${m[2]}"`).sort();
      return `<${tag}${pairs.length ? ` ${pairs.join(' ')}` : ''}>`;
    }).replace(/>\s+</g, '><').trim();
}
