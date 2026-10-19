// Standalone: bundle with esbuild, then call runBedwarsTests() from Node.
import { BedwarsMatch, type BwBody, type BwHost, type BwSetup } from '../src/bedwars';
import { BW, BW_RESOURCE_ITEM, type BwAction, type BwPos } from '../src/bedwars_rules';
import { bwMap } from '../src/bedwars_map';
const MAP = bwMap(0), BW_BASES = MAP.bases;
import { Block, isSolid } from '../src/blocks';
import { Item } from '../src/items';
import { bwCatalog } from '../src/bedwars_catalog';
import { bwAdd, bwCount, bwGive, bwHas } from '../src/bedwars_inventory';
import { bwKey } from '../src/bedwars_nav';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Bedwars: ${message}`); }
export class BwTestHost implements BwHost {
  now = 0;
  bodies = new Map<number, BwBody>();
  edits = new Map<number, number>();
  impulses: { id: number; kx: number; ky: number; kz: number; by: number }[] = [];
  messages: { id: number | null; msg: any }[] = [];
  match: BedwarsMatch;
  mapId = 0;
  constructor(players: BwSetup['players'] = [{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: false }], map = 0, teams = Math.max(2, ...players.map((p) => p.team + 1))) {
    for (const p of players) this.bodies.set(p.id, { x: 0, y: 97, z: 0, yaw: 0, pitch: 0, health: 20, dead: false });
    this.mapId = map;
    this.match = new BedwarsMatch(this, { players, world: 42, map, teams });
  }
  nowMs(): number { return this.now; }
  body(id: number): BwBody | undefined { return this.bodies.get(id); }
  name(id: number): string { return `Player ${id}`; }
  send(id: number, msg: any): void { this.messages.push({ id, msg }); }
  broadcast(msg: any): void { this.messages.push({ id: null, msg }); }
  teleport(id: number, x: number, y: number, z: number, yaw?: number, health?: number): void {
    const b = this.bodies.get(id)!; Object.assign(b, { x, y, z });
    if (yaw !== undefined) b.yaw = yaw;
    if (health !== undefined) { b.health = health; b.dead = health <= 0; }
  }
  setHealth(id: number, health: number, dead: boolean): void { Object.assign(this.bodies.get(id)!, { health, dead }); }
  impulse(id: number, kx: number, ky: number, kz: number, by: number, _health: number): void { this.impulses.push({ id, kx, ky, kz, by }); }
  setBlock(x: number, y: number, z: number, block: number): void { this.edits.set(bwKey(x, y, z), block); }
  getBlock(x: number, y: number, z: number): number { return this.edits.get(bwKey(x, y, z)) ?? bwMap(this.mapId).blockAt(x, y, z); }
  drive(id: number, pose: { x: number; y: number; z: number; yaw: number; pitch: number; held?: number; swing?: boolean }): void { Object.assign(this.bodies.get(id)!, pose); }
  at(id: number, p: BwPos): void { this.teleport(id, p.x, p.y, p.z); }
  aim(id: number, target: number): void {
    const a = this.body(id)!, b = this.body(target)!;
    a.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    a.pitch = Math.atan2(b.y + 1 - a.y - 1.62, Math.hypot(b.x - a.x, b.z - a.z));
  }
  tick(seconds: number): void { for (let t = 0; t < seconds - 1e-8; t += 0.05) { this.now += 50; this.match.tick(0.05); if (this.messages.length > 1000) this.messages.splice(0, 500); } }
  start(): void { for (const id of this.match.players.keys()) this.match.ready(id); this.tick(BW.COUNTDOWN + 0.1); }
  action(id: number, action: BwAction): void { this.match.handle(id, action); }
  buy(id: number, sku: string, request = this.messages.length + 1): boolean {
    this.action(id, { kind: 'buy', sku, request });
    return this.messages.some((m) => m.id === id && m.msg.t === 'bwBuyResult' && m.msg.request === request && m.msg.ok);
  }
  /** Everything the server sent to one player of a given message type. */
  got(id: number, t: string): any[] { return this.messages.filter((m) => (m.id === id || m.id === null) && m.msg.t === t).map((m) => m.msg); }
  give(id: number, resource: 'iron' | 'gold' | 'diamond' | 'emerald', n: number): void { bwAdd(this.match.players.get(id)!.slots, BW_RESOURCE_ITEM[resource], n); }
  have(id: number, resource: 'iron' | 'gold' | 'diamond' | 'emerald'): number { return bwCount(this.match.players.get(id)!.slots, BW_RESOURCE_ITEM[resource]); }
  mine(id: number, at: BwPos, seconds: number, slot = 0): void {
    for (let t = 0; t < seconds; t += 0.1) { this.action(id, { kind: 'break', ...at, slot }); this.tick(0.1); }
  }
}

export function runBedwarsTests(): void {
  let passed = 0;
  const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ✓ ${name}`); };
  const wool = (h: BwTestHost, id: number) => { const p = h.match.players.get(id)!; bwGive(p.slots, bwCatalog('wool')!, p.team); return p.slots.findIndex((s) => s && s.id === (p.team === 0 ? Block.TeamWoolA : Block.TeamWoolB)); };
  test('ready barrier, countdown, finite ticks and immutable snapshots', () => {
    const h = new BwTestHost(), m = h.match;
    m.ready(1); h.tick(1); assert(m.phase === 'loading', 'all players must ready');
    m.tick(NaN); m.tick(Infinity); assert(m.time === 0, 'nonfinite dt must not advance');
    m.ready(2); assert(!m.canMove(1), 'no moving during countdown'); h.tick(5.1);
    assert(m.canMove(1), 'playing allows movement');
    const s = m.snapshot(); s.teams[0].upgrades.forge = 99; s.teams[0].chest.gold = 500;
    assert(m.teams[0].upgrades.forge === 0 && m.teams[0].chest.gold === 0, 'snapshot cannot mutate game state');
    assert(m.players.get(1)!.slots[0]?.id === Item.WoodSword, 'registered starter sword');
  });
  test('generators drop real items that fall, rest, and vanish into the hotbar when picked up', () => {
    const h = new BwTestHost(); h.start(); const g = BW_BASES[0].forge;
    h.at(1, { x: g.x + 8, y: 97, z: g.z + 6 }); h.at(2, { x: -90, y: 97, z: 60 });
    h.tick(1.1);
    const first = h.match.dropsSnapshot()[0];
    assert(first && first.item === Item.IronIngot, 'iron spawns as a world item');
    h.tick(0.05); const later = h.match.dropsSnapshot().find((d) => d.id === first.id)!;
    h.tick(2);
    const rested = h.match.dropsSnapshot().find((d) => d.id === first.id)!;
    assert(later.y < first.y + 0.5 && Math.abs(rested.y - 97) < 0.05, `drop falls under gravity onto the platform (y=${rested.y})`);
    assert(h.have(1, 'iron') === 0, 'nothing is collected from afar');
    h.at(1, g); h.tick(1);
    assert(h.have(1, 'iron') >= 2, `standing at the forge puts iron in the hotbar, has ${h.have(1, 'iron')}`);
    const gone = h.messages.filter((m) => m.msg.t === 'bwDrop' && m.msg.gone?.some((x: any) => x.by === 1));
    assert(gone.length > 0, 'pickups tell clients which player took the item, so the entity is removed');
    assert(h.match.dropsSnapshot().every((d) => d.id !== first.id), 'picked-up drop no longer exists');
    assert(!('wallet' in h.match.players.get(1)!), 'there is no separate wallet any more');
  });
  test('generator piles are capped and stack into one pile', () => {
    const h = new BwTestHost(); h.start(); h.at(1, { x: -90, y: 97, z: 60 }); h.at(2, { x: 90, y: 97, z: -60 });
    h.tick(100);
    const iron = h.match.dropsSnapshot().filter((d) => d.item === Item.IronIngot);
    const total = iron.reduce((n, d) => n + d.count, 0);
    assert(total <= 96, `two forges cannot exceed their caps, total ${total}`);
    assert(iron.length <= 6, `resting iron merges into a few stacks (${iron.length})`);
  });
  test('a full hotbar leaves the drop on the ground', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!, g = BW_BASES[0].forge;
    for (let i = 1; i < 9; i++) p.slots[i] = { id: Block.OakPlanks, count: 64 };
    h.at(1, g); h.tick(3);
    assert(h.have(1, 'iron') === 0 && h.match.dropsSnapshot().some((d) => d.item === Item.IronIngot), 'refused pickup stays in the world');
    p.slots[1] = null; h.tick(1);
    assert(h.have(1, 'iron') > 0, 'freeing a slot lets it be collected');
  });
  test('purchase range, replay handling and atomic inventory', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.give(1, 'iron', 20);
    assert(!h.buy(1, 'wool', 1), 'remote shop rejected'); assert(h.have(1, 'iron') === 20, 'rejected buy never charges');
    h.at(1, BW_BASES[0].shop); assert(h.buy(1, 'wool', 2), 'shop works at map marker');
    assert(h.have(1, 'iron') === 16, 'wool costs four iron');
    h.buy(1, 'wool', 2); assert(h.have(1, 'iron') === 16, 'replayed request grants once');
    h.action(1, { kind: 'buy', sku: 'stone_sword', request: 2 });
    const conflict = h.messages[h.messages.length - 1].msg;
    assert(conflict.t === 'bwBuyResult' && !conflict.ok && conflict.message.includes('different item'), 'request ID collision rejects different SKU descriptively');
    assert(h.have(1, 'iron') === 16 && p.sword === 0, 'conflicting request does not grant or charge');
    assert(bwCount(p.slots, Block.TeamWoolA) === 16, 'bought correct quantity');
    h.give(1, 'iron', 80);
    for (let i = 1; i < p.slots.length; i++) if (!p.slots[i] || p.slots[i]!.id === Block.TeamWoolA) p.slots[i] = i === 1 ? { id: Block.TeamWoolA, count: 64 } : { id: Block.OakPlanks, count: 64 };
    const have = h.have(1, 'iron');
    assert(!h.buy(1, 'wool', 3) && h.have(1, 'iron') === have, 'full hotbar purchase is atomic');
  });
  test('paying can free the slot the purchase needs', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    for (let i = 1; i < 9; i++) p.slots[i] = { id: Block.OakPlanks, count: 64 };
    p.slots[1] = { id: Item.IronIngot, count: 4 };
    h.at(1, BW_BASES[0].shop); assert(h.buy(1, 'wool', 1), 'the iron stack vacates a slot for the wool');
    assert(bwCount(p.slots, Block.TeamWoolA) === 16 && h.have(1, 'iron') === 0, 'wool in, iron out');
  });
  test('team chest and diamond upgrades are scoped, priced and persistent', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: false }, { id: 3, team: 0, bot: false }]); h.start();
    h.give(1, 'gold', 12);
    h.at(1, BW_BASES[0].chest); h.action(1, { kind: 'bank', resource: 'gold', amount: 12, direction: 'deposit' });
    assert(h.have(1, 'gold') === 0 && h.match.teams[0].chest.gold === 12, 'deposit conserves money');
    h.at(2, BW_BASES[0].chest); h.action(2, { kind: 'bank', resource: 'gold', amount: 12, direction: 'withdraw' });
    assert(h.match.teams[0].chest.gold === 12 && h.have(2, 'gold') === 0, 'enemy cannot raid chest');
    h.at(3, BW_BASES[0].chest); h.action(3, { kind: 'bank', resource: 'gold', amount: 5, direction: 'withdraw' });
    assert(h.have(3, 'gold') === 5 && h.match.snapshot().teams[0].chest.gold === 7, 'teammate can withdraw');
    h.action(3, { kind: 'bank', resource: 'gold', amount: -5, direction: 'deposit' }); assert(h.have(3, 'gold') === 5, 'negative bank action rejected');
    h.give(1, 'diamond', 6); h.at(1, BW_BASES[0].upgrades);
    assert(h.buy(1, 'protection', 10) && h.buy(1, 'protection', 11), 'upgrade escalating cost 2 then 4');
    assert(h.have(1, 'diamond') === 0 && h.match.teams[0].upgrades.protection === 2, 'team upgrade state');
    h.at(1, { x: 0, y: 39, z: 0 }); h.tick(0.1); assert(h.match.snapshot().teams[0].chest.gold === 7, 'chest persists across death');
  });
  test('placement consumes stock, protects terrain, rejects occlusion and body overlap, and says no', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.at(1, { x: -55.5, y: 97, z: 5.5 }); const slot = wool(h, 1), at = { x: -54, y: 97, z: 5 };
    assert(h.getBlock(at.x, at.y, at.z) === 0, 'fixture air');
    h.action(1, { kind: 'place', ...at, slot }); assert(h.getBlock(at.x, at.y, at.z) === Block.TeamWoolA, 'valid supported placement');
    assert(p.slots[slot]?.count === 15, 'block consumed once');
    h.tick(0.2); h.action(1, { kind: 'place', x: -56, y: 97, z: 5, slot }); assert(p.slots[slot]?.count === 15, 'cannot place inside player');
    assert(h.got(1, 'bwNack').some((n) => n.x === -56 && n.z === 5), 'a refused placement is reported so the client can take the block back');
    h.mine(1, { x: -55, y: 96, z: 5 }, 2); assert(isSolid(h.getBlock(-55, 96, 5)), 'natural terrain immutable');
    const count = p.slots[slot]!.count;
    h.action(1, { kind: 'place', x: NaN, y: 97, z: 5, slot });
    h.action(1, { kind: 'place', x: 100000, y: 97, z: 5, slot }); assert(p.slots[slot]!.count === count, 'invalid coordinates rejected');
  });
  test('bridging at the client rate is accepted block after block', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    let edge = -76; for (let x = -76; x < -40; x++) if (isSolid(h.getBlock(x, 96, 5))) edge = x;
    const slot = wool(h, 1);
    let placed = 0;
    for (let i = 0; i < 12; i++) {
      h.at(1, { x: edge + 0.5 + i, y: 97, z: 5.5 }); // standing on the block placed last, as a bridger does
      h.action(1, { kind: 'place', x: edge + 1 + i, y: 96, z: 5, slot });
      if (h.getBlock(edge + 1 + i, 96, 5) === Block.TeamWoolA) placed++;
      h.tick(BW.PLACE_REPEAT_MS / 1000);
    }
    assert(placed === 12, `${placed}/12 placements at ${BW.PLACE_REPEAT_MS} ms spacing were accepted`);
    assert(p.slots[slot]?.count === 4, 'stack reduced by the placements');
  });
  test('bed breaks require sustained server time, heartbeat, enemy ownership and LOS', () => {
    const h = new BwTestHost(); h.start(); const bed = BW_BASES[1].bed;
    h.at(1, { x: bed.x - 2, y: 97, z: bed.z + 0.5 });
    for (let i = 0; i < 40; i++) h.action(1, { kind: 'break', ...bed, slot: 0 });
    assert(h.match.teams[1].bed, 'packet burst does not accelerate mining');
    h.tick(0.6); assert(!h.match.snapshot().breaks.length, 'missing heartbeat cancels mining');
    h.mine(1, bed, 0.5); assert(h.match.teams[1].bed, 'partial mining cannot destroy bed');
    h.action(1, { kind: 'stopBreak' }); h.mine(1, bed, 0.5); assert(h.match.teams[1].bed, 'stop resets progress');
    h.mine(1, bed, 0.5); assert(!h.match.teams[1].bed && h.match.players.get(1)!.beds === 1, 'sustained mining destroys bed');
    assert(h.getBlock(bed.x, bed.y, bed.z) === 0 && h.getBlock(BW_BASES[1].bedFoot.x, bed.y, BW_BASES[1].bedFoot.z) === 0, 'both bed cells removed');
    h.at(1, { x: BW_BASES[0].bed.x - 2, y: 97, z: -0.5 }); h.mine(1, BW_BASES[0].bed, 2);
    assert(h.match.teams[0].bed, 'own bed protected');
    const h2 = new BwTestHost(); h2.start(); h2.at(1, { x: bed.x - 2, y: 97, z: bed.z + 0.5 });
    for (const y of [97, 98, 99]) h2.setBlock(bed.x - 1, y, bed.z, Block.OakPlanks);
    h2.mine(1, bed, 2); assert(h2.match.teams[1].bed, 'cannot mine bed through defense');
  });
  test('the mining snapshot carries its duration so clients can animate the crack', () => {
    const h = new BwTestHost(); h.start(); const bed = BW_BASES[1].bed;
    h.at(1, { x: bed.x - 2, y: 97, z: bed.z + 0.5 }); h.action(1, { kind: 'break', ...bed, slot: 0 }); h.tick(0.1);
    const b = h.match.snapshot().breaks[0];
    assert(b && b.id === 1 && b.duration > 0.5 && b.progress > 0 && b.progress < 1, `break view ${JSON.stringify(b)}`);
  });
  test('a broken block goes into the breaker\'s hotbar and is shown flying to them', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.at(1, { x: -55.5, y: 97, z: 5.5 }); const slot = wool(h, 1), at = { x: -54, y: 97, z: 5 };
    h.action(1, { kind: 'place', ...at, slot }); assert(p.slots[slot]!.count === 15, 'placed');
    h.tick(0.2); h.messages.length = 0; h.mine(1, at, 1.5, 0);
    assert(h.getBlock(at.x, at.y, at.z) === Block.Air, 'block broken');
    assert(bwCount(p.slots, Block.TeamWoolA) === 16, `the block is back in the hotbar (${bwCount(p.slots, Block.TeamWoolA)})`);
    const pop = h.messages.find((m) => m.msg.t === 'bwDrop' && m.msg.add?.some((d: any) => d.item === Block.TeamWoolA) && m.msg.gone?.some((g: any) => g.by === 1));
    assert(pop, 'clients are told an item popped out and went to the breaker, so they can animate it');
    assert(!h.match.dropsSnapshot().some((d) => d.item === Block.TeamWoolA), 'it never exists on the ground');
  });
  test('a broken block with no hotbar room stays in the world', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.at(1, { x: -55.5, y: 97, z: 5.5 }); const slot = wool(h, 1), at = { x: -54, y: 97, z: 5 };
    h.action(1, { kind: 'place', ...at, slot }); h.tick(0.2);
    for (let i = 1; i < 9; i++) if (!p.slots[i] || i !== slot) p.slots[i] = { id: Block.OakPlanks, count: 64 };
    p.slots[slot] = null; for (let i = 1; i < 9; i++) p.slots[i] = { id: Block.OakPlanks, count: 64 };
    h.mine(1, at, 1.5, 0);
    assert(h.match.dropsSnapshot().some((d) => d.item === Block.TeamWoolA), 'with a full hotbar the block lies on the ground');
  });
  test('breaking enemy wool gives the breaker their own colour', () => {
    const h = new BwTestHost(); h.start(); h.at(1, { x: -55.5, y: 97, z: 5.5 });
    const at = { x: -54, y: 97, z: 5 };
    h.setBlock(at.x, at.y, at.z, Block.TeamWoolB); h.match.placed.set(bwKey(at.x, at.y, at.z), { ...at, block: Block.TeamWoolB });
    h.mine(1, at, 1.5, 0); h.tick(1.5);
    assert(bwCount(h.match.players.get(1)!.slots, Block.TeamWoolA) === 1 && bwCount(h.match.players.get(1)!.slots, Block.TeamWoolB) === 0, 'wool is converted to the breaker team colour');
  });
  test('death hands carried resources to the killer, keeps tools/armor, respawns then final-eliminates', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.give(1, 'iron', 40); h.at(1, BW_BASES[0].shop);
    assert(h.buy(1, 'tools', 1) && h.buy(1, 'chain_armor', 2), 'persistent equipment purchases');
    h.give(1, 'gold', 9); h.at(1, { x: 0, y: 39, z: 0 }); h.tick(0.1);
    assert(!p.alive && !p.eliminated && h.have(1, 'gold') === 0 && !h.match.canMove(1), 'bed death enters respawn state');
    assert(h.match.dropsSnapshot().every((d) => d.item !== Item.GoldIngot), 'void deaths lose their resources');
    h.tick(BW.RESPAWN + 0.1); assert(p.alive && p.health === 20 && p.tools.pickaxe === 1 && p.armor === 1 && bwHas(p.slots, 'tools'), 'persistent gear restored');
    const bed = BW_BASES[0].bed; h.at(2, { x: bed.x + 2, y: 97, z: bed.z + 0.5 }); h.mine(2, bed, 1);
    h.at(1, { x: 0, y: 39, z: 0 }); h.tick(0.1);
    assert(p.eliminated && h.match.isOver() && h.match.result?.winner === 1, 'final kill awards opposing team');
    const time = h.match.time; h.tick(10); assert(h.match.time === time, 'results freeze simulation');
  });
  test('melee checks reach, walls, rate and invulnerability, and confirms hits to the attacker', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1);
    h.at(1, { x: -60, y: 97, z: 4 }); h.at(2, { x: -57.5, y: 97, z: 4 });
    h.aim(1, 2);
    const p = h.match.players.get(1)!, q = h.match.players.get(2)!;
    h.give(2, 'gold', 7);
    h.action(1, { kind: 'melee', target: 2, slot: 0 }); const health = q.health;
    assert(health === 16, `wooden sword deals 4, health ${health}`);
    for (let i = 0; i < 10; i++) h.action(1, { kind: 'melee', target: 2, slot: 0 }); assert(q.health === health, 'repeat swings in the same instant do nothing');
    const confirm = h.got(1, 'hitconfirm');
    assert(confirm.length === 1 && confirm[0].target === 2 && confirm[0].amount === 4 && confirm[0].killed === false, `attacker gets exactly one confirmation ${JSON.stringify(confirm)}`);
    h.tick(0.2); h.action(1, { kind: 'melee', target: 2, slot: 0 }); assert(q.health === health, 'a hit inside the invulnerability window does nothing');
    h.tick(0.3); h.setBlock(-59, 98, 4, Block.OakPlanks); h.action(1, { kind: 'melee', target: 2, slot: 0 }); assert(q.health === health, 'wall blocks melee');
    h.setBlock(-59, 98, 4, Block.Air);
    for (let i = 0; i < 4; i++) { h.tick(0.5); h.action(1, { kind: 'melee', target: 2, slot: 0 }); }
    assert(!q.alive && p.kills === 1 && h.have(2, 'gold') === 0, 'victim lost the gold');
    assert(h.have(1, 'gold') === 7, 'the killer received the victim\'s resources directly');
    assert(h.got(1, 'hitconfirm').some((c) => c.killed), 'the killing blow is confirmed as a kill');
  });
  test('a killer with a full hotbar leaves the rest on the ground', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1);
    h.at(1, { x: -60, y: 97, z: 4 }); h.at(2, { x: -57.5, y: 97, z: 4 }); h.aim(1, 2);
    const p = h.match.players.get(1)!, q = h.match.players.get(2)!;
    for (let i = 1; i < 9; i++) p.slots[i] = { id: Block.OakPlanks, count: 64 };
    h.give(2, 'gold', 5); q.health = 1; h.setHealth(2, 1, false);
    h.action(1, { kind: 'melee', target: 2, slot: 0 });
    assert(!q.alive && h.match.dropsSnapshot().some((d) => d.item === Item.GoldIngot && d.count === 5), 'resources that do not fit drop where the victim fell');
  });
  test('melee is judged against where the target was a moment ago (lag compensation)', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1);
    h.at(1, { x: -60, y: 97, z: 4 }); h.at(2, { x: -57.5, y: 97, z: 4 }); h.tick(0.4);
    h.at(2, { x: -54, y: 97, z: 4 });
    const a = h.body(1)!; a.yaw = Math.atan2(-(-57.5 + 60), 0); a.pitch = 0;
    h.action(1, { kind: 'melee', target: 2, slot: 0 });
    assert(h.match.players.get(2)!.health === 16, 'the swing lands on the position the attacker saw');
    const h2 = new BwTestHost(); h2.start(); h2.tick(2.1);
    h2.at(1, { x: -60, y: 97, z: 4 }); h2.at(2, { x: -57.5, y: 97, z: 4 }); h2.tick(1);
    h2.at(2, { x: -54, y: 97, z: 4 }); h2.tick(0.5);
    const b = h2.body(1)!; b.yaw = Math.atan2(-(-57.5 + 60), 0); b.pitch = 0;
    h2.action(1, { kind: 'melee', target: 2, slot: 0 });
    assert(h2.match.players.get(2)!.health === 20, 'old positions beyond the rewind window do not count');
  });
  test('knockback pushes away from the attacker and sprinting hits harder', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1);
    h.at(1, { x: -60, y: 97, z: 4 }); h.at(2, { x: -57.5, y: 97, z: 4 }); h.aim(1, 2);
    h.action(1, { kind: 'melee', target: 2, slot: 0 });
    const idle = h.impulses[h.impulses.length - 1];
    assert(idle.id === 2 && idle.kx > 3 && Math.abs(idle.kz) < 1.5 && idle.ky > 3, `knocked back along +x and up ${JSON.stringify(idle)}`);
    // The attacker covers ground at sprint speed in the last third of a second.
    const h2 = new BwTestHost(); h2.start(); h2.tick(2.1);
    h2.at(2, { x: -57.5, y: 97, z: 4 });
    for (let i = 0; i < 8; i++) { h2.at(1, { x: -62 + i * 0.28, y: 97, z: 4 }); h2.tick(0.05); }
    h2.aim(1, 2); h2.action(1, { kind: 'melee', target: 2, slot: 0 });
    const sprint = h2.impulses[h2.impulses.length - 1];
    assert(sprint && Math.hypot(sprint.kx, sprint.kz) > Math.hypot(idle.kx, idle.kz) + 1.5, 'a sprinting hit knocks back further');
  });
  test('bow consumes authoritative ammunition and simulates projectile hits', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1); const p = h.match.players.get(1)!, q = h.match.players.get(2)!;
    bwGive(p.slots, bwCatalog('bow')!, 0); bwGive(p.slots, bwCatalog('arrows')!, 0);
    h.at(1, { x: -61.5, y: 97, z: 4.5 }); h.at(2, { x: -55.5, y: 97, z: 4.5 });
    const slot = p.slots.findIndex((s) => s?.id === Item.BridgeBow);
    h.action(1, { kind: 'shoot', slot, dx: 1, dy: 0, dz: 0, power: 1 }); h.tick(0.3);
    assert(bwCount(p.slots, Item.BridgeArrow) === 7, 'one arrow consumed'); assert(q.health < 20, 'arrow hit simulated on server');
    assert(h.got(1, 'hitconfirm').length === 1, 'the archer is told about the hit');
    h.action(1, { kind: 'shoot', slot, dx: 1, dy: 0, dz: 0, power: 999 }); assert(bwCount(p.slots, Item.BridgeArrow) === 7, 'invalid charge rejected');
  });
  test('projectiles stream on their own message while in flight', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1); const p = h.match.players.get(1)!;
    bwGive(p.slots, bwCatalog('bow')!, 0); bwGive(p.slots, bwCatalog('arrows')!, 0);
    // z 2.5 is a clear lane: at full draw the arrow reaches z 4.5's lamp post in 0.15 s.
    h.at(1, { x: -61.5, y: 97, z: 2.5 }); h.at(2, { x: 80, y: 97, z: -50 });
    const slot = p.slots.findIndex((s) => s?.id === Item.BridgeBow);
    h.action(1, { kind: 'shoot', slot, dx: 1, dy: 0.1, dz: 0, power: 1 }); h.tick(0.3);
    const frames = h.got(1, 'bwProj').filter((m) => m.p.length > 0);
    assert(frames.length >= 5, `an arrow in flight is sent every step (${frames.length} frames in 0.3 s)`);
    assert(!('projectiles' in h.match.snapshot()), 'projectiles are not duplicated in the snapshot');
  });
  test('friendly fire is rejected and bots can be knocked off a bridge into the void', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: true }, { id: 3, team: 0, bot: false }]); h.start(); h.tick(2.1);
    for (const x of [35, 36, 37]) h.setBlock(x, 96, 0, Block.TeamWoolA);
    // The bot stands right at the bridge's end: one hit sends it over.
    h.at(1, { x: 35.9, y: 97, z: 0.5 }); h.at(2, { x: 35.1, y: 97, z: 0.5 }); h.at(3, { x: 37.5, y: 97, z: 0.5 }); h.tick(0.05);
    h.aim(1, 3); h.action(1, { kind: 'melee', target: 3, slot: 0 }); assert(h.match.players.get(3)!.health === 20, 'friendly melee ignored');
    h.aim(1, 2); h.action(1, { kind: 'melee', target: 2, slot: 0 }); h.tick(3.2);
    assert(h.match.players.get(2)!.deaths === 1 && h.match.players.get(1)!.kills === 1, `bot obeys knockback/gravity and void kill credit: ${JSON.stringify(h.body(2))}`);
  });
  test('melee requires physical yaw and pitch aim with modest target-width tolerance', () => {
    const h = new BwTestHost(); h.start(); h.tick(2.1);
    h.at(1, { x: -60, y: 97, z: 4 }); h.at(2, { x: -57.5, y: 97, z: 4 });
    const a = h.body(1)!, victim = h.match.players.get(2)!;
    a.yaw = 0; a.pitch = 0;
    h.action(1, { kind: 'melee', target: 2, slot: 0 }); assert(victim.health === 20, 'looking -Z cannot hit a victim at +X');
    h.tick(0.3);
    h.aim(1, 2); a.pitch = Math.PI / 2;
    h.action(1, { kind: 'melee', target: 2, slot: 0 }); assert(victim.health === 20, 'looking straight up cannot hit a same-level victim');
    h.tick(0.3);
    h.aim(1, 2); a.yaw += 0.2;
    h.action(1, { kind: 'melee', target: 2, slot: 0 }); assert(h.match.snapshot().players.find(p => p.id === 2)!.health === 16, 'small aim/interpolation discrepancy remains playable');
  });
  test('arrows pass through a slab empty upper half but collide with its solid lower half', () => {
    for (const [dy, expectedHealth] of [[0, 20 - 8 * 0.8], [-0.2, 20]]) {
      const h = new BwTestHost(); h.start(); h.tick(2.1);
      const p = h.match.players.get(1)!;
      bwGive(p.slots, bwCatalog('bow')!, 0); bwGive(p.slots, bwCatalog('arrows')!, 0);
      h.at(1, { x: -61.5, y: 97, z: 4.5 }); h.at(2, { x: -57.5, y: 97, z: 4.5 });
      h.setBlock(-60, 98, 4, Block.ManorMarbleSlab);
      const slot = p.slots.findIndex((s) => s?.id === Item.BridgeBow);
      h.action(1, { kind: 'shoot', slot, dx: 1, dy, dz: 0, power: 1 }); h.tick(0.3);
      assert(Math.abs(h.match.players.get(2)!.health - expectedHealth) < 1e-6, `slab geometry respected for ${dy === 0 ? 'upper air' : 'lower solid'} arrow trajectory`);
    }
  });
  test('untrusted payloads do not crash or grant inventory; disposal stops world changes', () => {
    const h = new BwTestHost(); h.start(); const before = JSON.stringify(h.match.players.get(1)!.slots);
    for (const action of [null, {}, { kind: 'buy', sku: {}, request: 1 }, { kind: 'bank', resource: '__proto__', amount: 1, direction: 'withdraw' }, { kind: 'use', slot: 0, dx: Infinity, dy: 0, dz: 0 }, { kind: 'place', slot: 900, x: 0, y: 97, z: 0 }, { kind: 'drop', slot: 0, all: true }, { kind: 'drop', slot: -1, all: true }] as unknown as BwAction[]) h.action(1, action);
    assert(JSON.stringify(h.match.players.get(1)!.slots) === before, 'malformed actions have no inventory effect');
    h.match.dispose(); const time = h.match.time; h.tick(10); assert(h.match.time === time && !h.match.canMove(1), 'dispose freezes match');
  });
  test('there is no drop action: Q is sprint, items only leave the hotbar on death or by spending', () => {
    const h = new BwTestHost(); h.start(); h.tick(0.1);
    h.give(1, 'gold', 10); const slot = h.match.players.get(1)!.slots.findIndex((s) => s?.id === Item.GoldIngot);
    h.action(1, { kind: 'drop', slot, all: false } as unknown as BwAction);
    assert(h.have(1, 'gold') === 10 && !h.match.dropsSnapshot().some((d) => d.item === Item.GoldIngot), 'a stale drop packet does nothing');
  });
  test('pickaxe, axe and shears persist independently and only effective tools accelerate mining', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.give(1, 'iron', 60); h.give(1, 'gold', 20); h.at(1, BW_BASES[0].shop);
    for (const [i, sku] of ['tools', 'wood_axe', 'shears', 'iron_tools', 'iron_axe'].entries()) assert(h.buy(1, sku, i), `buy ${sku}`);
    assert(p.tools.pickaxe === 2 && p.tools.axe === 2 && p.tools.shears === 3, 'independent persistent tiers');
    h.at(1, { x: -55.5, y: 97, z: 5.5 });
    const at = { x: -54, y: 97, z: 5 }, record = { ...at, block: Block.OakPlanks };
    h.setBlock(at.x, at.y, at.z, record.block); h.match.placed.set(bwKey(at.x, at.y, at.z), record);
    const pick = p.slots.findIndex((s) => s?.id === Item.IronPickaxe);
    h.mine(1, at, 0.6, pick); assert(h.getBlock(at.x, at.y, at.z) === Block.OakPlanks, 'pickaxe does not speed up wood');
    const axe = p.slots.findIndex((s) => s?.id === Item.IronAxe);
    h.mine(1, at, 0.7, axe); assert(h.getBlock(at.x, at.y, at.z) === Block.Air, 'effective axe cuts wood faster');
    h.at(1, { x: 0, y: 39, z: 0 }); h.tick(5.2);
    assert(bwHas(p.slots, 'iron_tools') && bwHas(p.slots, 'iron_axe') && bwHas(p.slots, 'shears'), 'all tool types survive death');
    const slot = p.slots.findIndex((s) => s?.id === Item.IronAxe);
    h.action(1, { kind: 'select', slot }); assert(h.body(1)!.held === Item.IronAxe, 'host held item follows authoritative selection');
  });
  test('a bed broken on the tick a respawn is due still lets that respawn happen', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    h.at(1, { x: 0, y: 39, z: 0 }); h.tick(0.1);
    const bed = BW_BASES[0].bed; h.at(2, { x: bed.x + 2, y: 97, z: bed.z + 0.5 });
    h.action(2, { kind: 'break', ...bed, slot: 0 });
    p.respawnAt = h.match.time + 0.85;
    h.mine(2, bed, 0.9);
    assert(!h.match.teams[0].bed, 'the bed is gone');
    h.tick(1); assert(p.alive && !p.eliminated && !h.match.isOver(), 'the pending respawn still happens once');
  });
  test('disconnect counts death, retains upgrades, pauses respawn and expires after grace', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    p.armor = 2; h.match.teams[0].upgrades.protection = 1;
    h.match.disconnect(1); h.match.disconnect(1);
    assert(!p.connected && !p.alive && p.deaths === 1 && !h.match.isOver(), 'disconnect is an idempotent death with grace');
    h.tick(10); assert(!p.alive && !h.match.isOver(), 'disconnected player does not automatically respawn');
    h.match.reconnect(1); h.tick(0.1);
    assert(p.connected && p.alive && p.armor === 2 && h.match.teams[0].upgrades.protection === 1, 'reconnect restores same persistent player');
    h.match.disconnect(1); h.tick(29.8); assert(!h.match.isOver(), 'full thirty second grace'); h.tick(0.3);
    assert(h.match.result?.winner === 1 && !h.match.players.has(1), 'expired disconnect forfeits');
  });
  test('reconnect replays the items on the ground', () => {
    const h = new BwTestHost(); h.start(); h.at(1, { x: -90, y: 97, z: 60 }); h.at(2, { x: 90, y: 97, z: -60 }); h.tick(5);
    h.messages.length = 0; h.match.ready(1);
    const reset = h.got(1, 'bwDrop').find((m) => m.reset);
    assert(reset && reset.add.length > 0, 'a (re)joining player gets every item on the ground');
  });
  test('reconnect never revives a final-eliminated player', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: false }, { id: 3, team: 0, bot: false }]); h.start();
    const bed = BW_BASES[0].bed; h.at(2, { x: bed.x + 2, y: 97, z: bed.z + 0.5 }); h.mine(2, bed, 1);
    h.match.disconnect(1); h.match.reconnect(1); h.tick(6);
    const p = h.match.players.get(1)!; assert(p.connected && p.eliminated && !p.alive && !h.match.canMove(1), 'final elimination remains spectator on reconnect');
    assert(!h.match.isOver(), 'living teammate keeps 2v1 team in game');
  });
  test('healing consumes once and restores exactly eight health over time', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    p.health = 5; h.setHealth(1, 5, false); bwGive(p.slots, bwCatalog('heal')!, 0);
    const slot = p.slots.findIndex((s) => s?.id === Item.HealingApple);
    h.action(1, { kind: 'use', slot, dx: 0, dy: 1, dz: 0 }); h.tick(4.1);
    assert(p.health === 13 && !bwHas(p.slots, 'heal'), `healing gain/consumption, health=${p.health}`);
  });
  test('TNT has a fuse, destroys placed defenses, preserves terrain, beds and blastproof glass', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    bwGive(p.slots, bwCatalog('tnt')!, 0);
    const bed = BW_BASES[0].bed;
    const block = { x: bed.x - 2, y: 97, z: bed.z + 1, block: Block.TeamWoolA };
    const glass = { x: bed.x - 2, y: 97, z: bed.z, block: Block.ManorGlass };
    for (const cell of [block, glass]) { h.setBlock(cell.x, cell.y, cell.z, cell.block); h.match.placed.set(bwKey(cell.x, cell.y, cell.z), cell); }
    h.at(1, { x: bed.x - 3.5, y: 97, z: bed.z + 1.5 });
    const slot = p.slots.findIndex((s) => s?.id === Item.BedwarsTNT);
    h.action(1, { kind: 'use', slot, dx: 1, dy: -0.2, dz: 0 }); h.tick(2);
    assert(h.getBlock(block.x, block.y, block.z) === Block.TeamWoolA && h.got(1, 'bwProj').some((m) => m.p.some((v: any) => v.kind === 'tnt')), 'live TNT fuse visible before blast');
    h.at(1, BW_BASES[0].forge); h.tick(1.2);
    assert(h.getBlock(block.x, block.y, block.z) === Block.Air, 'TNT destroys player wool');
    assert(h.getBlock(glass.x, glass.y, glass.z) === Block.ManorGlass && h.match.teams[0].bed, 'glass and bed survive');
    assert(isSolid(h.getBlock(block.x, 96, block.z)), 'authored floor survives');
  });
  test('pearl travels ballistically then lands in a safe supported space', () => {
    const h = new BwTestHost(); h.start(); const p = h.match.players.get(1)!;
    bwGive(p.slots, bwCatalog('pearl')!, 0); h.at(1, { x: -61.5, y: 97, z: 4.5 });
    const slot = p.slots.findIndex((s) => s?.id === Item.TeleportPearl);
    h.action(1, { kind: 'use', slot, dx: 1, dy: -0.7, dz: 0 });
    assert(h.body(1)!.x === -61.5, 'pearl does not teleport before collision'); h.tick(1);
    assert(h.body(1)!.x > -61 && h.body(1)!.y === 97, `pearl landed ahead on floor: ${JSON.stringify(h.body(1))}`);
    assert(!bwHas(p.slots, 'pearl'), 'pearl consumed');
  });
  test('the schedule upgrades generators, warns, removes beds, starts the deathmatch and hard-ends', () => {
    const h = new BwTestHost(); h.start();
    assert(h.match.snapshot().next?.label === 'Diamond II', 'the sidebar names the next event');
    h.match.time = 150.01; h.tick(0.05);
    assert(h.match.snapshot().gens.some((g) => g.tier === 2), 'diamond generators reach tier II on schedule');
    assert(h.messages.some((v) => v.msg.t === 'bwEvent' && v.msg.text.startsWith('Diamond II')), 'tier change announced');
    h.match.time = BW.BED_GONE_AT - 30 - 0.025; h.tick(0.05);
    assert(h.messages.some((v) => v.msg.t === 'bwEvent' && v.msg.text.includes('destroyed in 30 seconds')), '30 second bed warning');
    h.match.time = BW.BED_GONE_AT - 0.025; h.tick(0.05);
    assert(h.match.phase === 'suddenDeath' && h.match.teams.every((t) => !t.bed), 'beds removed on schedule');
    h.match.time = BW.ZONE_AT - 30 - 0.025; h.tick(0.05);
    assert(h.messages.some((v) => v.msg.t === 'bwEvent' && v.msg.text.includes('Deathmatch in 30 seconds')), '30 second deathmatch warning');
    h.match.time = BW.ZONE_AT + 60; h.tick(1.1);
    const zone = h.match.snapshot().safeZone;
    assert(zone.active && zone.radius < 80 && zone.startsIn === 0, 'shrinking zone published');
    assert(h.match.players.get(1)!.health < 20, 'outside zone takes pressure damage');
    h.at(1, { x: -1, y: 97, z: 0 }); h.at(2, { x: 1, y: 97, z: 0 });
    h.match.time = BW.END_AT - 0.025; h.tick(0.05);
    assert(h.match.isOver() && h.match.result?.reason.includes('Time limit'), 'hard end');
  });
  test('every map is four rotated copies of one base, forges on the centre line', () => {
    for (const id of [0, 1]) {
      const map = bwMap(id), c = map.bases.map((b) => b.center);
      const d = c.map((p) => Math.hypot(p.x - 0.5, p.z - 0.5));
      assert(d.every((v) => Math.abs(v - d[0]) < 1e-9), `map ${id}: every island is the same distance out`);
      for (const b of map.bases) {
        const rel = (p: BwPos) => ({ u: (p.x - b.center.x) * b.inward.x + (p.z - b.center.z) * b.inward.z, w: -(p.x - b.center.x) * b.inward.z + (p.z - b.center.z) * b.inward.x });
        assert(Math.abs(rel(b.forge).w) < 1e-9, `map ${id} team ${b.team}: forge on the centre line`);
        const gens = map.generators.filter((g) => g.team === b.team);
        assert(gens.length === 2 && gens.every((g) => g.pos.x === b.forge.x && g.pos.z === b.forge.z), 'iron and gold share the forge spot');
        assert(Math.abs(rel({ ...b.bed, x: b.bed.x + .5, z: b.bed.z + .5 }).w) < 1e-9, 'bed on the centre line');
        // The stamp agrees: the same local cell holds the same block on every island.
        for (const [u, w] of [[-9, 0], [-7, -7], [6, 0], [7, 0], [-11, 5], [3, -10]]) {
          const blocks = map.bases.map((o) => { const x = Math.floor(o.center.x + o.inward.x * u - o.inward.z * w), z = Math.floor(o.center.z + o.inward.z * u + o.inward.x * w); return [96, 97].map((y) => { const v = map.blockAt(x, y, z); return [Block.TeamWoolA, Block.TeamWoolB, Block.TeamWoolC, Block.TeamWoolD].includes(v) ? 'team' : v; }).join(':'); });
          assert(blocks.every((v) => v === blocks[0]), `map ${id}: cell (${u}, ${w}) differs between islands: ${blocks}`);
        }
      }
    }
  });
  test('three and four teams: own islands, unused beds gone, last team standing wins', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: false }, { id: 3, team: 2, bot: false }]);
    h.start();
    const s = h.match.snapshot();
    assert(s.teamCount === 3 && s.teams.length === 3, 'snapshot carries three teams');
    const unused = MAP.bases[3];
    assert(h.getBlock(unused.bed.x, unused.bed.y, unused.bed.z) === 0, 'the empty island has no bed');
    for (const id of [1, 2, 3]) assert(Math.hypot(h.body(id)!.x - MAP.bases[id - 1].center.x, h.body(id)!.z - MAP.bases[id - 1].center.z) < 4, `player ${id} spawns on its own island`);
    for (const t of [1, 2]) (h.match as unknown as { destroyBed(t: number): void }).destroyBed(t);
    h.at(2, { x: 0, y: 30, z: 0 }); h.tick(0.1);
    assert(!h.match.isOver(), 'two teams still standing');
    h.at(3, { x: 0, y: 30, z: 0 }); h.tick(0.1);
    assert(h.match.result?.winner === 0, 'the last team standing wins');
  });
  test('a bed broken while you are dead still respawns you one last time', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: false }, { id: 2, team: 1, bot: false }, { id: 3, team: 0, bot: false }]); h.start(); h.tick(1);
    h.at(1, { x: 0, y: 30, z: 0 }); h.tick(0.1);
    const p = h.match.players.get(1)!;
    assert(!p.alive && !p.eliminated && p.respawnAt > 0, 'dead, waiting to respawn');
    const bed = MAP.bases[0].bed; h.at(2, { x: bed.x - 1.5, y: 97, z: bed.z + 0.5 }); h.mine(2, bed, 1.5);
    assert(!h.match.teams[0].bed, 'bed broken during the timer');
    h.tick(6);
    assert(p.alive && !p.eliminated, 'the pending respawn still happens');
    h.at(1, { x: 0, y: 30, z: 0 }); h.tick(0.1);
    assert(!p.alive && p.eliminated, 'dying again with the bed gone is final');
    assert(!h.match.isOver(), 'the teammate keeps the team in it');
  });
  test('a four-bot free-for-all on the frost map plays to a winner', () => {
    const h = new BwTestHost([0, 1, 2, 3].map((t) => ({ id: t + 1, team: t, bot: true })), 1, 4);
    h.start();
    for (let i = 0; i < 900 && !h.match.isOver(); i++) h.tick(1);
    assert(h.match.isOver(), `match finishes (t=${h.match.time.toFixed(0)}, ${h.match.result?.reason})`);
    assert(h.match.placed.size > 40, 'bots bridged between the islands');
  });
  test('team names never mention the map', () => {
    const h = new BwTestHost(); h.start();
    const text = JSON.stringify(h.messages.filter((m) => m.msg.t === 'bwEvent'));
    assert(!/skygarden|citadel|crimson|cobalt/i.test(text), 'event text uses plain names');
  });
  test('the bot collects, buys, bridges, destroys the bed and wins on the real map', () => {
    const h = new BwTestHost([{ id: 1, team: 0, bot: true }, { id: 2, team: 1, bot: false }]); h.start();
    for (let i = 0; i < 480 && !h.match.isOver(); i++) h.tick(1);
    const p = h.match.players.get(1)!, bot = h.match.bots[0];
    assert(h.match.placed.size > 12, `bot must bridge/defend; placed=${h.match.placed.size}`);
    // A rush goes straight for the bed; the others buy tools first, and the
    // economy plan also farms diamonds for a team upgrade.
    if (bot.plan !== 'rush') assert(p.tools.pickaxe > 0, `bot must purchase tools; goal=${bot.goal}`);
    if (bot.plan === 'eco') assert(Object.values(h.match.teams[0].upgrades).some((v) => v > 0), 'bot must gather diamonds and buy an upgrade');
    assert(p.beds === 1, `bot must break enemy bed; goal=${h.match.bots[0].goal}, pos=${JSON.stringify(h.body(1))}`);
    assert(h.match.result?.winner === 0, 'bot must final-kill and win');
  });
  console.log(`Bedwars: ${passed} tests passed.`);
}
