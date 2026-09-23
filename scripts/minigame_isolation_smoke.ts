// Minigame isolation: every id in MINIGAME_ONLY must be unreachable from the
// open world, through every route the world has for putting an item in a
// player's hands.
//
// Most of the tables below are opt-in-by-explicit-listing, so "we just won't
// add it" would be technically sufficient. That is exactly why this file
// exists: a guarantee nobody checks is a guarantee that expires the first time
// someone adds a plausible-looking recipe.

import { Block, BLOCKS } from '../src/blocks';
import { Item, ITEMS, creativePaletteIds, dropFor } from '../src/items';
import { MINIGAME_ONLY, isMinigameOnly, stripMinigameItems } from '../src/minigame_items';
import { RECIPES } from '../src/crafting';
import { LOOT_TABLES } from '../src/loot';
import { VAULT_LOOT } from '../src/vaults';
import { MOB_DEFS } from '../src/mobs';
import { SMELT, FUEL } from '../src/furnace';
import { itemDescription } from '../src/itemdesc';
import { GameServer } from '../src/net/server_core';
import {
  ARENA_BAND_MIN_X, ARENA_VOID_MIN_X, arenaBandForX, isArenaColumn, isArenaEditKey,
} from '../src/arena';
import { DUEL_ARENA_BASE_X, DUEL_ARENA_SLOT_SPACING, DUEL_ARENA_SLOTS } from '../src/duels';
import { Terrain } from '../src/terrain';
import { Chunk, CHUNK_X } from '../src/chunk';

let passed = 0;
function check(name: string, ok: unknown, detail = ''): void {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  passed++;
}

let tokenN = 0;
const token = () => `${String(++tokenN).padStart(24, 'b')}0123456789abcdef01234567`;

const ONLY = [...MINIGAME_ONLY].sort((a, b) => a - b);
/** Ids registered as blocks but deliberately given NO item form. */
const BLOCK_ONLY = [
  Block.BwBedA, Block.BwBedB, Block.BwGenerator, Block.BwShop, Block.ArenaRim,
  Block.ParkourLaunchPad, Block.ParkourBoostPad,
];
/** Ids that DO have an item form, so their gate is load-bearing rather than free. */
const ITEM_FORMED = [
  Block.TeamWoolA, Block.TeamWoolB, Block.PartyTileC, Block.PartyTileD,
  Item.VoidCleaver, Item.KnockbackStick, Item.BridgeBow, Item.BridgeArrow,
];

// ── The registry itself ────────────────────────────────────────────────────
{
  check('the registry is non-empty and every id is a finite integer',
    ONLY.length >= 11 && ONLY.every((id) => Number.isInteger(id) && id > 0 && id < 256));
  check('every listed id is one of the two documented kinds',
    ONLY.length === BLOCK_ONLY.length + ITEM_FORMED.length &&
    [...BLOCK_ONLY, ...ITEM_FORMED].every((id) => isMinigameOnly(id)));
  check('block-only ids are registered as blocks so the mesher can draw them',
    BLOCK_ONLY.every((id) => !!BLOCKS[id]));
  check('block-only ids have NO item form — unobtainability for free',
    BLOCK_ONLY.every((id) => ITEMS[id] === undefined));
  check('block-only fixtures are unmineable by the ordinary path',
    BLOCK_ONLY.every((id) => BLOCKS[id].hardness === -1));
  check('item-formed ids DO have an item form, so the explicit gate is required',
    ITEM_FORMED.every((id) => !!ITEMS[id]));
  check('no minigame id collides with a live open-world id of the other kind',
    !isMinigameOnly(Block.Barrier) && !isMinigameOnly(Item.ReinforcedFrame) &&
    !isMinigameOnly(Block.PackedSnow));
  check('nothing in the registry sits on a RETIRED id',
    ONLY.every((id) => ![213, 214, 215, 219, 223, 224].includes(id)));
}

// ── Enumerations a player can see ──────────────────────────────────────────
{
  const palette = creativePaletteIds();
  check('the creative palette lists no minigame item',
    palette.every((id) => !isMinigameOnly(id)));
  check('the creative palette is otherwise unchanged and still substantial',
    palette.length === Object.keys(ITEMS).map(Number).filter((id) => ITEMS[id]).length - ITEM_FORMED.length &&
    palette.length > 100);
  check('the palette is sorted ascending with no duplicates',
    palette.every((id, i) => i === 0 || id > palette[i - 1]));
  check('ordinary items are still listed',
    palette.includes(Item.Diamond) && palette.includes(Block.OakPlanks) &&
    palette.includes(Item.BurstRifle));
}

