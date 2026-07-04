import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS, isReplaceable } from './blocks';
import { Furnaces } from './furnace';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { Interaction, raycastBlocks } from './interact';
import { Inventory } from './inventory';
import {
  InventoryUI, MachineUIContext, TurretUIContext, ClaimUIContext,
} from './inventory_ui';
import { dropFor, GunInfo, Item, ItemStack, ITEMS } from './items';
import { RECIPES, Recipe } from './crafting';
import { renderItemIcon } from './icons';
import { itemDescription } from './itemdesc';
import {
  Machines, MachineType, allowedFilterMask, applyUpgrade, claimMachine,
  collectMachine, currentRate, machineHeight, machineTypeForBlock,
  sanitizeState, setFilter, upgradeCost,
} from './machines';
import { ItemEntities } from './itementity';
import { Chests } from './chests';
import { Mobs } from './mobs';
import { NetClient } from './net/client';
import {
  WORLD_SEED, WORLD_HALF, CORE_HALF, inCore, makeUsername, skinSeed, GameMode,
  FlagInfo, MAX_ATTUNED, TOTEM_COOLDOWN, TOTEM_WINDUP, COMBAT_TAG,
} from './net/protocol';
import { MachineModels } from './machinemodels';
import { NetItems } from './netitems';
import { Particles } from './particles';
import { Projectiles } from './projectiles';
import { Player, MAX_AIR } from './player';
import {
  TurretState, TurretAxis, applyTurretUpgrade, claimTurret, damageTurret,
  newTurret, sanitizeTurretState, turretLoad, turretUpgradeCost, TURRET_AMMO_CAP,
  TURRET_FUEL_CAP,
} from './turrets';
import { TurretModels } from './turretmodels';
import { RemotePlayers } from './remoteplayers';
import { WorldMap } from './worldmap';
import { Minimap } from './minimap';
import { Accounts, Account } from './net/accounts';
import {
  FACTIONS, NO_FACTION, factionColor, factionName, sameFaction, otherFaction,
} from './teams';
import {
  Claims, OIL_CAP, OIL_PER_BARREL, MAX_SHIELD_HP, claimProtected, damageShield,
  feedOil, shieldUp,
} from './claims';
import {
  Regions, CaptureMeters, REGION_COUNT, regionOf, regionCenter, regionBounds,
  capitalFaction, capitalOf, isCapital, CONTROL_RADIUS,
} from './regions';
import {
  newSeason, tickSeasonClock, seasonTimeLeft, seasonExpired, deadlineWinner,
  advanceSeason,
} from './season';
import { GadgetCooldowns, GadgetDef, gadgetOf } from './gadgets';
import {
  MAX_HEARTS, START_HEARTS, WITHDRAW_FLOOR, canConsume, canWithdraw,
  clampHearts, formatRemaining, maxHealthFor,
} from './hearts';
import { Sky, WATER_FOG_COLOR } from './sky';
import { Survival } from './survival';
import { createAtlas, createCrackTextures } from './textures';
import { World, RENDER_DISTANCE } from './world';
import { Panorama } from './panorama';
import { structureChestTier } from './structures';
import { chestLootSlots } from './loot';

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
const spawn = world.terrain.randomDrySpawn(Math.random, CORE_HALF);
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
// guns, machines, turret parts and upgrade materials.
if (new URLSearchParams(location.search).get('kit') === 'full') for (const [id, n] of [
  [Item.Pistol, 1], [Item.Rifle, 1], [Item.RocketLauncher, 1],
  [Item.Shotgun, 1], [Item.SMG, 1], [Item.Sniper, 1], [Item.BurstRifle, 1],
  [Item.Bullet, 256], [Item.Rocket, 16],
  [Block.Autominer, 8], [Block.OilDerrick, 8],
  // warfare kit: turrets, cannon ammo
  [Block.Turret, 8],
  [Item.Cannonball, 128],
  // building set
  [Block.OakPlanks, 64], [Block.OakSlab, 64], [Block.OakStairsN, 64],
  [Block.SpruceSlab, 64], [Block.SpruceStairsN, 64],
  // materials to craft/upgrade machines + turrets on the spot
  [Item.IronIngot, 64], [Item.Redstone, 64], [Item.Diamond, 32],
  [Item.CobaltIngot, 64], [Item.OilBarrel, 64], [Item.IronPickaxe, 1],
] as [number, number][]) {
  inventory.add(id, n);
}
const interaction = new Interaction(scene, world, player, cracks, inventory);
// Fixed "fake" title-screen panorama (its own world + seed; same every launch).
const panoramaView = new Panorama(atlas, window.innerWidth / window.innerHeight);

// Visual world border: four translucent cyan walls at ±WORLD_HALF so players
// can see the edge of the 5000×5000 play area (movement is clamped to it), plus
// a subtler faction-gold ring at ±CORE_HALF marking the HEARTLAND core — the
// inner 1000×1000 where claims/war/spawns live (outside = the Wilds).
(() => {
  const ring = (half: number, color: number, opacity: number, height: number): void => {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const geoNS = new THREE.PlaneGeometry(half * 2, height);
    for (const z of [-half, half]) {
      const w = new THREE.Mesh(geoNS, mat);
      w.position.set(0, height / 2, z); scene.add(w);
    }
    for (const x of [-half, half]) {
      const w = new THREE.Mesh(geoNS, mat);
      w.position.set(x, height / 2, 0); w.rotation.y = Math.PI / 2; scene.add(w);
    }
  };
  ring(WORLD_HALF, 0x5ad0ff, 0.42, 160); // hard outer border (cyan)
  ring(CORE_HALF, 0xffd84a, 0.14, 120);  // Heartland boundary (soft gold)
})();

const sky = new Sky(scene, seed);
const hud = new HUD(atlas.canvas, inventory);
// Gadget cooldown sweep on the hotbar (ender-pearl style).
hud.cooldownOf = (id) => {
  const d = gadgetOf(id);
  return d ? Math.min(1, gadgetCd.remaining(id, worldTimeLocal) / d.cooldown) : 0;
};
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
// --- Warfare (M14): turrets, territory ---
const turretStates = new Map<string, TurretState>();
const turretModels = new TurretModels(scene, turretStates);
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
// War windows (admin-scheduled in MP): capture is only open while `warActiveNow`.
// Offline single-player is always "at war" (free-play skirmish). The HUD counts
// these down locally between the server's periodic broadcasts.
let warActiveNow = false;
let warLeft = 0;   // seconds left in the active war
let warNextIn = 0; // seconds until the next scheduled war (peacetime)
// Gadgets (Phase 8): a local cooldown gate (the server enforces its own) +
// active spy disguises on remote players (id -> seconds of local time left).
const gadgetCd = new GadgetCooldowns();
const disguises = new Map<number, { realFaction: number; left: number }>();
let jumpImmuneUntil = 0; // suppress fall damage briefly after a Jump Boost
// Grappling hook: once fired, a string flies to the anchored block and reels the
// player the ENTIRE way (a sustained per-frame pull, not a one-shot nudge).
let grappleActive = false;
let grappleTime = 0;            // safety-timeout clock
/** A server teleport waiting for the destination chunks to stream in. While
 *  set, the player is pinned at the target (no gravity fall into ungenerated
 *  world); cleared once the near bubble is meshed (or after a timeout). */
let pendingTeleport: { x: number; y: number; z: number; started: number } | null = null;
const grappleAnchor = new THREE.Vector3();
const grapplePrev = new THREE.Vector3(); // last-frame pos to detect "stuck on a wall"
const grappleRope = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xf2efe6 }),
);
grappleRope.visible = false;
grappleRope.frustumCulled = false;
scene.add(grappleRope);
/** Reel the player toward the anchored block each frame until they arrive, hit a
 *  wall, or time out. Runs BEFORE player.update so the velocity it sets is what
 *  the physics step integrates. */
