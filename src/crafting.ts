// Crafting: shaped recipes (matched at any offset, mirrored allowed) and
// shapeless recipes, over the 9 crafting cells in the Inventory (a 2x2
// personal grid only exposes 4 of them, so 3x3 recipes need the table).

import { Block } from './blocks';
import { Inventory, CRAFT_START, CRAFT_SIZE } from './inventory';
import { Item, ItemStack } from './items';

/** An ingredient is one item id or any-of a list. */
type Ingredient = number | number[];

interface ShapedRecipe {
  kind: 'shaped';
  pattern: (Ingredient | null)[][]; // rows of cells
  result: ItemStack;
}
interface ShapelessRecipe {
  kind: 'shapeless';
  items: Ingredient[];
  result: ItemStack;
}
export type Recipe = ShapedRecipe | ShapelessRecipe;

const ANY_LOG = [Block.OakLog, Block.BirchLog, Block.SpruceLog];
const ANY_COAL = [Item.Coal, Item.Charcoal];
const P = Block.OakPlanks;
const S = Item.Stick;
const C = Block.Cobblestone;
const I = Item.IronIngot;
const D = Item.Diamond;
const T = Item.TitaniumIngot;
const R = Item.Redstone;
const Cb = Item.CobaltIngot;
const Pk = Item.IronPickaxe; // a "pickaxe core" gives the autominer a tiered feel

function shaped(pattern: (Ingredient | null)[][], id: number, count = 1): Recipe {
  return { kind: 'shaped', pattern, result: { id, count } };
}
function shapeless(items: Ingredient[], id: number, count = 1): Recipe {
  return { kind: 'shapeless', items, result: { id, count } };
}

function tools(material: Ingredient, ids: [number, number, number]): Recipe[] {
  const [pickaxe, axe, shovel] = ids;
  const m = material;
  return [
    shaped([[m, m, m], [null, S, null], [null, S, null]], pickaxe),
    shaped([[m, m], [m, S], [null, S]], axe),
    shaped([[m], [S], [S]], shovel),
  ];
}

/** Vanilla armor shapes for one material: helmet, chestplate, leggings, boots. */
function armorSet(m: Ingredient, ids: [number, number, number, number]): Recipe[] {
  const [helmet, chest, legs, boots] = ids;
  return [
    shaped([[m, m, m], [m, null, m]], helmet),
    shaped([[m, null, m], [m, m, m], [m, m, m]], chest),
    shaped([[m, m, m], [m, null, m], [m, null, m]], legs),
    shaped([[m, null, m], [m, null, m]], boots),
  ];
}

export const RECIPES: Recipe[] = [
  shapeless([ANY_LOG], Block.OakPlanks, 4),
  shaped([[P], [P]], Item.Stick, 4),
  shaped([[P, P], [P, P]], Block.CraftingTable),
  shaped([[C, C, C], [C, null, C], [C, C, C]], Block.Furnace),
  shaped([[P, P, P], [P, null, P], [P, P, P]], Block.Chest),
  shaped([[ANY_COAL], [S]], Block.Torch, 4),
  ...tools(P, [Item.WoodenPickaxe, Item.WoodenAxe, Item.WoodenShovel]),
  ...tools(C, [Item.StonePickaxe, Item.StoneAxe, Item.StoneShovel]),
  ...tools(I, [Item.IronPickaxe, Item.IronAxe, Item.IronShovel]),

  // Armor (M10): iron / diamond / titanium sets.
  ...armorSet(I, [Item.IronHelmet, Item.IronChestplate, Item.IronLeggings, Item.IronBoots]),
  ...armorSet(D, [Item.DiamondHelmet, Item.DiamondChestplate, Item.DiamondLeggings, Item.DiamondBoots]),
  ...armorSet(T, [Item.TitaniumHelmet, Item.TitaniumChestplate, Item.TitaniumLeggings, Item.TitaniumBoots]),

  // Guns + ammo (M12): iron frames bound with redstone.
  shaped([[I, I, null], [null, R, null]], Item.Pistol),
  shaped([[I, I, I], [null, R, I]], Item.Rifle),
  shaped([[I, I, I], [I, R, I], [I, I, I]], Item.RocketLauncher),
  shapeless([I, R], Item.Bullet, 8),
  shaped([[null, I, null], [I, R, I], [null, ANY_COAL, null]], Item.Rocket, 2),

  // Automation (M13): machines built around an iron frame.
  // Autominer = iron + redstone wrapped around a pickaxe core.
  shaped([[I, I, I], [R, Pk, R], [I, I, I]], Block.Autominer),
  // Oil Derrick = iron + cobalt ingots + redstone.
  shaped([[Cb, I, Cb], [I, R, I], [I, I, I]], Block.OilDerrick),
];

function matches(ing: Ingredient, id: number | undefined): boolean {
  if (id === undefined) return false;
  return Array.isArray(ing) ? ing.includes(id) : ing === id;
}

/** Match the 9 crafting cells (3x3, row-major) against the recipe book. */
export function matchGrid(cells: (ItemStack | null)[]): ItemStack | null {
  const at = (x: number, y: number) => cells[y * 3 + x];

  for (const recipe of RECIPES) {
    if (recipe.kind === 'shapeless') {
      const present = cells.filter((c) => c !== null) as ItemStack[];
      if (present.length !== recipe.items.length) continue;
      const pool = [...present];
      let ok = true;
      for (const ing of recipe.items) {
        const idx = pool.findIndex((s) => matches(ing, s.id));
        if (idx < 0) { ok = false; break; }
        pool.splice(idx, 1);
      }
      if (ok) return { ...recipe.result };
      continue;
    }

    const h = recipe.pattern.length;
    const w = Math.max(...recipe.pattern.map((r) => r.length));
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let oy = 0; oy + h <= 3; oy++) {
        for (let ox = 0; ox + w <= 3; ox++) {
          let ok = true;
          for (let y = 0; y < 3 && ok; y++) {
            for (let x = 0; x < 3 && ok; x++) {
              const px = mirror ? w - 1 - (x - ox) : x - ox;
              const inPattern =
                y >= oy && y < oy + h && x >= ox && x < ox + w;
              const ing = inPattern ? recipe.pattern[y - oy][px] ?? null : null;
              const cell = at(x, y);
              if (ing === null) ok = cell === null;
              else ok = matches(ing, cell?.id);
            }
          }
          if (ok) return { ...recipe.result };
        }
      }
    }
  }
  return null;
}

/** Current craft result for the inventory's crafting cells. */
export function craftResult(inv: Inventory): ItemStack | null {
  return matchGrid(inv.slots.slice(CRAFT_START, CRAFT_START + CRAFT_SIZE));
}

/** Consume one item from each occupied crafting cell. */
export function consumeCraft(inv: Inventory): void {
  for (let i = CRAFT_START; i < CRAFT_START + CRAFT_SIZE; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    s.count -= 1;
    if (s.count <= 0) inv.slots[i] = null;
  }
  inv.version++;
}
