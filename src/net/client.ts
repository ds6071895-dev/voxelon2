// Browser-side network client. Connects to the VOXELON server, tracks remote
// players (a timestamped transform history per player, which the renderer
// replays on a fixed delay — see interp.ts), and exposes send helpers + event
// callbacks. Fails gracefully to offline mode so the game is fully playable
// with no server running.

import { INTERP_DELAY, SenderClock, StateTimeline, TransformBuffer, netNow } from '../interp';
import type { ItemStack } from '../items';
import type { MachineAct, MachineState, UpgradeAxis } from '../machines';
import type { EffectKind, TrapFxWhat, TrapKind, TrapState } from '../traps';
import type { TurretState, TurretAxis } from '../turrets';
import {
  ClientMsg, DuelLeaderboardEntry, GameMode, ItemEntityInfo, PlayerInfo, SERVER_PORT, ServerMsg,
  TRANSFORM_HZ,
} from './protocol';
import type { MobWire, PlayerCounts } from './protocol';
import type { Cosmetics } from '../character';
import type {
  EncounterEvent, EncounterSnapshot, VaultAttackIntent,
} from '../vault_encounter';
import { sanitizeEncounterSnapshot } from '../vault_encounter';
import type { VaultBossKind, VaultFamily, VaultTier } from '../vaults';
import type {
  BombSnapshot, HeliLossReason, HelicopterSnapshot, SeatKind,
} from '../vehicles';
import type { DuelArenaBounds, DuelLobbySnapshot, DuelResult } from '../duels';
import type { BwArenaBounds, BwLobbySnapshot, BwResult, BwStage } from '../bedwars';
import type {
  PartyArenaBounds, PartyLobbySnapshot, PartyMode, PartyResult, PartySubBounds,
} from '../partygames';
import type { DuelFlair, DuelPublicProfile } from '../duels_progression';
import type { FactionPublic } from './protocol';

