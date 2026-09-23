import './prestige_ui.css';
import './arena_3d.css';
import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS, isReplaceable, isSolid, isVaultMasonry } from './blocks';
import { ArenaKind } from './arena';
import { Furnaces } from './furnace';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { TouchControls, isTouchDevice } from './touch';
import { Interaction, raycastBlocks } from './interact';
import { Inventory } from './inventory';
import { InventoryUI, MachineUIContext, TurretUIContext } from './inventory_ui';
import { dropFor, gunVolley, GunInfo, Item, ItemStack, ITEMS } from './items';
import { RECIPES, Recipe, WARFARE_BLUEPRINTS, setBlueprintCheck } from './crafting';
import { renderItemIcon } from './icons';
import { iconSvg, iconifyHtml, setIconText, type IconName } from './emoji_icons';
import { itemDescription } from './itemdesc';
import {
  Machines, MachineType, MachineEvents, MachineState, applyUpgrade, claimMachine,
  collectMachine, currentRate, machineHeight, machineTypeForBlock,
  sanitizeState, setFilter, upgradeCost, machineRank, applyMachineAct, actCost,
  relocateMachine, igniteWell, machineCanClaim, depositInto, HOPPER_SIDES, totalStored,
} from './machines';
import { ItemEntities, itemGeometry } from './itementity';
import { createGunModel, gunFeel, isGunItem, poseGunModel } from './gunmodels';
import { createGadgetModel, isModeledGadget, poseGadgetModel } from './gadgetmodels';
import { ChatBox } from './chat';
import { Chests } from './chests';
import { Mob, Mobs } from './mobs';
import { NetClient } from './net/client';
import {
  WORLD_SEED, WORLD_HALF, WORLD_BORDER, CORE_HALF, RELOCATE_RANGE, makeUsername, skinSeed,
  GameMode, MAX_ATTUNED, RANGED_MAX_DAMAGE, TOTEM_COOLDOWN, TOTEM_WINDUP, COMBAT_TAG,
  TPA_HOLD, TPA_EXPIRE, type DuelLeaderboardEntry, type PlayerCounts,
  type FactionPublic,
} from './net/protocol';
import {
  TrapField, TrapTarget, TrapTickResult, TrapKind, TrapFxWhat, TRAP_NAMES, TRAP_VERBS, isTrapBlock,
  trapKindForBlock, trapFriendly, ownerHostile, trapConcealed, sanitizeTrap, solidFrom, CHANNELS,
  CHANNEL_COLORS, CHANNEL_NAMES, TIMER_INTERVALS, FLAME_FUEL_CAP, FLAME_BURSTS_PER_BARREL,
} from './traps';
import { TrapModels, TRAP_MODEL_BLOCKS } from './trapmodels';
import { meshHooks } from './mesher';
import { StatusEffects, EFFECT_LABELS, EFFECT_COLORS } from './effects';
import { falloffDamage } from './gadgets';
import { MachineModels } from './machinemodels';
import { NetItems } from './netitems';
import { Particles } from './particles';
import { AmbientWorld } from './ambient_world';
import { BIOME_NAMES, BIOME_SOUND } from './biomes';
import { Projectiles } from './projectiles';
import { Player, MAX_AIR } from './player';
import {
  TurretState, TurretAxis, applyTurretUpgrade, claimTurret, damageTurret,
  newTurret, sanitizeTurretState, turretLoad, turretUpgradeCost, TURRET_AMMO_CAP,
  TURRET_FUEL_CAP, TURRET_MUZZLE_Y, turretCanClaim, turretDisabled, turretFriendly,
} from './turrets';
import { TurretModels } from './turretmodels';
import { TurretDefense } from './turret_defense';
import {
  RemotePlayers, SEAT_SINK, anchorTiltedBody, applyAvatarSneak, buildAvatarBody,
  buildArmorOverlay, disposeAvatarBody, stridePose, AvatarBody,
} from './remoteplayers';
import {
  GliderRig, RIG_HARNESS_Y, buildGliderRig, glidePose, poseGliderRig,
} from './glidermodels';
import { Cosmetics, defaultCosmetics, sanitizeCosmetics } from './character';
import {
  type Wardrobe, emptyWardrobe, equipCape, sanitizeWardrobe,
} from './capes';
import { createWardrobe } from './wardrobe_ui';
import { WorldMap } from './worldmap';
import { Accounts, Account } from './net/accounts';
import {
  FACTIONS, NO_FACTION, factionColor, factionName, isFaction, otherFaction,
} from './teams';
import { warBorderAt, clampInsideBorder, WAR_MIN_BORDER } from './war';
import { Flag, FLAG_REACH, FLAG_MAX_HP, newFlags, flagPosition } from './flags';
import { FlagModels } from './flagmodels';
import { FactionPicker, type PledgeData } from './faction_picker';
import {
  WarfareProgress, buyWarfareNode, grantWarfareXp, migrateWarfare, newWarfare,
  sanitizeWarfare, settleWarfareXp, warfareAvailable, warfareOwns, warfareTier,
  ContributionRecord, helicopterStats, tierLabel, blastAt, blastBlockCandidates,
} from './warfare';
import { WarfareUI } from './warfare_ui';
import {
  FAST_ROPE_SLIDE_MAX, FAST_ROPE_SLIDE_SPEED, helicopterGunDamage, helicopterRayDistance,
  HELI_FUEL_BURN, HELI_FUEL_IDLE, HELI_GROUND_CLEARANCE, HeliLossReason,
  HelicopterSnapshot, PASSENGER_ARC, SeatKind, VehicleSim, VehicleEvent,
  bombBlast, fastRopeHeld, fastRopeProgressDelta, fastRopeSlideSpeed, viewYawToHeliYaw,
} from './vehicles';
import { VehicleHUD } from './vehiclehud';
import { VehicleModels } from './vehiclemodels';
import {
  DUEL_ROUND_MS, DUEL_MAX_HEALTH, DUEL_MAX_PILLAR_HEIGHT, DUEL_ARENA_SIZE,
  DUEL_MIN_PLAYERS, DUEL_SCORE_LIMIT, duelEventCopy, duelTerrainElevation,
  type DuelEvent, type DuelEventKind,
  type DuelLobbySnapshot, type DuelParticipant,
  type DuelResult, type DuelArenaBounds, clampToDuelArena,
  duelTokenFromUrl, withDuelToken,
} from './duels';
import {
  PARTY_AMBIENT_LIGHT, PARTY_MAX_HEALTH, PARTY_FLOOR_Y, PARTY_VOID_Y,
  BRIDGE_TEAM_BLOCK, BRIDGE_TEAM_NAME, BRIDGE_GOAL_LIMIT,
  BRIDGE_MELEE_TIER, BRIDGE_BOW_COOLDOWN_MS,
  bridgeGoalGuard, clampToPartySub, registerPartyArena, parkourCourse,
  type PartyLobbySnapshot, type PartyMode, type PartySubBounds,
} from './partygames';
import { PartyUI } from './party_ui';
import { PartyVisuals } from './party_visuals';
import { parkourTheme } from './parkour_themes';
import { parkourBuildBlocked, parkourPadImpulse, parkourPadUnder } from './parkour_mechanics';
import {
  DUEL_DIVISIONS, DUEL_FLAIRS, DUEL_SIGILS, DUEL_SIGIL_SIZE, DUEL_TIER_THEMES,
  DuelProgressChange, DuelPublicProfile,
  type DuelRank, duelProfileOf, duelRankAt, duelRankProgress,
  duelRevealState, newDuelProgress, unlockedDuelFlairs,
} from './duels_progression';
import { AvatarBustBoard, BUST_POSES, type BustEntry } from './avatar_bust';
import {
  DamageNumbers, KillBanner, StreakTracker, hitFlavor, type HitFlavor,
} from './pvp_feedback';

import { GadgetCooldowns, GadgetDef, gadgetOf } from './gadgets';
import {
  GUIDE_STEPS, GuideState, compassGlyph, guideComplete, guideProgress, markGuideStep,
  newGuideState, nextGuideStep, sanitizeGuide,
} from './guide';
import { isRune, runeOf, runeBonuses, runeDefense } from './runes';
import { HealUse } from './healuse';
import { createFieldGuide } from './field_guide';
import {
  MAX_HEARTS, START_HEARTS, WITHDRAW_FLOOR, canConsume, canWithdraw,
  clampHearts, formatRemaining, maxHealthFor,
} from './hearts';
import { DAY_LENGTH, Sky, WATER_FOG_COLOR } from './sky';
import { Survival } from './survival';
import { createAtlas, createCrackTextures } from './textures';
import { World, RENDER_DISTANCE, DEFAULT_RENDER_DISTANCE } from './world';
import { Panorama } from './panorama';
import { PostFX } from './postfx';
import { SunShadow } from './shadows';
import { createHudMods } from './hud_mods';
import type { HudModData } from './hud_mods';
import { structureChestTier } from './structures';
import { chestLootSlots } from './loot';
import {
  VAULT_BOSS_NAMES, VAULT_LOOT_COOLDOWN, VAULT_LOOT_WINDOW, VAULT_RECHARGE,
  VAULT_REVEAL, VaultStamp,
  vaultAt, vaultLoot, vaultStamp, worldVaults,
} from './vaults';
import {
  BOSS_DEFINITIONS, EncounterEvent, EncounterSnapshot, VaultAttackIntent, VaultEncounter,
  ENCOUNTER_VICTORY_CINEMATIC_SECONDS, bossMaxHp, sealContains,
} from './vault_encounter';
import {
  GRAPHICS_PRESETS, MAX_LOOK_SENSITIVITY, MIN_LOOK_SENSITIVITY,
  VaultBossHUD, VaultCinematic, loadAccessibility, saveAccessibility,
} from './vault_presentation';
import type { GraphicsQuality } from './vault_presentation';
import { VaultEncounterVisuals } from './vault_visuals';
import {
  applyHudTheme, createHudSettingsPanel, keyLabel, loadHudSettings, saveHudSettings,
} from './hud_settings';

// Fog is pinned to the live render distance so lowering graphics quality hides
// the shorter view behind fog instead of behind a hard edge of missing chunks.
// Recomputed by applyGraphicsQuality().
let FOG_NEAR = DEFAULT_RENDER_DISTANCE * 16 - 38;
let FOG_FAR = DEFAULT_RENDER_DISTANCE * 16 - 6;
// Only this nearby bubble blocks entry. The old startup path waited for the
// complete 17x17 render area (289 expensive light+mesh jobs) before Play could
// proceed, even though collision only needs the chunks immediately around the
// player. Distant chunks continue streaming in once play starts.
const INITIAL_LOAD_DISTANCE = 2;
const TITLE_WORLD_BUDGET_MS = 12;
const FOV = 70;
const SPRINT_FOV = 80.5;
// Hold-to-zoom (default C), scroll to change the magnification while held —
// the spyglass/"smooth zoom" feel: the FOV eases in and out rather than
// snapping, and the look speed scales with it so a 10x view is still aimable.
const ZOOM_MIN = 1.5;
const ZOOM_MAX = 12;
const ZOOM_DEFAULT = 4;
const ZOOM_STEP = 1.22;   // per wheel notch (multiplicative — even in log terms)
const ZOOM_EASE = 11;     // e-folds per second toward the target magnification

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

// MSAA is on. A voxel world is nothing but hard silhouettes, and every one of
// them crawls a pixel at a time as you walk when the edges are not resolved —
// which is what "the distance doesn't look smooth, it looks like the
// resolution" actually is. Multisampling costs fill rate, not texture memory,
// and it is the only thing that fixes GEOMETRY aliasing; mipmaps cannot.
// TEXTURE aliasing is the other half of that sentence and the opposite is true
// there: MSAA does nothing for it (it samples coverage, not the texture), and
// mipmaps plus anisotropy are the only fix. That is why the atlas is built
// mipmapped (textures.ts) even though the edges are left to MSAA.
// Settings are read here, before the context exists, because `antialias` is a
// context-creation attribute — it cannot be toggled on a live renderer. Render
// distance and pixel ratio DO apply live (applyGraphicsQuality below); only the
// MSAA half of a quality change waits for the next reload.
const accessibility = loadAccessibility();

/** Replace the whole page with a readable explanation. Used when there is no
 *  GPU path at all — a crash-to-black-canvas is the single worst first
 *  impression a browser game can make, and "your browser can't do this" is a
 *  thing the player can actually act on. */
function fatalScreen(heading: string, detail: string): void {
  document.body.innerHTML =
    `<div style="position:fixed;inset:0;display:grid;place-content:center;gap:14px;
      padding:32px;text-align:center;background:#0f1a24;color:#e8eefc;
      font:14px/1.6 ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif">
      <h1 style="font-size:26px;color:#d78a0c;letter-spacing:1px">VOXELON</h1>
      <p style="font-size:17px;font-weight:600">${heading}</p>
      <p style="max-width:46ch;color:#9fb0cc;margin:0 auto">${detail}</p>
    </div>`;
}

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: GRAPHICS_PRESETS[accessibility.graphicsQuality].antialias,
    powerPreference: 'high-performance',
  });
} catch (err) {
  fatalScreen(
    'This browser can\u2019t run VOXELON.',
    'The game needs WebGL, and this browser either doesn\u2019t support it or has it '
    + 'disabled. Try an up-to-date Chrome, Edge, Firefox or Safari, and make sure '
    + 'hardware acceleration is turned on in your browser settings.');
  throw err;
}
renderer.setPixelRatio(Math.min(
  window.devicePixelRatio, GRAPHICS_PRESETS[accessibility.graphicsQuality].pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.className = 'game';
app.prepend(renderer.domElement);

// GPU context loss: a driver reset, a laptop switching GPUs, or the browser
// reclaiming memory from a backgrounded tab all kill the WebGL context out from
// under us. three.js re-initialises itself on 'webglcontextrestored', but
// without this the player just sees a frozen or black canvas and assumes the
// game crashed. Freeze the loop, say what happened, and pick back up on restore.
let contextLost = false;
const contextLostEl = document.createElement('div');
contextLostEl.id = 'context-lost';
contextLostEl.innerHTML =
  '<div><b>Graphics context lost</b>'
  + '<p>The browser reset the GPU connection. Waiting for it to come back\u2026</p>'
  + '<p class="hint">If nothing happens in a few seconds, reload the page \u2014 '
  + 'your account and the world are saved on the server.</p></div>';
app.appendChild(contextLostEl);
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  // Must be prevented for the context to ever be restored. (three.js also does
  // this in its own listener; calling it twice is harmless.)
  e.preventDefault();
  contextLost = true;
  contextLostEl.classList.add('visible');
  if (input.locked) input.unlock();   // never leave the pointer captured
  audio.setMusicVolume(0);
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  contextLostEl.classList.remove('visible');
  audio.setMusicVolume(accessibility.musicVolume);
  // Re-apply everything that lives on the context rather than in three's cache.
  applyGraphicsQuality(accessibility.graphicsQuality);
});

const scene = new THREE.Scene();
// The `max` preset's shader stack. Inert (and holding no buffers) until a
// preset with `shaders: true` is applied — see applyGraphicsQuality.
const postfx = new PostFX(renderer, scene);
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
/** The perspective the player had BEFORE taking a helicopter seat; boarding
 *  switches to the rear third-person view, and leaving restores this. */
let preSeatView: View = View.First;
const VIEW_DIST = 4.0;       // how far the boom reaches when nothing blocks it
// Aboard a helicopter the boom has a whole airframe to clear before it sees
// anything: at walking distance the camera sits inside the tail. The seated
// boom still follows mouse-look, however, so both crew members can freely orbit
// the aircraft instead of having their view welded to its centreline.
const VIEW_DIST_SEATED = 9.0;
const VIEW_LIFT_SEATED = 1.6;  // and rides above the rotor disc, looking down
const viewCamera = new THREE.PerspectiveCamera(
  FOV, window.innerWidth / window.innerHeight, 0.08, 2000
);
viewCamera.rotation.order = 'YXZ';
scene.add(viewCamera);

// The atlas IS mipmapped now, which reverses an earlier call. The note that
// used to sit here said every smoothing stage tried — trilinear minification, a
// hand-built mip chain, forced anisotropy — bought a calmer horizon by making
// the near field blurry, so the chain was dropped and the horizon was left to
// swim. Two things make that trade unnecessary:
//   · Magnification is still NearestFilter. Mip levels are a MINIFICATION
//     concept; a surface at arm's length samples level 0 and is pixel-for-pixel
//     what it always was. Only surfaces already smaller than their texture can
//     reach level 1, and those were the ones shimmering.
//   · The tiles are now PADDED (ATLAS_PAD in textures.ts). Mipmapping an
//     unpadded tile atlas averages each tile against its NEIGHBOUR in the grid,
//     which smears unrelated colours across the whole sheet — that haze is very
//     probably what read as "the pixel art went blurry" the first time round.
// Geometry aliasing is still MSAA's job, not the texture filter's (see above).
// Built AFTER the renderer, because the atlas needs the context's anisotropy
// limit to filter grazing-angle ground properly.
const atlas = createAtlas(seed, renderer.capabilities.getMaxAnisotropy());
const cracks = createCrackTextures();
const world = new World(scene, atlas, seed);
// The sun's shadow map. Like PostFX it belongs to the `max` preset and holds
// no buffers until that preset is applied; it writes into uniforms World owns,
// because those are bound into the chunk shaders when they first compile.
const sunShadow = new SunShadow(renderer, scene, atlas.texture, world.shadowUniforms);
// Offline single-player gets a random dry spawn too (MP uses the server's).
const spawn = world.terrain.randomDrySpawn(Math.random, CORE_HALF);
const player = new Player(spawn);
// HUD look + keybinds (Pause -> HUD Settings). Applied before the first frame
// and before Input reads a key, so nothing ever renders or listens with the
// defaults when the player has chosen otherwise.
const hudSettings = loadHudSettings();
applyHudTheme(hudSettings.theme);
const input = new Input(renderer.domElement);
input.setBinds(hudSettings.binds);
// Phones/tablets get on-screen controls (joystick + buttons) that feed the
// exact same Input fields the keyboard/mouse write — pointer lock is virtual
// in touch mode. Callbacks close over UI declared further down; they only run
// on taps, long after module init.
const isMobile = isTouchDevice();
const touch = isMobile ? new TouchControls(input, {
  onInventory: () => { input.inventoryToggled = true; },
  onChat: () => { input.chatPressed = true; },
  onPause: () => {
    if (player.dead) return;
    if (screen === 'guide') { fieldGuide.backToPause(); return; }
    if (screen === 'paused') { resumePlay(); return; }         // resume
    if (invUI.open) { input.inventoryToggled = true; return; } // close menu first
    if (worldMap.open) { input.mapToggled = true; return; }
    if (warfareUI.open) { input.progressPressed = true; return; }
    if (input.locked) input.unlock();                          // open pause menu
    enterPause();
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

// Visual boundaries: the hard outer edge of the 5000×5000 play area, the
// Heartland ring at ±CORE_HALF, and the war's closing ring.
//
// These used to be four quads as wide as the boundary itself, and that is what
// made them glitch. A 5000-unit plane parked at ±2500 lies almost entirely
// beyond the camera's 2000-unit far plane, so a moving, invisible cut ran
// across it; its bounding sphere sits thousands of units from anything you can
// see, so the transparent pass sorted it against water, clouds and particles
// essentially at random; and standing on the boundary — which is exactly where
// movement clamps you — put the camera inside the plane, where DoubleSide and
// the near plane fought each other frame by frame.
//
// A wall is now a SHORT panel that slides along the boundary to stay in front
// of you. It is always well inside the far plane, always near the camera for
// sorting, and never contains it. The pattern is a function of WORLD position,
// not of the panel, so the panel's own motion is invisible; the ends fade out,
// and the whole thing fades in with distance the way the terrain fog does, so
// it still only appears as you approach.
const BOUNDARY_PANEL = 340;  // units of wall drawn either side of you
const BOUNDARY_TOP = 256;    // the full world column
/** How far OUTSIDE the clamp the sheet is hung. Movement clamps you to exactly
 *  ±half, so a sheet drawn at ±half is coplanar with your own eye the moment
 *  you walk into it — the degenerate case a two-sided plane cannot resolve.
 *  A quarter of a block is invisible as a position and enough to stay clear of
 *  the 0.08 near plane, so the wall is still solid when you are up against it. */
const BOUNDARY_MARGIN = 0.25;

interface BoundaryRing {
  /** `half` is the ring's current half-extent; visible=false hides it. */
  update(half: number, visible: boolean): void;
  material: THREE.ShaderMaterial;
}

function makeBoundaryRing(color: number, opacity: number, band: number): BoundaryRing {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uBand: { value: band },      // world-unit spacing of the field lines
      uTime: { value: 0 },
      uFog: { value: new THREE.Vector2(FOG_NEAR, FOG_FAR) },
    },
    vertexShader: `
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uBand;
      uniform float uTime;
      uniform vec2 uFog;
      varying vec3 vWorld;
      varying vec2 vUv;

      /** Distance to the nearest multiple of period, in world units. */
      float grid(float v, float period) {
        return abs(fract(v / period) - 0.5) * period;
      }

      void main() {
        // The panel slides; the pattern must not. Everything below is keyed to
        // the WORLD position of the fragment, so the wall reads as a fixed
        // structure you walk along.
        float along = abs(vWorld.x) > abs(vWorld.z) ? vWorld.z : vWorld.x;

        // Field lines: verticals on the world grid, plus a slow rising pulse.
        float posts = 1.0 - smoothstep(0.0, 1.1, grid(along, uBand));
        float rungs = 1.0 - smoothstep(0.0, 0.7, grid(vWorld.y, uBand * 0.5));
        float pulse = pow(0.5 + 0.5 * sin(vWorld.y * 0.25 - uTime * 1.6), 6.0);

        // A sheet that is densest at the ground and thins out overhead, so the
        // boundary reads as rising out of the world rather than hanging in it.
        float sheet = 1.0 - smoothstep(0.0, 1.0, vUv.y);
        sheet = 0.16 + sheet * 0.5;

        float body = sheet + posts * 0.55 + rungs * 0.18 + pulse * 0.22;

        // Feather the sliding ends so the panel never shows an edge, and fade
        // with distance on the same curve the terrain fog uses.
        float ends = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
        float away = 1.0 - smoothstep(uFog.x, uFog.y, distance(vWorld, cameraPosition));

        float alpha = uOpacity * body * ends * away;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor * (0.85 + posts * 0.5 + pulse * 0.4), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false, // the shader fades on the same curve by hand
  });

  const geometry = new THREE.PlaneGeometry(1, 1);
  const group = new THREE.Group();
  const walls = [0, 1, 2, 3].map((i) => {
    const wall = new THREE.Mesh(geometry, material);
    wall.frustumCulled = false; // it is always in view by construction
    // No renderOrder on purpose: a panel now sits a few dozen units from the
    // camera, so three's ordinary back-to-front sort finally puts it in the
    // right place against water and particles. Forcing an order would undo
    // exactly the thing this rewrite fixed.
    if (i >= 2) wall.rotation.y = Math.PI / 2;
    group.add(wall);
    return wall;
  });
  scene.add(group);

  return {
    material,
    update(half: number, visible: boolean): void {
      group.visible = visible;
      if (!visible) return;
      // Slide each panel to sit in front of the camera, clamped so it never
      // hangs off the end of its own side.
      const width = Math.min(BOUNDARY_PANEL, half * 2);
      const limit = Math.max(0, half - width / 2);
      const alongX = THREE.MathUtils.clamp(camera.position.x, -limit, limit);
      const alongZ = THREE.MathUtils.clamp(camera.position.z, -limit, limit);
      const y = BOUNDARY_TOP / 2;
      const edge = half + BOUNDARY_MARGIN;
      walls[0].position.set(alongX, y, -edge);
      walls[1].position.set(alongX, y, edge);
      walls[2].position.set(-edge, y, alongZ);
      walls[3].position.set(edge, y, alongZ);
      for (const wall of walls) wall.scale.set(width, BOUNDARY_TOP, 1);
      material.uniforms.uFog.value.set(
        scene.fog instanceof THREE.Fog ? scene.fog.near : FOG_NEAR,
        scene.fog instanceof THREE.Fog ? scene.fog.far : FOG_FAR,
      );
    },
  };
}

const worldBoundary = makeBoundaryRing(0x5ad0ff, 0.62, 16); // hard outer edge
const coreBoundary = makeBoundaryRing(0xffd84a, 0.22, 32);  // Heartland ring
// WAR BORDER: a closing ring, shown only during a war. It repositions every
// frame from the pure shrink curve, so every client renders the identical ring
// the server clamps movement to.
const warBoundary = makeBoundaryRing(0xff4a3a, 0.72, 8);

/** Re-seat the rings on the camera. Cheap, and must run every frame: the
 *  panels only look like continuous walls because they follow you. */
function updateBoundaryRings(): void {
  // Inside a Duels arena the open world is cropped away entirely, so its
  // boundaries have nothing left to mark.
  const show = !arenaActive;
  worldBoundary.update(WORLD_HALF, show);
  coreBoundary.update(CORE_HALF, show);
  if (!show) warBoundary.update(0, false);
  const t = worldTimeLocal;
  worldBoundary.material.uniforms.uTime.value = t;
  coreBoundary.material.uniforms.uTime.value = t;
  warBoundary.material.uniforms.uTime.value = t * 2.4;
}

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
let heldSwingSeq = 0;
held.onSwing = () => { heldSwingSeq = (heldSwingSeq + 1) & 0xffff; };
// The weapon view drives its own mechanical sounds: racking a pump, dropping a
// magazine, seating a fresh one. They land on the animation, not the input.
held.onGunSound = (kind) => audio.gunAction(kind);
const viewKickOut = { pitch: 0, yaw: 0, roll: 0 };

const furnaces = new Furnaces(world);
const survival = new Survival();
const particles = new Particles(scene);
const mobs = new Mobs(scene, world, atlas, itemEntities, particles);
const audio = new GameAudio();
const ambientWorld = new AmbientWorld(scene, world);
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
// Rig particles: exhaust smoke, drill dust, jam sparks, gusher spray, embers.
machineModels.onPuff = (kind, x, y, z) => {
  if (kind === 'smoke') particles.burst(x, y, z, 2, 0x55595f, 0.5, 1.6, { gravity: -1.4, spread: 0.2, scale: 1.7 });
  else if (kind === 'dust') particles.burst(x, y, z, 3, 0x9a8466, 1.6, 0.5, { gravity: 3, spread: 0.5, scale: 0.8 });
  else if (kind === 'spark') particles.burst(x, y, z, 4, 0xffb040, 3.2, 0.35, { gravity: 7, spread: 0.3, scale: 0.35 });
  else if (kind === 'oil') particles.burst(x, y, z, 6, 0x120e0a, 3.4, 1.3, { gravity: 5, spread: 0.8, scale: 1.3 });
  else particles.burst(x, y, z, 3, 0xff7a20, 1.4, 0.9, { gravity: -2.4, spread: 0.6, scale: 0.6 });
};
// Trapcraft: offline this field is authoritative; online it mirrors the
// server's trap entities (owner/channel/facing) for models + camouflage.
const trapField = new TrapField();
const trapSolid = solidFrom((x, y, z) => world.getBlock(x, y, z));
const trapModels = new TrapModels(scene, trapField, trapSolid);
// Cells with a live trap entity are drawn by TrapModels, not the chunk mesh.
meshHooks.skipTrap = (x, y, z) => trapField.has(x, y, z);
/** A cell gained/lost a trap entity: rebuild its chunk so mesh + model agree. */
function remeshTrapCell(x: number, z: number): void {
  const c = world.getChunk(x >> 4, z >> 4);
  if (c) c.dirty = true;
}
const statusFx = new StatusEffects();
/** Seconds until the open machine dashboard re-requests server truth (MP). */
let machineResync = 0;
/** Seconds until the offline output hoppers next run. */
let machineHopper = 4;

// --- Trap wiring panel: right-click a trap you own ---------------------------
let trapPanelAt: { x: number; y: number; z: number } | null = null;
const trapPanel = document.createElement('div');
trapPanel.style.cssText =
  'position:absolute;inset:0;display:none;z-index:34;align-items:center;justify-content:center;' +
  'background:rgba(6,9,16,0.6);';
const trapCard = document.createElement('div');
trapCard.style.cssText =
  'background:#101b28;border:1px solid #395063;border-radius:14px;box-shadow:0 18px 60px #000b;' +
  'width:360px;max-width:92vw;color:#dce8f0;font:12px/1.45 Inter,system-ui,sans-serif;padding:16px;' +
  'display:flex;flex-direction:column;gap:10px;';
trapPanel.appendChild(trapCard);
app.appendChild(trapPanel);
trapPanel.addEventListener('mousedown', (e) => { if (e.target === trapPanel) closeTrapPanel(); });
let trapPanelKey = '';

function openTrapPanel(x: number, y: number, z: number): void {
  trapPanelAt = { x, y, z };
  trapPanelKey = '';
  trapPanel.style.display = 'flex';
  input.unlock();
  refreshTrapPanel();
}

function closeTrapPanel(): void {
  trapPanelAt = null;
  trapPanel.style.display = 'none';
  if (worldReady && !player.dead && screen === 'playing') input.lock();
}

/** Rebuild the panel when the trap's visible state changes. */
function refreshTrapPanel(): void {
  const at = trapPanelAt;
  if (!at) return;
  const s = trapField.get(at.x, at.y, at.z);
  if (!s || Math.hypot(at.x + 0.5 - player.pos.x, at.z + 0.5 - player.pos.z) > 8) { closeTrapPanel(); return; }
  const key = `${s.kind}:${s.channel}:${s.interval}:${s.fuel}:${inventory.countItem(Item.OilBarrel)}`;
  if (key === trapPanelKey) return;
  trapPanelKey = key;
  trapCard.replaceChildren();
  const el = (tag: string, css: string, text = '') => {
    const n = document.createElement(tag); n.style.cssText = css; n.textContent = text; trapCard.appendChild(n); return n;
  };
  el('div', 'font-size:9px;font-weight:700;letter-spacing:.15em;color:#98afc1;', 'TRAPCRAFT / WIRING');
  el('div', 'font-size:20px;font-weight:750;color:#f3f8fc;', TRAP_NAMES[s.kind]);
  const receiver = s.kind === TrapKind.FallTrap || s.kind === TrapKind.WallTrap || s.kind === TrapKind.Spike ||
    s.kind === TrapKind.Landmine || s.kind === TrapKind.Claymore || s.kind === TrapKind.FlameJet ||
    s.kind === TrapKind.DartLauncher || s.kind === TrapKind.NetLauncher || s.kind === TrapKind.AlarmBell;
  el('div', 'color:#a8bfce;font-size:11px;', receiver
    ? 'RECEIVER — fires whenever any of your triggers on this channel goes off (within 24 blocks).'
    : 'TRIGGER — signals every one of your receivers on this channel within 24 blocks.');
  const grid = el('div', 'display:grid;grid-template-columns:repeat(8,1fr);gap:5px;');
  for (let c = 0; c < CHANNELS; c++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${CHANNEL_NAMES[c]} channel`;
    b.style.cssText = `aspect-ratio:1;border-radius:6px;cursor:pointer;background:${CHANNEL_COLORS[c]};` +
      `border:${c === s.channel ? '3px solid #fff' : '1px solid #0006'};`;
    b.addEventListener('click', () => {
      s.channel = c;
      if (net.connected) net.sendTrapConfig(at.x, at.y, at.z, c, s.kind === TrapKind.Timer ? s.interval : undefined);
      audio.trap('click');
      refreshTrapPanel();
    });
    grid.appendChild(b);
  }
  el('div', 'color:#e7f0f6;font-weight:600;', `Channel: ${CHANNEL_NAMES[s.channel]}`);
  const row = () => el('div', 'display:flex;gap:6px;flex-wrap:wrap;');
  const btn = (parent: HTMLElement, label: string, on: boolean, click: () => void, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.disabled = disabled;
    b.style.cssText = 'flex:1;padding:8px 10px;border-radius:7px;cursor:pointer;font:600 11px system-ui;' +
      `color:${on ? '#102431' : '#e5eff7'};background:${on ? '#72ead5' : '#243647'};border:1px solid #41556a;` +
      (disabled ? 'opacity:.5;cursor:default;' : '');
    b.addEventListener('click', click);
    parent.appendChild(b);
    return b;
  };
  if (s.kind === TrapKind.Timer) {
    el('div', 'font-size:9px;font-weight:700;letter-spacing:.15em;color:#98afc1;', 'PULSE EVERY');
    const r = row();
    for (const iv of TIMER_INTERVALS) {
      btn(r, `${iv}s`, s.interval === iv, () => {
        s.interval = iv;
        if (net.connected) net.sendTrapConfig(at.x, at.y, at.z, s.channel, iv);
        refreshTrapPanel();
      });
    }
  }
  if (s.kind === TrapKind.FlameJet) {
    el('div', 'font-size:9px;font-weight:700;letter-spacing:.15em;color:#98afc1;',
      `FUEL — ${s.fuel} / ${FLAME_FUEL_CAP} bursts`);
    const have = inventory.countItem(Item.OilBarrel);
    const room = Math.floor((FLAME_FUEL_CAP - s.fuel) / FLAME_BURSTS_PER_BARREL);
    const n = Math.min(have, room, 10);
    btn(row(), n > 0 ? `Load ${n} Oil Barrel${n > 1 ? 's' : ''} (+${n * FLAME_BURSTS_PER_BARREL})` : 'No oil to load', false, () => {
      if (n <= 0) return;
      inventory.removeItem(Item.OilBarrel, n);
      s.fuel = Math.min(FLAME_FUEL_CAP, s.fuel + n * FLAME_BURSTS_PER_BARREL);
      if (net.connected) net.sendTrapFuel(at.x, at.y, at.z, n);
      refreshTrapPanel();
    }, n <= 0);
  }
  el('div', 'color:#90a8b9;font-size:10px;',
    'Your traps never fire on you or your allies. Enemies see concealed traps only when sneaking right next to them or carrying a Trap Detector.');
  btn(row(), 'Done', false, closeTrapPanel);
}
// --- Warfare (M14): turrets, territory ---
const turretStates = new Map<string, TurretState>();
const turretModels = new TurretModels(scene, turretStates, particles);
// Friendly turrets also gun down our (client-side) hostile mobs.
const turretDefense = new TurretDefense(turretStates, mobs, {
  online: () => net.connected,
  me: () => ({ name: net.connected ? net.username : 'You', faction: localFaction }),
  solid: (x, y, z) => isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))),
  fireLocal: (x, y, z, tx, ty, tz) => {
    turretModels.fireTracer(x, y, z, tx, ty, tz);
    audio.gun(new THREE.Vector3(x + 0.5, y + TURRET_MUZZLE_Y, z + 0.5), 2.1);
  },
  fireNet: (x, y, z, tx, ty, tz) => net.sendTurretMobShot(x, y, z, tx, ty, tz),
});
/** Keep the turret entity map in step with its block: a cell that stops being
 *  a turret (raided, exploded, replaced) loses its state, model and panel. */
function syncTurretCell(x: number, y: number, z: number, b: number): void {
  const key = `${x},${y},${z}`;
  if (b === Block.Turret) {
    if (!turretStates.has(key)) turretStates.set(key, newTurret());
    return;
  }
  if (!turretStates.delete(key)) return;
  if (openTurret && openTurret.x === x && openTurret.y === y && openTurret.z === z) {
    openTurret = null;
    turretModels.showRange(null);
    if (invUI.open && invUI.mode === 'turret') invUI.hide();
  }
}
// --- CAPTURE THE FLAG: one flag per faction, server-authoritative ---
let flagState = newFlags();
const flagModels = new FlagModels(scene);
flagModels.setGroundProbe((x, z) => world.terrain.height(Math.floor(x), Math.floor(z)) + 1);
flagModels.setState(flagState.breakable, flagState.flags);
/** Seconds until the client may send another flag swing (matches the server). */
let flagHitTimer = 0;
/** Local mirror of "my faction holds no flag" — drives the danger banner.
 *  Never assigned directly: `refreshFlagless()` is the ONE place that decides
 *  it, because the answer depends on TWO things that arrive independently (the
 *  flag sync and your own faction) and reading it off only one of them is how
 *  the badge used to get stuck. */
let myFactionFlagless = false;

/**
 * Recompute the flagless badge from the two live facts, and repaint if it moved.
 *
 * Called from BOTH sides: every flag sync, and every point where `localFaction`
 * changes (welcome, pledge, offline auth, a spy's secret switch). The flag sync
 * usually lands BEFORE the welcome that tells us which side we are on — at that
 * moment nothing holds a flag for NO_FACTION, so a one-shot check at sync time
 * latched "NO FLAG — deaths are FOREVER" on and left it on until the next flag
 * event, which in a quiet week never comes.
 *
 * An unpledged player is never flagless: they have no side to lose one with.
 */
function refreshFlagless(): void {
  const flagless = isFaction(localFaction)
    && !flagState.flags.some((f) => f.holder === localFaction);
  if (flagless === myFactionFlagless) return;
  myFactionFlagless = flagless;
  refreshNetInfo();
}
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
let jumpImmuneUntil = 0; // suppress fall damage briefly after a Bounce Pad launch
// --- GRAPPLING HOOK ----------------------------------------------------------
// A movement TOY, not an elevator. The old hook pinned your velocity to a fixed
// 28 b/s straight at the anchor and then threw all of it away on arrival, which
// made every shot feel identical and ended with a dead stop. This one has the
// four beats a hook needs to feel good:
//
//   1. LAUNCH  — a real hook flies out; the line pays out behind it (anticipation)
//   2. BITE    — it thunks into the surface and the reel YANKS, building speed
//   3. SWING   — past the rope's length the line goes taut and the outward part
//                of your velocity is cancelled: a pendulum you steer with WASD
//   4. RELEASE — SPACE (or arriving) lets go and you KEEP every bit of the speed
//                you built, with a pop upward so you clear the ledge you swung at
//
// Momentum survives the release because Player.momentumTime suspends the normal
// air drag; chaining a second hook out of a launch is the whole point, so the
// gadget cooldown is short enough to allow it.
const GRAPPLE_HOOK_SPEED = 82;   // hook flight speed (blocks/s)
const GRAPPLE_PULL = 86;         // reel acceleration while the line is taut
const GRAPPLE_SLACK_PULL = 26;   // gentler assist while inside the rope length
const GRAPPLE_MAX_SPEED = 33;    // ceiling on reel speed
const GRAPPLE_REEL_RATE = 13;    // how fast the rope itself winds in (blocks/s)
const GRAPPLE_ARRIVE = 2.6;      // rope length that counts as "you're there"
const GRAPPLE_MIN_RANGE = 4.5;   // closer than this there is nothing to swing on
const GRAPPLE_LIFT = 27;         // anti-gravity while reeling upward
const GRAPPLE_MAX_TIME = 7;      // safety timeout (seconds attached)
const GRAPPLE_LAUNCH_UP = 8.5;   // upward pop when you let go
const GRAPPLE_MOMENTUM = 1.8;    // seconds of preserved speed after release
const ROPE_CLEARANCE = 0.35;     // ignore blocks this close to either rope end
const ROPE_CUT_GRACE = 0.15;     // seconds of blocked rope before the line snaps
type GrappleStage = 'fly' | 'reel';
let grappleStage: GrappleStage | null = null;
let grappleTime = 0;            // safety-timeout clock
let grappleRopeLen = 0;         // live rope length (shortens as you reel)
let grappleStuckTime = 0;       // seconds of no progress (hugging a wall)
let ropeCutTime = 0;            // seconds the rope has been blocked by terrain
let grappleWhirAt = 0;          // next winch whir (local seconds)
let grappleTrailAt = 0;         // next speed-trail particle (local seconds)
let grapplePrevJump = false;    // rising-edge detach on SPACE
let glideBlockedUntil = 0;      // the detach keypress must not also open wings
let speedFov = 0;               // extra FOV from raw speed (the camera "kick")
/** Magnification the zoom key is asking for; kept between presses so the level
 *  you scrolled to last time is the one you get back. */
let zoomTarget = ZOOM_DEFAULT;
/** The eased magnification actually applied to the camera (1 = not zoomed). */
let zoomAmount = 1;
/** Gameplay FOV before the zoom key divides it — what the sprint/sights/speed
 *  easing runs on, so a cutscene's own FOV can never become its starting point. */
let fovNoZoom = FOV;
/** A server teleport waiting for the destination chunks to stream in. While
 *  set, the player is pinned at the target (no gravity fall into ungenerated
 *  world); cleared once the near bubble is meshed (or after a timeout). */
let pendingTeleport: { x: number; y: number; z: number; started: number } | null = null;
const grappleAnchor = new THREE.Vector3();
const grappleHookPos = new THREE.Vector3(); // the hook itself while in flight
const grapplePrev = new THREE.Vector3();    // last-frame pos to detect "stuck on a wall"
// The rope is drawn as a chain of thin cylinders rather than a THREE.Line so it
// has real thickness at any distance (line widths are 1px on WebGL) and can sag
// while slack, then pull straight as the reel takes up the tension.
const ROPE_SEGMENTS = 14;
const ropeGroup = new THREE.Group();
const ropeSegments: THREE.Mesh[] = [];
{
  const geo = new THREE.CylinderGeometry(0.038, 0.038, 1, 5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe9e2cf });
  for (let i = 0; i < ROPE_SEGMENTS; i++) {
    const seg = new THREE.Mesh(geo, mat);
    seg.frustumCulled = false;
    ropeGroup.add(seg);
    ropeSegments.push(seg);
  }
  const head = new THREE.Group();
  const hookMat = new THREE.MeshBasicMaterial({ color: 0xb6c1d0 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.42, 6), hookMat);
  head.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6), hookMat);
  tip.position.y = 0.3;
  head.add(tip);
  for (let i = 0; i < 3; i++) {
    const claw = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.3, 5), hookMat);
    const a = i * Math.PI * 2 / 3;
    claw.position.set(Math.cos(a) * 0.1, -0.15, Math.sin(a) * 0.1);
    claw.rotation.set(Math.sin(a) * 0.72, 0, -Math.cos(a) * 0.72);
    head.add(claw);
  }
  head.frustumCulled = false;
  head.name = 'hook';
  ropeGroup.add(head);
}
const grappleHookMesh = ropeGroup.getObjectByName('hook') as THREE.Group;
ropeGroup.visible = false;
scene.add(ropeGroup);
const ropeA = new THREE.Vector3();
const ropeB = new THREE.Vector3();
const ropeCastDir = new THREE.Vector3();
const ropeCastFrom = new THREE.Vector3();
const ropeChest = new THREE.Vector3();
const ropeDir = new THREE.Vector3();
const ropeUp = new THREE.Vector3(0, 1, 0);
/** Lay the rope from the hand to `to`, sagging by `sag` blocks at its middle. */
function drawRope(to: THREE.Vector3, sag: number): void {
  const eye = player.eyePosition;
  const handX = eye.x, handY = eye.y - 0.25, handZ = eye.z;
  const sway = Math.sin(worldTimeLocal * 6) * 0.06;
  const point = (t: number, out: THREE.Vector3): void => {
    out.set(handX + (to.x - handX) * t, handY + (to.y - handY) * t,
      handZ + (to.z - handZ) * t);
    out.y -= (sag + sway) * Math.sin(Math.PI * t);
  };
  for (let i = 0; i < ROPE_SEGMENTS; i++) {
    point(i / ROPE_SEGMENTS, ropeA);
    point((i + 1) / ROPE_SEGMENTS, ropeB);
    ropeDir.subVectors(ropeB, ropeA);
    const len = Math.max(0.001, ropeDir.length());
    const seg = ropeSegments[i];
    seg.position.copy(ropeA).addScaledVector(ropeDir, 0.5);
    seg.scale.set(1, len, 1);
    seg.quaternion.setFromUnitVectors(ropeUp, ropeDir.divideScalar(len));
  }
  grappleHookMesh.position.copy(to);
  grappleHookMesh.quaternion.copy(ropeSegments[ROPE_SEGMENTS - 1].quaternion);
}

/** Is the straight line from `from` to `to` broken by a solid block? The rope is
 *  the one thing in the game that PULLS you along a line you did not walk, so it
 *  has to know when terrain has come between you and the anchor — otherwise the
 *  winch keeps hauling and grinds you into (and, given a thin enough wall and an
 *  unlucky frame, through) whatever is in the way. Torches, plants and other
 *  pass-through blocks are stepped over: they are not walls. */
function ropeBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const dir = ropeCastDir.subVectors(to, from);
  const span = dir.length();
  if (span < ROPE_CLEARANCE * 2) return false;
  dir.divideScalar(span);
  const org = ropeCastFrom.copy(from);
  let travelled = 0;
  // The anchor sits just off a surface, so stop short of it: the block the hook
  // is biting must never count as the thing blocking its own rope.
  for (let i = 0; i < 6; i++) {
    const left = span - travelled - ROPE_CLEARANCE;
    if (left <= 0) return false;
    const hit = raycastBlocks(world, org, dir, left);
    if (!hit) return false;
    if (isSolid(world.getBlock(hit.x, hit.y, hit.z))) return true;
    const step = Math.hypot(hit.hx - org.x, hit.hy - org.y, hit.hz - org.z) + 0.05;
    travelled += step;
    org.addScaledVector(dir, step);
  }
  return false;
}

/** Fire the hook at whatever you're aiming at. Returns false if nothing is in
 *  range (the caller then skips the cooldown so a miss costs you nothing). */
function fireGrapple(maxRange: number): boolean {
  const eye = player.eyePosition;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const hit = raycastBlocks(world, eye, dir, maxRange);
  if (!hit) return false;
  // A hook needs something to BITE. The block raycast also stops on torches,
  // plants and the like — anchoring to one would reel you into the wall behind
  // it, since nothing about it is solid enough to swing from.
  if (!isSolid(world.getBlock(hit.x, hit.y, hit.z))) return false;
  // Too close and the hook would bite, "arrive" and launch on the same frame —
  // a free jump every cooldown. A hook needs somewhere to pull you TO.
  if (Math.hypot(hit.hx - eye.x, hit.hy - eye.y, hit.hz - eye.z) < GRAPPLE_MIN_RANGE) {
    return false;
  }
  // Anchor ON the surface (nudged out along the face normal) instead of the
  // block centre, so the rope visibly bites where you aimed and the reel never
  // tries to drag you inside a wall.
  grappleAnchor.set(hit.hx + hit.nx * 0.22, hit.hy + hit.ny * 0.22, hit.hz + hit.nz * 0.22);
  grappleHookPos.set(eye.x, eye.y - 0.25, eye.z);
  grappleStage = 'fly';
  grappleTime = 0;
  grappleStuckTime = 0;
  ropeCutTime = 0;
  grappleWhirAt = 0;
  grapplePrevJump = true; // ignore the SPACE that may still be held from a jump
  grapplePrev.copy(player.pos);
  ropeGroup.visible = true;
  audio.grappleFire();
  held.gadgetAction('grappleFire');
  heldSwingSeq = (heldSwingSeq + 1) & 0xffff;
  return true;
}

/** Fly the hook, then reel/swing on it. Runs BEFORE player.update so the
 *  velocity it writes is what the physics step integrates. */
function updateGrapple(dt: number): void {
  if (!grappleStage) return;
  if (player.dead || player.flying || player.boating) { endGrapple(); return; }
  grappleTime += dt;
  const eye = player.eyePosition;

  if (grappleStage === 'fly') {
    // The hook travels; the line trails behind it with a bit of slack.
    const step = GRAPPLE_HOOK_SPEED * dt;
    const left = grappleHookPos.distanceTo(grappleAnchor);
    if (left <= step || grappleTime > 1.6) {
      grappleHookPos.copy(grappleAnchor);
      grappleStage = 'reel';
      grappleRopeLen = Math.max(GRAPPLE_ARRIVE,
        grappleAnchor.distanceTo(eye));
      audio.grappleHit(grappleAnchor);
      audio.grappleReel();
      grappleWhirAt = worldTimeLocal + 0.5; // the winch loop picks up from here
      grappleTrailAt = 0;
      particles.poof(grappleAnchor.x, grappleAnchor.y, grappleAnchor.z);
      triggerEncounterShake(0.12, 0.03);
    } else {
      grappleHookPos.lerp(grappleAnchor, step / Math.max(0.001, left));
    }
    drawRope(grappleHookPos, Math.min(1.4, grappleHookPos.distanceTo(eye) * 0.06));
    return;
  }

  // --- Attached: reel + swing ------------------------------------------------
  // SPACE cuts the line and launches (rising edge, so a held jump can't do it).
  const jumpNow = input.locked && !invUI.open && input.jump;
  const detach = jumpNow && !grapplePrevJump;
  grapplePrevJump = jumpNow;

  // Pull from roughly chest height so the rope angle matches the body.
  const cx = player.pos.x, cy = player.pos.y + 0.9, cz = player.pos.z;
  const tx = grappleAnchor.x - cx, ty = grappleAnchor.y - cy, tz = grappleAnchor.z - cz;
  const dist = Math.hypot(tx, ty, tz) || 0.001;
  const dx = tx / dist, dy = ty / dist, dz = tz / dist;

  if (detach || dist <= GRAPPLE_ARRIVE || grappleTime > GRAPPLE_MAX_TIME) {
    endGrapple(true);
    return;
  }
  // Hugging a surface with no progress for a moment: we're as close as the rope
  // will ever get, so let go rather than grinding against the wall.
  const moved = Math.hypot(player.pos.x - grapplePrev.x, player.pos.y - grapplePrev.y,
    player.pos.z - grapplePrev.z);
  grappleStuckTime = moved < 0.02 * (dt * 60) ? grappleStuckTime + dt : 0;
  grapplePrev.copy(player.pos);
  if (grappleTime > 0.35 && grappleStuckTime > 0.35) { endGrapple(true); return; }
  // Terrain has come between us and the anchor: the line is cut. Sliding along
  // a wall keeps `moved` high, so the stuck-detector above never fires on the
  // case that matters most — a swing that carries you behind a corner while the
  // winch is still pulling at full strength. A brief grace keeps a rope that
  // merely clips a corner for one frame from snapping mid-swing.
  ropeCutTime = ropeBlocked(ropeChest.set(cx, cy, cz), grappleAnchor)
    ? ropeCutTime + dt : 0;
  if (ropeCutTime > ROPE_CUT_GRACE) { endGrapple(true); return; }

  // The winch takes the rope in; the pull is an ACCELERATION so the yank builds
  // instead of teleporting you to a constant speed.
  grappleRopeLen = Math.max(GRAPPLE_ARRIVE, grappleRopeLen - GRAPPLE_REEL_RATE * dt);
  const taut = dist > grappleRopeLen;
  const vel = player.vel;
  // The reel may limit speed it creates, but must not erase a faster launch
  // inherited from a Bounce Pad (or a previous grapple).
  const inheritedSpeed = vel.length();
  vel.x += dx * (taut ? GRAPPLE_PULL : GRAPPLE_SLACK_PULL) * dt;
  vel.y += dy * (taut ? GRAPPLE_PULL : GRAPPLE_SLACK_PULL) * dt;
  vel.z += dz * (taut ? GRAPPLE_PULL : GRAPPLE_SLACK_PULL) * dt;
  if (taut) {
    // Pendulum: a rope cannot stretch, so cancel the part of the velocity that
    // is moving AWAY from the anchor. What's left is the tangential swing.
    const radial = vel.x * dx + vel.y * dy + vel.z * dz;
    if (radial < 0) {
      vel.x -= dx * radial; vel.y -= dy * radial; vel.z -= dz * radial;
    }
  }
  // Reeling toward a high anchor has to beat gravity or you just dangle.
  if (dy > 0.1) vel.y += GRAPPLE_LIFT * dy * dt;
  const speed = vel.length();
  const speedLimit = Math.max(GRAPPLE_MAX_SPEED, inheritedSpeed);
  if (speed > speedLimit) vel.multiplyScalar(speedLimit / speed);
  player.fallDistance = 0;
  // Suspend the normal air drag while attached: WASD steers the swing instead
  // of dragging it back to walking pace (see Player.momentumTime).
  player.momentumTime = Math.max(player.momentumTime, 0.3);
  if (worldTimeLocal >= grappleWhirAt) {
    audio.grappleReel();
    grappleWhirAt = worldTimeLocal + 0.5;
  }
  // Speed trail: sparse on purpose (each particle is a mesh), just enough to
  // read as "you are moving fast" out of the corner of your eye.
  if (speed > 16 && worldTimeLocal >= grappleTrailAt) {
    grappleTrailAt = worldTimeLocal + 0.06;
    particles.burst(cx, cy, cz, 1, 0xdfe8ff, 1.2, 0.35);
  }
  drawRope(grappleAnchor, 0.1);
}

/** Cut the line. `launch` keeps the speed you built (and pops you up over the
 *  lip you were swinging at) — a dead stop is what made the old hook boring. */
function endGrapple(launch = false): void {
  if (!grappleStage) return;
  const wasAttached = grappleStage === 'reel';
  grappleStage = null;
  ropeGroup.visible = false;
  glideBlockedUntil = worldTimeLocal + 0.3;
  if (launch && wasAttached) {
    player.vel.y = Math.max(player.vel.y, Math.min(GRAPPLE_LAUNCH_UP, player.vel.y + 6.5));
    player.momentumTime = GRAPPLE_MOMENTUM;
    audio.grappleRelease();
    held.gadgetAction('grappleRelease');
    heldSwingSeq = (heldSwingSeq + 1) & 0xffff;
    particles.burst(player.pos.x, player.pos.y + 0.9, player.pos.z, 8, 0xe9e2cf, 2.4, 0.4);
  } else {
    player.momentumTime = 0;
  }
  player.fallDistance = 0;
  jumpImmuneUntil = worldTimeLocal + 2.5; // the landing after a swing is on us
}

// Anchor preview: while the hook is held, the surface you'd bite into is ringed
// in the world. Aiming a grapple at a 48-block range through a crosshair is
// guesswork otherwise — this is what turns "fire and hope" into a decision.
const grappleMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.26, 0.4, 22),
  new THREE.MeshBasicMaterial({
    color: 0xbfe6ff, transparent: true, opacity: 0.8,
    side: THREE.DoubleSide, depthWrite: false,
  }),
);
grappleMarker.visible = false;
grappleMarker.renderOrder = 4;
scene.add(grappleMarker);
function updateGrappleAim(controlling: boolean): void {
  const stack = inventory.selectedStack;
  grappleMarker.visible = false;
  if (!controlling || grappleStage || stack?.id !== Item.GrapplingHook) return;
  const eye = player.eyePosition;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const hit = raycastBlocks(world, eye, dir,
    gadgetOf(Item.GrapplingHook)?.radius ?? 48);
  if (!hit) return;
  if (!isSolid(world.getBlock(hit.x, hit.y, hit.z))) return;
  grappleMarker.visible = true;
  grappleMarker.position.set(hit.hx + hit.nx * 0.03, hit.hy + hit.ny * 0.03,
    hit.hz + hit.nz * 0.03);
  grappleMarker.lookAt(
    grappleMarker.position.x + hit.nx,
    grappleMarker.position.y + hit.ny,
    grappleMarker.position.z + hit.nz);
  const usable = gadgetCd.ready(Item.GrapplingHook, worldTimeLocal) &&
    Math.hypot(hit.hx - eye.x, hit.hy - eye.y, hit.hz - eye.z) >= GRAPPLE_MIN_RANGE;
  grappleMarker.scale.setScalar(
    (1 + Math.sin(worldTimeLocal * 7) * 0.09) * (usable ? 1 : 0.68));
  (grappleMarker.material as THREE.MeshBasicMaterial).color.set(
    usable ? 0xbfe6ff : 0x7d8697);
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

// World map (M key): terrain + war flags + waypoints + totem travel.
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
netinfoEl.id = 'netinfo';
netinfoEl.style.cssText =
  'position:absolute;top:6px;right:8px;font-size:14px;z-index:10;' +
  'pointer-events:none;text-align:right;';
app.appendChild(netinfoEl);
const killfeedEl = document.createElement('div');
killfeedEl.style.cssText =
  'position:absolute;top:28px;right:8px;z-index:10;pointer-events:none;text-align:right;';
app.appendChild(killfeedEl);

// Combat-log clock. It sits above the tallest possible survival-status stack,
// so it never covers the hotbar, hearts, armor, energy, bubbles, or ammo.
const combatTimerEl = document.createElement('div');
combatTimerEl.className = 'mc-font';
combatTimerEl.style.cssText =
  'position:absolute;left:50%;transform:translateX(-50%);z-index:10;' +
  'pointer-events:none;display:none;padding:4px 9px;border:1px solid rgba(255,95,95,.75);' +
  'border-radius:4px;background:rgba(35,5,8,.82);color:#ff7777;font-size:12px;' +
  'white-space:nowrap;text-shadow:0 1px 2px #000;';
app.appendChild(combatTimerEl);
let combatTagUntilLocal = 0;

function combatSecondsLeft(): number {
  return Math.max(0, combatTagUntilLocal - worldTimeLocal);
}

function updateCombatTimer(): void {
  const left = combatSecondsLeft();
  if (left <= 0 || player.dead || screen === 'title') {
    combatTimerEl.style.display = 'none';
    return;
  }
  combatTimerEl.innerHTML = iconifyHtml(`⚔ COMBAT ${Math.ceil(left)}s`);
  // Two heart rows lift armor/ammo by another 22px.
  combatTimerEl.style.bottom = localHearts > 10
    ? 'calc(var(--hotbar-slot) + 108px + var(--safe-bottom))'
    : 'calc(var(--hotbar-slot) + 86px + var(--safe-bottom))';
  combatTimerEl.style.display = 'block';
}

// ─── PvP combat feedback ────────────────────────────────────────────────────
// A gunfight is only readable if two questions are answered instantly: did MY
// shot land, and where is the fire coming from? Both are driven by the server
// (`hitconfirm` and the `by` on `hurt`), never predicted, so neither can lie
// about a hit the server rejected.

// Hitmarker: the classic four ticks flicking out of the crosshair.
const hitmarkerEl = document.createElement('div');
hitmarkerEl.style.cssText =
  'position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;' +
  'z-index:11;pointer-events:none;opacity:0;';
const hitmarkerTicks: HTMLDivElement[] = [];
for (const [x, y, rot] of [
  ['left:1px', 'top:1px', 45], ['right:1px', 'top:1px', -45],
  ['left:1px', 'bottom:1px', -45], ['right:1px', 'bottom:1px', 45],
] as [string, string, number][]) {
  const tick = document.createElement('div');
  tick.style.cssText =
    `position:absolute;${x};${y};width:11px;height:2px;background:#fff;` +
    `transform:rotate(${rot}deg);box-shadow:0 0 2px rgba(0,0,0,0.9);`;
  hitmarkerEl.appendChild(tick);
  hitmarkerTicks.push(tick);
}
app.appendChild(hitmarkerEl);
let hitmarkerT = 0;               // seconds of marker left to play
let hitmarkerKill = false;        // the marker currently playing is a kill
const HITMARKER_TIME = 0.4;

// ── The payoff layer ────────────────────────────────────────────────────────
// A number off the target, a slam for the elimination, and a chip under the
// crosshair naming who you just dropped. Everything below is driven ONLY by
// server messages (`hitconfirm` / `hurt` / `killfeed`); none of it can invent
// a hit the server rejected. See pvp_feedback.ts.
const damageNumbers = new DamageNumbers(app);
const pvpSlamEl = document.createElement('div');
pvpSlamEl.className = 'pvp-slam';
pvpSlamEl.setAttribute('role', 'status');
pvpSlamEl.setAttribute('aria-live', 'polite');
app.appendChild(pvpSlamEl);
const killBanner = new KillBanner(pvpSlamEl);
const killChipEl = document.createElement('div');
killChipEl.className = 'pvp-killchip';
app.appendChild(killChipEl);
let killChipT = 0;
const KILL_CHIP_TIME = 2.2;
/** Local kills-without-dying. Duels takes its announcer from the server; this
 *  is what gives the OPEN WORLD the same streak vocabulary. */
const pvpStreak = new StreakTracker();
/** 0..1 red-rim intensity from the last hit taken (decays every frame). */
let hurtPulse = 0;
/** Seconds until the next low-health heartbeat. */
let heartbeatTimer = 0;
const hurtVignetteEl = document.getElementById('hurt-vignette') as HTMLDivElement;

// Directional damage arcs: a red wedge around the crosshair pointing back at
// whoever shot you, held in world space so it keeps pointing at them as you
// spin to return fire.
const dmgArcWrap = document.createElement('div');
dmgArcWrap.style.cssText =
  'position:absolute;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;' +
  'z-index:11;pointer-events:none;';
app.appendChild(dmgArcWrap);
interface DamageArc { el: HTMLDivElement; x: number; z: number; t: number }
const dmgArcs: DamageArc[] = [];
const DMG_ARC_TIME = 1.6;
const MAX_DMG_ARCS = 4;

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
  setIconText(regionBannerEl, text);
  regionBannerEl.style.color = color;
  regionBannerEl.style.display = 'block';
  regionBannerTimer = 3.2;
}
// The local player's faction. NO_FACTION until allegiance is sworn on the
// pledge screen — nothing assigns a side any more, online or off. Everything
// downstream already treats NO_FACTION as neutral by design (factionColor,
// factionName, sameFaction and isFaction all handle it), so an unpledged player
// simply renders grey and is friendly with nobody.
let localFaction = NO_FACTION;
/** Per-faction public dossiers for the pledge screen (server-sent online). */
let factionPublics: FactionPublic[] = [];
// Local gamemode (admin-set via the server console). Drives flight/noclip/
// invulnerability + the creative build conveniences.
let localMode: GameMode = 'survival';
// Authentication state (mandatory login). Declared early so refreshNetInfo can
// read it; the form + flow are wired further down.
let authed = false;
let authedName = '';
/** Live population reported by the server, split by the mode players chose. */
let livePlayerCounts: PlayerCounts | null = null;

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
let serverWorldTime = 0;
let serverWorldTimeAt = performance.now();
let hasServerWorldTime = false;
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
    `<span style="color:${factionCss(localFaction)}">${iconSvg('square')} ${factionName(localFaction)}</span>  `;
  const modeBadge = localMode === 'survival' ? '' :
    `<span style="color:#ffe27a">[${localMode.toUpperCase()}]</span>  `;
  // Permanent "Seasons Won" badge (Phase 5): a gold star + count.
  const wonBadge = localSeasonsWon > 0
    ? `<span style="color:#ffd84a">${iconSvg('star')}${localSeasonsWon}</span>  ` : '';
  // No flag = no comeback: your faction's deaths are permanent until you take
  // one back. It rides in the status line so it's impossible to miss.
  const flagBadge = myFactionFlagless && net.connected
    ? `<span style="color:#ff5c5c">${iconSvg('skull')} NO FLAG — deaths are FOREVER</span>  ` : '';
  if (net.connected) {
    netinfoEl.innerHTML =
      `${flagBadge}${wonBadge}${modeBadge}${badge}${net.username}   ${net.remotes.size + 1} online`;
  } else if (authed) {
    netinfoEl.innerHTML = `${wonBadge}${badge}${authedName}   (offline)`;
  } else {
    netinfoEl.innerHTML = '';
  }
}
function showKill(killer: string, victim: string, how?: string): void {
  const line = document.createElement('div');
  line.className = 'mc-font';
  line.style.cssText = 'font-size:13px;text-shadow:1px 1px 0 #000;';
  // Trap kills read as a sentence: "Alex was shredded by Sam's Claymore".
  setIconText(line, how ? `${victim} was ${how}` : killer ? `${killer}  »  ${victim}` : `${victim} died`);
  killfeedEl.appendChild(line);
  window.setTimeout(() => line.remove(), 5000);
}
/** One of our rounds connected. `amount` is the health actually removed after
 *  the target's armor, so 0 means "hit them, their kit ate all of it" — worth
 *  showing in its own colour rather than staying silent, because a silent
 *  crosshair is indistinguishable from a miss. */
function showHitmarker(amount: number, killed: boolean): void {
  hitmarkerT = HITMARKER_TIME;
  hitmarkerKill = killed;
  const color = killed ? '#ff5555' : amount > 0 ? '#ffffff' : '#9fb4c7';
  for (const tick of hitmarkerTicks) {
    tick.style.background = color;
    // A kill throws the ticks wide: the shape itself says "that was the last
    // one", so you know to move on to the next target without reading a number.
    tick.style.width = killed ? '16px' : '11px';
    tick.style.boxShadow = killed
      ? '0 0 6px rgba(255,60,80,.9), 0 0 2px rgba(0,0,0,.9)'
      : '0 0 2px rgba(0,0,0,0.9)';
  }
  audio.hitmarker(killed, amount <= 0);
}

/**
 * One of our rounds landed on a PLAYER. `hitconfirm` only carries the target id
 * and the post-armor number, so the world position comes from the avatar we are
 * already rendering — what you shot is what you saw.
 */
function showPvpHit(targetId: number, amount: number, killed: boolean): void {
  showHitmarker(amount, killed);
  const flavor: HitFlavor = hitFlavor(
    amount, killed, arenaActive ? arenaMaxHealth : 20);
  const remote = net.remotes.get(targetId);
  if (remote) {
    const body = remotePlayers.renderedPos(targetId);
    const x = body?.x ?? remote.tx, y = (body?.y ?? remote.ty) + 1.15, z = body?.z ?? remote.tz;
    damageNumbers.spawn(x, y, z, amount, flavor);
    // Impact spray at the body: red for damage that got through, a dull gray
    // spall for a round the target's kit ate.
    if (flavor === 'soak') {
      particles.burst(x, y, z, 4, 0xc6d6e4, 2.2, 0.3, { gravity: 3, spread: 0.35, scale: 0.4 });
    } else {
      particles.burst(x, y, z, killed ? 16 : 6, killed ? 0xff4356 : 0xf4626f,
        killed ? 5 : 2.8, killed ? 0.6 : 0.36,
        { gravity: 3.2, spread: 0.42, scale: killed ? 0.62 : 0.46 });
    }
    // Tint the victim's model. This is the feedback that reads from the hip,
    // without ever looking at the crosshair.
    remotePlayers.hurtFlash(targetId,
      killed ? 1 : flavor === 'soak' ? 0.28 : flavor === 'heavy' ? 0.8 : 0.55);
  }
  // A tiny kick on every landed round — enough for the hand to feel the
  // connection, far below the shake a boss stomp uses.
  if (flavor !== 'soak') {
    triggerEncounterShake(killed ? 0.14 : 0.06,
      killed ? 0.019 : 0.0035 + Math.min(0.007, amount * 0.0005));
  }
  if (killed) onPvpKill(targetId);
}

/** Colour for a streak beat. Shared with the Duels announcer so an open-world
 *  RAMPAGE and a ranked one are the same colour as well as the same word. */
function pvpBeatColor(kind: DuelEventKind): string {
  return DUEL_EVENT_COLORS[kind];
}

/** We dropped someone: name them under the crosshair, then play whatever
 *  streak beats the kill earned. In Duels the SERVER owns the big announcer
 *  calls (they must match for every client), so only the chip plays there. */
function onPvpKill(targetId: number): void {
  const victim = net.remotes.get(targetId)?.info.username ?? 'Enemy';
  // In a match the announcer slam sits in the same place and says the same
  // thing with more force; the chip is the quiet version for when it is not up.
  if (arenaActive && duelAnnounceEl.classList.contains('visible')) return;
  setIconText(killChipEl, `✖ ELIMINATED ${victim}`);
  killChipEl.classList.remove('visible');
  void killChipEl.offsetWidth; // restart the pop
  killChipEl.style.opacity = '1'; // clear any fade left from the previous kill
  killChipEl.classList.add('visible');
  killChipT = KILL_CHIP_TIME;
  if (arenaActive) return;
  const beats = pvpStreak.kill(targetId, performance.now());
  killBanner.push('ELIMINATED', victim, '#ff5f76', 1.15);
  for (const kind of beats) {
    const copy = duelEventCopy({
      seq: 0, kind, actor: net.myId, actorName: 'You',
      victim: targetId, victimName: victim, count: pvpStreak.streak, at: 0,
    });
    killBanner.push(copy.title, copy.sub, pvpBeatColor(kind), 1.45);
    audio.duelAnnounce(kind);
  }
}

/** We took a hit from `(x, z)`: raise a wedge pointing that way. Recorded in
 *  world space so turning toward the shooter sweeps the wedge to the crosshair
 *  — that IS the affordance, it tells you which way to turn. */
function showDamageFrom(x: number, z: number): void {
  // Fold a fresh hit from roughly the same bearing into the existing arc rather
  // than stacking duplicates during sustained automatic fire.
  for (const arc of dmgArcs) {
    if (Math.hypot(arc.x - x, arc.z - z) < 4) {
      arc.x = x; arc.z = z; arc.t = DMG_ARC_TIME;
      return;
    }
  }
  if (dmgArcs.length >= MAX_DMG_ARCS) {
    const oldest = dmgArcs.shift();
    oldest?.el.remove();
  }
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;';
  const wedge = document.createElement('div');
  // A triangle pointing outward (up = straight ahead) at the rim of the wrap.
  wedge.style.cssText =
    'position:absolute;left:50%;top:6px;width:74px;height:26px;margin-left:-37px;' +
    'background:linear-gradient(to bottom,rgba(255,52,52,0.95),rgba(255,52,52,0));' +
    'clip-path:polygon(50% 0,100% 100%,0 100%);';
  el.appendChild(wedge);
  dmgArcWrap.appendChild(el);
  dmgArcs.push({ el, x, z, t: DMG_ARC_TIME });
}

/** Per-frame decay + re-aim of the combat feedback overlays. */
function updateCombatFeedback(dt: number): void {
  updateCombatTimer();
  if (hitmarkerT > 0) {
    hitmarkerT = Math.max(0, hitmarkerT - dt);
    const k = hitmarkerT / HITMARKER_TIME;
    hitmarkerEl.style.opacity = String(Math.min(1, k * 2.2));
    // Punches out slightly then settles, so rapid hits still read individually.
    // A kill also spins the ticks a few degrees as it blows out.
    const scale = (hitmarkerKill ? 1.75 : 1.35) - 0.35 * Math.min(1, k * 1.6);
    const spin = hitmarkerKill ? k * 26 : 0;
    hitmarkerEl.style.transform = `rotate(${spin.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
  } else if (hitmarkerEl.style.opacity !== '0') {
    hitmarkerEl.style.opacity = '0';
  }

  // "✖ ELIMINATED <name>" holds, then fades.
  if (killChipT > 0) {
    killChipT = Math.max(0, killChipT - dt);
    if (killChipT <= 0) killChipEl.classList.remove('visible');
    else killChipEl.style.opacity = String(Math.min(1, killChipT / 0.45));
  }
  killBanner.update(dt);
  updatePartyFrame(dt);

  // The red rim from the last hit taken, plus a permanent low-health bed under
  // it. Both are capped hard when photosensitivity-safe mode is on.
  hurtPulse = Math.max(0, hurtPulse - dt * 2.4);
  const healthFrac = player.maxHealth > 0 ? player.health / player.maxHealth : 1;
  const critical = !player.dead && healthFrac < 0.32
    ? (1 - healthFrac / 0.32) * (accessibility.reducedMotion
      ? 0.3 : 0.24 + Math.sin(worldTimeLocal * 5.4) * 0.07)
    : 0;
  const cap = accessibility.photosensitivitySafe ? 0.24 : 0.62;
  hurtVignetteEl.style.opacity = String(Math.min(cap, hurtPulse * 0.62 + critical));

  // The heartbeat under it. It quickens as the bar empties, which is the whole
  // point: in a duel you can hear how close your opponent is to finishing you
  // without ever taking your eyes off them.
  if (critical > 0 && screen !== 'title' && !player.dead) {
    const urgency = Math.min(1, (1 - healthFrac / 0.32));
    heartbeatTimer -= dt;
    if (heartbeatTimer <= 0) {
      audio.heartbeat(urgency);
      heartbeatTimer = 1.15 - urgency * 0.45;
    }
  } else {
    heartbeatTimer = 0;
  }

  if (!dmgArcs.length) return;
  // Screen-space basis for the current facing: forward is where the camera
  // looks, right is 90° clockwise from it (same convention as the server's
  // facing check).
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  for (let i = dmgArcs.length - 1; i >= 0; i--) {
    const arc = dmgArcs[i];
    arc.t -= dt;
    if (arc.t <= 0) { arc.el.remove(); dmgArcs.splice(i, 1); continue; }
    const dx = arc.x - player.pos.x, dz = arc.z - player.pos.z;
    const angle = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    arc.el.style.transform = `rotate(${angle}rad)`;
    arc.el.style.opacity = String(Math.min(1, arc.t / (DMG_ARC_TIME * 0.6)));
  }
}

/** Transient on-screen notice (admin feedback: gamemode/teleport/etc). */
function showNotice(text: string): void {
  const line = document.createElement('div');
  line.className = 'mc-font';
  line.style.cssText = 'font-size:14px;color:#ffe27a;text-shadow:1px 1px 0 #000;';
  setIconText(line, text);
  killfeedEl.appendChild(line);
  window.setTimeout(() => line.remove(), 4000);
}

// Drop routing: in multiplayer drops are server-owned (everyone sees them);
// offline they are local item entities.
function spawnDrop(x: number, y: number, z: number, id: number, count: number): void {
  if (net.connected) { net.sendDrop([{ id, count }], x, y, z); return; }
  itemEntities.spawn(x, y, z, id, count);
}
/**
 * Tip a set of stacks onto the ground. Returns whether they actually got there:
 * a caller that has already taken the items out of the inventory (the death
 * spill) has to know, because a socket that closed a moment ago accepts the
 * send and discards it — see `NetClient.raw`.
 */
function spillStacks(stacks: ItemStack[], x: number, y: number, z: number): boolean {
  if (!stacks.length) return true;
  if (net.connected) {
    return net.sendDrop(stacks.map((s) => ({ id: s.id, count: s.count })), x, y, z);
  }
  for (const s of stacks) itemEntities.spawn(x, y, z, s.id, s.count);
  return true;
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
    invUI.chestPager = null; // an ordinary chest is one page, and is called Chest
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
    turretModels.showRange(x, y, z);
    invUI.show('turret', undefined, undefined, turretCtxFor(x, y, z));
  } else if (kind === 'helipad') {
    openHelipadPanel(x, y, z);
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
  const yieldContext = machines.context(x, z, here()?.type ?? MachineType.Autominer);
  return {
    state: here,
    context: () => yieldContext,
    configureFilter: (mask) => {
      const s = here(); if (!s) return;
      setFilter(s, mask);
      if (net.connected) net.sendMachineConfig(x, y, z, s.filter);
    },
    rate: () => {
      const s = here();
      return s ? currentRate(s, yieldContext) : 0;
    },
    toggleFilter: (i) => {
      const s = here();
      if (!s || s.type !== MachineType.Autominer) return;
      // Bands the bore hasn't reached yet stay selectable: they start
      // producing the moment the drill gets there.
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
      showNotice(axis === 'production' ? `${machineRank(s.level)} installed — output boosted, hull repaired!` : 'Expanded buffer installed!');
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
      const me = net.connected ? net.username : 'You';
      if (!machineCanClaim(s, me, localFaction)) {
        showNotice('Hostile rig — knock its hull below 25% before hacking it.');
        return;
      }
      claimMachine(s, me, localFaction); // local predict
      if (net.connected) net.sendMachineClaim(x, y, z);
    },
    move: () => {
      if (!here()) return;
      const fromX = x, fromY = y, fromZ = z;
      forceCloseMachine();
      interaction.armedMove = (px, py, pz) => moveMachine(fromX, fromY, fromZ, px, py, pz);
      if (worldReady) resumePlay();
      showNotice(`✋ Carry it up to ${RELOCATE_RANGE} blocks, then right-click the new site. Esc cancels.`);
    },
    myName: () => (net.connected ? net.username : 'You'),
    myFaction: () => localFaction,
    act: (act, n, item) => {
      const s = here();
      if (!s) return;
      // Item costs: fixed ones (coolant/cap/smother/inject) or the fuel/bit
      // item itself. Paid client-side, like upgrades.
      const cost: Record<number, number> = actCost(act) ?? {};
      if (act === 'fuel') cost[item] = Math.floor(n);
      if (act === 'bit') cost[item] = 1;
      if (!canAffordCost(cost)) return;
      if (!applyMachineAct(s, act, n, item)) return; // not applicable right now
      payCost(cost);
      if (net.connected) net.sendMachineAct(x, y, z, act, n, item);
      const pos = new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
      if (act === 'coolant' || act === 'vent') { audio.rig('hiss', pos); particles.burst(pos.x, pos.y + 0.6, pos.z, 12, 0xe8eef2, 1.6, 1.2, { gravity: -1.5, scale: 1.4 }); }
      else if (act === 'bit') audio.rig('bit', pos);
      else if (act === 'cap') showNotice('🛢 Wellhead capped — the gusher is under control.');
      else if (act === 'smother') { showNotice('🔥 Fire smothered.'); audio.rig('hiss', pos); }
      else if (act === 'inject') showNotice('Frac sand injected — reservoir pressure rising.');
      else audio.place(materialOf(Block.Autominer), pos);
    },
    survey: () => {
      const s = here();
      return s ? machines.survey(x, z, s.type) : [];
    },
  };
}

/** Rig events (jam, strike, gusher, well fire…): sound, particles, notices.
 *  Offline from the local sim; online from the server's `machineFx`. */
function machineFx(x: number, y: number, z: number, fx: string): void {
  const pos = new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
  const near = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z) < 64;
  const s = machines.get(x, y, z);
  const mine = !!s && (s.owner === (net.connected ? net.username : 'You') || !s.owner);
  switch (fx) {
    case 'jam':
      audio.rig('jam', pos);
      particles.burst(pos.x, pos.y + 0.4, pos.z, 18, 0xffb040, 3.5, 0.5, { gravity: 7, scale: 0.4 });
      if (near || mine) showNotice('⚠ Autominer OVERHEATED and jammed!');
      break;
    case 'strike':
      audio.rig('strike', pos);
      if (near || mine) showNotice('🛢 Oil struck! The derrick is pumping.');
      break;
    case 'gusher':
      audio.rig('gusher', pos);
      particles.burst(pos.x + 0.3, pos.y + 2, pos.z, 40, 0x120e0a, 6, 1.6, { gravity: 5, spread: 0.6, scale: 1.4 });
      if (near || mine) showNotice('🛢💥 GUSHER! Free oil — cap it before anything sets it alight!');
      break;
    case 'ignite':
      audio.rig('ignite', pos);
      particles.explosion(pos.x, pos.y + 1, pos.z);
      if (near || mine) showNotice('🔥 An uncapped well caught fire! Smother it with sand!');
      break;
    case 'fireOut':
      if (near || mine) showNotice('The well fire burned itself out.');
      break;
    case 'bitBroke':
      audio.rig('bit', pos);
      if (mine) showNotice('Your autominer wore out its drill bit — back to the stock bit.');
      break;
    case 'siphon':
      audio.rig('siphon', pos);
      break;
  }
}
machines.onEvent = (x: number, y: number, z: number, _s: MachineState, ev: MachineEvents) => {
  if (net.connected) return; // the server announces events online
  machineFx(x, y, z, ev.jammed ? 'jam' : ev.gusher ? 'gusher' : ev.struck ? 'strike'
    : ev.fireOut ? 'fireOut' : 'bitBroke');
};

/** Relocate a placed machine to a new anchor cell. You can't break a machine,
 *  only MOVE it — so this preserves its level/storage/filter/stored output.
 *  Online the server does the authoritative move + echoes the edits; offline we
 *  carry the local MachineState object across to the new footprint. */
function moveMachine(
  fromX: number, fromY: number, fromZ: number, px: number, py: number, pz: number
): boolean {
  const s = machines.get(fromX, fromY, fromZ);
  if (!s) {
    showNotice('That machine is no longer there.');
    return true;
  }
  if (px === fromX && py === fromY && pz === fromZ) {
    showNotice('Choose a different site. Right-click to try again.');
    return false;
  }
  if (Math.hypot(px - fromX, pz - fromZ) > RELOCATE_RANGE) {
    showNotice(`Too far — a rig can be carried at most ${RELOCATE_RANGE} blocks. Right-click a closer site.`);
    return false;
  }
  const type = s.type;
  const h = machineHeight(type);
  // Validate the destination column is clear (cells being vacated count as free).
  for (let k = 0; k < h; k++) {
    const cy = py + k;
    const vacating = px === fromX && pz === fromZ && cy >= fromY && cy < fromY + h;
    if (cy < 0 || cy >= 256 || (!vacating && !isReplaceable(world.getBlock(px, cy, pz)))) {
      showNotice('No room there. Right-click another site to try again.');
      return false;
    }
    if (player.intersectsBlock(px, cy, pz) || interaction.canEdit?.(px, cy, pz) === false) {
      showNotice('That site is obstructed. Step clear and right-click another site.');
      return false;
    }
  }
  if (net.connected) {
    net.sendMachineMove(fromX, fromY, fromZ, px, py, pz); // server echoes edits + state
    audio.place(materialOf(Block.Autominer), new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5));
    return true;
  }
  // Offline: move the footprint + the live state object locally.
  const blockId = type === MachineType.OilDerrick ? Block.OilDerrick : Block.Autominer;
  for (let k = 0; k < h; k++) world.applyRemoteEdit(fromX, fromY + k, fromZ, Block.Air);
  machines.remove(fromX, fromY, fromZ); // deletes the map entry; `s` keeps the data
  relocateMachine(s); // fresh ground: the bore/well starts over
  world.setBlock(px, py, pz, blockId);
  for (let k = 1; k < h; k++) world.setBlock(px, py + k, pz, Block.MachinePart);
  machines.set(px, py, pz, s);
  audio.place(materialOf(blockId), new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5));
  showNotice('Machine moved!');
  return true;
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
      // An uncapped gusher catches fire instead of being flattened.
      if (igniteWell(m.state)) { machineFx(m.x, m.y, m.z, 'ignite'); continue; }
      if (m.state.fire > 0) continue;
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
        if (s.ammo > 0) {
          spawnDrop(x + 0.5, y + 0.3, z + 0.5, Item.Cannonball, Math.min(64, s.ammo));
        }
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
  turretModels.showRange(null);
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
  renderer.setPixelRatio(Math.min(
    window.devicePixelRatio, GRAPHICS_PRESETS[accessibility.graphicsQuality].pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

/** Push the chosen graphics preset into the renderer, the streamer and the fog.
 *  Everything here is live except MSAA, which is bound to the GL context. */
function applyGraphicsQuality(quality: GraphicsQuality): void {
  const preset = GRAPHICS_PRESETS[quality];
  world.renderDistance = Math.max(2, Math.min(RENDER_DISTANCE, preset.renderDistance));
  FOG_NEAR = world.renderDistance * 16 - 38;
  FOG_FAR = world.renderDistance * 16 - 6;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Smooth lighting is baked into the chunk geometry, so this queues a remesh
  // of everything loaded; the streamer works through it a few chunks a frame.
  world.setSmoothLighting(preset.smoothLighting);
  postfx.setEnabled(preset.shaders);
  postfx.setSize(window.innerWidth, window.innerHeight);
  // The rest of the shader preset: cast sun shadows and give the cloud decks
  // their volumetric shading. Both are inert on every preset below `max`.
  sunShadow.setEnabled(preset.shaders);
  sky.setShaders(preset.shaders);
  world.shaderModeUniform.value = preset.shaders ? 1 : 0;
}

// Screen state: 'title' shows the orbiting panorama + Play; 'paused' shows
// the pause menu over the frozen first-person view; 'playing' is locked.
const pauseEl = document.getElementById('pause')!;
const musicVolumeInput = document.getElementById('music-volume') as HTMLInputElement;
const effectsVolumeInput = document.getElementById('effects-volume') as HTMLInputElement;
const cameraShakeInput = document.getElementById('camera-shake') as HTMLInputElement;
const reducedMotionInput = document.getElementById('reduced-motion') as HTMLInputElement;
const contrastInput = document.getElementById('contrast-telegraphs') as HTMLInputElement;
const safeEffectsInput = document.getElementById('safe-effects') as HTMLInputElement;
const lookSensInput = document.getElementById('look-sensitivity') as HTMLInputElement;
const lookSensValue = document.getElementById('look-sensitivity-value')!;
const graphicsInput = document.getElementById('graphics-quality') as HTMLSelectElement;
lookSensInput.value = String(accessibility.lookSensitivity);
graphicsInput.value = accessibility.graphicsQuality;
musicVolumeInput.value = String(accessibility.musicVolume);
effectsVolumeInput.value = String(accessibility.effectsVolume);
cameraShakeInput.value = String(accessibility.cameraShake);
reducedMotionInput.checked = accessibility.reducedMotion;
contrastInput.checked = accessibility.highContrastTelegraphs;
safeEffectsInput.checked = accessibility.photosensitivitySafe;
let graphicsApplied = false;
const saveAccessUi = (): void => {
  accessibility.musicVolume = Number(musicVolumeInput.value);
  accessibility.effectsVolume = Number(effectsVolumeInput.value);
  accessibility.cameraShake = Number(cameraShakeInput.value);
  accessibility.reducedMotion = reducedMotionInput.checked;
  accessibility.highContrastTelegraphs = contrastInput.checked;
  accessibility.photosensitivitySafe = safeEffectsInput.checked;
  accessibility.lookSensitivity = Math.max(MIN_LOOK_SENSITIVITY,
    Math.min(MAX_LOOK_SENSITIVITY, Number(lookSensInput.value)));
  const quality = graphicsInput.value as GraphicsQuality;
  input.lookSensitivity = accessibility.lookSensitivity;
  lookSensValue.textContent = `${accessibility.lookSensitivity.toFixed(2)}\u00d7`;
  // Only on a real change: this reallocates the drawing buffer, and saveAccessUi
  // fires on every tick of every slider in the panel.
  if (quality !== accessibility.graphicsQuality || !graphicsApplied) {
    accessibility.graphicsQuality = quality;
    graphicsApplied = true;
    applyGraphicsQuality(quality);
  }
  saveAccessibility(accessibility);
  audio.setMusicVolume(accessibility.musicVolume);
  audio.setEffectsVolume(accessibility.effectsVolume);
  document.body.classList.toggle('reduced-motion', accessibility.reducedMotion);
  document.body.classList.toggle('high-contrast-telegraphs', accessibility.highContrastTelegraphs);
  document.body.classList.toggle('photosensitivity-safe', accessibility.photosensitivitySafe);
};
for (const el of [musicVolumeInput, effectsVolumeInput, cameraShakeInput,
  reducedMotionInput, contrastInput, safeEffectsInput, lookSensInput, graphicsInput]) {
  el.addEventListener('input', saveAccessUi);
}
saveAccessUi();
type Screen = 'title' | 'playing' | 'paused' | 'guide' | 'duel_results';
let screen: Screen = 'title';

function enterPlaying(): void {
  screen = 'playing';
  document.body.classList.add('in-game');
  overlay.classList.add('hidden');
  pauseEl.style.display = 'none';
}
const pauseGuideBtn = document.getElementById('pause-guide-btn') as HTMLButtonElement;

function enterPause(): void {
  // Results/rematch is already a cursor-driven screen. Never put the pause
  // overlay behind it or recapture the pointer while players are voting.
  if (screen === 'duel_results') {
    pauseEl.style.display = 'none';
    if (input.locked) input.unlock();
    return;
  }
  screen = 'paused';
  pauseEl.style.display = 'flex';
  if (pauseGuideBtn) pauseGuideBtn.style.display = arenaActive ? 'none' : '';
}
function enterTitle(): void {
  interaction.armedMove = null;
  if (fieldGuide?.open) fieldGuide.closeSilently();
  screen = 'title';
  // Disarm any outstanding pointer request. Input re-asks for the pointer on
  // the next click or window focus now, and a stale "we still want it" flag
  // would grab the cursor back the moment you tabbed to the title screen.
  input.unlock();
  document.body.classList.remove('in-game');
  overlay.classList.remove('hidden');
  pauseEl.style.display = 'none';
  cleanupDuelSession(true);
  onVaultTransition(null);
  // The socket stays open for the menus; without this the server keeps our
  // body standing in the world and everyone else sees it frozen there.
  net.sendAway();
}


const fieldGuide = createFieldGuide({
  root: app,
  multiplayerActive: () => net.connected,
  onBackToPause: () => {
    screen = 'paused';
    pauseEl.style.display = 'flex';
  },
  onResume: () => resumePlay(),
});

pauseGuideBtn.addEventListener('click', () => {
  if (player.dead || screen !== 'paused' || arenaActive) return;
  screen = 'guide';
  pauseEl.style.display = 'none';
  fieldGuide.show();
});

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
const playBtnLabel = document.getElementById('play-btn-label')!;
const playPlayerCountEl = document.getElementById('play-player-count')!;
const controlsBtn = document.getElementById('controls-btn')!;
const menuBtns = document.getElementById('menu-btns')!;
const menuUser = document.getElementById('menu-user')!;
const authModeLabel = document.getElementById('auth-mode-label')!;

const livePlayerCountEls: Record<keyof Omit<PlayerCounts, 'play'>, HTMLElement> = {
  duels: document.getElementById('duels-live-count')!,
  parkour: document.getElementById('parkour-live-count')!,
  bridge: document.getElementById('bridge-live-count')!,
};

function renderLivePlayerCounts(): void {
  const connected = net.connected;
  const counts = livePlayerCounts;
  const setCount = (element: HTMLElement, count: number | null, context: string): void => {
    const state = connected ? count === null ? 'syncing' : 'live' : 'offline';
    const text = count === null
      ? connected ? 'Syncing…' : 'Offline'
      : `${count} ${count === 1 ? 'player' : 'players'} ${context}`;
    element.textContent = text;
    element.dataset.state = state;
    element.setAttribute('aria-label', count === null
      ? text : `${text} currently`);
  };

  // Offline single-player has one local participant. Minigames require the
  // multiplayer server, so their cards stay explicit about unavailable data.
  setCount(playPlayerCountEl, connected ? counts?.play ?? null : authed ? 1 : null,
    connected ? 'online' : 'local');
  for (const mode of ['duels', 'parkour', 'bridge'] as const) {
    setCount(livePlayerCountEls[mode], connected ? counts?.[mode] ?? null : null, 'active');
  }
}

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

// --- FACTIONS ---------------------------------------------------------------
// Registration used to assign your side to keep the war 50/50 and announce it on
// a card you could only accept. That whole path is gone: an account is created
// with NO faction, and the first time you press Play you get the ALLEGIANCE
// PLEDGE (faction_picker.ts) — both sides laid out with their roster — and the
// choice you make there is permanent.
//
// The pledge screen shares ONE WebGL bust board through gov_ui.ts, because the
// page has a hard ceiling on GL contexts and the world and the Duels ladder
// already spend two.
const factionPicker = new FactionPicker(app);

// --- THE POINTER-LOCK ARBITER ------------------------------------------------
// One question, asked in one place: does anything on screen need a cursor?
//
// Every panel used to answer that for itself, each carrying its own hand-copied
// list of the other panels — which is why the lists had drifted apart, and why
// opening the government menu released the pointer and then slammed the PAUSE
// menu up behind it (the pointer-lock listener's list had never heard of it).
// `cursorPanelOpen` is now the ONLY list. Add a panel to it and locking,
// unlocking, the pause fallback, the click-to-resume hint and the click-the-
// world safety net all learn about it at once.

/** Every overlay that needs a mouse. The class-based panels expose `.open`; the
 *  three hand-rolled full-screen cards are read straight off their display. */
function cursorPanelOpen(): boolean {
  return invUI.open || worldMap.open || warfareUI.open || chatBox.open
    || factionPicker.open
    || wardrobeUI.open || fieldGuide.open || tutorial.open || guideOpen
    || strategicPanel.style.display !== 'none'   // helipad bay
    || trapPanel.style.display !== 'none'        // trap wiring panel
    || revivePanel.style.display !== 'none'      // teammate revival picker
    || elimEl.style.display !== 'none';          // elimination banner
}

/** True when the WORLD should be holding the pointer: in play, alive, and with
 *  nothing over the top of it that you would need to click. */
function shouldHoldPointer(): boolean {
  return worldReady && screen === 'playing' && !player.dead && !cursorPanelOpen();
}

/**
 * Take the pointer, or hand it back, so the lock matches what is on screen.
 *
 * Safe to call every frame — which is exactly what `frame()` does, and what
 * makes this automatic rather than something each new panel has to remember.
 * The pointer is only re-asked for when the browser is neither holding it nor
 * still considering an earlier request, so a refused lock waits for the next
 * real gesture (input.ts re-asks on click / keypress / focus) instead of being
 * re-fired sixty times a second.
 */
function syncPointerLock(): void {
  if (shouldHoldPointer()) {
    if (!input.locked && !input.lockPending) input.lock();
  } else if (input.locked || input.lockPending) {
    input.unlock();
  }
}

/**
 * Drop into the world and take the pointer — the pause menu's Resume, the
 * briefing's Skip, the Play button, a duel arena opening under you.
 *
 * The order matters. These used to ask for the lock while `screen` still said
 * 'paused'/'guide'/'title' and let the resulting pointerlockchange call
 * `enterPlaying`. With the arbiter running every frame that race is lost: a
 * frame landing between the request and the browser granting it would see a
 * screen that is not 'playing', decide the world should not have the pointer,
 * and cancel the request. So the screen state moves FIRST, and the arbiter then
 * agrees with it.
 */
function resumePlay(): void {
  enterPlaying();
  syncPointerLock();
}

for (const panel of [factionPicker]) {
  // The arbiter would catch these on the next frame anyway; running it on the
  // open/close edge means the cursor is already there when the panel paints.
  panel.onOpen = syncPointerLock;
  panel.onClose = syncPointerLock;
}

/** Build the dossiers the pledge screen reads. Offline there is exactly one
 *  citizen — you — so the dossiers are derived locally. */
function pledgeDossiers(): FactionPublic[] {
  if (net.connected && factionPublics.length) return factionPublics;
  return FACTIONS.map((f) => {
    const mine = localFaction === f.id && !!authedName;
    return {
      faction: f.id,
      members: mine ? [authedName] : [],
      memberCount: mine ? 1 : 0,
      faces: mine ? [{ username: authedName, cosmetics: myCosmetics }] : [],
    };
  });
}

/** Push the latest dossiers into the pledge screen if it is up. */
function refreshPledgeScreen(): void {
  if (factionPicker.open) factionPicker.update(safePledgeData());
}

/** Show the allegiance pledge. Everything else waits behind it — an unpledged
 *  player has no side. */
function openFactionPicker(): void {
  factionPicker.show(safePledgeData());
}

/** The dossiers, or an empty set of them. Everything the cards show — the
 *  roster, the faces — is DECORATION around a choice that has to be makeable
 *  regardless: the screen renders one card per faction out of FACTIONS whether
 *  or not any dossier arrived, so a late sync can never be what stands between
 *  a new player and the world. */
function safePledgeData(): PledgeData {
  try {
    return { factions: pledgeDossiers() };
  } catch (e) {
    console.error('[PLEDGE] dossiers unavailable — showing the bare screen', e);
    return { factions: [] };
  }
}
// A glassy tick when a side is picked, and the fanfare when the oath is sworn.
factionPicker.onTick = (progress) => audio.healTick(0.8 + progress * 0.6);
factionPicker.onLand = () => audio.warfareAuthorized();
factionPicker.onPledge = (faction) => {
  if (net.connected) { net.sendPledge(faction); return; }
  // Offline we are our own authority, but the choice is just as permanent.
  const account = localAccounts.get(authedName);
  if (account && !isFaction(account.faction)) {
    localAccounts.pledge(authedName, faction, Date.now());
    saveLocalAccounts();
  }
  adoptFaction(faction);
  factionPicker.hide();
  spawnInOwnTerritory();
  startPlaying();
};

/** Adopt a faction everywhere it is mirrored on the client. */
function adoptFaction(faction: number): void {
  localFaction = faction;
  invalidateSelfAvatar();  // your body wears the new side's shirt
  refreshFlagless();       // the badge is about the side we just joined
  refreshNetInfo();
  refreshPledgeScreen();
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
  loadCosmetics(username); // per-account avatar look (Character screen)
  loadWardrobe(username);  // per-account cape collection (Capes screen)
  held.setSkin(skinSeed(username), myCosmetics); // first-person hand matches avatar
  overlay.classList.add('authenticated');
  titleCharacterPreview.setCosmetics(myCosmetics);
  authEl.style.display = 'none';
  menuBtns.style.display = 'flex'; // Civilization / Character / Controls appear once logged in
  playBtn.removeAttribute('disabled');
  menuUser.textContent = username;
  authErr.textContent = '';
  authStatus.textContent = '';
  clearElimination(); // you're in — no lockout panel hanging around
  refreshNetInfo();
  renderLivePlayerCounts();
  titleStatusTimer = 0; // your side + the war clock appear with the menu
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
function previewSession(username: string): void {
  overlay.classList.add('authenticated');
  authEl.style.display = 'none';
  menuBtns.style.display = 'flex';
  menuUser.textContent = username;
  playBtn.setAttribute('disabled', '');
}
function showSessionFailure(error: string): void {
  overlay.classList.remove('authenticated');
  sessionPending = false;
  menuBtns.style.display = 'none';
  authEl.style.display = '';
  playBtn.removeAttribute('disabled');
  authStatus.textContent = '';
  authErr.textContent = error;
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
  // May be NO_FACTION: an offline account swears allegiance on the pledge screen
  // exactly like an online one, and the choice is just as permanent.
  localFaction = account.faction;
  invalidateSelfAvatar(); // your third-person body reflects the new look/side
  refreshFlagless();
  onAuthSuccess(account.username);
  refreshPledgeScreen();
  spawnInOwnTerritory(); // never drop into enemy land (offline)
  // A fresh account has no side yet — the pledge screen comes up on Play.
  if (!freshRegister) restoreOfflineInventory(); // bring back saved single-player stuff
  restoreOfflineHearts(); // fresh accounts fall back to the 10-heart start
  restoreOfflineTotems(); // attuned Waypoint Totems (fast travel)
  restoreOfflineWarfare(); // Warfare Command technology (offline mirror)
  issueOfflineSession(account.username);
}

/** Try to resume a saved session (no password). Falls back to the normal
 *  login form if the token is stale or the account is gone. */
function attemptSessionAuth(sess: { u: string; t: string }, retries = 12): void {
  if (authed) return;
  if (net.socketOpen) {
    sessionPending = true;
    net.sendSession(sess.u, sess.t);
  } else if (net.offline) {
    const res = localAccounts.sessionLogin(sess.u, sess.t);
    if (!res.ok || !res.account) {
      clearSession();
      showSessionFailure('Session expired — please log in again.');
      return;
    }
    finishOfflineAuth(res.account, false);
  } else if (retries > 0) {
    setTimeout(() => attemptSessionAuth(sess, retries - 1), 350);
  } else {
    showSessionFailure('Could not reach the server. Try again.');
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
    if (mode === 'register') { net.sendRegister(username, password); }
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
// A two-way segmented control, so which mode you are in is visible at a glance
// rather than hidden in a sentence of microcopy below the form.
const tabRegister = document.getElementById('tab-register')!;
const tabLogin = document.getElementById('tab-login')!;
const authTitle = document.querySelector<HTMLElement>('#auth .auth-title')!;
// Show / hide the passphrase. Only ever changes the input type — the value
// never leaves the field.
const passToggle = document.getElementById('pass-toggle') as HTMLButtonElement;
passToggle.addEventListener('click', () => {
  const show = authPass.type === 'password';
  authPass.type = show ? 'text' : 'password';
  passToggle.setAttribute('aria-pressed', String(show));
  passToggle.setAttribute('aria-label', show ? 'Hide passphrase' : 'Show passphrase');
  authPass.focus();
});
let authMode: 'register' | 'login' = 'register';
// Remember the last account that logged in (username only) so a returning player
// lands on a prefilled login instead of retyping it.
let lastUser = '';
try { lastUser = localStorage.getItem('voxelon.lastUser') || ''; } catch { /* ignore */ }
function setAuthMode(mode: 'register' | 'login'): void {
  authMode = mode;
  authErr.textContent = '';
  authStatus.textContent = '';
  for (const [tab, active] of [
    [tabRegister, mode === 'register'], [tabLogin, mode === 'login'],
  ] as const) {
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  if (mode === 'register') {
    submitBtn.textContent = 'Enlist';
    authTitle.textContent = 'Enter the war';
    authModeLabel.textContent =
      'Roll a callsign and pick a passphrase. Your soldier, kit and side ' +
      'are kept with the account.';
    authUser.readOnly = true;          // names are random-only on register
    rollBtn.style.display = '';
    // ALWAYS roll a fresh name on entering register — never keep a name typed
    // while in login mode (switching login→signup must not carry it over).
    rollUsername();
  } else {
    submitBtn.textContent = 'Log in';
    authTitle.textContent = 'Welcome back';
    authModeLabel.textContent =
      'Sign in and the world picks up exactly where you left it.';
    authUser.readOnly = false;         // type your existing name to log in
    authUser.value = lastUser;         // prefill the remembered account
    rollBtn.style.display = 'none';
    if (lastUser) authPass.focus(); else authUser.focus();
  }
}
// Re-entering the mode you are already in would silently re-roll your callsign.
tabRegister.addEventListener('click', () => {
  if (authMode !== 'register') setAuthMode('register');
});
tabLogin.addEventListener('click', () => {
  if (authMode !== 'login') setAuthMode('login');
});

// --- Elimination countdown on the title screen ------------------------------
// A knocked-out player lands back here, so the wait is shown as a LIVE ticking
// clock rather than a one-off error line. A permanent elimination (your faction
// had no flag) says so plainly instead of counting toward a date in 2286.
const elimPanel = document.createElement('div');
elimPanel.className = 'mc-font';
// Matches the daylight title screen it sits on: white glass, crimson ink.
elimPanel.style.cssText =
  'display:none;position:absolute;left:50%;bottom:26px;transform:translateX(-50%);z-index:8;' +
  'width:min(430px,calc(100vw - 36px));padding:14px 18px;border-radius:16px;' +
  'background:linear-gradient(180deg,rgba(255,244,245,.96),rgba(255,236,238,.94));' +
  'border:1px solid rgba(212,52,63,.3);color:#8f1d27;font-size:12.5px;text-align:center;' +
  'line-height:1.55;text-shadow:none;backdrop-filter:blur(12px);' +
  'box-shadow:0 22px 48px rgba(157,31,40,.18),inset 0 1px rgba(255,255,255,.9);';
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
      `<b style="font-size:17px">${iconSvg('skull')} ELIMINATED — FOREVER</b><br>` +
      'You ran out of hearts while your faction held no flag.<br>' +
      'There is no comeback from this one. Ask an admin for a fresh start.';
    elimPanel.style.display = 'block';
    return;
  }
  if (!elimUntilMs) { elimPanel.style.display = 'none'; return; }
  const left = elimUntilMs - Date.now();
  if (left <= 0) {
    elimPanel.innerHTML =
      `<b style="font-size:17px">${iconSvg('sparkle')} You're back!</b><br>Log in to rejoin the war with 3 hearts.`;
    elimPanel.style.display = 'block';
    return;
  }
  const h = Math.floor(left / 3600000);
  const m = Math.floor(left / 60000) % 60;
  const sec = Math.floor(left / 1000) % 60;
  const clock = `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  elimPanel.innerHTML =
    `<b style="font-size:17px">${iconSvg('skull')} ELIMINATED</b><br>` +
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
    // Only a REAL token rejection invalidates the saved session. Transient
    // refusals (attempt throttle, elimination countdown, a hiccup) keep the
    // token so the next visit still resumes without a password.
    if (/session expired|authentication failed/i.test(error)) {
      clearSession();
      showSessionFailure('Session expired — please log in again.');
    } else {
      showSessionFailure(error);
    }
    return;
  }
  authErr.textContent = error;
};
submitBtn.addEventListener('click', () => attemptAuth(authMode));
authPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptAuth(authMode); });
// Returning players land on a prefilled login; first-timers get register.
// A #register / #login hash (a deep link directly to either tab) wins
// over both — the visitor already told us which door they wanted.
const hashMode = location.hash.toLowerCase();
setAuthMode(hashMode === '#register' ? 'register'
  : hashMode === '#login' ? 'login'
  : lastUser ? 'login' : 'register');
// A saved session skips the form entirely (resume as soon as we know whether
// the server is reachable; a stale token falls back to the login form).
{
  const sess = loadSession();
  if (sess) {
    previewSession(sess.u);
    attemptSessionAuth(sess);
  }
}
// Log Out (title menu): forget the saved session + reload back to the form.
document.getElementById('logout-btn')!.addEventListener('click', () => {
  clearSession();
  location.reload();
});

/** Drop into the world once it has streamed in. The wait is shared by the Play
 *  button and the pledge screen's hand-off, so swearing allegiance can never
 *  drop somebody into chunks that do not exist yet. */
function startPlaying(): void {
  if (worldReady) { beginPlay(); return; }
  // World usually finished streaming during the title; if not, wait briefly
  // (still no full-screen loading screen) before dropping in.
  playBtnLabel.textContent = 'Preparing…';
  const wait = (): void => {
    if (worldReady) { playBtnLabel.textContent = 'Play'; beginPlay(); }
    else setTimeout(wait, 100);
  };
  wait();
}

playBtn.addEventListener('click', () => {
  if (!authed) return;
  audio.resume();
  // No side yet? Then Play means CHOOSE ONE first. The pledge screen is the only
  // way onto a faction, and it is shown before the world rather than over it, so
  // the decision is made with the dossiers in front of you and nothing else
  // happening. It hands off to startPlaying() itself once you swear.
  if (!isFaction(localFaction)) { openFactionPicker(); return; }
  startPlaying();
});

// --- THE ARENA: minigames browser, ranked ladder, Duels lobby and match -----
// One screen, three views, one colour system. Every accent on this screen is
// the player's own tier colour (from duels_progression.ts), pushed onto the
// DOM as --rank/--rank-accent/--rank-shade so the chip, the ladder, the lobby,
// the HUD and the result reveal can never disagree about what Gold looks like.
//
// Keep the deep-link token in the address bar throughout auth; the successful
// welcome consumes it, while a rejected/full lobby leaves the title intact.
const initialDuelToken = duelTokenFromUrl(location.href);
let pendingDuelToken = initialDuelToken;
let pendingDuelAttempted = false;
let pendingDuelRetry = 0;
let duelSnapshot: DuelLobbySnapshot | null = null;
let duelInviteToken = '';
let duelProfile: DuelPublicProfile = duelProfileOf(newDuelProgress());
let duelLeaderboardData: DuelLeaderboardEntry[] = [];
const duelInviteBanner = document.getElementById('duel-invite-banner')!;
net.onSocketOpen = () => {
  if (initialDuelToken) net.sendDuelInviteInfo(initialDuelToken);
};
net.onDuelInviteInfo = (valid, host, lobbyId) => {
  if (!initialDuelToken) return;
  duelInviteBanner.classList.add('visible');
  duelInviteBanner.textContent = valid && host
    ? `${host} is inviting you to Duel${lobbyId ? ` · Lobby ${lobbyId}` : ''}. Sign in or create an account to join.`
    : 'This Duel invite has expired. You can still sign in and create a new lobby.';
};

const minigamesBtn = document.getElementById('minigames-btn') as HTMLButtonElement;
const minigamesModal = document.getElementById('minigames-modal')!;
const minigamesClose = document.getElementById('minigames-close') as HTMLButtonElement;
const minigamesBrowser = document.getElementById('minigames-browser')!;
const minigamesLobby = document.getElementById('minigames-lobby')!;
const duelLobbyPanel = document.getElementById('duel-lobby-panel')!;
const partyLobbyPanel = document.getElementById('party-lobby-panel')!;
const duelsCardAction = document.getElementById('duels-card-action') as HTMLButtonElement;
const duelsPrivateAction = document.getElementById('duels-private-action') as HTMLButtonElement;
const duelQueueStatus = document.getElementById('duel-queue-status')!;
const duelLobbyTitle = document.getElementById('duel-lobby-title')!;
const duelInvite = document.getElementById('duel-invite') as HTMLInputElement;
const duelCopy = document.getElementById('duel-copy') as HTMLButtonElement;
const duelFeedback = document.getElementById('duel-feedback')!;
const duelRoster = document.getElementById('duel-roster')!;
const duelReadyBarFill = document.getElementById('duel-readybar-fill') as HTMLElement;
const duelReady = document.getElementById('duel-ready') as HTMLButtonElement;
const duelStart = document.getElementById('duel-start') as HTMLButtonElement;
const duelLeave = document.getElementById('duel-leave') as HTMLButtonElement;
const duelShare = document.getElementById('duel-share') as HTMLButtonElement;
const duelSteps = document.getElementById('duel-steps');
/** The host has copied or shared this lobby's link at least once. */
let duelInviteShared = false;
const duelProfileCard = document.getElementById('duel-profile-card')!;
const duelProfileEmblem = document.getElementById('duel-profile-emblem')!;
const duelRankName = document.getElementById('duel-rank-name')!;
const duelEloEl = document.getElementById('duel-elo')!;
const duelRankFill = document.getElementById('duel-rank-fill') as HTMLElement;
const duelRankNext = document.getElementById('duel-rank-next')!;
const duelProfileMeta = document.getElementById('duel-profile-meta')!;
const duelFlairList = document.getElementById('duel-flair')!;
const duelLeaderboardEl = document.getElementById('duel-leaderboard')!;
const duelRanksView = document.getElementById('duel-ranks-view')!;
const duelRanksHero = document.getElementById('duel-ranks-hero')!;
const duelLadder = document.getElementById('duel-ladder')!;
const arenaTabGames = document.getElementById('tab-games') as HTMLButtonElement;
const arenaTabLobby = document.getElementById('tab-lobby') as HTMLButtonElement;
const arenaTabLadder = document.getElementById('duel-ranks-button') as HTMLButtonElement;
let minigamesRestoreFocus: HTMLElement | null = null;
let duelQueued = false;

/** The emblem grid. Every tier's silhouette lives in `duels_progression`
 * (DUEL_SIGILS) so the Arena and the reveal all draw the
 * same mark from the same 5x5 string — nothing here invents a shape. */
const DUEL_EMBLEM_CELLS = DUEL_SIGIL_SIZE * DUEL_SIGIL_SIZE;

/** Push a rank's palette onto an element as CSS variables. */
function applyRankTheme(el: HTMLElement, rank: DuelRank): void {
  el.style.setProperty('--rank', rank.color);
  el.style.setProperty('--rank-accent', rank.accent);
  el.style.setProperty('--rank-shade', rank.shade);
  el.style.setProperty('--rank-weight', String(rank.facets));
}

function paintDuelEmblem(emblem: HTMLElement, rank: DuelRank): void {
  applyRankTheme(emblem, rank);
  emblem.classList.remove('tier-5', 'tier-6');
  if (rank.namedIndex >= 5) emblem.classList.add(`tier-${Math.min(6, rank.namedIndex)}`);
  const mask = rank.sigil || DUEL_SIGILS.crown;
  emblem.querySelectorAll<HTMLElement>('i').forEach((block, index) => {
    const lit = mask[index] === '#';
    block.classList.toggle('lit', lit);
    block.classList.toggle('dim', !lit);
  });
}

function makeDuelEmblem(rank: DuelRank, extraClass = ''): HTMLElement {
  const emblem = document.createElement('div');
  emblem.className = `duel-emblem ${extraClass}`.trim();
  emblem.setAttribute('aria-hidden', 'true');
  const n = DUEL_SIGIL_SIZE;
  for (let i = 0; i < DUEL_EMBLEM_CELLS; i++) {
    const col = i % n, row = Math.floor(i / n);
    const block = document.createElement('i');
    // Blocks assemble outward from the centre, so the mark builds itself.
    const ring = Math.max(Math.abs(col - (n - 1) / 2), Math.abs(row - (n - 1) / 2));
    block.style.setProperty('--block-delay', `${ring * 46 + ((col + row) % 3) * 12}ms`);
    block.style.setProperty('--shard-x', `${(col - (n - 1) / 2) * 15}px`);
    block.style.setProperty('--shard-y', `${(row - (n - 1) / 2) * 14}px`);
    emblem.appendChild(block);
  }
  paintDuelEmblem(emblem, rank);
  return emblem;
}

/** The label a profile shows publicly: Provisional hides the tier until the
 * five placement matches are done, exactly like the server's own reveal. */
function duelRankLabel(profile: { placementsRemaining: number; rank: DuelRank }): string {
  return profile.placementsRemaining > 0 ? 'Provisional' : profile.rank.label;
}

// ── The ladder ─────────────────────────────────────────────────────────────
function renderDuelLadder(): void {
  const { rank: current, next, progress, rpIntoDivision } = duelRankProgress(duelProfile.rp);
  const peakNamed = duelRankAt(duelProfile.peakRp).namedIndex;
  applyRankTheme(duelRanksHero, current);

  const provisional = duelProfile.placementsRemaining > 0;
  const detail = provisional
    ? `${duelProfile.placementsRemaining} placement match${duelProfile.placementsRemaining === 1 ? '' : 'es'} before your tier is revealed. RP is already moving: ${rpIntoDivision}/100 through the highlighted division.`
    : next ? `${100 - rpIntoDivision} RP to ${next.label} — ${Math.round(progress * 100)}% of the way through this division.`
      : `${rpIntoDivision}/100 through Voxelon I. There is no ceiling above this.`;
  const voxelonFloor = DUEL_DIVISIONS.find((entry) => entry.name === 'Voxelon')!.min;
  const overall = Math.min(100, Math.round(duelProfile.rp / voxelonFloor * 100));

  duelRanksHero.replaceChildren();
  duelRanksHero.append(makeDuelEmblem(current, 'lg'));
  const copy = document.createElement('div');
  const eyebrow = document.createElement('small'); eyebrow.textContent = 'Your standing';
  const title = document.createElement('strong');
  title.textContent = `${provisional ? 'Provisional' : current.label} · ${duelProfile.rp} RP`;
  const description = document.createElement('p'); description.textContent = detail;
  const motto = document.createElement('em'); motto.textContent = `“${current.motto}”`;
  copy.append(eyebrow, title, description, motto);
  const climb = document.createElement('div'); climb.className = 'duel-ranks-overall';
  const climbLabel = document.createElement('small'); climbLabel.textContent = 'Climb to Voxelon';
  const climbValue = document.createElement('b'); climbValue.textContent = ` ${overall}%`;
  climbLabel.appendChild(climbValue);
  const climbTrack = document.createElement('div'); climbTrack.className = 'duel-ranks-overall-track';
  const climbFill = document.createElement('div'); climbFill.className = 'duel-ranks-overall-fill';
  climbFill.style.width = `${overall}%`;
  climbTrack.appendChild(climbFill); climb.append(climbLabel, climbTrack);
  duelRanksHero.append(copy, climb);

  // The ladder is laid out column-reverse, so Copper is appended first and
  // Voxelon ends up on top — you read it as a climb.
  duelLadder.replaceChildren();
  for (const [namedIndex, theme] of DUEL_TIER_THEMES.entries()) {
    const ranks = DUEL_DIVISIONS.filter((entry) => entry.namedIndex === namedIndex);
    const tier = document.createElement('div'); tier.className = 'duel-tier';
    tier.style.setProperty('--tier', theme.color);
    tier.style.setProperty('--tier-order', String(DUEL_TIER_THEMES.length - namedIndex - 1));
    tier.dataset.tier = String(namedIndex + 1);
    tier.style.setProperty('--tier-accent', theme.accent);
    tier.classList.toggle('current', current.namedIndex === namedIndex && !provisional);
    tier.classList.toggle('cleared', namedIndex < peakNamed);
    tier.classList.toggle('locked', namedIndex > peakNamed);
    tier.append(makeDuelEmblem(ranks[2]));

    const copyCell = document.createElement('div'); copyCell.className = 'duel-tier-copy';
    const name = document.createElement('strong'); name.textContent = theme.name;
    const line = document.createElement('em'); line.textContent = theme.motto;
    const meta = document.createElement('small');
    meta.textContent = `${ranks[0].min}+ RP · Title: ${theme.flair}`;
    copyCell.append(name, line, meta); tier.append(copyCell);

    const divisions = document.createElement('div'); divisions.className = 'duel-tier-divisions';
    // Divisions read left-to-right as III, II, I — the order you clear them.
    for (const entry of ranks) {
      const cell = document.createElement('div'); cell.className = 'duel-division';
      const isCurrent = entry.index === current.index && !provisional;
      cell.classList.toggle('current', isCurrent);
      cell.classList.toggle('done', entry.index < current.index);
      if (isCurrent) cell.setAttribute('aria-current', 'step');
      const label = document.createElement('b'); label.textContent = entry.division;
      const minimum = document.createElement('small'); minimum.textContent = `${entry.min} RP`;
      cell.append(label, minimum);
      if (isCurrent) {
        const meter = document.createElement('span'); meter.className = 'duel-division-progress';
        meter.style.setProperty('--division-progress', `${Math.round(progress * 100)}%`);
        meter.appendChild(document.createElement('i'));
        cell.appendChild(meter);
      }
      divisions.appendChild(cell);
    }
    tier.appendChild(divisions);
    if (current.namedIndex === namedIndex) {
      const you = document.createElement('span'); you.className = 'duel-tier-you';
      you.textContent = provisional ? 'PLACING' : 'YOU ARE HERE';
      tier.appendChild(you);
    }
    duelLadder.appendChild(tier);
  }

  const unlocked = unlockedDuelFlairs(duelProfile);
  duelFlairList.replaceChildren(...DUEL_FLAIRS.map((flair, index) => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'duel-flair-chip'; chip.textContent = flair;
    chip.style.setProperty('--tier', DUEL_TIER_THEMES[index].color);
    const owned = unlocked.includes(flair);
    chip.disabled = !owned;
    chip.setAttribute('aria-pressed', String(flair === duelProfile.equippedFlair));
    chip.title = owned ? `Equip ${flair}` : `Reach ${DUEL_TIER_THEMES[index].name} to unlock ${flair}`;
    chip.addEventListener('click', () => { if (owned) net.sendDuelFlair(flair); });
    return chip;
  }));
}

// ── The hall of fame ───────────────────────────────────────────────────────
// The ladder renders every listed account's REAL character as a live 3D bust:
// one shared WebGL canvas stretched over the panel draws each avatar into its
// own row (avatar_bust.ts), and pointing at a row makes that player salute.
// The board is built lazily — a player who never opens the Arena never pays
// for a second GL context — and degrades to a plain (still good-looking)
// medallion if the context can't be had.
let bustBoard: AvatarBustBoard | null = null;
let bustBoardFailed = false;
const DUEL_MEDALS = ['1st', '2nd', '3rd'];

function ensureBustBoard(): AvatarBustBoard | null {
  if (bustBoard || bustBoardFailed) return bustBoard;
  try {
    bustBoard = new AvatarBustBoard();
    bustBoard.mount(duelLeaderboardEl.parentElement ?? duelLeaderboardEl);
  } catch {
    bustBoardFailed = true; // no context to spare — the CSS medallions carry it
    bustBoard = null;
  }
  return bustBoard;
}

/** The ladder animates on its own clock: it is a title-screen panel, so it
 *  runs only while the Arena is actually open and showing the board. */
let bustLast = 0;
// One draw per bust per frame is a real cost on a long board, and nothing here
// benefits from 60Hz, so the ladder runs at ~30 and leaves the rest of the
// frame to the panorama behind it.
const BUST_FRAME = 1 / 30;
function bustFrame(now: number): void {
  requestAnimationFrame(bustFrame);
  if (!bustBoard || !minigamesModal.classList.contains('open')) { bustLast = now; return; }
  const dt = Math.min(0.1, bustLast ? (now - bustLast) / 1000 : 0);
  if (dt < BUST_FRAME) return;
  bustLast = now;
  bustBoard.render(dt);
}
requestAnimationFrame(bustFrame);

function renderDuelLeaderboard(): void {
  duelLeaderboardEl.replaceChildren();
  // The board is for settled ratings only: nobody still in placements shows up
  // here. The server already filters them out; we filter again so an older
  // server can never put a provisional row on the ladder.
  const ranked = duelLeaderboardData.filter((entry) => entry.placementsRemaining <= 0);
  if (!ranked.length) {
    const empty = document.createElement('div'); empty.className = 'duel-leaderboard-empty';
    empty.textContent = 'Nobody has finished their placements yet. Be the first name on the board.';
    duelLeaderboardEl.appendChild(empty);
    bustBoard?.setRoster([]);
    return;
  }
  const busts: BustEntry[] = [];
  ranked.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'duel-lb-row';
    if (index < 3) row.classList.add('podium', `top${index + 1}`);
    if (entry.username.toLowerCase() === authedName.toLowerCase()) row.classList.add('me');
    applyRankTheme(row, entry.rank);

    const place = document.createElement('span');
    place.className = 'duel-lb-place';
    place.append(String(index + 1));
    if (index < 3) {
      const medal = document.createElement('small');
      medal.textContent = DUEL_MEDALS[index];
      place.appendChild(medal);
    }

    // The bust: a CSS medallion, plus the box the renderer scissors into.
    const bust = document.createElement('div'); bust.className = 'duel-lb-bust';
    const slot = document.createElement('div'); slot.className = 'duel-lb-slot';
    bust.appendChild(slot);
    busts.push({
      key: entry.username.toLowerCase(),
      cosmetics: sanitizeCosmetics(entry.cosmetics, skinSeed(entry.username)),
      slot,
      // Each podium place gets its own salute, so the top of the board never
      // plays the same animation three times running.
      pose: BUST_POSES[index % BUST_POSES.length],
    });

    const id = document.createElement('div'); id.className = 'duel-lb-id';
    const name = document.createElement('strong'); name.textContent = entry.username;
    const sub = document.createElement('span');
    sub.textContent = duelRankLabel(entry);
    const flair = document.createElement('em');
    flair.textContent = ` · ${entry.equippedFlair}`;
    sub.appendChild(flair);
    id.append(name, sub);

    const emblem = makeDuelEmblem(entry.rank, 'sm');

    const score = document.createElement('div'); score.className = 'duel-lb-score';
    const rp = document.createElement('b'); rp.textContent = `${entry.rp} RP`;
    const played = entry.wins + entry.losses;
    const winRate = played > 0 ? Math.round(entry.wins / played * 100) : 0;
    const record = document.createElement('small');
    record.textContent = played > 0
      ? `${entry.wins}W · ${entry.losses}L · ${winRate}%`
      : `${entry.wins}W · ${entry.losses}L`;
    const track = document.createElement('div'); track.className = 'duel-lb-winrate';
    const fill = document.createElement('i'); fill.style.width = `${winRate}%`;
    track.appendChild(fill);
    score.append(rp, record, track);

    row.append(place, bust, id, emblem, score);
    // Pointing at a row is the whole invitation: the avatar dollies out and
    // throws its pose for as long as you stay on it.
    const key = entry.username.toLowerCase();
    row.addEventListener('pointerenter', () => bustBoard?.setHover(key));
    row.addEventListener('pointerleave', () => bustBoard?.setHover(null));
    duelLeaderboardEl.appendChild(row);
  });
  ensureBustBoard()?.setRoster(busts);
}

function renderDuelProgress(): void {
  const { rank, next, progress } = duelRankProgress(duelProfile.rp);
  // The whole Arena — and the result screen — wears the local player's colours.
  applyRankTheme(duelProfileCard, rank);
  applyRankTheme(minigamesModal, rank);
  applyRankTheme(duelResultEl, rank);
  paintDuelEmblem(duelProfileEmblem, rank);
  duelRankName.textContent = duelRankLabel(duelProfile);
  duelEloEl.textContent = `${duelProfile.rp} RP`;
  duelRankFill.style.width = `${Math.round(progress * 100)}%`;
  duelRankNext.textContent = duelProfile.placementsRemaining > 0
    ? `${duelProfile.placementsRemaining} placement match${duelProfile.placementsRemaining === 1 ? '' : 'es'} left`
    : next ? `${next.min - duelProfile.rp} RP to ${next.label}` : 'Voxelon I · no ceiling';
  duelProfileMeta.textContent = duelProfile.streak > 1
    ? `${duelProfile.streak} win streak · ${duelProfile.wins}W ${duelProfile.losses}L · ${duelProfile.equippedFlair}`
    : `${duelProfile.wins}W ${duelProfile.losses}L · Peak ${duelRankAt(duelProfile.peakRp).label} · ${duelProfile.equippedFlair}`;
  renderDuelLadder();
  renderDuelLeaderboard();
}

function duelInviteUrl(token: string): string {
  return withDuelToken(location.href, token);
}

function setDuelParam(token: string | null): void {
  history.replaceState(history.state, '', withDuelToken(location.href, token));
}

function modalFocusable(): HTMLElement[] {
  return [...minigamesModal.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);
}

function refreshDuelsAvailability(): void {
  const online = net.connected;
  duelsCardAction.setAttribute('aria-disabled', String(!online));
  duelsCardAction.setAttribute('aria-pressed', String(duelQueued));
  duelsPrivateAction.setAttribute('aria-disabled', String(!online || duelQueued));
  duelsCardAction.textContent = online ? (duelQueued ? 'Cancel Queue' : 'Play') : 'Multiplayer server required';
  if (!online) duelQueueStatus.textContent = 'Connect to multiplayer to play Duels.';
  else if (duelQueued) duelQueueStatus.textContent = 'Finding you an opponent…';
  else duelQueueStatus.textContent = '';
}

// ── View switching ─────────────────────────────────────────────────────────
type ArenaView = 'games' | 'lobby' | 'ladder';
let arenaView: ArenaView = 'games';
/** A Bridge/Parkour private lobby is open and owns the Lobby tab. */
let partyLobbyLive = false;

function showArenaView(view: ArenaView): void {
  // The Lobby tab only exists while you are actually in one.
  if (view === 'lobby' && !duelSnapshot && !partyLobbyLive) view = 'games';
  arenaView = view;
  minigamesBrowser.hidden = view !== 'games';
  minigamesLobby.hidden = view !== 'lobby';
  duelLobbyPanel.hidden = !duelSnapshot;
  partyLobbyPanel.hidden = !!duelSnapshot || !partyLobbyLive;
  duelRanksView.hidden = view !== 'ladder';
  const tabs: [HTMLButtonElement, ArenaView][] =
    [[arenaTabGames, 'games'], [arenaTabLobby, 'lobby'], [arenaTabLadder, 'ladder']];
  for (const [tab, id] of tabs) tab.setAttribute('aria-selected', String(id === view));
  if (view === 'ladder') renderDuelLadder();
}

function refreshArenaTabs(): void {
  const inLobby = !!duelSnapshot || partyLobbyLive;
  arenaTabLobby.disabled = !inLobby;
  arenaTabLobby.replaceChildren(document.createTextNode('Lobby'));
  if (inLobby) {
    const dot = document.createElement('span'); dot.className = 'arena-tab-dot';
    arenaTabLobby.appendChild(dot);
  }
  if (!inLobby && arenaView === 'lobby') showArenaView('games');
}

function showDuelBrowser(): void { refreshArenaTabs(); showArenaView('games'); }
function showDuelLobby(): void { refreshArenaTabs(); showArenaView('lobby'); }

function openMinigames(focusLobby = false): void {
  minigamesRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : minigamesBtn;
  refreshDuelsAvailability();
  refreshPartyAvailability();
  refreshArenaTabs();
  minigamesModal.classList.add('open');
  minigamesModal.setAttribute('aria-hidden', 'false');
  if (focusLobby && (duelSnapshot || partyLobbyLive)) showDuelLobby();
  requestAnimationFrame(() => (focusLobby && duelSnapshot ? duelReady : minigamesClose).focus());
}

/** Land on the GAMES tab of the arena browser and touch nothing else.
 *
 *  Coming out of a match, the browser is where every next decision is made —
 *  a different mode, a rematch, the ladder — so leaving a match always shows
 *  the board of games rather than the lobby of the room you just left. The
 *  Lobby tab is still one click away (and still wears its dot) whenever a
 *  private lobby actually survived the match. */
function openGamesTab(): void {
  openMinigames();
  showDuelBrowser();
}

/** Land on the Games tab and press one card's Play button, exactly as if the
 *  player had done it themselves — same queue path, same aria state, same
 *  "Cancel Queue" affordance to back out with. Used by every "play again"
 *  control so the result screen never has a private route into matchmaking
 *  that the board itself does not have. */
function pressMinigamePlay(mode: 'duels' | 'bridge' | 'parkour'): void {
  openGamesTab();
  const card = mode === 'duels' ? duelsCardAction
    : mode === 'bridge' ? partyCardAction : parkourCardAction;
  if (card.getAttribute('aria-disabled') === 'true') return;
  card.click();
  // `openMinigames` parks focus on the close button from inside a rAF. Ours is
  // queued after it, so the pressed card keeps the focus ring rather than
  // losing it a frame later.
  requestAnimationFrame(() => card.focus());
}

function closeMinigames(): void {
  minigamesModal.classList.remove('open');
  minigamesModal.setAttribute('aria-hidden', 'true');
  minigamesRestoreFocus?.focus();
  minigamesRestoreFocus = null;
}

// ── Lobby ──────────────────────────────────────────────────────────────────
/** Stable per-player colour, shared by the lobby avatar and the match pills. */
function duelSkinColor(skin: number): string {
  return `hsl(${((skin % 360) + 360) % 360} 68% 56%)`;
}

/** A lobby seat's avatar: a small CSS voxel head that turns slowly in 3D,
 *  painted in the player's stable skin colour. */
function lobbyAvatar(skin: number): HTMLElement {
  const avatar = document.createElement('span'); avatar.className = 'duel-avatar fl-head';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.style.setProperty('--skin', duelSkinColor(skin));
  avatar.style.setProperty('--spin-delay', `${-(Math.abs(skin) % 7)}s`);
  const cube = document.createElement('span'); cube.className = 'fl-head-cube';
  for (let i = 0; i < 6; i++) cube.appendChild(document.createElement('i'));
  avatar.appendChild(cube);
  return avatar;
}

/** Tick off the three lobby steps: shared, joined, all ready. Each step only
 *  counts once the ones before it have. */
function paintLobbySteps(steps: HTMLElement | null, shared: boolean, joined: boolean, ready: boolean): void {
  if (!steps) return;
  const done = [shared || joined, joined, joined && ready];
  steps.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('done', done[i]);
    li.classList.toggle('now', !done[i] && (i === 0 || done[i - 1]));
  });
}

/** Copy an invite link, falling back to a selection copy. Plays the button's
 *  "copied" burst on success. Resolves with whether the copy landed. */
async function copyInviteLink(link: HTMLInputElement, button: HTMLElement): Promise<boolean> {
  let ok = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(link.value);
    ok = true;
  } catch {
    link.focus(); link.select();
    try { ok = document.execCommand('copy'); } catch { /* selection remains */ }
  }
  button.classList.remove('copied');
  if (ok) { void button.offsetWidth; button.classList.add('copied'); }
  return ok;
}

/** The native share sheet, where the platform has one. */
function wireLobbyShare(button: HTMLButtonElement, url: () => string, onShared: () => void): void {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  button.hidden = typeof nav.share !== 'function';
  button.onclick = () => {
    const href = url();
    if (!href || !nav.share) return;
    nav.share({ title: 'Join my VOXELON lobby', url: href }).then(onShared, () => { /* dismissed */ });
  };
}

function renderDuelLobby(): void {
  const snap = duelSnapshot;
  refreshArenaTabs();
  if (!snap) { showDuelBrowser(); return; }
  showDuelLobby();
  duelLobbyTitle.textContent = `Lobby ${snap.id}`;
  duelInvite.value = duelInviteToken ? duelInviteUrl(duelInviteToken) : '';
  duelInvite.parentElement!.toggleAttribute('hidden', !duelInviteToken);

  duelRoster.replaceChildren();
  for (const p of snap.participants) {
    const row = document.createElement('div'); row.className = 'duel-slot';
    if (p.ready && p.connected) row.classList.add('ready');
    if (p.id === net.myId) { row.classList.add('me'); applyRankTheme(row, p.profile.rank); }
    row.style.setProperty('--seat-i', String(duelRoster.childElementCount));
    const avatar = lobbyAvatar(p.skin);
    const name = document.createElement('strong');
    name.textContent = p.id === net.myId ? `${p.username} (you)` : p.username;
    if (p.host) {
      const host = document.createElement('span');
      host.className = 'duel-slot-host'; host.textContent = 'HOST';
      name.appendChild(host);
    }
    const rankLine = document.createElement('small'); rankLine.className = 'duel-player-rank';
    rankLine.style.setProperty('--slot-rank', p.profile.rank.color);
    rankLine.textContent = `${duelRankLabel(p.profile)} · ${p.profile.rp} RP`;
    const flair = document.createElement('span'); flair.textContent = p.profile.equippedFlair;
    rankLine.appendChild(flair);
    const state = document.createElement('span');
    state.className = `duel-slot-state ${!p.connected ? 'duel-gone' : p.ready ? 'duel-ready' : 'duel-waiting'}`;
    state.textContent = !p.connected ? 'Gone' : p.ready ? 'Ready' : 'Waiting';
    row.append(avatar, name, rankLine, state); duelRoster.appendChild(row);
  }
  // Empty seats are shown, not hidden: the room visibly has space for more.
  for (let i = snap.participants.length; i < snap.capacity; i++) {
    const slot = document.createElement('div');
    slot.className = 'duel-slot empty';
    slot.textContent = i < DUEL_MIN_PLAYERS ? 'Waiting for a challenger' : 'Open seat';
    duelRoster.appendChild(slot);
  }

  const me = snap.participants.find((p) => p.id === net.myId);
  const readyCount = snap.participants.filter((p) => p.ready && p.connected).length;
  paintLobbySteps(duelSteps, duelInviteShared, snap.participants.length >= DUEL_MIN_PLAYERS,
    readyCount === snap.participants.length && snap.participants.length >= DUEL_MIN_PLAYERS);
  // The bar tracks readiness of the people actually here, not of four seats.
  duelReadyBarFill.style.width = snap.participants.length
    ? `${Math.round(readyCount / snap.participants.length * 100)}%` : '0%';
  duelReady.textContent = me?.ready ? 'Cancel ready' : 'Ready up';
  duelReady.setAttribute('aria-pressed', String(me?.ready === true));
  duelReady.setAttribute('aria-disabled', String(snap.phase !== 'lobby'));
  const canStart = !!me?.host && snap.phase === 'lobby' &&
    snap.participants.length >= DUEL_MIN_PLAYERS && snap.participants.length <= snap.capacity &&
    snap.participants.every((p) => p.connected && p.ready);
  duelStart.setAttribute('aria-disabled', String(!canStart));
  duelStart.textContent = snap.phase === 'results' ? 'Match complete' : 'Start match';
  if (snap.phase === 'lobby' && !duelFeedback.textContent?.includes('copied')) {
    duelFeedback.textContent = canStart
      ? 'Everyone is ready. Drop them in.'
      : snap.participants.length < DUEL_MIN_PLAYERS
        ? 'Send the invite link — you need at least one opponent.'
        : `${readyCount}/${snap.participants.length} ready. Lock in when your loadout is set.`;
  }
  if (snap.phase === 'results' && snap.result) {
    const winner = snap.participants.find((p) => p.id === snap.result!.winner)?.username;
    duelFeedback.textContent = winner ? `${winner} took it — rematch voting is open for 15 seconds.` : 'Match complete.';
  }
}

minigamesBtn.addEventListener('click', () => openMinigames(!!duelSnapshot || partyLobbyLive));
arenaTabGames.addEventListener('click', () => showArenaView('games'));
arenaTabLobby.addEventListener('click', () => showArenaView('lobby'));
arenaTabLadder.addEventListener('click', () => showArenaView('ladder'));
minigamesClose.addEventListener('click', closeMinigames);
minigamesModal.addEventListener('mousedown', (event) => {
  if (event.target === minigamesModal) closeMinigames();
});
minigamesModal.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeMinigames();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = modalFocusable();
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

// 3D tilt on anything marked [data-tilt] (game cards, the lobby hero): the
// card leans toward the pointer and its art parallaxes inside the frame.
// Delegated, because the party lobby hero is rebuilt on every snapshot.
let tiltTarget: HTMLElement | null = null;
function resetTilt(el: HTMLElement): void {
  for (const prop of ['--px', '--py', '--rx', '--ry']) el.style.setProperty(prop, prop.startsWith('--r') ? '0deg' : '0px');
  el.classList.remove('tilting');
}
minigamesModal.addEventListener('pointermove', (event) => {
  const el = (event.target as Element | null)?.closest<HTMLElement>('[data-tilt]') ?? null;
  if (tiltTarget && tiltTarget !== el) resetTilt(tiltTarget);
  tiltTarget = el;
  if (!el || event.pointerType === 'touch') return;
  if (accessibility.reducedMotion || accessibility.photosensitivitySafe) return;
  const rect = el.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - .5;
  const y = (event.clientY - rect.top) / rect.height - .5;
  el.classList.add('tilting');
  el.style.setProperty('--px', `${x * -10}px`);
  el.style.setProperty('--py', `${y * -8}px`);
  el.style.setProperty('--ry', `${x * 9}deg`);
  el.style.setProperty('--rx', `${y * -7}deg`);
});
minigamesModal.addEventListener('pointerleave', () => { if (tiltTarget) resetTilt(tiltTarget); tiltTarget = null; });

// The Arena backdrop: a handful of voxel cubes drifting and turning in 3D.
{
  const field = document.getElementById('arena-voxels');
  const tints = ['#7dd3fc', '#fcd34d', '#a7f3d0', '#f9a8d4', '#c4b5fd', '#fdba74', '#93c5fd', '#86efac'];
  for (let n = 0; field && n < 12; n++) {
    const wrap = document.createElement('span'); wrap.className = 'ar-voxel';
    wrap.style.cssText = `--x:${(n * 37 + 7) % 96}%;--y:${(n * 53 + 11) % 88}%;--s:${14 + (n * 7) % 26}px;` +
      `--c:${tints[n % tints.length]};--d:${14 + (n % 5) * 3}s;--delay:${-n * 1.7}s;--z:${(n % 4) * 60 - 90}px`;
    const cube = document.createElement('span'); cube.className = 'ar-voxel-cube';
    for (let i = 0; i < 6; i++) cube.appendChild(document.createElement('i'));
    wrap.appendChild(cube); field.appendChild(wrap);
  }
}
for (const disabled of minigamesModal.querySelectorAll<HTMLButtonElement>('[aria-disabled="true"]')) {
  disabled.addEventListener('click', (event) => {
    if (disabled.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
}
duelsCardAction.addEventListener('click', () => {
  if (!net.connected) {
    duelQueueStatus.textContent = 'Duels requires a live multiplayer server.';
    return;
  }
  if (!duelQueued) {
    if (duelSnapshot) { net.sendDuelLeave(); duelSnapshot = null; duelInviteToken = ''; setDuelParam(null); }
    // Matchmaking can launch as soon as another player arrives, so checkpoint
    // the open-world body before entering the queue rather than waiting for a
    // private-lobby Ready click.
    duelLocalFallback = {
      state: inventory.serialize(), x: player.pos.x, y: player.pos.y, z: player.pos.z,
      yaw: player.yaw, pitch: player.pitch,
      health: player.health, dead: player.dead, mode: localMode,
    };
    pushStateSave();
  } else {
    duelLocalFallback = null;
  }
  net.sendDuelQueue(!duelQueued);
});
duelsPrivateAction.addEventListener('click', () => {
  if (!net.connected || duelsPrivateAction.getAttribute('aria-disabled') === 'true') return;
  duelInviteShared = false;
  duelQueueStatus.textContent = 'Creating your private party…';
  duelFeedback.textContent = 'Opening a private party…';
  net.sendDuelCreate();
});
duelReady.addEventListener('click', () => {
  if (duelReady.getAttribute('aria-disabled') === 'true') return;
  const me = duelSnapshot?.participants.find((p) => p.id === net.myId);
  // Checkpoint the exact current open-world inventory before consenting to a
  // match; match-time autosaves are suppressed on both client and server.
  if (!me?.ready) {
    duelLocalFallback = {
      state: inventory.serialize(), x: player.pos.x, y: player.pos.y, z: player.pos.z,
      yaw: player.yaw, pitch: player.pitch,
      health: player.health, dead: player.dead, mode: localMode,
    };
    pushStateSave();
  }
  net.sendDuelReady(!me?.ready);
});
duelStart.addEventListener('click', () => {
  if (duelStart.getAttribute('aria-disabled') !== 'true') net.sendDuelStart();
});
duelLeave.addEventListener('click', () => {
  net.sendDuelLeave(); duelSnapshot = null; duelInviteToken = ''; pendingDuelToken = '';
  if (pendingDuelRetry) window.clearTimeout(pendingDuelRetry); pendingDuelRetry = 0;
  duelLocalFallback = null;
  setDuelParam(null); showDuelBrowser(); duelFeedback.textContent = '';
  duelInviteShared = false;
});
duelCopy.addEventListener('click', async () => {
  if (!duelInvite.value) return;
  const copied = await copyInviteLink(duelInvite, duelCopy);
  duelFeedback.textContent = copied
    ? 'Invite copied. Send it to whoever you want to beat.'
    : 'Copy unavailable — the invite is selected.';
  if (copied) {
    duelInviteShared = true;
    duelCopy.textContent = 'Copied!';
    window.setTimeout(() => { duelCopy.textContent = 'Copy invite'; }, 1800);
    renderDuelLobby();
  }
});
wireLobbyShare(duelShare, () => duelInvite.value, () => { duelInviteShared = true; renderDuelLobby(); });

net.onDuelLobby = (snapshot, inviteToken) => {
  duelQueued = false;
  if (pendingDuelRetry) window.clearTimeout(pendingDuelRetry); pendingDuelRetry = 0;
  duelSnapshot = snapshot;
  syncDuelClock(snapshot.serverNow);
  if (inviteToken) {
    duelInviteToken = inviteToken;
    pendingDuelToken = inviteToken;
    setDuelParam(inviteToken);
  }
  if (snapshot.phase === 'lobby') {
    renderDuelLobby();
    if (!arenaActive) openMinigames(true);
  } else {
    playDuelFeed(snapshot.feed);
    renderDuelScoreboard();
    if (snapshot.phase === 'countdown' && duelResultData && duelResultVoteStatus) {
      duelResultVoteStatus.textContent = 'Rematch accepted · preparing the arena…';
      if (duelResultRematch) duelResultRematch.disabled = true;
    }
  }
};
net.onDuelQueue = (queued) => {
  duelQueued = queued;
  refreshDuelsAvailability();
};
net.onDuelError = (code, message) => {
  if (duelQueued) {
    duelQueued = false;
    refreshDuelsAvailability();
  }
  duelFeedback.textContent = message;
  if (code === 'invalid' || code === 'full' || code === 'match_in_progress') {
    duelSnapshot = null; showDuelBrowser(); openMinigames();
  }
  if (code === 'match_in_progress' && pendingDuelToken) {
    duelFeedback.textContent = `${message} Waiting for the lobby to reopen…`;
    pendingDuelAttempted = false;
    if (pendingDuelRetry) window.clearTimeout(pendingDuelRetry);
    pendingDuelRetry = window.setTimeout(() => {
      pendingDuelRetry = 0;
      if (!pendingDuelToken || pendingDuelAttempted || !net.connected) return;
      pendingDuelAttempted = true; net.sendDuelJoin(pendingDuelToken);
    }, 2_000);
  }
};

function joinPendingDuel(): void {
  if (!pendingDuelToken || pendingDuelAttempted || !net.connected) return;
  pendingDuelAttempted = true;
  openMinigames();
  duelFeedback.textContent = 'Joining private Duels lobby…';
  net.sendDuelJoin(pendingDuelToken);
}

// ── Match state ────────────────────────────────────────────────────────────
/** Duels health is a 40 HP pool. Drawn at the open world's 2 HP per icon that
 *  is twenty hearts in two stacked rows; at 4 it is the same familiar ten-icon
 *  row everything else uses, and reads at a glance mid-fight. */
const DUEL_HP_PER_HEART = 4;
// Generic arena state. The FLAG is shared by every minigame ("this client's
// body is temporary"); everything that used to be a `duelArenaActive &&
// <duel-specific thing>` conjunction is now a data lookup, so a third mode
// costs zero new gate sites.
let arenaActive = false;
let arenaKind: ArenaKind | null = null;
/** Display name of the mode currently borrowing this client's body. */
function arenaModeName(): string {
  return arenaKind === 'party' ? (partySnapshot?.mode === 'parkour' ? 'Parkour' : 'The Bridge')
    : 'Duels';
}
let arenaMaxHealth = 20;
let arenaHpPerHeart = 2;
/** Item ids whose reserve is infinite inside the current arena. */
let arenaUnlimited: ReadonlySet<number> = new Set<number>();
/** Per-mode build/break rules and containment. Null = use the world path. */
let arenaCanPlaceAt: ((x: number, y: number, z: number, held: number) => boolean) | null = null;
let arenaCanEditAt: ((x: number, y: number, z: number, held: number) => boolean) | null = null;
let arenaClampPos:
  ((p: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) | null = null;
let duelActiveBounds: DuelArenaBounds | null = null;
let duelArenaReadySent = false;
let duelReadyWatchdog = 0;

/** Confirm to the server that this client has the arena streamed.
 *
 *  This deliberately does NOT live only in the render loop. A Duels client
 *  whose window is in the background gets its animation frames throttled to
 *  nothing, so the ready never left, and the server's arena-load gate timed the
 *  whole match back to the lobby — which is what "Run it back does nothing"
 *  looked like from the other window. The watchdog below is a plain interval,
 *  and timers keep firing when frames do not. */
function markDuelArenaReady(): void {
  if (arenaKind !== 'duel' || duelArenaReadySent) return;
  duelArenaReadySent = true;
  net.sendDuelArenaReady();
  stopDuelReadyWatchdog();
}
function stopDuelReadyWatchdog(): void {
  if (duelReadyWatchdog) window.clearInterval(duelReadyWatchdog);
  duelReadyWatchdog = 0;
}
function startDuelReadyWatchdog(x: number, z: number): void {
  stopDuelReadyWatchdog();
  duelReadyWatchdog = window.setInterval(() => {
    if (!arenaActive || duelArenaReadySent) { stopDuelReadyWatchdog(); return; }
    // Well inside the server's 30s gate. The frame loop still pins the player
    // at the spawn until the collision bubble is genuinely built, so readying
    // early costs nothing but never strands the match.
    if (world.update(x,z,30,2)) markDuelArenaReady();
  }, 250);
}
let duelCountdownEndsAt = 0;
let duelRespawnAt = 0;
let duelSpectating = false;
let duelClockServer = 0;
let duelClockLocal = performance.now();
let duelLastCountdownCue = -1;
let duelLastLeaderKey = '';
let duelFinalMinuteShown = false;
let duelFinalThirtyPlayed = false;
let duelSuddenDeathPlayed = false;
let duelFightPlayed = false;
let duelFightCueUntil = 0;
let duelResultData: DuelResult | null = null;
let duelScoresHeld = false;
let duelResultVoteStatus: HTMLElement | null = null;
let duelResultRematch: HTMLButtonElement | null = null;
/** Our own "run it back" click, held until the server snapshot agrees. */
let duelRematchVoteSent = false;
/** "Queue again" was pressed; re-enter matchmaking once the body comes back. */
let duelRequeueOnReturn = false;
/** True while this duel came from an invite link rather than matchmaking. Only
 *  an invite lobby survives the match, so only it can offer a rematch vote. */
function duelFromInvite(): boolean { return duelInviteToken !== ''; }
let duelLocalFallback: {
  state: ReturnType<typeof inventory.serialize>;
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; dead: boolean; mode: GameMode;
} | null = null;

// Top-centre clock + one score pill per fighter.
const duelMatchHud = document.createElement('div');
duelMatchHud.className = 'duel-match-hud';
const duelClockEl = document.createElement('div'); duelClockEl.className = 'duel-clock';
const duelClockLabel = document.createElement('small'); duelClockLabel.textContent = 'Round';
const duelTimeEl = document.createElement('strong'); duelTimeEl.textContent = '5:00';
const duelClockBar = document.createElement('div'); duelClockBar.className = 'duel-clock-bar';
const duelClockBarFill = document.createElement('i'); duelClockBar.appendChild(duelClockBarFill);
duelClockEl.append(duelClockLabel, duelTimeEl, duelClockBar);
const duelPillsEl = document.createElement('div'); duelPillsEl.className = 'duel-score-pills';
duelMatchHud.append(duelClockEl, duelPillsEl);
app.appendChild(duelMatchHud);

const duelCenterCue = document.createElement('div');
duelCenterCue.className = 'duel-center-cue';
app.appendChild(duelCenterCue);

// The announcer slam and the kill feed both replay from the authoritative
// snapshot feed, so every client sees the same call at the same moment.
const duelAnnounceEl = document.createElement('div');
duelAnnounceEl.className = 'duel-announce';
duelAnnounceEl.setAttribute('role', 'status');
duelAnnounceEl.setAttribute('aria-live', 'polite');
const duelAnnounceTitle = document.createElement('b');
const duelAnnounceSub = document.createElement('small');
duelAnnounceEl.append(duelAnnounceTitle, duelAnnounceSub);
app.appendChild(duelAnnounceEl);

const duelKillFeedEl = document.createElement('div');
duelKillFeedEl.className = 'duel-killfeed';
duelKillFeedEl.setAttribute('aria-hidden', 'true');
app.appendChild(duelKillFeedEl);

const duelScoreboard = document.createElement('div');
duelScoreboard.className = 'duel-scoreboard';
const duelScorePanel = document.createElement('div'); duelScorePanel.className = 'duel-score-panel';
duelScoreboard.appendChild(duelScorePanel); app.appendChild(duelScoreboard);

const duelScoresTouch = document.createElement('button');
duelScoresTouch.className = 'duel-scores-touch'; duelScoresTouch.type = 'button';
duelScoresTouch.textContent = 'Scores'; duelScoresTouch.setAttribute('aria-label', 'Hold to see scores');
app.appendChild(duelScoresTouch);

// Shown whenever the game is live but the browser is holding on to the mouse.
// It is `pointer-events: none` on purpose: the click that dismisses it is the
// same click the canvas re-locks on, so there is nothing to aim at.
const clickResumeEl = document.createElement('div');
clickResumeEl.className = 'click-resume';
clickResumeEl.textContent = 'Click to take control';
app.appendChild(clickResumeEl);

const duelResultEl = document.createElement('div'); duelResultEl.className = 'duel-result';
duelResultEl.setAttribute('role', 'dialog'); duelResultEl.setAttribute('aria-modal', 'true');
duelResultEl.setAttribute('aria-label', 'Duels match result');
const duelResultCard = document.createElement('div'); duelResultCard.className = 'duel-result-card';
duelResultEl.appendChild(duelResultCard); app.appendChild(duelResultEl);

function duelNow(): number { return duelClockServer + (performance.now() - duelClockLocal); }
function syncDuelClock(serverNow: number): void {
  duelClockServer = serverNow; duelClockLocal = performance.now();
}
function formatDuelTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function duelStatus(p: DuelParticipant): string {
  if (!p.connected) return 'Disconnected';
  if (p.spectating && p.respawnAt) return 'Respawning';
  if (p.spectating) return 'Spectator';
  return p.alive ? 'Alive' : 'Respawning';
}

// ── The announcer ──────────────────────────────────────────────────────────
const DUEL_EVENT_COLORS: Record<DuelEventKind, string> = {
  first_blood: '#ff6d80', double_kill: '#7fd3f5', triple_kill: '#5ad0ff',
  quad_kill: '#a273f7', spree: '#ffd45e', rampage: '#ff9a3c',
  unstoppable: '#ff5f76', godlike: '#ff4f6e', shutdown: '#55e8a6',
  revenge: '#c08cff', match_point: '#ffe6a4',
};
let duelFeedSeen = 0;
let duelAnnounceUntil = 0;

function pushDuelFeedRow(title: string, sub: string, color: string): void {
  const row = document.createElement('div');
  row.style.setProperty('--feed', color);
  const tag = document.createElement('b'); tag.textContent = title;
  const text = document.createElement('span'); text.textContent = sub;
  row.append(tag, text);
  duelKillFeedEl.appendChild(row);
  while (duelKillFeedEl.childElementCount > 3) duelKillFeedEl.firstElementChild!.remove();
  window.setTimeout(() => row.remove(), 3_800);
}

function pushDuelKillFeed(event: DuelEvent): void {
  const copy = duelEventCopy(event);
  pushDuelFeedRow(copy.title, copy.sub, DUEL_EVENT_COLORS[event.kind]);
}

/** Every ordinary kill in a match, in the ONE corner Duels uses for them.
 *  The open-world kill feed draws in the same corner 70px higher, so letting
 *  both run put two different renderings of the same kill on screen at once. */
function pushDuelKill(killer: string, victim: string): void {
  pushDuelFeedRow(killer || 'ELIMINATED', victim, '#9fb6cc');
}

/** Replay any announcer beats this client has not shown yet. Beats are
 * idempotent by `seq`, so a dropped snapshot never loses or repeats a call. */
function playDuelFeed(feed: DuelEvent[]): void {
  if (!arenaActive) { duelFeedSeen = Math.max(duelFeedSeen, ...feed.map((e) => e.seq), 0); return; }
  const fresh = feed.filter((event) => event.seq > duelFeedSeen).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return;
  duelFeedSeen = fresh[fresh.length - 1].seq;
  for (const event of fresh) {
    // Yours are slammed over the crosshair a few lines below. Printing them in
    // the side feed as well is the same call twice, two inches apart.
    if (event.actor === net.myId || event.victim === net.myId) continue;
    pushDuelKillFeed(event);
  }
  // The centre of the screen belongs to beats YOU are part of. A four-player
  // arena generates a call every few seconds, and slamming every one of them
  // over the crosshair meant the loudest surface on screen was mostly other
  // people's business — the single biggest reason a match reads as noisy. A
  // rival's killing spree still reaches you the moment it involves you, which
  // is when you die to it; until then it is one line in the side feed.
  const mine = fresh.filter((event) => event.actor === net.myId || event.victim === net.myId);
  if (!mine.length) return;
  const headline = mine[mine.length - 1];
  const copy = duelEventCopy(headline);
  duelAnnounceEl.style.setProperty('--announce', DUEL_EVENT_COLORS[headline.kind]);
  duelAnnounceTitle.textContent = copy.title;
  duelAnnounceSub.textContent = copy.sub;
  duelAnnounceEl.classList.remove('visible', 'out');
  void duelAnnounceEl.offsetWidth;  // restart the slam animation
  duelAnnounceEl.classList.add('visible');
  duelAnnounceUntil = duelNow() + 2_200;
  audio.duelAnnounce(headline.kind);
}

function updateDuelAnnounce(now: number): void {
  if (!duelAnnounceEl.classList.contains('visible')) return;
  if (now < duelAnnounceUntil) return;
  if (!duelAnnounceEl.classList.contains('out')) {
    duelAnnounceEl.classList.add('out');
    duelAnnounceUntil = now + 400;
    return;
  }
  duelAnnounceEl.classList.remove('visible', 'out');
}

// ── Scoreboard ─────────────────────────────────────────────────────────────
function duelScoreRows(players: DuelParticipant[]): HTMLElement {
  const rows = document.createElement('div');
  const head = document.createElement('div'); head.className = 'duel-score-row header';
  for (const label of ['#', 'Player', 'Kills', 'Deaths', 'K/D']) {
    const cell = document.createElement('span'); cell.textContent = label; head.appendChild(cell);
  }
  const statusHead = document.createElement('span');
  statusHead.className = 'duel-score-status'; statusHead.textContent = 'Status';
  head.appendChild(statusHead);
  rows.appendChild(head);
  const topKills = players[0]?.kills ?? 0;
  players.forEach((p, index) => {
    const row = document.createElement('div');
    row.className = `duel-score-row${p.id === net.myId ? ' local' : ''}`;
    const place = document.createElement('span'); place.textContent = String(index + 1);
    const name = document.createElement('strong');
    if (p.kills === topKills && topKills > 0) {
      const mark = document.createElement('span');
      mark.className = 'duel-leader-mark'; mark.innerHTML = iconSvg('diamond');
      name.appendChild(mark);
    }
    const who = document.createElement('span'); who.textContent = p.username;
    name.appendChild(who);
    if (p.spree >= 3) {
      const spree = document.createElement('span');
      spree.className = 'duel-score-spree'; spree.textContent = `${p.spree}×`;
      name.appendChild(spree);
    }
    const kills = document.createElement('span');
    kills.className = 'duel-score-kills'; kills.textContent = String(p.kills);
    const deaths = document.createElement('span'); deaths.textContent = String(p.deaths);
    const kd = document.createElement('span');
    kd.textContent = p.deaths === 0 ? p.kills.toFixed(1) : (p.kills / p.deaths).toFixed(2);
    const status = document.createElement('span');
    status.className = `duel-score-status ${p.alive ? 'duel-status-alive' : 'duel-status-out'}`;
    status.textContent = duelStatus(p);
    row.append(place, name, kills, deaths, kd, status);
    rows.appendChild(row);
  });
  return rows;
}

function renderDuelScoreboard(): void {
  const players = duelResultData?.scoreboard ?? duelSnapshot?.participants ?? [];
  duelScorePanel.replaceChildren();
  const head = document.createElement('div'); head.className = 'duel-score-head';
  const title = document.createElement('div');
  const kicker = document.createElement('small');
  kicker.textContent = duelSnapshot?.phase === 'sudden_death' ? 'Sudden death' : 'Prism Colosseum';
  const heading = document.createElement('h2'); heading.textContent = 'Scoreboard';
  title.append(kicker, heading);
  const hint = document.createElement('small');
  hint.textContent = duelResultData ? 'Final' : `First to ${DUEL_SCORE_LIMIT}`;
  head.append(title, hint); duelScorePanel.append(head, duelScoreRows(players));
}

function setDuelScoresVisible(visible: boolean): void {
  duelScoresHeld = visible;
  duelScoreboard.classList.toggle('visible', visible && arenaActive && !duelResultData);
  if (visible) renderDuelScoreboard();
}
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !arenaActive || duelResultData) return;
  event.preventDefault();
  if (!event.repeat) setDuelScoresVisible(true);
});
window.addEventListener('keyup', (event) => {
  if (event.key === 'Tab' && arenaActive) { event.preventDefault(); setDuelScoresVisible(false); }
});
window.addEventListener('blur', () => setDuelScoresVisible(false));
for (const type of ['pointerdown', 'touchstart'] as const) {
  duelScoresTouch.addEventListener(type, (event) => { event.preventDefault(); setDuelScoresVisible(true); });
}
for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const) {
  duelScoresTouch.addEventListener(type, (event) => { event.preventDefault(); setDuelScoresVisible(false); });
}

// ── Result reveal ──────────────────────────────────────────────────────────
let duelRevealFrame = 0;

function duelChangeSummary(change: DuelProgressChange): string {
  const direction = change.change >= 0 ? `gained ${change.change}` : `lost ${Math.abs(change.change)}`;
  const protection = change.shieldUsed ? ` Promotion shield held the floor at ${change.protectedFloor} RP.` : '';
  const reveal = change.placementReveal ? ` Placement complete: ${change.newRank.label}.` : '';
  const unlock = change.newlyUnlockedFlair ? ` Unlocked the title ${change.newlyUnlockedFlair}.` : '';
  return `${direction} RP, from ${change.beforeRp} to ${change.afterRp}. ${change.newRank.label}.${protection}${reveal}${unlock}`;
}

/** Headline chips under the result title: the moments worth remembering. */
function duelResultRecap(result: DuelResult): string[] {
  const chips: string[] = [];
  const best = [...result.scoreboard].sort((a, b) => b.bestSpree - a.bestSpree)[0];
  if (best && best.bestSpree >= 3) chips.push(`Best spree · ${best.username} ×${best.bestSpree}`);
  const firstBlood = result.feed.find((event) => event.kind === 'first_blood');
  if (firstBlood) chips.push(`First blood · ${firstBlood.actorName}`);
  const biggest = result.feed.filter((event) => event.kind === 'godlike' ||
    event.kind === 'unstoppable' || event.kind === 'quad_kill').pop();
  if (biggest) chips.push(duelEventCopy(biggest).title);
  const total = result.scoreboard.reduce((sum, p) => sum + p.kills, 0);
  chips.push(`${total} total kills`);
  return chips;
}

function renderDuelResult(result: DuelResult): void {
  cancelAnimationFrame(duelRevealFrame);
  duelResultData = result; duelRematchVoteSent = false;
  screen = 'duel_results'; input.unlock();
  pauseEl.style.display = 'none';
  duelAnnounceEl.classList.remove('visible', 'out');
  duelKillFeedEl.replaceChildren();
  for (const change of result.progressChanges) if (change.id !== net.myId) remotePlayers.invalidate(change.id);
  const winner = result.scoreboard.find((p) => p.id === result.winner);
  const mine = result.winner === net.myId;
  audio.duelCue(mine ? 'victory' : 'defeat');
  duelResultCard.replaceChildren();
  const kicker = document.createElement('div'); kicker.className = 'duel-result-kicker';
  kicker.textContent = mine ? 'Victory' : result.winner === null ? 'Match complete' : 'Defeat';
  const title = document.createElement('h2');
  title.textContent = winner ? (mine ? 'You win' : `${winner.username} wins`) : 'No winner';
  const summary = document.createElement('p'); summary.className = 'duel-result-summary';
  const reasonText: Record<DuelResult['finishReason'], string> = {
    time: 'full time', score: `score limit — ${DUEL_SCORE_LIMIT} kills`,
    sudden_death: 'sudden death', forfeit: 'forfeit', cancelled: 'cancelled',
  };
  summary.textContent = `${formatDuelTime(result.durationMs)} · ${reasonText[result.finishReason]}`;
  const recap = document.createElement('div'); recap.className = 'duel-result-recap';
  for (const text of duelResultRecap(result)) {
    const chip = document.createElement('span'); chip.textContent = text; recap.appendChild(chip);
  }
  const scores = document.createElement('div'); scores.className = 'duel-result-score';
  scores.appendChild(duelScoreRows(result.scoreboard));

  const rating = result.progressChanges.find((change) => change.id === net.myId);
  const ratingReveal = document.createElement('div'); ratingReveal.className = 'duel-rating-reveal';
  let revealNow: HTMLButtonElement | null = null;
  if (rating) {
    applyRankTheme(duelResultEl, rating.oldRank);
    applyRankTheme(ratingReveal, rating.oldRank);
    ratingReveal.classList.toggle('loss', rating.change < 0);
    const revealEmblem = makeDuelEmblem(rating.oldRank, 'lg duel-reveal-emblem');
    const crestStage = document.createElement('div'); crestStage.className = 'duel-crest-stage';
    const effects = document.createElement('div'); effects.className = 'duel-ascension-fx';
    effects.setAttribute('aria-hidden', 'true');
    // Light rays and a glowing pedestal sit under the crest; the orbits and
    // shockwaves are tilted rings in the same 3D stage, and every spark is a
    // small voxel that flies out at its own depth.
    effects.innerHTML = '<i class="duel-rays"></i><i class="duel-pedestal"></i>' +
      '<i class="duel-orbit"></i><i class="duel-orbit inner"></i><i class="duel-shockwave"></i><i class="duel-shockwave second"></i>';
    for (let i = 0; i < 24; i++) {
      const spark = document.createElement('b');
      spark.style.setProperty('--angle', `${i * 15}deg`);
      spark.style.setProperty('--distance', `${90 + (i % 4) * 17}px`);
      spark.style.setProperty('--spark-delay', `${(i % 3) * 45}ms`);
      spark.style.setProperty('--z', `${((i * 7) % 5 - 2) * 40}px`);
      spark.style.setProperty('--spin', `${(i % 2 ? 1 : -1) * (240 + (i % 5) * 60)}deg`);
      effects.appendChild(spark);
    }
    crestStage.append(effects, revealEmblem);
    const headline = document.createElement('div'); headline.className = 'duel-reward-headline';
    headline.textContent = 'RANK PROGRESS';
    ratingReveal.append(headline, crestStage);
    const label = document.createElement('div'); label.className = 'duel-result-kicker';
    label.textContent = rating.profile.placementsRemaining > 0
      ? `Provisional · ${rating.profile.placementsRemaining} placements left` : rating.oldRank.label;
    const number = document.createElement('div'); number.className = 'duel-rating-number';
    const amount = document.createElement('span'); amount.textContent = String(rating.beforeRp);
    const unit = document.createElement('em'); unit.textContent = 'RP';
    const delta = document.createElement('span');
    delta.className = `duel-rating-change ${rating.change >= 0 ? 'up' : 'down'}`;
    delta.textContent = `${rating.change >= 0 ? '+' : ''}${rating.change}`;
    number.append(amount, unit, delta);
    const trackLabels = document.createElement('div'); trackLabels.className = 'duel-track-labels';
    const trackRank = document.createElement('span');
    const trackNext = document.createElement('span');
    trackLabels.append(trackRank, trackNext);
    const track = document.createElement('div'); track.className = 'duel-result-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Rank division progress');
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
    const trackFill = document.createElement('div'); trackFill.className = 'duel-result-track-fill';
    track.appendChild(trackFill);
    const chips = document.createElement('div'); chips.className = 'duel-change-chips';
    const chipTexts = [
      `Skill ${rating.baseSkillDelta >= 0 ? '+' : ''}${rating.baseSkillDelta}`,
      `Streak ${rating.streakBonus ? `+${rating.streakBonus}` : '—'}`,
      `Repeat ×${rating.repeatMultiplier}`,
      rating.shieldUsed ? `Shield · floor ${rating.protectedFloor}` : 'Shield · not used',
    ];
    for (const text of chipTexts) {
      const chip = document.createElement('span'); chip.className = 'duel-change-chip';
      chip.textContent = text; chips.appendChild(chip);
    }
    const event = document.createElement('div'); event.className = 'duel-rank-up'; event.hidden = true;
    const particles = document.createElement('div'); particles.className = 'duel-block-particles';
    particles.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 26; i++) {
      const block = document.createElement('i');
      block.style.setProperty('--x', `${(i * 37) % 96 + 2}%`);
      block.style.setProperty('--y', `${(i * 53) % 76 + 12}%`);
      block.style.setProperty('--delay', `${(i % 8) * .06}s`);
      particles.appendChild(block);
    }
    const live = document.createElement('div'); live.className = 'duel-reveal-summary';
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    ratingReveal.append(label, number, trackLabels, track, chips, event, particles, live);

    let ascended = false, finished = false;
    const started = performance.now();
    const settle = (skipped = false) => {
      cancelAnimationFrame(duelRevealFrame);
      if (finished || duelResultData !== result) return;
      const reduceMotion = accessibility.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      ratingReveal.classList.toggle('instant', skipped || reduceMotion);
      const state = duelRevealState(rating, performance.now() - started, {
        skipped, reducedMotion: reduceMotion,
        photosensitivitySafe: accessibility.photosensitivitySafe,
      });
      ratingReveal.dataset.phase = state.phase;
      duelResultCard.dataset.revealPhase = state.phase;
      amount.textContent = state.displayedRp.toLocaleString();
      const displayed = duelRankProgress(state.displayedRp);
      trackRank.textContent = rating.profile.placementsRemaining > 0 ? 'Provisional' : displayed.rank.label;
      trackNext.textContent = displayed.next ? `${100 - displayed.rpIntoDivision} RP to ${rating.profile.placementsRemaining > 0 ? 'next division' : displayed.next.label}` : 'MAX TIER · KEEP CLIMBING';
      track.setAttribute('aria-valuenow', String(Math.round(state.barProgress * 100)));
      const earned = state.displayedRp - rating.beforeRp;
      delta.textContent = `${earned >= 0 ? '+' : ''}${earned}`;
      if (!state.revealed) headline.textContent = state.phase === 'counting'
        ? rating.change > 0 ? 'RP GAINED' : rating.change < 0 ? 'RP ADJUSTMENT' : 'RANK HELD'
        : 'RANK PROGRESS';
      trackFill.style.width = `${Math.round(state.barProgress * 100)}%`;
      particles.hidden = state.phase !== 'counting' || state.particles === 'none';
      if (state.shake > 0 && !reduceMotion && !accessibility.photosensitivitySafe) {
        const kick = state.shake * 6;
        duelResultCard.style.transform =
          `translate(${(Math.random() - .5) * kick}px, ${(Math.random() - .5) * kick}px)`;
      } else if (duelResultCard.style.transform) {
        duelResultCard.style.transform = '';
      }
      // The ascension beat: the emblem, the colour and the sound all change
      // together, the moment the count-up lands on the final number.
      if (state.revealed && !ascended) {
        ascended = true; particles.hidden = true;
        headline.textContent = rating.placementReveal ? 'RANK REVEALED' : rating.namedRankPromotion ? 'TIER UP'
          : rating.promotion ? 'LEVEL UP' : rating.demotion ? 'RANK ADJUSTED'
          : rating.change > 0 ? 'RP SECURED' : rating.change < 0 ? 'NEXT ROUND. NEW CHANCE.' : 'RANK HELD';
        ratingReveal.classList.toggle('celebrate', rating.promotion || rating.placementReveal || rating.change > 0);
        applyRankTheme(ratingReveal, rating.newRank);
        applyRankTheme(duelResultEl, rating.newRank);
        paintDuelEmblem(revealEmblem, rating.newRank);
        label.textContent = rating.profile.placementsRemaining > 0
          ? `Provisional · ${rating.profile.placementsRemaining} placements left` : rating.newRank.label;
        ratingReveal.classList.add(rating.newlyUnlockedFlair ? 'unlock' : rating.promotion ? 'promotion'
          : rating.demotion ? 'demotion' : 'ordinary');
        const revealEvents = [
          rating.placementReveal ? `Placed — ${rating.newRank.label}` : '',
          rating.newlyUnlockedFlair ? `Title unlocked — ${rating.newlyUnlockedFlair}` : '',
          !rating.placementReveal && rating.namedRankPromotion ? `${rating.newRank.name.toUpperCase()} TIER` : '',
          !rating.placementReveal && !rating.namedRankPromotion && rating.promotion ? `Promoted — ${rating.newRank.label}` : '',
          rating.demotion ? `Demoted — ${rating.newRank.label}` : '',
        ].filter(Boolean);
        const eventText = revealEvents.join(' · ');
        event.textContent = eventText; event.hidden = !eventText;
        live.textContent = duelChangeSummary(rating);
        audio.duelCue(rating.placementReveal ? 'placement' : rating.newlyUnlockedFlair ? 'unlock'
          : rating.namedRankPromotion ? 'rankPromotion' : rating.promotion ? 'promotion'
          : rating.demotion ? 'demotion' : rating.change >= 0 ? 'gain' : 'loss');
        if (rating.placementReveal && rating.newlyUnlockedFlair) {
          window.setTimeout(() => { if (duelResultData === result) audio.duelCue('unlock'); }, 420);
        }
      }
      if (state.settled && !finished) {
        finished = true;
        duelResultCard.style.transform = '';
        if (revealNow) {
          const hadFocus = document.activeElement === revealNow;
          revealNow.hidden = true;
          if (hadFocus) duelResultCard.querySelector<HTMLButtonElement>('.duel-result-controls .primary')?.focus();
        }
      }
      if (!state.settled) duelRevealFrame = requestAnimationFrame(() => settle());
    };
    revealNow = document.createElement('button'); revealNow.type = 'button'; revealNow.textContent = 'Skip';
    revealNow.setAttribute('aria-label', 'Skip rank animation and reveal final Rank Points');
    revealNow.addEventListener('click', () => settle(true));
    settle(accessibility.reducedMotion);
  }
  const controls = document.createElement('div'); controls.className = 'duel-result-controls';
  // A private lobby has somewhere to go back TO, so it gets the rematch vote.
  // A matchmade duel has no lobby and no one to vote with: the only two things
  // you can do with that opponent gone are queue for another or walk away.
  const invited = duelFromInvite();
  const primary = document.createElement('button'); primary.type = 'button';
  primary.className = 'primary'; primary.textContent = invited ? 'Run it back' : 'Queue again';
  // Both destinations are the games board now, so the label says so. A private
  // lobby that survived the match is still one click away on the Lobby tab —
  // which wears its dot — rather than the place you land whether you wanted it
  // or not.
  const leave = document.createElement('button'); leave.type = 'button';
  leave.textContent = 'Back to games';
  primary.addEventListener('click', () => {
    if (!invited) {
      // The queue can only be joined from the open world, so the requeue is
      // latched and fired by onDuelRestored once the server hands the body back.
      primary.disabled = true; leave.disabled = true;
      duelRequeueOnReturn = true;
      voteStatus.textContent = 'Back to the queue\u2026';
      net.sendDuelReturn();
      return;
    }
    // Latch it locally. updateDuelHud repaints this button every frame from the
    // authoritative snapshot, and until the vote round-trips that snapshot
    // still says "has not voted" — which un-pressed the button under the
    // player's cursor and invited a second click.
    duelRematchVoteSent = true;
    primary.disabled = true;
    primary.textContent = 'Vote sent';
    voteStatus.textContent = 'Waiting for the other players…';
    net.sendDuelRematch(true);
  });
  leave.addEventListener('click', () => {
    primary.disabled = true; leave.disabled = true;
    duelRequeueOnReturn = false;
    voteStatus.textContent = 'Back to the games board\u2026';
    net.sendDuelReturn();
  });
  const voteStatus = document.createElement('p'); voteStatus.className = 'duel-result-summary';
  // Only an invite lobby has a live vote for updateDuelHud to count down; a
  // matchmade result says what the two buttons do and then stays put.
  if (!invited) voteStatus.textContent = 'Queue again for a new opponent, or go back to the games board.';
  duelResultVoteStatus = voteStatus; duelResultRematch = invited ? primary : null;
  controls.append(...(revealNow ? [revealNow] : []), primary, leave);
  duelResultCard.append(kicker, title, summary,
    ...(rating ? [ratingReveal] : []), recap, scores, voteStatus, controls);
  duelResultEl.classList.add('visible'); duelScoreboard.classList.remove('visible');
  requestAnimationFrame(() => (revealNow && !revealNow.hidden ? revealNow : primary).focus());
}

// ── Match HUD ──────────────────────────────────────────────────────────────
let duelPillNodes = new Map<number, { root: HTMLElement; score: HTMLElement; spree: HTMLElement }>();
let duelPillKey = '';
const duelLastKills = new Map<number, number>();

function renderDuelPills(board: DuelParticipant[]): void {
  const key = board.map((p) => p.id).join(',');
  if (key !== duelPillKey) {
    duelPillKey = key;
    duelPillNodes = new Map();
    duelPillsEl.replaceChildren();
    for (const p of board) {
      const pill = document.createElement('div'); pill.className = 'duel-pill';
      const swatch = document.createElement('i'); swatch.style.background = duelSkinColor(p.skin);
      const name = document.createElement('span'); name.textContent = p.username;
      const score = document.createElement('b');
      const spree = document.createElement('span'); spree.className = 'duel-pill-spree';
      pill.append(swatch, name, score, spree);
      duelPillsEl.appendChild(pill);
      duelPillNodes.set(p.id, { root: pill, score, spree });
    }
  }
  const topKills = Math.max(0, ...board.map((p) => p.kills));
  for (const p of board) {
    const node = duelPillNodes.get(p.id);
    if (!node) continue;
    node.score.textContent = String(p.kills);
    // Sprees are already called out loud by the announcer and written in the
    // side feed. A third copy riding on every pill is noise, not information.
    node.spree.textContent = '';
    node.root.classList.toggle('me', p.id === net.myId);
    node.root.classList.toggle('leader', p.kills === topKills && topKills > 0);
    node.root.classList.toggle('down', !p.alive || !p.connected);
    // A score change bumps the pill so you feel the point land.
    if ((duelLastKills.get(p.id) ?? p.kills) !== p.kills) {
      node.root.classList.remove('bump');
      void node.root.offsetWidth;
      if (!accessibility.reducedMotion) node.root.classList.add('bump');
    }
    duelLastKills.set(p.id, p.kills);
  }
}

/** Swap the centre cue, restarting its slam animation only when the text
 * actually changes so a held cue does not strobe. */
let duelCueText = '';
function setDuelCue(text: string, tone: '' | 'go' | 'danger' = ''): void {
  if (text === duelCueText) return;
  duelCueText = text;
  duelCenterCue.textContent = text;
  duelCenterCue.style.display = text ? 'block' : 'none';
  duelCenterCue.className = 'duel-center-cue';
  if (!text) return;
  if (text.length > 2) duelCenterCue.classList.add('text');
  if (tone) duelCenterCue.classList.add(tone);
  if (!accessibility.reducedMotion) {
    void duelCenterCue.offsetWidth;
    duelCenterCue.classList.add('slam');
  }
}

function updateDuelHud(): void {
  if (!arenaActive || !duelSnapshot) {
    duelMatchHud.classList.remove('visible'); duelScoresTouch.classList.remove('visible');
    duelAnnounceEl.classList.remove('visible', 'out');
    if (duelKillFeedEl.childElementCount) duelKillFeedEl.replaceChildren();
    setDuelCue('');
    return;
  }
  duelMatchHud.classList.add('visible'); duelScoresTouch.classList.add('visible');
  const now = duelNow();
  const board = duelSnapshot.participants;
  const me = board.find((p) => p.id === net.myId);
  renderDuelPills(board);
  updateDuelAnnounce(now);
  // A change at the top of the board gets its own small sting.
  const topKills = Math.max(0, ...board.map((p) => p.kills));
  const leaderKey = board.filter((p) => p.kills === topKills).map((p) => p.id).join(',');
  if (duelSnapshot.phase === 'running' && duelLastLeaderKey && topKills > 0 &&
      leaderKey && leaderKey !== duelLastLeaderKey) audio.duelCue('lead');
  duelLastLeaderKey = leaderKey;

  duelClockEl.classList.remove('warn', 'critical', 'sudden');
  if (duelSnapshot.phase === 'sudden_death') {
    duelClockLabel.textContent = 'Next kill wins';
    duelTimeEl.textContent = 'SUDDEN DEATH';
    duelClockEl.classList.add('sudden');
    duelClockBarFill.style.transform = 'scaleX(1)';
  } else {
    const endsAt = duelSnapshot.endsAt ?? (duelSnapshot.startedAt ?? now) + DUEL_ROUND_MS;
    const remaining = endsAt - now;
    duelClockLabel.textContent = `First to ${DUEL_SCORE_LIMIT}`;
    duelTimeEl.textContent = formatDuelTime(remaining);
    duelClockBarFill.style.transform = `scaleX(${Math.max(0, Math.min(1, remaining / DUEL_ROUND_MS))})`;
    if (remaining <= 30_000) duelClockEl.classList.add('critical');
    else if (remaining <= 60_000) duelClockEl.classList.add('warn');
    if (duelSnapshot.phase === 'running' && remaining <= 60_000 && remaining > 0 &&
        !duelFinalMinuteShown) {
      // The clock has already gone amber and the announcer has already played
      // the sting. Slamming FINAL MINUTE over the crosshair as well is a third
      // copy of the same fact, dropped on the one place you are looking.
      duelFinalMinuteShown = true;
    }
    if (duelSnapshot.phase === 'running' && remaining <= 30_000 && remaining > 0 &&
        !duelFinalThirtyPlayed) {
      duelFinalThirtyPlayed = true; audio.duelCue('final30');
    }
  }

  let cue = '', tone: '' | 'go' | 'danger' = '';
  if (duelSnapshot.phase === 'countdown') {
    const countdownAt = duelSnapshot.countdownEndsAt ?? duelCountdownEndsAt;
    if (countdownAt <= 0) { cue = 'BUILDING ARENA'; }
    else {
      const number = Math.max(0, Math.ceil((countdownAt - now) / 1000));
      cue = number > 0 ? String(number) : 'FIGHT';
      if (number === 0) tone = 'go';
      if (number !== duelLastCountdownCue) {
        duelLastCountdownCue = number;
        audio.duelCue(number > 0 ? 'countdown' : 'fight');
        if (number === 0) { duelFightPlayed = true; duelFightCueUntil = now + 900; }
      }
    }
  } else if (duelSpectating && duelRespawnAt > now) {
    cue = `RESPAWN ${Math.ceil((duelRespawnAt - now) / 1000)}`;
  } else if (duelSnapshot.phase === 'sudden_death') {
    cue = 'SUDDEN DEATH'; tone = 'danger';
    if (!duelSuddenDeathPlayed) { duelSuddenDeathPlayed = true; audio.duelCue('sudden'); }
  } else if (duelSnapshot.phase === 'running') {
    if (!duelFightPlayed) {
      duelFightPlayed = true; duelFightCueUntil = now + 900; audio.duelCue('fight');
    }
    if (now < duelFightCueUntil) { cue = 'FIGHT'; tone = 'go'; }
  }

  // The announcer owns the centre of the screen while it is up.
  setDuelCue(duelAnnounceEl.classList.contains('visible') && cue.length > 2 ? '' : cue, tone);

  if (arenaActive && !duelArenaReadySent && duelSnapshot?.phase === 'countdown' &&
      (duelSnapshot.countdownEndsAt === undefined || duelSnapshot.countdownEndsAt === 0)) {
    if (world.update(player.pos.x, player.pos.z, 20, 2)) {
      markDuelArenaReady();
    }
  }
  if (duelResultData && duelResultVoteStatus && duelResultRematch) {
    const connected = board.filter((p) => p.connected);
    const votes = connected.filter((p) => p.rematchVote).length;
    const left = formatDuelTime(duelResultData.rematchDeadline - now);
    duelResultVoteStatus.textContent = `${votes}/${connected.length} voted to run it back · ${left}`;
    const voted = me?.rematchVote === true || duelRematchVoteSent;
    duelResultRematch.disabled = voted;
    duelResultRematch.textContent = voted ? 'Vote sent' : 'Run it back';
  }
  if (duelScoresHeld) renderDuelScoreboard();
}

/** Drop every generic arena hook back to open-world defaults. Called by every
 *  exit path so no mode's rules can outlive its match. */
/** The FULL duel footprint — walls included. `DuelArenaBounds.min/max` are the
 *  playable interior, which is two columns short of the colosseum on every
 *  side; anything that has to cover the whole structure (the render crop, the
 *  chunk invalidation) needs the outer box. */
function duelArenaFootprint(arena: DuelArenaBounds): {
  minX: number; minZ: number; maxX: number; maxZ: number;
} {
  return {
    minX: arena.originX, minZ: arena.originZ,
    maxX: arena.originX + DUEL_ARENA_SIZE, maxZ: arena.originZ + DUEL_ARENA_SIZE,
  };
}

function clearArenaState(): void {
  // Drop the arena's chunks on the way OUT too, so a colosseum or a venue is
  // never left sitting in the client's chunk cache holding one match's blocks
  // while the open world streams back in around it.
  if (arenaKind === 'duel' && duelActiveBounds) world.invalidateArena(duelArenaFootprint(duelActiveBounds));
  else if (arenaKind === 'party' && partyActiveBounds) world.invalidateArena(partyActiveBounds);
  arenaActive = false;
  arenaKind = null;
  arenaMaxHealth = 20;
  arenaHpPerHeart = 2;
  arenaUnlimited = new Set<number>();
  arenaCanPlaceAt = null;
  arenaCanEditAt = null;
  arenaClampPos = null;
  world.setArenaRenderBounds(null);
  clearPartySession();
  net.arenaRevision = undefined;
}

function cleanupDuelSession(restoreState = true): void {
  duelRequeueOnReturn = false;
  stopDuelReadyWatchdog();
  clearArenaState();
  duelActiveBounds = null;
  duelArenaReadySent = false;
  duelSpectating = false;
  duelScoresHeld = false;
  duelResultData = null;
  duelRematchVoteSent = false;
  duelResultRematch = null;
  duelResultVoteStatus = null;
  duelSnapshot = null;
  duelQueued = false;
  refreshDuelsAvailability();
  duelInviteToken = '';
  pendingDuelToken = '';
  duelFeedSeen = 0;
  duelLastKills.clear();
  duelPillKey = '';

  duelMatchHud.classList.remove('visible');
  duelScoresTouch.classList.remove('visible');
  duelScoreboard.classList.remove('visible');
  duelResultEl.classList.remove('visible');
  duelAnnounceEl.classList.remove('visible', 'out');
  duelKillFeedEl.replaceChildren();
  killChipEl.classList.remove('visible');
  killChipT = 0;
  damageNumbers.clear();
  killBanner.clear();
  pvpStreak.reset();
  hurtPulse = 0;
  setDuelCue('');

  if (typeof closeMinigames === 'function') closeMinigames();

  if (restoreState && duelLocalFallback) {
    const fallback = duelLocalFallback;
    duelLocalFallback = null;
    inventory.restore(fallback.state);
    player.pos.set(fallback.x, fallback.y, fallback.z);
    player.yaw = fallback.yaw;
    player.pitch = fallback.pitch;
    player.maxHealth = maxHealthFor(localHearts);
    player.health = fallback.health;
    player.dead = fallback.dead;
    applyLocalMode(fallback.mode);
    lastHealth = fallback.health;
  } else {
    duelLocalFallback = null;
  }
}

function duelControlBlocked(): boolean {
  if (arenaKind === 'party') return partySnapshot?.phase !== 'running' || partyCaged();
  if (!arenaActive || !duelSnapshot) return false;
  return duelSnapshot.phase === 'countdown' ||
    duelSnapshot.phase === 'results' || screen === 'duel_results';
}

net.onDuelArena = (arena, spawn, countdownEndsAt) => {
  // Throw away everything this client thinks it knows about the colosseum
  // before streaming it. Arena slots are recycled from 0 the moment a match
  // ends, so the NEXT duel in this slot inherited whatever was left in the
  // edit overlay from the last one — a plank the server's reset batch never
  // reached this client for, or a placement the client predicted and the
  // server refused. Those survived as a few floating blocks standing in an
  // otherwise pristine arena. Rebuilding the footprint from authored geometry
  // makes that impossible rather than unlikely. (The Bridge and Parkour have
  // always done this; Duels never did.)
  world.invalidateArena(duelArenaFootprint(arena));
  arenaActive = true; arenaKind = 'duel'; duelActiveBounds = arena;
  arenaMaxHealth = DUEL_MAX_HEALTH; arenaHpPerHeart = DUEL_HP_PER_HEART;
  arenaCanPlaceAt = duelArenaRules.canPlaceAt;
  arenaCanEditAt = duelArenaRules.canEditAt;
  arenaClampPos = (pos) => clampToDuelArena(pos, arena);
  // Duels arenas are lit to a competitive floor of 12/15 so nobody wins on a
  // dark corner.
  world.setArenaRenderBounds(duelArenaFootprint(arena), 0.8);
  duelArenaReadySent = false; duelCountdownEndsAt = countdownEndsAt;
  duelLastCountdownCue = -1; duelCueText = ''; duelLastLeaderKey = '';
  duelFinalMinuteShown = false; duelFinalThirtyPlayed = false;
  duelSuddenDeathPlayed = false; duelFightPlayed = false;
  duelFightCueUntil = 0;
  duelFeedSeen = duelSnapshot?.feed.reduce((max, e) => Math.max(max, e.seq), 0) ?? 0;
  duelLastKills.clear(); duelPillKey = '';
  duelKillFeedEl.replaceChildren();
  duelAnnounceEl.classList.remove('visible', 'out');
  duelResultData = null; duelRematchVoteSent = false;
  duelResultEl.classList.remove('visible'); duelSpectating = false;
  clearVaultPresentation(true); endGrapple(); setSeat(null); myRope = null;
  killfeedEl.replaceChildren(); combatTagUntilLocal = 0; combatTimerEl.style.display = 'none';
  warEl.style.display = 'none'; regionBannerEl.style.display = 'none';
  worldMap.hide(); worldMap.hideBeacons(); worldMap.setDynamicMarkers([]);
  flagModels.setState(false, []);
  if (fieldGuide?.open) fieldGuide.closeSilently();
  starterEl.style.display = 'none';
  closeMinigames(); audio.resume();
  applyLocalMode('survival');
  player.pos.set(spawn.x, spawn.y, spawn.z); player.vel.set(0, 0, 0); player.fallDistance = 0;
  player.maxHealth = arenaMaxHealth; player.health = arenaMaxHealth; player.dead = false;
  player.flying = false; player.noclip = false; player.gliding = false; player.boating = false;
  pendingTeleport = { x: spawn.x, y: spawn.y, z: spawn.z, started: worldTimeLocal };
  // Pre-stream the small arena bubble immediately so ready can be sent without delay
  if (world.update(spawn.x, spawn.z, 50, 2)) {
    pendingTeleport = null;
    markDuelArenaReady();
  } else {
    startDuelReadyWatchdog(spawn.x, spawn.z);
  }
  resumePlay();
};
net.onDuelLoadout = (slots, armor, selected, unlimitedReserve) => {
  inventory.restore({ slots, armor, selected });
  arenaUnlimited = unlimitedReserve
    ? new Set<number>([Block.OakPlanks, Item.Bullet]) : new Set<number>();
  fireCooldown = 0; reloadTimer = 0; burstRemaining = 0; healUse.cancel();
};
net.onDuelClock = (serverNow, _endsAt, _suddenDeath) => syncDuelClock(serverNow);
net.onDuelRespawn = (respawnAt, spectating) => {
  duelRespawnAt = respawnAt; duelSpectating = spectating;
  // Dying wipes the floating numbers left over from the fight that killed you,
  // so the respawn view is clean.
  if (spectating) { damageNumbers.clear(); hurtPulse = 0; }
  player.flying = spectating; player.noclip = spectating;
  if (spectating) {
    burstRemaining = 0; burstStack = null; burstGun = null;
    reloadTimer = 0; reloadingStack = null; aimZoom = 1; healUse.cancel();
  }
  if (!spectating) { player.flying = false; player.noclip = false; player.health = arenaMaxHealth; }
};
net.onDuelResult = renderDuelResult;
net.onDuelProfile = (profile, leaderboard) => {
  duelProfile = profile;
  if (leaderboard.length) duelLeaderboardData = leaderboard.slice();
  renderDuelProgress();
};
net.onDuelLeaderboard = (leaderboard) => {
  duelLeaderboardData = leaderboard.slice(); renderDuelLeaderboard();
};
net.onDuelProfileUpdate = (id) => remotePlayers.invalidate(id);
net.onDuelRestored = (x, y, z, yaw, pitch, health, dead, mode, state) => {
  const reopenedDuel=duelSnapshot?.phase==='lobby'?duelSnapshot:null;
  // enterTitle() below runs cleanupDuelSession, which disarms the latch, so
  // read it before the teardown rather than after it.
  const requeue = duelRequeueOnReturn;
  duelRequeueOnReturn = false;
  stopDuelReadyWatchdog();
  clearArenaState();
  duelActiveBounds = null;
  duelArenaReadySent = false;
  duelSpectating = false; duelResultData = null; duelResultEl.classList.remove('visible');
  duelMatchHud.classList.remove('visible'); duelScoresTouch.classList.remove('visible');
  duelKillFeedEl.replaceChildren(); duelAnnounceEl.classList.remove('visible', 'out');
  setDuelCue('');
  if (state) inventory.restore(state);
  flagModels.setState(flagState.breakable, flagState.flags);
  player.maxHealth = maxHealthFor(localHearts);
  player.pos.set(x, y, z); player.yaw = yaw; player.pitch = pitch;
  player.health = health; player.dead = dead;
  pendingTeleport = { x, y, z, started: worldTimeLocal };
  applyLocalMode(mode); lastHealth = health; enterTitle(); duelSnapshot=reopenedDuel; renderDuelLobby(); openGamesTab();
  duelLocalFallback = null;
  partyLocalFallback = null;
  if (partySnapshot?.phase !== 'lobby') { partySnapshot = null; partyInviteToken = ''; }
  partyQueued = false;
  renderPartyLobby();
  parkourQueueStatus.textContent = ''; partyQueueStatus.textContent = '';
  refreshPartyAvailability();
  // "Queue again" from a matchmade result: the server has just handed the
  // open-world body back, which is the first moment the queue will accept us.
  if (requeue) {
    if (net.connected && !duelSnapshot) {
      duelLocalFallback = {
        state: inventory.serialize(), x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch,
        health: player.health, dead: player.dead, mode: localMode,
      };
      pushStateSave();
      // Press the board's own Play button rather than queueing behind its
      // back: the card then shows "Cancel Queue" and "Finding you an
      // opponent…" exactly as it would have if the click were real.
      pressMinigamePlay('duels');
    }
  }
};

// First drop-in shows the guided briefing once (tracked in localStorage); after
// that — or when the briefing is skipped/completed — enter the game directly.
function beginPlay(): void {
  if (!tutorialSeen) { tutorial.show(); return; }
  resumePlay();
}

// Controls / keybindings panel (Controls button). Grouped by what you are
// doing rather than one long alphabet soup, with the keys as chips so they can
// be picked out at a glance. The card scrolls internally: the old centred
// column silently clipped its first and last rows on shorter windows.
// Rebuilt from the live keybinds every time the sheet opens (see below), so
// Controls and HUD Settings can never disagree about which key does what.
let renderControlsBody = (): void => { /* assigned by the IIFE */ };
const controlsPanel = (() => {
  // [action, alternatives, hint]. An alternative is a list of chips shown
  // adjacent (W A S D is one combo, not four choices); alternatives are joined
  // by "or"; the hint is prose ("in mid-air"), never a key.
  type Bind = [string, string[][], string?];
  type Group = { title: string; binds: Bind[] };
  const buildGroups = (): Group[] => {
    const k = hudSettings.binds;
    const move = [keyLabel(k.forward), keyLabel(k.left), keyLabel(k.back), keyLabel(k.right)];
    return isMobile ? [
      { title: 'Moving', binds: [
        ['Move', [['left joystick']]],
        ['Sprint', [['left joystick']], 'push past the rim'],
        ['Jump', [['⬆']], 'hold'], ['Sneak', [['⇩']], 'toggle'],
        ['Deploy glider', [['⬆']], 'in mid-air'],
        ['Fire grappling hook', [['tap']], 'holding the hook'],
        ['Let go and launch', [['⬆']], 'mid-swing — you keep the speed'],
        ['Launch boat', [['tap']], 'on water'], ['Hop out of boat', [['⬆']]],
      ] },
      { title: 'Fighting', binds: [
        ['Break block / attack', [['long-press']]], ['Place / use', [['tap']]],
        ['Aim down sights', [['⊕']]], ['Reload gun', [['R']]],
      ] },
      { title: 'Items', binds: [
        ['Hotbar slot', [['tap a slot']]], ['Inventory', [['🎒']]],
      ] },
      { title: 'The world', binds: [
        ['World map', [['🗺']]], ['Your progress', [['⚑']]],
        ['Command box', [['/']], 'commands only — there is no chat'],
      ] },
      { title: 'Commands', binds: [
        ['Open the world map', [['/map']]], ['Drop a waypoint here', [['/waypoint']]],
        ['Warfare Command', [['/warfare']]], ['Getting-started guide', [['/guide']]],
        ['Teleport to a player', [['/tpa']]], ['Accept a request', [['/tpaccept']], 'then stand still'],
        ['Every command you can run', [['/help']]],
      ] },
      { title: 'Screens', binds: [
        ['Getting-started guide', [['✕']], 'starts open — tap to hide'],
        ['Pause / back', [['⏸']]],
      ] },
    ] : [
      { title: 'Moving', binds: [
        ['Move', [move]],
        ['Sprint', [[keyLabel(k.sprint)], [keyLabel(k.forward), keyLabel(k.forward)]], 'double-tap'],
        ['Jump', [[keyLabel(k.jump)]]], ['Sneak', [[keyLabel(k.sneak)]]],
        ['Deploy glider', [[keyLabel(k.jump)]], 'in mid-air'],
        ['Fire grappling hook', [['Left click']], 'holding the hook'],
        ['Let go and launch', [[keyLabel(k.jump)]], 'mid-swing — you keep the speed'],
        ['Steer the swing', [move], 'while hooked'],
        ['Launch boat', [['Right click']], 'on water'],
        ['Hop out of boat', [[keyLabel(k.jump)]]],
      ] },
      { title: 'Fighting', binds: [
        ['Break block / attack', [['Left click']]], ['Place / use', [['Right click']]],
        ['Aim down sights', [['Right click']], 'hold'], ['Reload gun', [[keyLabel(k.reload)]]],
      ] },
      { title: 'Items', binds: [
        ['Hotbar slot', [['1'], ['9'], ['scroll']]], ['Inventory', [[keyLabel(k.inventory)]]],
        ['Drop item', [[keyLabel(k.drop)]], `Shift + ${keyLabel(k.drop)} drops the stack`],
      ] },
      { title: 'The world', binds: [
        ['Command box', [[keyLabel(k.chat)]], 'commands only — there is no chat'],
      ] },
      { title: 'Commands', binds: [
        ['Open the world map', [['/map']]], ['Set waypoint here', [['/waypoint']]],
        ['Warfare Command', [['/warfare']]], ['Getting-started guide', [['/guide']]],
        ['Teleport to a player', [['/tpa']]], ['Accept a request', [['/tpaccept']], 'then stand still'],
        ['Every command you can run', [['/help']]],
      ] },
      { title: 'Screens', binds: [
        ['Camera view (1st / 3rd)', [[keyLabel(k.view)]]],
        ['Zoom', [[keyLabel(k.zoom)]], 'hold; scroll to change the magnification'],
        ['Debug overlay', [['F3']]], ['Pause / back', [['Esc']]],
      ] },
    ];
  };

  const panel = document.createElement('div');
  panel.className = 'sheet-scrim';
  const card = document.createElement('div');
  card.className = 'sheet-card mc-font';

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'sheet-eyebrow';
  eyebrow.textContent = isMobile ? 'Touch controls' : 'Keyboard & mouse';
  const title = document.createElement('h2');
  title.className = 'sheet-title';
  title.textContent = 'Controls';
  head.append(eyebrow, title);

  const body = document.createElement('div');
  body.className = 'sheet-body';
  renderControlsBody = (): void => {
    body.textContent = '';
    for (const group of buildGroups()) {
      const section = document.createElement('section');
      section.className = 'keygroup';
      const label = document.createElement('h3');
      label.className = 'keygroup-title';
      label.textContent = group.title;
      section.appendChild(label);
      for (const [action, alternatives, hint] of group.binds) {
        const row = document.createElement('div');
        row.className = 'keyrow';
        const name = document.createElement('span');
        name.className = 'keyrow-action';
        name.textContent = action;
        const chips = document.createElement('span');
        chips.className = 'keyrow-keys';
        alternatives.forEach((combo, i) => {
          if (i > 0) {
            const sep = document.createElement('i');
            sep.className = 'keyrow-sep';
            sep.textContent = 'or';
            chips.appendChild(sep);
          }
          const set = document.createElement('span');
          set.className = 'keyrow-combo';
          for (const key of combo) {
            const chip = document.createElement('kbd');
            setIconText(chip, key);
            set.appendChild(chip);
          }
          chips.appendChild(set);
        });
        if (hint) {
          const note = document.createElement('i');
          note.className = 'keyrow-hint';
          setIconText(note, hint);
          chips.appendChild(note);
        }
        row.append(name, chips);
        section.appendChild(row);
      }
      body.appendChild(section);
    }
  };
  renderControlsBody();

  const back = document.createElement('button');
  back.className = 'mc-btn sheet-close';
  back.textContent = 'Back';
  back.addEventListener('click', () => { panel.style.display = 'none'; });

  card.append(head, body, back);
  panel.appendChild(card);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.style.display = 'none'; // click the backdrop
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.style.display === 'flex') {
      panel.style.display = 'none';
      e.stopPropagation();
    }
  });
  app.appendChild(panel);
  return panel;
})();

controlsBtn.addEventListener('click', () => {
  wardrobeUI.hide();
  const opening = controlsPanel.style.display !== 'flex';
  if (opening) renderControlsBody(); // pick up any rebinds since it last opened
  controlsPanel.style.display = opening ? 'flex' : 'none';
});

// --- CHARACTER: customise your avatar (skin, hair, hats, face…) --------------
// Opens from the title menu. A live draggable 3D preview of the same avatar
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
  titleCharacterPreview.setCosmetics(myCosmetics);
  if (net.connected) net.sendCosmetics(myCosmetics);
}

const titleCharacterPreview = (() => {
  const host = document.getElementById('title-character-preview')!;
  const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  previewRenderer.setClearColor(0x000000, 0);
  previewRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  host.appendChild(previewRenderer.domElement);
  const previewScene = new THREE.Scene();
  const previewCam = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  previewCam.position.set(0, 1.15, 4.3);
  previewCam.lookAt(0, 0.98, 0);
  let body: AvatarBody | null = null;
  let pointerX = 0;
  let pointerY = 0;

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    previewRenderer.setSize(width, height, false);
    previewCam.aspect = width / height;
    previewCam.updateProjectionMatrix();
  };
  // The soldier on the plinth follows the pointer anywhere on the title
  // screen, not just over its own box — it is watching you pick your side.
  overlay.addEventListener('pointermove', (e) => {
    const rect = host.getBoundingClientRect();
    if (!rect.width) return;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.3;
    pointerX = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth * 0.45)));
    pointerY = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.6)));
  });
  overlay.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  new ResizeObserver(resize).observe(host);

  const animate = (): void => {
    requestAnimationFrame(animate);
    if (body) {
      const t = performance.now() / 1000;
      // Model faces +z after the flip, so looking toward the pointer is -x.
      body.head.rotation.y += (-pointerX * 0.6 - body.head.rotation.y) * 0.1;
      body.head.rotation.x += (pointerY * 0.3 - body.head.rotation.x) * 0.1;
      // At ease: a slow breath through the shoulders and a slight body turn.
      body.group.rotation.y += (Math.PI - pointerX * 0.18 - body.group.rotation.y) * 0.05;
      const breath = Math.sin(t * 1.6) * 0.012;
      body.parts[2].rotation.x = -0.06 + breath; body.parts[3].rotation.x = 0.06 - breath;
      body.parts[2].rotation.z = -0.05; body.parts[3].rotation.z = 0.05;
    }
    if (screen === 'title' && authed) previewRenderer.render(previewScene, previewCam);
  };
  animate();

  return {
    setCosmetics(cosmetics: Cosmetics): void {
      if (body) { previewScene.remove(body.group); disposeAvatarBody(body); }
      body = buildAvatarBody({ ...cosmetics });
      body.group.rotation.y = Math.PI;
      body.parts[2].rotation.x = -0.08;
      body.parts[3].rotation.x = 0.08;
      previewScene.add(body.group);
      resize();
    },
  };
})();

// THE WARDROBE (wardrobe_ui.ts): one studio for the look AND the capes —
// a lit plinth, every option laid out as a tile, live head-shot thumbnails.
const wardrobeUI = createWardrobe({
  root: app,
  getCosmetics: () => myCosmetics,
  getWardrobe: () => myWardrobe,
  factions: FACTIONS.map((f) => ({ name: f.name, color: factionColor(f.id) })),
  getFaction: () => (isFaction(localFaction) ? FACTIONS.findIndex((f) => f.id === localFaction) : -1),
  reducedMotion: () => accessibility.reducedMotion
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  onSave: (look) => {
    myCosmetics = look;
    invalidateSelfAvatar(); // your third-person body reflects the new look
    saveCosmetics();
  },
  onEquipCape: (id) => {
    const next = equipCape(myWardrobe, id);
    if (next === myWardrobe) return; // not yours — sanitize already refused it
    myWardrobe = next;
    saveWardrobe();
  },
});
wardrobeUI.onOpen = syncPointerLock;
wardrobeUI.onClose = syncPointerLock;

characterBtn.addEventListener('click', () => {
  if (!authed) return;
  audio.resume();
  controlsPanel.style.display = 'none';
  wardrobeUI.show();
});

// --- CAPES: the wardrobe you collect into, and the one you wear --------------
// Deliberately NOT part of Cosmetics: a cosmetic index is something you cycle
// to, and a cape is meant to be something you earn. The collection lives here
// as its own per-account blob (localStorage today; the account and the wire
// when the earned-cape system lands), and capes.ts holds the empty catalog.
const capesBtn = document.getElementById('capes-btn')!;
let myWardrobe: Wardrobe = emptyWardrobe();

function wardrobeKey(user: string): string { return `voxelon.capes.${user}`; }
function loadWardrobe(user: string): void {
  myWardrobe = emptyWardrobe();
  try {
    const raw = localStorage.getItem(wardrobeKey(user));
    if (raw) myWardrobe = sanitizeWardrobe(JSON.parse(raw));
  } catch { /* ignore */ }
  wardrobeUI.update();
}
function saveWardrobe(): void {
  if (!authedName) return;
  try {
    localStorage.setItem(wardrobeKey(authedName), JSON.stringify(myWardrobe));
  } catch { /* ignore */ }
}

capesBtn.addEventListener('click', () => {
  if (!authed) return;
  audio.resume();
  controlsPanel.style.display = 'none';
  wardrobeUI.show('capes');
});

// --- First-play onboarding: guided mission briefing, shown once ---------------
let tutorialSeen = false;
try { tutorialSeen = localStorage.getItem('voxelon.tutorialSeen') === '1'; } catch { /* ignore */ }

type TutorialStep = {
  chapter: string;
  icon: IconName;
  /** Title with the one word worth colouring wrapped in *asterisks*. */
  title: string;
  summary: string;
  tip: string;
  accent: string;
  items: { icon: IconName; label: string; value: string; keys?: string[] }[];
};

const tutorial = (() => {
  const steps: TutorialStep[] = isMobile ? [
    {
      chapter: 'Movement', icon: 'compass', title: 'Claim your *first* ground', accent: '#2bb6e8',
      summary: 'Explore with the left joystick, look by dragging the world, and learn the rhythm of movement before night closes in.',
      tip: 'Push the joystick beyond its rim to sprint. The jump control also deploys your glider while airborne.',
      items: [
        { icon: 'compass', label: 'Move', value: 'Left joystick · push farther to sprint' },
        { icon: 'eye', label: 'Look', value: 'Drag anywhere on the right side of the screen' },
        { icon: 'wing', label: 'Jump / glide', value: 'Hold the jump control', keys: ['⬆'] },
      ],
    },
    {
      chapter: 'Survival', icon: 'pickaxe', title: 'Turn the world into *tools*', accent: '#f0a81c',
      summary: 'Mine your first tree, shape raw blocks into equipment, and build a shelter that can survive the frontier.',
      tip: 'Your getting-started guide stays available in-game and tracks the path from bare hands to your first vault.',
      items: [
        { icon: 'pickaxe', label: 'Break / attack', value: 'Long-press a block or target' },
        { icon: 'brick', label: 'Place / use', value: 'Tap a block face or an interactable object' },
        { icon: 'backpack', label: 'Inventory', value: 'Tap the backpack to craft and manage items' },
      ],
    },
    {
      chapter: 'Civilization', icon: 'gear', title: 'Build *power*, not just shelter', accent: '#8b6cff',
      summary: 'Automate resources, customize your character, unlock progression branches, and turn a camp into a functioning civilization.',
      tip: 'Open the recipe guide from any crafting screen whenever you need a complete production path.',
      items: [
        { icon: 'map', label: 'World map', value: 'Tap the map to inspect territory and travel points' },
        { icon: 'flag', label: 'Progress', value: 'Tap the flag to spend upgrades and view faction growth' },
        { icon: 'gear', label: 'Machines', value: 'Autominers, derricks, defenses, and transport' },
      ],
    },
    {
      chapter: 'War', icon: 'swords', title: 'Every *heart* changes the war', accent: '#ff5a43',
      summary: 'You fight for a balanced faction. Hold territory, protect your flag, and remember that defeat can cost more than gear.',
      tip: 'During war the border contracts and every player glows. Stay with your faction and watch the map.',
      items: [
        { icon: 'heart', label: 'Lifesteal', value: 'Kills can transfer hearts between players' },
        { icon: 'trophy', label: 'Faction war', value: 'The strongest season performance wins' },
        { icon: 'shield', label: 'Your objective', value: 'Survive, build leverage, and fight as a team' },
      ],
    },
  ] : [
    {
      chapter: 'Movement', icon: 'compass', title: 'Claim your *first* ground', accent: '#2bb6e8',
      summary: 'Learn the movement language of the frontier before you commit to a direction. The world is large, persistent, and dangerous after dark.',
      tip: 'Press V any time to cycle between first- and third-person views.',
      items: [
        { icon: 'compass', label: 'Move', value: 'Space to jump · Shift to sneak', keys: ['W', 'A', 'S', 'D'] },
        { icon: 'bolt', label: 'Sprint', value: 'Or double-tap W', keys: ['Q'] },
        { icon: 'eye', label: 'Look', value: 'Move the mouse once you enter the world' },
      ],
    },
    {
      chapter: 'Survival', icon: 'pickaxe', title: 'Turn the world into *tools*', accent: '#f0a81c',
      summary: 'Mine your first tree, convert raw blocks into equipment, and build a shelter that can survive the frontier.',
      tip: 'Press T and type /guide for the getting-started checklist — it tracks the path from bare hands to your first vault.',
      items: [
        { icon: 'pickaxe', label: 'Break / attack', value: 'Hold on a block, click a target', keys: ['LMB'] },
        { icon: 'brick', label: 'Place / use', value: 'Blocks, doors, machines, chests', keys: ['RMB'] },
        { icon: 'backpack', label: 'Inventory', value: 'Craft and manage items', keys: ['E'] },
      ],
    },
    {
      chapter: 'Civilization', icon: 'gear', title: 'Build *power*, not just shelter', accent: '#8b6cff',
      summary: 'Automate resources, unlock progression branches, and turn a temporary camp into a functioning civilization.',
      tip: 'Crafting screens include a recipe guide. Use it to trace complete production chains for machines, weapons, and defenses.',
      items: [
        { icon: 'map', label: 'World map', value: 'Terrain, war flags and your waypoints', keys: ['/map'] },
        { icon: 'flag', label: 'Progress', value: 'Spend upgrades and view faction growth', keys: ['/warfare'] },
        { icon: 'gear', label: 'Machines', value: 'Autominers, derricks, defenses, and transport' },
      ],
    },
    {
      chapter: 'War', icon: 'swords', title: 'Every *heart* changes the war', accent: '#ff5a43',
      summary: 'You fight for a balanced faction. Hold territory, protect your flag, and remember that defeat can cost more than gear.',
      tip: 'During war the border contracts and every player glows. Stay close to allies, watch the map, and choose fights carefully.',
      items: [
        { icon: 'heart', label: 'Lifesteal', value: 'Kills can transfer hearts between players' },
        { icon: 'trophy', label: 'Faction war', value: 'The strongest season performance wins' },
        { icon: 'shield', label: 'Your objective', value: 'Survive, build leverage, and fight as a team' },
      ],
    },
  ];

  /** A five-faced CSS voxel (the bottom never shows). `face` goes on the sides. */
  function makeCube(face = ''): HTMLDivElement {
    const cube = document.createElement('div');
    cube.className = 'brief-cube';
    for (let f = 0; f < 5; f++) {
      const side = document.createElement('i');
      if (face && f !== 2) side.innerHTML = face;
      cube.appendChild(side);
    }
    return cube;
  }

  let i = 0;
  const panel = document.createElement('div');
  panel.className = 'onboarding-shell';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'First-play briefing');
  panel.tabIndex = -1;

  // Drifting background voxels, each tinted by one of the step accents.
  const field = document.createElement('div');
  field.className = 'brief-field';
  const floats: [number, number, number, number][] = [ // x%, y%, size px, accent index
    [6, 14, 34, 0], [16, 78, 22, 1], [44, 6, 18, 2], [58, 88, 30, 3],
    [84, 12, 26, 1], [93, 56, 38, 2], [3, 50, 16, 3], [72, 40, 14, 0],
  ];
  floats.forEach(([x, y, size, accent], n) => {
    const wrap = document.createElement('div');
    wrap.className = 'brief-float';
    wrap.style.cssText = `--x:${x}%;--y:${y}%;--d:${10 + n * 1.7}s;--delay:${-n * 1.3}s;--spin:${18 + n * 4}s;--o:${.35 + (n % 3) * .15}`;
    const cube = makeCube();
    cube.style.setProperty('--s', size + 'px');
    cube.style.setProperty('--c', steps[accent].accent);
    wrap.appendChild(cube);
    field.appendChild(wrap);
  });

  const frame = document.createElement('div');
  frame.className = 'onboarding-frame';
  const visual = document.createElement('section');
  visual.className = 'onboarding-visual';
  const chapter = document.createElement('div'); chapter.className = 'brief-chapter';
  const hero = document.createElement('div'); hero.className = 'brief-hero';
  const heroBob = document.createElement('div'); heroBob.className = 'brief-hero-bob';
  hero.appendChild(heroBob);
  const visualText = document.createElement('div');
  const number = document.createElement('div'); number.className = 'brief-number';
  const title = document.createElement('h2'); title.className = 'brief-title';
  const summary = document.createElement('p'); summary.className = 'brief-summary';
  visualText.append(number, title, summary);
  visual.append(chapter, hero, visualText);

  const content = document.createElement('section');
  content.className = 'onboarding-content';
  const stepper = document.createElement('div'); stepper.className = 'brief-steps';
  const stepButtons = steps.map((s, n) => {
    const b = document.createElement('button');
    b.className = 'brief-step';
    b.setAttribute('aria-label', `Step ${n + 1}: ${s.chapter}`);
    b.innerHTML = `<span class="brief-step-bar"></span><span class="brief-step-name">${s.chapter}</span>`;
    b.addEventListener('click', () => go(n));
    stepper.appendChild(b);
    return b;
  });
  const contentLabel = document.createElement('div'); contentLabel.className = 'brief-content-label';
  contentLabel.textContent = 'Field essentials';
  const items = document.createElement('div'); items.className = 'brief-items';
  const tip = document.createElement('div'); tip.className = 'brief-tip';
  const actions = document.createElement('div'); actions.className = 'brief-actions';
  const back = document.createElement('button'); back.className = 'mc-btn brief-back'; back.textContent = '← Back';
  const skip = document.createElement('button'); skip.className = 'mc-btn brief-skip'; skip.textContent = 'Skip briefing';
  const next = document.createElement('button'); next.className = 'mc-btn brief-next';
  actions.append(back, skip, next);
  content.append(stepper, contentLabel, items, tip, actions);
  if (!isMobile) {
    const hint = document.createElement('div'); hint.className = 'brief-hint';
    hint.innerHTML = 'Navigate with <span class="brief-key">←</span> <span class="brief-key">→</span> · <span class="brief-key">Esc</span> to skip';
    content.appendChild(hint);
  }
  frame.append(visual, content);
  panel.append(field, frame);
  app.appendChild(panel);

  function render(): void {
    const step = steps[i];
    panel.style.setProperty('--brief-accent', step.accent);
    panel.dataset.step = String(i + 1);
    chapter.textContent = step.chapter;
    heroBob.replaceChildren(makeCube(iconSvg(step.icon)));
    number.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
    title.replaceChildren(...step.title.split('*').map((part, n) => {
      if (n % 2 === 0) return document.createTextNode(part);
      const em = document.createElement('em'); em.textContent = part; return em;
    }));
    summary.textContent = step.summary;
    tip.textContent = step.tip;
    stepButtons.forEach((b, n) => {
      b.classList.toggle('active', n === i);
      b.classList.toggle('done', n < i);
      if (n === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    items.replaceChildren();
    step.items.forEach((detail, n) => {
      const row = document.createElement('div'); row.className = 'brief-item';
      row.style.setProperty('--n', String(n));
      const glyph = document.createElement('div'); glyph.className = 'brief-item-glyph';
      glyph.innerHTML = iconSvg(detail.icon);
      const text = document.createElement('div');
      const label = document.createElement('div'); label.className = 'brief-item-label'; label.textContent = detail.label;
      const value = document.createElement('div'); value.className = 'brief-item-value'; value.textContent = detail.value;
      text.append(label, value);
      row.append(glyph, text);
      if (detail.keys) {
        const keys = document.createElement('div'); keys.className = 'brief-keys';
        for (const k of detail.keys) {
          const cap = document.createElement('span'); cap.className = 'brief-key'; setIconText(cap, k);
          keys.appendChild(cap);
        }
        row.appendChild(keys);
      }
      items.appendChild(row);
    });
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Enter the world →' : 'Continue →';
    // Restart the entrance animation for the new step.
    panel.classList.remove('is-entering');
    void panel.offsetWidth;
    panel.classList.add('is-entering');
  }

  function go(n: number): void {
    if (n === i || n < 0 || n >= steps.length) return;
    i = n; render();
  }

  function finish(): void {
    panel.style.display = 'none';
    tutorialSeen = true;
    try { localStorage.setItem('voxelon.tutorialSeen', '1'); } catch { /* ignore */ }
    if (worldReady) resumePlay();
  }

  function advance(): void {
    if (i >= steps.length - 1) finish(); else go(i + 1);
  }

  back.addEventListener('click', () => go(i - 1));
  skip.addEventListener('click', finish);
  next.addEventListener('click', advance);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); advance(); }
  });

  return {
    get open(): boolean { return panel.style.display === 'flex'; },
    show(): void {
      i = 0; render();
      panel.style.display = 'flex';
      panel.classList.remove('is-opening'); void panel.offsetWidth; panel.classList.add('is-opening');
      panel.focus();
    },
    finish,
  };
})();

document.getElementById('resume-btn')!.addEventListener('click', () => {
  resumePlay();
});

let hudSaveTimer = 0;
/** Coalesced save. Every control in the HUD panel and every pixel of a drag
 *  lands here, and a localStorage write is synchronous. */
function saveHudSoon(): void {
  window.clearTimeout(hudSaveTimer);
  hudSaveTimer = window.setTimeout(() => saveHudSettings(hudSettings), 200);
}

// The always-on readouts (FPS, CPS, coordinates, keystrokes). They are their
// own overlay rather than part of the HUD class because the player can drag
// each one anywhere on screen, so nothing about where they sit is fixed.
const hudMods = createHudMods(app, {
  layout: hudSettings.layout,
  binds: hudSettings.binds,
  onChange: saveHudSoon,
  // Leaving the drag editor puts the player back where they opened it from:
  // the HUD Settings panel, over the pause menu.
  onEditDone: () => {
    if (screen === 'paused') {
      pauseEl.style.display = 'flex';
      hudSettingsPanel.show();
    }
  },
});

// HUD Settings sits over the pause menu rather than replacing it: the panel
// previews the theme against a stand-in sky, so there is nothing to see behind
// it and closing it should land you back where you opened it.
const hudSettingsPanel = createHudSettingsPanel(app, {
  settings: hudSettings,
  touch: isMobile,
  onChange: () => {
    input.setBinds(hudSettings.binds);
    hudMods.setBinds(hudSettings.binds);
    // Toggling a module or resizing it in the panel has to reach the live
    // overlay, which is reading the same layout object.
    hudMods.sync();
    saveHudSoon();
  },
  onClose: () => { if (screen === 'paused') pauseEl.style.display = 'flex'; },
  // Hand the whole screen over to the drag editor: the pause menu behind the
  // panel would otherwise sit on top of the very readouts being arranged.
  onEditLayout: () => {
    pauseEl.style.display = 'none';
    hudMods.beginEdit();
  },
});
document.getElementById('hud-settings-btn')!.addEventListener('click', () => {
  hudSettingsPanel.show();
});
document.getElementById('quit-btn')!.addEventListener('click', () => {
  // Quitting mid-fight would be a combat log with extra steps (the server
  // refuses to hide a tagged body anyway), so hold the door until it lapses.
  if (net.connected && !arenaActive && combatSecondsLeft() > 0) {
    showNotice(`You're in combat — you can quit in ${Math.ceil(combatSecondsLeft())}s.`);
    return;
  }
  // Quitting the play screen must relinquish every helicopter attachment even
  // though the title shares this page and the network connection stays alive.
  if (myRope) dropFastRope();
  if (mySeat) dismountHeli();
  if (!net.connected) offlineVehicles.disconnectPlayer(0);
  setSeat(null);
  myRope = null;
  vehicleHud.setRope(false);
  if (arenaKind === 'party' || partySnapshot || partyQueued) {
    leaveParty();

  } else if (arenaActive || duelSnapshot || duelQueued) {
    net.sendDuelLeave(); cleanupDuelSession(true);
  }
  pushStateSave();
  enterTitle();
});

document.addEventListener('pointerlockchange', () => {
  if (!worldReady) return;
  if (screen === 'duel_results') {
    pauseEl.style.display = 'none';
    if (input.locked) input.unlock();
    return;
  }
  if (input.locked) {
    enterPlaying(); // entered or returned to the game
  } else if (!player.dead && screen === 'playing' && !cursorPanelOpen()) {
    // A panel that asked for the cursor is deliberately NOT in the pause path:
    // it frees the mouse while the world keeps running, so unlocking for it must
    // not slam the pause menu up behind it (which would also strand `screen` on
    // 'paused' and stop the arbiter re-locking when the panel closes). That is
    // exactly what `cursorPanelOpen` is for — one list, so a panel added there
    // can never fall through to the pause menu again.
    enterPause(); // Esc / lost focus while playing -> pause, not the title
  }
});
// Safety net: re-engage pointer lock by clicking the world when we're in-game
// but unlocked (e.g. a menu just closed but the browser blocked an immediate
// re-lock — "requestPointerLock too soon after exit"). This guarantees you can
// always get movement back after closing the Map panel.
renderer.domElement.addEventListener('mousedown', () => {
  if (warfareUI.open) {
    // The Warfare panel floats over a live world: clicking the world beside it
    // means "I'm done reading" — close it and take the mouse back.
    warfareUI.hide();
    return;
  }
  if (!input.locked) syncPointerLock();
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.defaultPrevented) return;
  if (interaction.armedMove) {
    interaction.armedMove = null;
    showNotice('Machine relocation cancelled.');
  }
  if (tutorial.open) { tutorial.finish(); }
  else if (chatBox.open) { chatBox.hide(); }
  else if (warfareUI.open) { hideProgress(); }
  else if (guideOpen) { hideGuide(); }
  else if (worldMap.open) { worldMap.hide(); input.lock(); }
  else if (invUI.open) { invUI.hide(); input.lock(); }
  else if (trapPanelAt) { closeTrapPanel(); }
  else if (fieldGuide.open) fieldGuide.backToPause();
  // Do not re-lock from Escape while paused. Browsers may deliver the native
  // pointer-lock exit before this key event; treating that same press as
  // "resume" caused an unlock/relock race that could strand avatar/death UI.
  else if (screen === 'paused') return;
  else if (screen === 'playing' && !player.dead) { input.unlock(); enterPause(); }
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

/**
 * Tip everything we were carrying onto the ground where we died.
 *
 * Three things this has to get right, each of which has cost somebody their
 * pockets:
 *
 * - It must not DELETE the loot when it cannot drop it. `spillAll` empties the
 *   inventory first, and a socket that closed a moment ago still accepts sends
 *   and discards them, so a death during a connection blip erased everything
 *   the player was carrying and dropped nothing. The stacks go back where they
 *   were if the drop did not reach the wire; keeping them is a far smaller
 *   wrong than erasing them, and the server's own copy still has them anyway.
 * - It must not be TAXED. The levy is on what you pull out of the ground, and
 *   `spillStacks` defaults to that; a corpse is not a harvest, so the faction
 *   does not get a cut of the worst moment of somebody's week.
 * - It must not land somewhere unreachable. A death in the void spilled at the
 *   death height, which on the server rests the stack below the world where
 *   nothing can ever pick it up. Anything below the surface goes on top of it.
 */
function spillDeathLoot(): void {
  const carried = inventory.serialize();
  const loot = inventory.spillAll();
  if (!loot.length) return;
  const x = player.pos.x, z = player.pos.z;
  const surface = world.terrain.height(Math.floor(x), Math.floor(z)) + 2;
  const y = player.pos.y + 1 < 1 ? surface : player.pos.y + 1;
  if (!spillStacks(loot, x, y, z)) {
    inventory.restore(carried);
    showNotice('⚠ Connection lost — your items stayed with you.');
  }
}

function checkDeath(): void {
  // Rearm on every return to life. `deathShown` used to be cleared only by the
  // server's `respawned` message, but several paths hand a live body back
  // without one — entering an arena, and both arena-exit restores, all assign
  // `player.dead` directly. Any of them left the latch stuck ON, and the NEXT
  // real death then hit the early return below: no death screen, and no spill.
  // Deriving it from the state it is latching cannot drift out of step.
  if (!player.dead) {
    if (deathShown) { deathShown = false; deathEl.style.display = 'none'; }
    return;
  }
  if (deathShown) return;
  deathShown = true;
  interaction.armedMove = null;
  if (myRope) {
    if (!net.connected) offlineVehicles.detachRope(0);
    myRope = null;
    vehicleHud.setRope(false);
  }
  clearVaultPresentation(true, 0.35);
  invUI.hide(); // closes (and saves) an open chest BEFORE we spill the inventory
  // An arena body carries an arena loadout, which does not belong to the world
  // economy and must never be tipped into it. The modes run their own death
  // and respawn; the open-world spill below is for the open world only.
  if (!arenaActive) spillDeathLoot();
  pushStateSave(); // persist the now-empty inventory so a reconnect can't dupe it
  // We can die while the pause menu is up (the sim never pauses). Normalize to
  // 'playing' and drop the pause menu so the death screen is the only overlay
  // and the Esc handler has no 'paused' branch to re-lock the pointer over it.
  if (fieldGuide.open) fieldGuide.closeSilently();
  screen = 'playing';
  pauseEl.style.display = 'none';
  deathEl.style.display = 'flex';
  input.unlock();
}

// --- Persistence: server-stored inventory + position (MP) and localStorage
// (offline). The server is the system of record online; offline we mirror to
// localStorage keyed by the local account so single-player also persists.
function pushStateSave(): void {
  if (arenaActive) return; // temporary arena coordinates/loadout never persist
  if (net.connected) {
    // Warfare Command progression is deliberately NOT in this blob: the server
    // stores it on the account, so a client state push can never mint or wipe
    // technology. The retired `progress` key is simply never written again.
    net.sendSaveState(inventory.serialize() as unknown as Record<string, unknown>);
  } else if (authedName) {
    try {
      localStorage.setItem(`voxelon.inv.${authedName.toLowerCase()}`,
        JSON.stringify(inventory.serialize()));
    } catch { /* ignore */ }
    saveOfflineWarfare();
  }
}
net.onRestoreState = (state) => {
  // Run the one-time warfare migration FIRST and use its cleaned output, so the
  // retired progression keys (`progress`/`xp`/`skills`/`factionXp`) are gone
  // before anything reads the blob. The authoritative technology itself arrives
  // separately in the `warfare` message.
  const cleaned = migrateWarfare(state as Record<string, unknown>).data;
  inventory.restore(cleaned);
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
  // The flag sync normally arrives BEFORE this, when we had no side to judge it
  // against — re-decide the badge now that we know which one we are on.
  refreshFlagless();
  localSeasonsWon = me.seasonsWon ?? 0; // authoritative badge from the account
  player.pos.set(me.x, me.y, me.z);
  player.vel.set(0, 0, 0);
  // Startup may already have prepared the default spawn while authentication
  // was in flight. A returning player can be thousands of blocks away, so the
  // readiness gate must follow the restored position instead of doing work at
  // a location they will never see.
  worldReady = false;
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
  // Logging in lands on the title screen (a reconnect mid-game does not): stay
  // out of everyone's world until Play, or our body stands frozen at the
  // saved spot the whole time we sit in the menus.
  if (screen === 'title') net.sendAway();
  joinPendingDuel();
  joinPendingParty();
};
net.onPlayerCounts = (counts) => {
  livePlayerCounts = counts;
  renderLivePlayerCounts();
};
net.onWorldTime = (seconds) => {
  if (!Number.isFinite(seconds)) return;
  serverWorldTime = seconds;
  serverWorldTimeAt = performance.now();
  hasServerWorldTime = true;
};
net.onFlags = (breakable, flags) => {
  flagState = { breakable, flags: flags.map((flag) => ({ ...flag })) };
  flagModels.setState(breakable, flagState.flags);
  refreshFlagless();
};
// Someone (possibly us) changed their look: rebuild that avatar.
net.onCosmetics = (id) => remotePlayers.invalidate(id);
function applyNetworkEdit(x: number, y: number, z: number, b: number): void {
  world.applyRemoteEdit(x, y, z, b);
  // If someone removed/replaced the chest block we have open, stop viewing it.
  if (openChest && openChest.x === x && openChest.y === y && openChest.z === z
    && b !== Block.Chest) {
    forceCloseChest();
  }
  syncTurretCell(x, y, z, b);
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
}
net.onEdit = applyNetworkEdit;
net.onEditBatch = (edits) => {
  world.beginBatch();
  for (const e of edits) applyNetworkEdit(e.x, e.y, e.z, e.block);
  world.endBatch();
};
net.onHurt = (health, dead, k, by, combat) => {
  const bite = Math.max(0, player.health - health);
  player.setHealthFromServer(health, dead);
  player.vel.x += k[0] * 6; player.vel.y += k[1] * 6; player.vel.z += k[2] * 6;
  // How hard it bit drives the rim and the kick, so a graze and a near-death
  // hit are told apart before the health bar is ever read.
  hurtPulse = Math.min(1, Math.max(hurtPulse, 0.34 + bite / 13));
  triggerEncounterShake(0.13, Math.min(0.05, 0.006 + bite * 0.0016));
  if (dead) { pvpStreak.died(by !== net.myId ? by : -1); damageNumbers.clear(); }
  // Point a wedge back at whoever did it. Only another PLAYER gets one — falls,
  // lava and mobs are self-evident, an unseen sniper is not.
  const attacker = net.remotes.get(by);
  if (attacker && by !== net.myId) showDamageFrom(attacker.tx, attacker.tz);
  if (combat > 0 && by !== net.myId) {
    combatTagUntilLocal = worldTimeLocal + Math.max(0, combat);
    lastDamageLocal = worldTimeLocal;
    // A grapple already in flight is mobility too: taking a PvP hit cuts it,
    // and the same timer below prevents firing another one.
    if (grappleStage) endGrapple();
  }
  // lastHealth is left alone so the frame loop plays the hurt sound.
};
net.onHitConfirm = (target, amount, killed) => showPvpHit(target, amount, killed);
// Someone else pulled a trigger: replay it as ghost tracers + a positional
// report. This is what stops enemy fire being invisible and silent — you can
// now see the streaks, hear the direction, and take cover.
net.onShot = (id, item, x, y, z, dx, dy, dz) => {
  const gun = ITEMS[item]?.gun;
  if (!gun) return;
  const origin = new THREE.Vector3(x, y, z);
  const dir = new THREE.Vector3(dx, dy, dz);
  if (dir.lengthSq() < 1e-6) return;
  dir.normalize();
  // Only the trigger pull is networked; every receiver re-rolls the gun's own
  // pellet spread locally, so a shotgun still sprays without seven messages.
  const pellets = Math.max(1, gun.pellets ?? 1);
  for (let i = 0; i < pellets; i++) {
    projectiles.fireGhost(origin, spreadDir(dir, gun.spread ?? 0), gun);
  }
  audio.gun(origin, gunFeel(item).kick);
  remotePlayers.muzzleFlash(id);
};
// Cosmetic remote explosion (the crater itself arrives as ordinary edits).
net.onBlast = (x, y, z) => {
  particles.explosion(x, y, z);
  audio.explosion(new THREE.Vector3(x, y, z));
};
// Server-authoritative health between hits (REGEN): the periodic snapshot
// carries our own health, so the HUD ticks up smoothly instead of freezing
// until the next hit. Never let a snapshot revive us — that's onRespawned's job.
net.onSelfHealth = (health, dead) => {
  if (player.dead && !dead) return;
  player.setHealthFromServer(health, dead);
};
net.onRespawned = (x, y, z, h) => {
  if (arenaKind === 'party') resetPartyWeaponPose();
  player.respawn({ x, y, z });
  player.health = h;
  lastHealth = h;
  hurtPulse = 0;
  damageNumbers.clear();
  killBanner.clear();
  deathShown = false;
  deathEl.style.display = 'none';
  pushStateSave();
  if (worldReady && screen === 'playing') input.lock();
};
net.onKillfeed = (killer, victim, how) => {
  if (arenaActive) pushDuelKill(killer, victim);
  else showKill(killer, victim, how);
};
net.onRoster = refreshNetInfo;
// Admin gamemode/teleport/notice (driven from the server console).
net.onGamemode = (mode) => { applyLocalMode(mode); showNotice(`Gamemode: ${mode}`); };
net.onTeleport = (x, y, z) => {
  endGrapple();
  player.pos.set(x, y, z);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  // Corrections inside a loaded arena are immediate. Waiting for meshes on
  // every correction repeatedly pins the player, even though collision data
  // is already present. Check every column the body can occupy on arrival.
  const loaded = [-.3, .3].every(dx => [-.3, .3].every(dz => world.isLoaded(x + dx, z + dz)));
  pendingTeleport = arenaActive && loaded ? null : { x, y, z, started: worldTimeLocal };
  if (!arenaActive) showNotice('Teleporting…');
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
    showNotice(`🗿 Totem attuned (${attunedTotems.length}/${MAX_ATTUNED}) — open the map (/map) to travel!`);
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
  if (!arenaActive) showNotice('Teleporting…');
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
    `<div style="font-size:44px;color:#ff5a5a;text-shadow:3px 3px 0 #000;letter-spacing:3px;">${iconSvg('skull')} ELIMINATED</div>` +
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
  title.innerHTML = iconifyHtml('✨ REVIVE A TEAMMATE');
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
// --- HEALING CONSUMABLES ------------------------------------------------------
// Using a Bandage/Medkit is a short channelled ACT: the hand lifts the item into
// view and works it in over ~1-2s (see healuse.ts for the timing), a bar under
// the crosshair fills, soft beats tick along with the presses, and the payoff is
// a chime + green motes + a breathing vignette while the regen buff runs.
const useBarEl = document.getElementById('use-bar') as HTMLDivElement;
const useBarFill = useBarEl.querySelector('.use-fill') as HTMLDivElement;
const useBarLabel = useBarEl.querySelector('.use-label') as HTMLDivElement;
const healGlowEl = document.getElementById('heal-glow') as HTMLDivElement;
const heartsEl = document.getElementById('hearts') as HTMLCanvasElement;
const healUse = new HealUse();
let healGlow = 0;      // 0..1 vignette strength (decays; pulses on each heal tick)
let healBuff = 0;      // seconds of accelerated regen left (visual only)
let heartsSqueeze = 0; // seconds left of the hearts-bar squeeze

/** Floating "+N" above the health bar whenever the buff restores health. */
function showHealPopup(amount: number): void {
  const el = document.createElement('div');
  el.className = 'heal-pop mc-font';
  el.textContent = `+${amount}`;
  app.appendChild(el);
  window.setTimeout(() => el.remove(), 1000);
}

/** Right-click a held Bandage/Medkit: begin applying it. */
function beginHealUse(): void {
  if (healUse.active) return;
  const stack = inventory.selectedStack;
  const heal = stack ? ITEMS[stack.id]?.heal : undefined;
  if (!stack || !heal) return;
  if (player.health >= player.maxHealth) {
    showNotice("You're already at full health!");
    return;
  }
  healUse.start(stack.id, inventory.selected);
  audio.healStart(stack.id === Item.Medkit);
  held.swing(); // the hand reaches for it before the wrap animation takes over
}

/** Interrupted mid-wrap (switched away, opened a menu, died): nothing is spent. */
function cancelHealUse(notice = true): void {
  if (!healUse.active) return;
  const name = ITEMS[healUse.itemId]?.name ?? 'Heal';
  healUse.cancel();
  audio.healCancel();
  if (notice) showNotice(`${name} interrupted.`);
}

/** The channel completed: spend the item and start the fast-regen window. In MP
 *  the server owns health (the buff flows back via the snapshot); offline the
 *  local Survival sim applies the same accelerated regen. */
function finishHealUse(id: number): void {
  const heal = ITEMS[id]?.heal;
  // The item is only spent on completion, and only if it is still in hand.
  if (!heal || inventory.selectedStack?.id !== id) return;
  inventory.consumeSelected(1);
  if (net.connected) net.sendUseHeal(id);
  else survival.boost(heal.duration, heal.interval);
  const medkit = id === Item.Medkit;
  showNotice(`${ITEMS[id]?.name ?? 'Heal'} applied — regenerating fast!`);
  audio.heal(medkit);
  healBuff = heal.duration;
  healGlow = Math.max(healGlow, medkit ? 0.9 : 0.65);
  heartsSqueeze = 0.16;
  particles.heal(player.pos.x, player.pos.y + 1, player.pos.z, medkit ? 22 : 14, medkit);
  pushStateSave();
}

/** Per-frame: advance the channel, drive the bar, and keep the post-heal glow
 *  breathing. `active` is false whenever the player can't be patching up. */
function updateHealFeel(dt: number, active: boolean): void {
  if (healUse.active) {
    const stack = inventory.selectedStack;
    if (!active || inventory.selected !== healUse.slot || stack?.id !== healUse.itemId) {
      cancelHealUse();
    } else {
      const step = healUse.tick(dt);
      for (let i = 0; i < step.beats; i++) {
        audio.healBeat(i);
        particles.heal(player.pos.x, player.pos.y + 1.1, player.pos.z, 3);
      }
      if (step.done) finishHealUse(step.item);
    }
  }

  // Use bar under the crosshair.
  if (healUse.active) {
    useBarEl.style.display = 'block';
    useBarFill.style.width = `${(healUse.progress * 100).toFixed(1)}%`;
    useBarLabel.textContent = (ITEMS[healUse.itemId]?.name ?? 'Applying').toUpperCase();
  } else {
    useBarEl.style.display = 'none';
  }

  // Green vignette: a strong pop on application that settles into a slow
  // breathing glow for as long as the fast regen runs.
  if (healBuff > 0) {
    healBuff = Math.max(0, healBuff - dt);
    const breathe = accessibility.reducedMotion ? 0.5 : 0.5 + Math.sin(worldTimeLocal * 3.2) * 0.18;
    healGlow = Math.max(healGlow - dt * 1.6, 0.26 * breathe);
  } else {
    healGlow = Math.max(0, healGlow - dt * 1.8);
  }
  const cap = accessibility.photosensitivitySafe ? 0.22 : 0.5;
  healGlowEl.style.opacity = String(Math.min(cap, healGlow * 0.55));

  // Hearts squeeze on each restored point.
  heartsSqueeze = Math.max(0, heartsSqueeze - dt);
  heartsEl.style.transform = heartsSqueeze > 0 && !accessibility.reducedMotion
    ? 'scale(1.14)' : 'scale(1)';
}

/** Health went UP: while a bandage/medkit buff is running, sell every point. */
function onHealthRestored(amount: number): void {
  if (healBuff <= 0 || amount <= 0) return;
  showHealPopup(amount);
  audio.healTick(1 + Math.min(0.5, player.health / Math.max(1, player.maxHealth)));
  healGlow = Math.min(1, healGlow + 0.22);
  heartsSqueeze = 0.16;
  particles.heal(player.pos.x, player.pos.y + 1, player.pos.z, 4);
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
// --- WARFARE COMMAND ----------------------------------------------------------
// The retired Progress system (personal kill XP, the five generic skill
// branches, faction XP levels and every "+2% speed" buff) is GONE. Warfare XP
// comes from exactly one place: dungeon bosses you actually helped kill.
//
// Online the SERVER owns the progression and pushes it down; offline the same
// pure rules run locally against a versioned localStorage key. The old
// `voxelon.prog.*` / `voxelon.fxp.*` keys are read once by the migration and
// then never written again.
const WARFARE_KEY_PREFIX = 'voxelon.warfare.v1.';
let warfare: WarfareProgress = newWarfare();

function warfareKey(): string {
  return `${WARFARE_KEY_PREFIX}${(authedName || 'player').toLowerCase()}`;
}

function saveOfflineWarfare(): void {
  if (net.connected || !authedName) return;
  try { localStorage.setItem(warfareKey(), JSON.stringify(warfare)); }
  catch { /* ignore */ }
}

/** Load the offline blob, running the one-time `warfare-v1` migration: the
 *  retired progression keys are discarded and removed so later saves never
 *  carry them. Inventory, hearts, factions, records and world edits live under
 *  other keys and are untouched. */
function restoreOfflineWarfare(): void {
  if (net.connected || !authedName) return;
  try {
    const raw = localStorage.getItem(warfareKey());
    warfare = sanitizeWarfare(raw ? JSON.parse(raw) : null);
    const name = authedName.toLowerCase();
    // One-time cleanup of the dead progression keys.
    localStorage.removeItem(`voxelon.prog.${name}`);
    localStorage.removeItem(`voxelon.fxp.${name}`);
  } catch { warfare = newWarfare(); }
}

/** Award warfare XP locally (offline) with the toast + fanfare. */
function grantOfflineWarfareXp(amount: number, boss: string, tier: number): void {
  const got = grantWarfareXp(warfare, amount);
  if (got <= 0) return;
  showRegionBanner(`⌘ +${got} WARFARE XP`, '#5ce2ec');
  showNotice(`Tier ${tier} ${boss} cleared — ${warfareAvailable(warfare)} XP available to spend.`);
  audio.heartSteal();
  saveOfflineWarfare();
  warfareUI.refresh();
}

// Mob kills no longer grant progression of ANY kind — that was the whole point
// of retiring the old system. (The hook stays so mob-death sounds/loot keep
// working through the same path.)
mobs.onPlayerKill = () => { /* warfare XP comes from vault bosses only */ };
// Shared mobs: every client simulates the mobs it spawned and streams them;
// the others draw proxies and send their hits to the owner (mobs.ts).
mobs.onProxyHit = (mob, dmg, kx, kz) => {
  if (mob.proxy) net.sendMobHit(mob.proxy.owner, mob.proxy.nid, dmg, kx, kz);
};
net.onMobs = (owner, list, gone) => { if (!arenaActive) mobs.applyRemote(owner, list, gone); };
net.onMobHit = (_from, nid, dmg, kx, kz) => mobs.applyRemoteHit(nid, dmg, kx, kz);
net.onLeave = (id) => mobs.dropOwner(id);
let mobSyncTimer = 0;
let mobSyncHadAny = false;
/** Stream our mobs ~10×/s while anyone could be watching. An empty list is
 *  still sent once after the last one goes, so proxies clear promptly. */
function syncMobs(dt: number): void {
  mobSyncTimer -= dt;
  if (!net.connected || mobSyncTimer > 0) return;
  mobSyncTimer = 0.1;
  if (net.remotes.size === 0) { mobSyncHadAny = false; return; }
  const { mobs: list, gone } = mobs.wire(player.pos);
  if (!list.length && !gone.length && !mobSyncHadAny) return;
  mobSyncHadAny = list.length > 0;
  net.sendMobSync(list, gone);
}

/** Rune bonuses are the only surviving personal modifiers. The five generic
 *  Progress branches and the faction-level perks were retired with the old
 *  system, so this now reads straight off worn gear. */
function activeBuffs(): {
  speedMult: number; armorBonus: number; toughness: number; reloadMult: number;
  mineMult: number; spreadMult: number; gunDamageMult: number; wearSave: number;
  meleeBonus: number; energyMult: number; fallMult: number; xpMult: number;
} {
  const worn = inventory.wornArmor();
  const runes = runeBonuses(worn);
  const defense = runeDefense(inventory.armorPoints(), worn);
  return {
    speedMult: runes.speedMult,
    armorBonus: runes.armor,
    toughness: defense.toughness,
    reloadMult: runes.reloadMult,
    wearSave: runes.wearSave,
    mineMult: runes.mineMult,
    spreadMult: runes.spreadMult,
    gunDamageMult: 1,
    meleeBonus: 0,
    energyMult: 1,
    fallMult: 1,
    xpMult: 1,
  };
}

// --- The G panel: Warfare Command ---------------------------------------------
const warfareUI = new WarfareUI({
  state: () => warfare,
  tint: () => factionCss(localFaction),
  buy: (id) => {
    if (net.connected) {
      // The server is the authority; it echoes the new state back to us.
      net.sendWarfareBuy(id);
      // Optimistic local apply keeps the panel responsive; a `warfare` message
      // overwrites it either way, so a rejected buy self-corrects.
      buyWarfareNode(warfare, id);
    } else if (buyWarfareNode(warfare, id)) {
      saveOfflineWarfare();
    }
  },
  onPurchase: (node) => {
    // The panel runs its own celebration (pop, shockwave, banner); this is the
    // part that reaches outside it — a real fanfare and a world-space toast.
    audio.warfareAuthorized();
    showNotice(`${node.name} authorized.`);
  },
  onOpen: () => input.unlock(),
  onClose: () => {
    if (worldReady && !player.dead && screen === 'playing') input.lock();
  },
});
app.appendChild(warfareUI.root);
// No click-outside handler here on purpose: the panel's shell is click-through
// so the world behind it stays live, and the canvas's own mousedown (above)
// closes the panel when you click back into the game.
window.addEventListener('resize', () => { if (warfareUI.open) warfareUI.layoutMode(); });

function showProgress(): void {
  if (warfareUI.open || player.dead) return;
  if (invUI.open) invUI.hide();
  if (worldMap.open) worldMap.hide();
  warfareUI.show();
}
function hideProgress(): void { warfareUI.hide(); }
function toggleProgress(): void {
  if (warfareUI.open) warfareUI.hide();
  else if (input.locked && screen === 'playing') showProgress();
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
let bossVictoryTimer = 0;
const bossRenderTarget = new THREE.Vector3();
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
interface OfflineArenaPlacement { encounterId: string; block: number; restoreBlock: number; }
const offlineArenaPlacements = new Map<string, OfflineArenaPlacement>();
const pendingOfflineArenaPlacements = new Map<string, number>();

/** One cleanup gate for every way an encounter presentation can end. Keeping
 * this atomic prevents a late snapshot from leaving a boss bar, cinematic or
 * soundtrack behind on the title/death/disconnect screens. */
function clearVaultPresentation(dropSnapshot = true, musicFade = 0.3): void {
  if (dropSnapshot) encounterSnapshot = null;
  activeEncounterId = '';
  vaultBossHud.hide();
  vaultCinematic.finish();
  vaultEncounterVisuals.hide();
  audio.stopVaultMusic(musicFade);
}
let vaultPollTimer = 0;
/** Seconds you must stay outside a vault's bounds before it counts as leaving —
 *  long enough to absorb a boss knockback, short enough to feel immediate. */
const VAULT_EXIT_GRACE = 1.2;
let vaultExitGrace = 0;
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

// Discovered vaults (client-side collection: the "found X / Y" count).
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
// Every vault in the seed (for proximity sensing and the "found X / Y" count).
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
}

/** Crossing a vault's bounds: sting + banner + minimap dim + discovery, and
 *  fetch/derive the authoritative boss state. */
function onVaultTransition(v: VaultStamp | null): void {
  const previousKey = curVault ? vaultKeyOf(curVault) : null;
  if (!v) {
    cleanupOfflineArenaPlacements();
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
    cleanupOfflineArenaPlacements();
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

function blockInsideArena(v: VaultStamp, x: number, y: number, z: number): boolean {
  const b = v.arena.bounds;
  return x + 0.5 >= b.minX && x + 0.5 <= b.maxX &&
    y + 0.5 >= b.minY && y + 0.5 <= b.maxY &&
    z + 0.5 >= b.minZ && z + 0.5 <= b.maxZ;
}

/** Offline mirrors the server's ownership cleanup without firing block drops. */
function cleanupOfflineArenaPlacements(encounterId?: string): void {
  world.beginBatch();
  for (const [key, placed] of [...offlineArenaPlacements]) {
    if (encounterId && placed.encounterId !== encounterId) continue;
    offlineArenaPlacements.delete(key);
    const [x, y, z] = key.split(',').map(Number);
    if (world.getBlock(x, y, z) !== placed.block) continue;
    if (machines.has(x, y, z)) machines.remove(x, y, z);
    world.applyRemoteEdit(x, y, z, placed.restoreBlock);
  }
  world.endBatch();
  pendingOfflineArenaPlacements.clear();
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
  // Mirrors the server exactly (gunVolley): every pellet of a shotgun volley
  // and every round of a burst is its own hit, so the cooldown is budgeted
  // across the volley and each hit is capped at one projectile's damage.
  const volley = heldInfo?.gun ? gunVolley(heldInfo.gun) : null;
  const maxDamage = volley ? volley.perHit
    : gadget ? Math.min(30, gadget.damage ?? 8)
      : stack?.id === Item.Sword ? 7 : 4;
  const range = heldInfo?.gun ? heldInfo.gun.range : gadget ? 24 : 4;
  const cadence = volley ? volley.cadence : gadget ? 0.8 : 0.32;
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
  } else if (event.type === 'seal') {
    audio.vaultMusicCue('door');
    triggerEncounterShake(0.45, 0.12);
  } else if (event.type === 'move') {
    audio.vaultMusicCue('movement');
    triggerEncounterShake(0.18, 0.045);
  } else if (event.type === 'combo') {
    audio.vaultMusicCue('combo');
    triggerEncounterShake(0.5, 0.13);
  } else if (event.type === 'wave') {
    audio.vaultMusicCue('army');
    triggerEncounterShake(0.4, 0.1);
  } else if (event.type === 'heal') {
    audio.vaultMusicCue(event.audio === 'healing_interrupt' ? 'interrupt' : 'healing');
    if (event.audio === 'healing_interrupt') showNotice('✦ HEALING NETWORK BROKEN!');
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

const seenBossImpacts = new Set<number>();
let bossImpactEncounter = '';
const bossImpactPosition = new THREE.Vector3();
function updateBossImpacts(snapshot: EncounterSnapshot | null): void {
  if (!snapshot || snapshot.encounterId !== bossImpactEncounter) {
    seenBossImpacts.clear(); bossImpactEncounter = snapshot?.encounterId ?? '';
  }
  if (!snapshot || snapshot.status !== 'active') return;
  let strongest: EncounterSnapshot['hazards'][number] | undefined;
  for (const hazard of snapshot.hazards) {
    if (snapshot.time < hazard.executeAt || snapshot.time > hazard.expiresAt ||
        seenBossImpacts.has(hazard.id)) continue;
    seenBossImpacts.add(hazard.id);
    if (!strongest || hazard.damage > strongest.damage) strongest = hazard;
  }
  if (seenBossImpacts.size > 128) {
    const active = new Set(snapshot.hazards.map(h => h.id));
    for (const id of seenBossImpacts) if (!active.has(id)) seenBossImpacts.delete(id);
  }
  if (!strongest) return;
  bossImpactPosition.set(strongest.origin.x, strongest.origin.y + 0.5, strongest.origin.z);
  audio.vaultImpact(snapshot.family, bossImpactPosition, strongest.damage / 7);
  const distance = bossImpactPosition.distanceTo(player.pos);
  if (distance < strongest.radius + 9) triggerEncounterShake(0.2,
    Math.min(0.07, strongest.damage * 0.007) * Math.max(0, 1 - distance / 28));
}

function triggerEncounterShake(duration: number, strength: number): void {
  if (accessibility.reducedMotion || accessibility.photosensitivitySafe || accessibility.cameraShake <= 0) return;
  encounterShakeTime = Math.max(encounterShakeTime, duration);
  encounterShakeStrength = Math.max(encounterShakeStrength,
    strength * accessibility.cameraShake);
}

/** This frame's shake offset, remembered so a camera repositioned later in the
 *  frame (the helicopter seat) can re-apply it instead of cancelling it. */
const shakeOffset = new THREE.Vector2();

function updateEncounterShake(dt: number): void {
  shakeOffset.set(0, 0);
  if (encounterShakeTime <= 0 || accessibility.reducedMotion) return;
  encounterShakeTime = Math.max(0, encounterShakeTime - dt);
  const fade = Math.min(1, encounterShakeTime * 4);
  const x = Math.sin(worldTimeLocal * 79) * encounterShakeStrength * fade;
  const y = Math.cos(worldTimeLocal * 63) * encounterShakeStrength * fade * 0.65;
  shakeOffset.set(x, y);
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
    cameraAnchors: v.arena.cameraAnchors, seal: v.arena.seal,
    startTime: worldTimeLocal,
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
  settleOfflineWarfareXp(v, elapsed);
}

/**
 * The OFFLINE mirror of the server's warfare settlement. It runs the identical
 * pure `settleWarfareXp` over the identical contribution ledger the encounter
 * engine kept, so solo play and multiplayer pay out exactly the same amount for
 * the same fight — and a solo player who watched from the doorway still earns
 * nothing.
 */
function settleOfflineWarfareXp(v: VaultStamp, elapsed: number): void {
  const engine = localVaultEncounter;
  if (!engine) return;
  const name = authedName || 'You';
  const ledger: ContributionRecord[] = [];
  for (const [id, row] of engine.ledger) {
    ledger.push({ id, username: name, damage: row.damage, activeSeconds: row.activeSeconds });
  }
  const awards = settleWarfareXp(ledger, v.tier, engine.maxHp,
    Number.isFinite(elapsed) ? elapsed : 0);
  if (!awards.length) {
    showNotice('No warfare XP — you have to actually fight the boss to earn it.');
    return;
  }
  grantOfflineWarfareXp(awards[0].xp, VAULT_BOSS_NAMES[v.bossKind], v.tier);
}

/** Per-frame vault upkeep: bounds test (throttled), guard anchors, the Brute,
 *  and the unopened-chest sparkle. */
function updateVaults(dt: number): void {
  if (bossVictoryTimer > 0 && bruteMob) {
    bossVictoryTimer = Math.max(0, bossVictoryTimer - dt);
    mobs.poseBoss(bruteMob, null, 3, true);
    if (bossVictoryTimer === 0) { mobs.slay(bruteMob); bruteMob = null; }
  }
  vaultPollTimer -= dt;
  if (vaultPollTimer <= 0) {
    vaultPollTimer = 0.3;
    updateNearbyVaults(); // reveal entrances within range as the player roams
    const v = vaultAt(seed, player.pos.x, player.pos.y + 0.5, player.pos.z,
      world.terrain, vaultStampCached);
    if (v?.cx !== curVault?.cx || v?.cz !== curVault?.cz) {
      // The bounds test is a hard AABB polled a few times a second, and a boss
      // leap, charge or knockback can push you a fraction outside it for a
      // single poll. Tearing the whole encounter down on that flicker is what
      // made the score cut out and restart mid-fight, so leaving a vault has to
      // be sustained before it counts. Entering is still instant.
      if (v) { vaultExitGrace = 0; onVaultTransition(v); }
      else {
        vaultExitGrace += 0.3;
        if (vaultExitGrace >= VAULT_EXIT_GRACE) onVaultTransition(null);
      }
    } else {
      vaultExitGrace = 0;
    }
  }
  mobs.setVault(curVault);
  if (!curVault) {
    vaultEncounterVisuals.hide();
    if (localVaultEncounter) {
      localVaultEncounter.tick(dt, []);
      if (localVaultEncounter.status === 'idle') {
        cleanupOfflineArenaPlacements(localVaultEncounter.config.encounterId);
        localVaultEncounter = null;
        localEncounterVaultKey = null;
      }
    }
    return;
  }
  const view = vaultViews.get(vaultKeyOf(curVault));
  const inArena = localInsideArena(curVault);
  if (!net.connected && localVaultEncounter && (!inArena || player.dead)) {
    cleanupOfflineArenaPlacements(localVaultEncounter.config.encounterId);
  }
  const myEncounterId = net.connected ? net.myId : 0;
  if (encounterSnapshot?.seal.sealed &&
      encounterSnapshot.participants.includes(myEncounterId)) {
    const b = curVault.arena.bounds;
    player.pos.x = Math.max(b.minX + 0.15, Math.min(b.maxX - 0.15, player.pos.x));
    player.pos.z = Math.max(b.minZ + 0.15, Math.min(b.maxZ - 0.15, player.pos.z));
  }
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
    if (!player.dead) {
      for (const event of events) encounterEvent(event);
      for (const hazard of localVaultEncounter.hazards) {
        const damage = localVaultEncounter.hitByHazard(hazard.id, localEncounterParticipant(curVault));
        if (damage > 0) player.damage(damage);
      }
    }
    if (!player.dead) {
      encounterSnapshot = localVaultEncounter.snapshot();
      if (bruteMob) bruteMob.health = encounterSnapshot.hp;
      vaultBossHud.update(encounterSnapshot);
      audio.setVaultMusicPhase(encounterSnapshot.phase, encounterSnapshot.hpPercent < 0.15);
    }
    if (localVaultEncounter.status === 'victory') {
      const victorySnapshot = encounterSnapshot;
      cleanupOfflineArenaPlacements(localVaultEncounter.config.encounterId);
      completeOfflineEncounter(curVault);
      if (victorySnapshot) vaultCinematic.playVictory(victorySnapshot);
      if (bruteMob) {
        bossVictoryTimer = ENCOUNTER_VICTORY_CINEMATIC_SECONDS;
        mobs.poseBoss(bruteMob, null, 3, true);
      }
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
      cleanupOfflineArenaPlacements(localVaultEncounter.config.encounterId);
      encounterSnapshot = null;
      localVaultEncounter = null;
      localEncounterVaultKey = null;
      activeEncounterId = '';
      vaultBossHud.hide();
      audio.stopVaultMusic();
    }
  }
  if (bruteMob?.removed) bruteMob = null;
  if (bruteMob && encounterSnapshot) {
    mobs.poseBoss(bruteMob, encounterSnapshot.cast?.name ?? null, encounterSnapshot.phase);
    bossRenderTarget.set(encounterSnapshot.boss.position.x,
      encounterSnapshot.boss.position.y, encounterSnapshot.boss.position.z);
    bruteMob.pos.lerp(bossRenderTarget, Math.min(1, dt *
      (encounterSnapshot.movement ? 8 : 12)));
    bruteMob.model.group.position.copy(bruteMob.pos);
  }
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
  updateBossImpacts(encounterSnapshot);
  if (encounterSnapshot?.status === 'active') audio.vaultMusicCue('engage');
  const closingShot = vaultCinematic.frame;
  const visualSnapshot = encounterSnapshot ?? (closingShot?.mode === 'victory'
    ? { ...closingShot.snapshot, status: 'victory' as const,
      time: closingShot.snapshot.time + closingShot.progress * ENCOUNTER_VICTORY_CINEMATIC_SECONDS }
    : null);
  vaultEncounterVisuals.update(visualSnapshot, accessibility.highContrastTelegraphs,
    accessibility.reducedMotion || accessibility.photosensitivitySafe);
}

// --- GETTING STARTED guide (early-game direction) ------------------------------
// A small checklist panel so a fresh spawn always knows what to do next: punch
// a tree → tools → a gun → find + loot your first vault. Steps auto-check off
// (inventory scans + vault hooks), persist per account, and /guide toggles it.
const starterEl = document.createElement('div');
starterEl.className = 'mc-font guide-hud';
app.appendChild(starterEl);
const starterHead = document.createElement('div');
starterHead.className = 'guide-hud-head';
const starterTitle = document.createElement('div');
starterTitle.className = 'guide-hud-title';
starterTitle.textContent = 'Getting started';
const starterCount = document.createElement('div');
starterCount.className = 'guide-hud-count';
// A tappable ✕ so touch devices (no H key) can dismiss the checklist too.
const starterCloseBtn = document.createElement('div');
starterCloseBtn.className = 'guide-hud-close';
starterCloseBtn.innerHTML = iconSvg('close');
starterCloseBtn.title = 'Hide (/guide shows it again)';
starterCloseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleGuidePanel(); });
starterHead.append(starterTitle, starterCount, starterCloseBtn);
const starterBar = document.createElement('div');
starterBar.className = 'guide-hud-bar';
const starterBarFill = document.createElement('div');
starterBarFill.className = 'guide-hud-bar-fill';
starterBar.appendChild(starterBarFill);
const starterBody = document.createElement('div');
starterBody.className = 'guide-hud-steps';
const starterHint = document.createElement('div');
starterHint.className = 'guide-hud-hint';
starterHint.hidden = true;
starterEl.append(starterHead, starterBar, starterBody, starterHint);
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
  if (step) showNotice(`✅ ${step.text}`); // step.icon is already SVG markup — the tick carries it
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
  return `${iconSvg('skull')} Nearest vault: <b>${Math.round(bestD)}m ${glyph}</b>`;
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
    `Vault ${['I', 'II', 'III'][tier - 1]}`);
  inventory.consumeSelected(1);
  audio.heartSteal();
  showNotice(`🧭 Tier ${['I', 'II', 'III'][tier - 1]} vault: ${Math.round(bestD)}m ${glyph} — waypoint set!`);
}

function renderGuidePanel(): void {
  const next = nextGuideStep(guideState);
  const { done, total } = guideProgress(guideState);
  starterCount.textContent = `${done} / ${total}`;
  starterBarFill.style.width = `${total ? (done / total) * 100 : 0}%`;
  starterBody.replaceChildren();
  for (const step of GUIDE_STEPS) {
    const stepDone = guideState[step.id];
    const active = next?.id === step.id;
    // The step text has a couple of keyboard-key parentheticals baked in —
    // swap them for the touch equivalent rather than pointing at keys mobile
    // players can't press.
    const text = isMobile
      ? step.text.replace('(E)', '(🎒)').replace('check the map — M', 'check the map — 🗺')
      : step.text;
    const row = document.createElement('div');
    row.className = `guide-hud-step${stepDone ? ' done' : active ? ' active' : ''}`;
    const tick = document.createElement('span');
    tick.className = 'guide-hud-step-tick';
    tick.innerHTML = iconifyHtml(stepDone ? '✔' : step.icon);
    const label = document.createElement('span');
    label.className = 'guide-hud-step-text';
    setIconText(label, text);
    row.append(tick, label);
    starterBody.appendChild(row);
  }
  // Live compass hint toward the nearest unexplored vault until one is looted.
  starterHint.hidden = true;
  if (!guideState.loot) {
    const hint = nearestVaultHint();
    if (hint) { starterHint.hidden = false; starterHint.innerHTML = hint; }
  }
}
/** Per-frame guide upkeep: visibility, periodic detection, live vault hint. */
function updateGuide(dt: number, controlling: boolean): void {
  loadGuide();
  const show = controlling && authed && !guideHidden && !guideComplete(guideState) && !arenaActive;
  starterEl.style.display = show ? 'block' : 'none';
  if (!authed) return;
  guideCheckTimer -= dt;
  if (guideCheckTimer <= 0) {
    guideCheckTimer = 0.5;
    if (!guideComplete(guideState) && !arenaActive) detectGuideSteps();
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
// Mobs and dungeon actors are simulated locally, so their hitmarker is local
// too. PvP markers deliberately still come from the server (`onHitConfirm`).
projectiles.localHitSink = (damage, at) => {
  showHitmarker(damage, false);
  // The same number a PvP hit pops, so "did that land, and how hard?" reads
  // identically whatever you are shooting at.
  damageNumbers.spawn(at.x, at.y, at.z, damage, hitFlavor(damage, false));
};
// Rounds stop ON an airframe rather than sailing through the cabin. The damage
// itself is reported at the trigger pull (reportAirTargetHit) — this is purely
// what makes shooting at a helicopter LOOK like shooting at a helicopter.
projectiles.hullSink = (point) => vehicleModels.pointInHull(point);
projectiles.encounterSink = (point, damage, source) => {
  const seal = encounterSnapshot?.seal;
  if (seal?.sealed && seal.geometry && sealContains(seal.geometry, point, 0.08)) {
    particles.poof(point.x, point.y, point.z);
    return true;
  }
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
};
net.onEncounterStart = (cx, cz, data) => {
  if (screen !== 'playing' || player.dead || !curVault || curVault.cx !== cx || curVault.cz !== cz) return;
  encounterSnapshot = data.snapshot;
  activeEncounterId = encounterSnapshot.encounterId;
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
  if (screen !== 'playing' || player.dead || !curVault || curVault.cx !== cx || curVault.cz !== cz) return;
  // An older encounter can still have a packet in flight after a reset/quit.
  if (activeEncounterId && snapshot.encounterId !== activeEncounterId) return;
  activeEncounterId = snapshot.encounterId;
  encounterSnapshot = snapshot;
  vaultBossHud.update(snapshot);
  audio.setVaultMusicPhase(snapshot.phase, snapshot.hpPercent < 0.15);
  if (bruteMob) bruteMob.health = snapshot.hp;
  const view = vaultViews.get(`${cx},${cz}`);
  if (view) { view.hp = snapshot.hp; view.maxHp = snapshot.maxHp; view.alive = snapshot.hp > 0; }
};
net.onEncounterEvent = (cx, cz, event) => {
  if (screen === 'playing' && !player.dead && curVault?.cx === cx && curVault.cz === cz) {
    encounterEvent(event);
  }
};
net.onEncounterEnd = (cx, cz, outcome) => {
  if (curVault?.cx !== cx || curVault.cz !== cz) return;
  const endedSnapshot = encounterSnapshot;
  if (screen === 'playing' && !player.dead && outcome === 'victory') {
    if (endedSnapshot) vaultCinematic.playVictory(endedSnapshot);
    showRegionBanner('🏆 VAULT CLEARED!', '#ffd84a');
    audio.vaultMusicCue('victory');
    const viewState = vaultViews.get(`${cx},${cz}`);
    if (viewState) { viewState.hp = 0; viewState.alive = false; }
    if (bruteMob) {
      bossVictoryTimer = ENCOUNTER_VICTORY_CINEMATIC_SECONDS;
      mobs.poseBoss(bruteMob, null, 3, true);
    }
    encounterSnapshot = null;
    activeEncounterId = '';
    vaultBossHud.hide();
    vaultEncounterVisuals.hide();
  } else {
    if (screen === 'playing' && !player.dead) audio.vaultMusicCue('reset');
    if (bruteMob) { mobs.slay(bruteMob); bruteMob = null; }
    clearVaultPresentation(true);
  }
};
net.onVaultCleared = (cx, cz, by) => {
  if (curVault && curVault.cx === cx && curVault.cz === cz) {
    showRegionBanner(by === net.username ? '🏆 VAULT CLEARED!' : `🏆 ${by.toUpperCase()} CLEARED THE VAULT!`, '#ffd84a');
    audio.vaultClear();
  }
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
  if (!trapField.has(x, y, z)) trapField.place(x, y, z, world.getBlock(x, y, z));
  applyTrapResultLocal(trapField.pull(x, y, z, trapSolid, localTrapTargets()));
};

// --- TPA: teleport requests (DonutSMP-style) ----------------------------------
// `/tpa <player>` asks; the TARGET runs `/tpaccept` and must then stand still
// and untouched for TPA_HOLD seconds, after which the requester is teleported
// straight to them (server-authoritative). The stand-still window is what stops
// a request being accepted mid-fight to bail out or to bait someone in.
// Multiplayer only: offline there is nobody to teleport to.
let tpaIncomingFrom = '';   // username of the pending requester ('' = none)
let tpaIncomingAtMs = 0;    // wall-clock ms the request arrived
let tpaAccepting = false;   // /tpaccept was run — the stand-still clock is live
let tpaHold = 0;            // seconds held so far
let tpaHoldStart: THREE.Vector3 | null = null; // position when the hold began
let tpaHoldHealth = 0;      // health when the hold began (a hit = cancel)

// Incoming-request banner (target side): sticky while the request is pending.
const tpaBannerEl = document.createElement('div');
tpaBannerEl.className = 'mc-font';
tpaBannerEl.style.cssText =
  'position:absolute;top:130px;left:50%;transform:translateX(-50%);z-index:12;' +
  'display:none;text-align:center;font-size:13px;line-height:1.8;color:#eaf0ff;' +
  'white-space:pre-line;text-shadow:1px 1px 0 #000;background:rgba(8,10,16,0.62);' +
  'border:1px solid #3a4790;border-radius:8px;padding:8px 16px;pointer-events:none;';
app.appendChild(tpaBannerEl);

net.onTpaRequest = (from) => {
  tpaIncomingFrom = from;
  tpaIncomingAtMs = performance.now();
  tpaAccepting = false;
  tpaHold = 0;
  tpaHoldStart = null;
  showNotice(`📨 ${from} wants to teleport to YOU — run /tpaccept to allow it!`);
  chatBox.print(`📨 ${from} wants to teleport to you — /tpaccept or /tpdeny`);
};

/** `/tpa <player>` — ask to be teleported to them. */
function sendTpaTo(name: string): string | null {
  if (!net.connected) return 'TPA needs multiplayer — no server connected.';
  if (!name) return 'Usage: /tpa <player>';
  if (name.toLowerCase() === net.username.toLowerCase()) return "You're already there.";
  net.sendTpa(name);
  chatBox.print(`🌀 Asked ${name} to let you teleport to them.`, 'ok');
  return null;
}

/** `/tpaccept` — start the stand-still clock on the newest pending request. */
function acceptTpa(): string | null {
  if (!tpaIncomingFrom) return 'Nobody has asked to teleport to you.';
  if (tpaAccepting) return `Already accepting — hold still for ${
    Math.max(0, TPA_HOLD - tpaHold).toFixed(1)}s.`;
  tpaAccepting = true;
  tpaHold = 0;
  tpaHoldStart = null; // captured on the first update frame, once we're back in control
  chatBox.print(`🌀 Accepting ${tpaIncomingFrom} — stand still for ${TPA_HOLD}s.`, 'ok');
  return null;
}

/** `/tpdeny` — drop the pending request without teleporting anyone. */
function denyTpa(): string | null {
  if (!tpaIncomingFrom) return 'Nobody has asked to teleport to you.';
  chatBox.print(`❌ Refused ${tpaIncomingFrom}'s teleport request.`);
  tpaIncomingFrom = '';
  tpaAccepting = false;
  tpaHold = 0;
  tpaHoldStart = null;
  return null;
}

function cancelTpaHold(reason: string): void {
  showNotice(reason);
  chatBox.print(reason, 'err');
  tpaAccepting = false;
  tpaHold = 0;
  tpaHoldStart = null;
}

/** Per-frame TPA upkeep: expire the pending request, run the stand-still clock
 *  started by /tpaccept (moving or taking damage cancels it), draw the banner. */
function updateTpa(dt: number, controlling: boolean): void {
  if (!tpaIncomingFrom) {
    tpaBannerEl.style.display = 'none';
    return;
  }
  const ageSec = (performance.now() - tpaIncomingAtMs) / 1000;
  if (ageSec > TPA_EXPIRE || !net.connected) {
    tpaIncomingFrom = '';
    tpaAccepting = false;
    tpaBannerEl.style.display = 'none';
    return;
  }
  if (tpaAccepting && !player.dead) {
    // The clock only runs while you actually have control, so the seconds spent
    // typing the command (pointer unlocked) don't count as standing still.
    if (controlling) {
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
          chatBox.print(`🌀 Accepted — ${tpaIncomingFrom} is on their way!`, 'ok');
          tpaIncomingFrom = '';
          tpaAccepting = false;
          tpaHold = 0;
          tpaHoldStart = null;
          tpaBannerEl.style.display = 'none';
          return;
        }
      }
    }
  } else if (player.dead) {
    tpaAccepting = false;
    tpaHold = 0;
    tpaHoldStart = null;
  }
  tpaBannerEl.style.display = 'block';
  const bar = '█'.repeat(Math.round((tpaHold / TPA_HOLD) * 10)).padEnd(10, '░');
  setIconText(tpaBannerEl,
    `📨 ${tpaIncomingFrom} wants to teleport to you\n` +
    (tpaAccepting
      ? `accepting… ${bar} ${Math.max(0, TPA_HOLD - tpaHold).toFixed(1)}s — don't move!`
      : `run /tpaccept to allow it (${Math.ceil(TPA_EXPIRE - ageSec)}s left)`));
}

// --- The command box ---------------------------------------------------------
// One key (T) opens a slash-only console. It is the ONLY way into the map,
// waypoints, Warfare Command, the Getting Started guide and TPA — those lost
// their dedicated keys — and, for operators, into the server's admin commands.
// There is deliberately no free chat: an unrecognised line is refused locally
// and never leaves the machine.
const chatBox = new ChatBox(app, {
  isOp: () => net.connected && net.isOp,
  onOpen: () => { if (input.locked) input.unlock(); },
  onClose: () => {
    if (worldReady && screen === 'playing' && !player.dead &&
        !invUI.open && !worldMap.open && !warfareUI.open) {
      input.lock();
    }
  },
  sendAdmin: (raw) => net.sendCommand(raw),
  runLocal: (name, args) => {
    switch (name) {
      case 'help':
        for (const line of chatBox.helpLines()) chatBox.print(line);
        return null;
      case 'map':
        // The panels want the pointer back before they take over the screen;
        // the box has already unlocked it, so open them straight away.
        if (player.dead) return "You can't do that while dead.";
        if (invUI.open) invUI.hide();
        worldMap.show();
        return null;
      case 'warfare':
        if (player.dead) return "You can't do that while dead.";
        showProgress();
        return null;
      case 'guide':
        if (arenaActive) return `Guide is disabled during ${arenaModeName()}.`;
        toggleGuidePanel();
        chatBox.print(guideHidden ? 'Getting Started guide hidden.' : 'Getting Started guide shown.');
        return null;
      case 'waypoint': {
        if (player.dead) return "You can't do that while dead.";
        const wpName = worldMap.addWaypointAt(
          player.pos.x, player.pos.y, player.pos.z, args.join(' '));
        const where = `${Math.round(player.pos.x)}, Y${Math.round(player.pos.y)}, ` +
          `${Math.round(player.pos.z)}`;
        showNotice(`📍 Waypoint "${wpName}" set — ${where}`);
        chatBox.print(`📍 Waypoint "${wpName}" set at ${where}`, 'ok');
        return null;
      }
      case 'tpa': return sendTpaTo(args[0] ?? '');
      case 'tpaccept': return acceptTpa();
      case 'tpdeny': return denyTpa();
      default: return `"/${name}" isn't wired up yet.`;
    }
  },
});
net.onOpState = (op) => {
  if (op) chatBox.print('🛡 You are a server operator — /help lists your commands.', 'ok');
};
net.onCmdOut = (lines, ok) => {
  for (const line of lines) chatBox.print(line, ok ? 'info' : 'err');
};

/** T (or the touch button): open the command box, already primed with "/". */
function openCommandBox(prefill = ''): void {
  if (player.dead || screen !== 'playing') return;
  chatBox.show(prefill);
}

net.onGotItem = (id, count) => {
  // The server grants the whole stack on a valid pickup; if it doesn't all fit,
  // re-drop the remainder as a server item entity so it isn't destroyed (the
  // offline path likewise leaves the leftover on the ground). After a partial
  // add the inventory has no room left, so the re-drop won't be re-requested.
  const left = inventory.add(id, count);
  if (left > 0) {
    net.sendDrop([{ id, count: left }], player.pos.x, player.pos.y, player.pos.z);
  }
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
net.onMachineFx = (x, y, z, fx) => machineFx(x, y, z, fx);
net.onTraps = (list) => {
  trapField.clear();
  for (const [k, raw] of list) {
    const st = sanitizeTrap(raw);
    if (!st) continue;
    const [x, y, z] = k.split(',').map(Number);
    trapField.set(x, y, z, st);
    remeshTrapCell(x, z);
  }
};
net.onTrap = (x, y, z, state) => {
  if (!state) { if (trapField.remove(x, y, z)) remeshTrapCell(x, z); return; }
  const st = sanitizeTrap(state);
  if (!st) return;
  const fresh = !trapField.has(x, y, z);
  trapField.set(x, y, z, st);
  if (fresh) remeshTrapCell(x, z);
};
net.onTrapFx = (x, y, z, kind, what, tx, ty, tz) => trapFxLocal(x, y, z, kind, what, tx, ty, tz);
net.onEffect = (kind, seconds) => applyStatusEffect(kind, seconds);
net.onAlarm = (x, y, z, owner, intruder) => {
  audio.trap('bell', new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
  const whose = owner === net.username ? 'Your' : `${owner}'s`;
  showNotice(`🔔 ${whose} alarm at ${x}, ${z}: ${intruder || 'an intruder'} is inside!`);
};
net.onTurret = (x, y, z, state) => {
  const s = sanitizeTurretState(state);
  if (s) turretStates.set(`${x},${y},${z}`, s);
};
net.onTurretFire = (x, y, z, tx, ty, tz) => {
  turretModels.fireTracer(x, y, z, tx, ty, tz);
  // A cannon, not a pistol: the heavy report with its room tail.
  audio.gun(new THREE.Vector3(x + 0.5, y + TURRET_MUZZLE_Y, z + 0.5), 2.1);
};
net.onWar = (active, timeLeft, nextIn, duration, score, wins) => {
  const wasActive = warActiveNow;
  warActiveNow = active; warLeft = timeLeft; warNextIn = nextIn; warDur = duration;
  if (Array.isArray(score)) warScore = score;
  if (Array.isArray(wins)) warWins = wins;
  if (active && !wasActive) {
    showRegionBanner('⚔️ WAR! THE BORDER IS CLOSING!', '#ff5a5a');
  }
  titleStatusTimer = 0; // reflect the fresh schedule on the title strip at once
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
  refreshFlagless();      // you inherit the new side's flag situation with it
  refreshNetInfo();
  showNotice(`🤫 You secretly joined ${factionName(faction)}. Switches left: ${remaining}.`);
};

// --- FACTIONS: the wire -------------------------------------------------------
net.onFactions = (factions) => {
  factionPublics = factions;
  refreshPledgeScreen();
};
net.onPledged = (faction) => {
  adoptFaction(faction);
  factionPicker.hide();
  showRegionBanner(`YOU FIGHT FOR ${factionName(faction).toUpperCase()}`, factionCss(faction));
  // The pledge screen is the last thing between the title and the world.
  startPlaying();
};
net.onGovErr = (reason) => showNotice(`⚠ ${reason}`);
net.onSeasonEnd = (winner, number) => {
  // The winning side's badge is refreshed on the next welcome, but bump it now
  // for instant feedback.
  if (winner === localFaction && winner >= 0) localSeasonsWon++;
  warWins = new Array(FACTIONS.length).fill(0);
  announceSeasonEnd(winner, number);
  refreshNetInfo();
};
net.onDisconnect = () => {
  livePlayerCounts = null;
  renderLivePlayerCounts();
  if (pendingDuelRetry) window.clearTimeout(pendingDuelRetry); pendingDuelRetry = 0;
  pendingDuelAttempted = false;
  duelQueued = false;
  refreshDuelsAvailability();
  const wasParty = arenaKind === 'party' || !!partySnapshot;
  if (arenaActive || duelSnapshot || partySnapshot) {
    if (wasParty) restorePartyFallback();
    cleanupDuelSession(true);
    input.unlock();
    enterTitle();
    const mode = wasParty ? (partySnapshot?.mode === 'parkour' ? 'Parkour' : 'The Bridge') : 'Duels';
    showNotice(`${mode} connection lost — your open-world state was kept safe.`);
  }
  partyQueued = false; partySnapshot = null; partyInviteToken = '';
  partyInviteAttempted = false; renderPartyLobby();
  refreshPartyAvailability();
  player.damageSink = undefined;
  survival.enableRegen = true;
  clearVaultPresentation(true);
  // Drop all server-owned warfare state so its meshes/markers don't linger
  // (turretModels reconciles to the now-empty set).
  turretStates.clear();
  // Warfare Command hardware is server-owned too: drop it so no ghost
  // helicopter lingers over an offline world.
  setSeat(null);
  vehicleModels.clear();
  warActiveNow = false;
  // Flags are server state: drop the markers so a stale pole/beacon can't linger
  // over an offline world.
  flagState = newFlags();
  flagModels.setState(false, flagState.flags);
  refreshFlagless();
  lastFlagMarkerKey = '';
  worldMap.setDynamicMarkers([]);
  refreshNetInfo();
};
interaction.onEdit = (x, y, z, b, facing) => {
  const key = `${x},${y},${z}`;
  if (!net.connected && localVaultEncounter && curVault && blockInsideArena(curVault, x, y, z)) {
    if (b === Block.Air) {
      offlineArenaPlacements.delete(key);
    } else {
      const tracked = offlineArenaPlacements.get(key);
      offlineArenaPlacements.set(key, {
        encounterId: localVaultEncounter.config.encounterId,
        block: b,
        restoreBlock: tracked?.encounterId === localVaultEncounter.config.encounterId
          ? tracked.restoreBlock : pendingOfflineArenaPlacements.get(key) ?? Block.Air,
      });
    }
  }
  pendingOfflineArenaPlacements.delete(key);
  // A placed turret is ours from the start (the server claims it for the placer
  // too); breaking one drops its entity + model.
  if (b === Block.Turret && !turretStates.has(key)) {
    turretStates.set(key, newTurret(net.connected ? net.username : 'You', localFaction));
  }
  syncTurretCell(x, y, z, b);
  // Placing a machine block creates its local entity (prediction offline + MP).
  const mt = machineTypeForBlock(b);
  if (mt !== null) machines.place(x, y, z, mt);
  // Traps: breaking one drops its entity — offline, mining an armed hostile
  // trap sets it off (online the server does this); placing one creates an
  // entity we own, facing the way interact.ts chose.
  const had = trapField.get(x, y, z);
  const newKind = trapKindForBlock(b);
  if (had && had.kind !== newKind) {
    if (net.connected) trapField.remove(x, y, z);
    else applyTrapResultLocal(trapField.spring(x, y, z, meAsTarget(), trapSolid));
  }
  if (newKind !== null && (!had || had.kind !== newKind)) {
    trapField.place(x, y, z, b, net.connected ? net.username : 'You', localFaction, facing ?? 0);
    remeshTrapCell(x, z);
  }
  net.sendEdit(x, y, z, b, facing);
};
/** The Duels build rules, as a data object behind the generic arena hooks.
 *  Moved verbatim out of `interaction.canPlace`/`canEdit`; a new mode supplies
 *  its own object instead of adding another branch to those two functions. */
const duelArenaRules = {
  canPlaceAt(x: number, y: number, z: number, held: number): boolean {
    if (!duelActiveBounds) return false;
    if (duelSnapshot?.phase !== 'running' && duelSnapshot?.phase !== 'sudden_death') return false;
    if (held !== Block.OakPlanks) return false;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < duelActiveBounds.minX || bx >= duelActiveBounds.maxX ||
        bz < duelActiveBounds.minZ || bz >= duelActiveBounds.maxZ) return false;
    if (by < duelActiveBounds.floor || by >= duelActiveBounds.ceiling - 1) return false;
    const lx = bx - duelActiveBounds.minX, lz = bz - duelActiveBounds.minZ;
    const groundY = duelActiveBounds.floor + duelTerrainElevation(lx, lz);
    if (by <= groundY) return false;
    if (by > groundY + DUEL_MAX_PILLAR_HEIGHT) return false;
    return true;
  },
  canEditAt(x: number, y: number, z: number, held: number): boolean {
    if (!duelActiveBounds) return false;
    if (duelSnapshot?.phase !== 'running' && duelSnapshot?.phase !== 'sudden_death') return false;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < duelActiveBounds.minX || bx >= duelActiveBounds.maxX ||
        bz < duelActiveBounds.minZ || bz >= duelActiveBounds.maxZ) return false;
    const lx = bx - duelActiveBounds.minX, lz = bz - duelActiveBounds.minZ;
    const groundY = duelActiveBounds.floor + duelTerrainElevation(lx, lz);
    if (by <= groundY) return false;
    const block = world.getBlock(x, y, z);
    // Interaction asks canEdit about the empty destination before canPlace.
    // Permit that destination only for the plank stack; existing cover is
    // reclaimable only with the utility axe.
    if (isReplaceable(block)) return held === Block.OakPlanks;
    return block === Block.OakPlanks && held === Item.IronAxe;
  },
};

interaction.shouldConsumePlacement = (block) => !arenaUnlimited.has(block);
interaction.canPlace = (x, y, z) => {
  if (arenaActive && arenaCanPlaceAt) {
    return arenaCanPlaceAt(x, y, z, inventory.selectedStack?.id ?? 0);
  }
  if (localVaultEncounter && curVault && blockInsideArena(curVault, x, y, z)) return false;
  // Warfare hardware is blueprint-gated — refuse the placement here rather
  // than letting a block appear and vanish.
  const held = inventory.selectedStack;
  const id = held?.id ?? 0;
  if (id === Block.Helipad || id === Item.HelicopterKit) {
    if (!hasBlueprint(id)) {
      warfarePlaceHint(`${ITEMS[id]?.name ?? 'That'} needs a Warfare Command authorization (/warfare).`);
      return false;
    }
  }
  return true;
};
interaction.canEdit = (x, y, z) => {
  if (arenaActive && arenaCanEditAt) {
    return arenaCanEditAt(x, y, z, inventory.selectedStack?.id ?? 0);
  }
  const block = world.getBlock(x, y, z);
  if (block === Block.MobSpawner || block === Block.VaultChest) return false;
  return !(encounterSnapshot && curVault && blockInsideArena(curVault, x, y, z));
};

const parkourCardAction = document.getElementById('parkour-card-action') as HTMLButtonElement;
const parkourPrivateAction = document.getElementById('parkour-private-action') as HTMLButtonElement;
const parkourQueueStatus = document.getElementById('parkour-queue-status')!;
parkourCardAction.addEventListener('click', () => queuePartyMode('parkour'));
parkourPrivateAction.addEventListener('click', () => createPartyMode('parkour'));
// Party Games and Parkour: snapshots own every phase, timer and target.
const partyCardAction = document.getElementById('party-card-action') as HTMLButtonElement;
const partyPrivateAction = document.getElementById('party-private-action') as HTMLButtonElement;
const partyQueueStatus = document.getElementById('party-queue-status')!;
const partyUI = new PartyUI(document.body);
const partyVisuals = new PartyVisuals(scene);
let partySnapshot: PartyLobbySnapshot | null = null;
let partySub: PartySubBounds | null = null;
/** Footprint of the venue currently streamed in, kept so the chunks can be
 *  dropped again on the way out (see `clearArenaState`). */
let partyActiveBounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null;
let partyQueued = false;
let partyQueuedMode: PartyMode = 'bridge';
let partyInviteToken = '';
/** The host has copied or shared this party lobby's link at least once. */
let partyInviteShared = false;
let partyArenaReadySent = false;
let partyClockServer = 0, partyClockLocal = 0;
let partyReadyWatchdog = 0;
let partyLocalFallback: {
  state: ReturnType<typeof inventory.serialize>;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  dead: boolean;
  mode: GameMode;
} | null = null;
let pendingPartyInvite = new URL(location.href).searchParams.get('party') ?? '';
let partyInviteAttempted = false;
function joinPendingParty(): void {
  if (!pendingPartyInvite || partyInviteAttempted || !net.connected)
    return;
  partyInviteAttempted = true;
  savePartyFallback();
  net.sendPartyJoin(pendingPartyInvite);
  openMinigames();
}
function partyInviteUrl(token: string): string {
  const url = new URL(location.href);
  url.searchParams.delete('duel');
  url.searchParams.set('party', token);
  return url.toString();
}
function clearPartyInviteUrl(): void { const url = new URL(location.href); url.searchParams.delete('party'); history.replaceState(history.state, '', url); }
function partyNow(): number { return partyClockServer + performance.now() - partyClockLocal; }
function savePartyFallback(): void {
  if (arenaActive || partyLocalFallback)
    return;
  partyLocalFallback = { state: inventory.serialize(), x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, health: player.health, dead: player.dead, mode: localMode };
  pushStateSave();
}
function restorePartyFallback(): void {
  const f = partyLocalFallback;
  partyLocalFallback = null;
  if (!f)
    return;
  inventory.restore(f.state);
  player.pos.set(f.x, f.y, f.z);
  player.yaw = f.yaw;
  player.pitch = f.pitch;
  player.maxHealth = maxHealthFor(localHearts);
  player.health = f.health;
  player.dead = f.dead;
  applyLocalMode(f.mode);
  lastHealth = f.health;
}
function clearPartySession(): void {
  stopPartyReadyWatchdog();
  partySub = null;
  partyActiveBounds = null;
  partyArenaReadySent = false;
  partyUI.setVisible(false);
  partyVisuals.clear();
}
function refreshPartyAvailability(): void {
  for (const [button, mode] of [[partyCardAction, 'bridge'], [parkourCardAction, 'parkour']] as const) {
    button.setAttribute('aria-disabled', String(!net.connected));
    button.textContent = !net.connected ? 'Multiplayer server required' : partyQueued && partyQueuedMode === mode ? 'Cancel Queue' : 'Play';
    button.setAttribute('aria-pressed', String(partyQueued && partyQueuedMode === mode));
  }
  partyPrivateAction.setAttribute('aria-disabled', String(!net.connected));
  parkourPrivateAction.setAttribute('aria-disabled', String(!net.connected));
}
function queuePartyMode(mode: PartyMode): void {
  if (!net.connected) {
    showNotice('Connect to multiplayer to play.');
    return;
  }
  if (arenaActive)
    return;
  if (partyQueued && partyQueuedMode === mode) {
    net.sendPartyQueue(false, mode);
    return;
  }
  if (partySnapshot) {
    net.sendPartyLeave();
    partySnapshot = null;
    partyInviteToken = '';
    renderPartyLobby();
  }
  if (duelSnapshot) {
    net.sendDuelLeave();
    duelSnapshot = null;
    duelInviteToken = '';
    setDuelParam(null);
    showDuelBrowser();
  }
  savePartyFallback();
  partyQueuedMode = mode;
  net.sendPartyQueue(true, mode);
}
function createPartyMode(mode: PartyMode): void {
  if (!net.connected || arenaActive)
    return;
  if (partySnapshot) {
    renderPartyLobby();
    return;
  }
  if (duelSnapshot) {
    net.sendDuelLeave();
    duelSnapshot = null;
    showDuelBrowser();
  }
  savePartyFallback();
  partyQueuedMode = mode;
  partyInviteShared = false;
  net.sendPartyCreate(mode);
}
function leaveParty(): void {
  net.sendPartyLeave();
  partyInviteShared = false;
  pendingPartyInvite = '';
  partySnapshot = null;
  partyQueued = false;
  partyInviteToken = '';
  clearPartyInviteUrl();
  restorePartyFallback();
  clearArenaState();
  renderPartyLobby();
  refreshPartyAvailability();
  setDuelCue('');
}
/** One lobby seat, in the same shape as a Duels seat so both lobbies share
 *  the stage styling. */
function partyLobbySeat(p: PartyLobbySnapshot['participants'][number], sub: string): HTMLElement {
  const row = document.createElement('div'); row.className = 'duel-slot';
  if (p.ready && p.connected) row.classList.add('ready');
  if (p.id === net.myId) row.classList.add('me');
  const avatar = lobbyAvatar(p.skin);
  const name = document.createElement('strong');
  name.textContent = p.id === net.myId ? `${p.username} (you)` : p.username;
  if (p.host) {
    const host = document.createElement('span');
    host.className = 'duel-slot-host'; host.textContent = 'HOST';
    name.appendChild(host);
  }
  const line = document.createElement('small'); line.className = 'duel-player-rank';
  line.textContent = sub;
  const state = document.createElement('span');
  state.className = `duel-slot-state ${!p.connected ? 'duel-gone' : p.ready ? 'duel-ready' : 'duel-waiting'}`;
  state.textContent = !p.connected ? 'Gone' : p.ready ? 'Ready' : 'Waiting';
  row.append(avatar, name, line, state);
  return row;
}
function partyEmptySeat(text: string): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'duel-slot empty'; slot.textContent = text;
  return slot;
}
function renderPartyLobby(): void {
  const s = partySnapshot;
  const live = !!s && s.phase === 'lobby';
  const changed = live !== partyLobbyLive;
  partyLobbyLive = live;
  partyLobbyPanel.replaceChildren();
  if (changed) refreshArenaTabs();
  if (!s || !live) {
    if (arenaView === 'lobby' && !duelSnapshot) showArenaView('games');
    return;
  }
  const bridge = s.mode === 'bridge';
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n;
  };
  partyLobbyPanel.style.setProperty('--hero', `url('/minigames/${bridge ? 'the-bridge' : 'parkour'}.webp')`);
  partyLobbyPanel.style.setProperty('--mode', bridge ? '#f43f5e' : '#10b981');

  const top = el('div', 'fl-top');
  const hero = el('header', 'lobby-hero fl-hero');
  hero.dataset.tilt = '';
  const art = el('div', 'fl-hero-art'); art.setAttribute('aria-hidden', 'true');
  const copy = el('div', 'lobby-hero-copy');
  copy.append(
    el('div', 'lobby-kicker', `Private match · ${bridge ? 'The Bridge' : 'Parkour'}`),
    el('h3', '', bridge ? 'The Bridge' : 'Parkour Duel'),
    el('p', '', bridge
      ? 'Two bases, one span a single block wide. Cleaver, bow and infinite wool — dive into the enemy portal.'
      : 'A fresh course, infinite wool and one rival. First to the golden gate wins.'));
  const rules = el('div', 'duel-ruleline');
  for (const chip of bridge
    ? [`First to ${BRIDGE_GOAL_LIMIT}`, `${s.participants.length}/${s.capacity} players`, 'Infinite wool', 'Bow + cleaver']
    : ['Fresh course', `${s.participants.length}/${s.capacity} racers`, 'Infinite wool', 'R to retry'])
    rules.append(el('span', '', chip));
  hero.append(art, copy, rules);
  top.append(hero);

  const readyCount = s.participants.filter(p => p.ready && p.connected).length;
  const joined = s.participants.length >= 2;
  if (partyInviteToken) {
    const invite = el('div', 'lobby-invite fl-invite');
    const gift = el('div', 'fl-gift'); gift.setAttribute('aria-hidden', 'true');
    const giftCube = el('div', 'fl-gift-cube');
    for (let i = 0; i < 6; i++) giftCube.append(el('i'));
    gift.append(giftCube);
    const label = el('div', 'lobby-invite-label');
    label.append(el('b', '', 'Invite your friends'), el('span', '', 'Anyone with this link lands straight in your lobby.'));
    const link = el('input');
    link.readOnly = true;
    link.setAttribute('aria-label', 'Invite link');
    link.value = partyInviteUrl(partyInviteToken);
    link.onclick = () => link.select();
    const steps = el('ol', 'fl-steps'); steps.setAttribute('aria-label', 'Lobby progress');
    for (const text of ['Share the link', 'Friends join', 'Everyone readies']) steps.append(el('li', '', text));
    const paint = () => paintLobbySteps(steps, partyInviteShared, joined, joined && readyCount === s.participants.length);
    const copyBtn = el('button', 'duel-copy lobby-copy', 'Copy invite');
    copyBtn.type = 'button';
    copyBtn.onclick = async () => {
      const ok = await copyInviteLink(link, copyBtn);
      copyBtn.textContent = ok ? 'Copied!' : 'Link selected';
      if (ok) { partyInviteShared = true; paint(); }
      window.setTimeout(() => { copyBtn.textContent = 'Copy invite'; }, 1800);
    };
    const shareBtn = el('button', 'duel-copy fl-share', 'Share…');
    shareBtn.type = 'button';
    wireLobbyShare(shareBtn, () => link.value, () => { partyInviteShared = true; paint(); });
    paint();
    invite.append(gift, label, link, copyBtn, shareBtn, steps);
    top.append(invite);
  }
  partyLobbyPanel.append(top);

  const head = el('div', 'fl-seats-head');
  const bar = el('div', 'duel-readybar'); bar.setAttribute('aria-hidden', 'true');
  const fill = el('i'); fill.style.width = `${s.participants.length ? Math.round(readyCount / s.participants.length * 100) : 0}%`;
  bar.append(fill);
  const me = s.participants.find(p => p.id === net.myId);
  const canStart = !!me?.host && s.participants.length >= 2 && s.participants.every(p => p.ready && p.connected);
  const feedback = el('div', 'duel-feedback', canStart
    ? 'Everyone is ready. Drop them in.'
    : s.participants.length < 2
      ? 'Send the invite link — you need at least one opponent.'
      : `${readyCount}/${s.participants.length} ready.${me?.host ? '' : ' The host starts the match.'}`);
  feedback.setAttribute('role', 'status');
  head.append(el('b', '', bridge ? 'Teams' : 'Racers'), bar, feedback);
  partyLobbyPanel.append(head);

  let seat = 0;
  const numbered = (node: HTMLElement) => { node.style.setProperty('--seat-i', String(seat++)); return node; };
  if (bridge) {
    const teams = el('div', 'lobby-teams');
    const per = Math.max(1, Math.ceil(s.capacity / 2));
    const column = (team: number) => {
      const col = el('div', 'lobby-team');
      col.style.setProperty('--team', team === 0 ? '#f43f5e' : '#3b82f6');
      col.append(el('div', 'lobby-team-name', BRIDGE_TEAM_NAME[team]));
      const members = s.participants.filter(p => p.team === team);
      for (const p of members) col.append(numbered(partyLobbySeat(p, `${BRIDGE_TEAM_NAME[team]} side`)));
      for (let i = members.length; i < per; i++) col.append(numbered(partyEmptySeat('Open seat')));
      return col;
    };
    teams.append(column(0), el('div', 'lobby-vs', 'VS'), column(1));
    partyLobbyPanel.append(teams);
  } else {
    const roster = el('div', 'duel-roster');
    for (const p of s.participants) roster.append(numbered(partyLobbySeat(p, 'Racer')));
    for (let i = s.participants.length; i < s.capacity; i++)
      roster.append(numbered(partyEmptySeat(i < 2 ? 'Waiting for a challenger' : 'Open seat')));
    partyLobbyPanel.append(roster);
  }

  const actions = el('div', 'duel-controls');
  const button = (text: string, cls: string, action: () => void, disabled = false) => {
    const b = el('button', `duel-control ${cls}`, text);
    b.type = 'button';
    b.setAttribute('aria-disabled', String(disabled));
    b.onclick = () => { if (b.getAttribute('aria-disabled') !== 'true') action(); };
    actions.append(b);
    return b;
  };
  button(me?.ready ? 'Cancel ready' : 'Ready up', 'lobby-ready', () => net.sendPartyReady(!me?.ready))
    .setAttribute('aria-pressed', String(me?.ready === true));
  if (me?.host) button('Start match', 'lobby-start', () => net.sendPartyStart(), !canStart);
  button('Leave lobby', 'lobby-leave', () => leaveParty());
  partyLobbyPanel.append(actions);
  if (arenaView === 'lobby') showArenaView('lobby');
}
partyCardAction.addEventListener('click', () => queuePartyMode('bridge'));
partyPrivateAction.addEventListener('click', () => createPartyMode('bridge'));
// "Back to games" goes to the board and stops there. "Play again" goes to the
// board and presses the same card the player would have.
partyUI.onLeave = () => { leaveParty(); enterTitle(); openGamesTab(); };
partyUI.onReplay = () => {
  const mode = partySnapshot?.mode ?? 'bridge';
  leaveParty();
  enterTitle();
  pressMinigamePlay(mode);
};
net.onPartyQueue = queued => {
  partyQueued = queued;
  partyQueueStatus.textContent = queued && partyQueuedMode === 'bridge' ? 'Finding an opponent…' : '';
  parkourQueueStatus.textContent = queued && partyQueuedMode === 'parkour' ? 'Finding a racer…' : '';
  refreshPartyAvailability();
};
net.onPartyError = (_code, message) => { partyQueued = false; refreshPartyAvailability(); showNotice(message); partyQueueStatus.textContent = message; };
net.onPartyLobby = (snapshot, inviteToken) => {
  if (!snapshot.participants.some(p => p.id === net.myId && p.connected))
    return;
  partySnapshot = snapshot;
  partyClockServer = snapshot.serverNow;
  partyClockLocal = performance.now();
  if (inviteToken)
    partyInviteToken = inviteToken;
  // Every phase re-renders: leaving 'lobby' is what retires the Lobby tab.
  renderPartyLobby();
  if (snapshot.phase === 'lobby') {
    if (!arenaActive) {
      openMinigames();
      showArenaView('lobby');
    }
  }
  if (snapshot.phase === 'results' && arenaKind === 'party') {
    screen = 'duel_results';
    input.unlock();
    pauseEl.style.display = 'none';
  }
  partyUI.setSnapshot(snapshot, net.myId);
  refreshPartyAvailability();
};
net.onPartyArena = (arena, sub, team, spawn, _countdown) => {
  savePartyFallback();
  registerPartyArena(arena);
  world.invalidateArena(arena);
  partyActiveBounds = { minX: arena.minX, minZ: arena.minZ, maxX: arena.maxX, maxZ: arena.maxZ };
  arenaActive = true;
  arenaKind = 'party';
  partySub = sub;
  net.arenaRevision = partySnapshot!.revision;
  arenaMaxHealth = PARTY_MAX_HEALTH;
  arenaHpPerHeart = 2;
  // Local prediction of the server's build rules (server_core.handlePartyEdit
  // is still the authority). The Bridge builds out over the void, so its box
  // reaches below the deck; Parkour keeps the tighter one.
  const wool = BRIDGE_TEAM_BLOCK[team] ?? Block.TeamWoolA;
  const bridge = sub.game === 'bridge';
  arenaCanPlaceAt = (x, y, z, held) => partySnapshot?.phase === 'running' && held === wool &&
    x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ &&
    y >= (bridge ? PARTY_VOID_Y : PARTY_FLOOR_Y - 3) && y < (bridge ? PARTY_FLOOR_Y + 16 : PARTY_FLOOR_Y + 12) &&
    !(bridge && bridgeGoalGuard(Math.floor(x) - sub.minX, Math.floor(z) - sub.minZ)) &&
    !(!bridge && parkourBuildBlocked(parkourCourse(sub.seed), Math.floor(x) - sub.minX, Math.floor(y), Math.floor(z) - sub.minZ));
  arenaCanEditAt = (x, y, z, held) => {
    const block = world.getBlock(x, y, z);
    // Taking your own wool back out of the bridge you just built is part of
    // crossing; everything the venue itself is made of stays put.
    if (bridge && (block === Block.TeamWoolA || block === Block.TeamWoolB))
      return x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ;
    return block === Block.Air && !!arenaCanPlaceAt?.(x, y, z, held);
  };
  arenaClampPos = pos => clampToPartySub(pos, sub);
  // Wool and arrows are both unlimited: the count on the hotbar is scenery,
  // and the server never reads either of them.
  arenaUnlimited = new Set([wool, Item.BridgeArrow]);
  world.setArenaRenderBounds(sub, PARTY_AMBIENT_LIGHT);
  partyArenaReadySent = false;
  partyUI.setVisible(true);
  partyUI.setSnapshot(partySnapshot, net.myId);
  partyUI.showRound(sub.game, performance.now());
  clearVaultPresentation(true);
  endGrapple();
  setSeat(null);
  myRope = null;
  killfeedEl.replaceChildren();
  combatTagUntilLocal = 0;
  combatTimerEl.style.display = 'none';
  warEl.style.display = 'none';
  regionBannerEl.style.display = 'none';
  worldMap.hide();
  worldMap.hideBeacons();
  worldMap.setDynamicMarkers([]);
  flagModels.setState(false, []);
  if (fieldGuide?.open)
    fieldGuide.closeSilently();
  starterEl.style.display = 'none';
  closeMinigames();
  audio.resume();
  applyLocalMode('survival');
  player.pos.set(spawn.x, spawn.y, spawn.z);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  player.maxHealth = PARTY_MAX_HEALTH;
  player.health = PARTY_MAX_HEALTH;
  player.dead = false;
  player.flying = false;
  player.noclip = false;
  player.gliding = false;
  player.boating = false;
  // Start facing the thing you are trying to reach: the first jump, or the
  // far end of the chasm.
  if (sub.game === 'parkour') {
    const target = parkourCourse(sub.seed).steps[1][0];
    player.yaw = Math.atan2(-(sub.minX + target.x - spawn.x), -(sub.minZ + target.z - spawn.z));
  } else {
    player.yaw = Math.atan2(0, -((team === 0 ? sub.maxZ : sub.minZ) - spawn.z));
  }
  pendingTeleport = { ...spawn, started: worldTimeLocal };
  world.update(spawn.x, spawn.z, 50, 4);
  startPartyReadyWatchdog(spawn.x, spawn.z);
  resumePlay();
};
net.onPartyLoadout = (slots, selected) => {
  resetPartyWeaponPose();
  partySwingAt = -1e9;
  partyShotAt = -1e9;
  partyUI.bowReadyAt = 0;
  inventory.restore({ slots, armor: new Array(4).fill(null), selected });
  fireCooldown = 0;
  reloadTimer = 0;
  burstRemaining = 0;
  healUse.cancel();
};
net.onPartyHit = (target, amount, combo, _charge, crit, killed, ranged) => {
  showPvpHit(target, amount, killed);
  const remote = net.remotes.get(target);
  const at = remote ? new THREE.Vector3(remote.tx, remote.ty + 1.1, remote.tz) : undefined;
  if (ranged) audio.arrowHit(crit, at);
  else {
    audio.axeHit(crit, at);
    held.meleeImpact(crit);
    if (at) particles.burst(at.x, at.y, at.z, crit ? 16 : 8,
      crit ? 0xffd25e : 0xd8edf5, crit ? 3 : 2, .25,
      { gravity: 4, spread: .3, scale: .25 });
  }
  // Confirm movement crits and consecutive hits without a recharge meter.
  if (!killed && (crit || combo > 0))
    killBanner.push(crit ? 'CRIT' : `COMBO ×${combo + 1}`,
      ranged ? 'On target' : crit ? 'Jump strike' : 'Keep the pressure',
      crit ? '#ffd25e' : '#72ffcb', 1.1);
};
net.onPartyArrow = a => {
  partyVisuals.spawnArrow(a);
  if (a.by !== net.myId) audio.bowRelease(a.power);
};
net.onPartyArrowEnd = (id, x, y, z, hit) => {
  partyVisuals.endArrow(id);
  particles.burst(x, y, z, hit ? 8 : 4, hit ? 0xff8f9c : 0xd8cba4, hit ? 3 : 1.8, .3,
    { gravity: 6, spread: .3, scale: .32 });
};
net.onPartyResult = () => { if (arenaKind === 'party') {
  screen = 'duel_results';
  input.unlock();
  pauseEl.style.display = 'none';
} };
function markPartyArenaReady(): void {
  if (arenaKind !== 'party' || partyArenaReadySent || !partySnapshot)
    return;
  partyArenaReadySent = true;
  net.sendPartyArenaReady(partySnapshot.revision);
  stopPartyReadyWatchdog();
}
function stopPartyReadyWatchdog(): void { if (partyReadyWatchdog)
  window.clearInterval(partyReadyWatchdog); partyReadyWatchdog = 0; }
function startPartyReadyWatchdog(x: number, z: number): void {
  stopPartyReadyWatchdog();
  partyReadyWatchdog = window.setInterval(() => {
    if (arenaKind !== 'party' || partyArenaReadySent) {
      stopPartyReadyWatchdog();
      return;
    }
    // Readiness means the ground you start on is real. The venues are now
    // hundreds of blocks long — waiting for the far end of a Parkour lane or
    // the enemy Bridge base would never finish inside the load barrier — so
    // the barrier covers the spawn bubble and the rest streams as you go.
    const complete = world.update(x, z, 30, 4);
    if (complete && world.isLoaded(x, z)) {
      pendingTeleport = null;
      markPartyArenaReady();
    }
  }, 100);
}
/** Predict responsive weapon motion; the server validates every contact and
 * flies every arrow. Neither weapon gains power from waiting. */
const PARTY_MELEE_REACH = 4.2;
let partySwingAt = -1e9;
let partyShotAt = -1e9;
/** Shut in the drop cage: the opening countdown, and the three seconds after
 *  every goal. Nothing the player does with the keyboard counts while the
 *  hatch is closed — the server is holding everybody at their own base. */
function partyCaged(): boolean {
  const s = partySnapshot;
  return !!s && s.mode === 'bridge' && s.goalResetAt !== undefined && partyNow() < s.goalResetAt;
}
function partyWeaponsActive(): boolean {
  return arenaKind === 'party' && partySub?.game === 'bridge' &&
    partySnapshot?.phase === 'running' && !partyCaged();
}
function resetPartyWeaponPose(): void {
  held.setBowDraw(0);
}
function updatePartyWeapon(heldId: number, lookDir: THREE.Vector3, eye: THREE.Vector3): void {
  const now = performance.now();
  if (heldId === Item.IronAxe) {
    resetPartyWeaponPose();
    if ((!input.leftClicked && !input.leftDown) ||
        now - partySwingAt < BRIDGE_MELEE_TIER.cooldownMs) return;
    partySwingAt = now;
    held.swing();
    audio.axeSwing(1);
    // Report the ray target if there is one, and otherwise the nearest body
    // inside the reach and the facing cone. Being GENEROUS here costs nothing:
    // the server re-checks range, facing and cooldown against its own
    // positions, so the only thing a loose client test can do is stop a swing
    // that would have landed from never being sent at all.
    let target = remotePlayers.rayHit(eye, lookDir, PARTY_MELEE_REACH);
    if (target < 0) {
      // The cone is measured flat, the way the server measures it: looking
      // steeply down at somebody is still looking at them.
      const look = Math.hypot(lookDir.x, lookDir.z) || 1e-3;
      const lx = lookDir.x / look, lz = lookDir.z / look;
      let best = PARTY_MELEE_REACH;
      for (const [id, r] of net.remotes) {
        if (r.dead)
          continue;
        const dx = r.tx - eye.x, dy = r.ty + .9 - eye.y, dz = r.tz - eye.z;
        const dist = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz) || 1e-3;
        if (dist > best || (dx / flat) * lx + (dz / flat) * lz < .55)
          continue;
        best = dist;
        target = id;
      }
    }
    if (target >= 0)
      net.sendPartyMelee(target);
    return;
  }
  if (heldId !== Item.BridgeBow) {
    resetPartyWeaponPose();
    return;
  }
  // One click, one arrow. No draw, release gate, or charge slider.
  if (!input.rightClicked || now - partyShotAt < BRIDGE_BOW_COOLDOWN_MS) return;
  audio.bowRelease(1);
  held.releaseBow(1);
  partyShotAt = now;
  partyUI.bowReadyAt = now + BRIDGE_BOW_COOLDOWN_MS;
  net.sendPartyShoot(lookDir.x, lookDir.y, lookDir.z, 1);
}
function updatePartyFrame(dt: number): void {
  // Clear the held pose whenever combat is interrupted.
  if (!partyWeaponsActive() || screen !== 'playing' ||
      (inventory.selectedStack?.id !== Item.BridgeBow && inventory.selectedStack?.id !== Item.IronAxe))
    resetPartyWeaponPose();
  if (arenaKind !== 'party' || !partySnapshot) {
    partyVisuals.updateArrows(dt);
    return;
  }
  const now = partyNow();
  partyUI.update(performance.now(), now);
  partyVisuals.update(partySnapshot, net.myId, now);
  partyVisuals.updateArrows(dt);
}

net.connect();

let worldReady = false;
const clock = new THREE.Clock();
let fps = 0, frames = 0, fpsTime = 0;
// Sound state
let lastHealth = 20;
let lastSentArmor = -1; // last armor-points value pushed to the server
let lastSentToughness = -1; // last flat-soak value pushed to the server
let lastInWater = false;
let lavaTimer = 0; // throttles lava burn damage

// Gun state.
const ammoEl = document.getElementById('ammo')!;
const RELOAD_TIME = 1.1;
let fireCooldown = 0;
let reloadTimer = 0;
let reloadDuration = 0;
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

/** The directions of the rounds in the volley just fired (reused every shot). */
const volleyDirs: THREE.Vector3[] = [];

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
  const spread = (gun.spread ?? 0) * (arenaActive ? 1 : buffs.spreadMult); // Rune of Focus
  // Gunslinger capstones boost per-round damage (server still clamps PvP hits).
  const boosted = !arenaActive && buffs.gunDamageMult > 1
    ? { ...gun, damage: Math.max(1, Math.round(gun.damage * buffs.gunDamageMult)) }
    : gun;
  const eye = player.eyePosition;
  // The pellet directions are kept so the air-target test can run down the
  // rounds that were ACTUALLY fired rather than down the crosshair: a shotgun
  // that puts four pellets through a cabin should take four pellets' worth of
  // hull off it, and a wide pattern that mostly missed should not.
  volleyDirs.length = 0;
  for (let i = 0; i < pellets; i++) {
    const dir = spreadDir(base, spread);
    volleyDirs.push(dir);
    projectiles.fire(eye, dir, boosted);
  }
  reportAirTargetHit(boosted, volleyDirs);
  // Tell everyone else we fired (cosmetic only — hits are reported separately
  // and validated server-side). One message per trigger pull, not per pellet.
  net.sendShot(eye.x, eye.y, eye.z, base.x, base.y, base.z, stack.id);
  held.recoil();
  heldSwingSeq = (heldSwingSeq + 1) & 0xffff;
  // The weapon's own feel profile drives how the shot sounds and how hard the
  // world jolts, so a shotgun and an SMG never land the same way.
  const feel = gunFeel(stack.id);
  audio.gun(player.eyePosition, feel.kick);
  if (feel.shake > 0) triggerEncounterShake(0.11, feel.shake);
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
  if (loaded >= gun.mag ||
      (!arenaUnlimited.has(gun.ammo) && inventory.countItem(gun.ammo) <= 0)) return;
  reloadTimer = RELOAD_TIME * (arenaActive ? 1 : activeBuffs().reloadMult);
  reloadDuration = reloadTimer;
  reloadingStack = stack;
}
let stepAccum = 0;
let ambienceTimer = 20;
// Biome name for the draggable readout, resampled on a timer rather than every
// frame: naming a biome means sampling the terrain height first.
let hudBiomeName = '';
let hudBiomeTimer = 0;
let torchTime = 0; // flame-flicker clock for the held-torch light
let wasGliding = false; // edge-detect glider deploy for the whoosh/notice

function facingString(): string {
  const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx > 0 ? 'east (+X)' : 'west (-X)';
  }
  return dz > 0 ? 'south (+Z)' : 'north (-Z)';
}

/** Cardinal name and world axis, for the draggable direction readout. The F3
 *  overlay's facingString() packs both into one string; this keeps them apart
 *  so the module can style them differently. */
function facingParts(): { name: string; axis: string } {
  const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx > 0 ? { name: 'East', axis: '+X' } : { name: 'West', axis: '-X' };
  }
  return dz > 0 ? { name: 'South', axis: '+Z' } : { name: 'North', axis: '-Z' };
}

function clockString(): string {
  const tod = sky.time % 1; // 0 = 06:00
  const minutes = Math.floor(((tod * 24 + 6) % 24) * 60);
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m} (day ${Math.floor(sky.time) + 1})`;
}

function updateCamera(): void {
  const cockpitEye = mySeat
    ? vehicleModels.cockpitWorldPosition(mySeat.id, mySeat.seat)
    : null;
  camera.position.copy(cockpitEye ?? player.eyePosition);
  // Brief roll tilt while the damage flash decays, like vanilla's hurt cam —
  // plus the glider's bank, so turning under the wing leans the whole horizon.
  camera.rotation.set(
    player.pitch, player.yaw, player.damageFlash * 0.18 + glideCamRoll);

  // Aim-down-sights divides the FOV (zoom) and steadies the look. Raw speed
  // widens it instead: a grapple reel or a launch pushes the world past you,
  // which is most of what makes going fast FEEL fast. (updateCamera already
  // eases toward the target, so no extra smoothing is needed here.)
  const base = player.sprinting ? SPRINT_FOV : FOV;
  const targetFov = base / aimZoom + (aimZoom > 1 ? 0 : speedFov);
  // Sights and the zoom key stack: scoping a rifle while zoomed magnifies both.
  player.lookScale = aimZoom * zoomAmount > 1
    ? Math.max(0.1, 1 / (aimZoom * zoomAmount)) : 1;
  // `fovNoZoom` is the gameplay FOV the game has always eased toward (sprint,
  // sights, speed kick); the zoom key divides it afterwards. Keeping the two
  // apart means the ramp is not smoothed twice — its own easing already is
  // frame-rate independent — while sprinting or scoping mid-zoom still eases.
  const settled = Math.abs(fovNoZoom - targetFov) <= 0.01;
  if (!settled) fovNoZoom += (targetFov - fovNoZoom) * 0.3;
  const want = fovNoZoom / zoomAmount;
  if (!settled || camera.fov !== want) {
    camera.fov = want;
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
  if (!frame || !curVault || accessibility.reducedMotion || accessibility.photosensitivitySafe) return;
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
    // Follow an arc around the creature. A straight interpolation between
    // opposite room anchors passed directly through the boss's body.
    const startAngle = Math.atan2(a.z - boss.z, a.x - boss.x);
    const endAngle = Math.atan2(b.z - boss.z, b.x - boss.x);
    const deltaAngle = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
    const shotAngle = startAngle + deltaAngle * sweep;
    const shotRadius = Math.max(5.8, THREE.MathUtils.lerp(
      Math.hypot(a.x - boss.x, a.z - boss.z), Math.hypot(b.x - boss.x, b.z - boss.z), sweep));
    cinematicShotPos.set(boss.x + Math.cos(shotAngle) * shotRadius,
      THREE.MathUtils.lerp(a.y, b.y, sweep), boss.z + Math.sin(shotAngle) * shotRadius);
    // The second half pushes close to the boss before retreating into gameplay.
    const close = THREE.MathUtils.smoothstep(p, 0.42, 0.72);
    const orbit = shotAngle + close * 0.65;
    const closeRadius = THREE.MathUtils.lerp(shotRadius, 5.4, close);
    cinematicShotPos.set(
      boss.x + Math.cos(orbit) * closeRadius,
      THREE.MathUtils.lerp(cinematicShotPos.y, boss.y + 2.2 + Math.sin(p * Math.PI) * 1.3, close),
      boss.z + Math.sin(orbit) * closeRadius,
    );
    returnMix = THREE.MathUtils.smoothstep(p, 0.73, 1);
    cinematicFov = THREE.MathUtils.lerp(62, 42, close);
  } else if (frame.mode === 'phase') {
    const angle = -0.7 + p * Math.PI * 0.65;
    cinematicShotPos.set(
      boss.x + Math.cos(angle) * 6.2,
      boss.y + 2.8 + Math.sin(p * Math.PI) * 0.7,
      boss.z + Math.sin(angle) * 6.2,
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

  const bounds = curVault.arena.bounds;
  cinematicShotPos.x = THREE.MathUtils.clamp(cinematicShotPos.x, bounds.minX + 0.7, bounds.maxX - 0.7);
  cinematicShotPos.y = THREE.MathUtils.clamp(cinematicShotPos.y, boss.y + 0.8, bounds.maxY - 0.7);
  cinematicShotPos.z = THREE.MathUtils.clamp(cinematicShotPos.z, bounds.minZ + 0.7, bounds.maxZ - 0.7);
  const focusHeight = frame.snapshot.kind === 'mire_queen' ? 1.3
    : frame.snapshot.kind === 'ember_colossus' ? 2.3 : 3;
  camera.position.copy(cinematicShotPos).lerp(cinematicGameplayPos, returnMix);
  camera.lookAt(boss.x, boss.y + (frame.mode === 'victory' ? 1.1 : focusHeight), boss.z);
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
const boomEye = new THREE.Vector3();

/**
 * Place the third-person render camera on a boom out of the player's eye.
 * BACK keeps the player's own orientation (the boom trails behind); FRONT
 * spins it 180° and mirrors the pitch so the camera looks back at your face.
 * Either way the boom is pulled in short of the first solid block, so the
 * view never ends up inside terrain.
 */
function updateViewCamera(): void {
  const front = view === View.Front;
  // Seated, the boom hangs off the COCKPIT eye rather than the player capsule's
  // — they are the same place, but only one of them is smoothed with the
  // airframe — and rides a little higher, over the rotor disc.
  const seatEye = mySeat
    ? vehicleModels.cockpitWorldPosition(mySeat.id, mySeat.seat)
    : null;
  const seated = !!seatEye;
  const eye = boomEye.copy(seatEye ?? player.eyePosition);
  if (seated) eye.y += VIEW_LIFT_SEATED;
  viewCamera.fov = camera.fov;
  viewCamera.updateProjectionMatrix();
  const reach = seated ? VIEW_DIST_SEATED : VIEW_DIST;

  // Always derive the boom from mouse-look. This makes the two chase views
  // proper orbit cameras for pilot and gunner alike; aircraft attitude still
  // moves the eye anchor, but no longer confiscates either occupant's camera.
  viewCamera.rotation.set(
    front ? -player.pitch : player.pitch,
    front ? player.yaw + Math.PI : player.yaw,
    0
  );
  // The boom runs straight backwards out of the camera's own facing.
  boomDir.set(0, 0, 1).applyQuaternion(viewCamera.quaternion);
  let dist = reach;
  for (let d = 0.4; d <= reach; d += 0.25) {
    boomProbe.copy(eye).addScaledVector(boomDir, d);
    if (isSolid(world.getBlock(
      Math.floor(boomProbe.x), Math.floor(boomProbe.y), Math.floor(boomProbe.z)
    ))) { dist = Math.max(0.6, d - 0.35); break; }
  }
  viewCamera.position.copy(eye).addScaledVector(boomDir, dist);
}

/** V: cycle first person → third-person back → third-person front. */
function cycleView(): void {
  // The airframe is always flown from an exterior camera: first person puts
  // the eye inside the cabin/rotor geometry and can strand the camera there
  // after a seat transfer. Seated V therefore toggles only the two safe chase
  // perspectives.
  if (mySeat) {
    view = view === View.Back ? View.Front : View.Back;
    showNotice(`🎥 ${VIEW_NAMES[view]}`);
    vehicleModels.setCockpitView(null);
    return;
  }
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
let selfHeldMesh: THREE.Object3D | null = null;
let selfWalkPhase = 0;
let selfSneakT = 0;
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
  if (view === View.First || player.dead || localMode === 'spectator' || duelSpectating) {
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
  // A vehicle seat reports the seat PAN, so the body sinks a thigh's length to
  // put its hips there — otherwise your own head sticks through the cabin roof
  // exactly the way a remote rider's used to.
  b.group.position.set(player.pos.x, player.pos.y - (mySeat ? SEAT_SINK : 0), player.pos.z);
  b.group.rotation.y = player.yaw;

  // Held item + worn armor, kept in step with the inventory.
  const heldId = inventory.selectedStack?.id ?? 0;
  if (heldId !== selfHeldId) {
    selfHeldId = heldId;
    if (selfHeldMesh) { selfHeldMesh.parent?.remove(selfHeldMesh); selfHeldMesh = null; }
    if (heldId > 0 && ITEMS[heldId]) {
      const mesh = isGunItem(heldId)
        ? createGunModel(heldId)
        : isModeledGadget(heldId)
          ? createGadgetModel(heldId)
          : new THREE.Mesh(itemGeometry(atlas, heldId), selfItemMat);
      if (isGunItem(heldId)) {
        poseGunModel(mesh, 'avatar');
      } else if (isModeledGadget(heldId)) {
        poseGadgetModel(mesh, 'avatar');
      } else {
        mesh.position.set(0, -0.68, -0.2);
        mesh.rotation.set(-0.5, 0, 0);
        mesh.scale.setScalar(ITEMS[heldId].kind === 'block' ? 1.5 : 1.1);
      }
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

  // Pose: the same glide/boat/stride/crouch poses the remote avatars use.
  const sneakTarget = player.sneaking && !player.boating && !player.gliding ? 1 : 0;
  selfSneakT += (sneakTarget - selfSneakT) * Math.min(1, 12 * dt);
  if (player.boating || mySeat) {
    applyAvatarSneak(b, 0);
    b.group.rotation.x = 0; b.group.rotation.z = 0; b.head.rotation.x = 0;
    b.parts[0].rotation.x = 1.35; b.parts[1].rotation.x = 1.35;
    const arms = mySeat ? 0.95 : 0.55;
    b.parts[2].rotation.x = arms; b.parts[3].rotation.x = arms;
    b.parts[2].rotation.z = 0; b.parts[3].rotation.z = 0;
    // The seat banks and pitches with the helicopter. Inheriting its complete
    // attitude keeps the rider inside the cabin when A/D rolls the airframe.
    if (mySeat) {
      const heli = vehicleModels.snapshotOf(mySeat.id);
      if (heli) b.group.rotation.set(heli.pitch, heli.yaw, heli.roll, 'YXZ');
    }
  } else if (selfGlideT > 0.01) {
    // Hanging under the wing (the rig itself is placed by updateGliderRig).
    applyAvatarSneak(b, 0);
    const pose = glidePose(player.pitch, selfBank, glidePhase, selfGlideT);
    b.group.rotation.x = pose.tilt;
    b.group.rotation.z = pose.roll;
    anchorTiltedBody(b.group, player.pos.x, player.pos.y, player.pos.z);
    b.parts[0].rotation.x = pose.legs[0]; b.parts[1].rotation.x = pose.legs[1];
    b.parts[2].rotation.x = pose.arms[0]; b.parts[3].rotation.x = pose.arms[1];
    b.parts[2].rotation.z = -pose.armRoll; b.parts[3].rotation.z = pose.armRoll;
    b.head.rotation.x = pose.head;
  } else {
    applyAvatarSneak(b, selfSneakT);
    b.group.rotation.x = 0;
    b.group.rotation.z = 0;
    b.head.rotation.x = player.pitch + selfSneakT * 0.12; // hunch while keeping look direction
    const hspeed = Math.hypot(player.vel.x, player.vel.z);
    selfWalkPhase += Math.min(hspeed, 7) * dt * 2.4;
    // Same shared pose helper the remote avatars use, so your own body never
    // animates differently from the one other players see.
    const pose = stridePose(
      selfWalkPhase, hspeed, selfSneakT, selfHeldId > 0, held.swingAmount());
    b.parts[0].rotation.x = pose.legs[0];
    b.parts[1].rotation.x = pose.legs[1];
    b.parts[2].rotation.x = pose.arms[0];
    b.parts[2].rotation.z = 0;
    b.parts[3].rotation.x = pose.arms[1];
    b.parts[3].rotation.z = pose.rightArmRoll;
    if (isGunItem(selfHeldId)) {
      const aiming = aimZoom > 1;
      const reloadProgress = reloadTimer > 0 && reloadDuration > 0
        ? 1 - reloadTimer / reloadDuration : -1;
      const reloadDip = reloadProgress >= 0 ? Math.sin(reloadProgress * Math.PI) : 0;
      const raise = 0.9 + (aiming ? 0.42 : 0);
      const kick = held.recoilAmount();
      b.parts[2].rotation.x = raise + kick * 0.1 - reloadDip * 0.25;
      b.parts[3].rotation.x = raise + 0.1 + kick * 0.18 - reloadDip * 0.35;
      b.parts[2].rotation.z = -0.42 + (aiming ? 0.12 : 0);
      b.parts[3].rotation.z = 0.08 + reloadDip * 0.5;
      if (selfHeldMesh) {
        selfHeldMesh.rotation.x = -(raise + 0.1) + player.pitch;
        selfHeldMesh.rotation.z = -reloadDip * 0.45;
      }
    } else if (isModeledGadget(selfHeldId)) {
      const action = held.recoilAmount();
      b.parts[2].rotation.x = 0.45 + action * 0.18;
      b.parts[3].rotation.x = 0.62 + action * 0.48;
      b.parts[2].rotation.z = -0.18;
      b.parts[3].rotation.z = 0.08;
    }
  }
}

// ── The glider you are actually riding ──────────────────────────────────────
// The rig is a scene object, not a first-person prop, and it stays visible in
// FIRST person: hanging under a wing with the control bar out in front of you
// IS the cockpit view, so there is nothing extra to model and what you see is
// exactly what everyone else sees you flying.
let selfRig: GliderRig | null = null;
let selfGlideT = 0;      // 0..1 deploy ease (drives the pilot pose too)
let selfBank = 0;        // smoothed bank angle, radians
let glideCamRoll = 0;    // camera roll into the turn (updateCamera adds it)
let glidePhase = 0;      // sail-flutter / leg-scissor clock
let selfPrevYaw = 0;
let windTimer = 0;       // next gust of the wind bed
let vaporTimer = 0;      // next puff of wingtip vapour
const rigScratch = new THREE.Vector3();

/** How fast the wing is flying, 0..1, for wind, flutter and vapour. */
function glideSpeed01(): number {
  return Math.max(0, Math.min(1, (player.glideSpeed - 10) / 22));
}

/** Fly the wing: attitude, bank, wind and wingtip vapour. Runs every frame in
 *  every view so the deploy/stow blend is never skipped. */
function updateGliderRig(dt: number): void {
  const flying = player.gliding && !player.dead;
  selfGlideT += ((flying ? 1 : 0) - selfGlideT) * Math.min(1, dt * (flying ? 6 : 9));

  // Bank comes from how hard you are turning — an aircraft rolls into a turn,
  // and the roll is most of what sells the fact that you are flying one.
  let turn = player.yaw - selfPrevYaw;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  selfPrevYaw = player.yaw;
  const bankTarget = flying
    ? Math.max(-0.75, Math.min(0.75, (turn / Math.max(dt, 1e-4)) * 0.42)) : 0;
  selfBank += (bankTarget - selfBank) * Math.min(1, dt * 5);
  glideCamRoll = accessibility.reducedMotion ? 0 : selfBank * 0.32 * selfGlideT;

  if (selfGlideT <= 0.02) {
    if (selfRig) selfRig.group.visible = false;
    return;
  }
  if (!selfRig) {
    selfRig = buildGliderRig();
    scene.add(selfRig.group);
  }
  glidePhase += dt * 2.2;
  const speed01 = glideSpeed01();
  poseGliderRig(selfRig, {
    deploy: selfGlideT, bank: selfBank, time: glidePhase, speed01,
  });
  selfRig.group.position.set(
    player.pos.x, player.pos.y + RIG_HARNESS_Y, player.pos.z);
  selfRig.group.rotation.set(
    THREE.MathUtils.clamp(player.pitch, -1.2, 1.2) * 0.8 + 0.06,
    player.yaw, selfBank);
  // Your own fists on the bar — only when the third-person body (which has its
  // own hands) is not the one being drawn.
  selfRig.hands.visible = view === View.First;

  if (!flying) return;
  // Wind bed: re-triggered gusts whose level tracks airspeed, so a dive roars
  // and a level cruise whispers.
  windTimer -= dt;
  if (windTimer <= 0) {
    windTimer = 0.34;
    audio.glideWind(speed01);
  }
  // Vapour off the wingtips once you are really moving.
  if (speed01 > 0.45 && !accessibility.reducedMotion) {
    vaporTimer -= dt;
    if (vaporTimer <= 0) {
      vaporTimer = 0.09;
      for (const tip of selfRig.tips) {
        tip.getWorldPosition(rigScratch);
        particles.burst(rigScratch.x, rigScratch.y, rigScratch.z, 1, 0xffffff,
          0.4, 0.3, { gravity: 0, spread: 0.15, scale: 0.4 });
      }
    }
  }
}

/** Scratch colour for the underwater fog tint (per-frame; not allocated). */
const waterFogTint = new THREE.Color();

function updateAtmosphere(activeCamera: THREE.Camera): void {
  // Every light the terrain is lit by — the sun or moon, the dome's ambient,
  // the horizon it fogs into — is measured off the sky the player can see.
  world.applySky(sky, !player.eyeUnderwater && !curVault);
  postfx.setSky(sky, activeCamera);
  // Animation clock for water, wind and flicker. Wall time, wrapped well
  // inside float32's comfortable range (the world clock is days since epoch).
  world.timeUniform.value = (performance.now() / 1000) % 4096;
  const fog = scene.fog as THREE.Fog;
  if (player.eyeUnderwater) {
    // Underwater haze takes the local water colour, so surfacing in a tropical
    // lagoon looks nothing like surfacing under polar ice.
    const wt = world.terrain.tints(Math.floor(player.pos.x), Math.floor(player.pos.z)).water;
    waterFogTint.setRGB(0.4 + wt[0], 0.4 + wt[1], 0.4 + wt[2]);
    fog.color.copy(WATER_FOG_COLOR).multiply(waterFogTint)
      .multiplyScalar(0.3 + 0.7 * sky.sunIntensity);
    fog.near = 0;
    fog.far = 24;
  } else if (arenaActive) {
    // The sealed room has its own clear daytime presentation. A shorter bright
    // haze softens the wall line and guarantees no distant open-world terrain
    // can become legible through a missed angle.
    fog.color.copy(sky.skyColor);
    fog.near = 34;
    fog.far = 68;
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
    // While the outer world is still streaming, pull the fog edge in to the
    // generated bubble. Since chunks are built nearest-first, sqrt(progress)
    // closely tracks the currently available radius. This prevents holes or
    // pop-in without making the player wait for the full view distance.
    const loadedRadius = Math.max(
      INITIAL_LOAD_DISTANCE,
      Math.sqrt(world.progress(player.pos.x, player.pos.z)) * world.renderDistance
    );
    fog.far = Math.min(FOG_FAR, loadedRadius * 16 - 6);
    fog.near = Math.min(FOG_NEAR, Math.max(8, fog.far - 32));
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
      const me = net.connected ? net.username : 'You';
      if (!s || !turretCanClaim(s, me, localFaction)) return;
      const hacked = !!s.owner && s.owner !== me && turretDisabled(s);
      claimTurret(s, me, localFaction);
      if (net.connected) net.sendTurretClaim(x, y, z);
      else if (hacked) showNotice('Turret hacked — it fights for you now.');
    },
    canClaim: () => {
      const s = here();
      return !!s && turretCanClaim(s, net.connected ? net.username : 'You', localFaction);
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
    canMove: () => {
      const s = here();
      return !!s && turretFriendly(s, net.connected ? net.username : 'You', localFaction);
    },
    move: () => {
      const s = here();
      if (!s || !turretFriendly(s, net.connected ? net.username : 'You', localFaction)) {
        showNotice('Only your own (or your faction\'s) turret can be relocated.');
        return;
      }
      invUI.hide();
      interaction.armedMove = (px, py, pz) => moveTurret(x, y, z, px, py, pz);
      if (worldReady) resumePlay();
      showNotice(`✋ Carry it up to ${RELOCATE_RANGE} blocks, then right-click the new site. Esc cancels.`);
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

/** Relocate a turret: its level, ammo, fuel and hull travel with it. Online the
 *  server moves it and echoes the edits + state; offline we move it locally. */
function moveTurret(
  fromX: number, fromY: number, fromZ: number, px: number, py: number, pz: number
): boolean {
  const fromKey = `${fromX},${fromY},${fromZ}`;
  const s = turretStates.get(fromKey);
  if (!s || world.getBlock(fromX, fromY, fromZ) !== Block.Turret) {
    showNotice('That turret is no longer there.');
    return true;
  }
  if (px === fromX && py === fromY && pz === fromZ) {
    showNotice('Choose a different site. Right-click to try again.');
    return false;
  }
  if (Math.hypot(px - fromX, pz - fromZ) > RELOCATE_RANGE) {
    showNotice(`Too far — a turret can be carried at most ${RELOCATE_RANGE} blocks. Right-click a closer site.`);
    return false;
  }
  if (py < 0 || py >= 256 || !isReplaceable(world.getBlock(px, py, pz))) {
    showNotice('No room there. Right-click another site to try again.');
    return false;
  }
  if (player.intersectsBlock(px, py, pz) || interaction.canEdit?.(px, py, pz) === false) {
    showNotice('That site is obstructed. Step clear and right-click another site.');
    return false;
  }
  const pos = new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5);
  if (net.connected) {
    net.sendTurretMove(fromX, fromY, fromZ, px, py, pz); // server echoes edits + state
    audio.place(materialOf(Block.Turret), pos);
    return true;
  }
  turretStates.delete(fromKey); // keep `s` so the placement hook can't reset it
  world.applyRemoteEdit(fromX, fromY, fromZ, Block.Air);
  syncTurretCell(fromX, fromY, fromZ, Block.Air);
  turretStates.set(`${px},${py},${pz}`, s);
  world.setBlock(px, py, pz, Block.Turret);
  audio.place(materialOf(Block.Turret), pos);
  showNotice('Turret moved!');
  return true;
}

// --- WARFARE COMMAND: vehicles (client) --------------------------------------
// Online the server owns helicopters and pushes snapshots; the client renders
// them and predicts nothing that matters. Offline the SAME pure simulation runs
// locally, so single-player behaves identically to a server.

/** Highest solid cell in a column, edits included (bombs + heli floor/ceiling). */
function warfareGroundY(x: number, z: number): number {
  const bx = Math.floor(x), bz = Math.floor(z);
  let top = world.terrain.height(bx, bz);
  for (let y = top + 1; y <= top + 48 && y < 256; y++) {
    if (isSolid(world.getBlock(bx, y, bz))) top = y;
  }
  return top;
}

const offlineVehicles = new VehicleSim({
  solid: (x, y, z) => isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))),
  groundY: warfareGroundY,
  worldHalf: WORLD_HALF,
  vaultArena: (x, y, z) => {
    const v = vaultAt(seed, x, y, z, world.terrain, vaultStampCached);
    if (!v) return false;
    const b = v.arena.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ &&
      y >= b.minY && y <= b.maxY;
  },
});

const vehicleModels = new VehicleModels(scene, (f) => factionCss(f));

/** The helicopter the local player is riding, and in which seat. */
let mySeat: { id: number; seat: SeatKind } | null = null;
let myRope: {
  id: number;
  /** Smooth client-presented position plus the latest server correction. */
  progress: number;
  authoritativeProgress: number;
  motion: number;
  /** Seconds of uninterrupted slide — the ramp the sim runs, mirrored here so
   *  the shake, the wind and the friction sparks agree with the speed. */
  held: number;
  /** Blocks/s actually descending, smoothed for the instrument line. */
  descent: number;
  /** Repeat timers for the wind bed and the friction sparks. */
  wind: number;
  spark: number;
} | null = null;
let ropeInputAccum = 0;
let prevRopeJump = false;

/**
 * Grab the line.
 *
 * Everything that says "you are ON it now" lives here rather than at the three
 * places you can end up attached (offline attach, the pilot transferring out of
 * a seat, the server confirming either), so the feel can never go missing from
 * one route in.
 */
function beginRope(id: number, progress: number): void {
  const fresh = myRope?.id !== id;
  myRope = {
    id, progress, authoritativeProgress: progress, motion: 0,
    held: 0, descent: 0, wind: 0, spark: 0,
  };
  vehicleHud.setRope(true);
  vehicleHud.setRopeTelemetry(progress, 0);
  if (!fresh) return;
  audio.ropeGrab();
  triggerEncounterShake(0.14, 0.045);
  const at = vehicleModels.ropeWorldPosition(id, progress);
  if (at) particles.burst(at.x, at.y, at.z, 5, 0xd8c090, 1.6, 0.32,
    { gravity: 2.4, spread: 0.4, scale: 0.3 });
}
let heliInputSeq = 1;
let heliInputAccum = 0;
let heliBombCooldown = 0;
/** How close you must stand to a parked airframe to climb aboard it. */
const HELI_BOARD_RANGE = 5.5;
/** Last-known airspeed of the ridden airframe, for the cockpit readout. */
let heliSpeedSmoothed = 0;
const vehicleHud = new VehicleHUD(app);

/** Does the local player hold the blueprint needed to build/retrofit this? */
function hasBlueprint(id: number): boolean {
  const node = WARFARE_BLUEPRINTS[id];
  return !node || warfareOwns(warfare, node);
}
// The crafting grid refuses to produce warfare hardware you have not
// authorized — the recipe is visible in the guide, but the bench stays empty.
setBlueprintCheck(hasBlueprint);

// --- Network handlers ---------------------------------------------------------

net.onWarfare = (xp, nodes) => {
  warfare = sanitizeWarfare({ version: 1, xp, nodes });
  warfareUI.refresh();
};
net.onWarfareXp = (amount, tier, total, boss) => {
  showRegionBanner(`⌘ +${amount} WARFARE XP`, '#5ce2ec');
  showNotice(`Tier ${tier} ${boss} cleared — ${total} warfare XP earned in total.`);
  audio.heartSteal();
};
/**
 * Items debited client-side for an action the SERVER still has to approve.
 * The inventory model is client-trusted, so the debit has to happen locally —
 * but a refusal (faction cap, missing blueprint, out of range, wrong faction)
 * must not silently destroy a 38-iron airframe or a stack of bombs. Every
 * such payment is parked here and refunded on the next `warfareErr`.
 */
let pendingWarfarePayment: { id: number; count: number }[] = [];

/** Debit `items` now, remembering them so a server refusal can refund them. */
function payWarfare(items: { id: number; count: number }[]): void {
  for (const it of items) inventory.removeItem(it.id, it.count);
  pendingWarfarePayment = items.filter((it) => it.count > 0);
}
/** The server accepted whatever we last paid for — drop the refund ticket. */
function settleWarfarePayment(): void { pendingWarfarePayment = []; }
function refundWarfarePayment(): void {
  for (const it of pendingWarfarePayment) {
    const left = inventory.add(it.id, it.count);
    if (left > 0) spillAtPlayer([{ id: it.id, count: left }]);
  }
  pendingWarfarePayment = [];
}

net.onWarfareErr = (reason) => {
  refundWarfarePayment();
  showNotice(`⛔ ${reason}`);
};
net.onHelis = (list, bombs) => {
  settleWarfarePayment();
  vehicleModels.sync(list, bombs);
};
net.onHeliSeat = (id, seat) => {
  setSeat(seat ? { id, seat } : null);
  showNotice(!seat ? 'You step down from the airframe.'
    : seat === 'pilot'
      ? 'Pilot seat — WASD flies, Space climbs, Shift descends, right-click drops a bomb.'
      : 'Gunner seat — look around and fire your own weapon inside the forward arc.');
};
net.onHeliRopeState = (id, progress) => {
  const next = Math.max(0, Math.min(1, progress));
  if (id > 0 && myRope?.id === id) {
    myRope.authoritativeProgress = next;
    // Large corrections mean an attach/teleport, not ordinary packet jitter.
    if (Math.abs(myRope.progress - next) > 0.25) myRope.progress = next;
  } else if (id > 0) {
    beginRope(id, next);
  } else {
    myRope = null;
  }
  if (myRope) {
    setSeat(null);
  } else {
    vehicleHud.setRope(false);
    prevRopeJump = input.jump;
  }
};
net.onHeliModuleInstalled = (_id, item) => {
  settleWarfarePayment();
  showNotice(`✓ ${ITEMS[item]?.name ?? 'Airframe module'} installed.`);
};
net.onHeliDown = (_id, x, y, z, _faction, reason) => heliLossEffect(x, y, z, reason);
net.onHeliCrash = (id, x, y, z) => heliCrashEffect(id, x, y, z);
net.onHeliGone = (id) => { if (mySeat?.id === id) setSeat(null); };
net.onEjected = (x, y, z, vx, vy, vz, reason) => applyEject(x, y, z, vx, vy, vz, reason);

// --- Offline simulation -----------------------------------------------------------

/** Shared blast application: damage first, then BOUNDED player-built block loss. */
function offlineBlast(
  faction: number, at: { x: number; y: number; z: number },
  radius: number, playerDamage: number, hardwareDamage: number, blockCap: number,
  breakNatural = false,
): void {
  if (!isFaction(faction) || faction !== localFaction) {
    const dmg = blastAt(at, { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      radius, playerDamage);
    if (dmg > 0) player.damage(dmg);
  }
  for (const h of [...offlineVehicles.helicopters.values()]) {
    if (h.faction === faction || h.dying > 0) continue;
    const dmg = bombBlast(at, h.position, radius, hardwareDamage);
    if (dmg > 0) applyOfflineVehicleEvents(offlineVehicles.damage(h.id, dmg));
  }
  // Helicopter bombs pass `breakNatural` so their impact makes a real crater.
  let removed = 0;
  world.beginBatch();
  try {
    for (const c of blastBlockCandidates(at.x, at.y, at.z, radius)) {
      if (removed >= blockCap) break;
      const edited = world.getEditedBlock(c.x, c.y, c.z);
      const block = edited ?? (breakNatural ? world.getBlock(c.x, c.y, c.z) : undefined);
      if (block === undefined || block === Block.Air) continue;
      const info = BLOCKS[block];
      if (!info || info.hardness < 0 || isVaultMasonry(block)) continue;
      if (block === Block.Core) continue;
      world.setBlock(c.x, c.y, c.z, Block.Air);
      removed++;
    }
  } finally {
    world.endBatch();
  }
  particles.burst(at.x, at.y + 1, at.z, 40, 0xff8a3a, 8, 1.1);
}

function applyOfflineVehicleEvents(events: readonly VehicleEvent[]): void {
  for (const ev of events) {
    switch (ev.kind) {
      case 'bombImpact':
        offlineBlast(ev.faction, { x: ev.x, y: ev.y, z: ev.z }, ev.radius,
          ev.playerDamage, ev.hardwareDamage, ev.blockCap, true);
        audio.explosion(new THREE.Vector3(ev.x, ev.y, ev.z));
        break;
      case 'heliDown':
        heliLossEffect(ev.x, ev.y, ev.z, ev.reason);
        break;
      case 'eject':
        player.damage(ev.damage);
        applyEject(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.reason);
        break;
      case 'heliCrash':
        heliCrashEffect(ev.id, ev.x, ev.y, ev.z);
        break;
      case 'heliRemoved':
        if (mySeat?.id === ev.id) setSeat(null);
        break;
      default:
        break;
    }
  }
}

// --- The hangar panels ---------------------------------------------------------

let openHelipad: { x: number; y: number; z: number } | null = null;
/** When the bay was opened on a specific parked airframe rather than a pad. */
let openAirframeId = 0;

const strategicPanel = document.createElement('div');
strategicPanel.style.cssText =
  'position:absolute;inset:0;display:none;z-index:34;align-items:center;justify-content:center;' +
  'background:rgba(6,9,16,0.82);';
const strategicCard = document.createElement('div');
strategicCard.className = 'mc-font';
strategicCard.style.cssText =
  'background:linear-gradient(#111a2b,#0b1220);border:2px solid #26374f;border-radius:10px;' +
  'box-shadow:0 12px 44px rgba(0,0,0,0.65);width:540px;max-width:94vw;max-height:88vh;' +
  'overflow:auto;color:#dce6f5;text-shadow:none;font-size:13px;padding:16px;';
strategicPanel.appendChild(strategicCard);
app.appendChild(strategicPanel);
strategicPanel.addEventListener('mousedown', (e) => {
  if (e.target === strategicPanel) closeStrategicPanel();
});

function closeStrategicPanel(): void {
  strategicPanel.style.display = 'none';
  openHelipad = null;
  openAirframeId = 0;
  airframeLive = null;
  if (worldReady && !player.dead && screen === 'playing' && !worldMap.open) input.lock();
}

/** Small helper: a 44px-minimum action button appended to a row. */
function actionButton(
  row: HTMLElement, label: string, enabled: boolean, onClick: () => void,
  accent = '#5ce2ec',
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mc-font';
  // Labels here carry inline icon markup (setIconText would escape it away).
  b.innerHTML = iconifyHtml(label);
  b.disabled = !enabled;
  b.style.cssText =
    `min-height:44px;padding:0 14px;border-radius:7px;font-family:inherit;font-size:12px;` +
    `cursor:${enabled ? 'pointer' : 'not-allowed'};border:2px solid ${enabled ? accent : '#2a3346'};` +
    `background:${enabled ? 'rgba(92,226,236,0.10)' : '#131a28'};` +
    `color:${enabled ? '#e6faff' : '#5a6880'};`;
  // The listener is ALWAYS attached: a disabled button fires no click events by
  // itself, and a live panel may re-enable this node later (see
  // setButtonEnabled) — a handler that was never attached could not come back.
  b.addEventListener('click', () => { if (!b.disabled) onClick(); });
  row.appendChild(b);
  return b;
}

/** Usernames and waypoint names reach these panels as plain text; anything
 *  interpolated into innerHTML has to be neutralised first. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/** Re-style an already-built button in place. Rebuilding a button every frame
 *  destroys the node a mousedown landed on, so live panels mutate instead. */
function setButtonEnabled(
  b: HTMLButtonElement, enabled: boolean, accent = '#5ce2ec',
): void {
  if (b.disabled === !enabled) return;
  b.disabled = !enabled;
  b.style.cursor = enabled ? 'pointer' : 'not-allowed';
  b.style.borderColor = enabled ? accent : '#2a3346';
  b.style.background = enabled ? 'rgba(92,226,236,0.10)' : '#131a28';
  b.style.color = enabled ? '#e6faff' : '#5a6880';
}

/** A labelled progress bar for the hangar bay's live readouts. */
function consoleGauge(
  parent: HTMLElement, label: string, color: string,
): { fill: HTMLDivElement; text: HTMLSpanElement } {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:9px;margin:5px 0;';
  parent.appendChild(row);
  const name = document.createElement('span');
  name.style.cssText =
    'font-size:10px;letter-spacing:1.3px;color:#63758f;min-width:104px;';
  name.textContent = label;
  row.appendChild(name);
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:relative;flex:1;height:13px;border-radius:3px;overflow:hidden;' +
    'background:rgba(3,7,12,0.9);border:1px solid rgba(120,150,190,0.26);';
  row.appendChild(wrap);
  const fill = document.createElement('div');
  fill.style.cssText =
    `position:absolute;inset:0 auto 0 0;width:0%;background:${color};` +
    'transition:width 0.15s linear;';
  wrap.appendChild(fill);
  const text = document.createElement('span');
  text.style.cssText =
    'font-size:10px;color:#c6d3e6;min-width:96px;text-align:right;';
  row.appendChild(text);
  return { fill, text };
}

/** One label/value pair in the spec grid. */
function specCell(label: string, value: string): string {
  return `<div style="display:flex;flex-direction:column;gap:2px;min-width:92px">` +
    `<span style="font-size:9px;letter-spacing:1.2px;color:#5b6b83">${label}</span>` +
    `<span style="font-size:12px;color:#dce6f5">${value}</span></div>`;
}

/** The hangar bay's chrome: a scanning header sweep and a drifting spec grid. */
let hangarCssInjected = false;
function injectHangarCss(): void {
  if (hangarCssInjected) return;
  hangarCssInjected = true;
  const el = document.createElement('style');
  el.textContent =
    '@keyframes vx-bay-sweep{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}' +
    '@keyframes vx-bay-grid{0%{background-position:0 0}100%{background-position:0 26px}}';
  document.head.appendChild(el);
}

function statLine(label: string, value: string, accent = '#dce6f5'): string {
  return `<div style="display:flex;gap:10px;font-size:12px;padding:3px 0">` +
    `<span style="flex:1;color:#7f93b3">${label}</span>` +
    `<span style="color:${accent}">${value}</span></div>`;
}

function openHelipadPanel(x: number, y: number, z: number): void {
  openHelipad = { x, y, z };
  openAirframeId = 0;
  strategicPanel.style.display = 'flex';
  input.unlock();
  renderHelipadPanel();
}

/** Open the bay for one specific airframe (sneak + right-click on it). */
function openAirframePanel(id: number): void {
  openHelipad = { x: 0, y: 0, z: 0 };
  openAirframeId = id;
  strategicPanel.style.display = 'flex';
  input.unlock();
  renderHelipadPanel();
}

/** The helicopter parked on this pad, if any. */
function heliAtPad(pad: { x: number; y: number; z: number }): HelicopterSnapshot | null {
  for (const h of vehicleModels.snapshots()) {
    if (Math.hypot(h.x - (pad.x + 0.5), h.z - (pad.z + 0.5)) <= 4 &&
        Math.abs(h.y - (pad.y + 1.6)) <= 3) return h;
  }
  return null;
}

/** Whichever airframe the open bay is about. */
function bayHeli(): HelicopterSnapshot | null {
  if (openAirframeId) return vehicleModels.snapshotOf(openAirframeId);
  return openHelipad ? heliAtPad(openHelipad) : null;
}

interface AirframeLive {
  fuelFill: HTMLDivElement; fuelText: HTMLSpanElement;
  hullFill: HTMLDivElement; hullText: HTMLSpanElement;
  bombFill: HTMLDivElement; bombText: HTMLSpanElement;
  status: HTMLDivElement;
  heliId: number;
  buttons: { node: HTMLButtonElement; enabled: () => boolean; accent: string }[];
}
let airframeLive: AirframeLive | null = null;

function renderHelipadPanel(): void {
  if (!openHelipad) return;
  injectHangarCss();
  const heli = bayHeli();
  const kit = inventory.countItem(Item.HelicopterKit);
  const myTier = warfareTier(warfare, 'helicopter');
  const accent = '#5ce2ec';
  airframeLive = null;
  strategicCard.innerHTML = '';
  strategicCard.style.width = '580px';

  const header = document.createElement('div');
  header.style.cssText =
    'position:relative;overflow:hidden;border-radius:8px;padding:12px 14px;' +
    `margin:-4px -4px 12px;border:1px solid ${accent}55;` +
    'background:linear-gradient(120deg,rgba(12,22,36,0.95),rgba(8,13,22,0.9));';
  strategicCard.appendChild(header);
  const sweep = document.createElement('div');
  sweep.style.cssText =
    'position:absolute;top:0;bottom:0;width:26%;pointer-events:none;' +
    `background:linear-gradient(90deg,transparent,${accent}22,transparent);` +
    'transform:skewX(-16deg);animation:vx-bay-sweep 4.2s linear infinite;';
  header.appendChild(sweep);
  const title = document.createElement('div');
  title.style.cssText = 'position:relative;';
  title.innerHTML =
    `<div style="font-size:17px;letter-spacing:2.4px;color:${accent}">${iconSvg('heli')} AIRFRAME BAY</div>` +
    `<div style="font-size:10px;letter-spacing:1.6px;color:#5b6b83;margin-top:3px">` +
    (heli
      ? `${tierLabel(heli.tier)} · UNIT #${heli.id} · ${escapeHtml(heli.owner || 'unclaimed')}`
      : 'NO AIRFRAME PRESENT') +
    `</div>`;
  header.appendChild(title);

  if (!heli) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px;color:#7f93b3;line-height:1.7;margin-bottom:10px;';
    note.innerHTML =
      `Nothing parked here. Deploy an airframe from this pad — or simply ` +
      `<b style="color:#dce6f5">right-click the ground</b> anywhere while holding a ` +
      `<b style="color:#dce6f5">Helicopter Airframe</b>: a pad is a convenient place to ` +
      `keep an aircraft, not a requirement for flying one.`;
    strategicCard.appendChild(note);
    const stats = document.createElement('div');
    stats.innerHTML =
      statLine('Airframes held', String(kit), kit > 0 ? '#5ff09a' : '#ff5c4d') +
      statLine('Authorized mark', myTier > 0 ? tierLabel(myTier) : 'not authorized',
        myTier > 0 ? '#5ff09a' : '#ff5c4d');
    strategicCard.appendChild(stats);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;';
    strategicCard.appendChild(row);
    const pad = openHelipad;
    actionButton(row, 'Deploy airframe',
      kit > 0 && myTier > 0 && hasBlueprint(Item.HelicopterKit), () => {
        if (net.connected) {
          // A refusal (range or blueprint) refunds the airframe — it costs ~38
          // iron and 8 titanium, so losing it to a rejected click would be brutal.
          payWarfare([{ id: Item.HelicopterKit, count: 1 }]);
          net.sendHeliSpawn(pad.x, pad.y, pad.z);
        } else {
          inventory.removeItem(Item.HelicopterKit, 1);
          offlineVehicles.spawn(authedName || 'You', localFaction, pad, Math.max(1, myTier));
        }
        closeStrategicPanel();
        showNotice('🚁 Airframe deployed — fuel it, load bombs, then board it.');
      }, '#5ff09a');
    actionButton(row, 'Close', true, closeStrategicPanel, '#7f93b3');
    return;
  }

  const stats = helicopterStats(heli.tier);

  const gauges = document.createElement('div');
  gauges.style.cssText =
    'padding:10px 12px;border-radius:8px;border:1px solid #1e2a3d;' +
    'background:rgba(6,10,17,0.6);';
  strategicCard.appendChild(gauges);
  // Oil first and biggest: it is the resource that decides whether a sortie
  // comes home, and the turbine drinks it.
  const fuel = consoleGauge(gauges, 'OIL', '#4ad9a0');
  const hull = consoleGauge(gauges, 'INTEGRITY', '#8fb4ff');
  const bomb = consoleGauge(gauges, 'BOMB RACK', '#e6a83a');

  const status = document.createElement('div');
  status.style.cssText = 'margin-top:8px;font-size:11px;letter-spacing:1.1px;';
  gauges.appendChild(status);

  const spec = document.createElement('div');
  spec.style.cssText =
    'margin-top:10px;padding:11px 12px;border-radius:8px;border:1px solid #1e2a3d;' +
    'background:repeating-linear-gradient(0deg,rgba(8,13,22,0.75) 0 12px,' +
    'rgba(11,18,30,0.75) 12px 13px);animation:vx-bay-grid 9s linear infinite;';
  strategicCard.appendChild(spec);
  const burn = HELI_FUEL_IDLE + HELI_FUEL_BURN;
  spec.innerHTML =
    `<div style="font-size:10px;letter-spacing:1.6px;color:${accent};margin-bottom:9px">` +
    `AIRFRAME</div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:16px 22px">` +
    specCell('MARK', `Mk ${['I', 'II', 'III'][stats.mark - 1]}`) +
    specCell('CRUISE', `${stats.speed} b/s`) +
    specCell('CLIMB', `${stats.climb} b/s`) +
    specCell('CEILING', `${stats.altitude} b`) +
    specCell('BOMB BLAST', `${stats.bombRadius} b`) +
    specCell('BOMB DMG', `${stats.bombPlayerDamage} / ${stats.bombHardwareDamage}`) +
    specCell('OIL BURN', `${HELI_FUEL_IDLE.toFixed(2)}–${burn.toFixed(2)} /s`) +
    specCell('ENDURANCE', `~${Math.round(heli.maxFuel / burn)}s hard`) +
    specCell('TANK MODULE', heli.fuelModule === 3 ? 'long-range ×3'
      : heli.fuelModule === 2 ? 'auxiliary ×2' : 'standard') +
    specCell('FAST ROPE', heli.ropeWinch ? 'installed' : 'not installed') +
    `</div>`;

  const note = document.createElement('div');
  note.style.cssText = 'margin-top:10px;font-size:11px;color:#63758f;line-height:1.65;';
  note.innerHTML =
    `Refuelling, rearming and retrofits need the airframe <b>on the ground and ` +
    `stopped</b> — anywhere, not just on a pad. Run the tank dry in the air and ` +
    `the crew is thrown clear while the aircraft falls, so watch the oil bar.`;
  strategicCard.appendChild(note);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;';
  strategicCard.appendChild(row);

  const held = (id: number): number => inventory.countItem(id);
  const fuelBtn = actionButton(row, 'Refuel', false, () => {
    const h = bayHeli();
    if (!h) return;
    const n = Math.min(held(Item.OilBarrel), Math.ceil(h.maxFuel - h.fuel));
    if (n > 0) serviceHeli(h.id, n, 0, 0, [{ id: Item.OilBarrel, count: n }]);
  }, '#5ff09a');
  const armBtn = actionButton(row, 'Load bombs', false, () => {
    const h = bayHeli();
    if (!h) return;
    const n = Math.min(held(Item.AerialBomb), h.maxBombs - h.bombs);
    if (n > 0) serviceHeli(h.id, 0, n, 0, [{ id: Item.AerialBomb, count: n }]);
  }, '#5ff09a');
  const fixBtn = actionButton(row, 'Repair 25%', false, () => {
    const h = bayHeli();
    if (!h) return;
    serviceHeli(h.id, 0, 0, 1, [{ id: Item.RepairKit, count: 1 }]);
  }, '#5ff09a');
  const upBtn = actionButton(row,
    heli.tier < myTier ? `Retrofit → ${tierLabel(heli.tier + 1)}` : 'Retrofit locked',
    false, () => {
      const h = bayHeli();
      if (!h) return;
      if (net.connected) net.sendHeliUpgrade(h.id);
      else {
        const local = offlineVehicles.helicopters.get(h.id);
        if (local) offlineVehicles.retrofit(local, local.tier + 1);
      }
      renderHelipadPanel();
    });
  const pilotBtn = actionButton(row, 'Board (pilot)', false,
    () => { const h = bayHeli(); if (h) mountHeli(h.id, 'pilot'); }, '#ffd24a');
  const gunBtn = actionButton(row, 'Board (gunner)', false,
    () => { const h = bayHeli(); if (h) mountHeli(h.id, 'passenger'); }, '#ffd24a');
  const auxBtn = actionButton(row, 'Install auxiliary tanks', false,
    () => { const h = bayHeli(); if (h) installHeliModule(h.id, Item.AuxiliaryTank); }, '#4ad9a0');
  const rangeBtn = actionButton(row, 'Install long-range tanks', false,
    () => { const h = bayHeli(); if (h) installHeliModule(h.id, Item.LongRangeTank); }, '#4ad9a0');
  const winchBtn = actionButton(row, 'Install fast-rope winch', false,
    () => { const h = bayHeli(); if (h) installHeliModule(h.id, Item.RopeWinch); }, '#e6a83a');
  actionButton(row, 'Close', true, closeStrategicPanel, '#7f93b3');

  airframeLive = {
    fuelFill: fuel.fill, fuelText: fuel.text,
    hullFill: hull.fill, hullText: hull.text,
    bombFill: bomb.fill, bombText: bomb.text,
    status, heliId: heli.id,
    buttons: [
      { node: fuelBtn, accent: '#5ff09a', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && held(Item.OilBarrel) > 0 && h.fuel < h.maxFuel;
      } },
      { node: armBtn, accent: '#5ff09a', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && held(Item.AerialBomb) > 0 && h.bombs < h.maxBombs;
      } },
      { node: fixBtn, accent: '#5ff09a', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && held(Item.RepairKit) > 0 && h.hp < h.maxHp;
      } },
      { node: upBtn, accent: '#5ce2ec', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && h.tier < warfareTier(warfare, 'helicopter');
      } },
      { node: pilotBtn, accent: '#ffd24a', enabled: () => {
        const h = bayHeli();
        return !!h && !mySeat && h.pilot === 0 && h.dying <= 0;
      } },
      { node: gunBtn, accent: '#ffd24a', enabled: () => {
        const h = bayHeli();
        return !!h && !mySeat && h.passenger === 0 && h.dying <= 0;
      } },
      { node: auxBtn, accent: '#4ad9a0', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && h.fuelModule < 2 && held(Item.AuxiliaryTank) > 0 &&
          hasBlueprint(Item.AuxiliaryTank);
      } },
      { node: rangeBtn, accent: '#4ad9a0', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && h.fuelModule === 2 && held(Item.LongRangeTank) > 0 &&
          hasBlueprint(Item.LongRangeTank);
      } },
      { node: winchBtn, accent: '#e6a83a', enabled: () => {
        const h = bayHeli();
        return !!h && serviceable(h) && !h.ropeWinch && held(Item.RopeWinch) > 0 &&
          hasBlueprint(Item.RopeWinch);
      } },
    ],
  };
  refreshAirframeLive();
}

/** The client's honest preview of VehicleSim.canService: on the ground, stopped. */
function serviceable(h: HelicopterSnapshot): boolean {
  return h.dying <= 0 && h.y - warfareGroundY(h.x, h.z) <= HELI_GROUND_CLEARANCE + 1.2;
}

/** Repaint the bay's live gauges and re-gate its buttons, every frame it is up. */
function refreshAirframeLive(): void {
  const L = airframeLive;
  if (!L) return;
  const h = bayHeli();
  if (!h) { renderHelipadPanel(); return; }
  if (h.id !== L.heliId) { renderHelipadPanel(); return; }

  const fuelFrac = h.maxFuel > 0 ? Math.max(0, Math.min(1, h.fuel / h.maxFuel)) : 0;
  L.fuelFill.style.width = `${fuelFrac * 100}%`;
  L.fuelFill.style.background =
    fuelFrac > 0.28 ? '#4ad9a0' : fuelFrac > 0.12 ? '#ffd24a' : '#ff5c4d';
  L.fuelText.textContent = `${h.fuel.toFixed(1)} / ${h.maxFuel}`;

  const hullFrac = h.maxHp > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0;
  L.hullFill.style.width = `${hullFrac * 100}%`;
  L.hullFill.style.background =
    hullFrac > 0.5 ? '#8fb4ff' : hullFrac > 0.25 ? '#ffd24a' : '#ff5c4d';
  L.hullText.textContent = `${h.hp} / ${h.maxHp}`;

  const bombFrac = h.maxBombs > 0 ? Math.max(0, Math.min(1, h.bombs / h.maxBombs)) : 0;
  L.bombFill.style.width = `${bombFrac * 100}%`;
  L.bombText.textContent = h.maxBombs > 0 ? `${h.bombs} / ${h.maxBombs}` : 'no rack';

  const parked = serviceable(h);
  setIconText(L.status, h.dying > 0 ? '💥 Airframe destroyed'
    : parked ? '✓ On the ground — servicing available'
    : '✈ Airborne — land and stop to service');
  L.status.style.color = h.dying > 0 ? '#ff5c4d' : parked ? '#5ff09a' : '#ffd24a';

  for (const b of L.buttons) setButtonEnabled(b.node, b.enabled(), b.accent);
}


function serviceHeli(
  id: number, oil: number, bombs: number, repair: number,
  cost: { id: number; count: number }[],
): void {
  if (net.connected) {
    payWarfare(cost);
    net.sendHeliService(id, oil, bombs, repair);
  } else {
    const h = offlineVehicles.helicopters.get(id);
    if (!h) return;
    // Offline the sim is the authority, so pay only for what it actually took.
    const took = offlineVehicles.service(h, oil, bombs, repair);
    for (const it of cost) {
      const taken = it.id === Item.OilBarrel ? took.oil
        : it.id === Item.AerialBomb ? took.bombs : took.repair;
      if (taken > 0) inventory.removeItem(it.id, taken);
    }
  }
  renderHelipadPanel();
}

function installHeliModule(id: number, item: number): void {
  if (inventory.countItem(item) < 1 || !hasBlueprint(item)) return;
  if (net.connected) {
    payWarfare([{ id: item, count: 1 }]);
    net.sendHeliModule(id, item);
  } else {
    const h = offlineVehicles.helicopters.get(id);
    if (!h) return;
    const module = item === Item.AuxiliaryTank ? 'auxTank'
      : item === Item.LongRangeTank ? 'longRangeTank'
        : item === Item.RopeWinch ? 'ropeWinch' : null;
    if (module && offlineVehicles.installModule(h, module)) {
      inventory.removeItem(item, 1);
      showNotice(`✓ ${ITEMS[item]?.name ?? 'Airframe module'} installed.`);
    }
  }
  renderHelipadPanel();
}

/**
 * The single place `mySeat` changes. Taking or leaving a seat has to move a
 * handful of presentation state together — the vehicle HUD, and the glazing on
 * the aircraft you are sitting inside — so routing every transition through one
 * function is what keeps the cockpit from being left half-configured after an
 * eject, a disconnect or a wreck.
 */
function setSeat(next: { id: number; seat: SeatKind } | null): void {
  if (next && !mySeat) {
    // Boarding: remember where we were looking so leaving the seat can put it
    // back exactly, then use the rear chase view so the helicopter remains
    // visible ahead of the camera while flying.
    preSeatView = view;
    view = View.Back;
  } else if (next && view === View.First) {
    // A seat transfer or late server correction must not bypass the exterior-
    // only camera rule.
    view = View.Back;
  } else if (!next && mySeat) {
    // Leaving the seat: restore the perspective from before boarding.
    view = preSeatView;
  }
  mySeat = next;
  if (next) myRope = null;
  // Pilot and gunner get identical full-range vertical mouse-look in every
  // camera view; leaving restores the usual on-foot pole margin.
  player.fullVerticalLook = next !== null;
  vehicleHud.setSeat(next?.seat ?? null);
  vehicleModels.setCockpitView(next && view === View.First ? next.id : null);
}

/** Wreck presentation, scaled to how the airframe was lost. */
function heliLossEffect(x: number, y: number, z: number, reason: HeliLossReason): void {
  vehicleModels.explode(x, y, z);
  audio.explosion(new THREE.Vector3(x, y, z));
  triggerEncounterShake(reason === 'flameout' ? 0.25 : 0.45, 0.045);
}

/** Ground impact is a separate beat from the engine bursting in flight. */
function heliCrashEffect(id: number, x: number, y: number, z: number): void {
  vehicleModels.crash(id, x, y, z);
  audio.explosion(new THREE.Vector3(x, y, z));
  const distance = player.pos.distanceTo(new THREE.Vector3(x, y, z));
  const strength = Math.max(0, 1 - distance / 90);
  if (strength > 0) triggerEncounterShake(0.8 * strength, 0.08 * strength);
}

/** Thrown clear of a bursting airframe: land where the sim says, carrying the
 *  impulse it gave us, so a crash flings the crew instead of parking them. */
function applyEject(
  x: number, y: number, z: number, vx: number, vy: number, vz: number,
  reason: HeliLossReason,
): void {
  setSeat(null);
  player.pos.set(x, y, z);
  player.vel.set(vx, vy, vz);
  player.fallDistance = 0;
  player.gliding = false;
  showNotice(reason === 'flameout'
    ? '⛽ Fuel starvation — you are thrown clear!'
    : reason === 'crash' ? '💥 Crash! You are thrown from the wreck!'
    : '💥 Ejected!');
}

function mountHeli(id: number, seat: SeatKind): void {
  if (net.connected) {
    net.sendHeliMount(id, seat);
  } else {
    const res = offlineVehicles.mount(id, 0, localFaction,
      { x: player.pos.x, y: player.pos.y, z: player.pos.z }, seat);
    if (!res.ok) { showNotice(`⛔ ${res.reason}`); return; }
    setSeat({ id, seat: res.seat });
    showNotice(res.seat === 'pilot'
      ? 'Pilot seat — WASD flies, Space climbs, Shift descends, right-click drops a bomb.'
      : 'Gunner seat — look around and fire your own weapon inside the forward arc.');
  }
  closeStrategicPanel();
}

function dismountHeli(): void {
  if (net.connected) { net.sendHeliDismount(); return; }
  const res = offlineVehicles.dismount(0);
  if (!res.ok) { showNotice(`⛔ ${res.reason}`); return; }
  setSeat(null);
  if (res.at) player.pos.set(res.at.x, res.at.y, res.at.z);
}

function toggleFastRope(): void {
  if (!mySeat || mySeat.seat !== 'pilot') return;
  const h = vehicleModels.snapshotOf(mySeat.id);
  if (!h?.ropeWinch) { showNotice('⛔ This airframe has no fast-rope winch.'); return; }
  if (net.connected) net.sendHeliRope('toggle');
  else if (!offlineVehicles.toggleRope(0)) { showNotice('⛔ Fast-rope control unavailable.'); return; }
  // The line takes a second to pay out, and the winch is under the floor where
  // the pilot cannot see it — so the deployment gets its own cue.
  const out = !h.ropeDeployed;
  audio.ropeDeploy(new THREE.Vector3(h.x, h.y, h.z));
  showNotice(out
    ? '🪢 Fast rope away — crew can transfer with F.'
    : 'Winch reeling the rope in.');
}

/** F transfers crew to a deployed rope; without one it remains ordinary exit. */
function transferOrDismount(): void {
  if (!mySeat) return;
  const h = vehicleModels.snapshotOf(mySeat.id);
  if (!h?.ropeDeployed) { dismountHeli(); return; }
  if (net.connected) { net.sendHeliRope('attach'); return; }
  const id = mySeat.id;
  const local = offlineVehicles.helicopters.get(id);
  if (!local) return;
  const from = { ...local.position };
  offlineVehicles.dismount(0);
  const attached = offlineVehicles.attachRope(0, localFaction, from, id);
  if (!attached.ok) { showNotice(`⛔ ${attached.reason}`); return; }
  setSeat(null);
  beginRope(id, attached.rider.progress);
}

function nearestRopeInReach(): HelicopterSnapshot | null {
  let best: HelicopterSnapshot | null = null, bestD = 2.25;
  for (const h of vehicleModels.snapshots()) {
    if (!h.ropeDeployed || h.dying > 0 || h.faction !== localFaction) continue;
    const top = h.y - 0.75;
    const p = Math.max(0, Math.min(1, (top - player.pos.y) / Math.max(1, h.ropeLength)));
    const d = Math.hypot(player.pos.x - h.x, player.pos.y - (top - p * h.ropeLength), player.pos.z - h.z);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

function tryAttachFastRope(): boolean {
  const h = nearestRopeInReach();
  if (!h) return false;
  if (net.connected) { net.sendHeliRope('attach'); return true; }
  const attached = offlineVehicles.attachRope(0, localFaction,
    { x: player.pos.x, y: player.pos.y, z: player.pos.z }, h.id);
  if (!attached.ok) { showNotice(`⛔ ${attached.reason}`); return true; }
  beginRope(h.id, attached.rider.progress);
  showNotice('Fast rope attached — S slides, W climbs, Space drops.');
  return true;
}

/**
 * Let go of the line.
 *
 * Two very different things share this button, and they should not feel the
 * same. Reaching the deck is an ARRIVAL: the fall is cancelled, boots thump,
 * dust goes up. Letting go at altitude is a CHOICE: you keep the aircraft's
 * momentum and whatever speed the slide had built, and the ground is now your
 * problem — which is exactly the tradeoff that makes riding the line all the
 * way down worth doing.
 */
function dropFastRope(mode: 'manual' | 'deck' = 'manual'): void {
  if (!myRope) return;
  const id = myRope.id;
  const slide = myRope.motion > 0 ? fastRopeSlideSpeed(myRope.held) : 0;
  if (net.connected) net.sendHeliRope('drop');
  else offlineVehicles.detachRope(0);
  myRope = null;
  vehicleHud.setRope(false);
  vehicleHud.setRopeTelemetry(0, 0);
  const ground = warfareGroundY(player.pos.x, player.pos.z);
  const drop = player.pos.y - (ground + 1);
  if (mode === 'deck' || drop <= 2.6) {
    player.vel.set(0, 0, 0);
    player.fallDistance = 0;
    audio.ropeLand(player.pos);
    particles.burst(player.pos.x, ground + 1.05, player.pos.z, 14, 0xbfae90, 3.4, 0.5,
      { gravity: 5, spread: 1.0, scale: 0.42 });
    triggerEncounterShake(0.18, 0.075);
    showNotice('✓ Boots down.');
  } else {
    // Inherit the airframe's travel so stepping off a moving helicopter throws
    // you along its track instead of dropping you out of a stationary hole.
    const vel = vehicleModels.velocityOf(id);
    player.vel.set(vel ? vel.x * 0.6 : 0, -Math.min(6, slide * 0.35), vel ? vel.z * 0.6 : 0);
    player.fallDistance = 0;
    audio.grappleRelease();
    showNotice(`Off the rope — ${drop.toFixed(0)} b to the ground.`);
  }
}

/**
 * FIELD DEPLOY: right-click the ground holding a Helicopter Airframe kit and it
 * assembles right there. The helipad remains a nice place to keep an aircraft,
 * but it is no longer the price of admission for every single flight.
 */
function tryDeployHelicopter(): boolean {
  const kit = inventory.selectedStack;
  if (!kit || kit.id !== Item.HelicopterKit) return false;
  if (!hasBlueprint(Item.HelicopterKit)) {
    warfarePlaceHint('Flight Certification is not authorized.');
    return true;
  }
  if (warfareTier(warfare, 'helicopter') < 1) {
    warfarePlaceHint('You have not authorized an airframe yet.');
    return true;
  }
  const eye = player.eyePosition;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const hit = raycastBlocks(world, eye, dir, 7);
  if (!hit) { warfarePlaceHint('Aim at the ground you want to assemble on.'); return true; }
  // The cell ABOVE whatever we hit is where the skids go down.
  const bx = hit.x, by = hit.y + 1, bz = hit.z;
  if (!isSolid(world.getBlock(bx, by - 1, bz))) {
    warfarePlaceHint('Assemble the airframe on solid, level ground.');
    return true;
  }
  for (let dy = 0; dy <= 3; dy++) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isSolid(world.getBlock(bx + dx, by + dy, bz + dz))) {
        warfarePlaceHint('Not enough clearance for the rotor here.');
        return true;
      }
    }
  }
  if (net.connected) {
    payWarfare([{ id: Item.HelicopterKit, count: 1 }]);
    net.sendHeliDeploy(bx, by, bz);
  } else {
    inventory.removeItem(Item.HelicopterKit, 1);
    offlineVehicles.spawn(authedName || 'You', localFaction, { x: bx, y: by, z: bz },
      Math.max(1, warfareTier(warfare, 'helicopter')));
  }
  audio.explosion(new THREE.Vector3(bx + 0.5, by, bz + 0.5));
  showNotice('🚁 Airframe assembled — right-click it to board.');
  return true;
}

/** The nearest boardable airframe to the player, if they are stood by one. */
function heliWithinBoarding(): HelicopterSnapshot | null {
  let best: HelicopterSnapshot | null = null;
  let bestD = HELI_BOARD_RANGE;
  for (const h of vehicleModels.snapshots()) {
    if (h.dying > 0) continue;
    if (isFaction(h.faction) && isFaction(localFaction) && h.faction !== localFaction) continue;
    const d = Math.hypot(h.x - player.pos.x, h.y - player.pos.y, h.z - player.pos.z);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/**
 * Walk up to a parked helicopter and right-click it to get in. Boarding used to
 * be reachable only through a helipad's panel, which is why the pad felt
 * mandatory; the aircraft itself is the obvious thing to interact with.
 */
function tryBoardHelicopter(): boolean {
  const h = heliWithinBoarding();
  if (!h) return false;
  // Sneak + right-click opens the servicing bay instead of climbing in, which
  // is how you refuel, rearm and retrofit without a helipad anywhere in sight.
  if (input.sneak) { openAirframePanel(h.id); return true; }
  if (h.pilot !== 0 && h.passenger !== 0) {
    showNotice('⛔ Both seats are taken.');
    return true;
  }
  // Pilot seat first, gunner if someone is already flying.
  mountHeli(h.id, h.pilot === 0 ? 'pilot' : 'passenger');
  return true;
}

// --- Placement ---------------------------------------------------------------------

let lastPlaceHint = -10;
/** Throttled explanation for a refused placement (never spams the notice line). */
function warfarePlaceHint(text: string): void {
  if (worldTimeLocal - lastPlaceHint < 1.5) return;
  lastPlaceHint = worldTimeLocal;
  showNotice(`⛔ ${text}`);
}

// --- Air targets (helicopters) -----------------------------------------------------

const _airOrigin = new THREE.Vector3();
const _airDir = new THREE.Vector3();
const _airPoint = new THREE.Vector3();


/**
 * Report a gunshot that lines up with an enemy helicopter — the authoritative
 * hit report, exactly like the PvP ranged path, with the projectile itself
 * still flying for the visuals.
 *
 * Three things it is careful about:
 *   EVERY PELLET   a shotgun that puts six pellets through a cabin should hurt
 *                  six times as much as one that puts one through, so the test
 *                  runs per pellet on the SAME directions the rounds were fired
 *                  with rather than once down the crosshair.
 *   TERRAIN        a helicopter behind a ridge is behind a ridge. The block
 *                  raycast runs first and anything closer than the hull wins.
 *   YOUR OWN RIDE  a gunner leaning out of the door sits inside their own
 *                  aircraft's hit sphere; shooting the airframe you are
 *                  strapped into is never what you meant.
 */
function reportAirTargetHit(gun: GunInfo, dirs: readonly THREE.Vector3[]): void {
  if (!dirs.length) return;
  _airOrigin.copy(player.eyePosition);
  const range = Math.min(gun.range, 140);
  const perRound = Math.max(1, Math.round(gun.damage));
  const mine = mySeat?.id ?? myRope?.id ?? 0;

  // Snapshot the candidates once — the same list serves every pellet.
  const targets: { id: number; pos: THREE.Vector3 }[] = [];
  for (const h of vehicleModels.snapshots()) {
    if (h.id === mine || h.dying > 0) continue;
    if (isFaction(h.faction) && h.faction === localFaction) continue;
    const p = vehicleModels.positionOf(h.id);
    if (p) targets.push({ id: h.id, pos: p });
  }
  if (!targets.length) return;

  /** Total damage and an impact point per airframe this trigger pull. */
  const landed = new Map<number, { damage: number; at: THREE.Vector3 }>();
  for (const dir of dirs) {
    _airDir.copy(dir).normalize();
    let bestId = 0;
    let bestT = Infinity;
    for (const target of targets) {
      const t = helicopterRayDistance(_airOrigin, _airDir, target.pos, range);
      if (t === null || t >= bestT) continue;
      bestT = t; bestId = target.id;
    }
    if (!bestId) continue;
    // The round has to actually get there: a block in the way stops it.
    const blocked = raycastBlocks(world, _airOrigin, _airDir, Math.min(bestT, range));
    if (blocked) continue;
    // Impact point: where the ray crosses the hull sphere, so the sparks and
    // the damage number land on the skin rather than at the rotor hub.
    _airPoint.copy(_airOrigin).addScaledVector(_airDir, bestT);
    const prev = landed.get(bestId);
    if (prev) prev.damage += perRound;
    else landed.set(bestId, { damage: perRound, at: _airPoint.clone() });
  }

  for (const [id, hit] of landed) {
    const snap = vehicleModels.snapshotOf(id);
    // The bar is authoritative, but the shooter should not wait a round trip to
    // learn their burst was the last one — a hull already at or below the
    // damage they just dealt reads as a kill marker straight away.
    const rawDamage = hit.damage;
    hit.damage = helicopterGunDamage(rawDamage);
    const killed = !!snap && snap.hp <= hit.damage;
    showHitmarker(hit.damage, killed);
    damageNumbers.spawn(hit.at.x, hit.at.y, hit.at.z, hit.damage,
      hitFlavor(hit.damage, killed, snap?.maxHp ?? 100));
    particles.burst(hit.at.x, hit.at.y, hit.at.z, killed ? 14 : 6,
      killed ? 0xffa03a : 0xffd98a, killed ? 5 : 2.6, killed ? 0.55 : 0.3,
      { gravity: 3.4, spread: 0.5, scale: killed ? 0.5 : 0.34 });
    vehicleModels.hitFlash(id, hit.damage);
    audio.heliHit(hit.at, hit.damage >= 12 || killed);
    if (net.connected) {
      // The server caps a single report at the ranged ceiling, so a volley that
      // legitimately beat that (a shotgun with every pellet in the cabin) goes
      // as several reports rather than being quietly clipped to one round.
      let left = rawDamage;
      for (let i = 0; i < 6 && left > 0; i++) {
        const chunk = Math.min(left, RANGED_MAX_DAMAGE);
        net.sendHeliHit(id, chunk);
        left -= chunk;
      }
    } else {
      applyOfflineVehicleEvents(offlineVehicles.damageFromGun(id, rawDamage));
    }
  }
}

// --- Per-frame upkeep ---------------------------------------------------------------

/** Drive the offline sim, the models, the seat camera and the pilot input. */
function updateWarfare(dt: number): void {
  // Offline: tick the authoritative simulation locally.
  if (!net.connected) {
    applyOfflineVehicleEvents(offlineVehicles.tick(dt));
    vehicleModels.sync(offlineVehicles.snapshot(), offlineVehicles.bombSnapshots());
  }
  // The camera drives how the overhead hull bars are sized and faded, so the
  // same one the frame will render through is handed over here.
  vehicleModels.setLocalRide(mySeat?.id ?? myRope?.id ?? null);
  let hovered: number | null = null;
  if (input.locked && !player.dead) {
    camera.getWorldDirection(_airDir);
    let nearest = 170;
    for (const h of vehicleModels.snapshots()) {
      if (h.dying > 0 || h.id === mySeat?.id || h.id === myRope?.id) continue;
      const pos = vehicleModels.positionOf(h.id);
      if (!pos) continue;
      const distance = helicopterRayDistance(player.eyePosition, _airDir, pos, nearest);
      if (distance === null) continue;
      if (raycastBlocks(world, player.eyePosition, _airDir, distance)) continue;
      nearest = distance; hovered = h.id;
    }
  }
  vehicleModels.setHovered(hovered);
  vehicleModels.update(dt, view === View.First ? camera : viewCamera);
  heliBombCooldown = Math.max(0, heliBombCooldown - dt);
  if (openHelipad) refreshAirframeLive();

  if (!mySeat) {
    if (!myRope) {
      if (vehicleHud.active) vehicleHud.setSeat(null);
      return;
    }
    const heli = vehicleModels.snapshotOf(myRope.id);
    if (!heli) { myRope = null; vehicleHud.setRope(false); return; }
    const motion = (input.back ? 1 : 0) - (input.forward ? 1 : 0);
    const ropeLen = Math.max(1, heli.ropeLength);
    const wasProgress = myRope.progress;
    // The slide ramp runs on the client too — the sim's own curve, so the
    // shake, the wind and the sparks below are always describing the speed the
    // server is actually moving you at.
    myRope.held = fastRopeHeld(myRope.held, motion, dt);
    if (!net.connected) {
      const rider = offlineVehicles.ropeRider(0);
      if (!rider) { myRope = null; vehicleHud.setRope(false); return; }
      myRope.progress = rider.progress;
      myRope.authoritativeProgress = rider.progress;
      myRope.motion = rider.motion;
      myRope.held = rider.held;
    } else {
      // Predict the same asymmetric climb/slide motion as the server, then
      // softly reconcile. This removes the old 20 Hz vertical hard-snapping.
      const delta = fastRopeProgressDelta(motion, dt, ropeLen, myRope.held);
      myRope.progress = Math.max(0, Math.min(1, myRope.progress + delta));
      myRope.authoritativeProgress = Math.max(0, Math.min(1,
        myRope.authoritativeProgress + delta));
      const correction = 1 - Math.exp(-10 * dt);
      myRope.progress += (myRope.authoritativeProgress - myRope.progress) * correction;
      myRope.motion = motion;
    }
    const at = vehicleModels.ropeWorldPosition(myRope.id, myRope.progress);
    if (!at) { myRope = null; vehicleHud.setRope(false); return; }
    player.pos.copy(at); player.vel.set(0, 0, 0); player.fallDistance = 0;

    // --- Descent feel ---------------------------------------------------------
    // Everything here reads the SAME slide ramp the simulation is running, so
    // the noise, the shake and the sparks wind up exactly as you pick up speed
    // and stop dead the instant you grab back on.
    const rate = dt > 0
      ? (myRope.progress - wasProgress) * ropeLen / dt : 0;
    myRope.descent += (rate - myRope.descent) * Math.min(1, dt * 8);
    const sliding = motion > 0 && myRope.progress < 0.999;
    const ramp = sliding
      ? THREE.MathUtils.clamp(
        (fastRopeSlideSpeed(myRope.held) - FAST_ROPE_SLIDE_SPEED) /
        (FAST_ROPE_SLIDE_MAX - FAST_ROPE_SLIDE_SPEED), 0, 1)
      : 0;
    if (sliding) {
      // A constant low rumble that grows into a real shake at full chat.
      triggerEncounterShake(0.12, 0.012 + ramp * 0.05);
      myRope.wind -= dt;
      if (myRope.wind <= 0) {
        myRope.wind = 0.16;
        audio.ropeSlide(ramp);
      }
      myRope.spark -= dt;
      if (myRope.spark <= 0) {
        myRope.spark = 0.05;
        // Friction off the gloves, thrown UP past you as you drop.
        particles.burst(at.x, at.y + 1.35, at.z, 1 + Math.round(ramp * 2),
          ramp > 0.6 ? 0xffb347 : 0xd8c090, 1.2 + ramp * 2.2, 0.26,
          { gravity: -1.6, spread: 0.22, scale: 0.16 + ramp * 0.1 });
      }
    } else {
      myRope.wind = 0;
      myRope.spark = 0;
    }

    const riderGround = warfareGroundY(at.x, at.z);
    const above = at.y - (riderGround + 1);
    vehicleHud.setRope(true);
    vehicleHud.setRopeTelemetry(myRope.progress, myRope.descent);
    vehicleHud.update(dt, heli, 0, above, tierLabel(heli.tier));
    ropeInputAccum += dt;
    if (ropeInputAccum >= 1 / 20) {
      ropeInputAccum = 0;
      if (net.connected) net.sendHeliRope('move', motion);
      else offlineVehicles.setRopeMotion(0, motion);
    }
    // Run out of line with the deck under you and you are simply THERE. Making
    // a player press a second button to finish an insertion they have already
    // committed to is the least satisfying possible end to the ride. It takes
    // holding the slide, so someone who attached at the bottom of the line to
    // climb UP is never bounced straight back off it.
    if (motion > 0 && myRope.progress >= 0.999 && above <= 2.6) {
      dropFastRope('deck');
      prevRopeJump = input.jump;
      return;
    }
    const jump = input.jump;
    if (jump && !prevRopeJump) dropFastRope();
    prevRopeJump = jump;
    return;
  }
  const heli = vehicleModels.snapshotOf(mySeat.id);
  if (!heli) { setSeat(null); return; }

  // Ride the seat: the player's body follows the airframe exactly (the server
  // owns the flight, so this is pure presentation of an authoritative pose).
  const seatPos = vehicleModels.seatWorldPosition(mySeat.id, mySeat.seat);
  if (seatPos) {
    player.pos.set(seatPos.x, seatPos.y, seatPos.z);
    player.vel.set(0, 0, 0);
    player.fallDistance = 0;
  }

  // The camera was placed from the pose this airframe had at the START of the
  // frame, several hundred lines ago — but the pose has just moved. Re-seating
  // the camera on the CURRENT pose is what stops the world sliding a frame
  // behind the aircraft carrying it, which is most of the judder you feel from
  // the cockpit even when the aircraft itself is drawn perfectly smoothly.
  refreshSeatCamera();

  // Instruments. Airspeed is differentiated from the snapshot stream (the wire
  // carries a pose, not a velocity) and smoothed so the needle does not buzz.
  const rawSpeed = heliAirspeed(heli);
  heliSpeedSmoothed += (rawSpeed - heliSpeedSmoothed) * Math.min(1, dt * 6);
  vehicleHud.update(dt, heli, heliSpeedSmoothed,
    heli.y - warfareGroundY(heli.x, heli.z), tierLabel(heli.tier));
  // Remove our own glazing/interior only in cockpit view. Outside observers
  // continue to see the complete aircraft in every view.
  vehicleModels.setCockpitView(view === View.First ? mySeat.id : null);

  if (mySeat.seat !== 'pilot') return;
  // Pilot input at the transform rate — WASD horizontal, Space/Shift vertical,
  // camera yaw steers.
  // 30 Hz, comfortably above the server's 20 Hz flight tick: a control change
  // then waits at most a third of a tick to be picked up instead of a whole
  // one, which is the cheapest latency there is to buy back.
  heliInputAccum += dt;
  if (heliInputAccum >= 1 / 30) {
    heliInputAccum = 0;
    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const side = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const lift = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
    const seq = heliInputSeq++;
    const heading = viewYawToHeliYaw(player.yaw);
    if (net.connected) net.sendHeliInput(fwd, side, lift, heading, seq);
    else offlineVehicles.setInput(0, { forward: fwd, strafe: side, lift, yaw: heading, seq });
  }
}

/**
 * Put the camera back on the seat after the airframe has been advanced for this
 * frame. Mirrors what updateCamera() does for the seat case, and re-applies the
 * shake this frame already added, so nothing is lost by running later. The two
 * cameras that deliberately take the whole screen — a
 * vault cutscene — are never overridden.
 */
function refreshSeatCamera(): void {
  if (!mySeat || vaultCinematic.frame) return;
  const eye = vehicleModels.cockpitWorldPosition(mySeat.id, mySeat.seat);
  if (!eye) return;
  camera.position.copy(eye);
  camera.position.x += shakeOffset.x;
  camera.position.y += shakeOffset.y;
  if (view !== View.First) {
    updateViewCamera();
    viewCamera.position.x += shakeOffset.x;
    viewCamera.position.y += shakeOffset.y;
  }
}

/**
 * Airspeed of a ridden airframe, differentiated from consecutive snapshots. The
 * wire carries a pose rather than a velocity, so this is the only honest way to
 * put a speed on the instrument panel.
 */
const _heliPrevPos = new THREE.Vector3();
let _heliPrevId = 0;
let _heliPrevTime = -1;
function heliAirspeed(snap: HelicopterSnapshot): number {
  const now = worldTimeLocal;
  if (snap.id !== _heliPrevId || _heliPrevTime < 0 || now <= _heliPrevTime) {
    _heliPrevId = snap.id;
    _heliPrevTime = now;
    _heliPrevPos.set(snap.x, snap.y, snap.z);
    return heliSpeedSmoothed;
  }
  const gap = now - _heliPrevTime;
  // Ignore sub-frame gaps: dividing a rounded position delta by a tiny dt
  // produces enormous nonsense readings.
  if (gap < 0.05) return heliSpeedSmoothed;
  const speed = _heliPrevPos.distanceTo(new THREE.Vector3(snap.x, snap.y, snap.z)) / gap;
  _heliPrevTime = now;
  _heliPrevPos.set(snap.x, snap.y, snap.z);
  return speed;
}

/** Is the gunner looking inside the airframe's forward firing arc? Mirrors
 *  VehicleSim.passengerCanFire so the client and the server agree. */
function gunnerArcClear(): boolean {
  if (!mySeat || mySeat.seat !== 'passenger') return true;
  const snap = vehicleModels.snapshotOf(mySeat.id);
  if (!snap) return true;
  const aim = viewYawToHeliYaw(player.yaw);
  const rel = Math.atan2(Math.sin(aim - snap.yaw), Math.cos(aim - snap.yaw));
  return Math.abs(rel) <= PASSENGER_ARC;
}

/** The pilot's right-click drops a bomb rather than placing a block. */
function tryDropBomb(): boolean {
  if (!mySeat || mySeat.seat !== 'pilot' || heliBombCooldown > 0) return false;
  heliBombCooldown = 0.25;   // input debounce only; the real cooldown is server-side
  const snap = vehicleModels.snapshotOf(mySeat.id);
  // Honest feedback for a rack that cannot answer: the server silently drops a
  // release it refuses, which made an empty rack feel like a broken button.
  if (snap && snap.maxBombs === 0) {
    showNotice('⛔ This airframe has no bomb rack.');
    return true;
  }
  if (snap && snap.bombs <= 0) {
    showNotice('⛔ Bomb rack empty — land and rearm.');
    return true;
  }
  if (net.connected) net.sendHeliBomb();
  else applyOfflineVehicleEvents(offlineVehicles.dropBomb(0));
  return true;
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

// --- Title-screen world status ----------------------------------------------
// The foot of the title screen answers the two questions you actually have
// before pressing Play: which side am I, and when is the next war? Both are
// live server state (the welcome carries a war snapshot, and `war` messages
// keep it current), so this is reporting, not decoration — it stays hidden
// until sign-in rather than inventing something to say.
let titleStatusTimer = 0; // repaint the strip a few times a second, not every frame
const titleStatusEl = document.getElementById('title-status') as HTMLDivElement;
const titleSideEl = document.getElementById('tstat-side') as HTMLElement;
const titleWarCell = document.getElementById('tstat-war-cell') as HTMLElement;
const titleWarKeyEl = document.getElementById('tstat-war-k') as HTMLElement;
const titleWarEl = document.getElementById('tstat-war') as HTMLElement;
const titleWinsEl = document.getElementById('tstat-wins') as HTMLElement;
function updateTitleStatus(): void {
  if (!titleStatusEl) return;
  if (!authed) { titleStatusEl.hidden = true; return; }
  titleStatusEl.hidden = false;
  const side = titleSideEl.querySelector('span');
  if (side) side.textContent = net.connected ? factionName(localFaction) : 'Single player';
  titleSideEl.style.setProperty('--side-color',
    net.connected ? factionCss(localFaction) : '#9a9a9a');
  if (!net.connected) {
    titleWarCell.classList.remove('live');
    titleWarKeyEl.textContent = 'Wars';
    titleWarEl.textContent = 'Offline — no wars';
    titleWinsEl.textContent = '—';
    return;
  }
  titleWarCell.classList.toggle('live', warActiveNow);
  titleWarKeyEl.textContent = warActiveNow ? 'War in progress' : 'Next war';
  titleWarEl.textContent = warActiveNow
    ? `${formatClock(warLeft)} left`
    : warNextIn > 0 ? `in ${formatClock(warNextIn)}` : 'Not scheduled';
  const a = FACTIONS[0], b = FACTIONS[1];
  titleWinsEl.innerHTML =
    `<span style="color:${factionCss(a.id)}">${a.name} ${warWins[a.id] ?? 0}</span>` +
    `<span style="color:var(--ink-mute)">·</span>` +
    `<span style="color:${factionCss(b.id)}">${b.name} ${warWins[b.id] ?? 0}</span>`;
}

/** The live war border side length (full world outside a war). */
function currentWarBorder(): number {
  return warActiveNow ? warBorderAt(warLeft, warDur, WORLD_BORDER) : WORLD_BORDER;
}

/** Standing in a vault whose boss encounter is running. The sealed arena
 *  outranks the war border for exactly this span (server: `liveArenaFor`). */
function inLiveVaultFight(): boolean {
  if (!curVault || !encounterSnapshot) return false;
  const s = encounterSnapshot.status;
  return s === 'intro' || s === 'active' || s === 'reset_grace';
}

/** The border dragged us in from somewhere the old Y made sense and here it
 *  does not. Stand on top of this column instead of inside it — without this
 *  an underground player ends up permanently embedded in solid rock, unable to
 *  move in any direction, because the clamp bypasses collision entirely. */
function surfaceAfterBorderPull(): void {
  const surface = world.terrain.height(
    Math.floor(player.pos.x), Math.floor(player.pos.z)) + 1;
  if (player.pos.y >= surface) return; // already above ground — leave them be
  player.pos.y = surface;
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  showNotice('⚠️ The war border closed over you — pulled up to the surface.');
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
    `<span style="color:#ff6a6a">${iconSvg('swords')} WAR · ${formatClock(warLeft)}</span> ` +
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
  // The hook has a control scheme, not just a button, so it gets taught here.
  const controls = def.kind === 'grapple'
    ? (grappleStage
      ? 'SPACE or LEFT-CLICK — let go and launch · WASD steers the swing'
      : 'LEFT-CLICK to fire · SPACE mid-swing to launch off it')
    : 'left-click to use';
  gadgetTipEl.innerHTML =
    `<div style="color:#ffd84a;font-size:13px">${def.name}</div>` +
    `<div style="color:#cdd6ee;font-size:11px;text-shadow:none">${def.desc}</div>` +
    `<div style="color:#7f8db0;font-size:10px;text-shadow:none">${controls}</div>`;
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
  // Mid-swing the button means RELEASE, not re-fire, so it cannot be gated by
  // the cooldown of the shot that put you on the rope in the first place.
  if (def.kind === 'grapple' && grappleStage) { endGrapple(true); return; }
  if (def.kind === 'grapple' && combatSecondsLeft() > 0) {
    showNotice(`Grappling Hook blocked in combat (${Math.ceil(combatSecondsLeft())}s).`);
    return;
  }
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
      // A miss costs nothing: the cooldown only starts once the hook is away.
      if (!fireGrapple(def.radius ?? 48)) {
        showNotice(`Nothing to hook — aim at a surface ${GRAPPLE_MIN_RANGE}+ blocks away.`);
        return;
      }
      gadgetCd.use(def.item, worldTimeLocal);
      break;
    }
    case 'jump': {
      // A second pad high in open air would turn a one-use jump into unlimited
      // vertical flight. Require a real block in this exact column no more than
      // ten blocks below the player's feet.
      let supportY = -1;
      const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
      for (let y = Math.min(255, Math.floor(player.pos.y) - 1); y >= 0; y--) {
        if (isSolid(world.getBlock(bx, y, bz))) { supportY = y; break; }
      }
      if (supportY < 0 || player.pos.y - (supportY + 1) > 10) {
        showNotice('Bounce Pad blocked — you are more than 10 blocks above solid ground.');
        return;
      }
      gadgetCd.use(def.item, worldTimeLocal); consume();
      player.vel.y = 36; // ~20-block vertical launch (gravity 32)
      player.onGround = false;
      player.momentumTime = Math.max(player.momentumTime, GRAPPLE_MOMENTUM);
      player.fallDistance = 0;
      jumpImmuneUntil = worldTimeLocal + 7; // no fall damage from this leap
      held.gadgetAction('bounce');
      heldSwingSeq = (heldSwingSeq + 1) & 0xffff;
      audio.bouncePad();
      triggerEncounterShake(0.22, 0.035);
      particles.burst(player.pos.x, player.pos.y + 0.08, player.pos.z,
        24, 0x75ff9b, 7, 0.75, { gravity: 7, spread: 1.15, scale: 1.2 });
      particles.burst(player.pos.x, player.pos.y + 0.12, player.pos.z,
        10, 0xffffff, 10, 0.42, { gravity: 9, spread: 0.7, scale: 0.65 });
      showNotice('BOOOOING! Bounce Pad launched you!');
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
      net.sendEdit(x, y, z, Block.Turret); // the server claims it for us
      turretStates.set(`${x},${y},${z}`, newTurret(net.connected ? net.username : 'You', localFaction));
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

let prevJumpForTrap = false;
let wireHurtTimer = 0;
const trapHudEl = document.createElement('div');
trapHudEl.className = 'mc-font';
trapHudEl.style.cssText =
  'position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);z-index:23;' +
  'display:none;padding:10px 20px;border-radius:8px;font-size:17px;color:#fff;' +
  'background:rgba(60,10,10,0.8);border:2px solid #ff6a3d;text-align:center;';
app.appendChild(trapHudEl);
// Lingering effect chips (bleeding, poisoned, on fire…) above the hotbar.
const effectChipsEl = document.createElement('div');
effectChipsEl.className = 'mc-font';
effectChipsEl.style.cssText =
  'position:absolute;bottom:118px;left:50%;transform:translateX(-50%);z-index:12;display:flex;gap:6px;' +
  'pointer-events:none;font-size:11px;';
app.appendChild(effectChipsEl);
let effectChipsKey = '';

/** Which holding trap the player is standing in (Air if none). */
function trapUnderfoot(): number {
  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  const feet = world.getBlock(bx, Math.floor(player.pos.y + 0.1), bz);
  if (feet === Block.Tar || feet === Block.BarbedWire) return feet;
  const under = world.getBlock(bx, Math.floor(player.pos.y - 0.05), bz);
  if (under === Block.Tar) return under;
  return Block.Air;
}

/** A trap (or anything) put a status effect on us: HUD line + sound. */
function applyStatusEffect(kind: import('./traps').EffectKind, seconds: number): void {
  if (player.dead || arenaActive) return;
  const fresh = !statusFx.has(kind);
  statusFx.add(kind, seconds);
  if (!fresh) return;
  if (kind === 'pinned') { audio.hurt(); showNotice('🪤 A bear trap snapped shut on your leg!'); }
  else if (kind === 'netted') showNotice('🕸 Netted! You can\'t move or fight for a moment.');
  else if (kind === 'stun') showNotice('⚡ Stunned!');
  else if (kind === 'burning') showNotice('🔥 You\'re on fire!');
  else if (kind === 'slow') showNotice('☠ Poison dart — you\'re slowed!');
}

/** Status effects + the passive holding blocks (tar, barbed wire). */
function updateTrapGrip(dt: number): void {
  wireHurtTimer = Math.max(0, wireHurtTimer - dt);
  player.pinned = false;
  player.trapSlow = 1;
  player.trapNoJump = false;
  if (arenaActive || player.dead || localMode !== 'survival' || player.noclip) {
    statusFx.clear(); prevJumpForTrap = false; trapHudEl.style.display = 'none';
    effectChipsEl.replaceChildren(); effectChipsKey = '';
    return;
  }
  // Damage over time is the server's job online; offline we are the authority.
  const dot = statusFx.update(dt);
  if (dot > 0 && !net.connected) player.damage(dot);
  if (statusFx.has('burning') && Math.random() < dt * 8) {
    particles.burst(player.pos.x, player.pos.y + 0.9, player.pos.z, 1, 0xff7a20, 1, 0.5, { gravity: -2, scale: 0.5 });
  }

  const jumpNow = input.jump;
  const pressed = jumpNow && !prevJumpForTrap;
  prevJumpForTrap = jumpNow;
  let hud = '';
  if (statusFx.has('pinned')) {
    // Struggle out: each fresh jump press prises the jaws a little wider.
    if (pressed && statusFx.struggle()) showNotice('🪤 You wrenched the trap open!');
    else hud = `${iconSvg('trap')} <b>CAUGHT IN A BEAR TRAP</b><br>Mash <b>JUMP</b> to break free — ${statusFx.strugglesLeft()} more`;
  } else if (statusFx.has('netted')) {
    hud = `<b>NETTED</b><br>${statusFx.remaining('netted').toFixed(1)}s`;
  } else if (statusFx.has('stun')) {
    hud = `<b>STUNNED</b>`;
  }
  if (statusFx.rooted()) { player.pinned = true; player.trapNoJump = true; }
  player.trapSlow = Math.min(player.trapSlow, statusFx.speedMult());
  if (hud) { trapHudEl.innerHTML = hud; trapHudEl.style.display = 'block'; }
  else trapHudEl.style.display = 'none';

  // Lingering effect chips.
  const chips = statusFx.active.filter(k => k === 'bleed' || k === 'slow' || k === 'burning');
  const key = chips.map(k => `${k}${Math.ceil(statusFx.remaining(k))}`).join(',');
  if (key !== effectChipsKey) {
    effectChipsKey = key;
    effectChipsEl.replaceChildren(...chips.map(k => {
      const chip = document.createElement('span');
      chip.textContent = `${EFFECT_LABELS[k]} ${Math.ceil(statusFx.remaining(k))}s`;
      chip.style.cssText = `padding:3px 8px;border-radius:5px;background:rgba(0,0,0,.6);color:${EFFECT_COLORS[k]};` +
        `border:1px solid ${EFFECT_COLORS[k]};text-shadow:none;`;
      return chip;
    }));
  }

  const trap = trapUnderfoot();
  // Tar: a crawl, and no jumping out of the pit.
  if (trap === Block.Tar) {
    player.trapSlow = Math.min(player.trapSlow, 0.32);
    player.trapNoJump = true;
    return;
  }
  // Barbed wire: slow AND bleeding while you push through it.
  if (trap === Block.BarbedWire) {
    player.trapSlow = Math.min(player.trapSlow, 0.45);
    if (wireHurtTimer <= 0) {
      wireHurtTimer = 0.8;
      player.damage(2);
      particles.burst(player.pos.x, player.pos.y + 0.5, player.pos.z, 3, 0xb01e1e, 1.2, 0.4, { scale: 0.4 });
    }
  }
}

// --- Trapcraft: local plumbing ------------------------------------------------

/** The local player as a trap target. */
function meAsTarget(): TrapTarget {
  return { id: 'me', name: net.connected ? net.username : 'You', faction: localFaction,
    x: player.pos.x, y: player.pos.y, z: player.pos.z };
}

/** Mobs the offline trap sim can see this frame, by target id. */
const trapMobs = new Map<string, Mob>();
/** Targets the offline trap sim may catch: us (when catchable) and nearby mobs. */
function localTrapTargets(): TrapTarget[] {
  const out: TrapTarget[] = [];
  if (arenaActive) return out;
  if (!player.dead && localMode === 'survival' && !player.noclip) out.push(meAsTarget());
  trapMobs.clear();
  if (!net.connected) {
    mobs.list.forEach((m, i) => {
      if (Math.abs(m.pos.x - player.pos.x) > 48 || Math.abs(m.pos.z - player.pos.z) > 48) return;
      const id = `mob:${i}`;
      trapMobs.set(id, m);
      out.push({ id, name: '', faction: NO_FACTION, x: m.pos.x, y: m.pos.y, z: m.pos.z });
    });
  }
  return out;
}

/** Generated spikes (vault floors) have no trap entity: they keep the classic
 *  rule — anyone standing on them is pricked — reported as self-damage. */
let legacySpikeTimer = 0;
function legacySpikes(dt: number): void {
  legacySpikeTimer = Math.max(0, legacySpikeTimer - dt);
  if (player.dead || localMode !== 'survival' || player.noclip || !player.onGround) return;
  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  const by = Math.floor(player.pos.y - 0.05);
  if (world.getBlock(bx, by, bz) !== Block.SpikeTrap || trapField.has(bx, by, bz)) return;
  if (legacySpikeTimer > 0) return;
  player.damage(3);
  legacySpikeTimer = 0.55;
}

/** Radius within which hidden enemy traps show up for us. */
function trapRevealRadius(): number {
  if (inventory.selectedStack?.id === Item.TrapDetector) return 10;
  return player.sneaking ? 3 : 0;
}

/** Is this trap cell invisible to us right now (hidden hostile trap)? */
function trapHiddenAt(x: number, y: number, z: number): boolean {
  const s = trapField.get(x, y, z);
  if (!s || !s.owner || s.arm > 0 || !trapConcealed(s.kind)) return false;
  if (trapFriendly(s, net.connected ? net.username : 'You', localFaction)) return false;
  return Math.hypot(x + 0.5 - player.pos.x, y + 0.5 - player.pos.y, z + 0.5 - player.pos.z) > trapRevealRadius();
}

/** Sound + particles + model animation for one trap event. */
function trapFxLocal(
  x: number, y: number, z: number, kind: TrapKind, what: TrapFxWhat, tx?: number, ty?: number, tz?: number,
): void {
  trapModels.fx(x, y, z, what, tx, ty, tz);
  const pos = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
  const s = trapField.get(x, y, z);
  const mine = !!s && trapFriendly(s, net.connected ? net.username : 'You', localFaction);
  // Don't let a hidden trap give itself away by sound before it actually bites.
  if (what === 'arm') { if (mine) audio.trap('arm', pos); return; }
  if (what === 'reset') return;
  if (what === 'prime') { audio.trap('beep', pos); return; }
  switch (kind) {
    case TrapKind.Spike: audio.trap('spike', pos); break;
    case TrapKind.BearTrap: audio.trap('snap', pos); break;
    case TrapKind.ShockPlate:
      audio.trap('zap', pos);
      particles.burst(pos.x, pos.y, pos.z, 14, 0x8fd3ff, 3, 0.3, { gravity: 0, scale: 0.35 });
      break;
    case TrapKind.Landmine:
      // Online the server's `blast` message draws the explosion.
      if (!net.connected) { particles.explosion(pos.x, pos.y, pos.z); audio.explosion(pos); }
      break;
    case TrapKind.Claymore:
      particles.explosion(pos.x, pos.y, pos.z);
      audio.explosion(pos);
      break;
    case TrapKind.FlameJet: audio.trap('whoosh', pos); break;
    case TrapKind.DartLauncher: audio.trap('dart', pos); break;
    case TrapKind.NetLauncher: audio.trap('net', pos); break;
    case TrapKind.AlarmBell: audio.trap('bell', pos); break;
    case TrapKind.FallTrap: case TrapKind.WallTrap: audio.trap('slam', pos); break;
    case TrapKind.Tripwire: if (mine) audio.trap('laser', pos); break;
    case TrapKind.PressurePlate: case TrapKind.Timer: if (mine) audio.trap('click', pos); break;
    case TrapKind.MotionSensor: if (mine) audio.trap('beep', pos); break;
    default: break;
  }
}

/** Offline authority: apply a pure trap result to the local world + player. */
function applyTrapResultLocal(res: TrapTickResult): void {
  for (const w of res.writes) world.applyRemoteEdit(w.x, w.y, w.z, w.block);
  for (const f of res.fx) trapFxLocal(f.x, f.y, f.z, f.kind, f.what, f.tx, f.ty, f.tz);
  for (const h of res.hits) {
    const mob = trapMobs.get(h.target);
    if (mob) {
      const hold = h.effects.find(e => e.kind === 'pinned' || e.kind === 'netted' || e.kind === 'stun');
      const dot = h.effects.some(e => e.kind === 'bleed' || e.kind === 'burning') ? 3 : 0;
      mobs.trapHit(mob, h.damage + dot, hold ? hold.seconds : 0);
      continue;
    }
    if (h.target !== 'me') continue;
    const wasAlive = !player.dead;
    player.damage(h.damage);
    if (h.kx || h.kz) { player.vel.x += h.kx * 6; player.vel.y += h.ky * 6; player.vel.z += h.kz * 6; }
    for (const e of h.effects) applyStatusEffect(e.kind, e.seconds);
    if (wasAlive && player.dead) {
      showNotice(`You were ${TRAP_VERBS[h.kind] ?? 'caught'} by ${h.owner ? `${h.owner}'s` : 'a'} ${TRAP_NAMES[h.kind]}.`);
    }
  }
  for (const b of res.blasts) {
    const at = new THREE.Vector3(b.x, b.y, b.z);
    particles.explosion(at.x, at.y, at.z);
    audio.explosion(at);
    const me = meAsTarget();
    if (!player.dead && ownerHostile(b.owner, b.faction, me)) {
      const dmg = falloffDamage(b.damage, Math.hypot(me.x - b.x, me.y - b.y, me.z - b.z), b.radius);
      if (dmg > 0) player.damage(dmg);
    }
    if (!net.connected) {
      for (const m of [...mobs.list]) {
        const dmg = falloffDamage(b.damage, m.pos.distanceTo(at), b.radius);
        if (dmg > 0) mobs.trapHit(m, dmg);
      }
    }
    destroyMachinesNear(at, b.crater);
  }
  for (const a of res.alarms) {
    audio.trap('bell', new THREE.Vector3(a.x + 0.5, a.y + 0.5, a.z + 0.5));
    showNotice(`🔔 Alarm at ${a.x}, ${a.z}!`);
  }
}

// --- Defusing: sneak + hold USE on a revealed enemy trap ---------------------
const DEFUSE_SECONDS = 2.5;
let defuseAt: { x: number; y: number; z: number; t: number; px: number; pz: number; hp: number } | null = null;

function beginDefuse(x: number, y: number, z: number): void {
  defuseAt = { x, y, z, t: 0, px: player.pos.x, pz: player.pos.z, hp: player.health };
  audio.trap('click', new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
}

function updateDefuse(dt: number): void {
  if (!defuseAt) return;
  const d = defuseAt;
  const moved = Math.hypot(player.pos.x - d.px, player.pos.z - d.pz) > 0.6;
  if (player.dead || !player.sneaking || moved || player.health < d.hp || !input.rightDown ||
      !isTrapBlock(world.getBlock(d.x, d.y, d.z))) {
    defuseAt = null;
    trapHudEl.style.display = 'none';
    if (!player.dead) showNotice('Defuse abandoned.');
    return;
  }
  d.t += dt;
  const pct = Math.min(100, Math.round(d.t / DEFUSE_SECONDS * 100));
  trapHudEl.innerHTML = `${iconSvg('trap')} <b>DEFUSING</b> ${pct}%<br>Stay still and keep sneaking`;
  trapHudEl.style.display = 'block';
  if (d.t < DEFUSE_SECONDS) return;
  defuseAt = null;
  trapHudEl.style.display = 'none';
  if (net.connected) { net.sendTrapDefuse(d.x, d.y, d.z); return; }
  const block = world.getBlock(d.x, d.y, d.z);
  const s = trapField.remove(d.x, d.y, d.z);
  world.applyRemoteEdit(d.x, d.y, d.z, Block.Air);
  const item = block === Block.LeverOn ? Block.Lever : block === Block.FallTrapOpen ? Block.FallTrap
    : block === Block.WallTrapUp ? Block.WallTrap : block;
  const left = inventory.add(item, 1);
  if (left > 0) spillAtPlayer([{ id: item, count: left }]);
  showNotice(`Defused a ${s ? TRAP_NAMES[s.kind] : 'trap'}.`);
}

interaction.hiddenAt = (x, y, z, id) => TRAP_MODEL_BLOCKS.has(id) && trapHiddenAt(x, y, z);
interaction.onTrapUse = (x, y, z, sneaking) => {
  const block = world.getBlock(x, y, z);
  if (!trapField.has(x, y, z)) trapField.place(x, y, z, block); // legacy: ownerless
  const s = trapField.get(x, y, z);
  if (!s) return false;
  const friendly = trapFriendly(s, net.connected ? net.username : 'You', localFaction);
  if (sneaking && !friendly) {
    if (Math.hypot(x + 0.5 - player.pos.x, y + 0.5 - player.pos.y, z + 0.5 - player.pos.z) > 3.5) {
      showNotice('Get closer to defuse it.');
      return true;
    }
    beginDefuse(x, y, z);
    return true;
  }
  if (!friendly) return false;
  openTrapPanel(x, y, z);
  return true;
};

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
      `${iconSvg('flag')} <b>You are carrying the ${factionName(mine.faction)} flag!</b><br>` +
      `Run it to your own flag — <b>${Math.round(d)}m</b> away. Die and it goes home.`,
      factionCss(mine.faction));
    return false; // carrying doesn't consume clicks — you still need to fight
  }

  const target = flagModels.plantedInReach(localFaction, px, pz, FLAG_REACH);
  if (!target) { flagHudEl.style.display = 'none'; return false; }

  if (!flagState.breakable) {
    showFlagHud(
      `${iconSvg('shield')} The ${factionName(target.faction)} flag is <b>protected</b> — it can't be taken right now.`,
      '#7a8090');
    return false;
  }
  const pct = Math.round(100 - (target.hp / FLAG_MAX_HP) * 100);
  showFlagHud(
    `${iconSvg('flag')} <b>Hold left-click</b> to prise the ${factionName(target.faction)} flag loose — ${pct}%`,
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
  refreshFlagless();
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
  if (!r) return null;
  // The drawn body, so the flag rides on the carrier instead of hopping ahead.
  return remotePlayers.renderedPos(pid)?.clone() ?? new THREE.Vector3(r.tx, r.ty, r.tz);
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
        name: `${owner} flag — ${who}`,
      });
      continue;
    }
    const home = flagPosition(f);
    const stolen = f.holder !== f.faction;
    markers.push({
      x: home.x, z: home.z,
      color: factionColor(f.faction),
      name: stolen
        ? `${owner} flag — held by ${factionName(f.holder)}`
        : `${owner} flag`,
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
  warBoundary.update(currentWarBorder() / 2, active);
  if (active) {
    // Pulse the ring so it reads as dangerous.
    warBoundary.material.uniforms.uOpacity.value =
      0.6 + 0.22 * Math.abs(Math.sin(worldTimeLocal * 2.2));
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
      // Follow the drawn body, not the raw network target: that runs a
      // snapshot ahead and hops at packet rate, so the halo jittered off the
      // walking player it belongs to.
      const at = remotePlayers.renderedPos(id);
      if (at) sp.position.set(at.x, at.y + 1.1, at.z);
      else sp.position.set(r.tx, r.ty + 1.1, r.tz);
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
guideBtn.innerHTML = iconifyHtml('📖 Crafting Guide');
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
  header.innerHTML = `<div style="flex:1;font-size:15px;color:#ffd84a;letter-spacing:1px">${iconSvg('book')} CRAFTING GUIDE</div>`;
  const close = document.createElement('button');
  close.innerHTML = iconSvg('close');
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
  // Nothing to simulate or draw without a GPU context — and rendering into a
  // lost context throws. The clamp on `dt` below absorbs the gap on resume.
  if (contextLost) return;
  const dt = Math.min(0.05, clock.getDelta());
  updateDuelHud();
  // Hand the mouse to whatever is on screen, every frame. A panel that opens or
  // closes never has to do this itself — and a panel added later cannot forget.
  syncPointerLock();
  clickResumeEl.classList.toggle('visible',
    input.lockPending && !input.touchMode && shouldHoldPointer());

  frames++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fps = Math.round(frames / fpsTime);
    frames = 0;
    fpsTime = 0;
  }

  // Build only a collision-safe player bubble before allowing entry. The old
  // full-distance gate generated 289 chunks here; this needs just 25, while
  // the ordinary in-game streamer below fills the remaining view outward.
  if (!worldReady && world.update(
    player.pos.x, player.pos.z,
    screen === 'title' ? TITLE_WORLD_BUDGET_MS : 6,
    INITIAL_LOAD_DISTANCE
  )) {
    worldReady = true;
  }

  // Title screen: render the fixed "fake" panorama (its own world) and skip the
  // gameplay sim entirely. The gameplay world keeps generating above.
  if (screen === 'title') {
    // The war clock keeps running while you read the menu, so the countdown on
    // the status strip stays honest between server broadcasts.
    if (warActiveNow) warLeft = Math.max(0, warLeft - dt);
    else if (warNextIn > 0) warNextIn = Math.max(0, warNextIn - dt);
    titleStatusTimer -= dt;
    if (titleStatusTimer <= 0) { titleStatusTimer = 0.25; updateTitleStatus(); }
    panoramaView.update(dt);
    panoramaView.render(renderer);
    worldMap.hideBeacons();
    touch?.update({ shown: false, playing: false, gun: false, vehicle: false,
      vehicleLabel: 'EXIT', rope: false });
    input.endFrame();
    return;
  }

  if (input.inventoryToggled) {
    if (arenaActive) showNotice(`Inventory management is locked during ${arenaModeName()}.`);
    else toggleInventory();
  }
  if (invUI.open && input.hotbarKey >= 0) invUI.hotbarSwap(input.hotbarKey);
  if (input.mapToggled) {
    if (arenaActive) showNotice(`The world map is unavailable during ${arenaModeName()}.`);
    else toggleMap();
  }
  if (input.progressPressed) {
    if (arenaActive) showNotice(`Progression is suspended during ${arenaModeName()}.`);
    else toggleProgress();
  }
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
        rs.loaded = arenaUnlimited.has(gun.ammo)
          ? gun.mag
          : loaded + inventory.removeItem(gun.ammo, gun.mag - loaded);
        inventory.version++;
      }
      reloadingStack = null;
      reloadDuration = 0;
    }
  }

  // Advance cinematics before control/camera decisions so their final frame and
  // UI restoration happen atomically.
  vaultCinematic.setReducedMotion(accessibility.reducedMotion || accessibility.photosensitivitySafe);
  vaultCinematic.update(dt);

  // Direct control only while actively playing (pointer locked, no UI, alive).
  const controlling = input.locked && !player.dead && !duelControlBlocked() &&
    !invUI.open && !vaultCinematic.playing;
  // PLAY-THROUGH: the Warfare panel is a floating card over a live world, so it
  // hands the cursor to the tree WITHOUT taking your legs away. Movement keys
  // still drive the player; look, mining, shooting and hotbar stay suspended
  // (those all need the pointer lock this panel gave up).
  const playThrough = warfareUI.open && !player.dead && !invUI.open &&
    !vaultCinematic.playing && screen === 'playing';

  // Keep worn-armor mitigation current before any damage can land this frame:
  // offline the player mitigates locally; in MP the server mitigates from this
  // synced value (clamped server-side). Progression bonuses (Toughness ranks +
  // the faction perk) ride on top of worn gear; speed applies to movement.
  const buffsNow = activeBuffs();
  player.speedMult = arenaActive ? 1 : buffsNow.speedMult;
  player.energyDrainMult = arenaKind === 'party' ? 0 : arenaActive ? 1 : buffsNow.energyMult;
  if(arenaKind === 'party'){player.energy=1;player.exhausted=false;}   // Windrunner capstones
  player.fallDamageMult = arenaActive ? 1 : buffsNow.fallMult;      // Juggernaut capstones
  interaction.miningSpeedMult = arenaActive ? 1 : buffsNow.mineMult; // Prospector + Rune of Fortune
  interaction.toolWearSave = arenaActive ? 0 : buffsNow.wearSave;    // Rune of Fortune
  const armorPts = arenaActive ? 0 : inventory.armorPoints() + buffsNow.armorBonus;
  player.armorPoints = armorPts;
  player.toughness = arenaActive ? 0 : buffsNow.toughness;           // Greater Rune of Iron
  if (net.connected &&
      (armorPts !== lastSentArmor || buffsNow.toughness !== lastSentToughness)) {
    lastSentArmor = armorPts;
    lastSentToughness = buffsNow.toughness;
    net.sendArmor(armorPts, buffsNow.toughness);
  }

  // In-world simulation (we've already returned early on the title screen) —
  // even with a menu open the world keeps ticking and you stay vulnerable; only
  // direct input is suspended (frozen input keeps gravity + PvP knockback).
  {
    if (controlling) {
      if (input.debugToggled) hud.toggleDebug();
      if (input.operatorModeTogglePressed && net.connected && net.isOp) {
        const mode = localMode === 'creative' ? 'survival' : 'creative';
        net.sendCommand(`gamemode ${mode} ${net.username}`);
      }
      if (input.hotbarKey >= 0) inventory.select(input.hotbarKey);
      // While the zoom key is held the wheel drives the magnification instead
      // of the hotbar — scrolling off your held item mid-zoom is never what the
      // scroll was meant for.
      if (input.wheelDelta !== 0) {
        if (input.zoomHeld) {
          zoomTarget = THREE.MathUtils.clamp(
            zoomTarget * ZOOM_STEP ** -input.wheelDelta, ZOOM_MIN, ZOOM_MAX);
        } else {
          inventory.select(inventory.selected + input.wheelDelta);
        }
      }
      if (input.dropPressed && !arenaActive) {
        dropCurrentItem(input.down('ShiftLeft') || input.down('ShiftRight'));
      }
      if (input.viewPressed) cycleView();
      // T: the command box. The map, waypoints, Warfare Command, the guide and
      // TPA all live behind it now — none of them has a key of its own.
      if (input.chatPressed) openCommandBox();
    }

    const moveInput = controlling || playThrough ? input : FROZEN_INPUT;
    // A glider worn in the chestplate slot enables mid-air deploy (player.update
    // reads this; jump while falling to start gliding).
    const wornChest = inventory.chestplateStack;
    // ...unless a rope is in the way: SPACE cuts the grapple, and without this
    // the very same keypress would also pop the wings and eat the launch you
    // just earned. Press it again after the launch to glide.
    player.gliderEquipped = !!wornChest && wornChest.id === Item.Glider &&
      !grappleStage && worldTimeLocal >= glideBlockedUntil;
    // Teleport arrival: pin the player at the destination and pour extra frame
    // budget into streaming a small chunk bubble there; release once the ground
    // is real (or after a generous timeout so we can never get stuck).
    if (pendingTeleport) {
      const tp = pendingTeleport;
      player.pos.set(tp.x, tp.y, tp.z);
      player.vel.set(0, 0, 0);
      player.fallDistance = 0;
      const bubbleReady = world.update(tp.x, tp.z, arenaActive ? 20 : 14, 2);
      if (bubbleReady || (worldTimeLocal - tp.started > (arenaActive ? 2 : 8))) {
        pendingTeleport = null;
        if (arenaKind === 'duel' && bubbleReady) markDuelArenaReady();
      }
    }
    updateGrapple(dt); // hook flight / reel / swing (sets velocity before the step)
    player.update(dt, moveInput, world);
    // R gives up on the current jump. The Bridge has checkpoints of its own
    // (the portals) and nothing to retry, so the key is Parkour's alone.
    // Collapse Chase has no retry: a life is the only thing a fall costs.
    if (controlling && arenaKind === 'party' && partySub?.game === 'parkour' && input.reloadPressed &&
      parkourCourse(partySub.seed).variant.mode !== 'collapse') net.sendPartyRetry();
    // Parkour throw pads: touching one sets your velocity outright. The
    // server recognises the same pad by position and lets the flight stand.
    if (arenaKind === 'party' && partySub?.game === 'parkour' && player.onGround &&
      partySnapshot?.phase === 'running') {
      const pad = parkourPadUnder(parkourCourse(partySub.seed),
        player.pos.x - partySub.minX, player.pos.y, player.pos.z - partySub.minZ);
      if (pad) {
        const kick = parkourPadImpulse(pad);
        player.vel.set(kick.vx, kick.vy, kick.vz);
        player.momentumTime = kick.momentum;
        player.onGround = false;
        player.fallDistance = 0;
      }
    }
    if (arenaActive && arenaClampPos) {
      const beforeX = player.pos.x, beforeY = player.pos.y, beforeZ = player.pos.z;
      const bounded = arenaClampPos(player.pos);
      player.pos.set(bounded.x, bounded.y, bounded.z);
      if (bounded.x !== beforeX) player.vel.x = 0;
      if (bounded.y !== beforeY) player.vel.y = 0;
      if (bounded.z !== beforeZ) player.vel.z = 0;
    }
    // Speed FOV: how fast you are actually travelling this frame, eased so a
    // swing blooms the view open and a landing settles it back.
    {
      const speed = player.vel.length();
      const want = Math.max(0, Math.min(13, (speed - 12) * 0.85));
      speedFov += (want - speedFov) * Math.min(1, dt * 6);
    }
    // Smooth zoom: ease in LOG space so every step of the ramp changes the view
    // by the same proportion — a linear FOV ramp crawls at 10x and lurches at
    // 2x. Snapping the last sliver keeps `zoomAmount === 1` exactly when idle,
    // so an un-zoomed camera is bit-for-bit what it was before this existed.
    {
      const want = controlling && input.zoomHeld ? zoomTarget : 1;
      const k = 1 - Math.exp(-dt * ZOOM_EASE);
      zoomAmount = Math.exp(THREE.MathUtils.lerp(
        Math.log(zoomAmount), Math.log(want), k));
      if (Math.abs(zoomAmount - want) < 0.002) zoomAmount = want;
    }
    // World border: keep the player inside the play area (the server clamps
    // authoritatively too). During a war this is the CLOSING red ring — but a
    // live boss fight is exempt, matching the server, so a ring closing over a
    // distant vault can never rip you out of a sealed arena mid-encounter.
    if (!arenaActive && !inLiveVaultFight()) {
      const clampHalf = net.connected && warActiveNow ? currentWarBorder() / 2 : WORLD_HALF;
      const clamped = clampInsideBorder(player.pos.x, player.pos.z, clampHalf);
      if (clamped.moved > 0) {
        player.pos.x = clamped.x;
        player.pos.z = clamped.z;
        // Pulled in from far away (a mine, a cave, a vault you had left): the
        // old Y belongs somewhere else, so stand on this column rather than
        // being sealed inside it. The server follows with an authoritative
        // teleport onto guaranteed-dry ground.
        if (clamped.relocated) surfaceAfterBorderPull();
      }
    }

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
      showNotice('Wings out! Dive for speed · pull up to climb · jump to stow');
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
    if (controlling && localMode !== 'spectator' && !duelSpectating) {
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const eye = player.eyePosition;
      const heldStack = inventory.selectedStack;
      const heldGun = heldStack ? ITEMS[heldStack.id]?.gun : undefined;
      const heldGadget = heldStack && !heldGun ? gadgetOf(heldStack.id) : undefined;

      // FLAGS come first: standing at an enemy flag pad, left-click is a swing
      // at the pole (never a mine), because that's the only thing you could
      // possibly mean to be doing there.
      if (arenaActive && !heldStack) {
        // Empty temporary slots are not mining tools. Suppress client
        // prediction too, so rejected edits cannot leave a local-only hole.
        interaction.update(dt, input, camera, true, true);
      } else if (statusFx.blocksActions() || defuseAt) {
        // Stunned, netted, or both hands busy defusing: no shooting, mining
        // or placing until it passes.
        interaction.update(dt, input, camera, true, true);
      } else if (healUse.active) {
        // Both hands are busy with the wrap: no mining, placing or shooting
        // until it is finished (or interrupted by switching away).
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (myRope) {
        // Movement is consumed by the shared rope sim; no mining, placing or
        // firing while both hands are on the line.
        if (input.dismountPressed) dropFastRope();
        interaction.update(dt, input, camera, true, true);
      } else if (mySeat) {
        // Aboard a helicopter, the world controls change meaning entirely:
        // neither seat can mine, place or open anything from the air, the
        // PILOT's secondary action releases a bomb, and the GUNNER keeps their
        // own weapon — a gunner seat that cannot shoot is just a passenger seat.
        const occupiedSeat = mySeat.seat;
        if (input.dismountPressed) transferOrDismount();
        if (mySeat && occupiedSeat === 'pilot') {
          if (input.reloadPressed) toggleFastRope();
          if (input.rightClicked) tryDropBomb();
        } else if (mySeat && heldGun) {
          if (input.reloadPressed) reloadGun();
          const wantFire = heldGun.auto ? input.leftDown : input.leftClicked;
          if (wantFire && fireCooldown <= 0 && reloadTimer <= 0) {
            // Mirror the server's gunner arc so a shot outside it is EXPLAINED
            // rather than silently swallowed.
            if (gunnerArcClear()) tryFire(heldStack!, heldGun);
            else if (input.leftClicked) showNotice('⛔ Turn the nose — no shot from that angle.');
          }
        }
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (input.dismountPressed && tryAttachFastRope()) {
        interaction.update(dt, input, camera, true, true);
      } else if (partyWeaponsActive() && heldStack &&
          (heldStack.id === Item.IronAxe || heldStack.id === Item.BridgeBow)) {
        // The Bridge's weapons own both buttons while one is in hand: no
        // mining, no placing, and no block use behind a shot.
        updatePartyWeapon(heldStack.id, lookDir, eye);
        interaction.update(dt, input, camera, true, true);
      } else if (input.rightClicked && !interaction.armedMove && heldStack &&
          heldStack.id === Item.HelicopterKit && tryDeployHelicopter()) {
        // Field-assemble an airframe wherever you are standing.
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (input.rightClicked && !interaction.armedMove && !heldGun &&
          tryBoardHelicopter()) {
        // Stood beside a parked airframe: right-click climbs in.
        interaction.update(dt, input, camera, true, true); // suppress mine + use
      } else if (flagSwingUpdate(dt, input.leftDown)) {
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
        // Healing consumables (Bandage/Medkit): start the patch-up channel.
        beginHealUse();
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
      player.gliding, player.boating, player.sneaking,
      inventory.selectedStack?.id ?? 0,                 // held item on the avatar
      inventory.wornArmor().map((s) => s?.id ?? 0),     // worn armor plating
      heldSwingSeq,                                       // hit / firearm recoil sequence
      aimZoom > 1, reloadTimer > 0,
      !!mySeat);                                          // strapped into a vehicle seat

    // Simulation never pauses: mobs hunt you and survival ticks in menus too.
    if (!arenaActive) {
      survival.update(dt, player);
      mobs.myId = net.connected ? net.myId : -1;
      mobs.remoteTargets.length = 0;
      if (net.connected) {
        for (const [id, r] of net.remotes) {
          if (r.info.mode !== 'survival') continue; // creative/spectator are not prey
          mobs.remoteTargets.push({ id, pos: new THREE.Vector3(r.tx, r.ty, r.tz), dead: r.dead });
        }
      }
      mobs.update(dt, player, sky.sunIntensity);
      syncMobs(dt);
      updateVaults(dt); // dungeons: bounds/banner, guard anchors, the Brute, sparkle
    }
    // Volcanic lava is a hazard: standing in it burns you (the M21 ashlands
    // doubles as a PvP hazard). Damage routes through the server in MP.
    lavaTimer = Math.max(0, lavaTimer - dt);
    if (!player.dead && !arenaActive) {
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
    // Trapcraft: status effects + tar/wire grip every frame; offline the trap
    // field is simulated here (online the server runs it and tells us).
    if (!arenaActive) {
      updateTrapGrip(dt);
      updateDefuse(dt);
      legacySpikes(dt);
      if (!net.connected && trapField.size) {
        applyTrapResultLocal(trapField.tick(dt, localTrapTargets(), trapSolid));
      }
      trapModels.update(dt, {
        name: net.connected ? net.username : 'You', faction: localFaction,
        x: player.pos.x, y: player.pos.y, z: player.pos.z, reveal: trapRevealRadius(),
      });
      if (trapPanelAt) refreshTrapPanel();
    }
    // Machines run under the same never-pausing sim. Offline this is the
    // authoritative tick; in multiplayer it's a local prediction for the fill
    // bar (the server is authoritative and reconciles on open/collect).
    if (!arenaActive) {
      machines.update(dt);
      if (!net.connected) {
        // Offline authority: a well fire that eats the whole hull flattens it.
        for (const m of machines.list()) if (m.state.hp <= 0) destroyMachineLocal(m.x, m.y, m.z);
        // Output hopper: rigs empty into an adjacent chest every few seconds
        // (never into the chest you have open — the panel would overwrite it).
        machineHopper -= dt;
        if (machineHopper <= 0) {
          machineHopper = 4;
          for (const m of machines.list()) {
            if (totalStored(m.state) <= 0) continue;
            for (const [dx, dz] of HOPPER_SIDES) {
              const cx = m.x + dx, cz = m.z + dz;
              if (world.getBlock(cx, m.y, cz) !== Block.Chest) continue;
              if (openChest && openChest.x === cx && openChest.y === m.y && openChest.z === cz) continue;
              const slots = chests.open(cx, m.y, cz);
              if (depositInto(slots, m.state.stored)) chests.sync(cx, m.y, cz, slots);
            }
          }
        }
      } else if (openMachine) {
        // Keep the open dashboard honest: re-adopt server truth every 3 s.
        machineResync -= dt;
        if (machineResync <= 0) { machineResync = 3; net.sendMachineOpen(openMachine.x, openMachine.y, openMachine.z); }
      }
      machineModels.update(dt); // animate drills/pumpjacks
      if (!player.dead) turretDefense.update(dt, player.pos.x, player.pos.z);
      turretModels.update(dt);
      updateWarfare(dt);    // helicopters
      updateWarHud(dt);     // war clock + border + kill score (MP only, war only)
      updateGuide(dt, controlling); // getting-started checklist + vault compass
      updateTpa(dt, controlling);   // TPA accept hold + incoming-request banner
      updateWarVisuals();   // the closing red ring + everybody-glows halos
      updateFlagVisuals(dt); // flag poles, beacons + the carrier's banner
      tickDisguises(dt); // Phase 8: expire spy disguises on remote avatars
      updateThrownItems(dt); // animate tossed grenades/bombs
    }
    updateBoundaryRings(); // world edge, Heartland ring and the war ring
    // Bounce Pad: zero fall distance while the immunity window is active.
    if (jumpImmuneUntil > 0) {
      player.fallDistance = 0;
      if (worldTimeLocal >= jumpImmuneUntil || (player.onGround && player.vel.y <= 0)) jumpImmuneUntil = 0;
    }
    updateHeldGadgetTip();
    updateGrappleAim(controlling);
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
  updateGliderRig(dt); // the wing first: the pilot pose hangs off its state
  updateSelfAvatar(dt);

  // The streaming radius is the one the graphics preset chose, not the
  // RENDER_DISTANCE ceiling: passing the ceiling here would mesh every chunk
  // out to the `max` radius no matter which preset the player picked.
  // A Duels colosseum is 44 blocks across, so three chunks covers it. The
  // Bridge and the Parkour lane are hundreds of blocks long and the far end is
  // the thing you are aiming at, so they get a much deeper bubble.
  world.update(player.pos.x, player.pos.z, 6,
    arenaKind === 'party' ? 10 : arenaActive ? 3 : world.renderDistance);
  if (net.connected && hasServerWorldTime) {
    const extrapolated = serverWorldTime + (performance.now() - serverWorldTimeAt) / 1000;
    sky.time = 0.04 + extrapolated / DAY_LENGTH;
  }
  // Duels presents a fixed noon sky while the persistent server clock keeps
  // advancing underneath. The sky eases both into noon and back to the live
  // clock, and also absorbs small authoritative clock corrections smoothly.
  sky.update(dt, activeCamera, arenaKind==='party' && partySub ? parkourTheme(partySub.seed).time : arenaActive ? 0.25 : undefined,
    !(net.connected && hasServerWorldTime));
  updateAtmosphere(activeCamera);
  ambientWorld.update(
    dt, player.pos, sky.sunIntensity,
    !player.eyeUnderwater && !curVault && !arenaActive,
    accessibility.reducedMotion,
  );
  itemEntities.update(dt, player, inventory, sky.sunIntensity);
  particles.update(dt, activeCamera);
  // Hover health bar: the player the crosshair is over shows their health.
  if (controlling) {
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    remotePlayers.setHovered(remotePlayers.rayHit(player.eyePosition, lookDir, 60));
  } else {
    remotePlayers.setHovered(-1);
  }
  net.adaptiveDelay = !arenaActive; // open world rides out late packets; arenas keep their tuned delay
  remotePlayers.update(dt); // interpolate + animate other players
  {
    netItems.update(dt, player, inventory, sky.sunIntensity);
    projectiles.update(dt); // in-flight rounds keep travelling even in a menu
  }
  updateCombatFeedback(dt); // hitmarker burn-down + re-aim the damage arcs
  damageNumbers.update(dt, activeCamera); // re-project the floating hit numbers

  // State-driven sounds.
  audio.updateListener(activeCamera);
  if (player.health < lastHealth) {
    if (!player.dead) audio.hurt();
    // Taking a hit levels your worn armor (more for harder hits).
    inventory.addArmorXp(2 + (lastHealth - player.health));
    lastDamageLocal = worldTimeLocal; // combat tag (blocks totem travel 10s)
  } else if (player.health > lastHealth) {
    onHealthRestored(player.health - lastHealth); // "+N", sparkle, hearts squeeze
  }
  tickTotemWindup(dt);
  lastHealth = player.health;
  // Bandage/medkit application: advance the channel and its feedback.
  updateHealFeel(dt, controlling && localMode !== 'spectator' && !duelSpectating && !mySeat);
  if (player.inWater && !lastInWater && Math.abs(player.vel.y) > 1) audio.splash();
  lastInWater = player.inWater;
  ambienceTimer -= dt;
  if (ambienceTimer <= 0) {
    // Underground gets the cave pad; open sky gets the voice of whichever biome
    // the player is standing in — birdsong, frogs, alpine wind, surf, the
    // rumble of the ashlands. It used to be silence everywhere above ground.
    const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
    if (!world.hasSkyAccess(px, Math.floor(player.pos.y + 1), pz)) {
      ambienceTimer = 25 + Math.random() * 35;
      audio.caveAmbience();
    } else {
      ambienceTimer = 13 + Math.random() * 20;
      const b = world.terrain.biomeWithWater(px, pz, world.terrain.height(px, pz));
      const family = BIOME_SOUND[b];
      if (family !== 'none') {
        audio.biomeAmbience(family, sky.sunIntensity < 0.55);
      }
    }
  }
  // The POV arm only renders in first person, but selected-item state remains
  // current in third person so guns do not accidentally trigger punch swings.
  // Both hands are on the control bar while gliding, so the POV arm steps
  // aside for the rig (which draws its own fists on the bar).
  // Keep the first-person body/held item visible behind the live pause overlay;
  // pausing releases controls, not the player's existence or presentation.
  const firstPersonActive = !player.dead && !duelSpectating && view === View.First &&
    screen !== 'duel_results';
  // A PILOT has both hands on the controls, so the POV arm steps aside. A
  // GUNNER is holding their own weapon and needs to see it — hiding it was why
  // the gunner seat felt like a passenger seat.
  held.setActive(firstPersonActive && !player.gliding && mySeat?.seat !== 'pilot');
  held.setItem(!player.dead && !duelSpectating ? inventory.selectedStack?.id ?? null : null);
  const reloadProgress = reloadTimer > 0 && reloadDuration > 0
    ? 1 - reloadTimer / reloadDuration : -1;
  held.setGrappleReeling(grappleStage === 'reel');
  held.update(dt, controlling && interaction.breakingActive, sky.sunIntensity,
    aimZoom > 1, reloadProgress, healUse.active ? healUse.progress : -1,
    Math.hypot(player.vel.x, player.vel.z), player.onGround);
  // Recoil the VIEW, not the aim: this runs after the frame's shots were fired
  // from camera.quaternion, and updateCamera rewrites the rotation next frame,
  // so the kick is felt without ever bending a bullet.
  if (firstPersonActive && !accessibility.reducedMotion) {
    held.viewKick(viewKickOut);
    camera.rotation.x -= viewKickOut.pitch;
    camera.rotation.y += viewKickOut.yaw;
    camera.rotation.z += viewKickOut.roll;
  }

  // Gameplay HUD chrome shows only during active play.
  const hudDisplay = controlling ? '' : 'none';
  crosshair.style.display = hudDisplay;
  hotbarEl.style.display = controlling ? 'flex' : 'none';
  statusEl.style.display = hudDisplay;
  // Combat feedback lives with the crosshair — a damage arc left hanging over
  // the pause menu or the death screen is noise.
  hitmarkerEl.style.display = hudDisplay;
  dmgArcWrap.style.display = hudDisplay;

  // Ammo counter: "loaded / reserve" while a gun is held (RELOADING during one).
  const gunStack = controlling ? inventory.selectedStack : null;
  const gunInfo = gunStack ? ITEMS[gunStack.id]?.gun : undefined;
  if (gunInfo) {
    const loaded = gunStack!.loaded ?? gunInfo.mag;
    ammoEl.textContent = reloadTimer > 0
      ? 'RELOADING…'
      : `${loaded} / ${arenaUnlimited.has(gunInfo.ammo) ? '∞' : inventory.countItem(gunInfo.ammo)}`;
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
    // Size the row from the pool the health number is actually measured
    // against. In the open world that is localHearts; inside a Duels body the
    // bar is DUEL_MAX_HEALTH, and passing the open-world count there drew a
    // permanently full row — you could not read your own health in a match.
    hearts: arenaActive ? arenaMaxHealth / arenaHpPerHeart : player.maxHealth / 2,
    hpPerHeart: arenaActive ? arenaHpPerHeart : 2,
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

  if (!arenaActive) {
    flagModels.setWarActive(warActiveNow);
    flagModels.update(dt, activeCamera, (id) => {
      if (id === net.myId) return player.pos;
      return flagCarrierPos(id);
    });
    worldMap.setDynamicMarkers(flagState.flags.map((flag) => {
      const home = flagPosition(flag);
      const remote = net.remotes.get(flag.carrier);
      const x = flag.carrier === net.myId ? player.pos.x : remote?.tx ?? home.x;
      const z = flag.carrier === net.myId ? player.pos.z : remote?.tz ?? home.z;
      return {
        x, z,
        color: factionColor(flag.faction),
        name: `${factionName(flag.faction)} Flag`,
        beaconRange: 100,
      };
    }));
  }

  // The always-on readouts. They stay up for the whole session, so this runs
  // every frame; each module only touches the DOM when its own text changes.
  // Playing only. The pause menu is a dark scrim ABOVE this overlay, so
  // leaving the readouts up there would show them dimmed and unreachable
  // behind it; the drag editor is how they are reached from the pause menu.
  const modsVisible = worldReady && screen === 'playing';
  hudMods.setVisible(modsVisible);
  if (modsVisible || hudMods.editing) {
    hudBiomeTimer -= dt;
    if (hudBiomeTimer <= 0 && hudSettings.layout.biome.on) {
      hudBiomeTimer = 0.5;
      const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
      hudBiomeName = BIOME_NAMES[
        world.terrain.biomeWithWater(bx, bz, world.terrain.height(bx, bz))];
    }
    const facing = facingParts();
    const heldStack = inventory.selectedStack;
    const modData: HudModData = {
      fps,
      x: player.pos.x, y: player.pos.y, z: player.pos.z,
      facing: facing.name, axis: facing.axis,
      // clockString() appends the day in brackets; the modules keep the two
      // apart so a player can have one without the other.
      time: clockString().slice(0, 5),
      day: Math.floor(sky.time) + 1,
      speed: Math.hypot(player.vel.x, player.vel.z),
      biome: hudBiomeName,
      held: heldStack ? ITEMS[heldStack.id]?.name ?? '' : '',
      players: net.connected ? net.remotes.size + 1 : 1,
      armor: armorPts,
      health: player.health,
      maxHealth: arenaActive ? arenaMaxHealth : player.maxHealth,
    };
    hudMods.update(modData);
  }

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
      gun: !duelSpectating && !!(hs && ITEMS[hs.id]?.gun),
      vehicle: !!mySeat || !!myRope || !!nearestRopeInReach(),
      vehicleLabel: myRope ? 'DROP' : mySeat ? 'F' : 'ROPE',
      rope: mySeat?.seat === 'pilot' && !!vehicleModels.snapshotOf(mySeat.id)?.ropeWinch,
    });
  }

  input.endFrame();
  // Redraw the sun's shadow map from the eye's neighbourhood immediately before
  // the frame that samples it, so it can never be a frame behind the world it
  // is shading. `camera` is the eye even in third person, which keeps the box
  // centred on the player rather than on the trailing camera.
  sunShadow.update(sky.lightDir, camera.position, sky.lightHeight, sky.moonlit);
  postfx.render(activeCamera);
  // Floating waypoint badges (skip the title panorama — wrong camera + covered).
  worldMap.renderBeacons(window.innerWidth, window.innerHeight);
}

// No loading screen at all: show the title (with its panorama) immediately;
// the gameplay world streams in behind it while you read the menu / log in.
overlay.classList.remove('hidden');
updateCamera();
frame();

// Dev-server-only handle for poking the renderer from a console or a headless
// screenshot script (time of day, graphics preset, where the eye is). Vite
// strips the whole block from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __vx: unknown }).__vx = {
    sky, player, world, camera,
    setQuality: (q: GraphicsQuality) => {
      graphicsInput.value = q;
      saveAccessUi();
    },
  };
}
