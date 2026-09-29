// Browser-side network client for Worlds. Connects to the game server,
// tracks the players in YOUR current world (a timestamped transform history
// per player, replayed on a fixed delay — see interp.ts), and exposes send
// helpers + event callbacks. Reconnects on its own when the socket drops.

import { INTERP_DELAY, SenderClock, StateTimeline, TransformBuffer, netNow } from '../interp';
import type { ItemStack } from '../items';
import {
  SERVER_PORT, TRANSFORM_HZ,
  type ClientMsg, type GameMode, type PartyState, type PlayerInfo, type ServerMsg,
} from './protocol';
import type { Cosmetics } from '../character';
import type { DuelArenaBounds, DuelLobbySnapshot, DuelResult } from '../duels';
import type { PartyArenaBounds, PartyLobbySnapshot, PartyResult, PartySubBounds } from '../partygames';
import type { WorldSpec } from '../multiverse';
import type { RatClassId, RsEffects, RsResult, RsRole, RsSnapshot, RsSound } from '../ratseek_rules';

export interface Remote {
  info: PlayerInfo;
  /** Newest networked transform (rough "where are they"); anything that must
   *  match what the player SEES goes through `buf`. */
  tx: number; ty: number; tz: number; tyaw: number; tpitch: number;
  buf: TransformBuffer;
  clock: SenderClock;
  seenAt: number;
  poses: StateTimeline<RemotePose>;
  health: number;
  dead: boolean;
  sneaking: boolean;
  held: number;
  swing: number;
  aiming: boolean;
  reloading: boolean;
}

type RemotePose = Pick<Remote,
  'sneaking' | 'held' | 'swing' | 'aiming' | 'reloading'>;

function poseOf(s: { sneaking?: boolean; held?: number; swing?: number; aiming?: boolean; reloading?: boolean },
  prev?: RemotePose): RemotePose {
  return {
    sneaking: s.sneaking === true,
    held: typeof s.held === 'number' ? s.held : 0,
    swing: typeof s.swing === 'number' ? s.swing : prev?.swing ?? 0,
    aiming: s.aiming === true, reloading: s.reloading === true,
  };
}

/** Same-origin in production (the game server serves the page); the game
 *  server's own port under the Vite dev server. */
function serverUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sameOrigin = location.protocol === 'https:' || location.port === '' ||
    location.port === String(SERVER_PORT);
  return sameOrigin ? `${proto}//${location.host}` : `ws://${location.hostname || 'localhost'}:${SERVER_PORT}`;
}

/** Seconds a remote may be absent from snapshots before it is dropped. */
const STALE_REMOTE_S = 2;

export class NetClient {
  /** Socket open and `welcome` received. */
  connected = false;
  myId = -1;
  /** The world this client is in (null on the menu). */
  worldId: number | null = null;
  /** Bridge/Parkour round revision the transforms are stamped with. */
  revision: number | undefined;
  readonly remotes = new Map<number, Remote>();
  private ws: WebSocket | null = null;
  private xformAcc = 0;
  private reconnectTimer = 0;
  private attempts = 0;
  /** Supplies the hello payload (guest name, session, look) on every connect. */
  helloPayload: () => Extract<ClientMsg, { t: 'hello' }> = () => ({ t: 'hello' });

