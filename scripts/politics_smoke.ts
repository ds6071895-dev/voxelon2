// Headless checks for FACTION GOVERNMENT: politics.ts, treasury.ts, and the
// authority the GameServer wraps them in.
//
// Runs with `npm run politics-smoke`.

import {
  MAX_BROADCASTS, MAX_PARTIES_PER_FACTION, MAX_PROMISES, MAX_TAX,
  PRESET_PROMISES, TERM_MS, ballotOf, castVote, disbandParty, foundParty,
  governmentOf, isPresident, newPolitics, partyOfFounder, pushBroadcast,
  rollCycle, sanitizeLabel, sanitizePolitics, sanitizePromises, setKit, setTaxRate,
  tallyElection, termExpired, voteCounts,
} from '../src/politics';
import {
  KIT_ARMOR_SLOTS, KIT_SLOTS, MAX_KIT_STACK, RAID_STACKS, STARTER_KIT,
  TREASURY_PAGES, TREASURY_PAGE_SLOTS, TREASURY_PEDESTALS, TREASURY_RING_RADIUS,
  TREASURY_SLOTS, canFundKits, countOf, deposit, fundKits, isTreasuryPage,
  kitCost, kitItemCount, kitSlotAccepts, kitStacks, levy, newKit, newTreasury,
  pedestalLocation, raid, sanitizeKit, sanitizeTreasury, setTreasuryPage,
  treasuryCount, treasuryInReach, treasuryLocation, treasuryPage, withdraw,
} from '../src/treasury';
import { flagHome } from '../src/flags';
import { Accounts } from '../src/net/accounts';
import { GameServer } from '../src/net/server_core';
import type { ClientMsg } from '../src/net/protocol';
import { FACTIONS, NO_FACTION } from '../src/teams';
import { ITEMS, Item, type ItemStack } from '../src/items';
import { Block } from '../src/blocks';

let passed = 0;
function check(name: string, ok: unknown, detail = ''): void {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  passed++;
}

const A = FACTIONS[0].id, B = FACTIONS[1].id;
const T0 = 1_700_000_000_000;
/** Characters a player must never be able to smuggle into a party name: a bidi
 *  mark that could reorder it, and a C0 control. Written as escapes so this file
 *  stays plain ASCII. */
const BIDI = '\u200E';
const CONTROL = '\u0007';

// --- Text handling -----------------------------------------------------------
{
  check('sanitizeLabel collapses whitespace and trims',
    sanitizeLabel('  The   Miners   Union  ', 40) === 'The Miners Union');
  check('sanitizeLabel strips markup, bidi marks and control characters',
    sanitizeLabel('<script>x</script>', 40) === 'scriptx/script' &&
    sanitizeLabel('a`b', 40) === 'ab' &&
    sanitizeLabel(`a${BIDI}b`, 40) === 'ab' &&
    sanitizeLabel(`a${CONTROL}b`, 40) === 'ab');
  check('sanitizeLabel caps length', sanitizeLabel('x'.repeat(200), 24).length === 24);
  check('sanitizeLabel refuses non-strings',
    sanitizeLabel(null, 20) === '' && sanitizeLabel(42 as unknown, 20) === '');
  check('promises are deduplicated, range-checked and capped',
    sanitizePromises([0, 0, 1, 2, 3, 99, -1, 1.5]).length === MAX_PROMISES &&
    sanitizePromises([0, 0, 1, 2, 3]).every((i) => i >= 0 && i < PRESET_PROMISES.length) &&
    sanitizePromises('nope').length === 0);
}

