// Browser-side network client. Connects to the VOXELON server, tracks remote
// players (a timestamped transform history per player, which the renderer
// replays on a fixed delay — see interp.ts), and exposes send helpers + event
// callbacks. Fails gracefully to offline mode so the game is fully playable
// with no server running.

import { TransformBuffer, netNow } from '../interp';
import type { ItemStack } from '../items';
import type { MachineState, UpgradeAxis } from '../machines';
import type { TurretState, TurretAxis } from '../turrets';
import {
  ClientMsg, GameMode, ItemEntityInfo, PlayerInfo, SERVER_PORT, ServerMsg,
  TRANSFORM_HZ,
} from './protocol';
import type { Cosmetics } from '../character';
import type {
  EncounterEvent, EncounterSnapshot, VaultAttackIntent,
} from '../vault_encounter';
import { sanitizeEncounterSnapshot } from '../vault_encounter';
import type { VaultBossKind, VaultFamily, VaultTier } from '../vaults';
import type {
  BatteryState, LaunchReject, MissileSnapshot, ProtectedArea, SiloState,
} from '../strategic';
import type {
  BombSnapshot, HeliLossReason, HelicopterSnapshot, SeatKind,
} from '../vehicles';

export interface Remote {
  info: PlayerInfo;
  /** Newest networked transform. Kept for code that only needs "where are they
   *  right now, roughly" (map markers, nameplate culling); anything that has to
   *  match what the player SEES — rendering, hit tests — must go through `buf`. */
  tx: number; ty: number; tz: number; tyaw: number; tpitch: number;
  /** Timestamped transform history, replayed INTERP_DELAY behind the local
   *  clock so the avatar moves smoothly instead of easing toward each packet. */
  buf: TransformBuffer;
  health: number;
  dead: boolean;
  gliding: boolean;
  boating: boolean;
  /** Strapped into a vehicle seat — drives the seated avatar pose. */
  seated: boolean;
  sneaking: boolean;
  /** Held item id (0 = bare hand) — rendered in the avatar's hand. */
  held: number;
  /** Worn armor item ids [helmet, chest, legs, boots] (0 = bare slot). */
  armor: number[];
  /** Latest networked swing sequence. */
  swing: number;
  aiming: boolean;
  reloading: boolean;
}

/** Resolve the WebSocket URL. When the page is served by the game server itself
 *  (production build / a Cloudflare tunnel / any reverse proxy) the socket is
 *  SAME-ORIGIN — `wss://host` over https, `ws://host` over http — so a single
 *  tunnel on one port hosts the whole game. Only in Vite dev (the page is on a
 *  different port, e.g. 5173) do we target the ws server's own port directly. */
function serverUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sameOrigin =
    location.protocol === 'https:' ||        // tunnel / proxy → same origin (wss)
    location.port === '' ||                  // default 80/443 → same origin
    location.port === String(SERVER_PORT);   // served directly by the game server
  return sameOrigin
    ? `${proto}//${location.host}`
    : `ws://${location.hostname || 'localhost'}:${SERVER_PORT}`;
}

export class NetClient {
  connected = false;
  offline = false;
  /** The socket is open + reachable (server is up), but not yet authenticated. */
  socketOpen = false;
  myId = -1;
  username = '';
  /** This account is a server operator (told to us right after auth). Only a
   *  UI hint — the server re-authorises every operator command it receives. */
  isOp = false;
  readonly remotes = new Map<number, Remote>();
  /** Server-owned dropped items, keyed by entity id (for the renderer). */
  readonly netItems = new Map<number, ItemEntityInfo>();

