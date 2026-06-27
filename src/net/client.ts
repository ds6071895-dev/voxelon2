// Browser-side network client. Connects to the VOXELON server, tracks remote
// players (raw target transforms — interpolation lives in the renderer), and
// exposes send helpers + event callbacks. Fails gracefully to offline mode so
// the game is fully playable with no server running.

import type { ItemStack } from '../items';
import type { MachineState, UpgradeAxis } from '../machines';
import type { ShipState, ShipAxis } from '../ships';
import type { TurretState, TurretAxis } from '../turrets';
import type { ClaimState } from '../claims';
import type { FactionPolitics } from '../politics';
import {
  ClientMsg, GameMode, ItemEntityInfo, PlayerInfo, SERVER_PORT, ServerMsg, ShipTransform,
  TRANSFORM_HZ,
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
  /** The socket is open + reachable (server is up), but not yet authenticated. */
  socketOpen = false;
  myId = -1;
  username = '';
  readonly remotes = new Map<number, Remote>();
  /** Server-owned dropped items, keyed by entity id (for the renderer). */
  readonly netItems = new Map<number, ItemEntityInfo>();

  /** Fired once the server welcome arrives (multiplayer is now live). */
  onWelcome?: (info: PlayerInfo) => void;
  /** Saved per-account state to restore (inventory/hotbar), if the account has any. */
  onRestoreState?: (state: Record<string, unknown>) => void;
  /** A block edit from another player (apply without re-broadcasting). */
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  /** Server-authoritative health change for the local player. */
  onHurt?: (health: number, dead: boolean, k: [number, number, number]) => void;
  onRespawned?: (x: number, y: number, z: number, health: number) => void;
  onKillfeed?: (killer: string, victim: string) => void;
  /** The LOCAL player's gamemode changed (admin command). */
  onGamemode?: (mode: GameMode) => void;
  /** The server teleported the local player (admin command). */
  onTeleport?: (x: number, y: number, z: number) => void;
  /** A server notice to surface to the local player (admin feedback). */
  onNotice?: (text: string) => void;
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
  /** Full ship state (launch / upgrade / hp on first sight). */
  onShipState?: (ship: ShipState) => void;
  /** Periodic ship transforms (id -> position/yaw/hp). */
  onShipTransforms?: (ships: ShipTransform[]) => void;
  onShipRemove?: (id: number) => void;
  /** Authoritative turret state (open reply / upgrade / load / fire refresh). */
  onTurret?: (x: number, y: number, z: number, state: TurretState) => void;
  /** A turret fired (render a tracer + aim the barrel). */
  onTurretFire?: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => void;
  /** Authoritative claim state (open reply / feed / breach / periodic refresh). */
  onClaim?: (claim: ClaimState) => void;
  onClaimRemove?: (id: number) => void;
  /** Region board changed (owner faction id per region index). */
  onRegions?: (owners: number[]) => void;
  /** Capture meters refreshed (per-region filling faction + 0..1 fraction). */
  onRegionMeters?: (capFaction: number[], capProgress: number[]) => void;
  /** A region flipped owners ("WE CAPTURED X!" banner). */
  onRegionCapture?: (region: number, faction: number, from: number) => void;
  /** A faction took an enemy capital — instant win. */
  onRegionWin?: (faction: number) => void;
  /** Season clock update (number + seconds left). */
  onSeason?: (number: number, timeLeft: number) => void;
  /** A season ended (winner faction, or NO_FACTION for a stalemate). */
  onSeasonEnd?: (winner: number, number: number) => void;
  /** Faction government state changed (Phase 6). */
  onPolitics?: (factions: FactionPolitics[]) => void;
  /** A faction elected a new Commander. */
  onCommanderElected?: (faction: number, commander: string) => void;
  /** Private confirmation of YOUR secret faction switch (Phase 7). */
  onFactionSwitched?: (faction: number, remaining: number) => void;
  /** Play a gadget visual effect (frag/oil blast, smoke cloud) at a point. */
  onGadgetFx?: (kind: string, x: number, y: number, z: number) => void;
  /** A player is disguised as `faction` until `until` (server worldTime). */
  onDisguised?: (id: number, faction: number, until: number) => void;
  /** A faction breached an enemy claim (HUD/killfeed event). */
  onBreach?: (attacker: string, faction: number, victim: number) => void;
  /** A register/login was rejected (the login screen shows the error). */
  onAuthErr?: (error: string) => void;

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
        for (const ship of msg.ships) this.onShipState?.(ship);
        for (const tr of msg.turrets) this.onTurret?.(tr.x, tr.y, tr.z, tr.state);
        for (const cl of msg.claims) this.onClaim?.(cl);
        this.onRegions?.(msg.regions);
        this.onSeason?.(msg.season.number, msg.season.timeLeft);
        this.onPolitics?.(msg.politics);
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
      case 'gamemode': {
        const r = this.remotes.get(msg.id);
        if (r) r.info.mode = msg.mode;          // keep remote rendering in step
        if (msg.id === this.myId) this.onGamemode?.(msg.mode);
        break;
      }
      case 'teleport':
        this.onTeleport?.(msg.x, msg.y, msg.z);
        break;
      case 'notice':
        this.onNotice?.(msg.text);
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
      case 'shipState':
        this.onShipState?.(msg.ship);
        break;
      case 'shipTransforms':
        this.onShipTransforms?.(msg.ships);
        break;
      case 'shipRemove':
        this.onShipRemove?.(msg.id);
        break;
      case 'turret':
        this.onTurret?.(msg.x, msg.y, msg.z, msg.state);
        break;
      case 'turretFire':
        this.onTurretFire?.(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz);
        break;
      case 'regions':
        this.onRegions?.(msg.owners);
        this.onRegionMeters?.(msg.capFaction, msg.capProgress);
        break;
      case 'regionCapture':
        this.onRegionCapture?.(msg.region, msg.faction, msg.from);
        break;
      case 'regionWin':
        this.onRegionWin?.(msg.faction);
        break;
      case 'season':
        this.onSeason?.(msg.number, msg.timeLeft);
        break;
      case 'seasonEnd':
        this.onSeasonEnd?.(msg.winner, msg.number);
        break;
      case 'politics':
        this.onPolitics?.(msg.factions);
        break;
      case 'commanderElected':
        this.onCommanderElected?.(msg.faction, msg.commander);
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
      case 'claim':
        this.onClaim?.(msg.claim);
        break;
      case 'claims':
        for (const cl of msg.claims) this.onClaim?.(cl);
        break;
      case 'claimRemove':
        this.onClaimRemove?.(msg.id);
        break;
      case 'breach':
        this.onBreach?.(msg.attacker, msg.faction, msg.victim);
        break;
      case 'authErr':
        this.onAuthErr?.(msg.error);
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

  /** Send register/login over the open socket (before `welcome`/connected). */
  sendRegister(username: string, password: string, faction?: number): void {
    this.raw({ t: 'register', username, password, faction });
  }
  sendLogin(username: string, password: string): void {
    this.raw({ t: 'login', username, password });
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
  sendArmor(points: number): void {
    if (this.connected) this.raw({ t: 'armor', points });
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
  // Ships.
  sendShipLaunch(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'shipLaunch', x, y, z });
  }
  sendShipSteer(id: number, thrust: number, turn: number): void {
    if (this.connected) this.raw({ t: 'shipSteer', id, thrust, turn });
  }
  sendShipFire(id: number, dx: number, dy: number, dz: number): void {
    if (this.connected) this.raw({ t: 'shipFire', id, dx, dy, dz });
  }
  sendShipDock(id: number): void {
    if (this.connected) this.raw({ t: 'shipDock', id });
  }
  sendShipUpgrade(id: number, axis: ShipAxis): void {
    if (this.connected) this.raw({ t: 'shipUpgrade', id, axis });
  }
  sendShipHit(id: number, amount: number): void {
    if (this.connected) this.raw({ t: 'shipHit', id, amount });
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
  // Land claims.
  sendClaimOpen(x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'claimOpen', x, y, z });
  }
  sendClaimFeed(x: number, y: number, z: number, count: number): void {
    if (this.connected) this.raw({ t: 'claimFeed', x, y, z, count });
  }
  sendClaimHit(x: number, y: number, z: number, amount: number): void {
    if (this.connected) this.raw({ t: 'claimHit', x, y, z, amount });
  }

  // Politics (Phase 6).
  sendNominate(party: string): void { if (this.connected) this.raw({ t: 'nominate', party }); }
  sendVote(candidate: string): void { if (this.connected) this.raw({ t: 'vote', candidate }); }
  sendSetRally(region: number): void { if (this.connected) this.raw({ t: 'setRally', region }); }
  sendAppointOfficer(user: string): void { if (this.connected) this.raw({ t: 'appointOfficer', user }); }
  sendDismissOfficer(user: string): void { if (this.connected) this.raw({ t: 'dismissOfficer', user }); }
  sendSetTax(rate: number): void { if (this.connected) this.raw({ t: 'setTax', rate }); }
  sendDonate(amount: number): void { if (this.connected) this.raw({ t: 'donate', amount }); }
  sendCommanderSpend(kind: 'shield' | 'crate' | 'buff', x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'commanderSpend', kind, x, y, z });
  }
  sendRecall(): void { if (this.connected) this.raw({ t: 'recall' }); }
  sendSwitchFaction(faction: number): void { if (this.connected) this.raw({ t: 'switchFaction', faction }); }
  sendGadgetUse(item: number, x: number, y: number, z: number): void {
    if (this.connected) this.raw({ t: 'gadgetUse', item, x, y, z });
  }
}

function toRemote(p: PlayerInfo): Remote {
  return {
    info: p, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, tpitch: p.pitch,
    health: p.health, dead: p.dead,
  };
}
