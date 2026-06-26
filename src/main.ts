import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS } from './blocks';
import { Furnaces } from './furnace';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { Interaction } from './interact';
import { Inventory } from './inventory';
import {
  InventoryUI, MachineUIContext, ShipUIContext, TurretUIContext, ClaimUIContext,
} from './inventory_ui';
import { dropFor, GunInfo, Item, ItemStack, ITEMS } from './items';
import {
  Machines, MachineType, allowedFilterMask, applyUpgrade, claimMachine,
  collectMachine, currentRate, damageMachine, machineHeight, machineTypeForBlock,
  sanitizeState, setFilter, upgradeCost,
} from './machines';
import { ItemEntities } from './itementity';
import { Chests } from './chests';
import { Mobs } from './mobs';
import { NetClient } from './net/client';
import { WORLD_SEED, WORLD_HALF, makeUsername, GameMode } from './net/protocol';
import { MachineModels } from './machinemodels';
import { NetItems } from './netitems';
import { Particles } from './particles';
import { Projectiles } from './projectiles';
import { Player, MAX_AIR } from './player';
import {
  Ships, applyShipUpgrade, blockWorldPos, cannonCount, deckHeightAt,
  floodFillHull, newShip, sanitizeShipState, shipCannonDamage, shipFireInterval,
  shipUpgradeCost, tickShip, ShipState, ShipAxis,
} from './ships';
import { ShipModels } from './shipmodels';
import {
  TurretState, TurretAxis, applyTurretUpgrade, claimTurret, damageTurret,
  newTurret, sanitizeTurretState, turretLoad, turretUpgradeCost, TURRET_AMMO_CAP,
  TURRET_FUEL_CAP,
} from './turrets';
import { TurretModels } from './turretmodels';
import { RemotePlayers } from './remoteplayers';
import { WorldMap } from './worldmap';
import { Accounts, Account } from './net/accounts';
import { FACTIONS, NO_FACTION, factionColor, factionName, forcedFaction, sameFaction } from './teams';
import {
  Claims, OIL_CAP, OIL_PER_BARREL, MAX_SHIELD_HP, claimProtected, damageShield,
  feedOil, shieldUp,
} from './claims';
import {
  Regions, CaptureMeters, REGION_COUNT, regionOf, regionCenter, capitalFaction,
  isCapital, CONTROL_RADIUS,
} from './regions';
import {
  newSeason, tickSeasonClock, seasonTimeLeft, seasonExpired, deadlineWinner,
  advanceSeason,
} from './season';
import { Sky, WATER_FOG_COLOR } from './sky';
import { Survival } from './survival';
import { createAtlas, createCrackTextures } from './textures';
import { World, RENDER_DISTANCE } from './world';
import { Panorama } from './panorama';

const FOG_NEAR = RENDER_DISTANCE * 16 - 38;
const FOG_FAR = RENDER_DISTANCE * 16 - 6;
const FOV = 70;
const SPRINT_FOV = 80.5;

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;
const crosshair = document.getElementById('crosshair')!;
const hotbarEl = document.getElementById('hotbar')!;
const statusEl = document.getElementById('status')!;
crosshair.style.display = 'none'; // HUD hidden until the player is in-game
hotbarEl.style.display = 'none';
statusEl.style.display = 'none';

