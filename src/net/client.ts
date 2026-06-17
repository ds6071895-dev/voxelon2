// Browser-side network client. Connects to the VOXELON server, tracks remote
// players (raw target transforms — interpolation lives in the renderer), and
// exposes send helpers + event callbacks. Fails gracefully to offline mode so
// the game is fully playable with no server running.

import {
  ClientMsg, PlayerInfo, SERVER_PORT, ServerMsg, TRANSFORM_HZ,
} from './protocol';

export interface Remote {
  info: PlayerInfo;
  tx: number; ty: number; tz: number; tyaw: number; tpitch: number;
  health: number;
  dead: boolean;
}

export class NetClient {
  connected = false;
  offline = false;
  myId = -1;
  username = '';
  readonly remotes = new Map<number, Remote>();

  /** Fired once the server welcome arrives (multiplayer is now live). */
  onWelcome?: (info: PlayerInfo) => void;
  /** A block edit from another player (apply without re-broadcasting). */
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  /** Server-authoritative health change for the local player. */
  onHurt?: (health: number, dead: boolean, k: [number, number, number]) => void;
  onRespawned?: (x: number, y: number, z: number, health: number) => void;
  onKillfeed?: (killer: string, victim: string) => void;
  /** Roster changed (join/leave/welcome) — refresh player count UI. */
  onRoster?: () => void;
  /** Connection lost after having been live. */
  onDisconnect?: () => void;

  private ws: WebSocket | null = null;
  private xformAcc = 0;

  /** Begin connecting. Falls back to offline after `timeoutMs`. */
  connect(timeoutMs = 2500): void {
    const host = location.hostname || 'localhost';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${host}:${SERVER_PORT}`);
    } catch {
      this.offline = true;
      return;
    }
    this.ws = ws;
    const timer = setTimeout(() => {
      if (!this.connected) { this.offline = true; this.close(); }
    }, timeoutMs);

    ws.onopen = () => this.raw({ t: 'hello' });
    ws.onmessage = (e) => {
      clearTimeout(timer);
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data as string) as ServerMsg; } catch { return; }
      this.handle(msg);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      if (!this.connected) this.offline = true;
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (this.connected) {
        this.connected = false;
        this.remotes.clear();
        this.onDisconnect?.();
        this.onRoster?.();
      } else {
        this.offline = true;
      }
    };
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome': {
        this.connected = true;
        this.myId = msg.id;
        this.username = msg.username;
        this.remotes.clear();
        for (const p of msg.players) {
          if (p.id !== this.myId) this.remotes.set(p.id, toRemote(p));
        }
        for (const [k, b] of msg.edits) {
          const [x, y, z] = k.split(',').map(Number);
          this.onEdit?.(x, y, z, b);
        }
        const me = msg.players.find((p) => p.id === this.myId);
        if (me) this.onWelcome?.(me);
        this.onRoster?.();
        break;
      }
      case 'join':
        if (msg.player.id !== this.myId) {
          this.remotes.set(msg.player.id, toRemote(msg.player));
          this.onRoster?.();
        }
        break;
      case 'leave':
        this.remotes.delete(msg.id);
        this.onRoster?.();
        break;
      case 'snapshot':
        for (const s of msg.players) {
          if (s.id === this.myId) continue;
          const r = this.remotes.get(s.id);
          if (r) {
            r.tx = s.x; r.ty = s.y; r.tz = s.z;
            r.tyaw = s.yaw; r.tpitch = s.pitch;
            r.health = s.health; r.dead = s.dead;
          }
        }
        break;
      case 'edit':
        this.onEdit?.(msg.x, msg.y, msg.z, msg.block);
        break;
      case 'hurt':
        this.onHurt?.(msg.health, msg.dead, [msg.kx, msg.ky, msg.kz]);
        break;
      case 'respawned':
        this.onRespawned?.(msg.x, msg.y, msg.z, msg.health);
        break;
      case 'killfeed':
        this.onKillfeed?.(msg.killer, msg.victim);
        break;
    }
  }

  private raw(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private close(): void {
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
  }

  // --- outbound -------------------------------------------------------------

  /** Throttled transform send (call every frame with dt). */
  sendXform(
    dt: number, x: number, y: number, z: number, yaw: number, pitch: number
  ): void {
    if (!this.connected) return;
    const interval = 1 / TRANSFORM_HZ;
    this.xformAcc += dt;
    if (this.xformAcc < interval) return;
    // Subtract the interval (don't zero) so the long-run rate matches
    // TRANSFORM_HZ; clamp to avoid a burst after a long stall.
    this.xformAcc = Math.min(this.xformAcc - interval, interval);
    this.raw({ t: 'xform', x, y, z, yaw, pitch });
  }

  sendEdit(x: number, y: number, z: number, block: number): void {
    if (this.connected) this.raw({ t: 'edit', x, y, z, block });
  }
  sendAttack(target: number): void {
    if (this.connected) this.raw({ t: 'attack', target });
  }
  sendSelfHurt(amount: number): void {
    if (this.connected) this.raw({ t: 'selfhurt', amount });
  }
  sendRespawn(): void {
    if (this.connected) this.raw({ t: 'respawn' });
  }
}

function toRemote(p: PlayerInfo): Remote {
  return {
    info: p, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, tpitch: p.pitch,
    health: p.health, dead: p.dead,
  };
}