function updateGrapple(dt: number): void {
  if (!grappleActive) return;
  if (player.dead) { endGrapple(); return; }
  grappleTime += dt;
  // Pull from roughly chest height toward the anchor.
  const tx = grappleAnchor.x - player.pos.x;
  const ty = grappleAnchor.y - (player.pos.y + 0.9);
  const tz = grappleAnchor.z - player.pos.z;
  const dist = Math.hypot(tx, ty, tz) || 1;
  // Update the rope visual (hand/eye -> anchor).
  const eye = player.eyePosition;
  const pos = grappleRope.geometry.attributes.position as THREE.BufferAttribute;
  pos.setXYZ(0, eye.x, eye.y - 0.2, eye.z);
  pos.setXYZ(1, grappleAnchor.x, grappleAnchor.y, grappleAnchor.z);
  pos.needsUpdate = true;
  // Arrived or timed out -> release.
  if (dist < 2.0 || grappleTime > 3.5) { endGrapple(); return; }
  // Stuck against a wall (no progress) -> release; we're as close as we'll get.
  const moved = Math.hypot(
    player.pos.x - grapplePrev.x, player.pos.y - grapplePrev.y, player.pos.z - grapplePrev.z);
  if (grappleTime > 0.3 && moved < 0.03) { endGrapple(); return; }
  grapplePrev.copy(player.pos);
  // Constant strong reel (overwrites gravity each frame so it pulls the WHOLE way).
  const speed = 28;
  player.vel.x = (tx / dist) * speed;
  player.vel.y = (ty / dist) * speed;
  player.vel.z = (tz / dist) * speed;
  player.fallDistance = 0;
}
function endGrapple(): void {
  if (!grappleActive) return;
  grappleActive = false;
  grappleRope.visible = false;
  player.vel.multiplyScalar(0.3);     // bleed reel speed so you don't overshoot
  jumpImmuneUntil = worldTimeLocal + 2; // no fall damage right after release
}
// World map (M key): region board + claims + capture meters + waypoints.
const worldMap = new WorldMap(scene, camera, world.terrain, claims, {
  player: () => ({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }),
  faction: () => localFaction,
  regions: () => regionOwners,
  captureMeters: () => regionMeters,
});
// Circular HUD radar (top-left): live terrain + waypoints + capitals + faction tint.
const minimap = new Minimap(app, world.terrain);
// War flags (the land-claim markers). Server-driven; shown to everyone as a
// waypoint + an in-world flag. `flagsSetAt` lets the countdown tick smoothly
// between the server's periodic broadcasts.
let activeFlags: FlagInfo[] = [];
let flagsSetAt = 0;
const flagGroup = new THREE.Group();
scene.add(flagGroup);
const flagPoleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 6);
const flagClothGeo = new THREE.PlaneGeometry(2.2, 1.2);
/** Seconds left before a flag claims its land (smoothly counted down locally). */
function flagSecondsLeft(f: FlagInfo): number {
  return Math.max(0, Math.round(f.secondsLeft - (worldTimeLocal - flagsSetAt)));
}
/** Rebuild the in-world flag posts (a pole + a colored pennant) to match the
 *  active flag list. Cheap (at most a couple of flags). */
