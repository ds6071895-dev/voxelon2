// VOXELON WebSocket transport: a thin shell that wires ws sockets to the
// pure GameServer (all the real logic lives in src/net/server_core.ts).
// Run with `npm run server`.

import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as readline from 'readline';
import { ClientMsg, GameMode, SERVER_PORT, SNAPSHOT_HZ, ServerMsg } from '../src/net/protocol';
import { GameServer, Outbound, WorldSave } from '../src/net/server_core';
import { Accounts, Account } from '../src/net/accounts';
import { WARFARE_TREE, sanitizeWarfare, warfareAvailable } from '../src/warfare';
import { ITEMS, Item } from '../src/items';
import {
  COMEBACK_HEARTS, ELIMINATION_MS, PERMANENT_UNTIL, formatRemaining,
  isPermanentElimination,
} from '../src/hearts';

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
// The whole authoritative world (edits, machines, chests, turrets, war score)
// is serialized to a JSON file and reloaded on boot, so a restart doesn't wipe
// everyone's builds. Autosaved on a timer + on shutdown.
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
// When a season ends, persist the "Seasons Won" badge to every winning account
// (including offline members) and notify whoever's online (Phase 5).
game.onSeasonEnd = (winner, season) => {
  if (winner < 0) { console.log(`season ${season} ended in a stalemate`); return; }
  const won = accounts.awardSeasonWin(winner, season); // defectors this season are skipped
  saveAccounts();
  worldDirty = true;
  console.log(`season ${season} won by faction ${winner}; awarded ${won.length} badge(s)`);
};
// Persist a secret faction switch to the account (new side + switch counters).
game.onFactionSwitch = (username, faction, switchesUsed, switchSeason, forfeitSeason) => {
  accounts.applySwitch(username, faction, switchesUsed, switchSeason, forfeitSeason);
  saveAccounts();
  worldDirty = true;
};
// WARFARE COMMAND: persist a player's technology to the ACCOUNT record (not the
// opaque client state blob), so a routine state save can never mint or wipe it.
game.onWarfareChange = (username, progress) => {
  const a = accounts.get(username);
  if (!a) return;
  a.warfare = progress;
  saveAccounts();
};

game.onDuelSettlement = (changes) => {
  if (!accounts.applyDuelSettlement(changes)) throw new Error('Duels settlement referenced an unknown account');
  saveAccounts();
  const profiles: Record<string, ReturnType<typeof accounts.duelProfile>> = {};
  for (const change of changes) {
    profiles[change.username.toLowerCase()] = accounts.duelProfile(change.username);
  }
  return { leaderboard: accounts.duelLeaderboard(10), profiles };
};
game.onDuelFlair = (username, flair) => {
  const profile = accounts.equipDuelFlair(username, flair);
  if (!profile) return null;
  saveAccounts();
  return { profile, leaderboard: accounts.duelLeaderboard(10) };
};
// Lifesteal elimination (Milestone A): record the 24h wall-clock lockout on the
// account (login is refused until it expires) and boot the victim shortly after
// so their full-screen banner has time to deliver. Comeback hearts are written
// now so no later state capture can resurrect the pre-elimination count.
game.onEliminate = (username, by, permanent) => {
  // Permanent when the victim's faction holds no flag — that's the whole point
  // of the flag: it's the only thing that buys anyone a second life.
  const until = permanent ? PERMANENT_UNTIL : Date.now() + ELIMINATION_MS;
  accounts.eliminate(username, until, COMEBACK_HEARTS);
  saveAccounts();
  console.log(`[KILL] ${username} was ELIMINATED by ${by} ` +
    `(${permanent ? 'PERMANENTLY — their faction has no flag' : 'locked out 24h'})`);
  const pid = game.playerIdByName(username);
  if (pid !== undefined) {
    setTimeout(() => {
      try { sockets.get(pid)?.close(); } catch { /* close handler cleans up */ }
    }, 1500);
  }
  return until;
};
// Revival Beacon: eliminated faction-mates + the actual revive (faction-gated).
game.listEliminated = (faction) => accounts.eliminatedOf(faction, Date.now());
game.onRevive = (target, faction, by) => {
  const a = accounts.get(target);
  if (!a || a.faction !== faction) return false; // faction-mates only
  const ok = accounts.clearElimination(target, Date.now(), by);
  if (ok) { saveAccounts(); console.log(`[REVIVE] ${by} revived ${target}`); }
  return ok;
};
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