// The world always uses the shared seed so clients never desync from the
// server (the ?seed override was removed).
const seed = WORLD_SEED;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.className = 'game';
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(new THREE.Color(), FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(
  FOV, window.innerWidth / window.innerHeight, 0.08, 2000
);
camera.rotation.order = 'YXZ';
scene.add(camera); // so the held-item view (a camera child) renders

const atlas = createAtlas(seed);
const cracks = createCrackTextures();
const world = new World(scene, atlas, seed);
// Offline single-player gets a random dry spawn too (MP uses the server's).
const spawn = world.terrain.randomDrySpawn(Math.random, WORLD_HALF);
const player = new Player(spawn);
const input = new Input(renderer.domElement);
const inventory = new Inventory();

// Basic starter kit — a modest comeback loadout granted on first spawn and
// re-claimable after death (see grantStarterKit). Just enough to dig, build a
// little, and defend yourself; NOT a head-start on the war economy.
const BASIC_KIT: [number, number][] = [
  [Item.WoodenPickaxe, 1],
  [Item.WoodenAxe, 1],
  [Item.Pistol, 1],
  [Item.Bullet, 24],
  [Block.Torch, 8],
  [Block.OakPlanks, 16],
];
/** Top up the inventory to the basic-kit amounts. Top-up (not blind add) is the
 *  anti-farm: you can't drop-and-reclaim to stockpile — you only ever receive
 *  the shortfall below the kit quantity, so a full pouch grants nothing. */
function grantStarterKit(): void {
  for (const [id, n] of BASIC_KIT) {
    const have = inventory.countItem(id);
    if (have < n) inventory.add(id, n - have);
  }
}
grantStarterKit();
// Debug loadout (testing the automation + warfare layers): ?kit=full grants all
// guns, machines, ship/turret parts and upgrade materials.
if (new URLSearchParams(location.search).get('kit') === 'full') for (const [id, n] of [
  [Item.Pistol, 1], [Item.Rifle, 1], [Item.RocketLauncher, 1],
  [Item.Shotgun, 1], [Item.SMG, 1], [Item.Sniper, 1], [Item.BurstRifle, 1],
  [Item.Bullet, 256], [Item.Rocket, 16],
  [Block.Autominer, 8], [Block.OilDerrick, 8],
  // warfare kit: ship parts, turrets, cannon ammo
  [Block.ShipHelm, 4], [Block.Cannon, 16], [Block.Turret, 8],
  [Item.Cannonball, 128],
  // building set for nicer-looking ships
  [Block.OakPlanks, 64], [Block.OakSlab, 64], [Block.OakStairsN, 64],
  [Block.SpruceSlab, 64], [Block.SpruceStairsN, 64],
  // materials to craft/upgrade machines + ships + turrets on the spot
  [Item.IronIngot, 64], [Item.Redstone, 64], [Item.Diamond, 32],
  [Item.CobaltIngot, 64], [Item.OilBarrel, 64], [Item.IronPickaxe, 1],
] as [number, number][]) {
  inventory.add(id, n);
}
const interaction = new Interaction(scene, world, player, cracks, inventory);
// Fixed "fake" title-screen panorama (its own world + seed; same every launch).
const panoramaView = new Panorama(atlas, window.innerWidth / window.innerHeight);

// Visual world border: four translucent cyan walls at ±WORLD_HALF so players
// can see the edge of the 1000×1000 play area (movement is clamped to it).
(() => {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x5ad0ff, transparent: true, opacity: 0.42,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const H = 160, B = WORLD_HALF;
  const geoNS = new THREE.PlaneGeometry(B * 2, H);
  for (const [z, ry] of [[-B, 0], [B, 0]] as [number, number][]) {
    const w = new THREE.Mesh(geoNS, mat);
    w.position.set(0, H / 2, z); w.rotation.y = ry; scene.add(w);
  }
  for (const x of [-B, B]) {
    const w = new THREE.Mesh(geoNS, mat);
    w.position.set(x, H / 2, 0); w.rotation.y = Math.PI / 2; scene.add(w);
  }
})();

const sky = new Sky(scene, seed);
const hud = new HUD(atlas.canvas, inventory);
const invUI = new InventoryUI(inventory, atlas.canvas);
const itemEntities = new ItemEntities(scene, world, atlas);
const held = new HeldItemView(camera, atlas);

const furnaces = new Furnaces(world);
const survival = new Survival();
const particles = new Particles(scene);
const mobs = new Mobs(scene, world, atlas, itemEntities, particles);
const audio = new GameAudio();
mobs.onSound = (name, pos) => audio.mob(name, pos.clone());
const net = new NetClient();
const remotePlayers = new RemotePlayers(scene, net);
const netItems = new NetItems(scene, net, atlas);
const projectiles = new Projectiles(scene, world, mobs, remotePlayers, net, player, particles);
const chests = new Chests();
chests.net = net;
const machines = new Machines(world.terrain);
const machineModels = new MachineModels(scene, machines);
// --- Warfare (M14): ships, turrets, territory ---
const ships = new Ships();
const shipModels = new ShipModels(scene, atlas);
/** Last server transform per ship (for reconcile/interpolation). */
const shipTargets = new Map<number, { x: number; y: number; z: number; yaw: number; hp: number }>();
const turretStates = new Map<string, TurretState>();
const turretModels = new TurretModels(scene, turretStates);
projectiles.shipsProvider = () => ships.list(); // bullets/cannonballs chip hull HP
// A round that lands inside an enemy faction's claim drains its shield (M19).
projectiles.claimSink = (x, y, z, damage) => {
  const c = claims.at(x, z);
  if (!c || sameFaction(localFaction, c.faction)) return;
  if (net.connected) net.sendClaimHit(c.coreX, c.coreY, c.coreZ, damage);
  else damageShield(c, damage); // offline parity (no enemy claims in SP)
};
// --- Factions (M18): land claims + oil shields ---
const claims = new Claims();
let openClaim: { x: number; y: number; z: number } | null = null;
const shieldGroup = new THREE.Group();
scene.add(shieldGroup);
const shieldMeshes = new Map<number, THREE.LineSegments>();
// Region board (Phase 1/2): owner faction id per region + capture meters.
// Server-authoritative in MP (net.onRegions); offline the local Regions sim is
// authoritative (identical pure module), driven by the local player's presence.
const localRegions = new Regions();
let regionOwners: number[] = localRegions.ownerList();
let regionMeters: CaptureMeters = localRegions.meters();
// Seasons (Phase 5): server-authoritative in MP (net.onSeason); offline the
// local season clock is authoritative. The badge count is shown in the HUD.
const localSeason = newSeason();
let seasonNumber = localSeason.number;
let seasonLeft = seasonTimeLeft(localSeason);
let localSeasonsWon = 0;
// World map (M key): region board + claims + capture meters + waypoints.
const worldMap = new WorldMap(scene, camera, world.terrain, claims, {
  player: () => ({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }),
  faction: () => localFaction,
  regions: () => regionOwners,
  captureMeters: () => regionMeters,
});
let pilotingShipId: number | null = null;
let ridingShipId: number | null = null;
let localShipId = 1; // offline ship ids (no server to assign them)
/** Per-ship motion this frame (pivot + new origin + yaw delta) for rider carry. */
const shipDelta = new Map<number, { ox: number; oz: number; nx: number; nz: number; dyaw: number }>();
let openShip: number | null = null;
let openTurret: { x: number; y: number; z: number } | null = null;
let shipSteerAcc = 0;       // throttle for shipSteer sends
let cannonCooldown = 0;     // local cannon fire-rate gate
let lastSneak = false;      // sneak rising-edge (Shift docks while piloting)
let openMachine: { x: number; y: number; z: number } | null = null;
let openChest: { x: number; y: number; z: number } | null = null;
let lastChestVersion = -1;   // last version pushed/loaded — gates the live sync
let chestBaseVersion = -1;   // version as of the last load FROM the server

// Multiplayer HUD: connection/roster line + a small kill feed (top-right).
const netinfoEl = document.createElement('div');
netinfoEl.className = 'mc-font';
netinfoEl.style.cssText =
  'position:absolute;top:6px;right:8px;font-size:14px;z-index:10;' +
  'pointer-events:none;text-align:right;';
app.appendChild(netinfoEl);
const killfeedEl = document.createElement('div');
killfeedEl.style.cssText =
  'position:absolute;top:28px;right:8px;z-index:10;pointer-events:none;text-align:right;';
app.appendChild(killfeedEl);

// World-map button (also bound to the M key). Clickable whenever the pointer
// isn't locked (menus); during locked FPS play the M key opens it.
const mapBtn = document.createElement('button');
mapBtn.className = 'mc-font';
mapBtn.textContent = '🗺 Map (M)';
mapBtn.style.cssText =
  'position:absolute;bottom:8px;right:8px;z-index:12;font-size:12px;padding:6px 10px;' +
  'cursor:pointer;border:2px solid;border-color:#fff #555 #555 #fff;background:#6b6b6b;' +
  'color:#fff;text-shadow:none;';
mapBtn.addEventListener('click', () => {
  if (player.dead) return;
  if (worldMap.open) { worldMap.hide(); input.lock(); return; }
  if (invUI.open) invUI.hide();
  worldMap.show(); // pointer is already unlocked when a DOM button is clickable
});
app.appendChild(mapBtn);

// War HUD (Phase 2): a top-centre region tug bar (Crimson vs Azure region
// counts), a capture-meter bar shown while you stand on a contested control
// point, and a big capture/win banner that flashes on major events.
const regionWarEl = document.createElement('div');
regionWarEl.className = 'mc-font';
regionWarEl.style.cssText =
  'position:absolute;top:6px;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;text-align:center;font-size:13px;text-shadow:1px 1px 0 #000;' +
  'width:340px;display:none;';
app.appendChild(regionWarEl);
const seasonEl = document.createElement('div');
seasonEl.className = 'mc-font';
seasonEl.style.cssText =
  'position:absolute;top:38px;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;text-align:center;font-size:11px;color:#cfe0ff;' +
  'text-shadow:1px 1px 0 #000;width:340px;display:none;';
app.appendChild(seasonEl);
const captureBarEl = document.createElement('div');
captureBarEl.className = 'mc-font';
captureBarEl.style.cssText =
  'position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;text-align:center;font-size:14px;text-shadow:1px 1px 0 #000;' +
  'width:300px;display:none;';
app.appendChild(captureBarEl);
const regionBannerEl = document.createElement('div');
regionBannerEl.className = 'mc-font';
regionBannerEl.style.cssText =
  'position:absolute;top:26%;left:50%;transform:translateX(-50%);font-size:34px;z-index:12;' +
  'pointer-events:none;text-shadow:3px 3px 0 #000;text-align:center;display:none;' +
  'letter-spacing:1px;white-space:nowrap;';
app.appendChild(regionBannerEl);
let regionBannerTimer = 0;
function showRegionBanner(text: string, color: string): void {
  regionBannerEl.textContent = text;
  regionBannerEl.style.color = color;
  regionBannerEl.style.display = 'block';
  regionBannerTimer = 3.2;
}
// The local player's faction: server-assigned in MP (onWelcome), or a single
// local faction offline so shields/ownership/colors still work in single-player.
let localFaction = FACTIONS[0].id;
// Local gamemode (admin-set via the server console). Drives flight/noclip/
// invulnerability + the creative build conveniences.
let localMode: GameMode = 'survival';
// Authentication state (mandatory login). Declared early so refreshNetInfo can
// read it; the form + flow are wired further down.
let authed = false;
let authedName = '';

/** Apply a gamemode to the local player (flight/noclip/creative build). */
function applyLocalMode(mode: GameMode): void {
  localMode = mode;
  player.flying = mode !== 'survival';   // creative + spectator fly
  player.noclip = mode === 'spectator';  // only spectators pass through blocks
  interaction.creative = mode === 'creative';
  invUI.creative = mode === 'creative';  // inventory screen shows the all-items palette
  refreshNetInfo();
}
// Local grace/shield clock for the offline claim sim (advanced in the frame loop).
let worldTimeLocal = 0;
function factionCss(id: number): string {
  const c = factionColor(id);
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}
function refreshNetInfo(): void {
  const badge = localFaction === NO_FACTION ? '' :
    `<span style="color:${factionCss(localFaction)}">■ ${factionName(localFaction)}</span>  `;
  const modeBadge = localMode === 'survival' ? '' :
    `<span style="color:#ffe27a">[${localMode.toUpperCase()}]</span>  `;
  // Permanent "Seasons Won" badge (Phase 5): a gold star + count.
  const wonBadge = localSeasonsWon > 0 ? `<span style="color:#ffd84a">★${localSeasonsWon}</span>  ` : '';
  if (net.connected) {
    netinfoEl.innerHTML = `${wonBadge}${modeBadge}${badge}${net.username}   ${net.remotes.size + 1} online`;
  } else if (authed) {
    netinfoEl.innerHTML = `${wonBadge}${badge}${authedName}   (offline)`;
  } else {
    netinfoEl.innerHTML = '';
  }
}
function showKill(killer: string, victim: string): void {
  const line = document.createElement('div');
  line.className = 'mc-font';
  line.style.cssText = 'font-size:13px;text-shadow:1px 1px 0 #000;';
  line.textContent = killer ? `${killer}  »  ${victim}` : `${victim} died`;
  killfeedEl.appendChild(line);
  window.setTimeout(() => line.remove(), 5000);
}
/** Transient on-screen notice (admin feedback: gamemode/teleport/etc). */
function showNotice(text: string): void {
  const line = document.createElement('div');
  line.className = 'mc-font';
  line.style.cssText = 'font-size:14px;color:#ffe27a;text-shadow:1px 1px 0 #000;';
  line.textContent = text;
  killfeedEl.appendChild(line);
  window.setTimeout(() => line.remove(), 4000);
}

// Drop routing: in multiplayer drops are server-owned (everyone sees them);
// offline they are local item entities.
function spawnDrop(x: number, y: number, z: number, id: number, count: number): void {
  if (net.connected) net.sendDrop([{ id, count }], x, y, z);
  else itemEntities.spawn(x, y, z, id, count);
}
function spillStacks(stacks: ItemStack[], x: number, y: number, z: number): void {
  if (!stacks.length) return;
  if (net.connected) net.sendDrop(stacks.map((s) => ({ id: s.id, count: s.count })), x, y, z);
  else for (const s of stacks) itemEntities.spawn(x, y, z, s.id, s.count);
}

// Broken blocks drop items; furnaces and chests spill their contents.
world.onBlockBroken = (x, y, z, oldId, harvested) => {
  const drop = dropFor(oldId, Math.random(), harvested);
  // dropChance < 1 during explosions, so blasted blocks mostly vanish.
  if (drop && Math.random() < world.dropChance) {
    spawnDrop(x + 0.5, y + 0.3, z + 0.5, drop.id, drop.count);
  }
  if (oldId === Block.Furnace || oldId === Block.FurnaceLit) {
    spillStacks(furnaces.remove(x, y, z), x + 0.5, y + 0.3, z + 0.5);
  }
  if (oldId === Block.Chest) {
    // Clear our local cache either way. Offline we spill the contents here;
    // online the server spills the authoritative stored contents on the edit,
    // so the client must not (its cache may be empty/stale — that would lose or
    // wipe items, especially for a chest this player never opened).
    const dropped = chests.remove(x, y, z);
    if (!net.connected) spillStacks(dropped, x + 0.5, y + 0.3, z + 0.5);
  }
  if (oldId === Block.Autominer || oldId === Block.OilDerrick) {
    // Same authority split as chests: offline we spill the local machine's
    // stored output; online the server spills its authoritative copy on the
    // edit, so we only drop the local entity here. (Normal play sabotages
    // machines; this covers explosions/other breaks of the anchor.)
    const type = oldId === Block.OilDerrick ? MachineType.OilDerrick : MachineType.Autominer;
    const stored = machines.remove(x, y, z);
    if (!net.connected) spillStacks(recordToStacks(stored), x + 0.5, y + 0.3, z + 0.5);
    for (let k = 1; k < machineHeight(type); k++) world.applyRemoteEdit(x, y + k, z, Block.Air);
    if (openMachine && openMachine.x === x && openMachine.y === y && openMachine.z === z) {
      forceCloseMachine();
    }
  }
};
interaction.onAction = () => held.swing();
interaction.onBlockSound = (kind, blockId, x, y, z) => {
  const pos = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
  if (kind === 'break') audio.dig(materialOf(blockId), pos);
  else audio.place(materialOf(blockId), pos);
};
interaction.onOpenContainer = (kind, x, y, z) => {
  if (kind === 'chest') {
    openChest = { x, y, z };
    inventory.loadChest(chests.open(x, y, z));
    lastChestVersion = chestBaseVersion = inventory.version;
    invUI.show('chest');
  } else if (kind === 'machine') {
    // Right-clicking any footprint cell opens the machine at its anchor.
    const a = resolveMachineAnchor(x, y, z);
    if (!a) return;
    const type = machineTypeForBlock(world.getBlock(a.x, a.y, a.z));
    if (type === null) return;
    openMachine = { x: a.x, y: a.y, z: a.z };
    machines.place(a.x, a.y, a.z, type); // ensure a local entity exists to predict
    if (net.connected) net.sendMachineOpen(a.x, a.y, a.z); // adopt authoritative state
    invUI.show('machine', undefined, machineCtxFor(a.x, a.y, a.z));
  } else if (kind === 'turret') {
    openTurret = { x, y, z };
    const key = `${x},${y},${z}`;
    if (!turretStates.has(key)) turretStates.set(key, newTurret()); // local predict
    if (net.connected) net.sendTurretOpen(x, y, z);
    invUI.show('turret', undefined, undefined, undefined, turretCtxFor(x, y, z));
  } else if (kind === 'claim') {
    if (!claims.coreAt(x, y, z)) return; // no claim here (e.g. an orphan Core)
    openClaim = { x, y, z };
    if (net.connected) net.sendClaimOpen(x, y, z);
    invUI.show('claim', undefined, undefined, undefined, undefined, claimCtxFor(x, y, z));
  } else {
    invUI.show(kind, kind === 'furnace' ? furnaces.get(x, y, z) : undefined);
  }
  document.exitPointerLock();
};

// --- Machine UI plumbing ----------------------------------------------------
function recordToStacks(rec: Record<number, number>): ItemStack[] {
  const out: ItemStack[] = [];
  for (const [idStr, n] of Object.entries(rec)) {
    const id = Number(idStr);
    let r = Math.floor(n);
    while (r > 0) { const c = Math.min(64, r); out.push({ id, count: c }); r -= c; }
  }
  return out;
}
function canAffordCost(cost: Record<number, number>): boolean {
  for (const [idStr, n] of Object.entries(cost)) {
    if (inventory.countItem(Number(idStr)) < n) return false;
  }
  return true;
}
function payCost(cost: Record<number, number>): void {
  for (const [idStr, n] of Object.entries(cost)) inventory.removeItem(Number(idStr), n);
}
function grantRecord(rec: Record<number, number>): void {
  for (const [idStr, n] of Object.entries(rec)) {
    const id = Number(idStr);
    const left = inventory.add(id, n);
    if (left > 0) spillAtPlayer([{ id, count: left }]);
  }
}
function machineCtxFor(x: number, y: number, z: number): MachineUIContext {
  const here = () => machines.get(x, y, z) ?? null;
  return {
    state: here,
    rate: () => {
      const s = here();
      return s ? currentRate(s, machines.context(x, z, s.type)) : 0;
    },
    toggleFilter: (i) => {
      const s = here();
      if (!s || s.type !== MachineType.Autominer) return;
      if (!(allowedFilterMask(s.level) & (1 << i))) return; // gated: ignore
      setFilter(s, (s.filter ^ (1 << i)) >>> 0); // local prediction
      if (net.connected) net.sendMachineConfig(x, y, z, s.filter);
    },
    upgrade: (axis) => {
      const s = here();
      if (!s) return;
      const cost = upgradeCost(s, axis);
      if (!cost || !canAffordCost(cost)) return;
      payCost(cost);              // payment is client-side (trust model)
      applyUpgrade(s, axis);      // local prediction; server also applies + caps
      if (net.connected) net.sendMachineUpgrade(x, y, z, axis);
    },
    collect: () => {
      const s = here();
      if (!s) return;
      if (net.connected) {
        net.sendMachineCollect(x, y, z); // server grants (gotitem) + sends state
      } else {
        grantRecord(collectMachine(s));
      }
    },
    canAfford: (axis) => {
      const s = here();
      const cost = s ? upgradeCost(s, axis) : null;
      return !!cost && canAffordCost(cost);
    },
    claim: () => {
      const s = here();
      if (!s) return;
      claimMachine(s, net.connected ? net.username : 'You'); // local predict
      if (net.connected) net.sendMachineClaim(x, y, z);
    },
    myName: () => (net.connected ? net.username : 'You'),
  };
}
function forceCloseMachine(): void {
  openMachine = null;
  if (invUI.open && invUI.mode === 'machine') invUI.hide();
}
function forceCloseClaim(): void {
  openClaim = null;
  if (invUI.open && invUI.mode === 'claim') invUI.hide();
}
// Faction-colored wireframe shield dome over a claim's 3×3-chunk footprint.
const SHIELD_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(48, 80, 48));
function removeShieldDome(id: number): void {
  const m = shieldMeshes.get(id);
  if (!m) return;
  shieldGroup.remove(m);
  (m.material as THREE.Material).dispose(); // geometry is shared — never dispose it
  shieldMeshes.delete(id);
}
/** Drop every base (claim + its dome). Used on a season reset + disconnect. */
function clearAllBases(): void {
  for (const id of [...shieldMeshes.keys()]) removeShieldDome(id);
  claims.clear();
  forceCloseClaim();
}
function updateShieldDomes(_dt: number): void {
  const live = new Set<number>();
  for (const c of claims.list()) {
    live.add(c.id);
    let mesh = shieldMeshes.get(c.id);
    if (!mesh) {
      mesh = new THREE.LineSegments(SHIELD_EDGES,
        new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));
      shieldGroup.add(mesh);
      shieldMeshes.set(c.id, mesh);
    }
    mesh.position.set(c.cx * 16 + 8, c.coreY + 30, c.cz * 16 + 8);
    const mat = mesh.material as THREE.LineBasicMaterial;
    mat.color.setHex(factionColor(c.faction));
    mesh.visible = shieldUp(c);
    const frac = Math.max(0, Math.min(1, c.shieldHp / MAX_SHIELD_HP));
    const flick = frac < 0.25 ? 0.35 + 0.5 * Math.abs(Math.sin(worldTimeLocal * 8)) : 1;
    mat.opacity = (0.16 + 0.34 * frac) * flick;
  }
  for (const id of [...shieldMeshes.keys()]) if (!live.has(id)) removeShieldDome(id);
}
function claimCtxFor(x: number, y: number, z: number): ClaimUIContext {
  const here = () => claims.coreAt(x, y, z) ?? null;
  const mine = () => { const c = here(); return !!c && sameFaction(localFaction, c.faction); };
  return {
    state: here,
    mine,
    canFeed: () => mine() && inventory.countItem(Item.OilBarrel) > 0,
    feed: () => {
      const c = here();
      if (!c || !mine()) return;
      const have = inventory.countItem(Item.OilBarrel);
      if (have <= 0) return;
      // Feed as many barrels as the buffer has room for.
      const room = Math.floor((OIL_CAP - c.oil) / OIL_PER_BARREL);
      const n = Math.min(have, room);
      if (n <= 0) return;
      inventory.removeItem(Item.OilBarrel, n);
      if (net.connected) net.sendClaimFeed(x, y, z, n);
      else feedOil(c, n); // offline: apply locally
    },
  };
}
// Resolve a footprint cell (anchor or MachinePart) to the anchor block below.
function resolveMachineAnchor(x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  for (let cy = y, i = 0; i < 8; cy--, i++) {
    const id = world.getBlock(x, cy, z);
    if (machineTypeForBlock(id) !== null) return { x, y: cy, z };
    if (id !== Block.MachinePart) return null;
  }
  return null;
}

