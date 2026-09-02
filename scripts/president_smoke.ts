import { validateText } from '../src/content_filter';
import {
  createInitialPoliticsState,
  createParty,
  castVote,
  resolveElection,
  setTaxRate,
  allocateKitStock,
  claimStarterKit,
  addBroadcast,
  formatTermRemaining,
} from '../src/politics';
import {
  createTreasury,
  levyTax,
  canStealTreasury,
  stealFromTreasury,
  depositToTreasury,
  treasuryLocation,
} from '../src/treasury';
import { defaultCosmetics } from '../src/character';
import { GameServer } from '../src/net/server_core';
import { mulberry32 } from '../src/noise';
import { Item } from '../src/items';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

console.log('\n--- 1. Testing Zero-Cost Content Filter ---');
// Prohibited terms
assert(!validateText('United States Party', 'Party Name').ok, 'Blocks real country (United States)');
assert(!validateText('French Legion', 'Party Name').ok, 'Blocks demonym (French)');
assert(!validateText('London Underground', 'Party Name').ok, 'Blocks real world city (London)');
assert(!validateText('Vote for Donald Trump', 'Campaign Slogan').ok, 'Blocks political figure (Donald Trump)');
assert(!validateText('Communist Union', 'Party Name').ok, 'Blocks political ideology (Communist)');
assert(!validateText('Nazi Regime', 'Party Name').ok, 'Blocks hate/extremist term (Nazi)');

// Leetspeak and evasion
assert(!validateText('R.u.s.s.i.a', 'Party Name').ok, 'Blocks dotted country evasion (R.u.s.s.i.a)');
assert(!validateText('Am3r1ca', 'Party Name').ok, 'Blocks leetspeak country (Am3r1ca)');
assert(!validateText('f u c k', 'Campaign Slogan').ok, 'Blocks spaced profanity');
assert(!validateText('fuuuuck', 'Campaign Slogan').ok, 'Blocks repeated character profanity');

// Benign names
assert(validateText('Crimson Vanguard Alliance', 'Party Name').ok, 'Allows benign fantasy faction party');
assert(validateText('Iron Brotherhood', 'Party Name').ok, 'Allows Iron Brotherhood');
assert(validateText('Defend the Realm and Slay the Bosses', 'Campaign Slogan').ok, 'Allows game-themed campaign slogan');

console.log('\n--- 2. Testing Politics & Election Engine ---');
const now = Date.now();
const politics = createInitialPoliticsState(now);
assert(politics.elections[0] !== undefined, 'Crimson election initialized');
assert(politics.elections[1] !== undefined, 'Azure election initialized');

const cosmetics = defaultCosmetics(42);
const partyReg = createParty(
  politics,
  0,
  'Arthur',
  'Solar Concord',
  'Peace through superior defense and prosperous trade',
  ['Fund 20 recruit starter kits', 'Maintain tax rate under 5%'],
  cosmetics
);
assert(partyReg.ok, 'Arthur successfully founded Solar Concord party');
assert(politics.elections[0].parties.length === 1, 'Party registered in Crimson election');

// Duplicate party restriction
const dupReg = createParty(
  politics,
  0,
  'Arthur',
  'Another Party',
  'Should fail duplicate candidate check',
  ['Empty promise'],
  cosmetics
);
assert(!dupReg.ok, 'Enforces 1 candidate/party per player constraint');

// Second party by different player
const party2Reg = createParty(
  politics,
  0,
  'Galahad',
  'Shield Bearers',
  'Fortify all base defenses against enemy incursions',
  ['Upgrade all base turrets', 'Sponsor iron armor for recruits'],
  cosmetics
);
assert(party2Reg.ok, 'Galahad founded second party');

// Voting
const v1 = castVote(politics, 0, 'Citizen1', partyReg.party!.id);
assert(v1.ok, 'Citizen1 voted for Solar Concord');
const vDup = castVote(politics, 0, 'Citizen1', party2Reg.party!.id);
assert(!vDup.ok, 'Citizen1 cannot vote twice in the same election');
const v2 = castVote(politics, 0, 'Citizen2', partyReg.party!.id);
assert(v2.ok, 'Citizen2 voted for Solar Concord');
const v3 = castVote(politics, 0, 'Citizen3', party2Reg.party!.id);
assert(v3.ok, 'Citizen3 voted for Shield Bearers');

// Election resolution
const termEnd = now + 7 * 24 * 3600 * 1000 + 1000;
const outcome = resolveElection(politics, 0, termEnd);
assert(outcome.winner?.leader === 'Arthur', 'Arthur won the election with 2 votes vs 1');
assert(politics.elections[0].activePresident === 'Arthur', 'Arthur set as active Crimson President');
assert(politics.elections[0].parties.length === 0, 'Parties cleared for new cycle');

// Presidential Powers: Tax rate
assert(!setTaxRate(politics, 0, 'Imposter', 0.1).ok, 'Non-president cannot set tax rate');
const taxSet = setTaxRate(politics, 0, 'Arthur', 0.08);
assert(taxSet.ok, 'President Arthur set tax rate to 8%');
setTaxRate(politics, 0, 'Arthur', 0.5);
assert(politics.governments[0].taxRate === 0.15, 'Tax rate clamped to max 15%');

// Presidential Powers: Starter Kits
const alloc = allocateKitStock(politics, 0, 'Arthur', 15);
assert(alloc.ok, 'President Arthur allocated 15 recruit starter kits');
assert(politics.governments[0].kitStock === 40, 'Recruit kit stock is now 40 (25 initial + 15 allocated)');
const kitClaim = claimStarterKit(politics, 0);
assert(kitClaim !== null, 'New recruit claimed starter kit');
assert(politics.governments[0].kitStock === 39, 'Kit stock decremented to 39');