// --- Login throttling -------------------------------------------------------
// Brute-force guard. Behind a tunnel every socket shares one source IP, so we
// throttle by USERNAME (each account gets its own budget) AND by socket (one
// connection can't grind through a username list). After LOGIN_MAX_FAILS bad
// attempts inside LOGIN_WINDOW_MS the key is locked for LOGIN_LOCKOUT_MS; a
// successful login clears the username's counter.
const LOGIN_MAX_FAILS = 6;           // failed attempts before a lockout
const LOGIN_WINDOW_MS = 5 * 60_000;  // stale failures outside this window reset
const LOGIN_LOCKOUT_MS = 60_000;     // lock duration once the cap is hit
const SOCKET_MAX_ATTEMPTS = 20;      // total auth attempts allowed per socket/window
interface Throttle { fails: number; first: number; lockedUntil: number; }
const loginFails = new Map<string, Throttle>();      // keyed by username
const socketAttempts = new Map<string, Throttle>();  // keyed by String(socket id)

const throttleKey = (username: string): string => username.trim().toLowerCase();

/** Remaining lockout for `key` in `bucket` (ms; 0 = clear), pruning stale rows. */
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

/** Authenticate a connecting socket (register or login). On success the socket
 *  gets a player with its account's persisted faction; on failure an authErr. */
