// Worlds WebSocket transport: a thin shell wiring sockets to the pure
// GameServer (all real logic lives in src/net/server_core.ts). It also serves
// the built client from `dist/` on the same port, so one port hosts the game.
// Run with `npm run server` (default port 8090 — VOXELON keeps 8080).

import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as readline from 'readline';
import * as zlib from 'zlib';
import { SERVER_PORT, SNAPSHOT_HZ, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { GameServer, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';

const port = Number(process.env.PORT) || SERVER_PORT;
const sockets = new Map<number, WebSocket>();

// --- Accounts ----------------------------------------------------------------
// Worlds keeps its OWN account file; VOXELON's is never read or written.
const ACCOUNTS_FILE = path.join(process.cwd(), 'worlds-accounts.json');
const hasher = (pass: string, salt: string): string => crypto.scryptSync(pass, salt, 32).toString('hex');

function loadAccounts(): Accounts {
  try { return new Accounts(JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) as unknown[]); }
  catch { return new Accounts(); }
}
const accounts = loadAccounts();
let accountsDirty = false;
function saveAccounts(): void {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts.toJSON(), null, 2));
    accountsDirty = false;
  } catch (e) { console.error('failed to save accounts', e); }
}
console.log(`loaded ${accounts.size} account(s) from ${ACCOUNTS_FILE}`);

const game = new GameServer({
  accounts,
  hasher,
  salt: () => crypto.randomBytes(16).toString('hex'),
  token: () => crypto.randomBytes(24).toString('hex'),
});
game.onAccountsChanged = () => { accountsDirty = true; };

// --- Sign-in throttling ------------------------------------------------------
// Brute-force guard, per name and per socket.
const LOGIN_MAX_FAILS = 6;
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_LOCKOUT_MS = 60_000;
const SOCKET_MAX_ATTEMPTS = 20;
interface Throttle { fails: number; first: number; lockedUntil: number }
const loginFails = new Map<string, Throttle>();
const socketAttempts = new Map<string, Throttle>();
function throttleRemaining(bucket: Map<string, Throttle>, key: string, now: number): number {
  const t = bucket.get(key);
  if (!t) return 0;
  if (now >= t.lockedUntil && now - t.first > LOGIN_WINDOW_MS) { bucket.delete(key); return 0; }
  return Math.max(0, t.lockedUntil - now);
}
function recordFail(bucket: Map<string, Throttle>, key: string, max: number, now: number): void {
  let t = bucket.get(key);
  if (!t || now - t.first > LOGIN_WINDOW_MS) { t = { fails: 0, first: now, lockedUntil: 0 }; bucket.set(key, t); }
  t.fails++;
  if (t.fails >= max) t.lockedUntil = now + LOGIN_LOCKOUT_MS;
}

