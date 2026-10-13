// Worlds — the browser client.
//
// The page is always one of two things: the title screen (a living backdrop
// orbiting a game world, the three game cards and the dressing room) or a
// match. A match is played in its own world: when the server moves us into
// one, the client swaps the world's generator (multiverse.ts), streams the
// spawn bubble, reports it ready, and the server starts the countdown. Leaving
// swaps back to the menu. Everything that happens in a match — movement
// checks, hits, goals, respawns — is decided by the server.

import './styles/hud.css';
import './styles/results.css';
import './styles/worlds.css';
import './styles/ratseek.css';
import './styles/mobile.css';
import './styles/bedwars.css';
import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS, isReplaceable, isSolid } from './blocks';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { TouchControls, isTouchDevice } from './touch';
import './styles/hud_mods.css';
import './styles/hud_settings.css';
import './styles/wardrobe.css';
import { Interaction, raycastBlocks } from './interact';
import { aimAssist, type AimPoint } from './aim_assist';
import { Inventory } from './inventory';
import { Item, ITEMS, type GunInfo, type ItemStack } from './items';
import { blockCubeGeometry } from './item_geometry';
import { GUN_FEEL } from './gunmodels';
import { NetClient } from './net/client';
import { skinSeed, type GameMode, type PartyState } from './net/protocol';
import { Particles } from './particles';
import { Player } from './player';
import { RemotePlayers } from './remoteplayers';
import { buildAvatarBody, disposeAvatarBody, type AvatarBody } from './avatar';
import { createAvatarItemMaterial, createAvatarEquipment, attachAvatarEquipment, poseAvatar, type AvatarEquipment } from './avatar_equipment';
import { hitFlavor, type HitFlavor } from './pvp_feedback';
import { Projectiles } from './projectiles';
import { Sky } from './sky';
import { createAtlas, createCrackTextures, TILE_PX, tileOrigin } from './textures';
import { World, RENDER_DISTANCE, DEFAULT_RENDER_DISTANCE } from './world';
import { PostFX, ShaderBudget } from './postfx';
import { SunShadow } from './shadows';
import { HealUse } from './healuse';
import { createWardrobe } from './wardrobe_ui';
import { emptyWardrobe, equipCape, sanitizeWardrobe, type Wardrobe } from './capes';
import { defaultCosmetics, sanitizeCosmetics, type Cosmetics } from './character';
import {
  GRAPHICS_ORDER, GRAPHICS_PRESETS, MAX_LOOK_SENSITIVITY, MIN_LOOK_SENSITIVITY,
  loadAccessibility, saveAccessibility, type GraphicsQuality,
} from './settings';
import { applyHudTheme, createHudSettingsPanel, loadHudSettings, saveHudSettings } from './hud_settings';
import { createHudMods, type HudModData } from './hud_mods';
import { worldGenerator, type WorldSpec } from './multiverse';
import { TEXTURE_SEED, TitleBackdrop } from './title_backdrop';
import {
  DUEL_MAX_HEALTH, DUEL_MAX_PILLAR_HEIGHT, DUEL_ARENA_SIZE,
  clampToDuelArena, duelTerrainElevation,
  type DuelArenaBounds, type DuelLobbySnapshot,
} from './duels';
import {
  BRIDGE_BOW_COOLDOWN_MS, BRIDGE_GOALS, BRIDGE_MELEE_TIER, BRIDGE_TEAM_BLOCK, PARTY_AMBIENT_LIGHT,
  PARTY_CEILING_Y, PARTY_FLOOR_Y, PARTY_MAX_HEALTH, PARTY_VOID_Y, bridgeCageSpawn, bridgeGoalGuard,
  clampToPartySub, parkourCourse, type PartyLobbySnapshot, type PartySubBounds,
} from './partygames';
import { parkourBuildBlocked, parkourPadImpulse, parkourPadUnder } from './parkour_mechanics';
import { parkourTheme } from './parkour_themes';
import { PartyUI } from './party_ui';
import { PartyVisuals } from './party_visuals';
import { DragonView } from './parkour_dragon';
import { HomeScreen } from './ui/home';
import { AccountDialog } from './ui/account_dialog';
import { PartyPanel } from './ui/party_panel';
import { ControlsSheet } from './ui/controls_sheet';
import { RatSeekClient, isClassBadge, pickSeeker, storedRatClass } from './ratseek_client';
import { RS } from './ratseek_rules';
import { BedwarsClient } from './bedwars_client';
import { BedwarsSetup } from './ui/bedwars_setup';
import { BW_BOUNDS } from './bedwars_map';
import { BW_TEAM_COLORS } from './bedwars_rules';
import { MODE_LABELS, BRIDGE_COLORS } from './ui/presentation';
import { Screens } from './client/screens';
import { WorldReadiness } from './client/world_readiness';
import { Comfort } from './client/comfort';
import { DuelsPresenter } from './client/duels_presenter';
import { CombatPresenter } from './client/combat_presenter';
import { HealingPresenter } from './client/healing_presenter';
import { PickerSession } from './client/picker_session';
import { canDuelAct, canPartyAct } from './modes';

// ── Constants ──────────────────────────────────────────────────────────────

const FOV = 70;
const SPRINT_FOV = 80.5;
const ZOOM_MIN = 1.5;
const ZOOM_MAX = 12;
const ZOOM_DEFAULT = 4;
const ZOOM_STEP = 1.22;
const ZOOM_EASE = 11;
const VIEW_DIST = 4.0;
/** Duels health is a 40 HP pool drawn at 4 HP per icon: the familiar row of ten. */
const DUEL_HP_PER_HEART = 4;
const RELOAD_TIME = 1.1;
const BURST_INTERVAL = 0.06;
const PARTY_MELEE_REACH = 4.2;
const GUEST_KEY = 'worlds.guest';
const SESSION_KEY = 'worlds.session';
const LOOK_KEY = 'worlds.look';
const MODE_NAMES = MODE_LABELS;

function fogEnd(radius: number): number { return Math.max(4, radius * 16 * 0.9 - 4); }
let FOG_FAR = fogEnd(DEFAULT_RENDER_DISTANCE);

const app = document.getElementById('app')!;
const crosshair = document.getElementById('crosshair')!;
const hotbarEl = document.getElementById('hotbar')!;
const statusEl = document.getElementById('status')!;
const ammoEl = document.getElementById('ammo')!;
const pauseEl = document.getElementById('pause')!;
const loadingEl = document.getElementById('w-loading')!;
const loadingTitle = document.getElementById('w-loading-title')!;
const loadingSub = document.getElementById('w-loading-sub')!;
crosshair.style.display = 'none';
hotbarEl.style.display = 'none';
statusEl.style.display = 'none';

// ── Renderer ───────────────────────────────────────────────────────────────

const accessibility = loadAccessibility();
const comfort = new Comfort(accessibility);
function fatalScreen(heading: string, detail: string): void {
  document.body.innerHTML =
    `<div style="position:fixed;inset:0;display:grid;place-content:center;gap:14px;padding:32px;text-align:center;
      background:#0f1a24;color:#e8eefc;font:14px/1.6 ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif">
      <h1 style="font-size:26px;color:#e3a12a;letter-spacing:1px">Worlds</h1>
      <p style="font-size:17px;font-weight:600">${heading}</p>
      <p style="max-width:46ch;color:#9fb0cc;margin:0 auto">${detail}</p></div>`;
}
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: GRAPHICS_PRESETS[accessibility.graphicsQuality].antialias, powerPreference: 'high-performance',
  });
} catch (err) {
  fatalScreen('This browser can’t run Worlds.',
    'The game needs WebGL. Try an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration turned on.');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS_PRESETS[accessibility.graphicsQuality].pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.className = 'game';
app.prepend(renderer.domElement);

let contextLost = false;
const contextLostEl = document.createElement('div');
contextLostEl.id = 'context-lost';
contextLostEl.innerHTML = '<div><b>Graphics context lost</b><p>The browser reset the GPU connection. Waiting for it to come back…</p>'
  + '<p class="hint">If nothing happens in a few seconds, reload the page.</p></div>';
app.appendChild(contextLostEl);
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  contextLostEl.classList.add('visible');
  if (input.locked) input.unlock();
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  contextLostEl.classList.remove('visible');
  applyGraphicsQuality(accessibility.graphicsQuality);
});

const scene = new THREE.Scene();
const postfx = new PostFX(renderer, scene);
const shaderBudget = new ShaderBudget();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(new THREE.Color(), 34, 68);
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.08, 2000);
camera.rotation.order = 'YXZ';
scene.add(camera);
const enum View { First = 0, Back = 1, Front = 2 }
const VIEW_NAMES = ['First person', 'Third person (back)', 'Third person (front)'];
let view: View = View.First;
const viewCamera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.08, 2000);
viewCamera.rotation.order = 'YXZ';
scene.add(viewCamera);

const atlas = createAtlas(TEXTURE_SEED, renderer.capabilities.getMaxAnisotropy());
const cracks = createCrackTextures();
const world = new World(scene, atlas, worldGenerator({ kind: 'duel', seed: 1 }));
const sunShadow = new SunShadow(renderer, scene, atlas.texture, world.shadowUniforms);
const player = new Player({ x: 22, y: 110, z: 22 });
player.damageSink = () => { /* the server owns every point of health */ };
const hudSettings = loadHudSettings();
applyHudTheme(hudSettings.theme);
const input = new Input(renderer.domElement);
input.setBinds(hudSettings.binds);
const isMobile = isTouchDevice();
const touch = isMobile ? new TouchControls(input, {
  onPause: () => {
    if (screens.state === 'paused') { resumePlay(); return; }
    if (screens.state === 'playing') screens.enterPause();
  },
}) : null;
const inventory = new Inventory();
const interaction = new Interaction(scene, world, player, cracks, inventory);
const sky = new Sky(scene, TEXTURE_SEED);
const hud = new HUD(atlas.canvas, inventory);
const held = new HeldItemView(camera, atlas);
let heldSwingSeq = 0;
held.onSwing = () => { heldSwingSeq = (heldSwingSeq + 1) & 0xffff; };
held.onGunSound = (kind) => audio.gunAction(kind);
const viewKickOut = { pitch: 0, yaw: 0, roll: 0 };
const particles = new Particles(scene);
const audio = new GameAudio();
audio.setEffectsVolume(accessibility.effectsVolume);
const net = new NetClient();
const remotePlayers = new RemotePlayers(scene, net, atlas);
const projectiles = new Projectiles(scene, world, remotePlayers, net, player, particles);
const partyUI = new PartyUI(document.body);
const partyVisuals = new PartyVisuals(scene);
/** Dragon Chase: the dragon and its fire. */
const dragonView = new DragonView(scene, particles);
const healUse = new HealUse();
/** Rat and Seek's HUD, props and screen effects. */
const rsClient = new RatSeekClient({
  scene, app, net, audio, particles, player, world, remotePlayers, atlasCanvas: atlas.canvas,
  onPanel: () => syncPointerLock(),
});
const bwClient = new BedwarsClient({
  scene, app, net, player, world, inventory, remotePlayers, atlas, cracks, interaction,
  onPanel: () => { input.releaseButtons(); syncPointerLock(); },
  flushPose: heldId => net.flushXform(player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch, player.sneaking, heldId, heldSwingSeq),
  onPlaced: (x, y, z, block) => audio.place(materialOf(block), new THREE.Vector3(x + .5, y + .5, z + .5)),
  onPickup: () => audio.pickup(),
  onBedLost: () => audio.bedLost(),
  onReplay: () => net.send({ t: 'play', mode: 'bedwars', setupRevision: myParty?.bedwars?.revision }),
  onEditTeams: () => { net.send({ t: 'leaveMatch' }); openBedwarsSetup(); },
  onLeave: () => net.send({ t: 'leaveMatch' }),
});
/** Morning over the manor: low sun, bright rooms. */
const RS_TIME_OF_DAY = 0.1;
/** Bounce Pad cooldown: earliest `worldTimeLocal` it can fire again. */
let bouncePadReadyAt = 0;
/** The title screen's living backdrop. Built once and kept: it has its own
 *  scene and World, so a match never touches it. */
const backdrop = new TitleBackdrop(atlas, window.innerWidth / window.innerHeight);