function handleAuth(id: number, msg: ClientMsg & { t: 'register' | 'login' | 'session' }): void {
  const { username } = msg;
  const now = Date.now();
  const sk = String(id);
  // Per-socket cap: a single connection can't hammer the auth path. Every
  // attempt counts (right or wrong) so a username-list grind trips it fast.
  const socketLock = throttleRemaining(socketAttempts, sk, now);
  recordFail(socketAttempts, sk, SOCKET_MAX_ATTEMPTS, now);
  if (socketLock > 0) {
    send(id, { t: 'authErr', error: `Too many attempts — wait ${Math.ceil(socketLock / 1000)}s.` });
    return;
  }
  // Per-username lockout (survives reconnects; works behind a shared-IP tunnel).
  const userLock = throttleRemaining(loginFails, throttleKey(username), now);
  if (userLock > 0) {
    send(id, { t: 'authErr', error: `Account locked — try again in ${Math.ceil(userLock / 1000)}s.` });
    return;
  }
  const res = msg.t === 'register'
    ? accounts.register(username, msg.password, hasher, randomSalt(), msg.faction)
    : msg.t === 'login'
      ? accounts.login(username, msg.password, hasher)
      : accounts.sessionLogin(username, msg.token);
  if (!res.ok || !res.account) {
    // Count failed logins AND session resumes toward the lockout (both are
    // secret guesses; a failed register is just a name clash).
    if (msg.t !== 'register') recordFail(loginFails, throttleKey(username), LOGIN_MAX_FAILS, now);
    send(id, { t: 'authErr', error: res.error ?? 'Authentication failed' });
    return;
  }
  loginFails.delete(throttleKey(res.account.username)); // success clears the counter
  socketAttempts.delete(sk);
  if (game.usernameOnline(res.account.username)) {
    // Same account reconnecting — usually a browser that was closed and
    // reopened before its old socket timed out. The newest login wins: kick
    // the ghost (persisting its state) so the returning player is never
    // locked out of their own account.
    let ghost = -1;
    for (const [cid, name] of authed) {
      if (name === res.account.username) { ghost = cid; break; }
    }
    if (ghost < 0) { // shouldn't happen, but never let auth wedge
      send(id, { t: 'authErr', error: 'That account is already online' });
      return;
    }
    persistPlayer(ghost);
    authed.delete(ghost);
    dispatch(game.removePlayer(ghost));
    const gws = sockets.get(ghost);
    sockets.delete(ghost);
    try { gws?.terminate(); } catch { /* already gone */ }
    console.log(`~ ${res.account.username} reconnected — ghost session replaced`);
  }
  // Lifesteal elimination: the credentials may be right, but an eliminated
  // account can't play until the 24h lockout expires (or a teammate revives
  // them). Friendly countdown, not a generic error.
  const lockMs = accounts.eliminationRemaining(res.account.username, Date.now());
  if (lockMs > 0) {
    const forever = isPermanentElimination(accounts.get(res.account.username)?.eliminatedUntil);
    send(id, {
      t: 'authErr',
      error: forever
        ? 'Eliminated FOREVER — your faction had no flag when you fell.'
        : `Eliminated — back in ${formatRemaining(lockMs)}`,
      lockMs, permanent: forever,
    });
    return;
  }
  accounts.clearElimination(res.account.username, Date.now()); // clear a stale/expired stamp
  const revivedBy = accounts.popRevivedBy(res.account.username);
  if (revivedBy) saveAccounts(); // the one-shot notice must not replay next login
  authed.set(id, res.account.username);
  dispatch(game.addPlayer(id, {
    username: res.account.username, faction: res.account.faction,
    seasonsWon: res.account.seasonsWon, switchesUsed: res.account.switchesUsed,
    switchSeason: res.account.switchSeason, forfeitSeason: res.account.forfeitSeason,
    data: res.account.data,
    warfare: accounts.warfareOf(res.account.username),
    duelProgress: accounts.duelProgressOf(res.account.username),
    duelLeaderboard: accounts.duelLeaderboard(10),
  }));
  // Issue (rotate) a session token so this browser can resume without the
  // password next visit — persisted on the account, mirrored in localStorage.
  const token = crypto.randomBytes(24).toString('hex');
  accounts.setToken(res.account.username, token);
  saveAccounts();
  send(id, { t: 'session', token });
  // Operator status drives which commands their command box offers (the
  // server still re-checks it on every command it actually receives).
  send(id, { t: 'op', op: accounts.isOp(res.account.username) });
  if (revivedBy) {
    send(id, { t: 'notice', text: `${revivedBy} revived you — welcome back at ${COMEBACK_HEARTS} hearts!` });
  }
  console.log(`+ ${res.account.username} authed (${game.playerCount} online)`);
}

