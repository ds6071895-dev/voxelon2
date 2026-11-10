// Standalone in-engine cinematic stage. No accounts, sockets or live matches.
// Capture advances simulation time explicitly, independent of rendering speed.
import * as THREE from 'three';
import { createAtlas } from '../textures';
import { World } from '../world';
import { worldGenerator, type WorldGenerator } from '../multiverse';
import { TitleTerrain } from '../title_terrain';
import { TEXTURE_SEED } from '../title_backdrop';
import { Sky } from '../sky';
import { PostFX } from '../postfx';
import { SunShadow } from '../shadows';
import { Particles } from '../particles';
import { DragonView } from '../parkour_dragon';
import { parkourTheme } from '../parkour_themes';
import { buildAvatarBody, type AvatarBody } from '../avatar';
import { defaultCosmetics } from '../character';
import { createAvatarEquipment, createAvatarItemMaterial, attachAvatarEquipment, poseAvatar, type AvatarEquipment } from '../avatar_equipment';
import { ITEMS } from '../items';
import { createRatModel, createCheeseModel, createCatModel, type RatModel, type CatModel } from '../ratseek_models';
import { buildMob, animateMob, type MobRig } from '../vanilla/client/mob_models';
import type { EntityView } from '../vanilla/messages';
import { configureCaptureQuality, sizeCapture, loadCaptureChunks } from '../media/offline';
import { warmCaptureDragon } from '../media/dragon';
import {
  createTrailerCourse, trailerShotContext, trailerFrame, trailerEdits, trailerEvents, trailerDragonCue, trailerWorld, trailerFocus, useTrailerLake,
  captureSmooth as smooth, type StageFrame, type StageEdit, type StageEvent,
} from './staging';
import { createCape, wearCape, type Cape, type CapeTier } from './cape';
import { SHOTS, SCREENSHOTS, HERO_FRAMES, RELEASE, RPG, DURATION, type Shot } from './shots';

const params = new URLSearchParams(location.search);
const capture = params.has('capture');
const canvas = document.getElementById('output') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const status = document.getElementById('status')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xb7d3ee, 90, 180);
const camera = new THREE.PerspectiveCamera(58, 16 / 9, .08, 2000);
const atlas = createAtlas(TEXTURE_SEED, renderer.capabilities.getMaxAnisotropy());
const lake = new TitleTerrain(0x5ca1ab1e);
useTrailerLake(lake);
let generator = lake as WorldGenerator;
const world = new World(scene, atlas, generator);
world.setSmoothLighting(true);
const sky = new Sky(scene, TEXTURE_SEED);
sky.setShaders(true);
// Lucky Pillars hangs over the void: looking down, show a clear poster-blue
// backdrop (as the title card does) instead of the atmosphere's grey haze.
const voidSky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color(0x69b7ef) }, horizon: { value: new THREE.Color(0xc4e5fa) }, bottom: { value: new THREE.Color(0x80bce8) } },
  vertexShader: 'varying float height; void main() { height = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying float height;
    void main() { vec3 c = height > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.65, height)) : mix(horizon, bottom, smoothstep(0.0, 0.65, -height));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
}));
voidSky.frustumCulled = false; voidSky.renderOrder = -99; voidSky.visible = false;
scene.add(voidSky);
const postfx = new PostFX(renderer, scene);
const shadows = new SunShadow(renderer, scene, atlas.texture, world.shadowUniforms);
const effects = params.get('quality') !== 'high';
configureCaptureQuality(renderer, postfx, shadows, effects, effects, params.get('quality') === 'max' ? 0 : 1, 1);
world.shaderModeUniform.value = effects ? 1 : 0;
const particles = new Particles(scene);
const dragon = new DragonView(scene, particles);

const { seed, course } = createTrailerCourse();

// ── cast ────────────────────────────────────────────────────────────────
// Slots keep each character's look and shirt from shot to shot.
const CAST: { seed: number; shirt: number }[] = [
  { seed: 300, shirt: 0xd9393f }, { seed: 671, shirt: 0x2f6fe0 }, { seed: 1042, shirt: 0xe8c22c }, { seed: 1213, shirt: 0xd9393f },
  { seed: 77, shirt: 0x2f6fe0 }, { seed: 2718, shirt: 0x8b5cf6 }, { seed: 905, shirt: 0x37a845 },
  // The cape hero, then the four tier models.
  { seed: 4242, shirt: 0x1f2a44 }, { seed: 515, shirt: 0x5b6b7d }, { seed: 1888, shirt: 0x2b5ea8 }, { seed: 3301, shirt: 0x5a3a8c }, { seed: 6160, shirt: 0x7a1f2a },
];
const itemMat = createAvatarItemMaterial(atlas);
interface Actor { body: AvatarBody; pivot: THREE.Group; equipment: AvatarEquipment | null; item: number; flash: THREE.Mesh | null; cape: Cape | null }
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
const flashGeo = new THREE.IcosahedronGeometry(.07, 0);
const actors: Actor[] = CAST.map(c => {
  const body = buildAvatarBody(defaultCosmetics(c.seed), new THREE.Color(c.shirt));
  const pivot = new THREE.Group();
  pivot.add(body.group); body.group.position.y = -.9;
  pivot.visible = false;
  scene.add(pivot);
  return { body, pivot, equipment: null, item: -1, flash: null, cape: null };
});
const rats: RatModel[] = [createRatModel(), createRatModel(), createRatModel(true)];
rats.forEach(r => scene.add(r.group));
const cheese = createCheeseModel();
scene.add(cheese);
let cat: CatModel | null = null;
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd587, transparent: true, opacity: .75 });
const tracers = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(.035, .035, 4), tracerMat); m.visible = false; scene.add(m); return m; });
const arrow = new THREE.Group();
{
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(.03, .03, .8), new THREE.MeshBasicMaterial({ color: 0xcaa56a }));
  const tip = new THREE.Mesh(new THREE.BoxGeometry(.07, .07, .12), new THREE.MeshBasicMaterial({ color: 0xd8dfe6 }));
  tip.position.z = -.44;
  arrow.add(shaft, tip); arrow.visible = false; scene.add(arrow);
}
// Floating loot: the shared held-item model, centred on a spinning pivot.
const dropPivots: { pivot: THREE.Group; item: number; equipment: AvatarEquipment | null }[] = [];
function dropPivot(i: number, item: number): THREE.Group {
  let d = dropPivots[i];
  if (!d) { d = { pivot: new THREE.Group(), item: -1, equipment: null }; scene.add(d.pivot); dropPivots[i] = d; }
  if (d.item !== item) {
    d.equipment?.dispose();
    d.item = item;
    d.equipment = createAvatarEquipment(atlas, item, itemMat);
    if (d.equipment) {
      const root = d.equipment.root;
      root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
      root.position.sub(c);
      d.pivot.add(root);
    }
  }
  return d.pivot;
}
// Disaster City's horde: the vanilla client's own zombie model and animation.
const zombies: MobRig[] = Array.from({ length: 8 }, (_, i) => {
  const group = new THREE.Group();
  const rig: MobRig = { id: 900 + i, kind: 'zombie', group, yaw: 0, flags: 0, age: 0, legs: [], arms: [], walk: 0, hurtUntil: 0 };
  buildMob(rig, { id: rig.id, kind: 'zombie', x: 0, y: 0, z: 0, yaw: 0, flags: 0 } as EntityView);
  group.visible = false;
  scene.add(group);
  return rig;
});
function tintZombies(k: number): void {
  for (const z of zombies) z.mats?.forEach(m => m.color.setScalar(k));
}
// Meteors: a glowing magma lump inside a soft additive halo.
const meteorCore = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
const meteorHot = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
const meteorHalo = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const meteors = Array.from({ length: 3 }, () => {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), meteorCore);
  const hot = new THREE.Mesh(new THREE.BoxGeometry(.62, .62, .62), meteorHot);
  hot.position.set(.25, .25, .25);
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), meteorHalo);
  g.add(core, hot, halo); g.visible = false; scene.add(g);
  return g;
});

