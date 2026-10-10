// Real transport regressions use unique, generated Worlds-only stores and assets.
// Run: node test/http_transport.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'node_modules/.tmp'), { recursive: true });
const directory = await mkdtemp(path.join(root, 'node_modules/.tmp/http-transport-'));
const bundle = path.join(directory, 'server.cjs');
await build({ absWorkingDir: root, entryPoints: ['server/server.ts'], bundle: true,
  platform: 'node', format: 'cjs', outfile: bundle, external: ['ws'], logLevel: 'error' });

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(err => err ? reject(err) : resolve()));
  return port;
}
async function fixture(name, accountText) {
  const cwd = path.join(directory, name);
  await mkdir(path.join(cwd, 'dist/assets'), { recursive: true });
  await writeFile(path.join(cwd, 'dist/index.html'), '<!doctype html><title>Fixture</title>');
  await writeFile(path.join(cwd, 'dist/assets/probe.js'), 'console.log("fixture");');
  if (accountText !== undefined) await writeFile(path.join(cwd, 'worlds-accounts.json'), accountText);
  const port = await freePort();
  const child = spawn(process.execPath, [bundle], { cwd, env: { ...process.env, PORT: String(port), TRUST_PROXY: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Transport did not start: ${output}`)), 15_000);
    const collect = bytes => {
      output += String(bytes);
      if (output.includes(`Worlds server listening on :${port}`)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    exited.then(({ code, signal }) => { clearTimeout(timer); reject(new Error(`Transport exited ${code ?? signal}: ${output}`)); });
  });
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try { return await exited; } finally { clearTimeout(timer); }
  }
  return { cwd, port, child, exited, ready, stop, output: () => output };
}
function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, headers }, response => {
      const chunks = [];
      response.on('data', data => chunks.push(data));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5_000, () => req.destroy(new Error('HTTP fixture request timed out')));
  });
}
function inbox(socket) {
  const messages = [], waiters = new Set();
  socket.on('message', data => {
    const message = JSON.parse(String(data)); messages.push(message);
    for (const wake of waiters) wake();
  });
  return predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(wake); reject(new Error('Socket fixture response timed out')); }, 5_000);
    function wake() {
      const index = messages.findIndex(predicate);
      if (index >= 0) { clearTimeout(timer); waiters.delete(wake); resolve(messages.splice(index, 1)[0]); }
    }
    waiters.add(wake); wake();
  });
}

const live = await fixture('valid');
const sockets = [];
try {
  await live.ready;
  assert.ok(live.output().includes(path.join(live.cwd, 'worlds-accounts.json')), 'launched server identifies its isolated store');
  const index = await request(live.port, '/');
  assert.equal(index.status, 200); assert.equal(index.headers['cache-control'], 'no-cache');
  assert.match(index.headers['content-type'], /text\/html/);
  assert.equal((await request(live.port, '/client/route')).body.toString(), index.body.toString(), 'SPA route falls back to the fixture index');
  const asset = await request(live.port, '/assets/probe.js', { 'accept-encoding': 'gzip' });
  assert.equal(asset.headers['content-encoding'], 'gzip');
  assert.equal(asset.headers.vary, 'accept-encoding');
  assert.match(asset.headers['content-type'], /javascript/);
  assert.match(asset.headers['cache-control'], /immutable/);
  assert.equal(gunzipSync(asset.body).toString(), 'console.log("fixture");');
  assert.equal((await request(live.port, '/bad%ZZ')).status, 400, 'bad percent-encoding is a request failure');
  const traversal = await request(live.port, '/%2e%2e%2fworlds-accounts.json');
  assert.ok(traversal.status === 403 || traversal.status === 404, 'encoded parent path cannot return outside-dist bytes');
  assert.equal((await request(live.port, '/')).status, 200, 'malformed requests do not kill the host');

  const socket = new WebSocket(`ws://127.0.0.1:${live.port}`); sockets.push(socket);
  const next = inbox(socket);
  await once(socket, 'open');
  socket.send('{invalid json'); socket.send(JSON.stringify({ t: 'hello' }));
  const welcome = await next(m => m.t === 'welcome');
  socket.send(JSON.stringify({ t: 'register', username: welcome.username, password: 'fixture-only-passphrase' }));
  const identity = await next(m => m.t === 'identity' && m.account);
  assert.equal(identity.username, welcome.username); assert.ok(identity.token.length >= 16);

  const large = new WebSocket(`ws://127.0.0.1:${live.port}`); sockets.push(large);
  large.on('error', () => {});
  await once(large, 'open');
  const closed = once(large, 'close'); large.send('x'.repeat(70 * 1024));
  assert.equal((await closed)[0], 1009, 'oversized frame is closed by the transport');
  assert.equal((await request(live.port, '/')).status, 200, 'frame refusal does not kill the host');
  const result = await live.stop(); assert.equal(result.code, 0, 'normal shutdown saves successfully');
  const saved = JSON.parse(await readFile(path.join(live.cwd, 'worlds-accounts.json'), 'utf8'));
  assert.equal(saved.length, 1); assert.equal(saved[0].username, welcome.username);
  assert.ok(saved[0].hash && saved[0].salt && saved[0].hash !== 'fixture-only-passphrase', 'only hashed credentials are persisted');
} finally {
  for (const socket of sockets) socket.terminate();
  await live.stop();
}

for (const [name, bytes] of [['corrupt-json', '{not json'], ['wrong-schema', '{"accounts":[]}']]) {
  const invalid = await fixture(name, bytes);
  try {
    await assert.rejects(invalid.ready, /Transport exited/, 'unreadable account content fails startup rather than creating an empty store');
    assert.notEqual((await invalid.exited).code, 0);
    assert.equal(await readFile(path.join(invalid.cwd, 'worlds-accounts.json'), 'utf8'), bytes, 'startup preserves the invalid store byte-for-byte');
  } finally { await invalid.stop(); }
}
console.log(`HTTP/WebSocket/persistence fixture regressions passed (${directory})`);
