// Standalone in-engine cinematic stage. No accounts, sockets or live matches.
// Capture advances simulation time explicitly, independent of rendering speed.
import * as THREE from 'three';
import { createAtlas } from '../textures';
import { World } from '../world';
import { worldGenerator } from '../multiverse';
import { TitleTerrain } from '../title_terrain';
import { TEXTURE_SEED } from '../title_backdrop';
import { Sky } from '../sky';
import { PostFX } from '../postfx';
import { SunShadow } from '../shadows';
import { Particles } from '../particles';
import { DragonView } from '../parkour_dragon';
import { parkourTheme } from '../parkour_themes';
import { buildAvatarBody, poseGunHold, releaseGunHold } from '../avatar';
import { defaultCosmetics } from '../character';
import { createGunModel, poseGunModel } from '../gunmodels';
import { createRatModel, createCheeseModel } from '../ratseek_models';
import { createHeldAxe, fitHands, muzzleLine, PALM } from '../media/grips';
import { configureCaptureQuality, sizeCapture, loadCaptureChunks, poseCaptureStride } from '../media/offline';
import { warmCaptureDragon } from '../media/dragon';
import { createTrailerCourse, trailerShotContext, trailerCamera, trailerActorPoses, trailerRatPoses, trailerDragonCue, captureSmooth as smooth } from './staging';
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
let generator = lake as import('../multiverse').WorldGenerator;
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
const actors = [0xe25360, 0x548af2, 0xedb957, 0x48bda0].map((color, i) => {
  const body = buildAvatarBody(defaultCosmetics(300 + i * 371), new THREE.Color(color));
  scene.add(body.group);
  const gun = createGunModel();
  poseGunModel(gun, 'avatar');
  body.group.add(gun);
  const axe = createHeldAxe();
  body.parts[3].add(axe);
  return { body, gun, axe };
});
const rats = [createRatModel(), createRatModel(), createRatModel(true)];
rats.forEach(r => scene.add(r.group));
const cheese = createCheeseModel();
scene.add(cheese);
const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(.055, 0), new THREE.MeshBasicMaterial({ color: 0xffdd80 }));
scene.add(flash);
const tracer = new THREE.Mesh(new THREE.BoxGeometry(.035, .035, 4), new THREE.MeshBasicMaterial({ color: 0xffd587, transparent: true, opacity: .65 }));
scene.add(tracer);

// Fetch the title-screen lockup itself: one source of truth for the branding.
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

let shotIndex = -1;
let lastTime = 0;
let fireSent = false;
let freed = false;
let anchor = new THREE.Vector3();
let firstOrder = 0;
let previewing = false;
let exporting = false;
let previewOrigin = 0;
let previewStart = 0;
let width = 1920, height = 1080;

function resize(w: number, h: number): void {
  sizeCapture(renderer, postfx, camera, w, h);
  width = w; height = h;
  canvas.width = w; canvas.height = h;
}
resize(Number(params.get('width')) || 1920, Number(params.get('height')) || 1080);

function shotCamera(s: Shot, t: number): void {
  const pose = trailerCamera(s, t, { anchor, firstOrder }, dragon.headPosition());
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
}

async function prepare(index: number): Promise<void> {
  if (!Number.isInteger(index) || !SHOTS[index]) throw new Error(`Invalid shot ${index}`);
  previewing = false;
  const previous = SHOTS[shotIndex];
  const s = SHOTS[index];
  shotIndex = index;
  lastTime = 0;
  fireSent = false;
  freed = false;
  // Seed presentation effects independently for every take.
  let rng = seed ^ (index * 7919);
  Math.random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  status.textContent = `Loading ${s.id}…`;
  dragon.clear();
  particles.update(10, camera);
  actors.forEach(a => { a.body.group.visible = false; a.gun.visible = false; a.axe.visible = false; });
  rats.forEach((r, i) => { r.group.visible = false; r.setCaged(i === 2); });
  cheese.visible = flash.visible = tracer.visible = false;
  if (!previous || previous.set !== s.set || s.action === 'rescue' || previous.action === 'rescue') {
    generator = s.set === 'lake' ? lake : worldGenerator({ kind: s.set === 'duel' ? 'duel' : s.set === 'manor' ? 'ratseek' : s.set, seed });
    world.setGenerator(generator);
  }
  const ambient = s.set === 'manor' ? .4 : .65;
  if (s.set === 'lake') world.setArenaRenderBounds(null);
  else world.setArenaRenderBounds(generator.bounds, ambient);
  const tod = s.set === 'manor' ? .10 : s.set === 'lake' ? .11 : .14;
  sky.snapTo(tod);
  if (s.set === 'parkour') {
    ({ firstOrder, anchor } = trailerShotContext(s, course));
    dragon.enter(course, parkourTheme(seed), 0, 0);
    warmCaptureDragon(dragon, firstOrder);
  }
  shotCamera(s, s.duration / 2);
  const center = s.set === 'lake' ? new THREE.Vector3(0, 0, 0)
    : s.set === 'bridge' ? new THREE.Vector3(12, 0, 40)
      : s.set === 'duel' ? new THREE.Vector3(22, 0, 22)
        : s.set === 'manor' ? new THREE.Vector3(4, 0, 5) : anchor;
  const radius = s.set === 'lake' ? 8 : s.set === 'parkour' ? 7 : 4;
  await loadCaptureChunks(world, center.x, center.z, radius, 30, s.id);
  render(0);
  status.textContent = s.id;
}