// ── logo, reel posters ───────────────────────────────────────────────────
const logo = new Image();
let logoSVG = '';
async function loadLogo(): Promise<void> {
  const markup = await (await fetch('/index.html')).text();
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const svg = doc.querySelector('.w-wordmark svg');
  if (!svg) throw new Error('Title-screen Worlds logo was not found.');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  logoSVG = svg.outerHTML;
  const logoURL = URL.createObjectURL(new Blob([logoSVG], { type: 'image/svg+xml' }));
  logo.src = logoURL;
  await logo.decode();
  URL.revokeObjectURL(logoURL);
}
const POSTERS = [
  { id: 'pillars', name: 'LUCKY PILLARS', accent: '#e0a91b', focus: .45 },
  { id: 'disaster', name: 'DISASTER CITY', accent: '#dc5a24', focus: .5 },
  { id: 'minigames', name: 'PARTY GAMES', accent: '#ec4899', focus: .5 },
  { id: 'bridge', name: 'THE BRIDGE', accent: '#4da3ff', focus: .5 },
  { id: 'duels', name: 'DUELS', accent: '#ffb347', focus: .5 },
  { id: 'parkour', name: 'PARKOUR', accent: '#46d6a5', focus: .5 },
  { id: 'ratseek', name: 'RAT AND SEEK', accent: '#c58cff', focus: .5 },
].map(p => ({ ...p, image: new Image() }));
async function loadPosters(): Promise<void> {
  await Promise.all(POSTERS.map(async p => { p.image.src = `/cards/${p.id}.webp`; await p.image.decode(); }));
}
const ACCENT: Record<string, string> = {
  pillars: '#f2b824', disaster: '#ff6a2c', whack: '#ff5fae', tnt: '#ff5fae', podium: '#ff5fae',
  bridge: '#4da3ff', duel: '#ffb347', parkour: '#46d6a5', manor: '#c58cff', lake: '#ffffff', rpg: '#ffffff',
};
const GAME_NAME: Record<string, string> = {
  pillars: 'LUCKY PILLARS', disaster: 'DISASTER CITY', whack: 'PARTY GAMES', tnt: 'PARTY GAMES', podium: 'PARTY GAMES',
  bridge: 'THE BRIDGE', duel: 'DUELS', parkour: 'PARKOUR', manor: 'RAT AND SEEK',
};
const TIER_LABEL: { name: string; color: string }[] = [
  { name: 'COMMON', color: '#c9d3df' }, { name: 'RARE', color: '#6fb0ff' }, { name: 'EPIC', color: '#c59bff' }, { name: 'LEGENDARY', color: '#ffd35c' },
];

// ── clock and state ─────────────────────────────────────────────────────
let shotIndex = -1;
let lastTime = 0;
let fireSent = false;
let anchor = new THREE.Vector3();
let firstOrder = 0;
let previewing = false;
let exporting = false;
let previewOrigin = 0;
let previewStart = 0;
let width = 1920, height = 1080;
let edits: StageEdit[] = [];
let editsApplied: { x: number; y: number; z: number; original: number }[] = [];
let editNext = new Set<number>();
let events: StageEvent[] = [];
let eventsNext = 0;
let lastFrame: StageFrame | null = null;
let rngState = 1;

function resize(w: number, h: number): void {
  sizeCapture(renderer, postfx, camera, w, h);
  width = w; height = h;
  canvas.width = w; canvas.height = h;
}
resize(Number(params.get('width')) || 1920, Number(params.get('height')) || 1080);

/** Hour of the shot at time t: the RPG act runs from sunset into the night. */
function todOf(s: Shot, t = 0): number {
  const k = Math.max(0, Math.min(1, t / s.duration));
  switch (s.action) {
    case 'rpg-dusk': return .474 + .03 * k;
    case 'rpg-hero': return .51 + .04 * k;
    case 'rpg-dark': case 'rpg-rise': return .575;
    case 'rpg': return .56;
  }
  switch (s.set) {
    case 'manor': return .10;
    case 'pillars': return .23;
    case 'disaster': return s.action === 'dc-zombies' ? .478 : .462;
    case 'whack': case 'tnt': return .2;
    case 'podium': return .44;
    case 'lake': return s.action === 'logo' ? .09 : s.action.startsWith('cape') ? .15 : .11;
    default: return .14;
  }
}
const FOG: Partial<Record<Shot['set'], [number, number]>> = {
  lake: [62, 150], rpg: [70, 170], pillars: [150, 280], disaster: [80, 190], whack: [110, 230], tnt: [110, 230], podium: [100, 210],
};
const generators = new Map<string, WorldGenerator>();
function generatorFor(set: Shot['set']): WorldGenerator {
  const spec = trailerWorld(set, seed);
  if (spec === 'lake') return lake;
  const key = `${spec.kind}:${spec.seed}`;
  let g = generators.get(key);
  if (!g) { g = worldGenerator(spec); generators.set(key, g); }
  return g;
}

