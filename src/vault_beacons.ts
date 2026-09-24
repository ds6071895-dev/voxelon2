import * as THREE from 'three';

export interface VaultBeaconSite {
  cx: number;
  cz: number;
  x: number;
  z: number;
}

interface Beacon {
  group: THREE.Group;
  glow: THREE.MeshBasicMaterial;
  core: THREE.MeshBasicMaterial;
  crown: THREE.SpriteMaterial;
}

const HEIGHT = 180;
const RANGE = 520;
const FADE_START = 420;

/** World-space vault lights. They do not use terrain fog, so they remain visible
 * beyond the chunks that are currently streamed or drawn. */
export class VaultBeacons {
  readonly group = new THREE.Group();
  private readonly beacons = new Map<string, Beacon>();
  private readonly column = new THREE.CylinderGeometry(1, 1, HEIGHT, 12, 1, true);
  private readonly crownTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.group.name = 'vault-beacons';
    scene.add(this.group);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(247,222,255,1)');
    gradient.addColorStop(0.12, 'rgba(209,145,255,0.95)');
    gradient.addColorStop(0.38, 'rgba(137,72,244,0.35)');
    gradient.addColorStop(1, 'rgba(103,44,213,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.crownTexture = new THREE.CanvasTexture(canvas);
  }

  setSites(sites: readonly VaultBeaconSite[], groundY: (x: number, z: number) => number): void {
    const wanted = new Set(sites.map((site) => `${site.cx},${site.cz}`));
    for (const [key, beacon] of this.beacons) {
      if (wanted.has(key)) continue;
      this.group.remove(beacon.group);
      beacon.glow.dispose();
      beacon.core.dispose();
      beacon.crown.dispose();
      this.beacons.delete(key);
    }
    for (const site of sites) {
      const key = `${site.cx},${site.cz}`;
      if (this.beacons.has(key)) continue;
      const glow = new THREE.MeshBasicMaterial({ color: 0x873dff, transparent: true,
        opacity: 0.16, depthWrite: false, fog: false, side: THREE.FrontSide,
        blending: THREE.AdditiveBlending, toneMapped: false });
      const core = new THREE.MeshBasicMaterial({ color: 0x9c49f5, transparent: true,
        opacity: 0.85, depthWrite: false, fog: false, side: THREE.FrontSide,
        toneMapped: false });
      const crown = new THREE.SpriteMaterial({ map: this.crownTexture, color: 0xe3bbff,
        transparent: true, opacity: 0.75, depthWrite: false, depthTest: true,
        fog: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const beaconGroup = new THREE.Group();
      const baseY = groundY(site.x, site.z) + 2;
      beaconGroup.position.set(site.x + 0.5, baseY, site.z + 0.5);
      const halo = new THREE.Mesh(this.column, glow);
      halo.position.y = HEIGHT / 2;
      halo.scale.set(6, 1, 6);
      const shaft = new THREE.Mesh(this.column, core);
      shaft.position.y = HEIGHT / 2;
      shaft.scale.set(1.2, 1, 1.2);
      const star = new THREE.Sprite(crown);
      star.position.y = HEIGHT - 7;
      star.scale.set(20, 20, 1);
      beaconGroup.add(halo, shaft, star);
      this.group.add(beaconGroup);
      this.beacons.set(key, { group: beaconGroup, glow, core, crown });
    }
  }

  update(x: number, z: number, time: number, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    for (const beacon of this.beacons.values()) {
      const dx = beacon.group.position.x - x;
      const dz = beacon.group.position.z - z;
      const distance = Math.hypot(dx, dz);
      const fade = THREE.MathUtils.clamp((RANGE - distance) / (RANGE - FADE_START), 0, 1);
      const pulse = 0.92 + 0.08 * Math.sin(time * 1.7 + beacon.group.position.x * 0.03);
      beacon.group.visible = fade > 0;
      beacon.glow.opacity = 0.16 * fade * pulse;
      beacon.core.opacity = 0.85 * fade * pulse;
      beacon.crown.opacity = 0.75 * fade * pulse;
    }
  }
}