function rebuildFlagMeshes(): void {
  while (flagGroup.children.length) {
    const m = flagGroup.children.pop() as THREE.Mesh;
    (m.material as THREE.Material).dispose();
  }
  for (const f of activeFlags) {
    const gy = world.terrain.height(Math.round(f.x), Math.round(f.z));
    const col = factionColor(f.faction);
    const pole = new THREE.Mesh(flagPoleGeo, new THREE.MeshBasicMaterial({ color: 0x6b4a2a }));
    pole.position.set(f.x + 0.5, gy + 3, f.z + 0.5);
    flagGroup.add(pole);
    const cloth = new THREE.Mesh(flagClothGeo,
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    cloth.position.set(f.x + 0.5 + 1.1, gy + 5, f.z + 0.5);
    flagGroup.add(cloth);
  }
}
/** Flag markers (with countdown labels) for the map beacons + minimap. */
function flagMarkers(): { x: number; z: number; color: number; name: string }[] {
  return activeFlags.map((f) => {
    const s = flagSecondsLeft(f);
    const mm = Math.floor(s / 60), ss = s % 60;
    return {
      x: f.x, z: f.z, color: factionColor(f.faction),
      name: `🚩 ${factionName(f.faction)} ${mm}:${ss < 10 ? '0' : ''}${ss}`,
    };
  });
}
let openTurret: { x: number; y: number; z: number } | null = null;
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
  'width:118px;box-sizing:border-box;text-align:center;cursor:pointer;border:2px solid;' +
  'border-color:#fff #555 #555 #fff;background:#6b6b6b;color:#fff;text-shadow:none;';
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
// War clock: capture is only open during a war (admin-scheduled in MP).
const warEl = document.createElement('div');
warEl.className = 'mc-font';
warEl.style.cssText =
  'position:absolute;top:56px;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;text-align:center;font-size:13px;' +
  'text-shadow:1px 1px 0 #000;width:340px;display:none;';
app.appendChild(warEl);
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
// Lifesteal (Milestone A): the local player's hearts (max-health currency,
// 2 HP each). Server-authoritative online; a localStorage-mirrored SP stat
// offline (no elimination offline — zombies can't take hearts).
let localHearts = START_HEARTS;
function applyHearts(n: number): void {
  localHearts = clampHearts(n);
  player.maxHealth = maxHealthFor(localHearts);
  player.health = Math.min(player.health, player.maxHealth);
  saveOfflineHearts();
}
function saveOfflineHearts(): void {
  if (net.connected || !authedName) return;
  try {
    localStorage.setItem(`voxelon.hearts.${authedName.toLowerCase()}`, String(localHearts));
  } catch { /* ignore */ }
}
function restoreOfflineHearts(): void {
  if (net.connected || !authedName) return;
  try {
    const h = localStorage.getItem(`voxelon.hearts.${authedName.toLowerCase()}`);
    applyHearts(h === null ? START_HEARTS : Number(h));
  } catch { /* ignore */ }
}
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
function dropCurrentItem(entireStack = false): void {
  const stack = inventory.selectedStack;
  if (!stack) return;
  const count = entireStack ? stack.count : 1;
  const d = new THREE.Vector3(-Math.sin(player.yaw), 0.3, -Math.cos(player.yaw)).normalize();
  const dropPos = player.pos.clone().addScaledVector(d, 1.0);
  dropPos.y += 1.2;
  spawnDrop(dropPos.x, dropPos.y, dropPos.z, stack.id, count);
  inventory.consumeSelected(count);
  pushStateSave();
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
    if (!net.connected) ensureOfflineStructureLoot(x, y, z); // unopened loot still spills
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
// Offline structure-chest loot: a pristine terrain chest rolls its seeded loot
// on FIRST interaction (open or break) — the same pure roll the server makes
// online, so the contents are identical. `structLooted` stops a re-roll after
// the chest is broken and replaced in the same session.
const structLooted = new Set<string>();
function ensureOfflineStructureLoot(x: number, y: number, z: number): void {
  if (net.connected) return; // online: the server owns the roll
  const key = `${x},${y},${z}`;
  if (chests.has(x, y, z) || structLooted.has(key)) return;
  const tier = structureChestTier(seed, x, y, z, world.terrain);
  if (!tier) return;
  structLooted.add(key);
  chests.store(x, y, z, chestLootSlots(seed, x, y, z, tier));
}

interaction.onOpenContainer = (kind, x, y, z) => {
  if (kind === 'chest') {
    openChest = { x, y, z };
    ensureOfflineStructureLoot(x, y, z);
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
    invUI.show('turret', undefined, undefined, turretCtxFor(x, y, z));
  } else if (kind === 'claim') {
    if (!claims.coreAt(x, y, z)) return; // no claim here (e.g. an orphan Core)
    openClaim = { x, y, z };
    if (net.connected) net.sendClaimOpen(x, y, z);
    invUI.show('claim', undefined, undefined, undefined, claimCtxFor(x, y, z));
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
    move: () => {
      if (!here()) return;
      const fromX = x, fromY = y, fromZ = z;
      forceCloseMachine();
      if (invUI.open && invUI.mode === 'machine') invUI.hide();
      if (worldReady) input.lock();
      showNotice('✋ Right-click where to move the machine.');
      interaction.armedMove = (px, py, pz) => moveMachine(fromX, fromY, fromZ, px, py, pz);
    },
    myName: () => (net.connected ? net.username : 'You'),
  };
}

/** Relocate a placed machine to a new anchor cell. You can't break a machine,
 *  only MOVE it — so this preserves its level/storage/filter/stored output.
 *  Online the server does the authoritative move + echoes the edits; offline we
 *  carry the local MachineState object across to the new footprint. */
function moveMachine(
  fromX: number, fromY: number, fromZ: number, px: number, py: number, pz: number
): void {
  const s = machines.get(fromX, fromY, fromZ);
  if (!s) return;
  const type = s.type;
  const h = machineHeight(type);
  // Validate the destination column is clear (cells being vacated count as free).
  for (let k = 0; k < h; k++) {
    const cy = py + k;
    const vacating = px === fromX && pz === fromZ && cy >= fromY && cy < fromY + h;
    if (cy < 0 || cy >= 256 || (!vacating && !isReplaceable(world.getBlock(px, cy, pz)))) {
      showNotice('No room to move it there.');
      return;
    }
  }
  if (net.connected) {
    net.sendMachineMove(fromX, fromY, fromZ, px, py, pz); // server echoes edits + state
    audio.place(materialOf(Block.Autominer), new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5));
    return;
  }
  // Offline: move the footprint + the live state object locally.
  const blockId = type === MachineType.OilDerrick ? Block.OilDerrick : Block.Autominer;
  for (let k = 0; k < h; k++) world.applyRemoteEdit(fromX, fromY + k, fromZ, Block.Air);
  machines.remove(fromX, fromY, fromZ); // deletes the map entry; `s` keeps the data
  world.setBlock(px, py, pz, blockId);
  for (let k = 1; k < h; k++) world.setBlock(px, py + k, pz, Block.MachinePart);
  machines.set(px, py, pz, s);
  audio.place(materialOf(blockId), new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5));
  showNotice('Machine moved!');
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
/** Demolish every placed machine whose anchor is within `radius` of a blast
 *  (offline only; the server does this authoritatively online). */
function destroyMachinesNear(center: THREE.Vector3, radius: number): void {
  const r = radius + 1.5;
  for (const m of machines.list()) {
    if (Math.hypot(m.x + 0.5 - center.x, m.y + 0.5 - center.y, m.z + 0.5 - center.z) <= r) {
      destroyMachineLocal(m.x, m.y, m.z);
    }
  }
}

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

// Sabotage: left-click damages turret HP. Machines are explosive-only (a left
// click just reminds the player); the hint is throttled so it doesn't spam.
let lastSabotageHint = -10;
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
  // Machines are immune to bullets + melee — the ONLY way to take one down is an
  // explosive (a grenade detonates it). Tell the player instead of chipping HP.
  if (worldTimeLocal - lastSabotageHint > 1.2) {
    lastSabotageHint = worldTimeLocal;
    showNotice('💥 Machines only break to explosives — use a grenade!');
  }
};
// Right-click a Respawn Beacon to set your personal respawn point there.
interaction.onSetSpawn = (x, y, z) => {
  if (net.connected) {
    net.sendSetSpawn(x, y, z); // server validates the block + range, replies notice
  } else {
    localSpawn = { x, y, z };
    showNotice('✅ Respawn point set!');
  }
  particles.burst(x + 0.5, y + 1.1, z + 0.5, 18, 0x88ff99, 2.4, 0.9);
  audio.place(materialOf(Block.RespawnBeacon), new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
};
invUI.onClose = () => {
  if (openChest) {
    chests.sync(openChest.x, openChest.y, openChest.z, inventory.saveChest());
    openChest = null;
  }
  openMachine = null; // machine actions sync immediately; nothing to flush
  openTurret = null;  // turret actions also sync immediately
};
const spillAtPlayer = (stacks: ItemStack[]) =>
  spillStacks(stacks, player.pos.x, player.pos.y + 1, player.pos.z);
invUI.onOverflow = spillAtPlayer;
// Lifesteal: crafting a Heart item bottles one of YOUR hearts. Veto the craft
// at the withdrawal floor; a successful craft tells the server to deduct the
// heart (offline it's deducted locally). Mirrors the server's own floor check.
invUI.canCraft = (r) => {
  if (r.id !== Item.Heart) return true;
  if (canWithdraw(localHearts)) return true;
  showNotice(`You need at least ${WITHDRAW_FLOOR + 1} hearts to bottle one!`);
  return false;
};
invUI.onCrafted = (r) => {
  if (r.id !== Item.Heart) return;
  if (net.connected) {
    net.sendHeartWithdraw(); // the echo applies the new count + plays the toast
  } else {
    applyHearts(localHearts - 1);
    showNotice(`−1 ❤ bottled — now ${localHearts}`);
    audio.heartLoss();
  }
};

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

// Registration auto-assigns the balanced (50/50) side — no picking. We flag a
// fresh registration so the assigned side is announced once the faction is known
// (immediately offline; on `welcome` online).
let justRegistered = false;
function announceSide(faction: number): void {
  showRegionBanner(`YOU FIGHT FOR ${factionName(faction).toUpperCase()}!`, factionCss(faction));
  showNotice(`⚔ You joined the ${factionName(faction)} — keeping the war 50/50.`);
}

function onAuthSuccess(username: string): void {
  authed = true;
  authedName = username;
  held.setSkin(skinSeed(username)); // match the first-person hand to our avatar
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
    // Online: the server is the authority. No side pick — the server balances.
    authStatus.textContent = mode === 'register' ? 'Registering…' : 'Logging in…';
    if (mode === 'register') { justRegistered = true; net.sendRegister(username, password); }
    else net.sendLogin(username, password);
  } else if (net.offline) {
    // Offline single-player: verify against the local account store.
    const res = mode === 'register'
      ? localAccounts.register(username, password, localHash,
          `${Math.floor(Math.random() * 1e9).toString(16)}${Date.now().toString(16)}`)
      : localAccounts.login(username, password, localHash);
    if (!res.ok || !res.account) { authErr.textContent = res.error ?? 'Failed'; return; }
    if (mode === 'register') saveLocalAccounts();
    localFaction = res.account.faction;
    onAuthSuccess(res.account.username);
    spawnInOwnTerritory(); // never drop into enemy land (offline)
    if (mode === 'register') announceSide(localFaction);
    if (mode === 'login') restoreOfflineInventory(); // bring back saved single-player stuff
    restoreOfflineHearts(); // fresh accounts fall back to the 10-heart start
    restoreOfflineTotems(); // attuned Waypoint Totems (fast travel)
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
    authToggle.innerHTML = 'Already have an account? <a id="toggle-link">Log in</a>';
    if (!authUser.value) rollUsername();
  } else {
    submitBtn.textContent = 'Log In';
    authUser.readOnly = false;         // type your existing name to log in
    authUser.value = '';
    rollBtn.style.display = 'none';
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
      if (worldReady) { playBtn.textContent = 'Play'; beginPlay(); }
      else setTimeout(wait, 100);
    };
    wait();
    return;
  }
  beginPlay();
});

// First drop-in shows a tiny tutorial (once, tracked in localStorage); after
// that — or on Skip/Play! — we lock the pointer and enter the game.
function beginPlay(): void {
  if (!tutorialSeen) { tutorial.show(); return; }
  input.lock();
}

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
    ['Sprint', 'Q / double-tap W'], ['Break / attack mob', 'Left click'],
    ['Place / use', 'Right click'], ['Aim down sights (guns)', 'Hold right click'],
    ['Reload gun', 'R'], ['Drop item', 'O (Shift+O = stack)'], ['Deploy glider (in mid-air)', 'Jump'],
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

// --- First-play tutorial: 3 tiny cards, shown ONCE on the first Play ----------
let tutorialSeen = false;
try { tutorialSeen = localStorage.getItem('voxelon.tutorialSeen') === '1'; } catch { /* ignore */ }

