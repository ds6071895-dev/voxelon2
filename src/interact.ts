// Block targeting (voxel DDA raycast), hold-to-break with crack stages,
// placement with face targeting, middle-click pick block.

import * as THREE from 'three';
import {
  Block, BLOCKS, isReplaceable, isSlab, isSolid, isTopSlab, orientStairsForYaw,
  slabBottomId, slabPlacement, stairsBaseOf, torchForFace, torchSupport,
} from './blocks';
import type { Input } from './input';
import type { Inventory } from './inventory';
import { ITEMS, miningStats } from './items';
import { machineHeight, machineTypeForBlock } from './machines';
import type { Player } from './player';
import type { World } from './world';

export const REACH = 4.5;
const PLACE_REPEAT = 0.25; // vanilla holds place every 4 ticks

/** Machine blocks (and their footprint parts) are sabotaged, not mined. */
export function isMachineBlock(id: number): boolean {
  return id === Block.Autominer || id === Block.OilDerrick || id === Block.MachinePart;
}

/** Turrets are block-entities too: sabotaged (HP), not mined. */
export function isTurretBlock(id: number): boolean {
  return id === Block.Turret;
}

/** Any sabotage-target block-entity (machine or turret). */
export function isEntityBlock(id: number): boolean {
  return isMachineBlock(id) || isTurretBlock(id);
}

export interface RayHit {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  /** World hit point on the targeted face (used to pick top vs bottom slab). */
  hx: number; hy: number; hz: number;
}

export function raycastBlocks(
  world: World, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0
    ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0
    ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0
    ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;

  for (let i = 0; i < 256; i++) {
    // `t` is the ray parameter at which it crosses into the cell evaluated below
    // (origin + dir*t is the entry point on that cell's face).
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
    if (id !== Block.Air && id !== Block.Water) {
      return {
        x, y, z, nx, ny, nz,
        hx: origin.x + dir.x * t, hy: origin.y + dir.y * t, hz: origin.z + dir.z * t,
      };
    }
  }
  return null;
}

export class Interaction {
  target: RayHit | null = null;
  /** Fired on successful break/place (held-item swing hooks in). */
  onAction?: () => void;
  /** Fired when right-clicking a crafting table, furnace, chest, machine, or turret. */
  onOpenContainer?: (
    kind: 'table' | 'furnace' | 'chest' | 'machine' | 'turret' | 'claim',
    x: number, y: number, z: number
  ) => void;
  /** Fired on left-click against a machine/turret block: sabotage (HP), not mining. */
  onSabotage?: (x: number, y: number, z: number) => void;
  /** Fired on right-click of a Respawn Beacon: set the player's spawn point. */
  onSetSpawn?: (x: number, y: number, z: number) => void;
  /** Fired on right-click of a Waypoint Totem: attune/release it (B4). */
  onAttune?: (x: number, y: number, z: number) => void;
  /** When set ("Move machine" armed), the NEXT right-click consumes itself and
   *  calls this with the placement cell (against the aimed face) instead of
   *  placing/opening — so a machine can be relocated without breaking it. */
  armedMove: ((px: number, py: number, pz: number) => void) | null = null;
  /** Block dig/place sounds. */
  onBlockSound?: (
    kind: 'break' | 'place', blockId: number, x: number, y: number, z: number
  ) => void;
  /** Local block edit (break = block 0); main broadcasts it to the server. */
  onEdit?: (x: number, y: number, z: number, block: number) => void;
  /** Veto an edit at a cell (e.g. an enemy faction's shielded claim). Returning
   *  false blocks the break/place so the client doesn't mispredict it. */
  canEdit?: (x: number, y: number, z: number) => boolean;
  /** Veto a PLACEMENT of a specific block (e.g. a base Core only inside owned
   *  territory). Returning false cancels the place so it isn't mispredicted. */
  canPlace?: (x: number, y: number, z: number, block: number) => boolean;
  private readonly world: World;
  private readonly player: Player;
  private readonly inventory: Inventory;
  private readonly highlight: THREE.LineSegments;
  private readonly crackMesh: THREE.Mesh;
  private readonly crackMaterial: THREE.MeshBasicMaterial;
  private readonly crackTextures: THREE.Texture[];
  private breakKey = '';
  private breakProgress = 0;
  private placeCooldown = 0;
  /** Creative gamemode: instant break + placed blocks aren't consumed. */
  creative = false;