function env(): Parameters<typeof trailerFrame>[2] {
  return { generator, course, context: { anchor, firstOrder }, dragonHead: dragon.headPosition() };
}

function revertEdits(): void {
  for (const e of editsApplied.reverse()) world.setBlock(e.x, e.y, e.z, e.original);
  editsApplied = []; editNext = new Set();
}

async function prepare(index: number): Promise<void> {
  if (!Number.isInteger(index) || !SHOTS[index]) throw new Error(`Invalid shot ${index}`);
  previewing = false;
  const s = SHOTS[index];
  shotIndex = index;
  lastTime = 0; fireSent = false; eventsNext = 0; lastFrame = null;
  // Seed presentation effects independently for every take.
  rngState = seed ^ (index * 7919);
  Math.random = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };
  status.textContent = `Loading ${s.id}…`;
  dragon.clear();
  particles.update(10, camera);
  revertEdits();
  const next = generatorFor(s.set);
  if (next !== generator) {
    generator = next;
    world.setGenerator(generator);
  }
  if (s.set === 'lake' || s.set === 'rpg') world.setArenaRenderBounds(null);
  else world.setArenaRenderBounds(generator.bounds, s.set === 'manor' ? .55 : s.set === 'disaster' ? .7 : s.set === 'pillars' ? .9 : s.set === 'whack' || s.set === 'tnt' || s.set === 'podium' ? .95 : .65);
  voidSky.visible = s.set === 'pillars';
  tintZombies(s.action === 'dc-zombies' ? .78 : 1);
  sky.snapTo(todOf(s));
  if (s.set === 'parkour') {
    ({ firstOrder, anchor } = trailerShotContext(s, course));
    dragon.enter(course, parkourTheme(seed), 0, 0);
    warmCaptureDragon(dragon, firstOrder);
  }
  edits = trailerEdits(s); events = trailerEvents(s);
  const focus = trailerFocus(s);
  const center = focus?.center ?? (s.set === 'lake' ? new THREE.Vector3(0, 0, 0)
    : s.set === 'bridge' ? new THREE.Vector3(12, 0, 40)
      : s.set === 'duel' ? new THREE.Vector3(22, 0, 22)
        : s.set === 'manor' ? (s.action === 'rs-manor' ? new THREE.Vector3(14, 0, 28) : s.action === 'rs-rescue' ? new THREE.Vector3(22, 0, 2) : new THREE.Vector3(4, 0, 5)) : anchor);
  const radius = focus?.radius ?? (s.set === 'lake' ? 8 : s.set === 'parkour' ? 7 : s.set === 'bridge' && s.action === 'br-arena' ? 5 : 4);
  await loadCaptureChunks(world, center.x, center.z, radius, 30, s.id);
  hideAll();
  applyEdits(0);
  render(0);
  status.textContent = s.id;
}

function applyEdits(t: number): void {
  edits.forEach(([x, y, z, block, at], i) => {
    if (at > t + 1e-6 || editNext.has(i)) return;
    if (block === undefined || !Number.isInteger(block)) throw new Error(`Invalid trailer edit block at ${x},${y},${z}`);
    editNext.add(i);
    editsApplied.push({ x, y, z, original: world.getBlock(x, y, z) });
    world.setBlock(x, y, z, block);
  });
}

function hideAll(): void {
  actors.forEach(a => { a.pivot.visible = false; if (a.flash) a.flash.visible = false; });
  rats.forEach(r => { r.group.visible = false; });
  cheese.visible = false;
  tracers.forEach(m => { m.visible = false; });
  arrow.visible = false;
  dropPivots.forEach(d => { d.pivot.visible = false; });
  zombies.forEach(z => { z.group.visible = false; });
  meteors.forEach(m => { m.visible = false; });
  if (cat) cat.group.visible = false;
}

function equip(a: Actor, item: number): void {
  if (a.item === item) return;
  a.equipment?.dispose(); a.equipment = null;
  if (a.flash) { a.flash.removeFromParent(); a.flash = null; }
  a.item = item;
  a.equipment = createAvatarEquipment(atlas, item, itemMat);
  if (!a.equipment) return;
  attachAvatarEquipment(a.body, a.equipment);
  if (a.equipment.kind === 'gun') {
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.visible = false; flash.renderOrder = 60;
    (a.equipment.root.getObjectByName('muzzle') ?? a.equipment.root).add(flash);
    a.flash = flash;
  }
}

function dress(a: Actor, tier: CapeTier | undefined): void {
  if ((a.cape?.tier ?? undefined) === tier) return;
  a.cape?.dispose(); a.cape = null;
  if (tier) { a.cape = createCape(tier); wearCape(a.body, a.cape); }
}

