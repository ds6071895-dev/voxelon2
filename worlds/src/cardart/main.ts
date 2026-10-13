// Title-screen card art: one posed still per game, rendered in-engine from the
// real venue generators and models, so every tile shows the game as it looks
// when you play it. `npm run cards` captures them into public/cards/.
//
// cardart.html?card=<id> previews one card; the capture script drives the
// `window.__cards` API. Pass cam=x,y,z&at=x,y,z&fov=n to frame by hand.
import * as THREE from 'three';
import { createAtlas } from '../textures';
import { World } from '../world';
import { worldGenerator, type WorldGenerator } from '../multiverse';
import { TEXTURE_SEED } from '../title_backdrop';
import { Sky } from '../sky';
import { PostFX } from '../postfx';
import { SunShadow } from '../shadows';
import { Particles } from '../particles';
import { DragonView } from '../parkour_dragon';
import { parkourStandSpot, type ParkourPlatform } from '../parkour_course';
import { parkourTheme } from '../parkour_themes';
import { buildAvatarBody, disposeAvatarBody, poseGunHold, type AvatarBody } from '../avatar';
import { createAvatarEquipment, attachAvatarEquipment } from '../avatar_equipment';
import { defaultCosmetics } from '../character';
import { createRatModel, createCheeseModel, createCatModel, disposeRsProp } from '../ratseek_models';
import { createBedwarsModels } from '../bedwars_models';
import { bwMap, BW_BOUNDS } from '../bedwars_map';
import { Item } from '../items';
import { Block } from '../blocks';
import { fitHands } from '../media/grips';
import { chooseCaptureCourse } from '../media/course';
import { warmCaptureDragon } from '../media/dragon';
import { captureGround, configureCaptureQuality, sizeCapture, loadCaptureChunks, poseCaptureStride } from '../media/offline';

export type CardId = 'bedwars' | 'duels' | 'bridge' | 'parkour' | 'ratseek';
export const CARDS: readonly CardId[] = ['bedwars', 'duels', 'bridge', 'parkour', 'ratseek'];

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('output') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xb7d3ee, 90, 180);
const camera = new THREE.PerspectiveCamera(50, 1, .08, 2000);
const atlas = createAtlas(TEXTURE_SEED, renderer.capabilities.getMaxAnisotropy());
const world = new World(scene, atlas, worldGenerator({ kind: 'duel', seed: 1 }));
world.setSmoothLighting(true);
const sky = new Sky(scene, TEXTURE_SEED);
// The hero looks down into the void. Use a clear blue poster backdrop there
// instead of the atmosphere's grey ground haze, retaining the real sun lighting.
const heroSky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  uniforms: {
    top: { value: new THREE.Color(0x69b7ef) },
    horizon: { value: new THREE.Color(0xc4e5fa) },
    bottom: { value: new THREE.Color(0x80bce8) },
  },
  vertexShader: `
    varying float height;
    void main() {
      height = normalize(position).y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 top;
    uniform vec3 horizon;
    uniform vec3 bottom;
    varying float height;
    void main() {
      vec3 color = height > 0.0
        ? mix(horizon, top, smoothstep(0.0, 0.65, height))
        : mix(horizon, bottom, smoothstep(0.0, 0.65, -height));
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }
  `,
  side: THREE.BackSide, depthWrite: false, fog: false,
}));
heroSky.frustumCulled = false;
heroSky.renderOrder = -99;
heroSky.visible = false;
scene.add(heroSky);
const postfx = new PostFX(renderer, scene);
const shadows = new SunShadow(renderer, scene, atlas.texture, world.shadowUniforms);
// The in-game "Extra High" look: smooth light and sun shadows, no colour grade.
const shaders = params.get('shaders') === '1';
sky.setShaders(shaders);
configureCaptureQuality(renderer, postfx, shadows, shaders, true, 0, 1);
world.shaderModeUniform.value = shaders ? 1 : 0;
const particles = new Particles(scene);
const dragon = new DragonView(scene, particles);
const itemMat = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: .4, vertexColors: true, side: THREE.DoubleSide });

/** Everything a card adds to the scene, removed again before the next one. */
const props = new THREE.Group();
scene.add(props);
const propDisposers: (() => void)[] = [];

const TEAM = { red: 0xd9393f, blue: 0x2f6fe0, green: 0x37a845, yellow: 0xe8c22c } as const;