// Presidential Powers: Faction Broadcast
const bc = addBroadcast(politics, 0, 'Arthur', 'Citizens: Prepare base defenses, war is coming!');
assert(bc.ok, 'President Arthur dispatched faction broadcast');
assert(politics.governments[0].broadcasts.length >= 2, 'Broadcast stored in history');

console.log('\n--- 3. Testing Faction Treasury & War Window Theft ---');
const treasury = createTreasury(0);
assert(treasury.faction === 0, 'Treasury created for Crimson');

// Item taxation
const taxResult = levyTax(0.10, Item.Diamond, 20);
assert(taxResult.treasuryGets === 2, '10% tax on 20 diamonds yields 2 for treasury');
assert(taxResult.playerGets === 18, 'Player retains 18 diamonds');
depositToTreasury(treasury, Item.Diamond, 2);
depositToTreasury(treasury, Item.GoldIngot, 16);
assert(treasury.totalTaxIntake === 18, 'Treasury intake recorded 18 items');

// Treasury Theft Rules
assert(!canStealTreasury(1, 0, false), 'Enemy player CANNOT steal treasury during peacetime');
assert(!canStealTreasury(0, 0, true), 'Friendly player CANNOT steal own treasury during war');
assert(canStealTreasury(1, 0, true), 'Enemy player CAN steal treasury during active war window');

// Executing raid
const raid = stealFromTreasury(treasury, 'RaiderBob', 3);
assert(raid.alarm, 'Raid triggered base emergency alarm');
assert(raid.stolen.length > 0, 'Enemy raider acquired stolen items');
assert(treasury.lastRaidBy === 'RaiderBob', 'Treasury recorded last raider');

console.log('\n--- 4. Testing Network & Server Integration ---');
const server = new GameServer(9999, mulberry32(12345));
const p1Join = server.addPlayer(1, { username: 'Lancelot', faction: -1 });
assert(p1Join.some((o) => o.msg.t === 'welcome' && (o.msg as any).politics !== undefined), 'Welcome packet includes initial politics state');

// Choose faction via protocol
const choosePledge = server.handle(1, { t: 'chooseFaction', faction: 0 });
assert(choosePledge.some((o) => o.msg.t === 'politicsSync'), 'Pledging allegiance syncs politics to all');
assert(choosePledge.some((o) => o.msg.t === 'notificationMsg'), 'Pledging allegiance sends welcome notification');

// Party creation via wire
const wireParty = server.handle(1, {
  t: 'createParty',
  name: 'Round Table',
  slogan: 'Chivalry and valor across the frontier',
  promises: ['Protect the Heartland'],
});
assert(wireParty.some((o) => o.msg.t === 'politicsSync'), 'Party created over network and broadcast');

// Treasury steal during peacetime vs war
const p2Join = server.addPlayer(2, { username: 'Invader', faction: 1 });
const tLoc = treasuryLocation(0);
// Position invader near Crimson treasury
server.handle(2, { t: 'xform', x: tLoc.x + 1, y: 64, z: tLoc.z + 1, yaw: 0, pitch: 0 });

// Peacetime theft attempt
const peaceSteal = server.handle(2, { t: 'treasurySteal', faction: 0 });
assert(peaceSteal.some((o) => o.msg.t === 'notice' && (o.msg as any).text.includes('war window')), 'Server rejected peacetime treasury steal');

// Start war
server.adminStartWar(120);
const warSteal = server.handle(2, { t: 'treasurySteal', faction: 0 });
assert(warSteal.some((o) => o.msg.t === 'gotitem' || o.msg.t === 'notice'), 'Server handled wartime treasury steal');

// --- Secret ballot -------------------------------------------------------
// politicsSync fans out to every client. It must never carry the faction's
// voter register: a player may see their OWN ballot and nobody else's.
const voter = server.addPlayer(3, { username: 'Voter', faction: 0 });
assert(voter.length > 0, 'Third player joined');

// "Round Table" was registered by player 1 above; player 3 votes for it.
const partyId: string | null = (() => {
  for (const o of wireParty) {
    if (o.msg.t !== 'politicsSync') continue;
    const parties = (o.msg as any).state.elections[0].parties;
    if (parties.length) return parties[parties.length - 1].id as string;
  }
  return null;
})();
assert(partyId !== null, 'Found the registered party on the ballot');

const cast = server.handle(3, { t: 'voteParty', partyId: partyId! });
let checkedSyncs = 0;
for (const o of cast) {
  if (o.msg.t !== 'politicsSync') continue;
  checkedSyncs++;
  for (const party of (o.msg as any).state.elections[0].parties) {
    if (o.to === 3) continue; // the voter's own copy may name the voter
    assert(party.voters.length === 0,
      `politicsSync to client ${o.to} carries no other player's ballot`);
  }
}
assert(checkedSyncs > 0, 'Vote produced politics syncs to inspect');

const mine = cast.find((o) => o.to === 3 && o.msg.t === 'politicsSync');
assert(!!mine, 'Voter receives their own politics sync');
assert((mine!.msg as any).state.elections[0].parties.some(
  (p: any) => p.voters.includes('voter')), 'Voter can still see their own ballot');
console.log("✅ PASS: politicsSync redacts other players' ballots");

// --- Raid throttle -------------------------------------------------------
// Back-to-back raids must be refused, or a client can drain the vault in one
// frame and bury the defenders in alarms.
const rapid = server.handle(2, { t: 'treasurySteal', faction: 0 });
assert(rapid.every((o) => o.msg.t !== 'gotitem'), 'Second immediate raid yields no loot');
console.log('✅ PASS: Treasury raids are rate limited');

console.log('\n✨ ALL PRESIDENT SYSTEM TESTS PASSED SUCCESSFULLY! ✨\n');