function drawFrame(f: StageFrame, t: number): void {
  hideAll();
  for (const p of f.actors) {
    const a = actors[p.slot];
    if (!a || p.visible === false) continue;
    equip(a, p.item);
    dress(a, p.cape);
    a.pivot.visible = true;
    a.pivot.position.set(p.pos[0], p.pos[1] + .9, p.pos[2]);
    a.pivot.rotation.set(p.tilt?.[0] ?? 0, p.yaw, p.tilt?.[2] ?? 0, 'YXZ');
    poseAvatar(a.body, a.equipment, {
      walkPhase: p.walk, speed: p.speed, sneak: 0, pitch: p.pitch ?? 0, attackSwing: p.attack ?? 0,
      aim: p.aim, kick: p.kick, bowPower: p.bow,
    });
    if (p.cheer) {
      // Both arms thrown up and open for the podium.
      const c = p.cheer, wave = Math.sin(t * 9 + p.slot) * .12 * c;
      a.body.parts[2].rotation.set(-2.75 * c + wave, 0, -.28 * c);
      a.body.parts[3].rotation.set(-2.75 * c - wave, 0, .28 * c);
    }
    a.cape?.pose(t + p.slot * .37, p.wind ?? 0, p.speed);
    if (a.flash) a.flash.visible = f.flashes.includes(p.slot);
  }
  f.rats.forEach((p, i) => {
    const r = rats[i];
    if (!r) return;
    r.group.visible = true;
    r.setCaged(p.caged);
    r.group.position.set(...p.pos); r.group.rotation.y = p.yaw;
    r.pose(p.speed, p.phase, t);
    if (p.cheese) {
      cheese.visible = true; cheese.scale.setScalar(.6);
      r.group.updateWorldMatrix(true, false);
      cheese.position.copy(r.group.localToWorld(new THREE.Vector3(0, .34, -.46)));
      cheese.rotation.y = p.yaw;
    }
  });
  if (f.cat) {
    cat ??= (() => { const c = createCatModel(); c.group.traverse(o => { if (o instanceof THREE.Sprite) o.visible = false; }); scene.add(c.group); return c; })();
    cat.group.visible = true; cat.group.position.set(...f.cat.pos); cat.group.rotation.y = f.cat.yaw;
    cat.update(f.cat.sit, f.cat.speed, t);
  }
  f.drops.forEach((d, i) => {
    const pivot = dropPivot(i, d.item);
    pivot.visible = d.scale > .01;
    pivot.position.set(...d.pos); pivot.scale.setScalar(1.25 * d.scale); pivot.rotation.set(0, t * 2.6 + i, 0);
  });
  f.zombies.forEach((p, i) => {
    const z = zombies[i];
    if (!z) return;
    z.group.visible = true;
    z.group.position.set(...p.pos);
    z.yaw = p.yaw; z.group.rotation.y = p.yaw;
    z.age = t + i * 1.7; z.walk = p.phase;
    z.dying = p.dying;
    if (p.dying === undefined) z.group.rotation.z = 0;
    z.swingAt = p.swingAgo !== undefined ? (t - p.swingAgo) * 1000 : undefined;
    animateMob(z, 0, p.speed, t * 1000);
    if (p.dying !== undefined && p.dying > 1.0) z.group.position.y -= (p.dying - 1.0) * .6;
  });
  f.meteors.forEach((m, i) => {
    const g = meteors[i];
    if (!g) return;
    g.visible = true; g.position.set(...m.pos); g.scale.setScalar(m.size);
    g.rotation.set(t * 2.1 + i, t * 1.3, t * .7);
  });
  const tr = f.projectiles.filter(p => p.kind === 'tracer');
  tr.forEach((p, i) => {
    const dir = new THREE.Vector3(...p.dir).normalize(), m = tracers[i];
    m.visible = true; m.position.set(...p.pos).addScaledVector(dir, 2.2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  });
  const ar = f.projectiles.find(p => p.kind === 'arrow');
  if (ar) {
    arrow.visible = true; arrow.position.set(...ar.pos);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...ar.dir).normalize());
  }
}

function stepEffects(t: number, dt: number): void {
  const s = SHOTS[shotIndex];
  if (s.set === 'parkour') {
    const cue = trailerDragonCue(t, firstOrder);
    dragon.sync(cue.front, cue.speed, cue.now);
    if ((s.action === 'pk-dragon' || s.action === 'pk-escape') && t > 1.4 && !fireSent && lastFrame) {
      const target = lastFrame.actors[0].pos;
      dragon.fireball({ id: 1, tx: target[0], ty: target[1], tz: target[2] + 4, launchAt: 24400, landAt: 26600 });
      fireSent = true;
    }
    dragon.update(dt, cue.now, 0, false);
  }
  // Meteor trails: fire close behind the lump, smoke further back.
  if (lastFrame && dt > 0) for (const m of lastFrame.meteors) {
    const back = new THREE.Vector3(...m.dir).normalize().multiplyScalar(-1);
    const [x, y, z] = m.pos;
    particles.burst(x + back.x * .8 * m.size, y + back.y * .8 * m.size, z + back.z * .8 * m.size, 3, 0xffa040, 1.2, .45, { gravity: 0, spread: .7 * m.size, scale: 1.3 * m.size, additive: true });
    particles.burst(x + back.x * 2.2 * m.size, y + back.y * 2.2 * m.size, z + back.z * 2.2 * m.size, 2, 0x5a5552, .6, 1.6, { gravity: -.3, spread: 1.0 * m.size, scale: 1.8 * m.size });
  }
  while (eventsNext < events.length && events[eventsNext].at <= t) {
    const e = events[eventsNext++], [x, y, z] = e.pos;
    if (e.kind === 'debris') { particles.debris(x, y, z, e.color, 24); particles.debris(x, y + .5, z, 0x6b4a2a, 14); }
    else if (e.kind === 'ring') particles.ring(x, y, z, e.color, 34, 8, .9);
    else if (e.kind === 'burst') particles.burst(x, y, z, 22, e.color, 4.5, .7, { additive: true, scale: 1.2 });
    else if (e.kind === 'death') particles.deathBurst(x, y, z, e.color);
    else if (e.kind === 'poof') particles.poof(x, y, z);
    else if (e.kind === 'heal') particles.heal(x, y, z, 10);
    else if (e.kind === 'sparkle') particles.burst(x, y, z, 26, e.color, 2.6, .9, { gravity: -.6, spread: .9, scale: .55, additive: true });
    else if (e.kind === 'blast') {
      particles.burst(x, y + .5, z, 70, e.color, 9, .8, { gravity: 2, spread: 1.6, scale: 1.6, additive: true });
      particles.burst(x, y + .5, z, 30, 0xfff0c0, 5, .45, { gravity: 0, spread: 1.0, scale: 1.2, additive: true });
    } else if (e.kind === 'smoke') particles.burst(x, y + 1, z, 60, e.color, 2.2, 3.4, { gravity: -1.1, spread: 2.6, scale: 2.4 });
    else if (e.kind === 'firework') {
      particles.burst(x, y, z, 90, e.color, 11, 1.4, { gravity: 3.5, spread: .3, scale: .7, additive: true });
      particles.burst(x, y, z, 30, 0xffffff, 6, .7, { gravity: 2, spread: .2, scale: .45, additive: true });
    }
  }
  particles.update(dt, camera);
}

function animate(t: number, dt: number): void {
  const s = SHOTS[shotIndex];
  applyEdits(t);
  // The frame is a pure function of time; the dragon's head position feeds back
  // into its camera, so evaluate after stepping the flight model.
  stepEffects(t, dt);
  lastFrame = trailerFrame(s, t, env());
  drawFrame(lastFrame, t);
}

