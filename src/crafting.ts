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
const ANY_PLANKS = [OAK, BIRCH, SPRUCE, Block.JunglePlanks, Block.CherryPlanks];
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
  // Discovery woods (Milestone C): jungle + cherry, wired like birch/spruce.
  shapeless([Block.JungleLog], Block.JunglePlanks, 4),
  shapeless([Block.CherryLog], Block.CherryPlanks, 4),
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

  // Warfare (M14): turret + cannonball ammo.
  // Turret = a cannon-grade barrel on an iron+redstone auto-mount.
  shaped([[I, Cb, I], [R, I, R], [I, I, I]], Block.Turret),
  // Cannonball = iron shell packed with coal/charcoal powder.
  shaped([[null, I, null], [I, ANY_COAL, I], [null, I, null]], Item.Cannonball, 4),

  // Factions (M18): the claim Core — a diamond+titanium reactor caged in iron,
  // an expensive end-game build that anchors a faction's protected land.
  shaped([[T, D, T], [Cb, D, Cb], [I, I, I]], Block.Core),

  // Respawn Beacon: a cheap personal spawn block (a redstone-lit stone plinth).
  // Right-click to set your spawn; easily broken so it's a soft, contestable point.
  shaped([[C, R, C], [C, I, C], [C, C, C]], Block.RespawnBeacon),

  // Waypoint Totem (B4): a mid-cost travel anchor — gold runes on a plank
  // pillar. The 5000-block world is 2.5 km to the edge; totems shrink it.
  shaped([[null, Item.GoldIngot, null], [P, Item.GoldIngot, P], [P, P, P]], Block.WaypointTotem),

  // Glider: an early-game pair of wings — stick struts over plank membranes.
  // Cheap on purpose (worn in the chest slot, wears out fast).
  shaped([[S, S, S], [P, null, P]], Item.Glider),

  // Gadgets (Phase 8): nine war toys, built from common war materials.
  shaped([[null, I, null], [I, ANY_COAL, I], [null, R, null]], Item.Grenade, 2),
  shaped([[R, R, R], [R, Cb, R], [I, I, I]], Item.C4),
  shaped([[null, I, I], [I, S, null], [S, null, null]], Item.GrapplingHook),
  shaped([[I, I, I], [P, P, P]], Item.DeployCover, 2),
  shaped([[I, Cb, I], [R, I, R]], Item.SentryKit),
  shaped([[null, I, null], [ANY_COAL, R, ANY_COAL]], Item.SmokeGrenade, 2),
  shaped([[null, null, T], [null, I, I], [I, null, null]], Item.WarHorn),
  shaped([[null, I, null], [I, Item.OilBarrel, I], [null, R, null]], Item.OilBomb),
  shaped([[null, R, null], [I, Cb, I]], Item.SpyDisguise),
  // Jump Boost: a one-use spring — redstone + a slime-less feather-light frame
  // (sticks + iron). Cheap-ish but not trivial.
  shaped([[S, R, S], [I, R, I]], Item.JumpBoost, 2),

  // Lifesteal (Milestone A). WITHDRAW a heart: two gold ingots make the vessel;
  // crafting it ALSO costs 1 of YOUR hearts (main.ts vetoes the craft at the
  // 2-heart floor + sends heartWithdraw so the server deducts it).
  shapeless([Item.GoldIngot, Item.GoldIngot], Item.Heart),
  // Revival Beacon: an expensive teammate-rescue totem — titanium cage, twin
  // diamonds, and a real Heart at its core.
  shaped([[T, D, T], [T, Item.Heart, T], [null, D, null]], Item.RevivalBeacon),

  // Healing consumables (right-click for a burst of fast regeneration).
  // Bandage = cheap minor patch: redstone-soaked wrappings on a stick.
  shapeless([R, R, S], Item.Bandage, 2),
  // Medkit = a strong field kit: an iron case, a diamond healing core, redstone.
  shaped([[null, R, null], [I, D, I], [null, R, null]], Item.Medkit),

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
