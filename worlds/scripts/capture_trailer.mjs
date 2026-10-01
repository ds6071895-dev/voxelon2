// Reproducible release media: screenshots + an explicitly timed WebCodecs edit.
// Requires Playwright/Chromium and FFmpeg; they may live outside the project.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs FFMPEG=/path/to/ffmpeg npm run trailer
// Options: --stills-only --video-only --width=1920 --height=1080 --fps=30
//          --stills-width=3840 --quality=balanced --output=release-media
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile, open, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';
import { mixTrailer } from './mix_trailer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const value = (name, fallback) => [...args].find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const width = Number(value('width', '1920')), height = Number(value('height', '1080'));
const fps = Number(value('fps', '30')), stillWidth = Number(value('stills-width', '3840'));
const quality = value('quality', 'balanced');
const out = path.resolve(root, value('output', 'release-media'));
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
for (const [key, n] of Object.entries({ width, height, fps, stillWidth })) {
  if (!Number.isInteger(n) || n <= 0 || n > (key === 'fps' ? 60 : 8192)) throw new Error(`Invalid ${key}: ${n}`);
}
if (width % 2 || height % 2) throw new Error('Video dimensions must be even.');
const moduleURL = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright';
const { chromium } = await import(moduleURL);
await mkdir(path.join(out, 'screenshots'), { recursive: true });
await mkdir(path.join(out, 'video'), { recursive: true });
await mkdir(path.join(out, 'audio'), { recursive: true });

