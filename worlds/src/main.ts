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
import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, isReplaceable, isSolid } from './blocks';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input, FROZEN_INPUT } from './input';
import { TouchControls, isTouchDevice } from './touch';
import { Interaction, raycastBlocks } from './interact';
import { aimAssist, type AimPoint } from './aim_assist';
import { Inventory } from './inventory';
import { Item, ITEMS, type GunInfo, type ItemStack } from './items';
import { iconSvg } from './emoji_icons';
import { itemGeometry } from './item_geometry';
import { createGunModel, GUN_FEEL, isGunItem, poseGunModel } from './gunmodels';
import { createGadgetModel, isModeledGadget, poseGadgetModel } from './gadgetmodels';
import { NetClient } from './net/client';
import { skinSeed, type GameMode, type PartyState } from './net/protocol';
import { Particles } from './particles';
import { Player } from './player';
import {
  RemotePlayers, applyAvatarSneak, buildAvatarBody, disposeAvatarBody, poseGunHold, releaseGunHold,
  stridePose, type AvatarBody,
} from './remoteplayers';
import { DamageNumbers, KillBanner, hitFlavor, type HitFlavor } from './pvp_feedback';
import { Projectiles } from './projectiles';
import { Sky } from './sky';
import { createAtlas, createCrackTextures } from './textures';
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
  DUEL_MAX_HEALTH, DUEL_MAX_PILLAR_HEIGHT, DUEL_ROUND_MS, DUEL_SCORE_LIMIT, DUEL_ARENA_SIZE,
  clampToDuelArena, duelEventCopy, duelTerrainElevation,
  type DuelArenaBounds, type DuelEvent, type DuelEventKind, type DuelLobbySnapshot, type DuelParticipant,
  type DuelResult,
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
import { HomeScreen } from './ui/home';
import { AccountDialog } from './ui/account_dialog';
import { PartyPanel } from './ui/party_panel';
import { ControlsSheet } from './ui/controls_sheet';
import { RatSeekClient, isClassBadge, pickSeeker, storedRatClass } from './ratseek_client';
import { RS } from './ratseek_rules';

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
const MODE_NAMES: Record<GameMode, string> = { duels: 'Duels', bridge: 'The Bridge', parkour: 'Parkour', ratseek: 'Rat and Seek' };

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
    if (screen === 'paused') { resumePlay(); return; }
    if (screen === 'playing') { if (input.locked) input.unlock(); enterPause(); }
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
const healUse = new HealUse();
/** Rat and Seek's HUD, props and screen effects. */
const rsClient = new RatSeekClient({
  scene, app, net, audio, particles, player, world, remotePlayers, atlasCanvas: atlas.canvas,
  onPanel: () => syncPointerLock(),
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS_PRESETS[accessibility.graphicsQuality].pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

function applyGraphicsQuality(quality: GraphicsQuality): void {
  const preset = GRAPHICS_PRESETS[quality];
  world.renderDistance = Math.max(2, Math.min(RENDER_DISTANCE, preset.renderDistance));
  FOG_FAR = fogEnd(world.renderDistance);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatioCap));
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
  document.body.classList.toggle('reduced-motion', accessibility.reducedMotion);
  document.body.classList.toggle('photosensitivity-safe', accessibility.photosensitivitySafe);
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

type Screen = 'title' | 'playing' | 'paused' | 'results';
let screen: Screen = 'title';

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

function cursorPanelOpen(): boolean {
  return wardrobeUI.open || controlsSheet.open || hudSettingsPanelOpen() || rsClient.pickerOpen || !!seekerPick;
}
let hudSettingsVisible = false;
function hudSettingsPanelOpen(): boolean { return hudSettingsVisible || hudMods.editing; }
function shouldHoldPointer(): boolean {
  return screen === 'playing' && !cursorPanelOpen();
}
function syncPointerLock(): void {
  if (shouldHoldPointer()) {
    if (!input.locked && !input.lockPending) input.lock();
  } else if (input.locked || input.lockPending) {
    input.unlock();
  }
}
function enterPlaying(): void {
  screen = 'playing';
  document.body.classList.add('in-game');
  pauseEl.style.display = 'none';
}
function resumePlay(): void { enterPlaying(); syncPointerLock(); }
function enterPause(): void {
  if (screen === 'results') { pauseEl.style.display = 'none'; if (input.locked) input.unlock(); return; }
  setPauseContext(false);
  screen = 'paused';
  pauseEl.style.display = 'flex';
}

// The pause card doubles as the title screen's Settings sheet: same controls,
// same saved values, with Done in place of Resume and no Leave match.
const pauseEyebrow = pauseEl.querySelector<HTMLElement>('.pause-eyebrow')!;
const pauseTitle = pauseEl.querySelector<HTMLElement>('h1')!;
const pauseHint = pauseEl.querySelector<HTMLElement>('.pause-hint')!;
const resumeBtn = document.getElementById('resume-btn')!;
const quitBtn = document.getElementById('quit-btn')!;
let titleSettingsOpen = false;
function setPauseContext(title: boolean): void {
  titleSettingsOpen = title;
  pauseEyebrow.textContent = title ? 'Worlds · settings' : 'Worlds · paused';
  pauseTitle.textContent = title ? 'Settings' : 'Paused';
  pauseHint.textContent = title ? 'Changes save on this device straight away.' : 'The match keeps going while you are in here.';
  resumeBtn.textContent = title ? 'Done' : 'Resume';
  quitBtn.style.display = title ? 'none' : '';
}
function openTitleSettings(): void {
  if (screen !== 'title') return;
  setPauseContext(true);
  pauseEl.style.display = 'flex';
}
function closeTitleSettings(): void {
  if (!titleSettingsOpen) return;
  setPauseContext(false);
  pauseEl.style.display = 'none';
}
resumeBtn.addEventListener('click', () => { if (titleSettingsOpen) closeTitleSettings(); else resumePlay(); });
document.getElementById('quit-btn')!.addEventListener('click', () => {
  net.send({ t: 'leaveMatch' });
  pauseEl.style.display = 'none';
});
document.getElementById('pause-controls-btn')!.addEventListener('click', () => controlsSheet.show());
document.addEventListener('pointerlockchange', () => {
  if (screen === 'results' || screen === 'title') { if (!titleSettingsOpen) pauseEl.style.display = 'none'; return; }
  if (input.locked) enterPlaying();
  else if (screen === 'playing' && !cursorPanelOpen()) enterPause();
});
renderer.domElement.addEventListener('mousedown', () => { if (!input.locked) syncPointerLock(); });
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.defaultPrevented) return;
  if (titleSettingsOpen && !hudSettingsPanelOpen() && !controlsSheet.open) { closeTitleSettings(); return; }
  if (screen === 'paused') return;
  if (screen === 'playing') { input.unlock(); enterPause(); }
});

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
    if (screen === 'paused' || titleSettingsOpen) { pauseEl.style.display = 'flex'; hudSettingsPanel.show(); hudSettingsVisible = true; }
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
  onClose: () => { hudSettingsVisible = false; if (screen === 'paused' || titleSettingsOpen) pauseEl.style.display = 'flex'; },
  onEditLayout: () => { hudSettingsVisible = false; pauseEl.style.display = 'none'; hudMods.beginEdit(); },
});
document.getElementById('hud-settings-btn')!.addEventListener('click', () => { hudSettingsVisible = true; hudSettingsPanel.show(); });

