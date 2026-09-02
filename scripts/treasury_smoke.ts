import {
  createTreasury,
  treasuryLocation,
  levyTax,
  depositToTreasury,
  canStealTreasury,
  stealFromTreasury,
  treasuryItemCount,
} from '../src/treasury';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('Testing treasury.ts...');

const loc0 = treasuryLocation(0);
const loc1 = treasuryLocation(1);
assert(loc0.x !== loc1.x, 'Treasury locations should differ between factions');

// Taxation test
const tax5 = levyTax(0.05, 102, 100);
assert(tax5.treasuryGets === 5 && tax5.playerGets === 95, `Taxed: ${tax5.treasuryGets}, Player: ${tax5.playerGets}`);

// Treasury deposit test
const t0 = createTreasury(0);
depositToTreasury(t0, 102, 60);
assert(treasuryItemCount(t0) === 60, 'Treasury should hold 60 items');

// Theft rules
// 1. Defending player cannot steal (they are friendly)
assert(!canStealTreasury(0, 0, true), 'Friendly player cannot steal own treasury');

// 2. Enemy during peacetime cannot steal
assert(!canStealTreasury(1, 0, false), 'Enemy cannot steal during peacetime');

// 3. Enemy during war CAN steal
assert(canStealTreasury(1, 0, true), 'Enemy should be able to steal during active war');

// Execute raid
const raid = stealFromTreasury(t0, 'RaiderBob');
assert(raid.alarm && raid.stolen.length > 0, 'Raid should trigger alarm and yield stolen items');
assert(treasuryItemCount(t0) === 0, 'Treasury should be looted');

console.log('All treasury.ts tests passed successfully!');
