import * as THREE from 'three';
import { GameAudio, materialOf } from './audio';
import { Block, BLOCKS } from './blocks';
import { Furnaces } from './furnace';
import { HeldItemView } from './held';
import { HUD } from './hud';
import { Input } from './input';
import { Interaction } from './interact';
import { Inventory } from './inventory';
import { InventoryUI } from './inventory_ui';
import { dropFor, ItemStack, ITEMS } from './items';
import { ItemEntities } from './itementity';
import { Mobs } from './mobs';
import { Particles } from './particles';
import { Player, MAX_AIR } from './player';
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

const seedParam = new URLSearchParams(location.search).get('seed');
const seed = seedParam ? Number(seedParam) | 0 : 1337;

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

// Broken blocks (including popped plants/torches) drop item entities;
// broken furnaces spill their contents.
world.onBlockBroken = (x, y, z, oldId, harvested) => {
  const drop = dropFor(oldId, Math.random(), harvested);
  // dropChance < 1 during explosions, so blasted blocks mostly vanish.
  if (drop && Math.random() < world.dropChance) {
    itemEntities.spawn(x + 0.5, y + 0.3, z + 0.5, drop.id, drop.count);
  }
  if (oldId === Block.Furnace || oldId === Block.FurnaceLit) {
    for (const s of furnaces.remove(x, y, z)) {
      itemEntities.spawn(x + 0.5, y + 0.3, z + 0.5, s.id, s.count);
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
  invUI.show(kind, kind === 'furnace' ? furnaces.get(x, y, z) : undefined);
  document.exitPointerLock();
};
const spillAtPlayer = (stacks: ItemStack[]) => {
  for (const s of stacks) {
    itemEntities.spawn(player.pos.x, player.pos.y + 1, player.pos.z, s.id, s.count);
  }
};
invUI.onOverflow = spillAtPlayer;

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  panorama.aspect = aspect;
  panorama.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('play-btn')!.addEventListener('click', () => {
  audio.resume();
  input.lock();
});
document.addEventListener('pointerlockchange', () => {
  if (worldReady && !invUI.open && !player.dead) {
    overlay.classList.toggle('hidden', input.locked);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && invUI.open) {
    invUI.hide();
    input.lock();
  }
});

// Death and respawn.
const deathEl = document.getElementById('death')!;
let deathShown = false;
document.getElementById('respawn')!.addEventListener('click', () => {
  player.respawn(spawn);
  lastHealth = 20;
  deathShown = false;
  deathEl.style.display = 'none';
  audio.resume();
  input.lock();
});

function checkDeath(): void {
  if (!player.dead || deathShown) return;
  deathShown = true;
  invUI.hide();
  spillAtPlayer(inventory.spillAll()); // vanilla: your items drop where you died
  deathEl.style.display = 'flex';
  document.exitPointerLock();
}

let worldReady = false;
const clock = new THREE.Clock();
let fps = 0, frames = 0, fpsTime = 0;
// Sound state
let lastHealth = 20;
let lastInWater = false;
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

  if (input.locked && !player.dead) {
    if (input.debugToggled) hud.toggleDebug();
    if (input.hotbarKey >= 0) inventory.select(input.hotbarKey);
    if (input.wheelDelta !== 0) inventory.select(inventory.selected + input.wheelDelta);

    player.update(dt, input, world);
    updateCamera();

    // Combat: a mob under the crosshair takes priority over mining.
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const mobInSights = mobs.rayHit(player.eyePosition, lookDir, 3.5);
    if (input.leftClicked && mobInSights) {
      const heldStack = inventory.selectedStack;
      const tool = heldStack ? ITEMS[heldStack.id]?.tool : undefined;
      mobs.attack(player.eyePosition, lookDir, tool?.damage ?? 1, player);
      if (tool) inventory.damageSelected(2); // attacking wears a tool by 2
      held.swing();
    }
    interaction.update(dt, input, camera, mobInSights !== null);

    // Footsteps.
    const moveSpeed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && moveSpeed > 0.8) {
      stepAccum += moveSpeed * dt;
      if (stepAccum > 2.1) {
        stepAccum = 0;
        const under = world.getBlock(
          Math.floor(player.pos.x),
          Math.floor(player.pos.y - 0.5),
          Math.floor(player.pos.z)
        );
        audio.step(materialOf(under));
      }
    }
  }

  if (input.locked || invUI.open) {
    survival.update(dt, player);
    mobs.update(dt, player, sky.sunIntensity);
  }
  checkDeath();
  furnaces.update(dt);

  // When the title/pause menu is up, render the slowly-orbiting panorama.
  const inMenu = !input.locked && !invUI.open && !player.dead;
  let activeCamera: THREE.Camera = camera;
  if (inMenu) {
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

  // State-driven sounds.
  audio.updateListener(activeCamera);
  if (player.health < lastHealth && !player.dead) audio.hurt();
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
  // Hide the held item (a child of the player camera) while the panorama
  // menu is up, so it doesn't float over the title/pause screen.
  held.setItem(inMenu ? null : inventory.selectedStack?.id ?? null);
  held.update(dt, input.locked && input.leftDown, sky.sunIntensity);

  // Gameplay HUD chrome shows only during active play (not menu/inventory/death).
  const hudDisplay = input.locked ? '' : 'none';
  crosshair.style.display = hudDisplay;
  hotbarEl.style.display = input.locked ? 'flex' : 'none';
  statusEl.style.display = hudDisplay;
  hud.update();
  hud.updateStatus({
    health: player.health,
    energy: player.energy,
    exhausted: player.exhausted,
    air: player.air,
    maxAir: MAX_AIR,
    underwater: player.eyeUnderwater,
  });
  (document.getElementById('damage-flash') as HTMLDivElement).style.opacity =
    String(Math.min(0.35, player.damageFlash));
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
