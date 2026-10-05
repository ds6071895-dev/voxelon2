// Bots buy, bridge, mine and fight through exactly the same action gate as humans.
import { Block, isSolid } from './blocks';
import { Item } from './items';
import { BW_BASES, BW_GENERATORS, bwBedAt } from './bedwars_map';
import type { BedwarsMatch, BwPlayer } from './bedwars';
import { BW, BW_RESOURCE_ITEM, bwToolOf, type BwPos, type BwResource, type BwTeam } from './bedwars_rules';
import { bwCatalog, bwPrice } from './bedwars_catalog';
import { bwCount, bwHas } from './bedwars_inventory';
import { bwDistance, bwFits, bwKey, bwLine, bwPath } from './bedwars_nav';

type Goal = 'forge' | 'shop' | 'defend' | 'diamond' | 'upgrade' | 'emerald' | 'attack';
export class BedwarsBot {
  goal: Goal = 'forge';
  private request = 1;
  private path: BwPos[] = [];
  private pathTarget = '';
  private replanAt = 0;
  private thinkAt = 0;
  private defenseDone = false;
  /** Cells the bot found it could not physically stand in, so the planner skips them. */
  private readonly avoid = new Set<number>();
  private diamondTrips = 0;
  private wasAlive = true;
  private vertical = 0;
  private knockX = 0;
  private knockZ = 0;