// Offline destroy: spill loot + drop the machine block once, then silently
// clear the whole footprint (applyRemoteEdit suppresses the break hook so we
// don't double-drop), and close the UI if we were viewing it.
function destroyMachineLocal(ax: number, ay: number, az: number): void {
  const s = machines.get(ax, ay, az);
  if (!s) return;
  const type = s.type;
  const stored = machines.remove(ax, ay, az);
  spillStacks(recordToStacks(stored), ax + 0.5, ay + 0.3, az + 0.5);
  spawnDrop(ax + 0.5, ay + 0.3, az + 0.5,
    type === MachineType.OilDerrick ? Block.OilDerrick : Block.Autominer, 1);
  for (let k = 0; k < machineHeight(type); k++) world.applyRemoteEdit(ax, ay + k, az, Block.Air);
  if (openMachine && openMachine.x === ax && openMachine.y === ay && openMachine.z === az) {
    forceCloseMachine();
  }
}

// Sabotage: a left-click on a machine block damages its HP; at 0 it's destroyed
// (server-authoritative in MP; local offline) and drops its loot + block.
interaction.onSabotage = (x, y, z) => {
  const held = inventory.selectedStack;
  const tool = held ? ITEMS[held.id]?.tool : undefined;
  const dmg = (tool?.damage ?? 1) + 3; // fists chip away; tools hit harder
  // Turret? (single-block entity)
  if (world.getBlock(x, y, z) === Block.Turret) {
    const key = `${x},${y},${z}`;
    if (net.connected) {
      net.sendTurretHit(x, y, z, dmg);
    } else {
      const s = turretStates.get(key);
      if (s && damageTurret(s, dmg)) {
        turretStates.delete(key);
        spawnDrop(x + 0.5, y + 0.3, z + 0.5, Block.Turret, 1);
        if (s.ammo > 0) spawnDrop(x + 0.5, y + 0.3, z + 0.5, Item.Cannonball, Math.min(64, s.ammo));
        world.applyRemoteEdit(x, y, z, Block.Air);
        if (openTurret && openTurret.x === x && openTurret.y === y && openTurret.z === z) {
          openTurret = null;
          if (invUI.open && invUI.mode === 'turret') invUI.hide();
        }
      }
    }
    return;
  }
  const a = resolveMachineAnchor(x, y, z);
  if (!a) return;
  if (net.connected) {
    net.sendMachineHit(a.x, a.y, a.z, dmg);
  } else {
    const s = machines.get(a.x, a.y, a.z);
    if (s && damageMachine(s, dmg)) destroyMachineLocal(a.x, a.y, a.z);
  }
};
// Right-click a placed (not-yet-launched) Ship Helm to capture + launch its hull.
interaction.onUseHelm = (hx, hy, hz) => {
  if (net.connected) {
    net.sendShipLaunch(hx, hy, hz); // server flood-fills + broadcasts shipState
    return;
  }
  launchShipLocal(hx, hy, hz);
};
invUI.onClose = () => {
  if (openChest) {
    chests.sync(openChest.x, openChest.y, openChest.z, inventory.saveChest());
    openChest = null;
  }
  openMachine = null; // machine actions sync immediately; nothing to flush
  openShip = null;    // ship/turret actions also sync immediately
  openTurret = null;
};
const spillAtPlayer = (stacks: ItemStack[]) =>
  spillStacks(stacks, player.pos.x, player.pos.y + 1, player.pos.z);
invUI.onOverflow = spillAtPlayer;