const tutorial = (() => {
  const steps: { title: string; lines: string[] }[] = [
    { title: '⛏️ MOVE & BUILD', lines: [
      'WASD to move · Space to jump',
      'Left-click mines blocks · Right-click places & uses them',
    ] },
    { title: '🎒 CRAFT', lines: [
      'Press E for your inventory + crafting',
      'Build a Crafting Table, open it, and hit 📖 Guide for every recipe',
    ] },
    { title: '⚔️ WAR', lines: [
      "You're auto-assigned to a faction — fight for it!",
      'Stand in an enemy region to capture it · M = map',
    ] },
  ];
  let i = 0;
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;background:rgba(8,8,14,0.92);z-index:26;';
  const card = document.createElement('div');
  card.className = 'mc-font';
  card.style.cssText = 'background:#15182b;border:2px solid #3a4790;border-radius:10px;' +
    'padding:22px 26px;max-width:440px;text-align:center;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:24px;letter-spacing:2px;color:#ffd84a;margin-bottom:12px;';
  const body = document.createElement('div');
  body.style.cssText = 'font-size:15px;color:#cfe0ff;line-height:1.7;text-shadow:none;';
  const dots = document.createElement('div');
  dots.style.cssText = 'font-size:14px;color:#7f8db0;margin-top:14px;letter-spacing:3px;';
  card.append(title, body, dots);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;';
  const skip = document.createElement('button');
  skip.className = 'mc-btn'; skip.textContent = 'Skip';
  skip.style.cssText = 'font-size:15px;padding:7px 20px;';
  const next = document.createElement('button');
  next.className = 'mc-btn';
  next.style.cssText = 'font-size:15px;padding:7px 26px;';
  row.append(skip, next);
  panel.append(card, row);
  app.appendChild(panel);

  function render(): void {
    const s = steps[i];
    title.textContent = s.title;
    body.innerHTML = s.lines.map((l) => `<div>${l}</div>`).join('');
    dots.textContent = steps.map((_, k) => (k === i ? '●' : '○')).join(' ');
    next.textContent = i === steps.length - 1 ? 'Play!' : 'Next ▶';
  }
  function finish(): void {
    panel.style.display = 'none';
    tutorialSeen = true;
    try { localStorage.setItem('voxelon.tutorialSeen', '1'); } catch { /* ignore */ }
    if (worldReady) input.lock();
  }
  skip.addEventListener('click', finish);
  next.addEventListener('click', () => {
    if (i >= steps.length - 1) finish();
    else { i++; render(); }
  });
  return {
    get open(): boolean { return panel.style.display === 'flex'; },
    show(): void { i = 0; render(); panel.style.display = 'flex'; },
    finish,
  };
})();

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
// Safety net: re-engage pointer lock by clicking the world when we're in-game
// but unlocked (e.g. a menu just closed but the browser blocked an immediate
// re-lock — "requestPointerLock too soon after exit"). This guarantees you can
// always get movement back after closing the Map panel.
renderer.domElement.addEventListener('mousedown', () => {
  if (screen === 'playing' && !input.locked && !player.dead &&
      !invUI.open && !worldMap.open) {
    input.lock();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (tutorial.open) { tutorial.finish(); }
  else if (guideOpen) { hideGuide(); }
  else if (worldMap.open) { worldMap.hide(); input.lock(); }
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
    spawnInOwnTerritory(); // respawn in our own land, never enemy territory
    player.respawn({ x: player.pos.x, y: player.pos.y, z: player.pos.z });
    lastHealth = player.maxHealth;
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
  if (justRegistered) { justRegistered = false; announceSide(localFaction); }
  player.pos.set(me.x, me.y, me.z);
  player.vel.set(0, 0, 0);
  applyHearts(me.hearts ?? START_HEARTS); // hearts first so max HP is right
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
  endGrapple();
  player.pos.set(x, y, z);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  // The destination is usually unstreamed world (getBlock reads air there), so
  // hold the player in place until a bubble of chunks loads — otherwise they
  // free-fall into the not-yet-generated void and die on arrival.
  pendingTeleport = { x, y, z, started: worldTimeLocal };
  showNotice('Teleporting…');
};
net.onNotice = (text) => showNotice(text);

// --- Waypoint Totems (B4): attune (right-click) + travel (map click) ----------
// Server-authoritative online (attuned list + cooldown + combat tag live
// there); the same rules run locally offline. The client owns the 3s wind-up,
// which any damage interrupts (the server's combat tag re-checks it anyway).
let attunedTotems: { x: number; y: number; z: number }[] = [];
let totemCdUntil = 0;        // local cooldown clock (worldTimeLocal; UX + offline rule)
let lastDamageLocal = -999;  // worldTimeLocal of the last damage taken (combat tag)
let totemWindup: { x: number; y: number; z: number; left: number } | null = null;
function setAttuned(list: { x: number; y: number; z: number }[]): void {
  attunedTotems = list;
  worldMap.setTotems(list);
  if (!net.connected && authedName) {
    try {
      localStorage.setItem(`voxelon.totems.${authedName.toLowerCase()}`, JSON.stringify(list));
    } catch { /* ignore */ }
  }
}
function restoreOfflineTotems(): void {
  if (net.connected || !authedName) return;
  try {
    const raw = localStorage.getItem(`voxelon.totems.${authedName.toLowerCase()}`);
    const list = raw ? JSON.parse(raw) as { x: number; y: number; z: number }[] : [];
    setAttuned(Array.isArray(list)
      ? list.filter((t) => Number.isFinite(t?.x) && Number.isFinite(t?.y) && Number.isFinite(t?.z))
          .slice(0, MAX_ATTUNED)
      : []);
  } catch { setAttuned([]); }
}
net.onAttuned = (totems) => setAttuned(totems);
interaction.onAttune = (x, y, z) => {
  if (net.connected) { net.sendAttune(x, y, z); return; }
  // Offline: the same toggle + cap rules the server enforces online.
  const at = attunedTotems.findIndex((t) => t.x === x && t.y === y && t.z === z);
  if (at >= 0) {
    setAttuned(attunedTotems.filter((_, i) => i !== at));
    showNotice('Attunement released.');
  } else if (attunedTotems.length >= MAX_ATTUNED) {
    showNotice(`You can attune at most ${MAX_ATTUNED} totems — release one first (right-click it).`);
  } else {
    setAttuned([...attunedTotems, { x, y, z }]);
    showNotice(`🗿 Totem attuned (${attunedTotems.length}/${MAX_ATTUNED}) — open the map (M) to travel!`);
  }
};
worldMap.onTotemTravel = (t) => {
  if (player.dead || totemWindup) return;
  if (worldTimeLocal < totemCdUntil) {
    showNotice(`Totem travel recharging — ${Math.ceil(totemCdUntil - worldTimeLocal)}s left.`);
    return;
  }
  if (worldTimeLocal - lastDamageLocal < COMBAT_TAG) {
    showNotice("You can't teleport while in combat!");
    return;
  }
  worldMap.hide();
  input.lock();
  totemWindup = { x: t.x, y: t.y, z: t.z, left: TOTEM_WINDUP };
  showNotice(`🗿 Focusing on the totem… ${TOTEM_WINDUP}s — don't get hit!`);
};
/** Advance the wind-up each frame; damage cancels, completion teleports. */
function tickTotemWindup(dt: number): void {
  if (!totemWindup) return;
  if (player.dead || worldTimeLocal - lastDamageLocal < 0.5) {
    totemWindup = null;
    showNotice('Teleport interrupted!');
    return;
  }
  totemWindup.left -= dt;
  if (totemWindup.left > 0) return;
  const { x, y, z } = totemWindup;
  totemWindup = null;
  totemCdUntil = worldTimeLocal + TOTEM_COOLDOWN;
  if (net.connected) {
    net.sendTotemTeleport(x, y, z); // server validates + replies `teleport`
    return;
  }
  // Offline: the totem must still be standing (mirror of the server rule).
  if (world.getBlock(x, y, z) !== Block.WaypointTotem) {
    setAttuned(attunedTotems.filter((tt) => !(tt.x === x && tt.y === y && tt.z === z)));
    showNotice('That totem was destroyed!');
    return;
  }
  endGrapple();
  player.pos.set(x + 0.5, y + 1, z + 0.5);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  pendingTeleport = { x: x + 0.5, y: y + 1, z: z + 0.5, started: worldTimeLocal };
  showNotice('Teleporting…');
}

// --- Lifesteal (Milestone A) -------------------------------------------------
net.onHearts = (hearts, reason, from) => {
  applyHearts(hearts);
  switch (reason) {
    case 'steal':
      showNotice(`+1 ❤ (stole from ${from ?? 'an enemy'})`);
      audio.heartSteal();
      break;
    case 'loss':
      showNotice(from ? `−1 ❤ (stolen by ${from})` : '−1 ❤');
      audio.heartLoss();
      break;
    case 'consume':
      showNotice(`+1 max ❤ — now ${localHearts}!`);
      audio.heartSteal();
      break;
    case 'withdraw':
      showNotice(`−1 ❤ bottled — now ${localHearts}`);
      audio.heartLoss();
      break;
    // 'init'/'admin': the server sends its own notice when one is warranted.
  }
};
// Full-screen elimination banner (the server disconnects us moments later).
const elimEl = document.createElement('div');
elimEl.className = 'mc-font';
elimEl.style.cssText =
  'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;' +
  'justify-content:center;gap:16px;background:rgba(24,4,10,0.93);z-index:40;text-align:center;';
app.appendChild(elimEl);
net.onEliminated = (by, until) => {
  deathEl.style.display = 'none'; // the elimination banner replaces the death screen
  const ms = Math.max(0, until - Date.now());
  elimEl.innerHTML =
    '<div style="font-size:44px;color:#ff5a5a;text-shadow:3px 3px 0 #000;letter-spacing:3px;">💀 ELIMINATED</div>' +
    `<div style="font-size:18px;color:#ffd0d0;">${by} took your last heart!</div>` +
    '<div style="font-size:14px;color:#cfe0ff;max-width:460px;line-height:1.7;">' +
    `You can come back in <b>${formatRemaining(ms)}</b> — or a teammate can bring you back early with a Revival Beacon. ` +
    'Your base, faction and stuff are waiting for you.</div>';
  const back = document.createElement('button');
  back.className = 'mc-btn';
  back.textContent = 'Back to Title';
  back.style.cssText = 'font-size:15px;padding:8px 24px;margin-top:8px;';
  back.addEventListener('click', () => { elimEl.style.display = 'none'; enterTitle(); });
  elimEl.appendChild(back);
  elimEl.style.display = 'flex';
  audio.heartLoss();
  document.exitPointerLock();
};
// Revival Beacon: right-click opens a picker of eliminated teammates (the
// server supplies the list; the beacon is consumed only on a confirmed revive).
const revivePanel = document.createElement('div');
revivePanel.style.cssText =
  'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;' +
  'justify-content:center;gap:12px;background:rgba(8,10,18,0.9);z-index:30;';
app.appendChild(revivePanel);
function hideRevivePanel(lock = true): void {
  revivePanel.style.display = 'none';
  if (lock && worldReady && !player.dead) input.lock();
}
function openRevivePicker(): void {
  if (!net.connected) { showNotice('Reviving teammates works on the online server.'); return; }
  net.sendReviveList(); // the reply builds + shows the picker
}
net.onReviveList = (targets) => {
  if (!inventory.countItem(Item.RevivalBeacon)) return; // beacon gone in the meantime
  if (!targets.length) {
    showNotice('No eliminated teammates right now — lucky team!');
    return;
  }
  revivePanel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'mc-font';
  title.textContent = '✨ REVIVE A TEAMMATE';
  title.style.cssText = 'font-size:26px;color:#ffd84a;letter-spacing:2px;text-shadow:2px 2px 0 #000;';
  revivePanel.appendChild(title);
  for (const t of targets.slice(0, 12)) {
    const b = document.createElement('button');
    b.className = 'mc-btn';
    b.style.cssText = 'font-size:15px;padding:8px 22px;min-width:340px;';
    b.textContent = `${t.username} — back in ${formatRemaining(t.remainingMs)}`;
    b.addEventListener('click', () => {
      net.sendBeaconRevive(t.username);
      hideRevivePanel();
    });
    revivePanel.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.className = 'mc-btn';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'font-size:14px;padding:7px 20px;margin-top:6px;';
  cancel.addEventListener('click', () => hideRevivePanel());
  revivePanel.appendChild(cancel);
  revivePanel.style.display = 'flex';
  document.exitPointerLock();
};
net.onRevived = (target, ok) => {
  // The server's notice explains either way; a confirmed revive consumes the
  // beacon (it was validated against a real eliminated teammate).
  if (ok) {
    inventory.removeItem(Item.RevivalBeacon, 1);
    pushStateSave();
    showRegionBanner(`✨ ${target.toUpperCase()} IS BACK!`, '#7dffa0');
  }
};
/** Right-click a held Heart: +1 max heart (server-validated online). */
function consumeHeartItem(): void {
  if (!canConsume(localHearts)) {
    showNotice(`Your hearts are already full (${MAX_HEARTS})!`);
    return;
  }
  inventory.consumeSelected(1);
  if (net.connected) {
    net.sendHeartConsume(); // the echo applies the count + plays the toast
  } else {
    applyHearts(localHearts + 1);
    showNotice(`+1 max ❤ — now ${localHearts}!`);
    audio.heartSteal();
  }
  pushStateSave();
}
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
net.onWar = (active, timeLeft, nextIn) => {
  const wasActive = warActiveNow;
  warActiveNow = active; warLeft = timeLeft; warNextIn = nextIn;
  if (active && !wasActive) showRegionBanner('⚔️ WAR! CAPTURE THE REGIONS!', '#ff5a5a');
  else if (!active && wasActive) showRegionBanner('🕊️ PEACETIME — CAPTURE LOCKED', '#9fd0ff');
};
net.onFlags = (flags) => {
  // Announce a flag that's newly aimed at land you care about (plant feedback).
  const known = new Set(activeFlags.map((f) => `${f.faction}:${f.region}`));
  for (const f of flags) {
    if (known.has(`${f.faction}:${f.region}`)) continue;
    if (f.faction === localFaction) showRegionBanner('🚩 FLAG PLANTED — HOLD IT!', factionCss(f.faction));
    else showRegionBanner('🚩 ENEMY FLAG — GO DEFEND!', factionCss(f.faction));
  }
  activeFlags = flags;
  flagsSetAt = worldTimeLocal;
  rebuildFlagMeshes();
};
net.onGadgetFx = (kind, x, y, z) => gadgetFxAt(kind, x, y, z);
net.onDisguised = (id, faction) => {
  // A remote player is disguised: re-skin their avatar to the shown faction for
  // the disguise window, remembering their real faction to restore afterward.
  const r = net.remotes.get(id);
  if (!r) return;
  if (!disguises.has(id)) disguises.set(id, { realFaction: r.info.faction, left: 0 });
  disguises.get(id)!.left = 45; // SpyDisguise duration (local-clock seconds)
  r.info.faction = faction;
  remotePlayers.invalidate(id); // rebuild avatar in the disguised colors
};
net.onFactionSwitched = (faction, remaining) => {
  // Secret: no banner, just a private notice. Your nameplate stays the OLD color
  // to everyone else (a spy) — only the server knows your true side.
  localFaction = faction;
  refreshNetInfo();
  showNotice(`🤫 You secretly joined ${factionName(faction)}. Switches left: ${remaining}.`);
};
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
  // (turretModels reconciles to the now-empty set).
  turretStates.clear();
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
  // Claims are Heartland-only (B2): tell the player BEFORE the place attempt
  // so a rejected Core in the Wilds is never a silent mystery.
  if (!inCore(x, z)) {
    showNotice('Claims only work in the Heartland (inner 1000×1000)!');
    return false;
  }
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
    invUI.show('inventory');
    document.exitPointerLock();
  }
}

// --- Warfare: turret panel + territory --------------------------------------

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
  // Online peacetime: capture is locked — say so instead of showing a meter.
  if (net.connected && !warActiveNow) {
    captureBarEl.innerHTML = '<div style="color:#9fd0ff">🕊️ Capture locked — wait for the war</div>';
    return;
  }
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

/** mm:ss (or h:mm:ss) clock for the war timer. */
function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** The war clock: shows whether capture is open + a live countdown. Offline is a
 *  perpetual free-play skirmish; online it reflects the admin-scheduled war. */
function updateWarHud(dt: number): void {
  warEl.style.display = 'block';
  if (!net.connected) {
    warEl.innerHTML = '<span style="color:#ffb86a">⚔️ Skirmish — capture open</span>';
    return;
  }
  // Count down locally between the server's periodic broadcasts.
  if (warActiveNow) warLeft = Math.max(0, warLeft - dt);
  else if (warNextIn > 0) warNextIn = Math.max(0, warNextIn - dt);
  if (warActiveNow) {
    warEl.innerHTML = `<span style="color:#ff6a6a">⚔️ WAR · ${formatClock(warLeft)} left</span>`;
  } else if (warNextIn > 0) {
    warEl.innerHTML = `<span style="color:#9fd0ff">🕊️ Next war in ${formatClock(warNextIn)}</span>`;
  } else {
    warEl.innerHTML = '<span style="color:#9fb0c4">🕊️ Peacetime — capture locked</span>';
  }
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


/** Drop the (offline) player into a region their faction controls — never enemy
 *  land. Mirrors the server's faction-aware spawn. */
// Personal respawn point set via a Respawn Beacon (offline; online the server
// tracks it). Cleared if the beacon block is gone when we try to use it.
let localSpawn: { x: number; y: number; z: number } | null = null;

function spawnInOwnTerritory(): void {
  if (net.connected) return; // online: the server places us
  // A personal Respawn Beacon (still standing) overrides the faction spawn.
  if (localSpawn && world.getBlock(localSpawn.x, localSpawn.y, localSpawn.z) === Block.RespawnBeacon) {
    player.pos.set(localSpawn.x + 0.5, localSpawn.y + 1, localSpawn.z + 0.5);
    player.vel.set(0, 0, 0);
    return;
  }
  localSpawn = null; // beacon gone — forget the stale point
  let pick = localRegions.ownerAt(capitalOf(localFaction)) === localFaction ? capitalOf(localFaction) : -1;
  if (pick < 0) {
    for (let i = 0; i < REGION_COUNT; i++) if (localRegions.ownerAt(i) === localFaction) { pick = i; break; }
  }
  const s = pick >= 0
    ? (() => { const b = regionBounds(pick); return world.terrain.drySpawnInBounds(Math.random, b.minX + 6, b.maxX - 6, b.minZ + 6, b.maxZ - 6); })()
    : world.terrain.randomDrySpawn(Math.random, CORE_HALF);
  player.pos.set(s.x, s.y, s.z);
  player.vel.set(0, 0, 0);
}

// --- Gadgets (Phase 8): use mechanics + visual effects -----------------------

/** Play a gadget's visual effect at a point (everyone sees these via gadgetFx). */
function gadgetFxAt(kind: string, x: number, y: number, z: number): void {
  if (kind === 'smoke') {
    particles.burst(x, y + 0.5, z, 48, 0xb8c0cc, 2.4, 4.5); // big slow gray cloud
  } else if (kind === 'horn') {
    particles.burst(x, y + 1.4, z, 18, 0xffd84a, 3, 0.9);
  } else {
    particles.explosion(x, y, z); // frag / oil bomb
  }
}

/** Detonation point for a thrown gadget: the block you're aiming at, else a
 *  point a short way down your look ray. */
function gadgetTargetPoint(): { x: number; y: number; z: number } {
  const t = interaction.target;
  if (t) return { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 };
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const eye = player.eyePosition;
  return { x: eye.x + dir.x * 14, y: eye.y + dir.y * 14, z: eye.z + dir.z * 14 };
}

// Thrown-item visuals: a small spinning cube that arcs from your hand to the
// detonation point, then fires its on-land effect. (frag/oil/smoke get tossed.)
const THROW_GEO = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const THROW_GRAVITY = 26;
interface ThrownItem {
  mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number;
  onLand: (p: THREE.Vector3) => void;
}
const thrownItems: ThrownItem[] = [];
function tossItem(color: number, to: THREE.Vector3, onLand: (p: THREE.Vector3) => void): void {
  const from = player.eyePosition.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  from.addScaledVector(dir, 0.6); // start just past the hand
  const mesh = new THREE.Mesh(THROW_GEO, new THREE.MeshBasicMaterial({ color }));
  mesh.position.copy(from);
  scene.add(mesh);
  const t = Math.max(0.35, from.distanceTo(to) / 18);
  const vel = new THREE.Vector3(
    (to.x - from.x) / t, (to.y - from.y) / t + 0.5 * THROW_GRAVITY * t, (to.z - from.z) / t);
  thrownItems.push({ mesh, pos: from, vel, life: t + 0.5, onLand });
}
function updateThrownItems(dt: number): void {
  for (let i = thrownItems.length - 1; i >= 0; i--) {
    const it = thrownItems[i];
    it.vel.y -= THROW_GRAVITY * dt;
    it.pos.addScaledVector(it.vel, dt);
    it.mesh.position.copy(it.pos);
    it.mesh.rotation.x += dt * 9; it.mesh.rotation.z += dt * 7;
    it.life -= dt;
    const solid = BLOCKS[world.getBlock(Math.floor(it.pos.x), Math.floor(it.pos.y), Math.floor(it.pos.z))]?.solid ?? false;
    if (it.life <= 0 || solid) {
      it.onLand(it.pos.clone());
      scene.remove(it.mesh);
      (it.mesh.material as THREE.Material).dispose();
      thrownItems.splice(i, 1);
    }
  }
}
const THROW_COLOR: Record<string, number> = { frag: 0x6a9a5a, oil: 0x2a2630, smoke: 0x9aa2ae };

// Held-gadget tooltip: shows the gadget name + description above the hotbar so
// players know what a toy does and how to use it.
const gadgetTipEl = document.createElement('div');
gadgetTipEl.className = 'mc-font';
gadgetTipEl.style.cssText =
  'position:absolute;bottom:96px;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;text-align:center;max-width:460px;display:none;' +
  'background:rgba(8,10,16,0.78);border:1px solid #34406a;border-radius:6px;padding:5px 10px;';
app.appendChild(gadgetTipEl);
function updateHeldGadgetTip(): void {
  const stack = inventory.selectedStack;
  const def = stack ? gadgetOf(stack.id) : undefined;
  if (!def || invUI.open || worldMap.open || player.dead) {
    gadgetTipEl.style.display = 'none'; return;
  }
  gadgetTipEl.style.display = 'block';
  gadgetTipEl.innerHTML =
    `<div style="color:#ffd84a;font-size:13px">${def.name}</div>` +
    `<div style="color:#cdd6ee;font-size:11px;text-shadow:none">${def.desc}</div>` +
    `<div style="color:#7f8db0;font-size:10px;text-shadow:none">left-click to use</div>`;
}

/** Deploy a 3-wide × 2-tall blast wall a couple of blocks ahead (cover gadget). */
function deployCover(): void {
  const yaw = player.yaw;
  // Nearest cardinal forward + its perpendicular (so the wall faces you).
  const fx = Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw)) ? -Math.sign(Math.sin(yaw)) : 0;
  const fz = fx === 0 ? -Math.sign(Math.cos(yaw)) : 0;
  const px = fz, pz = fx; // perpendicular
  const baseX = Math.floor(player.pos.x) + fx * 2;
  const baseY = Math.floor(player.pos.y);
  const baseZ = Math.floor(player.pos.z) + fz * 2;
  for (let w = -1; w <= 1; w++) {
    for (let h = 0; h <= 1; h++) {
      const x = baseX + px * w, y = baseY + h, z = baseZ + pz * w;
      if (world.getBlock(x, y, z) !== Block.Air) continue;
      world.setBlock(x, y, z, Block.Cobblestone);
      net.sendEdit(x, y, z, Block.Cobblestone);
    }
  }
}