// ── Every opt-in economy table ─────────────────────────────────────────────
{
  const recipeIds = new Set<number>();
  for (const r of RECIPES) {
    recipeIds.add(r.result.id);
    const cells = r.kind === 'shaped' ? r.pattern.flat() : r.items;
    for (const cell of cells) {
      if (cell === null || cell === undefined) continue;
      for (const id of Array.isArray(cell) ? cell : [cell]) recipeIds.add(id);
    }
  }
  check('no recipe produces OR consumes a minigame id',
    ONLY.every((id) => !recipeIds.has(id)),
    ONLY.filter((id) => recipeIds.has(id)).join(','));

  const lootIds = new Set<number>();
  for (const table of Object.values(LOOT_TABLES)) for (const e of table) lootIds.add(e.id);
  for (const table of Object.values(VAULT_LOOT)) for (const e of table) lootIds.add(e.id);
  check('no structure or vault loot pool can roll a minigame id',
    ONLY.every((id) => !lootIds.has(id)));

  const dropIds = new Set<number>();
  for (const def of Object.values(MOB_DEFS)) {
    // Drain the RNG across its whole range so a weighted rare drop cannot hide.
    for (let i = 0; i < 200; i++) {
      for (const stack of def.drops(() => i / 200)) dropIds.add(stack.id);
    }
  }
  check('no mob drops a minigame id at any roll', ONLY.every((id) => !dropIds.has(id)));

  check('minigame ids neither smelt nor smelt INTO anything',
    ONLY.every((id) => SMELT[id] === undefined) &&
    !Object.values(SMELT).some((out) => isMinigameOnly(out)));
  check('minigame ids are not furnace fuel', ONLY.every((id) => FUEL[id] === undefined));
  check('minigame ids have no field-guide description',
    ITEM_FORMED.every((id) => itemDescription(id) === itemDescription(-1)));
}

// ── dropFor: breaking a cell must never mint an arena item ─────────────────
{
  check('breaking a block-only fixture drops nothing',
    BLOCK_ONLY.every((id) => dropFor(id, null) === null));
  check('breaking a placed arena wool drops nothing into the world',
    ITEM_FORMED.filter((id) => BLOCKS[id]).every((id) => {
      const d = dropFor(id, null);
      return d === null || !isMinigameOnly(d.id);
    }));
}

// ── stripMinigameItems ─────────────────────────────────────────────────────
{
  const before = {
    x: 120, y: 70, z: 30, mode: 'survival',
    slots: [
      { id: Item.Diamond, count: 3 },
      { id: Item.VoidCleaver, count: 1 },
      null,
      { id: Block.TeamWoolA, count: 16 },
      { id: Block.OakPlanks, count: 64 },
    ],
    armor: [{ id: Item.IronHelmet, count: 1 }, null, null, null],
    totems: [1, 2, 3],
  };
  const snapshot = JSON.stringify(before);
  const after = stripMinigameItems(before as unknown as Record<string, unknown>);
  const slots = after.slots as ({ id: number } | null)[];
  check('the offending stacks are removed', slots[1] === null && slots[3] === null);
  check('slot INDICES are preserved, not spliced — hotbar positions are meaningful',
    slots.length === 5 && slots[0]?.id === Item.Diamond && slots[4]?.id === Block.OakPlanks);
  check('untouched arrays and scalar keys survive verbatim',
    after.x === 120 && after.mode === 'survival' &&
    JSON.stringify(after.armor) === JSON.stringify(before.armor) &&
    JSON.stringify(after.totems) === JSON.stringify(before.totems));
  check('the input is never mutated', JSON.stringify(before) === snapshot);
  check('a clean blob round-trips unchanged',
    JSON.stringify(stripMinigameItems({ slots: [{ id: Item.Coal, count: 1 }] })) ===
    JSON.stringify({ slots: [{ id: Item.Coal, count: 1 }] }));
}

