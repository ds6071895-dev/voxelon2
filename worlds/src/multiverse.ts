// The Multiverse: every match is played in a WORLD of its own.
//
// VOXELON stamped each minigame arena into the open world's coordinate space,
// far past the border, in a fixed number of slots — which capped how many
// matches could run at once and made isolation a matter of cropping and
// filtering. Worlds works like a Multiverse server instead: a match gets its
// own world (own blocks, own edits, own players), built by one of the
// generators below, and every world is authored at the same origin. Two
// matches can both stand at (0, 140, 0) because they are different worlds.
//
// Pure: no DOM, no THREE, no Node. The browser builds its chunk meshes from a
// generator; the server runs collision, movement validation and bot physics
// against the same generator plus that world's edit log.

import { Block, BLOCKS } from './blocks';
import type { ColumnTints, Tint } from './tints';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { DUEL_ARENA_FLOOR_Y, DUEL_ARENA_SIZE, duelArenaBlockAt } from './duels';
import {
  PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y, partyGame, partyVenueLookup,
} from './partygames';
import { parkourTheme } from './parkour_themes';
import { RS_BOUNDS, RS_MAX_Y, RS_MIN_Y, ratseekBlockAt } from './ratseek_house';

export type WorldKind = 'duel' | 'bridge' | 'parkour' | 'ratseek';

/** Everything a client needs to build a world: which generator, which seed.
 *  `id` is the server's handle for this world instance. */
export interface WorldSpec {
  id: number;
  kind: WorldKind;
  seed: number;
}

export interface WorldBounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** A deterministic world. Chunks outside `bounds` are empty air. */
export interface WorldGenerator {
  readonly seed: number;
  readonly bounds: WorldBounds;
  /** Inclusive y range that can hold authored blocks. */
  readonly minY: number;
  readonly maxY: number;
  /** Authored block at a cell (Air anywhere nothing was built). */
  blockAt(x: number, y: number, z: number): number;
  /** Fill one chunk column with authored blocks. */
  fill(chunk: Chunk): void;
  /** Grass/foliage/water colouring for a column. */
  tints(x: number, z: number): ColumnTints;
}

function tintOf(hex: number): Tint {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

const TEMPERATE: ColumnTints = {
  grass: tintOf(0x7cbd6b), foliage: tintOf(0x59ae30), water: tintOf(0x3f76e4),
};

class VenueGenerator implements WorldGenerator {
  private readonly columnTints: ColumnTints;
  constructor(
    readonly seed: number,
    readonly bounds: WorldBounds,
    readonly minY: number,
    readonly maxY: number,
    private readonly stamp: (x: number, y: number, z: number) => number,
    tints: ColumnTints = TEMPERATE,
  ) {
    this.columnTints = tints;
  }

  blockAt(x: number, y: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    const b = this.bounds;
    if (bx < b.minX || bx >= b.maxX || bz < b.minZ || bz >= b.maxZ) return Block.Air;
    const by = Math.floor(y);
    if (by < this.minY || by > this.maxY) return Block.Air;
    return this.stamp(bx, by, bz);
  }

  fill(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_X, oz = chunk.cz * CHUNK_Z, b = this.bounds;
    // A chunk entirely outside the venue is honest, empty void.
    if (ox >= b.maxX || ox + CHUNK_X <= b.minX || oz >= b.maxZ || oz + CHUNK_Z <= b.minZ) return;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const wx = ox + lx;
      if (wx < b.minX || wx >= b.maxX) continue;
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const wz = oz + lz;
        if (wz < b.minZ || wz >= b.maxZ) continue;
        for (let y = this.minY; y <= this.maxY; y++) {
          const block = this.stamp(wx, y, wz);
          if (block !== Block.Air) chunk.set(lx, y, lz, block);
        }
      }
    }
  }

  tints(): ColumnTints { return this.columnTints; }
}

const generators = new Map<string, WorldGenerator>();

/** The generator for a world. Cached per kind+seed: generators are immutable,
 *  so every world of the same kind and seed can share one. */