function poseActor(i: number, p: THREE.Vector3, yaw: number, t: number, gun = false, attack = 0, speed = 4): void {
  const a = actors[i];
  releaseGunHold(a.body);
  a.body.group.visible = true;
  a.body.group.position.copy(p);
  a.body.group.rotation.y = yaw;
  poseCaptureStride(a.body, t * 9 + i, speed, gun || attack > 0, attack);
  a.gun.visible = gun;
  a.axe.visible = !gun && attack > 0;
  if (gun) {
    poseGunHold(a.body, a.gun, { pitch: 0, aim: .6, reload: 0, kick: Math.max(0, Math.sin(t * 18)) * .3 });
    fitHands(a.body, a.gun);
  }
}

function animate(t: number, dt: number): void {
  const s = SHOTS[shotIndex];
  for (const pose of trailerActorPoses(s, t, { anchor, firstOrder }, course, generator)) {
    poseActor(pose.index, pose.position, pose.yaw, pose.time, pose.gun, pose.attack, pose.speed);
  }
  if (s.action === 'duel') {
    const { origin, direction } = muzzleLine(actors[0].gun);
    flash.visible = t > .5 && t % .5 < .1;
    flash.position.copy(origin);
    tracer.visible = flash.visible;
    tracer.position.copy(origin).addScaledVector(direction, 2);
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  } else if (s.action === 'run' || s.action === 'dragon') {
    const cue = trailerDragonCue(t, firstOrder);
    dragon.sync(cue.front, cue.speed, cue.now);
    if (s.action === 'dragon' && t > 1.4 && !fireSent) {
      const target = actors[0].body.group.position;
      dragon.fireball({ id: 1, tx: target.x, ty: target.y, tz: target.z + 5, launchAt: 24500, landAt: 26700 });
      fireSent = true;
    }
    dragon.update(dt, cue.now, 0, false);
  } else if (s.action === 'rats') {
    trailerRatPoses(s, t).forEach((pose, i) => {
      const r = rats[i];
      r.group.visible = true;
      r.group.position.fromArray(pose.position);
      r.group.rotation.y = pose.yaw;
      r.pose(pose.speed, pose.phase, t);
    });
    cheese.visible = true;
    cheese.position.copy(rats[0].group.position).add(new THREE.Vector3(0, .32, -.48));
    cheese.scale.setScalar(.55);
  } else if (s.action === 'rescue') {
    if (!freed && t > .85) {
      // A freed rat is teleported out by the real game too; the cage stays shut.
      rats[2].setCaged(false);
      freed = true;
    }
    trailerRatPoses(s, t, freed).forEach((pose, i) => {
      const r = rats[i];
      r.group.visible = true;
      r.group.position.fromArray(pose.position);
      r.group.rotation.y = pose.yaw;
      r.pose(pose.speed, pose.phase, t);
    });
    cheese.visible = !freed;
    cheese.position.set(25.2, 81.5, .5);
    cheese.scale.setScalar(.7);
  }
  particles.update(dt, camera);
}

function text(line: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center'): void {
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.shadowColor = '#061020'; ctx.shadowBlur = size * .5;
  ctx.fillStyle = '#f5f8ff';
  ctx.fillText(line, x, y);
  ctx.shadowBlur = 0;
}

// A deliberately indistinct silhouette: no emblem, trim or final cape design.
const cape = document.createElement('canvas');
cape.width = 600; cape.height = 740;
const capeCtx = cape.getContext('2d')!;
capeCtx.filter = 'blur(32px)';
capeCtx.fillStyle = '#020307';
capeCtx.beginPath();
capeCtx.moveTo(230, 120); capeCtx.quadraticCurveTo(300, 82, 370, 120);
capeCtx.bezierCurveTo(385, 270, 440, 460, 453, 600);
capeCtx.quadraticCurveTo(306, 653, 154, 600);
capeCtx.bezierCurveTo(173, 420, 217, 260, 230, 120);
capeCtx.fill();

