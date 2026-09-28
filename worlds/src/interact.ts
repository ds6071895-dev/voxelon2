// Block targeting (voxel DDA raycast), hold-to-break with crack stages and
// face-targeted placement. The match rules (which cells may be edited, which
// blocks are infinite) are supplied by the mode through the veto hooks; the
// server re-checks every edit.

import * as THREE from 'three';
import { Block, BLOCKS, isReplaceable } from './blocks';
import type { Input } from './input';
import type { Inventory } from './inventory';
import { breakTime as blockBreakTime, ITEMS } from './items';
import type { Player } from './player';
import type { World } from './world';

const REACH = 4.5;
const PLACE_REPEAT = 0.25; // vanilla holds place every 4 ticks

interface RayHit {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
}

function raycastBlocks(
  world: World, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number,
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < 256; i++) {
    const t = Math.min(tMaxX, tMaxY, tMaxZ);
    if (t > maxDist) return null;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY <= tMaxZ) {
      y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    const id = world.getBlock(x, y, z);
    if (id !== Block.Air && id !== Block.Water && id !== Block.Barrier) {
      return { x, y, z, nx, ny, nz };
    }
  }
  return null;
}

export class Interaction {
  target: RayHit | null = null;
  /** Fired on successful break/place (held-item swing hooks in). */
  onAction?: () => void;
  onBlockSound?: (kind: 'break' | 'place', blockId: number, x: number, y: number, z: number) => void;
  /** Local block edit (break = block 0); main sends it to the server. */
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  /** Veto an edit at a cell (break or place). */
  canEdit?: (x: number, y: number, z: number) => boolean;
  /** Veto a PLACEMENT of a specific block. */
  canPlace?: (x: number, y: number, z: number, block: number) => boolean;
  /** Whether placing `block` uses one up (false = infinite in this mode). */
  shouldConsumePlacement?: (block: number) => boolean;
  /** True for this frame while left-click is actively working a block. */
  breakingActive = false;
  private readonly highlight: THREE.LineSegments;
  private readonly crackMesh: THREE.Mesh;
  private readonly crackMaterial: THREE.MeshBasicMaterial;
  private breakKey = '';
  private breakProgress = 0;
  private placeCooldown = 0;

  constructor(
    scene: THREE.Scene, private readonly world: World, private readonly player: Player,
    private readonly crackTextures: THREE.Texture[], private readonly inventory: Inventory,
  ) {
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    this.highlight.visible = false;
    scene.add(this.highlight);
    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), this.crackMaterial);
    this.crackMesh.visible = false;
    scene.add(this.crackMesh);
  }

  /** Hide the outline and crack (menus, spectating). */
  clear(): void {
    this.target = null;
    this.highlight.visible = false;
    this.crackMesh.visible = false;
    this.breakKey = '';
    this.breakProgress = 0;
  }

  update(dt: number, input: Input, camera: THREE.Camera, suppressMining = false, suppressUse = false): void {
    this.breakingActive = false;
    const origin = this.player.eyePosition;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.target = raycastBlocks(this.world, origin, dir, REACH);
    if (this.target && !suppressMining) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.highlight.visible = false;
    }
    this.updateBreaking(dt, input, suppressMining);
    if (!suppressUse) this.updatePlacing(dt, input);
  }

  private updateBreaking(dt: number, input: Input, suppress: boolean): void {
    const t = this.target;
    if (!input.leftDown || !t || suppress) {
      this.breakKey = ''; this.breakProgress = 0; this.crackMesh.visible = false;
      return;
    }
    this.breakingActive = true;
    const key = `${t.x},${t.y},${t.z}`;
    if (key !== this.breakKey) { this.breakKey = key; this.breakProgress = 0; }
    const id = this.world.getBlock(t.x, t.y, t.z);
    const info = BLOCKS[id];
    if (!info || info.hardness < 0 || (this.canEdit && !this.canEdit(t.x, t.y, t.z))) {
      this.crackMesh.visible = false;
      this.breakProgress = 0;
      return;
    }
    const breakTime = blockBreakTime(info, this.inventory.selectedStack);
    this.breakProgress += dt;
    if (this.breakProgress >= breakTime) {
      this.onBlockSound?.('break', id, t.x, t.y, t.z);
      this.world.setBlock(t.x, t.y, t.z, Block.Air);
      this.onEdit?.(t.x, t.y, t.z, 0);
      this.breakKey = ''; this.breakProgress = 0; this.crackMesh.visible = false;
      this.onAction?.();
      return;
    }
    const stage = Math.min(9, Math.floor((this.breakProgress / Math.max(1e-3, breakTime)) * 10));
    this.crackMaterial.map = this.crackTextures[stage];
    this.crackMesh.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    this.crackMesh.visible = true;
  }

  private updatePlacing(dt: number, input: Input): void {
    this.placeCooldown -= dt;
    const wantPlace = input.rightClicked || (input.rightDown && this.placeCooldown <= 0);
    if (!wantPlace || !this.target) return;
    const stack = this.inventory.selectedStack;
    const info = stack ? ITEMS[stack.id] : null;
    if (!stack || !info || info.kind !== 'block') return;
    const blockId: number = info.block!;
    const targetId = this.world.getBlock(this.target.x, this.target.y, this.target.z);
    const intoTarget = BLOCKS[targetId]?.replaceable ?? false;
    const px = this.target.x + (intoTarget ? 0 : this.target.nx);
    const py = this.target.y + (intoTarget ? 0 : this.target.ny);
    const pz = this.target.z + (intoTarget ? 0 : this.target.nz);
    if (!isReplaceable(this.world.getBlock(px, py, pz)) || py < 0 || py >= 256) return;
    if (this.canEdit && !this.canEdit(px, py, pz)) return;
    if (this.canPlace && !this.canPlace(px, py, pz, blockId)) return;
    if (BLOCKS[blockId].solid && this.player.intersectsBlock(px, py, pz)) return;
    this.world.setBlock(px, py, pz, blockId);
    this.onEdit?.(px, py, pz, blockId);
    this.onBlockSound?.('place', blockId, px, py, pz);
    if (this.shouldConsumePlacement?.(blockId) ?? true) this.inventory.consumeSelected(1);
    this.placeCooldown = PLACE_REPEAT;
    this.onAction?.();
  }
}
