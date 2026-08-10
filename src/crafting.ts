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
  // Diamond Shovel: the only diamond TOOL — it instamines grass/dirt/sand.
  shaped([[D], [S], [S]], Item.DiamondShovel),
  // The Sword: classic blade shape (top melee damage against mobs).
  shaped([[I], [I], [S]], Item.Sword),
  // Gold banking: 4 ingots <-> 1 solid Gold Block (vault treasuries drop them).
  shaped([[Item.GoldIngot, Item.GoldIngot], [Item.GoldIngot, Item.GoldIngot]], Block.GoldBlock),
  shapeless([Block.GoldBlock], Item.GoldIngot, 4),

  // Early-game armor: wood (planks) + stone (cobble) starter sets — cheap on
  // purpose so a fresh spawn can suit up before their first Tier I vault.
  ...armorSet(P, [Item.WoodHelmet, Item.WoodChestplate, Item.WoodLeggings, Item.WoodBoots]),
  ...armorSet(C, [Item.StoneHelmet, Item.StoneChestplate, Item.StoneLeggings, Item.StoneBoots]),

  // Armor (M10): iron / diamond / titanium sets.
  ...armorSet(I, [Item.IronHelmet, Item.IronChestplate, Item.IronLeggings, Item.IronBoots]),
  ...armorSet(D, [Item.DiamondHelmet, Item.DiamondChestplate, Item.DiamondLeggings, Item.DiamondBoots]),
  ...armorSet(T, [Item.TitaniumHelmet, Item.TitaniumChestplate, Item.TitaniumLeggings, Item.TitaniumBoots]),

  // Guns + ammo (M12): iron frames bound with redstone.
  shaped([[I, I, null], [null, R, null]], Item.Pistol),
  shaped([[I, I, I], [null, R, I]], Item.Rifle),
  shaped([[I, I, I], [I, R, I], [I, I, I]], Item.RocketLauncher),
  // One batch covers most of a rifle magazine. Bosses demand sustained fire,
  // but iron + redstone still keep large stockpiles from being free.
  shapeless([I, R], Item.Bullet, 24),
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
  // A diamond healing core supplies two kits, keeping boss healing practical.
  shaped([[null, R, null], [I, D, I], [null, R, null]], Item.Medkit, 2),

  // Traps. Spike Trap = a row of iron spikes on a stone base (batch of 3).
  shaped([[I, I, I], [C, C, C]], Block.SpikeTrap, 3),
  // Landmine = twin redstone triggers over an iron shell packed with powder.
  shaped([[R, null, R], [I, ANY_COAL, I]], Block.Landmine, 2),
  // Lever-triggered traps — DIRT cheap on purpose (trap-building is core play).
  // Lever = a stick on cobble. Fall Trap = two planks (a flimsy hatch).
  // Wall Trap = two cobble (a spring-loaded wall block).
  shaped([[S], [C]], Block.Lever, 2),
  shaped([[P, P]], Block.FallTrap, 2),
  shaped([[C, C]], Block.WallTrap, 2),

  // --- Flag-war kit ---------------------------------------------------------
  // Bear Trap = a sprung iron jaw on a redstone plate: pins whoever steps in it.
  shaped([[I, R, I], [I, null, I]], Block.BearTrap, 2),
  // Tar = coal boiled down with oil: a sticky pool nobody jumps out of.
  shaped([[ANY_COAL, ANY_COAL], [ANY_COAL, Item.OilBarrel]], Block.Tar, 4),
  // Barbed Wire = iron drawn out into cheap, nasty strands.
  shaped([[I, null, I], [null, I, null], [I, null, I]], Block.BarbedWire, 6),
  // Barricade = planks and sticks nailed crossways — the cheap wall.
  shaped([[P, S, P], [S, P, S], [P, S, P]], Block.Barricade, 4),
  // Reinforced Stone = cobble bound with iron: the wall you build round a flag.
  shaped([[C, I, C], [I, C, I], [C, I, C]], Block.ReinforcedStone, 5),
  // Floodlight = a torch behind glass in an iron housing: no more night sneaks.
  shaped([[I, Block.Glass, I], [I, Block.Torch, I]], Block.Floodlight, 2),

  // Boat: a plank hull, like the classic. Right-click water to launch.
  shaped([[P, null, P], [P, P, P]], Item.Boat),

  // Vault compasses (one-use vault finders): a redstone needle in a ring —
  // iron for Tier I, gold for Tier II, diamond for the deep-Wilds Tier III.
  shaped([[null, I, null], [I, R, I], [null, S, null]], Item.VaultCompass1),
  shaped([[null, Item.GoldIngot, null], [Item.GoldIngot, R, Item.GoldIngot], [null, S, null]], Item.VaultCompass2),
  shaped([[null, D, null], [D, R, D], [null, S, null]], Item.VaultCompass3),

  // Boss relic trophies: convert legacy masonry/torches into the cleared
  // family's decorative kit without replacing progression materials.
  shapeless([Item.WardenSigil, Block.VaultBrick], Block.CarvedVaultBrick, 8),
  shapeless([Item.MireBloom, Block.VaultBrick], Block.MossyVaultBrick, 8),
  shapeless([Item.EmberCore, Block.VaultBrick], Block.EmberBrick, 8),
  shapeless([Item.SeerPrism, Block.VaultBrick], Block.PrismBrick, 8),
  shapeless([Item.ArtificerGear, Block.VaultBrick], Block.GildedVaultBrick, 8),
  shapeless([Item.WardenSigil, Block.Torch], Block.SoulLantern, 2),
  shapeless([Item.MireBloom, Block.Torch], Block.GlowFungus, 2),
  shapeless([Item.EmberCore, Block.Torch], Block.EmberBrazier, 2),
  shapeless([Item.SeerPrism, Block.Torch], Block.PrismLamp, 2),
  shapeless([Item.ArtificerGear, Block.Torch], Block.GildedLamp, 2),

  // Greater Runes: arranged as a 2×2 seal instead of a shapeless four-item
  // row. That keeps the recipe preview honest and lets it fit the personal
  // crafting grid as well as a crafting table.
  shaped([[Item.WardenSigil, Item.WardenSigil], [Item.RuneOfIron, D]], Item.GreaterRuneOfIron),
  shaped([[Item.MireBloom, Item.MireBloom], [Item.RuneOfSwiftness, D]], Item.GreaterRuneOfSwiftness),
  shaped([[Item.EmberCore, Item.EmberCore], [Item.RuneOfFortune, D]], Item.GreaterRuneOfFortune),
  shaped([[Item.SeerPrism, Item.SeerPrism], [Item.RuneOfFocus, D]], Item.GreaterRuneOfFocus),
  shaped([[Item.ArtificerGear, Item.ArtificerGear],
    [[Item.RuneOfIron, Item.RuneOfSwiftness, Item.RuneOfFortune, Item.RuneOfFocus], D]], Item.GreaterRuneOfPower),

  // Building set (M15): per-wood slabs + stairs.
  ...woodCraft(OAK, Block.OakSlab, Block.OakStairsN),
  ...woodCraft(BIRCH, Block.BirchSlab, Block.BirchStairsN),
  ...woodCraft(SPRUCE, Block.SpruceSlab, Block.SpruceStairsN),

  // --- WARFARE COMMAND ------------------------------------------------------
  // Strategic hardware is assembled from SUB-ASSEMBLIES, because a 3×3 grid
  // cannot express "32 iron" in one recipe. Components are free to craft; the
  // finished hardware below is BLUEPRINT-GATED (see WARFARE_BLUEPRINTS).
  //
  // Reinforced Frame — 8 Iron.
  shaped([[I, I, I], [I, null, I], [I, I, I]], Item.ReinforcedFrame),
  // Guidance Unit — 6 Redstone, 1 Cobalt, 2 Iron.
  shaped([[R, R, R], [R, Cb, R], [I, R, I]], Item.GuidanceUnit),
  // Warhead — 2 Cobalt, 1 Oil, 4 Iron.
  shaped([[null, Cb, null], [I, Item.OilBarrel, I], [I, Cb, I]], Item.Warhead),
  // Rotor Assembly — 4 Titanium, 1 Cobalt, 2 Iron.
  shaped([[T, T, T], [I, Cb, I], [null, T, null]], Item.RotorAssembly),
  // Fuel Tank — 4 Iron, 2 Oil.
  shaped([[I, I], [Item.OilBarrel, Item.OilBarrel], [I, I]], Item.FuelTank),
  // Bomb Casing — 2 Iron, 1 Coal.
  shaped([[I], [ANY_COAL], [I]], Item.BombCasing),

  // Tactical Silo — ≈38 Iron, 8 Redstone, 3 Cobalt, 2 Oil.
  shaped([
    [Item.ReinforcedFrame, Item.GuidanceUnit, Item.ReinforcedFrame],
    [Item.ReinforcedFrame, Item.Warhead, Item.ReinforcedFrame],
    [R, Item.OilBarrel, R],
  ], Block.TacticalSilo),
  // Tactical Missile — ≈8 Iron, 6 Redstone, 3 Cobalt, 2 Oil.
  shaped([
    [null, Item.Warhead, null],
    [I, Item.GuidanceUnit, I],
    [null, Item.OilBarrel, null],
  ], Item.TacticalMissile),
  // Interceptor Battery — ≈20 Iron, 6 Redstone, 2 Cobalt, 1 Oil.
  shaped([
    [null, Item.GuidanceUnit, null],
    [Item.ReinforcedFrame, Cb, Item.ReinforcedFrame],
    [I, Item.OilBarrel, I],
  ], Block.InterceptorBattery),
  // Two Interceptor Missiles — 4 Iron, 2 Redstone, 1 Cobalt, 1 Oil.
  shaped([
    [R, null, R],
    [I, Cb, I],
    [I, Item.OilBarrel, I],
  ], Item.InterceptorMissile, 2),
  // Helipad — 8 Iron, 6 Cobblestone, 2 Redstone. Deliberately the cheap piece:
  // the pad is where an air wing LIVES, not what makes it expensive.
  shaped([
    [R, Item.ReinforcedFrame, R],
    [C, C, C],
    [C, C, C],
  ], Block.Helipad),
  // Helicopter Airframe — ≈38 Iron, 6 Redstone, 3 Cobalt, 8 Titanium, 4 Oil.
  // Titanium lands here and in the retrofits, never in the first missile, so
  // the very first unlock is usable long before a titanium run.
  shaped([
    [Item.RotorAssembly, Item.RotorAssembly, null],
    [Item.ReinforcedFrame, Item.GuidanceUnit, Item.ReinforcedFrame],
    [Item.FuelTank, Item.ReinforcedFrame, Item.FuelTank],
  ], Item.HelicopterKit),
  // Two Aerial Bombs — 4 Iron, 2 Redstone, 1 Cobalt, 1 Oil, 1 Coal.
  shaped([
    [R, Item.BombCasing, R],
    [I, Cb, I],
    [null, Item.OilBarrel, null],
  ], Item.AerialBomb, 2),
  // Hardware Repair Kit — 4 Iron, 1 Cobalt, 1 Oil (restores 25% of a hull).
  shaped([[I, I], [Cb, Item.OilBarrel], [I, I]], Item.RepairKit),
];