export interface Remote {
  info: PlayerInfo;
  /** Newest networked transform. Kept for code that only needs "where are they
   *  right now, roughly" (map markers, nameplate culling); anything that has to
   *  match what the player SEES — rendering, hit tests — must go through `buf`. */
  tx: number; ty: number; tz: number; tyaw: number; tpitch: number;
  /** Timestamped transform history, replayed INTERP_DELAY behind the local
   *  clock so the avatar moves smoothly instead of easing toward each packet. */
  buf: TransformBuffer;
  /** Maps this player's relayed sample clock onto ours for `buf`. */
  clock: SenderClock;
  /** Receive time of the last snapshot that included this player. */
  seenAt: number;
  /** Pose/action history on `buf`'s timeline. The fields below are only set
   *  from it by `applyRemotePoses`, so they describe the same instant as the
   *  drawn body rather than running INTERP_DELAY ahead of it. */
  poses: StateTimeline<RemotePose>;
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

/** The part of a Remote that is replayed on the render timeline. */
export type RemotePose = Pick<Remote,
  'gliding' | 'boating' | 'seated' | 'sneaking' | 'held' | 'armor' | 'swing' | 'aiming' | 'reloading'>;

function poseOf(s: {
  gliding?: boolean; boating?: boolean; seated?: boolean; sneaking?: boolean; held?: number;
  armor?: number[]; swing?: number; aiming?: boolean; reloading?: boolean;
}, prev?: RemotePose): RemotePose {
  return {
    gliding: s.gliding === true, boating: s.boating === true,
    seated: s.seated === true, sneaking: s.sneaking === true,
    held: typeof s.held === 'number' ? s.held : 0,
    armor: Array.isArray(s.armor) ? s.armor : prev?.armor ?? [0, 0, 0, 0],
    swing: typeof s.swing === 'number' ? s.swing : prev?.swing ?? 0,
    aiming: s.aiming === true, reloading: s.reloading === true,
  };
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
  /** Open world only: stretch the playback delay when packets run late. The
   *  arenas keep the fixed INTERP_DELAY their lag compensation is tuned to. */
  adaptiveDelay = false;
  /** Decaying peak of how late samples arrive past their timeline slot (s). */
  private latePeak = 0;
  private lateAt = 0;
  private delayApplied = INTERP_DELAY;
  /** Server-owned dropped items, keyed by entity id (for the renderer). */
  readonly netItems = new Map<number, ItemEntityInfo>();
  /** Latest server-authoritative population by mode. */
  playerCounts: PlayerCounts | null = null;

  /** Fired once the server welcome arrives (multiplayer is now live). */
  onWelcome?: (info: PlayerInfo) => void;
  onSocketOpen?: () => void;
  onDuelInviteInfo?: (valid: boolean, host?: string, lobbyId?: string) => void;
  onPlayerCounts?: (counts: PlayerCounts) => void;
  onDuelQueue?: (queued: boolean) => void;
  /** Persistent authoritative day/night clock, refreshed with every snapshot. */
  onWorldTime?: (seconds: number) => void;
  onDuelLobby?: (snapshot: DuelLobbySnapshot, inviteToken?: string) => void;
  onDuelError?: (code: string, message: string) => void;
  onDuelArena?: (arena: DuelArenaBounds, spawn: { x: number; y: number; z: number },
    countdownEndsAt: number) => void;
  onDuelLoadout?: (slots: (ItemStack | null)[], armor: (ItemStack | null)[],
    selected: number, unlimitedReserve: boolean) => void;
  onDuelClock?: (serverNow: number, endsAt: number, suddenDeath: boolean) => void;
  onDuelRespawn?: (respawnAt: number, spectating: boolean) => void;
  onDuelResult?: (result: DuelResult) => void;
  onDuelProfile?: (profile: DuelPublicProfile, leaderboard: DuelLeaderboardEntry[]) => void;
  onDuelLeaderboard?: (leaderboard: DuelLeaderboardEntry[]) => void;
  onDuelProfileUpdate?: (id: number) => void;
  onDuelRestored?: (x: number, y: number, z: number, yaw: number, pitch: number, health: number,
    dead: boolean, mode: GameMode, state?: Record<string, unknown>) => void;
  // --- Bedwars ---
  onBwQueue?: (queued: boolean) => void;
  onBwLobby?: (snapshot: BwLobbySnapshot, inviteToken?: string) => void;
  onBwError?: (code: string, message: string) => void;
  onBwArena?: (arena: BwArenaBounds, spawn: { x: number; y: number; z: number },
    team: number, countdownEndsAt: number) => void;
  onBwLoadout?: (slots: (ItemStack | null)[], selected: number, axe: number, upgrade: boolean) => void;
  onBwGrant?: (items: ItemStack[]) => void;
  onBwResources?: (iron: number, gold: number, diamond: number) => void;
  onBwHit?: (target: number, amount: number, combo: number, charge: number,
    crit: boolean, killed: boolean) => void;
  onBwBedBroken?: (team: number, by: number) => void;
  onBwClock?: (serverNow: number, endsAt: number, stage: BwStage) => void;
  onBwRespawn?: (respawnAt: number, spectating: boolean) => void;
  onBwResult?: (result: BwResult) => void;
  // --- The Bridge / Parkour ---
  onPartyQueue?: (queued: boolean) => void;
  onPartyLobby?: (snapshot: PartyLobbySnapshot, inviteToken?: string) => void;
  onPartyError?: (code: string, message: string) => void;
  onPartyArena?: (arena: PartyArenaBounds, sub: PartySubBounds, team: number,
    spawn: { x: number; y: number; z: number }, countdownEndsAt: number) => void;
  onPartyLoadout?: (slots: (ItemStack | null)[], selected: number) => void;
  onPartyHit?: (target: number, amount: number, combo: number, charge: number,
    crit: boolean, killed: boolean, ranged: boolean) => void;
  onPartyArrow?: (a: { id: number; by: number; x: number; y: number; z: number;
    dx: number; dy: number; dz: number; speed: number; power: number }) => void;
  onPartyArrowEnd?: (id: number, x: number, y: number, z: number, hit: boolean) => void;
  onPartyResult?: (result: PartyResult) => void;
  /** Saved per-account state to restore (inventory/hotbar), if the account has any. */
  onRestoreState?: (state: Record<string, unknown>) => void;
  /** A block edit from another player (apply without re-broadcasting). */
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  /** Bulk world change, allowing the renderer to remesh touched chunks once. */
  onEditBatch?: (edits: { x: number; y: number; z: number; block: number }[]) => void;
  /** Server-authoritative health change for the local player. `by` is the id of
   *  whoever dealt it (used for the directional damage indicator; it is the
   *  local id, or an unknown id, for non-player damage). */
  onHurt?: (health: number, dead: boolean, k: [number, number, number], by: number,
    combat: number) => void;
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
  onKillfeed?: (killer: string, victim: string, how?: string) => void;
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
  /** A player left our world (quit, arena, disconnect). */
  onLeave?: (id: number) => void;
  /** Another player's mobs near us. */
  onMobs?: (owner: number, mobs: MobWire[], gone: number[]) => void;
  /** Someone hit one of our mobs. */
  onMobHit?: (from: number, nid: number, dmg: number, kx: number, kz: number) => void;
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
  /** A rig event (jam, gusher, well fire…) for FX + notices. */
  onMachineFx?: (x: number, y: number, z: number, fx: string) => void;
  /** Trap state sync (null = removed). */
  onTrap?: (x: number, y: number, z: number, state: TrapState | null) => void;
  /** Full trap list (welcome). */
  onTraps?: (traps: [string, TrapState][]) => void;
  /** A trap fired / armed / reset (animation + sound). */
  onTrapFx?: (x: number, y: number, z: number, kind: TrapKind, what: TrapFxWhat,
    tx?: number, ty?: number, tz?: number) => void;
  /** A status effect landed on us. */
  onEffect?: (kind: EffectKind, seconds: number) => void;
  /** One of our (or our faction's) alarm bells rang. */
  onAlarm?: (x: number, y: number, z: number, owner: string, intruder: string) => void;
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
  /** Helicopters + their falling bombs. */
  onHelis?: (list: HelicopterSnapshot[], bombs: BombSnapshot[]) => void;
  /** YOUR seat changed (null = you are on your feet again). */
  onHeliSeat?: (id: number, seat: SeatKind | null) => void;
  onHeliRopeState?: (id: number, progress: number) => void;
  onHeliModuleInstalled?: (id: number, item: number) => void;
  onHeliDown?: (
    id: number, x: number, y: number, z: number, faction: number, reason: HeliLossReason,
  ) => void;
  onHeliGone?: (id: number) => void;
  onHeliCrash?: (id: number, x: number, y: number, z: number) => void;
  /** You were thrown clear of a bursting airframe, with an impulse to match. */
  onEjected?: (
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    reason: HeliLossReason,
  ) => void;
  /** Private confirmation of YOUR secret faction switch (Phase 7). */
  onFactionSwitched?: (faction: number, remaining: number) => void;
  // --- FACTIONS ---------------------------------------------------------------
  /** The public faction dossiers the pledge screen reads. */
  onFactions?: (factions: FactionPublic[]) => void;
  /** Your allegiance landed — you are a citizen of `faction` from now on. */
  onPledged?: (faction: number) => void;
  /** A pledge was refused. */
  onGovErr?: (reason: string) => void;
  /** Play a gadget visual effect (frag/oil blast, smoke cloud) at a point. */
  onGadgetFx?: (kind: string, x: number, y: number, z: number) => void;
  /** Another player threw a gadget: fly it from (x,y,z) with (vx,vy,vz). */
  onGadgetThrown?: (id: number, item: number, x: number, y: number, z: number,
    vx: number, vy: number, vz: number) => void;
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
  arenaRevision: number | undefined;

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

    ws.onopen = () => { this.socketOpen = true; clearTimeout(timer); this.onSocketOpen?.(); };
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
        this.playerCounts = null;
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
        for (const rig of msg.machines ?? []) this.onMachine?.(rig.x, rig.y, rig.z, rig.state);
        this.onTraps?.(msg.traps ?? []);
        for (const tr of msg.turrets) this.onTurret?.(tr.x, tr.y, tr.z, tr.state);
        this.onSeason?.(msg.season.number, msg.season.timeLeft);
        this.onWar?.(msg.war.active, msg.war.timeLeft, msg.war.nextIn,
          msg.war.duration, msg.war.score, msg.war.wins);
        this.onFlags?.(msg.flags.breakable, msg.flags.flags);
        this.onWarfare?.(msg.warfare.xp, msg.warfare.nodes);
        this.onHelis?.(msg.helis, []);
        this.onFactions?.(msg.factions ?? []);
        this.onDuelProfile?.(msg.duelProfile, msg.duelLeaderboard);
        this.onWorldTime?.(msg.worldTime);
        const me = msg.players.find((p) => p.id === this.myId);
        // Restore saved inventory BEFORE onWelcome (which adopts the server
        // position) so the comeback loadout/inventory is in place from frame one.
        if (msg.state) this.onRestoreState?.(msg.state);
        if (me) this.onWelcome?.(me);
        this.onRoster?.();
        break;
      }
      case 'playerCounts': {
        this.playerCounts = {
          play: msg.play, duels: msg.duels, parkour: msg.parkour, bridge: msg.bridge,
        };
        this.onPlayerCounts?.(this.playerCounts);
        break;
      }
      case 'join':
        if (msg.player.id !== this.myId) {
          // A re-announce of someone already here (back from the menu or an
          // arena) refreshes their info without throwing away the motion
          // history — a fresh buffer would pop the body.
          const known = this.remotes.get(msg.player.id);
          if (known) known.info = msg.player;
          else this.remotes.set(msg.player.id, toRemote(msg.player));
          this.onRoster?.();
        }
        break;
      case 'leave':
        this.remotes.delete(msg.id);
        this.onLeave?.(msg.id);
        this.onRoster?.();
        break;
      case 'mobs':
        this.onMobs?.(msg.owner, Array.isArray(msg.mobs) ? msg.mobs : [],
          Array.isArray(msg.gone) ? msg.gone : []);
        break;
      case 'mobHit':
        this.onMobHit?.(msg.from, msg.nid, msg.dmg, msg.kx, msg.kz);
        break;
      case 'snapshot': {
        this.onWorldTime?.(msg.worldTime);
        // One receive time for the whole batch: every transform in a snapshot
        // describes the same server instant, so they must share a stamp or the
        // avatars would drift apart from each other.
        const at = netNow();
        for (const s of msg.players) {
          if (s.id === this.myId) { this.onSelfHealth?.(s.health, s.dead); continue; }
          const r = this.remotes.get(s.id);
          if (r) {
            r.seenAt = at;
            r.tx = s.x; r.ty = s.y; r.tz = s.z;
            r.tyaw = s.yaw; r.tpitch = s.pitch;
            // Place the sample on its owner's timeline when the server relays
            // one; older servers fall back to the batch receive time.
            const pose = poseOf(s, r);
            if (typeof s.ct === 'number') {
              const m = r.clock.map(s.ct, at);
              if (m && !m.restarted) this.noteLateness(at - m.t, at);
              if (m) {
                const sample = { t: m.t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
                if (m.restarted) {
                  r.buf.reset(sample);
                  r.poses.reset(m.t, pose);
                } else {
                  r.buf.push(sample);
                  r.poses.push(m.t, pose);
                }
              } else if (Number.isFinite(r.buf.newest)) {
                // A re-relay of the last transform: any pose change the server
                // made on its own (arena entry, dismount) rides the newest sample.
                r.poses.push(r.buf.newest, pose);
              }
            } else {
              r.buf.push({ t: at, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
              r.poses.push(at, pose);
            }
            r.health = s.health; r.dead = s.dead;
          }
        }
        // A snapshot lists every player this client can see. One the server
        // has left out for a while is gone from our scope, whether or not its
        // `leave` ever reached us — never keep drawing a frozen body.
        let pruned = false;
        for (const [id, r] of this.remotes) {
          if (at - r.seenAt > STALE_REMOTE_S) { this.remotes.delete(id); pruned = true; }
        }
        if (pruned) this.onRoster?.();
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
      case 'editBatch':
        if (this.onEditBatch) this.onEditBatch(msg.edits);
        else for (const e of msg.edits) this.onEdit?.(e.x, e.y, e.z, e.block);
        break;
      case 'hurt':
        this.onHurt?.(msg.health, msg.dead, [msg.kx, msg.ky, msg.kz], msg.by, msg.combat ?? 0);
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
        this.onKillfeed?.(msg.killer, msg.victim, msg.how);
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
      case 'machineFx':
        this.onMachineFx?.(msg.x, msg.y, msg.z, msg.fx);
        break;
      case 'trap':
        this.onTrap?.(msg.x, msg.y, msg.z, msg.state);
        break;
      case 'trapFx':
        this.onTrapFx?.(msg.x, msg.y, msg.z, msg.kind, msg.what, msg.tx, msg.ty, msg.tz);
        break;
      case 'effect':
        this.onEffect?.(msg.kind, msg.seconds);
        break;
      case 'alarm':
        this.onAlarm?.(msg.x, msg.y, msg.z, msg.owner, msg.intruder);
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
      case 'helis':
        this.onHelis?.(msg.list, msg.bombs);
        break;
      case 'heliSeat':
        this.onHeliSeat?.(msg.id, msg.seat);
        break;
      case 'heliRopeState':
        this.onHeliRopeState?.(msg.id, msg.progress);
        break;
      case 'heliModuleInstalled':
        this.onHeliModuleInstalled?.(msg.id, msg.item);
        break;
      case 'heliDown':
        this.onHeliDown?.(msg.id, msg.x, msg.y, msg.z, msg.faction, msg.reason);
        break;
      case 'heliGone':
        this.onHeliGone?.(msg.id);
        break;
      case 'heliCrash':
        this.onHeliCrash?.(msg.id, msg.x, msg.y, msg.z);
        break;
      case 'seasonEnd':
        this.onSeasonEnd?.(msg.winner, msg.number);
        break;
      case 'factionSwitched':
        this.onFactionSwitched?.(msg.faction, msg.remaining);
        break;
      case 'factions':
        this.onFactions?.(msg.factions);
        break;
      case 'pledged':
        this.onPledged?.(msg.faction);
        break;
      case 'govErr':
        this.onGovErr?.(msg.reason);
        break;
      case 'gadgetFx':
        this.onGadgetFx?.(msg.kind, msg.x, msg.y, msg.z);
        break;
      case 'gadgetThrown':
        this.onGadgetThrown?.(msg.id, msg.item, msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz);
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
      case 'duelLobby':
        this.onDuelLobby?.(msg.snapshot, msg.inviteToken);
        break;
      case 'bwLobby':
        this.onBwLobby?.(msg.snapshot, msg.inviteToken);
        break;
      case 'bwQueue':
        this.onBwQueue?.(msg.queued);
        break;
      case 'bwError':
        this.onBwError?.(msg.code, msg.message);
        break;
      case 'bwArena':
        this.onBwArena?.(msg.arena, msg.spawn, msg.team, msg.countdownEndsAt);
        break;
      case 'bwLoadout':
        this.onBwLoadout?.(msg.slots, msg.selected, msg.axe, msg.upgrade ?? false);
        break;
      case 'bwGrant':
        this.onBwGrant?.(msg.items);
        break;
      case 'bwResources':
        this.onBwResources?.(msg.iron, msg.gold, msg.diamond);
        break;
      case 'bwHit':
        this.onBwHit?.(msg.target, msg.amount, msg.combo, msg.charge, msg.crit, msg.killed);
        break;
      case 'bwBedBroken':
        this.onBwBedBroken?.(msg.team, msg.by);
        break;
      case 'bwClock':
        this.onBwClock?.(msg.serverNow, msg.endsAt, msg.stage);
        break;
      case 'bwRespawn':
        this.onBwRespawn?.(msg.respawnAt, msg.spectating);
        break;
      case 'bwResult':
        this.onBwResult?.(msg.result);
        break;
      case 'partyLobby':
        this.onPartyLobby?.(msg.snapshot, msg.inviteToken);
        break;
      case 'partyQueue':
        this.onPartyQueue?.(msg.queued);
        break;
      case 'partyError':
        this.onPartyError?.(msg.code, msg.message);
        break;
      case 'partyArena':
        this.onPartyArena?.(msg.arena, msg.sub, msg.team, msg.spawn, msg.countdownEndsAt);
        break;
      case 'partyLoadout':
        this.onPartyLoadout?.(msg.slots, msg.selected);
        break;
      case 'partyHit':
        this.onPartyHit?.(msg.target, msg.amount, msg.combo, msg.charge, msg.crit, msg.killed, msg.ranged);
        break;
      case 'partyArrow':
        this.onPartyArrow?.(msg);
        break;
      case 'partyArrowEnd':
        this.onPartyArrowEnd?.(msg.id, msg.x, msg.y, msg.z, msg.hit);
        break;
      case 'partyResult':
        this.onPartyResult?.(msg.result);
        break;
      case 'duelInviteInfo':
        this.onDuelInviteInfo?.(msg.valid, msg.host, msg.lobbyId);
        break;
      case 'duelQueue':
        this.onDuelQueue?.(msg.queued);
        break;
      case 'duelError':
        this.onDuelError?.(msg.code, msg.message);
        break;
      case 'duelArena':
        this.onDuelArena?.(msg.arena, msg.spawn, msg.countdownEndsAt);
        break;
      case 'duelLoadout':
        this.onDuelLoadout?.(msg.slots, msg.armor, msg.selected, msg.unlimitedReserve);
        break;
      case 'duelClock':
        this.onDuelClock?.(msg.serverNow, msg.endsAt, msg.suddenDeath);
        break;
      case 'duelRespawn':
        this.onDuelRespawn?.(msg.respawnAt, msg.spectating);
        break;
      case 'duelResult':
        for (const change of msg.result.progressChanges) {
          const remote = this.remotes.get(change.id);
          if (remote) remote.info.duelProfile = change.profile;
        }
        this.onDuelResult?.(msg.result);
        break;
      case 'duelProgress':
        this.onDuelProfile?.(msg.profile, msg.leaderboard);
        break;
      case 'duelFlairResult':
        this.onDuelProfile?.(msg.profile, msg.leaderboard);
        break;
      case 'duelLeaderboard':
        this.onDuelLeaderboard?.(msg.leaderboard);
        break;
      case 'duelProfileUpdate': {
        const remote = this.remotes.get(msg.id);
        if (remote) remote.info.duelProfile = msg.profile;
        this.onDuelProfileUpdate?.(msg.id);
        break;
      }
      case 'arenaRestored':
        this.onDuelRestored?.(msg.x, msg.y, msg.z, msg.yaw, msg.pitch, msg.health, msg.dead,
          msg.mode, msg.state);
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

  /**
   * Put one message on the wire. Returns whether it actually went — which is
   * NOT the same as `connected`.
   *
   * `connected` is cleared by the socket's `close` EVENT, and that event fires
   * some time after the socket itself has moved to CLOSING/CLOSED. In between,
   * every send here is discarded in silence while callers still believe they
   * are online. That window is harmless for a transform and destructive for a
   * message the caller has already paid for locally — the death spill empties
   * the inventory before the drop is sent — so the answer is reported rather
   * than swallowed, and those callers can put the loot back.
   */
  private raw(msg: ClientMsg, volatile = false): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Transforms are disposable: if a slow tunnel is already carrying an
      // older packet, queuing more only makes the opponent see where we were
      // seconds ago. Reliable actions (shots, edits, lobby commands, etc.) are
      // never dropped.
      if (volatile && this.ws.bufferedAmount > 32 * 1024) return false;
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private close(): void {
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
  }

  // --- outbound -------------------------------------------------------------

  /** Throttled transform send (call every frame with dt). */
  private noteLateness(late: number, at: number): void {
    if (!Number.isFinite(late)) return;
    // The peak relaxes by 40ms per second of calm, so one hitch widens the
    // buffer for a few seconds rather than for the rest of the session.
    this.latePeak = Math.max(0, this.latePeak - Math.max(0, at - this.lateAt) * 0.04);
    this.lateAt = at;
    if (late > this.latePeak) this.latePeak = Math.min(0.5, late);
  }

  /** Seconds behind now that remote bodies are drawn. A sample is only usable
   *  once the one AFTER the render instant has arrived, so the delay must
   *  cover one send interval plus the worst recent lateness. Slewed at a few
   *  percent so the change is a gentle playback-speed shift, never a jump. */
  renderDelay(dt: number): number {
    // Arena entry is a teleport anyway, so snap straight back to the tuned
    // delay there rather than easing out of an open-world stretch.
    if (!this.adaptiveDelay) return (this.delayApplied = INTERP_DELAY);
    const target = Math.min(INTERP_DELAY + 0.1, Math.max(INTERP_DELAY, this.latePeak + 0.07));
    const step = Math.max(0, dt) * 0.06;
    this.delayApplied += Math.max(-step, Math.min(step, target - this.delayApplied));
    return this.delayApplied;
  }

  /** Bring every remote's pose/action fields to `renderTime` — the instant
   *  the renderer is drawing — so a swing or crouch lands with the body. */
  applyRemotePoses(renderTime: number): void {
    for (const r of this.remotes.values()) {
      const pose = r.poses.at(renderTime);
      if (pose) Object.assign(r, pose);
    }
  }

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
    this.raw({ t: 'xform', arenaRevision: this.arenaRevision, x, y, z, yaw, pitch,
      ct: Math.round(netNow() * 1000), gliding, boating, seated, sneaking, held, armor,
      swing, aiming, reloading }, true);
  }

  /** Send register/login over the open socket (before `welcome`/connected). */
  sendRegister(username: string, password: string): void {
    this.raw({ t: 'register', username, password });
  }
  sendLogin(username: string, password: string): void {
    this.raw({ t: 'login', username, password });
  }
  /** Resume a saved session (token from a previous visit's `session` msg). */
  sendSession(username: string, token: string): void {
    this.raw({ t: 'session', username, token });
  }
  sendDuelCreate(): void { if (this.connected) this.raw({ t: 'duelCreate' }); }
  sendDuelQueue(join: boolean): void { if (this.connected) this.raw({ t: 'duelQueue', join }); }
  sendDuelInviteInfo(token: string): void { if (this.socketOpen && token) this.raw({ t: 'duelInviteInfo', token }); }
  sendDuelJoin(token: string): void {
    if (this.connected) this.raw({ t: 'duelJoin', token });
  }
  /** Our simulated mobs, for the players around us. */
  sendMobSync(mobs: MobWire[], gone: number[]): void {
    if (this.connected) this.raw({ t: 'mobSync', mobs, gone }, true);
  }
  /** We hit a mob `owner` simulates. */
  sendMobHit(owner: number, nid: number, dmg: number, kx: number, kz: number): void {
    if (this.connected) this.raw({ t: 'mobHit', owner, nid, dmg, kx, kz });
  }
  /** Back on the title screen: take our body out of everyone's world. */
  sendAway(): void { if (this.connected) this.raw({ t: 'away' }); }
  sendDuelLeave(): void { if (this.connected) this.raw({ t: 'duelLeave' }); }
  sendDuelReady(ready: boolean): void {
    if (this.connected) this.raw({ t: 'duelReady', ready });
  }
  sendDuelStart(): void { if (this.connected) this.raw({ t: 'duelStart' }); }
  sendDuelArenaReady(): void { if (this.connected) this.raw({ t: 'duelArenaReady' }); }
  sendDuelRematch(vote: boolean): void {
    if (this.connected) this.raw({ t: 'duelRematch', vote });
  }
  sendDuelReturn(): void { if (this.connected) this.raw({ t: 'duelReturn' }); }
  sendDuelFlair(flair: DuelFlair): void { if (this.connected) this.raw({ t: 'duelFlair', flair }); }

  sendBwCreate(): void { if (this.connected) this.raw({ t: 'bwCreate' }); }
  sendBwQueue(join: boolean): void { if (this.connected) this.raw({ t: 'bwQueue', join }); }
  sendBwJoin(token: string): void { if (this.connected) this.raw({ t: 'bwJoin', token }); }
  sendBwLeave(): void { if (this.connected) this.raw({ t: 'bwLeave' }); }
  sendBwReady(ready: boolean): void { if (this.connected) this.raw({ t: 'bwReady', ready }); }
  sendBwStart(): void { if (this.connected) this.raw({ t: 'bwStart' }); }
  sendBwArenaReady(): void { if (this.connected) this.raw({ t: 'bwArenaReady' }); }
  /** The whole melee wire format: one target id. Damage, charge, crit, combo
   *  and knockback are all decided by the server. */
  sendBwMelee(target: number): void { if (this.connected) this.raw({ t: 'bwMelee', target }); }
  sendBwBed(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'bwBed', x, y, z });
  }
  sendBwShopBuy(entry: number): void { if (this.connected) this.raw({ t: 'bwShopBuy', entry }); }

  sendPartyCreate(mode: PartyMode = 'bridge'): void { if (this.connected) this.raw({ t: 'partyCreate', mode }); }
  sendPartyQueue(join: boolean, mode: PartyMode = 'bridge'): void { if (this.connected) this.raw({ t: 'partyQueue', join, mode }); }
  sendPartyJoin(token: string): void { if (this.connected) this.raw({ t: 'partyJoin', token }); }
  sendPartyLeave(): void { if (this.connected) this.raw({ t: 'partyLeave' }); }
  sendPartyReady(ready: boolean): void { if (this.connected) this.raw({ t: 'partyReady', ready }); }
  sendPartyStart(): void { if (this.connected) this.raw({ t: 'partyStart' }); }
  sendPartyArenaReady(revision: number): void { if (this.connected) this.raw({ t: 'partyArenaReady', revision }); }
  sendPartyRetry(): void { if (this.connected) this.raw({ t: 'partyRetry' }); }
  sendPartyMelee(target: number): void { if (this.connected) this.raw({ t: 'partyMelee', target }); }
  sendPartyShoot(dx: number, dy: number, dz: number, power: number): void {
    if (this.connected) this.raw({ t: 'partyShoot', dx, dy, dz, power });
  }

  sendEdit(x: number, y: number, z: number, block: number, facing?: number): void {
    if (!this.connected) return;
    this.raw(facing === undefined ? { t: 'edit', x, y, z, block } : { t: 'edit', x, y, z, block, f: facing });
  }
  sendTrapConfig(x: number, y: number, z: number, channel: number, interval?: number): void {
    if (this.connected) this.raw({ t: 'trapConfig', x, y, z, channel, interval });
  }
  sendTrapFuel(x: number, y: number, z: number, count: number): void {
    if (this.connected) this.raw({ t: 'trapFuel', x, y, z, count });
  }
  sendTrapDefuse(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'trapDefuse', x, y, z });
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
  /**
   * Hand stacks to the server as world item entities.
   *
   * Returns whether the message actually reached the wire; see `raw`. A caller
   * that has ALREADY removed the items locally must check it, or a send that
   * lands in the closing-socket window deletes them instead of dropping them.
   */
  sendDrop(
    items: { id: number; count: number }[], x: number, y: number, z: number
  ): boolean {
    if (!items.length) return true;
    return this.connected && this.raw({ t: 'drop', items, x, y, z });
  }