  constructor(readonly match: BedwarsMatch, readonly id: number) {}
  knockback(x: number, y: number, z: number): void {
    this.knockX += x; this.knockZ += z; this.vertical = Math.max(this.vertical, y);
    this.path = []; this.replanAt = 0;
  }
  tick(dt: number): void {
    const m = this.match, p = m.players.get(this.id), b = m.host.body(this.id);
    if (!p || !b) return;
    if (!p.alive) { this.wasAlive = false; this.path = []; return; }
    if (!this.wasAlive) { this.wasAlive = true; this.goal = 'forge'; this.vertical = 0; this.knockX = 0; this.knockZ = 0; this.pathTarget = ''; }
    const get = m.host.getBlock.bind(m.host);
    // The host's drive port does not run player physics for an AI body.
    if (this.vertical !== 0 || Math.hypot(this.knockX, this.knockZ) > 0.05 || b.y < 96.9 || !isSolid(get(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z)))) {
      const at = { x: b.x, y: b.y, z: b.z };
      const steps = Math.max(1, Math.ceil(Math.hypot(this.knockX, this.knockZ, this.vertical) * dt / 0.15));
      for (let i = 0; i < steps; i++) {
        const interval = dt / steps;
        this.vertical -= 24 * interval;
        const x = at.x + this.knockX * interval, z = at.z + this.knockZ * interval;
        if (bwFits(get, { ...at, x })) at.x = x; else this.knockX = 0;
        if (bwFits(get, { ...at, z })) at.z = z; else this.knockZ = 0;
        const y = at.y + this.vertical * interval;
        if (bwFits(get, { ...at, y })) at.y = y;
        else {
          const floor = Math.floor(y) + 1;
          if (this.vertical < 0 && bwFits(get, { ...at, y: floor })) at.y = floor;
          this.vertical = 0;
        }
      }
      const friction = this.vertical === 0 ? 0.65 : 0.97;
      this.knockX *= friction; this.knockZ *= friction;
      if (Math.abs(this.knockX) < 0.025) this.knockX = 0;
      if (Math.abs(this.knockZ) < 0.025) this.knockZ = 0;
      m.host.drive(this.id, { ...b, ...at });
      return;
    }
    this.vertical = 0;
    const base = BW_BASES[p.team], enemy = BW_BASES[(1 - p.team) as BwTeam];
    if (m.time >= BW.ZONE_AT && Math.hypot(b.x, b.z) > Math.max(4, 86 - (m.time - BW.ZONE_AT) / (BW.END_AT - BW.ZONE_AT) * 82)) {
      this.walk({ x: 0.5, y: 97, z: 0.5 }, dt); return;
    }
    const foes = [...m.players.values()].filter((v) => v.alive && v.team !== p.team && m.host.body(v.id));
    foes.sort((a, c) => bwDistance(b, m.host.body(a.id)!) - bwDistance(b, m.host.body(c.id)!));
    const foe = foes[0], body = foe && m.host.body(foe.id);
    if (p.health <= 12) {
      const heal = p.slots.findIndex((s) => s?.id === Item.HealingApple);
      if (heal >= 0) m.handle(this.id, { kind: 'use', slot: heal, dx: 0, dy: 1, dz: 0 });
    }
    if (body && bwDistance(b, body) < 9 && bwLine(get, { ...b, y: b.y + 1.3 }, { ...body, y: body.y + 1.2 })) {
      this.face(body, 0, true);
      if (bwDistance(b, body) <= 3.3) {
        m.handle(this.id, { kind: 'melee', target: foe.id, slot: 0 });
        // Close enough to hit, stay on the bridge instead of walking through a foe.
        return;
      }
      this.walk(body, dt); return;
    }
    if (m.time >= this.thinkAt) {
      this.thinkAt = m.time + 0.3;
      if (this.goal === 'forge' && this.have(p, 'iron') >= (p.tools.pickaxe ? 22 : 36)) this.change('shop');
      if ((this.goal === 'attack' || this.goal === 'diamond' || this.goal === 'emerald') && this.wool(p) < 4) this.change('forge');
    }
    switch (this.goal) {
      case 'forge': this.walk(base.forge, dt); break;
      case 'shop':
        if (bwDistance(b, base.shop) > 3.2) { this.walk(base.shop, dt); break; }
        if (!p.tools.pickaxe) this.buy('tools');
        if (!p.sword) this.buy('stone_sword');
        if (p.armor < 2 && this.have(p, 'gold') >= 12) this.buy('iron_armor');
        else if (p.sword < 2 && this.have(p, 'gold') >= 7) this.buy('iron_sword');
        if (p.tools.pickaxe < 2 && this.have(p, 'gold') >= 6) this.buy('iron_tools');
        if (this.have(p, 'gold') >= 4 && !bwHas(p.slots, 'tnt')) this.buy('tnt');
        if (this.have(p, 'gold') >= 3 && !bwHas(p.slots, 'heal')) this.buy('heal');
        for (let i = 0; i < 4 && this.wool(p) < 64 && this.have(p, 'iron') >= 4; i++) this.buy('wool');
        if (!p.tools.shears && this.have(p, 'iron') >= 20) this.buy('shears');
        for (let i = 0; i < 2 && this.wool(p) < 96 && this.have(p, 'iron') >= 4; i++) this.buy('wool');
        if (p.armor < 1 && this.have(p, 'iron') >= 30) this.buy('chain_armor');
        if (this.have(p, 'emerald') >= 6 && p.armor < 3) this.buy('diamond_armor');
        else if (this.have(p, 'emerald') >= 4 && p.sword < 3) this.buy('diamond_sword');
        if (this.wool(p) < 16) this.change('forge');
        else if (!this.defenseDone && m.teams[p.team].bed) this.change('defend');
        else if (this.have(p, 'diamond') >= 2) this.change('upgrade');
        else this.change(this.diamondTrips < 1 ? 'diamond' : 'attack');
        break;
      case 'defend': {
        const bed = base.bed;
        const cells = [
          { x: bed.x - 1, y: bed.y, z: bed.z }, { x: bed.x + 1, y: bed.y, z: bed.z },
          { x: bed.x - 1, y: bed.y, z: bed.z + 1 }, { x: bed.x + 1, y: bed.y, z: bed.z + 1 },
          { x: bed.x, y: bed.y, z: bed.z - 1 }, { x: bed.x, y: bed.y, z: bed.z + 2 },
          { x: bed.x, y: bed.y + 1, z: bed.z }, { x: bed.x, y: bed.y + 1, z: bed.z + 1 },
        ];
        const missing = cells.find((v) => !isSolid(get(v.x, v.y, v.z)));
        if (!missing || this.wool(p) < 16) { this.defenseDone = true; this.change('diamond'); break; }
        const at = { x: bed.x + (p.team === 0 ? -3.5 : 3.5), y: 97, z: bed.z + 0.5 };
        if (bwDistance(b, at) > 0.6) this.walk(at, dt);
        this.face({ ...missing, x: missing.x + 0.5, z: missing.z + 0.5 }, this.woolSlot(p));
        m.handle(this.id, { kind: 'place', ...missing, slot: this.woolSlot(p) });
        // A service clearance may exclude a defense cell: don't stall forever.
        if (m.time > 85) { this.defenseDone = true; this.change('diamond'); }
        break;
      }
      case 'diamond': {
        const options = BW_GENERATORS.filter((g) => g.kind === 'diamond').sort((a, c) => bwDistance(base.center, a.pos) - bwDistance(base.center, c.pos));
        const g = options[0];
        if (!g) { this.change('attack'); break; }
        if (this.have(p, 'diamond') >= 4) { this.diamondTrips++; this.change('upgrade'); }
        else this.walk(g.pos, dt);
        break;
      }
      case 'upgrade':
        if (bwDistance(b, base.upgrades) > 3.2) { this.walk(base.upgrades, dt); break; }
        if (!m.teams[p.team].upgrades.sharpness && this.have(p, 'diamond') >= 4) this.buy('sharpness');
        if (!m.teams[p.team].upgrades.forge && this.have(p, 'diamond') >= 2) this.buy('forge');
        if (this.have(p, 'diamond') >= 2) this.buy('protection');
        if (this.have(p, 'diamond') >= 1) this.buy('trap');
        this.change('shop'); break;
      case 'emerald': {
        const g = BW_GENERATORS.filter((v) => v.kind === 'emerald').sort((a, c) => bwDistance(b, a.pos) - bwDistance(b, c.pos))[0];
        if (!g || this.have(p, 'emerald') >= 4) this.change('shop');
        else this.walk(g.pos, dt);
        break;
      }
      case 'attack':
        if (m.teams[enemy.team].bed) {
          const target = { x: enemy.bed.x + 0.5, y: enemy.bed.y + 0.5, z: enemy.bed.z + 0.5 };
          if (bwDistance(b, target) < 4.2) {
            const eye = { ...b, y: b.y + 1.62 };
            // Find the first defense along the bed ray and mine it before the bed.
            let hit = { ...enemy.bed };
            const steps = Math.ceil(bwDistance(eye, target) * 15);
            for (let i = 1; i <= steps; i++) {
              const v = { x: Math.floor(eye.x + (target.x - eye.x) * i / steps), y: Math.floor(eye.y + (target.y - eye.y) * i / steps), z: Math.floor(eye.z + (target.z - eye.z) * i / steps) };
              if (isSolid(get(v.x, v.y, v.z))) { hit = v; break; }
            }
            const slot = this.miningSlot(p, get(hit.x, hit.y, hit.z));
            this.face(target, slot, true);
            if (m.placed.has(bwKey(hit.x, hit.y, hit.z)) || bwBedAt(hit.x, hit.y, hit.z) === enemy.team) {
              m.handle(this.id, { kind: 'break', ...hit, slot }); return;
            }
          }
          this.walk(target, dt);
        } else if (body) this.walk(body, dt);
        else this.change('emerald');
        break;
    }
  }
  private have(p: BwPlayer, r: BwResource): number { return bwCount(p.slots, BW_RESOURCE_ITEM[r]); }
  private wool(p: BwPlayer): number { return bwCount(p.slots, Block.TeamWoolA) + bwCount(p.slots, Block.TeamWoolB); }
  private miningSlot(p: BwPlayer, block: number): number {
    const kind = block === Block.OakPlanks ? 'axe' : block === Block.Sandstone ? 'pickaxe' : 'shears';
    const slot = p.slots.findIndex((s) => s && bwToolOf(s.id)?.kind === kind);
    return slot >= 0 ? slot : 0;
  }
  private woolSlot(p: BwPlayer): number { return p.slots.findIndex((s) => s?.id === Block.TeamWoolA || s?.id === Block.TeamWoolB); }
  private change(goal: Goal): void { if (this.goal !== goal) { this.goal = goal; this.pathTarget = ''; this.path = []; } }
  private buy(sku: string): void {
    const p = this.match.players.get(this.id)!, e = bwCatalog(sku)!;
    if (this.have(p, e.resource) >= bwPrice(e, this.match.teams[p.team].upgrades)) this.match.handle(this.id, { kind: 'buy', sku, request: this.request++ });
  }
  private face(target: BwPos, slot: number, swing = false): void {
    const m = this.match, b = m.host.body(this.id)!, p = m.players.get(this.id)!;
    const yaw = Math.atan2(-(target.x - b.x), -(target.z - b.z));
    const pitch = Math.atan2(target.y - b.y - 1.3, Math.hypot(target.x - b.x, target.z - b.z));
    m.host.drive(this.id, { ...b, yaw, pitch, held: p.slots[slot]?.id ?? p.slots[0]?.id, swing });
  }
  private walk(target: BwPos, dt: number): void {
    const m = this.match, p = m.players.get(this.id)!, b = m.host.body(this.id)!, get = m.host.getBlock.bind(m.host);
    if (Math.hypot(target.x - b.x, target.z - b.z) < 1.05) { m.handle(this.id, { kind: 'stopBreak' }); return; }
    const targetKey = `${Math.floor(target.x)},${Math.floor(target.z)}`;
    if (targetKey !== this.pathTarget || m.time >= this.replanAt || !this.path.length) {
      this.path = bwPath(get, b, target, (x, y, z) => m.placed.has(bwKey(x, y, z)), (x, z) => this.avoid.has(bwKey(x, 0, z)));
      this.pathTarget = targetKey; this.replanAt = m.time + 3;
    }
    const next = this.path[0];
    if (!next) return;
    const cell = { x: Math.floor(next.x), y: 96, z: Math.floor(next.z) };
    for (const y of [97, 98]) if (isSolid(get(cell.x, y, cell.z))) {
      if (m.placed.has(bwKey(cell.x, y, cell.z))) {
        const slot = this.miningSlot(p, get(cell.x, y, cell.z));
        this.face({ ...cell, y }, slot, true);
        m.handle(this.id, { kind: 'break', x: cell.x, y, z: cell.z, slot });
      } else this.replanAt = 0;
      return;
    }
    if (!isSolid(get(cell.x, cell.y, cell.z))) {
      const slot = this.woolSlot(p);
      if (slot < 0) { this.change('forge'); return; }
      this.face({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 }, slot, true);
      m.handle(this.id, { kind: 'place', ...cell, slot });
      if (!isSolid(get(cell.x, cell.y, cell.z))) return;
    }
    m.handle(this.id, { kind: 'stopBreak' });
    const distance = Math.hypot(next.x - b.x, next.z - b.z), step = Math.min(distance, dt * 4.1);
    const at = { x: b.x + (next.x - b.x) / (distance || 1) * step, y: 97, z: b.z + (next.z - b.z) / (distance || 1) * step };
    if (!bwFits(get, at)) {
      // Furniture has collision a whole-cell path cannot see. Slide along it if
      // one axis is free; otherwise remember the cell as blocked and route around.
      const slideX = { ...at, z: b.z }, slideZ = { ...at, x: b.x };
      if (bwFits(get, slideX) && Math.abs(slideX.x - b.x) > 0.01) m.host.drive(this.id, { ...slideX, yaw: Math.atan2(-(next.x - b.x), -(next.z - b.z)), pitch: 0, held: p.slots[0]?.id, swing: false });
      else if (bwFits(get, slideZ) && Math.abs(slideZ.z - b.z) > 0.01) m.host.drive(this.id, { ...slideZ, yaw: Math.atan2(-(next.x - b.x), -(next.z - b.z)), pitch: 0, held: p.slots[0]?.id, swing: false });
      else { this.avoid.add(bwKey(Math.floor(next.x), 0, Math.floor(next.z))); this.replanAt = 0; this.path = []; }
      return;
    }
    const yaw = Math.atan2(-(next.x - b.x), -(next.z - b.z));
    m.host.drive(this.id, { ...at, yaw, pitch: 0, held: p.slots[0]?.id, swing: false });
    if (distance < 0.25) this.path.shift();
  }
}