// --- Connection & flood limits -------------------------------------------------
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_SOCKETS = 2000;
const MAX_SOCKETS_PER_IP = 12;
const MSG_RATE_BURST = 240;
const MSG_RATE_PER_SEC = 120;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const socketIps = new Map<number, string>();
const ipCounts = new Map<string, number>();
function clientIp(req: http.IncomingMessage): string {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
interface RateBucket { tokens: number; last: number }
const msgBuckets = new Map<number, RateBucket>();
function allowMessage(id: number, now: number): boolean {
  let b = msgBuckets.get(id);
  if (!b) { b = { tokens: MSG_RATE_BURST, last: now }; msgBuckets.set(id, b); }
  b.tokens = Math.min(MSG_RATE_BURST, b.tokens + ((now - b.last) / 1000) * MSG_RATE_PER_SEC);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function send(id: number, msg: ServerMsg, volatile = false, json?: string): void {
  const ws = sockets.get(id);
  if (!ws || ws.readyState !== ws.OPEN) return;
  // A snapshot supersedes every older one: drop it rather than queue it
  // behind a slow connection.
  if (volatile && ws.bufferedAmount > 64 * 1024) return;
  ws.send(json ?? JSON.stringify(msg));
}
function dispatch(out: Outbound[]): void {
  // The core hands the same message object to every recipient of a broadcast
  // (snapshots, relayed transforms): serialise each one once, not per socket.
  let lastMsg: ServerMsg | null = null, lastJson = '';
  for (const o of out) {
    if (o.msg !== lastMsg) { lastMsg = o.msg; lastJson = JSON.stringify(o.msg); }
    send(o.to, o.msg, o.msg.t === 'snapshot', lastJson);
  }
}

// --- Static client hosting ------------------------------------------------------
const DIST = path.join(process.cwd(), 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(DIST, path.normalize(urlPath));
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); res.end('Client not built — run `npm run build` first.'); }
        else { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }); res.end(idx); }
      });
      return;
    }
    const ext = path.extname(filePath);
    const headers: Record<string, string> = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    };
    const encodings = String(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE.has(ext) && encodings.includes('gzip')) {
      zlib.gzip(data, (zipErr, compressed) => {
        if (zipErr) { res.writeHead(200, headers); res.end(data); return; }
        res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' });
        res.end(compressed);
      });
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

// No per-message deflate: nearly every frame is a tiny transform or snapshot,
// and ws runs (de)compression on libuv's shared threadpool, so each one queued
// behind the others and arrived later than it left. Browsers also compress
// EVERY outgoing frame once it is negotiated. The bytes saved were not worth
// the latency; the big one-off payloads are rare and small in absolute terms.
const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false, maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const ip = clientIp(req);
  const perIp = ipCounts.get(ip) ?? 0;
  if (sockets.size >= MAX_SOCKETS || perIp >= MAX_SOCKETS_PER_IP) {
    ws.on('error', () => { /* refused */ });
    ws.close(1013, 'Server busy');
    return;
  }
  const id = game.connect();
  sockets.set(id, ws);
  socketIps.set(id, ip);
  ipCounts.set(ip, perIp + 1);

  ws.on('message', (data: unknown) => {
    const now = Date.now();
    if (!allowMessage(id, now)) { ws.close(1008, 'Message rate exceeded'); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'login') {
      const key = String(msg.username ?? '').trim().toLowerCase();
      const sk = String(id);
      const socketLock = throttleRemaining(socketAttempts, sk, now);
      recordFail(socketAttempts, sk, SOCKET_MAX_ATTEMPTS, now);
      const userLock = throttleRemaining(loginFails, key, now);
      if (socketLock > 0 || userLock > 0) {
        send(id, { t: 'authErr', error: `Too many attempts — wait ${Math.ceil(Math.max(socketLock, userLock) / 1000)}s.` });
        return;
      }
      const out = game.handle(id, msg);
      if (out.some((o) => o.to === id && o.msg.t === 'authErr')) recordFail(loginFails, key, LOGIN_MAX_FAILS, now);
      else loginFails.delete(key);
      dispatch(out);
      return;
    }
    dispatch(game.handle(id, msg));
  });
  ws.on('close', () => {
    sockets.delete(id);
    socketAttempts.delete(String(id));
    msgBuckets.delete(id);
    const addr = socketIps.get(id);
    if (addr !== undefined) {
      const left = (ipCounts.get(addr) ?? 1) - 1;
      if (left > 0) ipCounts.set(addr, left); else ipCounts.delete(addr);
      socketIps.delete(id);
    }
    dispatch(game.disconnect(id));
    if (accountsDirty) saveAccounts();
  });
  ws.on('error', () => { /* close handler cleans up */ });
  (ws as WebSocket & { isAlive: boolean }).isAlive = true;
  ws.on('pong', () => { (ws as WebSocket & { isAlive: boolean }).isAlive = true; });
});

// Heartbeat: drop half-open connections.
setInterval(() => {
  for (const ws of sockets.values()) {
    const alive = ws as WebSocket & { isAlive: boolean };
    if (!alive.isAlive) { ws.terminate(); continue; }
    alive.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

// Simulation + snapshot tick.
let last = Date.now();
let slowTicks = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  dispatch(game.tick(dt));
  dispatch(game.snapshots());
  const spent = performance.now() - t0;
  if (spent > 40 && ++slowTicks % 20 === 1) {
    console.warn(`slow tick: ${spent.toFixed(1)} ms (${game.worldCount()} worlds, ${game.playerCount()} players)`);
  }
}, 1000 / SNAPSHOT_HZ);

// Persist accounts when something changed.
setInterval(() => { if (accountsDirty) saveAccounts(); }, 15000);

function shutdown(): void {
  saveAccounts();
  console.log('saved accounts on shutdown');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Operator console ----------------------------------------------------------
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'status') {
      console.log(`${game.playerCount()} players, ${game.worldCount()} worlds, ${game.botCount()} practice opponents, ` +
        `${game.parties.size} parties, ${accounts.size} accounts`);
    } else if (cmd === 'save') { saveAccounts(); console.log('saved'); }
    else if (cmd === 'stop' || cmd === 'quit') shutdown();
    else if (cmd) console.log('commands: status, save, stop');
  });
}

httpServer.listen(port, () => {
  console.log(`Worlds server listening on :${port} (ws + static dist/)`);
});