interaction.onAction = () => held.swing();
interaction.onBlockSound = (kind, blockId, x, y, z) => {
  const pos = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
  if (kind === 'break') audio.dig(materialOf(blockId), pos);
  else audio.place(materialOf(blockId), pos);
};
interaction.onEdit = (x, y, z, b) => {
  net.flushXform(player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch,
    player.sneaking, inventory.selectedStack?.id ?? 0, heldSwingSeq, aimZoom > 1, reloadTimer > 0);
  net.sendEdit(x, y, z, b);
};

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect; camera.updateProjectionMatrix();
  viewCamera.aspect = aspect; viewCamera.updateProjectionMatrix();
  backdrop.resize(aspect);
  renderer.setPixelRatio(renderPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

/** Device pixel ratio for the current screen. Bedwars is the largest world, so
 *  its fill rate is capped lower than the preset allows on high-DPI screens. */
let bedwarsPixelCap = false;
function renderPixelRatio(quality: GraphicsQuality = accessibility.graphicsQuality): number {
  const cap = GRAPHICS_PRESETS[quality].pixelRatioCap;
  return Math.min(window.devicePixelRatio, bedwarsPixelCap ? Math.min(cap, 1.5) : cap);
}
function syncPixelRatio(inBedwars: boolean): void {
  bedwarsPixelCap = inBedwars;
  renderer.setPixelRatio(renderPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
}

function applyGraphicsQuality(quality: GraphicsQuality): void {
  const preset = GRAPHICS_PRESETS[quality];
  world.renderDistance = Math.max(2, Math.min(RENDER_DISTANCE, preset.renderDistance));
  FOG_FAR = fogEnd(world.renderDistance);
  renderer.setPixelRatio(renderPixelRatio(quality));
  renderer.setSize(window.innerWidth, window.innerHeight);
  world.setSmoothLighting(preset.smoothLighting);
  postfx.setEnabled(preset.shaders);
  postfx.setSize(window.innerWidth, window.innerHeight);
  sunShadow.setEnabled(preset.shaders);
  shaderBudget.reset();
  postfx.setTier(0);
  sunShadow.setTier(0);
  sky.setShaders(preset.shaders);
  sky.setDetail(GRAPHICS_ORDER.indexOf(quality) <= GRAPHICS_ORDER.indexOf('medium') ? 1 : 0);
  world.shaderModeUniform.value = preset.shaders ? 1 : 0;
}

// ── Settings (pause menu) ──────────────────────────────────────────────────

const effectsVolumeInput = document.getElementById('effects-volume') as HTMLInputElement;
const cameraShakeInput = document.getElementById('camera-shake') as HTMLInputElement;
const reducedMotionInput = document.getElementById('reduced-motion') as HTMLInputElement;
const safeEffectsInput = document.getElementById('safe-effects') as HTMLInputElement;
const lookSensInput = document.getElementById('look-sensitivity') as HTMLInputElement;
const lookSensValue = document.getElementById('look-sensitivity-value')!;
const graphicsInput = document.getElementById('graphics-quality') as HTMLSelectElement;
lookSensInput.value = String(accessibility.lookSensitivity);
graphicsInput.value = accessibility.graphicsQuality;
effectsVolumeInput.value = String(accessibility.effectsVolume);
cameraShakeInput.value = String(accessibility.cameraShake);
reducedMotionInput.checked = accessibility.reducedMotion;
safeEffectsInput.checked = accessibility.photosensitivitySafe;
let graphicsApplied = false;
function saveAccessUi(): void {
  accessibility.effectsVolume = Number(effectsVolumeInput.value);
  accessibility.cameraShake = Number(cameraShakeInput.value);
  accessibility.reducedMotion = reducedMotionInput.checked;
  accessibility.photosensitivitySafe = safeEffectsInput.checked;
  accessibility.lookSensitivity = Math.max(MIN_LOOK_SENSITIVITY, Math.min(MAX_LOOK_SENSITIVITY, Number(lookSensInput.value)));
  const quality = graphicsInput.value as GraphicsQuality;
  input.lookSensitivity = accessibility.lookSensitivity;
  lookSensValue.textContent = `${accessibility.lookSensitivity.toFixed(2)}×`;
  if (quality !== accessibility.graphicsQuality || !graphicsApplied) {
    accessibility.graphicsQuality = quality;
    graphicsApplied = true;
    applyGraphicsQuality(quality);
  }
  saveAccessibility(accessibility);
  audio.setEffectsVolume(accessibility.effectsVolume);
  comfort.syncBody();
  // Slider tracks fill up to the thumb (hud.css reads --fill).
  for (const el of [lookSensInput, effectsVolumeInput, cameraShakeInput]) {
    const min = Number(el.min), max = Number(el.max);
    el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`);
  }
}
for (const el of [effectsVolumeInput, cameraShakeInput, reducedMotionInput, safeEffectsInput, lookSensInput, graphicsInput]) {
  el.addEventListener('input', saveAccessUi);
}
saveAccessUi();

// ── Screens ────────────────────────────────────────────────────────────────

const screens = new Screens(input, pauseEl, () => cancelPendingActions());

const toastEl = document.createElement('div');
toastEl.className = 'w-toast';
toastEl.setAttribute('role', 'status');
app.appendChild(toastEl);
let toastTimer = 0;
function toast(text: string, ms = 3200): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

const clickResumeEl = document.createElement('div');
clickResumeEl.className = 'click-resume';
clickResumeEl.textContent = 'Click to take control';
app.appendChild(clickResumeEl);

function shouldHoldPointer(): boolean { return screens.shouldHoldPointer; }
function syncPointerLock(): void { screens.syncPointerLock(); }
function resumePlay(): void { screens.resumePlay(); }
document.getElementById('quit-btn')!.addEventListener('click', () => {
  net.send({ t: 'leaveMatch' });
  pauseEl.style.display = 'none';
});
document.getElementById('pause-controls-btn')!.addEventListener('click', () => screens.showOverlay(() => controlsSheet.show()));
renderer.domElement.addEventListener('mousedown', () => { if (!input.locked) syncPointerLock(); });

// HUD settings + the draggable readouts (FPS, coordinates...).
let hudSaveTimer = 0;
function saveHudSoon(): void {
  window.clearTimeout(hudSaveTimer);
  hudSaveTimer = window.setTimeout(() => saveHudSettings(hudSettings), 200);
}
const hudMods = createHudMods(app, {
  layout: hudSettings.layout,
  binds: hudSettings.binds,
  onChange: saveHudSoon,
  onEditDone: () => {
    if (!screens.transitioning && (screens.state === 'paused' || screens.titleSettingsOpen)) screens.showOverlay(() => hudSettingsPanel.show());
  },
});
const hudSettingsPanel = createHudSettingsPanel(app, {
  settings: hudSettings,
  touch: isMobile,
  onChange: () => {
    input.setBinds(hudSettings.binds);
    hudMods.setBinds(hudSettings.binds);
    hudMods.sync();
    saveHudSoon();
  },
  onClose: () => screens.restorePause(),
  onEditLayout: () => screens.showOverlay(() => hudMods.beginEdit()),
});
document.getElementById('hud-settings-btn')!.addEventListener('click', () => screens.showOverlay(() => hudSettingsPanel.show()));

const controlsSheet = new ControlsSheet(app, () => hudSettings.binds, isMobile, () => screens.restorePause());
screens.register(controlsSheet);
screens.register(hudSettingsPanel);
screens.register({ get open() { return hudMods.editing; }, hide: () => hudMods.endEdit() });
screens.register({ get open() { return rsClient.pickerOpen; }, hide: () => rsClient.closePicker() });
screens.register({ get open() { return bwClient.panelOpen; }, hide: () => {} });

// ── Identity, look and wardrobe ────────────────────────────────────────────

let myName = '';
let signedIn = false;
let myCosmetics: Cosmetics = defaultCosmetics(0);
let myWardrobe: Wardrobe = emptyWardrobe();

function storedJson<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function store(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch { /* storage is optional */ }
}
function storedLook(): Cosmetics | undefined {
  const raw = storedJson<unknown>(LOOK_KEY);
  return raw ? sanitizeCosmetics(raw, 0) : undefined;
}

const previewHost = document.getElementById('w-preview')!;
const homeRoot = document.getElementById('w-home')!;
const titlePreview = (() => {
  const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  previewRenderer.setClearColor(0x000000, 0);
  previewRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  previewHost.appendChild(previewRenderer.domElement);
  const previewScene = new THREE.Scene();
  const previewCam = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  previewCam.position.set(0, 1.15, 5.6);
  previewCam.lookAt(0, 0.5, 0);
  // The nametag floats over the head wherever the layout puts the canvas.
  const nametag = document.querySelector<HTMLElement>('.w-nametag')!;
  const tagPoint = new THREE.Vector3();
  let headTop = 2;
  // The character stands on a little floating island of small blocks: a
  // rounded 5x5 grass top that tapers through dirt and stone to one tip.
  const ISLAND_BLOCK = 0.3;
  const rig = new THREE.Group();
  previewScene.add(rig);
  const islandMat = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true });
  const islandBlocks: [number, number, number, number][] = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    const r = Math.abs(x) + Math.abs(z);
    if (Math.abs(x) < 2 || Math.abs(z) < 2) islandBlocks.push([Block.Grass, x, -0.5, z]);
    if (r <= 2 && (Math.abs(x) < 2 || z === 0) && (Math.abs(z) < 2 || x === 0)) islandBlocks.push([Block.Dirt, x, -1.5, z]);
    if (r <= 1) islandBlocks.push([Block.Stone, x, -2.5, z]);
  }
  islandBlocks.push([Block.Stone, 0, -3.5, 0]);
  for (const [id, x, y, z] of islandBlocks) {
    const cube = new THREE.Mesh(blockCubeGeometry(atlas, id), islandMat);
    cube.scale.setScalar(ISLAND_BLOCK / 0.25);
    cube.position.set(x * ISLAND_BLOCK, y * ISLAND_BLOCK, z * ISLAND_BLOCK);
    rig.add(cube);
  }
  let body: AvatarBody | null = null;
  let pointerX = 0, pointerY = 0;
  // Drag to turn the island; it coasts, then settles back to face you.
  let spin = 0, spinVel = 0, dragId = -1, dragX = 0;
  const resize = (): void => {
    const width = Math.max(1, previewHost.clientWidth), height = Math.max(1, previewHost.clientHeight);
    previewRenderer.setSize(width, height, false);
    previewCam.aspect = width / height;
    previewCam.updateProjectionMatrix();
  };
  homeRoot.addEventListener('pointermove', (e) => {
    const rect = previewHost.getBoundingClientRect();
    if (!rect.width) return;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.3;
    pointerX = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth * 0.45)));
    pointerY = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.6)));
  });
  homeRoot.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  previewHost.addEventListener('pointerdown', (e) => {
    dragId = e.pointerId; dragX = e.clientX; spinVel = 0;
    previewHost.setPointerCapture(e.pointerId);
  });
  previewHost.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    const dx = e.clientX - dragX; dragX = e.clientX;
    spin += dx * 0.012; spinVel = dx * 0.012;
  });
  const release = (e: PointerEvent): void => { if (e.pointerId === dragId) dragId = -1; };
  previewHost.addEventListener('pointerup', release);
  previewHost.addEventListener('pointercancel', release);
  new ResizeObserver(resize).observe(previewHost);
  const animate = (): void => {
    requestAnimationFrame(animate);
    if (screens.state !== 'title' || homeRoot.hidden) return;
    const t = performance.now() / 1000;
    if (dragId < 0) {
      spin += spinVel; spinVel *= 0.93;
      if (Math.abs(spinVel) < 0.002) spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * 0.03;
    }
    rig.rotation.y = spin;
    rig.position.y = Math.sin(t * 1.1) * 0.05;
    if (body) {
      body.head.rotation.y += (-pointerX * 0.6 - body.head.rotation.y) * 0.1;
      body.head.rotation.x += (pointerY * 0.3 - body.head.rotation.x) * 0.1;
      body.group.rotation.y += (Math.PI - pointerX * 0.18 - body.group.rotation.y) * 0.05;
      const breath = Math.sin(t * 1.6) * 0.012;
      body.parts[2].rotation.x = -0.06 + breath; body.parts[3].rotation.x = 0.06 - breath;
      body.parts[2].rotation.z = -0.05; body.parts[3].rotation.z = 0.05;
    }
    tagPoint.set(0, headTop + rig.position.y + 0.14, 0).project(previewCam);
    nametag.style.top = `${((1 - tagPoint.y) / 2 * 100).toFixed(2)}%`;
    previewRenderer.render(previewScene, previewCam);
  };
  animate();
  return {
    setCosmetics(cosmetics: Cosmetics): void {
      if (body) { rig.remove(body.group); disposeAvatarBody(body); }
      body = buildAvatarBody({ ...cosmetics });
      body.group.rotation.y = Math.PI;
      rig.add(body.group);
      headTop = new THREE.Box3().setFromObject(body.group).max.y;
      resize();
    },
  };
})();

function applyLook(c: Cosmetics): void {
  myCosmetics = c;
  held.setSkin(skinSeed(myName || 'x'), myCosmetics);
  titlePreview.setCosmetics(myCosmetics);
  invalidateSelfAvatar();
  home.setIdentity(myName || 'Connecting…', signedIn, myCosmetics, skinSeed(myName || 'x'));
}

const wardrobeUI = createWardrobe({
  root: app,
  getCosmetics: () => myCosmetics,
  getWardrobe: () => myWardrobe,
  reducedMotion: () => comfort.reducedMotion,
  onSave: (look) => {
    applyLook(look);
    store(LOOK_KEY, look);
    net.send({ t: 'cosmetics', c: look });
  },
  onEquipCape: (id) => {
    const next = equipCape(myWardrobe, id);
    if (next === myWardrobe) return;
    myWardrobe = next;
    store(`worlds.capes.${myName}`, myWardrobe);
  },
});
wardrobeUI.onOpen = syncPointerLock;
wardrobeUI.onClose = syncPointerLock;
screens.register(wardrobeUI);

function setIdentity(name: string, account: boolean, serverLook?: Cosmetics): void {
  myName = name;
  signedIn = account;
  if (!account) store(GUEST_KEY, name);
  // A signed-in account's look lives on the server; a guest's lives here.
  const look = account && serverLook ? sanitizeCosmetics(serverLook, skinSeed(name))
    : storedLook() ?? (serverLook ? sanitizeCosmetics(serverLook, skinSeed(name)) : defaultCosmetics(skinSeed(name)));
  if (account && !serverLook && storedLook()) net.send({ t: 'cosmetics', c: look });
  if (account && serverLook) store(LOOK_KEY, look);
  myWardrobe = sanitizeWardrobe(storedJson(`worlds.capes.${name}`));
  wardrobeUI.update();
  applyLook(look);
  accountDialog.setIdentity(name, account);
}

// ── Menu: home, account, party ─────────────────────────────────────────────

let myParty: PartyState | null = null;

const home = new HomeScreen({
  onPlay: (mode) => {
    audio.resume();
    if (mode === 'bedwars' && myParty && myParty.members.length > 1) { openBedwarsSetup(); return; }
    if (mode === 'ratseek') { playRatSeek(); return; }
    net.send({ t: 'play', mode });
  },
  onCancel: () => net.send({ t: 'cancelQueue' }),
  onControls: () => controlsSheet.show(),
  onSettings: () => { audio.resume(); screens.openTitleSettings(); },
  onParty: () => { audio.resume(); partyPanel.show(); },
  onAccount: () => { audio.resume(); accountDialog.show(); },
  onWardrobe: () => { audio.resume(); wardrobeUI.show(); },
  onCapes: () => { audio.resume(); wardrobeUI.show('capes'); },
});

const accountDialog = new AccountDialog(app, {
  onLogin: (username, password) => net.send({ t: 'login', username, password }),
  onRegister: (username, password) => net.send({ t: 'register', username, password }),
  onRoll: () => net.send({ t: 'rollName' }),
  onLogout: () => { store(SESSION_KEY, null); net.send({ t: 'logout' }); },
});
const partyPanel = new PartyPanel(app, {
  onCreate: () => net.send({ t: 'partyCreate' }),
  onJoin: (code) => net.send({ t: 'partyJoin', code }),
  onLeave: () => net.send({ t: 'partyLeave' }),
  onKick: (id) => net.send({ t: 'partyKick', id }),
  onPromote: (id) => net.send({ t: 'partyPromote', id }),
  onBedwars: () => openBedwarsSetup(),
});
const bwSetup = new BedwarsSetup(app, {
  onChange: (teams, assignments, fill, revision) => net.send({ t: 'bwSetup', teams, assignments, fill, revision }),
  onStart: revision => net.send({ t: 'play', mode: 'bedwars', setupRevision: revision }),
  onClose: () => {},
});
function openBedwarsSetup(): void {
  if (!myParty || myParty.members.length < 2) return;
  if (!myParty.bedwars && myParty.leader === net.myId) {
    // Everyone on their own island to start with: 1v1, 1v1v1 or 1v1v1v1.
    const assignments: Record<string, number> = {};
    myParty.members.forEach((m, i) => assignments[String(m.id)] = i);
    net.send({ t: 'bwSetup', teams: Math.max(2, myParty.members.length), assignments, fill: false, revision: 0 });
  }
  partyPanel.close();
  bwSetup.update(myParty, net.myId);
  bwSetup.show();
}

/** Queue or launch Rat and Seek. A party starts with the AI Seeker; the host
 *  can change who seeks in game, with the "Who seeks?" item, until the hunt. */
function playRatSeek(): void {
  net.send({ t: 'play', mode: 'ratseek', seeker: 0, ratClass: storedRatClass() });
}
/** Closes the host's in-game "Who seeks?" sheet, while it is open. */
const seekerPicker = new PickerSession<number>(syncPointerLock);
screens.register(seekerPicker);
function openSeekerPick(): void {
  if (seekerPicker.open || !myParty || !rsClient.canPickSeeker()) return;
  const current = rsClient.snapshotSeeker(myParty.members.map((m) => m.id));
  const party = myParty;
  seekerPicker.choose(signal => pickSeeker(app, party, net.myId, current, signal), seeker => {
    if (match?.kind === 'rs' && rsClient.canPickSeeker() && seeker !== current) net.sendRsSeeker(seeker);
  });
}

net.helloPayload = () => {
  const session = storedJson<{ username: string; token: string }>(SESSION_KEY);
  let guest = '';
  try { guest = localStorage.getItem(GUEST_KEY) ?? ''; } catch { /* ignore */ }
  return { t: 'hello', guest: guest || undefined, session: session ?? undefined, cosmetics: storedLook() };
};
net.onWelcome = (username, account, cosmetics) => {
  home.setMyId(net.myId);
  home.setConnected(true);
  setIdentity(username, account, cosmetics);
};
net.onIdentity = (username, account, token, cosmetics) => {
  if (token) store(SESSION_KEY, { username, token });
  if (!account) store(SESSION_KEY, null);
  setIdentity(username, account, cosmetics);
  if (account && token) accountDialog.close();
};
net.onAuthErr = (error) => accountDialog.setError(error);
net.onNameOffer = (name) => accountDialog.setOffer(name);
net.onParty = (state) => {
  const wasIn = !!myParty;
  const newDraft = !!state?.bedwars && !myParty?.bedwars;
  myParty = state;
  home.setParty(state);
  partyPanel.update(state, net.myId);
  bwSetup.update(state, net.myId);
  bwClient.setParty(state, net.myId);
  if (newDraft && screens.state === 'title') bwSetup.show();
  if (state && !wasIn && !partyPanel.open) toast(`You're in party ${state.code}.`);
};
net.onPartyErr = (message) => { partyPanel.setError(message); bwSetup.setError(message); toast(message); };
net.onQueue = (mode) => home.setQueue(mode);
net.onNotice = (text) => toast(text);
net.onDisconnect = () => {
  home.setConnected(false, 'Lost the connection — reconnecting…');
  myParty = null; home.setParty(null); partyPanel.update(null, -1);
  bwSetup.update(null, -1); bwSetup.close();
  bwClient.setParty(null, -1);
  if (screens.state !== 'title') exitToMenu();
};
home.setConnected(false, '');

// ── Worlds: entering and leaving a match ────────────────────────────────────

type MatchKind = 'duel' | 'pg' | 'rs' | 'bw';
let match: { kind: MatchKind; spec: WorldSpec; mode: GameMode } | null = null;
const readiness = new WorldReadiness(world, () => net.sendWorldReady(), hideLoading);
let worldTimeLocal = 0;
let arenaMaxHealth = 20;
let arenaHpPerHeart = 2;
let arenaUnlimited: ReadonlySet<number> = new Set<number>();
let arenaCanPlaceAt: ((x: number, y: number, z: number, held: number) => boolean) | null = null;
let arenaCanEditAt: ((x: number, y: number, z: number, held: number) => boolean) | null = null;
let arenaClampPos: ((p: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) | null = null;
let lastHealth = 20;

interaction.shouldConsumePlacement = (block) => !arenaUnlimited.has(block);
interaction.canPlace = (x, y, z) => !!arenaCanPlaceAt?.(x, y, z, inventory.selectedStack?.id ?? 0);
interaction.canEdit = (x, y, z) => !!arenaCanEditAt?.(x, y, z, inventory.selectedStack?.id ?? 0);

function showLoading(title: string, sub: string): void {
  loadingTitle.textContent = title;
  loadingSub.textContent = sub;
  loadingEl.classList.add('show');
}
function hideLoading(): void { loadingEl.classList.remove('show'); }

/** Move this client into the match's world. */
function enterMatchWorld(spec: WorldSpec, kind: MatchKind, mode: GameMode, spawn: { x: number; y: number; z: number }): void {
  const same = match && match.spec.id === spec.id;
  screens.prepareTransition();
  if (match?.kind === 'bw') bwClient.exit();
  if (kind !== 'rs') rsClient.exit();
  resetMatchPresentation();
  match = { kind, spec, mode };
  if (!same) {
    world.setGenerator(worldGenerator(spec));
    projectiles.clear();
    partyVisuals.clear();
    // Each world has its own fixed time of day; arrive in it, don't fade into it.
    sky.snapTo(kind === 'pg' ? parkourTheme(spec.seed).time : kind === 'rs' ? RS_TIME_OF_DAY : 0.25);
  }
  home.hide();
  accountDialog.close();
  partyPanel.close();
  bwSetup.close();
  if (wardrobeUI.open) wardrobeUI.hide();
  if (controlsSheet.open) controlsSheet.hide();
  player.pos.set(spawn.x, spawn.y, spawn.z);
  player.stepLift = 0;
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  player.flying = false; player.noclip = false; duelSpectating = false; player.dead = false;
  showLoading(MODE_NAMES[mode], 'Entering the world…');
  audio.resume();
  readiness.enter(kind, spawn, worldTimeLocal);
  screens.enterMatch();
}

/** Back to the title screen. */
function exitToMenu(): void {
  screens.menu();
  readiness.reset();
  resetMatchPresentation();
  match = null;
  duelSnapshot = null;
  pgSnapshot = null; pgSub = null;
  arenaCanPlaceAt = null; arenaCanEditAt = null; arenaClampPos = null;
  arenaUnlimited = new Set();
  arenaMaxHealth = 20; arenaHpPerHeart = 2;
  world.setArenaRenderBounds(null);
  rsClient.exit();
  bwClient.exit();
  syncPixelRatio(false);
  duelSpectating = false;
  hideLoading();
  partyUI.setVisible(false);
  partyVisuals.clear();
  dragonView.clear();
  projectiles.clear();
  interaction.clear();
  inventory.restore([], 0);
  hideSelfAvatar();
  held.setActive(false);
  pauseEl.style.display = 'none';
  crosshair.style.display = 'none';
  hotbarEl.style.display = 'none';
  statusEl.style.display = 'none';
  // The frame loop only repaints the HUD while a match runs, so whatever it
  // last left lit has to be put away here or it sits on the title screen.
  hudMods.setVisible(false);
  ammoEl.style.display = 'none';
  home.show();
}
net.onLeftWorld = () => exitToMenu();

// ── Remote edits, hits and movement corrections ────────────────────────────

let bwEditSoundAt = 0;
net.onEdit = (x, y, z, b) => {
  const old = world.getBlock(x, y, z);
  world.setBlock(x, y, z, b);
  if (match?.kind === 'bw') {
    bwClient.noteEdit(x, y, z, b);
    if (old !== b && bwClient.map.bedAt(x, y, z) === null && Math.hypot(player.pos.x - x, player.pos.y - y, player.pos.z - z) < 24) {
      const at = new THREE.Vector3(x + .5, y + .5, z + .5);
      // Someone else's building: audible only close by, and a burst (a TNT
      // blast, a fast bridge) is one sound rather than a rattle.
      const now = performance.now(), audible = now - bwEditSoundAt > 90 && at.distanceTo(player.pos) < 14;
      if (audible) bwEditSoundAt = now;
      if (b === Block.Air) {
        if (audible) audio.dig(materialOf(old), at);
        particles.debris(at.x, at.y, at.z, blockDebrisColor(old));
      } else if (audible) audio.place(materialOf(b), at);
    }
  }
};
net.onEditBatch = (edits) => {
  world.beginBatch();
  for (const e of edits) world.setBlock(e.x, e.y, e.z, e.block);
  world.endBatch();
  if (match?.kind === 'bw') for (const e of edits) bwClient.noteEdit(e.x, e.y, e.z, e.block);
};
/** Average colour of a block's side art, for the chips thrown off when it breaks. */
const debrisColors = new Map<number, number>();
function blockDebrisColor(block: number): number {
  const cached = debrisColors.get(block);
  if (cached !== undefined) return cached;
  let color = 0xb9b2a4;
  try {
    const info = BLOCKS[block];
    if (info) {
      const { x, y } = tileOrigin(info.side);
      const px = atlas.canvas.getContext('2d')!.getImageData(x, y, TILE_PX, TILE_PX).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 40) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      if (n) color = ((r / n) << 16) | ((g / n) << 8) | (b / n);
    }
  } catch { /* the default grey is fine */ }
  debrisColors.set(block, color);
  return color;
}
net.onTeleport = (x, y, z) => {
  player.pos.set(x, y, z);
  player.stepLift = 0;
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  readiness.teleport({ x, y, z }, worldTimeLocal);
};
net.onSelfHealth = (health) => {
  if (health !== player.health) player.setHealthFromServer(health, false);
};
net.onRespawned = (x, y, z, h) => {
  if (match?.kind === 'bw') {
    duelSpectating = false; player.flying = false; player.noclip = false;
    const team = bwClient.snap?.players.find(p => p.id === net.myId)?.team;
    if (team !== undefined) player.yaw = bwClient.map.bases[team].yaw;
    player.pitch = 0;
  }
  cancelPendingActions();
  if (match?.kind === 'pg' && pgSub?.game === 'bridge') bridgeRespawnFx(x, y, z);
  player.respawn({ x, y, z });
  if (match?.kind === 'pg' && pgSub?.game === 'parkour') parkourRespawnFx(pgSub, x, y, z);
  // Every Bridge respawn (void, own portal, goal reset) faces down the span.
  if (match?.kind === 'pg' && pgSub?.game === 'bridge') {
    player.yaw = Math.atan2(0, -((pgSub.minZ + pgSub.maxZ) / 2 - z));
    player.pitch = 0;
  }
  player.maxHealth = arenaMaxHealth;
  player.health = h;
  lastHealth = h;
  combat.clearHurt();
  damageNumbers.clear();
  killBanner.clear();
};
net.onCosmetics = (id) => remotePlayers.invalidate(id);

// ── Combat feedback ────────────────────────────────────────────────────────

const combat = new CombatPresenter(app, audio, comfort);
const damageNumbers = combat.numbers;
const killBanner = combat.banner;
let encounterShakeTime = 0;
let encounterShakeStrength = 0;
let fovPunch = 0;

function triggerShake(duration: number, strength: number): void {
  if (comfort.reducedMotion || comfort.photosensitivitySafe || comfort.cameraShake <= 0) return;
  encounterShakeTime = Math.max(encounterShakeTime, duration);
  encounterShakeStrength = Math.max(encounterShakeStrength, strength * comfort.cameraShake);
}
function updateShake(dt: number): void {
  if (comfort.reducedMotion || comfort.photosensitivitySafe || comfort.cameraShake <= 0) {
    encounterShakeTime = 0; encounterShakeStrength = 0; return;
  }
  if (encounterShakeTime <= 0) return;
  encounterShakeTime = Math.max(0, encounterShakeTime - dt);
  const fade = Math.min(1, encounterShakeTime * 4);
  const x = Math.sin(worldTimeLocal * 79) * encounterShakeStrength * fade;
  const y = Math.cos(worldTimeLocal * 63) * encounterShakeStrength * fade * 0.65;
  camera.position.x += x; camera.position.y += y;
  if (view !== View.First) { viewCamera.position.x += x; viewCamera.position.y += y; }
  encounterShakeStrength *= Math.pow(0.08, dt);
}

function showPvpHit(targetId: number, amount: number, killed: boolean): void {
  // Bedwars sounds like Minecraft: the hit is a thud on the victim, not a UI blip.
  if (match?.kind === 'bw') {
    const r = net.remotes.get(targetId);
    combat.hit(amount, killed, true);
    audio.axeContact(false, r ? new THREE.Vector3(r.tx, r.ty + 1, r.tz) : undefined);
    if (killed) audio.hitmarker(true);
  } else combat.hit(amount, killed);
  const flavor: HitFlavor = hitFlavor(amount, killed, arenaMaxHealth);
  const remote = net.remotes.get(targetId);
  if (remote) {
    const body = remotePlayers.renderedPos(targetId);
    const x = body?.x ?? remote.tx, y = (body?.y ?? remote.ty) + 1.15, z = body?.z ?? remote.tz;
    damageNumbers.spawn(x, y, z, amount, flavor);
    if (flavor === 'soak') particles.burst(x, y, z, 4, 0xc6d6e4, 2.2, 0.3, { gravity: 3, spread: 0.35, scale: 0.4 });
    else particles.burst(x, y, z, killed ? 16 : 6, killed ? 0xff4356 : 0xf4626f, killed ? 5 : 2.8, killed ? 0.6 : 0.36,
      { gravity: 3.2, spread: 0.42, scale: killed ? 0.62 : 0.46 });
    remotePlayers.hurtFlash(targetId, killed ? 1 : flavor === 'soak' ? 0.28 : flavor === 'heavy' ? 0.8 : 0.55);
  }
  if (flavor !== 'soak') triggerShake(killed ? 0.14 : 0.06, killed ? 0.019 : 0.0035 + Math.min(0.007, amount * 0.0005));
  if (killed) {
    const victim = net.remotes.get(targetId)?.info.username ?? 'Opponent';
    if (duelUI.announced) return;
    combat.eliminated(victim);
  }
}

net.onHurt = (health, k, by) => {
  const bite = Math.max(0, player.health - health);
  player.setHealthFromServer(health, false);
  if (match?.kind === 'bw') player.applyKnockback(k[0], k[1], k[2]);
  else { player.vel.x += k[0] * 6; player.vel.y += k[1] * 6; player.vel.z += k[2] * 6; }
  combat.hurt(bite);
  triggerShake(0.13, Math.min(0.05, 0.006 + bite * 0.0016));
  const attacker = net.remotes.get(by);
  if (attacker && by !== net.myId) combat.damageFrom(attacker.tx, attacker.tz);
};
net.onHitConfirm = (target, amount, killed, crit) => {
  showPvpHit(target, amount, killed);
  if (match?.kind !== 'bw') return;
  held.meleeImpact(crit);
  const r = remotePlayers.renderedPos(target);
  // A critical hit throws Minecraft's little star sparks off the victim.
  if (crit && r) particles.burst(r.x, r.y + 1.2, r.z, 14, 0xfff1a8, 3.2, .35, { gravity: 2, spread: .45, scale: .28 });
};
net.onShot = (id, item, x, y, z, dx, dy, dz) => {
  const gun = ITEMS[item]?.gun;
  if (!gun) return;
  const origin = new THREE.Vector3(x, y, z);
  const dir = new THREE.Vector3(dx, dy, dz);
  if (dir.lengthSq() < 1e-6) return;
  dir.normalize();
  projectiles.fireGhost(origin, dir, gun);
  audio.gun(origin);
  remotePlayers.muzzleFlash(id);
};
net.onKillfeed = (killer, victim) => { if (match?.kind === 'duel') duelUI.kill(killer, victim); };

// ── Guns (Duels' Burst Rifle) ──────────────────────────────────────────────

let fireCooldown = 0;
let reloadTimer = 0;
let reloadDuration = 0;
let aimZoom = 1;
let reloadingStack: ItemStack | null = null;
let burstRemaining = 0;
let burstTimer = 0;
let burstStack: ItemStack | null = null;
let burstGun: GunInfo | null = null;
let speedFov = 0;
let zoomTarget = ZOOM_DEFAULT;
let zoomAmount = 1;
let fovNoZoom = FOV;

/** Interrupt local channels, never already-launched projectiles or server state. */
function cancelPendingActions(): void {
  burstRemaining = 0; burstTimer = 0; burstStack = null; burstGun = null;
  reloadTimer = 0; reloadDuration = 0; reloadingStack = null; aimZoom = 1;
  cancelHealUse();
  bwBowAt = 0;
  held.setBowDraw(0);
}

function resetMatchPresentation(): void {
  cancelPendingActions();
  fireCooldown = 0; bouncePadReadyAt = 0;
  duelUI.reset(); combat.reset(); healing.reset();
  encounterShakeTime = 0; encounterShakeStrength = 0; fovPunch = 0;
  player.damageFlash = 0;
  (document.getElementById('damage-flash') as HTMLDivElement).style.opacity = '0';
  bridgeRemoteFx.clear(); bridgeFxEl.className = '';
  axeIndicatorEl.style.display = 'none';
}

function fireVolley(stack: ItemStack, gun: GunInfo): boolean {
  const loaded = stack.loaded ?? gun.mag;
  if (loaded <= 0) return false;
  stack.loaded = loaded - 1;
  inventory.version++;
  const base = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const eye = player.eyePosition;
  projectiles.fire(eye, base, gun);
  net.sendShot(eye.x, eye.y, eye.z, base.x, base.y, base.z, stack.id);
  held.recoil();
  heldSwingSeq = (heldSwingSeq + 1) & 0xffff;
  audio.gun(player.eyePosition);
  triggerShake(0.11, GUN_FEEL.shake);
  return true;
}
function tryFire(stack: ItemStack, gun: GunInfo): void {
  fireCooldown = gun.cooldown;
  if (!fireVolley(stack, gun)) { fireCooldown = 0; reloadGun(); return; }
  const burst = Math.max(1, gun.burst ?? 1);
  if (burst > 1) { burstRemaining = burst - 1; burstTimer = BURST_INTERVAL; burstStack = stack; burstGun = gun; }
}
function reloadGun(): void {
  if (reloadTimer > 0) return;
  const stack = inventory.selectedStack;
  const gun = stack ? ITEMS[stack.id]?.gun : undefined;
  if (!stack || !gun) return;
  const loaded = stack.loaded ?? gun.mag;
  if (loaded >= gun.mag || (!arenaUnlimited.has(gun.ammo) && inventory.countItem(gun.ammo) <= 0)) return;
  reloadTimer = RELOAD_TIME;
  reloadDuration = reloadTimer;
  reloadingStack = stack;
}

// ── Healing (Duels medkit) ─────────────────────────────────────────────────

const healing = new HealingPresenter(audio, particles, comfort);
function beginHealUse(): void {
  if (healUse.active) return;
  const stack = inventory.selectedStack;
  const heal = stack ? ITEMS[stack.id]?.heal : undefined;
  if (!stack || !heal) return;
  if (player.health >= player.maxHealth) { toast("You're already at full health!", 1600); return; }
  healUse.start(stack.id, inventory.selected);
  healing.begin();
  held.swing();
}
function cancelHealUse(): void {
  if (!healUse.active) return;
  healUse.cancel();
  healing.cancel();
}
function finishHealUse(id: number): void {
  const heal = ITEMS[id]?.heal;
  if (!heal || inventory.selectedStack?.id !== id) return;
  inventory.consumeSelected(1);
  net.sendUseHeal(id);
  healing.finish(heal.duration);
  particles.heal(player.pos.x, player.pos.y + 1, player.pos.z, 30);
  particles.healRing(player.pos.x, player.pos.y + 0.9, player.pos.z);
  fovPunch = comfort.reducedMotion ? 0 : 7;
  triggerShake(0.18, 0.05);
}
function updateHealFeel(dt: number, active: boolean): void {
  if (healUse.active) {
    const stack = inventory.selectedStack;
    if (!active || inventory.selected !== healUse.slot || stack?.id !== healUse.itemId) cancelHealUse();
    else {
      const step = healUse.tick(dt);
      for (let i = 0; i < step.beats; i++) {
        healing.beat(player.pos.x, player.pos.y, player.pos.z);
      }
      if (step.done) finishHealUse(step.item);
    }
  }
  healing.update(dt, { active: healUse.active, progress: healUse.progress,
    remaining: healUse.duration - healUse.elapsed, name: ITEMS[healUse.itemId]?.name ?? 'Applying',
    x: player.pos.x, y: player.pos.y, z: player.pos.z, time: worldTimeLocal });
  fovPunch = Math.max(0, fovPunch - dt * 18);
}
function onHealthRestored(amount: number): void {
  healing.restored(amount, player.pos.x, player.pos.y, player.pos.z);
}

/** Duels' Bounce Pad: a single-use ~20-block launch straight up. */
function useBouncePad(): void {
  if (worldTimeLocal < bouncePadReadyAt) return;
  let supportY = -1;
  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  for (let y = Math.min(255, Math.floor(player.pos.y) - 1); y >= 0; y--) {
    if (isSolid(world.getBlock(bx, y, bz))) { supportY = y; break; }
  }
  if (supportY < 0 || player.pos.y - (supportY + 1) > 10) { toast('Bounce Pad needs ground within 10 blocks below you.', 2000); return; }
  bouncePadReadyAt = worldTimeLocal + 0.5;
  inventory.consumeSelected(1);
  player.vel.y = 36;
  player.onGround = false;
  player.momentumTime = Math.max(player.momentumTime, 1.8);
  player.fallDistance = 0;
  held.bounce();
  heldSwingSeq = (heldSwingSeq + 1) & 0xffff;
  audio.bouncePad();
  triggerShake(0.22, 0.035);
  particles.burst(player.pos.x, player.pos.y + 0.08, player.pos.z, 24, 0x75ff9b, 7, 0.75, { gravity: 7, spread: 1.15, scale: 1.2 });
  particles.burst(player.pos.x, player.pos.y + 0.12, player.pos.z, 10, 0xffffff, 10, 0.42, { gravity: 9, spread: 0.7, scale: 0.65 });
}

// ── Duels ──────────────────────────────────────────────────────────────────

let duelSnapshot: DuelLobbySnapshot | null = null;
let duelActiveBounds: DuelArenaBounds | null = null;
let duelRespawnAt = 0;
let duelSpectating = false;
const duelUI = new DuelsPresenter(app, audio, comfort,
  () => ({ id: net.myId, party: !!myParty && myParty.members.length > 1, follower: followerInParty() }),
  { replay: () => net.send({ t: 'play', mode: 'duels' }), leave: () => net.send({ t: 'leaveMatch' }) });

function duelNow(): number { return duelUI.now(); }
/** Am I in a party whose leader is somebody else? Then "play again" is theirs. */
function followerInParty(): boolean {
  return !!myParty && myParty.members.length > 1 && myParty.leader !== net.myId;
}


const duelRules = {
  canPlaceAt(x: number, y: number, z: number, heldId: number): boolean {
    const a = duelActiveBounds;
    if (!a || !canDuelAct(duelSnapshot?.phase ?? null, duelSnapshot?.participants.find(p => p.id === net.myId)) || heldId !== Block.OakPlanks) return false;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < a.minX || bx >= a.maxX || bz < a.minZ || bz >= a.maxZ || by < a.floor || by >= a.ceiling - 1) return false;
    const groundY = a.floor + duelTerrainElevation(bx - a.minX, bz - a.minZ);
    return by > groundY && by <= groundY + DUEL_MAX_PILLAR_HEIGHT;
  },
  canEditAt(x: number, y: number, z: number, heldId: number): boolean {
    const a = duelActiveBounds;
    if (!a || !canDuelAct(duelSnapshot?.phase ?? null, duelSnapshot?.participants.find(p => p.id === net.myId))) return false;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < a.minX || bx >= a.maxX || bz < a.minZ || bz >= a.maxZ) return false;
    if (by <= a.floor + duelTerrainElevation(bx - a.minX, bz - a.minZ)) return false;
    const block = world.getBlock(x, y, z);
    if (isReplaceable(block)) return heldId === Block.OakPlanks;
    return block === Block.OakPlanks && heldId === Item.IronAxe;
  },
};

net.onDuelArena = (spec, arena, spawn, countdownEndsAt) => {
  duelActiveBounds = arena;
  arenaMaxHealth = DUEL_MAX_HEALTH; arenaHpPerHeart = DUEL_HP_PER_HEART;
  remotePlayers.maxHealth = DUEL_MAX_HEALTH;
  arenaCanPlaceAt = duelRules.canPlaceAt;
  arenaCanEditAt = duelRules.canEditAt;
  arenaClampPos = (pos) => clampToDuelArena(pos, arena);
  world.setArenaRenderBounds({ minX: arena.originX, minZ: arena.originZ,
    maxX: arena.originX + DUEL_ARENA_SIZE, maxZ: arena.originZ + DUEL_ARENA_SIZE }, 0.8);
  duelSpectating = false;
  pgSnapshot = null; partyUI.setVisible(false);
  player.maxHealth = DUEL_MAX_HEALTH; player.health = DUEL_MAX_HEALTH; lastHealth = DUEL_MAX_HEALTH;
  player.yaw = spawn.x < arena.minX + (arena.maxX - arena.minX) / 2 ? -Math.PI * .75 : Math.PI * .75;
  enterMatchWorld(spec, 'duel', 'duels', spawn);
  duelUI.enter(countdownEndsAt);
};
net.onDuelState = (snapshot) => {
  duelSnapshot = snapshot;
  duelUI.setSnapshot(snapshot);
};
net.onDuelLoadout = (slots, selected) => {
  inventory.restore(slots, selected);
  arenaUnlimited = new Set<number>([Block.OakPlanks, Item.Bullet]);
  cancelPendingActions(); fireCooldown = 0;
};
net.onDuelClock = (serverNow) => duelUI.syncClock(serverNow);
net.onDuelRespawn = (respawnAt, spectating) => {
  duelRespawnAt = respawnAt; duelSpectating = spectating;
  if (spectating) {
    damageNumbers.clear(); combat.clearHurt();
    cancelPendingActions();
  }
  player.flying = spectating; player.noclip = spectating;
  if (!spectating) player.health = arenaMaxHealth;
};
net.onPgRespawn = (respawnAt, spectating) => {
  duelSpectating = spectating;
  if (spectating) { cancelPendingActions(); damageNumbers.clear(); combat.clearHurt(); bridgeDeathFx(respawnAt); }
  else bridgeFxEl.classList.remove('dead');
  player.flying = spectating; player.noclip = spectating;
};
net.onDuelResult = (result) => { screens.results(); duelUI.result(result); };

// ── The Bridge / Parkour ───────────────────────────────────────────────────

let pgSnapshot: PartyLobbySnapshot | null = null;
let pgSub: PartySubBounds | null = null;
let pgClockServer = 0, pgClockLocal = 0;
let partySwingAt = -1e9;
let partyShotAt = -1e9;
const partyPredicted = { id: -1, at: 0 };
const axeIndicatorEl = document.getElementById('axe-indicator') as HTMLDivElement;
const axeIndicatorFill = axeIndicatorEl.firstElementChild as HTMLElement;
const axeLook = new THREE.Vector3();

// ── Bridge death, respawn and kill-refill feel ──────────────────────────────
// Pure presentation. Death and respawn for OTHER players ride the authoritative
// `dead` flag on their snapshots, so a fall, a hit and a goal reset all read
// the same way to everyone watching.
const bridgeFxEl = document.getElementById('bridge-fx') as HTMLDivElement;
const bridgeFxTitle = bridgeFxEl.querySelector('.bfx-title b') as HTMLElement;
const bridgeFxSub = bridgeFxEl.querySelector('.bfx-title small') as HTMLElement;
const BRIDGE_TEAM_HEX = BRIDGE_COLORS;
let bridgeDeathRespawnAt = 0, bridgeDeathShown = -1;
const bridgeRemoteFx = new Map<number, { dead: boolean; x: number; y: number; z: number }>();

function bridgeTeamColor(id: number): number {
  return BRIDGE_TEAM_HEX[pgSnapshot?.participants.find((p) => p.id === id)?.team ?? 0] ?? 0xffffff;
}
function bridgeDeathFx(respawnAt: number): void {
  if (pgSub?.game !== 'bridge') return;
  bridgeDeathRespawnAt = respawnAt; bridgeDeathShown = -1;
  const me = pgSnapshot?.participants.find((p) => p.id === net.myId);
  const kill = pgSnapshot?.lastKill;
  const how = kill?.cause === 'void' ? 'knocked you into the void' : kill?.cause === 'bow' ? 'shot you' : 'cut you down';
  bridgeFxTitle.textContent = 'YOU DIED';
  bridgeFxSub.dataset.by = kill && me && kill.victim === me.username && pgNow() - kill.at < 2000 ? `${kill.username} ${how}` : 'You fell';
  bridgeFxEl.classList.remove('reborn', 'dead');
  void bridgeFxEl.offsetWidth; // restart the wash
  bridgeFxEl.classList.add('dead');
  particles.deathBurst(player.pos.x, player.pos.y, player.pos.z, bridgeTeamColor(net.myId));
  audio.bridgeDeath(true);
  triggerShake(0.3, 0.05);
  if (!comfort.reducedMotion) fovPunch = Math.max(fovPunch, 6);
  combat.fullPulse();
}
function bridgeRespawnFx(x: number, y: number, z: number): void {
  bridgeFxEl.classList.remove('dead', 'reborn');
  void bridgeFxEl.offsetWidth;
  bridgeFxEl.classList.add('reborn');
  particles.respawnBeam(x, y, z, bridgeTeamColor(net.myId));
  audio.bridgeRespawn(true);
  triggerShake(0.14, 0.02);
  if (!comfort.reducedMotion) fovPunch = Math.max(fovPunch, 5);
}
function bridgeKillHealFx(gain: number): void {
  particles.killHeal(player.pos.x, player.pos.y, player.pos.z);
  audio.killHeal();
  healing.refill(gain);
  triggerShake(0.16, 0.02);
  if (!comfort.reducedMotion) fovPunch = Math.max(fovPunch, 4);
}
function updateBridgeFx(): void {
  if (match?.kind !== 'pg' || pgSub?.game !== 'bridge') {
    if (bridgeRemoteFx.size) bridgeRemoteFx.clear();
    if (bridgeFxEl.className) bridgeFxEl.className = '';
    return;
  }
  if (bridgeFxEl.classList.contains('dead')) {
    const left = Math.max(1, Math.ceil((bridgeDeathRespawnAt - pgNow()) / 1000));
    if (left !== bridgeDeathShown) {
      bridgeDeathShown = left;
      const by = bridgeFxSub.dataset.by ?? '';
      bridgeFxSub.textContent = `${by ? `${by}\n` : ''}Respawning in ${left}`;
    }
  }
  for (const id of bridgeRemoteFx.keys()) if (!net.remotes.has(id)) bridgeRemoteFx.delete(id);
  for (const [id, r] of net.remotes) {
    const prev = bridgeRemoteFx.get(id);
    const body = r.dead ? null : remotePlayers.renderedPos(id);
    if (!prev) { bridgeRemoteFx.set(id, { dead: r.dead, x: r.tx, y: r.ty, z: r.tz }); continue; }
    if (!r.dead) { prev.x = body?.x ?? r.tx; prev.y = body?.y ?? r.ty; prev.z = body?.z ?? r.tz; }
    if (r.dead === prev.dead) continue;
    prev.dead = r.dead;
    const at = new THREE.Vector3(r.dead ? prev.x : r.tx, r.dead ? prev.y : r.ty, r.dead ? prev.z : r.tz);
    if (r.dead) { particles.deathBurst(at.x, at.y, at.z, bridgeTeamColor(id)); audio.bridgeDeath(false, at.clone().setY(at.y + 1)); }
    else { particles.respawnBeam(at.x, at.y, at.z, bridgeTeamColor(id)); audio.bridgeRespawn(false, at.clone().setY(at.y + 1)); }
  }
}

function pgNow(): number { return pgClockServer + performance.now() - pgClockLocal; }
function pgCaged(): boolean {
  const s = pgSnapshot;
  return !!s && s.mode === 'bridge' && s.goalResetAt !== undefined && pgNow() < s.goalResetAt;
}
function pgWeaponsActive(): boolean {
  return match?.kind === 'pg' && pgSub?.game === 'bridge' &&
    canPartyAct(pgSnapshot, pgSnapshot?.participants.find(p => p.id === net.myId), pgNow());
}

partyUI.onReplay = () => net.send({ t: 'play', mode: pgSub?.game === 'parkour' ? 'parkour' : 'bridge' });
partyUI.onLeave = () => net.send({ t: 'leaveMatch' });
partyUI.onCountTick = (n, kind) => audio.bridgeCount(n, kind === 'reset');
partyUI.onGo = () => {
  audio.bridgeGo();
  const sub = pgSub;
  if (!sub || sub.game !== 'bridge') return;
  for (const team of [0, 1]) {
    const c = bridgeCageSpawn(sub, team, 0);
    const color = BRIDGE_COLORS[team] ?? BRIDGE_COLORS[0];
    particles.burst(c.x, c.y + 1.2, c.z, 26, color, 6, 0.8, { gravity: 9, spread: 4.6, scale: 0.7 });
    particles.burst(c.x, c.y + 1.2, c.z, 10, 0xffffff, 4, 0.5, { gravity: 6, spread: 4, scale: 0.45 });
  }
  triggerShake(0.18, 0.02);
};
partyUI.onGoal = (ours, team, matchPoint) => {
  audio.bridgeGoal(ours, matchPoint);
  triggerShake(0.35, ours ? 0.03 : 0.018);
  const sub = pgSub;
  if (!sub) return;
  const portal = BRIDGE_GOALS.find((g) => g.team !== team);
  if (!portal) return;
  const color = BRIDGE_COLORS[team] ?? BRIDGE_COLORS[0];
  const x = sub.minX + (portal.minX + portal.maxX) / 2, z = sub.minZ + (portal.minZ + portal.maxZ) / 2;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    window.setTimeout(() => {
      particles.burst(x + Math.cos(a) * 3, PARTY_FLOOR_Y + 5 + i * 1.3, z + Math.sin(a) * 3, 22,
        i % 2 ? 0xffffff : color, 8, 1.1, { gravity: 5, spread: 0.6, scale: 0.8 });
    }, i * 140);
  }
};