function useGadget(def: GadgetDef): void {
  if (!gadgetCd.ready(def.item, worldTimeLocal)) {
    showNotice(`${def.name}: ${gadgetCd.remaining(def.item, worldTimeLocal).toFixed(1)}s left`);
    return;
  }
  const consume = (): void => { if (def.consumed) inventory.consumeSelected(1); };
  switch (def.kind) {
    case 'frag': case 'oil': case 'smoke': {
      if (def.oilCost && inventory.countItem(Item.OilBarrel) < def.oilCost) {
        showNotice('Oil Bomb needs an oil barrel.'); return;
      }
      const tgt = gadgetTargetPoint();
      gadgetCd.use(def.item, worldTimeLocal);
      if (def.oilCost) inventory.removeItem(Item.OilBarrel, def.oilCost);
      consume();
      // Toss the item through the air; the blast/fx fire when it lands.
      const kind = def.kind, item = def.item;
      const blastR = def.radius ?? 4;
      tossItem(THROW_COLOR[kind] ?? 0x888888, new THREE.Vector3(tgt.x, tgt.y, tgt.z), (land) => {
        if (net.connected) net.sendGadgetUse(item, land.x, land.y, land.z);
        gadgetFxAt(kind, land.x, land.y, land.z);
        if (kind !== 'smoke') {
          mobs.explode(land, player); // local block/mob blast
          // Machines are immune to bullets/melee but DEMOLISHED by an explosive.
          // Online the server does this; offline we blow them up locally.
          if (!net.connected) destroyMachinesNear(land, blastR);
        }
      });
      break;
    }
    case 'grapple': {
      // Long raycast (the grapple reaches much farther than your edit range).
      const eye = player.eyePosition;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const hit = raycastBlocks(world, eye, dir, def.radius ?? 40);
      if (!hit) { showNotice('No surface in range to grapple.'); return; }
      gadgetCd.use(def.item, worldTimeLocal);
      // Anchor the string to the hit block and start reeling — the per-frame pull
      // in updateGrapple() drags the player the WHOLE way there.
      grappleAnchor.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      grappleActive = true;
      grappleTime = 0;
      grapplePrev.copy(player.pos);
      grappleRope.visible = true;
      particles.poof(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      break;
    }
    case 'jump': {
      gadgetCd.use(def.item, worldTimeLocal); consume();
      player.vel.y = 36; // ~20-block vertical launch (gravity 32)
      player.fallDistance = 0;
      jumpImmuneUntil = worldTimeLocal + 7; // no fall damage from this leap
      particles.burst(player.pos.x, player.pos.y, player.pos.z, 18, 0x9affb0, 4, 0.6);
      showNotice('🚀 BOOOOING! One-use jump boost!');
      break;
    }
    case 'cover':
      gadgetCd.use(def.item, worldTimeLocal); consume(); deployCover();
      showNotice('🧱 Cover deployed!');
      break;
    case 'sentry': {
      const t = interaction.target;
      if (!t) { showNotice('Aim at the ground to deploy a sentry.'); return; }
      const x = t.x, y = t.y + 1, z = t.z;
      if (world.getBlock(x, y, z) !== Block.Air) { showNotice('No room for a sentry there.'); return; }
      gadgetCd.use(def.item, worldTimeLocal); consume();
      world.setBlock(x, y, z, Block.Turret);
      net.sendEdit(x, y, z, Block.Turret);
      if (net.connected) net.sendTurretClaim(x, y, z);
      showNotice('🔫 Sentry deployed — load it with cannonballs + oil.');
      break;
    }
    case 'horn': {
      gadgetCd.use(def.item, worldTimeLocal);
      if (net.connected) net.sendGadgetUse(def.item, player.pos.x, player.pos.y, player.pos.z);
      gadgetFxAt('horn', player.pos.x, player.pos.y, player.pos.z);
      showNotice('📯 War Horn sounded — rally the troops!');
      break;
    }
    case 'disguise': {
      gadgetCd.use(def.item, worldTimeLocal);
      if (net.connected) net.sendGadgetUse(def.item, player.pos.x, player.pos.y, player.pos.z);
      showNotice(`🕵 Disguised as ${factionName(otherFaction(localFaction))} for ${def.duration ?? 30}s (to others).`);
      break;
    }
    case 'c4': {
      const t = interaction.target;
      const c = t ? claims.at(t.x, t.z) : undefined;
      if (!t || !c || sameFaction(c.faction, localFaction)) { showNotice('Plant C4 on an ENEMY base.'); return; }
      gadgetCd.use(def.item, worldTimeLocal); consume();
      const bx = t.x + 0.5, by = t.y + 0.5, bz = t.z + 0.5;
      const cx = c.coreX, cy = c.coreY, cz = c.coreZ, dmg = def.damage ?? 200;
      showNotice(`💣 C4 planted — ${def.fuse ?? 3}s to breach!`);
      window.setTimeout(() => {
        particles.explosion(bx, by, bz);
        if (net.connected) net.sendClaimHit(cx, cy, cz, dmg);
        else { const cl = claims.coreAt(cx, cy, cz); if (cl) damageShield(cl, dmg); }
      }, (def.fuse ?? 3) * 1000);
      break;
    }
  }
}

/** Fade out spy disguises on a local clock; restore each avatar's real colors. */
function tickDisguises(dt: number): void {
  for (const [id, d] of disguises) {
    d.left -= dt;
    if (d.left <= 0) {
      const r = net.remotes.get(id);
      if (r) { r.info.faction = d.realFaction; remotePlayers.invalidate(id); }
      disguises.delete(id);
    }
  }
}

// --- Crafting Guide (recipe book) -------------------------------------------
let guideOpen = false;
const guideEl = document.createElement('div');
guideEl.style.cssText =
  'position:absolute;inset:0;display:none;z-index:40;align-items:center;' +
  'justify-content:center;background:rgba(6,8,14,0.86);';
const guidePanel = document.createElement('div');
guidePanel.className = 'mc-font';
guidePanel.style.cssText =
  'background:linear-gradient(#161a26,#10131c);border:2px solid #34406a;border-radius:10px;' +
  'box-shadow:0 10px 40px rgba(0,0,0,0.6);width:560px;max-height:88vh;overflow:auto;' +
  'color:#e7edf7;text-shadow:none;font-size:13px;';
guideEl.appendChild(guidePanel);
app.appendChild(guideEl);
guideEl.addEventListener('mousedown', (e) => { if (e.target === guideEl) hideGuide(); });

const guideBtn = document.createElement('button');
guideBtn.className = 'mc-font';
guideBtn.textContent = '📖 Crafting Guide';
guideBtn.style.cssText =
  'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:25;display:none;' +
  'font-size:13px;padding:7px 14px;cursor:pointer;border:2px solid;border-color:#fff #555 #555 #fff;' +
  'background:#6b6b6b;color:#fff;text-shadow:none;';
guideBtn.addEventListener('click', showGuide);
app.appendChild(guideBtn);

function showGuide(): void { guideOpen = true; guideEl.style.display = 'flex'; }
function hideGuide(): void { guideOpen = false; guideEl.style.display = 'none'; }

/** Small pixelated icon canvas for an item id. */
function guideIcon(id: number, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  c.style.cssText = `width:${px}px;height:${px}px;image-rendering:pixelated`;
  renderItemIcon(c, atlas.canvas, id);
  return c;
}

const GUIDE_SECTIONS = [
  'Combat', 'Gadgets & Toys', 'War & Factions', 'Automation',
  'Tools, Armor & Travel', 'Building', 'Materials',
];
const COMBAT_IDS = new Set<number>([
  Item.Pistol, Item.Rifle, Item.RocketLauncher, Item.Shotgun, Item.SMG,
  Item.Sniper, Item.BurstRifle, Item.Bullet, Item.Rocket,
]);
const WAR_IDS = new Set<number>([
  Block.Core, Block.Turret, Item.Cannonball,
]);
function guideCategory(id: number): string {
  if (gadgetOf(id)) return 'Gadgets & Toys';
  if (COMBAT_IDS.has(id)) return 'Combat';
  if (WAR_IDS.has(id)) return 'War & Factions';
  if (id === Block.Autominer || id === Block.OilDerrick) return 'Automation';
  const info = ITEMS[id];
  if (info?.tool || info?.armor || info?.glider) return 'Tools, Armor & Travel';
  if (info?.kind === 'block') return 'Building';
  return 'Materials';
}

/** Render a recipe's ingredient grid (3×3 for shaped, a row for shapeless). */
function recipeGrid(r: Recipe): HTMLElement {
  const wrap = document.createElement('div');
  const first = (ing: number | number[]): number => Array.isArray(ing) ? ing[0] : ing;
  if (r.kind === 'shaped') {
    const cols = Math.max(...r.pattern.map((row) => row.length));
    wrap.style.cssText = `display:grid;grid-template-columns:repeat(${cols},22px);gap:2px`;
    for (const row of r.pattern) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.style.cssText = 'width:22px;height:22px;background:#0c0f18;border:1px solid #2a3550;border-radius:3px;display:flex;align-items:center;justify-content:center';
        const ing = row[c];
        if (ing !== null && ing !== undefined) cell.appendChild(guideIcon(first(ing), 18));
        wrap.appendChild(cell);
      }
    }
  } else {
    wrap.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap';
    for (const ing of r.items) {
      const cell = document.createElement('div');
      cell.style.cssText = 'width:22px;height:22px;background:#0c0f18;border:1px solid #2a3550;border-radius:3px;display:flex;align-items:center;justify-content:center';
      cell.appendChild(guideIcon(first(ing), 18));
      wrap.appendChild(cell);
    }
  }
  return wrap;
}