function earlyAccess(t: number): void {
  ctx.save();
  ctx.fillStyle = '#070b17'; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * .27, height * .52, 0, width * .27, height * .52, height * .62);
  glow.addColorStop(0, '#383150'); glow.addColorStop(.5, '#17182d'); glow.addColorStop(1, '#070b17');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = smooth(t / 1.2);
  const sway = Math.sin(t * .4) * width * .006;
  ctx.drawImage(cape, width * .075 + sway, height * .15, width * .37, height * .74);
  // Soft, defocused motes keep the tease cinematic without revealing details.
  ctx.fillStyle = '#b9a5e9';
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = (.025 + .025 * Math.sin(t + i)) * smooth(t / 1.2);
    ctx.beginPath(); ctx.arc(width * (.09 + ((i * 37) % 29) / 100), height * (.18 + ((i * 23 + t * 3) % 62) / 100), width * .002, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = smooth((t - .2) / .8);
  const x = width * .65;
  text('EARLY ACCESS', x, height * .25, width * .021);
  text('Starting within the next few days', x, height * .33, width * .018);
  ctx.globalAlpha *= smooth((t - 1) / .8);
  text('VOID CAPE', x, height * .49, width * .044);
  text('Participate in early access to get it.', x, height * .59, width * .016);
  ctx.globalAlpha *= smooth((t - 2) / .8);
  text('After early access, it will NEVER', x, height * .72, width * .015);
  text('be obtainable again. EVER.', x, height * .77, width * .018);
  ctx.restore();
}