const controlsSheet = new ControlsSheet(app, () => hudSettings.binds, isMobile, () => syncPointerLock());

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
  const previewCam = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  previewCam.position.set(0, 1.15, 4.3);
  previewCam.lookAt(0, 0.98, 0);
  let body: AvatarBody | null = null;
  let pointerX = 0, pointerY = 0;
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
  new ResizeObserver(resize).observe(previewHost);
  const animate = (): void => {
    requestAnimationFrame(animate);
    if (body) {
      const t = performance.now() / 1000;
      body.head.rotation.y += (-pointerX * 0.6 - body.head.rotation.y) * 0.1;
      body.head.rotation.x += (pointerY * 0.3 - body.head.rotation.x) * 0.1;
      body.group.rotation.y += (Math.PI - pointerX * 0.18 - body.group.rotation.y) * 0.05;
      const breath = Math.sin(t * 1.6) * 0.012;
      body.parts[2].rotation.x = -0.06 + breath; body.parts[3].rotation.x = 0.06 - breath;
      body.parts[2].rotation.z = -0.05; body.parts[3].rotation.z = 0.05;
    }
    if (screen === 'title' && !homeRoot.hidden) previewRenderer.render(previewScene, previewCam);
  };
  animate();
  return {
    setCosmetics(cosmetics: Cosmetics): void {
      if (body) { previewScene.remove(body.group); disposeAvatarBody(body); }
      body = buildAvatarBody({ ...cosmetics });
      body.group.rotation.y = Math.PI;
      previewScene.add(body.group);
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
  factions: [],
  getFaction: () => -1,
  reducedMotion: () => accessibility.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
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
    if (mode === 'ratseek') { playRatSeek(); return; }
    net.send({ t: 'play', mode });
  },
  onCancel: () => net.send({ t: 'cancelQueue' }),
  onControls: () => controlsSheet.show(),
  onSettings: () => { audio.resume(); openTitleSettings(); },
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
});

/** Queue or launch Rat and Seek. A party starts with the AI Seeker; the host
 *  can change who seeks in game, with the "Who seeks?" item, until the hunt. */
