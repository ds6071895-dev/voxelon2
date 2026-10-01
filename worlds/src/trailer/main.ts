// Standalone in-engine cinematic stage. No accounts, sockets or live matches.
// Capture advances simulation time explicitly, independent of rendering speed.
import * as THREE from 'three';
import { createAtlas } from '../textures';
import { World } from '../world';
import { worldGenerator } from '../multiverse';
import { TitleTerrain, TITLE_SEA } from '../title_terrain';
import { TEXTURE_SEED } from '../title_backdrop';
import { Sky } from '../sky';
import { PostFX } from '../postfx';
import { SunShadow } from '../shadows';
import { Particles } from '../particles';
import { DragonView } from '../parkour_dragon';
import { parkourCourse, parkourStandSpot, type ParkourPlatform } from '../parkour_course';
import { parkourTheme } from '../parkour_themes';
import { buildAvatarBody, poseGunHold, releaseGunHold, stridePose } from '../remoteplayers';
import { defaultCosmetics } from '../character';
import { createGunModel, poseGunModel } from '../gunmodels';
import { createRatModel, createCheeseModel } from '../ratseek_models';
import { isSolid } from '../blocks';
import { createHeldAxe, fitHands, muzzleLine, PALM } from './grips';
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
postfx.setEnabled(effects);
postfx.setTier(params.get('quality') === 'max' ? 0 : 1);
shadows.setEnabled(effects);
shadows.setTier(1);
world.shaderModeUniform.value = effects ? 1 : 0;
const particles = new Particles(scene);
const dragon = new DragonView(scene, particles);

// Choose one reproducible course with the two hero locations in the edit.
let seed = 2026;
for (; seed < 3026; seed += 8) {
  const pieces = parkourCourse(seed).variant.pieces;
  if (pieces.includes('rooftops') && pieces.includes('waterfall')) break;
}
if (seed >= 3026) throw new Error('No trailer course with rooftops and waterfall found.');
const course = parkourCourse(seed);
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
  width = w; height = h;
  canvas.width = w; canvas.height = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  postfx.setSize(w, h);
}
resize(Number(params.get('width')) || 1920, Number(params.get('height')) || 1080);

