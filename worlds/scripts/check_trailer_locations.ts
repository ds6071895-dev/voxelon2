// Geometry audit before spending time rendering: choose the exact capture
// course and check that low cameras/actors are not buried in authored builds.
import { parkourCourse, parkourStandSpot } from '../src/parkour_course';
import { worldGenerator } from '../src/multiverse';
import { isSolid, Block } from '../src/blocks';
import { rsHouse } from '../src/ratseek_house';
import { TitleTerrain, TITLE_SEA } from '../src/title_terrain';

let seed = 2026;
for (; seed < 3026; seed += 8) {
  const pieces = parkourCourse(seed).variant.pieces;
  if (pieces.includes('rooftops') && pieces.includes('waterfall')) break;
}
const course = parkourCourse(seed);
console.log('Capture seed:', seed, course.variant.pieces);
for (const piece of ['rooftops', 'waterfall']) {
  const section = course.sections.find(s => s.piece === piece)!;
  const firstOrder = Math.min(section.toOrder - 5, section.fromOrder + 5);
  console.log(piece, { section, anchor: parkourStandSpot(course, course.steps[firstOrder][0]) });
}
const points: Record<string, [number, number, number][]> = {
  duel: [[16, 102.2, 27], [16.5, 101.2, 18]],
  bridge: [[13.8, 143.6, 32], [13.8, 143.1, 34.5], [12.5, 142, 39], [12.5, 142, 41]],
  ratseek: [[1.8, 81.75, -4], [1.8, 81.75, -7.9], [30.5, 82.2, 7], [29.5, 82, 6]],
};
points.parkour = [];
for (const piece of ['rooftops', 'waterfall']) {
  const section = course.sections.find(s => s.piece === piece)!;
  const order = Math.min(section.toOrder - 5, section.fromOrder + 5);
  const p = course.steps[order][0];
  const paths = piece === 'rooftops'
    ? [[[19, 13, -12], [14, 6, 13]], [[15, 8, 22], [10, 6, 21]]]
    : [[[33, 24, -20], [25, 13, 15]], [[15, 8, 22], [10, 6, 21]]];
  for (const [from, to] of paths) for (let step = 0; step <= 12; step++) {
    const t = step / 12;
    points.parkour.push([p.x + from[0] + (to[0] - from[0]) * t, p.y + from[1] + (to[1] - from[1]) * t, p.z + from[2] + (to[2] - from[2]) * t]);
  }
}
let blocked = 0;
const lake = new TitleTerrain(0x5ca1ab1e);
for (let step = 0; step <= 24; step++) {
  const k = step / 24;
  const x = 25 - 37 * k, y = TITLE_SEA + 13 + 9 * k, z = 25;
  const block = lake.blockAt(Math.floor(x), Math.floor(y), Math.floor(z));
  if (isSolid(block)) { console.log('lake camera intersects scenery', { x, y, z, block }); blocked++; }
}
for (const [kind, positions] of Object.entries(points)) {
  const gen = worldGenerator({ kind: kind as 'duel' | 'bridge' | 'ratseek' | 'parkour', seed });
  for (const [x, y, z] of positions) {
    const block = gen.blockAt(Math.floor(x), Math.floor(y), Math.floor(z));
    const solid = isSolid(block) && block !== Block.Barrier;
    if (kind !== 'parkour' || solid) console.log(kind, { x, y, z, block, cameraBlocked: solid });
    if (solid) blocked++;
  }
}
console.log('Manor cheese locations:', rsHouse().cheese.slice(0, 4));
const bridge = worldGenerator({ kind: 'bridge', seed });
for (let frame = 0; frame <= 20; frame++) {
  const k = frame / 20;
  const from = [13.8, 143.6 - .5 * k, 32 + 2.5 * k];
  for (let step = 0; step < 40; step++) {
    const t = step / 40;
    const [x, y, z] = from.map((v, i) => Math.floor(v + ([12.5, 142, 40][i] - v) * t));
    const b = bridge.blockAt(x, y, z);
    if (isSolid(b) && b !== Block.Barrier) { blocked++; console.log('Bridge camera sight line blocked', {x, y, z}); break; }
  }
}
if (blocked) throw new Error(`${blocked} planned camera positions intersect scenery.`);
