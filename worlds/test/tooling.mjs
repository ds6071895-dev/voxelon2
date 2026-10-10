// Tool contracts exercised with disposable Worlds-local fixtures; no renderer,
// transport account store, FFmpeg encoding, cloud calls or publication needed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { root, browserSession, moduleSpecifier, selection, positiveInteger } from '../scripts/browser_session.mjs';
import { canonicalLogo, captureOptions, expectedFrames, gallery, requireFiles, verifyGallery, writeGallery } from '../scripts/release_tools.mjs';

const fixtureRoot = path.join(root, 'node_modules/.tmp');
await mkdir(fixtureRoot, { recursive: true });
const timeline = { width: 1920, height: 1080, fps: 30, duration: 3,
  shots: [{ id: 'a', start: 0, duration: 1 }, { id: 'b', start: 1, duration: 2 }], screenshots: [] };

test('capture rejects incompatible/empty/duplicate flags before browser startup', () => {
  for (const args of [['--stills-only', '--video-only'], ['--picture-only'], ['--shots=0'], ['--fps='], ['--fps=NaN'], ['--fps=0'], ['--width=1919'], ['--quality=unknown'], ['--video-only', '--picture-only', '--shots=0,0'], ['--video-only', '--picture-only', '--shots=1,0'], ['--video-only', '--picture-only', '--shots=0,'], ['--fps=30', '--fps=30'], ['--unknown']])
    assert.throws(() => captureOptions(args), undefined, args.join(' '));
  const partition = captureOptions(['--video-only', '--picture-only', '--shots=0,1']);
  assert.deepEqual(partition.selected, [0, 1]);
  assert.equal(expectedFrames(timeline, partition.selected), 90);
  assert.equal(expectedFrames({ ...timeline, selected: [1] }), 60);
  assert.throws(() => expectedFrames(timeline, [3]), /selection/);
  assert.throws(() => expectedFrames({ ...timeline, duration: 4 }), /timeline/);
  assert.throws(() => expectedFrames({ ...timeline, shots: [{ start: NaN, duration: 3 }] }), /timeline/);
  assert.throws(() => selection('MODES', '', ['bedwars']), /Invalid/);
  assert.throws(() => positiveInteger('port', '', 65535), /port/);
  assert.equal(moduleSpecifier(undefined), process.env.PLAYWRIGHT_MODULE ? moduleSpecifier(process.env.PLAYWRIGHT_MODULE) : 'playwright');
});

test('deliverable galleries contain only captured files, and fail missing/escaping links', async () => {
  const directory = await mkdtemp(path.join(fixtureRoot, 'gallery-contract-'));
  try {
    const manifest = { ...timeline, screenshots: [{ file: 'screenshots/a.png', shot: 0, time: .5, width: 16, height: 9 }] };
    await mkdir(path.join(directory, 'screenshots'));
    await writeFile(path.join(directory, 'screenshots/a.png'), 'fixture');
    await writeFile(path.join(directory, 'worlds-title-logo.svg'), '<svg/>');
    await writeGallery(directory, manifest);
    assert.deepEqual(new Set(await verifyGallery(directory)), new Set(['worlds-title-logo.svg', 'screenshots/a.png']));
    const stills = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.ok(!stills.includes('<video') && !stills.includes('<audio'));
    const video = gallery({ ...manifest, screenshots: [], video: 'video/master.mp4' });
    assert.ok(video.includes('<video') && !video.includes('poster=') && !video.includes('screenshots/'));
    await writeGallery(directory, { ...manifest, video: 'video/missing.mp4' });
    await assert.rejects(verifyGallery(directory), /Missing or empty/);
    await assert.rejects(requireFiles(directory, ['../outside.png']), /escapes/);
    await assert.rejects(requireFiles(directory, ['audio/effects.wav']), /Missing or empty/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('canonical logo checks the whole real lockup, ignoring DOM serialization differences', async () => {
  const title = await readFile(path.join(root, 'index.html'), 'utf8');
  const logo = title.slice(title.indexOf('class="w-wordmark"')).match(/<svg\b[\s\S]*?<\/svg>/)[0];
  const browserSerialization = logo.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/<([\w:-]+)([^>]*?)\s*\/>/g, '<$1$2></$1>');
  assert.equal(canonicalLogo(logo), canonicalLogo(browserSerialization));
  assert.notEqual(canonicalLogo(logo), canonicalLogo(logo.replace('M11 0V66Q11 89 34 89', 'M12 0V66Q11 89 34 89')));
  assert.notEqual(canonicalLogo(logo), canonicalLogo(logo.replace(/stroke="[^"]+"/, 'stroke="#f00"')));
});

test('failed browser launch closes the owned Vite listener', async () => {
  const directory = await mkdtemp(path.join(fixtureRoot, 'browser-contract-'));
  const previous = process.env.PLAYWRIGHT_MODULE;
  const testURL = process.env.TEST_URL;
  const reserve = net.createServer();
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  try {
    const fake = path.join(directory, 'playwright.mjs');
    await writeFile(fake, 'export const chromium = { async launch() { throw new Error("fixture launch failure"); } };');
    process.env.PLAYWRIGHT_MODULE = fake;
    delete process.env.TEST_URL;
    await assert.rejects(browserSession({ port }), /fixture launch failure/);
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_MODULE; else process.env.PLAYWRIGHT_MODULE = previous;
    if (testURL === undefined) delete process.env.TEST_URL; else process.env.TEST_URL = testURL;
    await rm(directory, { recursive: true, force: true });
  }
});