// The chest we're viewing was removed by someone else (MP). Salvage the items
// we were arranging in it back to us and close WITHOUT re-pushing to the now
// empty location: clearing openChest first makes onClose + the live sync no-ops,
// and the server already cleared its copy on the removal edit.
function forceCloseChest(): void {
  const salvaged = inventory.saveChest(); // clears the chest region, chestOpen=false
  openChest = null;
  if (invUI.open) invUI.hide();
  const overflow: ItemStack[] = [];
  for (const s of salvaged) {
    if (!s) continue;
    const left = inventory.add(s.id, s.count);
    if (left > 0) overflow.push({ ...s, count: left });
  }
  if (overflow.length) spillAtPlayer(overflow);
}

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  panoramaView.resize(aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Screen state: 'title' shows the orbiting panorama + Play; 'paused' shows
// the pause menu over the frozen first-person view; 'playing' is locked.
const pauseEl = document.getElementById('pause')!;
type Screen = 'title' | 'playing' | 'paused';
let screen: Screen = 'title';

function enterPlaying(): void {
  screen = 'playing';
  overlay.classList.add('hidden');
  pauseEl.style.display = 'none';
}
function enterPause(): void {
  screen = 'paused';
  pauseEl.style.display = 'flex';
}
function enterTitle(): void {
  screen = 'title';
  overlay.classList.remove('hidden');
  pauseEl.style.display = 'none';
}

// --- Login / register (mandatory accounts) ---------------------------------
// Online: the server verifies against its account store (scrypt). Offline SP:
// a LOCAL account store in localStorage (the same pure Accounts module + a sync
// hash) gates play so there's a login for everything. Play is hidden until authed.
const authEl = document.getElementById('auth')!;
const authUser = document.getElementById('auth-user') as HTMLInputElement;
const authPass = document.getElementById('auth-pass') as HTMLInputElement;
const authErr = document.getElementById('auth-err')!;
const authStatus = document.getElementById('auth-status')!;
const playBtn = document.getElementById('play-btn')!;
const controlsBtn = document.getElementById('controls-btn')!;
const menuBtns = document.getElementById('menu-btns')!;

/** Non-cryptographic salted hash for OFFLINE local accounts (identity gate only;
 *  real security is the server's scrypt). FNV-1a over salt+password. */
function localHash(pass: string, salt: string): string {
  let h = 2166136261 >>> 0;
  const s = `${salt} ${pass}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function loadLocalAccounts(): Account[] {
  try { return JSON.parse(localStorage.getItem('voxelon.accounts') || '[]'); } catch { return []; }
}
const localAccounts = new Accounts(loadLocalAccounts());
function saveLocalAccounts(): void {
  try { localStorage.setItem('voxelon.accounts', JSON.stringify(localAccounts.toJSON())); } catch { /* ignore */ }
}

// --- Faction picker (register only) ----------------------------------------
// On first registration the player PICKS a side. Offline we know the local
// account counts, so we enforce the >20% imbalance rule right here (the chosen
// button is forced to the weaker side). Online the server is the authority: we
// send the pick and `welcome` reports the side we actually landed on (which may
// be overridden if a side was full). LOUD faction colors so the choice pops.
const factionPickEl = document.getElementById('faction-pick')!;
const factionPickBtns = document.getElementById('faction-pick-btns')!;
const factionPickNote = document.getElementById('faction-pick-note')!;
let chosenFaction = FACTIONS[0].id;
const factionOptEls = new Map<number, HTMLElement>();
for (const f of FACTIONS) {
  const el = document.createElement('div');
  el.className = 'faction-opt mc-font';
  el.style.color = factionCss(f.id);
  el.textContent = f.name;
  el.addEventListener('click', () => {
    if (el.classList.contains('forced-off')) return;
    chosenFaction = f.id;
    refreshFactionPicker();
  });
  factionPickBtns.appendChild(el);
  factionOptEls.set(f.id, el);
}
/** Offline-only imbalance gate: returns the side the player is forced onto, or
 *  null when they may pick freely. (Online, the server decides.) */
function offlineForced(): number | null {
  if (net.socketOpen) return null; // server enforces online
  const counts: Record<number, number> = {};
  for (const f of FACTIONS) counts[f.id] = 0;
  for (const a of localAccounts.list()) if (counts[a.faction] !== undefined) counts[a.faction]++;
  return forcedFaction(counts);
}
function refreshFactionPicker(): void {
  const forced = offlineForced();
  if (forced !== null) chosenFaction = forced;
  for (const f of FACTIONS) {
    const el = factionOptEls.get(f.id)!;
    el.classList.toggle('selected', f.id === chosenFaction);
    el.classList.toggle('forced-off', forced !== null && f.id !== forced);
  }
  factionPickNote.textContent = forced !== null
    ? `${factionName(forced)} needs reinforcements — you're assigned there to keep it fair.`
    : 'Teams may rebalance you if a side fills up.';
}

function onAuthSuccess(username: string): void {
  authed = true;
  authedName = username;
  authEl.style.display = 'none';
  menuBtns.style.display = 'flex'; // Play / Controls appear once logged in
  authErr.textContent = '';
  authStatus.textContent = '';
  refreshNetInfo();
}

function attemptAuth(mode: 'login' | 'register', retries = 12): void {
  if (authed) return;
  const username = authUser.value.trim();
  const password = authPass.value;
  authErr.textContent = '';
  if (net.socketOpen) {
    // Online: the server is the authority.
    authStatus.textContent = mode === 'register' ? 'Registering…' : 'Logging in…';
    if (mode === 'register') net.sendRegister(username, password, chosenFaction);
    else net.sendLogin(username, password);
  } else if (net.offline) {
    // Offline single-player: verify against the local account store.
    const res = mode === 'register'
      ? localAccounts.register(username, password, localHash,
          `${Math.floor(Math.random() * 1e9).toString(16)}${Date.now().toString(16)}`, chosenFaction)
      : localAccounts.login(username, password, localHash);
    if (!res.ok || !res.account) { authErr.textContent = res.error ?? 'Failed'; return; }
    if (mode === 'register') saveLocalAccounts();
    localFaction = res.account.faction;
    onAuthSuccess(res.account.username);
    if (mode === 'login') restoreOfflineInventory(); // bring back saved single-player stuff
  } else if (retries > 0) {
    // Still resolving whether a server is reachable — try again shortly.
    authStatus.textContent = 'Connecting…';
    setTimeout(() => attemptAuth(mode, retries - 1), 350);
  } else {
    authStatus.textContent = '';
    authErr.textContent = 'Could not reach the server. Try again.';
  }
}

// "Roll" a fresh random username. Avoids names we already know about locally
// (best-effort; the server enforces final uniqueness at register time).
const rollBtn = document.getElementById('roll-btn')!;
function rollUsername(): void {
  let name = makeUsername(Math.random);
  for (let i = 0; i < 20 && localAccounts.has(name); i++) name = makeUsername(Math.random);
  authUser.value = name;
  authErr.textContent = '';
  authStatus.textContent = 'Rolled a name — roll again or pick a password.';
}
rollBtn.addEventListener('click', rollUsername);

// Two auth modes. REGISTER forces a randomly-rolled username (the field is
// read-only + a 🎲 roller); LOGIN lets you type your existing name back in.
const submitBtn = document.getElementById('submit-btn')!;
const authToggle = document.getElementById('auth-toggle')!;
let authMode: 'register' | 'login' = 'register';
function setAuthMode(mode: 'register' | 'login'): void {
  authMode = mode;
  authErr.textContent = '';
  authStatus.textContent = '';
  if (mode === 'register') {
    submitBtn.textContent = 'Register';
    authUser.readOnly = true;          // names are random-only on register
    rollBtn.style.display = '';
    factionPickEl.style.display = 'flex'; // pick a side when registering
    refreshFactionPicker();
    authToggle.innerHTML = 'Already have an account? <a id="toggle-link">Log in</a>';
    if (!authUser.value) rollUsername();
  } else {
    submitBtn.textContent = 'Log In';
    authUser.readOnly = false;         // type your existing name to log in
    authUser.value = '';
    rollBtn.style.display = 'none';
    factionPickEl.style.display = 'none'; // existing accounts keep their side
    authToggle.innerHTML = 'Need an account? <a id="toggle-link">Register</a>';
    authUser.focus();
  }
  // The link is replaced via innerHTML above, so rebind it each time.
  document.getElementById('toggle-link')!
    .addEventListener('click', () => setAuthMode(mode === 'register' ? 'login' : 'register'));
}

net.onAuthErr = (error) => { authStatus.textContent = ''; authErr.textContent = error; };
submitBtn.addEventListener('click', () => attemptAuth(authMode));
authPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptAuth(authMode); });
setAuthMode('register'); // default: roll a random name, ready to register

playBtn.addEventListener('click', () => {
  if (!authed) return;
  audio.resume();
  // World usually finished streaming during the title; if not, wait briefly
  // (still no full-screen loading screen) before dropping in.
  if (!worldReady) {
    playBtn.textContent = 'Preparing…';
    const wait = (): void => {
      if (worldReady) { playBtn.textContent = 'Play'; input.lock(); }
      else setTimeout(wait, 100);
    };
    wait();
    return;
  }
  input.lock();
});

// Controls / keybindings panel (Controls button).
const controlsPanel = (() => {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:14px;background:rgba(8,8,14,0.9);z-index:24;';
  const h = document.createElement('h2');
  h.className = 'mc-font';
  h.textContent = 'CONTROLS';
  h.style.cssText = 'font-size:30px;letter-spacing:4px;';
  panel.appendChild(h);
  const list = document.createElement('div');
  list.className = 'mc-font';
  list.style.cssText = 'display:grid;grid-template-columns:auto auto;gap:6px 32px;font-size:15px;';
  const binds: [string, string][] = [
    ['Move', 'W A S D'], ['Jump', 'Space'], ['Sneak', 'Shift'],
    ['Sprint', 'Ctrl / double-tap W'], ['Break / attack mob', 'Left click'],
    ['Place / use', 'Right click'], ['Aim down sights (guns)', 'Hold right click'],
    ['Reload gun', 'R'], ['Deploy glider (in mid-air)', 'Jump'],
    ['Hotbar slot', '1 – 9 / scroll'], ['Inventory', 'E'], ['World map', 'M'],
    ['Debug overlay', 'F3'], ['Pause / back', 'Esc'],
  ];
  for (const [action, key] of binds) {
    const a = document.createElement('div'); a.textContent = action; a.style.color = '#cfe0ff';
    const k = document.createElement('div'); k.textContent = key;
    k.style.color = '#fff'; k.style.textAlign = 'right';
    list.append(a, k);
  }
  panel.appendChild(list);
  const back = document.createElement('button');
  back.className = 'mc-btn';
  back.textContent = 'Back';
  back.style.cssText = 'font-size:16px;padding:8px 24px;margin-top:6px;';
  back.addEventListener('click', () => { panel.style.display = 'none'; });
  panel.appendChild(back);
  app.appendChild(panel);
  return panel;
})();

controlsBtn.addEventListener('click', () => {
  controlsPanel.style.display = controlsPanel.style.display === 'flex' ? 'none' : 'flex';
});

document.getElementById('resume-btn')!.addEventListener('click', () => input.lock());
document.getElementById('quit-btn')!.addEventListener('click', () => enterTitle());