function lockup(t: number): void {
  if (SHOTS[shotIndex].id === '17-early-access') { earlyAccess(t); return; }
  const k = smooth(t / 1.3);
  ctx.save();
  ctx.globalAlpha = k;
  const w = width * .58, h = w * 120 / 900;
  const x = (width - w) / 2, y = height * .38 - h / 2 - (1 - k) * height * .025;
  // Keep the exact dark-ink logo readable over the panorama.
  const glow = ctx.createRadialGradient(width / 2, y + h / 2, w * .05, width / 2, y + h / 2, w * .8);
  glow.addColorStop(0, '#edf5ffe8'); glow.addColorStop(.6, '#edf5ffb8'); glow.addColorStop(1, '#edf5ff00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(logo, x, y, w, h);
  // A short anticipation beat, then a date impact with an expanding glow.
  const reveal = smooth((t - 1.8) / .45);
  ctx.globalAlpha *= reveal;
  ctx.translate(width / 2, height * .61);
  ctx.scale(1 + (1 - reveal) * .22, 1 + (1 - reveal) * .22);
  text(RELEASE, 0, 0, width * .047);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = .32 * Math.exp(-Math.max(0, t - 2) * 4) * reveal;
  ctx.fillStyle = '#fff1d2'; ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = smooth((t - 2.6) / .7);
  text('DUELS  /  THE BRIDGE  /  PARKOUR  /  RAT AND SEEK', width / 2, height * .73, width * .013);
  ctx.restore();
}

function render(t: number, clean = false, branded = false): void {
  const s = SHOTS[shotIndex];
  if (!s) throw new Error('Prepare a shot before rendering.');
  if (!Number.isFinite(t) || t < 0 || t > s.duration) throw new Error(`Invalid shot time ${t}`);
  // Animation is advanced at a fixed 60 Hz even when the output is 30 FPS.
  while (lastTime + 1 / 60 < t - .00001) {
    lastTime += 1 / 60;
    animate(lastTime, 1 / 60);
  }
  animate(t, Math.max(0, t - lastTime));
  lastTime = t;
  shotCamera(s, t);
  const tod = s.set === 'manor' ? .1 : s.set === 'lake' ? .11 : .14;
  sky.update(1 / 60, camera, tod);
  world.applySky(sky);
  world.timeUniform.value = s.start + t;
  (scene.background as THREE.Color).copy(sky.skyColor);
  (scene.fog as THREE.Fog).color.copy(sky.skyColor);
  const fog = scene.fog as THREE.Fog;
  fog.near = s.set === 'lake' ? 62 : 90;
  fog.far = s.set === 'lake' ? 150 : 185;
  shadows.update(sky.lightDir, camera.position, sky.lightHeight, sky.moonlit, 1 / 30);
  postfx.setSky(sky, camera);
  postfx.render(camera, s.start + t);
  ctx.globalAlpha = 1;
  ctx.drawImage(renderer.domElement, 0, 0, width, height);
  if (!clean) {
    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * .25, width / 2, height / 2, width * .63);
    vignette.addColorStop(0, '#030a1800'); vignette.addColorStop(1, '#030a1860');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    const bar = Math.round(height * .07);
    ctx.fillStyle = '#080d17'; ctx.fillRect(0, 0, width, bar); ctx.fillRect(0, height - bar, width, bar);
    if (s.action === 'logo') lockup(t);
    else if (s.label) {
      ctx.save();
      ctx.globalAlpha = smooth((t - .3) / .6) * (1 - smooth((t - s.duration + .65) / .5));
      text(s.label, width / 2, height * .82, width * .023);
      ctx.restore();
    }
    const fade = s.start === 0 ? 1 - smooth(t / 1.3) : 1 - smooth(t / .18);
    const out = s.action === 'logo' ? smooth((t - s.duration + .65) / .65) : smooth((t - s.duration + .18) / .18);
    ctx.fillStyle = `rgba(3,8,15,${Math.max(fade, out)})`; ctx.fillRect(0, 0, width, height);
  }
  if (branded) {
    ctx.fillStyle = '#edf5ffe0';
    ctx.shadowColor = '#06102050'; ctx.shadowBlur = width * .012;
    ctx.beginPath();
    ctx.roundRect(width * .04, height * .055, width * .37, height * .11, width * .009);
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.drawImage(logo, width * .055, height * .071, width * .34, width * .34 * 120 / 900);
    text(RELEASE, width * .055, height * .91, width * .022, 'left');
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
  /** Cheap capture diagnostics; samples the actual stage without advancing it. */
  info() {
    const s = SHOTS[shotIndex];
    return {
      seed, shot: s?.id, time: lastTime, firstOrder,
      anchor: anchor.toArray(), camera: camera.position.toArray(), fov: camera.fov,
      target: s ? trailerCamera(s, lastTime, { anchor, firstOrder }, dragon.headPosition()).target.toArray() : null,
      head: dragon.headPosition().toArray(),
      actors: actors.filter(a => a.body.group.visible).map(a => ({
        position: a.body.group.position.toArray(), yaw: a.body.group.rotation.y,
        parts: a.body.parts.map(p => ({ rotation: p.rotation.toArray(), scale: p.scale.toArray() })),
        gun: a.gun.visible, axe: a.axe.visible,
      })),
      rats: rats.filter(r => r.group.visible).map(r => r.group.position.toArray()),
    };
  },
  validateRig() {
    const failures: string[] = [];
    for (const a of actors.filter(a => a.body.group.visible)) {
      a.body.group.updateWorldMatrix(true, true);
      if (a.axe.visible && a.body.parts[3].localToWorld(PALM.clone()).distanceTo(a.axe.getWorldPosition(new THREE.Vector3())) > .001) failures.push('Axe detached from palm');
      if (a.gun.visible) {
        const grip = a.gun.localToWorld(new THREE.Vector3(0, -.15, .03));
        if (a.body.parts[3].localToWorld(PALM.clone()).distanceTo(grip) > .001) failures.push('Rifle trigger hand detached');
        const support = a.gun.getObjectByName('grip2')!.getWorldPosition(new THREE.Vector3());
        support.add(new THREE.Vector3(0, -.08, 0).applyQuaternion(a.gun.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(a.gun.scale.y));
        if (a.body.parts[2].localToWorld(PALM.clone()).distanceTo(support) > .001) failures.push('Rifle support hand detached');
      }
    }
    if (tracer.visible) {
      const { origin, direction } = muzzleLine(actors[0].gun);
      const start = tracer.localToWorld(new THREE.Vector3(0, 0, -2));
      if (start.distanceTo(origin) > .001 || flash.position.distanceTo(origin) > .001) failures.push('Muzzle effects detached');
      const ray = new THREE.Vector3(0, 0, 1).applyQuaternion(tracer.quaternion);
      if (ray.dot(direction) < .999) failures.push('Tracer off barrel axis');
    }
    if (failures.length) throw new Error(failures.join('; '));
    return true;
  },
};
declare global { interface Window { __trailer: typeof api } }
window.__trailer = api;
async function initialize(): Promise<void> {
  await loadLogo();
  await prepare(0);
  document.body.dataset.ready = 'true';
  if (!capture) void preview();
}
void initialize().catch(error => {
  status.textContent = String(error);
  document.body.dataset.error = String(error);
  console.error(error);
});