// ── Dragon Chase ────────────────────────────────────────────────────────────

/** Show the made-it / out card with a cursor to click it. */
function parkourDoneCursor(): void {
  if (match?.kind !== 'pg' || screens.state !== 'playing') return;
  screens.results();
}
partyUI.onWatch = () => { if (match?.kind === 'pg' && pgSnapshot?.phase === 'running') resumePlay(); };
partyUI.onLifeLost = (cause, out) => {
  audio.lifeLost(out);
  combat.fullPulse();
  triggerShake(cause === 'fall' ? .2 : .4, cause === 'fall' ? .02 : .05);
  if (!comfort.reducedMotion) fovPunch = Math.max(fovPunch, 6);
  if (out) parkourDoneCursor();
};
partyUI.onMadeIt = () => {
  audio.madeIt();
  particles.burst(player.pos.x, player.pos.y + 1.5, player.pos.z, 40, 0xffd25e, 7, 1.2, { gravity: 7, spread: 1.4, scale: .8 });
  particles.burst(player.pos.x, player.pos.y + 1.5, player.pos.z, 20, 0xffffff, 5, 1, { gravity: 6, spread: 1, scale: .6 });
  parkourDoneCursor();
};
/** Back on the course after a lost life (or up on the podium): a beam of
 *  light, and you face the way you are going. */