function playRatSeek(): void {
  net.send({ t: 'play', mode: 'ratseek', seeker: 0, ratClass: storedRatClass() });
}
/** Closes the host's in-game "Who seeks?" sheet, while it is open. */
let seekerPick: AbortController | null = null;
function openSeekerPick(): void {
  if (seekerPick || !myParty || !rsClient.canPickSeeker()) return;
  const current = rsClient.snapshotSeeker(myParty.members.map((m) => m.id));
  seekerPick = new AbortController();
  syncPointerLock();
  void pickSeeker(app, myParty, net.myId, current, seekerPick.signal).then((seeker) => {
    seekerPick = null;
    syncPointerLock();
    if (seeker !== null && seeker !== current) net.sendRsSeeker(seeker);
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
  myParty = state;
  home.setParty(state);
  partyPanel.update(state, net.myId);
  if (state && !wasIn && !partyPanel.open) toast(`You're in party ${state.code}.`);
};
net.onPartyErr = (message) => { partyPanel.setError(message); toast(message); };
net.onQueue = (mode) => home.setQueue(mode);
net.onNotice = (text) => toast(text);
net.onDisconnect = () => {
  home.setConnected(false, 'Lost the connection — reconnecting…');
  myParty = null; home.setParty(null); partyPanel.update(null, -1);
  if (screen !== 'title') exitToMenu();
};
home.setConnected(false, '');

// ── Worlds: entering and leaving a match ────────────────────────────────────

type MatchKind = 'duel' | 'pg' | 'rs';
let match: { kind: MatchKind; spec: WorldSpec; mode: GameMode } | null = null;
let readySent = false;
let readyWatchdog = 0;
let pendingTeleport: { x: number; y: number; z: number; started: number } | null = null;
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
  match = { kind, spec, mode };
  if (!same) {
    world.setGenerator(worldGenerator(spec));
    projectiles.clear();
    partyVisuals.clear();
    // Each world has its own fixed time of day; arrive in it, don't fade into it.
    sky.snapTo(kind === 'pg' ? parkourTheme(spec.seed).time : kind === 'rs' ? RS_TIME_OF_DAY : 0.25);
  }
  closeTitleSettings();
  home.hide();
  accountDialog.close();
  partyPanel.close();
  if (wardrobeUI.open) wardrobeUI.hide();
  if (controlsSheet.open) controlsSheet.hide();
  readySent = false;
  player.pos.set(spawn.x, spawn.y, spawn.z);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  player.flying = false; player.noclip = false; duelSpectating = false; player.dead = false;
  pendingTeleport = { ...spawn, started: worldTimeLocal };
  showLoading(MODE_NAMES[mode], 'Entering the world…');
  audio.resume();
  startReadyWatchdog(spawn.x, spawn.z);
  resumePlay();
}

function sendReady(): void {
  if (readySent || !match) return;
  readySent = true;
  net.sendWorldReady();
  stopReadyWatchdog();
}
function stopReadyWatchdog(): void { if (readyWatchdog) window.clearInterval(readyWatchdog); readyWatchdog = 0; }
/** Report the spawn bubble built even while this tab is in the background
 *  (timers keep running when animation frames do not). */
function startReadyWatchdog(x: number, z: number): void {
  stopReadyWatchdog();
  readyWatchdog = window.setInterval(() => {
    if (!match || readySent) { stopReadyWatchdog(); return; }
    const complete = world.update(x, z, 30, match.kind === 'pg' ? 4 : 2);
    if (complete && world.isLoaded(x, z)) { pendingTeleport = null; hideLoading(); sendReady(); }
  }, 100);
}

/** Back to the title screen. */
function exitToMenu(): void {
  stopReadyWatchdog();
  match = null;
  duelSnapshot = null; duelResultData = null;
  pgSnapshot = null; pgSub = null;
  arenaCanPlaceAt = null; arenaCanEditAt = null; arenaClampPos = null;
  arenaUnlimited = new Set();
  arenaMaxHealth = 20; arenaHpPerHeart = 2;
  world.setArenaRenderBounds(null);
  rsClient.exit();
  duelSpectating = false;
  hideLoading();
  duelResultEl.classList.remove('visible');
  duelMatchHud.classList.remove('visible');
  duelScoresTouch.classList.remove('visible');
  duelScoreboard.classList.remove('visible');
  duelAnnounceEl.classList.remove('visible', 'out');
  duelKillFeedEl.replaceChildren();
  setDuelCue('');
  partyUI.setVisible(false);
  partyVisuals.clear();
  interaction.clear();
  healUse.cancel();
  inventory.restore([], 0);
  damageNumbers.clear();
  killBanner.clear();
  killChipEl.classList.remove('visible');
  hurtPulse = 0;
  burstRemaining = 0; reloadTimer = 0; fireCooldown = 0;
  hideSelfAvatar();
  held.setActive(false);
  screen = 'title';
  input.unlock();
  document.body.classList.remove('in-game');
  setPauseContext(false);
  pauseEl.style.display = 'none';
  crosshair.style.display = 'none';
  hotbarEl.style.display = 'none';
  statusEl.style.display = 'none';
  // The frame loop only repaints the HUD while a match runs, so whatever it
  // last left lit has to be put away here or it sits on the title screen.
  hudMods.endEdit();
  hudMods.setVisible(false);
  hitmarkerEl.style.display = 'none';
  dmgArcWrap.style.display = 'none';
  ammoEl.style.display = 'none';
  useBarEl.style.display = 'none';
  useBarEl.classList.remove('beat', 'done');
  home.show();
}
net.onLeftWorld = () => exitToMenu();

// ── Remote edits, hits and movement corrections ────────────────────────────

net.onEdit = (x, y, z, b) => world.setBlock(x, y, z, b);
net.onEditBatch = (edits) => {
  world.beginBatch();
  for (const e of edits) world.setBlock(e.x, e.y, e.z, e.block);
  world.endBatch();
};
net.onTeleport = (x, y, z) => {
  player.pos.set(x, y, z);
  player.vel.set(0, 0, 0);
  player.fallDistance = 0;
  const loaded = [-.3, .3].every((dx) => [-.3, .3].every((dz) => world.isLoaded(x + dx, z + dz)));
  pendingTeleport = loaded ? null : { x, y, z, started: worldTimeLocal };
};
net.onSelfHealth = (health) => {
  if (health !== player.health) player.setHealthFromServer(health, false);
};
net.onRespawned = (x, y, z, h) => {
  if (match?.kind === 'pg') held.setBowDraw(0);
  if (match?.kind === 'pg' && pgSub?.game === 'bridge') bridgeRespawnFx(x, y, z);
  player.respawn({ x, y, z });
  // Every Bridge respawn (void, own portal, goal reset) faces down the span.
  if (match?.kind === 'pg' && pgSub?.game === 'bridge') {
    player.yaw = Math.atan2(0, -((pgSub.minZ + pgSub.maxZ) / 2 - z));
    player.pitch = 0;
  }
  player.maxHealth = arenaMaxHealth;
  player.health = h;
  lastHealth = h;
  hurtPulse = 0;
  damageNumbers.clear();
  killBanner.clear();
};
net.onCosmetics = (id) => remotePlayers.invalidate(id);

// ── Combat feedback ────────────────────────────────────────────────────────

const hitmarkerEl = document.createElement('div');
hitmarkerEl.style.cssText = 'position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;z-index:11;pointer-events:none;opacity:0;';
const hitmarkerTicks: HTMLDivElement[] = [];
for (const [x, y, rot] of [['left:1px', 'top:1px', 45], ['right:1px', 'top:1px', -45],
  ['left:1px', 'bottom:1px', -45], ['right:1px', 'bottom:1px', 45]] as [string, string, number][]) {
  const tick = document.createElement('div');
  tick.style.cssText = `position:absolute;${x};${y};width:11px;height:2px;background:#fff;transform:rotate(${rot}deg);box-shadow:0 0 2px rgba(0,0,0,0.9);`;
  hitmarkerEl.appendChild(tick);
  hitmarkerTicks.push(tick);
}
app.appendChild(hitmarkerEl);
let hitmarkerT = 0;
let hitmarkerKill = false;
const HITMARKER_TIME = 0.4;
const damageNumbers = new DamageNumbers(app);
const pvpSlamEl = document.createElement('div');
pvpSlamEl.className = 'pvp-slam';
pvpSlamEl.setAttribute('role', 'status');
app.appendChild(pvpSlamEl);
const killBanner = new KillBanner(pvpSlamEl);
const killChipEl = document.createElement('div');
killChipEl.className = 'pvp-killchip';
app.appendChild(killChipEl);
let killChipT = 0;
let hurtPulse = 0;
let heartbeatTimer = 0;
const hurtVignetteEl = document.getElementById('hurt-vignette') as HTMLDivElement;
const dmgArcWrap = document.createElement('div');
dmgArcWrap.style.cssText = 'position:absolute;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;z-index:11;pointer-events:none;';
app.appendChild(dmgArcWrap);
interface DamageArc { el: HTMLDivElement; x: number; z: number; t: number }
const dmgArcs: DamageArc[] = [];
const DMG_ARC_TIME = 1.6;
let encounterShakeTime = 0;
let encounterShakeStrength = 0;
let fovPunch = 0;

function triggerShake(duration: number, strength: number): void {
  if (accessibility.reducedMotion || accessibility.photosensitivitySafe || accessibility.cameraShake <= 0) return;
  encounterShakeTime = Math.max(encounterShakeTime, duration);
  encounterShakeStrength = Math.max(encounterShakeStrength, strength * accessibility.cameraShake);
}
function updateShake(dt: number): void {
  if (encounterShakeTime <= 0 || accessibility.reducedMotion) return;
  encounterShakeTime = Math.max(0, encounterShakeTime - dt);
  const fade = Math.min(1, encounterShakeTime * 4);
  const x = Math.sin(worldTimeLocal * 79) * encounterShakeStrength * fade;
  const y = Math.cos(worldTimeLocal * 63) * encounterShakeStrength * fade * 0.65;
  camera.position.x += x; camera.position.y += y;
  if (view !== View.First) { viewCamera.position.x += x; viewCamera.position.y += y; }
  encounterShakeStrength *= Math.pow(0.08, dt);
}

function showHitmarker(amount: number, killed: boolean): void {
  hitmarkerT = HITMARKER_TIME;
  hitmarkerKill = killed;
  const color = killed ? '#ff5555' : amount > 0 ? '#ffffff' : '#9fb4c7';
  for (const tick of hitmarkerTicks) {
    tick.style.background = color;
    tick.style.width = killed ? '16px' : '11px';
    tick.style.boxShadow = killed ? '0 0 6px rgba(255,60,80,.9), 0 0 2px rgba(0,0,0,.9)' : '0 0 2px rgba(0,0,0,0.9)';
  }
  audio.hitmarker(killed, amount <= 0);
}
function showPvpHit(targetId: number, amount: number, killed: boolean): void {
  showHitmarker(amount, killed);
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
    if (duelAnnounceEl.classList.contains('visible')) return;
    killChipEl.innerHTML = '';
    killChipEl.textContent = `✖ ELIMINATED ${victim}`;
    killChipEl.classList.remove('visible');
    void killChipEl.offsetWidth;
    killChipEl.style.opacity = '1';
    killChipEl.classList.add('visible');
    killChipT = 2.2;
  }
}
function showDamageFrom(x: number, z: number): void {
  for (const arc of dmgArcs) {
    if (Math.hypot(arc.x - x, arc.z - z) < 4) { arc.x = x; arc.z = z; arc.t = DMG_ARC_TIME; return; }
  }
  if (dmgArcs.length >= 4) dmgArcs.shift()?.el.remove();
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;';
  const wedge = document.createElement('div');
  wedge.style.cssText = 'position:absolute;left:50%;top:6px;width:74px;height:26px;margin-left:-37px;'
    + 'background:linear-gradient(to bottom,rgba(255,52,52,0.95),rgba(255,52,52,0));clip-path:polygon(50% 0,100% 100%,0 100%);';
  el.appendChild(wedge);
  dmgArcWrap.appendChild(el);
  dmgArcs.push({ el, x, z, t: DMG_ARC_TIME });
}
function updateCombatFeedback(dt: number): void {
  if (hitmarkerT > 0) {
    hitmarkerT = Math.max(0, hitmarkerT - dt);
    const k = hitmarkerT / HITMARKER_TIME;
    hitmarkerEl.style.opacity = String(Math.min(1, k * 2.2));
    const scale = (hitmarkerKill ? 1.75 : 1.35) - 0.35 * Math.min(1, k * 1.6);
    const spin = hitmarkerKill ? k * 26 : 0;
    hitmarkerEl.style.transform = `rotate(${spin.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
  } else if (hitmarkerEl.style.opacity !== '0') hitmarkerEl.style.opacity = '0';
  if (killChipT > 0) {
    killChipT = Math.max(0, killChipT - dt);
    if (killChipT <= 0) killChipEl.classList.remove('visible');
    else killChipEl.style.opacity = String(Math.min(1, killChipT / 0.45));
  }
  killBanner.update(dt);
  hurtPulse = Math.max(0, hurtPulse - dt * 2.4);
  const healthFrac = player.maxHealth > 0 ? player.health / player.maxHealth : 1;
  const critical = match && !duelSpectating && healthFrac < 0.32
    ? (1 - healthFrac / 0.32) * (accessibility.reducedMotion ? 0.3 : 0.24 + Math.sin(worldTimeLocal * 5.4) * 0.07) : 0;
  const cap = accessibility.photosensitivitySafe ? 0.24 : 0.62;
  hurtVignetteEl.style.opacity = String(Math.min(cap, hurtPulse * 0.62 + critical));
  if (critical > 0 && screen !== 'title') {
    const urgency = Math.min(1, 1 - healthFrac / 0.32);
    heartbeatTimer -= dt;
    if (heartbeatTimer <= 0) { audio.heartbeat(urgency); heartbeatTimer = 1.15 - urgency * 0.45; }
  } else heartbeatTimer = 0;
  if (!dmgArcs.length) return;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  for (let i = dmgArcs.length - 1; i >= 0; i--) {
    const arc = dmgArcs[i];
    arc.t -= dt;
    if (arc.t <= 0) { arc.el.remove(); dmgArcs.splice(i, 1); continue; }
    const dx = arc.x - player.pos.x, dz = arc.z - player.pos.z;
    arc.el.style.transform = `rotate(${Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz)}rad)`;
    arc.el.style.opacity = String(Math.min(1, arc.t / (DMG_ARC_TIME * 0.6)));
  }
}

net.onHurt = (health, k, by) => {
  const bite = Math.max(0, player.health - health);
  player.setHealthFromServer(health, false);
  player.vel.x += k[0] * 6; player.vel.y += k[1] * 6; player.vel.z += k[2] * 6;
  hurtPulse = Math.min(1, Math.max(hurtPulse, 0.34 + bite / 13));
  triggerShake(0.13, Math.min(0.05, 0.006 + bite * 0.0016));
  const attacker = net.remotes.get(by);
  if (attacker && by !== net.myId) showDamageFrom(attacker.tx, attacker.tz);
};
net.onHitConfirm = (target, amount, killed) => showPvpHit(target, amount, killed);
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
net.onKillfeed = (killer, victim) => { if (match?.kind === 'duel') pushDuelKill(killer, victim); };

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

const useBarEl = document.getElementById('use-bar') as HTMLDivElement;
const useBarFill = useBarEl.querySelector('.use-fill') as HTMLDivElement;
const useBarLabel = useBarEl.querySelector('.use-label') as HTMLDivElement;
const healGlowEl = document.getElementById('heal-glow') as HTMLDivElement;
const heartsEl = document.getElementById('hearts') as HTMLCanvasElement;
const healTallyEl = document.getElementById('heal-tally') as HTMLDivElement;
const healBurstEl = document.getElementById('heal-burst') as HTMLDivElement;
let healGlow = 0, healBuff = 0, heartsSqueeze = 0, healBeatCount = 0;
let healTally = 0, healTallyFade = 0, healTickStep = 0, healSpiralT = 0, healPulseT = 0, useBarDoneT = 0;

function renderHealTally(): void {
  if (healTally <= 0) { healTallyEl.dataset.show = ''; return; }
  healTallyEl.dataset.show = '1';
  healTallyEl.textContent = `+${healTally}`;
  healTallyEl.classList.remove('bump');
  void healTallyEl.offsetWidth;
  healTallyEl.classList.add('bump');
}
function beginHealUse(): void {
  if (healUse.active) return;
  const stack = inventory.selectedStack;
  const heal = stack ? ITEMS[stack.id]?.heal : undefined;
  if (!stack || !heal) return;
  if (player.health >= player.maxHealth) { toast("You're already at full health!", 1600); return; }
  healUse.start(stack.id, inventory.selected);
  healBeatCount = 0;
  useBarDoneT = 0;
  audio.healStart();
  useBarEl.classList.remove('done');
  held.swing();
}
function cancelHealUse(): void {
  if (!healUse.active) return;
  healUse.cancel();
  audio.healCancel();
}
function finishHealUse(id: number): void {
  const heal = ITEMS[id]?.heal;
  if (!heal || inventory.selectedStack?.id !== id) return;
  inventory.consumeSelected(1);
  net.sendUseHeal(id);
  audio.heal();
  healBuff = heal.duration;
  healTally = 0; healTickStep = 0; healTallyFade = 0;
  healGlow = 1;
  heartsSqueeze = 0.3;
  useBarDoneT = 0.42;
  useBarEl.classList.add('done');
  particles.heal(player.pos.x, player.pos.y + 1, player.pos.z, 30);
  particles.healRing(player.pos.x, player.pos.y + 0.9, player.pos.z);
  fovPunch = accessibility.reducedMotion ? 0 : 7;
  triggerShake(0.18, 0.05);
  if (!accessibility.photosensitivitySafe) {
    healBurstEl.classList.remove('go');
    void healBurstEl.offsetWidth;
    healBurstEl.classList.add('go');
  }
  healSpiralT = 0; healPulseT = 0.9;
}
function updateHealFeel(dt: number, active: boolean): void {
  if (healUse.active) {
    const stack = inventory.selectedStack;
    if (!active || inventory.selected !== healUse.slot || stack?.id !== healUse.itemId) cancelHealUse();
    else {
      const step = healUse.tick(dt);
      for (let i = 0; i < step.beats; i++) {
        audio.healBeat(healBeatCount++);
        particles.heal(player.pos.x, player.pos.y + 1.1, player.pos.z, 5);
        useBarEl.classList.remove('beat');
        void useBarEl.offsetWidth;
        useBarEl.classList.add('beat');
      }
      if (step.done) finishHealUse(step.item);
    }
  }
  useBarDoneT = Math.max(0, useBarDoneT - dt);
  if (healUse.active) {
    useBarEl.style.display = 'block';
    useBarFill.style.width = `${(healUse.progress * 100).toFixed(1)}%`;
    const name = (ITEMS[healUse.itemId]?.name ?? 'Applying').toUpperCase();
    useBarLabel.textContent = `${name} · ${Math.max(0, healUse.duration - healUse.elapsed).toFixed(1)}s`;
  } else if (useBarDoneT > 0) {
    useBarFill.style.width = '100%';
    useBarLabel.textContent = 'STIM IN — REGENERATING';
  } else {
    useBarEl.style.display = 'none';
    useBarEl.classList.remove('done');
  }
  if (healBuff > 0) {
    healSpiralT -= dt;
    if (healSpiralT <= 0) { healSpiralT = 0.09; particles.healSpiral(player.pos.x, player.pos.y + 0.15, player.pos.z, worldTimeLocal * 5.5); }
    healPulseT -= dt;
    if (healPulseT <= 0) { healPulseT = 0.95 + (1 - healBuff / 8) * 0.5; audio.healPulse(1 - healBuff / 8); }
  }
  fovPunch = Math.max(0, fovPunch - dt * 18);
  if (healBuff <= 0 && healTally > 0) {
    healTallyFade += dt;
    if (healTallyFade > 1.4) { healTally = 0; healTallyEl.dataset.show = ''; }
  }
  if (healBuff > 0) {
    healBuff = Math.max(0, healBuff - dt);
    const breathe = accessibility.reducedMotion ? 0.5 : 0.5 + Math.sin(worldTimeLocal * 3.2) * 0.18;
    healGlow = Math.max(healGlow - dt * 1.6, 0.26 * breathe);
  } else healGlow = Math.max(0, healGlow - dt * 1.8);
  healGlowEl.style.opacity = String(Math.min(accessibility.photosensitivitySafe ? 0.22 : 0.5, healGlow * 0.55));
  heartsSqueeze = Math.max(0, heartsSqueeze - dt);
  heartsEl.style.transform = heartsSqueeze > 0 && !accessibility.reducedMotion ? 'scale(1.14)' : 'scale(1)';
}
function onHealthRestored(amount: number): void {
  if (healBuff <= 0 || amount <= 0) return;
  healTally += amount;
  renderHealTally();
  audio.healTick(healTickStep++);
  healGlow = Math.min(1, healGlow + 0.22);
  heartsSqueeze = 0.16;
  particles.heal(player.pos.x, player.pos.y + 1, player.pos.z, 4);
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
let duelCountdownEndsAt = 0;
let duelRespawnAt = 0;
let duelSpectating = false;
let duelClockServer = 0;
let duelClockLocal = performance.now();
let duelLastCountdownCue = -1;
let duelLastLeaderKey = '';
let duelFinalThirtyPlayed = false;
let duelSuddenDeathPlayed = false;
let duelFightPlayed = false;
let duelFightCueUntil = 0;
let duelResultData: DuelResult | null = null;
let duelScoresHeld = false;
let duelFeedSeen = 0;
let duelAnnounceUntil = 0;
const duelLastKills = new Map<number, number>();

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
duelScoresTouch.textContent = 'Scores';
app.appendChild(duelScoresTouch);
const duelResultEl = document.createElement('div'); duelResultEl.className = 'duel-result';
duelResultEl.setAttribute('role', 'dialog'); duelResultEl.setAttribute('aria-modal', 'true');
duelResultEl.setAttribute('aria-label', 'Duels match result');
duelResultEl.style.setProperty('--rank', '#e3a12a');
duelResultEl.style.setProperty('--rank-accent', '#ffd272');
duelResultEl.style.setProperty('--rank-shade', '#9e6912');
const duelResultCard = document.createElement('div'); duelResultCard.className = 'duel-result-card';
duelResultEl.appendChild(duelResultCard); app.appendChild(duelResultEl);

const DUEL_EVENT_COLORS: Record<DuelEventKind, string> = {
  first_blood: '#ff6d80', double_kill: '#7fd3f5', triple_kill: '#5ad0ff', quad_kill: '#a273f7',
  spree: '#ffd45e', rampage: '#ff9a3c', unstoppable: '#ff5f76', godlike: '#ff4f6e',
  shutdown: '#55e8a6', revenge: '#c08cff', match_point: '#ffe6a4',
};

function duelNow(): number { return duelClockServer + (performance.now() - duelClockLocal); }
function syncDuelClock(serverNow: number): void { duelClockServer = serverNow; duelClockLocal = performance.now(); }
function formatDuelTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function duelStatus(p: DuelParticipant): string {
  if (!p.connected) return 'Left';
  if (p.spectating && p.respawnAt) return 'Respawning';
  if (p.spectating) return 'Watching';
  return p.alive ? 'Alive' : 'Respawning';
}
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
function pushDuelKill(killer: string, victim: string): void { pushDuelFeedRow(killer || 'ELIMINATED', victim, '#9fb6cc'); }
function playDuelFeed(feed: DuelEvent[]): void {
  if (!match) { duelFeedSeen = Math.max(duelFeedSeen, ...feed.map((e) => e.seq), 0); return; }
  const fresh = feed.filter((event) => event.seq > duelFeedSeen).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return;
  duelFeedSeen = fresh[fresh.length - 1].seq;
  for (const event of fresh) {
    if (event.actor === net.myId || event.victim === net.myId) continue;
    const copy = duelEventCopy(event);
    pushDuelFeedRow(copy.title, copy.sub, DUEL_EVENT_COLORS[event.kind]);
  }
  const mine = fresh.filter((event) => event.actor === net.myId || event.victim === net.myId);
  if (!mine.length) return;
  const headline = mine[mine.length - 1];
  const copy = duelEventCopy(headline);
  duelAnnounceEl.style.setProperty('--announce', DUEL_EVENT_COLORS[headline.kind]);
  duelAnnounceTitle.textContent = copy.title;
  duelAnnounceSub.textContent = copy.sub;
  duelAnnounceEl.classList.remove('visible', 'out');
  void duelAnnounceEl.offsetWidth;
  duelAnnounceEl.classList.add('visible');
  duelAnnounceUntil = duelNow() + 2_200;
  audio.duelAnnounce(headline.kind);
}
function updateDuelAnnounce(now: number): void {
  if (!duelAnnounceEl.classList.contains('visible') || now < duelAnnounceUntil) return;
  if (!duelAnnounceEl.classList.contains('out')) { duelAnnounceEl.classList.add('out'); duelAnnounceUntil = now + 400; return; }
  duelAnnounceEl.classList.remove('visible', 'out');
}
function duelScoreRows(players: DuelParticipant[]): HTMLElement {
  const rows = document.createElement('div');
  const head = document.createElement('div'); head.className = 'duel-score-row header';
  for (const label of ['#', 'Player', 'Kills', 'Deaths', 'K/D']) {
    const cell = document.createElement('span'); cell.textContent = label; head.appendChild(cell);
  }
  const statusHead = document.createElement('span'); statusHead.className = 'duel-score-status'; statusHead.textContent = 'Status';
  head.appendChild(statusHead);
  rows.appendChild(head);
  const topKills = players[0]?.kills ?? 0;
  players.forEach((p, index) => {
    const row = document.createElement('div');
    row.className = `duel-score-row${p.id === net.myId ? ' local' : ''}`;
    const place = document.createElement('span'); place.textContent = String(index + 1);
    const name = document.createElement('strong');
    if (p.kills === topKills && topKills > 0) {
      const mark = document.createElement('span'); mark.className = 'duel-leader-mark'; mark.innerHTML = iconSvg('diamond');
      name.appendChild(mark);
    }
    const who = document.createElement('span'); who.textContent = p.username; name.appendChild(who);
    if (p.spree >= 3) { const spree = document.createElement('span'); spree.className = 'duel-score-spree'; spree.textContent = `${p.spree}×`; name.appendChild(spree); }
    const kills = document.createElement('span'); kills.className = 'duel-score-kills'; kills.textContent = String(p.kills);
    const deaths = document.createElement('span'); deaths.textContent = String(p.deaths);
    const kd = document.createElement('span'); kd.textContent = p.deaths === 0 ? p.kills.toFixed(1) : (p.kills / p.deaths).toFixed(2);
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
  head.append(title, hint);
  duelScorePanel.append(head, duelScoreRows(players));
}
function setDuelScoresVisible(visible: boolean): void {
  duelScoresHeld = visible;
  duelScoreboard.classList.toggle('visible', visible && match?.kind === 'duel' && !duelResultData);
  if (visible) renderDuelScoreboard();
}
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || match?.kind !== 'duel' || duelResultData) return;
  event.preventDefault();
  if (!event.repeat) setDuelScoresVisible(true);
});
window.addEventListener('keyup', (event) => {
  if (event.key === 'Tab' && match?.kind === 'duel') { event.preventDefault(); setDuelScoresVisible(false); }
});
window.addEventListener('blur', () => setDuelScoresVisible(false));
for (const type of ['pointerdown', 'touchstart'] as const) {
  duelScoresTouch.addEventListener(type, (event) => { event.preventDefault(); setDuelScoresVisible(true); });
}
for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const) {
  duelScoresTouch.addEventListener(type, (event) => { event.preventDefault(); setDuelScoresVisible(false); });
}

/** Am I in a party whose leader is somebody else? Then "play again" is theirs. */
function followerInParty(): boolean {
  return !!myParty && myParty.members.length > 1 && myParty.leader !== net.myId;
}
function resultButtons(mode: GameMode): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'duel-result-controls';
  const again = document.createElement('button'); again.type = 'button'; again.className = 'primary';
  const menu = document.createElement('button'); menu.type = 'button'; menu.textContent = 'Menu';
  if (followerInParty()) {
    again.textContent = 'Waiting for the leader';
    again.disabled = true;
  } else {
    again.textContent = myParty && myParty.members.length > 1 ? 'Play again with party' : 'Play again';
    again.addEventListener('click', () => { again.disabled = true; menu.disabled = true; net.send({ t: 'play', mode }); });
  }
  menu.addEventListener('click', () => { again.disabled = true; menu.disabled = true; net.send({ t: 'leaveMatch' }); });
  controls.append(again, menu);
  return controls;
}
function duelResultRecap(result: DuelResult): string[] {
  const chips: string[] = [];
  const best = [...result.scoreboard].sort((a, b) => b.bestSpree - a.bestSpree)[0];
  if (best && best.bestSpree >= 3) chips.push(`Best spree · ${best.username} ×${best.bestSpree}`);
  const firstBlood = result.feed.find((event) => event.kind === 'first_blood');
  if (firstBlood) chips.push(`First blood · ${firstBlood.actorName}`);
  chips.push(`${result.scoreboard.reduce((sum, p) => sum + p.kills, 0)} total kills`);
  return chips;
}
function renderDuelResult(result: DuelResult): void {
  duelResultData = result;
  screen = 'results';
  input.unlock();
  pauseEl.style.display = 'none';
  duelAnnounceEl.classList.remove('visible', 'out');
  duelKillFeedEl.replaceChildren();
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
    sudden_death: 'sudden death', forfeit: 'opponent left', cancelled: 'the arena could not load for everyone',
  };
  summary.textContent = `${formatDuelTime(result.durationMs)} · ${reasonText[result.finishReason]}`;
  const recap = document.createElement('div'); recap.className = 'duel-result-recap';
  for (const text of duelResultRecap(result)) { const chip = document.createElement('span'); chip.textContent = text; recap.appendChild(chip); }
  const scores = document.createElement('div'); scores.className = 'duel-result-score';
  scores.appendChild(duelScoreRows(result.scoreboard));
  const controls = resultButtons('duels');
  duelResultCard.append(kicker, title, summary, recap, scores, controls);
  duelResultEl.classList.add('visible');
  duelScoreboard.classList.remove('visible');
  requestAnimationFrame(() => controls.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
}

let duelPillNodes = new Map<number, { root: HTMLElement; score: HTMLElement }>();
let duelPillKey = '';
function renderDuelPills(board: DuelParticipant[]): void {
  const key = board.map((p) => p.id).join(',');
  if (key !== duelPillKey) {
    duelPillKey = key;
    duelPillNodes = new Map();
    duelPillsEl.replaceChildren();
    for (const p of board) {
      const pill = document.createElement('div'); pill.className = 'duel-pill';
      const swatch = document.createElement('i');
      const c = new THREE.Color().setHSL((p.skin % 360) / 360, 0.55, 0.55);
      swatch.style.background = `#${c.getHexString()}`;
      const name = document.createElement('span'); name.textContent = p.username;
      const score = document.createElement('b');
      pill.append(swatch, name, score);
      duelPillsEl.appendChild(pill);
      duelPillNodes.set(p.id, { root: pill, score });
    }
  }
  const topKills = Math.max(0, ...board.map((p) => p.kills));
  for (const p of board) {
    const node = duelPillNodes.get(p.id);
    if (!node) continue;
    node.score.textContent = String(p.kills);
    node.root.classList.toggle('me', p.id === net.myId);
    node.root.classList.toggle('leader', p.kills === topKills && topKills > 0);
    node.root.classList.toggle('down', !p.alive || !p.connected);
    if ((duelLastKills.get(p.id) ?? p.kills) !== p.kills) {
      node.root.classList.remove('bump');
      void node.root.offsetWidth;
      if (!accessibility.reducedMotion) node.root.classList.add('bump');
    }
    duelLastKills.set(p.id, p.kills);
  }
}
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
  if (!accessibility.reducedMotion) { void duelCenterCue.offsetWidth; duelCenterCue.classList.add('slam'); }
}
function updateDuelHud(): void {
  if (match?.kind !== 'duel' || !duelSnapshot) {
    duelMatchHud.classList.remove('visible'); duelScoresTouch.classList.remove('visible');
    if (duelCueText) setDuelCue('');
    return;
  }
  duelMatchHud.classList.add('visible'); duelScoresTouch.classList.add('visible');
  const now = duelNow();
  const board = duelSnapshot.participants;
  renderDuelPills(board);
  updateDuelAnnounce(now);
  const topKills = Math.max(0, ...board.map((p) => p.kills));
  const leaderKey = board.filter((p) => p.kills === topKills).map((p) => p.id).join(',');
  if (duelSnapshot.phase === 'running' && duelLastLeaderKey && topKills > 0 && leaderKey && leaderKey !== duelLastLeaderKey) audio.duelCue('lead');
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
    if (duelSnapshot.phase === 'running' && remaining <= 30_000 && remaining > 0 && !duelFinalThirtyPlayed) {
      duelFinalThirtyPlayed = true; audio.duelCue('final30');
    }
  }
  let cue = '', tone: '' | 'go' | 'danger' = '';
  if (duelSnapshot.phase === 'countdown') {
    const countdownAt = duelSnapshot.countdownEndsAt ?? duelCountdownEndsAt;
    if (!countdownAt) cue = 'WAITING FOR PLAYERS';
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
    if (!duelFightPlayed) { duelFightPlayed = true; duelFightCueUntil = now + 900; audio.duelCue('fight'); }
    if (now < duelFightCueUntil) { cue = 'FIGHT'; tone = 'go'; }
  }
  setDuelCue(duelAnnounceEl.classList.contains('visible') && cue.length > 2 ? '' : cue, tone);
  if (duelScoresHeld) renderDuelScoreboard();
}

