// Shared browser ownership for offline captures and externally hosted tests.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function moduleSpecifier(value = process.env.PLAYWRIGHT_MODULE) {
  if (!value) return 'playwright';
  if (value.startsWith('file:')) return value;
  return pathToFileURL(path.resolve(value)).href;
}
export function positiveInteger(name, value, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!String(value).trim() || !Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`${name} must be an integer from 1 to ${max}; received ${JSON.stringify(value)}`);
  return n;
}
export function selection(name, value, allowed) {
  const values = value.split(',').map(s => s.trim());
  if (!values.length || values.some(s => !s || !allowed.includes(s)) || new Set(values).size !== values.length)
    throw new Error(`Invalid ${name}: ${JSON.stringify(value)}. Choose distinct values from ${allowed.join(', ')}.`);
  return values;
}
export async function artifactDirectory(name, value = process.env.ARTIFACTS) {
  const directory = path.resolve(root, value ?? `node_modules/.tmp/browser-check/${name}`);
  if (!directory.startsWith(`${root}${path.sep}`)) throw new Error('ARTIFACTS must be inside Worlds');
  await mkdir(directory, { recursive: true });
  return directory;
}
export function observeErrors(page, errors, label = '') {
  page.on('pageerror', e => errors.push(`${label}${e.stack ?? e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const location = m.location();
    errors.push(`${label}console: ${m.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ''}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${label}HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('requestfailed', request => errors.push(`${label}request failed: ${request.url()} — ${request.failure()?.errorText ?? 'unknown error'}`));
}
export function assertBrowserErrors(errors) {
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
}
export async function browserSession({ port, base = process.env.TEST_URL, capture = false } = {}) {
  let browser, server;
  const close = async () => {
    try { await browser?.close(); } finally { await server?.close(); }
  };
  try {
    if (!base && port !== undefined) {
      const { createServer } = await import('vite');
      server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: {
        host: '127.0.0.1', port: positiveInteger('capture port', port, 65535), strictPort: true,
      } });
      await server.listen();
      base = `http://127.0.0.1:${server.config.server.port}`;
    }
    const { chromium } = await import(moduleSpecifier());
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
        ...(capture ? ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] : [])],
    });
    return { browser, base: base?.replace(/\/$/, ''), close };
  } catch (error) { await close(); throw error; }
}