// --- Founding ----------------------------------------------------------------
{
  const st = newPolitics(T0);
  check('a fresh state has an election and a government per faction',
    FACTIONS.every((f) => !!st.elections[f.id] && !!st.governments[f.id]) &&
    st.elections[A].president === null);

  const ok = foundParty(st, A, 'Ada', 'Deep Shafts', 'Tunnels for everyone', [0, 2], T0);
  check('founding a party succeeds and returns it', ok.ok && ok.party?.name === 'Deep Shafts');
  check('one party per citizen',
    !foundParty(st, A, 'Ada', 'Second Try', 'Again', [1], T0).ok);
  check('a duplicate party name is refused',
    !foundParty(st, A, 'Bo', 'deep shafts', 'Copycat', [1], T0).ok);
  check('an empty name, slogan or promise list is refused',
    !foundParty(st, A, 'Bo', '  ', 'Slogan', [1], T0).ok &&
    !foundParty(st, A, 'Bo', 'Fine Name', '', [1], T0).ok &&
    !foundParty(st, A, 'Bo', 'Fine Name', 'Slogan', [], T0).ok);
  check('founding into a junk faction is refused',
    !foundParty(st, NO_FACTION, 'Bo', 'Name', 'Slogan', [1], T0).ok);
  check('promises are capped at founding',
    foundParty(st, A, 'Cy', 'Broad Church', 'Everything', [0, 1, 2, 3, 4, 5], T0)
      .party!.promises.length === MAX_PROMISES);

  // Fill the ballot.
  for (let i = 0; i < MAX_PARTIES_PER_FACTION; i++) {
    foundParty(st, A, `Filler${i}`, `Party ${i}`, 'Slogan', [1], T0);
  }
  check('the ballot is capped',
    st.elections[A].parties.length === MAX_PARTIES_PER_FACTION &&
    !foundParty(st, A, 'Late', 'Too Late', 'Slogan', [1], T0).ok);
  check('party ids are unique',
    new Set(st.elections[A].parties.map((p) => p.id)).size === st.elections[A].parties.length);
}

// --- Voting and the count ----------------------------------------------------
{
  const st = newPolitics(T0);
  const red = foundParty(st, A, 'Ada', 'Reds', 'Slogan', [0], T0).party!;
  const blue = foundParty(st, A, 'Bo', 'Blues', 'Slogan', [1], T0 + 5).party!;

  check('a vote for an unknown party is refused', !castVote(st, A, 'Cy', 'nope').ok);
  check('a vote is recorded once',
    castVote(st, A, 'Cy', red.id).ok && voteCounts(st.elections[A])[red.id] === 1);
  check('voting again MOVES the ballot instead of adding one',
    castVote(st, A, 'Cy', blue.id).ok &&
    voteCounts(st.elections[A])[red.id] === 0 &&
    voteCounts(st.elections[A])[blue.id] === 1 &&
    ballotOf(st.elections[A], 'Cy') === blue.id);
  check('a username is a case-insensitive identity at the ballot box',
    (castVote(st, A, 'CY', blue.id), Object.keys(st.elections[A].votes).length === 1));

  castVote(st, A, 'Dee', red.id);
  castVote(st, A, 'Eli', red.id);
  const won = tallyElection(st.elections[A]);
  check('the most-voted party seats its founder',
    won.president === 'Ada' && st.elections[A].president === 'Ada' &&
    st.elections[A].presidentPartyId === red.id);
  check('isPresident is case-insensitive and faction-scoped',
    isPresident(st, A, 'ada') && !isPresident(st, A, 'Bo') && !isPresident(st, B, 'Ada'));

  // A tie goes to the party that stood first.
  const tie = newPolitics(T0);
  const first = foundParty(tie, A, 'Early', 'First', 'Slogan', [0], T0).party!;
  foundParty(tie, A, 'Later', 'Second', 'Slogan', [1], T0 + 1000);
  castVote(tie, A, 'V1', first.id);
  castVote(tie, A, 'V2', tie.elections[A].parties[1].id);
  check('a tie breaks to the party that stood first',
    tallyElection(tie.elections[A]).president === 'Early');

  // Nobody voting changes nothing.
  const quiet = newPolitics(T0);
  foundParty(quiet, A, 'Nobody', 'Ignored', 'Slogan', [0], T0);
  check('a count with no votes leaves the seat exactly as it was',
    tallyElection(quiet.elections[A]).president === null &&
    quiet.elections[A].president === null);
  quiet.elections[A].president = 'Sitting';
  check('an incumbent is not unseated by apathy',
    tallyElection(quiet.elections[A]).president === 'Sitting');
}

// --- Terms -------------------------------------------------------------------
{
  const st = newPolitics(T0);
  const p = foundParty(st, A, 'Ada', 'Reds', 'Slogan', [0], T0).party!;
  castVote(st, A, 'Cy', p.id);
  check('a term is not expired before its deadline',
    !termExpired(st.elections[A], T0 + TERM_MS - 1) &&
    termExpired(st.elections[A], T0 + TERM_MS));
  tallyElection(st.elections[A]);
  rollCycle(st.elections[A], T0 + TERM_MS);
  check('a new cycle clears the ballots, keeps the parties and reseats the clock',
    st.elections[A].cycle === 2 &&
    Object.keys(st.elections[A].votes).length === 0 &&
    st.elections[A].parties.length === 1 &&
    st.elections[A].endsAt === T0 + TERM_MS * 2 &&
    st.elections[A].president === 'Ada');
}

