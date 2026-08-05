import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS, isReplaceable, isSolid } from './blocks';
import { Furnaces } from './furnace';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { TouchControls, isTouchDevice } from './touch';
import { Interaction, raycastBlocks } from './interact';
import { Inventory } from './inventory';
import { InventoryUI, MachineUIContext, TurretUIContext } from './inventory_ui';
import { dropFor, GunInfo, Item, ItemStack, ITEMS } from './items';
import { RECIPES, Recipe } from './crafting';
import { renderItemIcon } from './icons';
import { itemDescription } from './itemdesc';
import {
  Machines, MachineType, allowedFilterMask, applyUpgrade, claimMachine,
  collectMachine, currentRate, machineHeight, machineTypeForBlock,
  sanitizeState, setFilter, upgradeCost,
} from './machines';
import { ItemEntities, itemGeometry } from './itementity';
import { Chests } from './chests';
import { Mob, Mobs } from './mobs';
import { NetClient } from './net/client';
import {
  WORLD_SEED, WORLD_HALF, WORLD_BORDER, CORE_HALF, makeUsername, skinSeed,
  GameMode, MAX_ATTUNED, TOTEM_COOLDOWN, TOTEM_WINDUP, COMBAT_TAG,
  TPA_HOLD, TPA_EXPIRE,
} from './net/protocol';
import { leverFlips } from './traps';
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
import {
  RemotePlayers, buildAvatarBody, buildArmorOverlay, disposeAvatarBody, AvatarBody,
} from './remoteplayers';
import {
  CAPES, CAPE_COLORS, COSMETIC_RANGES, Cosmetics, EYE_COLORS, FACE_ACCESSORIES,
  HAIR_COLORS, HAIR_STYLES, HATS, HAT_COLORS, PANTS_COLORS, SHIRT_COLORS,
  SKIN_TONES, Swatch, defaultCosmetics, randomCosmetics, sanitizeCosmetics,
} from './character';
import { WorldMap } from './worldmap';
import { Accounts, Account } from './net/accounts';
import {
  FACTIONS, NO_FACTION, factionColor, factionName, isFaction, otherFaction,
} from './teams';
import { warBorderAt, WAR_MIN_BORDER } from './war';
import { Flag, FLAG_REACH, FLAG_MAX_HP, newFlags, flagPosition } from './flags';
import { FlagModels } from './flagmodels';
import {
  BRANCHES, MAX_LEVEL as MAX_PLAYER_LEVEL, ProgressState, XP_MOB, branchNodes,
  branchRank, buyNode, canBuyNode, factionLevelFor, factionLevelProgress,
  factionPerks, levelFor, levelProgress, newProgress, ownsNode, personalBuffs,
  pointsAvailable, sanitizeProgress, sanitizeFactionXp,
} from './progress';
import { GadgetCooldowns, GadgetDef, gadgetOf } from './gadgets';
import {
  GUIDE_STEPS, GuideState, compassGlyph, guideComplete, markGuideStep,
  newGuideState, nextGuideStep, sanitizeGuide,
} from './guide';
import { isRune, runeOf, runeBonuses } from './runes';
import {
  MAX_HEARTS, START_HEARTS, WITHDRAW_FLOOR, canConsume, canWithdraw,
  clampHearts, formatRemaining, maxHealthFor,
} from './hearts';
import { Sky, WATER_FOG_COLOR } from './sky';
import { Survival } from './survival';
import { createAtlas, createCrackTextures } from './textures';
import { World, RENDER_DISTANCE } from './world';
import { Panorama } from './panorama';
import { structureChestTier, worldStructures } from './structures';
import { chestLootSlots } from './loot';
import {
  VAULT_BOSS_NAMES, VAULT_LOOT_COOLDOWN, VAULT_LOOT_WINDOW, VAULT_RECHARGE,
  VAULT_REVEAL, VaultStamp,
  vaultAt, vaultLoot, vaultStamp, worldVaults,
} from './vaults';
import {
  BOSS_DEFINITIONS, EncounterEvent, EncounterSnapshot, VaultAttackIntent, VaultEncounter,
  bossMaxHp,
} from './vault_encounter';
import {
  VaultBossHUD, VaultCinematic, loadAccessibility, saveAccessibility,
} from './vault_presentation';
import { VaultEncounterVisuals } from './vault_visuals';

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
const vaultBossHud = new VaultBossHUD(app);
const vaultCinematic = new VaultCinematic(app);

// The world always uses the shared seed so clients never desync from the
// server (the ?seed override was removed).
const seed = WORLD_SEED;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.className = 'game';
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
const vaultEncounterVisuals = new VaultEncounterVisuals(scene);
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(new THREE.Color(), FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(
  FOV, window.innerWidth / window.innerHeight, 0.08, 2000
);
camera.rotation.order = 'YXZ';
scene.add(camera); // so the held-item view (a camera child) renders

// Camera views (V cycles): first person → third-person BACK → third-person
// FRONT. `camera` always stays at the eye with the true look direction — every
// raycast (mining, guns, hover) reads it — and a separate `viewCamera` is what
// actually renders in the third-person views, so aiming is never affected.
const enum View { First = 0, Back = 1, Front = 2 }
const VIEW_NAMES = ['First person', 'Third person (back)', 'Third person (front)'];
let view: View = View.First;
const VIEW_DIST = 4.0;       // how far the boom reaches when nothing blocks it
const viewCamera = new THREE.PerspectiveCamera(
  FOV, window.innerWidth / window.innerHeight, 0.08, 2000
);
viewCamera.rotation.order = 'YXZ';
scene.add(viewCamera);

const atlas = createAtlas(seed);
const cracks = createCrackTextures();
const world = new World(scene, atlas, seed);
// Offline single-player gets a random dry spawn too (MP uses the server's).
const spawn = world.terrain.randomDrySpawn(Math.random, CORE_HALF);
const player = new Player(spawn);
const input = new Input(renderer.domElement);
// Phones/tablets get on-screen controls (joystick + buttons) that feed the
// exact same Input fields the keyboard/mouse write — pointer lock is virtual
// in touch mode. Callbacks close over UI declared further down; they only run
// on taps, long after module init.
const isMobile = isTouchDevice();
const touch = isMobile ? new TouchControls(input, {
  onInventory: () => { input.inventoryToggled = true; },
  onMap: () => { input.mapToggled = true; },
  onProgress: () => { input.progressPressed = true; },
  onTpa: () => { input.tpaPressed = true; },
  onPause: () => {
    if (player.dead) return;
    if (screen === 'paused') { input.lock(); return; }        // resume
    if (invUI.open) { input.inventoryToggled = true; return; } // close menu first
    if (worldMap.open) { input.mapToggled = true; return; }
    if (progressOpen) { input.progressPressed = true; return; }
    if (input.locked) input.unlock();                          // open pause menu
  },
}) : null;
const inventory = new Inventory();

// No starter kit: everyone begins bare-handed — the Getting Started guide
// walks new players from punching a tree to their first vault instead.
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

// WAR BORDER: a closing ring of red walls, shown only during a war. The four
// walls reposition/rescale every frame from the pure shrink curve so every
// client renders the identical ring the server clamps movement to.
const warWallGroup = new THREE.Group();
warWallGroup.visible = false;
scene.add(warWallGroup);
const warWallMat = new THREE.MeshBasicMaterial({
  color: 0xff4a3a, transparent: true, opacity: 0.4,
  side: THREE.DoubleSide, depthWrite: false,
});
const warWallGeo = new THREE.PlaneGeometry(1, 240);
const warWalls = [0, 1, 2, 3].map(() => {
  const m = new THREE.Mesh(warWallGeo, warWallMat);
  m.frustumCulled = false;
  warWallGroup.add(m);
  return m;
});
warWalls[2].rotation.y = Math.PI / 2;
warWalls[3].rotation.y = Math.PI / 2;

// EVERYBODY GLOWS during a war: an additive faction-colored halo floats on
// every player (depth-test off, so it shows through walls) — nobody hides.
const glowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const glowGroup = new THREE.Group();
scene.add(glowGroup);
const glowSprites = new Map<number, THREE.Sprite>();
function warGlowMaterial(faction: number): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: glowTexture, color: factionColor(faction),
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    transparent: true, opacity: 0.85,
  });
}

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
const accessibility = loadAccessibility();
audio.setMusicVolume(accessibility.musicVolume);
audio.setEffectsVolume(accessibility.effectsVolume);
mobs.onSound = (name, pos) => audio.mob(name, pos.clone());
const net = new NetClient();
const remotePlayers = new RemotePlayers(scene, net, atlas);
const netItems = new NetItems(scene, net, atlas);
const projectiles = new Projectiles(scene, world, mobs, remotePlayers, net, player, particles);
const chests = new Chests();
chests.net = net;
const machines = new Machines(world.terrain);
const machineModels = new MachineModels(scene, machines);
// --- Warfare (M14): turrets, territory ---
const turretStates = new Map<string, TurretState>();
const turretModels = new TurretModels(scene, turretStates);
// --- CAPTURE THE FLAG: one flag per faction, server-authoritative ---
let flagState = newFlags();
const flagModels = new FlagModels(scene);
flagModels.setGroundProbe((x, z) => world.terrain.height(Math.floor(x), Math.floor(z)) + 1);
/** Seconds until the client may send another flag swing (matches the server). */
let flagHitTimer = 0;
/** Local mirror of "my faction holds no flag" — drives the danger banner. */
let myFactionFlagless = false;
// Seasons: server-authoritative. Only the permanent ★ badge is shown — the
// old top-centre "Season N · time" HUD line was cut as clutter.
let localSeasonsWon = 0;
// The WAR (admin-scheduled, MP-only): a shrinking-border battle royale. The
// HUD counts down locally between the server's periodic broadcasts; the live
// border size derives purely from timeLeft+duration (warBorderAt).
let warActiveNow = false;
let warLeft = 0;    // seconds left in the active war
let warNextIn = 0;  // seconds until the next scheduled war (peacetime)
let warDur = 0;     // total war duration (drives the border shrink curve)
let warScore: number[] = new Array(FACTIONS.length).fill(0); // kills this war
let warWins: number[] = new Array(FACTIONS.length).fill(0);  // war wins this season
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
// --- Boat: fast water travel. Riding is a movement MODE (like gliding) — the
// boat item stays in your inventory, so nothing is ever lost overboard. ---
let boatActive = false;
let boatGroundTime = 0; // seconds beached (auto-dismount)
let prevBoatJump = false;
/** The local hull mesh (follows the player while boating). */
const boatGroup = (() => {
  const g = new THREE.Group();
  const hull = new THREE.MeshBasicMaterial({ color: 0x7c5f38 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x54401f });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 2.0), dark);
  floor.position.y = 0.09;
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 2.0), hull);
  railL.position.set(-0.55, 0.3, 0);
  const railR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 2.0), hull);
  railR.position.set(0.55, 0.3, 0);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.16), hull);
  bow.position.set(0, 0.34, -1.0); // -z = forward at yaw 0
  const stern = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.36, 0.16), hull);
  stern.position.set(0, 0.3, 1.0);
  g.add(floor, railL, railR, bow, stern);
  g.visible = false;
  scene.add(g);
  return g;
})();

/** Right-clicked holding a Boat: find a water-surface cell along the aim
 *  (block raycasts skip water, so we walk the ray ourselves) and hop in. */
function tryLaunchBoat(): void {
  if (boatActive) return;
  const eye = player.eyePosition;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  for (let t = 0.6; t <= 5.5; t += 0.25) {
    const x = Math.floor(eye.x + dir.x * t);
    const y = Math.floor(eye.y + dir.y * t);
    const z = Math.floor(eye.z + dir.z * t);
    if (world.getBlock(x, y, z) !== Block.Water) continue;
    // Ride the topmost water cell of the column (needs open air above).
    let top = y;
    while (top - y < 4 && world.getBlock(x, top + 1, z) === Block.Water) top++;
    if (world.getBlock(x, top + 1, z) !== Block.Air) continue;
    boatActive = true;
    boatGroundTime = 0;
    player.pos.set(x + 0.5, top + 0.95, z + 0.5);
    player.vel.set(0, 0, 0);
    player.gliding = false;
    player.boating = true;
    boatGroup.visible = true;
    audio.splash();
    showNotice('⛵ Boat launched! Look + W to row · jump to hop out');
    return;
  }
  showNotice('Aim at open water to launch the boat.');
}

function exitBoat(hop = true): void {
  if (!boatActive) return;
  boatActive = false;
  player.boating = false;
  boatGroup.visible = false;
  boatGroundTime = 0;
  if (hop) { player.vel.y = 5; player.fallDistance = 0; }
}

// World map (M key): terrain + structures + vaults + waypoints + travel.
const worldMap = new WorldMap(scene, camera, world.terrain, {
  player: () => ({ x: player.pos.x, z: player.pos.z, yaw: player.yaw }),
  faction: () => localFaction,
  onClose: () => { if (worldReady && !player.dead && screen === 'playing') input.lock(); },
});
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
  'border-color:#fff #555 #555 #fff;background:#6b6b6b;color:#fff;text-shadow:none;display:none;';
  // Hidden on the title screen (no world/character to show yet) and on mobile
  // (which has its own 🗺 icon in the touch overlay) — enterPlaying() reveals it.
mapBtn.addEventListener('click', () => {
  if (player.dead) return;
  if (worldMap.open) { worldMap.hide(); input.lock(); return; }
  if (invUI.open) invUI.hide();
  worldMap.show(); // pointer is already unlocked when a DOM button is clickable
});
app.appendChild(mapBtn);

// War HUD: the war clock/score line + a big banner that flashes on events.
// Shown ONLY while a war is actually running — no top-centre text otherwise
// (the old always-on "Season N" / "Peacetime" lines were cut as clutter).
const warEl = document.createElement('div');
warEl.className = 'mc-font';
warEl.style.cssText =
  'position:absolute;top:6px;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;text-align:center;font-size:13px;' +
  'text-shadow:1px 1px 0 #000;width:340px;display:none;';
app.appendChild(warEl);
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
  // No flag = no comeback: your faction's deaths are permanent until you take
  // one back. It rides in the status line so it's impossible to miss.
  const flagBadge = myFactionFlagless && net.connected
    ? '<span style="color:#ff5c5c">💀 NO FLAG — deaths are FOREVER</span>  ' : '';
  if (net.connected) {
    netinfoEl.innerHTML =
      `${flagBadge}${wonBadge}${modeBadge}${badge}${net.username}   ${net.remotes.size + 1} online`;
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
  } else {
    invUI.show(kind, kind === 'furnace' ? furnaces.get(x, y, z) : undefined);
  }
  input.unlock();
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
  viewCamera.aspect = aspect;
  viewCamera.updateProjectionMatrix();
  panoramaView.resize(aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Screen state: 'title' shows the orbiting panorama + Play; 'paused' shows
// the pause menu over the frozen first-person view; 'playing' is locked.
const pauseEl = document.getElementById('pause')!;
const musicVolumeInput = document.getElementById('music-volume') as HTMLInputElement;
const effectsVolumeInput = document.getElementById('effects-volume') as HTMLInputElement;
const cameraShakeInput = document.getElementById('camera-shake') as HTMLInputElement;
const reducedMotionInput = document.getElementById('reduced-motion') as HTMLInputElement;
const contrastInput = document.getElementById('contrast-telegraphs') as HTMLInputElement;
const safeEffectsInput = document.getElementById('safe-effects') as HTMLInputElement;
musicVolumeInput.value = String(accessibility.musicVolume);
effectsVolumeInput.value = String(accessibility.effectsVolume);
cameraShakeInput.value = String(accessibility.cameraShake);
reducedMotionInput.checked = accessibility.reducedMotion;
contrastInput.checked = accessibility.highContrastTelegraphs;
safeEffectsInput.checked = accessibility.photosensitivitySafe;
const saveAccessUi = (): void => {
  accessibility.musicVolume = Number(musicVolumeInput.value);
  accessibility.effectsVolume = Number(effectsVolumeInput.value);
  accessibility.cameraShake = Number(cameraShakeInput.value);
  accessibility.reducedMotion = reducedMotionInput.checked;
  accessibility.highContrastTelegraphs = contrastInput.checked;
  accessibility.photosensitivitySafe = safeEffectsInput.checked;
  saveAccessibility(accessibility);
  audio.setMusicVolume(accessibility.musicVolume);
  audio.setEffectsVolume(accessibility.effectsVolume);
  document.body.classList.toggle('reduced-motion', accessibility.reducedMotion);
  document.body.classList.toggle('high-contrast-telegraphs', accessibility.highContrastTelegraphs);
  document.body.classList.toggle('photosensitivity-safe', accessibility.photosensitivitySafe);
};
for (const el of [musicVolumeInput, effectsVolumeInput, cameraShakeInput,
  reducedMotionInput, contrastInput, safeEffectsInput]) {
  el.addEventListener('input', saveAccessUi);
}
saveAccessUi();
type Screen = 'title' | 'playing' | 'paused';
let screen: Screen = 'title';

function enterPlaying(): void {
  screen = 'playing';
  document.body.classList.add('in-game');
  overlay.classList.add('hidden');
  pauseEl.style.display = 'none';
  mapBtn.style.display = isMobile ? 'none' : '';
  progressBtn.style.display = isMobile ? 'none' : '';
}
function enterPause(): void {
  screen = 'paused';
  pauseEl.style.display = 'flex';
}
function enterTitle(): void {
  screen = 'title';
  document.body.classList.remove('in-game');
  overlay.classList.remove('hidden');
  pauseEl.style.display = 'none';
  // The Map/Progress corner buttons are gameplay-only — don't show them over
  // the title panorama (there's no world/character to view progress for yet).
  mapBtn.style.display = 'none';
  progressBtn.style.display = 'none';
  onVaultTransition(null);
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
// fresh registration so the assigned side is revealed once the faction is known
// (immediately offline; on `welcome` online) on a dedicated full-screen reveal
// shown right after Register — not as a banner shouted over the game.
let justRegistered = false;
const factionReveal = (() => {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:6px;text-align:center;' +
    'background:rgba(6,8,14,0.88);z-index:30;backdrop-filter:blur(3px);';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'mc-font';
  eyebrow.textContent = '⚔ WELCOME TO THE WAR ⚔';
  eyebrow.style.cssText = 'font-size:16px;letter-spacing:5px;color:#cdd8ea;';
  const lead = document.createElement('div');
  lead.className = 'mc-font';
  lead.textContent = 'You fight for';
  lead.style.cssText = 'font-size:20px;color:#9fb4cc;margin-top:14px;';
  const name = document.createElement('h1');
  name.className = 'mc-font';
  name.style.cssText = 'font-size:60px;letter-spacing:8px;margin:2px 0 10px;' +
    'text-shadow:0 3px 0 rgba(0,0,0,0.45),0 10px 30px rgba(0,0,0,0.75);';
  const blurb = document.createElement('div');
  blurb.className = 'mc-font';
  blurb.innerHTML = 'Sides are assigned automatically to keep the war a fair <b>50 / 50</b>.' +
    '<br/>Claim land, arm up and win the season for your faction!';
  blurb.style.cssText = 'font-size:14px;line-height:22px;color:#cdd8ea;max-width:460px;';
  const go = document.createElement('button');
  go.className = 'mc-btn';
  go.textContent = '⚔ Fight!';
  go.style.cssText = 'margin-top:18px;';
  go.addEventListener('click', () => { panel.style.display = 'none'; });
  panel.append(eyebrow, lead, name, blurb, go);
  app.appendChild(panel);
  return {
    show(faction: number): void {
      name.textContent = factionName(faction).toUpperCase();
      name.style.color = factionCss(faction);
      panel.style.display = 'flex';
    },
  };
})();
function announceSide(faction: number): void {
  factionReveal.show(faction);
}

// All surface structures shown on the world map as icons (one cached sweep —
// the layout is fixed for the seed, so it never needs recomputing).
let structureMarks: { x: number; z: number; kind: string }[] | null = null;
function refreshStructureMap(): void {
  if (!structureMarks) {
    structureMarks = worldStructures(seed, world.terrain)
      .map((s) => ({ x: s.x, z: s.z, kind: s.kind }));
  }
  worldMap.setStructures(structureMarks);
}

function onAuthSuccess(username: string): void {
  authed = true;
  authedName = username;
  sessionPending = false;
  if (pendingToken) { saveSession(username, pendingToken); pendingToken = null; }
  lastUser = username;
  // Remember the account so next visit prefills the login (username only — the
  // password is never stored).
  try { localStorage.setItem('voxelon.lastUser', username); } catch { /* ignore */ }
  discoveredVaults = null; // vault discoveries are per-account — reload lazily
  refreshVaultMap();
  refreshStructureMap();
  loadCosmetics(username); // per-account avatar look (Character screen)
  held.setSkin(skinSeed(username), myCosmetics); // first-person hand matches avatar
  authEl.style.display = 'none';
  menuBtns.style.display = 'flex'; // Civilization / Character / Controls appear once logged in
  authErr.textContent = '';
  authStatus.textContent = '';
  clearElimination(); // you're in — no lockout panel hanging around
  refreshNetInfo();
}

// --- Saved session (skip the login form on return visits) -------------------
// On every successful auth the server issues a rotating token (offline: a
// locally-generated one) which we mirror in localStorage; next visit we resume
// with it instead of asking for the password again. "Log Out" clears it.
const SESSION_KEY = 'voxelon.session';
let sessionPending = false; // a session resume is in flight (authErr = expired)
function loadSession(): { u: string; t: string } | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as { u?: string; t?: string } | null;
    return s && typeof s.u === 'string' && typeof s.t === 'string' ? { u: s.u, t: s.t } : null;
  } catch { return null; }
}
function saveSession(u: string, t: string): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ u, t })); } catch { /* ignore */ }
}
function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
// If the token beats the welcome over the wire, hold it until the username is
// known — a dropped token here would silently log the player out next visit.
let pendingToken: string | null = null;
net.onSession = (token) => {
  if (authedName) saveSession(authedName, token);
  else pendingToken = token;
};