  onWelcome?: (username: string, account: boolean, cosmetics?: Cosmetics) => void;
  onIdentity?: (username: string, account: boolean, token?: string, cosmetics?: Cosmetics) => void;
  onAuthErr?: (error: string) => void;
  onNameOffer?: (name: string) => void;
  onParty?: (party: PartyState | null) => void;
  onPartyErr?: (message: string) => void;
  onQueue?: (mode: GameMode | null) => void;
  onNotice?: (text: string) => void;
  onDisconnect?: () => void;
  onDuelArena?: (world: WorldSpec, arena: DuelArenaBounds, spawn: { x: number; y: number; z: number }, countdownEndsAt: number) => void;
  onPgArena?: (world: WorldSpec, arena: PartyArenaBounds, sub: PartySubBounds, team: number,
    spawn: { x: number; y: number; z: number }, countdownEndsAt: number, revision: number) => void;
  onLeftWorld?: () => void;
  onSelfHealth?: (health: number) => void;
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  onEditBatch?: (edits: { x: number; y: number; z: number; block: number }[]) => void;
  onHurt?: (health: number, k: [number, number, number], by: number) => void;
  onHitConfirm?: (target: number, amount: number, killed: boolean) => void;
  onShot?: (id: number, item: number, x: number, y: number, z: number, dx: number, dy: number, dz: number) => void;
  onRespawned?: (x: number, y: number, z: number, health: number) => void;
  onTeleport?: (x: number, y: number, z: number) => void;
  onKillfeed?: (killer: string, victim: string) => void;
  onCosmetics?: (id: number) => void;
  onDuelState?: (snapshot: DuelLobbySnapshot) => void;
  onDuelLoadout?: (slots: (ItemStack | null)[], selected: number) => void;
  onDuelClock?: (serverNow: number) => void;
  onDuelRespawn?: (respawnAt: number, spectating: boolean) => void;
  onPgRespawn?: (respawnAt: number, spectating: boolean) => void;
  onDuelResult?: (result: DuelResult) => void;
  onPgState?: (snapshot: PartyLobbySnapshot) => void;
  onPgLoadout?: (slots: (ItemStack | null)[], selected: number) => void;
  onPgHit?: (target: number, amount: number, combo: number, charge: number, crit: boolean, killed: boolean, ranged: boolean) => void;
  onPgKillHeal?: (victim: number, health: number) => void;
  onPgArrow?: (a: { id: number; by: number; x: number; y: number; z: number;
    dx: number; dy: number; dz: number; speed: number; power: number }) => void;
  onPgArrowEnd?: (id: number, x: number, y: number, z: number, hit: boolean) => void;
  onPgResult?: (result: PartyResult) => void;
  onRsArena?: (world: WorldSpec, role: RsRole, spawn: { x: number; y: number; z: number }, yaw: number) => void;
  onRsState?: (s: RsSnapshot) => void;
  onRsKit?: (slots: (ItemStack | null)[], selected?: number) => void;
  onRsFx?: (fx: RsEffects) => void;
  onRsTitle?: (title: string, sub: string, color: string, ms: number) => void;
  onRsBar?: (text: string, color: string) => void;
  onRsMsg?: (text: string, color: string) => void;
  onRsSound?: (kind: RsSound, at: { x: number; y: number; z: number } | null) => void;
  onRsImpulse?: (vx: number, vy: number, vz: number, momentum: number) => void;
  onRsResult?: (result: RsResult) => void;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    let ws: WebSocket;
    try { ws = new WebSocket(serverUrl()); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => { this.attempts = 0; this.raw(this.helloPayload()); };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data as string) as ServerMsg; } catch { return; }
      this.handle(msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this.worldId = null;
      this.remotes.clear();
      if (was) this.onDisconnect?.();
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* close follows */ };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(8000, 600 * 2 ** Math.min(4, this.attempts++));
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = 0; this.connect(); }, delay);
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.connected = true;
        this.myId = msg.id;
        this.onWelcome?.(msg.username, msg.account, msg.cosmetics);
        break;
      case 'identity':
        this.onIdentity?.(msg.username, msg.account, msg.token, msg.cosmetics);
        break;
      case 'authErr': this.onAuthErr?.(msg.error); break;
      case 'nameOffer': this.onNameOffer?.(msg.name); break;
      case 'party': this.onParty?.(msg.party); break;
      case 'partyErr': this.onPartyErr?.(msg.message); break;
      case 'queue': this.onQueue?.(msg.mode); break;
      case 'notice': this.onNotice?.(msg.text); break;
      case 'duelArena':
        this.enterWorld(msg.world.id, undefined);
        this.onDuelArena?.(msg.world, msg.arena, msg.spawn, msg.countdownEndsAt);
        break;
      case 'pgArena':
        this.enterWorld(msg.world.id, msg.revision);
        this.onPgArena?.(msg.world, msg.arena, msg.sub, msg.team, msg.spawn, msg.countdownEndsAt, msg.revision);
        break;
      case 'leftWorld':
        this.worldId = null;
        this.revision = undefined;
        this.remotes.clear();
        this.onLeftWorld?.();
        break;
      case 'join':
        if (msg.player.id !== this.myId) {
          const known = this.remotes.get(msg.player.id);
          if (known) known.info = msg.player;
          else this.remotes.set(msg.player.id, toRemote(msg.player));
        }
        break;
      case 'leave':
        this.remotes.delete(msg.id);
        break;
      case 'snapshot': {
        const at = netNow();
        for (const s of msg.players) {
          if (s.id === this.myId) { this.onSelfHealth?.(s.health); continue; }
          const r = this.remotes.get(s.id);
          if (!r) continue;
          r.seenAt = at;
          r.tx = s.x; r.ty = s.y; r.tz = s.z; r.tyaw = s.yaw; r.tpitch = s.pitch;
          const pose = poseOf(s, r);
          if (typeof s.ct === 'number') {
            const m = r.clock.map(s.ct, at);
            if (m) {
              const sample = { t: m.t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
              if (m.restarted) { r.buf.reset(sample); r.poses.reset(m.t, pose); }
              else { r.buf.push(sample); r.poses.push(m.t, pose); }
            } else if (Number.isFinite(r.buf.newest)) {
              r.poses.push(r.buf.newest, pose);
            }
          } else {
            r.buf.push({ t: at, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
            r.poses.push(at, pose);
          }
          r.health = s.health; r.dead = s.dead;
        }
        for (const [id, r] of this.remotes) {
          if (at - r.seenAt > STALE_REMOTE_S) this.remotes.delete(id);
        }
        break;
      }
      case 'edit': this.onEdit?.(msg.x, msg.y, msg.z, msg.block); break;
      case 'editBatch':
        if (this.onEditBatch) this.onEditBatch(msg.edits);
        else for (const e of msg.edits) this.onEdit?.(e.x, e.y, e.z, e.block);
        break;
      case 'hurt': this.onHurt?.(msg.health, [msg.kx, msg.ky, msg.kz], msg.by); break;
      case 'hitconfirm': this.onHitConfirm?.(msg.target, msg.amount, msg.killed === true); break;
      case 'shot': this.onShot?.(msg.id, msg.item, msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz); break;
      case 'respawned': this.onRespawned?.(msg.x, msg.y, msg.z, msg.health); break;
      case 'teleport': this.onTeleport?.(msg.x, msg.y, msg.z); break;
      case 'killfeed': this.onKillfeed?.(msg.killer, msg.victim); break;
      case 'cosmetics': {
        const rc = this.remotes.get(msg.id);
        if (rc) rc.info.cosmetics = msg.c;
        this.onCosmetics?.(msg.id);
        break;
      }
      case 'duelState': this.onDuelState?.(msg.snapshot); break;
      case 'duelLoadout': this.onDuelLoadout?.(msg.slots, msg.selected); break;
      case 'duelClock': this.onDuelClock?.(msg.serverNow); break;
      case 'pgRespawn': this.onPgRespawn?.(msg.respawnAt, msg.spectating); break;
      case 'duelRespawn': this.onDuelRespawn?.(msg.respawnAt, msg.spectating); break;
      case 'duelResult': this.onDuelResult?.(msg.result); break;
      case 'pgState': this.onPgState?.(msg.snapshot); break;
      case 'pgLoadout': this.onPgLoadout?.(msg.slots, msg.selected); break;
      case 'pgKillHeal': this.onPgKillHeal?.(msg.victim, msg.health); break;
      case 'pgHit': this.onPgHit?.(msg.target, msg.amount, msg.combo, msg.charge, msg.crit, msg.killed, msg.ranged); break;
      case 'pgArrow': this.onPgArrow?.(msg); break;
      case 'pgArrowEnd': this.onPgArrowEnd?.(msg.id, msg.x, msg.y, msg.z, msg.hit); break;
      case 'pgResult': this.onPgResult?.(msg.result); break;
      case 'rsArena':
        this.enterWorld(msg.world.id, undefined);
        this.onRsArena?.(msg.world, msg.role, msg.spawn, msg.yaw);
        break;
      case 'rsState': this.onRsState?.(msg.s); break;
      case 'rsKit': this.onRsKit?.(msg.slots, msg.selected); break;
      case 'rsFx': this.onRsFx?.(msg.fx); break;
      case 'rsTitle': this.onRsTitle?.(msg.title, msg.sub, msg.color, msg.ms); break;
      case 'rsBar': this.onRsBar?.(msg.text, msg.color); break;
      case 'rsMsg': this.onRsMsg?.(msg.text, msg.color); break;
      case 'rsSound': this.onRsSound?.(msg.kind, msg.x !== undefined ? { x: msg.x, y: msg.y!, z: msg.z! } : null); break;
      case 'rsImpulse': this.onRsImpulse?.(msg.vx, msg.vy, msg.vz, msg.momentum); break;
      case 'rsResult': this.onRsResult?.(msg.result); break;
    }
  }

  private enterWorld(id: number, revision: number | undefined): void {
    this.worldId = id;
    this.revision = revision;
    // Nobody from the menu or a previous world belongs in this one.
    // (`join` messages for this world's bodies arrive in the same batch.)
    for (const [rid, r] of this.remotes) if (r.seenAt < netNow() - 0.05) this.remotes.delete(rid);
    this.xformAcc = 0;
  }

  /** Put one message on the wire; returns whether it went. */
  private raw(msg: ClientMsg, volatile = false): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (volatile && this.ws.bufferedAmount > 32 * 1024) return false;
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  // --- Remote playback -------------------------------------------------------

  renderDelay(_dt = 0): number { return INTERP_DELAY; }

  applyRemotePoses(renderTime: number): void {
    for (const r of this.remotes.values()) {
      const pose = r.poses.at(renderTime);
      if (pose) Object.assign(r, pose);
    }
  }

  // --- Outbound ----------------------------------------------------------------

  send(msg: ClientMsg): boolean { return this.connected ? this.raw(msg) : false; }

  /** Throttled transform send (call every frame with dt). */
  sendXform(dt: number, x: number, y: number, z: number, yaw: number, pitch: number,
    sneaking = false, held = 0, swing = 0, aiming = false, reloading = false): void {
    if (!this.connected || this.worldId === null) return;
    const interval = 1 / TRANSFORM_HZ;
    this.xformAcc += dt;
    if (this.xformAcc < interval) return;
    this.xformAcc = Math.min(this.xformAcc - interval, interval);
    this.raw({ t: 'xform', world: this.worldId, revision: this.revision, x, y, z, yaw, pitch,
      ct: Math.round(netNow() * 1000), sneaking, held, swing, aiming, reloading }, true);
  }
  /** Unthrottled transform send, for right before an edit: the server checks a
   *  placement against the placer's body, and a pose up to 1/TRANSFORM_HZ old
   *  still overlaps the cell you just jumped or stepped off. */
  flushXform(x: number, y: number, z: number, yaw: number, pitch: number,
    sneaking = false, held = 0, swing = 0, aiming = false, reloading = false): void {
    if (!this.connected || this.worldId === null) return;
    this.xformAcc = 0;
    this.raw({ t: 'xform', world: this.worldId, revision: this.revision, x, y, z, yaw, pitch,
      ct: Math.round(netNow() * 1000), sneaking, held, swing, aiming, reloading });
  }
  sendWorldReady(): void {
    if (this.worldId !== null) this.send({ t: 'worldReady', world: this.worldId, revision: this.revision });
  }
  sendEdit(x: number, y: number, z: number, block: number): void { this.send({ t: 'edit', x, y, z, block }); }
  sendShot(x: number, y: number, z: number, dx: number, dy: number, dz: number, item: number): void {
    this.send({ t: 'shot', x, y, z, dx, dy, dz, item });
  }
  sendRangedAttack(target: number, amount: number): void { this.send({ t: 'rangedAttack', target, amount }); }
  sendUseHeal(item: number): void { this.send({ t: 'useHeal', item }); }
  sendPgMelee(target: number): void { this.send({ t: 'pgMelee', target }); }
  sendPgShoot(dx: number, dy: number, dz: number, power: number): void { this.send({ t: 'pgShoot', dx, dy, dz, power }); }
  sendPgRetry(): void { this.send({ t: 'pgRetry' }); }
  sendRsUse(slot: number, block?: { x: number; y: number; z: number; nx: number; ny: number; nz: number }): void {
    this.send({ t: 'rsUse', slot, block });
  }
  sendRsHit(target: number, decoy = false): void { this.send({ t: 'rsHit', target, decoy }); }
  sendRsClass(cls: RatClassId): void { this.send({ t: 'rsClass', cls }); }
  sendRsSeeker(seeker: number): void { this.send({ t: 'rsSeeker', seeker }); }
}

function toRemote(p: PlayerInfo): Remote {
  const now = netNow();
  const buf = new TransformBuffer();
  buf.reset({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  const pose = poseOf(p);
  const poses = new StateTimeline<RemotePose>();
  poses.reset(now, pose);
  return {
    info: p, buf, clock: new SenderClock(), seenAt: now, poses,
    tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, tpitch: p.pitch,
    health: p.health, dead: p.dead, ...pose,
  };
}