// --- Withdrawing -------------------------------------------------------------
{
  const st = newPolitics(T0);
  const p = foundParty(st, A, 'Ada', 'Reds', 'Slogan', [0], T0).party!;
  castVote(st, A, 'Cy', p.id);
  check('only the founder can withdraw, and only a real party',
    !disbandParty(st, A, 'Someone').ok && disbandParty(st, A, 'Ada').ok);
  check('withdrawing releases the ballots cast for it rather than losing them',
    st.elections[A].parties.length === 0 && ballotOf(st.elections[A], 'Cy') === null);
  check('a founder may stand again after withdrawing',
    foundParty(st, A, 'Ada', 'Reds II', 'Slogan', [0], T0).ok &&
    !!partyOfFounder(st.elections[A], 'Ada'));
}

// --- Tax and broadcasts ------------------------------------------------------
{
  const st = newPolitics(T0);
  const g = governmentOf(st, A)!;
  check('the tax rate is clamped into range',
    (setTaxRate(g, 0.9), g.taxRate === MAX_TAX) &&
    (setTaxRate(g, -1), g.taxRate === 0) &&
    !setTaxRate(g, NaN).ok);
  check('an empty broadcast is refused', !pushBroadcast(g, 'Ada', '   ', T0, 1).ok);
  for (let i = 0; i < MAX_BROADCASTS + 6; i++) pushBroadcast(g, 'Ada', `msg ${i}`, T0 + i, i);
  check('the broadcast ring is capped and keeps the NEWEST',
    g.broadcasts.length === MAX_BROADCASTS &&
    g.broadcasts[g.broadcasts.length - 1].text === `msg ${MAX_BROADCASTS + 5}`);
}

// --- The levy ----------------------------------------------------------------
{
  check('a zero rate takes nothing', levy(64, 0, 0) === 0 && levy(64, 0, 0.99) === 0);
  check('the levy never takes a whole stack, whatever the rate',
    levy(1, 1, 0) === 0 && levy(4, 1, 0) === 3 && levy(64, MAX_TAX, 0) < 64);
  check('the fractional remainder is settled by the roll, not rounded away',
    levy(10, 0.05, 0.4) === 1 && levy(10, 0.05, 0.9) === 0);
  check('junk inputs take nothing',
    levy(NaN, 0.1, 0) === 0 && levy(-5, 0.1, 0) === 0 && levy(10, NaN, 0) === 0);
  // Nothing is minted and nothing vanishes across the whole range.
  let conserved = true;
  for (let n = 1; n <= 64; n++) {
    for (const rate of [0.01, 0.05, 0.1, MAX_TAX]) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        const cut = levy(n, rate, roll);
        if (cut < 0 || cut >= n || !Number.isInteger(cut)) conserved = false;
      }
    }
  }
  check('the levy conserves items across every count and rate', conserved);
}