function applyCamera(s: Shot, t: number): void {
  const f = lastFrame ?? trailerFrame(s, t, env());
  const c = f.camera;
  // Debug framing: ?cam=x,y,z,tx,ty,tz[,fov] replaces every shot's camera.
  const override = params.get('cam')?.split(',').map(Number);
  if (override && override.length >= 6) {
    c.position = new THREE.Vector3(override[0], override[1], override[2]);
    c.target = new THREE.Vector3(override[3], override[4], override[5]);
    if (override[6]) c.fov = override[6];
  }
  camera.position.copy(c.position);
  // Each game's title lands with a jolt.
  const shake = f.shake + (s.title ? .06 * Math.exp(-t * 7) : 0);
  if (shake) camera.position.add(new THREE.Vector3(Math.sin(t * 91) * shake, Math.sin(t * 77 + 1) * shake, Math.sin(t * 63 + 2) * shake));
  camera.lookAt(c.target);
  if (c.roll) camera.rotateZ(c.roll);
  camera.fov = c.fov;
  camera.updateProjectionMatrix();
}

// ── 2D overlays ─────────────────────────────────────────────────────────
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
type Ctx2 = CanvasRenderingContext2D & { letterSpacing: string };
function text(line: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', weight = 800, color: string | CanvasGradient = '#f7faff', spacing = 0, shadow = '#04101fcc'): void {
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${size}px ${FONT}`;
  (ctx as Ctx2).letterSpacing = `${spacing}px`;
  ctx.shadowColor = shadow; ctx.shadowBlur = size * .45; ctx.shadowOffsetY = size * .06;
  ctx.fillStyle = color;
  ctx.fillText(line, x, y);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  (ctx as Ctx2).letterSpacing = '0px';
}
function goldFill(y: number, size: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  g.addColorStop(0, '#fff6cf'); g.addColorStop(.45, '#ffd35c'); g.addColorStop(1, '#d08a17');
  return g;
}
const u = (): number => height / 1080;
/** Cinematic letterbox: ~2.2:1 picture inside the 16:9 frame. */
const BAR = .0963;
function letterbox(a = 1): void {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height * BAR); ctx.fillRect(0, height * (1 - BAR), width, height * BAR + 1);
  ctx.restore();
}
function project(p: [number, number, number]): { x: number; y: number; on: boolean } {
  const v = new THREE.Vector3(...p).project(camera);
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height, on: v.z > -1 && v.z < 1 };
}

/** Caption block: a coloured bar, the game name (first shot of a game) and one line of explanation. */
function caption(s: Shot, t: number): void {
  const accent = ACCENT[s.set] ?? '#fff';
  const enter = smooth((t - .2) / .45), leave = 1 - smooth((t - s.duration + .5) / .4);
  const a = enter * leave;
  if (a <= 0 || (!s.label && !s.title)) return;
  const x = width * .065, base = height * .79, k = u();
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate((1 - enter) * -50 * k, 0);
  const hasTitle = !!s.title;
  const barH = hasTitle ? 150 * k : 56 * k;
  ctx.fillStyle = accent; ctx.shadowColor = '#04101f88'; ctx.shadowBlur = 14 * k;
  ctx.fillRect(x - 28 * k, base - barH * .72, 9 * k, barH);
  ctx.shadowBlur = 0;
  if (hasTitle) {
    // The name slams in slightly oversized and settles.
    const slam = 1 + (1 - smooth(t / .35)) * .12;
    ctx.save(); ctx.translate(x, base - 52 * k); ctx.scale(slam, slam);
    text(s.title!, 0, 0, 100 * k, 'left', 900, '#ffffff', 4 * k);
    ctx.restore();
    text(s.label, x + 3 * k, base + 40 * k, 38 * k, 'left', 700, '#eef4ff', .5 * k);
  } else text(s.label, x, base, 38 * k, 'left', 700, '#ffffff', .5 * k);
  ctx.restore();
}

/** A small tag that stays in the corner for the whole of a game's section. */
function gameTag(s: Shot, t: number): void {
  const name = GAME_NAME[s.set];
  if (!name || s.title) return;
  const accent = ACCENT[s.set], k = u();
  const a = smooth(t / .4) * (1 - smooth((t - s.duration + .3) / .3));
  ctx.save(); ctx.globalAlpha = a * .95;
  ctx.font = `800 ${24 * k}px ${FONT}`; (ctx as Ctx2).letterSpacing = `${3 * k}px`;
  const w = ctx.measureText(name).width + 62 * k, h = 46 * k, x = width * .065 - 28 * k, y = height * BAR + 26 * k;
  ctx.fillStyle = '#071221cc'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 23 * k); ctx.fill();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x + 24 * k, y + h / 2, 7 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(name, x + 42 * k, y + h / 2 + 1 * k);
  (ctx as Ctx2).letterSpacing = '0px';
  ctx.restore();
}

/** Full-frame statements in the cold open: wide-tracked, settling in from slightly large. */
function slates(s: Shot, t: number): void {
  for (const [from, to, line] of s.slates ?? []) {
    if (t < from - .05 || t > to + .05) continue;
    const a = smooth((t - from) / .5) * (1 - smooth((t - to + .55) / .55));
    const grow = 1.08 - .08 * smooth((t - from) / (to - from));
    ctx.save();
    ctx.globalAlpha = a * .45; ctx.fillStyle = '#020812'; ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = a;
    ctx.translate(width / 2, height / 2); ctx.scale(grow, grow);
    text(line, 0, 0, 120 * u(), 'center', 900, '#ffffff', 26 * u(), '#000000cc');
    ctx.restore();
  }
}

/** Score popups (Whack-a-Mole): rise and fade over the mole that was hit. */
function popups(f: StageFrame): void {
  for (const p of f.popups) {
    const s = project(p.pos);
    if (!s.on) continue;
    ctx.save(); ctx.globalAlpha = 1 - smooth((p.k - .6) / .4);
    const pop = 1 + (1 - smooth(p.k / .15)) * .5;
    ctx.translate(s.x, s.y); ctx.scale(pop, pop);
    text(p.text, 0, 0, 64 * u(), 'center', 900, p.color, 0, '#000000dd');
    ctx.restore();
  }
}

/** The capes announcement over the reveal. */
function capeTitle(t: number): void {
  const k = u();
  const a = smooth((t - 2.0) / .45);
  if (a <= 0) return;
  ctx.save();
  const g = ctx.createLinearGradient(0, height * .55, 0, height);
  g.addColorStop(0, '#02081200'); g.addColorStop(1, '#020812cc');
  ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, height * .55, width, height * .45);
  const slam = 1 + (1 - smooth((t - 2.0) / .35)) * .25;
  ctx.translate(width / 2, height * .7); ctx.scale(slam, slam);
  text('CAPES ARE COMING', 0, 0, 112 * k, 'center', 900, goldFill(0, 112 * k), 14 * k, '#000000cc');
  ctx.restore();
  const b = smooth((t - 3.1) / .5);
  ctx.save(); ctx.globalAlpha = b;
  text('Win them. Wear them. Never bought.', width / 2, height * .79, 40 * k, 'center', 700, '#ffffff', 2 * k);
  ctx.restore();
}

/** Tier names above each cape, landing one by one. */
function capeTiers(f: StageFrame, t: number): void {
  const k = u();
  f.actors.forEach((p, i) => {
    const at = .5 + i * .6, a = smooth((t - at) / .3);
    if (a <= 0) return;
    const s = project([p.pos[0], p.pos[1] + 2.45, p.pos[2]]);
    if (!s.on) return;
    s.y = Math.max(s.y, height * BAR + 40 * k);
    const tier = TIER_LABEL[i];
    ctx.save(); ctx.globalAlpha = a;
    ctx.translate(s.x, s.y - (1 - a) * 20 * k);
    text(tier.name, 0, 0, (i === 3 ? 44 : 36) * k, 'center', 900, i === 3 ? goldFill(0, 44 * k) : tier.color, 4 * k, '#000000dd');
    ctx.restore();
  });
  const b = smooth((t - 2.7) / .5);
  ctx.save(); ctx.globalAlpha = b;
  text('EARN CAPES IN EVERY GAME', width / 2, height * (1 - BAR) - 58 * k, 46 * k, 'center', 900, '#ffffff', 10 * k, '#000000dd');
  ctx.restore();
}

/** Every game as a poster wall, each column rising in on a beat. */
function reel(t: number): void {
  ctx.save();
  ctx.fillStyle = '#060d18'; ctx.fillRect(0, 0, width, height);
  const colW = width / POSTERS.length, step = .5;
  POSTERS.forEach((p, i) => {
    const k = smooth((t - i * step) / .45);
    if (k <= 0) return;
    const x = i * colW, rise = (1 - k) * height * .35;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, 0, colW - 4, height); ctx.clip();
    ctx.globalAlpha = k;
    const iw = p.image.naturalWidth, ih = p.image.naturalHeight, ground = ih * .12;
    const srcH = ih - ground, scale = height / srcH * 1.04 * (1 + (4 - t) * .01);
    const sw = colW / scale, sx = Math.max(0, Math.min(iw - sw, iw * p.focus - sw / 2));
    ctx.drawImage(p.image, sx, 0, sw, srcH, x, rise, colW, srcH * scale);
    const g = ctx.createLinearGradient(0, height * .55, 0, height);
    g.addColorStop(0, '#04101800'); g.addColorStop(1, '#041018f0');
    ctx.fillStyle = g; ctx.fillRect(x, 0, colW, height);
    ctx.fillStyle = p.accent; ctx.fillRect(x + colW * .12, height * .865, colW * .76 * smooth((t - i * step - .2) / .4), 6 * u());
    ctx.restore();
    ctx.save(); ctx.globalAlpha = k;
    // Two-word names stack onto two lines.
    const cut = p.name.indexOf(' ');
    const size = Math.min(colW * .135, 40 * u());
    if (cut > 0) {
      text(p.name.slice(0, cut), x + colW / 2, height * .905, size, 'center', 900, '#fff', 1.5);
      text(p.name.slice(cut + 1), x + colW / 2, height * .948, size, 'center', 900, '#fff', 1.5);
    } else text(p.name, x + colW / 2, height * .925, size * 1.15, 'center', 900, '#fff', 1.5);
    ctx.restore();
  });
  ctx.restore();
}

function lockup(t: number, d: number): void {
  const k = smooth(t / 1.0), s = u();
  ctx.save();
  ctx.globalAlpha = k;
  const w = width * .56, h = w * 120 / 900;
  const x = (width - w) / 2, y = height * .36 - h / 2 - (1 - k) * height * .025;
  // The exact dark-ink logo needs a bright, soft ground to stay readable.
  const glow = ctx.createRadialGradient(width / 2, y + h / 2, w * .05, width / 2, y + h / 2, w * .75);
  glow.addColorStop(0, '#f2f8ffee'); glow.addColorStop(.6, '#edf5ffc0'); glow.addColorStop(1, '#edf5ff00');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(logo, x, y, w, h);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = .4 * Math.exp(-t * 4);
  ctx.fillStyle = '#fff1d2'; ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const reveal = smooth((t - 1.0) / .45);
  ctx.save(); ctx.globalAlpha = k * reveal;
  ctx.translate(width / 2, height * .57); ctx.scale(1 + (1 - reveal) * .2, 1 + (1 - reveal) * .2);
  text('7 GAMES. ONE WORLD.', 0, 0, 56 * s, 'center', 900, '#0d2340', 12 * s, '#ffffffdd');
  ctx.restore();
  const names = smooth((t - 1.9) / .7);
  ctx.save(); ctx.globalAlpha = names;
  text(POSTERS.slice(0, 3).map(p => p.name).join('   ·   '), width / 2, height * .68, 26 * s, 'center', 800, '#ffffff', 4 * s);
  text(POSTERS.slice(3).map(p => p.name).join('   ·   '), width / 2, height * .73, 26 * s, 'center', 800, '#ffffff', 4 * s);
  ctx.restore();
  const date = smooth((t - 2.8) / .6) * (1 - smooth((t - d + .7) / .6));
  ctx.save(); ctx.globalAlpha = date;
  ctx.font = `800 ${30 * s}px ${FONT}`;
  const tw = ctx.measureText(RELEASE).width + 140 * s;
  ctx.fillStyle = '#ffffffee'; ctx.beginPath(); ctx.roundRect((width - tw) / 2, height * .8, tw, 64 * s, 32 * s); ctx.fill();
  text(RELEASE, width / 2, height * .8 + 33 * s, 30 * s, 'center', 900, '#0d2340', 8 * s, '#ffffff00');
  ctx.restore();
}

/** The black before the RPG: nothing but a faint ember glow that swells on each heartbeat. */
function darkPulse(t: number): void {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  const beat = [1, 2, 3].reduce((m, b) => Math.max(m, t >= b ? Math.exp(-(t - b) * 3.5) : 0), 0);
  const a = smooth(t / .25) * (.55 + .45 * beat);
  const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * .42);
  glow.addColorStop(0, `rgba(96,52,22,${a})`); glow.addColorStop(.5, `rgba(40,20,10,${a * .6})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
}