document.addEventListener('pointerlockchange', () => {
  if (!worldReady) return;
  if (input.locked) {
    enterPlaying(); // entered or returned to the game
  } else if (!player.dead && !invUI.open && !worldMap.open && screen === 'playing') {
    enterPause(); // Esc / lost focus while playing -> pause, not the title
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (worldMap.open) { worldMap.hide(); input.lock(); }
  else if (invUI.open) { invUI.hide(); input.lock(); }
  else if (screen === 'paused' && !player.dead) input.lock(); // Esc resumes from pause
});

// Death and respawn.
const deathEl = document.getElementById('death')!;
let deathShown = false;
document.getElementById('respawn')!.addEventListener('click', () => {
  audio.resume();
  if (net.connected) {
    net.sendRespawn(); // server replies with onRespawned
  } else {
    player.respawn(spawn);
    lastHealth = 20;
    deathShown = false;
    deathEl.style.display = 'none';
    grantStarterKit(); // re-claim the basic loadout after death (offline)
    pushStateSave();
    input.lock();
  }
});

function checkDeath(): void {
  if (!player.dead || deathShown) return;
  deathShown = true;
  invUI.hide(); // closes (and saves) an open chest BEFORE we spill the inventory
  // Drop everything where we died — networked so others can grab it (MP) or
  // local item entities (offline). We can't pick anything up while dead.
  spillAtPlayer(inventory.spillAll());
  pushStateSave(); // persist the now-empty inventory so a reconnect can't dupe it
  // We can die while the pause menu is up (the sim never pauses). Normalize to
  // 'playing' and drop the pause menu so the death screen is the only overlay
  // and the Esc handler has no 'paused' branch to re-lock the pointer over it.
  screen = 'playing';
  pauseEl.style.display = 'none';
  deathEl.style.display = 'flex';
  document.exitPointerLock();
}

// --- Persistence: server-stored inventory + position (MP) and localStorage
// (offline). The server is the system of record online; offline we mirror to
// localStorage keyed by the local account so single-player also persists.
function pushStateSave(): void {
  if (net.connected) net.sendSaveState(inventory.serialize() as unknown as Record<string, unknown>);
  else if (authedName) {
    try {
      localStorage.setItem(`voxelon.inv.${authedName.toLowerCase()}`,
        JSON.stringify(inventory.serialize()));
    } catch { /* ignore */ }
  }
}
net.onRestoreState = (state) => inventory.restore(state);
// Offline: restore the saved inventory for the just-authed local account.
function restoreOfflineInventory(): void {
  if (net.connected || !authedName) return;
  try {
    const raw = localStorage.getItem(`voxelon.inv.${authedName.toLowerCase()}`);
    if (raw) inventory.restore(JSON.parse(raw));
  } catch { /* ignore */ }
}
// Periodic autosave + a final flush when the tab closes.
setInterval(pushStateSave, 15000);
window.addEventListener('beforeunload', pushStateSave);

// --- Multiplayer wiring (callbacks fire async, after the world is set up) ---
net.onWelcome = (me) => {
  // The welcome IS the online auth success signal — reveal Play, hide the form.
  onAuthSuccess(me.username);
  // Adopt the server-assigned spawn so we line up with the server's record.
  localFaction = me.faction;
  localSeasonsWon = me.seasonsWon ?? 0; // authoritative badge from the account
  player.pos.set(me.x, me.y, me.z);
  player.vel.set(0, 0, 0);
  player.health = me.health;
  player.dead = false;
  lastHealth = me.health;
  player.damageSink = (a) => net.sendSelfHurt(a); // server owns health in MP
  survival.enableRegen = false;                   // server runs regen
  applyLocalMode(me.mode);                         // restore admin-set gamemode
  refreshNetInfo();
};
net.onEdit = (x, y, z, b) => {
  world.applyRemoteEdit(x, y, z, b);
  // If someone removed/replaced the chest block we have open, stop viewing it.
  if (openChest && openChest.x === x && openChest.y === y && openChest.z === z
    && b !== Block.Chest) {
    forceCloseChest();
  }
  // Keep local machine prediction in step with remote placements/removals.
  const mt = machineTypeForBlock(b);
  if (mt !== null) {
    machines.place(x, y, z, mt);
  } else if (machines.has(x, y, z)) {
    machines.remove(x, y, z); // server already spilled the authoritative copy
    if (openMachine && openMachine.x === x && openMachine.y === y && openMachine.z === z) {
      forceCloseMachine();
    }
  }
};
net.onHurt = (health, dead, k) => {
  player.setHealthFromServer(health, dead);
  player.vel.x += k[0] * 6; player.vel.y += k[1] * 6; player.vel.z += k[2] * 6;
  // lastHealth is left alone so the frame loop plays the hurt sound.
};
net.onRespawned = (x, y, z, h) => {
  player.respawn({ x, y, z });
  player.health = h;
  lastHealth = h;
  deathShown = false;
  deathEl.style.display = 'none';
  grantStarterKit(); // re-claim the basic loadout after death (MP)
  pushStateSave();
  if (worldReady) input.lock();
};
net.onKillfeed = showKill;
net.onRoster = refreshNetInfo;
// Admin gamemode/teleport/notice (driven from the server console).
net.onGamemode = (mode) => { applyLocalMode(mode); showNotice(`Gamemode: ${mode}`); };
net.onTeleport = (x, y, z) => {
  player.pos.set(x, y, z);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
};
net.onNotice = (text) => showNotice(text);
net.onGotItem = (id, count) => {
  // The server grants the whole stack on a valid pickup; if it doesn't all fit,
  // re-drop the remainder as a server item entity so it isn't destroyed (the
  // offline path likewise leaves the leftover on the ground). After a partial
  // add the inventory has no room left, so the re-drop won't be re-requested.
  const left = inventory.add(id, count);
  if (left > 0) net.sendDrop([{ id, count: left }], player.pos.x, player.pos.y, player.pos.z);
};
net.onChest = (x, y, z, slots) => {
  chests.store(x, y, z, slots);
  // If we have this chest open, adopt the authoritative contents — but ONLY if
  // we haven't edited the chest region since our last load. Otherwise this could
  // be a stale open-reply (or another viewer's update) arriving after we placed
  // an item, which would clobber it (item loss). Our pending edits win and are
  // pushed by the live sync; last-writer-wins on close.
  if (openChest && openChest.x === x && openChest.y === y && openChest.z === z
    && inventory.version === chestBaseVersion) {
    inventory.loadChest(slots);
    lastChestVersion = chestBaseVersion = inventory.version;
  }
};
net.onMachine = (x, y, z, state) => {
  // Adopt the server's authoritative machine state (open reply / config /
  // upgrade / collect echo), replacing our local prediction.
  const s = sanitizeState(state);
  if (s) machines.set(x, y, z, s);
};
net.onShipState = (ship) => {
  const s = sanitizeShipState(ship);
  if (!s) return;
  ships.set(s);
  shipTargets.set(s.id, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: s.hp });
  // Auto-board a ship I just launched (my own, no current ship, standing near it).
  if (s.owner === net.username && pilotingShipId === null &&
    Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 6) {
    boardShip(s);
  }
};
net.onShipTransforms = (list) => {
  for (const t of list) {
    shipTargets.set(t.id, { x: t.x, y: t.y, z: t.z, yaw: t.yaw, hp: t.hp });
    const s = ships.get(t.id);
    // Non-piloted ships follow the server (lerped in updateShips); the piloted
    // ship keeps its local prediction and only adopts the server hp here.
    if (s && t.id !== pilotingShipId) { /* lerp handled in frame */ }
    if (s && t.id === pilotingShipId) s.hp = t.hp;
  }
};
net.onShipRemove = (id) => {
  const s = ships.get(id);
  if (s) particles.explosion(s.x, s.y + 0.5, s.z);
  ships.remove(id);
  shipTargets.delete(id);
  shipDelta.delete(id);
  if (pilotingShipId === id) pilotingShipId = null;
  if (ridingShipId === id) ridingShipId = null;
  if (openShip === id && invUI.open && invUI.mode === 'ship') invUI.hide();
  if (openShip === id) openShip = null;
};
net.onTurret = (x, y, z, state) => {
  const s = sanitizeTurretState(state);
  if (s) turretStates.set(`${x},${y},${z}`, s);
};
net.onTurretFire = (x, y, z, tx, ty, tz) => {
  turretModels.fireTracer(x, y, z, tx, ty, tz);
  particles.poof(tx, ty, tz);
  audio.gun(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
};
net.onRegions = (owners) => {
  if (Array.isArray(owners) && owners.length) regionOwners = owners;
};
net.onRegionMeters = (capFaction, capProgress) => {
  regionMeters = { faction: capFaction, progress: capProgress };
};
net.onRegionCapture = (region, faction, from) => {
  announceCapture(region, faction, from);
};
net.onRegionWin = (faction) => {
  showRegionBanner(`${factionName(faction).toUpperCase()} WINS THE WAR!`, factionCss(faction));
  showKill('★ SEASON WON ★', factionName(faction));
};
net.onSeason = (number, timeLeft) => { seasonNumber = number; seasonLeft = timeLeft; };
net.onSeasonEnd = (winner, number) => {
  // The server already reset the board + cleared bases authoritatively; mirror it
  // locally (drop claim domes) and flash the result. The winning side's badge is
  // refreshed on the next welcome, but bump it now for instant feedback.
  clearAllBases();
  if (winner === localFaction && winner >= 0) localSeasonsWon++;
  announceSeasonEnd(winner, number);
  refreshNetInfo();
};
net.onClaim = (claim) => {
  claims.set(claim); // adopt authoritative state (re-indexes its chunks)
};
net.onClaimRemove = (id) => {
  claims.remove(id);
  removeShieldDome(id);
  if (openClaim) { const c = claims.coreAt(openClaim.x, openClaim.y, openClaim.z); if (!c) forceCloseClaim(); }
};
net.onBreach = (attacker, faction, victim) => {
  showKill(`${factionName(faction)} breached`, `${factionName(victim)}'s claim`);
};
net.onDisconnect = () => {
  player.damageSink = undefined;
  survival.enableRegen = true;
  // Drop all server-owned warfare state so its meshes/markers don't linger
  // (shipModels/turretModels reconcile to the now-empty sets).
  ships.clear();
  shipTargets.clear();
  shipDelta.clear();
  turretStates.clear();
  pilotingShipId = null;
  ridingShipId = null;
  openShip = null;
  claims.clear();
  for (const id of [...shieldMeshes.keys()]) removeShieldDome(id);
  forceCloseClaim();
  refreshNetInfo();
};
interaction.onEdit = (x, y, z, b) => {
  // Placing a machine block creates its local entity (prediction offline + MP).
  const mt = machineTypeForBlock(b);
  if (mt !== null) machines.place(x, y, z, mt);
  // Base Core: offline we own the claim sim (server owns it in MP). Placing a
  // Core founds a base (3×3 footprint) — only in owned territory (Phase 3);
  // breaking one (owner) dissolves its claim.
  if (!net.connected) {
    if (b === Block.Core) claims.create(localFaction, x, y, z, worldTimeLocal);
    else if (b === Block.Air) {
      const c = claims.coreAt(x, y, z);
      if (c) { claims.remove(c.id); removeShieldDome(c.id); }
    }
  }
  net.sendEdit(x, y, z, b);
};
// A base Core may only be placed in a region your faction controls (Phase 3) —
// mirrors the server so the client never mispredicts an illegal base, online or
// off. Other blocks are unrestricted here.
interaction.canPlace = (x, _y, z, block) => {
  if (block !== Block.Core) return true;
  if (sameFaction(regionOwners[regionOf(x, z)] ?? NO_FACTION, localFaction)) return true;
  showNotice('You can only build a base in territory your faction controls!');
  return false;
};
// Block edits inside an enemy faction's protected claim (mirrors the server so
// the client never mispredicts a break/place it isn't allowed to make).
interaction.canEdit = (x, y, z) => {
  const c = claims.at(x, z);
  if (!c || sameFaction(localFaction, c.faction)) return true;
  // Enemies can never touch the Core block; otherwise blocked while protected —
  // UNLESS your faction owns the region the base sits in, which opens it (Phase 3).
  if (Math.floor(x) === c.coreX && Math.floor(y) === c.coreY && Math.floor(z) === c.coreZ) return false;
  const ownsRegion = sameFaction(regionOwners[regionOf(x, z)] ?? NO_FACTION, localFaction);
  return ownsRegion || !claimProtected(c, worldTimeLocal);
};
net.connect();

let worldReady = false;
const clock = new THREE.Clock();
let fps = 0, frames = 0, fpsTime = 0;
// Sound state
let lastHealth = 20;
let lastSentArmor = -1; // last armor-points value pushed to the server
let lastInWater = false;
let lavaTimer = 0; // throttles lava burn damage

// Gun state.
const ammoEl = document.getElementById('ammo')!;
const RELOAD_TIME = 1.1;
let fireCooldown = 0;
let reloadTimer = 0;
// Aim-down-sights magnification (1 = hip fire). Set each frame from the held
// gun's `zoom` while right-click is held; drives camera FOV + look sensitivity.
let aimZoom = 1;
let reloadingStack: ItemStack | null = null;
// Burst-fire scheduler (burst rifle): rounds left + interval timer for the gun
// that pulled the trigger.
const BURST_INTERVAL = 0.06;
let burstRemaining = 0;
let burstTimer = 0;
let burstStack: ItemStack | null = null;
let burstGun: GunInfo | null = null;

/** Jitter an aim direction within a cone of the given half-angle (radians). */
function spreadDir(dir: THREE.Vector3, spread: number): THREE.Vector3 {
  if (spread <= 0) return dir.clone();
  const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
  const ang = Math.random() * Math.PI * 2;
  const mag = Math.tan(spread) * Math.sqrt(Math.random());
  return dir.clone()
    .addScaledVector(right, Math.cos(ang) * mag)
    .addScaledVector(realUp, Math.sin(ang) * mag)
    .normalize();
}

/** Fire one round (consuming one from the magazine), spawning its pellet(s).
 *  Returns false if the magazine was empty. */
function fireVolley(stack: ItemStack, gun: GunInfo): boolean {
  const loaded = stack.loaded ?? gun.mag;
  if (loaded <= 0) return false;
  stack.loaded = loaded - 1;
  inventory.version++; // refresh the ammo counter
  const base = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const pellets = Math.max(1, gun.pellets ?? 1);
  const spread = gun.spread ?? 0;
  for (let i = 0; i < pellets; i++) {
    projectiles.fire(player.eyePosition, spreadDir(base, spread), gun);
  }
  held.recoil();
  audio.gun(player.eyePosition);
  return true;
}

function tryFire(stack: ItemStack, gun: GunInfo): void {
  fireCooldown = gun.cooldown;
  if (!fireVolley(stack, gun)) { fireCooldown = 0; reloadGun(); return; } // empty -> reload
  const burst = Math.max(1, gun.burst ?? 1);
  if (burst > 1) {
    burstRemaining = burst - 1;
    burstTimer = BURST_INTERVAL;
    burstStack = stack;
    burstGun = gun;
  }
}

function reloadGun(): void {
  if (reloadTimer > 0) return;
  const stack = inventory.selectedStack;
  const gun = stack ? ITEMS[stack.id]?.gun : undefined;
  if (!stack || !gun) return;
  const loaded = stack.loaded ?? gun.mag;
  if (loaded >= gun.mag || inventory.countItem(gun.ammo) <= 0) return;
  reloadTimer = RELOAD_TIME;
  reloadingStack = stack;
}
let stepAccum = 0;
let ambienceTimer = 20;
let torchTime = 0; // flame-flicker clock for the held-torch light
let wasGliding = false; // edge-detect glider deploy for the whoosh/notice

function facingString(): string {
  const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx > 0 ? 'east (+X)' : 'west (-X)';
  }
  return dz > 0 ? 'south (+Z)' : 'north (-Z)';
}