export function worldGenerator(spec: Pick<WorldSpec, 'kind' | 'seed'>): WorldGenerator {
  const key = `${spec.kind}:${spec.seed >>> 0}`;
  let gen = generators.get(key);
  if (gen) return gen;
  if (spec.kind === 'duel') {
    gen = new VenueGenerator(spec.seed,
      { minX: 0, maxX: DUEL_ARENA_SIZE, minZ: 0, maxZ: DUEL_ARENA_SIZE },
      // The colosseum's invisible barrier runs to the top of the world, so a
      // pillar-and-jump can never clear the wall.
      DUEL_ARENA_FLOOR_Y - 1, 255,
      (x, y, z) => duelArenaBlockAt(x, y, z) ?? Block.Air);
  } else if (spec.kind === 'ratseek') {
    // The Crooked Manor is one fixed estate; every match gets a fresh copy.
    gen = new VenueGenerator(spec.seed, RS_BOUNDS, RS_MIN_Y, RS_MAX_Y, ratseekBlockAt);
  } else {
    const game = spec.kind, def = partyGame(game);
    const tints = game === 'parkour'
      ? { ...TEMPERATE, grass: tintOf(parkourTheme(spec.seed).foliage), foliage: tintOf(parkourTheme(spec.seed).foliage) }
      : TEMPERATE;
    gen = new VenueGenerator(spec.seed,
      { minX: 0, maxX: def.sizeX, minZ: 0, maxZ: def.sizeZ },
      PARTY_STAMP_MIN_Y, PARTY_STAMP_MAX_Y,
      partyVenueLookup(game, spec.seed), tints);
  }
  // Parkour courses are generated per match; keep the cache from growing
  // without bound on a long-running server.
  if (generators.size > 64) generators.delete(generators.keys().next().value!);
  generators.set(key, gen);
  return gen;
}

/** Drop a finished world's cached generator. */
export function releaseWorldGenerator(spec: Pick<WorldSpec, 'kind' | 'seed'>): void {
  generators.delete(`${spec.kind}:${spec.seed >>> 0}`);
}

/**
 * One world's live block state: the authored generator plus whatever players
 * placed and broke. The server keeps one per running match; bots and movement
 * validation read through it. `edits` holds only cells that differ from the
 * generator (Air included, for a broken authored block).
 */
export class WorldBlocks {
  /** Cell key → block. Keys pack (x, y, z) into one number: venues sit at the
   *  origin and are far smaller than the ±2048 this allows. */
  readonly edits = new Map<number, number>();
  constructor(readonly gen: WorldGenerator) { }

  static key(x: number, y: number, z: number): number { return ((y + 64) * 4096 + (z + 2048)) * 4096 + (x + 2048); }

  getBlock(x: number, y: number, z: number): number {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (this.edits.size) {
      const edited = this.edits.get(WorldBlocks.key(bx, by, bz));
      if (edited !== undefined) return edited;
    }
    return this.gen.blockAt(bx, by, bz);
  }
  solidAt(x: number, y: number, z: number): boolean {
    return !!BLOCKS[this.getBlock(x, y, z)]?.solid;
  }
  /** Record an edit. Setting a cell back to its authored block forgets it. */
  set(x: number, y: number, z: number, block: number): void {
    const k = WorldBlocks.key(x, y, z);
    if (this.gen.blockAt(x, y, z) === block) this.edits.delete(k);
    else this.edits.set(k, block);
  }
  /** Restore a cell to its authored block. */
  restore(x: number, y: number, z: number): number {
    this.edits.delete(WorldBlocks.key(x, y, z));
    return this.gen.blockAt(x, y, z);
  }
  isEdited(x: number, y: number, z: number): boolean { return this.edits.has(WorldBlocks.key(x, y, z)); }
  /** The player-placed block at a cell, if any (undefined = authored). */
  editAt(x: number, y: number, z: number): number | undefined { return this.edits.get(WorldBlocks.key(x, y, z)); }
  /** Adapter for code written against the client World's read API (the bots'
   *  Player physics and planners). Every chunk "is loaded". */
  asWorld(): { isLoaded: () => boolean; getBlock: (x: number, y: number, z: number) => number } {
    return { isLoaded: () => true, getBlock: (x, y, z) => this.getBlock(x, y, z) };
  }
}
