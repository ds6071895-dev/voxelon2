import {
  createInitialPoliticsState,
  createParty,
  castVote,
  resolveElection,
  setTaxRate,
  allocateKitStock,
  claimStarterKit,
  formatTermRemaining,
} from '../src/politics';
import { defaultCosmetics } from '../src/character';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('Testing politics.ts...');

const now = 1000000;
const state = createInitialPoliticsState(now);

// Test party creation
const p1Res = createParty(
  state,
  0,
  'Alice',
  'Iron Vanguard',
  'Strength through Unity',
  ['Low Tax Target (3%) · Boost Private Miners'],
  defaultCosmetics(1)
);
assert(p1Res.ok, `Failed to create party p1: ${p1Res.error}`);

const p2Res = createParty(
  state,
  0,
  'Bob',
  'Phoenix Rising',
  'From Ashes to Glory',
  ['Balanced Tax (5%) · Steady Infrastructure'],
  defaultCosmetics(2)
);
assert(p2Res.ok, `Failed to create party p2: ${p2Res.error}`);

// Test duplicate party from Alice rejected
const p3Res = createParty(
  state,
  0,
  'Alice',
  'Second Party',
  'Trying again',
  [],
  defaultCosmetics(1)
);
assert(!p3Res.ok, 'Alice should not be able to create 2 parties');

// Test voting
const v1 = castVote(state, 0, 'Charlie', p1Res.party!.id);
assert(v1.ok, 'Charlie should be able to vote for p1');

// Double vote check
const v2 = castVote(state, 0, 'Charlie', p2Res.party!.id);
assert(!v2.ok, 'Charlie should not be able to vote twice');

// Another vote for p1
castVote(state, 0, 'Dave', p1Res.party!.id);

// Vote for p2
castVote(state, 0, 'Eve', p2Res.party!.id);

// Resolve election
const { winner, broadcast } = resolveElection(state, 0, now + 5000);
assert(winner !== null && winner.leader === 'Alice', 'Alice should win the election with 2 votes');
assert(state.elections[0].activePresident === 'Alice', 'Alice should be the active president');
assert(broadcast.text.includes('Alice'), 'Broadcast should mention Alice');

// President sets tax rate
const taxBad = setTaxRate(state, 0, 'Bob', 0.10);
assert(!taxBad.ok, 'Bob should not be able to set tax rate (not president)');

const taxGood = setTaxRate(state, 0, 'Alice', 0.08);
assert(taxGood.ok, 'Alice should be able to set tax rate');
assert(state.governments[0].taxRate === 0.08, 'Tax rate should be 0.08');

// Starter kit claims
const initialStock = state.governments[0].kitStock;
const kitClaim = claimStarterKit(state, 0);
assert(kitClaim.ok && kitClaim.kit !== undefined, 'Kit claim should succeed');
assert(state.governments[0].kitStock === initialStock - 1, 'Kit stock should decrement by 1');

// Term countdown format
const remainingStr = formatTermRemaining(now + 100000000, now);
assert(remainingStr.length > 0, 'Remaining string should not be empty');

console.log('All politics.ts tests passed successfully!');