// --- The strongbox -----------------------------------------------------------
{
  check('a treasury sits beside its own flag pad', FACTIONS.every((f) => {
    const home = flagHome(f.id), loc = treasuryLocation(f.id);
    return Math.abs(loc.x - home.x) + Math.abs(loc.z - home.z) > 0 &&
      Math.hypot(loc.x - home.x, loc.z - home.z) < 6;
  }));
  const loc = treasuryLocation(A);
  check('reach is decided from the pad, not from the whole map',
    treasuryInReach(loc.x, loc.z) === A && treasuryInReach(loc.x + 999, loc.z) === null);

  const t = newTreasury(A);
  check('deposits stack and report the overflow',
    deposit(t, Item.CobaltIngot, 100) === 0 && countOf(t, Item.CobaltIngot) === 100);
  const max = ITEMS[Item.CobaltIngot].maxStack;
  const spill = deposit(t, Item.CobaltIngot, TREASURY_SLOTS * max);
  check('a full treasury hands the remainder BACK rather than eating it',
    spill > 0 && treasuryCount(t) === TREASURY_SLOTS * max);
  check('withdrawal takes exactly what was asked for',
    withdraw(t, Item.CobaltIngot, 10) === 10 &&
    treasuryCount(t) === TREASURY_SLOTS * max - 10);

  // Kit funding is all-or-nothing.
  const kt = newTreasury(A);
  check('an empty treasury cannot fund a kit',
    !canFundKits(kt, 1) && !fundKits(kt, 1) && !canFundKits(kt, 0));
  for (const line of kitCost()) deposit(kt, line.id, line.count * 2);
  check('funding pays the exact bill',
    canFundKits(kt, 2) && fundKits(kt, 2) &&
    kitCost().every((line) => countOf(kt, line.id) === 0));
  const partial = newTreasury(A);
  for (const line of kitCost()) deposit(partial, line.id, line.count);
  const before = treasuryCount(partial);
  check('an unaffordable funding changes NOTHING',
    !fundKits(partial, 2) && treasuryCount(partial) === before);
  check('the starter kit is made of real items',
    STARTER_KIT.every((line) => !!ITEMS[line.id] && line.count > 0));

  // --- The hoard as PAGES ----------------------------------------------------
  check('the hoard is a whole number of chest-shaped pages',
    TREASURY_SLOTS === TREASURY_PAGE_SLOTS * TREASURY_PAGES &&
    isTreasuryPage(0) && isTreasuryPage(TREASURY_PAGES - 1) &&
    !isTreasuryPage(-1) && !isTreasuryPage(TREASURY_PAGES) && !isTreasuryPage(0.5));
  const pt = newTreasury(A);
  deposit(pt, Item.CobaltIngot, 5);
  check('a page is always chest-shaped, and an unreal page is empty',
    treasuryPage(pt.slots, 0).length === TREASURY_PAGE_SLOTS &&
    treasuryPage(pt.slots, 0)[0]?.count === 5 &&
    treasuryPage(pt.slots, 1).every((s) => s === null) &&
    treasuryPage(pt.slots, TREASURY_PAGES).every((s) => s === null));
  const edited = treasuryPage(pt.slots, 0);
  edited[0] = null;                                  // the president took it
  edited[4] = { id: Item.Bullet, count: 12 };        // and put this in
  edited[5] = { id: 123456, count: 3 } as ItemStack; // junk: never lands
  check('writing a page takes, gives and fail-closes line by line',
    setTreasuryPage(pt.slots, 0, edited) &&
    pt.slots[0] === null && pt.slots[4]?.id === Item.Bullet && pt.slots[5] === null &&
    treasuryCount(pt) === 12);
  check('a page write never reaches another page, and a bad page changes nothing',
    !setTreasuryPage(pt.slots, TREASURY_PAGES, edited) &&
    !setTreasuryPage(pt.slots, 0, 'not a page') &&
    pt.slots[TREASURY_PAGE_SLOTS] === null && treasuryCount(pt) === 12);
  check('a page write caps a line at the item\'s own stack limit',
    setTreasuryPage(pt.slots, 2, [{ id: Item.Bullet, count: 9999 }]) &&
    (pt.slots[TREASURY_PAGE_SLOTS * 2]?.count ?? 0) === ITEMS[Item.Bullet].maxStack);

  // --- The editable loadout --------------------------------------------------
  const kit = newKit();
  check('a fresh loadout is the classic starter kit, laid into the hotbar',
    kit.length === KIT_SLOTS &&
    kit.slice(0, KIT_ARMOR_SLOTS).every((s) => s === null) &&
    kitItemCount(kit) === STARTER_KIT.reduce((n, l) => n + l.count, 0));
  check('the default loadout costs exactly what the old fixed kit cost',
    kitCost(kitStacks(kit)).every((line) =>
      kitCost().some((l) => l.id === line.id && l.count === line.count)));

  check('an armor slot takes only the piece that belongs in it',
    kitSlotAccepts(0, Item.IronHelmet) && !kitSlotAccepts(0, Item.IronBoots) &&
    !kitSlotAccepts(0, Block.Torch) && kitSlotAccepts(KIT_ARMOR_SLOTS, Block.Torch));
  check('a slot outside the loadout is refused outright',
    !kitSlotAccepts(-1, Block.Torch) && !kitSlotAccepts(KIT_SLOTS, Block.Torch));

  // The sanitizer is what stands between the wire and the loadout, so it has to
  // DROP a bad line rather than relocate it or take the whole array down.
  const dirty = sanitizeKit([
    { id: Item.IronBoots, count: 1 },              // wrong armor slot -> dropped
    { id: Item.IronChestplate, count: 1 },         // right slot -> kept
    null, 'nonsense',
    { id: Block.Torch, count: 9999 },              // over the cap -> clamped
    { id: 999999, count: 1 },                      // not an item -> dropped
    { id: Block.Torch, count: 0 },                 // empty -> dropped
  ]);
  check('a malformed loadout line becomes a gap, never a crash or a move',
    dirty.length === KIT_SLOTS && dirty[0] === null &&
    dirty[1]?.id === Item.IronChestplate && dirty[2] === null && dirty[3] === null &&
    dirty[4]?.id === Block.Torch && dirty[5] === null && dirty[6] === null);
  check('a loadout line is capped at the kit ceiling',
    (dirty[4]?.count ?? 0) <= MAX_KIT_STACK);
  check('a loadout off a pre-kit save falls back to the starter kit',
    kitItemCount(sanitizeKit(undefined)) === kitItemCount(newKit()));

  const gov = governmentOf(newPolitics(T0), A)!;
  check('an empty loadout is refused — kitStock would count nothing',
    !setKit(gov, new Array(KIT_SLOTS).fill(null)).ok &&
    !setKit(gov, 'not an array').ok &&
    !setKit(gov, new Array(KIT_SLOTS + 1).fill(null)).ok);
  check('a valid loadout is adopted whole',
    setKit(gov, [{ id: Item.IronHelmet, count: 1 }]).ok &&
    gov.kit[0]?.id === Item.IronHelmet && kitItemCount(gov.kit) === 1);

  // --- The hoard ring --------------------------------------------------------
  check('every pedestal stands on the ring, and none on the strongbox axis',
    Array.from({ length: TREASURY_PEDESTALS }, (_, i) => pedestalLocation(A, i))
      .every((at) => {
        const home = flagHome(A);
        const r = Math.hypot(at.x - home.x, at.z - home.z);
        return Math.abs(r - TREASURY_RING_RADIUS) < 1e-6 &&
          Math.abs(at.z - home.z) > 0.4;   // never on the +/-X axis
      }));
  check('the whole ring is inside the reach the raid test uses',
    Array.from({ length: TREASURY_PEDESTALS }, (_, i) => pedestalLocation(A, i))
      .every((at) => treasuryInReach(at.x, at.z) === A));

  // Raiding.
  const victim = newTreasury(B);
  for (let i = 0; i < 10; i++) deposit(victim, Item.CobaltIngot, 64);
  const haul = raid(victim, 'Raider', T0, RAID_STACKS);
  check('a raid takes at most the stack cap and stamps who did it',
    haul.length === RAID_STACKS && victim.lastRaidBy === 'Raider' && victim.lastRaidAt === T0);
  const empty = newTreasury(B);
  check('raiding an empty strongbox takes nothing and stamps nothing',
    raid(empty, 'Raider', T0).length === 0 && empty.lastRaidAt === 0);
}