  /** Fired once the server welcome arrives (multiplayer is now live). */
  onWelcome?: (info: PlayerInfo) => void;
  /** Saved per-account state to restore (inventory/hotbar), if the account has any. */
  onRestoreState?: (state: Record<string, unknown>) => void;
  /** A block edit from another player (apply without re-broadcasting). */
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  /** Server-authoritative health change for the local player. `by` is the id of
   *  whoever dealt it (used for the directional damage indicator; it is the
   *  local id, or an unknown id, for non-player damage). */
  onHurt?: (health: number, dead: boolean, k: [number, number, number], by: number) => void;
  /** One of OUR direct hits landed: the hitmarker. `amount` is post-armor, so 0
   *  means "connected but fully soaked". */
  onHitConfirm?: (target: number, amount: number, killed: boolean) => void;
  /** Someone else fired a gun: play the tracer + report where it came from. */
  onShot?: (
    id: number, item: number,
    x: number, y: number, z: number, dx: number, dy: number, dz: number,
  ) => void;
  /** Someone else's explosion went off (cosmetic; the crater arrives as edits). */
  onBlast?: (x: number, y: number, z: number) => void;
  onRespawned?: (x: number, y: number, z: number, health: number) => void;
  /** The local player's authoritative health/dead from the periodic snapshot —
   *  this is how server-side REGEN reaches the client (hurt only fires on a
   *  hit, so without this the HUD froze between hits then jumped on the next). */
  onSelfHealth?: (health: number, dead: boolean) => void;
  onKillfeed?: (killer: string, victim: string) => void;
  /** The LOCAL player's gamemode changed (admin command). */
  onGamemode?: (mode: GameMode) => void;
  /** The server teleported the local player (admin command). */
  onTeleport?: (x: number, y: number, z: number) => void;
  /** A server notice to surface to the local player (admin feedback). */
  onNotice?: (text: string) => void;
  /** TPA: `from` wants to teleport to YOU (run /tpaccept to allow). */
  onTpaRequest?: (from: string) => void;
  /** Operator status for this account changed (or arrived on login). */
  onOpState?: (op: boolean) => void;
  /** Output of an operator command we sent, for the command box. */
  onCmdOut?: (lines: string[], ok: boolean) => void;
  /** Roster changed (join/leave/welcome) — refresh player count UI. */
  onRoster?: () => void;
  /** Connection lost after having been live. */
  onDisconnect?: () => void;
  /** A pickup we requested was granted — add it to the local inventory. */
  onGotItem?: (item: number, count: number) => void;
  /** Authoritative chest contents (open reply or live update from a peer). */
  onChest?: (x: number, y: number, z: number, slots: (ItemStack | null)[]) => void;
  /** Authoritative machine state (open reply / config / upgrade / collect). */
  onMachine?: (x: number, y: number, z: number, state: MachineState) => void;
  /** Authoritative turret state (open reply / upgrade / load / fire refresh). */
  onTurret?: (x: number, y: number, z: number, state: TurretState) => void;
  /** A turret fired (render a tracer + aim the barrel). */
  onTurretFire?: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => void;
  /** Season clock update (number + seconds left). */
  onSeason?: (number: number, timeLeft: number) => void;
  /** A season ended (winner faction, or NO_FACTION for a stalemate). */
  onSeasonEnd?: (winner: number, number: number) => void;
  /** War clock changed: the shrinking-border battle state + score + wins. */
  onWar?: (active: boolean, timeLeft: number, nextIn: number, duration: number,
    score: number[], wins: number[]) => void;
  /** A war ended: the most-kills faction won it (NO_FACTION = draw). */
  onWarEnd?: (winner: number, score: number[]) => void;
  /** Capture-the-flag state changed (also fires once from `welcome`). */
  onFlags?: (breakable: boolean,
    flags: { faction: number; holder: number; hp: number; carrier: number }[]) => void;
  /** A flag was taken / returned / captured (drives banners + notices). */
  onFlagEvent?: (kind: 'taken' | 'returned' | 'captured', faction: number,
    by: string, holder: number) => void;
  // --- WARFARE COMMAND ---
  /** YOUR authoritative technology state (welcome + after every change). */
  onWarfare?: (xp: number, nodes: string[]) => void;
  /** A boss you helped kill paid out warfare XP. */
  onWarfareXp?: (amount: number, tier: number, total: number, boss: string) => void;
  /** A warfare action was refused, with the reason to show. */
  onWarfareErr?: (reason: string) => void;
  /** Strategic hardware state changed (or was removed). */
  onSilo?: (state: SiloState) => void;
  onSiloGone?: (id: number, x: number, y: number, z: number) => void;
  onBattery?: (state: BatteryState) => void;
  onBatteryGone?: (id: number, x: number, y: number, z: number) => void;
  /** Periodic missile positions + the discrete flight events. */
  onMissiles?: (list: MissileSnapshot[]) => void;
  onMissileLaunch?: (missile: MissileSnapshot, siloId: number) => void;
  onInterceptorLaunch?: (missile: MissileSnapshot, batteryId: number) => void;
  onMissileEnd?: (id: number, reason: 'impact' | 'intercepted' | 'shot' | 'expired',
    x: number, y: number, z: number, radius: number) => void;
  /** An inbound strike is on its way (drives the warning banner + map ping). */
  onStrikeWarning?: (faction: number, x: number, z: number, eta: number, radius: number) => void;
  /** Areas a strike may never be aimed into (drawn on the targeting map). */
  onProtectedAreas?: (areas: ProtectedArea[]) => void;
  /** A launch request was refused. */
  onLaunchRejected?: (reason: LaunchReject, text: string) => void;
  /** Helicopters + their falling bombs. */
  onHelis?: (list: HelicopterSnapshot[], bombs: BombSnapshot[]) => void;
  /** YOUR seat changed (null = you are on your feet again). */
  onHeliSeat?: (id: number, seat: SeatKind | null) => void;
  onHeliDown?: (
    id: number, x: number, y: number, z: number, faction: number, reason: HeliLossReason,
  ) => void;
  onHeliGone?: (id: number) => void;
  /** You were thrown clear of a bursting airframe, with an impulse to match. */
  onEjected?: (
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    reason: HeliLossReason,
  ) => void;
  /** Private confirmation of YOUR secret faction switch (Phase 7). */
  onFactionSwitched?: (faction: number, remaining: number) => void;
  /** Play a gadget visual effect (frag/oil blast, smoke cloud) at a point. */
  onGadgetFx?: (kind: string, x: number, y: number, z: number) => void;
  /** A player is disguised as `faction` until `until` (server worldTime). */
  onDisguised?: (id: number, faction: number, until: number) => void;
  /** A player changed their avatar cosmetics (their info is already updated). */
  onCosmetics?: (id: number) => void;
  /** A register/login was rejected (the login screen shows the error). */
  onAuthErr?: (error: string, lockMs?: number, permanent?: boolean) => void;
  /** A fresh session token arrived (store it for password-less resume). */
  onSession?: (token: string) => void;
  /** Lifesteal: the local player's authoritative hearts count changed. */
  onHearts?: (hearts: number, reason: string, from?: string) => void;
  /** Lifesteal: YOU were eliminated (0 hearts) — banner before the boot. */
  onEliminated?: (by: string, until: number) => void;
  /** Revival Beacon: the eliminated faction-mates you could revive. */
  onReviveList?: (targets: { username: string; remainingMs: number }[]) => void;
  /** Revival Beacon: result of a revive attempt (ok consumes the beacon). */
  onRevived?: (target: string, ok: boolean) => void;
  /** Waypoint Totems: the authoritative attuned list changed (B4). */
  onAttuned?: (totems: { x: number; y: number; z: number }[]) => void;
  /** Vaults (Milestone D): a vault's authoritative boss state (enter reply /
   *  hit broadcast). `opened` is only present on the direct enter reply. */
  onVault?: (cx: number, cz: number, tier: number, hp: number, maxHp: number,
    alive: boolean, opened?: boolean) => void;
  /** The Vault Brute fell (banner + fame). */
  onVaultCleared?: (cx: number, cz: number, by: string) => void;
  /** YOUR per-player vault loot was granted (items arrive via gotitem). */
  onVaultLooted?: (cx: number, cz: number) => void;
  onEncounterStart?: (cx: number, cz: number, data: {
    encounterId: string; family: VaultFamily; kind: VaultBossKind; tier: VaultTier;
    startTime: number; seed: number; scaling: number;
    cameraAnchors: { x: number; y: number; z: number }[];
    snapshot: EncounterSnapshot;
  }) => void;
  onEncounterSnapshot?: (cx: number, cz: number, snapshot: EncounterSnapshot) => void;
  onEncounterEvent?: (cx: number, cz: number, event: EncounterEvent) => void;
  onEncounterEnd?: (cx: number, cz: number,
    outcome: 'victory' | 'reset' | 'abandonment', credited?: string) => void;

