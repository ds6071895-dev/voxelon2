import assert from 'node:assert/strict';
import { Block } from '../src/blocks';
import { bwAcceptMotion, bwAuthorizeImpulse, bwMotion, bwSupported } from '../src/bedwars_movement';
import type { BwPos } from '../src/bedwars_rules';
import { GameServer, type Outbound } from '../src/net/server_core';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { mulberry32 } from '../src/noise';
import { Player } from '../src/player';
import { FROZEN_INPUT, type PlayerInput } from '../src/input';

const floor = (_x: number, y: number, _z: number): number => y === 0 ? Block.Stone : Block.Air;
const empty = (): number => Block.Air;
const close = (actual: number, expected: number, message: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
};

/** Uses real public matchmaking and transform dispatch. Fixture teleports and
 * impulses go through the same host ports as respawns, pearls and combat. */
class MovementServer {
  readonly game: GameServer;
  readonly inbox: { to: number; msg: ServerMsg }[] = [];
  readonly ids: number[];
  readonly world: number;
  constructor() {
    // A party 1v1 on the garden map (the fixtures use its coordinates); the
    // map is picked by the server's rng, so take the first seed that lands there.
    let seed = 941;
    for (;;) {
      this.game = new GameServer({ rng: mulberry32(seed++) });
      this.inbox.length = 0;
      this.ids = [this.game.connect(), this.game.connect()];
      for (const id of this.ids) this.send(id, { t: 'hello' });
      this.send(this.ids[0], { t: 'partyCreate' });
      const code = (this.inbox.filter(o => o.msg.t === 'party').pop()!.msg as Extract<ServerMsg, { t: 'party' }>).party!.code;
      this.send(this.ids[1], { t: 'partyJoin', code });
      this.send(this.ids[0], { t: 'bwSetup', teams: 2, assignments: { [this.ids[0]]: 0, [this.ids[1]]: 1 }, fill: false, revision: 0 });
      const revision = (this.inbox.filter(o => o.msg.t === 'party').pop()!.msg as Extract<ServerMsg, { t: 'party' }>).party!.bedwars!.revision;
      this.send(this.ids[0], { t: 'play', mode: 'bedwars', setupRevision: revision });
      if (this.game.bedwars(this.game.worldOf(this.ids[0])!.id)!.map.id === 0) break;
    }
    this.world = this.game.worldOf(this.ids[0])!.id;
    for (const id of this.ids) this.send(id, { t: 'worldReady', world: this.world });
    this.tick(5.2);
    assert.equal(this.match.phase, 'playing', 'server fixture starts an active Bedwars round');
  }
  get match() { return this.game.bedwars(this.world)!; }
  get id() { return this.ids[0]; }
  get body() { return this.match.host.body(this.id)!; }
  deliver(messages: Outbound[]): void { this.inbox.push(...messages); }
  send(id: number, message: ClientMsg): void { this.deliver(this.game.handle(id, message)); }
  tick(seconds: number): void { for (let i = 0; i < Math.round(seconds * 20); i++) this.deliver(this.game.tick(0.05)); }
  place(at: BwPos): void { this.match.host.teleport(this.id, at.x, at.y, at.z, 0, 20); }
  /** A real client's `ct` advances with its clock; the server judges each
   * transform at its send time, so the default is a perfectly synced clock. */
  move(to: BwPos, ct = Math.round((this.game as unknown as { worldTime: number }).worldTime * 1000)): void {
    this.send(this.id, { t: 'xform', world: this.world, ...to, yaw: 0, pitch: 0, ct });
  }
}

/** Actual browser physics at rendering FPS, transforms at 30Hz, server ticks
 * at 20Hz. No synthetic y curves or ground flags are sent to the server. */