// --- Persistence -------------------------------------------------------------
{
  const st = newPolitics(T0);
  const p = foundParty(st, A, 'Ada', 'Reds', 'Slogan', [0, 1], T0).party!;
  castVote(st, A, 'Cy', p.id);
  tallyElection(st.elections[A]);
  setTaxRate(governmentOf(st, A)!, 0.1);
  pushBroadcast(governmentOf(st, A)!, 'Ada', 'Muster at the flag.', T0, 1);

  const back = sanitizePolitics(JSON.parse(JSON.stringify(st)), T0);
  check('politics survives a serialize round-trip',
    back.elections[A].president === 'Ada' &&
    back.elections[A].parties[0].promises.length === 2 &&
    back.governments[A].taxRate === 0.1 &&
    back.governments[A].broadcasts[0].text === 'Muster at the flag.' &&
    ballotOf(back.elections[A], 'Cy') === p.id);
  check('restored ids never collide with new ones',
    foundParty(back, A, 'New', 'Fresh', 'Slogan', [0], T0).party!.id !== p.id);
  check('junk loads fail closed into a usable fresh state',
    sanitizePolitics(null, T0).elections[A].president === null &&
    sanitizePolitics({ elections: 'nope' }, T0).governments[A].taxRate >= 0 &&
    sanitizePolitics({ elections: { [A]: { parties: [{ id: 5 }, null] } } }, T0)
      .elections[A].parties.length === 0);
  check('a ballot for a party that did not survive the load is dropped',
    sanitizePolitics({ elections: { [A]: { votes: { cy: 'ghost' } } } }, T0)
      .elections[A].votes.cy === undefined);
  check('a saved deadline in the far future is clamped to one term',
    sanitizePolitics({ elections: { [A]: { endsAt: T0 + TERM_MS * 50 } } }, T0)
      .elections[A].endsAt <= T0 + TERM_MS);

  const t = newTreasury(A);
  deposit(t, Item.CobaltIngot, 12);
  const rt = sanitizeTreasury(JSON.parse(JSON.stringify(t)), A);
  check('a treasury survives a round-trip and fails closed on junk',
    countOf(rt, Item.CobaltIngot) === 12 &&
    treasuryCount(sanitizeTreasury({ slots: [{ id: 99999, count: 4 }, 'x'] }, A)) === 0 &&
    treasuryCount(sanitizeTreasury(null, A)) === 0);
}