function parkourRespawnFx(sub: PartySubBounds, x: number, y: number, z: number): void {
  const course = parkourCourse(sub.seed);
  particles.respawnBeam(x, y, z, 0xffd25e);
  audio.bridgeRespawn(true);
  let best = course.platforms[0], bestD = Infinity;
  for (const p of course.platforms) {
    const d = Math.hypot(sub.minX + p.x - x, p.y - y, sub.minZ + p.z - z);
    if (d < bestD) { bestD = d; best = p; }
  }
  const next = bestD < 1.5 ? course.steps[best.order + 1]?.[0] : undefined;
  player.yaw = next ? Math.atan2(-(sub.minX + next.x - x), -(sub.minZ + next.z - z)) : 0;
  player.pitch = 0;
}
net.onPgDragon = (front, speed, at) => dragonView.sync(front, speed, at);
net.onPgFireball = (f) => dragonView.fireball(f);
/** The dragon, drawn and heard, every frame of a run. */
function updateDragon(dt: number, now: number): void {
  const s = pgSnapshot;
  if (!s || pgSub?.game !== 'parkour') return;
  const ev = dragonView.update(dt, now, s.round && s.phase === 'running' ? s.round.startedAt : null,
    comfort.reducedMotion);
  partyUI.dragonFront = dragonView.shownFront();
  const head = dragonView.headPosition(), dist = head.distanceTo(player.pos);
  if (ev.roar) { audio.dragonRoar(ev.roar); triggerShake(.6, .04); }
  if (ev.wing && dist < 45) audio.dragonWing(ev.wing);
  if (ev.breath) audio.dragonBreath(ev.breath);
  for (const at of ev.impacts) {
    const near = at.distanceTo(player.pos) < 8;
    audio.fireballImpact(at, near);
    if (near) triggerShake(.35, .05);
  }
  if (dist < 10 && s.phase === 'running') triggerShake(.1, .012);
}