function buildGuide(): void {
  guidePanel.replaceChildren();
  const header = document.createElement('div');
  header.style.cssText =
    'position:sticky;top:0;background:#10131c;display:flex;align-items:center;gap:10px;' +
    'padding:12px 16px;border-bottom:1px solid #232a40;z-index:1';
  header.innerHTML = `<div style="flex:1;font-size:15px;color:#ffd84a;letter-spacing:1px">📖 CRAFTING GUIDE</div>`;
  const close = document.createElement('button');
  close.textContent = '✕';
  close.style.cssText = 'width:26px;height:26px;cursor:pointer;border:1px solid #3a4666;border-radius:5px;background:#1c2335;color:#cdd6ee;font-size:13px';
  close.addEventListener('click', hideGuide);
  header.appendChild(close);
  guidePanel.appendChild(header);

  // Group recipes by category, keeping one entry per result item.
  const byCat = new Map<string, Recipe[]>();
  const seen = new Set<number>();
  for (const r of RECIPES) {
    if (seen.has(r.result.id)) continue;
    seen.add(r.result.id);
    const cat = guideCategory(r.result.id);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }

  for (const cat of GUIDE_SECTIONS) {
    const recipes = byCat.get(cat);
    if (!recipes?.length) continue;
    const h = document.createElement('div');
    h.textContent = cat.toUpperCase();
    h.style.cssText = 'padding:10px 16px 4px;font-size:11px;letter-spacing:2px;color:#7f8db0;border-top:1px solid #232a40';
    guidePanel.appendChild(h);
    for (const r of recipes) {
      const id = r.result.id, info = ITEMS[id];
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid #1a2032';
      const icon = guideIcon(id, 38);
      icon.style.flex = '0 0 auto';
      const mid = document.createElement('div');
      mid.style.cssText = 'flex:1;min-width:0';
      const desc = itemDescription(id);
      mid.innerHTML =
        `<div style="color:#e7edf7">${info?.name ?? id}${r.result.count > 1 ? ` <span style="color:#7f8db0">×${r.result.count}</span>` : ''}</div>` +
        (desc ? `<div style="color:#8f9ec0;font-size:11px">${desc}</div>` : '');
      const grid = recipeGrid(r);
      grid.style.flex = '0 0 auto';
      card.append(icon, mid, grid);
      guidePanel.appendChild(card);
    }
  }
}
buildGuide();

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
      if (input.dropPressed) dropCurrentItem(input.down('ShiftLeft') || input.down('ShiftRight'));
    }

    const moveInput = controlling ? input : FROZEN_INPUT;
    // A glider worn in the chestplate slot enables mid-air deploy (player.update
    // reads this; jump while falling to start gliding).
    const wornChest = inventory.chestplateStack;
    player.gliderEquipped = !!wornChest && wornChest.id === Item.Glider;
    // Teleport arrival: pin the player at the destination and pour extra frame
    // budget into streaming a small chunk bubble there; release once the ground
    // is real (or after a generous timeout so we can never get stuck).
    if (pendingTeleport) {
      const tp = pendingTeleport;
      player.pos.set(tp.x, tp.y, tp.z);
      player.vel.set(0, 0, 0);
      player.fallDistance = 0;
      const bubbleReady = world.update(tp.x, tp.z, 14, 2);
      if (bubbleReady || worldTimeLocal - tp.started > 8) pendingTeleport = null;
    }
    updateGrapple(dt); // sustained grapple pull (sets velocity before the step)
    player.update(dt, moveInput, world);
    // World border: keep the player inside the 5000×5000 play area (the server
    // clamps authoritatively too).
    player.pos.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.pos.x));
    player.pos.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, player.pos.z));

    // Gun aim-down-sights: hold right-click with a gun to zoom (per-gun amount).
    {
      const hs = inventory.selectedStack;
      const g = hs ? ITEMS[hs.id]?.gun : undefined;
      const aiming = controlling && localMode !== 'spectator' &&
        !!g?.zoom && input.rightDown;
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
      const heldGadget = heldStack && !heldGun ? gadgetOf(heldStack.id) : undefined;

      if (heldGadget) {
        // Gadgets: left-click uses the toy (suppresses mining + block use).
        if (input.leftClicked) useGadget(heldGadget);
        interaction.update(dt, input, camera, true, true);
      } else if (heldGun) {
        // Guns suppress melee + mining (and block use, so right-click aims down
        // sights instead of placing/opening): fire on click (semi) / hold (auto).
        if (input.reloadPressed) reloadGun();
        const wantFire = heldGun.auto ? input.leftDown : input.leftClicked;
        if (wantFire && fireCooldown <= 0 && reloadTimer <= 0) tryFire(heldStack!, heldGun);
        interaction.update(dt, input, camera, true, true);
      } else if (input.rightClicked && !interaction.armedMove && heldStack &&
          (heldStack.id === Item.Heart || heldStack.id === Item.RevivalBeacon)) {
        // Lifesteal consumables: a Heart grows your max hearts; a Revival
        // Beacon opens the eliminated-teammate picker.
        if (heldStack.id === Item.Heart) consumeHeartItem();
        else openRevivePicker();
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (input.rightClicked && !interaction.armedMove &&
          heldStack && ITEMS[heldStack.id]?.armor?.slot === 'chestplate') {
        // Right-click a chestplate-slot item straight from the hotbar to equip it
        // into the chest slot — and SWAP: a glider swaps with a worn chestplate
        // (and vice-versa), since equip() puts the displaced item back in-hand.
        inventory.tryEquipArmor(inventory.selected);
        showNotice(heldStack.id === Item.Glider ? 'Glider equipped!' : 'Chestplate equipped!');
        pushStateSave();
        interaction.update(dt, input, camera, true, true); // suppress mine + use
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
    net.sendXform(dt, player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch, player.gliding);

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
    // Warfare: render turrets, run the region war + its HUD.
    turretModels.update(dt);
    // Region war (Phase 2): offline the local sim is authoritative; the War HUD
    // reads the latest board + meters (server-fed online, local sim offline).
    if (!net.connected) updateRegionsOffline(dt);
    updateRegionWarHud();
    // Seasons (Phase 5): offline the local clock is authoritative.
    if (!net.connected) updateSeasonOffline(dt);
    updateSeasonHud();
    updateWarHud(dt); // war clock (capture window); offline = perpetual skirmish
    // Circular radar: visible while playing (hidden behind the full map /
    // inventory, and behind the F3 debug overlay since they share the top-left).
    const showRadar = screen === 'playing' && !worldMap.open && !invUI.open && !hud.debugVisible;
    minimap.setVisible(showRadar);
    const flagMk = flagMarkers();
    worldMap.setDynamicMarkers(flagMk); // war flags as in-world beacons + on the map
    if (showRadar) {
      // Tint reflects the TERRITORY you're standing in (blue in Azure land, red
      // in Crimson land), not your own faction; neutral land gets no tint.
      const hereOwner = regionOwners[regionOf(player.pos.x, player.pos.z)] ?? NO_FACTION;
      minimap.update(player.pos.x, player.pos.z, player.yaw, hereOwner, worldMap.listWaypoints(), flagMk);
    }
    tickDisguises(dt); // Phase 8: expire spy disguises on remote avatars
    updateThrownItems(dt); // animate tossed grenades/bombs
    // Jump Boost: zero fall distance while the immunity window is active.
    if (jumpImmuneUntil > 0) {
      player.fallDistance = 0;
      if (worldTimeLocal >= jumpImmuneUntil || (player.onGround && player.vel.y <= 0)) jumpImmuneUntil = 0;
    }
    updateHeldGadgetTip();
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
    lastDamageLocal = worldTimeLocal; // combat tag (blocks totem travel 10s)
  }
  tickTotemWindup(dt);
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
  hud.updateCooldowns();
  // The Crafting Guide button shows whenever a crafting table is open.
  guideBtn.style.display = (invUI.open && invUI.mode === 'table' && !guideOpen) ? 'block' : 'none';
  if (guideOpen && !(invUI.open && invUI.mode === 'table')) hideGuide();
  hud.updateStatus({
    health: player.health,
    hearts: localHearts,
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
