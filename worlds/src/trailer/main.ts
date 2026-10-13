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
import { itemGeometry, itemGeometrySolid } from '../item_geometry';
import { ITEMS } from '../items';
import { createRatModel, createCheeseModel, createCatModel, type RatModel, type CatModel } from '../ratseek_models';
import { createBedwarsModels, type BedwarsModels } from '../bedwars_models';
import { bwMap, BW_BOUNDS } from '../bedwars_map';
import { configureCaptureQuality, sizeCapture, loadCaptureChunks } from '../media/offline';
import { warmCaptureDragon } from '../media/dragon';
import { createTrailerCourse, trailerShotContext, trailerFrame, trailerEdits, trailerEvents, trailerDragonCue, captureSmooth as smooth, type StageFrame, type StageEdit, type StageEvent } from './staging';
import { SHOTS, SCREENSHOTS, RELEASE, DURATION, type Shot } from './shots';

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
let generator = lake as WorldGenerator;
const world = new World(scene, atlas, generator);
world.setSmoothLighting(true);
const sky = new Sky(scene, TEXTURE_SEED);
sky.setShaders(true);
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
];
const itemMat = createAvatarItemMaterial(atlas);
interface Actor { body: AvatarBody; pivot: THREE.Group; equipment: AvatarEquipment | null; item: number; flash: THREE.Mesh | null }
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
const flashGeo = new THREE.IcosahedronGeometry(.07, 0);
const actors: Actor[] = CAST.map(c => {
  const body = buildAvatarBody(defaultCosmetics(c.seed), new THREE.Color(c.shirt));
  const pivot = new THREE.Group();
  pivot.add(body.group); body.group.position.y = -.9;
  pivot.visible = false;
  scene.add(pivot);
  return { body, pivot, equipment: null, item: -1, flash: null };
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
const dropMeshes: THREE.Mesh[] = [];
let bedwarsModels: BedwarsModels | null = null;
const bwTheme = bwMap(0);

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
  { id: 'bedwars', name: 'BEDWARS', accent: '#ff5a5f' }, { id: 'bridge', name: 'THE BRIDGE', accent: '#4da3ff' },
  { id: 'duels', name: 'DUELS', accent: '#ffb347' }, { id: 'parkour', name: 'PARKOUR', accent: '#46d6a5' },
  { id: 'ratseek', name: 'RAT AND SEEK', accent: '#c58cff' },
].map(p => ({ ...p, image: new Image() }));
async function loadPosters(): Promise<void> {
  await Promise.all(POSTERS.map(async p => { p.image.src = `/cards/${p.id}.webp`; await p.image.decode(); }));
}
const ACCENT: Record<string, string> = {
  bedwars: '#ff5a5f', bridge: '#4da3ff', duel: '#ffb347', parkour: '#46d6a5', manor: '#c58cff', lake: '#ffffff',
};
const GAME_NAME: Record<string, string> = { bedwars: 'BEDWARS', bridge: 'THE BRIDGE', duel: 'DUELS', parkour: 'PARKOUR', manor: 'RAT AND SEEK' };

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

const todOf = (s: Shot): number => s.set === 'manor' ? .10 : s.set === 'lake' ? (s.action === 'logo' ? .09 : .11) : s.set === 'bedwars' ? .17 : .14;
const generatorFor = (set: Shot['set']): WorldGenerator =>
  set === 'lake' ? lake : worldGenerator({ kind: set === 'duel' ? 'duel' : set === 'manor' ? 'ratseek' : set, seed: set === 'bedwars' ? 0 : seed });

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
  const previous = SHOTS[shotIndex];
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
  if (!previous || previous.set !== s.set) {
    generator = generatorFor(s.set);
    world.setGenerator(generator);
  }
  if (s.set === 'bedwars') {
    if (!bedwarsModels) { bedwarsModels = createBedwarsModels(bwTheme, 4, atlas); scene.add(bedwarsModels.group); }
    bedwarsModels.group.visible = true;
  } else if (bedwarsModels) bedwarsModels.group.visible = false;
  if (s.set === 'lake') world.setArenaRenderBounds(null);
  else world.setArenaRenderBounds(s.set === 'bedwars' ? BW_BOUNDS : generator.bounds, s.set === 'manor' ? .55 : .65);
  sky.snapTo(todOf(s));
  if (s.set === 'parkour') {
    ({ firstOrder, anchor } = trailerShotContext(s, course));
    dragon.enter(course, parkourTheme(seed), 0, 0);
    warmCaptureDragon(dragon, firstOrder);
  }
  edits = trailerEdits(s); events = trailerEvents(s);
  const frame = trailerFrame(s, s.duration / 2, env());
  const center = s.set === 'lake' ? new THREE.Vector3(0, 0, 0)
    : s.set === 'bedwars' ? new THREE.Vector3(-50, 0, 3)
      : s.set === 'bridge' ? new THREE.Vector3(12, 0, 40)
        : s.set === 'duel' ? new THREE.Vector3(22, 0, 22)
          : s.set === 'manor' ? (s.action === 'rs-manor' ? new THREE.Vector3(14, 0, 28) : s.action === 'rs-rescue' ? new THREE.Vector3(22, 0, 2) : new THREE.Vector3(4, 0, 5)) : anchor;
  const radius = s.set === 'lake' ? 8 : s.set === 'parkour' ? 7 : s.set === 'bedwars' ? 6 : s.set === 'bridge' && s.action === 'br-arena' ? 5 : 4;
  void frame;
  await loadCaptureChunks(world, center.x, center.z, radius, 30, s.id);
  hideAll();
  applyEdits(0);
  render(0);
  status.textContent = s.id;
}

