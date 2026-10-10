import assert from 'node:assert/strict';
import { Block } from '../src/blocks';
import { Item } from '../src/items';
import { bwMap } from '../src/bedwars_map';
import { bwAdd, bwCount, bwKit } from '../src/bedwars_inventory';
import { BwPurchaseRequests } from '../src/bedwars_requests';
import { BwPredictions, bwCellText } from '../src/bedwars_prediction';
import { BwTestHost } from './bedwars';

export function runBedwarsCleanupTests(): void {
  let passed = 0;
  const test = (name: string, fn: () => void): void => { fn(); passed++; console.log(`  ✓ ${name}`); };
  const p = { x: -54, y: 97, z: 5 };
  const fixture = (count = 2, item: number = Block.TeamWoolA, previous: number = Block.Air) => {
    const slots = bwKit(); slots[2] = { id: item, count };
    const blocks = new Map<string, number>([[bwCellText(p.x, p.y, p.z), previous]]), placed = new Set<string>();
    const ledger = new BwPredictions({ slots, placed,
      getBlock: (x, y, z) => blocks.get(bwCellText(x, y, z)) ?? Block.Air,
      setBlock: (x, y, z, block) => { blocks.set(bwCellText(x, y, z), block); }, changed: () => {} });
    const block = () => blocks.get(bwCellText(p.x, p.y, p.z));
    return { slots, blocks, placed, ledger, block };
  };

  test('purchase identities survive reset, reconnect, reload and clock rollback', () => {
    const saved = new Map<string, string>();
    const store = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    const h = new BwTestHost(); h.start(); h.at(1, bwMap(0).bases[0].shop); h.give(1, 'iron', 20);
    const before = new BwPurchaseRequests(() => store, () => 1000), request = before.next();
    assert(h.buy(1, 'wool', request)); assert.equal(h.have(1, 'iron'), 16);
    h.match.disconnect(1); h.tick(5.1); h.match.reconnect(1); h.tick(.1);
    h.at(1, bwMap(0).bases[0].shop); h.give(1, 'iron', 20);
    const reloaded = new BwPurchaseRequests(() => store, () => 900), next = reloaded.next();
    assert(next > request); assert(h.buy(1, 'wool', next));
    assert.equal(h.have(1, 'iron'), 16); assert.equal(bwCount(h.match.players.get(1)!.slots, Block.TeamWoolA), 16);
    assert(h.buy(1, 'wool', request)); assert(h.buy(1, 'wool', next));
    assert.equal(h.have(1, 'iron'), 16, 'both pre-resume and new requests replay without payment');
    assert.equal(bwCount(h.match.players.get(1)!.slots, Block.TeamWoolA), 16, 'replay cannot restore wool lost on disconnect');
  });

  test('storage-disabled purchases use fresh numeric secure-source identities', () => {
    let random = 77;
    const first = new BwPurchaseRequests(() => { throw new Error('disabled'); }, () => 1000, () => random++);
    const second = new BwPurchaseRequests(() => null, () => 1000, () => random++);
    assert.equal(first.next(), 77); assert.equal(second.next(), 78); assert.equal(first.next(), 79);
  });

  test('send failure restores the requested slot and replaceable cell, with distinct item/block IDs', () => {
    const f = fixture(1, Item.BridgeBow, Block.Dandelion);
    const sequence = f.ledger.begin(p, Block.TeamWoolA, Item.BridgeBow, 2, 0)!;
    assert.equal(f.slots[2], null); assert.equal(f.slots[0]?.id, Item.WoodSword);
    f.ledger.nack(p, sequence);
    assert.deepEqual(f.slots[2], { id: Item.BridgeBow, count: 1 });
    assert.equal(f.block(), Block.Dandelion); assert.equal(f.placed.size, 0);
    f.ledger.nack(p, sequence); assert.deepEqual(f.slots[2], { id: Item.BridgeBow, count: 1 }, 'duplicate refusal never refunds twice');
  });

  test('expiry rolls back once and quarantines the cell until a late definitive echo', () => {
    const f = fixture(); f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 0);
    f.ledger.expire(2501, 2500); f.ledger.expire(5000, 2500);
    assert.equal(f.block(), Block.Air); assert.equal(f.slots[2]?.count, 2);
    assert.equal(f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 5001), null);
    f.blocks.set(bwCellText(p.x, p.y, p.z), Block.TeamWoolA); f.placed.add(bwCellText(p.x, p.y, p.z)); f.ledger.echo(p);
    f.slots[2] = { id: Block.TeamWoolA, count: 1 }; f.ledger.kit(1);
    assert.equal(f.block(), Block.TeamWoolA); assert.equal(f.slots[2]?.count, 1); assert.equal(f.ledger.has(p), false);
  });

  test('echo then kit settles an edit and its debit independently', () => {
    const f = fixture(); f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 0); f.ledger.echo(p);
    f.ledger.nack(p, 1); assert.equal(f.block(), Block.TeamWoolA); assert.equal(f.slots[2]?.count, 1);
    f.slots[2] = { id: Block.TeamWoolA, count: 1 }; f.ledger.kit(1); f.ledger.expire(5000, 2500);
    assert.equal(f.slots[2]?.count, 1); assert.equal(f.block(), Block.TeamWoolA); assert.equal(f.ledger.has(p), false);
  });
  test('kit before echo or NACK never double-spends or double-refunds', () => {
    for (const accepted of [false, true]) {
      const f = fixture(); f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 0);
      f.slots[2] = { id: Block.TeamWoolA, count: accepted ? 1 : 2 }; f.ledger.kit(1);
      if (accepted) f.ledger.echo(p); else f.ledger.nack(p, 1);
      assert.equal(f.slots[2]?.count, accepted ? 1 : 2); assert.equal(f.block(), accepted ? Block.TeamWoolA : Block.Air);
    }
  });
  test('a stale kit reapplies only newer spends while preserving slot selection and identity', () => {
    const f = fixture(5), q = { ...p, x: p.x + 1 };
    f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 0);
    f.ledger.begin(q, Block.TeamWoolA, Block.TeamWoolA, 2, 60);
    f.slots[2] = { id: Block.TeamWoolA, count: 4 }; f.ledger.kit(1);
    assert.equal(f.slots[2]?.count, 3, 'kit includes first spend, only second reapplied');
    f.slots[2] = { id: Item.IronIngot, count: 8 }; f.ledger.kit(2); f.ledger.nack(q, 2);
    assert.deepEqual(f.slots[2], { id: Item.IronIngot, count: 8 }, 'replacement slot is never overwritten/refunded');
    assert.equal(f.slots[0]?.id, Item.WoodSword);
  });
  test('old NACK cannot roll back a newer placement and reload resumes the server watermark', () => {
    const f = fixture(); f.ledger.kit(40);
    const first = f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 0)!; assert.equal(first, 41);
    f.ledger.nack(p, first);
    const second = f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 60)!;
    f.ledger.nack(p, first); assert.equal(f.block(), Block.TeamWoolA); assert.equal(f.slots[2]?.count, 1);
    f.ledger.nack(p, second); assert.equal(f.slots[2]?.count, 2);
  });
  test('legacy kits and expiry retain authoritative inventory and external edits', () => {
    const f = fixture(); f.ledger.begin(p, Block.TeamWoolA, Block.TeamWoolA, 2, 0);
    f.slots[2] = { id: Item.IronIngot, count: 8 }; f.ledger.kit();
    f.blocks.set(bwCellText(p.x, p.y, p.z), Block.OakPlanks); f.ledger.expire(3000, 2500);
    assert.equal(f.block(), Block.OakPlanks); assert.deepEqual(f.slots[2], { id: Item.IronIngot, count: 8 });
  });
  test('authority emits processed-placement kits even for refusal and ignores replayed predictions', () => {
    const h = new BwTestHost(); h.start(); const player = h.match.players.get(1)!;
    bwAdd(player.slots, Block.TeamWoolA, 2); const slot = player.slots.findIndex(s => s?.id === Block.TeamWoolA);
    h.at(1, { x: -55.5, y: 97, z: 5.5 });
    h.action(1, { kind: 'place', ...p, slot, prediction: 1 }); h.tick(.05);
    assert.equal(h.got(1, 'bwKit').at(-1).placement, 1); assert.equal(bwCount(player.slots, Block.TeamWoolA), 1);
    h.action(1, { kind: 'place', ...p, x: p.x + 1, slot, prediction: 1 });
    assert.equal(h.getBlock(p.x + 1, p.y, p.z), Block.Air, 'replay cannot place a second cell');
    h.action(1, { kind: 'place', ...p, x: -56, slot, prediction: 2 }); h.tick(.05);
    assert.equal(h.got(1, 'bwNack').at(-1).prediction, 2); assert.equal(h.got(1, 'bwKit').at(-1).placement, 2);
    assert.equal(bwCount(player.slots, Block.TeamWoolA), 1);
  });
  test('purchase replay cannot execute again after its cached reply is retired', () => {
    const h = new BwTestHost(); h.start(); h.at(1, bwMap(0).bases[0].shop); h.give(1, 'iron', 20);
    assert(h.buy(1, 'wool', 1));
    for (let request = 2; request <= 130; request++) { h.tick(.05); h.action(1, { kind: 'buy', sku: 'unknown', request }); }
    assert.equal(h.match.players.get(1)!.requests.size, 128);
    h.buy(1, 'wool', 1); assert.equal(h.have(1, 'iron'), 16);
    assert.equal(bwCount(h.match.players.get(1)!.slots, Block.TeamWoolA), 16);
    assert.match(h.got(1, 'bwBuyResult').at(-1).message, /already processed/);
  });
  test('forge pickup copies teammates but source-less death drops do not duplicate', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: false }, { id: 3, team: 0, bot: false }]); h.start();
    const forge = bwMap(0).bases[0].forge; h.at(1, forge); h.at(3, forge); h.tick(1.5);
    assert(h.have(1, 'iron') > 0); assert.equal(h.have(1, 'iron'), h.have(3, 'iron'));
    h.give(2, 'gold', 9); h.at(2, forge); h.setHealth(2, 0, true); h.tick(.8);
    assert.equal(h.have(1, 'gold') + h.have(3, 'gold'), 9, 'death drops have no forge source and cannot be copied');
  });
  test('swords reset to wood while independent tools and armor persist after death', () => {
    const h = new BwTestHost(); h.start(); h.at(1, bwMap(0).bases[0].shop); h.give(1, 'iron', 60);
    assert(h.buy(1, 'stone_sword', 1)); assert(h.buy(1, 'tools', 2)); assert(h.buy(1, 'chain_armor', 3));
    h.at(1, { x: 0, y: 39, z: 0 }); h.tick(5.2); const player = h.match.players.get(1)!;
    assert.equal(player.sword, 0); assert.equal(player.slots[0]?.id, Item.WoodSword);
    assert.equal(player.tools.pickaxe, 1); assert.equal(player.armor, 1);
  });
  console.log(`Bedwars cleanup: ${passed} tests passed.`);
}
