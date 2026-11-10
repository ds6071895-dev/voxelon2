// Trailer-only cape: a pixel-art cloth hung from an avatar's shoulders, in
// four hinged strips so it ripples in the wind. Colours come from the wardrobe's
// rarity palette (capes.ts), so the announcement shows exactly the tiers the
// earned-cape system will hand out. No named cape is shown, and never the Void Cape.
import * as THREE from 'three';
import { RARITY_COLORS } from '../capes';
import type { AvatarBody } from '../avatar';

export type CapeTier = keyof typeof RARITY_COLORS;

const W = .56, H = .92, D = .045, STRIPS = 4;
/** Shoulder line on the avatar's back (body faces -z, so the back is +z). */
const TOP_Y = 1.47, BACK_Z = .14 + D / 2 + .01;

function shade(hex: number, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** 16 x 26 px cloth: woven noise, a two-pixel trim and a tier emblem. */
function capeTexture(tier: CapeTier): THREE.CanvasTexture {
  const base = RARITY_COLORS[tier];
  const trim = tier === 'legendary' ? 0xfff0a8 : tier === 'epic' ? 0xe6c9ff : tier === 'rare' ? 0xbfe0ff : 0xe4e9ef;
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 26;
  const g = canvas.getContext('2d')!;
  let seed = 0x51ed + tier.length * 977;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < 26; y++) for (let x = 0; x < 16; x++) {
    const weave = ((x + y) & 1) ? .94 : 1;
    g.fillStyle = shade(base, (.78 + rnd() * .16) * weave * (1 - y / 26 * .18));
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = shade(trim, 1);
  g.fillRect(0, 0, 16, 1); g.fillRect(0, 25, 16, 1); g.fillRect(0, 0, 1, 26); g.fillRect(15, 0, 1, 26);
  g.fillStyle = shade(base, .55);
  g.fillRect(1, 1, 14, 1); g.fillRect(1, 24, 14, 1);
  // Emblem: a pip for common, a diamond for rare, a star for epic, a crown for legendary.
  g.fillStyle = shade(trim, 1);
  const px = (pts: number[][]) => pts.forEach(([x, y]) => g.fillRect(x, y, 1, 1));
  if (tier === 'common') px([[7, 11], [8, 11], [7, 12], [8, 12]]);
  else if (tier === 'rare') px([[7, 8], [8, 8], [6, 9], [9, 9], [5, 10], [10, 10], [5, 11], [10, 11], [6, 12], [9, 12], [7, 13], [8, 13], [7, 10], [8, 10], [7, 11], [8, 11], [6, 10], [9, 10], [6, 11], [9, 11]]);
  else if (tier === 'epic') px([[7, 7], [8, 7], [7, 8], [8, 8], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [11, 9], [12, 9], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10], [10, 10], [6, 11], [7, 11], [8, 11], [9, 11], [5, 12], [6, 12], [9, 12], [10, 12], [4, 13], [5, 13], [10, 13], [11, 13]]);
  else {
    px([[4, 8], [7, 7], [8, 7], [11, 8], [4, 9], [5, 9], [7, 8], [8, 8], [10, 9], [11, 9]]);
    for (let x = 4; x <= 11; x++) { g.fillRect(x, 10, 1, 1); g.fillRect(x, 11, 1, 1); g.fillRect(x, 12, 1, 1); }
    g.fillStyle = shade(0xd9393f, 1); g.fillRect(7, 11, 2, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Cape {
  root: THREE.Group;
  tier: CapeTier;
  /** wind 0..1, speed in blocks/s (a run lifts the cape), t seconds. */
  pose(t: number, wind: number, speed: number): void;
  dispose(): void;
}

export function createCape(tier: CapeTier): Cape {
  const tex = capeTexture(tier);
  const front = new THREE.MeshBasicMaterial({ map: tex });
  const edge = new THREE.MeshBasicMaterial({ color: new THREE.Color(RARITY_COLORS[tier]).multiplyScalar(.5) });
  const glow = tier === 'legendary' || tier === 'epic'
    ? new THREE.MeshBasicMaterial({ color: tier === 'legendary' ? 0xffd86b : 0xc59bff, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false })
    : null;
  const root = new THREE.Group();
  root.position.set(0, TOP_Y, BACK_Z);
  const hinges: THREE.Group[] = [];
  const geos: THREE.BufferGeometry[] = [];
  let parent: THREE.Object3D = root;
  const h = H / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const hinge = new THREE.Group();
    if (i) hinge.position.y = -h;
    parent.add(hinge);
    const geo = new THREE.BoxGeometry(W, h, D);
    geo.translate(0, -h / 2, 0);
    // Map this strip's slice of the texture onto the outward (+z) face only.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const v0 = 1 - (i + 1) / STRIPS, v1 = 1 - i / STRIPS;
    for (let k = 0; k < uv.count; k++) uv.setY(k, v0 + uv.getY(k) * (v1 - v0));
    geos.push(geo);
    const mats = [edge, edge, edge, edge, front, front];
    hinge.add(new THREE.Mesh(geo, mats));
    if (glow) {
      const halo = new THREE.Mesh(geo, glow);
      halo.scale.set(1.12, 1.06, 1.6);
      hinge.add(halo);
    }
    hinges.push(hinge);
    parent = hinge;
  }
  return {
    root, tier,
    pose(t, wind, speed) {
      // The cape trails further back the faster its wearer moves, and ripples
      // with a travelling wave whose amplitude grows toward the hem.
      const lift = .12 + Math.min(1, speed / 6) * .75 + wind * .35;
      hinges.forEach((hinge, i) => {
        const wave = Math.sin(t * (5.2 + wind * 3) - i * 1.25) * (.06 + wind * .14) * (1 + i * .45);
        hinge.rotation.x = -(i === 0 ? lift : lift * .18) - wave;
        hinge.rotation.z = Math.sin(t * 2.1 + i * .8) * .03 * wind;
      });
    },
    dispose() {
      root.removeFromParent();
      geos.forEach(g => g.dispose());
      tex.dispose(); front.dispose(); edge.dispose(); glow?.dispose();
    },
  };
}

/** Hang a cape on a body (the body group's +z is its back). */
export function wearCape(body: AvatarBody, cape: Cape): void {
  body.group.add(cape.root);
}
