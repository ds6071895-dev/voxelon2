// Renders server-owned dropped items (multiplayer) and requests pickups when
// the local player is in range. The server owns position + lifetime + the
// authoritative pickup; this is purely presentation + a pickup request.

import * as THREE from 'three';
import type { Inventory } from './inventory';
import { itemGeometry } from './itementity';
import type { NetClient } from './net/client';
import { PICKUP_RANGE } from './net/protocol';
import type { Player } from './player';
import type { Atlas } from './textures';

export class NetItems {
  private readonly scene: THREE.Scene;
  private readonly net: NetClient;
  private readonly atlas: Atlas;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly age = new Map<number, number>();
  private readonly requested = new Map<number, number>(); // eid -> cooldown s

  constructor(scene: THREE.Scene, net: NetClient, atlas: Atlas) {
    this.scene = scene;
    this.net = net;
    this.atlas = atlas;
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture, alphaTest: 0.4, vertexColors: true,
      side: THREE.DoubleSide,
    });
  }

  update(dt: number, player: Player, inventory: Inventory, sunlight: number): void {
    this.material.color.setScalar(0.45 + 0.55 * sunlight);

    // Drop meshes for items the server removed (picked up / despawned).
    for (const [eid, mesh] of this.meshes) {
      if (!this.net.netItems.has(eid)) {
        this.scene.remove(mesh); // geometry/material are shared — don't dispose
        this.meshes.delete(eid);
        this.age.delete(eid);
      }
    }
    for (const [eid, t] of this.requested) {
      const nt = t - dt;
      if (nt <= 0) this.requested.delete(eid); else this.requested.set(eid, nt);
    }

    const pcx = player.pos.x, pcy = player.pos.y + 0.9, pcz = player.pos.z;
    for (const [eid, info] of this.net.netItems) {
      let mesh = this.meshes.get(eid);
      if (!mesh) {
        mesh = new THREE.Mesh(itemGeometry(this.atlas, info.item), this.material);
        this.scene.add(mesh);
        this.meshes.set(eid, mesh);
        this.age.set(eid, 0);
      }
      const a = (this.age.get(eid) ?? 0) + dt;
      this.age.set(eid, a);
      mesh.position.set(info.x, info.y + 0.25 + Math.sin(a * 2) * 0.07, info.z);
      mesh.rotation.y = a * 1.8;

      // Request a pickup when in range (server validates + grants).
      if (!player.dead && !this.requested.has(eid)) {
        const dx = info.x - pcx, dy = info.y - pcy, dz = info.z - pcz;
        if (dx * dx + dy * dy + dz * dz <= PICKUP_RANGE * PICKUP_RANGE &&
          inventory.canAccept(info.item)) {
          this.net.sendPickup(eid);
          this.requested.set(eid, 0.5); // throttle re-requests
        }
      }
    }
  }
}