/** The RPG act's statements: wide-tracked, warm, settling into the lower frame. */
function rpgSlates(s: Shot, t: number, dark: boolean): void {
  const k = u();
  for (const [from, to, line] of s.slates ?? []) {
    if (t < from - .05 || t > to + .05) continue;
    const a = smooth((t - from) / .6) * (1 - smooth((t - to + .6) / .6));
    const drift = 1.04 - .04 * smooth((t - from) / (to - from));
    ctx.save();
    if (!dark) {
      const veil = ctx.createLinearGradient(0, height * .45, 0, height);
      veil.addColorStop(0, '#02060d00'); veil.addColorStop(1, '#02060dcc');
      ctx.globalAlpha = a; ctx.fillStyle = veil; ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = a;
    ctx.translate(width / 2, dark ? height / 2 : height * .74); ctx.scale(drift, drift);
    text(line, 0, 0, (dark ? 64 : 70) * k, 'center', 800, dark ? '#e9eef7' : '#fff4dc', (dark ? 22 : 18) * k, '#000000ee');
    ctx.restore();
  }
}

/** The RPG title card: silence, then the title slams in over the night lake,
 *  and the card spells out that it launches on its own, after Worlds. */
function rpgCard(t: number, d: number): void {
  const s = u(), hit = .6;
  const leave = 1 - smooth((t - d + 1.1) / .8);
  ctx.save();
  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, '#02060d77'); shade.addColorStop(.5, '#02060d33'); shade.addColorStop(1, '#02060ddd');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
  ctx.restore();
  // Half a second of black, then the slam and a white burn.
  if (t < hit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); return; }
  const lt = t - hit;
  ctx.save(); ctx.globalAlpha = .9 * Math.exp(-lt * 3.2);
  ctx.fillStyle = '#fff4d8'; ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const eyebrow = smooth((lt - 1.0) / .7) * leave;
  ctx.save(); ctx.globalAlpha = eyebrow;
  text(RPG.eyebrow, width / 2, height * .265, 30 * s, 'center', 800, '#e9eef7', 16 * s, '#000000cc');
  ctx.restore();
  const title = smooth(lt / .12) * leave;
  ctx.save(); ctx.globalAlpha = title;
  ctx.translate(width / 2, height * .4);
  const grow = (1 + (1 - smooth(lt / .35)) * .35) * (1.04 - .04 * smooth(lt / 8)); ctx.scale(grow, grow);
  text(RPG.title, 0, 0, 180 * s, 'center', 900, goldFill(0, 180 * s), 32 * s, '#000000ee');
  ctx.restore();
  // The date lands on the second boom.
  const dateAt = 2.4, date = smooth((lt - dateAt) / .2) * leave;
  ctx.save(); ctx.globalAlpha = date;
  ctx.translate(width / 2, height * .555); const slam = 1 + (1 - smooth((lt - dateAt) / .3)) * .3; ctx.scale(slam, slam);
  text(RPG.date, 0, 0, 78 * s, 'center', 900, '#ffffff', 20 * s, '#000000ee');
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .5 * Math.exp(-Math.max(0, lt - dateAt) * 5) * (lt >= dateAt ? 1 : 0);
  ctx.fillStyle = '#fff4d8'; ctx.fillRect(0, 0, width, height);
  ctx.restore();
  // Spelled out: this is its own launch.
  const sep = smooth((lt - 3.6) / .6) * leave;
  ctx.save(); ctx.globalAlpha = sep;
  const rule = 260 * s * smooth((lt - 3.6) / .8);
  ctx.fillStyle = '#ffd35c'; ctx.fillRect(width / 2 - rule, height * .625, rule * 2, 2 * s);
  text(RPG.separate, width / 2, height * .665, 34 * s, 'center', 800, '#ffffff', 9 * s, '#000000ee');
  ctx.restore();
  const early = smooth((lt - 4.6) / .6) * leave;
  ctx.save(); ctx.globalAlpha = early;
  ctx.font = `800 ${28 * s}px ${FONT}`; (ctx as Ctx2).letterSpacing = `${6 * s}px`;
  const tw = ctx.measureText(RPG.early).width + 110 * s;
  (ctx as Ctx2).letterSpacing = '0px';
  ctx.fillStyle = '#ffd35cee'; ctx.beginPath(); ctx.roundRect((width - tw) / 2, height * .725, tw, 62 * s, 31 * s); ctx.fill();
  text(RPG.early, width / 2, height * .725 + 32 * s, 28 * s, 'center', 900, '#1a1206', 6 * s, '#00000000');
  ctx.restore();
  // Two launches, side by side, so nobody mistakes one for the other.
  const both = smooth((lt - 5.6) / .7) * leave;
  ctx.save(); ctx.globalAlpha = both * .95;
  const y = height * .855;
  RPG.launches.forEach(([name, when], i) => {
    const x = width / 2 + (i ? 1 : -1) * 250 * s;
    text(name, x, y - 19 * s, 26 * s, 'center', 900, i ? '#ffd35c' : '#cfe3ff', 6 * s, '#000000ee');
    text(when, x, y + 19 * s, 26 * s, 'center', 700, '#ffffff', 4 * s, '#000000ee');
  });
  ctx.fillStyle = '#ffffff66'; ctx.fillRect(width / 2 - 1 * s, y - 30 * s, 2 * s, 60 * s);
  ctx.restore();
}

