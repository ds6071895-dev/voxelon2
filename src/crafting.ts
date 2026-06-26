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

const ANY_COAL = [Item.Coal, Item.Charcoal];
const OAK = Block.OakPlanks, BIRCH = Block.BirchPlanks, SPRUCE = Block.SprucePlanks;
// Generic recipes accept ANY plank type (vanilla behaviour); slab/stairs are
// per-wood so each wood yields its own matching pieces.
const ANY_PLANKS = [OAK, BIRCH, SPRUCE];
const P = ANY_PLANKS;
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

/** Slab (6) + stairs (4) recipes for one wood from its specific plank block. */
function woodCraft(planks: number, slab: number, stairs: number): Recipe[] {
  return [
    shaped([[planks, planks, planks]], slab, 6),
    shaped([[planks, null, null], [planks, planks, null], [planks, planks, planks]], stairs, 4),
  ];
}

export const RECIPES: Recipe[] = [
  // Each log type yields its own planks now.
  shapeless([Block.OakLog], OAK, 4),
  shapeless([Block.BirchLog], BIRCH, 4),
  shapeless([Block.SpruceLog], SPRUCE, 4),
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
  // Arcade guns (distinct roles). Shotgun = iron barrels on a planks stock.
  shaped([[I, I, I], [P, R, null]], Item.Shotgun),
  // SMG = compact iron + redstone over a cobalt receiver.
  shaped([[I, I, R], [Cb, R, null]], Item.SMG),
  // Sniper = long iron barrel + a diamond scope, cobalt-braced.
  shaped([[I, I, I], [null, R, D], [Cb, null, null]], Item.Sniper),
  // Burst Rifle = iron carbine with a cobalt fire-group.
  shaped([[I, I, I], [Cb, R, R]], Item.BurstRifle),

  // Automation (M13): machines built around an iron frame.
  // Autominer = iron + redstone wrapped around a pickaxe core.
  shaped([[I, I, I], [R, Pk, R], [I, I, I]], Block.Autominer),
  // Oil Derrick = iron + cobalt ingots + redstone.
  shaped([[Cb, I, Cb], [I, R, I], [I, I, I]], Block.OilDerrick),

  // Warfare (M14): ships + turrets + cannonball ammo.
  // Ship Helm = a planks wheel around a redstone core on a cobalt hub.
  shaped([[P, R, P], [R, Cb, R], [P, R, P]], Block.ShipHelm),
  // Cannon = an iron barrel reinforced with cobalt over a planks carriage.
  shaped([[I, I, Cb], [I, R, I], [P, P, P]], Block.Cannon),
  // Turret = a cannon-grade barrel on an iron+redstone auto-mount.
  shaped([[I, Cb, I], [R, I, R], [I, I, I]], Block.Turret),
  // Cannonball = iron shell packed with coal/charcoal powder.
  shaped([[null, I, null], [I, ANY_COAL, I], [null, I, null]], Item.Cannonball, 4),

  // Factions (M18): the claim Core — a diamond+titanium reactor caged in iron,
  // an expensive end-game build that anchors a faction's protected land.
  shaped([[T, D, T], [Cb, D, Cb], [I, I, I]], Block.Core),

  // Glider: an early-game pair of wings — stick struts over plank membranes.
  // Cheap on purpose (worn in the chest slot, wears out fast).
  shaped([[S, S, S], [P, null, P]], Item.Glider),

  // Building set (M15): per-wood slabs + stairs.
  ...woodCraft(OAK, Block.OakSlab, Block.OakStairsN),
  ...woodCraft(BIRCH, Block.BirchSlab, Block.BirchStairsN),
  ...woodCraft(SPRUCE, Block.SpruceSlab, Block.SpruceStairsN),
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