// ── The server's fail-closed belt-and-braces ───────────────────────────────
{
  for (const id of ONLY) {
    const s = new GameServer(99, token);
    s.addPlayer(1, { username: 'Cheater', faction: 0 });
    s.handle(1, { t: 'xform', x: 40, y: 70, z: 40, yaw: 0, pitch: 0 });
    const editsBefore = s.serialize().edits.length;

    const edit = s.handle(1, { t: 'edit', x: 40, y: 70, z: 41, block: id });
    check(`edit with minigame block ${id} is dropped and logs nothing`,
      edit.length === 0 && s.serialize().edits.length === editsBefore);

    const drop = s.handle(1, {
      t: 'drop', items: [{ id, count: 4 }], x: 40, y: 70, z: 40,
    });
    check(`drop of minigame id ${id} spawns no entity`,
      !drop.some((o) => o.msg.t === 'itemspawn'));

    // Storage: park a real chest first, then try to stuff an arena item in it.
    s.handle(1, { t: 'edit', x: 40, y: 70, z: 39, block: Block.Chest });
    const chest = s.handle(1, {
      t: 'chestSet', x: 40, y: 70, z: 39,
      slots: [{ id, count: 1 }],
    });
    check(`chestSet with minigame id ${id} is rejected`, chest.length === 0);
  }
}

// A world edit with an ORDINARY block still works — the gates above must not
// have been implemented by accidentally rejecting everything.
{
  const s = new GameServer(99, token);
  s.addPlayer(1, { username: 'Builder', faction: 0 });
  s.addPlayer(2, { username: 'Rival', faction: 1 });
  const attacker = s.players.get(1)!, rival = s.players.get(2)!;
  Object.assign(rival, { x: attacker.x, y: attacker.y, z: attacker.z - 2 });
  attacker.held = Item.IronAxe;
  const health = rival.health;
  check('Bridge iron axe attacks are inert in regular warfare',
    s.handle(1, { t: 'partyMelee', target: 2 }).length === 0 && rival.health === health);
  attacker.held = Item.BridgeBow;
  check('Bridge bow attacks are inert in regular warfare',
    s.handle(1, { t: 'partyShoot', dx: 0, dy: 0, dz: -1, power: 1 }).length === 0 && rival.health === health);
  s.handle(1, { t: 'xform', x: 40, y: 70, z: 40, yaw: 0, pitch: 0 });
  const ok = s.handle(1, { t: 'edit', x: 40, y: 70, z: 41, block: Block.OakPlanks });
  check('an ordinary world edit is still accepted', ok.length > 0 &&
    s.serialize().edits.some(([k, b]) => k === '40,70,41' && b === Block.OakPlanks));
  const dropped = s.handle(1, {
    t: 'drop', items: [{ id: Item.Diamond, count: 1 }], x: 40, y: 70, z: 40,
  });
  check('an ordinary drop still spawns an entity',
    dropped.some((o) => o.msg.t === 'itemspawn'));
}

// ── Persistence cannot carry an arena item out ─────────────────────────────
{
  const s = new GameServer(99, token);
  s.addPlayer(1, { username: 'Saver', faction: 0 });
  s.handle(1, { t: 'xform', x: 12, y: 70, z: 12, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'saveState', data: {
    x: 12, y: 70, z: 12,
    slots: [{ id: Item.Diamond, count: 1 }, { id: Item.VoidCleaver, count: 1 }],
  } });
  const captured = s.capturePlayerState(1)!.data;
  const slots = captured.slots as ({ id: number } | null)[];
  check('capturePlayerState never persists a minigame item',
    slots[0]?.id === Item.Diamond && slots[1] === null);
}