// --- Accounts: allegiance is permanent ---------------------------------------
{
  const hash = (p: string, s: string): string => `${p}:${s}`;
  const accs = new Accounts();
  accs.register('Ada', 'password', hash, 'salt');
  check('a new account has no faction', accs.get('Ada')!.faction === NO_FACTION);
  check('a pledge sticks', accs.pledge('Ada', B, T0).ok && accs.get('Ada')!.faction === B);
  check('a second pledge is refused', !accs.pledge('Ada', A, T0).ok);
  const reloaded = new Accounts(JSON.parse(JSON.stringify(accs.toJSON())));
  check('allegiance survives a reload and is still permanent',
    reloaded.get('Ada')!.faction === B && !reloaded.pledge('Ada', A, T0).ok);
}

// --- The server: authority ---------------------------------------------------
{
  const now = (): number => T0;
  const s = new GameServer(1337, () => 0.5, now);
  // Pledges and kits are account-backed; mirror that with in-memory hooks.
  const pledged = new Map<string, number>();
  const kits = new Set<string>();
  s.onPledge = (username, faction) => {
    if (pledged.has(username)) return false;
    pledged.set(username, faction);
    return true;
  };
  s.kitClaimed = (username) => kits.has(username);
  s.onClaimKit = (username) => (kits.has(username) ? false : (kits.add(username), true));

  s.addPlayer(1, { username: 'Ada', faction: NO_FACTION });
  s.addPlayer(2, { username: 'Bo', faction: NO_FACTION });

  check('an unpledged player cannot found a party',
    s.handle(1, { t: 'foundParty', name: 'Reds', slogan: 'Slogan', promises: [0] })
      .some((o) => o.msg.t === 'govErr'));

  const welcome = s.addPlayer(3, { username: 'Cy', faction: NO_FACTION })
    .find((o) => o.msg.t === 'welcome')!.msg;
  check('the welcome carries the politics state and the public dossiers',
    welcome.t === 'welcome' && !!welcome.politics &&
    welcome.factions.length === FACTIONS.length &&
    welcome.factions.every((f) => typeof f.treasuryCount === 'number'));

  check('pledging is accepted once and refused thereafter',
    s.handle(1, { t: 'pledgeFaction', faction: A }).some((o) => o.msg.t === 'pledged') &&
    s.handle(1, { t: 'pledgeFaction', faction: B }).some((o) => o.msg.t === 'govErr'));
  check('a junk faction is refused',
    s.handle(2, { t: 'pledgeFaction', faction: 99 }).some((o) => o.msg.t === 'govErr'));
  // A VACANT SEAT IS STILL JOINABLE. No election has been tallied at this point,
  // so neither faction has a president — the pledge must go through anyway, and
  // the dossiers must still carry citizens for the card's plinth to stand up.
  const vacantJoin = s.handle(2, { t: 'pledgeFaction', faction: A });
  const vacantSync = vacantJoin.find((o) => o.msg.t === 'politics')!.msg as
    Extract<typeof vacantJoin[number]['msg'], { t: 'politics' }>;
  check('a faction with no president is still joinable',
    vacantJoin.some((o) => o.msg.t === 'pledged') &&
    vacantSync.factions.every((f) => !f.president));
  check('a presidentless faction still publishes faces for its plinth',
    (vacantSync.factions.find((f) => f.faction === A)!.faces ?? [])
      .some((face) => face.username === 'Bo'));

  const founded = s.handle(1, {
    t: 'foundParty', name: 'Reds', slogan: 'Deep tunnels', promises: [0, 1],
  });
  check('founding a party syncs everyone and announces it',
    founded.some((o) => o.msg.t === 'politics') &&
    founded.some((o) => o.msg.t === 'notify' && o.msg.notif.kind === 'election'));
  const partyId = (founded.find((o) => o.msg.t === 'politics')!.msg as
    Extract<typeof founded[number]['msg'], { t: 'politics' }>).state.elections[A].parties[0].id;
  check('a vote through the wire is accepted',
    s.handle(2, { t: 'castVote', partyId }).some((o) => o.msg.t === 'politics'));

  // Only the president may govern.
  check('a citizen cannot set tax, broadcast or fund kits',
    s.handle(2, { t: 'govTax', rate: 0.1 }).some((o) => o.msg.t === 'govErr') &&
    s.handle(2, { t: 'govBroadcast', text: 'hi' }).some((o) => o.msg.t === 'govErr') &&
    s.handle(2, { t: 'govFundKits', count: 1 }).some((o) => o.msg.t === 'govErr'));

  const tallied = s.adminTallyElection(A);
  check('forcing the count seats the winner and tells the faction',
    tallied.some((o) => o.msg.t === 'notify' && o.msg.notif.kind === 'election'));
  check('the president may now set the tax',
    !s.handle(1, { t: 'govTax', rate: 0.1 }).some((o) => o.msg.t === 'govErr'));
  check('a broadcast reaches every citizen of the faction',
    s.handle(1, { t: 'govBroadcast', text: 'Muster at the flag.' })
      .filter((o) => o.msg.t === 'notify').length === 2);

  // Tax lands in the treasury on a HARVEST drop and nowhere else.
  const dropped = s.handle(1, {
    t: 'drop', items: [{ id: Block.Stone, count: 64 }], x: 0, y: 70, z: 0, reason: 'harvest',
  });
  const spawned = dropped.find((o) => o.msg.t === 'itemspawn')!.msg;
  check('a harvest drop is taxed on the way out of the world',
    spawned.t === 'itemspawn' && spawned.item.count < 64 && spawned.item.count > 0);
  const manual = s.handle(1, {
    t: 'drop', items: [{ id: Block.Stone, count: 64 }], x: 0, y: 70, z: 0, reason: 'manual',
  }).find((o) => o.msg.t === 'itemspawn')!.msg;
  check('emptying your own pockets is never taxed',
    manual.t === 'itemspawn' && manual.item.count === 64);

  // Kits: funded OUT OF THE PRESIDENT'S OWN INVENTORY, one per account. The
  // client has already taken the bill out of its pockets by the time the message
  // arrives, so the server only records the stock — the hoard is not a purse and
  // is not touched on the way, which is what the before/after count proves. A
  // stocked treasury here also stands in for the raid test further down.
  for (const line of kitCost()) s.adminDepositTreasury(A, line.id, line.count * 2);
  const bankedBefore = (s.addPlayer(8, { username: 'Obs', faction: A })
    .find((o) => o.msg.t === 'welcome')!.msg as { factions: { faction: number;
      treasuryCount: number }[] }).factions.find((f) => f.faction === A)!.treasuryCount;
  check('the president funds kits from their pockets and a citizen claims one',
    s.handle(1, { t: 'govFundKits', count: 2, source: 'inventory' })
      .some((o) => o.msg.t === 'politics') &&
    s.handle(2, { t: 'claimKit' }).some((o) => o.msg.t === 'gotitem') &&
    s.handle(2, { t: 'claimKit' }).some((o) => o.msg.t === 'govErr'));
  const bankedAfter = (s.addPlayer(10, { username: 'Obs2', faction: A })
    .find((o) => o.msg.t === 'welcome')!.msg as { factions: { faction: number;
      treasuryCount: number }[] }).factions.find((f) => f.faction === A)!.treasuryCount;
  check('funding kits never spends (or fills) the treasury', bankedAfter === bankedBefore);
  check('the retired treasury purse is refused rather than minting free kits',
    s.handle(1, { t: 'govFundKits', count: 1, source: 'treasury' } as unknown as ClientMsg)
      .some((o) => o.msg.t === 'govErr'));

  // The hoard opens as a CHEST, for the president, at the flag, and nowhere or
  // nobody else. `Ada` is the sitting president of A; `Bo` is a citizen of A.
  const padA = treasuryLocation(A);
  const atPad = (id: number): void => {
    s.handle(id, { t: 'xform', x: padA.x, y: 70, z: padA.z, yaw: 0, pitch: 0 });
  };
  atPad(2);
  check('a citizen standing at the flag cannot open the hoard',
    s.handle(2, { t: 'treasuryOpen', faction: A }).some((o) => o.msg.t === 'govErr'));
  s.handle(1, { t: 'xform', x: padA.x + 40, y: 70, z: padA.z, yaw: 0, pitch: 0 });
  check('the president cannot open it from a walk away',
    s.handle(1, { t: 'treasuryOpen', faction: A }).some((o) => o.msg.t === 'govErr'));
  atPad(1);
  const opened = s.handle(1, { t: 'treasuryOpen', faction: A })
    .find((o) => o.msg.t === 'treasury')?.msg;
  check('the president at the flag is handed the whole hoard',
    !!opened && opened.t === 'treasury' && opened.faction === A &&
    opened.slots.length === TREASURY_SLOTS);
  check('a president may not open the ENEMY hoard through this door',
    s.handle(1, { t: 'treasuryOpen', faction: B }).some((o) => o.msg.t === 'govErr'));

  // Writing a page back: president + in reach, one page at a time, fail-closed.
  const page1: (ItemStack | null)[] = new Array(TREASURY_PAGE_SLOTS).fill(null);
  page1[0] = { id: Item.CobaltIngot, count: 9 };
  page1[1] = { id: 999999, count: 4 } as ItemStack;       // junk id -> empty slot
  page1[2] = { id: Item.CobaltIngot, count: 0 } as ItemStack; // no count -> empty
  check('the president writes one page of the hoard and junk lines fail closed',
    s.handle(1, { t: 'treasurySet', faction: A, page: 1, slots: page1 })
      .some((o) => o.msg.t === 'politics'));
  const reread = s.handle(1, { t: 'treasuryOpen', faction: A })
    .find((o) => o.msg.t === 'treasury')!.msg as { slots: (ItemStack | null)[] };
  check('the write landed on page 1 only, one valid line of it',
    reread.slots[TREASURY_PAGE_SLOTS]?.id === Item.CobaltIngot &&
    reread.slots[TREASURY_PAGE_SLOTS]?.count === 9 &&
    reread.slots[TREASURY_PAGE_SLOTS + 1] === null &&
    reread.slots[TREASURY_PAGE_SLOTS + 2] === null);
  check('a page that does not exist is refused',
    s.handle(1, { t: 'treasurySet', faction: A, page: TREASURY_PAGES, slots: page1 })
      .some((o) => o.msg.t === 'govErr'));
  atPad(2);
  check('a citizen cannot write to the hoard at all',
    s.handle(2, { t: 'treasurySet', faction: A, page: 0, slots: page1 })
      .some((o) => o.msg.t === 'govErr'));

  // Raiding is war-only, enemy-only and in-reach-only.
  s.handle(3, { t: 'pledgeFaction', faction: B });
  const loc = treasuryLocation(A);
  check('a raid outside a war window is refused',
    s.handle(3, { t: 'treasuryRaid', faction: A }).some((o) => o.msg.t === 'govErr'));
  s.adminStartWar(60);
  check('a raid from across the map is refused',
    s.handle(3, { t: 'treasuryRaid', faction: A }).some((o) => o.msg.t === 'govErr'));
  s.handle(3, { t: 'xform', x: loc.x, y: 70, z: loc.z, yaw: 0, pitch: 0 });
  const robbed = s.handle(3, { t: 'treasuryRaid', faction: A });
  check('a raid at the pad during a war takes stacks and alarms the defenders',
    robbed.some((o) => o.msg.t === 'gotitem') &&
    robbed.some((o) => o.msg.t === 'treasuryRaided') &&
    robbed.some((o) => o.msg.t === 'notify' && o.msg.notif.kind === 'raid'));
  check('you can never rob your OWN strongbox',
    s.handle(1, { t: 'treasuryRaid', faction: A }).some((o) => o.msg.t === 'govErr'));

  // The world save carries it all.
  const save = JSON.parse(JSON.stringify(s.serialize()));
  check('the save carries politics and the treasuries', !!save.politics && !!save.treasuries);
  const restored = new GameServer(1337, () => 0.5, now);
  restored.restore(save);
  const after = restored.addPlayer(9, { username: 'Ada', faction: A })
    .find((o) => o.msg.t === 'welcome')!.msg;
  check('a restart keeps the president, the levy and the strongbox',
    after.t === 'welcome' &&
    after.politics.elections[A].president === 'Ada' &&
    after.politics.governments[A].taxRate === 0.1 &&
    (after.factions.find((f) => f.faction === A)?.treasuryCount ?? 0) > 0);

  const legacy = new GameServer(1337, () => 0.5, now);
  legacy.restore({
    v: 2, seed: 1337, worldTime: 5, edits: [], chests: [], machines: [], turrets: [],
  });
  const fresh = legacy.addPlayer(1, { username: 'Ada', faction: A })
    .find((o) => o.msg.t === 'welcome')!.msg;
  check('a v2 save loads with a fresh government rather than refusing',
    fresh.t === 'welcome' && fresh.politics.elections[A].president === null);
}

console.log(`Politics smoke: ${passed} checks passed`);