const duelRules = {
  canPlaceAt(x: number, y: number, z: number, heldId: number): boolean {
    const a = duelActiveBounds;
    if (!a || (duelSnapshot?.phase !== 'running' && duelSnapshot?.phase !== 'sudden_death') || heldId !== Block.OakPlanks) return false;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < a.minX || bx >= a.maxX || bz < a.minZ || bz >= a.maxZ || by < a.floor || by >= a.ceiling - 1) return false;
    const groundY = a.floor + duelTerrainElevation(bx - a.minX, bz - a.minZ);
    return by > groundY && by <= groundY + DUEL_MAX_PILLAR_HEIGHT;
  },
  canEditAt(x: number, y: number, z: number, heldId: number): boolean {
    const a = duelActiveBounds;
    if (!a || (duelSnapshot?.phase !== 'running' && duelSnapshot?.phase !== 'sudden_death')) return false;
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
  duelCountdownEndsAt = countdownEndsAt;
  duelLastCountdownCue = -1; duelCueText = ''; duelLastLeaderKey = '';
  duelFinalThirtyPlayed = false; duelSuddenDeathPlayed = false; duelFightPlayed = false; duelFightCueUntil = 0;
  duelFeedSeen = 0;
  duelLastKills.clear(); duelPillKey = '';
  duelKillFeedEl.replaceChildren();
  duelAnnounceEl.classList.remove('visible', 'out');
  duelResultData = null;
  duelResultEl.classList.remove('visible');
  duelSpectating = false;
  pgSnapshot = null; partyUI.setVisible(false);
  player.maxHealth = DUEL_MAX_HEALTH; player.health = DUEL_MAX_HEALTH; lastHealth = DUEL_MAX_HEALTH;
  player.yaw = spawn.x < arena.minX + (arena.maxX - arena.minX) / 2 ? -Math.PI * .75 : Math.PI * .75;
  enterMatchWorld(spec, 'duel', 'duels', spawn);
};
net.onDuelState = (snapshot) => {
  duelSnapshot = snapshot;
  syncDuelClock(snapshot.serverNow);
  if (snapshot.phase !== 'lobby') { playDuelFeed(snapshot.feed); if (duelScoresHeld) renderDuelScoreboard(); }
};
net.onDuelLoadout = (slots, selected) => {
  inventory.restore(slots, selected);
  arenaUnlimited = new Set<number>([Block.OakPlanks, Item.Bullet]);
  fireCooldown = 0; reloadTimer = 0; burstRemaining = 0; healUse.cancel();
};
net.onDuelClock = (serverNow) => syncDuelClock(serverNow);
net.onDuelRespawn = (respawnAt, spectating) => {
  duelRespawnAt = respawnAt; duelSpectating = spectating;
  if (spectating) {
    damageNumbers.clear(); hurtPulse = 0;
    burstRemaining = 0; burstStack = null; burstGun = null;
    reloadTimer = 0; reloadingStack = null; aimZoom = 1; healUse.cancel();
  }
  player.flying = spectating; player.noclip = spectating;
  if (!spectating) player.health = arenaMaxHealth;
};
net.onPgRespawn = (respawnAt, spectating) => {
  duelSpectating = spectating;
  if (spectating) { held.setBowDraw(0); damageNumbers.clear(); hurtPulse = 0; bridgeDeathFx(respawnAt); }
  else bridgeFxEl.classList.remove('dead');
  player.flying = spectating; player.noclip = spectating;
};
net.onDuelResult = (result) => renderDuelResult(result);

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
const BRIDGE_TEAM_HEX = [0xff5f76, 0x5aa8ff];
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
  if (!accessibility.reducedMotion) fovPunch = Math.max(fovPunch, 6);
  hurtPulse = 1;
}
function bridgeRespawnFx(x: number, y: number, z: number): void {
  bridgeFxEl.classList.remove('dead', 'reborn');
  void bridgeFxEl.offsetWidth;
  bridgeFxEl.classList.add('reborn');
  particles.respawnBeam(x, y, z, bridgeTeamColor(net.myId));
  audio.bridgeRespawn(true);
  triggerShake(0.14, 0.02);
  if (!accessibility.reducedMotion) fovPunch = Math.max(fovPunch, 5);
}
function bridgeKillHealFx(gain: number): void {
  particles.killHeal(player.pos.x, player.pos.y, player.pos.z);
  audio.killHeal();
  healGlow = 1;
  heartsSqueeze = 0.6;
  if (gain > 0) { healTally = gain; healTallyFade = 0; renderHealTally(); }
  triggerShake(0.16, 0.02);
  if (!accessibility.reducedMotion) fovPunch = Math.max(fovPunch, 4);
  if (!accessibility.photosensitivitySafe) {
    healBurstEl.classList.remove('go');
    void healBurstEl.offsetWidth;
    healBurstEl.classList.add('go');
  }
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
  return match?.kind === 'pg' && pgSub?.game === 'bridge' && pgSnapshot?.phase === 'running' && !pgCaged();
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
    const color = team === 0 ? 0xff5f76 : 0x5aa8ff;
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
  const color = team === 0 ? 0xff5f76 : 0x5aa8ff;
  const x = sub.minX + (portal.minX + portal.maxX) / 2, z = sub.minZ + (portal.minZ + portal.maxZ) / 2;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    window.setTimeout(() => {
      particles.burst(x + Math.cos(a) * 3, PARTY_FLOOR_Y + 5 + i * 1.3, z + Math.sin(a) * 3, 22,
        i % 2 ? 0xffffff : color, 8, 1.1, { gravity: 5, spread: 0.6, scale: 0.8 });
    }, i * 140);
  }
};