function render(t: number, clean = false, branded = false): void {
  const s = SHOTS[shotIndex];
  if (!s) throw new Error('Prepare a shot before rendering.');
  if (!Number.isFinite(t) || t < 0 || t > s.duration) throw new Error(`Invalid shot time ${t}`);
  // Animation is advanced at a fixed 60 Hz even when the output is 30 FPS.
  while (lastTime + 1 / 60 < t - .00001) { lastTime += 1 / 60; animate(lastTime, 1 / 60); }
  animate(t, Math.max(0, t - lastTime));
  lastTime = t;
  applyCamera(s, t);
  // The sunset is keyed to the shot clock, not eased, so every frame is exact.
  sky.snapTo(todOf(s, t));
  sky.update(1 / 60, camera, todOf(s, t));
  voidSky.position.copy(camera.position);
  world.applySky(sky);
  world.timeUniform.value = s.start + t;
  (scene.background as THREE.Color).copy(sky.skyColor);
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(sky.skyColor);
  if (voidSky.visible) fog.color.set(0xc4e5fa);
  [fog.near, fog.far] = FOG[s.set] ?? [90, 185];
  shadows.update(sky.lightDir, camera.position, sky.lightHeight, sky.moonlit, 1 / 30);
  postfx.setSky(sky, camera);
  postfx.render(camera, s.start + t);
  ctx.globalAlpha = 1;
  if (!clean || branded) ctx.filter = s.set === 'disaster' ? 'saturate(1.15) contrast(1.1)' : s.set === 'rpg' ? 'saturate(1.2) contrast(1.12)' : 'saturate(1.1) contrast(1.06)';
  ctx.drawImage(renderer.domElement, 0, 0, width, height);
  ctx.filter = 'none';
  const f = lastFrame!;
  if (f.flash > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, f.flash) * .8; ctx.fillStyle = '#eef4ff'; ctx.fillRect(0, 0, width, height); ctx.restore(); }
  if (!clean) {
    if (s.action === 'reel') reel(t);
    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * .3, width / 2, height / 2, width * .66);
    vignette.addColorStop(0, '#02081200'); vignette.addColorStop(1, s.set === 'rpg' ? '#020812aa' : '#02081266');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    if (s.action === 'pg-whack') popups(f);
    const boxed = s.action !== 'reel' && s.action !== 'logo';
    if (s.action === 'rpg-dark') darkPulse(t);
    if (boxed) letterbox(s.start === 0 ? smooth(t / 1.0) : 1);
    if (s.action === 'logo') lockup(t, s.duration);
    else if (s.action === 'rpg') rpgCard(t, s.duration);
    else if (s.action === 'rpg-dark' || s.action === 'rpg-dusk' || s.action === 'rpg-hero') rpgSlates(s, t, s.action === 'rpg-dark');
    else if (s.action === 'rpg-rise') { /* picture only */ }
    else if (s.action === 'cape-reveal') capeTitle(t);
    else if (s.action === 'cape-tiers') capeTiers(f, t);
    else if (s.action === 'lake') slates(s, t);
    else if (s.action !== 'reel') { caption(s, t); gameTag(s, t); }
    // Soft dip at the cuts; the opening rises from black and the end fades out.
    // The RPG act fades up out of black on its own; the Worlds card fades out fully first.
    const fade = s.start === 0 ? 1 - smooth(t / 1.3) : s.action === 'rpg-dusk' ? 1 - smooth(t / 1.4) : 1 - smooth(t / .1);
    const out = s.action === 'rpg' ? smooth((t - s.duration + 1.0) / .9)
      : s.action === 'logo' ? smooth((t - s.duration + .7) / .6)
        : s.action === 'rpg-rise' ? 0 : smooth((t - s.duration + .1) / .1);
    ctx.fillStyle = `rgba(2,6,13,${Math.max(fade, out)})`; ctx.fillRect(0, 0, width, height);
  }
  if (branded) {
    ctx.fillStyle = '#edf5ffe0';
    ctx.shadowColor = '#06102050'; ctx.shadowBlur = width * .012;
    ctx.beginPath();
    ctx.roundRect(width * .04, height * .055, width * .37, height * .11, width * .009);
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.drawImage(logo, width * .055, height * .071, width * .34, width * .34 * 120 / 900);
    text(RELEASE, width * .055, height * .91, width * .022, 'left', 800, '#ffffff', 6);
  }
}