net.onPgArena = (spec, _arena, sub, team, spawn) => {
  pgSub = sub;
  duelSnapshot = null;
  arenaMaxHealth = PARTY_MAX_HEALTH; arenaHpPerHeart = 2;
  remotePlayers.maxHealth = PARTY_MAX_HEALTH;
  const wool = BRIDGE_TEAM_BLOCK[team] ?? Block.TeamWoolA;
  const bridge = sub.game === 'bridge';
  arenaCanPlaceAt = (x, y, z, heldId) => canPartyAct(pgSnapshot, pgSnapshot?.participants.find(p => p.id === net.myId), pgNow()) && heldId === wool &&
    x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ &&
    y >= (bridge ? PARTY_VOID_Y : PARTY_FLOOR_Y - 3) && y < (bridge ? PARTY_FLOOR_Y + 16 : PARTY_CEILING_Y) &&
    !(bridge && bridgeGoalGuard(Math.floor(x) - sub.minX, Math.floor(z) - sub.minZ)) &&
    !(!bridge && parkourBuildBlocked(parkourCourse(sub.seed), Math.floor(x) - sub.minX, Math.floor(y), Math.floor(z) - sub.minZ));
  arenaCanEditAt = (x, y, z, heldId) => {
    if (!canPartyAct(pgSnapshot, pgSnapshot?.participants.find(p => p.id === net.myId), pgNow())) return false;
    const block = world.getBlock(x, y, z);
    if (block === Block.TeamWoolA || block === Block.TeamWoolB) return x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ;
    return block === Block.Air && !!arenaCanPlaceAt?.(x, y, z, heldId);
  };
  arenaClampPos = (pos) => clampToPartySub(pos, sub);
  arenaUnlimited = new Set([wool, Item.BridgeArrow]);
  // Dragon Chase is lit like broad daylight everywhere, the cavern included.
  world.setArenaRenderBounds(sub, sub.game === 'parkour' ? 1 : PARTY_AMBIENT_LIGHT);
  partyUI.setVisible(true);
  partyUI.setSnapshot(pgSnapshot, net.myId);
  partyUI.showRound(sub.game, performance.now());
  player.maxHealth = PARTY_MAX_HEALTH; player.health = PARTY_MAX_HEALTH; lastHealth = PARTY_MAX_HEALTH;
  if (sub.game === 'parkour') {
    const course = parkourCourse(sub.seed), target = course.steps[1][0];
    player.yaw = Math.atan2(-(sub.minX + target.x - spawn.x), -(sub.minZ + target.z - spawn.z));
    dragonView.enter(course, parkourTheme(sub.seed), sub.minX, sub.minZ);
  } else {
    dragonView.clear();
    player.yaw = Math.atan2(0, -((team === 0 ? sub.maxZ : sub.minZ) - spawn.z));
  }
  enterMatchWorld(spec, 'pg', sub.game === 'parkour' ? 'parkour' : 'bridge', spawn);
};
net.onPgState = (snapshot) => {
  if (!snapshot.participants.some((p) => p.id === net.myId && p.connected)) return;
  pgSnapshot = snapshot;
  pgClockServer = snapshot.serverNow;
  pgClockLocal = performance.now();
  if (snapshot.phase === 'results' && match?.kind === 'pg') {
    screens.results();
  }
  partyUI.replayLabel = followerInParty() ? '' : myParty && myParty.members.length > 1 ? 'Play again with party' : 'Play again';
  partyUI.setSnapshot(snapshot, net.myId);
};
net.onPgLoadout = (slots, selected) => {
  held.setBowDraw(0);
  partySwingAt = -1e9; partyShotAt = -1e9;
  partyUI.bowReadyAt = 0;
  inventory.restore(slots, selected);
  cancelPendingActions(); fireCooldown = 0;
};
net.onPgHit = (target, amount, combo, _charge, crit, killed, ranged) => {
  showPvpHit(target, amount, killed);
  const remote = net.remotes.get(target);
  const at = remote ? new THREE.Vector3(remote.tx, remote.ty + 1.1, remote.tz) : undefined;
  if (ranged) audio.arrowHit(crit, at);
  else {
    const predicted = partyPredicted.id === target && performance.now() - partyPredicted.at < 450;
    partyPredicted.id = -1;
    if (!predicted || crit) audio.axeHit(crit, at);
    if (!predicted) held.meleeImpact(crit); else if (crit) held.meleeImpact(true);
    if (at) particles.burst(at.x, at.y, at.z, crit ? 16 : 8, crit ? 0xffd25e : 0xd8edf5, crit ? 3 : 2, .25, { gravity: 4, spread: .3, scale: .25 });
    if (crit && !comfort.reducedMotion) fovPunch = Math.max(fovPunch, 3);
    if (crit || killed) triggerShake(0.12, crit ? 0.012 : 0.02);
  }
  if (!killed && (crit || combo > 0)) {
    killBanner.push(crit ? 'CRIT' : `COMBO ×${combo + 1}`, ranged ? 'On target' : crit ? 'Jump strike' : 'Keep the pressure',
      crit ? '#ffd25e' : '#72ffcb', 1.1);
  }
};
net.onPgKillHeal = (_victim, health) => {
  const gain = Math.max(0, health - player.health);
  player.health = Math.max(player.health, health);
  lastHealth = player.health; // the refill is its own event, not a medkit tick
  bridgeKillHealFx(gain);
};
net.onPgArrow = (a) => { partyVisuals.spawnArrow(a); if (a.by !== net.myId) audio.bowRelease(a.power); };
net.onPgArrowEnd = (id, x, y, z, hit) => {
  partyVisuals.endArrow(id);
  particles.burst(x, y, z, hit ? 8 : 4, hit ? 0xff8f9c : 0xd8cba4, hit ? 3 : 1.8, .3, { gravity: 6, spread: .3, scale: .32 });
};
net.onPgResult = () => {
  if (match?.kind === 'pg') screens.results();
};