/** Issue + store a local session token for OFFLINE accounts (the server does
 *  this for online play; offline we are our own authority). */
function issueOfflineSession(username: string): void {
  const token = `${Math.floor(Math.random() * 1e9).toString(16)}` +
    `${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
  localAccounts.setToken(username, token);
  saveLocalAccounts();
  saveSession(username, token);
}

/** Everything a fresh OFFLINE auth needs after the account checks out. */
function finishOfflineAuth(account: Account, freshRegister: boolean): void {
  localFaction = account.faction;
  invalidateSelfAvatar(); // your third-person body reflects the new look/side
  onAuthSuccess(account.username);
  spawnInOwnTerritory(); // never drop into enemy land (offline)
  if (freshRegister) announceSide(localFaction);
  else restoreOfflineInventory(); // bring back saved single-player stuff
  restoreOfflineHearts(); // fresh accounts fall back to the 10-heart start
  restoreOfflineTotems(); // attuned Waypoint Totems (fast travel)
  restoreOfflineProgress(); // XP + upgrades + the faction pool
  issueOfflineSession(account.username);
}

/** Try to resume a saved session (no password). Falls back to the normal
 *  login form if the token is stale or the account is gone. */
function attemptSessionAuth(sess: { u: string; t: string }, retries = 12): void {
  if (authed) return;
  if (net.socketOpen) {
    sessionPending = true;
    authStatus.textContent = `Resuming session as ${sess.u}…`;
    net.sendSession(sess.u, sess.t);
  } else if (net.offline) {
    const res = localAccounts.sessionLogin(sess.u, sess.t);
    if (!res.ok || !res.account) {
      clearSession();
      authStatus.textContent = '';
      authErr.textContent = 'Session expired — please log in again.';
      return;
    }
    finishOfflineAuth(res.account, false);
  } else if (retries > 0) {
    authStatus.textContent = 'Connecting…';
    setTimeout(() => attemptSessionAuth(sess, retries - 1), 350);
  } else {
    authStatus.textContent = '';
    authErr.textContent = 'Could not reach the server. Try again.';
  }
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
    finishOfflineAuth(res.account, mode === 'register');
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
// Remember the last account that logged in (username only) so a returning player
// lands on a prefilled login instead of retyping it.
let lastUser = '';
try { lastUser = localStorage.getItem('voxelon.lastUser') || ''; } catch { /* ignore */ }
function setAuthMode(mode: 'register' | 'login'): void {
  authMode = mode;
  authErr.textContent = '';
  authStatus.textContent = '';
  if (mode === 'register') {
    submitBtn.textContent = 'Register';
    authUser.readOnly = true;          // names are random-only on register
    rollBtn.style.display = '';
    authToggle.innerHTML = 'Already have an account? <a id="toggle-link">Log in</a>';
    // ALWAYS roll a fresh name on entering register — never keep a name typed
    // while in login mode (switching login→signup must not carry it over).
    rollUsername();
  } else {
    submitBtn.textContent = 'Log In';
    authUser.readOnly = false;         // type your existing name to log in
    authUser.value = lastUser;         // prefill the remembered account
    rollBtn.style.display = 'none';
    authToggle.innerHTML = 'Need an account? <a id="toggle-link">Register</a>';
    if (lastUser) authPass.focus(); else authUser.focus();
  }
  // The link is replaced via innerHTML above, so rebind it each time.
  document.getElementById('toggle-link')!
    .addEventListener('click', () => setAuthMode(mode === 'register' ? 'login' : 'register'));
}

// --- Elimination countdown on the title screen ------------------------------
// A knocked-out player lands back here, so the wait is shown as a LIVE ticking
// clock rather than a one-off error line. A permanent elimination (your faction
// had no flag) says so plainly instead of counting toward a date in 2286.
const elimPanel = document.createElement('div');
elimPanel.className = 'mc-font';
elimPanel.style.cssText =
  'display:none;margin:14px auto 0;max-width:430px;padding:14px 18px;border-radius:10px;' +
  'background:rgba(40,8,12,0.86);border:2px solid #ff5c5c;color:#ffd9d9;' +
  'font-size:14px;text-align:center;line-height:1.5;';
overlay.appendChild(elimPanel);
let elimUntilMs = 0;        // wall-clock ms when the lockout lifts (0 = none)
let elimPermanent = false;

function showElimination(lockMs: number, permanent: boolean): void {
  elimPermanent = permanent;
  elimUntilMs = permanent ? 0 : Date.now() + lockMs;
  renderElimination();
}
function clearElimination(): void {
  elimUntilMs = 0; elimPermanent = false;
  elimPanel.style.display = 'none';
}
function renderElimination(): void {
  if (elimPermanent) {
    elimPanel.innerHTML =
      '<b style="font-size:17px">💀 ELIMINATED — FOREVER</b><br>' +
      'You ran out of hearts while your faction held no flag.<br>' +
      'There is no comeback from this one. Ask an admin for a fresh start.';
    elimPanel.style.display = 'block';
    return;
  }
  if (!elimUntilMs) { elimPanel.style.display = 'none'; return; }
  const left = elimUntilMs - Date.now();
  if (left <= 0) {
    elimPanel.innerHTML =
      '<b style="font-size:17px">✨ You\'re back!</b><br>Log in to rejoin the war with 3 hearts.';
    elimPanel.style.display = 'block';
    return;
  }
  const h = Math.floor(left / 3600000);
  const m = Math.floor(left / 60000) % 60;
  const sec = Math.floor(left / 1000) % 60;
  const clock = `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  elimPanel.innerHTML =
    '<b style="font-size:17px">💀 ELIMINATED</b><br>' +
    `You come back in <b style="font-size:18px">${clock}</b> — with 3 hearts.<br>` +
    'A teammate with a Revival Beacon can bring you back sooner.';
  elimPanel.style.display = 'block';
}
// Tick the countdown once a second while it's on screen.
window.setInterval(() => {
  if (elimPanel.style.display !== 'none') renderElimination();
}, 1000);

net.onAuthErr = (error, lockMs, permanent) => {
  if (lockMs !== undefined && lockMs > 0) showElimination(lockMs, permanent === true);
  authStatus.textContent = '';
  if (sessionPending) {
    sessionPending = false;
    // Only a REAL token rejection invalidates the saved session. Transient
    // refusals (attempt throttle, elimination countdown, a hiccup) keep the
    // token so the next visit still resumes without a password.
    if (/session expired|authentication failed/i.test(error)) {
      clearSession();
      authErr.textContent = 'Session expired — please log in again.';
    } else {
      authErr.textContent = error;
    }
    return;
  }
  authErr.textContent = error;
};
submitBtn.addEventListener('click', () => attemptAuth(authMode));
authPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptAuth(authMode); });
// Returning players land on a prefilled login; first-timers get register.
setAuthMode(lastUser ? 'login' : 'register');
// A saved session skips the form entirely (resume as soon as we know whether
// the server is reachable; a stale token falls back to the login form).
{
  const sess = loadSession();
  if (sess) attemptSessionAuth(sess);
}
// Log Out (title menu): forget the saved session + reload back to the form.
document.getElementById('logout-btn')!.addEventListener('click', () => {
  clearSession();
  location.reload();
});