/**
 * BLUEPRINT GATING — crafting these requires the matching Warfare Command node.
 *
 * Both the hardware AND its ordnance are gated: knowing how to build a silo and
 * knowing how to build the warhead it fires are the same blueprint. The
 * intermediate COMPONENTS (frames, guidance units, warheads, rotors, tanks,
 * casings) stay open, which is what lets an un-authorized teammate still do the
 * heavy lifting for a faction's war effort — and *loading* already-built
 * ordnance into shared hardware is never gated at all (see server_core's
 * siloLoad/batteryLoad, which check faction, not blueprints).
 */
export const WARFARE_BLUEPRINTS: Record<number, string> = {
  [Block.TacticalSilo]: 'missile_command',
  [Item.TacticalMissile]: 'missile_command',
  [Block.InterceptorBattery]: 'aegis_systems',
  [Item.InterceptorMissile]: 'aegis_systems',
  [Block.Helipad]: 'flight_certification',
  [Item.HelicopterKit]: 'flight_certification',
  [Item.AerialBomb]: 'flight_certification',
};

/** The blueprint node a recipe result needs ('' = always craftable). */
export function blueprintFor(result: number): string {
  return WARFARE_BLUEPRINTS[result] ?? '';
}

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

/**
 * Blueprint check, injected by the client so this module stays free of any
 * progression dependency. Returns true when the player may craft `result`.
 * Defaults to "everything is craftable" (tests + the crafting guide).
 */
let blueprintCheck: (result: number) => boolean = () => true;

export function setBlueprintCheck(fn: (result: number) => boolean): void {
  blueprintCheck = fn;
}

/** Current craft result for the inventory's crafting cells. Strategic hardware
 *  is BLUEPRINT-GATED: the grid simply produces nothing until the matching
 *  Warfare Command node is authorized. */
export function craftResult(inv: Inventory): ItemStack | null {
  const r = matchGrid(inv.slots.slice(CRAFT_START, CRAFT_START + CRAFT_SIZE));
  if (r && WARFARE_BLUEPRINTS[r.id] && !blueprintCheck(r.id)) return null;
  return r;
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