// ── Bedwars ────────────────────────────────────────────────────────────────

net.onBwArena = (spec, team, spawn, yaw) => {
  duelSnapshot = null;
  pgSnapshot = null; pgSub = null; partyUI.setVisible(false); rsClient.exit();
  arenaMaxHealth = 20; arenaHpPerHeart = 2; remotePlayers.maxHealth = 20;
  arenaCanPlaceAt = null; arenaCanEditAt = null; arenaClampPos = null; arenaUnlimited = new Set();
  player.maxHealth = 20; player.health = 20; lastHealth = 20;
  player.yaw = yaw; player.pitch = 0;
  enterMatchWorld(spec, 'bw', 'bedwars', spawn);
  world.setArenaRenderBounds(BW_BOUNDS, 0.88);
  bwClient.enter(team, spec.seed);
  syncPixelRatio(true);
  bwSelected = -1; bwSwingAt = 0; bwClickAt = 0; bwBowAt = 0; bwFlashAt = 0;
};
net.onBwState = s => {
  if (match?.kind !== 'bw') return;
  const before = bwClient.snap;
  if (before) {
    for (const team of s.teams) {
      if (!before.teams[team.team]?.bed || team.bed) continue;
      const bed = bwClient.map.bases[team.team].bed;
      audio.dig('wood', new THREE.Vector3(bed.x + .5, bed.y + .5, bed.z + 1));
      particles.burst(bed.x + .5, bed.y + .5, bed.z + 1, 32,
        parseInt(BW_TEAM_COLORS[team.team].slice(1), 16), 4, 1, { gravity: 9, spread: 1, scale: .5 });
      audio.duelCue('sudden');
    }
    if (s.phase === 'countdown' && Math.ceil(s.countdown) !== Math.ceil(before.countdown)) audio.bridgeCount(Math.ceil(s.countdown));
    if (before.phase === 'countdown' && s.phase === 'playing') audio.bridgeGo();
    // Just died: the server lifts you over your base; look down at the map.
    const was = before.players.find(p => p.id === net.myId), now = s.players.find(p => p.id === net.myId);
    if (was?.alive && now && !now.alive) { player.yaw = bwClient.map.bases[now.team].yaw; player.pitch = -0.38; }
  }
  bwClient.setState(s);
  duelSpectating = bwClient.spectating;
  player.dead = false;
  player.flying = duelSpectating;
  player.noclip = duelSpectating;
};
net.onBwKit = (slots, _selected, placement) => bwClient.setKit(slots, placement);
net.onBwDrop = msg => bwClient.setDrops(msg);
net.onBwNack = (x, y, z, prediction?: Parameters<BedwarsClient['nack']>[3]) => bwClient.nack(x, y, z, prediction);
net.onBwProj = list => {
  for (const at of bwClient.setProjectiles(list)) {
    audio.fireballImpact(at, at.distanceTo(player.pos) < 12);
    particles.burst(at.x, at.y, at.z, 35, 0xe6bc77, 5, .8, { gravity: 6, spread: 1.5, scale: .5 });
  }
};
net.onBwEvent = (text, tone) => bwClient.event(text, tone);
net.onBwBuyResult = (request, ok, message) => {
  bwClient.buyResult(request, ok, message);
  if (ok) audio.place('wood');
};
net.onBwResult = result => {
  if (match?.kind !== 'bw') return;
  screens.results();
  bwClient.setResult(result);
  const team = result.players.find(p => p.id === net.myId)?.team;
  if (result.winner !== null) audio.duelCue(result.winner === team ? 'victory' : 'defeat');
};
let bwSelected = -1, bwSwingAt = 0, bwClickAt = 0, bwBowAt = 0, bwFlashAt = 0;
window.addEventListener('keydown', e => {
  if (match?.kind !== 'bw' || screens.state !== 'playing' || e.repeat || bwClient.panelOpen) return;
  if (e.code === 'KeyE' && bwClient.interact()) e.preventDefault();
});
function updateBedwarsInput(look: THREE.Vector3, eye: THREE.Vector3): void {
  const now = performance.now(), slot = inventory.selected, stack = inventory.selectedStack;
  if (bwSelected !== slot) { bwSelected = slot; net.sendBwAction({ kind: 'select', slot }); }
  const target = interaction.target;
  if (input.rightClicked && bwClient.interact()) { bwClient.aimBreak(null, slot, false); return; }
  // Aim at players with the same reach the server judges (plus a hair for interpolation).
  const victim = remotePlayers.rayHit(eye, look, bwClient.meleeReach + 0.2);
  const obstruction = target ? new THREE.Vector3(target.x + .5, target.y + .5, target.z + .5).distanceTo(eye) : Infinity;
  const other = victim >= 0 ? net.remotes.get(victim) : undefined;
  const hitPlayer = !!other && Math.hypot(other.tx - eye.x, other.ty + 1 - eye.y, other.tz - eye.z) < obstruction + .4;
  // Every click swings at once (no attack cooldown, as in Bedrock); holding the
  // button keeps swinging at a steady four a second.
  const swingNow = input.leftClicked ? now >= bwClickAt : input.leftDown && hitPlayer && now >= bwSwingAt;
  if (swingNow && (hitPlayer || !target)) {
    bwClickAt = now + 50; bwSwingAt = now + 250; held.swing();
    if (hitPlayer) {
      net.flushXform(player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch, player.sneaking, stack?.id ?? 0, heldSwingSeq);
      net.sendBwAction({ kind: 'melee', target: victim, slot });
      // Show the hit now; the server's confirmation adds the damage number.
      if (now - bwFlashAt > 450) { bwFlashAt = now; remotePlayers.hurtFlash(victim, 0.5); }
    }
  }
  bwClient.aimBreak(target, slot, input.leftDown && !hitPlayer);
  if (input.leftDown && target && !hitPlayer && now >= bwSwingAt && bwClient.isBreaking) { held.swing(); bwSwingAt = now + 380; }
  if (stack?.id === Item.BridgeBow) {
    if (input.rightDown && !bwBowAt) bwBowAt = now;
    held.setBowDraw(bwBowAt ? Math.min(1, (now - bwBowAt) / 850) : 0);
    if (!input.rightDown && bwBowAt) {
      const power = Math.min(1, (now - bwBowAt) / 850); bwBowAt = 0;
      net.sendBwAction({ kind: 'shoot', dx: look.x, dy: look.y, dz: look.z, power, slot });
      held.setBowDraw(0); audio.bowRelease(power);
    }
  } else {
    bwBowAt = 0; held.setBowDraw(0);
    if (stack && ITEMS[stack.id]?.kind === 'block') {
      // Every block that goes down swings the hand, as in Bedrock.
      if (input.rightDown && bwClient.build(target, eye, look, slot, input.rightClicked)) held.swing();
    } else if (input.rightClicked && stack) {
      bwClient.use(slot, look.x, look.y, look.z); held.swing();
    }
  }
}

// ── Rat and Seek ───────────────────────────────────────────────────────────

net.onRsArena = (spec, role, spawn, yaw) => {
  duelSnapshot = null;
  pgSnapshot = null; pgSub = null; partyUI.setVisible(false);
  arenaMaxHealth = 20; arenaHpPerHeart = 2; remotePlayers.maxHealth = 20;
  arenaCanPlaceAt = null; arenaCanEditAt = null; arenaClampPos = null;
  arenaUnlimited = new Set();
  player.maxHealth = 20; player.health = 20; lastHealth = 20;
  player.yaw = yaw;
  enterMatchWorld(spec, 'rs', 'ratseek', spawn);
  rsClient.enter(role);
};
net.onRsState = (s) => {
  if (match?.kind !== 'rs') return;
  rsClient.onState(s);
  if (!rsClient.canPickSeeker()) seekerPicker.hide();
};
net.onRsKit = (slots, selected) => inventory.restore(slots, selected ?? inventory.selected);
net.onRsFx = (fx) => rsClient.applyFx(fx);
net.onRsTitle = (title, sub, color, ms) => rsClient.title(title, sub, color, ms);
net.onRsBar = (text, color) => rsClient.bar(text, color);
net.onRsMsg = (text, color) => rsClient.message(text, color);
net.onRsSound = (kind, at) => rsClient.sound(kind, at);
net.onRsImpulse = (vx, vy, vz, momentum) => rsClient.impulse(vx, vy, vz, momentum);
net.onRsResult = (result) => {
  if (match?.kind !== 'rs') return;
  rsClient.noteResult(result);
  // No results screen: the server has put everyone round the backyard podium
  // and sends us back to the menu after a few seconds.
  player.yaw = result.podium.some((p) => p.id === net.myId) ? 0 : Math.PI;
  player.pitch = 0;
};