function send(id: number, msg: ServerMsg): void {
  const ws = sockets.get(id);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function dispatch(out: Outbound[]): void {
  for (const o of out) {
    if (o.to === 'all') {
      for (const cid of sockets.keys()) if (game.receivesWorldBroadcast(cid)) send(cid, o.msg);
    } else if (o.to === 'others') {
      for (const cid of sockets.keys()) {
        if (cid !== o.from && game.receivesWorldBroadcast(cid)) send(cid, o.msg);
      }
    } else {
      send(o.to, o.msg);
    }
  }
}

// --- Static client hosting --------------------------------------------------
// We serve the built client (`dist/`, made by `npm run build`) from the SAME
// HTTP server the WebSocket attaches to, so the whole game lives on ONE port.
// That makes a single `cloudflared tunnel --url http://localhost:8080` (or any
// reverse proxy) expose both the page and the realtime socket — no second port,
// no mixed-content. In dev you still run Vite (5173) + this server (8080)
// separately; the client auto-detects which case it's in (see client.ts).
const DIST = path.join(process.cwd(), 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // Resolve inside DIST only (no path traversal out of the build dir).
  const filePath = path.join(DIST, path.normalize(urlPath));
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fall back to index.html so refreshes work; a clear hint if not built.
      fs.readFile(path.join(DIST, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); res.end('Client not built — run `npm run build` first.'); }
        else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(idx); }
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server: httpServer });

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
      // The invite preview is read-only, rate-free metadata for the exact
      // private token in the URL; every state-changing action still needs auth.
      if (msg.t === 'duelInviteInfo') {
        const info = game.duelInviteInfo(msg.token);
        send(id, { t: 'duelInviteInfo', valid: !!info, host: info?.host, lobbyId: info?.lobbyId });
      } else if (msg.t === 'register' || msg.t === 'login' || msg.t === 'session') handleAuth(id, msg);
      return;
    }
    // Operator commands typed into the in-game command box. Handled HERE, not
    // in the pure GameServer, because they reach accounts/persistence/shutdown.
    // Authorised per line against the account record — never against anything
    // the client told us — so a forged `command` from a normal player is just
    // a refusal.
    if (msg.t === 'command') {
      const who = authed.get(id)!;
      if (!accounts.isOp(who)) {
        send(id, { t: 'cmdOut', lines: ['You are not a server operator.'], ok: false });
        console.log(`! ${who} tried to run "${String(msg.text).slice(0, 80)}" without OP`);
        return;
      }
      const lines: string[] = [];
      runCommand(String(msg.text ?? '').slice(0, 300), (text) => {
        for (const part of String(text).split('\n')) lines.push(part);
      }, false);
      send(id, { t: 'cmdOut', lines: lines.length ? lines : ['(no output)'], ok: true });
      console.log(`# ${who} ran: ${String(msg.text).slice(0, 120)}`);
      worldDirty = true;
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
    socketAttempts.delete(String(id)); // free the per-socket auth counter
    if (authed.has(id)) {
      // Combat logout must settle BEFORE persistence: the server drops and
      // clears the quitter's carried inventory, then saves that empty state.
      const settled = game.settleDisconnect(id);
      if (settled.length) worldDirty = true;
      dispatch(settled);
      // The credited killer's new heart is account currency too; checkpoint
      // live accounts now rather than leaving that reward until the autosave.
      if (settled.length) {
        for (const liveId of authed.keys()) if (liveId !== id) persistPlayer(liveId);
      }
      persistPlayer(id);          // capture final inventory + position/heart loss
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
let vaultLast = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - vaultLast) / 1000);
  vaultLast = now;
  dispatch(game.tickVaultEncounters(dt));
  dispatch(game.tickWarfare(dt));
}, 1000 / 20);

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  game.tickRegen(dt);
  game.tickMachines(dt);
  const moved = game.tickItems(dt);
  dispatch(game.tickTurrets(dt));
  dispatch(game.tickWar(dt)); // advances worldTime + the shrinking border
  dispatch(game.tickDuels());
  dispatch(game.tickSeason(dt));
  for (const cid of authed.keys()) {
    send(cid, { t: 'snapshot', players: game.snapshotFor(cid), worldTime: game.clockTime() });
  }
  if (moved.length) {
    const mv: ServerMsg = { t: 'itemsmove', items: moved };
    for (const cid of authed.keys()) if (game.receivesWorldBroadcast(cid)) send(cid, mv);
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

// --- Admin console ----------------------------------------------------------
// Commands typed into the terminal running the server (the operator is trusted,
// so there's no in-game auth). Type `help` for the list.

const MODE_ALIASES: Record<string, GameMode> = {
  s: 'survival', survival: 'survival', '0': 'survival',
  c: 'creative', creative: 'creative', '1': 'creative',
  sp: 'spectator', spec: 'spectator', spectator: 'spectator', '3': 'spectator',
};

// Item name -> id, built once from ITEMS (normalized: lowercased, no spaces).
const ITEM_BY_NAME = new Map<string, number>();
for (const key of Object.keys(ITEMS)) {
  const id = Number(key);
  const norm = ITEMS[id].name.toLowerCase().replace(/[^a-z0-9]/g, '');
  ITEM_BY_NAME.set(norm, id);
}
// Also accept the Item enum keys (e.g. "RocketLauncher", "OilBarrel").
for (const k of Object.keys(Item)) {
  const id = (Item as Record<string, number>)[k];
  if (typeof id === 'number') ITEM_BY_NAME.set(k.toLowerCase(), id);
}
/** Resolve a `give` item token: a numeric id, an enum key, or an item name. */
function resolveItem(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const id = Number(token);
    return ITEMS[id] ? id : null;
  }
  const id = ITEM_BY_NAME.get(token.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return id !== undefined ? id : null;
}

/** Resolve a player token to an online id, logging if not found. */
function resolvePlayer(token: string): number | null {
  const pid = game.playerIdByName(token);
  if (pid === undefined) { console.log(`no online player named "${token}"`); return null; }
  return pid;
}

/** The socket id of an authed player, by (case-insensitive) account name. */
function onlineIdOf(username: string): number | undefined {
  return [...authed.entries()]
    .find(([, n]) => n.toLowerCase() === username.toLowerCase())?.[0];
}

/**
 * Award warfare XP to ONE account (online or not) and push it everywhere it
 * needs to go: the account record (persisted), the live GameServer copy, and
 * the player's own client if they happen to be connected. Shared by the `xp`
 * command and `warfare grant` so the two can never drift apart.
 * Returns the account's new lifetime total, or null if there's no such account.
 */
function grantXp(name: string, amount: number): { username: string; total: number } | null {
  const account = accounts.get(name);
  if (!account) return null;
  const total = accounts.awardWarfareXp(account.username, amount);
  const progress = accounts.warfareOf(account.username);
  game.setWarfare(account.username, progress);
  saveAccounts();
  const pid = onlineIdOf(account.username);
  if (pid !== undefined) {
    send(pid, { t: 'warfare', xp: progress.xp, nodes: progress.nodes.slice() });
    send(pid, { t: 'notice', text: `+${amount} warfare XP granted by an operator.` });
  }
  return { username: account.username, total };
}

/** Commands only the terminal may run — granting operator is never in-game. */
const CONSOLE_ONLY = new Set(['op', 'deop']);

const HELP = [
  'Commands:',
  '  op <player>                   - grant operator (console only)',
  '  deop <player>                 - revoke operator (console only)',
  '  ops                           - list the server operators',
  '  list                          - list online players',
  '  coords [player]               - show coords of all players, or one player',
  '  give <player> <item> [count]  - give items (item = name or id)',
  '  gamemode <mode> <player>      - survival | creative | spectator (s/c/sp)',
  '  tp <player> <x> <y> <z>       - teleport a player to coordinates',
  '  tp <player> <targetPlayer>    - teleport a player to another player',
  '  tpstruct <player> [kind]      - tp to nearest tower|bunker|pod|vault',
  '  sethearts <player> <n>        - set an online player\'s hearts (0-20)',
  '  revive <player>               - clear a player\'s 24h elimination lockout',
  '  war start <min>               - start a war NOW for <min> minutes',
  '  war schedule <delay> <min>    - schedule a war in <delay> min, lasting <min>',
  '  war cancel                    - end/cancel the war (back to peacetime)',
  '  war status                    - show the current war / next-war timer',
  '  flags on|off                  - arm/lock flag breaking (default: locked)',
  '  flags reset                   - send every flag home to its own faction',
  '  flags status                  - who holds which flag right now',
  '  save                          - force-save the world + accounts',
  '  xp <player> <n>               - give a player n warfare XP (works offline)',
  '  xp all <n>                    - give every online player n warfare XP',
  '  warfare status <player>       - show a player\'s Warfare Command tree',
  '  warfare grant <player> <xp>   - award warfare XP',
  '  warfare reset <player>        - wipe a player\'s technology',
  '  stop                          - save and shut down',
  '  help                          - this list',
].join('\n');

/**
 * Run one operator command.
 *
 * `out` receives every line of feedback — the terminal console when typed here,
 * or the sender's in-game command box when an OP types it there. `fromConsole`
 * gates the handful of commands that must never be reachable from in-game: an
 * account can't promote itself (or anyone else) to operator, only the person at
 * the terminal can.
 */
function runCommand(line: string, out: (text: string) => void = console.log,
    fromConsole = true): void {
  const log = out;
  const parts = line.trim().replace(/^\/+/, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  const cmd = parts[0].toLowerCase();
  if (!fromConsole && CONSOLE_ONLY.has(cmd)) {
    log(`"${cmd}" can only be run from the server console.`);
    return;
  }
  try {
    switch (cmd) {
      case 'help': case '?': log(HELP); break;
      case 'op': case 'deop': {
        const grant = cmd === 'op';
        if (parts.length < 2) { log(`usage: ${cmd} <player>`); break; }
        const name = accounts.setOp(parts[1], grant);
        if (!name) { log(`no account named "${parts[1]}"`); break; }
        saveAccounts();
        // Tell them live if they're online, so their command box picks up (or
        // drops) the operator commands without a relog.
        const opId = onlineIdOf(name);
        if (opId !== undefined) {
          send(opId, { t: 'op', op: grant });
          send(opId, { t: 'notice', text: grant
            ? 'You are now a server operator — press T and type a command.'
            : 'Your operator status was revoked.' });
        }
        log(`${name} is ${grant ? 'now' : 'no longer'} an operator`);
        break;
      }
      case 'ops': {
        const ops = accounts.operators();
        log(ops.length ? `${ops.length} operator(s): ${ops.join(', ')}` : 'no operators yet');
        break;
      }
      case 'list': case 'players': {
        const list = game.playerList();
        log(`${list.length} online:`);
        for (const p of list) log(`  [${p.id}] ${p.username} (faction ${p.faction}, ${p.mode})`);
        break;
      }
      case 'coords': {
        const allCoords = game.playerCoords();
        if (!allCoords.length) { log('no players online'); break; }
        // Optional filter: `coords Alice` shows only Alice
        const filter = parts[1]?.toLowerCase();
        const shown = filter
          ? allCoords.filter((c) => c.username.toLowerCase().includes(filter))
          : allCoords;
        if (!shown.length) { log(`no player matching "${parts[1]}"`); break; }
        for (const c of shown) {
          log(`  ${c.username}: x=${c.x.toFixed(1)} y=${c.y.toFixed(1)} z=${c.z.toFixed(1)}`);
        }
        break;
      }
      case 'give': {
        if (parts.length < 3) { log('usage: give <player> <item> [count]'); break; }
        const pid = resolvePlayer(parts[1]); if (pid === null) break;
        const item = resolveItem(parts[2]);
        if (item === null) { log(`unknown item "${parts[2]}"`); break; }
        const count = parts[3] ? Math.max(1, Math.floor(Number(parts[3]))) : 1;
        if (!Number.isFinite(count)) { log('count must be a number'); break; }
        dispatch(game.adminGive(pid, item, count));
        log(`gave ${count}x ${ITEMS[item].name} to ${parts[1]}`);
        break;
      }
      case 'gamemode': case 'gm': {
        if (parts.length < 3) { log('usage: gamemode <mode> <player>  (order-independent)'); break; }
        // Accept the mode + player in EITHER order (so `gm Alice creative` and
        // `gm creative Alice` both work).
        const a = parts[1].toLowerCase(), b = parts[2].toLowerCase();
        const mode = MODE_ALIASES[a] ?? MODE_ALIASES[b];
        const who = MODE_ALIASES[a] ? parts[2] : parts[1];
        if (!mode) { log('mode must be survival | creative | spectator'); break; }
        const pid = resolvePlayer(who); if (pid === null) break;
        dispatch(game.adminSetMode(pid, mode));
        log(`${who} -> ${mode}`);
        break;
      }
      case 'tp': {
        const pid = resolvePlayer(parts[1] ?? ''); if (pid === null) break;
        // `tp <player> <targetPlayer>` — warp to another online player.
        if (parts.length === 3) {
          const targetId = resolvePlayer(parts[2]); if (targetId === null) break;
          if (targetId === pid) { log("can't teleport a player to themselves"); break; }
          const tc = game.playerCoords().find((c) => c.id === targetId);
          if (!tc) { log('target has no position'); break; }
          dispatch(game.adminTeleport(pid, tc.x, tc.y, tc.z));
          log(`teleported ${parts[1]} to ${tc.username} (${tc.x.toFixed(1)} ${tc.y.toFixed(1)} ${tc.z.toFixed(1)})`);
          break;
        }
        // `tp <player> <x> <y> <z>` — warp to coordinates.
        if (parts.length < 5) { log('usage: tp <player> <x> <y> <z>  OR  tp <player> <targetPlayer>'); break; }
        const [x, y, z] = [Number(parts[2]), Number(parts[3]), Number(parts[4])];
        if (![x, y, z].every(Number.isFinite)) { log('x y z must be numbers'); break; }
        dispatch(game.adminTeleport(pid, x, y, z));
        log(`teleported ${parts[1]} to ${x} ${y} ${z}`);
        break;
      }
      case 'tpstruct': case 'tps': {
        if (parts.length < 2) { log('usage: tpstruct <player> [tower|bunker|pod|vault]'); break; }
        const pid = resolvePlayer(parts[1]); if (pid === null) break;
        const kind = parts[2]?.toLowerCase();
        if (kind && !['tower', 'bunker', 'pod', 'vault'].includes(kind)) {
          log('kind must be tower | bunker | pod | vault'); break;
        }
        const s = game.nearestStructure(pid, kind);
        if (!s) { log(`no ${kind ?? 'structure'} found`); break; }
        dispatch(game.adminTeleport(pid, s.x, s.y, s.z));
        log(`teleported ${parts[1]} to the nearest ${s.kind} at ${s.x} ${s.y} ${s.z}`);
        break;
      }
      case 'sethearts': {
        if (parts.length < 3) { log('usage: sethearts <player> <n>'); break; }
        const pid = resolvePlayer(parts[1]); if (pid === null) break;
        const n = Number(parts[2]);
        if (!Number.isFinite(n)) { log('n must be a number (0-20)'); break; }
        dispatch(game.adminSetHearts(pid, n));
        worldDirty = true; // checkpoint the new hearts on the next autosave
        log(`set ${parts[1]}'s hearts to ${Math.max(0, Math.min(20, Math.floor(n)))}`);
        break;
      }
      case 'revive': {
        if (parts.length < 2) { log('usage: revive <player>'); break; }
        const name = parts[1];
        if (!accounts.has(name)) { log(`no account named "${name}"`); break; }
        if (accounts.eliminationRemaining(name, Date.now()) <= 0) {
          log(`${name} isn't eliminated`);
          break;
        }
        accounts.clearElimination(name, Date.now());
        saveAccounts();
        log(`revived ${name} — they can log back in (at ${COMEBACK_HEARTS} hearts)`);
        break;
      }
      case 'war': {
        const sub = (parts[1] || 'status').toLowerCase();
        if (sub === 'start' || sub === 'now') {
          const min = parts[2] ? Number(parts[2]) : 30;
          if (!Number.isFinite(min) || min <= 0) { log('usage: war start <minutes>'); break; }
          dispatch(game.adminStartWar(min * 60));
          log(`war started for ${min} min`);
        } else if (sub === 'schedule' || sub === 'in') {
          const delay = Number(parts[2]), dur = Number(parts[3]);
          if (![delay, dur].every(Number.isFinite) || delay < 0 || dur <= 0) {
            log('usage: war schedule <delayMinutes> <durationMinutes>'); break;
          }
          dispatch(game.adminScheduleWar(delay * 60, dur * 60));
          log(`war scheduled in ${delay} min, lasting ${dur} min`);
        } else if (sub === 'cancel' || sub === 'end' || sub === 'stop') {
          dispatch(game.adminCancelWar());
          log('war cancelled');
        } else if (sub === 'status') {
          log(game.warStatusText());
        } else {
          log('usage: war start|schedule|cancel|status');
        }
        break;
      }
      case 'flags': case 'flag': {
        const sub = (parts[1] || 'status').toLowerCase();
        if (sub === 'on' || sub === 'arm' || sub === 'breakable') {
          dispatch(game.adminSetFlagsBreakable(true));
          log('flags ARMED — enemy flags can now be broken (very slowly)');
        } else if (sub === 'off' || sub === 'lock' || sub === 'safe') {
          dispatch(game.adminSetFlagsBreakable(false));
          log('flags LOCKED — flags are unbreakable again');
        } else if (sub === 'reset') {
          dispatch(game.adminResetFlags());
          log('flags reset to their home pads');
        } else if (sub === 'status') {
          log(game.flagsStatusText());
        } else {
          log('usage: flags on|off|reset|status');
        }
        break;
      }
      case 'xp': case 'givexp': {
        // Warfare XP is the game's ONLY XP, so plain `xp` grants that. It works
        // on an offline account too (the grant lands on the account record and
        // is already there when they next log in).
        if (parts.length < 3) { log('usage: xp <player|all> <n>'); break; }
        const amount = Math.floor(Number(parts[2]));
        if (!Number.isFinite(amount) || amount <= 0) {
          log('n must be a positive number (use `warfare reset <player>` to wipe a tree)');
          break;
        }
        if (parts[1].toLowerCase() === 'all') {
          const names = [...new Set(authed.values())];
          if (!names.length) { log('no players online'); break; }
          for (const name of names) {
            const res = grantXp(name, amount);
            if (res) log(`  ${res.username} +${amount} XP (total ${res.total})`);
          }
          break;
        }
        const res = grantXp(parts[1], amount);
        if (!res) { log(`no account "${parts[1]}"`); break; }
        log(`gave ${amount} warfare XP to ${res.username} (total ${res.total})`);
        break;
      }
      case 'warfare': {
        // Operator control over Warfare Command progression: inspect a player's
        // technology, or grant/revoke warfare XP for testing and moderation.
        const sub = (parts[1] || 'status').toLowerCase();
        if (sub === 'status' || sub === 'show') {
          const who = parts[2];
          if (!who) { log('usage: warfare status <player>'); break; }
          const account = accounts.get(who);
          if (!account) { log(`no account "${who}"`); break; }
          const w = accounts.warfareOf(account.username);
          log(`${account.username}: ${w.xp} XP earned, ` +
            `${warfareAvailable(w)} available, ${w.nodes.length}/${WARFARE_TREE.length} nodes`);
          if (w.nodes.length) log(`  ${w.nodes.join(', ')}`);
        } else if (sub === 'grant' || sub === 'xp') {
          if (parts.length < 4) { log('usage: warfare grant <player> <xp>'); break; }
          const amount = Math.floor(Number(parts[3]));
          if (!Number.isFinite(amount) || amount <= 0) { log('xp must be a positive number'); break; }
          const res = grantXp(parts[2], amount); // same path as the `xp` command
          if (!res) { log(`no account "${parts[2]}"`); break; }
          log(`granted ${amount} warfare XP to ${res.username} (total ${res.total})`);
        } else if (sub === 'reset') {
          const account = accounts.get(parts[2] ?? '');
          if (!account) { log('usage: warfare reset <player>'); break; }
          account.warfare = sanitizeWarfare(null);
          game.setWarfare(account.username, account.warfare);
          saveAccounts();
          log(`${account.username}'s Warfare Command tree was reset`);
        } else {
          log('usage: warfare status|grant|reset <player> [xp]');
        }
        break;
      }
      case 'save': for (const id of authed.keys()) persistPlayer(id); saveWorld(); saveAccounts(); log('saved'); break;
      case 'stop': shutdown(); break;
      default: log(`unknown command "${cmd}" — type help`);
    }
  } catch (e) { log(`command error: ${e instanceof Error ? e.message : String(e)}`); }
}

const rl = readline.createInterface({ input: process.stdin, prompt: '> ' });
rl.on('line', (line) => { runCommand(line); rl.prompt(); });

httpServer.listen(port, () => {
  console.log(`VOXELON server listening on http://localhost:${port} (game + ws, seed ${game.seed})`);
  console.log(`  → open http://localhost:${port} to play (after \`npm run build\`)`);
  console.log('  → to share: `cloudflared tunnel --url http://localhost:' + port + '`');
  console.log('admin console ready — type `help` for commands');
  rl.prompt();
});