function applyEdits(t: number): void {
  edits.forEach(([x, y, z, block, at], i) => {
    if (at > t + 1e-6 || editNext.has(i)) return;
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
  dropMeshes.forEach(m => { m.visible = false; });
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

function drawFrame(f: StageFrame, t: number): void {
  hideAll();
  const used = new Set<number>();
  for (const p of f.actors) {
    const a = actors[p.slot];
    if (!a || p.visible === false) continue;
    used.add(p.slot);
    equip(a, p.item);
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
    let m = dropMeshes[i];
    const info = ITEMS[d.item];
    const geo = info?.kind === 'block' ? itemGeometry(atlas, d.item) : itemGeometrySolid(atlas, d.item, .42, .05);
    if (!m) { m = new THREE.Mesh(geo, itemMat); scene.add(m); dropMeshes[i] = m; }
    m.geometry = geo; m.visible = true;
    m.position.set(...d.pos); m.scale.setScalar(1.15 * d.scale); m.rotation.set(0, t * 2.6 + i, 0);
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
  if (bedwarsModels) bedwarsModels.beds[0].visible = f.bed;
}

function stepEffects(t: number, dt: number): void {
  const s = SHOTS[shotIndex];
  if (s.set === 'parkour') {
    const cue = trailerDragonCue(t, firstOrder);
    dragon.sync(cue.front, cue.speed, cue.now);
    if (s.action === 'pk-dragon' && t > 1.4 && !fireSent && lastFrame) {
      const target = lastFrame.actors[0].pos;
      dragon.fireball({ id: 1, tx: target[0], ty: target[1], tz: target[2] + 4, launchAt: 24400, landAt: 26600 });
      fireSent = true;
    }
    dragon.update(dt, cue.now, 0, false);
  }
  while (eventsNext < events.length && events[eventsNext].at <= t) {
    const e = events[eventsNext++], [x, y, z] = e.pos;
    if (e.kind === 'debris') particles.debris(x, y, z, e.color, 12);
    else if (e.kind === 'ring') particles.ring(x, y, z, e.color, 28, 5, .8);
    else if (e.kind === 'burst') particles.burst(x, y, z, 22, e.color, 4.5, .7, { additive: true, scale: 1.2 });
    else if (e.kind === 'death') particles.deathBurst(x, y, z, e.color);
    else if (e.kind === 'poof') particles.poof(x, y, z);
    else if (e.kind === 'heal') particles.heal(x, y, z, 10);
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
  bedwarsModels?.update(s.start + t);
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
  if (f.shake) camera.position.add(new THREE.Vector3(Math.sin(t * 91) * f.shake, Math.sin(t * 77 + 1) * f.shake, Math.sin(t * 63 + 2) * f.shake));
  camera.lookAt(c.target);
  camera.fov = c.fov;
  camera.updateProjectionMatrix();
}

// ── 2D overlays ─────────────────────────────────────────────────────────
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
function text(line: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', weight = 800, color = '#f7faff', spacing = 0, shadow = '#04101fcc'): void {
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${size}px ${FONT}`;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
  ctx.shadowColor = shadow; ctx.shadowBlur = size * .45; ctx.shadowOffsetY = size * .06;
  ctx.fillStyle = color;
  ctx.fillText(line, x, y);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
}

/** Caption block: a coloured bar, the game name (first shot of a game) and one line of explanation. */
function caption(s: Shot, t: number): void {
  const accent = ACCENT[s.set] ?? '#fff';
  const enter = smooth((t - .25) / .5), leave = 1 - smooth((t - s.duration + .55) / .45);
  const a = enter * leave;
  if (a <= 0 || (!s.label && !s.title)) return;
  const x = width * .065, base = height * .835, u = height / 1080;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate((1 - enter) * -40 * u, 0);
  const lineSize = 40 * u;
  const hasTitle = !!s.title;
  const barH = hasTitle ? 150 * u : 56 * u;
  ctx.fillStyle = accent; ctx.shadowColor = '#04101f88'; ctx.shadowBlur = 14 * u;
  ctx.fillRect(x - 28 * u, base - barH * .72, 9 * u, barH);
  ctx.shadowBlur = 0;
  if (hasTitle) {
    text(s.title!, x, base - 52 * u, 96 * u, 'left', 900, '#ffffff', 3 * u);
    text(s.label, x + 3 * u, base + 40 * u, lineSize, 'left', 700, '#eef4ff', .5 * u);
  } else text(s.label, x, base, lineSize, 'left', 700, '#ffffff', .5 * u);
  ctx.restore();
}

/** A small tag that stays in the corner for the whole of a game's section. */
function gameTag(s: Shot, t: number): void {
  const name = GAME_NAME[s.set];
  if (!name || s.title) return;
  const accent = ACCENT[s.set], u = height / 1080;
  const a = smooth(t / .4) * (1 - smooth((t - s.duration + .3) / .3));
  ctx.save(); ctx.globalAlpha = a * .95;
  ctx.font = `800 ${24 * u}px ${FONT}`; (ctx as unknown as { letterSpacing: string }).letterSpacing = `${3 * u}px`;
  const w = ctx.measureText(name).width + 62 * u, h = 46 * u, x = width * .065 - 28 * u, y = height * .07;
  ctx.fillStyle = '#071221cc'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 23 * u); ctx.fill();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x + 24 * u, y + h / 2, 7 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(name, x + 42 * u, y + h / 2 + 1 * u);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  ctx.restore();
}

/** The five games as a poster wall, each column rising in on a beat. */
function reel(t: number): void {
  ctx.save();
  ctx.fillStyle = '#060d18'; ctx.fillRect(0, 0, width, height);
  const colW = width / POSTERS.length;
  POSTERS.forEach((p, i) => {
    const k = smooth((t - i * .8) / .55);
    if (k <= 0) return;
    const x = i * colW, rise = (1 - k) * height * .35;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, 0, colW - 4, height); ctx.clip();
    ctx.globalAlpha = k;
    const iw = p.image.naturalWidth, ih = p.image.naturalHeight, ground = p.id === 'bedwars' ? 0 : ih * .2;
    const srcH = ih - ground, scale = height / srcH * 1.06;
    const sw = colW / scale, focus = p.id === 'bedwars' ? .62 : .5, sx = Math.max(0, Math.min(iw - sw, iw * focus - sw / 2));
    ctx.drawImage(p.image, sx, 0, sw, srcH, x, rise, colW, srcH * scale);
    const g = ctx.createLinearGradient(0, height * .55, 0, height);
    g.addColorStop(0, '#04101800'); g.addColorStop(1, '#041018f0');
    ctx.fillStyle = g; ctx.fillRect(x, 0, colW, height);
    ctx.fillStyle = p.accent; ctx.fillRect(x + colW * .12, height * .865, colW * .76 * smooth((t - i * .8 - .2) / .5), 6 * height / 1080);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = k;
    // Long names wrap onto two lines at the last space.
    const cut = p.name.length > 9 ? p.name.lastIndexOf(' ') : -1;
    if (cut > 0) {
      const size = colW * .13;
      text(p.name.slice(0, cut), x + colW / 2, height * .905, size, 'center', 900, '#fff', 1.5);
      text(p.name.slice(cut + 1), x + colW / 2, height * .945, size, 'center', 900, '#fff', 1.5);
    } else text(p.name, x + colW / 2, height * .93, colW * .16, 'center', 900, '#fff', 1.5);
    ctx.restore();
  });
  ctx.restore();
}

function lockup(t: number, d: number): void {
  const k = smooth(t / 1.3), u = height / 1080;
  ctx.save();
  ctx.globalAlpha = k;
  const w = width * .56, h = w * 120 / 900;
  const x = (width - w) / 2, y = height * .36 - h / 2 - (1 - k) * height * .025;
  // The exact dark-ink logo needs a bright, soft ground to stay readable.
  const glow = ctx.createRadialGradient(width / 2, y + h / 2, w * .05, width / 2, y + h / 2, w * .75);
  glow.addColorStop(0, '#f2f8ffee'); glow.addColorStop(.6, '#edf5ffc0'); glow.addColorStop(1, '#edf5ff00');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(logo, x, y, w, h);
  const reveal = smooth((t - 1.8) / .45);
  ctx.globalAlpha = k * reveal;
  ctx.save();
  ctx.translate(width / 2, height * .6);
  ctx.scale(1 + (1 - reveal) * .2, 1 + (1 - reveal) * .2);
  text(RELEASE, 0, 0, 62 * u, 'center', 900, '#0d2340', 14 * u, '#ffffffdd');
  ctx.restore();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = .3 * Math.exp(-Math.max(0, t - 1.8) * 5) * reveal;
  ctx.fillStyle = '#fff1d2'; ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const names = smooth((t - 2.6) / .7);
  ctx.save(); ctx.globalAlpha = names;
  text(POSTERS.map(p => p.name).join('   ·   '), width / 2, height * .715, 24 * u, 'center', 800, '#ffffff', 4 * u);
  ctx.restore();
  const early = smooth((t - 3.7) / .7) * (1 - smooth((t - d + .9) / .6));
  ctx.save(); ctx.globalAlpha = early;
  ctx.font = `800 ${28 * u}px ${FONT}`;
  const msg = 'EARLY ACCESS STARTS WITHIN DAYS', tw = ctx.measureText(msg).width + 90 * u;
  ctx.fillStyle = '#ffffffee'; ctx.beginPath(); ctx.roundRect((width - tw) / 2, height * .795, tw, 62 * u, 31 * u); ctx.fill();
  text(msg, width / 2, height * .795 + 32 * u, 28 * u, 'center', 800, '#0d2340', 3 * u);
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
  sky.update(1 / 60, camera, todOf(s));
  world.applySky(sky);
  world.timeUniform.value = s.start + t;
  (scene.background as THREE.Color).copy(sky.skyColor);
  (scene.fog as THREE.Fog).color.copy(sky.skyColor);
  const fog = scene.fog as THREE.Fog;
  fog.near = s.set === 'lake' ? 62 : s.set === 'bedwars' ? 110 : 90;
  fog.far = s.set === 'lake' ? 150 : s.set === 'bedwars' ? 230 : 185;
  shadows.update(sky.lightDir, camera.position, sky.lightHeight, sky.moonlit, 1 / 30);
  postfx.setSky(sky, camera);
  postfx.render(camera, s.start + t);
  ctx.globalAlpha = 1;
  if (!clean || branded) ctx.filter = 'saturate(1.1) contrast(1.05)';
  ctx.drawImage(renderer.domElement, 0, 0, width, height);
  ctx.filter = 'none';
  if (!clean) {
    if (s.action === 'reel') reel(t);
    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * .3, width / 2, height / 2, width * .66);
    vignette.addColorStop(0, '#02081200'); vignette.addColorStop(1, '#02081255');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    if (s.action === 'logo') lockup(t, s.duration);
    else if (s.action !== 'reel') { caption(s, t); gameTag(s, t); }
    // Soft dip at the cuts; the opening rises from black and the end fades out.
    const fade = s.start === 0 ? 1 - smooth(t / 1.3) : 1 - smooth(t / .12);
    const out = s.action === 'logo' ? smooth((t - s.duration + .8) / .8) : smooth((t - s.duration + .12) / .12);
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
  shots: SHOTS, screenshots: SCREENSHOTS, duration: DURATION, seed, canvas,
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
  await prepare(0);
  document.body.dataset.ready = 'true';
  if (!capture) void preview();
}
void initialize().catch(error => {
  status.textContent = String(error);
  document.body.dataset.error = String(error);
  console.error(error);
});