playBtn.addEventListener('click', () => {
  if (!authed) return;
  audio.resume();
  // World usually finished streaming during the title; if not, wait briefly
  // (still no full-screen loading screen) before dropping in.
  if (!worldReady) {
    playBtn.textContent = 'Preparing…';
    const wait = (): void => {
      if (worldReady) { playBtn.textContent = 'Civilization'; beginPlay(); }
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
  const binds: [string, string][] = isMobile ? [
    ['Move', 'left joystick'], ['Jump', '⬆ button (hold)'], ['Sneak', '⇩ button (toggle)'],
    ['Sprint', 'push joystick past the rim'], ['Break / attack mob', 'long-press'],
    ['Place / use', 'tap'], ['Aim down sights (guns)', '⊕ button'],
    ['Reload gun', 'R button'], ['Deploy glider (in mid-air)', '⬆ button'],
    ['Launch boat (on water)', 'tap'], ['Hop out of boat', '⬆ button'],
    ['Getting-started guide', 'starts open — tap ✕ to hide'],
    ['TPA — teleport to a player', '🌀 button'], ['Accept a TPA request', 'hold the accept button'],
    ['Hotbar slot', 'tap a slot'], ['Inventory', '🎒 button'], ['World map', '🗺 button'],
    ['Your progress', '⚑ button'], ['Pause / back', '⏸ button'],
  ] : [
    ['Move', 'W A S D'], ['Jump', 'Space'], ['Sneak', 'Shift'],
    ['Sprint', 'Q / double-tap W'], ['Break / attack mob', 'Left click'],
    ['Place / use', 'Right click'], ['Aim down sights (guns)', 'Hold right click'],
    ['Reload gun', 'R'], ['Drop item', 'O (Shift+O = stack)'], ['Deploy glider (in mid-air)', 'Jump'],
    ['Launch boat (on water)', 'Right click'], ['Hop out of boat', 'Jump'],
    ['Set waypoint here', 'B'], ['Getting-started guide', 'H'],
    ['TPA — teleport to a player', 'T'], ['Accept a TPA request', 'Hold Y'],
    ['Hotbar slot', '1 – 9 / scroll'], ['Inventory', 'E'], ['World map', 'M'],
    ['Your progress', 'G'], ['Camera view (1st / 3rd)', 'V'],
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
  charUI.close();
  controlsPanel.style.display = controlsPanel.style.display === 'flex' ? 'none' : 'flex';
});

// --- CHARACTER: customise your avatar (skin, hair, hats, capes, face…) --------
// Opens from the title menu. A live rotating 3D preview of the same avatar
// model other players see, plus ‹ › cyclers for every cosmetic category.
// Saved per-account: localStorage always, plus the server (which sanitizes,
// persists to the account and broadcasts) when online.
const characterBtn = document.getElementById('character-btn')!;
let myCosmetics: Cosmetics = defaultCosmetics(0);
let hasCustomLook = false; // only a saved custom look is pushed to the server

function cosmeticsKey(user: string): string { return `voxelon.cosmetics.${user}`; }
function loadCosmetics(user: string): void {
  hasCustomLook = false;
  myCosmetics = defaultCosmetics(skinSeed(user));
  invalidateSelfAvatar(); // your third-person body reflects the new look/side
  try {
    const raw = localStorage.getItem(cosmeticsKey(user));
    if (raw) {
      myCosmetics = sanitizeCosmetics(JSON.parse(raw), skinSeed(user));
      invalidateSelfAvatar();
      hasCustomLook = true;
    }
  } catch { /* ignore */ }
}
function saveCosmetics(): void {
  if (!authedName) return;
  hasCustomLook = true;
  try {
    localStorage.setItem(cosmeticsKey(authedName), JSON.stringify(myCosmetics));
  } catch { /* ignore */ }
  held.setSkin(skinSeed(authedName), myCosmetics);
  if (net.connected) net.sendCosmetics(myCosmetics);
}

// Every editor row: which Cosmetics field it cycles, its label, the display
// name per index and (for colour categories) the swatch to preview.
const CHAR_OPTIONS: { key: keyof Cosmetics; label: string; names: string[];
  swatches?: Swatch[] }[] = [
  { key: 'skin', label: 'Skin Tone', names: SKIN_TONES.map((s) => s.name), swatches: SKIN_TONES },
  { key: 'hairStyle', label: 'Hair Style', names: HAIR_STYLES },
  { key: 'hair', label: 'Hair Colour', names: HAIR_COLORS.map((s) => s.name), swatches: HAIR_COLORS },
  { key: 'eyes', label: 'Eyes', names: EYE_COLORS.map((s) => s.name), swatches: EYE_COLORS },
  { key: 'shirt', label: 'Shirt', names: SHIRT_COLORS.map((s) => s.name), swatches: SHIRT_COLORS },
  { key: 'pants', label: 'Trousers', names: PANTS_COLORS.map((s) => s.name), swatches: PANTS_COLORS },
  { key: 'hat', label: 'Hat', names: HATS },
  { key: 'hatColor', label: 'Hat Colour', names: HAT_COLORS.map((s) => s.name), swatches: HAT_COLORS },
  { key: 'cape', label: 'Cape', names: CAPES },
  { key: 'capeColor', label: 'Cape Colour', names: CAPE_COLORS.map((s) => s.name), swatches: CAPE_COLORS },
  { key: 'face', label: 'Face', names: FACE_ACCESSORIES },
];

const charUI = (() => {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:14px;background:rgba(8,8,14,0.92);z-index:24;';
  const h = document.createElement('h2');
  h.className = 'mc-font';
  h.textContent = 'CHARACTER';
  h.style.cssText = 'font-size:30px;letter-spacing:4px;color:#c9a6ff;';
  panel.appendChild(h);

  const cols = document.createElement('div');
  cols.style.cssText = 'display:flex;gap:34px;align-items:center;';
  panel.appendChild(cols);

  // Left: the live 3D preview (renderer created lazily on first open).
  const previewWrap = document.createElement('div');
  previewWrap.style.cssText = 'width:280px;height:400px;background:rgba(10,13,22,0.72);' +
    'border:1px solid #3a2a5e;border-radius:10px;overflow:hidden;';
  cols.appendChild(previewWrap);

  // Right: one ‹ value › cycler row per cosmetic category.
  const rows = document.createElement('div');
  rows.style.cssText = 'display:flex;flex-direction:column;gap:7px;min-width:360px;';
  cols.appendChild(rows);

  const editing: Cosmetics = defaultCosmetics(0);
  const valueEls = new Map<keyof Cosmetics, { text: HTMLSpanElement; dot: HTMLSpanElement }>();

  let previewRenderer: THREE.WebGLRenderer | null = null;
  let previewScene: THREE.Scene | null = null;
  let previewCam: THREE.PerspectiveCamera | null = null;
  let previewBody: AvatarBody | null = null;
  let previewSpin = 0.6;
  let previewRAF = 0;
  let lastFrame = 0;

  function rebuildPreview(): void {
    if (!previewScene) return;
    if (previewBody) {
      previewScene.remove(previewBody.group);
      disposeAvatarBody(previewBody);
    }
    previewBody = buildAvatarBody({ ...editing });
    previewBody.group.rotation.y = previewSpin;
    // Relaxed idle pose so the model doesn't look like a mannequin.
    previewBody.parts[2].rotation.x = -0.08;
    previewBody.parts[3].rotation.x = 0.08;
    previewScene.add(previewBody.group);
  }

  function refreshRows(): void {
    for (const opt of CHAR_OPTIONS) {
      const el = valueEls.get(opt.key);
      if (!el) continue;
      const i = editing[opt.key];
      el.text.textContent = opt.names[i] ?? '—';
      if (opt.swatches) {
        el.dot.style.display = '';
        el.dot.style.background = `#${opt.swatches[i].hex.toString(16).padStart(6, '0')}`;
      } else {
        el.dot.style.display = 'none';
      }
    }
  }

  for (const opt of CHAR_OPTIONS) {
    const row = document.createElement('div');
    row.className = 'mc-font';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;';
    const label = document.createElement('span');
    label.textContent = opt.label;
    label.style.cssText = 'flex:0 0 110px;color:#cfe0ff;';
    const mkArrow = (txt: string, d: number): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'mc-btn';
      b.textContent = txt;
      b.style.cssText = 'font-size:14px;padding:4px 12px;';
      b.addEventListener('click', () => {
        const n = COSMETIC_RANGES[opt.key];
        editing[opt.key] = (editing[opt.key] + d + n) % n;
        refreshRows();
        rebuildPreview();
      });
      return b;
    };
    const dot = document.createElement('span');
    dot.style.cssText = 'width:14px;height:14px;border:1px solid rgba(255,255,255,0.4);' +
      'border-radius:3px;display:none;';
    const value = document.createElement('span');
    value.style.cssText = 'flex:1;text-align:center;color:#fff;';
    row.append(label, mkArrow('‹', -1), dot, value, mkArrow('›', 1));
    rows.appendChild(row);
    valueEls.set(opt.key, { text: value, dot });
  }

  // Bottom buttons: randomise / save / back.
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;';
  const randomBtn = document.createElement('button');
  randomBtn.className = 'mc-btn';
  randomBtn.textContent = 'Randomise';
  randomBtn.style.cssText = 'font-size:15px;padding:9px 18px;';
  randomBtn.addEventListener('click', () => {
    Object.assign(editing, randomCosmetics());
    refreshRows();
    rebuildPreview();
  });
  const saveBtn = document.createElement('button');
  saveBtn.className = 'mc-btn';
  saveBtn.textContent = 'Save Look';
  saveBtn.style.cssText = 'font-size:15px;padding:9px 24px;background:linear-gradient(#8a5fd6,#6a41b0);' +
    'border-color:#d6bdff #35205e #35205e #d6bdff;color:#f3ecff;text-shadow:none;';
  saveBtn.addEventListener('click', () => {
    myCosmetics = { ...editing };
    invalidateSelfAvatar(); // your third-person body reflects the new look/side
    saveCosmetics();
    showNotice('New look saved — everyone sees it!');
    close();
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'mc-btn';
  backBtn.textContent = 'Back';
  backBtn.style.cssText = 'font-size:15px;padding:9px 18px;';
  backBtn.addEventListener('click', () => close());
  btnRow.append(randomBtn, saveBtn, backBtn);
  panel.appendChild(btnRow);
  app.appendChild(panel);

  function animatePreview(now: number): void {
    previewRAF = requestAnimationFrame(animatePreview);
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    if (!previewRenderer || !previewScene || !previewCam) return;
    previewSpin += dt * 0.7; // slow turntable
    if (previewBody) previewBody.group.rotation.y = previewSpin;
    previewRenderer.render(previewScene, previewCam);
  }

  function open(): void {
    Object.assign(editing, myCosmetics);
    if (!previewRenderer) {
      previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      previewRenderer.setSize(280, 400);
      previewRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      previewWrap.appendChild(previewRenderer.domElement);
      previewScene = new THREE.Scene();
      previewCam = new THREE.PerspectiveCamera(38, 280 / 400, 0.1, 20);
      previewCam.position.set(0, 1.25, 3.4);
      previewCam.lookAt(0, 1.0, 0);
    }
    refreshRows();
    rebuildPreview();
    panel.style.display = 'flex';
    lastFrame = performance.now();
    previewRAF = requestAnimationFrame(animatePreview);
  }
  function close(): void {
    if (panel.style.display === 'none') return;
    panel.style.display = 'none';
    cancelAnimationFrame(previewRAF);
  }
  return { open, close };
})();

characterBtn.addEventListener('click', () => {
  if (!authed) return;
  audio.resume();
  controlsPanel.style.display = 'none';
  charUI.open();
});

// --- First-play tutorial: 3 tiny cards, shown ONCE on the first Play ----------
let tutorialSeen = false;
try { tutorialSeen = localStorage.getItem('voxelon.tutorialSeen') === '1'; } catch { /* ignore */ }

const tutorial = (() => {
  const steps: { title: string; lines: string[] }[] = isMobile ? [
    { title: '⛏️ MOVE & BUILD', lines: [
      'Left joystick to move · ⬆ to jump',
      'Long-press mines blocks · Tap places & uses them',
    ] },
    { title: '🎒 CRAFT', lines: [
      'Tap 🎒 for your inventory + crafting',
      'Build a Crafting Table, open it, and hit 📖 Guide for every recipe',
    ] },
    { title: '⚔️ WAR', lines: [
      "You're auto-assigned to a faction — fight for it!",
      'When WAR starts the border closes in and everyone glows —',
      'most kills wins · 🗺 = map · ⚑ = your progress',
    ] },
  ] : [
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
      'When WAR starts the border closes in and everyone glows —',
      'most kills wins · M = map · G = your progress',
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
document.getElementById('quit-btn')!.addEventListener('click', () => {
  enterTitle();
});

document.addEventListener('pointerlockchange', () => {
  if (!worldReady) return;
  if (input.locked) {
    enterPlaying(); // entered or returned to the game
  } else if (!player.dead && !invUI.open && !worldMap.open && !tpaPromptVisible &&
      screen === 'playing') {
    enterPause(); // Esc / lost focus while playing -> pause, not the title
  }
});
// Safety net: re-engage pointer lock by clicking the world when we're in-game
// but unlocked (e.g. a menu just closed but the browser blocked an immediate
// re-lock — "requestPointerLock too soon after exit"). This guarantees you can
// always get movement back after closing the Map panel.
renderer.domElement.addEventListener('mousedown', () => {
  if (screen === 'playing' && !input.locked && !player.dead &&
      !invUI.open && !worldMap.open && !tpaPromptVisible) {
    input.lock();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (tutorial.open) { tutorial.finish(); }
  else if (tpaPromptVisible) { closeTpaPrompt(); }
  else if (progressOpen) { hideProgress(); }
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
    pushStateSave();
    input.lock();
  }
});

function checkDeath(): void {
  if (!player.dead || deathShown) return;
  deathShown = true;
  clearVaultPresentation(true, 0.35);
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
  input.unlock();
}

// --- Persistence: server-stored inventory + position (MP) and localStorage
// (offline). The server is the system of record online; offline we mirror to
// localStorage keyed by the local account so single-player also persists.
function pushStateSave(): void {
  if (net.connected) {
    const blob = inventory.serialize() as unknown as Record<string, unknown>;
    blob.progress = { xp: progress.xp, nodes: progress.nodes }; // XP rides along
    net.sendSaveState(blob);
  } else if (authedName) {
    try {
      localStorage.setItem(`voxelon.inv.${authedName.toLowerCase()}`,
        JSON.stringify(inventory.serialize()));
    } catch { /* ignore */ }
    saveOfflineProgress();
  }
}
net.onRestoreState = (state) => {
  inventory.restore(state);
  const st = sanitizeProgress((state as { progress?: unknown }).progress);
  progress.xp = st.xp; progress.nodes = st.nodes;
};
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
  invalidateSelfAvatar(); // your third-person body reflects the new look/side
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
  // Cosmetics: adopt the account-saved look from the server unless this
  // browser has a newer local edit — then push ours so everyone sees it.
  if (me.cosmetics && !hasCustomLook) {
    myCosmetics = sanitizeCosmetics(me.cosmetics, me.skin);
    invalidateSelfAvatar(); // your third-person body reflects the new look/side
  } else if (hasCustomLook) {
    net.sendCosmetics(myCosmetics);
  }
  held.setSkin(skinSeed(me.username), myCosmetics);
  refreshNetInfo();
};
// Someone (possibly us) changed their look: rebuild that avatar.
net.onCosmetics = (id) => remotePlayers.invalidate(id);
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
// Server-authoritative health between hits (REGEN): the periodic snapshot
// carries our own health, so the HUD ticks up smoothly instead of freezing
// until the next hit. Never let a snapshot revive us — that's onRespawned's job.
net.onSelfHealth = (health, dead) => {
  if (player.dead && !dead) return;
  player.setHealthFromServer(health, dead);
};
net.onRespawned = (x, y, z, h) => {
  player.respawn({ x, y, z });
  player.health = h;
  lastHealth = h;
  deathShown = false;
  deathEl.style.display = 'none';
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
  input.unlock();
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
  input.unlock();
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
/** Right-click a held Bandage/Medkit: consume it and trigger fast regen. In MP
 *  the server owns health (the buff flows back via the snapshot); offline the
 *  local Survival sim applies the same accelerated regen. */
function useHealItem(): void {
  const stack = inventory.selectedStack;
  const heal = stack ? ITEMS[stack.id]?.heal : undefined;
  if (!stack || !heal) return;
  if (player.health >= player.maxHealth) {
    showNotice("You're already at full health!");
    return;
  }
  const id = stack.id;
  inventory.consumeSelected(1);
  if (net.connected) net.sendUseHeal(id);
  else survival.boost(heal.duration, heal.interval);
  showNotice(`${ITEMS[id]?.name ?? 'Heal'} used — regenerating fast!`);
  audio.heal();
  pushStateSave();
}

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
// --- Progression (XP + upgrades): G panel, kill XP, faction pool --------------
// Personal XP is CLIENT-owned (persisted like the inventory: saveState online,
// localStorage offline). The faction pool is server-owned online (fxp
// broadcasts) and localStorage-mirrored offline. All rules live in progress.ts.
const progress: ProgressState = newProgress();
let factionXpPools: number[] = new Array(FACTIONS.length).fill(0);

function saveOfflineProgress(): void {
  if (net.connected || !authedName) return;
  try {
    localStorage.setItem(`voxelon.prog.${authedName.toLowerCase()}`, JSON.stringify(progress));
    localStorage.setItem(`voxelon.fxp.${authedName.toLowerCase()}`, JSON.stringify(factionXpPools));
  } catch { /* ignore */ }
}
function restoreOfflineProgress(): void {
  if (net.connected || !authedName) return;
  try {
    const raw = localStorage.getItem(`voxelon.prog.${authedName.toLowerCase()}`);
    const st = sanitizeProgress(raw ? JSON.parse(raw) : null);
    progress.xp = st.xp; progress.nodes = st.nodes;
    const fraw = localStorage.getItem(`voxelon.fxp.${authedName.toLowerCase()}`);
    factionXpPools = sanitizeFactionXp(fraw ? JSON.parse(fraw) : null, FACTIONS.length);
  } catch { /* ignore */ }
}

/** Grant personal XP (+ toast + level-up fanfare). */
function grantXp(amount: number, reason?: string): void {
  if (amount <= 0) return;
  const before = levelFor(progress.xp);
  progress.xp += amount;
  const after = levelFor(progress.xp);
  showNotice(`+${amount} XP${reason ? ` — ${reason}` : ''}`);
  if (after > before) {
    showRegionBanner(`⭐ LEVEL ${after}!`, '#ffd84a');
    showNotice(isMobile
      ? 'Level up! Tap ⚑ to spend your skill point.'
      : 'Level up! Press G to spend your skill point.');
    audio.heartSteal();
  }
  saveOfflineProgress();
  refreshProgressPanel();
}

// Mob kills feed personal XP + the faction pool (server clamps the report).
// Slayer capstones (+% mob XP) multiply the personal award.
mobs.onPlayerKill = (kind) => {
  const amt = Math.round((XP_MOB[kind] ?? 4) * activeBuffs().xpMult);
  grantXp(amt, kind);
  if (net.connected) net.sendXp(amt);
  else if (localFaction >= 0) {
    factionXpPools[localFaction] = (factionXpPools[localFaction] ?? 0) + amt;
    saveOfflineProgress();
  }
};
net.onXpAward = (amount, reason) => grantXp(amount, reason === 'kill' ? 'enemy kill' : reason);
net.onFactionXp = (xp) => {
  const before = factionLevelFor(factionXpPools[localFaction] ?? 0);
  factionXpPools = sanitizeFactionXp(xp, FACTIONS.length);
  const after = factionLevelFor(factionXpPools[localFaction] ?? 0);
  if (after > before) {
    showRegionBanner(`⚑ ${factionName(localFaction).toUpperCase()} REACHED LEVEL ${after}!`, factionCss(localFaction));
    audio.heartSteal();
  }
  refreshProgressPanel();
};

/** All progression + rune buffs that apply to the local player right now. */
function activeBuffs(): {
  speedMult: number; armorBonus: number; reloadMult: number;
  mineMult: number; spreadMult: number; gunDamageMult: number;
  meleeBonus: number; energyMult: number; fallMult: number; xpMult: number;
} {
  const mine = personalBuffs(progress);
  const perks = factionPerks(factionLevelFor(factionXpPools[localFaction] ?? 0));
  const runes = runeBonuses(inventory.wornArmor());
  return {
    speedMult: mine.speedMult * perks.speedMult * runes.speedMult,
    armorBonus: mine.armorBonus + perks.armor + runes.armor,
    reloadMult: mine.reloadMult,
    mineMult: mine.mineMult * runes.mineMult,
    spreadMult: mine.spreadMult * runes.spreadMult,
    gunDamageMult: mine.gunDamageMult,
    meleeBonus: mine.meleeBonus,
    energyMult: mine.energyMult,
    fallMult: mine.fallMult,
    xpMult: mine.xpMult,
  };
}

// --- The G panel: your XP/level/upgrades + your faction's level/perks ---------
let progressOpen = false;
const progressEl = document.createElement('div');
progressEl.style.cssText =
  'position:absolute;inset:0;display:none;z-index:34;align-items:center;' +
  'justify-content:center;background:rgba(6,8,14,0.82);';
const progressPanel = document.createElement('div');
progressPanel.className = 'mc-font';
progressPanel.style.cssText =
  'background:linear-gradient(#161a26,#10131c);border:2px solid #34406a;border-radius:10px;' +
  'box-shadow:0 10px 40px rgba(0,0,0,0.6);width:730px;max-width:96vw;max-height:88vh;overflow:auto;' +
  'color:#e7edf7;text-shadow:none;font-size:13px;padding-bottom:8px;';
progressEl.appendChild(progressPanel);
app.appendChild(progressEl);
progressEl.addEventListener('mousedown', (e) => { if (e.target === progressEl) hideProgress(); });

function xpBar(frac: number, color: string, label: string): string {
  return `<div style="position:relative;height:16px;background:#0c0f18;border:1px solid #2a3550;border-radius:4px;overflow:hidden">` +
    `<div style="height:100%;width:${(frac * 100).toFixed(1)}%;background:${color}"></div>` +
    `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff">${label}</div></div>`;
}

function refreshProgressPanel(): void {
  if (!progressOpen) return;
  const lvl = levelFor(progress.xp);
  const pts = pointsAvailable(progress);
  const fxp = factionXpPools[localFaction] ?? 0;
  const flvl = factionLevelFor(fxp);
  const perks = factionPerks(flvl);
  const buffs = activeBuffs();
  let html =
    `<div style="position:sticky;top:0;background:#10131c;display:flex;align-items:center;gap:10px;` +
    `padding:12px 16px;border-bottom:1px solid #232a40;z-index:1">` +
    `<div style="flex:1;font-size:15px;color:#ffd84a;letter-spacing:1px">⚑ FACTION &amp; PROGRESS</div>` +
    `<button id="prog-close" style="width:26px;height:26px;cursor:pointer;border:1px solid #3a4666;` +
    `border-radius:5px;background:#1c2335;color:#cdd6ee;font-size:13px">✕</button></div>`;

  // --- you ---
  html += `<div style="padding:12px 16px 4px">` +
    `<div style="font-size:11px;letter-spacing:2px;color:#7f8db0;margin-bottom:6px">YOU — ${authedName || 'PLAYER'}</div>` +
    `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:5px">` +
    `<span style="font-size:22px;color:#ffd84a">Lv ${lvl}</span>` +
    `<span style="color:#8f9ec0;font-size:11px">${progress.xp} XP</span>` +
    (pts > 0 ? `<span style="color:#7dffa0;font-size:12px">● ${pts} skill point${pts === 1 ? '' : 's'} to spend!</span>`
             : `<span style="color:#7f8db0;font-size:11px">kill mobs &amp; enemies for XP</span>`) +
    `</div>${xpBar(levelProgress(progress.xp), '#e2b23b', `to Lv ${Math.min(MAX_PLAYER_LEVEL, lvl + 1)}`)}</div>`;

  // --- THE SKILL TREE: 5 branches × 20 nodes. Costs rise with depth (1→4 pts)
  // and every 5th node is a named capstone — 250 points of tree against the 99
  // a maxed character earns, so you specialize. Hover a node for its story.
  html += `<div style="padding:8px 16px 2px;color:#7f8db0;font-size:10px;letter-spacing:1px">` +
    `SKILL TREE — 100 upgrades · deeper ranks cost more (1→4 pts) · ★ = capstone</div>`;
  html += `<div style="padding:4px 16px 6px;display:flex;flex-direction:column;gap:6px">`;
  for (const b of BRANCHES) {
    const nodes = branchNodes(b.id);
    const rank = branchRank(progress, b.id);
    html += `<div style="background:#141827;border:1px solid #232a40;border-radius:7px;padding:7px 9px">` +
      `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px">` +
      `<span style="font-size:15px">${b.icon}</span>` +
      `<span style="color:#ffd84a">${b.name}</span>` +
      `<span style="color:#8f9ec0;font-size:10px">${b.perNode.label} per rank · ${rank}/20</span></div>` +
      `<div style="display:flex;gap:3px;flex-wrap:nowrap">`;
    for (const n of nodes) {
      const owned = ownsNode(progress, n.id);
      const can = canBuyNode(progress, n.id);
      const capstone = n.name !== `${b.name} ${n.index + 1}`;
      const bg = owned ? '#7a5c14' : can ? '#1e3a24' : '#151a28';
      const border = owned ? '#ffd84a' : can ? '#54c96a' : '#262e44';
      const label = capstone ? '★' : String(n.index + 1);
      const color = owned ? '#ffe9a8' : can ? '#9fffb0' : '#4a5570';
      html += `<button data-node="${n.id}" title="${n.name} — ${n.desc} (${n.cost} pt${n.cost > 1 ? 's' : ''})" ` +
        `style="width:29px;height:29px;flex:0 0 auto;cursor:${can ? 'pointer' : 'default'};` +
        `border:${capstone ? 2 : 1}px solid ${border};border-radius:5px;background:${bg};` +
        `color:${color};font-size:${capstone ? 13 : 10}px;padding:0;font-family:inherit">` +
        `${label}</button>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;

  // --- faction ---
  const fname = factionName(localFaction);
  const fcol = factionCss(localFaction);
  const wa = warWins[FACTIONS[0].id] ?? 0, wb = warWins[FACTIONS[1].id] ?? 0;
  html += `<div style="padding:10px 16px 6px">` +
    `<div style="font-size:11px;letter-spacing:2px;color:#7f8db0;margin-bottom:6px">YOUR FACTION</div>` +
    `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:5px">` +
    `<span style="font-size:18px;color:${fcol}">■ ${fname}</span>` +
    `<span style="font-size:15px;color:#ffd84a">Lv ${flvl}</span>` +
    `<span style="color:#8f9ec0;font-size:11px">${fxp} shared XP</span></div>` +
    xpBar(factionLevelProgress(fxp), fcol, `to Lv ${Math.min(10, flvl + 1)}`) +
    `<div style="color:#9fb4cc;font-size:11px;margin-top:6px;line-height:1.7">` +
    `Everyone's kills level the whole faction. Current perks for every member:<br>` +
    `🛡 +${perks.armor} armor &nbsp;·&nbsp; 👟 +${((perks.speedMult - 1) * 100).toFixed(1)}% speed</div>` +
    (net.connected
      ? `<div style="color:#8f9ec0;font-size:11px;margin-top:6px">War wins this season — ` +
        `<span style="color:${factionCss(FACTIONS[0].id)}">${FACTIONS[0].name} ${wa}</span> · ` +
        `<span style="color:${factionCss(FACTIONS[1].id)}">${FACTIONS[1].name} ${wb}</span></div>`
      : '') +
    `</div>`;

  // --- your live totals ---
  html += `<div style="padding:4px 16px 8px;color:#7f8db0;font-size:11px;line-height:1.8">` +
    `Your combined buffs: +${((buffs.speedMult - 1) * 100).toFixed(1)}% speed · ` +
    `+${buffs.armorBonus} armor · −${((1 - buffs.reloadMult) * 100).toFixed(0)}% reload · ` +
    `+${((buffs.gunDamageMult - 1) * 100).toFixed(0)}% gun dmg · ` +
    `−${((1 - buffs.spreadMult) * 100).toFixed(0)}% spread · ` +
    `+${buffs.meleeBonus.toFixed(2)} melee · ` +
    `+${((buffs.mineMult - 1) * 100).toFixed(0)}% mining · ` +
    `−${((1 - buffs.energyMult) * 100).toFixed(0)}% sprint drain · ` +
    `−${((1 - buffs.fallMult) * 100).toFixed(0)}% fall dmg · ` +
    `+${((buffs.xpMult - 1) * 100).toFixed(0)}% mob XP</div>`;

  progressPanel.innerHTML = html;
  progressPanel.querySelector('#prog-close')!.addEventListener('click', hideProgress);
  for (const btn of progressPanel.querySelectorAll('button[data-node]')) {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).getAttribute('data-node')!;
      if (buyNode(progress, id)) {
        audio.heartSteal();
        saveOfflineProgress();
        pushStateSave();
        refreshProgressPanel();
      }
    });
  }
}

function showProgress(): void {
  if (progressOpen || player.dead) return;
  if (invUI.open) invUI.hide();
  if (worldMap.open) worldMap.hide();
  progressOpen = true;
  progressEl.style.display = 'flex';
  refreshProgressPanel();
  input.unlock();
}
function hideProgress(): void {
  if (!progressOpen) return;
  progressOpen = false;
  progressEl.style.display = 'none';
  if (worldReady && !player.dead && screen === 'playing') input.lock();
}
function toggleProgress(): void {
  if (progressOpen) hideProgress();
  else if (input.locked && screen === 'playing') showProgress();
}
// A clickable button stacked above the Map button (same footprint).
const progressBtn = document.createElement('button');
progressBtn.className = 'mc-font';
progressBtn.textContent = '⚑ Progress (G)';
progressBtn.style.cssText =
  'position:absolute;bottom:46px;right:8px;z-index:12;font-size:12px;padding:6px 10px;' +
  'width:118px;box-sizing:border-box;text-align:center;cursor:pointer;border:2px solid;' +
  'border-color:#fff #555 #555 #fff;background:#6b6b6b;color:#fff;text-shadow:none;display:none;';
  // Hidden on the title screen and on mobile (own ⚑ icon in the touch overlay).
progressBtn.addEventListener('click', () => {
  if (progressOpen) hideProgress();
  else if (!player.dead) showProgress();
});
app.appendChild(progressBtn);
// Flash the Progress button whenever there are unspent skill points.
const progressFlashStyle = document.createElement('style');
progressFlashStyle.textContent =
  '@keyframes prog-flash { 0%,100% { background:#6b6b6b; } 50% { background:#b8912b; } }';
document.head.appendChild(progressFlashStyle);
let progressFlashing = false;
function updateProgressFlash(): void {
  const want = pointsAvailable(progress) > 0;
  if (want === progressFlashing) return;
  progressFlashing = want;
  progressBtn.style.animation = want ? 'prog-flash 1.1s ease-in-out infinite' : '';
  progressBtn.textContent = want ? '⚑ Progress (G) ●' : '⚑ Progress (G)';
  progressBtn.style.borderColor = want ? '#ffd84a #7a5c10 #7a5c10 #ffd84a' : '#fff #555 #555 #fff';
}

// --- Vaults (Milestone D): dungeons, the Brute, per-player treasure ------------
// Deterministic stamps (cached per anchor chunk) drive everything client-side;
// the SERVER owns the Brute's shared HP + the once-per-player loot ledger
// online, and the identical pure rules run locally offline (localStorage).
const vaultStampCache = new Map<string, VaultStamp | null>();
function vaultStampCached(cx: number, cz: number): VaultStamp | null {
  const key = `${cx},${cz}`;
  let st = vaultStampCache.get(key);
  if (st === undefined) {
    st = vaultStamp(seed, cx, cz, world.terrain);
    vaultStampCache.set(key, st);
  }
  return st;
}
interface VaultView { tier: number; hp: number; maxHp: number; alive: boolean; opened: boolean; }
const vaultViews = new Map<string, VaultView>();
let curVault: VaultStamp | null = null;
let bruteMob: Mob | null = null;
let localVaultEncounter: VaultEncounter | null = null;
let localEncounterVaultKey: string | null = null;
let encounterSnapshot: EncounterSnapshot | null = null;
let encounterAttackSequence = 0;
let encounterRequestTimer = 0;
let encounterShakeTime = 0;
let encounterShakeStrength = 0;
const seenEncounterEvents = new Set<string>();
const seenEncounterIntros = new Set<string>();
let activeEncounterId = '';

/** One cleanup gate for every way an encounter presentation can end. Keeping
 * this atomic prevents a late snapshot from leaving a boss bar, cinematic or
 * soundtrack behind on the title/death/disconnect screens. */
function clearVaultPresentation(dropSnapshot = true, musicFade = 0.3): void {
  if (dropSnapshot) encounterSnapshot = null;
  encounterAttackSequence = 0;
  activeEncounterId = '';
  vaultBossHud.hide();
  vaultCinematic.finish();
  vaultEncounterVisuals.hide();
  audio.stopVaultMusic(musicFade);
}
let vaultPollTimer = 0;
let vaultSparkleTimer = 0;
const vaultKeyOf = (v: VaultStamp): string => `${v.cx},${v.cz}`;

// Offline per-account vault store: "cx,cz" -> Brute death epoch + the loot
// regrow ledger (lootedAt wall-clock ms + roll count). Legacy saves carried a
// once-only `opened` flag — migrated as "ready to loot again".
type VaultStore = Record<string, {
  deadAt?: number; opened?: boolean; lootedAt?: number; rolls?: number;
  boss?: string; best?: number; clears?: number;
}>;
function loadVaultStore(): VaultStore {
  try {
    return JSON.parse(
      localStorage.getItem(`voxelon.vaults.${authedName.toLowerCase()}`) || '{}') as VaultStore;
  } catch { return {}; }
}
function saveVaultStore(s: VaultStore): void {
  try {
    localStorage.setItem(`voxelon.vaults.${authedName.toLowerCase()}`, JSON.stringify(s));
  } catch { /* ignore */ }
}
/** Seconds left on the offline per-player loot-regrow cooldown (0 = ready). */
function offlineLootCooldownLeft(rec?: VaultStore[string]): number {
  if (rec?.lootedAt === undefined) return 0;
  return Math.max(0, VAULT_LOOT_COOLDOWN - (Date.now() - rec.lootedAt) / 1000);
}
/** Offline mirror of the server's vault state (same recharge/loot-window rules,
 *  on the wall clock so the Brute stays down across sessions). */
function offlineVaultView(v: VaultStamp): VaultView {
  const rec = loadVaultStore()[vaultKeyOf(v)];
  const sinceDead = (Date.now() - (rec?.deadAt ?? -Infinity)) / 1000;
  const alive = sinceDead > VAULT_RECHARGE;
  const max = bossMaxHp(v.tier, v.bossKind);
  return {
    tier: v.tier, hp: alive ? max : 0, maxHp: max, alive,
    opened: offlineLootCooldownLeft(rec) > 0, // = "your loot is regrowing"
  };
}

// Discovered vaults (client-side collection: map icons + "found X / Y").
let discoveredVaults: { key: string; x: number; z: number; tier: number }[] | null = null;
function discoveredList(): { key: string; x: number; z: number; tier: number }[] {
  if (!discoveredVaults) {
    try {
      const raw = localStorage.getItem(`voxelon.vaultsfound.${authedName.toLowerCase()}`);
      const list: { key: string; x: number; z: number; tier: number }[] =
        raw ? JSON.parse(raw) : [];
      discoveredVaults = Array.isArray(list)
        ? list.filter((d) => d && typeof d.key === 'string' &&
            Number.isFinite(d.x) && Number.isFinite(d.z)) : [];
    } catch { discoveredVaults = []; }
  }
  return discoveredVaults!;
}
// Every vault ENTRANCE in the world (one cached sweep — the layout is fixed for
// the seed). Vaults were too hard to find blind, so entrances within
// VAULT_REVEAL blocks now surface on the map/minimap (faint until entered).
let allVaults: { cx: number; cz: number; x: number; z: number; tier: number }[] | null = null;
function allVaultsList(): { cx: number; cz: number; x: number; z: number; tier: number }[] {
  if (!allVaults) allVaults = worldVaults(seed, world.terrain);
  return allVaults;
}
function totalVaults(): number { return allVaultsList().length; }

// Vault entrances currently within reveal range (recomputed as the player roams).
let nearbyVaults: { cx: number; cz: number; x: number; z: number; tier: number }[] = [];
let nearbyVaultKey = '';

// A faint light column at each nearby entrance so you can SPOT it in-world once
// the map has pointed you to the area. Shared geo + material (never disposed).
const vaultBeamGroup = new THREE.Group();
scene.add(vaultBeamGroup);
const VAULT_BEAM_GEO = new THREE.CylinderGeometry(0.6, 0.6, 70, 8, 1, true);
const VAULT_BEAM_MAT = new THREE.MeshBasicMaterial({
  color: 0x9a6aff, transparent: true, opacity: 0.14, depthWrite: false,
  side: THREE.DoubleSide,
});
function rebuildVaultBeams(): void {
  while (vaultBeamGroup.children.length > nearbyVaults.length) vaultBeamGroup.children.pop();
  while (vaultBeamGroup.children.length < nearbyVaults.length) {
    vaultBeamGroup.add(new THREE.Mesh(VAULT_BEAM_GEO, VAULT_BEAM_MAT));
  }
  nearbyVaults.forEach((v, i) => {
    const gy = world.terrain.height(Math.round(v.x), Math.round(v.z));
    (vaultBeamGroup.children[i] as THREE.Mesh).position.set(v.x + 0.5, gy + 35, v.z + 0.5);
  });
}

/** Recompute the reveal set; rebuild the beams + map only when it changes. */
function updateNearbyVaults(): void {
  const near = allVaultsList().filter((v) =>
    Math.hypot(v.x - player.pos.x, v.z - player.pos.z) <= VAULT_REVEAL);
  const key = near.map((v) => `${v.cx},${v.cz}`).join('|');
  if (key === nearbyVaultKey) return;
  nearbyVaultKey = key;
  nearbyVaults = near;
  rebuildVaultBeams();
  refreshVaultMap();
}

function refreshVaultMap(): void {
  const disc = discoveredList();
  const discKeys = new Set(disc.map((d) => d.key));
  const marks = disc.map((d) => ({
    x: d.x, z: d.z, tier: d.tier, discovered: true,
    cleared: vaultViews.get(d.key)?.alive === false,
  }));
  // Sensed-but-not-entered vaults render faint with no tier. EVERY Heartland
  // (Tier I) entrance is marked from the start — finding your first vault
  // should be a map-read, not a needle hunt.
  const marked = new Set(discKeys);
  for (const v of [...nearbyVaults, ...allVaultsList().filter((a) => a.tier === 1)]) {
    const key = `${v.cx},${v.cz}`;
    if (marked.has(key)) continue;
    marked.add(key);
    marks.push({ x: v.x, z: v.z, tier: v.tier, discovered: false, cleared: false });
  }
  worldMap.setVaults(marks, totalVaults());
}

function discoverVault(v: VaultStamp): void {
  const list = discoveredList();
  if (!list.some((d) => d.key === vaultKeyOf(v))) {
    // Store the ENTRANCE (mouth) so the marker sits where you actually walked in.
    list.push({ key: vaultKeyOf(v), x: v.mouth.x, z: v.mouth.z, tier: v.tier });
    try {
      localStorage.setItem(`voxelon.vaultsfound.${authedName.toLowerCase()}`, JSON.stringify(list));
    } catch { /* ignore */ }
    showNotice(`☠ Vault discovered! (${list.length}/${totalVaults()} found)`);
  }
  refreshVaultMap();
}

/** Crossing a vault's bounds: sting + banner + minimap dim + discovery, and
 *  fetch/derive the authoritative boss state. */
function onVaultTransition(v: VaultStamp | null): void {
  const previousKey = curVault ? vaultKeyOf(curVault) : null;
  if (!v) {
    clearVaultPresentation(true);
    seenEncounterEvents.clear();
    if (bruteMob) { mobs.slay(bruteMob); bruteMob = null; }
    curVault = null;
    return;
  }

  const nextKey = vaultKeyOf(v);
  // Offline encounters are kept when briefly stepping out of the same vault so
  // returning cannot manufacture a fresh encounter id and replay its intro.
  // Moving to a different vault intentionally abandons the old local runtime.
  if (localEncounterVaultKey && localEncounterVaultKey !== nextKey) {
    localVaultEncounter = null;
    localEncounterVaultKey = null;
  }
  curVault = v;
  if (net.connected) {
    net.sendVaultEnter(v.cx, v.cz);
  } else {
    vaultViews.set(nextKey, offlineVaultView(v));
    if (localVaultEncounter && localEncounterVaultKey === nextKey) {
      encounterSnapshot = localVaultEncounter.snapshot();
      activeEncounterId = encounterSnapshot.encounterId;
      vaultBossHud.update(encounterSnapshot);
      audio.startVaultMusic(v.family, encounterSnapshot.phase);
      audio.setVaultMusicPhase(encounterSnapshot.phase, encounterSnapshot.hpPercent < 0.15);
    }
  }
  discoverVault(v);
  if (previousKey !== nextKey) {
    showRegionBanner(`☠ VAULT — TIER ${['I', 'II', 'III'][v.tier - 1] ?? '?'}`, '#b9a5ff');
    audio.vaultSting();
  }
}

function localInsideArena(v: VaultStamp): boolean {
  const b = v.arena.bounds;
  return player.pos.x >= b.minX && player.pos.x <= b.maxX &&
    player.pos.y >= b.minY && player.pos.y <= b.maxY &&
    player.pos.z >= b.minZ && player.pos.z <= b.maxZ;
}

function localEncounterParticipant(v: VaultStamp) {
  return {
    id: net.connected ? net.myId : 0,
    position: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
    alive: !player.dead, inside: localInsideArena(v),
  };
}

function heldEncounterSource(): VaultAttackIntent['source'] {
  const info = inventory.selectedStack ? ITEMS[inventory.selectedStack.id] : undefined;
  if (info?.gun?.rocket) return 'rocket';
  if (info?.gun) return 'bullet';
  if (inventory.selectedStack && gadgetOf(inventory.selectedStack.id)) return 'gadget';
  return 'melee';
}

function hitEncounterTarget(
  targetId: number, hit: { x: number; y: number; z: number }, damage: number,
  source: VaultAttackIntent['source'],
): boolean {
  if (!curVault || !encounterSnapshot) return false;
  const stack = inventory.selectedStack;
  const heldInfo = stack ? ITEMS[stack.id] : undefined;
  const gadget = stack ? gadgetOf(stack.id) : undefined;
  const maxDamage = heldInfo?.gun
    ? heldInfo.gun.damage * Math.max(1, heldInfo.gun.pellets ?? 1)
    : gadget ? Math.min(30, gadget.damage ?? 8)
      : stack?.id === Item.Sword ? 7 : 4;
  const range = heldInfo?.gun ? heldInfo.gun.range : gadget ? 24 : 4;
  const cadence = heldInfo?.gun ? heldInfo.gun.cooldown : gadget ? 0.8 : 0.32;
  const intent: VaultAttackIntent = {
    encounterId: encounterSnapshot.encounterId,
    sequence: ++encounterAttackSequence,
    targetId, source, hit: { ...hit },
    claimedDamage: Math.max(1, Math.min(maxDamage, damage)),
  };
  if (net.connected) {
    net.sendVaultAttack(curVault.cx, curVault.cz, intent);
    return true;
  }
  if (!localVaultEncounter) return false;
  localVaultEncounter.attack(intent, localEncounterParticipant(curVault), {
    heldSource: source, maxDamage, range, cadence, now: worldTimeLocal,
  });
  encounterSnapshot = localVaultEncounter.snapshot();
  vaultBossHud.update(encounterSnapshot);
  return true;
}

function encounterEvent(event: EncounterEvent): void {
  if (seenEncounterEvents.has(event.id)) return;
  seenEncounterEvents.add(event.id);
  if (seenEncounterEvents.size > 512) {
    const first = seenEncounterEvents.values().next().value as string | undefined;
    if (first) seenEncounterEvents.delete(first);
  }
  if (event.type === 'phase' && encounterSnapshot) {
    const phase = event.audio === 'phase_3' ? 3 : 2;
    const phaseSnapshot = { ...encounterSnapshot, phase } as EncounterSnapshot;
    showRegionBanner(`⚔ PHASE ${phase} — ${
      BOSS_DEFINITIONS[phaseSnapshot.kind].phaseTitles[phase - 1].toUpperCase()}`,
      '#d8c4ff');
    vaultCinematic.playPhase(phaseSnapshot, phase);
    audio.setVaultMusicPhase(phase, phaseSnapshot.hpPercent < 0.15);
    audio.vaultMusicCue('phase');
    triggerEncounterShake(0.55, 0.18);
  } else if (event.type === 'spawn') {
    audio.vaultMusicCue('summon');
    triggerEncounterShake(0.22, 0.07);
  } else if (event.type === 'poise_break') {
    showNotice('✦ BOSS EXPOSED!');
    audio.vaultMusicCue('poise');
    triggerEncounterShake(0.3, 0.12);
  } else if (event.type === 'enrage') {
    showRegionBanner('☠ ENRAGED — FINISH THE FIGHT!', '#ff493d');
    audio.vaultMusicCue('enrage');
    triggerEncounterShake(0.8, 0.2);
  } else if (event.type === 'victory') {
    if (encounterSnapshot) vaultCinematic.playVictory(encounterSnapshot);
    audio.vaultMusicCue('victory');
    triggerEncounterShake(0.9, 0.22);
  } else if (event.type === 'reset') {
    audio.vaultMusicCue('reset');
  } else if (event.type === 'cast') {
    triggerEncounterShake(0.12, 0.025);
  }
}

function triggerEncounterShake(duration: number, strength: number): void {
  if (accessibility.reducedMotion || accessibility.cameraShake <= 0) return;
  encounterShakeTime = Math.max(encounterShakeTime, duration);
  encounterShakeStrength = Math.max(encounterShakeStrength,
    strength * accessibility.cameraShake);
}

function updateEncounterShake(dt: number): void {
  if (encounterShakeTime <= 0 || accessibility.reducedMotion) return;
  encounterShakeTime = Math.max(0, encounterShakeTime - dt);
  const fade = Math.min(1, encounterShakeTime * 4);
  const x = Math.sin(worldTimeLocal * 79) * encounterShakeStrength * fade;
  const y = Math.cos(worldTimeLocal * 63) * encounterShakeStrength * fade * 0.65;
  camera.position.x += x;
  camera.position.y += y;
  if (view !== View.First) {
    viewCamera.position.x += x;
    viewCamera.position.y += y;
  }
  encounterShakeStrength *= Math.pow(0.08, dt);
}

function beginOfflineEncounter(v: VaultStamp): void {
  const boss = v.rooms.find((r) => r.kind === 'boss');
  if (!boss) return;
  localVaultEncounter = new VaultEncounter({
    encounterId: `offline:${v.cx}:${v.cz}:${Date.now()}`,
    seed: (seed ^ Math.imul(v.cx, 0x85ebca77) ^ Math.imul(v.cz, 0xc2b2ae3d)) >>> 0,
    tier: v.tier, kind: v.bossKind, family: v.family,
    center: { x: boss.x + 0.5, y: boss.y, z: boss.z + 0.5 },
    bounds: { ...v.arena.bounds }, sockets: v.arena.sockets,
    cameraAnchors: v.arena.cameraAnchors, startTime: worldTimeLocal,
  });
  localVaultEncounter.start(0, worldTimeLocal);
  localEncounterVaultKey = vaultKeyOf(v);
  encounterSnapshot = localVaultEncounter.snapshot();
  activeEncounterId = encounterSnapshot.encounterId;
  vaultBossHud.update(encounterSnapshot);
  if (!seenEncounterIntros.has(encounterSnapshot.encounterId)) {
    seenEncounterIntros.add(encounterSnapshot.encounterId);
    vaultCinematic.play(encounterSnapshot);
  }
  audio.startVaultMusic(v.family, 1);
}

function completeOfflineEncounter(v: VaultStamp): void {
  const key = vaultKeyOf(v);
  const store = loadVaultStore();
  if ((store[key]?.deadAt ?? 0) > Date.now() - 1000) return;
  const elapsed = localVaultEncounter
    ? Math.max(0, localVaultEncounter.now - localVaultEncounter.startedAt) : Infinity;
  store[key] = {
    ...store[key], deadAt: Date.now(), boss: v.bossKind,
    best: Math.min(store[key]?.best ?? Infinity, elapsed),
    clears: (store[key]?.clears ?? 0) + 1,
  };
  saveVaultStore(store);
  vaultViews.set(key, offlineVaultView(v));
  showRegionBanner('🏆 VAULT CLEARED!', '#ffd84a');
  audio.vaultMusicCue('victory');
  showKill(authedName || 'You', `Tier ${v.tier} ${VAULT_BOSS_NAMES[v.bossKind]} ☠`);
  refreshVaultMap();
}

/** Per-frame vault upkeep: bounds test (throttled), guard anchors, the Brute,
 *  and the unopened-chest sparkle. */
function updateVaults(dt: number): void {
  vaultPollTimer -= dt;
  if (vaultPollTimer <= 0) {
    vaultPollTimer = 0.3;
    updateNearbyVaults(); // reveal entrances within range as the player roams
    const v = vaultAt(seed, player.pos.x, player.pos.y + 0.5, player.pos.z,
      world.terrain, vaultStampCached);
    if (v?.cx !== curVault?.cx || v?.cz !== curVault?.cz) onVaultTransition(v);
  }
  mobs.setVault(curVault);
  if (!curVault) { vaultEncounterVisuals.hide(); return; }
  const view = vaultViews.get(vaultKeyOf(curVault));
  const inArena = localInsideArena(curVault);
  encounterRequestTimer -= dt;
  if (net.connected && view?.alive && inArena && !encounterSnapshot &&
      encounterRequestTimer <= 0) {
    encounterRequestTimer = 1;
    net.sendVaultEnter(curVault.cx, curVault.cz);
  }
  if (!net.connected && view?.alive && inArena && !localVaultEncounter) {
    beginOfflineEncounter(curVault);
  }
  if (localVaultEncounter) {
    const events = localVaultEncounter.tick(dt, [localEncounterParticipant(curVault)]);
    for (const event of events) encounterEvent(event);
    for (const hazard of localVaultEncounter.hazards) {
      const damage = localVaultEncounter.hitByHazard(hazard.id, localEncounterParticipant(curVault));
      if (damage > 0) player.damage(damage);
    }
    encounterSnapshot = localVaultEncounter.snapshot();
    if (bruteMob) {
      bruteMob.health = encounterSnapshot.hp;
      bruteMob.pos.set(encounterSnapshot.boss.position.x,
        encounterSnapshot.boss.position.y, encounterSnapshot.boss.position.z);
    }
    vaultBossHud.update(encounterSnapshot);
    audio.setVaultMusicPhase(encounterSnapshot.phase, encounterSnapshot.hpPercent < 0.15);
    if (localVaultEncounter.status === 'victory') {
      const victorySnapshot = encounterSnapshot;
      completeOfflineEncounter(curVault);
      if (victorySnapshot) vaultCinematic.playVictory(victorySnapshot);
      if (bruteMob) { mobs.slay(bruteMob); bruteMob = null; }
      encounterSnapshot = null;
      localVaultEncounter = null;
      localEncounterVaultKey = null;
      activeEncounterId = '';
      vaultBossHud.hide();
      vaultEncounterVisuals.hide();
      // `view` was read before completeOfflineEncounter replaced the cached
      // state. Ending this frame prevents that stale alive=true object from
      // spawning a fresh body immediately after the kill.
      return;
    } else if (localVaultEncounter.status === 'idle') {
      encounterSnapshot = null;
      localVaultEncounter = null;
      localEncounterVaultKey = null;
      activeEncounterId = '';
      vaultBossHud.hide();
      audio.stopVaultMusic();
    }
  }
  if (bruteMob?.removed) bruteMob = null;
  // The Brute prowls its loot room whenever the vault is uncleared.
  if (view?.alive && !bruteMob && !player.dead) {
    const boss = curVault.rooms.find((r) => r.kind === 'boss');
    if (boss) {
      // The seeded boss FLAVOUR varies per vault: Brute / Ravager / Colossus.
      bruteMob = mobs.spawnBoss(curVault.bossKind, boss.x + 0.5, boss.y, boss.z + 0.5);
      bruteMob.health = view.hp; // mirror the shared server HP
      // Encounter attacks/transforms come only from the shared runtime. The
      // legacy mob body is now a renderer/hit volume, not a second damage AI.
      bruteMob.meleeDmg = 0;
      bruteMob.speedFactor = 0;
      audio.mob('brute', bruteMob.pos.clone());
    }
  }
  // The treasure sparkles for players who haven't claimed their roll yet.
  vaultSparkleTimer -= dt;
  if (view && !view.opened && vaultSparkleTimer <= 0) {
    vaultSparkleTimer = 0.4;
    const c = curVault.chest;
    if (Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 26) {
      particles.burst(c.x + 0.5, c.y + 0.9, c.z + 0.5, 3, 0xffe27a, 1.4, 0.6);
    }
  }
  vaultBossHud.update(encounterSnapshot);
  vaultEncounterVisuals.update(encounterSnapshot, accessibility.highContrastTelegraphs,
    accessibility.reducedMotion || accessibility.photosensitivitySafe);
}

// --- GETTING STARTED guide (early-game direction) ------------------------------
// A small checklist panel so a fresh spawn always knows what to do next: punch
// a tree → tools → a gun → find + loot your first vault. Steps auto-check off
// (inventory scans + vault hooks), persist per account, and H hides/shows it.
const starterEl = document.createElement('div');
starterEl.className = 'mc-font';
starterEl.style.cssText =
  'position:absolute;top:110px;left:8px;z-index:10;pointer-events:none;' +
  'font-size:11px;line-height:1.75;color:#dfe6f2;text-shadow:1px 1px 0 #000;' +
  'background:rgba(8,10,16,0.55);border:1px solid #2a3550;border-radius:6px;' +
  'padding:7px 24px 7px 10px;max-width:250px;display:none;';
app.appendChild(starterEl);
const starterBody = document.createElement('div');
starterEl.appendChild(starterBody);
// A tappable ✕ so touch devices (no H key) can dismiss the checklist too.
const starterCloseBtn = document.createElement('div');
starterCloseBtn.textContent = '✕';
starterCloseBtn.style.cssText =
  'position:absolute;top:5px;right:6px;pointer-events:auto;cursor:pointer;' +
  'color:#7f8db0;font-size:11px;';
starterCloseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleGuidePanel(); });
starterEl.appendChild(starterCloseBtn);
let guideState: GuideState = newGuideState();
let guideLoadedFor = ''; // account the current state belongs to
let guideHidden = false;
let guideCheckTimer = 0;
let guideDirty = true; // re-render the panel HTML on the next update

function guideKey(): string { return `voxelon.guide.${authedName.toLowerCase()}`; }
function loadGuide(): void {
  if (!authedName || guideLoadedFor === authedName) return;
  guideLoadedFor = authedName;
  try {
    guideState = sanitizeGuide(JSON.parse(localStorage.getItem(guideKey()) ?? 'null'));
  } catch { guideState = newGuideState(); }
  try { guideHidden = localStorage.getItem(`${guideKey()}.hidden`) === '1'; } catch { /* ignore */ }
  guideDirty = true;
}
function saveGuide(): void {
  try { localStorage.setItem(guideKey(), JSON.stringify(guideState)); } catch { /* ignore */ }
}
function guideMark(id: string): void {
  if (!markGuideStep(guideState, id)) return;
  saveGuide();
  guideDirty = true;
  const step = GUIDE_STEPS.find((s) => s.id === id);
  if (step) showNotice(`✅ ${step.icon} ${step.text}`);
  if (guideComplete(guideState)) {
    showRegionBanner('🎉 GETTING STARTED — COMPLETE!', '#9affb0');
  }
}
function toggleGuidePanel(): void {
  guideHidden = !guideHidden;
  try {
    localStorage.setItem(`${guideKey()}.hidden`, guideHidden ? '1' : '0');
  } catch { /* ignore */ }
  guideDirty = true;
}
/** Inventory-scan detection for the early steps (cheap; runs twice a second). */
function detectGuideSteps(): void {
  const hasAny = (pred: (id: number) => boolean): boolean =>
    inventory.slots.some((s) => s !== null && pred(s.id));
  if (!guideState.wood && hasAny((id) => id === Block.OakLog || id === Block.BirchLog ||
    id === Block.SpruceLog || id === Block.JungleLog || id === Block.CherryLog)) guideMark('wood');
  if (!guideState.planks && hasAny((id) => id === Block.OakPlanks || id === Block.BirchPlanks ||
    id === Block.SprucePlanks || id === Block.JunglePlanks || id === Block.CherryPlanks)) guideMark('planks');
  if (!guideState.table && hasAny((id) => id === Block.CraftingTable)) guideMark('table');
  if (!guideState.pickaxe && hasAny((id) => ITEMS[id]?.tool?.type === 'pickaxe')) guideMark('pickaxe');
  if (!guideState.stone && hasAny((id) => id === Block.Cobblestone || id === Block.Stone)) guideMark('stone');
  if (!guideState.gun && hasAny((id) => !!ITEMS[id]?.gun)) guideMark('gun');
  if (!guideState.bullets && hasAny((id) => id === Item.Bullet || id === Item.Rocket)) {
    guideMark('bullets');
  }
  // Any real armor counts (worn or carried) — the glider shares the armor slot
  // but is 0-defense travel gear, not armor.
  if (!guideState.armor && hasAny((id) => !!ITEMS[id]?.armor && !ITEMS[id]?.glider)) {
    guideMark('armor');
  }
  if (!guideState.vault && discoveredList().length > 0) guideMark('vault');
  if (!guideState.loot) {
    for (const v of vaultViews.values()) {
      if (v.opened) { guideMark('loot'); break; }
    }
  }
}
/** Nearest not-yet-discovered vault entrance — the guide's compass hint. */
function nearestVaultHint(): string {
  const found = new Set(discoveredList().map((d) => d.key));
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const v of allVaultsList()) {
    if (found.has(`${v.cx},${v.cz}`)) continue;
    const d = Math.hypot(v.x - player.pos.x, v.z - player.pos.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (!best) return '';
  const glyph = compassGlyph(best.x - player.pos.x, best.z - player.pos.z);
  return `☠ Nearest vault: <b>${Math.round(bestD)}m ${glyph}</b>`;
}
/** A one-use Vault Compass: find the nearest vault of the compass's tier,
 *  drop a named waypoint on its entrance (with the terrain height, so the
 *  in-world badge floats right over the arch) and consume the compass. */
function useVaultCompass(item: number): void {
  const tier = item === Item.VaultCompass1 ? 1 : item === Item.VaultCompass2 ? 2 : 3;
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const v of allVaultsList()) {
    if (v.tier !== tier) continue;
    const d = Math.hypot(v.x - player.pos.x, v.z - player.pos.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (!best) { showNotice(`No Tier ${['I', 'II', 'III'][tier - 1]} vault exists in this world.`); return; }
  const glyph = compassGlyph(best.x - player.pos.x, best.z - player.pos.z);
  worldMap.addWaypointAt(best.x, world.terrain.height(best.x, best.z) + 1, best.z,
    `☠ Vault ${['I', 'II', 'III'][tier - 1]}`);
  inventory.consumeSelected(1);
  audio.heartSteal();
  showNotice(`🧭 Tier ${['I', 'II', 'III'][tier - 1]} vault: ${Math.round(bestD)}m ${glyph} — waypoint set!`);
}

function renderGuidePanel(): void {
  const next = nextGuideStep(guideState);
  const lines: string[] = [
    '<b style="color:#ffd84a">GETTING STARTED</b> <span style="color:#7f8db0">' +
      (isMobile ? '(tap ✕ to hide)' : '(H to hide)') + '</span>',
  ];
  for (const step of GUIDE_STEPS) {
    const done = guideState[step.id];
    const active = next?.id === step.id;
    const color = done ? '#7f8db0' : active ? '#ffe27a' : '#cdd6ee';
    const tick = done ? '✔' : active ? '▶' : '·';
    // The step text has a couple of keyboard-key parentheticals baked in —
    // swap them for the touch equivalent rather than pointing at keys mobile
    // players can't press.
    const text = isMobile
      ? step.text.replace('(E)', '(🎒)').replace('check the map — M', 'check the map — 🗺')
      : step.text;
    lines.push(`<span style="color:${color}">${tick} ${step.icon} ` +
      `${done ? `<s>${text}</s>` : text}</span>`);
  }
  // Live compass hint toward the nearest unexplored vault until one is looted.
  if (!guideState.loot) {
    const hint = nearestVaultHint();
    if (hint) lines.push(`<span style="color:#b9a5ff">${hint}</span>`);
  }
  starterBody.innerHTML = lines.join('<br>');
}
/** Per-frame guide upkeep: visibility, periodic detection, live vault hint. */
function updateGuide(dt: number, controlling: boolean): void {
  loadGuide();
  const show = controlling && authed && !guideHidden && !guideComplete(guideState);
  starterEl.style.display = show ? 'block' : 'none';
  if (!authed) return;
  guideCheckTimer -= dt;
  if (guideCheckTimer <= 0) {
    guideCheckTimer = 0.5;
    if (!guideComplete(guideState)) detectGuideSteps();
    guideDirty = true; // the distance hint ticks along as you walk
  }
  if (show && guideDirty) {
    guideDirty = false;
    renderGuidePanel();
  }
}

// Boss combat: local hits mirror to the server's shared HP; offline the local
// Brute IS the authority and its death opens the loot window.
mobs.onBruteHit = (mob, dmg) => {
  if (!curVault || !encounterSnapshot) return;
  const source = heldEncounterSource();
  hitEncounterTarget(0, {
    x: mob.pos.x, y: mob.pos.y + mob.height * 0.5, z: mob.pos.z,
  }, dmg, source);
  mob.health = encounterSnapshot.hp;
  const view = vaultViews.get(vaultKeyOf(curVault));
  if (view) view.hp = encounterSnapshot.hp;
};
mobs.onBruteDown = () => {
  bruteMob = null;
  // The shared encounter engine owns victory. A rejected intro/invulnerable hit
  // restores mirrored HP in onBruteHit before Mobs reaches this callback.
};
projectiles.encounterSink = (point, damage, source) => {
  const target = vaultEncounterVisuals.targetAtPoint(encounterSnapshot, point);
  return target
    ? hitEncounterTarget(target.id, target.hit, damage, source)
    : false;
};
net.onVault = (cx, cz, tier, hp, maxHp, alive, opened) => {
  const key = `${cx},${cz}`;
  const prev = vaultViews.get(key);
  vaultViews.set(key, { tier, hp, maxHp, alive, opened: opened ?? prev?.opened ?? false });
  if (curVault && curVault.cx === cx && curVault.cz === cz && bruteMob) {
    // Scaling can raise absolute HP while preserving percentage, so adopt the
    // authoritative value rather than enforcing a client-side no-heal rule.
    bruteMob.health = hp;
    if (!alive) { mobs.slay(bruteMob); bruteMob = null; }
  }
  refreshVaultMap();
};
net.onEncounterStart = (cx, cz, data) => {
  if (screen !== 'playing' || !curVault || curVault.cx !== cx || curVault.cz !== cz) return;
  encounterSnapshot = data.snapshot;
  activeEncounterId = encounterSnapshot.encounterId;
  encounterAttackSequence = 0;
  seenEncounterEvents.clear();
  vaultBossHud.update(encounterSnapshot);
  const canShowIntro = encounterSnapshot.status === 'intro' && encounterSnapshot.elapsed <= 1.25;
  if (canShowIntro && !seenEncounterIntros.has(encounterSnapshot.encounterId)) {
    seenEncounterIntros.add(encounterSnapshot.encounterId);
    vaultCinematic.play(encounterSnapshot);
  } else {
    // Re-entering or joining an encounter already underway restores combat
    // presentation without replaying the opening cinematic.
    vaultCinematic.finish();
  }
  audio.startVaultMusic(data.family, encounterSnapshot.phase);
  audio.setVaultMusicPhase(encounterSnapshot.phase, encounterSnapshot.hpPercent < 0.15);
  const view = vaultViews.get(`${cx},${cz}`);
  if (view) {
    view.hp = encounterSnapshot.hp;
    view.maxHp = encounterSnapshot.maxHp;
    view.alive = encounterSnapshot.hp > 0;
  }
};
net.onEncounterSnapshot = (cx, cz, snapshot) => {
  if (screen !== 'playing' || !curVault || curVault.cx !== cx || curVault.cz !== cz) return;
  // An older encounter can still have a packet in flight after a reset/quit.
  if (activeEncounterId && snapshot.encounterId !== activeEncounterId) return;
  activeEncounterId = snapshot.encounterId;
  encounterSnapshot = snapshot;
  vaultBossHud.update(snapshot);
  audio.setVaultMusicPhase(snapshot.phase, snapshot.hpPercent < 0.15);
  if (bruteMob) {
    bruteMob.health = snapshot.hp;
    bruteMob.pos.set(snapshot.boss.position.x, snapshot.boss.position.y, snapshot.boss.position.z);
  }
  const view = vaultViews.get(`${cx},${cz}`);
  if (view) { view.hp = snapshot.hp; view.maxHp = snapshot.maxHp; view.alive = snapshot.hp > 0; }
};
net.onEncounterEvent = (cx, cz, event) => {
  if (screen === 'playing' && curVault?.cx === cx && curVault.cz === cz) encounterEvent(event);
};
net.onEncounterEnd = (cx, cz, outcome) => {
  if (curVault?.cx !== cx || curVault.cz !== cz) return;
  const endedSnapshot = encounterSnapshot;
  if (screen === 'playing' && outcome === 'victory') {
    if (endedSnapshot) vaultCinematic.playVictory(endedSnapshot);
    showRegionBanner('🏆 VAULT CLEARED!', '#ffd84a');
    audio.vaultMusicCue('victory');
    const viewState = vaultViews.get(`${cx},${cz}`);
    if (viewState) { viewState.hp = 0; viewState.alive = false; }
    if (bruteMob) { mobs.slay(bruteMob); bruteMob = null; }
    encounterSnapshot = null;
    activeEncounterId = '';
    vaultBossHud.hide();
    vaultEncounterVisuals.hide();
  } else {
    if (screen === 'playing') audio.vaultMusicCue('reset');
    if (bruteMob) { mobs.slay(bruteMob); bruteMob = null; }
    clearVaultPresentation(true);
  }
};
net.onVaultCleared = (cx, cz, by) => {
  if (curVault && curVault.cx === cx && curVault.cz === cz) {
    showRegionBanner(by === net.username ? '🏆 VAULT CLEARED!' : `🏆 ${by.toUpperCase()} CLEARED THE VAULT!`, '#ffd84a');
    audio.vaultClear();
  }
  refreshVaultMap();
};
net.onVaultLooted = (cx, cz) => {
  const v = vaultViews.get(`${cx},${cz}`);
  if (v) v.opened = true;
  audio.heartSteal();
  guideMark('loot');
  pushStateSave();
};
// Right-clicking the VaultChest: server-validated online; the identical rules
// (boss dead within the window, once per account) run locally offline.
interaction.onVaultChest = (x, y, z) => {
  if (net.connected) { net.sendVaultChestOpen(x, y, z); return; }
  const v = (curVault && curVault.chest.x === x && curVault.chest.y === y && curVault.chest.z === z)
    ? curVault : vaultAt(seed, x, y, z, world.terrain, vaultStampCached);
  if (!v || v.chest.x !== x || v.chest.y !== y || v.chest.z !== z) return;
  const key = vaultKeyOf(v);
  const view = vaultViews.get(key) ?? offlineVaultView(v);
  if (view.alive) {
    showNotice(`☠ The ${VAULT_BOSS_NAMES[v.bossKind]} guards this chest — defeat it first!`);
    return;
  }
  const store = loadVaultStore();
  if ((Date.now() - (store[key]?.deadAt ?? -Infinity)) / 1000 > VAULT_LOOT_WINDOW) {
    showNotice('🔒 The vault has resealed — the Brute will return to guard it.');
    return;
  }
  const cd = offlineLootCooldownLeft(store[key]);
  if (cd > 0) {
    showNotice(`⏳ You've looted this vault — the treasure regrows in ${Math.ceil(cd / 60)}m.`);
    return;
  }
  const roll = store[key]?.rolls ?? 0;
  for (const s of vaultLoot(seed, v.cx, v.cz, v.tier, authedName || 'You', roll)) {
    const left = inventory.add(s.id, s.count);
    if (left > 0) spillAtPlayer([{ id: s.id, count: left }]);
  }
  store[key] = { ...store[key], lootedAt: Date.now(), rolls: roll + 1 };
  saveVaultStore(store);
  view.opened = true;
  vaultViews.set(key, view);
  showNotice(`✨ Tier ${v.tier} vault treasure claimed!`);
  audio.heartSteal();
  guideMark('loot');
  pushStateSave();
};

// A Lever pull: server-authoritative online (linked traps can flip beyond the
// puller's own edit range, so it can't be sent as plain edits); offline the
// identical pure flip rules (traps.ts) run over the local world.
interaction.onLever = (x, y, z) => {
  audio.place(materialOf(Block.Lever), new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
  if (net.connected) { net.sendLever(x, y, z); return; }
  for (const f of leverFlips((bx, by, bz) => world.getBlock(bx, by, bz), x, y, z)) {
    world.setBlock(f.x, f.y, f.z, f.block);
  }
};

// --- TPA: teleport requests (DonutSMP-style) ----------------------------------
// T opens a small "teleport to who?" prompt; the TARGET must hold Y for
// TPA_HOLD seconds to accept — moving or taking damage resets the hold — and
// the requester is then teleported straight to them (server-authoritative).
// Multiplayer only: offline there is nobody to teleport to.
let tpaPromptVisible = false;
let tpaIncomingFrom = '';   // username of the pending requester ('' = none)
let tpaIncomingAtMs = 0;    // wall-clock ms the request arrived
let tpaHold = 0;            // seconds the accept key has been held
let tpaHoldStart: THREE.Vector3 | null = null; // position when the hold began
let tpaHoldHealth = 0;      // health when the hold began (a hit = cancel)
let tpaHoldBlocked = false; // a cancelled hold needs a key release to retry

const tpaPromptEl = document.createElement('div');
tpaPromptEl.style.cssText =
  'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
  'background:rgba(8,8,14,0.6);z-index:24;';
const tpaCard = document.createElement('div');
tpaCard.className = 'mc-font';
tpaCard.style.cssText = 'background:#15182b;border:2px solid #3a4790;border-radius:10px;' +
  'padding:18px 22px;display:flex;flex-direction:column;gap:10px;width:330px;';
tpaCard.innerHTML =
  '<div style="font-size:18px;color:#ffd84a;letter-spacing:1px;">🌀 TPA REQUEST</div>' +
  `<div style="font-size:12px;color:#cfe0ff;line-height:1.6;">Type a player name — if they ` +
  (isMobile
    ? `hold the accept button for ${TPA_HOLD}s you teleport straight to them.</div>`
    : `hold <b>Y</b> for ${TPA_HOLD}s you teleport straight to them.</div>`);
const tpaInput = document.createElement('input');
tpaInput.type = 'text';
tpaInput.maxLength = 32;
tpaInput.placeholder = 'player name…';
tpaInput.className = 'mc-font';
tpaInput.style.cssText = 'font-size:15px;padding:7px 10px;background:#0c0e1a;color:#fff;' +
  'border:1px solid #3a4790;border-radius:6px;outline:none;';
const tpaHint = document.createElement('div');
tpaHint.className = 'mc-font';
tpaHint.style.cssText = 'font-size:11px;color:#7f8db0;';
tpaHint.textContent = isMobile ? 'Tap Send to send' : 'Enter = send · Esc = cancel';
const tpaBtnRow = document.createElement('div');
tpaBtnRow.style.cssText = 'display:flex;gap:10px;';
const tpaSendBtn = document.createElement('button');
tpaSendBtn.className = 'mc-btn';
tpaSendBtn.textContent = 'Send';
tpaSendBtn.style.cssText = 'flex:1;font-size:14px;padding:7px 0;';
const tpaCancelBtn = document.createElement('button');
tpaCancelBtn.className = 'mc-btn';
tpaCancelBtn.textContent = 'Cancel';
tpaCancelBtn.style.cssText = 'flex:1;font-size:14px;padding:7px 0;';
tpaBtnRow.append(tpaSendBtn, tpaCancelBtn);
tpaCard.append(tpaInput, tpaHint, tpaBtnRow);
tpaPromptEl.appendChild(tpaCard);
app.appendChild(tpaPromptEl);

function sendTpaFromPrompt(): void {
  const name = tpaInput.value.trim();
  if (name) net.sendTpa(name);
  closeTpaPrompt();
}
tpaSendBtn.addEventListener('click', sendTpaFromPrompt);
tpaCancelBtn.addEventListener('click', () => closeTpaPrompt());

function openTpaPrompt(): void {
  if (!net.connected) { showNotice('TPA needs multiplayer — no server connected.'); return; }
  if (tpaPromptVisible) return;
  tpaPromptVisible = true;
  tpaPromptEl.style.display = 'flex';
  tpaInput.value = '';
  input.unlock();
  window.setTimeout(() => tpaInput.focus(), 0);
}
function closeTpaPrompt(): void {
  if (!tpaPromptVisible) return;
  tpaPromptVisible = false;
  tpaPromptEl.style.display = 'none';
  tpaInput.blur();
  if (worldReady && !player.dead) input.lock();
}
tpaInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // typing must never trigger game hotkeys (E, M, T…)
  if (e.key === 'Enter') {
    sendTpaFromPrompt();
  } else if (e.key === 'Escape') {
    closeTpaPrompt();
  }
});
tpaPromptEl.addEventListener('mousedown', (e) => {
  if (e.target === tpaPromptEl) closeTpaPrompt(); // click outside = cancel
});

// Incoming-request banner (target side): sticky while the request is pending.
const tpaBannerEl = document.createElement('div');
tpaBannerEl.className = 'mc-font';
tpaBannerEl.style.cssText =
  'position:absolute;top:130px;left:50%;transform:translateX(-50%);z-index:12;' +
  'display:none;text-align:center;font-size:13px;line-height:1.8;color:#eaf0ff;' +
  'white-space:pre-line;text-shadow:1px 1px 0 #000;background:rgba(8,10,16,0.62);' +
  'border:1px solid #3a4790;border-radius:8px;padding:8px 16px;pointer-events:none;';
app.appendChild(tpaBannerEl);

// Mobile has no Y key — a press-and-hold on-screen button drives the same
// `input.tAccept` flag `updateTpa` ORs in with `KeyY`. Only shown on touch
// devices, right under the banner, while a request is actually pending.
const tpaAcceptBtn = document.createElement('div');
if (isMobile) {
  tpaAcceptBtn.className = 'mc-font';
  tpaAcceptBtn.textContent = 'HOLD TO ACCEPT';
  tpaAcceptBtn.style.cssText =
    'position:absolute;top:230px;left:50%;transform:translateX(-50%);z-index:12;' +
    'display:none;text-align:center;font-size:13px;letter-spacing:1px;color:#0c0e1a;' +
    'background:#7dffa0;border:2px solid;border-color:#fff #3a7a4e #3a7a4e #fff;' +
    'border-radius:8px;padding:10px 22px;pointer-events:auto;cursor:pointer;user-select:none;';
  const setAccept = (down: boolean): void => {
    input.tAccept = down;
    tpaAcceptBtn.style.background = down ? '#54d980' : '#7dffa0';
  };
  tpaAcceptBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); setAccept(true); });
  tpaAcceptBtn.addEventListener('pointerup', () => setAccept(false));
  tpaAcceptBtn.addEventListener('pointercancel', () => setAccept(false));
  tpaAcceptBtn.addEventListener('pointerleave', () => setAccept(false));
  app.appendChild(tpaAcceptBtn);
}

net.onTpaRequest = (from) => {
  tpaIncomingFrom = from;
  tpaIncomingAtMs = performance.now();
  tpaHold = 0;
  tpaHoldStart = null;
  tpaHoldBlocked = false;
  showNotice(isMobile
    ? `📨 ${from} wants to teleport to YOU — hold the accept button!`
    : `📨 ${from} wants to teleport to YOU — hold Y to accept!`);
};

function cancelTpaHold(reason: string): void {
  showNotice(reason);
  tpaHold = 0;
  tpaHoldStart = null;
  tpaHoldBlocked = true; // release Y before trying again
}

/** Per-frame TPA upkeep: expire the pending request, run the hold-Y-to-accept
 *  clock (moving or taking damage resets it), and render the banner. */
function updateTpa(dt: number, controlling: boolean): void {
  if (!tpaIncomingFrom) {
    tpaBannerEl.style.display = 'none';
    if (isMobile) tpaAcceptBtn.style.display = 'none';
    return;
  }
  const ageSec = (performance.now() - tpaIncomingAtMs) / 1000;
  if (ageSec > TPA_EXPIRE || !net.connected) {
    tpaIncomingFrom = '';
    tpaBannerEl.style.display = 'none';
    if (isMobile) tpaAcceptBtn.style.display = 'none';
    return;
  }
  if (isMobile) tpaAcceptBtn.style.display = 'block';
  const holding = controlling && !player.dead && (input.down('KeyY') || input.tAccept);
  if (holding && !tpaHoldBlocked) {
    if (!tpaHoldStart) {
      tpaHoldStart = player.pos.clone();
      tpaHoldHealth = player.health;
    }
    if (player.pos.distanceTo(tpaHoldStart) > 0.35) {
      cancelTpaHold('❌ TPA accept cancelled — you moved!');
    } else if (player.health < tpaHoldHealth) {
      cancelTpaHold('❌ TPA accept cancelled — you were hit!');
    } else {
      tpaHold += dt;
      if (tpaHold >= TPA_HOLD) {
        net.sendTpaAccept();
        showNotice(`🌀 Accepted — ${tpaIncomingFrom} is on their way!`);
        tpaIncomingFrom = '';
        tpaHold = 0;
        tpaHoldStart = null;
        tpaBannerEl.style.display = 'none';
        if (isMobile) tpaAcceptBtn.style.display = 'none';
        return;
      }
    }
  } else if (!holding) {
    tpaHold = 0;
    tpaHoldStart = null;
    tpaHoldBlocked = false;
  }
  tpaBannerEl.style.display = 'block';
  const bar = '█'.repeat(Math.round((tpaHold / TPA_HOLD) * 10)).padEnd(10, '░');
  tpaBannerEl.textContent =
    `📨 ${tpaIncomingFrom} wants to teleport to you\n` +
    (tpaHold > 0
      ? `accepting… ${bar} ${Math.max(0, TPA_HOLD - tpaHold).toFixed(1)}s — don't move!`
      : isMobile
        ? `hold the button below for ${TPA_HOLD}s to accept (${Math.ceil(TPA_EXPIRE - ageSec)}s left)`
        : `hold Y for ${TPA_HOLD}s to accept (${Math.ceil(TPA_EXPIRE - ageSec)}s left)`);
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
net.onWar = (active, timeLeft, nextIn, duration, score, wins) => {
  const wasActive = warActiveNow;
  warActiveNow = active; warLeft = timeLeft; warNextIn = nextIn; warDur = duration;
  if (Array.isArray(score)) warScore = score;
  if (Array.isArray(wins)) warWins = wins;
  if (active && !wasActive) {
    showRegionBanner('⚔️ WAR! THE BORDER IS CLOSING!', '#ff5a5a');
  }
};
net.onWarEnd = (winner, score) => {
  const a = score[FACTIONS[0].id] ?? 0, b = score[FACTIONS[1].id] ?? 0;
  if (winner === NO_FACTION) {
    showRegionBanner(`WAR OVER — DRAW (${a} : ${b})`, '#cfe0ff');
  } else if (winner === localFaction) {
    showRegionBanner(`🏆 WE WON THE WAR! (${a} : ${b})`, factionCss(winner));
  } else {
    showRegionBanner(`${factionName(winner).toUpperCase()} WINS THE WAR (${a} : ${b})`, factionCss(winner));
  }
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
  invalidateSelfAvatar(); // your third-person body reflects the new look/side
  refreshNetInfo();
  showNotice(`🤫 You secretly joined ${factionName(faction)}. Switches left: ${remaining}.`);
};
net.onSeasonEnd = (winner, number) => {
  // The winning side's badge is refreshed on the next welcome, but bump it now
  // for instant feedback.
  if (winner === localFaction && winner >= 0) localSeasonsWon++;
  warWins = new Array(FACTIONS.length).fill(0);
  announceSeasonEnd(winner, number);
  refreshNetInfo();
};
net.onDisconnect = () => {
  player.damageSink = undefined;
  survival.enableRegen = true;
  clearVaultPresentation(true);
  // Drop all server-owned warfare state so its meshes/markers don't linger
  // (turretModels reconciles to the now-empty set).
  turretStates.clear();
  warActiveNow = false;
  // Flags are server state: drop the markers so a stale pole/beacon can't linger
  // over an offline world.
  flagState = newFlags();
  flagModels.setState(false, flagState.flags);
  lastFlagMarkerKey = '';
  worldMap.setDynamicMarkers([]);
  myFactionFlagless = false;
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
let lavaTimer = 0; // throttles lava burn damage
let spikeHurtTimer = 0; // throttles spike-trap damage ticks

/** Someone (you) stepped on a landmine: the plate detonates — blocks crater,
 *  you and nearby mobs take blast damage, and in MP the server splashes other
 *  players + broadcasts the crater (same path as a rocket burst). */
function triggerLandmine(x: number, y: number, z: number): void {
  world.setBlock(x, y, z, Block.Air);
  net.sendEdit(x, y, z, 0);
  const at = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
  gadgetFxAt('frag', at.x, at.y, at.z);
  mobs.explode(at, player); // local blocks/mobs/self blast
  if (net.connected) net.sendRocketBlast(at.x, at.y, at.z);
  else destroyMachinesNear(at, 4);
  showNotice('💥 You stepped on a landmine!');
}

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
  const buffs = activeBuffs();
  const spread = (gun.spread ?? 0) * buffs.spreadMult; // Gunslinger + Rune of Focus
  // Gunslinger capstones boost per-round damage (server still clamps PvP hits).
  const boosted = buffs.gunDamageMult > 1
    ? { ...gun, damage: Math.max(1, Math.round(gun.damage * buffs.gunDamageMult)) }
    : gun;
  for (let i = 0; i < pellets; i++) {
    projectiles.fire(player.eyePosition, spreadDir(base, spread), boosted);
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
  reloadTimer = RELOAD_TIME * activeBuffs().reloadMult; // Gunslinger ranks
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
  if (view !== View.First) updateViewCamera();
}

const cinematicShotA = new THREE.Vector3();
const cinematicShotB = new THREE.Vector3();
const cinematicShotPos = new THREE.Vector3();
const cinematicGameplayPos = new THREE.Vector3();
const cinematicGameplayQuat = new THREE.Quaternion();

/** Drive both render cameras through the authored vault camera anchors. Gameplay
 * camera state is recomputed first every frame, then blended back during the
 * final section so control returns without a hard snap. */
function updateVaultCinematicCamera(): void {
  const frame = vaultCinematic.frame;
  if (!frame || !curVault) return;
  const p = frame.progress;
  const boss = frame.snapshot.boss.position;
  const anchors = curVault.arena.cameraAnchors;
  const a = anchors[0] ?? { x: boss.x - 7, y: boss.y + 4, z: boss.z - 7 };
  const b = anchors[1] ?? { x: boss.x + 6, y: boss.y + 5, z: boss.z + 6 };
  cinematicGameplayPos.copy(camera.position);
  cinematicGameplayQuat.copy(camera.quaternion);
  const gameplayFov = camera.fov;
  cinematicShotA.set(a.x, a.y, a.z);
  cinematicShotB.set(b.x, b.y, b.z);

  let returnMix = 0;
  let cinematicFov = 54;
  if (frame.mode === 'intro') {
    const sweep = THREE.MathUtils.smoothstep(p, 0.02, 0.55);
    cinematicShotPos.copy(cinematicShotA).lerp(cinematicShotB, sweep);
    // The second half pushes close to the boss before retreating into gameplay.
    const close = THREE.MathUtils.smoothstep(p, 0.42, 0.72);
    const orbit = p * Math.PI * 1.2;
    cinematicShotPos.lerp(cinematicShotA.set(
      boss.x + Math.cos(orbit) * 4.8,
      boss.y + 2.2 + Math.sin(p * Math.PI) * 1.3,
      boss.z + Math.sin(orbit) * 4.8,
    ), close);
    returnMix = THREE.MathUtils.smoothstep(p, 0.73, 1);
    cinematicFov = THREE.MathUtils.lerp(62, 42, close);
  } else if (frame.mode === 'phase') {
    const angle = -0.7 + p * Math.PI * 1.35;
    cinematicShotPos.set(
      boss.x + Math.cos(angle) * 5.2,
      boss.y + 2.8 + Math.sin(p * Math.PI) * 0.7,
      boss.z + Math.sin(angle) * 5.2,
    );
    returnMix = THREE.MathUtils.smoothstep(p, 0.62, 1);
    cinematicFov = 48;
  } else {
    const rise = THREE.MathUtils.smoothstep(p, 0.05, 0.78);
    cinematicShotPos.copy(cinematicShotB).lerp(cinematicShotA.set(
      boss.x + 0.5, boss.y + 8.5, boss.z + 8.5,
    ), rise);
    returnMix = THREE.MathUtils.smoothstep(p, 0.84, 1);
    cinematicFov = THREE.MathUtils.lerp(52, 64, rise);
  }

  camera.position.copy(cinematicShotPos).lerp(cinematicGameplayPos, returnMix);
  camera.lookAt(boss.x, boss.y + (frame.mode === 'victory' ? 1.1 : 1.8), boss.z);
  camera.quaternion.slerp(cinematicGameplayQuat, returnMix);
  camera.fov = THREE.MathUtils.lerp(cinematicFov, gameplayFov, returnMix);
  camera.updateProjectionMatrix();

  // Third-person mode still renders through viewCamera; during a cutscene it
  // deliberately mirrors the cinematic eye so every view gets the same shot.
  viewCamera.position.copy(camera.position);
  viewCamera.quaternion.copy(camera.quaternion);
  viewCamera.fov = camera.fov;
  viewCamera.updateProjectionMatrix();
}

const boomDir = new THREE.Vector3();
const boomProbe = new THREE.Vector3();

/**
 * Place the third-person render camera on a boom out of the player's eye.
 * BACK keeps the player's own orientation (the boom trails behind); FRONT
 * spins it 180° and mirrors the pitch so the camera looks back at your face.
 * Either way the boom is pulled in short of the first solid block, so the
 * view never ends up inside terrain.
 */
function updateViewCamera(): void {
  const front = view === View.Front;
  const eye = player.eyePosition;
  viewCamera.fov = camera.fov;
  viewCamera.rotation.set(
    front ? -player.pitch : player.pitch,
    front ? player.yaw + Math.PI : player.yaw,
    0
  );
  viewCamera.updateProjectionMatrix();
  // The boom runs straight backwards out of the camera's own facing.
  boomDir.set(0, 0, 1).applyQuaternion(viewCamera.quaternion);
  let dist = VIEW_DIST;
  for (let d = 0.4; d <= VIEW_DIST; d += 0.25) {
    boomProbe.copy(eye).addScaledVector(boomDir, d);
    if (isSolid(world.getBlock(
      Math.floor(boomProbe.x), Math.floor(boomProbe.y), Math.floor(boomProbe.z)
    ))) { dist = Math.max(0.6, d - 0.35); break; }
  }
  viewCamera.position.copy(eye).addScaledVector(boomDir, dist);
}

/** V: cycle first person → third-person back → third-person front. */
function cycleView(): void {
  view = ((view + 1) % 3) as View;
  showNotice(`🎥 ${VIEW_NAMES[view]}`);
  if (view === View.First) hideSelfAvatar();
}

// ── The local player's own avatar (only rendered in the third-person views) ──
// Built from the same builder everyone else's body comes from, so you see
// exactly what other players see: your cosmetics, faction shirt, worn armor
// and the item in your hand.
let selfBody: AvatarBody | null = null;
let selfArmorKey = '';
let selfArmorMeshes: THREE.Mesh[] = [];
let selfHeldId = 0;
let selfHeldMesh: THREE.Mesh | null = null;
let selfWalkPhase = 0;
const selfItemMat = new THREE.MeshBasicMaterial({
  map: atlas.texture, alphaTest: 0.4, vertexColors: true, side: THREE.DoubleSide,
});

function hideSelfAvatar(): void {
  if (selfBody) selfBody.group.visible = false;
}

/** Drop the avatar so the next third-person frame rebuilds it (cosmetics or
 *  faction changed). */
function invalidateSelfAvatar(): void {
  if (!selfBody) return;
  // The held mesh uses the shared itemGeometry cache — detach, never dispose.
  if (selfHeldMesh) { selfHeldMesh.parent?.remove(selfHeldMesh); selfHeldMesh = null; }
  for (const m of selfArmorMeshes) { m.parent?.remove(m); m.geometry.dispose(); }
  selfArmorMeshes = [];
  selfArmorKey = ''; selfHeldId = 0;
  scene.remove(selfBody.group);
  disposeAvatarBody(selfBody);
  selfBody = null;
}

/** Pose the local avatar for this frame (third person only). */
function updateSelfAvatar(dt: number): void {
  if (view === View.First || player.dead || localMode === 'spectator') {
    hideSelfAvatar();
    return;
  }
  if (!selfBody) {
    selfBody = buildAvatarBody({ ...myCosmetics },
      isFaction(localFaction) ? new THREE.Color(factionColor(localFaction)) : undefined);
    scene.add(selfBody.group);
  }
  const b = selfBody;
  b.group.visible = true;
  b.group.position.set(player.pos.x, player.pos.y, player.pos.z);
  b.group.rotation.y = player.yaw;

  // Held item + worn armor, kept in step with the inventory.
  const heldId = inventory.selectedStack?.id ?? 0;
  if (heldId !== selfHeldId) {
    selfHeldId = heldId;
    if (selfHeldMesh) { selfHeldMesh.parent?.remove(selfHeldMesh); selfHeldMesh = null; }
    if (heldId > 0 && ITEMS[heldId]) {
      const mesh = new THREE.Mesh(itemGeometry(atlas, heldId), selfItemMat);
      mesh.position.set(0, -0.68, -0.2);
      mesh.rotation.set(-0.5, 0, 0);
      mesh.scale.setScalar(ITEMS[heldId].kind === 'block' ? 1.5 : 1.1);
      b.parts[3].add(mesh); // right hand
      selfHeldMesh = mesh;
    }
  }
  const armorIds = inventory.wornArmor().map((s) => s?.id ?? 0);
  const key = armorIds.join(',');
  if (key !== selfArmorKey) {
    selfArmorKey = key;
    for (const m of selfArmorMeshes) { m.parent?.remove(m); m.geometry.dispose(); }
    selfArmorMeshes = buildArmorOverlay(b, armorIds);
  }

  // Pose: the same glide/boat/stride poses the remote avatars use.
  if (player.boating) {
    b.group.rotation.x = 0; b.head.rotation.x = 0;
    b.parts[0].rotation.x = 1.35; b.parts[1].rotation.x = 1.35;
    b.parts[2].rotation.x = 0.55; b.parts[3].rotation.x = 0.55;
    if (b.cape) b.cape.rotation.x = -0.25;
  } else if (player.gliding) {
    b.group.rotation.x = 1.05;
    b.parts[0].rotation.x = 0.2; b.parts[1].rotation.x = 0.2;
    b.parts[2].rotation.x = 1.2; b.parts[3].rotation.x = 1.2;
    b.head.rotation.x = -0.9;
    if (b.cape) b.cape.rotation.x = -1.1;
  } else {
    b.group.rotation.x = 0;
    b.head.rotation.x = player.pitch; // your head actually looks where you look
    const hspeed = Math.hypot(player.vel.x, player.vel.z);
    selfWalkPhase += Math.min(hspeed, 7) * dt * 2.4;
    const amp = Math.sin(selfWalkPhase) * Math.min(1, hspeed / 4.5) * 0.8;
    b.parts[0].rotation.x = amp;
    b.parts[1].rotation.x = -amp;
    b.parts[2].rotation.x = -amp;
    b.parts[3].rotation.x = amp - (selfHeldId > 0 ? 0.45 : 0);
    if (b.cape) {
      const billow = Math.min(1, hspeed / 5) * 0.55;
      b.cape.rotation.x = -0.12 - billow - Math.sin(selfWalkPhase * 0.5) * 0.06;
    }
  }
}

function updateAtmosphere(): void {
  world.sunUniform.value = sky.sunIntensity;
  const fog = scene.fog as THREE.Fog;
  if (player.eyeUnderwater) {
    fog.color.copy(WATER_FOG_COLOR).multiplyScalar(0.3 + 0.7 * sky.sunIntensity);
    fog.near = 0;
    fog.far = 24;
  } else if (curVault) {
    const familyFog = {
      crypt: 0x514865, mire: 0x315e55, ember: 0x744432,
      crystal: 0x365f82, gilded: 0x6b5934,
    }[curVault.family];
    fog.color.setHex(familyFog);
    fog.near = 5;
    fog.far = Math.min(92, FOG_FAR);
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
    input.unlock();
  }
}

function toggleInventory(): void {
  if (player.dead) return;
  if (invUI.open) {
    invUI.hide();
    input.lock();
  } else if (input.locked) {
    invUI.show('inventory');
    input.unlock();
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

// --- Seasons (Phase 5) -------------------------------------------------------
// (The old top-centre season HUD line was removed; only the ★ badge remains.)

/** mm:ss (or h:mm:ss) clock for the war timer. */
function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** The live war border side length (full world outside a war). */
function currentWarBorder(): number {
  return warActiveNow ? warBorderAt(warLeft, warDur, WORLD_BORDER) : WORLD_BORDER;
}

/** The war clock: countdown + live border size + the kill score. Only visible
 *  DURING a war — peacetime keeps the top of the screen clean (the old
 *  "Peacetime" / "Next war in…" lines were cut as clutter). */
function updateWarHud(dt: number): void {
  // Count down locally between the server's periodic broadcasts.
  if (warActiveNow) warLeft = Math.max(0, warLeft - dt);
  else if (warNextIn > 0) warNextIn = Math.max(0, warNextIn - dt);
  if (!net.connected || !warActiveNow) { warEl.style.display = 'none'; return; }
  warEl.style.display = 'block';
  const a = FACTIONS[0], b = FACTIONS[1];
  const border = Math.round(currentWarBorder());
  const shrinking = border > WAR_MIN_BORDER;
  warEl.innerHTML =
    `<span style="color:#ff6a6a">⚔️ WAR · ${formatClock(warLeft)}</span> ` +
    `<span style="color:${shrinking ? '#ffb86a' : '#ff5a5a'}">· border ${border}m${shrinking ? ' ⤵' : ' — FINAL RING'}</span><br>` +
    `<span style="color:${factionCss(a.id)}">${a.name} ${warScore[a.id] ?? 0}</span>` +
    ` <span style="color:#8da0c0">kills</span> ` +
    `<span style="color:${factionCss(b.id)}">${warScore[b.id] ?? 0} ${b.name}</span>`;
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

// Personal respawn point set via a Respawn Beacon (offline; online the server
// tracks it). Cleared if the beacon block is gone when we try to use it.
let localSpawn: { x: number; y: number; z: number } | null = null;

/** Drop the (offline) player at their Respawn Beacon if it still stands, else a
 *  fresh dry Heartland spawn. Mirrors the server's spawn rules. */
function spawnInOwnTerritory(): void {
  if (net.connected) return; // online: the server places us
  if (localSpawn && world.getBlock(localSpawn.x, localSpawn.y, localSpawn.z) === Block.RespawnBeacon) {
    player.pos.set(localSpawn.x + 0.5, localSpawn.y + 1, localSpawn.z + 0.5);
    player.vel.set(0, 0, 0);
    return;
  }
  localSpawn = null; // beacon gone — forget the stale point
  const s = world.terrain.randomDrySpawn(Math.random, CORE_HALF);
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
      // A planted timed bomb: stick it on the aimed block, big blast after the
      // fuse. The blast itself routes through the same paths as a grenade.
      const t = interaction.target;
      if (!t) { showNotice('Aim at a block to plant C4.'); return; }
      gadgetCd.use(def.item, worldTimeLocal); consume();
      const bx = t.x + 0.5, by = t.y + 0.5, bz = t.z + 0.5;
      const blastR = def.radius ?? 5, item = def.item;
      showNotice(`💣 C4 planted — ${def.fuse ?? 3}s. RUN!`);
      window.setTimeout(() => {
        if (net.connected) net.sendGadgetUse(item, bx, by, bz);
        gadgetFxAt('frag', bx, by, bz);
        mobs.explode(new THREE.Vector3(bx, by, bz), player);
        if (!net.connected) destroyMachinesNear(new THREE.Vector3(bx, by, bz), blastR);
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

// --- Holding traps: bear trap, tar, barbed wire -----------------------------
// The rule these follow: a trap must be ESCAPABLE but never free. A bear trap
// costs you a fixed number of frantic jumps (and everyone nearby hears it);
// tar costs you your speed and your jump; barbed wire costs speed and blood.

/** Jumps needed to prise a bear trap open. */
const BEAR_TRAP_STRUGGLES = 6;
/** Hard ceiling on how long the jaws can hold you, however badly you struggle. */
const BEAR_TRAP_MAX_SECONDS = 7;

let trapStruggles = 0;      // jumps banked toward getting free
let trapPinLeft = 0;        // seconds left on the current pin
let prevJumpForTrap = false;
let wireHurtTimer = 0;
const trapHudEl = document.createElement('div');
trapHudEl.className = 'mc-font';
trapHudEl.style.cssText =
  'position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);z-index:23;' +
  'display:none;padding:10px 20px;border-radius:8px;font-size:17px;color:#fff;' +
  'background:rgba(60,10,10,0.8);border:2px solid #ff6a3d;text-align:center;';
app.appendChild(trapHudEl);

/** Which holding trap the player is standing in (Air if none). */
function trapUnderfoot(): number {
  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  const feet = world.getBlock(bx, Math.floor(player.pos.y + 0.1), bz);
  if (feet === Block.Tar || feet === Block.BarbedWire) return feet;
  const under = world.getBlock(bx, Math.floor(player.pos.y - 0.05), bz);
  if (under === Block.BearTrap || under === Block.Tar) return under;
  return Block.Air;
}

function updateTrapGrip(dt: number): void {
  wireHurtTimer = Math.max(0, wireHurtTimer - dt);
  player.pinned = false;
  player.trapSlow = 1;
  player.trapNoJump = false;
  if (player.dead || localMode !== 'survival' || player.noclip) {
    trapPinLeft = 0; trapHudEl.style.display = 'none';
    return;
  }

  const trap = trapUnderfoot();

  // Bear trap: the jaws snap shut the moment you step on them.
  if (trap === Block.BearTrap && trapPinLeft <= 0 && trapStruggles === 0) {
    trapPinLeft = BEAR_TRAP_MAX_SECONDS;
    trapStruggles = 0;
    player.damage(2);
    audio.hurt();
    showNotice('🪤 A bear trap snapped shut on your leg!');
  }

  if (trapPinLeft > 0) {
    trapPinLeft = Math.max(0, trapPinLeft - dt);
    player.pinned = true;
    player.trapNoJump = true;
    // Struggle out: each fresh jump press prises the jaws a little wider.
    const jumpNow = input.jump;
    if (jumpNow && !prevJumpForTrap) trapStruggles++;
    prevJumpForTrap = jumpNow;
    const left = Math.max(0, BEAR_TRAP_STRUGGLES - trapStruggles);
    if (left <= 0 || trapPinLeft <= 0) {
      trapPinLeft = 0; trapStruggles = 0;
      trapHudEl.style.display = 'none';
      showNotice('🪤 You wrenched the trap open!');
    } else {
      trapHudEl.innerHTML =
        `🪤 <b>CAUGHT IN A BEAR TRAP</b><br>Mash <b>JUMP</b> to break free — ${left} more`;
      trapHudEl.style.display = 'block';
    }
    return;
  }
  trapStruggles = 0;
  prevJumpForTrap = input.jump;
  trapHudEl.style.display = 'none';

  // Tar: a crawl, and no jumping out of the pit.
  if (trap === Block.Tar) {
    player.trapSlow = 0.32;
    player.trapNoJump = true;
    return;
  }
  // Barbed wire: slow AND bleeding while you push through it.
  if (trap === Block.BarbedWire) {
    player.trapSlow = 0.45;
    if (wireHurtTimer <= 0) {
      wireHurtTimer = 0.8;
      player.damage(2);
    }
  }
}

// --- CAPTURE THE FLAG (client side) -----------------------------------------
// Everything here is presentation + intent: the server owns the rules, decides
// which flag a swing lands on, and broadcasts every change.

const flagHudEl = document.createElement('div');
flagHudEl.className = 'mc-font';
flagHudEl.style.cssText =
  'position:absolute;top:96px;left:50%;transform:translateX(-50%);z-index:22;' +
  'display:none;padding:7px 16px;border-radius:8px;font-size:14px;color:#fff;' +
  'background:rgba(10,12,20,0.72);border:2px solid #7a5cff;text-align:center;';
app.appendChild(flagHudEl);

function showFlagHud(html: string, border: string): void {
  flagHudEl.innerHTML = html;
  flagHudEl.style.borderColor = border;
  flagHudEl.style.display = 'block';
}

/**
 * Swing at the flag pad you're standing on. Returns true when the flag layer
 * has claimed this frame's left-click (so mining stays suppressed).
 * Also drives the on-screen prompt: what to hit, how far along you are, and
 * where to run once you've got it.
 */
function flagSwingUpdate(dt: number, leftDown: boolean): boolean {
  flagHitTimer = Math.max(0, flagHitTimer - dt);
  if (!net.connected) { flagHudEl.style.display = 'none'; return false; }

  const px = player.pos.x, pz = player.pos.z;
  const mine = flagModels.carriedBy(net.myId ?? -1);
  if (mine) {
    // You're running a flag: point the way home and score on arrival (the
    // server does the actual capture check off your transform).
    const d = flagModels.distanceToOwnPad(localFaction, px, pz);
    showFlagHud(
      `🚩 <b>You are carrying the ${factionName(mine.faction)} flag!</b><br>` +
      `Run it to your own flag — <b>${Math.round(d)}m</b> away. Die and it goes home.`,
      factionCss(mine.faction));
    return false; // carrying doesn't consume clicks — you still need to fight
  }

  const target = flagModels.plantedInReach(localFaction, px, pz, FLAG_REACH);
  if (!target) { flagHudEl.style.display = 'none'; return false; }

  if (!flagState.breakable) {
    showFlagHud(
      `🛡 The ${factionName(target.faction)} flag is <b>protected</b> — it can't be taken right now.`,
      '#7a8090');
    return false;
  }
  const pct = Math.round(100 - (target.hp / FLAG_MAX_HP) * 100);
  showFlagHud(
    `🚩 <b>Hold left-click</b> to prise the ${factionName(target.faction)} flag loose — ${pct}%`,
    factionCss(target.faction));
  if (!leftDown || player.dead) return true;
  if (flagHitTimer <= 0) {
    flagHitTimer = 0.25;
    net.sendFlagHit();
    held.swing();
  }
  return true;
}

net.onFlags = (breakable, flags) => {
  flagState = { breakable, flags: flags.map((f) => ({ ...f })) };
  flagModels.setState(breakable, flagState.flags as Flag[]);
  const flagless = !flagState.flags.some((f) => f.holder === localFaction);
  if (flagless !== myFactionFlagless) {
    myFactionFlagless = flagless;
    refreshNetInfo();
  }
};

net.onFlagEvent = (kind, faction, by, holder) => {
  const who = by || 'Someone';
  if (kind === 'taken') {
    const mineNow = faction === localFaction;
    showRegionBanner(
      mineNow ? `🚩 ${who} IS STEALING YOUR FLAG — STOP THEM!`
              : `🚩 ${who} took the ${factionName(faction)} flag!`,
      factionCss(faction));
    audio.heartSteal();
  } else if (kind === 'returned') {
    showNotice(`🚩 The ${factionName(faction)} flag is back home.`);
  } else {
    const lost = faction === localFaction;
    showRegionBanner(
      lost ? `💀 YOUR FLAG IS GONE — deaths are now PERMANENT until you take it back!`
           : `🏴 ${factionName(holder)} captured the ${factionName(faction)} flag!`,
      factionCss(holder));
  }
};

/** Update flag poles/banners; resolves carriers to their live positions. */
function updateFlagVisuals(dt: number): void {
  if (!net.connected) return;
  flagModels.setWarActive(warActiveNow);
  flagModels.update(dt, camera, flagCarrierPos);
  updateFlagMarkers();
}

/** Where a flag carrier is right now (me or a synced remote), or null. */
function flagCarrierPos(pid: number): THREE.Vector3 | null {
  if (pid === net.myId) return player.pos.clone();
  const r = net.remotes.get(pid);
  return r ? new THREE.Vector3(r.tx, r.ty, r.tz) : null;
}

// The map/beacon markers are rebuilt only when something actually moved —
// setDynamicMarkers redraws the whole map canvas, and a carrier running across
// the world would otherwise redraw it every single frame.
let lastFlagMarkerKey = '';

/**
 * Put every flag on the world map (and, for free, on the floating in-world
 * beacon badges): planted flags sit on their pad, a stolen one rides with its
 * carrier so the whole server can watch the chase. Each marker is coloured by
 * the flag it IS, and says who's holding it.
 */
function updateFlagMarkers(): void {
  const markers: { x: number; z: number; color: number; name: string }[] = [];
  // Flags remain physical monuments during peace, but their exact location is
  // strategic information. Map, edge badge and sky-beam wayfinding begin with
  // the war and disappear again the moment it ends.
  if (!warActiveNow) {
    if (lastFlagMarkerKey !== '') {
      lastFlagMarkerKey = '';
      worldMap.setDynamicMarkers([]);
    }
    return;
  }
  for (const f of flagState.flags) {
    const owner = factionName(f.faction);
    if (f.carrier >= 0) {
      const pos = flagCarrierPos(f.carrier);
      if (!pos) continue; // carrier out of sync range — no marker to place
      const who = f.carrier === net.myId
        ? 'YOU'
        : net.remotes.get(f.carrier)?.info.username ?? 'a raider';
      markers.push({
        x: Math.round(pos.x), z: Math.round(pos.z),
        color: factionColor(f.faction),
        name: `🚩 ${owner} flag — ${who}`,
      });
      continue;
    }
    const home = flagPosition(f);
    const stolen = f.holder !== f.faction;
    markers.push({
      x: home.x, z: home.z,
      color: factionColor(f.faction),
      name: stolen
        ? `🏴 ${owner} flag — held by ${factionName(f.holder)}`
        : `🚩 ${owner} flag`,
    });
  }
  const key = markers.map((m) => `${m.x},${m.z},${m.color},${m.name}`).join('|');
  if (key === lastFlagMarkerKey) return;
  lastFlagMarkerKey = key;
  worldMap.setDynamicMarkers(markers);
}

/** Reposition the closing war ring + reconcile the everybody-glows halos. */
function updateWarVisuals(): void {
  const active = net.connected && warActiveNow;
  warWallGroup.visible = active;
  if (active) {
    const half = currentWarBorder() / 2;
    const size = half * 2;
    const y = 120;
    warWalls[0].position.set(0, y, -half);
    warWalls[1].position.set(0, y, half);
    warWalls[2].position.set(-half, y, 0);
    warWalls[3].position.set(half, y, 0);
    for (const w of warWalls) w.scale.x = size;
    // Pulse the ring so it reads as dangerous.
    warWallMat.opacity = 0.32 + 0.12 * Math.abs(Math.sin(worldTimeLocal * 2.2));
  }
  // Faction-colored halos over every living remote player while the war is on.
  const live = new Set<number>();
  if (active) {
    for (const [id, r] of net.remotes) {
      if (r.dead || r.info.mode === 'spectator') continue;
      live.add(id);
      let sp = glowSprites.get(id);
      if (!sp) {
        sp = new THREE.Sprite(warGlowMaterial(r.info.faction));
        sp.scale.setScalar(2.6);
        sp.renderOrder = 50;
        glowGroup.add(sp);
        glowSprites.set(id, sp);
      }
      (sp.material as THREE.SpriteMaterial).color.setHex(factionColor(r.info.faction));
      sp.position.set(r.tx, r.ty + 1.1, r.tz);
    }
  }
  for (const [id, sp] of glowSprites) {
    if (!live.has(id)) {
      glowGroup.remove(sp);
      sp.material.dispose();
      glowSprites.delete(id);
    }
  }

  // Everyone glows means everyone: in third person you see your own halo too,
  // exactly as the rest of the server sees you.
  const showSelf = active && view !== View.First && !player.dead &&
    localMode !== 'spectator';
  if (showSelf && !selfGlow) {
    selfGlow = new THREE.Sprite(warGlowMaterial(localFaction));
    selfGlow.scale.setScalar(2.6);
    selfGlow.renderOrder = 50;
    glowGroup.add(selfGlow);
  }
  if (selfGlow) {
    selfGlow.visible = showSelf;
    if (showSelf) {
      (selfGlow.material as THREE.SpriteMaterial).color.setHex(factionColor(localFaction));
      selfGlow.position.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
    }
  }
}
let selfGlow: THREE.Sprite | null = null;

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
  Block.Turret, Item.Cannonball,
]);
function guideCategory(id: number): string {
  if (gadgetOf(id)) return 'Gadgets & Toys';
  if (COMBAT_IDS.has(id)) return 'Combat';
  if (WAR_IDS.has(id)) return 'War & Factions';
  if (id === Block.Autominer || id === Block.OilDerrick) return 'Automation';
  const info = ITEMS[id];
  if (info?.tool || info?.armor || info?.glider || info?.heal) return 'Tools, Armor & Travel';
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
    touch?.update({ shown: false, playing: false, gun: false });
    input.endFrame();
    return;
  }

  if (input.inventoryToggled) toggleInventory();
  if (input.mapToggled) toggleMap();
  if (input.progressPressed) toggleProgress();
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

  // Advance cinematics before control/camera decisions so their final frame and
  // UI restoration happen atomically.
  vaultCinematic.update(dt);

  // Direct control only while actively playing (pointer locked, no UI, alive).
  const controlling = input.locked && !player.dead && !invUI.open && !vaultCinematic.playing;

  // Keep worn-armor mitigation current before any damage can land this frame:
  // offline the player mitigates locally; in MP the server mitigates from this
  // synced value (clamped server-side). Progression bonuses (Toughness ranks +
  // the faction perk) ride on top of worn gear; speed applies to movement.
  const buffsNow = activeBuffs();
  player.speedMult = buffsNow.speedMult;
  player.energyDrainMult = buffsNow.energyMult;   // Windrunner capstones
  player.fallDamageMult = buffsNow.fallMult;      // Juggernaut capstones
  interaction.miningSpeedMult = buffsNow.mineMult; // Prospector + Rune of Fortune
  const armorPts = inventory.armorPoints() + buffsNow.armorBonus;
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
      if (input.waypointPressed) {
        // B: drop a named waypoint right here (shows on the map + in-world,
        // with the altitude so you can find your way back to a cave/tower).
        const name = worldMap.addWaypointAt(player.pos.x, player.pos.y, player.pos.z);
        showNotice(`📍 Waypoint "${name}" set — ` +
          `${Math.round(player.pos.x)}, Y${Math.round(player.pos.y)}, ${Math.round(player.pos.z)}`);
      }
      if (input.guideToggled) toggleGuidePanel();
      if (input.viewPressed) cycleView();
      if (input.tpaPressed) openTpaPrompt();
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
    // World border: keep the player inside the play area (the server clamps
    // authoritatively too). During a war this is the CLOSING red ring.
    const clampHalf = net.connected && warActiveNow ? currentWarBorder() / 2 : WORLD_HALF;
    player.pos.x = Math.max(-clampHalf, Math.min(clampHalf, player.pos.x));
    player.pos.z = Math.max(-clampHalf, Math.min(clampHalf, player.pos.z));

    // Gun aim-down-sights: hold right-click with a gun to zoom (per-gun amount).
    {
      const hs = inventory.selectedStack;
      const g = hs ? ITEMS[hs.id]?.gun : undefined;
      const aiming = controlling && localMode !== 'spectator' &&
        !!g?.zoom && input.rightDown;
      aimZoom = aiming ? g!.zoom! : 1;
    }
    updateCamera();
    updateVaultCinematicCamera();
    updateEncounterShake(dt);

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

      // FLAGS come first: standing at an enemy flag pad, left-click is a swing
      // at the pole (never a mine), because that's the only thing you could
      // possibly mean to be doing there.
      if (flagSwingUpdate(dt, input.leftDown)) {
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (heldGadget) {
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
          heldStack.id === Item.Boat) {
        // Boat: right-click open water to launch and ride it.
        tryLaunchBoat();
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (input.rightClicked && !interaction.armedMove && heldStack &&
          (heldStack.id === Item.VaultCompass1 || heldStack.id === Item.VaultCompass2 ||
           heldStack.id === Item.VaultCompass3)) {
        // Vault compass: one use — mark the nearest vault of its tier.
        useVaultCompass(heldStack.id);
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (input.rightClicked && !interaction.armedMove && heldStack &&
          ITEMS[heldStack.id]?.heal) {
        // Healing consumables (Bandage/Medkit): a burst of fast regeneration.
        useHealItem();
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (input.rightClicked && !interaction.armedMove && heldStack &&
          isRune(heldStack.id)) {
        // Socket a held rune into the first worn armor piece with a free slot.
        const runeId = heldStack.id;
        const target = inventory.socketRune(runeId);
        if (target) {
          inventory.consumeSelected(1);
          showNotice(`✨ ${runeOf(runeId)?.name} socketed into your ${ITEMS[target.id]?.name}!`);
          audio.heartSteal();
          pushStateSave();
        } else {
          showNotice('No worn armor with a free rune slot — equip armor first (one rune per piece).');
        }
        interaction.update(dt, input, camera, true, true); // suppress mine + use
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
        // Melee never hits players — PvP is guns-only. Left-click fights
        // MOBS, otherwise mines the block. Priority: mob > mine.
        const encounterInSights = vaultEncounterVisuals.rayTarget(
          encounterSnapshot, eye, lookDir, 3.5,
        );
        const mobInSights = encounterInSights ? null : mobs.rayHit(eye, lookDir, 3.5);
        if (input.leftClicked && encounterInSights) {
          const tool = heldStack ? ITEMS[heldStack.id]?.tool : undefined;
          hitEncounterTarget(encounterInSights.id, encounterInSights.hit,
            (tool?.damage ?? 1) + activeBuffs().meleeBonus, 'melee');
          if (tool) inventory.damageSelected(2);
          held.swing();
        } else if (input.leftClicked && mobInSights) {
          const tool = heldStack ? ITEMS[heldStack.id]?.tool : undefined;
          // Prospector/Slayer nodes add flat melee damage (mobs only).
          mobs.attack(eye, lookDir, (tool?.damage ?? 1) + activeBuffs().meleeBonus, player);
          if (tool) inventory.damageSelected(2);
          held.swing();
        }
        interaction.update(dt, input, camera,
          encounterInSights !== null || mobInSights !== null);
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
    net.sendXform(dt, player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch,
      player.gliding, player.boating,
      inventory.selectedStack?.id ?? 0,                 // held item on the avatar
      inventory.wornArmor().map((s) => s?.id ?? 0));    // worn armor plating

    // Simulation never pauses: mobs hunt you and survival ticks in menus too.
    survival.update(dt, player);
    mobs.update(dt, player, sky.sunIntensity);
    updateVaults(dt); // dungeons: bounds/banner, guard anchors, the Brute, sparkle
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
    // Boat upkeep: hull follows the player; jump hops out; beaching dismounts.
    if (boatActive) {
      if (player.dead || player.flying) exitBoat(false);
      else {
        const jumpNow = controlling && input.jump;
        if (jumpNow && !prevBoatJump) exitBoat();
        prevBoatJump = jumpNow;
        if (boatActive) {
          if (player.onGround) {
            boatGroundTime += dt;
            if (boatGroundTime > 0.6) { exitBoat(); showNotice('You ran aground.'); }
          } else boatGroundTime = 0;
          boatGroup.position.copy(player.pos);
          boatGroup.rotation.y = player.yaw;
        }
      }
    } else prevBoatJump = false;
    // Traps: spikes prick anyone standing on them; a landmine detonates; the
    // holding traps (bear trap / tar / barbed wire) grab you where you stand.
    spikeHurtTimer = Math.max(0, spikeHurtTimer - dt);
    updateTrapGrip(dt);
    if (!player.dead && localMode === 'survival' && !player.noclip) {
      const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
      const by = Math.floor(player.pos.y - 0.05);
      const under = world.getBlock(bx, by, bz);
      if (under === Block.SpikeTrap && player.onGround && spikeHurtTimer <= 0) {
        // Spikes bite harder now — a spike moat is meant to hurt.
        player.damage(3);
        spikeHurtTimer = 0.55;
      } else if (under === Block.Landmine) {
        triggerLandmine(bx, by, bz);
      }
    }
    // Machines run under the same never-pausing sim. Offline this is the
    // authoritative tick; in multiplayer it's a local prediction for the fill
    // bar (the server is authoritative and reconciles on open/collect).
    machines.update(dt);
    machineModels.update(dt); // animate drills/pumpjacks
    turretModels.update(dt);
    updateWarHud(dt);     // war clock + border + kill score (MP only, war only)
    updateGuide(dt, controlling); // getting-started checklist + vault compass
    updateTpa(dt, controlling);   // TPA accept hold + incoming-request banner
    updateWarVisuals();   // the closing red ring + everybody-glows halos
    updateFlagVisuals(dt); // flag poles, beacons + the carrier's banner
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
    worldTimeLocal += dt;
  }

  checkDeath();
  furnaces.update(dt);

  // Past this point we're always in-game (title returns early above).
  // First person renders through the eye camera itself; the third-person
  // views render through the boom camera (aiming still uses `camera`).
  const activeCamera: THREE.Camera = view === View.First ? camera : viewCamera;
  updateSelfAvatar(dt);

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
  held.setItem(controlling && view === View.First
    ? inventory.selectedStack?.id ?? null : null);
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
  updateProgressFlash(); // gold pulse while skill points wait to be spent
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

  // Touch overlay visibility: pads only while actively controlling; the
  // utility row stays up so the inventory/map buttons can also close them.
  if (touch) {
    const hs = inventory.selectedStack;
    touch.update({
      shown: screen === 'playing' && !player.dead,
      playing: input.locked && screen === 'playing' && !player.dead &&
        !invUI.open && !worldMap.open,
      gun: !!(hs && ITEMS[hs.id]?.gun),
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