  constructor(
    scene: THREE.Scene, world: World, player: Player,
    crackTextures: THREE.Texture[], inventory: Inventory
  ) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.crackTextures = crackTextures;

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
    );
    this.highlight.visible = false;
    scene.add(this.highlight);

    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: crackTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.crackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.001, 1.001, 1.001), this.crackMaterial
    );
    this.crackMesh.visible = false;
    scene.add(this.crackMesh);
  }

  update(
    dt: number, input: Input, camera: THREE.Camera,
    suppressMining = false, suppressUse = false
  ): void {
    const origin = this.player.eyePosition;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.target = raycastBlocks(this.world, origin, dir, REACH);

    // Highlight outline.
    if (this.target && !suppressMining) {
      this.highlight.visible = true;
      this.highlight.position.set(
        this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5
      );
    } else {
      this.highlight.visible = false;
    }

    // "Move machine" armed: the next right-click drops the machine at the cell
    // against the aimed face (no placing/opening), then disarms. This is an
    // explicit one-shot mode the player just armed from the machine panel, so
    // it fires even while a gun/gadget is held (ignores suppressUse — otherwise
    // holding a gun would silently swallow the move click as an ADS zoom).
    if (this.armedMove && input.rightClicked && this.target) {
      const tId = this.world.getBlock(this.target.x, this.target.y, this.target.z);
      const into = BLOCKS[tId]?.replaceable ?? false;
      const px = this.target.x + (into ? 0 : this.target.nx);
      const py = this.target.y + (into ? 0 : this.target.ny);
      const pz = this.target.z + (into ? 0 : this.target.nz);
      const cb = this.armedMove;
      this.armedMove = null;
      cb(px, py, pz);
      return;
    }

    // suppressUse (e.g. aiming a gun down sights) blocks right-click placing AND
    // container/helm use, so right-click is free to mean "zoom" instead.
    const opened = suppressUse ? false : this.tryOpenContainer(input);
    const targetId = this.target
      ? this.world.getBlock(this.target.x, this.target.y, this.target.z) : Block.Air;
    if (isEntityBlock(targetId)) {
      // Machines aren't mined: a left-click is a sabotage hit (HP damage).
      if (input.leftClicked && !suppressMining && !opened) {
        this.onSabotage?.(this.target!.x, this.target!.y, this.target!.z);
        this.onAction?.();
      }
      this.breakKey = ''; this.breakProgress = 0; this.crackMesh.visible = false;
      if (!opened && !suppressUse) this.updatePlacing(dt, input, origin, dir);
    } else {
      this.updateBreaking(dt, input, suppressMining);
      if (!opened && !suppressUse) this.updatePlacing(dt, input, origin, dir);
    }

    // Middle-click pick block: select the matching hotbar slot.
    if (input.middleClicked && this.target) {
      let id = this.world.getBlock(this.target.x, this.target.y, this.target.z);
      if (torchSupport(id)) id = Block.Torch; // wall torches -> torch item
      const sb = stairsBaseOf(id);
      if (sb >= 0) id = sb; // any stairs facing -> the (N) stairs item
      if (isTopSlab(id)) id = slabBottomId(id); // top slab -> bottom slab item
      const slot = this.inventory.findInHotbar(id);
      if (slot >= 0) this.inventory.select(slot);
    }
  }

  private tryOpenContainer(input: Input): boolean {
    if (!input.rightClicked || !this.target || this.player.sneaking) return false;
    const id = this.world.getBlock(this.target.x, this.target.y, this.target.z);
    // A Respawn Beacon: set the player's personal spawn point here.
    if (id === Block.RespawnBeacon) {
      this.onSetSpawn?.(this.target.x, this.target.y, this.target.z);
      return true;
    }
    // A Waypoint Totem: attune/release it (fast travel from the map).
    if (id === Block.WaypointTotem) {
      this.onAttune?.(this.target.x, this.target.y, this.target.z);
      return true;
    }
    const kind = id === Block.CraftingTable ? 'table'
      : id === Block.Furnace || id === Block.FurnaceLit ? 'furnace'
      : id === Block.Chest ? 'chest'
      : id === Block.Core ? 'claim'
      : isTurretBlock(id) ? 'turret'
      : isMachineBlock(id) ? 'machine' // anchor or a footprint part -> open the machine
      : null;
    if (!kind) return false;
    this.onOpenContainer?.(kind, this.target.x, this.target.y, this.target.z);
    return true;
  }

  private updateBreaking(dt: number, input: Input, suppress = false): void {
    const t = this.target;
    if (!input.leftDown || !t || suppress) {
      this.breakKey = '';
      this.breakProgress = 0;
      this.crackMesh.visible = false;
      return;
    }
    const key = t.x + ',' + t.y + ',' + t.z;
    if (key !== this.breakKey) {
      this.breakKey = key;
      this.breakProgress = 0;
    }
    const id = this.world.getBlock(t.x, t.y, t.z);
    const info = BLOCKS[id];
    if (!info || info.hardness < 0) { // bedrock
      this.crackMesh.visible = false;
      return;
    }
    // Enemy faction's shielded claim: can't break inside it (mirrors the server).
    if (this.canEdit && !this.canEdit(t.x, t.y, t.z)) {
      this.crackMesh.visible = false;
      this.breakProgress = 0;
      return;
    }
    const held = this.inventory.selectedStack;
    const { time: rawTime, harvest } = miningStats(info, held);
    const breakTime = this.creative ? 0 : rawTime; // creative breaks instantly
    this.breakProgress += dt;

    if (this.breakProgress >= breakTime) {
      this.onBlockSound?.('break', id, t.x, t.y, t.z);
      this.world.setBlock(t.x, t.y, t.z, Block.Air, harvest);
      this.onEdit?.(t.x, t.y, t.z, 0);
      if (!this.creative && info.hardness > 0 && held && ITEMS[held.id]?.tool) {
        this.inventory.damageSelected(1); // mining wears a tool by 1
      }
      this.breakKey = '';
      this.breakProgress = 0;
      this.crackMesh.visible = false;
      this.onAction?.();
      return;
    }

    const stage = Math.min(9, Math.floor((this.breakProgress / breakTime) * 10));
    this.crackMaterial.map = this.crackTextures[stage];
    this.crackMesh.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    this.crackMesh.visible = true;
  }

  private updatePlacing(
    dt: number, input: Input, origin: THREE.Vector3, dir: THREE.Vector3
  ): void {
    this.placeCooldown -= dt;
    const wantPlace =
      input.rightClicked || (input.rightDown && this.placeCooldown <= 0);
    if (!wantPlace) return;

    // Survival: place what's in the selected hotbar stack, then consume it.
    const stack = this.inventory.selectedStack;
    const info = stack ? ITEMS[stack.id] : null;
    if (!stack || !info || info.kind !== 'block') return;
    let blockId: number = info.block!;

    if (!this.target) return;
    // Stairs orient to the player's look direction (the tall step faces that way).
    if (stairsBaseOf(blockId) >= 0) {
      blockId = orientStairsForYaw(stairsBaseOf(blockId), this.player.yaw);
    }
    // Slabs pick top vs bottom half from the aimed face + hit height (vanilla).
    if (isSlab(blockId)) {
      blockId = slabPlacement(blockId, this.target.ny, this.target.hy - this.target.y);
    }

    // Clicking a replaceable plant (tall grass, dead bush) places into it,
    // like vanilla; otherwise place against the targeted face.
    const targetId = this.world.getBlock(this.target.x, this.target.y, this.target.z);
    const intoTarget = BLOCKS[targetId]?.replaceable ?? false;
    const px = this.target.x + (intoTarget ? 0 : this.target.nx);
    const py = this.target.y + (intoTarget ? 0 : this.target.ny);
    const pz = this.target.z + (intoTarget ? 0 : this.target.nz);
    const existing = this.world.getBlock(px, py, pz);
    if (!isReplaceable(existing)) return;
    if (py < 0 || py >= 256) return;
    // Can't build inside an enemy faction's shielded claim (mirrors the server).
    if (this.canEdit && !this.canEdit(px, py, pz)) return;
    // Block-specific placement veto (e.g. a base Core needs owned territory).
    if (this.canPlace && !this.canPlace(px, py, pz, blockId)) return;

    // Machines occupy a vertical footprint (anchor at base + part cells above).
    // Validate the whole column is clear before committing the structure.
    const mType = machineTypeForBlock(blockId);
    if (mType !== null) {
      const h = machineHeight(mType);
      for (let k = 0; k < h; k++) {
        const cy = py + k;
        if (cy < 0 || cy >= 256) return;
        if (!isReplaceable(this.world.getBlock(px, cy, pz))) return;
        if (this.player.intersectsBlock(px, cy, pz)) return;
      }
      this.world.setBlock(px, py, pz, blockId); // anchor (holds the entity state)
      this.onEdit?.(px, py, pz, blockId);
      for (let k = 1; k < h; k++) {
        this.world.setBlock(px, py + k, pz, Block.MachinePart);
        this.onEdit?.(px, py + k, pz, Block.MachinePart);
      }
      this.onBlockSound?.('place', blockId, px, py, pz);
      if (!this.creative) this.inventory.consumeSelected(1);
      this.placeCooldown = PLACE_REPEAT;
      this.onAction?.();
      return;
    }

    if (blockId === Block.Torch) {
      // Torches orient to the clicked face and need a solid support block;
      // they can't displace water.
      if (existing === Block.Water) return;
      const oriented = intoTarget
        ? (isSolid(this.world.getBlock(px, py - 1, pz)) ? Block.Torch : null)
        : (isSolid(targetId)
          ? torchForFace(this.target.nx, this.target.ny, this.target.nz)
          : null);
      if (oriented === null) return;
      blockId = oriented;
    }

    if (BLOCKS[blockId].solid && this.player.intersectsBlock(px, py, pz, blockId)) return;

    this.world.setBlock(px, py, pz, blockId);
    this.onEdit?.(px, py, pz, blockId);
    this.onBlockSound?.('place', blockId, px, py, pz);
    if (!this.creative) this.inventory.consumeSelected(1);
    this.placeCooldown = PLACE_REPEAT;
    this.onAction?.();
  }

}
