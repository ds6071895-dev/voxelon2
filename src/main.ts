import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS } from './blocks';
import { Furnaces } from './furnace';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { Interaction } from './interact';
import { Inventory } from './inventory';
import { InventoryUI, MachineUIContext } from './inventory_ui';
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
import { MELEE_RANGE, WORLD_SEED } from './net/protocol';
import { MachineModels } from './machinemodels';
import { NetItems } from './netitems';
import { Particles } from './particles';
import { Projectiles } from './projectiles';
import { Player, MAX_AIR } from './player';
import { RemotePlayers } from './remoteplayers';
import { Sky, WATER_FOG_COLOR } from './sky';
import { Survival } from './survival';
import { createAtlas, createCrackTextures } from './textures';
import { World, RENDER_DISTANCE } from './world';

const FOG_NEAR = RENDER_DISTANCE * 16 - 38;
const FOG_FAR = RENDER_DISTANCE * 16 - 6;
const FOV = 70;
const SPRINT_FOV = 80.5;

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;
const loading = document.getElementById('loading')!;
const loadbar = document.querySelector('#loadbar div') as HTMLDivElement;
const crosshair = document.getElementById('crosshair')!;
const hotbarEl = document.getElementById('hotbar')!;
const statusEl = document.getElementById('status')!;
crosshair.style.display = 'none'; // HUD hidden until the player is in-game
hotbarEl.style.display = 'none';
statusEl.style.display = 'none';

const LOADING_TIPS = [
  'Diamonds hide below Y 16 — dig deep and bring torches.',
  'Sprinting drains your energy bar; let it recharge before a chase.',
  'Creepers hiss before they detonate — back off or take cover.',
  'Press E for your inventory — the world keeps running while it is open.',
  'Right-click a crafting table or furnace to use it.',
  'Other players can see and grab whatever you drop — guard your loot.',
  'Zombies burn in daylight; the night belongs to them.',
];
(document.getElementById('loadtip') as HTMLElement).textContent =
  LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];

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

// Title-screen panorama camera: slowly orbits an elevated point over spawn.
const panorama = new THREE.PerspectiveCamera(
  75, window.innerWidth / window.innerHeight, 0.08, 2000
);
panorama.rotation.order = 'YXZ';
let panoramaYaw = 0;

const atlas = createAtlas(seed);
const cracks = createCrackTextures();
const world = new World(scene, atlas, seed);
const spawn = world.terrain.findSpawn();
const player = new Player(spawn);
const input = new Input(renderer.domElement);
const inventory = new Inventory();