  private ws: WebSocket | null = null;
  private xformAcc = 0;

  /** Begin connecting. Falls back to offline after `timeoutMs`. */
  connect(timeoutMs = 2500): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      this.offline = true;
      return;
    }
    this.ws = ws;
    // Offline is decided by whether the socket OPENS (server reachable), NOT by
    // whether `welcome` arrives — with mandatory login the welcome only comes
    // after the player authenticates, which can be long after this timeout.
    const timer = setTimeout(() => {
      if (!this.socketOpen) { this.offline = true; this.close(); }
    }, timeoutMs);

    ws.onopen = () => { this.socketOpen = true; clearTimeout(timer); };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data as string) as ServerMsg; } catch { return; }
      this.handle(msg);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      if (!this.socketOpen) this.offline = true;
    };
    ws.onclose = () => {
      clearTimeout(timer);
      this.socketOpen = false;
      if (this.connected) {
        this.connected = false;
        this.isOp = false; // re-granted by the server on the next successful auth
        this.remotes.clear();
        this.netItems.clear();
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
        this.netItems.clear();
        for (const it of msg.items) this.netItems.set(it.eid, it);
        for (const tr of msg.turrets) this.onTurret?.(tr.x, tr.y, tr.z, tr.state);
        this.onSeason?.(msg.season.number, msg.season.timeLeft);
        this.onWar?.(msg.war.active, msg.war.timeLeft, msg.war.nextIn,
          msg.war.duration, msg.war.score, msg.war.wins);
        this.onFlags?.(msg.flags.breakable, msg.flags.flags);
        this.onWarfare?.(msg.warfare.xp, msg.warfare.nodes);
        for (const st of msg.silos) this.onSilo?.(st);
        for (const st of msg.batteries) this.onBattery?.(st);
        this.onHelis?.(msg.helis, []);
        this.onProtectedAreas?.(msg.protectedAreas);
        const me = msg.players.find((p) => p.id === this.myId);
        // Restore saved inventory BEFORE onWelcome (which adopts the server
        // position) so the comeback loadout/inventory is in place from frame one.
        if (msg.state) this.onRestoreState?.(msg.state);
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
      case 'snapshot': {
        // One receive time for the whole batch: every transform in a snapshot
        // describes the same server instant, so they must share a stamp or the
        // avatars would drift apart from each other.
        const at = netNow();
        for (const s of msg.players) {
          if (s.id === this.myId) { this.onSelfHealth?.(s.health, s.dead); continue; }
          const r = this.remotes.get(s.id);
          if (r) {
            r.tx = s.x; r.ty = s.y; r.tz = s.z;
            r.tyaw = s.yaw; r.tpitch = s.pitch;
            r.buf.push({ t: at, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
            r.health = s.health; r.dead = s.dead;
            r.gliding = s.gliding === true;
            r.boating = s.boating === true;
            r.sneaking = s.sneaking === true;
            r.held = typeof s.held === 'number' ? s.held : 0;
            if (Array.isArray(s.armor)) r.armor = s.armor;
            r.swing = typeof s.swing === 'number' ? s.swing : r.swing;
            r.aiming = s.aiming === true;
            r.reloading = s.reloading === true;
          }
        }
        break;
      }
      case 'gamemode': {
        const r = this.remotes.get(msg.id);
        if (r) r.info.mode = msg.mode;          // keep remote rendering in step
        if (msg.id === this.myId) this.onGamemode?.(msg.mode);
        break;
      }
      case 'teleport':
        this.onTeleport?.(msg.x, msg.y, msg.z);
        break;
      case 'ejected':
        this.onEjected?.(msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz, msg.reason);
        break;
      case 'notice':
        this.onNotice?.(msg.text);
        break;
      case 'tpaRequest':
        this.onTpaRequest?.(msg.from);
        break;
      case 'op':
        this.isOp = msg.op;
        this.onOpState?.(msg.op);
        break;
      case 'cmdOut':
        this.onCmdOut?.(msg.lines, msg.ok !== false);
        break;
      case 'edit':
        this.onEdit?.(msg.x, msg.y, msg.z, msg.block);
        break;
      case 'hurt':
        this.onHurt?.(msg.health, msg.dead, [msg.kx, msg.ky, msg.kz], msg.by);
        break;
      case 'hitconfirm':
        this.onHitConfirm?.(msg.target, msg.amount, msg.killed === true);
        break;
      case 'shot':
        this.onShot?.(msg.id, msg.item, msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz);
        break;
      case 'blast':
        this.onBlast?.(msg.x, msg.y, msg.z);
        break;
      case 'respawned':
        this.onRespawned?.(msg.x, msg.y, msg.z, msg.health);
        break;
      case 'killfeed':
        this.onKillfeed?.(msg.killer, msg.victim);
        break;
      case 'itemspawn':
        this.netItems.set(msg.item.eid, msg.item);
        break;
      case 'itemsmove':
        for (const m of msg.items) {
          const it = this.netItems.get(m.eid);
          if (it) { it.x = m.x; it.y = m.y; it.z = m.z; }
        }
        break;
      case 'itemremove':
        this.netItems.delete(msg.eid);
        break;
      case 'gotitem':
        this.onGotItem?.(msg.item, msg.count);
        break;
      case 'chest':
        this.onChest?.(msg.x, msg.y, msg.z, msg.slots);
        break;
      case 'machine':
        this.onMachine?.(msg.x, msg.y, msg.z, msg.state);
        break;
      case 'turret':
        this.onTurret?.(msg.x, msg.y, msg.z, msg.state);
        break;
      case 'turretFire':
        this.onTurretFire?.(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz);
        break;
      case 'season':
        this.onSeason?.(msg.number, msg.timeLeft);
        break;
      case 'war':
        this.onWar?.(msg.active, msg.timeLeft, msg.nextIn, msg.duration, msg.score, msg.wins);
        break;
      case 'warEnd':
        this.onWarEnd?.(msg.winner, msg.score);
        break;
      case 'flags':
        this.onFlags?.(msg.breakable, msg.flags);
        break;
      case 'flagEvent':
        this.onFlagEvent?.(msg.kind, msg.faction, msg.by, msg.holder);
        break;
      // --- WARFARE COMMAND ---
      case 'warfare':
        this.onWarfare?.(msg.xp, msg.nodes);
        break;
      case 'warfareXp':
        this.onWarfareXp?.(msg.amount, msg.tier, msg.total, msg.boss);
        break;
      case 'warfareErr':
        this.onWarfareErr?.(msg.reason);
        break;
      case 'silo':
        this.onSilo?.(msg.state);
        break;
      case 'siloGone':
        this.onSiloGone?.(msg.id, msg.x, msg.y, msg.z);
        break;
      case 'battery':
        this.onBattery?.(msg.state);
        break;
      case 'batteryGone':
        this.onBatteryGone?.(msg.id, msg.x, msg.y, msg.z);
        break;
      case 'missiles':
        this.onMissiles?.(msg.list);
        break;
      case 'missileLaunch':
        this.onMissileLaunch?.(msg.missile, msg.siloId);
        break;
      case 'interceptorLaunch':
        this.onInterceptorLaunch?.(msg.missile, msg.batteryId);
        break;
      case 'missileEnd':
        this.onMissileEnd?.(msg.id, msg.reason, msg.x, msg.y, msg.z, msg.radius);
        break;
      case 'strikeWarning':
        this.onStrikeWarning?.(msg.faction, msg.x, msg.z, msg.eta, msg.radius);
        break;
      case 'protectedAreas':
        this.onProtectedAreas?.(msg.areas);
        break;
      case 'launchRejected':
        this.onLaunchRejected?.(msg.reason, msg.text);
        break;
      case 'helis':
        this.onHelis?.(msg.list, msg.bombs);
        break;
      case 'heliSeat':
        this.onHeliSeat?.(msg.id, msg.seat);
        break;
      case 'heliDown':
        this.onHeliDown?.(msg.id, msg.x, msg.y, msg.z, msg.faction, msg.reason);
        break;
      case 'heliGone':
        this.onHeliGone?.(msg.id);
        break;
      case 'seasonEnd':
        this.onSeasonEnd?.(msg.winner, msg.number);
        break;
      case 'factionSwitched':
        this.onFactionSwitched?.(msg.faction, msg.remaining);
        break;
      case 'gadgetFx':
        this.onGadgetFx?.(msg.kind, msg.x, msg.y, msg.z);
        break;
      case 'disguised':
        this.onDisguised?.(msg.id, msg.faction, msg.until);
        break;
      case 'cosmetics': {
        const rc = this.remotes.get(msg.id);
        if (rc) rc.info.cosmetics = msg.c;
        this.onCosmetics?.(msg.id);
        break;
      }
      case 'authErr':
        this.onAuthErr?.(msg.error, msg.lockMs, msg.permanent);
        break;
      case 'session':
        this.onSession?.(msg.token);
        break;
      case 'hearts':
        this.onHearts?.(msg.hearts, msg.reason, msg.from);
        break;
      case 'eliminated':
        this.onEliminated?.(msg.by, msg.until);
        break;
      case 'reviveList':
        this.onReviveList?.(msg.targets);
        break;
      case 'revived':
        this.onRevived?.(msg.target, msg.ok);
        break;
      case 'attuned':
        this.onAttuned?.(msg.totems);
        break;
      case 'vault':
        this.onVault?.(msg.cx, msg.cz, msg.tier, msg.hp, msg.maxHp, msg.alive, msg.opened);
        break;
      case 'vaultCleared':
        this.onVaultCleared?.(msg.cx, msg.cz, msg.by);
        break;
      case 'vaultLooted':
        this.onVaultLooted?.(msg.cx, msg.cz);
        break;
      case 'encounterStart':
        {
        const snapshot = sanitizeEncounterSnapshot(msg.snapshot);
        if (!snapshot) break;
        this.onEncounterStart?.(msg.cx, msg.cz, {
          encounterId: msg.encounterId, family: msg.family, kind: msg.kind,
          tier: msg.tier, startTime: msg.startTime, seed: msg.seed,
          scaling: msg.scaling, cameraAnchors: msg.cameraAnchors,
          snapshot,
        });
        break;
        }
      case 'encounterSnapshot':
        {
          const snapshot = sanitizeEncounterSnapshot(msg.snapshot);
          if (snapshot) this.onEncounterSnapshot?.(msg.cx, msg.cz, snapshot);
        }
        break;
      case 'encounterEvent':
        if (msg.event && typeof msg.event.id === 'string' &&
            msg.event.id.length <= 192 && Number.isFinite(msg.event.executeAt)) {
          this.onEncounterEvent?.(msg.cx, msg.cz, msg.event);
        }
        break;
      case 'encounterEnd':
        this.onEncounterEnd?.(msg.cx, msg.cz, msg.outcome, msg.credited);
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
    dt: number, x: number, y: number, z: number, yaw: number, pitch: number,
    gliding = false, boating = false, sneaking = false, held = 0, armor: number[] = [], swing = 0,
    aiming = false, reloading = false, seated = false
  ): void {
    if (!this.connected) return;
    const interval = 1 / TRANSFORM_HZ;
    this.xformAcc += dt;
    if (this.xformAcc < interval) return;
    // Subtract the interval (don't zero) so the long-run rate matches
    // TRANSFORM_HZ; clamp to avoid a burst after a long stall.
    this.xformAcc = Math.min(this.xformAcc - interval, interval);
    this.raw({ t: 'xform', x, y, z, yaw, pitch, gliding, boating, seated, sneaking, held, armor,
      swing, aiming, reloading });
  }

  /** Send register/login over the open socket (before `welcome`/connected). */
  sendRegister(username: string, password: string, faction?: number): void {
    this.raw({ t: 'register', username, password, faction });
  }
  sendLogin(username: string, password: string): void {
    this.raw({ t: 'login', username, password });
  }
  /** Resume a saved session (token from a previous visit's `session` msg). */
  sendSession(username: string, token: string): void {
    this.raw({ t: 'session', username, token });
  }

  sendEdit(x: number, y: number, z: number, block: number): void {
    if (this.connected) this.raw({ t: 'edit', x, y, z, block });
  }
  /** Pull a lever (the server flips it + every linked trap). */
  /** Swing at the flag you're standing next to (the server picks which). */
  sendFlagHit(): void {
    if (this.connected) this.raw({ t: 'flagHit' });
  }

  sendLever(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'lever', x, y, z });
  }
  // TPA (teleport requests).
  sendTpa(target: string): void {
    if (this.connected) this.raw({ t: 'tpa', target });
  }
  sendTpaAccept(): void {
    if (this.connected) this.raw({ t: 'tpaAccept' });
  }
  /** Run an operator command server-side (rejected there unless we're OP). */
  sendCommand(text: string): boolean {
    if (!this.connected) return false;
    this.raw({ t: 'command', text });
    return true;
  }
  sendSelfHurt(amount: number): void {
    if (this.connected) this.raw({ t: 'selfhurt', amount });
  }
  /** Push owned state (inventory/hotbar) for the server to persist to the account. */
  sendSaveState(data: Record<string, unknown>): void {
    if (this.connected) this.raw({ t: 'saveState', data });
  }
  sendRespawn(): void {
    if (this.connected) this.raw({ t: 'respawn' });
  }
  sendDrop(items: { id: number; count: number }[], x: number, y: number, z: number): void {
    if (this.connected && items.length) this.raw({ t: 'drop', items, x, y, z });
  }
  sendPickup(eid: number): void {
    if (this.connected) this.raw({ t: 'pickup', eid });
  }
  sendChestOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'chestOpen', x, y, z });
  }
  sendChestSet(x: number, y: number, z: number, slots: (ItemStack | null)[]): void {
    if (this.connected) this.raw({ t: 'chestSet', x, y, z, slots });
  }
  sendCosmetics(c: Cosmetics): void {
    if (this.connected) this.raw({ t: 'cosmetics', c });
  }
  sendArmor(points: number, toughness = 0): void {
    if (this.connected) this.raw({ t: 'armor', points, toughness });
  }
  sendMachineOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'machineOpen', x, y, z });
  }
  sendMachineConfig(x: number, y: number, z: number, filter: number): void {
    if (this.connected) this.raw({ t: 'machineConfig', x, y, z, filter });
  }
  sendMachineUpgrade(x: number, y: number, z: number, axis: UpgradeAxis): void {
    if (this.connected) this.raw({ t: 'machineUpgrade', x, y, z, axis });
  }
  sendMachineCollect(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'machineCollect', x, y, z });
  }
  sendMachineHit(x: number, y: number, z: number, amount: number): void {
    if (this.connected) this.raw({ t: 'machineHit', x, y, z, amount });
  }
  sendMachineClaim(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'machineClaim', x, y, z });
  }
  sendMachineMove(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    if (this.connected) this.raw({ t: 'machineMove', x, y, z, tx, ty, tz });
  }
  sendSetSpawn(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'setSpawn', x, y, z });
  }
  sendRangedAttack(target: number, amount: number): void {
    if (this.connected) this.raw({ t: 'rangedAttack', target, amount });
  }
  /** Cosmetic "I fired" report, sent once per trigger pull (NOT per pellet —
   *  receivers re-roll the spread themselves from the gun's own stats). */
  sendShot(
    x: number, y: number, z: number, dx: number, dy: number, dz: number, item: number,
  ): void {
    if (this.connected) this.raw({ t: 'shot', x, y, z, dx, dy, dz, item });
  }
  // Turrets.
  sendTurretOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'turretOpen', x, y, z });
  }
  sendTurretUpgrade(x: number, y: number, z: number, axis: TurretAxis): void {
    if (this.connected) this.raw({ t: 'turretUpgrade', x, y, z, axis });
  }
  sendTurretClaim(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'turretClaim', x, y, z });
  }
  sendTurretLoad(x: number, y: number, z: number, item: number, count: number): void {
    if (this.connected) this.raw({ t: 'turretLoad', x, y, z, item, count });
  }
  sendTurretHit(x: number, y: number, z: number, amount: number): void {
    if (this.connected) this.raw({ t: 'turretHit', x, y, z, amount });
  }
  sendRocketBlast(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'rocketBlast', x, y, z });
  }

  sendSwitchFaction(faction: number): void { if (this.connected) this.raw({ t: 'switchFaction', faction }); }
  /** Report mob-kill XP (server clamps + feeds the faction pool). */
  // --- WARFARE COMMAND ---
  sendWarfareBuy(node: string): void { if (this.connected) this.raw({ t: 'warfareBuy', node }); }
  sendSiloOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'siloOpen', x, y, z });
  }
  sendSiloLoad(x: number, y: number, z: number, count: number): void {
    if (this.connected) this.raw({ t: 'siloLoad', x, y, z, count });
  }
  sendSiloUpgrade(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'siloUpgrade', x, y, z });
  }
  sendSiloLaunch(x: number, y: number, z: number, tx: number, tz: number): void {
    if (this.connected) this.raw({ t: 'siloLaunch', x, y, z, tx, tz });
  }
  sendBatteryOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'batteryOpen', x, y, z });
  }
  sendBatteryLoad(x: number, y: number, z: number, count: number): void {
    if (this.connected) this.raw({ t: 'batteryLoad', x, y, z, count });
  }
  sendBatteryUpgrade(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'batteryUpgrade', x, y, z });
  }
  sendStrategicHit(kind: 'silo' | 'battery', x: number, y: number, z: number, amount: number): void {
    if (this.connected) this.raw({ t: 'strategicHit', kind, x, y, z, amount });
  }
  sendMissileHit(id: number, amount: number): void {
    if (this.connected) this.raw({ t: 'missileHit', id, amount });
  }
  sendHeliSpawn(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'heliSpawn', x, y, z });
  }
  sendHeliDeploy(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'heliDeploy', x, y, z });
  }
  sendHeliMount(id: number, seat?: SeatKind): void {
    if (this.connected) this.raw({ t: 'heliMount', id, seat });
  }
  sendHeliDismount(): void { if (this.connected) this.raw({ t: 'heliDismount' }); }
  sendHeliInput(forward: number, strafe: number, lift: number, yaw: number, seq: number): void {
    if (this.connected) this.raw({ t: 'heliInput', forward, strafe, lift, yaw, seq });
  }
  sendHeliBomb(): void { if (this.connected) this.raw({ t: 'heliBomb' }); }
  sendHeliService(id: number, oil: number, bombs: number, repair: number): void {
    if (this.connected) this.raw({ t: 'heliService', id, oil, bombs, repair });
  }
  sendHeliUpgrade(id: number): void { if (this.connected) this.raw({ t: 'heliUpgrade', id }); }
  sendHeliHit(id: number, amount: number): void {
    if (this.connected) this.raw({ t: 'heliHit', id, amount });
  }
  // Lifesteal (Milestone A).
  sendHeartConsume(): void { if (this.connected) this.raw({ t: 'heartConsume' }); }
  sendHeartWithdraw(): void { if (this.connected) this.raw({ t: 'heartWithdraw' }); }
  sendUseHeal(item: number): void { if (this.connected) this.raw({ t: 'useHeal', item }); }
  sendReviveList(): void { if (this.connected) this.raw({ t: 'reviveList' }); }
  sendBeaconRevive(target: string): void {
    if (this.connected) this.raw({ t: 'beaconRevive', target });
  }
  // Waypoint Totems (B4).
  sendAttune(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'attune', x, y, z });
  }
  sendTotemTeleport(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'totemTeleport', x, y, z });
  }
  sendGadgetUse(item: number, x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'gadgetUse', item, x, y, z });
  }
  // Vaults (Milestone D).
  sendVaultEnter(cx: number, cz: number): void {
    if (this.connected) this.raw({ t: 'vaultEnter', cx, cz });
  }
  sendVaultAttack(cx: number, cz: number, intent: VaultAttackIntent): void {
    if (this.connected) this.raw({ t: 'vaultAttack', cx, cz, intent });
  }
  sendVaultChestOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'vaultChestOpen', x, y, z });
  }
}

function toRemote(p: PlayerInfo): Remote {
  const buf = new TransformBuffer();
  buf.reset({ t: netNow(), x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  return {
    info: p, buf, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, tpitch: p.pitch,
    health: p.health, dead: p.dead, gliding: p.gliding === true,
    boating: p.boating === true, seated: p.seated === true, sneaking: p.sneaking === true,
    held: typeof p.held === 'number' ? p.held : 0,
    armor: Array.isArray(p.armor) ? p.armor : [0, 0, 0, 0],
    swing: typeof p.swing === 'number' ? p.swing : 0,
    aiming: p.aiming === true, reloading: p.reloading === true,
  };
}
