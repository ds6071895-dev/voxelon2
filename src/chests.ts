// Chest storage. Offline: contents live in a local map. Multiplayer: the
// server is the source of truth (fetched on open, pushed on change, broadcast
// to other live viewers); this keeps a local cache for immediate display.

import type { ItemStack } from './items';
import type { NetClient } from './net/client';
import { CHEST_SLOTS } from './net/protocol';

export class Chests {
  net: NetClient | null = null;
  private readonly local = new Map<string, (ItemStack | null)[]>();

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Contents to show immediately on open (MP also requests the live copy). */
  open(x: number, y: number, z: number): (ItemStack | null)[] {
    if (this.net?.connected) this.net.sendChestOpen(x, y, z);
    return this.local.get(this.key(x, y, z)) ?? new Array(CHEST_SLOTS).fill(null);
  }

  /** Cache an authoritative copy received from the server. */
  store(x: number, y: number, z: number, slots: (ItemStack | null)[]): void {
    this.local.set(this.key(x, y, z), slots);
  }

  /** Persist edited contents locally and push to the server (MP). */
  sync(x: number, y: number, z: number, slots: (ItemStack | null)[]): void {
    this.local.set(this.key(x, y, z), slots);
    if (this.net?.connected) this.net.sendChestSet(x, y, z, slots);
  }

  /** Break the chest: clear the local cache and return its items.
   *  Offline the caller spills the returned items. In multiplayer the SERVER
   *  is authoritative for the break — it spills the real stored contents on the
   *  removal edit — so we do NOT push contents from the (possibly empty/stale)
   *  local cache, which would otherwise wipe or desync the server copy. */
  remove(x: number, y: number, z: number): ItemStack[] {
    const k = this.key(x, y, z);
    const contents = this.local.get(k) ?? [];
    this.local.delete(k);
    return contents.filter((s): s is ItemStack => s !== null);
  }
}