function runPlayerPhysics(h: MovementServer, player: Player, fps: number, seconds: number, input: PlayerInput): { landings: number; missedLandings: number } {
  const world = { getBlock: h.match.host.getBlock.bind(h.match.host) };
  let serverTime = 0, nextPacket = 1 / 30, landings = 0, missedLandings = 0;
  h.move(player.pos); h.inbox.length = 0; // Flush the fixture's authorized teleport.
  for (let frame = 1; frame <= Math.round(seconds * fps); frame++) {
    const beforeGround = player.onGround, time = frame / fps;
    player.update(1 / fps, input, world);
    const landed = !beforeGround && player.onGround;
    if (landed) landings++;
    while (serverTime + .05 <= time + 1e-8) { h.deliver(h.game.tick(.05)); serverTime += .05; }
    if (time + 1e-8 >= nextPacket) {
      h.move(player.pos, Math.round(time * 1000));
      close(h.body.y, player.pos.y, `${fps}FPS frame ${frame}: actual Player y accepted`);
      close(h.body.x, player.pos.x, `${fps}FPS frame ${frame}: actual Player x accepted`);
      close(h.body.z, player.pos.z, `${fps}FPS frame ${frame}: actual Player z accepted`);
      while (nextPacket <= time + 1e-8) nextPacket += 1 / 30;
    } else if (landed) missedLandings++;
    const correction = h.inbox.find(({ to, msg }) => to === h.id && msg.t === 'teleport');
    assert.equal(correction, undefined, `${fps}FPS frame ${frame}: legitimate physics caused server correction ${JSON.stringify(correction?.msg)}`);
  }
  return { landings, missedLandings };
}