net.onPgArena = (spec, _arena, sub, team, spawn) => {
  pgSub = sub;
  duelSnapshot = null; duelResultData = null; duelResultEl.classList.remove('visible');
  arenaMaxHealth = PARTY_MAX_HEALTH; arenaHpPerHeart = 2;
  remotePlayers.maxHealth = PARTY_MAX_HEALTH;
  const wool = BRIDGE_TEAM_BLOCK[team] ?? Block.TeamWoolA;
  const bridge = sub.game === 'bridge';
  arenaCanPlaceAt = (x, y, z, heldId) => pgSnapshot?.phase === 'running' && heldId === wool &&
    x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ &&
    y >= (bridge ? PARTY_VOID_Y : PARTY_FLOOR_Y - 3) && y < (bridge ? PARTY_FLOOR_Y + 16 : PARTY_CEILING_Y) &&
    !(bridge && bridgeGoalGuard(Math.floor(x) - sub.minX, Math.floor(z) - sub.minZ)) &&
    !(!bridge && parkourBuildBlocked(parkourCourse(sub.seed), Math.floor(x) - sub.minX, Math.floor(y), Math.floor(z) - sub.minZ));
  arenaCanEditAt = (x, y, z, heldId) => {
    const block = world.getBlock(x, y, z);
    if (block === Block.TeamWoolA || block === Block.TeamWoolB) return x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ;
    return block === Block.Air && !!arenaCanPlaceAt?.(x, y, z, heldId);
  };
  arenaClampPos = (pos) => clampToPartySub(pos, sub);
  arenaUnlimited = new Set([wool, Item.BridgeArrow]);
  world.setArenaRenderBounds(sub, PARTY_AMBIENT_LIGHT);
  partyUI.setVisible(true);
  partyUI.setSnapshot(pgSnapshot, net.myId);
  partyUI.showRound(sub.game, performance.now());
  player.maxHealth = PARTY_MAX_HEALTH; player.health = PARTY_MAX_HEALTH; lastHealth = PARTY_MAX_HEALTH;
  if (sub.game === 'parkour') {
    const target = parkourCourse(sub.seed).steps[1][0];
    player.yaw = Math.atan2(-(sub.minX + target.x - spawn.x), -(sub.minZ + target.z - spawn.z));
  } else {
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
    screen = 'results'; input.unlock(); pauseEl.style.display = 'none';
  }
  partyUI.replayLabel = followerInParty() ? '' : myParty && myParty.members.length > 1 ? 'Play again with party' : 'Play again';
  partyUI.setSnapshot(snapshot, net.myId);
};
net.onPgLoadout = (slots, selected) => {
  held.setBowDraw(0);
  partySwingAt = -1e9; partyShotAt = -1e9;
  partyUI.bowReadyAt = 0;
  inventory.restore(slots, selected);
  fireCooldown = 0; reloadTimer = 0; burstRemaining = 0; healUse.cancel();
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
    if (crit && !accessibility.reducedMotion) fovPunch = Math.max(fovPunch, 3);
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
  if (match?.kind === 'pg') { screen = 'results'; input.unlock(); pauseEl.style.display = 'none'; }
};