// TEMPORARY starter kit (for testing the automation + combat layers): every
// player spawns with all three guns + ammo, both machines, and some upgrade
// materials. Remove this block to restore the empty-inventory survival start.
for (const [id, n] of [
  [Item.Pistol, 1], [Item.Rifle, 1], [Item.RocketLauncher, 1],
  [Item.Bullet, 64], [Item.Rocket, 16],
  [Block.Autominer, 8], [Block.OilDerrick, 8],
  // materials to craft/upgrade machines on the spot
  [Item.IronIngot, 64], [Item.Redstone, 64], [Item.Diamond, 32],
  [Item.CobaltIngot, 32], [Item.IronPickaxe, 1],
] as [number, number][]) {
  inventory.add(id, n);
}
const interaction = new Interaction(scene, world, player, cracks, inventory);
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
function refreshNetInfo(): void {
  netinfoEl.textContent = net.connected
    ? `${net.username}   ${net.remotes.size + 1} online` : '';
}
function showKill(killer: string, victim: string): void {
  const line = document.createElement('div');
  line.className = 'mc-font';
  line.style.cssText = 'font-size:13px;text-shadow:1px 1px 0 #000;';
  line.textContent = killer ? `${killer}  »  ${victim}` : `${victim} died`;
  killfeedEl.appendChild(line);
  window.setTimeout(() => line.remove(), 5000);
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
  const a = resolveMachineAnchor(x, y, z);
  if (!a) return;
  const held = inventory.selectedStack;
  const tool = held ? ITEMS[held.id]?.tool : undefined;
  const dmg = (tool?.damage ?? 1) + 3; // fists chip away; tools hit harder
  if (net.connected) {
    net.sendMachineHit(a.x, a.y, a.z, dmg);
  } else {
    const s = machines.get(a.x, a.y, a.z);
    if (s && damageMachine(s, dmg)) destroyMachineLocal(a.x, a.y, a.z);
  }
};
invUI.onClose = () => {
  if (openChest) {
    chests.sync(openChest.x, openChest.y, openChest.z, inventory.saveChest());
    openChest = null;
  }
  openMachine = null; // machine actions sync immediately; nothing to flush
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
  panorama.aspect = aspect;
  panorama.updateProjectionMatrix();
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

document.getElementById('play-btn')!.addEventListener('click', () => {
  audio.resume();
  input.lock();
});
document.getElementById('resume-btn')!.addEventListener('click', () => input.lock());
document.getElementById('quit-btn')!.addEventListener('click', () => enterTitle());

document.addEventListener('pointerlockchange', () => {
  if (!worldReady) return;
  if (input.locked) {
    enterPlaying(); // entered or returned to the game
  } else if (!player.dead && !invUI.open && screen === 'playing') {
    enterPause(); // Esc / lost focus while playing -> pause, not the title
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (invUI.open) { invUI.hide(); input.lock(); }
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
  // We can die while the pause menu is up (the sim never pauses). Normalize to
  // 'playing' and drop the pause menu so the death screen is the only overlay
  // and the Esc handler has no 'paused' branch to re-lock the pointer over it.
  screen = 'playing';
  pauseEl.style.display = 'none';
  deathEl.style.display = 'flex';
  document.exitPointerLock();
}

// --- Multiplayer wiring (callbacks fire async, after the world is set up) ---
net.onWelcome = (me) => {
  // Adopt the server-assigned spawn so we line up with the server's record.
  player.pos.set(me.x, me.y, me.z);
  player.vel.set(0, 0, 0);
  player.health = me.health;
  player.dead = false;
  lastHealth = me.health;
  player.damageSink = (a) => net.sendSelfHurt(a); // server owns health in MP
  survival.enableRegen = false;                   // server runs regen
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
  if (worldReady) input.lock();
};
net.onKillfeed = showKill;
net.onRoster = refreshNetInfo;
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
net.onDisconnect = () => {
  player.damageSink = undefined;
  survival.enableRegen = true;
  refreshNetInfo();
};
interaction.onEdit = (x, y, z, b) => {
  // Placing a machine block creates its local entity (prediction offline + MP).
  const mt = machineTypeForBlock(b);
  if (mt !== null) machines.place(x, y, z, mt);
  net.sendEdit(x, y, z, b);
};
net.connect();

let worldReady = false;
const clock = new THREE.Clock();
let fps = 0, frames = 0, fpsTime = 0;
// Sound state
let lastHealth = 20;
let lastSentArmor = -1; // last armor-points value pushed to the server
let lastInWater = false;

// Gun state.
const ammoEl = document.getElementById('ammo')!;
const RELOAD_TIME = 1.1;
let fireCooldown = 0;
let reloadTimer = 0;
let reloadingStack: ItemStack | null = null;

function tryFire(stack: ItemStack, gun: GunInfo): void {
  const loaded = stack.loaded ?? gun.mag;
  if (loaded <= 0) { reloadGun(); return; } // firing on empty starts a reload
  stack.loaded = loaded - 1;
  inventory.version++; // refresh the ammo counter
  fireCooldown = gun.cooldown;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  projectiles.fire(player.eyePosition, dir, gun);
  held.swing();
  audio.gun(player.eyePosition);
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

  const targetFov = player.sprinting ? SPRINT_FOV : FOV;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * 0.25;
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

  if (!worldReady) {
    // Generate the spawn area with a fat time budget, then unlock the game.
    const done = world.update(spawn.x, spawn.z, 40);
    loadbar.style.width = `${Math.round(world.progress(spawn.x, spawn.z) * 100)}%`;
    if (done) {
      worldReady = true;
      loading.classList.add('hidden');
      overlay.classList.remove('hidden');
      updateCamera();
    }
    sky.update(dt, camera);
    updateAtmosphere();
    renderer.render(scene, camera);
    return;
  }

  if (input.inventoryToggled) toggleInventory();

  // Gun timers tick regardless of menu state (so a reload finishes even if you
  // open a menu); the reload pulls ammo into the magazine when it completes.
  if (fireCooldown > 0) fireCooldown = Math.max(0, fireCooldown - dt);
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

  // In-world simulation runs whenever we're NOT on the title screen — even
  // with a menu open the world keeps ticking and you stay vulnerable; only
  // direct input is suspended (frozen input keeps gravity + PvP knockback).
  if (screen !== 'title') {
    if (controlling) {
      if (input.debugToggled) hud.toggleDebug();
      if (input.hotbarKey >= 0) inventory.select(input.hotbarKey);
      if (input.wheelDelta !== 0) inventory.select(inventory.selected + input.wheelDelta);
    }

    player.update(dt, controlling ? input : FROZEN_INPUT, world);
    updateCamera();

    if (controlling) {
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const eye = player.eyePosition;
      const heldStack = inventory.selectedStack;
      const heldGun = heldStack ? ITEMS[heldStack.id]?.gun : undefined;

      if (heldGun) {
        // Guns suppress melee + mining: fire on click (semi) / hold (auto).
        if (input.reloadPressed) reloadGun();
        const wantFire = heldGun.auto ? input.leftDown : input.leftClicked;
        if (wantFire && fireCooldown <= 0 && reloadTimer <= 0) tryFire(heldStack!, heldGun);
        interaction.update(dt, input, camera, true);
      } else {
        // Combat priority: another player > mob > mining the block behind them.
        const remoteTarget = remotePlayers.rayHit(eye, lookDir, MELEE_RANGE);
        const mobInSights = remoteTarget < 0 ? mobs.rayHit(eye, lookDir, 3.5) : null;
        if (input.leftClicked && remoteTarget >= 0) {
          net.sendAttack(remoteTarget); // server validates + applies PvP damage
          const tool = heldStack ? ITEMS[heldStack.id]?.tool : undefined;
          if (tool) inventory.damageSelected(2);
          held.swing();
        } else if (input.leftClicked && mobInSights) {
          const tool = heldStack ? ITEMS[heldStack.id]?.tool : undefined;
          mobs.attack(eye, lookDir, tool?.damage ?? 1, player);
          if (tool) inventory.damageSelected(2);
          held.swing();
        }
        interaction.update(dt, input, camera, remoteTarget >= 0 || mobInSights !== null);
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
    // Machines run under the same never-pausing sim. Offline this is the
    // authoritative tick; in multiplayer it's a local prediction for the fill
    // bar (the server is authoritative and reconciles on open/collect).
    machines.update(dt);
    machineModels.update(dt); // animate drills/pumpjacks
  }

  checkDeath();
  furnaces.update(dt);

  // The orbiting panorama is only for the title screen; pause/inventory keep
  // the frozen first-person view.
  let activeCamera: THREE.Camera = camera;
  if (screen === 'title') {
    panoramaYaw += dt * 0.06;
    panorama.position.set(spawn.x + 0.5, spawn.y + 14, spawn.z + 0.5);
    panorama.rotation.set(-0.18, panoramaYaw, 0);
    activeCamera = panorama;
  }

  world.update(player.pos.x, player.pos.z, 6);
  sky.update(dt, activeCamera);
  updateAtmosphere();
  itemEntities.update(dt, player, inventory, sky.sunIntensity);
  particles.update(dt, activeCamera);
  remotePlayers.update(dt); // interpolate + animate other players
  if (screen !== 'title') {
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
}

updateCamera();
frame();
