// Reproducible release media: screenshots + an explicitly timed WebCodecs edit.
// Requires Playwright/Chromium and FFmpeg; they may live outside the project.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs FFMPEG=/path/to/ffmpeg npm run trailer
// Options: --stills-only --video-only --width=1920 --height=1080 --fps=30
//          --stills-width=3840 --quality=balanced --output=release-media/revised
import { mkdir, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { browserSession, observeErrors, assertBrowserErrors } from './browser_session.mjs';
import { captureOptions, expectedFrames as frameExpectation, writeGallery } from './release_tools.mjs';
import { finishTrailer } from './finish_trailer.mjs';

const options = captureOptions(process.argv.slice(2));
const { width, height, fps, stillWidth, quality, out, selected } = options;
const args = new Set(Object.keys(options).filter(key => options[key] === true).map(key => `--${key}`));
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
await mkdir(path.join(out, 'screenshots'), { recursive: true });
await mkdir(path.join(out, 'video'), { recursive: true });
await mkdir(path.join(out, 'audio'), { recursive: true });

let session, file;
const errors = [];
const manifest = { release: 'November 2026', logo: 'Exact SVG from title screen', music: 'Worlds Awaken — original composition', capture: 'Staged in-engine cinematic, using Worlds generators and models', width, height, fps, quality, screenshots: [] };
try {
  session = await browserSession({ port: process.env.TRAILER_PORT ?? 5184, capture: true });
  const { browser, base } = session;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(240000);
  observeErrors(page, errors);
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
  const expectedFrames = frameExpectation(manifest, selected);
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
      Object.assign(manifest, { frameCount, selected, picture: 'video/worlds-release-picture.ivf' });
      console.log(`Picture partition ready: ${out}`);
      process.exitCode = 0;
      // finally still closes browser and Vite; no audio or local masters needed.
    } else {
    manifest.frameCount = frameCount;
    assertBrowserErrors(errors);
    await finishTrailer(out, manifest, ffmpeg);
    }
  }
  assertBrowserErrors(errors);
  const manifestFile = args.has('--stills-only') ? 'screenshots-manifest.json' : args.has('--picture-only') ? 'picture-manifest.json' : 'manifest.json';
  await writeFile(path.join(out, manifestFile), JSON.stringify(manifest, null, 2));
  await writeGallery(out, manifest);
  console.log(`Release media ready: ${out}`);
} finally {
  try { if (file) await file.close(); } finally { await session?.close(); }
}