/** Rat and Seek clicks: a seeker's swing, and right-click item use. */
function updateRatSeekInput(lookDir: THREE.Vector3, eye: THREE.Vector3): void {
  const stack = inventory.selectedStack;
  if (input.leftClicked) {
    held.swing();
    if (rsClient.role === 'human' && rsClient.phase() === 'hunting') {
      const hit = rsClient.targetUnderCrosshair(eye, lookDir, RS.REACH + 0.3);
      if (hit) { net.sendRsHit(hit.id, hit.decoy); remotePlayers.hurtFlash(hit.id, 0.4); }
    }
  }
  if (input.rightClicked) {
    const t = interaction.target;
    // The Cheese Exchange first, so holding a class badge or the card never blocks a trade.
    const exchange = rsClient.exchangeAim(eye, lookDir, t);
    if (exchange) {
      net.flushXform(player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch,
        player.sneaking, stack?.id ?? 0, heldSwingSeq, false, false);
      net.sendRsUse(inventory.selected, exchange);
      held.swing();
      return;
    }
    if (stack && isClassBadge(stack.id)) { rsClient.openPicker(); return; }
    if (stack?.id === Item.SeekerPicker) { openSeekerPick(); return; }
    net.flushXform(player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch,
      player.sneaking, stack?.id ?? 0, heldSwingSeq, false, false);
    net.sendRsUse(inventory.selected, t ? { x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz } : undefined);
    if (stack) held.swing();
  }
}

/** Touch-only assist follows the same camera direction that the server sees. */
function updateMobileAim(dt: number): void {
  const id = inventory.selectedStack?.id;
  const gun = id !== undefined && !!ITEMS[id]?.gun;
  const bridge = pgWeaponsActive() && (id === Item.BridgeBow || id === Item.IronAxe);
  const seeker = match?.kind === 'rs' && rsClient.role === 'human' && rsClient.phase() === 'hunting';
  if (!(match?.kind === 'duel' && gun) && !bridge && !seeker) return;
  const active = input.mouseDX !== 0 || input.mouseDY !== 0 || input.leftDown || input.rightClicked;
  if (!active) return;
  const points: AimPoint[] = [];
  const myTeam = pgSnapshot?.participants.find(p => p.id === net.myId)?.team;
  for (const [remoteId, r] of net.remotes) {
    if (remoteId === net.myId || r.dead) continue;
    if (bridge) {
      const p = pgSnapshot?.participants.find(p => p.id === remoteId);
      if (!p?.connected || p.team === myTeam) continue;
    }
    if (seeker) {
      const style = rsClient.styleOf(remoteId);
      if (!style?.rat || style.hidden || style.caged) continue;
    }
    const point = remotePlayers.aimPoint(remoteId);
    if (point) points.push(point);
  }
  if (seeker) points.push(...rsClient.decoyAimPoints());
  const eye = player.eyePosition;
  const range = seeker ? RS.REACH : id === Item.IronAxe ? PARTY_MELEE_REACH : 40;
  const adjusted = aimAssist(player.yaw, player.pitch, eye, points, range, dt, active, point => {
    const direction = new THREE.Vector3(point.x, point.y, point.z).sub(eye);
    const distance = direction.length();
    return !raycastBlocks(world, eye, direction.normalize(), distance);
  });
  player.yaw = adjusted.yaw;
  player.pitch = adjusted.pitch;
}

function updatePartyWeapon(heldId: number, lookDir: THREE.Vector3, eye: THREE.Vector3): void {
  const now = performance.now();
  if (heldId === Item.IronAxe) {
    held.setBowDraw(0);
    if ((!input.leftClicked && !input.leftDown) || now - partySwingAt < BRIDGE_MELEE_TIER.cooldownMs) return;
    partySwingAt = now;
    held.swing();
    audio.axeSwing(1);
    let target = remotePlayers.rayHit(eye, lookDir, PARTY_MELEE_REACH);
    if (target >= 0 && !net.remotes.get(target)?.dead) {
      const body = remotePlayers.renderedPos(target);
      const r = net.remotes.get(target)!;
      const at = new THREE.Vector3(body?.x ?? r.tx, (body?.y ?? r.ty) + 1.1, body?.z ?? r.tz);
      audio.axeContact(player.sprinting, at);
      remotePlayers.hurtFlash(target, 0.45);
      held.meleeImpact(false);
      particles.burst(at.x, at.y, at.z, player.sprinting ? 7 : 4, 0xf4f0e8, 2.2, .22, { gravity: 5, spread: .3, scale: .28 });
      triggerShake(0.07, player.sprinting ? 0.007 : 0.004);
      partyPredicted.id = target;
      partyPredicted.at = now;
    }
    if (target < 0) {
      const look = Math.hypot(lookDir.x, lookDir.z) || 1e-3;
      const lx = lookDir.x / look, lz = lookDir.z / look;
      let best = PARTY_MELEE_REACH;
      for (const [id, r] of net.remotes) {
        if (r.dead) continue;
        const dx = r.tx - eye.x, dy = r.ty + .9 - eye.y, dz = r.tz - eye.z;
        const dist = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz) || 1e-3;
        if (dist > best || (dx / flat) * lx + (dz / flat) * lz < .55) continue;
        best = dist;
        target = id;
      }
    }
    if (target >= 0) net.sendPgMelee(target);
    return;
  }
  if (heldId !== Item.BridgeBow) { held.setBowDraw(0); return; }
  if (!input.rightClicked || now - partyShotAt < BRIDGE_BOW_COOLDOWN_MS) return;
  audio.bowRelease(1);
  held.releaseBow(1);
  partyShotAt = now;
  partyUI.bowReadyAt = now + BRIDGE_BOW_COOLDOWN_MS;
  net.sendPgShoot(lookDir.x, lookDir.y, lookDir.z, 1);
}
function updatePartyFrame(dt: number): void {
  if (!pgWeaponsActive() || screens.state !== 'playing' ||
      (inventory.selectedStack?.id !== Item.BridgeBow && inventory.selectedStack?.id !== Item.IronAxe)) held.setBowDraw(0);
  if (match?.kind !== 'pg' || !pgSnapshot) {
    partyVisuals.updateArrows(dt);
    axeIndicatorEl.style.display = 'none';
    return;
  }
  const now = pgNow();
  updateDragon(dt, now);
  partyUI.update(performance.now(), now);
  partyVisuals.update(pgSnapshot, net.myId, now, comfort.reducedMotion || comfort.photosensitivitySafe);
  partyVisuals.updateArrows(dt);
  const show = pgWeaponsActive() && screens.state === 'playing' && view === View.First && inventory.selectedStack?.id === Item.IronAxe;
  axeIndicatorEl.style.display = show ? 'block' : 'none';
  if (!show) return;
  const ready = Math.min(1, (performance.now() - partySwingAt) / BRIDGE_MELEE_TIER.cooldownMs);
  axeIndicatorFill.style.width = `${Math.round(ready * 100)}%`;
  axeIndicatorEl.classList.toggle('ready', ready >= 1);
  camera.getWorldDirection(axeLook);
  axeIndicatorEl.classList.toggle('reach', remotePlayers.rayHit(camera.position, axeLook, PARTY_MELEE_REACH) >= 0);
}

/** Nothing the keyboard does counts while the match holds everybody still. */
function controlBlocked(): boolean {
  if (match?.kind === 'bw') return (bwClient.frozen && !bwClient.spectating) || bwClient.panelOpen || screens.state === 'results';
  if (match?.kind === 'rs') return rsClient.frozen() || screens.state === 'results';
  if (match?.kind === 'pg') return pgSnapshot?.phase !== 'running' || pgCaged();
  if (match?.kind === 'duel') return !duelSnapshot || duelSnapshot.phase === 'countdown' || duelSnapshot.phase === 'results' || screens.state === 'results';
  return true;
}

// ── Camera, views and your own avatar ──────────────────────────────────────

const boomEye = new THREE.Vector3(), boomDir = new THREE.Vector3(), boomProbe = new THREE.Vector3();
function updateCamera(): void {
  camera.position.copy(player.eyePosition);
  camera.rotation.set(player.pitch, player.yaw, player.damageFlash * 0.18);
  const base = player.sprinting ? SPRINT_FOV : FOV;
  const dashFov = match?.kind === 'rs' && !comfort.reducedMotion ? rsClient.dashFov() : 0;
  const targetFov = base / aimZoom + (aimZoom > 1 ? 0 : speedFov + dashFov) - fovPunch;
  player.lookScale = aimZoom * zoomAmount > 1 ? Math.max(0.1, 1 / (aimZoom * zoomAmount)) : 1;
  const settled = Math.abs(fovNoZoom - targetFov) <= 0.01;
  if (!settled) fovNoZoom += (targetFov - fovNoZoom) * 0.3;
  const want = fovNoZoom / zoomAmount;
  if (!settled || camera.fov !== want) { camera.fov = want; camera.updateProjectionMatrix(); }
  if (view !== View.First) updateViewCamera();
}
function updateViewCamera(): void {
  const front = view === View.Front;
  const eye = boomEye.copy(player.eyePosition);
  viewCamera.fov = camera.fov;
  viewCamera.updateProjectionMatrix();
  viewCamera.rotation.set(front ? -player.pitch : player.pitch, front ? player.yaw + Math.PI : player.yaw, 0);
  boomDir.set(0, 0, 1).applyQuaternion(viewCamera.quaternion);
  let dist = VIEW_DIST;
  for (let d = 0.4; d <= VIEW_DIST; d += 0.25) {
    boomProbe.copy(eye).addScaledVector(boomDir, d);
    if (isSolid(world.getBlock(Math.floor(boomProbe.x), Math.floor(boomProbe.y), Math.floor(boomProbe.z)))) { dist = Math.max(0.6, d - 0.35); break; }
  }
  viewCamera.position.copy(eye).addScaledVector(boomDir, dist);
}
function cycleView(): void {
  view = ((view + 1) % 3) as View;
  toast(VIEW_NAMES[view], 1200);
  if (view === View.First) hideSelfAvatar();
}

let selfBody: AvatarBody | null = null;
let selfHeldId = 0;
let selfEquipment: AvatarEquipment | null = null;
let selfWalkPhase = 0;
let selfSneakT = 0;
const selfItemMat = createAvatarItemMaterial(atlas);
function hideSelfAvatar(): void { if (selfBody) selfBody.group.visible = false; }
function invalidateSelfAvatar(): void {
  if (!selfBody) return;
  selfEquipment?.dispose(); selfEquipment = null;
  selfHeldId = 0;
  scene.remove(selfBody.group);
  disposeAvatarBody(selfBody);
  selfBody = null;
}
function updateSelfAvatar(dt: number): void {
  if (view === View.First || duelSpectating || !match || rsClient.selfIsRat()) { hideSelfAvatar(); return; }
  if (!selfBody) { selfBody = buildAvatarBody({ ...myCosmetics }); scene.add(selfBody.group); }
  const b = selfBody;
  b.group.visible = true;
  b.group.position.set(player.pos.x, player.pos.y, player.pos.z);
  b.group.rotation.y = player.yaw;
  const heldId = inventory.selectedStack?.id ?? 0;
  if (heldId !== selfHeldId) {
    selfHeldId = heldId;
    selfEquipment?.dispose();
    selfEquipment = createAvatarEquipment(atlas, heldId, selfItemMat);
    if (selfEquipment) attachAvatarEquipment(b, selfEquipment);
  }
  const sneakTarget = player.sneaking ? 1 : 0;
  selfSneakT += (sneakTarget - selfSneakT) * Math.min(1, 12 * dt);
  const hspeed = Math.hypot(player.vel.x, player.vel.z);
  selfWalkPhase += Math.min(hspeed, 7) * dt * 2.4;
  const reloadProgress = reloadTimer > 0 && reloadDuration > 0 ? 1 - reloadTimer / reloadDuration : -1;
  poseAvatar(b, selfEquipment, {
    walkPhase: selfWalkPhase, speed: hspeed, sneak: selfSneakT, pitch: player.pitch,
    attackSwing: held.swingAmount(), aim: aimZoom > 1 ? 1 : 0,
    reload: reloadProgress >= 0 ? Math.sin(reloadProgress * Math.PI) : 0, kick: held.recoilAmount(),
    bowPower: bwBowAt ? Math.min(1, (performance.now() - bwBowAt) / 850) : 0,
  });
}

function updateAtmosphere(activeCamera: THREE.Camera): void {
  world.applySky(sky);
  postfx.setSky(sky, activeCamera);
  world.timeUniform.value = (performance.now() / 1000) % 4096;
  const fog = scene.fog as THREE.Fog;
  // A match presents a clear, bright arena: a soft haze on the far walls,
  // never a dark corner.
  fog.color.copy(sky.skyColor);
  fog.near = 34;
  fog.far = Math.min(68, FOG_FAR);
  if (match?.kind === 'bw') { fog.near = 85; fog.far = Math.max(160, FOG_FAR); }
  const rsFog = match?.kind === 'rs' ? rsClient.fog() : null;
  if (rsFog) { fog.near = rsFog.near; fog.far = rsFog.far; fog.color.setRGB(0, 0, 0); }
  (scene.background as THREE.Color).copy(fog.color);
}

// ── The frame loop ─────────────────────────────────────────────────────────

const clock = new THREE.Clock();
let fps = 0, frames = 0, fpsTime = 0;
let stepAccum = 0;