function actor(seed: number, shirt?: number): AvatarBody {
  const body = buildAvatarBody(defaultCosmetics(seed), shirt === undefined ? undefined : new THREE.Color(shirt));
  propDisposers.push(() => disposeAvatarBody(body));
  props.add(body.group);
  return body;
}
/** Feet at p, facing the point `look` (Worlds' forward is -z). */
function place(body: AvatarBody, p: THREE.Vector3, look: THREE.Vector3): void {
  body.group.position.copy(p);
  body.group.rotation.y = Math.atan2(-(look.x - p.x), -(look.z - p.z));
}
function stride(body: AvatarBody, phase: number, speed: number, holding: boolean, attack = 0): void {
  poseCaptureStride(body, phase, speed, holding, attack);
}
/** Shared avatar equipment with the card's authored hand pose. */
function hold(body: AvatarBody, item: number): void {
  const equipment = createAvatarEquipment(atlas, item, itemMat);
  if (equipment) {
    attachAvatarEquipment(body, equipment);
    propDisposers.push(() => equipment.dispose());
  }
}
function gun(body: AvatarBody, kick = 0): void {
  const equipment = createAvatarEquipment(atlas, Item.BurstRifle, itemMat)!;
  const g = equipment.root;
  attachAvatarEquipment(body, equipment);
  propDisposers.push(() => equipment.dispose());
  poseGunHold(body, g, { pitch: 0, aim: .6, reload: 0, kick });
  fitHands(body, g);
}
function ground(gen: WorldGenerator, x: number, z: number, top = 160, bottom = 60): number {
  return captureGround(gen, x, z, top, bottom);
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Staging {
  generator: WorldGenerator;
  /** Chunk-streaming centre and radius. */
  center: THREE.Vector3;
  radius: number;
  timeOfDay: number;
  ambient: number;
  cam: THREE.Vector3;
  at: THREE.Vector3;
  fov: number;
  fog: [number, number];
  edits?: [number, number, number, number][];
  /** Called once the world is meshed: place actors and models. */
  pose(): void;
  /** Per-frame animation hook for models that settle over time. */
  tick?(t: number): void;
}

const { seed: parkourSeed, course: cardCourse } = chooseCaptureCourse(['rooftops']);

function staging(id: CardId): Staging {
  if (id === 'bedwars') {
    // Red's island: the bed in front, a defender with a sword, and Blue
    // bridging in with wool across the void.
    const map = bwMap(0);
    const gen = worldGenerator({ kind: 'bedwars', seed: 0 });
    const red = map.bases[0];
    const bed = v(red.bed.x + .5, red.bed.y, red.bed.z + .5);
    const y = red.bed.y;
    const bridge: [number, number, number, number][] = [];
    if (params.get('wall') === '1') for (const [wx, wz] of [[-57, 0], [-54, 0], [-56, -1], [-55, -1], [-56, 1], [-55, 1]]) bridge.push([wx, y, wz, Block.TeamWoolA]);
    for (let x = -46; x <= -36; x++) bridge.push([x, y - 1, 2, Block.TeamWoolB]);
    return {
      // Framed right of centre: the hero tile's words sit over the left.
      generator: gen, center: v(-46, 0, 0), radius: 5, timeOfDay: .2, ambient: .88,
      cam: v(-36.8, y + 3.3, 5.4), at: v(-51, y + 1.4, 1.2), fov: 46, fog: [120, 240], edits: bridge,
      pose() {
        const models = createBedwarsModels(map, 2, atlas);
        propDisposers.push(() => models.dispose());
        props.add(models.group);
        models.update(3);
        const defender = actor(11, TEAM.red);
        place(defender, v(-51.5, ground(gen, -51.5, 2.5), 2.5), v(-40, y, 2.5));
        stride(defender, 1.2, 3, true, .55);
        hold(defender, Item.IronSword);
        const attacker = actor(905, TEAM.blue);
        place(attacker, v(-43.5, y, 2.5), v(bed.x, y, bed.z));
        stride(attacker, 2.4, 4.5, true, .2);
        hold(attacker, Block.TeamWoolB);
      },
    };
  }
  if (id === 'duels') {
    const gen = worldGenerator({ kind: 'duel', seed: 7 });
    return {
      generator: gen, center: v(22, 0, 22), radius: 4, timeOfDay: .3, ambient: .65,
      cam: v(23.9, 101.8, 27.4), at: v(22.1, 100.9, 22), fov: 55, fog: [90, 185],
      pose() {
        const a = actor(300, TEAM.red), b = actor(671, TEAM.blue);
        const pa = v(20.6, 0, 23.2), pb = v(23.6, 0, 20.8);
        pa.y = ground(gen, pa.x, pa.z, 110, 96); pb.y = ground(gen, pb.x, pb.z, 110, 96);
        place(a, pa, pb); place(b, pb, pa);
        stride(a, .8, 3, true); stride(b, 2.2, 3, true);
        gun(a, .25); gun(b);
      },
    };
  }
  if (id === 'bridge') {
    const gen = worldGenerator({ kind: 'bridge', seed: 7 });
    return {
      generator: gen, center: v(12, 0, 40), radius: 4, timeOfDay: .3, ambient: .65,
      cam: v(9.2, 142.3, 28.5), at: v(12.5, 142.2, 32.5), fov: 50, fog: [90, 185],
      pose() {
        const a = actor(1203, TEAM.red), b = actor(77, TEAM.blue);
        const ya = ground(gen, 12.5, 31, 160, 120), yb = ground(gen, 12.5, 33, 160, 120);
        place(a, v(12.5, ya, 31), v(12.5, ya, 40));
        place(b, v(12.5, yb, 33), v(12.5, yb, 20));
        stride(a, 1.1, 4, true, .7); stride(b, 2.6, 4, true, .15);
        hold(a, Item.IronSword);
        hold(b, Item.BridgeBow);
      },
    };
  }
  if (id === 'parkour') {
    const course = cardCourse;
    const gen = worldGenerator({ kind: 'parkour', seed: parkourSeed });
    const section = course.sections.find(p => p.piece === 'rooftops') ?? course.sections[1];
    const order = Math.min(section.toOrder - 5, section.fromOrder + 5);
    const p0 = course.steps[order][0];
    const anchor = v(p0.x, p0.y, p0.z);
    const stand = (p: ParkourPlatform) => { const s = parkourStandSpot(course, p); return v(s.x, s.y, s.z); };
    return {
      generator: gen, center: anchor, radius: 6, timeOfDay: parkourTheme(parkourSeed).time, ambient: 1,
      // The runners head toward -x; the dragon follows them from +x.
      cam: v(anchor.x - 6.6, anchor.y + 1.6, anchor.z - 1.4), at: v(anchor.x + 2.4, anchor.y + 1.2, anchor.z - .3), fov: 52, fog: [90, 185],
      pose() {
        dragon.enter(course, parkourTheme(parkourSeed), 0, 0);
        warmCaptureDragon(dragon, order);
        runners = [actor(300, TEAM.red), actor(671, TEAM.blue), actor(1042, TEAM.yellow)];
        runners.forEach((r, i) => {
          const a = stand(course.steps[order + 2 - i][0]), b = stand(course.steps[order + 3 - i][0]);
          const k = i === 1 ? .5 : .15;
          const p = a.clone().lerp(b, k); p.y += 5 * k * (1 - k);
          place(r, p, b);
          stride(r, 1 + i * 1.7, 5.6, false);
        });
      },
      tick(t) {
        dragon.sync(order - 2.2, 1.2, 23000 + t * 1000);
        dragon.update(1 / 60, 23000 + t * 1000, 0, true);
      },
    };
  }
  // Rat and Seek: the manor's front lawn in bright morning, rats making a dash
  // for the door with cheese while the seeker looks the other way.
  const gen = worldGenerator({ kind: 'ratseek', seed: 1 });
  return {
    generator: gen, center: v(0, 0, 8), radius: 5, timeOfDay: .1, ambient: 1,
    cam: v(2.0, 82.4, 26.9), at: v(1, 81.5, 22.0), fov: 52, fog: [90, 185],
    pose() {
      // Below the porch roof: the lawn and path are at most a block up.
      const floor = (x: number, z: number) => ground(gen, x, z, 83, 70);
      const rats = [createRatModel(), createRatModel(), createRatModel()];
      rats.forEach(r => propDisposers.push(() => r.dispose()));
      const spots = [[-.4, 23.2], [1.2, 24.6], [2.4, 22.4]];
      rats.forEach((r, i) => {
        props.add(r.group);
        const [x, z] = spots[i];
        r.group.position.set(x, floor(x, z), z);
        // Scurrying out toward the camera.
        r.group.rotation.y = Math.PI - .35 + i * .2;
        r.pose(5, i * 2.1, 1);
      });
      const cheese = createCheeseModel();
      propDisposers.push(() => disposeRsProp(cheese));
      cheese.scale.setScalar(.6);
      rats[0].group.updateWorldMatrix(true, false);
      cheese.position.copy(rats[0].group.localToWorld(v(0, .32, -.48)));
      props.add(cheese);
      const cat = createCatModel();
      propDisposers.push(() => cat.dispose());
      cat.group.position.set(-2.6, floor(-2.6, 19.5), 19.5);
      cat.group.rotation.y = 2.6;
      cat.update(true, 0, 2);
      // Name labels are for the match, not a poster.
      cat.group.traverse(o => { if (o instanceof THREE.Sprite) o.visible = false; });
      props.add(cat.group);
      // The seeker in the doorway, looking out over the lawn.
      const seeker = actor(2718, 0x8b5cf6);
      place(seeker, v(1.5, floor(1.5, 14.5), 14.5), v(1, 81, 24));
      stride(seeker, .4, 1.2, false);
    },
  };
}

let current: Staging | null = null;
let runners: AvatarBody[] = [];
let time = 0;

function frame(s: Staging): void {
  camera.position.copy(s.cam);
  camera.fov = s.fov;
  camera.lookAt(s.at);
  camera.updateProjectionMatrix();
}

/** Renders a w x h still. `below` extra pixels extend the frame downward
 *  without moving the subject, leaving ground for the tile's title to sit on. */
async function prepare(id: CardId, w = 1200, h = 900, below = 0): Promise<void> {
  if (!CARDS.includes(id)) throw new Error(`Invalid card ${id}`);
  sizeCapture(renderer, postfx, camera, w, h, below);
  // Dispose only resources explicitly owned by this take. Guns, bows, held-item
  // geometry and the atlas are borrowed from module caches and stay reusable.
  for (const dispose of propDisposers.splice(0)) dispose();
  props.clear();
  runners = [];
  dragon.clear();
  heroSky.visible = id === 'bedwars';
  const s = staging(id);
  const num = (k: string) => params.get(k)?.split(',').map(Number);
  const cam = num('cam'), at = num('at'), fov = num('fov');
  if (cam) s.cam.fromArray(cam);
  if (at) s.at.fromArray(at);
  if (fov) s.fov = fov[0];
  const tod = num('tod'); if (tod) s.timeOfDay = tod[0];
  current = s;
  world.setGenerator(s.generator);
  world.setArenaRenderBounds(id === 'bedwars' ? BW_BOUNDS : s.generator.bounds, s.ambient);
  for (const [x, y, z, b] of s.edits ?? []) world.setBlock(x, y, z, b);
  sky.snapTo(s.timeOfDay);
  await loadCaptureChunks(world, s.center.x, s.center.z, s.radius, 40, id);
  for (const [x, y, z, b] of s.edits ?? []) world.setBlock(x, y, z, b);
  await loadCaptureChunks(world, s.center.x, s.center.z, s.radius, 40, id);
  s.pose();
  time = 0;
  // Let the sky, shadows and dragon settle before the still is taken.
  for (let i = 0; i < 30; i++) render();
}

function render(): void {
  const s = current;
  if (!s) return;
  time += 1 / 60;
  s.tick?.(time);
  frame(s);
  sky.update(1 / 60, camera, s.timeOfDay);
  heroSky.position.copy(camera.position);
  world.applySky(sky);
  world.timeUniform.value = 4 + time;
  (scene.background as THREE.Color).copy(sky.skyColor);
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(sky.skyColor);
  if (heroSky.visible) fog.color.set(0xc4e5fa);
  [fog.near, fog.far] = s.fog;
  particles.update(1 / 60, camera);
  shadows.update(sky.lightDir, camera.position, sky.lightHeight, sky.moonlit, 1 / 30);
  postfx.setSky(sky, camera);
  postfx.render(camera, 4 + time);
}

const api = {
  cards: CARDS,
  prepare,
  render,
  image(type = 'image/webp', quality = .86): string { render(); return canvas.toDataURL(type, quality); },
  /** Framing aid: where the dragon's head is and where the shot is aimed. */
  info(): unknown { return { head: dragon.headPosition().toArray(), at: current?.at.toArray(), cam: current?.cam.toArray(), runners: runners.map(r => r.group.position.toArray()) }; },
};
declare global { interface Window { __cards: typeof api } }
window.__cards = api;

const first = (params.get('card') ?? 'bedwars') as CardId;
void prepare(first, Number(params.get('w')) || 1200, Number(params.get('h')) || 900, Number(params.get('below')) || 0)
  .then(() => { document.body.dataset.ready = 'true'; })
  .catch(error => { document.body.dataset.error = String(error); console.error(error); });