function clockString(): string {
  const tod = sky.time % 1; // 0 = 06:00
  const minutes = Math.floor(((tod * 24 + 6) % 24) * 60);
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m} (day ${Math.floor(sky.time) + 1})`;
}

function updateCamera(): void {
  camera.position.copy(player.eyePosition);
  // Brief roll tilt while the damage flash decays, like vanilla's hurt cam.
  camera.rotation.set(player.pitch, player.yaw, player.damageFlash * 0.18);

  // Aim-down-sights divides the FOV (zoom) and steadies the look.
  const base = player.sprinting ? SPRINT_FOV : FOV;
  const targetFov = base / aimZoom;
  player.lookScale = aimZoom > 1 ? Math.max(0.3, 1 / aimZoom) : 1;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * 0.3;
    camera.updateProjectionMatrix();
  }
}

function updateAtmosphere(): void {
  world.sunUniform.value = sky.sunIntensity;
  const fog = scene.fog as THREE.Fog;
  if (player.eyeUnderwater) {
    fog.color.copy(WATER_FOG_COLOR).multiplyScalar(0.3 + 0.7 * sky.sunIntensity);
    fog.near = 0;
    fog.far = 24;
  } else {
    fog.color.copy(sky.skyColor);
    fog.near = FOG_NEAR;
    fog.far = FOG_FAR;
  }
  (scene.background as THREE.Color).copy(fog.color);
}

function toggleMap(): void {
  if (player.dead) return;
  if (worldMap.open) {
    worldMap.hide();
    input.lock();
  } else if (input.locked) {
    if (invUI.open) invUI.hide();
    worldMap.show();
    document.exitPointerLock();
  }
}

function toggleInventory(): void {
  if (player.dead) return;
  if (invUI.open) {
    invUI.hide();
    input.lock();
  } else if (input.locked) {
    // At the helm, the inventory key opens the ship panel (upgrades + dock).
    if (pilotingShipId !== null && ships.get(pilotingShipId)) {
      openShip = pilotingShipId;
      invUI.show('ship', undefined, undefined, shipCtxFor(pilotingShipId));
    } else {
      invUI.show('inventory');
    }
    document.exitPointerLock();
  }
}

// --- Warfare: ship launch / board / steer / dock + turret + territory -------

function launchShipLocal(hx: number, hy: number, hz: number): void {
  const cap = (x: number, y: number, z: number) => world.getEditedBlock(x, y, z) ?? 0;
  const blocks = floodFillHull(hx, hy, hz, cap);
  if (!blocks) return; // not a helm / too small / too big
  const ship = newShip(localShipId++, 'You',
    { x: hx + 0.5, y: hy + 0.5, z: hz + 0.5 }, 0, blocks);
  for (const b of blocks) world.applyRemoteEdit(hx + b.dx, hy + b.dy, hz + b.dz, Block.Air);
  ships.set(ship);
  boardShip(ship);
}

function boardShip(ship: ShipState): void {
  ridingShipId = ship.id;
  pilotingShipId = ship.id;
  const deck = deckHeightAt(ship, ship.x, ship.z);
  player.pos.set(ship.x, deck ?? ship.y, ship.z);
  player.vel.set(0, 0, 0);
}

/** Dock/break down a ship: re-place its hull, remove the ship, return the
 *  player to control. Shared by the helm-panel button and the Shift shortcut. */
function dockShip(id: number): void {
  const s = ships.get(id);
  if (!s) return;
  if (net.connected) net.sendShipDock(id);
  else dockShipLocal(s);
  openShip = null; pilotingShipId = null; ridingShipId = null;
  // The hull re-materialises around where you stand (the helm lands in your
  // cell) — lift up so you settle on top of the deck instead of inside it.
  player.pos.y += 1.5;
  player.vel.set(0, 0, 0);
  if (invUI.open && invUI.mode === 'ship') invUI.hide();
  input.lock(); // closing via the in-panel button must re-capture the mouse
}

function dockShipLocal(ship: ShipState): void {
  for (const b of ship.blocks) {
    const w = blockWorldPos(ship, b);
    world.applyRemoteEdit(Math.round(w.x - 0.5), Math.round(w.y - 0.5), Math.round(w.z - 0.5), b.id);
  }
  ships.remove(ship.id);
  shipDelta.delete(ship.id);
  shipTargets.delete(ship.id);
}

function shipCtxFor(id: number): ShipUIContext {
  const here = () => ships.get(id) ?? null;
  return {
    state: here,
    upgrade: (axis: ShipAxis) => {
      const s = here();
      if (!s) return;
      const cost = shipUpgradeCost(s, axis);
      if (!cost || !canAffordCost(cost)) return;
      payCost(cost);
      applyShipUpgrade(s, axis); // local predict; server also applies + caps
      if (net.connected) net.sendShipUpgrade(id, axis);
    },
    canAfford: (axis) => {
      const s = here();
      const c = s ? shipUpgradeCost(s, axis) : null;
      return !!c && canAffordCost(c);
    },
    dock: () => dockShip(id),
  };
}

function turretCtxFor(x: number, y: number, z: number): TurretUIContext {
  const key = `${x},${y},${z}`;
  const here = () => turretStates.get(key) ?? null;
  return {
    state: here,
    upgrade: (axis: TurretAxis) => {
      const s = here();
      if (!s) return;
      const cost = turretUpgradeCost(s, axis);
      if (!cost || !canAffordCost(cost)) return;
      payCost(cost);
      applyTurretUpgrade(s, axis);
      if (net.connected) net.sendTurretUpgrade(x, y, z, axis);
    },
    canAfford: (axis) => {
      const s = here();
      const c = s ? turretUpgradeCost(s, axis) : null;
      return !!c && canAffordCost(c);
    },
    claim: () => {
      const s = here();
      if (!s) return;
      claimTurret(s, net.connected ? net.username : 'You');
      if (net.connected) net.sendTurretClaim(x, y, z);
    },
    load: (item: number) => {
      const s = here();
      if (!s) return;
      const have = inventory.countItem(item);
      const room = item === Item.Cannonball
        ? TURRET_AMMO_CAP - s.ammo : Math.floor(TURRET_FUEL_CAP - s.fuel);
      const n = Math.min(have, room);
      if (n <= 0) return;
      inventory.removeItem(item, n);
      turretLoad(s, item, n); // local predict
      if (net.connected) net.sendTurretLoad(x, y, z, item, n);
    },
    canLoad: (item: number) => {
      const s = here();
      if (!s) return false;
      const room = item === Item.Cannonball ? TURRET_AMMO_CAP - s.ammo : TURRET_FUEL_CAP - s.fuel;
      return inventory.countItem(item) > 0 && room > 0;
    },
    myName: () => (net.connected ? net.username : 'You'),
  };
}

/** Fire a cannonball from the piloted ship along the look direction. Consumes a
 *  Cannonball from the inventory; the projectile chips ships via shipHit and
 *  hits players via the ranged path (both server-validated). */
function fireCannon(ship: ShipState, dir: THREE.Vector3): void {
  if (cannonCooldown > 0 || cannonCount(ship) < 1) return;
  if (inventory.countItem(Item.Cannonball) <= 0) return;
  inventory.removeItem(Item.Cannonball, 1);
  cannonCooldown = shipFireInterval(ship.level);
  const cannonGun: GunInfo = {
    damage: shipCannonDamage(ship.level), ammo: Item.Cannonball, mag: 1,
    cooldown: cannonCooldown, auto: false, speed: 42, range: 64, rocket: true,
  };
  projectiles.fire(player.eyePosition, dir, cannonGun, ship.id);
  if (net.connected) net.sendShipFire(ship.id, dir.x, dir.y, dir.z);
  held.recoil();
  audio.gun(player.eyePosition);
}

/** Advance ships: predict the piloted ship from steer, follow others toward the
 *  server transform, and record each ship's frame motion for rider carry. */
function updateShips(dt: number, steer: { thrust: number; turn: number }): void {
  const height = (x: number, z: number) => world.terrain.height(x, z);
  shipDelta.clear();
  for (const ship of ships.list()) {
    const ox = ship.x, oz = ship.z, oyaw = ship.yaw;
    if (ship.id === pilotingShipId) {
      tickShip(ship, steer, dt, height); // local authority/prediction
    } else {
      const t = shipTargets.get(ship.id);
      if (t) {
        const k = Math.min(1, 12 * dt);
        ship.x += (t.x - ship.x) * k;
        ship.y += (t.y - ship.y) * k;
        ship.z += (t.z - ship.z) * k;
        let dy = t.yaw - ship.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        ship.yaw += dy * k;
        ship.hp = t.hp;
      }
    }
    let dyaw = ship.yaw - oyaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    shipDelta.set(ship.id, { ox, oz, nx: ship.x, nz: ship.z, dyaw });
  }
}

/** Carry the local player with the ship they're aboard: apply this frame's ship
 *  motion (translation + rotation about the pre-move origin) to the player. Run
 *  BEFORE player.update so look/gravity then apply on top. Returns the ship. */
function carryRider(): ShipState | null {
  let aboard: ShipState | null = null;
  for (const ship of ships.list()) {
    const dh = deckHeightAt(ship, player.pos.x, player.pos.z);
    if (dh !== null && player.pos.y >= dh - 0.6 && player.pos.y <= dh + 2.2) { aboard = ship; break; }
  }
  ridingShipId = aboard ? aboard.id : null;
  if (!aboard) { pilotingShipId = null; return null; }
  const d = shipDelta.get(aboard.id);
  if (d) {
    const relX = player.pos.x - d.ox, relZ = player.pos.z - d.oz;
    const c = Math.cos(d.dyaw), s = Math.sin(d.dyaw);
    player.pos.x = d.nx + (relX * c - relZ * s);
    player.pos.z = d.nz + (relX * s + relZ * c);
    player.yaw += d.dyaw;
  }
  // Auto-pilot when on/near the helm (origin). (Shift docks; see the frame loop.)
  const nearHelm = Math.hypot(player.pos.x - aboard.x, player.pos.z - aboard.z) < 1.8;
  pilotingShipId = nearHelm ? aboard.id : null;
  return aboard;
}

/** Keep an aboard rider standing on the deck (hull blocks aren't world-solid).
 *  Run AFTER player.update so it overrides the gravity that ran over open water. */
function snapToDeck(ship: ShipState): void {
  const onDeck = deckHeightAt(ship, player.pos.x, player.pos.z);
  if (onDeck !== null && player.pos.y < onDeck + 0.05) {
    player.pos.y = onDeck;
    if (player.vel.y < 0) player.vel.y = 0;
    player.onGround = true;
  }
}

// --- Region war (Phase 2): capture HUD + offline sim -------------------------

/** Friendly region label: a column letter + row number (e.g. "C4"), or CAPITAL. */
function regionLabel(i: number): string {
  if (isCapital(i)) return capitalFaction(i) === localFaction ? 'OUR CAPITAL' : 'ENEMY CAPITAL';
  const col = i % 6, row = Math.floor(i / 6);
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** Flash a banner + killfeed line for a region flip (loud + visual for kids). */
function announceCapture(region: number, faction: number, from: number): void {
  const label = regionLabel(region);
  if (faction === localFaction) showRegionBanner(`WE CAPTURED ${label}!`, factionCss(faction));
  else if (from === localFaction) showRegionBanner(`WE LOST ${label}!`, '#ff6a5a');
  showKill(`${factionName(faction)} took`, label);
}

/** Offline single-player: the local Regions sim IS authoritative (same pure
 *  module the server runs), driven by the local player's presence. */
function updateRegionsOffline(dt: number): void {
  const presence = [{ faction: localFaction, x: player.pos.x, z: player.pos.z, dead: player.dead }];
  const res = localRegions.tick(presence, dt);
  for (const ev of res.captured) announceCapture(ev.region, ev.faction, ev.from);
  if (res.winner >= 0) {
    // Taking the enemy capital wins the season instantly (Phase 5).
    endLocalSeason(res.winner);
    return;
  }
  regionOwners = localRegions.ownerList();
  regionMeters = localRegions.meters();
}

/** The always-on War HUD: a region tug bar + the control-point status of the
 *  region you're standing on (capturing / defending / neutral). */
function updateRegionWarHud(): void {
  const a = FACTIONS[0], b = FACTIONS[1];
  let ca = 0, cb = 0;
  for (let i = 0; i < regionOwners.length; i++) {
    if (regionOwners[i] === a.id) ca++; else if (regionOwners[i] === b.id) cb++;
  }
  regionWarEl.style.display = 'block';
  const aPct = (ca / Math.max(1, ca + cb)) * 100;
  regionWarEl.innerHTML =
    `<div style="margin-bottom:2px">⚔ <span style="color:${factionCss(a.id)}">${a.name} ${ca}</span>` +
    ` &nbsp;·&nbsp; <span style="color:${factionCss(b.id)}">${cb} ${b.name}</span></div>` +
    `<div style="height:9px;background:${factionCss(b.id)};border:1px solid #000;overflow:hidden">` +
    `<div style="height:100%;width:${aPct.toFixed(1)}%;background:${factionCss(a.id)}"></div></div>`;

  // Control-point status of the region under the player.
  const ri = regionOf(player.pos.x, player.pos.z);
  const c = regionCenter(ri);
  const onPoint = Math.hypot(player.pos.x - c.x, player.pos.z - c.z) <= CONTROL_RADIUS;
  if (!onPoint || ri >= REGION_COUNT) { captureBarEl.style.display = 'none'; return; }
  captureBarEl.style.display = 'block';
  const owner = regionOwners[ri];
  const capF = regionMeters.faction[ri] ?? NO_FACTION;
  const frac = Math.max(0, Math.min(1, regionMeters.progress[ri] ?? 0));
  if (capF !== NO_FACTION && frac > 0.001) {
    const label = capF === localFaction
      ? `CAPTURING ${regionLabel(ri)}`
      : owner === localFaction ? `DEFEND ${regionLabel(ri)}!` : `${factionName(capF)} TAKING ${regionLabel(ri)}`;
    captureBarEl.innerHTML =
      `<div style="color:${factionCss(capF)}">${label}</div>` +
      `<div style="height:13px;background:rgba(0,0,0,0.6);border:1px solid #000">` +
      `<div style="height:100%;width:${(frac * 100).toFixed(0)}%;background:${factionCss(capF)}"></div></div>`;
  } else {
    const who = owner === NO_FACTION ? 'Neutral' : factionName(owner) + (owner === localFaction ? ' (ours)' : '');
    const col = owner === NO_FACTION ? '#9fb0c4' : factionCss(owner);
    captureBarEl.innerHTML = `<div style="color:${col}">${isCapital(ri) ? '★ ' : ''}${regionLabel(ri)} — ${who}</div>`;
  }
}

// --- Seasons (Phase 5) -------------------------------------------------------

/** Human-readable "Xd Yh" / "Ym Zs" countdown for the season clock. */
function formatSeasonLeft(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${s % 60}s left`;
}