// ── Arena COLUMNS cannot carry a block out ─────────────────────────────────
//
// The block registry above is about WHICH ids a minigame owns. This section is
// about WHERE: an arena is a place beyond the world border, and nothing a
// match stamps or a competitor places there is part of the world. That has to
// hold through the two channels a block can escape by — the save file and a
// new player's login snapshot — because a retired mode's wool sat in a real
// world save for months by leaking through exactly those two.
{
  check('the open world and the arena bands cannot overlap',
    ARENA_VOID_MIN_X > 2_500 && ARENA_VOID_MIN_X < ARENA_BAND_MIN_X);
  check('an ordinary world column is not arena space',
    !isArenaColumn(0) && !isArenaColumn(2_500) && !isArenaColumn(-40_000) &&
    !isArenaColumn(Number.NaN));
  check('every band column is arena space',
    isArenaColumn(ARENA_BAND_MIN_X) && isArenaColumn(262_144));
  check('edit keys are classified by their x, negatives included',
    isArenaEditKey(`${ARENA_BAND_MIN_X},96,4`) && !isArenaEditKey('-217,74,183') &&
    !isArenaEditKey('40,70,41') && !isArenaEditKey('') && !isArenaEditKey('nonsense'));

  // A band owns its slots and not one column more. Bedwars was registered at
  // x=65 536 and the Duels band — unbounded at the time — answered for it, so
  // a retired mode's arena generated colosseums.
  const pastDuels = DUEL_ARENA_BASE_X + DUEL_ARENA_SLOTS * DUEL_ARENA_SLOT_SPACING;
  check('a band answers for its own slots',
    arenaBandForX(DUEL_ARENA_BASE_X)?.kind === 'duel' &&
    arenaBandForX(pastDuels - DUEL_ARENA_SLOT_SPACING)?.kind === 'duel');
  check('a band answers for NOTHING past its last slot',
    arenaBandForX(pastDuels) === null && arenaBandForX(65_536) === null);

  // Unclaimed space beyond the border is empty, not open world: a natural hill
  // next to an arena wall is world geometry inside a minigame.
  const terrain = new Terrain(99);
  const emptyAt = (worldX: number): boolean => {
    const chunk = new Chunk(Math.floor(worldX / CHUNK_X), 0);
    terrain.fill(chunk);
    return chunk.data.every((b) => b === 0);
  };
  check('the gap between the border and the first arena is pure air',
    emptyAt(ARENA_VOID_MIN_X) && emptyAt(ARENA_BAND_MIN_X - CHUNK_X));
  check('an unclaimed column past every band is pure air', emptyAt(pastDuels));
  check('the open world itself is still generated',
    !emptyAt(0) && !emptyAt(1_024));
}

{
  const s = new GameServer(99, token);
  s.addPlayer(1, { username: 'Duellist', faction: 0 });
  // Reach past the handlers and write straight into the edit log, which is
  // what every in-match arena build path does.
  const arenaKey = `${ARENA_BAND_MIN_X + 8},100,9`;
  s.edits.set(arenaKey, Block.OakPlanks);
  s.edits.set('40,70,41', Block.OakPlanks);

  check('an arena column is never written to the world save',
    !s.serialize().edits.some(([k]) => k === arenaKey));
  check('the world save still carries the open world',
    s.serialize().edits.some(([k, b]) => k === '40,70,41' && b === Block.OakPlanks));

  const welcome = s.addPlayer(2, { username: 'Newcomer', faction: 0 })
    .map((o) => o.msg).find((m) => m.t === 'welcome');
  if (!welcome || welcome.t !== 'welcome') throw new Error('no welcome message');
  check('a player logging in is never told about an arena column',
    !welcome.edits.some(([k]) => k === arenaKey));
  check('a player logging in still receives the open world',
    welcome.edits.some(([k]) => k === '40,70,41'));

  // The live map keeps the arena block — the in-match reset sweeps it by
  // footprint — so stripping it must be a view, not a deletion.
  check('the arena block is still live for the match it belongs to',
    s.edits.get(arenaKey) === Block.OakPlanks);
}

{
  // A world written by an older build sheds its arena blocks on the way in,
  // so the leak heals itself rather than needing the save file hand-edited.
  const s = new GameServer(99, token);
  const loaded = s.restore({
    v: 3, seed: 99, worldTime: 10,
    edits: [
      [`${ARENA_BAND_MIN_X + 4},101,7`, Block.OakPlanks],
      ['65606,141,49', Block.OakPlanks],
      ['12,70,12', Block.OakPlanks],
    ],
  });
  check('a legacy save still loads', loaded);
  check('its arena columns are dropped on load',
    ![...s.edits.keys()].some((k) => isArenaEditKey(k)));
  check('its open-world columns survive load', s.edits.get('12,70,12') === Block.OakPlanks);
}

console.log(`Minigame isolation smoke: ${passed} checks passed`);