// ── Rat and Seek ───────────────────────────────────────────────────────────

net.onRsArena = (spec, role, spawn, yaw) => {
  duelSnapshot = null; duelResultData = null; duelResultEl.classList.remove('visible');
  pgSnapshot = null; pgSub = null; partyUI.setVisible(false);
  arenaMaxHealth = 20; arenaHpPerHeart = 2; remotePlayers.maxHealth = 20;
  arenaCanPlaceAt = null; arenaCanEditAt = null; arenaClampPos = null;
  arenaUnlimited = new Set();
  player.maxHealth = 20; player.health = 20; lastHealth = 20;
  player.yaw = yaw;
  rsClient.enter(role);
  enterMatchWorld(spec, 'rs', 'ratseek', spawn);
};
net.onRsState = (s) => {
  if (match?.kind !== 'rs') return;
  rsClient.onState(s);
  if (!rsClient.canPickSeeker()) seekerPick?.abort();
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
    if (stack && isClassBadge(stack.id)) { rsClient.openPicker(); return; }
    if (stack?.id === Item.SeekerPicker) { openSeekerPick(); return; }
    const t = interaction.target;
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
  if (!pgWeaponsActive() || screen !== 'playing' ||
      (inventory.selectedStack?.id !== Item.BridgeBow && inventory.selectedStack?.id !== Item.IronAxe)) held.setBowDraw(0);
  if (match?.kind !== 'pg' || !pgSnapshot) {
    partyVisuals.updateArrows(dt);
    axeIndicatorEl.style.display = 'none';
    return;
  }
  const now = pgNow();
  partyUI.update(performance.now(), now);
  partyVisuals.update(pgSnapshot, net.myId, now);
  partyVisuals.updateArrows(dt);
  const show = pgWeaponsActive() && screen === 'playing' && view === View.First && inventory.selectedStack?.id === Item.IronAxe;
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
  if (match?.kind === 'rs') return rsClient.frozen() || screen === 'results';
  if (match?.kind === 'pg') return pgSnapshot?.phase !== 'running' || pgCaged();
  if (match?.kind === 'duel') return !duelSnapshot || duelSnapshot.phase === 'countdown' || duelSnapshot.phase === 'results' || screen === 'results';
  return true;
}