function updateSeasonHud(): void {
  seasonEl.style.display = 'block';
  seasonEl.innerHTML = `Season ${seasonNumber} · ${formatSeasonLeft(seasonLeft)}`;
}

/** Flash the season result + clear the old war (banner is loud for kids). */
function announceSeasonEnd(winner: number, number: number): void {
  if (winner >= 0) {
    showRegionBanner(`SEASON ${number}: ${factionName(winner).toUpperCase()} WINS! ★`, factionCss(winner));
    showKill(`★ Season ${number} won by`, factionName(winner));
  } else {
    showRegionBanner(`SEASON ${number}: STALEMATE — FRESH WAR!`, '#cfe0ff');
  }
}

/** Offline single-player: the local season clock is authoritative. Advance it,
 *  end the season at the deadline (most regions wins), and keep the HUD synced. */
function updateSeasonOffline(dt: number): void {
  tickSeasonClock(localSeason, dt);
  seasonNumber = localSeason.number;
  seasonLeft = seasonTimeLeft(localSeason);
  if (seasonExpired(localSeason)) endLocalSeason(deadlineWinner(localRegions.counts()));
}

/** Reset the war offline: award the local badge, clear bases, reset the board,
 *  and start the next season. */
function endLocalSeason(winner: number): void {
  const ended = localSeason.number;
  if (winner === localFaction && winner >= 0) {
    localSeasonsWon++;
    localAccounts.awardSeasonWin(winner);
    saveLocalAccounts();
    refreshNetInfo();
  }
  clearAllBases();
  localRegions.reset();
  regionOwners = localRegions.ownerList();
  regionMeters = localRegions.meters();
  advanceSeason(localSeason);
  seasonNumber = localSeason.number;
  seasonLeft = seasonTimeLeft(localSeason);
  announceSeasonEnd(winner, ended);
}