const select = document.getElementById('shot') as HTMLSelectElement;
SHOTS.forEach((s, i) => { const option = new Option(s.id, String(i)); select.add(option); });
select.addEventListener('change', () => { if (!exporting) void prepare(Number(select.value)); });
document.getElementById('play')!.addEventListener('click', async () => {
  if (exporting) return;
  if (previewing) { previewing = false; return; }
  await prepare(Number(select.value));
  previewOrigin = performance.now(); previewStart = SHOTS[shotIndex].start; previewing = true;
});
async function preview(): Promise<void> {
  if (previewing) {
    const seconds = previewStart + (performance.now() - previewOrigin) / 1000;
    const index = SHOTS.findIndex(s => seconds >= s.start && seconds < s.start + s.duration);
    if (index < 0) previewing = false;
    else if (index !== shotIndex) {
      const before = performance.now();
      await prepare(index);
      previewOrigin += performance.now() - before;
      select.value = String(index); previewing = true;
    } else render(seconds - SHOTS[index].start);
  }
  requestAnimationFrame(() => { void preview(); });
}

const api = {
  shots: SHOTS, screenshots: SCREENSHOTS, heroFrames: HERO_FRAMES, duration: DURATION, seed, canvas,
  prepare, render, resize,
  setExporting(on: boolean) { exporting = on; previewing = false; document.getElementById('controls')!.hidden = on; },
  get logoSVG() { return logoSVG; },
  /** The block the stage's world holds at a cell. */
  probe(x: number, y: number, z: number) { return world.getBlock(x, y, z); },
  /** Cheap capture diagnostics; samples the actual stage without advancing it. */
  info() {
    const s = SHOTS[shotIndex];
    return {
      seed, shot: s?.id, time: lastTime, firstOrder, anchor: anchor.toArray(), camera: camera.position.toArray(), fov: camera.fov,
      actors: lastFrame?.actors.map(a => ({ slot: a.slot, pos: a.pos, item: a.item })) ?? [],
      head: dragon.headPosition().toArray(),
    };
  },
  /** Every visible body must be finite and holding what the shot says it holds. */
  validateRig() {
    const failures: string[] = [];
    for (const a of actors.filter(a => a.pivot.visible)) {
      const p = a.pivot.position;
      if (![p.x, p.y, p.z].every(Number.isFinite)) failures.push('Actor position is not finite');
      if (a.item > 0 && ITEMS[a.item] && !a.equipment) failures.push(`Actor lost item ${a.item}`);
      if (a.equipment && !a.equipment.root.parent) failures.push('Equipment is detached from its body');
    }
    if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) failures.push('Camera position is not finite');
    if (failures.length) throw new Error(failures.join('; '));
    return true;
  },
};
declare global { interface Window { __trailer: typeof api } }
window.__trailer = api;
async function initialize(): Promise<void> {
  await Promise.all([loadLogo(), loadPosters()]);
  await prepare(Number(params.get('shot')) || 0);
  document.body.dataset.ready = 'true';
  if (!capture) void preview();
}
void initialize().catch(error => {
  status.textContent = String(error);
  document.body.dataset.error = String(error);
  console.error(error);
});
