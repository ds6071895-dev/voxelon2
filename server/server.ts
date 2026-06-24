// VOXELON WebSocket transport: a thin shell that wires ws sockets to the
// pure GameServer (all the real logic lives in src/net/server_core.ts).
// Run with `npm run server`.

import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ClientMsg, SERVER_PORT, SNAPSHOT_HZ, ServerMsg } from '../src/net/protocol';
import { GameServer, Outbound, WorldSave } from '../src/net/server_core';
import { Accounts, Account } from '../src/net/accounts';

const port = Number(process.env.PORT) || SERVER_PORT;
const sockets = new Map<number, WebSocket>();
// Sockets that have authenticated (id -> username); only these have a player.
const authed = new Map<number, string>();
let nextId = 1;

// --- Accounts (mandatory login) --------------------------------------------
// Passwords are hashed with Node's built-in scrypt (salted, no new deps), and
// the account list is persisted to a JSON file beside the server.
const ACCOUNTS_FILE = path.join(process.cwd(), 'voxelon-accounts.json');
const hasher = (pass: string, salt: string): string =>
  crypto.scryptSync(pass, salt, 32).toString('hex');
const randomSalt = (): string => crypto.randomBytes(16).toString('hex');

function loadAccounts(): Accounts {
  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    return new Accounts(JSON.parse(raw) as Account[]);
  } catch {
    return new Accounts();
  }
}
const accounts = loadAccounts();
function saveAccounts(): void {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts.toJSON(), null, 2));
  } catch (e) { console.error('failed to save accounts', e); }
}
console.log(`loaded ${accounts.size} account(s) from ${ACCOUNTS_FILE}`);

// --- World persistence ------------------------------------------------------
// The whole authoritative world (edits, claims, machines, chests, ships,
// turrets) is serialized to a JSON file and reloaded on boot, so a restart
// doesn't wipe everyone's builds. Autosaved on a timer + on shutdown.
const WORLD_FILE = path.join(process.cwd(), 'voxelon-world.json');
function loadWorld(): WorldSave | null {
  try { return JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8')) as WorldSave; }
  catch { return null; }
}
const savedWorld = loadWorld();
// Boot on the saved seed so restored edits line up with their terrain.
const game = new GameServer(savedWorld && Number.isFinite(savedWorld.seed) ? savedWorld.seed : undefined);
if (savedWorld && game.restore(savedWorld)) {
  console.log(`restored world from ${WORLD_FILE}`);
}
let worldDirty = false;
function saveWorld(): void {
  try {
    fs.writeFileSync(WORLD_FILE, JSON.stringify(game.serialize()));
    worldDirty = false;
  } catch (e) { console.error('failed to save world', e); }
}

/** Persist a player's current state (inventory/hotbar + position) to their
 *  account. Called on saveState pushes and on disconnect. */
function persistPlayer(id: number): void {
  const username = authed.get(id);
  if (!username) return;
  const cap = game.capturePlayerState(id);
  if (cap) { accounts.setData(cap.username, cap.data); worldDirty = true; }
}

/** Authenticate a connecting socket (register or login). On success the socket
 *  gets a player with its account's persisted faction; on failure an authErr. */
function handleAuth(id: number, msg: ClientMsg & { t: 'register' | 'login' }): void {
  const { username, password } = msg;
  const res = msg.t === 'register'
    ? accounts.register(username, password, hasher, randomSalt())
    : accounts.login(username, password, hasher);
  if (msg.t === 'register' && res.ok) saveAccounts();
  if (!res.ok || !res.account) {
    send(id, { t: 'authErr', error: res.error ?? 'Authentication failed' });
    return;
  }
  if (game.usernameOnline(res.account.username)) {
    send(id, { t: 'authErr', error: 'That account is already online' });
    return;
  }
  authed.set(id, res.account.username);
  dispatch(game.addPlayer(id, {
    username: res.account.username, faction: res.account.faction, data: res.account.data,
  }));
  console.log(`+ ${res.account.username} authed (${game.playerCount} online)`);
}

function send(id: number, msg: ServerMsg): void {
  const ws = sockets.get(id);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function dispatch(out: Outbound[]): void {
  for (const o of out) {
    if (o.to === 'all') {
      for (const cid of sockets.keys()) send(cid, o.msg);
    } else if (o.to === 'others') {
      for (const cid of sockets.keys()) if (cid !== o.from) send(cid, o.msg);
    } else {
      send(o.to, o.msg);
    }
  }
}

const wss = new WebSocketServer({ port });

wss.on('connection', (ws: WebSocket) => {
  const id = nextId++;
  sockets.set(id, ws);
  // No player yet — the socket must authenticate (register/login) first.

  ws.on('message', (data: unknown) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!authed.has(id)) {
      // Unauthenticated: the ONLY accepted messages are register/login.
      if (msg.t === 'register' || msg.t === 'login') handleAuth(id, msg);
      return;
    }
    dispatch(game.handle(id, msg));
    // A pushed state blob is persisted to the account right away (cheap, and
    // means an unclean disconnect still keeps the last save). Any non-transform
    // message can mutate the world, so flag it for the next autosave.
    if (msg.t === 'saveState') persistPlayer(id);
    else if (msg.t !== 'xform') worldDirty = true;
  });
  ws.on('close', () => {
    sockets.delete(id);
    if (authed.has(id)) {
      persistPlayer(id);          // capture final inventory + position
      authed.delete(id);
      saveAccounts();             // flush the just-updated account state
      dispatch(game.removePlayer(id));
      console.log(`- player left (${game.playerCount} online)`);
    }
  });
  ws.on('error', () => { /* ignore; close handler cleans up */ });
  (ws as WebSocket & { isAlive: boolean }).isAlive = true;
  ws.on('pong', () => { (ws as WebSocket & { isAlive: boolean }).isAlive = true; });
});

// Heartbeat: drop half-open connections so their player state doesn't leak.
setInterval(() => {
  for (const ws of sockets.values()) {
    const alive = ws as WebSocket & { isAlive: boolean };
    if (!alive.isAlive) { ws.terminate(); continue; } // triggers close cleanup
    alive.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

// Periodic snapshot + regeneration tick.
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  game.tickRegen(dt);
  game.tickMachines(dt);
  const moved = game.tickItems(dt);
  const shipXf = game.tickShips(dt);
  dispatch(game.tickTurrets(dt));
  dispatch(game.tickTerritory(dt));
  dispatch(game.tickClaims(dt));
  const snap: ServerMsg = { t: 'snapshot', players: game.snapshot() };
  for (const cid of sockets.keys()) send(cid, snap);
  if (moved.length) {
    const mv: ServerMsg = { t: 'itemsmove', items: moved };
    for (const cid of sockets.keys()) send(cid, mv);
  }
  if (shipXf.length) {
    const sx: ServerMsg = { t: 'shipTransforms', ships: shipXf };
    for (const cid of sockets.keys()) send(cid, sx);
  }
}, 1000 / SNAPSHOT_HZ);

// Autosave the world + accounts on a timer (only when something changed).
const AUTOSAVE_MS = 60000;
setInterval(() => {
  if (!worldDirty) return;
  for (const id of authed.keys()) persistPlayer(id); // checkpoint live players too
  saveWorld();
  saveAccounts();
  console.log('world autosaved');
}, AUTOSAVE_MS);

// Flush everything on a clean shutdown so nothing built right before exit is lost.
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const id of authed.keys()) persistPlayer(id);
  saveWorld();
  saveAccounts();
  console.log('saved world + accounts on shutdown');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`VOXELON server listening on ws://localhost:${port} (seed ${game.seed})`);