function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  frames++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fps = Math.round(frames / fpsTime);
    frames = 0;
    fpsTime = 0;
  }

  // The spawn area streams in quietly in the background (no loading screen) —
  // generously while we're still on the title, lightly once you're in.
  if (!worldReady && world.update(spawn.x, spawn.z, screen === 'title' ? 20 : 6)) {
    worldReady = true;
  }

  // Title screen: render the fixed "fake" panorama (its own world) and skip the
  // gameplay sim entirely. The gameplay world keeps generating above.
  if (screen === 'title') {
    panoramaView.update(dt);
    panoramaView.render(renderer);
    worldMap.hideBeacons();
    input.endFrame();
    return;
  }

  if (input.inventoryToggled) toggleInventory();
  if (input.mapToggled) toggleMap();
  worldMap.update();

  // Gun timers tick regardless of menu state (so a reload finishes even if you
  // open a menu); the reload pulls ammo into the magazine when it completes.
  if (fireCooldown > 0) fireCooldown = Math.max(0, fireCooldown - dt);
  if (cannonCooldown > 0) cannonCooldown = Math.max(0, cannonCooldown - dt);
  // Continue an in-flight burst (burst rifle) — cancelled if the gun is swapped.
  if (burstRemaining > 0 && burstGun && burstStack) {
    if (burstStack !== inventory.selectedStack || player.dead) {
      burstRemaining = 0; burstStack = null; burstGun = null;
    } else {
      burstTimer -= dt;
      while (burstRemaining > 0 && burstTimer <= 0) {
        if (!fireVolley(burstStack, burstGun)) { burstRemaining = 0; break; }
        burstRemaining--; burstTimer += BURST_INTERVAL;
      }
      if (burstRemaining <= 0) { burstStack = null; burstGun = null; }
    }
  }
  if (reloadTimer > 0) {
    reloadTimer -= dt;
    if (reloadTimer <= 0) {
      const rs = reloadingStack;
      const gun = rs ? ITEMS[rs.id]?.gun : undefined;
      if (rs && gun && rs === inventory.selectedStack) {
        const loaded = rs.loaded ?? gun.mag;
        rs.loaded = loaded + inventory.removeItem(gun.ammo, gun.mag - loaded);
        inventory.version++;
      }
      reloadingStack = null;
    }
  }

  // Direct control only while actively playing (pointer locked, no UI, alive).
  const controlling = input.locked && !player.dead && !invUI.open;

  // Keep worn-armor mitigation current before any damage can land this frame:
  // offline the player mitigates locally; in MP the server mitigates from this
  // synced value (clamped server-side).
  const armorPts = inventory.armorPoints();
  player.armorPoints = armorPts;
  if (net.connected && armorPts !== lastSentArmor) {
    lastSentArmor = armorPts;
    net.sendArmor(armorPts);
  }

  // In-world simulation (we've already returned early on the title screen) —
  // even with a menu open the world keeps ticking and you stay vulnerable; only
  // direct input is suspended (frozen input keeps gravity + PvP knockback).
  {
    if (controlling) {
      if (input.debugToggled) hud.toggleDebug();
      if (input.hotbarKey >= 0) inventory.select(input.hotbarKey);
      if (input.wheelDelta !== 0) inventory.select(inventory.selected + input.wheelDelta);
    }

    // Ships move first; then carry the local rider; then run player physics so
    // look/gravity apply on top of the carry. Steering reads this frame's input.
    const steer = { thrust: 0, turn: 0 };
    if (controlling && pilotingShipId !== null) {
      steer.thrust = input.forward ? 1 : input.back ? -1 : 0;
      steer.turn = input.left ? 1 : input.right ? -1 : 0;
    }
    updateShips(dt, steer);
    const aboard = carryRider();
    const piloting = controlling && pilotingShipId !== null && !!ships.get(pilotingShipId);
    // Shift docks/breaks down the ship you're piloting (rising-edge).
    if (piloting && controlling && input.sneak && !lastSneak) {
      dockShip(pilotingShipId!);
    }
    lastSneak = input.sneak;
    if (net.connected && pilotingShipId !== null) {
      shipSteerAcc += dt;
      if (shipSteerAcc >= 1 / 15) { shipSteerAcc = 0; net.sendShipSteer(pilotingShipId, steer.thrust, steer.turn); }
    }
    // While piloting, WASD steers (not walks): feed a look-only input.
    const moveInput = piloting
      ? { mouseDX: input.mouseDX, mouseDY: input.mouseDY, forward: false, back: false,
          left: false, right: false, jump: false, sneak: false,
          sprintKey: false, sprintHeld: false }
      : (controlling ? input : FROZEN_INPUT);
    // A glider worn in the chestplate slot enables mid-air deploy (player.update
    // reads this; jump while falling to start gliding).
    const wornChest = inventory.chestplateStack;
    player.gliderEquipped = !!wornChest && wornChest.id === Item.Glider;
    player.update(dt, moveInput, world);
    // World border: keep the player inside the 1000×1000 play area (the server
    // clamps authoritatively too).
    player.pos.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.pos.x));
    player.pos.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.pos.z));
    if (aboard) snapToDeck(aboard);

    // Gun aim-down-sights: hold right-click with a gun to zoom (per-gun amount).
    {
      const hs = inventory.selectedStack;
      const g = hs ? ITEMS[hs.id]?.gun : undefined;
      const aiming = controlling && localMode !== 'spectator' &&
        pilotingShipId === null && !!g?.zoom && input.rightDown;
      aimZoom = aiming ? g!.zoom! : 1;
    }
    updateCamera();

    // Held-torch dynamic light: holding a torch lights the world around you
    // (a moving point light in the chunk shader, with a gentle flame flicker).
    if (inventory.selectedStack?.id === Block.Torch) {
      torchTime += dt;
      // Strong, fully-lit near field (>1 so it saturates after the shader clamp)
      // with a gentle flame flicker.
      const flicker = 1.12 + Math.sin(torchTime * 11) * 0.06 + Math.sin(torchTime * 27) * 0.04;
      const e = player.eyePosition;
      world.setHeldLight(e.x, e.y, e.z, flicker);
    } else {
      world.setHeldLight(0, 0, 0, 0);
    }

    // Glider: whoosh + hint on deploy, and wear the worn glider down while
    // flying — it snaps when worn out (easy to break, by design).
    if (player.gliding && !wasGliding) {
      audio.glide();
      showNotice('Gliding! Look to steer · jump to stop');
    }
    wasGliding = player.gliding;
    if (player.gliding) {
      const g = inventory.chestplateStack;
      if (g && g.id === Item.Glider) {
        g.damage = (g.damage ?? 0) + dt;
        inventory.version++;
        if (g.damage >= (ITEMS[Item.Glider].glider?.durability ?? 1)) {
          inventory.clearChestplate();
          player.gliding = false;
          player.gliderEquipped = false;
          audio.gliderBreak();
          showNotice('Your glider broke!');
        }
      } else {
        player.gliding = false;
      }
    }

    // Spectators float freely but never mine/place/fight (the server rejects it
    // anyway; gating here avoids client mispredicts).
    if (controlling && localMode !== 'spectator') {
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const eye = player.eyePosition;
      const heldStack = inventory.selectedStack;
      const heldGun = heldStack ? ITEMS[heldStack.id]?.gun : undefined;

      if (piloting) {
        // At the helm: left-click fires cannons; mining/melee suppressed.
        const ship = ships.get(pilotingShipId!);
        if (ship && input.leftClicked) fireCannon(ship, lookDir);
        interaction.update(dt, input, camera, true);
      } else if (heldGun) {
        // Guns suppress melee + mining (and block use, so right-click aims down
        // sights instead of placing/opening): fire on click (semi) / hold (auto).
        if (input.reloadPressed) reloadGun();
        const wantFire = heldGun.auto ? input.leftDown : input.leftClicked;
        if (wantFire && fireCooldown <= 0 && reloadTimer <= 0) tryFire(heldStack!, heldGun);
        interaction.update(dt, input, camera, true, true);
      } else {
        // Melee no longer hits players — PvP is guns-only now. Left-click still
        // fights MOBS, otherwise mines the block. Priority: mob > mine.
        const mobInSights = mobs.rayHit(eye, lookDir, 3.5);
        if (input.leftClicked && mobInSights) {
          const tool = heldStack ? ITEMS[heldStack.id]?.tool : undefined;
          mobs.attack(eye, lookDir, tool?.damage ?? 1, player);
          if (tool) inventory.damageSelected(2);
          held.swing();
        }
        interaction.update(dt, input, camera, mobInSights !== null);
      }

      // Footsteps.
      const moveSpeed = Math.hypot(player.vel.x, player.vel.z);
      if (player.onGround && moveSpeed > 0.8) {
        stepAccum += moveSpeed * dt;
        if (stepAccum > 2.1) {
          stepAccum = 0;
          const under = world.getBlock(
            Math.floor(player.pos.x), Math.floor(player.pos.y - 0.5),
            Math.floor(player.pos.z)
          );
          audio.step(materialOf(under));
        }
      }
    }

    // Stream our transform even while paused/in a menu, so others still see
    // us (e.g. being knocked around). Throttled + connection-gated inside.
    net.sendXform(dt, player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch);

    // Simulation never pauses: mobs hunt you and survival ticks in menus too.
    survival.update(dt, player);
    mobs.update(dt, player, sky.sunIntensity);
    // Volcanic lava is a hazard: standing in it burns you (the M21 ashlands
    // doubles as a PvP hazard). Damage routes through the server in MP.
    lavaTimer = Math.max(0, lavaTimer - dt);
    if (!player.dead) {
      const inLava = world.getBlock(Math.floor(player.pos.x),
        Math.floor(player.pos.y + 0.2), Math.floor(player.pos.z)) === Block.Lava ||
        world.getBlock(Math.floor(player.pos.x),
          Math.floor(player.pos.y + 1.0), Math.floor(player.pos.z)) === Block.Lava;
      if (inLava && lavaTimer <= 0) { player.damage(6); lavaTimer = 0.5; }
    }
    // Machines run under the same never-pausing sim. Offline this is the
    // authoritative tick; in multiplayer it's a local prediction for the fill
    // bar (the server is authoritative and reconciles on open/collect).
    machines.update(dt);
    machineModels.update(dt); // animate drills/pumpjacks
    // Warfare: render ships/turrets, run the region war + its HUD.
    shipModels.update(ships.list());
    turretModels.update(dt);
    // Region war (Phase 2): offline the local sim is authoritative; the War HUD
    // reads the latest board + meters (server-fed online, local sim offline).
    if (!net.connected) updateRegionsOffline(dt);
    updateRegionWarHud();
    // Seasons (Phase 5): offline the local clock is authoritative.
    if (!net.connected) updateSeasonOffline(dt);
    updateSeasonHud();
    if (regionBannerTimer > 0) {
      regionBannerTimer -= dt;
      if (regionBannerTimer <= 0) regionBannerEl.style.display = 'none';
    }
    // Land claims: advance the grace/shield clock; offline this is the
    // authoritative claim sim (MP the server ticks + reconciles via 'claims').
    worldTimeLocal += dt;
    if (!net.connected) claims.tick(dt);
    updateShieldDomes(dt);
  }

  checkDeath();
  furnaces.update(dt);

  // Past this point we're always in-game (title returns early above).
  const activeCamera: THREE.Camera = camera;

  world.update(player.pos.x, player.pos.z, 6);
  sky.update(dt, activeCamera);
  updateAtmosphere();
  itemEntities.update(dt, player, inventory, sky.sunIntensity);
  particles.update(dt, activeCamera);
  // Hover health bar: the player the crosshair is over shows their health.
  if (controlling) {
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    remotePlayers.setHovered(remotePlayers.rayHit(player.eyePosition, lookDir, 60));
  } else {
    remotePlayers.setHovered(-1);
  }
  remotePlayers.update(dt); // interpolate + animate other players
  {
    netItems.update(dt, player, inventory, sky.sunIntensity);
    projectiles.update(dt); // in-flight rounds keep travelling even in a menu
  }

  // State-driven sounds.
  audio.updateListener(activeCamera);
  if (player.health < lastHealth) {
    if (!player.dead) audio.hurt();
    // Taking a hit levels your worn armor (more for harder hits).
    inventory.addArmorXp(2 + (lastHealth - player.health));
  }
  lastHealth = player.health;
  if (player.inWater && !lastInWater && Math.abs(player.vel.y) > 1) audio.splash();
  lastInWater = player.inWater;
  ambienceTimer -= dt;
  if (ambienceTimer <= 0) {
    ambienceTimer = 25 + Math.random() * 35;
    if (!world.hasSkyAccess(
      Math.floor(player.pos.x), Math.floor(player.pos.y + 1), Math.floor(player.pos.z)
    )) audio.caveAmbience();
  }
  // Held item shows only during active play.
  held.setItem(controlling ? inventory.selectedStack?.id ?? null : null);
  held.update(dt, controlling && input.leftDown, sky.sunIntensity);

  // Gameplay HUD chrome shows only during active play.
  const hudDisplay = controlling ? '' : 'none';
  crosshair.style.display = hudDisplay;
  hotbarEl.style.display = controlling ? 'flex' : 'none';
  statusEl.style.display = hudDisplay;

  // Ammo counter: "loaded / reserve" while a gun is held (RELOADING during one).
  const gunStack = controlling ? inventory.selectedStack : null;
  const gunInfo = gunStack ? ITEMS[gunStack.id]?.gun : undefined;
  if (gunInfo) {
    const loaded = gunStack!.loaded ?? gunInfo.mag;
    ammoEl.textContent = reloadTimer > 0
      ? 'RELOADING…'
      : `${loaded} / ${inventory.countItem(gunInfo.ammo)}`;
    ammoEl.style.display = 'block';
  } else {
    ammoEl.style.display = 'none';
  }
  hud.update();
  hud.updateStatus({
    health: player.health,
    energy: player.energy,
    exhausted: player.exhausted,
    air: player.air,
    maxAir: MAX_AIR,
    underwater: player.eyeUnderwater,
    armor: armorPts,
  });
  (document.getElementById('damage-flash') as HTMLDivElement).style.opacity =
    String(Math.min(0.35, player.damageFlash));

  // Push live chest edits to the server while a chest is open (version-gated).
  if (openChest && inventory.version !== lastChestVersion) {
    lastChestVersion = inventory.version;
    chests.sync(openChest.x, openChest.y, openChest.z, inventory.readChest());
  }
  invUI.update();

  if (hud.debugVisible) {
    const t = interaction.target;
    hud.updateDebug({
      fps,
      x: player.pos.x, y: player.pos.y, z: player.pos.z,
      cx: Math.floor(player.pos.x) >> 4, cz: Math.floor(player.pos.z) >> 4,
      facing: facingString(),
      target: t
        ? `${BLOCKS[world.getBlock(t.x, t.y, t.z)]?.name ?? '?'} at ${t.x} ${t.y} ${t.z}`
        : 'none',
      time: clockString(),
    });
  }

  input.endFrame();
  renderer.render(scene, activeCamera);
  // Floating waypoint badges (skip the title panorama — wrong camera + covered).
  worldMap.renderBeacons(window.innerWidth, window.innerHeight);
}

// No loading screen at all: show the title (with its panorama) immediately;
// the gameplay world streams in behind it while you read the menu / log in.
overlay.classList.remove('hidden');
updateCamera();
frame();