function frame(): void {
  requestAnimationFrame(frame);
  if (contextLost) return;
  const dt = Math.min(0.05, clock.getDelta());
  comfort.syncBody();
  frames++; fpsTime += dt;
  if (fpsTime >= 1) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
  syncPointerLock();
  clickResumeEl.classList.toggle('visible', input.lockPending && !input.touchMode && shouldHoldPointer());

  if (!match) {
    // The menu: the living backdrop and nothing else.
    home.tick();
    backdrop.update(dt);
    backdrop.render(renderer);
    touch?.update({ shown: false, playing: false, gun: false });
    hudMods.setVisible(false);
    if (hudMods.editing) hudMods.update({ fps, x: 128, y: 64, z: 128, facing: 'North', axis: '-Z',
      speed: 4.32, biome: MODE_NAMES.duels, held: ITEMS[Item.BurstRifle]?.name ?? 'Burst Rifle',
      players: 2, health: DUEL_MAX_HEALTH, maxHealth: DUEL_MAX_HEALTH });
    input.endFrame();
    return;
  }

  duelUI.update(match.kind === 'duel', duelSpectating, duelRespawnAt);
  const controlling = input.locked && !screens.panelOpen && !controlBlocked() && screens.state === 'playing';
  // Baseline advanced bursts/reloads before checking control. Bound the correction
  // to pending local channels: pause, overlays, death and held swaps cancel them.
  const switching = (input.hotbarKey >= 0 && input.hotbarKey !== inventory.selected) ||
    (input.wheelDelta !== 0 && !input.zoomHeld);
  if (!controlling || duelSpectating || switching ||
      (burstStack && burstStack !== inventory.selectedStack) ||
      (reloadingStack && reloadingStack !== inventory.selectedStack)) cancelPendingActions();
  if (fireCooldown > 0) fireCooldown = Math.max(0, fireCooldown - dt);
  if (burstRemaining > 0 && burstGun && burstStack) {
    if (burstStack !== inventory.selectedStack) { burstRemaining = 0; burstStack = null; burstGun = null; }
    else {
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
      if (rs && gun && rs === inventory.selectedStack) { rs.loaded = gun.mag; inventory.version++; }
      reloadingStack = null; reloadDuration = 0;
    }
  }

  player.energyDrainMult = match.kind === 'duel' ? 1 : 0;
  if (match.kind !== 'duel') { player.energy = 1; player.exhausted = false; }

  if (controlling) {
    if (input.debugToggled) hud.toggleDebug();
    if (input.hotbarKey >= 0) inventory.select(input.hotbarKey);
    if (input.wheelDelta !== 0) {
      if (input.zoomHeld) zoomTarget = THREE.MathUtils.clamp(zoomTarget * ZOOM_STEP ** -input.wheelDelta, ZOOM_MIN, ZOOM_MAX);
      else inventory.select(inventory.selected + input.wheelDelta);
    }
    if (input.viewPressed) cycleView();
  }
  if (touch) {
    const hs = inventory.selectedStack;
    touch.update({
      shown: screens.state === 'playing' || screens.state === 'paused', playing: controlling && !duelSpectating,
      gun: !!(hs && ITEMS[hs.id]?.gun),
      action: match.kind === 'bw' ? 'interact' : match.kind === 'rs' ? (rsClient.role === 'human' ? 'interact' : hs ? 'use' : 'none')
        : !hs ? 'none' : ITEMS[hs.id]?.gun ? 'attack' : ITEMS[hs.id]?.kind === 'block' ? 'build'
        : hs.id === Item.IronAxe ? 'attack' : 'use',
      label: match.kind === 'bw' ? 'USE / SHOP' : match.kind === 'rs' ? 'USE' : hs?.id === Item.BridgeBow ? 'SHOOT' : hs && ITEMS[hs.id]?.heal ? 'HEAL'
        : hs?.id === Item.JumpBoost ? 'BOOST' : undefined,
      context: `${match.mode}:${inventory.selected}:${hs?.id ?? 0}`,
    });
  }
  const moveInput = controlling ? input : FROZEN_INPUT;
  if (readiness.pendingTeleport) {
    const tp = readiness.pendingTeleport;
    player.pos.set(tp.x, tp.y, tp.z);
    player.vel.set(0, 0, 0);
    player.fallDistance = 0;
    readiness.update(worldTimeLocal);
  }
  if (match.kind === 'rs') {
    rsClient.reducedMotion = comfort.reducedMotion;
    if (controlling) rsClient.steerDash(dt);
  }
  player.update(dt, moveInput, world);
  // Parkour throw pads: touching one sets your velocity outright.
  if (match.kind === 'pg' && pgSub?.game === 'parkour' && player.onGround && pgSnapshot?.phase === 'running') {
    const pad = parkourPadUnder(parkourCourse(pgSub.seed), player.pos.x - pgSub.minX, player.pos.y, player.pos.z - pgSub.minZ);
    if (pad) {
      const kick = parkourPadImpulse(pad);
      player.vel.set(kick.vx, kick.vy, kick.vz);
      player.momentumTime = kick.momentum;
      player.onGround = false;
      player.fallDistance = 0;
    }
  }
  if (arenaClampPos) {
    const bx = player.pos.x, by = player.pos.y, bz = player.pos.z;
    const bounded = arenaClampPos(player.pos);
    player.pos.set(bounded.x, bounded.y, bounded.z);
    if (bounded.x !== bx) player.vel.x = 0;
    if (bounded.y !== by) player.vel.y = 0;
    if (bounded.z !== bz) player.vel.z = 0;
  }
  {
    const speed = player.vel.length();
    speedFov += (Math.max(0, Math.min(13, (speed - 12) * 0.85)) - speedFov) * Math.min(1, dt * 6);
    const want = controlling && input.zoomHeld ? zoomTarget : 1;
    const k = 1 - Math.exp(-dt * ZOOM_EASE);
    zoomAmount = Math.exp(THREE.MathUtils.lerp(Math.log(zoomAmount), Math.log(want), k));
    if (Math.abs(zoomAmount - want) < 0.002) zoomAmount = want;
    const hs = inventory.selectedStack;
    const g = hs ? ITEMS[hs.id]?.gun : undefined;
    aimZoom = controlling && !!g?.zoom && input.rightDown ? g!.zoom! : 1;
  }
  if (controlling && input.touchMode && !duelSpectating) updateMobileAim(dt);
  updateCamera();
  if (match.kind === 'rs') {
    camera.rotation.z += rsClient.nausea();
    if (rsClient.introCamera(camera)) view = View.First;
  }
  updateShake(dt);

  if (controlling && !duelSpectating) {
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const eye = player.eyePosition;
    const heldStack = inventory.selectedStack;
    const heldGun = heldStack ? ITEMS[heldStack.id]?.gun : undefined;
    if (match.kind === 'bw') {
      interaction.update(dt, input, camera, true, true);
      updateBedwarsInput(lookDir, eye);
    } else if (match.kind === 'rs') {
      updateRatSeekInput(lookDir, eye);
      interaction.update(dt, input, camera, true, true);
    } else if (!heldStack || healUse.active) {
      interaction.update(dt, input, camera, true, true);
    } else if (pgWeaponsActive() && (heldStack.id === Item.IronAxe || heldStack.id === Item.BridgeBow)) {
      updatePartyWeapon(heldStack.id, lookDir, eye);
      interaction.update(dt, input, camera, true, true);
    } else if (heldGun) {
      if (input.reloadPressed) reloadGun();
      const wantFire = heldGun.auto ? input.leftDown : input.leftClicked;
      if (wantFire && fireCooldown <= 0 && reloadTimer <= 0) tryFire(heldStack, heldGun);
      interaction.update(dt, input, camera, true, true);
    } else if (heldStack.id === Item.JumpBoost) {
      if (input.leftClicked || input.rightClicked) useBouncePad();
      interaction.update(dt, input, camera, true, true);
    } else if (input.rightClicked && ITEMS[heldStack.id]?.heal) {
      beginHealUse();
      interaction.update(dt, input, camera, true, true);
    } else {
      interaction.update(dt, input, camera);
    }
    const moveSpeed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && moveSpeed > 0.8) {
      stepAccum += moveSpeed * dt;
      if (stepAccum > 2.1) {
        stepAccum = 0;
        audio.step(materialOf(world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.5), Math.floor(player.pos.z))));
      }
    }
  } else {
    interaction.clear();
    if (match.kind === 'bw') bwClient.aimBreak(null, inventory.selected, false);
  }

  net.sendXform(dt, player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch,
    player.sneaking, inventory.selectedStack?.id ?? 0, heldSwingSeq, aimZoom > 1, reloadTimer > 0);
  worldTimeLocal += dt;

  const activeCamera: THREE.Camera = view === View.First ? camera : viewCamera;
  updateSelfAvatar(dt);
  world.update(player.pos.x, player.pos.z, 6, match.kind === 'pg' || match.kind === 'bw' ? 10 : match.kind === 'rs' ? 5 : 3);
  const tod = match.kind === 'pg' && pgSub ? parkourTheme(pgSub.seed).time : match.kind === 'rs' ? RS_TIME_OF_DAY : 0.25;
  sky.update(dt, activeCamera, tod);
  updateAtmosphere(activeCamera);
  particles.update(dt, activeCamera);
  if (controlling) {
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    remotePlayers.setHovered(remotePlayers.rayHit(player.eyePosition, lookDir, 60));
  } else remotePlayers.setHovered(-1);
  remotePlayers.update(dt);
  if (match.kind === 'bw') bwClient.update(dt);
  projectiles.update(dt);
  combat.update(dt, { health: player.health, maxHealth: player.maxHealth, spectating: duelSpectating,
    heartbeat: match.kind !== 'bw', x: player.pos.x, z: player.pos.z, yaw: player.yaw, time: worldTimeLocal });
  updatePartyFrame(dt);
  if (match.kind === 'rs') {
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    rsClient.frame(dt, player.yaw, player.eyePosition, look, view !== View.First);
  }
  combat.updateNumbers(dt, activeCamera);

  audio.updateListener(activeCamera);
  if (player.health < lastHealth) audio.hurt();
  else if (player.health > lastHealth) onHealthRestored(player.health - lastHealth);
  lastHealth = player.health;
  updateHealFeel(dt, controlling && !duelSpectating);
  updateBridgeFx();

  const firstPersonActive = !duelSpectating && view === View.First && screens.state !== 'results' &&
    !(match.kind === 'rs' && rsClient.phase() === 'intro');
  held.setActive(firstPersonActive);
  held.setPaws(rsClient.selfIsRat());
  held.setItem(!duelSpectating ? inventory.selectedStack?.id ?? null : null);
  const reloadProgress = reloadTimer > 0 && reloadDuration > 0 ? 1 - reloadTimer / reloadDuration : -1;
  held.update(dt, controlling && interaction.breakingActive, sky.sunIntensity, aimZoom > 1, reloadProgress,
    healUse.active ? healUse.progress : -1, Math.hypot(player.vel.x, player.vel.z), player.onGround);
  if (firstPersonActive && !comfort.reducedMotion) {
    held.viewKick(viewKickOut);
    camera.rotation.x -= viewKickOut.pitch;
    camera.rotation.y += viewKickOut.yaw;
    camera.rotation.z += viewKickOut.roll;
  }

  const showHud = controlling || (screens.state === 'playing' && !duelSpectating);
  crosshair.style.display = controlling ? '' : 'none';
  hotbarEl.style.display = showHud ? 'flex' : 'none';
  statusEl.style.display = showHud && match.kind !== 'rs' ? '' : 'none';
  combat.setVisible(controlling);
  const gunStack = controlling ? inventory.selectedStack : null;
  const gunInfo = gunStack ? ITEMS[gunStack.id]?.gun : undefined;
  if (gunInfo) {
    const loaded = gunStack!.loaded ?? gunInfo.mag;
    ammoEl.textContent = reloadTimer > 0 ? 'RELOADING…' : `${loaded} / ∞`;
    ammoEl.style.display = 'block';
  } else ammoEl.style.display = 'none';
  hud.update();
  hud.updateStatus({
    health: player.health,
    hearts: arenaMaxHealth / arenaHpPerHeart,
    hpPerHeart: arenaHpPerHeart,
    energy: player.energy,
    exhausted: player.exhausted,
  });
  (document.getElementById('damage-flash') as HTMLDivElement).style.opacity = String(Math.min(0.35, player.damageFlash));

  const modsVisible = screens.state === 'playing';
  hudMods.setVisible(modsVisible);
  if (modsVisible || hudMods.editing) {
    const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? { name: 'East', axis: '+X' } : { name: 'West', axis: '-X' })
      : (dz > 0 ? { name: 'South', axis: '+Z' } : { name: 'North', axis: '-Z' });
    const heldStack = inventory.selectedStack;
    const modData: HudModData = {
      fps, x: player.pos.x, y: player.pos.y, z: player.pos.z,
      facing: facing.name, axis: facing.axis,
      speed: Math.hypot(player.vel.x, player.vel.z), biome: MODE_NAMES[match.mode],
      held: heldStack ? ITEMS[heldStack.id]?.name ?? '' : '',
      players: net.remotes.size + 1, health: player.health, maxHealth: arenaMaxHealth,
    };
    hudMods.update(modData);
  }
  if (hud.debugVisible) {
    const t = interaction.target;
    hud.updateDebug({
      fps, x: player.pos.x, y: player.pos.y, z: player.pos.z,
      cx: Math.floor(player.pos.x) >> 4, cz: Math.floor(player.pos.z) >> 4,
      facing: `${MODE_NAMES[match.mode]} · world ${match.spec.id}`,
      target: t ? `${t.x} ${t.y} ${t.z}` : 'none',
      time: `${Math.round(duelNow() / 1000)}s`,
    });
  }
  input.endFrame();
  sunShadow.update(sky.lightDir, camera.position, sky.lightHeight, sky.moonlit, dt);
  if (GRAPHICS_PRESETS[accessibility.graphicsQuality].shaders && !document.hidden && shaderBudget.sample(dt)) {
    postfx.setTier(shaderBudget.tier);
    sunShadow.setTier(shaderBudget.tier);
  }
  postfx.render(activeCamera);
}

applyLook(storedLook() ?? defaultCosmetics(0));
net.connect();
updateCamera();
frame();

if (import.meta.env.DEV) {
  (window as unknown as { __worlds: unknown }).__worlds = { sky, player, world, camera, net, input, inventory, dragonView, bwClient, bwSetup, held, particles, interaction, atlas, pg: () => pgSnapshot };
}
