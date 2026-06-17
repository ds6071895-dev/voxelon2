// VOXELON WebSocket transport: a thin shell that wires ws sockets to the
// pure GameServer (all the real logic lives in src/net/server_core.ts).
// Run with `npm run server`.

import { WebSocketServer, WebSocket } from 'ws';
import { ClientMsg, SERVER_PORT, SNAPSHOT_HZ, ServerMsg } from '../src/net/protocol';
import { GameServer, Outbound } from '../src/net/server_core';

const port = Number(process.env.PORT) || SERVER_PORT;
const game = new GameServer();
const sockets = new Map<number, WebSocket>();
let nextId = 1;

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
  dispatch(game.addPlayer(id));
  console.log(`+ player ${id} joined (${game.playerCount} online)`);

  ws.on('message', (data: unknown) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    dispatch(game.handle(id, msg));
  });
  ws.on('close', () => {
    sockets.delete(id);
    dispatch(game.removePlayer(id));
    console.log(`- player ${id} left (${game.playerCount} online)`);
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
  const snap: ServerMsg = { t: 'snapshot', players: game.snapshot() };
  for (const cid of sockets.keys()) send(cid, snap);
}, 1000 / SNAPSHOT_HZ);

console.log(`VOXELON server listening on ws://localhost:${port} (seed ${game.seed})`);