// ── Camera, views and your own avatar ──────────────────────────────────────

const boomEye = new THREE.Vector3(), boomDir = new THREE.Vector3(), boomProbe = new THREE.Vector3();
function updateCamera(): void {
  camera.position.copy(player.eyePosition);
  camera.rotation.set(player.pitch, player.yaw, player.damageFlash * 0.18);
  const base = player.sprinting ? SPRINT_FOV : FOV;
  const targetFov = base / aimZoom + (aimZoom > 1 ? 0 : speedFov) - fovPunch;
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
let selfHeldMesh: THREE.Object3D | null = null;
let selfWalkPhase = 0;
let selfSneakT = 0;
const selfItemMat = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.4, vertexColors: true, side: THREE.DoubleSide });
function hideSelfAvatar(): void { if (selfBody) selfBody.group.visible = false; }
function invalidateSelfAvatar(): void {
  if (!selfBody) return;
  if (selfHeldMesh) { selfHeldMesh.parent?.remove(selfHeldMesh); selfHeldMesh = null; }
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
    if (selfHeldMesh) { selfHeldMesh.parent?.remove(selfHeldMesh); selfHeldMesh = null; }
    if (heldId > 0 && ITEMS[heldId]) {
      const mesh = isGunItem(heldId) ? createGunModel()
        : isModeledGadget(heldId) ? createGadgetModel()
        : new THREE.Mesh(itemGeometry(atlas, heldId), selfItemMat);
      if (isGunItem(heldId)) poseGunModel(mesh, 'avatar');
      else if (isModeledGadget(heldId)) poseGadgetModel(mesh, 'avatar');
      else { mesh.position.set(0, -0.68, -0.2); mesh.rotation.set(-0.5, 0, 0); mesh.scale.setScalar(ITEMS[heldId].kind === 'block' ? 1.5 : 1.1); }
      (isGunItem(heldId) ? b.group : b.parts[3]).add(mesh);
      selfHeldMesh = mesh;
    }
  }
  releaseGunHold(b);
  const sneakTarget = player.sneaking ? 1 : 0;
  selfSneakT += (sneakTarget - selfSneakT) * Math.min(1, 12 * dt);
  applyAvatarSneak(b, selfSneakT);
  b.head.rotation.x = player.pitch + selfSneakT * 0.12;
  const hspeed = Math.hypot(player.vel.x, player.vel.z);
  selfWalkPhase += Math.min(hspeed, 7) * dt * 2.4;
  const pose = stridePose(selfWalkPhase, hspeed, selfSneakT, selfHeldId > 0, held.swingAmount());
  b.parts[0].rotation.x = pose.legs[0]; b.parts[1].rotation.x = pose.legs[1];
  b.parts[2].rotation.x = pose.arms[0]; b.parts[2].rotation.z = 0;
  b.parts[3].rotation.x = pose.arms[1]; b.parts[3].rotation.z = pose.rightArmRoll;
  if (isGunItem(selfHeldId) && selfHeldMesh) {
    const reloadProgress = reloadTimer > 0 && reloadDuration > 0 ? 1 - reloadTimer / reloadDuration : -1;
    poseGunHold(b, selfHeldMesh, { pitch: player.pitch, aim: aimZoom > 1 ? 1 : 0,
      reload: reloadProgress >= 0 ? Math.sin(reloadProgress * Math.PI) : 0, kick: held.recoilAmount() });
  } else if (isModeledGadget(selfHeldId)) {
    const action = held.recoilAmount();
    b.parts[2].rotation.x = 0.45 + action * 0.18; b.parts[3].rotation.x = 0.62 + action * 0.48;
    b.parts[2].rotation.z = -0.18; b.parts[3].rotation.z = 0.08;
  }
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
    input.endFrame();
    return;
  }

  updateDuelHud();
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

  const controlling = input.locked && !controlBlocked() && screen === 'playing';
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
      shown: screen === 'playing' || screen === 'paused', playing: controlling && !duelSpectating,
      gun: !!(hs && ITEMS[hs.id]?.gun),
      action: match.kind === 'rs' ? (rsClient.role === 'human' ? 'interact' : hs ? 'use' : 'none')
        : !hs ? 'none' : ITEMS[hs.id]?.gun ? 'attack' : ITEMS[hs.id]?.kind === 'block' ? 'build'
        : hs.id === Item.IronAxe ? 'attack' : 'use',
      label: match.kind === 'rs' ? 'USE' : hs?.id === Item.BridgeBow ? 'SHOOT' : hs && ITEMS[hs.id]?.heal ? 'HEAL'
        : hs?.id === Item.JumpBoost ? 'BOOST' : undefined,
      retry: match.kind === 'pg' && pgSub?.game === 'parkour' && parkourCourse(pgSub.seed).variant.mode !== 'collapse',
      context: `${match.mode}:${inventory.selected}:${hs?.id ?? 0}`,
    });
  }
  const moveInput = controlling ? input : FROZEN_INPUT;
  if (pendingTeleport) {
    const tp = pendingTeleport;
    player.pos.set(tp.x, tp.y, tp.z);
    player.vel.set(0, 0, 0);
    player.fallDistance = 0;
    const bubbleReady = world.update(tp.x, tp.z, 20, 2);
    if (bubbleReady || worldTimeLocal - tp.started > 4) {
      pendingTeleport = null;
      if (bubbleReady) { hideLoading(); sendReady(); }
    }
  }
  player.update(dt, moveInput, world);
  if (controlling && match.kind === 'pg' && pgSub?.game === 'parkour' && input.reloadPressed &&
      parkourCourse(pgSub.seed).variant.mode !== 'collapse') net.sendPgRetry();
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
    if (match.kind === 'rs') {
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
  }

  net.sendXform(dt, player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch,
    player.sneaking, inventory.selectedStack?.id ?? 0, heldSwingSeq, aimZoom > 1, reloadTimer > 0);
  worldTimeLocal += dt;

  const activeCamera: THREE.Camera = view === View.First ? camera : viewCamera;
  updateSelfAvatar(dt);
  world.update(player.pos.x, player.pos.z, 6, match.kind === 'pg' ? 10 : match.kind === 'rs' ? 5 : 3);
  const tod = match.kind === 'pg' && pgSub ? parkourTheme(pgSub.seed).time : match.kind === 'rs' ? RS_TIME_OF_DAY : 0.25;
  sky.update(dt, activeCamera, tod);
  updateAtmosphere(activeCamera);
  particles.update(dt, activeCamera);
  if (controlling) {
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    remotePlayers.setHovered(remotePlayers.rayHit(player.eyePosition, lookDir, 60));
  } else remotePlayers.setHovered(-1);
  remotePlayers.update(dt);
  projectiles.update(dt);
  updateCombatFeedback(dt);
  updatePartyFrame(dt);
  if (match.kind === 'rs') {
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    rsClient.frame(dt, player.yaw, player.eyePosition, look, view !== View.First);
  }
  damageNumbers.update(dt, activeCamera);

  audio.updateListener(activeCamera);
  if (player.health < lastHealth) audio.hurt();
  else if (player.health > lastHealth) onHealthRestored(player.health - lastHealth);
  lastHealth = player.health;
  updateHealFeel(dt, controlling && !duelSpectating);
  updateBridgeFx();

  const firstPersonActive = !duelSpectating && view === View.First && screen !== 'results' &&
    !(match.kind === 'rs' && rsClient.phase() === 'intro');
  held.setActive(firstPersonActive);
  held.setPaws(rsClient.selfIsRat());
  held.setItem(!duelSpectating ? inventory.selectedStack?.id ?? null : null);
  const reloadProgress = reloadTimer > 0 && reloadDuration > 0 ? 1 - reloadTimer / reloadDuration : -1;
  held.update(dt, controlling && interaction.breakingActive, sky.sunIntensity, aimZoom > 1, reloadProgress,
    healUse.active ? healUse.progress : -1, Math.hypot(player.vel.x, player.vel.z), player.onGround);
  if (firstPersonActive && !accessibility.reducedMotion) {
    held.viewKick(viewKickOut);
    camera.rotation.x -= viewKickOut.pitch;
    camera.rotation.y += viewKickOut.yaw;
    camera.rotation.z += viewKickOut.roll;
  }

  const showHud = controlling || (screen === 'playing' && !duelSpectating);
  crosshair.style.display = controlling ? '' : 'none';
  hotbarEl.style.display = showHud ? 'flex' : 'none';
  statusEl.style.display = showHud && match.kind !== 'rs' ? '' : 'none';
  hitmarkerEl.style.display = controlling ? '' : 'none';
  dmgArcWrap.style.display = controlling ? '' : 'none';
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

  const modsVisible = screen === 'playing';
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
  (window as unknown as { __worlds: unknown }).__worlds = { sky, player, world, camera, net, input, inventory };
}