export function runBedwarsMovementTests(): void {
  const failures: string[] = [];
  let passed = 0;
  // Continue independent cases so a regression reports all concrete failures.
  const test = (name: string, fn: () => void): void => {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (error) {
      const detail = `${name}: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(detail); console.error(`  ✗ ${detail}`);
    }
  };

  test('movement credit cannot be regenerated by same-time packet floods or rejections', () => {
    let from = { x: 0.5, y: 1, z: 0.5 };
    const m = bwMotion(10, from), initial = { ...from };
    for (let i = 0; i < 500; i++) {
      const to = { ...from, x: from.x + 0.05 };
      if (bwAcceptMotion(m, 10, from, to, false, floor).ok) from = to;
      // Rejected outliers must not mint credit for the next small packet.
      assert.equal(bwAcceptMotion(m, 10, from, { ...from, x: from.x + 100 }, false, floor).ok, false);
    }
    close(from.x - initial.x, 3.2, 'only the initial jitter allowance can be spent');
    const beforeRefill = from.x;
    for (let i = 0; i < 500; i++) {
      const to = { ...from, x: from.x + 0.05 };
      if (bwAcceptMotion(m, 10.1, from, to, false, floor).ok) from = to;
    }
    close(from.x - beforeRefill, 0.8, '100ms elapsed time credits distance exactly once');
  });

  test('normal walking and sprinting remain valid across sustained 20Hz movement', () => {
    for (const speed of [4.317, 5.612]) {
      let from = { x: 0.5, y: 1, z: 0.5 };
      const m = bwMotion(0, from);
      for (let step = 1; step <= 200; step++) {
        const to = { ...from, x: 0.5 + speed * step * 0.05 };
        assert.equal(bwAcceptMotion(m, step * 0.05, from, to, false, floor).ok, true, `${speed} blocks/s rejected at step ${step}`);
        from = to;
      }
      close(from.x, 0.5 + speed * 10, 'ten seconds of forward movement');
      assert.deepEqual(m.safe, from, 'supported walking updates the correction anchor');
    }
  });

  test('a physical 1.25-block ballistic jump, landing and second jump are accepted', () => {
    let from = { x: 0.5, y: 1, z: 0.5 }, now = 0;
    const m = bwMotion(now, from), velocity = Math.sqrt(2 * 32 * 1.25), apexTime = velocity / 32;
    for (let jump = 0; jump < 2; jump++) {
      const started = now;
      // Include the exact apex rather than accepting a lower sampled jump.
      const times = [...Array.from({ length: 12 }, (_, i) => (i + 1) * 0.05), apexTime].sort((a, b) => a - b);
      let highest = 1;
      for (const elapsed of times) {
        now = started + elapsed;
        const to = { ...from, y: Math.max(1, 1 + velocity * elapsed - 16 * elapsed * elapsed) };
        const verdict = bwAcceptMotion(m, now, from, to, false, floor);
        assert.equal(verdict.ok, true, `jump ${jump + 1}, t=${elapsed.toFixed(3)}, y=${to.y.toFixed(3)}: ${JSON.stringify(verdict)}`);
        highest = Math.max(highest, to.y); from = to;
      }
      close(highest, 2.25, 'jump reaches its intended apex');
      assert.equal(m.airAt, null, 'landing rearms a subsequent legitimate jump');
      close(m.safe.y, 1, 'landing records floor height');
    }
  });

  test('slab and stair support honors actual half-height and tread collision boxes', () => {
    const terrain = (x: number, y: number, z: number): number => {
      if (y === 1 && z === 0 && x === 1) return Block.ManorMarbleSlab;
      if (y === 1 && z === 0 && x === 2) return Block.ManorStairN;
      return floor(x, y, z);
    };
    const slab = { x: 1.5, y: 1.5, z: 0.75 };
    const lowTread = { x: 2.5, y: 1.5, z: 0.85 };
    const highTread = { x: 2.5, y: 2, z: 0.15 };
    assert.ok(bwSupported(slab, terrain), 'half-height slab top is support');
    assert.ok(bwSupported(lowTread, terrain), 'lower stair tread is support');
    assert.ok(bwSupported(highTread, terrain), 'upper stair tread is support');
    assert.equal(bwSupported({ ...slab, y: 2 }, terrain), false, 'empty upper slab half is not a floor');
    let from = { x: 0.5, y: 1, z: 0.75 }, now = 0;
    const m = bwMotion(now, from);
    for (const to of [slab, lowTread, highTread]) {
      now += 0.2;
      assert.ok(bwAcceptMotion(m, now, from, to, false, terrain).ok, `step-up rejected at ${JSON.stringify(to)}`);
      assert.equal(m.airAt, null, 'supported step-up does not accumulate airtime');
      assert.deepEqual(m.safe, to, 'step-up correction anchor follows tread height'); from = to;
    }
    // A falling player can land on a half-height surface, not only full cells.
    from = { ...slab, y: 2.3 };
    const falling = bwMotion(0, from);
    assert.ok(bwAcceptMotion(falling, 0.1, from, slab, false, terrain).ok, 'slab landing accepted');
    assert.equal(falling.airAt, null); close(falling.safe.y, 1.5, 'slab landing height saved');
  });

  test('authorized knockback permits its trajectory while an identical unauthorized boost fails', () => {
    const start = { x: 0.5, y: 1, z: 0.5 };
    const authorized = bwMotion(0, start), unauthorized = bwMotion(0, start);
    bwAuthorizeImpulse(authorized, 0, start, 16, 12, 0);
    let from = start, control = start, denied = false;
    for (let step = 1; step <= 15; step++) {
      const t = step * 0.05, to = { x: start.x + 20 * t, y: 1 + Math.max(0, 12 * t - 16 * t * t), z: 0.5 };
      assert.ok(bwAcceptMotion(authorized, t, from, to, false, floor).ok, `authorized impulse rejected at ${t}s: ${JSON.stringify(to)}`);
      from = to;
      if (!denied) {
        const verdict = bwAcceptMotion(unauthorized, t, control, to, false, floor);
        denied = !verdict.ok;
        if (verdict.ok) control = to;
      }
    }
    assert.ok(denied, 'the same accelerated movement needs server authorization');
    assert.equal(bwAcceptMotion(authorized, 1.2, from, { ...from, x: from.x + 3.6 }, false, floor).ok, false, 'expired impulse cannot spend boosted burst allowance');
    assert.equal(authorized.extraSpeed, 0, 'expired impulse speed clears');
  });

  test('unsupported hovering is rejected without rearming its flight clock', () => {
    const terrain = (x: number, y: number, _z: number): number => x <= 0 && y === 0 ? Block.Stone : Block.Air;
    const safe = { x: 0.5, y: 1, z: 0.5 }, hover = { x: 1.5, y: 1, z: 0.5 };
    const m = bwMotion(0, safe);
    assert.ok(bwAcceptMotion(m, 0.2, safe, hover, false, terrain).ok, 'walking off an edge initially allowed');
    let rejectedAt = 0;
    for (let step = 1; step <= 30; step++) {
      const now = 0.2 + step * 0.05, verdict = bwAcceptMotion(m, now, hover, hover, false, terrain);
      if (!verdict.ok) { assert.ok(verdict.airViolation, 'hover denial requires authoritative falling'); rejectedAt = now; break; }
    }
    assert.ok(rejectedAt > 0 && rejectedAt <= 1.3, `hovering must stop promptly, rejectedAt=${rejectedAt}`);
    for (let i = 0; i < 100; i++) assert.equal(bwAcceptMotion(m, rejectedAt, hover, hover, false, terrain).ok, false, 'stationary packet floods cannot restart a jump');
    assert.deepEqual(m.safe, safe, 'airborne positions never replace the last supported anchor');
  });

  test('spectators can ascend and descend in empty space but cannot flood vertical credit', () => {
    let from = { x: 0, y: 30, z: 0 }, now = 0;
    const m = bwMotion(0, from);
    for (const speed of [8, -8]) for (let step = 0; step < 40; step++) {
      now += 0.05;
      const to = { ...from, y: from.y + speed * 0.05 };
      assert.ok(bwAcceptMotion(m, now, from, to, true, empty).ok, `spectator ${speed > 0 ? 'ascent' : 'descent'} rejected at ${now}`);
      from = to;
    }
    close(from.y, 30, 'spectator returns to original elevation without a floor');
    const initial = from.y;
    for (let i = 0; i < 200; i++) {
      const to = { ...from, y: from.y + 0.1 };
      if (bwAcceptMotion(m, now, from, to, true, empty).ok) from = to;
    }
    assert.ok(from.y - initial <= 1.4 + 1e-6, 'same-time spectator packets cannot create vertical distance');
  });

  test('server transform dispatch shares movement credit regardless of packet count or client clock', () => {
    const h = new MovementServer();
    h.place({ x: -61.5, y: 97, z: -1.5 });
    const start = { ...h.body };
    for (let i = 0; i < 300; i++) h.move({ x: h.body.x, y: h.body.y, z: h.body.z + 0.05 }, i * 100000);
    close(h.body.z - start.z, 3.2, 'server accepts only its fixed-time burst allowance');
    const afterFlood = { ...h.body };
    h.move({ x: h.body.x, y: h.body.y, z: h.body.z + 1 }, 1e15);
    close(h.body.z, afterFlood.z, 'forged client timestamps do not replenish credit');
    assert.ok(h.inbox.some(({ to, msg }) => to === h.id && msg.t === 'teleport' && Math.abs(msg.z - afterFlood.z) < 1e-6), 'server emits a position correction for overspending');
    for (let i = 0; i < 10; i++) {
      h.tick(0.05); const z = h.body.z + 4.317 * 0.05;
      h.move({ x: h.body.x, y: 97, z }); close(h.body.z, z, `normal walk after flood accepted at packet ${i}`);
    }
  });

  test('server accepts a normal ballistic jump and honors host-authorized knockback', () => {
    const h = new MovementServer(); h.place({ x: -61.5, y: 97, z: -1.5 });
    const velocity = Math.sqrt(2 * 32 * 1.25);
    for (let step = 1; step <= 12; step++) {
      h.tick(0.05); const t = step * 0.05, y = 97 + Math.max(0, velocity * t - 16 * t * t);
      h.move({ x: -61.5, y, z: -1.5 }); close(h.body.y, y, `server jump sample ${step}`);
    }
    // Above the authored map's 125-block ceiling, but within the living-player
    // movement bounds, so this isolates velocity validation from the canopy.
    const start = { x: -5.5, y: 130, z: 0.5 }; h.place(start);
    h.match.host.impulse(h.id, 16, 12, 0, h.ids[1], 20);
    for (let step = 1; step <= 10; step++) {
      h.tick(0.05); const t = step * 0.05;
      const to = { x: start.x + 20 * t, y: start.y + 12 * t - 16 * t * t, z: start.z };
      h.move(to); close(h.body.x, to.x, `server knockback horizontal sample ${step}`); close(h.body.y, to.y, `server knockback vertical sample ${step}`);
    }
  });

  test('server forces hovering downward into void death and permits subsequent spectator flight', () => {
    const h = new MovementServer(), safe = { x: 35.5, y: 97, z: 0.5 };
    h.match.host.setBlock(35, 96, 0, Block.TeamWoolA); h.place(safe);
    assert.equal(h.match.host.getBlock(36, 96, 0), Block.Air, 'hover fixture is over the actual map void');
    const hover = { x: 36.5, y: 97, z: 0.5 };
    h.tick(0.2); h.move(hover); close(h.body.x, hover.x, 'initial step off bridge accepted');
    for (let i = 0; i < 70 && h.match.players.get(h.id)!.alive; i++) {
      h.tick(0.05); h.move(hover);
      // Once dead the server lifts the body to its base's spectator view.
      if (h.match.players.get(h.id)!.alive) close(h.body.x, hover.x, 'anti-flight never rescues the player onto the bridge');
    }
    assert.equal(h.match.players.get(h.id)!.deaths, 1, 'hover spam eventually falls into the void');
    assert.equal(h.match.players.get(h.id)!.alive, false, 'void death enters real respawn/spectator state');
    let y = h.body.y;
    const at = { x: h.body.x, z: h.body.z };
    for (const direction of [1, -1]) for (let i = 0; i < 10; i++) {
      h.tick(0.05); y += direction * 0.4;
      h.move({ x: at.x, y, z: at.z }); close(h.body.y, y, 'dead spectator vertical transform accepted');
    }
  });

  test('the real island-edge silence exploit falls onto its actual lower ledge without rescue', () => {
    const h = new MovementServer(), edge = { x: -49.5, y: 97, z: 3.5 }, voidPose = { x: -48.5, y: 97, z: 3.5 };
    const get = h.match.host.getBlock.bind(h.match.host);
    assert.ok(bwSupported(edge, get), 'critic starting position is supported');
    assert.equal(bwSupported(voidPose, get), false, 'critic endpoint is unsupported');
    h.place(edge); h.move(voidPose); close(h.body.x, voidPose.x, 'step off real map edge accepted');
    h.inbox.length = 0;
    h.tick(3.5);
    const actual = new Player(voidPose), world = { getBlock: get };
    for (let frame = 0; frame < 240; frame++) actual.update(1 / 120, FROZEN_INPUT, world);
    assert.ok(actual.onGround, 'the critic location really has a lower landing surface');
    close(h.body.y, 96, 'server falls a full block onto the lower ledge');
    assert.ok(Math.abs(h.body.y - actual.pos.y) < .01, 'authoritative fall lands at the same height as actual Player physics');
    close(h.body.x, voidPose.x, 'silence correction retains unsupported horizontal location');
    const corrections = h.inbox.filter(({ to, msg }) => to === h.id && msg.t === 'teleport');
    assert.ok(corrections.length > 0, 'server tick sends downward corrections without incoming packets');
    assert.ok(corrections.every(({ msg }) => msg.t === 'teleport' && msg.y < 97 && msg.x === voidPose.x), 'no correction is a free safe-position rescue');
  });

  test('silence over unobstructed void causes death without waiting for a transform packet', () => {
    const h = new MovementServer();
    h.match.host.setBlock(35, 96, 0, Block.TeamWoolA);
    h.place({ x: 35.5, y: 97, z: .5 }); h.move({ x: 36.5, y: 97, z: .5 });
    h.tick(3.5);
    assert.equal(h.match.players.get(h.id)!.deaths, 1, 'server ticks alone advance the fall through the void boundary');
    assert.equal(h.match.players.get(h.id)!.alive, false, 'void death occurs before the bed respawn timer');
    assert.ok(Math.abs(h.body.x - 36.5) > 5 && h.body.y > 100, 'no rescue to the bridge: the dead watch from over their base');
  });

  test('removing the floor under a silent grounded player starts an authoritative fall', () => {
    const h = new MovementServer();
    h.match.host.setBlock(35, 96, 0, Block.TeamWoolA);
    h.place({ x: 35.5, y: 97, z: .5 }); h.move({ x: 35.5, y: 97, z: .5 });
    h.tick(.5);
    h.match.host.setBlock(35, 96, 0, Block.Air);
    h.tick(3.5);
    assert.equal(h.match.players.get(h.id)!.deaths, 1, 'tick validation rechecks changing support geometry without new packets');
    assert.ok(Math.abs(h.body.x - 35.5) > 5 && h.body.y > 100, 'destroyed support does not trigger a safe-ground rescue');
  });

  test('server-forced falling lands on the actual top of a half-height slab', () => {
    const h = new MovementServer();
    h.match.host.setBlock(35, 96, 0, Block.TeamWoolA);
    h.match.host.setBlock(36, 93, 0, Block.ManorMarbleSlab);
    h.place({ x: 35.5, y: 97, z: .5 }); h.move({ x: 36.5, y: 97, z: .5 });
    h.tick(3); // includes BW_MAX_LAG of silence grace before the forced fall
    close(h.body.x, 36.5, 'landing preserves horizontal position');
    close(h.body.y, 93.5, 'downward collision sweep lands on the slab, not its empty upper half');
    assert.equal(h.match.players.get(h.id)!.deaths, 0, 'a real landing interrupts the forced fall');
  });

  for (const fps of [50, 75, 90, 144, 165, 240]) test(`actual Player continuous jumps at ${fps}FPS with 30Hz transforms preserve between-packet landings`, () => {
    const h = new MovementServer(), spawn = { x: -61.5, y: 97, z: -1.5 };
    h.place(spawn);
    const player = new Player(spawn);
    const result = runPlayerPhysics(h, player, fps, 8, { ...FROZEN_INPUT, jump: true });
    assert.ok(result.landings >= 10, `${fps}FPS must exercise repeated full jump/landing cycles`);
    if (fps >= 75) assert.ok(result.missedLandings > 0, `${fps}FPS must include landings that had no transform packet`);
    assert.equal(h.match.players.get(h.id)!.deaths, 0);
  });

  for (const fps of [75, 144, 240]) test(`actual Player authorized knockback at ${fps}FPS survives 30Hz network sampling`, () => {
    const h = new MovementServer(), spawn = { x: -5.5, y: 130, z: .5 };
    h.place(spawn);
    const player = new Player(spawn);
    h.match.host.impulse(h.id, 16, 12, 0, h.ids[1], 20);
    player.vel.set(16, 12, 0); // Same additive impulse applied by main.ts onHurt.
    runPlayerPhysics(h, player, fps, 2, { ...FROZEN_INPUT });
    assert.equal(h.match.players.get(h.id)!.deaths, 0);
  });

  test('actual Player walking auto-steps onto a slab and both stair treads through GameServer', () => {
    const h = new MovementServer(), spawn = { x: 36.5, y: 97, z: 4.5 };
    for (let x = 35; x <= 37; x++) for (let z = -3; z <= 5; z++) h.match.host.setBlock(x, 96, z, Block.TeamWoolA);
    h.match.host.setBlock(36, 97, 2, Block.ManorMarbleSlab);
    h.match.host.setBlock(36, 97, 1, Block.ManorStairN);
    for (const z of [0, -1, -2]) h.match.host.setBlock(36, 97, z, Block.TeamWoolA);
    h.place(spawn);
    const player = new Player(spawn);
    runPlayerPhysics(h, player, 75, 1.35, { ...FROZEN_INPUT, forward: true });
    assert.ok(player.pos.z < 1 && player.pos.y >= 98 && player.pos.y < 98.01, `actual Player crossed both 0.5-block steps: ${JSON.stringify(player.pos)}`);
  });

  test('server auto-step validation still requires clear headroom throughout the rise', () => {
    const h = new MovementServer(), start = { x: 36.5, y: 97, z: 3.3 };
    for (const z of [2, 3, 4]) h.match.host.setBlock(36, 96, z, Block.TeamWoolA);
    h.match.host.setBlock(36, 97, 2, Block.ManorMarbleSlab);
    h.match.host.setBlock(36, 99, 3, Block.TeamWoolA);
    h.place(start);
    h.move({ x: 36.5, y: 97.5, z: 2.5 });
    close(h.body.y, start.y, 'a clear endpoint cannot bypass a low ceiling in the step path');
    close(h.body.z, start.z, 'blocked step has no horizontal displacement');
  });

  console.log(`Bedwars movement: ${passed} passed, ${failures.length} failed.`);
  assert.equal(failures.length, 0, failures.join('\n'));
}