  // --- FACTIONS -----------------------------------------------------------------
  sendPledge(faction: number): void {
    if (this.connected) this.raw({ t: 'pledgeFaction', faction });
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
  sendMachineAct(x: number, y: number, z: number, act: MachineAct, n: number, item: number): void {
    if (this.connected) this.raw({ t: 'machineAct', x, y, z, act, n, item });
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
  sendTurretMove(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    if (this.connected) this.raw({ t: 'turretMove', x, y, z, tx, ty, tz });
  }
  sendTurretLoad(x: number, y: number, z: number, item: number, count: number): void {
    if (this.connected) this.raw({ t: 'turretLoad', x, y, z, item, count });
  }
  sendTurretMobShot(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    if (this.connected) this.raw({ t: 'turretMobShot', x, y, z, tx, ty, tz });
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
  sendHeliModule(id: number, item: number): void {
    if (this.connected) this.raw({ t: 'heliModule', id, item });
  }
  sendHeliRope(action: 'toggle' | 'attach' | 'drop' | 'move', motion?: number): void {
    if (this.connected) this.raw({ t: 'heliRope', action, motion });
  }
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
  /** A throwable just left your hand (launch point + velocity). */
  sendGadgetThrow(item: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    if (this.connected) this.raw({ t: 'gadgetThrow', item, x, y, z, vx, vy, vz });
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

/** Seconds a remote may be absent from received snapshots before it is
 *  dropped (a few snapshot intervals, so one odd tick never flickers it). */
const STALE_REMOTE_S = 2;

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