function run(command, argv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, argv, { cwd: root, stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
let server, browser, file;
const errors = [];
const manifest = { release: 'November 2026', logo: 'Exact SVG from title screen', music: 'Worlds Awaken — original composition', capture: 'Staged in-engine cinematic, using Worlds generators and models', width, height, fps, quality, screenshots: [] };
try {
  let base = process.env.TEST_URL;
  if (!base) {
    server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: Number(process.env.TRAILER_PORT ?? 5184), strictPort: true } });
    await server.listen();
    base = `http://127.0.0.1:${server.config.server.port}`;
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => { errors.push(e.message); console.error(e); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error(m.text()); } });
  await page.goto(`${base}/trailer.html?capture&width=${width}&height=${height}&quality=${encodeURIComponent(quality)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.error);
  const initError = await page.evaluate(() => document.body.dataset.error);
  if (initError) throw new Error(initError);
  await page.evaluate(() => window.__trailer.setExporting(true));
  const { shots, screenshots, duration, seed, logoSVG } = await page.evaluate(() => {
    const a = window.__trailer;
    return { shots: a.shots, screenshots: a.screenshots, duration: a.duration, seed: a.seed, logoSVG: a.logoSVG };
  });
  Object.assign(manifest, { duration, seed, shots });
  const selected = value('shots', '').split(',').filter(Boolean).map(Number);
  if (selected.some(i => !Number.isInteger(i) || !shots[i])) throw new Error('Invalid shot selection');
  const expectedFrames = (selected.length ? selected.reduce((n, i) => n + shots[i].duration, 0) : duration) * fps;
  await writeFile(path.join(out, 'worlds-title-logo.svg'), logoSVG);
  const savePNG = async (name, shot, time, branded = false, w = stillWidth, clean = true) => {
    const h = Math.round(w * 9 / 16);
    console.log(`Screenshot ${name} (${w} × ${h})`);
    const data = await page.evaluate(async ({ shot, time, branded, w, h, clean }) => {
      const a = window.__trailer;
      a.resize(w, h); await a.prepare(shot); a.render(time, clean, branded); a.validateRig();
      return a.canvas.toDataURL('image/png').split(',')[1];
    }, { shot, time, branded, w, h, clean });
    await writeFile(path.join(out, 'screenshots', `${name}.png`), Buffer.from(data, 'base64'));
    manifest.screenshots.push({ file: `screenshots/${name}.png`, width: w, height: h, shot, time, branded });
  };
  if (!args.has('--video-only')) {
    for (const s of screenshots) await savePNG(s.name, s.shot, s.time);
    await savePNG('09-worlds-release-hero', 0, 4, true);
    await savePNG('10-parkour-release-hero', 7, 3, true);
    await savePNG('11-trailer-thumbnail', 7, 3, true, 1280);
    await savePNG('12-release-end-card', 15, 4, false, 1920, false);
    await savePNG('13-void-cape-teaser', 16, 5, false, 1920, false);
  }
  if (!args.has('--stills-only')) {
    const config = { codec: 'vp09.00.40.08', width, height, bitrate: 12_000_000, framerate: fps, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' };
    const supported = await page.evaluate(async config => typeof VideoEncoder !== 'undefined' && (await VideoEncoder.isConfigSupported(config)).supported, config);
    if (!supported) throw new Error('Chromium does not support VP9 WebCodecs encoding. Use a current Playwright Chromium build.');
    const ivfPath = path.join(out, 'video', 'worlds-release-picture.ivf');
    file = await open(ivfPath, 'w');
    const header = Buffer.alloc(32);
    header.write('DKIF'); header.writeUInt16LE(0, 4); header.writeUInt16LE(32, 6); header.write('VP90', 8);
    header.writeUInt16LE(width, 12); header.writeUInt16LE(height, 14);
    header.writeUInt32LE(fps, 16); header.writeUInt32LE(1, 20); header.writeUInt32LE(expectedFrames, 24);
    await file.write(header);
    let frameCount = 0;
    // Serialize writes so asynchronous encoder callbacks cannot reorder frames.
    let chain = Promise.resolve();
    await page.exposeFunction('saveTrailerChunk', (base64, timestamp) => {
      chain = chain.then(async () => {
        const bytes = Buffer.from(base64, 'base64'), frame = Buffer.alloc(12);
        frame.writeUInt32LE(bytes.length, 0); frame.writeBigUInt64LE(BigInt(Math.round(timestamp * fps / 1_000_000)), 4);
        await file.write(frame); await file.write(bytes); frameCount++;
      });
      return chain;
    });
    await page.evaluate(({ width, height }) => window.__trailer.resize(width, height), { width, height });
    for (let index = 0; index < shots.length; index++) {
      if (selected.length && !selected.includes(index)) continue;
      const s = shots[index];
      console.log(`Rendering ${s.id}: ${s.duration * fps} frames`);
      const start = Date.now();
      await page.evaluate(async ({ index, config, fps }) => {
        const a = window.__trailer;
        await a.prepare(index);
        const s = a.shots[index], saves = [];
        let encoderError;
        const encoder = new VideoEncoder({
          output(chunk) {
            const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            saves.push(window.saveTrailerChunk(btoa(binary), chunk.timestamp));
          },
          error(error) { encoderError = error.message; },
        });
        encoder.configure(config);
        try {
          for (let n = 0; n < Math.round(s.duration * fps); n++) {
            a.render(n / fps);
            if (n % 15 === 0) a.validateRig();
            const frame = new VideoFrame(a.canvas, { timestamp: Math.round((s.start + n / fps) * 1_000_000), duration: Math.round(1_000_000 / fps) });
            encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 }); frame.close();
            if (n % 15 === 14) {
              await encoder.flush(); await Promise.all(saves.splice(0));
              if (encoderError) throw new Error(encoderError);
            }
          }
          await encoder.flush(); await Promise.all(saves);
          if (encoderError) throw new Error(encoderError);
        } finally { encoder.close(); }
      }, { index, config, fps });
      console.log(`  ${((Date.now() - start) / 1000).toFixed(1)}s elapsed; ${frameCount} frames saved`);
    }
    await chain;
    if (frameCount !== expectedFrames) throw new Error(`Missing frames: ${frameCount}/${expectedFrames}`);
    await file.close(); file = undefined;
    if (args.has('--picture-only')) {
      await writeFile(path.join(out, 'picture-manifest.json'), JSON.stringify({ ...manifest, frameCount, selected }, null, 2));
      console.log(`Picture partition ready: ${out}`);
      process.exitCode = 0;
      // finally still closes browser and Vite; no audio or local masters needed.
    } else {
    const music = path.join(out, 'audio', 'worlds-awaken.wav');
    if (!await stat(music).catch(() => null)) await run(process.execPath, ['scripts/compose_trailer.mjs', path.join(out, 'audio')]);
    const loudness = await mixTrailer(path.join(out, 'audio'), ffmpeg);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-i', ivfPath, '-i', path.join(out, 'audio', 'trailer-final-mix.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', String(duration), '-movflags', '+faststart', '-metadata', 'title=Worlds — November 2026 Release Trailer', '-metadata', 'comment=Original score: Worlds Awaken. Staged in-engine cinematic.', path.join(out, 'video', 'worlds-november-2026-trailer.mp4')]);
    Object.assign(manifest, { frameCount, loudness, video: 'video/worlds-november-2026-trailer.mp4' });
    }
  }
  if (errors.length) throw new Error(`Browser errors during capture: ${errors.join('\n')}`);
  await writeFile(path.join(out, args.has('--stills-only') ? 'screenshots-manifest.json' : 'manifest.json'), JSON.stringify(manifest, null, 2));
  const cards = screenshots.map(s => `<figure><a href="screenshots/${s.name}.png"><img src="screenshots/${s.name}.png" alt="${s.name.replace(/^\d+-/, '').replaceAll('-', ' ')}" loading="lazy"></a><figcaption>${s.name.replace(/^\d+-/, '').replaceAll('-', ' ')}</figcaption></figure>`).join('\n');
  await writeFile(path.join(out, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Worlds · November 2026 release media</title>
<style>body{margin:0;background:#0b1423;color:#eaf1fb;font:16px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;margin-bottom:28px}.logo{background:#edf5ff;border-radius:14px;padding:18px 22px;width:min(420px,80vw)}.logo img{width:100%;display:block}h1{font-size:22px;letter-spacing:2px}h2{margin-top:40px}p,figcaption{color:#aabed7}video{width:100%;border-radius:16px;background:#000}audio{width:min(600px,100%)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0}figure img{width:100%;display:block;border-radius:12px}figcaption{text-transform:capitalize;margin-top:8px}a{color:#f6c86c}</style>
<main><header><div class="logo"><img src="worlds-title-logo.svg" alt="Worlds"></div><h1>NOVEMBER 2026</h1></header>
<video controls preload="metadata" poster="screenshots/11-trailer-thumbnail.png"><source src="video/worlds-november-2026-trailer.mp4" type="video/mp4"></video>
<p>${duration}-second in-engine cinematic · Original score: Worlds Awaken</p>
<h2>The original score</h2><audio controls preload="metadata" src="audio/worlds-awaken.m4a"></audio><p><a href="audio/worlds-awaken.wav">48 kHz / 24-bit WAV</a> · <a href="video/worlds-november-2026-trailer.mp4">Trailer MP4</a></p>
<h2>Release screenshots</h2><div class="grid">${cards}</div>
<h2>Hero images</h2><div class="grid"><figure><a href="screenshots/09-worlds-release-hero.png"><img src="screenshots/09-worlds-release-hero.png" alt="Worlds release hero"></a></figure><figure><a href="screenshots/10-parkour-release-hero.png"><img src="screenshots/10-parkour-release-hero.png" alt="Parkour release hero"></a></figure></div><h2>Early access</h2><p>Starting within the next few days. Participate in early access to get the Void Cape. After early access, it will NEVER be obtainable again. EVER.</p><img src="screenshots/13-void-cape-teaser.png" alt="Heavily blurred black Void Cape teaser" style="width:100%;border-radius:12px"></main></html>`);
  console.log(`Release media ready: ${out}`);
} finally {
  if (file) await file.close();
  if (browser) await browser.close();
  if (server) await server.close();
}
