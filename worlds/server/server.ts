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
import { LoginThrottle } from '../src/net/login_throttle';
import { writeAccountsAtomically } from './account_persistence';
import { staticClientPath } from './static_path';

const port = Number(process.env.PORT) || SERVER_PORT;
const sockets = new Map<number, WebSocket>();

// --- Accounts ----------------------------------------------------------------
// Worlds keeps its OWN account file; VOXELON's is never read or written.
const ACCOUNTS_FILE = path.join(process.cwd(), 'worlds-accounts.json');
const hasher = (pass: string, salt: string): string => crypto.scryptSync(pass, salt, 32).toString('hex');

function loadAccounts(): Accounts {
  try {
    const records: unknown = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Account store must be an array');
    return new Accounts(records);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Accounts();
    throw error;
  }
}
const accounts = loadAccounts();
let accountsDirty = false;
function saveAccounts(): boolean {
  try {
    writeAccountsAtomically(ACCOUNTS_FILE, JSON.stringify(accounts.toJSON(), null, 2));
    accountsDirty = false;
    return true;
  } catch (e) { console.error('failed to save accounts', e); return false; }
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
const loginFails = new LoginThrottle(6);
const socketAttempts = new LoginThrottle(20);

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
  const resolved = staticClientPath(DIST, req.url || '/');
  if (!resolved.ok) { res.writeHead(resolved.status); res.end(); return; }
  const { file: filePath, urlPath } = resolved;
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
  let id = game.connect();
  sockets.set(id, ws);
  socketIps.set(id, ip);
  ipCounts.set(ip, perIp + 1);

  ws.on('message', (data: unknown) => {
    const now = Date.now();
    if (!allowMessage(id, now)) { ws.close(1008, 'Message rate exceeded'); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'hello' && msg.resumeToken) {
      const resumed = game.resume(id, msg.resumeToken);
      if (resumed) {
        sockets.delete(id); socketIps.delete(id); msgBuckets.delete(id);
        id = resumed.id;
        sockets.set(id, ws); socketIps.set(id, ip);
        dispatch(resumed.out);
        return;
      }
    }
    if (msg.t === 'login') {
      const key = String(msg.username ?? '').trim().toLowerCase();
      const sk = String(id);
      const socketLock = socketAttempts.remaining(sk, now);
      socketAttempts.record(sk, now);
      const userLock = loginFails.remaining(key, now);
      if (socketLock > 0 || userLock > 0) {
        send(id, { t: 'authErr', error: `Too many attempts — wait ${Math.ceil(Math.max(socketLock, userLock) / 1000)}s.` });
        return;
      }
      const out = game.handle(id, msg);
      if (out.some((o) => o.to === id && o.msg.t === 'authErr')) loginFails.record(key, now);
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
  loginFails.sweep(Date.now());
  socketAttempts.sweep(Date.now());
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
  const saved = saveAccounts();
  if (saved) console.log('saved accounts on shutdown');
  process.exit(saved ? 0 : 1);
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
    } else if (cmd === 'save') { if (saveAccounts()) console.log('saved'); }
    else if (cmd === 'stop' || cmd === 'quit') shutdown();
    else if (cmd) console.log('commands: status, save, stop');
  });
}

httpServer.listen(port, () => {
  console.log(`Worlds server listening on :${port} (ws + static dist/)`);
});
