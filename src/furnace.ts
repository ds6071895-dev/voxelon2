// Furnaces: per-position block entities with input/fuel/output slots,
// vanilla-style burn and cook timers, and a lit/unlit block swap that feeds
// the lighting engine.

import { Block } from './blocks';
import { Item, ItemStack, ITEMS } from './items';
import type { World } from './world';

export const COOK_TIME = 10; // seconds per item, vanilla

/** input item id -> smelted item id */
export const SMELT: Record<number, number> = {
  [Block.IronOre]: Item.IronIngot,
  [Block.GoldOre]: Item.GoldIngot,
  [Block.TitaniumOre]: Item.TitaniumIngot,
  [Block.CobaltOre]: Item.CobaltIngot,
  [Block.Sand]: Block.Glass,
  [Block.Cobblestone]: Block.Stone,
  [Block.OakLog]: Item.Charcoal,
  [Block.BirchLog]: Item.Charcoal,
  [Block.SpruceLog]: Item.Charcoal,
};

/** fuel item id -> burn seconds (10s = one smelt) */
export const FUEL: Record<number, number> = {
  [Item.Coal]: 80,
  [Item.Charcoal]: 80,
  [Block.OakLog]: 15,
  [Block.BirchLog]: 15,
  [Block.SpruceLog]: 15,
  [Block.OakPlanks]: 15,
  [Item.Stick]: 5,
  [Block.CraftingTable]: 15,
};

export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** Seconds left on the current piece of fuel. */
  burnTime: number;
  /** Total seconds of the current piece of fuel (for the flame icon). */
  burnTotal: number;
  /** Seconds of smelting progress on the current input item. */
  cookTime: number;
}

function canSmelt(state: FurnaceState): boolean {
  if (!state.input) return false;
  const out = SMELT[state.input.id];
  if (out === undefined) return false;
  if (!state.output) return true;
  return state.output.id === out &&
    state.output.count < (ITEMS[out]?.maxStack ?? 64);
}

export class Furnaces {
  private readonly states = new Map<string, FurnaceState>();
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  get(x: number, y: number, z: number): FurnaceState {
    const key = `${x},${y},${z}`;
    let s = this.states.get(key);
    if (!s) {
      s = { input: null, fuel: null, output: null, burnTime: 0, burnTotal: 0, cookTime: 0 };
      this.states.set(key, s);
    }
    return s;
  }

  /** Remove a broken furnace's state; returns its contents for spilling. */
  remove(x: number, y: number, z: number): ItemStack[] {
    const key = `${x},${y},${z}`;
    const s = this.states.get(key);
    this.states.delete(key);
    if (!s) return [];
    return [s.input, s.fuel, s.output].filter((v): v is ItemStack => v !== null);
  }

  update(dt: number): void {
    for (const [key, s] of this.states) {
      const smeltable = canSmelt(s);

      // Ignite a new piece of fuel when there is work to do.
      if (s.burnTime <= 0 && smeltable && s.fuel && FUEL[s.fuel.id]) {
        s.burnTime = s.burnTotal = FUEL[s.fuel.id];
        s.fuel.count -= 1;
        if (s.fuel.count <= 0) s.fuel = null;
      }

      if (s.burnTime > 0) {
        s.burnTime -= dt;
        if (smeltable) {
          s.cookTime += dt;
          if (s.cookTime >= COOK_TIME) {
            s.cookTime = 0;
            const out = SMELT[s.input!.id];
            s.input!.count -= 1;
            if (s.input!.count <= 0) s.input = null;
            if (s.output) s.output.count += 1;
            else s.output = { id: out, count: 1 };
          }
        } else {
          s.cookTime = 0;
        }
      } else {
        s.burnTime = 0;
        s.cookTime = Math.max(0, s.cookTime - dt * 2); // progress decays
      }

      // Keep the world block in sync (drives the orange glow + light).
      const [x, y, z] = key.split(',').map(Number);
      const id = this.world.getBlock(x, y, z);
      const want = s.burnTime > 0 ? Block.FurnaceLit : Block.Furnace;
      if ((id === Block.Furnace || id === Block.FurnaceLit) && id !== want) {
        this.world.setBlock(x, y, z, want);
      }
    }
  }
}