const clamp = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => { const k = clamp(t); return k * k * (3 - 2 * k); };
function cam(from: number[], to: number[], target: number[], k: number, fov = 58): void {
  camera.position.fromArray(from).lerp(new THREE.Vector3().fromArray(to), smooth(k));
  camera.lookAt(new THREE.Vector3().fromArray(target));
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function shotCamera(s: Shot, t: number): void {
  const k = t / s.duration;
  if (s.set === 'lake') {
    cam([25, TITLE_SEA + 13, 25], [-12, TITLE_SEA + 22, 25], [-48, TITLE_SEA + 25, -42], k, 62);
  } else if (s.set === 'bridge') {
    if (s.action === 'scenery') cam([-28, 164, 6], [-19, 156, 60], [12, 143, 40], k, 64);
    else cam([13.8, 143.6, 32], [13.8, 143.1, 34.5], [12.5, 142, 40], k, 54);
  } else if (s.set === 'duel') {
    if (s.action === 'scenery') cam([49, 124, 47], [36, 115, 45], [22, 99, 22], k, 61);
    else cam([16, 102.2, 27], [16.5, 101.2, 18], [23, 99.2, 22], k, 58);
  } else if (s.set === 'manor') {
    if (s.action === 'scenery') cam([44, 111, 46], [32, 104, 41], [0, 91, 0], k, 60);
    else if (s.action === 'rescue') cam([30.5, 82.2, 7], [29.5, 82, 6], [26.5, 81.5, 0], k, 62);
    else cam([1.8, 81.75, -4 - t * .65], [1.8, 81.75, -4 - t * .65], [0, 81.6, 1 - t * .3], k, 64);
  } else {
    const a = anchor;
    if (s.action === 'finish') cam([a.x + 21, a.y + 10, a.z - 18], [a.x + 13, a.y + 7, a.z - 11], [a.x, a.y + 2, a.z], k, 62);
    else if (s.action === 'dragon') {
      const head = dragon.headPosition();
      cam([a.x + 15, a.y + 8, a.z + 22], [a.x + 10, a.y + 6, a.z + 21], [head.x, head.y - 1, head.z + 3], k, 64);
    } else if (s.piece === 'waterfall') {
      cam([a.x + 33, a.y + 24, a.z - 20], [a.x + 25, a.y + 13, a.z + 15], [a.x, a.y + 3, a.z + 12], k, 66);
    } else cam([a.x + 19, a.y + 13, a.z - 12], [a.x + 14, a.y + 6, a.z + 13], [a.x, a.y + 1, a.z + 10], k, 64);
  }
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
    const section = course.sections.find(p => p.piece === (s.piece ?? 'rooftops'))!;
    firstOrder = Math.min(section.toOrder - 5, section.fromOrder + 5);
    const p = s.action === 'finish' ? course.finish : course.steps[firstOrder][0];
    anchor = new THREE.Vector3(p.x, p.y, p.z);
    dragon.enter(course, parkourTheme(seed), 0, 0);
    // Warm the flight trail, so the dragon is already airborne at the cut.
    for (let i = 0; i < 90; i++) {
      dragon.sync(firstOrder - 8 + i * .055, 1.5, 20000 + i * 33);
      dragon.update(1 / 30, 20000 + i * 33, 0, true);
    }
  }
  shotCamera(s, s.duration / 2);
  const center = s.set === 'lake' ? new THREE.Vector3(0, 0, 0)
    : s.set === 'bridge' ? new THREE.Vector3(12, 0, 40)
      : s.set === 'duel' ? new THREE.Vector3(22, 0, 22)
        : s.set === 'manor' ? new THREE.Vector3(4, 0, 5) : anchor;
  const radius = s.set === 'lake' ? 8 : s.set === 'parkour' ? 7 : 4;
  world.renderDistance = radius;
  const deadline = performance.now() + 180000;
  while (!world.update(center.x, center.z, 30, radius)) {
    if (performance.now() > deadline) throw new Error(`Chunk loading timed out for ${s.id}`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  render(0);
  status.textContent = s.id;
}

function poseActor(i: number, p: THREE.Vector3, yaw: number, t: number, gun = false, attack = 0, speed = 4): void {
  const a = actors[i];
  releaseGunHold(a.body);
  a.body.group.visible = true;
  a.body.group.position.copy(p);
  a.body.group.rotation.y = yaw;
  const pose = stridePose(t * 9 + i, speed, 0, gun || attack > 0, attack);
  a.body.parts[0].rotation.x = pose.legs[0];
  a.body.parts[1].rotation.x = pose.legs[1];
  a.body.parts[2].rotation.set(pose.arms[0], 0, 0);
  a.body.parts[3].rotation.set(pose.arms[1], 0, pose.rightArmRoll);
  a.gun.visible = gun;
  a.axe.visible = !gun && attack > 0;
  if (gun) {
    poseGunHold(a.body, a.gun, { pitch: 0, aim: .6, reload: 0, kick: Math.max(0, Math.sin(t * 18)) * .3 });
    fitHands(a.body, a.gun);
  }
}

function ground(x: number, z: number): number {
  for (let y = 110; y >= 96; y--) if (isSolid(generator.blockAt(Math.floor(x), y, Math.floor(z)))) return y + 1.01;
  return 97.01;
}

function stand(p: ParkourPlatform): THREE.Vector3 {
  const at = parkourStandSpot(course, p);
  return new THREE.Vector3(at.x, at.y, at.z);
}

function animate(t: number, dt: number): void {
  const s = SHOTS[shotIndex];
  if (s.action === 'bridge') {
    const approach = Math.min(1, t / 2.5);
    const dist = 7 * (1 - approach) + .9;
    const swing = t > 2 ? Math.max(.1, Math.sin(t * 8)) : .15;
    poseActor(0, new THREE.Vector3(12.5, 141.01, 40 - dist), Math.PI, t, false, swing);
    poseActor(1, new THREE.Vector3(12.5, 141.01, 40 + dist), 0, t + .6, false, swing);
  } else if (s.action === 'duel') {
    for (let i = 0; i < 2; i++) {
      const x = 21 + Math.sin(t * 1.1 + i * Math.PI) * 3;
      const z = 21 + (i ? -3 : 3) + Math.cos(t * .9) * .7;
      poseActor(i, new THREE.Vector3(x, ground(x, z), z), i ? Math.PI : 0, t + i, true);
    }
    const { origin, direction } = muzzleLine(actors[0].gun);
    flash.visible = t > .5 && t % .5 < .1;
    flash.position.copy(origin);
    tracer.visible = flash.visible;
    tracer.position.copy(origin).addScaledVector(direction, 2);
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  } else if (s.action === 'run' || s.action === 'dragon') {
    for (let i = 0; i < 3; i++) {
      const progress = Math.max(0, t * 1.35 - i * .7);
      const order = firstOrder + Math.floor(progress);
      const a = course.steps[Math.min(order, course.steps.length - 2)][0];
      const b = course.steps[Math.min(order + 1, course.steps.length - 1)][0];
      const k = progress % 1;
      const from = stand(a), to = stand(b);
      const p = from.clone().lerp(to, k);
      p.y += 4 * 1.25 * k * (1 - k);
      const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
      poseActor(i, p, yaw, t + i, false, 0, 5.6);
    }
    dragon.sync(firstOrder - 3 + t * 1.2, 1.2, 23000 + t * 1000);
    if (s.action === 'dragon' && t > 1.4 && !fireSent) {
      const target = actors[0].body.group.position;
      dragon.fireball({ id: 1, tx: target.x, ty: target.y, tz: target.z + 5, launchAt: 24500, landAt: 26700 });
      fireSent = true;
    }
    dragon.update(dt, 23000 + t * 1000, 0, false);
  } else if (s.action === 'finish') {
    course.podium.forEach((p, i) => poseActor(i, new THREE.Vector3(p.x, p.y, p.z), 0, t + i, false, .5 + Math.sin(t * 3) * .3, 0));
  } else if (s.action === 'rats') {
    rats.slice(0, 2).forEach((r, i) => {
      r.group.visible = true;
      r.group.position.set(i ? -.8 : .4, 81, 1.5 - t * .8 + i * 1.8);
      r.group.rotation.y = 0;
      r.pose(5, t * 7 + i, t);
    });
    poseActor(0, new THREE.Vector3(-.2, 81, 5.5 - t * .8), 0, t, false, 0, 4);
    cheese.visible = true;
    cheese.position.copy(rats[0].group.position).add(new THREE.Vector3(0, .32, -.48));
    cheese.scale.setScalar(.55);
  } else if (s.action === 'rescue') {
    if (!freed && t > .85) {
      // A freed rat is teleported out by the real game too; the cage stays shut.
      rats[2].setCaged(false);
      freed = true;
    }
    rats.forEach((r, i) => {
      r.group.visible = true;
      r.group.position.set(i === 2 && !freed ? 29.5 : 25.5 + i * .8, 81, i === 2 && !freed ? 0 : 2 - t);
      r.group.rotation.y = .5;
      r.pose(freed ? 4 : 0, t * 8 + i, t);
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
