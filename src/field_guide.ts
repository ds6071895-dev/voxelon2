import { Item, ITEMS } from './items';
import { RUNES } from './runes';
import { VAULT_BOSS_NAMES } from './vaults';

export interface FieldGuideEntry {
  id: string;
  title: string;
  keywords: string[];
  html: string;
}

export interface FieldGuideSection {
  id: string;
  title: string;
  icon: string;
  summary: string;
  entries: FieldGuideEntry[];
}

type GuideIcon = 'start' | 'target' | 'controls' | 'pickaxe' | 'flag' | 'building' |
  'vault' | 'skull' | 'weapon' | 'heart' | 'machine' | 'travel' | 'team' |
  'help' | 'tip' | 'warning';

const ICON_PATHS: Record<GuideIcon, string> = {
  start: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  controls: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h2m2 0h2m2 0h2M7 13h2m2 0h6M7 16h10"/>',
  pickaxe: '<path d="m14 5 5 5M5 19 16 8M9 4c4-2 8-1 11 2l-3 3c-2-2-5-3-8-2L9 4Z"/>',
  flag: '<path d="M5 22V3m0 2h11l-2 4 2 4H5"/>',
  building: '<path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5M8 10h2m4 0h2"/>',
  vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v4l3 2M3 8h2m14 0h2M3 16h2m14 0h2"/>',
  skull: '<path d="M5 11a7 7 0 1 1 14 0c0 3-1 5-3 6v3H8v-3c-2-1-3-3-3-6Z"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/><path d="m10 16 2-2 2 2m-4 4v-2m4 2v-2"/>',
  weapon: '<path d="M3 13h11l4-4h3v6h-4l-2 2h-4l-2 4H6l1-6H3v-2Zm4 0V9h4v4"/>',
  heart: '<path d="M20.8 5.7a5.5 5.5 0 0 0-7.8 0L12 6.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"/>',
  machine: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1m0-14.2L17 7M7 17l-2.1 2.1"/>',
  travel: '<path d="m21 3-7 18-3-8-8-3 18-7Z"/>',
  team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7m0-6c4 0 6 2 6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.3 1-1.3 2.4M12 17h.01"/>',
  tip: '<path d="M9 18h6m-5 3h4M8.5 15.5A7 7 0 1 1 15.5 15.5c-.8.6-1 1.3-1 2.5h-5c0-1.2-.2-1.9-1-2.5Z"/>',
  warning: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
};

const icon = (name: GuideIcon, label?: string): string =>
  `<svg class="field-guide-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}>${ICON_PATHS[name]}</svg>`;

export interface FieldGuideController {
  readonly open: boolean;
  show(): void;
  backToPause(): void;
  closeForResume(): void;
  closeSilently(): void;
  destroy(): void;
}

export interface FieldGuideOptions {
  root: HTMLElement;
  multiplayerActive: () => boolean;
  onBackToPause: () => void;
  onResume: () => void;
}

const esc = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]!));

const list = (items: string[]): string => `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
const steps = (items: string[]): string => `<ol class="field-guide-steps">${items.map((item) => `<li>${item}</li>`).join('')}</ol>`;
const tip = (title: string, body: string): string => `<aside class="field-guide-callout tip">${icon('tip')}<strong>${title}</strong><p>${body}</p></aside>`;
const warning = (title: string, body: string): string => `<aside class="field-guide-callout warning">${icon('warning')}<strong>${title}</strong><p>${body}</p></aside>`;
const table = (headers: string[], rows: string[][]): string => `<div class="field-guide-table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const entry = (id: string, title: string, keywords: string[], html: string): FieldGuideEntry => ({ id, title, keywords, html });

function weaponRows(): string[][] {
  const ids = [Item.Pistol, Item.Rifle, Item.Shotgun, Item.SMG, Item.Sniper,
    Item.BurstRifle, Item.RocketLauncher, Item.Grenade, Item.OilBomb, Item.C4,
    Item.DeployCover, Item.GrapplingHook, Item.SentryKit, Item.WarHorn];
  return ids.map((id) => {
    const def = ITEMS[id];
    if (!def) return [String(id), 'Registry entry unavailable', '—', '—'];
    if (def.gun) {
      const rate = def.gun.cooldown > 0 ? `${(1 / def.gun.cooldown).toFixed(1)}/s` : '—';
      return [esc(def.name), `${def.gun.damage} damage`, `${def.gun.range} blocks`, `${def.gun.mag} rounds · ${rate}`];
    }
    if (def.tool) return [esc(def.name), `${def.tool.damage} melee damage`, 'Close', `${def.tool.durability} durability`];
    return [esc(def.name), 'Tactical gadget', 'Contextual', `Stack ${def.maxStack}`];
  });
}

/** Live rune stats, straight out of the registry so the guide can never drift
 *  from the real bonuses (same "source of truth" rule as weaponRows). */
function runeRows(ids: number[]): string[][] {
  return ids.map((id) => {
    const def = RUNES[id];
    if (!def) return [String(id), 'Registry entry unavailable'];
    return [esc(def.name), esc(def.desc.replace(/^.*?:\s*/, ''))];
  });
}

function bossName(index: number, fallback: string): string {
  const values = Object.values(VAULT_BOSS_NAMES) as string[];
  return values[index] ?? fallback;
}

export function fieldGuideSections(): FieldGuideSection[] {
  // Every boss is built around ONE dodge habit, and every boss fights in its own
  // room. Learn the habit and the room stops mattering; learn neither and the
  // room will teach you.
  const bosses = [
    [bossName(0, 'Bone Warden'), 'The Sunken Nave — a tall pillared cathedral with three long lanes', 'Chain sweeps, marching lanes and grave tolls, all aimed dead ahead', 'Sustained rifle or SMG', 'SIDESTEP. Fight from its flank: everything it throws is aimed straight forward, so moving sideways beats moving backwards.'],
    [bossName(1, 'Mire Queen'), 'The Drowned Ring — a round court inside a wading moat', 'Sinkholes under your feet, expanding tide rings and a serpent lunge', 'Mobile automatic weapon', 'KEEP MOVING. She aims where you ARE. Walk a constant circle, cross rings as they pass, and punish her after the lunge.'],
    [bossName(2, 'Ember Colossus'), 'The Walking Caldera — a clipped octagon rimmed with open lava', 'Crater stomps, vent rows, meteors, and a worldfire rim/core pair', 'Strong sustained ranged DPS', 'READ EARLY. It is enormous and slow. Start moving the moment the floor lights and it will never touch you.'],
    [bossName(3, 'Crystal Seer'), 'The Observatory — a mirrored dome ringed with obelisks', 'Thin beam lattices, paradox rings and falling shards, cast fast', 'Accurate ranged weapon', 'REACT SMALL. Its beams are narrow. Step to the edge of a lane instead of sprinting across the room.'],
    [bossName(4, 'Gilded Artificer'), 'The Assembly Hall — a machine floor under a working gantry', 'Grid rows, gear rings, crusher gaps and a quarter-floor audit', 'High sustained DPS', 'COUNT. It works to a rhythm. Watch one cycle without attacking, then stand inside the machine and take the gap it always leaves.'],
  ];

  return [
    {
      id: 'start', title: 'Start Here', icon: icon('start'), summary: 'Your first ten minutes and the safest route into the war.', entries: [
        entry('first-ten', 'Your first ten minutes', ['beginner', 'wood', 'iron', 'starter', 'first vault'],
          steps(['Gather wood and craft planks.', 'Build a workbench and basic tools.', 'Mine stone and coal; craft torches.', 'Find iron and upgrade tools and armor.', 'Carry bandages and obtain a ranged weapon.', 'Identify your faction base and flag.', 'Prepare for a Tier I vault.']) +
          tip('Starter route', 'Gather → Craft → Gear Up → Find Your Faction → Prepare for a Tier I Vault.')),
        entry('starter-checklist', 'Starter checklist', ['checklist', 'logs', 'torches', 'armor', 'bandages'],
          list(['Collect logs and craft planks.', 'Craft a workbench and pickaxe.', 'Mine stone and coal; make torches.', 'Smelt iron and equip armor.', 'Carry a ranged weapon and bandages.', 'Locate a vault.']) +
          warning('Avoid early losses', 'Do not enter a deep vault without healing, carry every valuable resource into risky exploration, or leave your faction flag undefended.')),
      ],
    },
    {
      id: 'objective', title: 'Main Objective', icon: icon('target'), summary: 'How survival, progression, factions, vaults, and warfare connect.', entries: [
        entry('game-loop', 'What am I trying to do?', ['objective', 'gameplay loop', 'season', 'faction'],
          `<p>Survive, improve your equipment, strengthen your faction, defend your flag, raid enemy infrastructure, clear vaults, defeat bosses, and turn rare loot into lasting strategic power.</p>` +
          tip('Core loop', 'Gather → Build → Gear Up → Explore → Clear Vaults → Defend Flag → Raid Enemies → Strengthen Faction.')),
      ],
    },
    {
      id: 'controls', title: 'Controls', icon: icon('controls'), summary: 'Desktop and mobile controls, plus contextual behavior.', entries: [
        entry('desktop-controls', 'Desktop controls', ['keyboard', 'mouse', 'wasd', 'reload', 'inventory'],
          table(['Action', 'Binding'], [['Move', 'W A S D'], ['Jump / glide', 'Space'], ['Sprint', 'Q or double-tap W'], ['Sneak', 'Shift'], ['Attack / mine', 'Left click'], ['Place / use / aim', 'Right click'], ['Inventory', 'E'], ['Map', 'M'], ['Warfare Command', 'G'], ['Leave vehicle', 'F'], ['Reload', 'R'], ['Pause', 'Esc']]) +
          tip('Context matters', 'Left click may hit an enemy before the block behind it. Right click changes behavior based on the held item.')),
        entry('mobile-controls', 'Mobile controls', ['touch', 'joystick', 'phone', 'tablet'],
          table(['Action', 'Control'], [['Move / sprint', 'Left joystick; push beyond rim to sprint'], ['Look', 'Drag the right side'], ['Jump / glide', 'Up control'], ['Attack / mine', 'Long-press'], ['Place / use', 'Tap'], ['Inventory', 'Backpack button'], ['Map', 'Map button'], ['Warfare Command', 'Command button'], ['Pause / back', 'Pause button']]))
      ],
    },
    {
      id: 'survival', title: 'Survival & Progression', icon: icon('pickaxe'), summary: 'Resources, tools, armor, runes, and healing.', entries: [
        entry('resource-progression', 'Resource and armor progression', ['wood', 'stone', 'iron', 'diamond', 'titanium', 'cobalt', 'armor'],
          table(['Stage', 'Practical role'], [['Wood', 'Emergency tools and starter protection'], ['Stone', 'Early mining and Tier I preparation'], ['Iron', 'Reliable Tier I and entry Tier II gear'], ['Diamond', 'Strong Tier II and possible Tier III gear'], ['Titanium', 'Safest high-tier combat armor'], ['Cobalt / oil / crystal', 'Advanced machines, warfare, and specialist crafting']]) +
          tip('Armor systems', 'Armor has durability, gains levels through use, accepts runes, and is subject to a damage-reduction cap.')),
        entry('healing', 'Healing in combat', ['bandage', 'medkit', 'regen', 'heal'],
          `<p>Bandages are efficient for routine recovery. Medkits are your emergency sustain during vault bosses and raids. Heal during safe movement windows rather than while standing in a telegraphed attack.</p>` +
          warning('High-tier vaults', 'Tier II and III fights last longer and punish mistakes harder. Carry multiple healing items and keep inventory space free.')),
      ],
    },
    {
      id: 'factions', title: 'Factions & Flags', icon: icon('flag'), summary: 'The central strategic objective of the season.', entries: [
        entry('flag-defense', 'Protecting the faction flag', ['flag', 'defense', 'fortress', 'faction'],
          steps(['Create an outer warning zone with lighting and clear sightlines.', 'Build a delay zone with wire, tar, bear traps, barricades, and narrow approaches.', 'Layer a damage zone with spikes, mines, turrets, wall traps, and fall traps.', 'Reinforce the inner flag room with controlled entrances, defender cover, and an escape route.']) +
          warning('Do not trap your own team', 'Keep friendly routes open, split supplies across multiple caches, and repair walls and traps after every attack.')),
        entry('flag-raids', 'Attacking enemy flags', ['raid', 'enemy flag', 'scout', 'war'],
          list(['Scout before committing.', 'Identify traps and alternate approaches.', 'Bring healing, ammunition, and deployable cover.', 'Suppress defenders with ranged fire.', 'Plan transport and escape before taking the flag.'])),
      ],
    },
    {
      id: 'defenses', title: 'Building & Defenses', icon: icon('building'), summary: 'Layered bases, traps, and defensive infrastructure.', entries: [
        entry('building-principles', 'Base design principles', ['building', 'walls', 'storage', 'outpost'],
          list(['Use layered walls rather than one monolithic wall.', 'Keep storage and industry away from the flag room.', 'Create controlled firing angles and more than one exit.', 'Use height for observation and protect machines.', 'Maintain safe respawn, recovery, and supply routes.'])),
        entry('traps', 'Trap combinations', ['bear trap', 'tar', 'barbed wire', 'spike', 'landmine', 'lever'],
          table(['Tool', 'Best use'], [['Bear trap', 'Hold attackers in chokepoints'], ['Tar', 'Slow targets in firing lanes'], ['Barbed wire', 'Shape perimeter movement'], ['Spike trap', 'Damage corridors and drop zones'], ['Landmine', 'Burst damage after commitment'], ['Barricade', 'Emergency cover and movement denial'], ['Floodlight', 'Reveal approaches and protect roads'], ['Lever traps', 'Trigger fall or wall traps at the right moment']]) +
          tip('Combination', 'Scout enters → defender waits → lever activates → route closes or damage triggers.')),
      ],
    },
    {
      id: 'vaults', title: 'Vaults & Dungeons', icon: icon('vault'), summary: 'Vault tiers, room types, preparation, and loot flow.', entries: [
        entry('vault-tiers', 'Vault tiers', ['tier i', 'tier ii', 'tier iii', 'wilds', 'vault'],
          table(['Tier', 'Location and expectation'], [['I', 'Closer to the core; introduction to vault combat and starter rare loot'], ['II', 'Farther into the Wilds; stronger enemies and sustained-damage checks'], ['III', 'Deep Wilds; highest health and damage, strongest rewards, teams recommended']]) +
          tip('Vault flow', 'Explore rooms → reach boss arena → complete mechanics → defeat boss → loot the personal chest during its open window.')),
        entry('vault-preparation', 'Vault preparation checklist', ['prepare', 'ammo', 'torches', 'respawn'],
          list(['Repair armor.', 'Bring spare ammunition and healing.', 'Clear unnecessary inventory space.', 'Carry close- and long-range options.', 'Bring torches and set a nearby respawn point.', 'For Tier III, coordinate damage, summon control, and revives if teammates join.'])),
      ],
    },
    {
      id: 'bosses', title: 'Bosses', icon: icon('skull'), summary: 'The arena, the danger and the one movement habit that beats each vault boss.', entries: [
        entry('boss-comparison', 'Boss comparison', ['boss', 'warden', 'queen', 'colossus', 'seer', 'artificer', 'arena', 'room'],
          table(['Boss', 'Its arena', 'Main danger', 'Weapon style'], bosses.map((b) => b.slice(0, 4))) +
          `<div class="field-guide-boss-grid">${bosses.map((b) => `<section class="field-guide-boss"><h3>${esc(b[0])}</h3><p><strong>Arena:</strong> ${esc(b[1])}.</p><p><strong>How to beat it:</strong> ${esc(b[4])}</p></section>`).join('')}</div>`),
        entry('boss-rewards', 'What you get for killing a boss', ['relic', 'greater rune', 'reward', 'loot', 'worth it', 'sigil', 'bloom', 'core', 'prism', 'gear'],
          `<p>Clearing a vault opens its chest for <strong>ten minutes</strong>. The haul is <strong>personal</strong> — every player who helped opens their own, nobody loots anyone else's — and it <strong>regrows every 30 minutes</strong>, so a vault you can beat is a repeatable income, not a one-off.</p>` +
          `<p>Every haul is guaranteed to contain that boss's <strong>relic</strong>, plus ammunition, healing and materials scaled to the tier. The guaranteed ammo is deliberate: a boss should always refund more than it costs you to kill it.</p>` +
          table(['Tier', 'Guaranteed on top of the relic', 'Weighted picks'], [
            ['I', '3 Bandages, 32 Bullets', '8'],
            ['II', '2 Medkits, 3 Titanium, 48 Bullets, 1 rune', '10'],
            ['III', '1 Heart, 4 Diamonds, 4 Titanium, 64 Bullets, 2 Medkits, 1 rune', '12'],
          ]) +
          tip('Hearts', 'A vault boss is the best Heart source in the game — better than a Crashed Cargo Pod, which costs you nothing to open. Tier III guarantees one outright.')),
        entry('greater-runes', 'Relics and Greater Runes', ['relic', 'greater rune', 'socket', 'armor upgrade', 'craft', 'farm'],
          `<p>Relics are the whole reason to fight the <em>same</em> boss more than once. Two matching relics, the base rune they upgrade and a Diamond craft a <strong>Greater Rune</strong> — and since a haul only ever contains one relic, a Greater Rune costs at least <strong>two full kills of that specific boss</strong>.</p>` +
          `<p>Greater Runes socket into worn armor exactly like ordinary ones (right-click, one rune per piece), but they are far stronger. They are the only armor upgrade in the game that cannot be mined, crafted from raw materials or found in a chest.</p>` +
          table(['Boss', 'Relic', 'Forges'], [
            [bossName(0, 'Bone Warden'), 'Warden Sigil', 'Greater Rune of Iron'],
            [bossName(1, 'Mire Queen'), 'Mire Bloom', 'Greater Rune of Swiftness'],
            [bossName(2, 'Ember Colossus'), 'Ember Core', 'Greater Rune of Fortune'],
            [bossName(3, 'Crystal Seer'), 'Seer Prism', 'Greater Rune of Focus'],
            [bossName(4, 'Gilded Artificer'), 'Artificer Gear', 'Greater Rune of Power'],
          ]) +
          table(['Greater Rune', 'While the armor piece is worn'], runeRows([
            Item.GreaterRuneOfIron, Item.GreaterRuneOfSwiftness, Item.GreaterRuneOfFortune,
            Item.GreaterRuneOfFocus, Item.GreaterRuneOfPower,
          ])) +
          tip('Why Iron is not simply "+3 armor"', 'A full titanium set is already 20 armor points — the hard cap, where percentage armor stops doing anything at all. The Greater Rune of Iron instead soaks a flat point of damage off every single hit, which nothing else in the game can do, so it keeps working on a maxed-out set.') +
          warning('A hit always hurts', 'Toughness can never make you immune: any hit that connects still costs at least 1 health, no matter how many runes you stack.')),
        entry('boss-armor', 'Lair hazards cut through armor', ['armor', 'pierce', 'mitigation', 'difficulty', 'tier', 'why did that hurt'],
          `<p>Ordinary damage — a mob, a bullet, a fall — is reduced by <strong>4% per armor point</strong>, up to 80% at 20 points. A vault boss is the one thing in the world that does not respect all of it. Every hazard a lair throws at you <strong>ignores part of your armor</strong>, and the deeper the vault the more it ignores.</p>` +
          table(['Tier', 'Armor ignored', 'What that means'], [
            ['I', 'A quarter', 'Barely noticeable — the teaching fight plays as it always has'],
            ['II', 'Just under half', 'Good armor still halves the hit; it no longer erases it'],
            ['III', 'Three fifths', 'Best-in-slot is the difference between six hits and three, not between one damage and one damage'],
          ]) +
          tip('Why it works this way', 'Armor is multiplicative, so a full titanium set blocks the same 80% of a Tier I tap and a Tier III execution. Without piercing, one authored attack cannot be both a fair hit on a fresh spawn and a real threat to a maxed player — every boss in the game landed for 1 or 2 damage on anyone who had finished the gear curve, and you could out-heal the hardest lair standing still.') +
          warning('Armor still matters more than anything else', 'Piercing shaves your mitigation, it does not cancel it. Walking into a Tier III lair in diamond instead of titanium roughly doubles what every mistake costs you, and a full set of Greater Runes of Iron is still the single biggest survivability upgrade you can bring.')),
        entry('boss-gear', 'Suggested gear by vault tier', ['recommended gear', 'ammo', 'armor', 'healing'],
          table(['Tier', 'Armor', 'Weapon', 'Healing', 'Ammunition'], [['I', 'Stone minimum, iron preferred', 'Pistol, shotgun, or SMG', '3–5 bandages, 1 medkit', 'About 150–250 rounds'], ['II', 'Full iron minimum, diamond preferred', 'Rifle, SMG, or shotgun', '2–3 medkits', 'About 400–600 rounds'], ['III', 'Diamond minimum, titanium preferred', 'Rifle, SMG, Burst Rifle, rockets', '4–6 medkits', 'About 700–1,000 rounds']]) +
          warning('Suggested, not required', 'These are preparation guidelines, not equipment locks. Player skill, group size, and boss familiarity matter.')),
      ],
    },
    {
      id: 'gear', title: 'Weapons & Gear', icon: icon('weapon'), summary: 'Live registry-backed weapon and gadget reference.', entries: [
        entry('weapon-reference', 'Weapon and gadget reference', ['weapon', 'gun', 'gadget', 'range', 'damage'],
          table(['Equipment', 'Role / damage', 'Range', 'Live stat'], weaponRows()) +
          tip('Source of truth', 'Names and numeric weapon statistics on this page are generated from the current item registry.')),
      ],
    },
    {
      id: 'hearts', title: 'Hearts & Elimination', icon: icon('heart'), summary: 'Maximum health, PvP transfer, elimination, and revival.', entries: [
        entry('heart-system', 'How Hearts work', ['heart', 'lifesteal', 'elimination', 'revival beacon'],
          list(['Each Heart increases maximum health.', 'PvP can transfer Hearts between players.', 'Reaching zero Hearts causes elimination.', 'Revival rules and duration depend on faction flag control and beacon availability.', 'Heart withdrawals are restricted so players cannot bypass the survival floor.']) +
          warning('Protect rare recovery items', 'Do not carry spare Hearts or revival items into unnecessary fights unless your team has a recovery plan.')),
      ],
    },
    {
      id: 'warfare', title: 'Warfare Command', icon: icon('machine'), summary: 'Boss-powered technology: tactical missiles, missile defense, and helicopters.', entries: [
        entry('warfare-xp', 'Where warfare XP comes from', ['warfare', 'xp', 'boss', 'vault', 'technology'],
          `<p>Warfare XP has exactly one source: <b>dungeon-boss victories you actually helped win</b>. Mobs, PvP, guards, chests, missiles and bombs grant none of it.</p>` +
          table(['Boss tier', 'Warfare XP'], [['Tier I', '300'], ['Tier II', '750'], ['Tier III', '1,500']]) +
          list(['Every qualifying participant is paid in full — the award is never divided by party size.',
            'You qualify by dealing at least 2% of the boss\'s scaled health and being present for at least a quarter of the fight, or by dealing 10% regardless of how long you stayed.',
            'Dying shortly before the kill does not erase your contribution.',
            'Walking in at the end without fighting earns nothing.',
            'Each account is paid once per boss recharge cycle.']) +
          tip('Press G', 'The Warfare Command tree is the G panel. Purchases are permanent, personal, and cost XP directly.')),
        entry('warfare-tree', 'The technology tree', ['tree', 'nodes', 'blueprint', 'trunk', 'branch'],
          `<p>One trunk of nine nodes, then three endgame branches. The trunk forces the order: <b>missiles, then missile defense, then helicopters</b>.</p>` +
          table(['Stage', 'What it opens'], [
            ['Missile Command → Hardened Silo', 'Tactical Silo, Tactical Missile, map targeting, range and magazine'],
            ['Aegis Systems → Fast Intercept', 'Interceptor Turret, Interceptor Missiles, radar and reload'],
            ['Flight Certification → Reinforced Airframe', 'Helipad, two-seat helicopter, bombs, hull and fuel'],
            ['Strike / Aegis / Aviation', 'The three capstone branches: reach, airspace denial, and gunships']]) +
          tip('Blueprints are personal, hardware is shared', 'You need the node to BUILD or RETROFIT. Once it exists, any faction teammate can load, operate and fly it.')),
        entry('warfare-missiles', 'Tactical missiles', ['missile', 'silo', 'launch', 'targeting', 'blast'],
          steps(['Build a Tactical Silo — it needs a clear 2×2 pad.',
            'Load a Tactical Missile into it.',
            'Right-click the silo and choose Select Target.',
            'Click the map to place a reticle; check distance, ETA, blast radius and nearby allies.',
            'Press Confirm Launch. The server revalidates everything before a round is spent.']) +
          list(['Two silos per faction, at least 48 blocks apart.',
            'Two offensive missiles in the air per faction, and a 30-second faction-wide gap between launches.',
            'Every strike gives its target at least eight seconds of warning.',
            'Vaults, spawn, faction cores and shielded bases can never be targeted.',
            'Only player-PLACED blocks are destroyed — natural terrain is never excavated.',
            'Friendly players and friendly hardware are immune. Strategic explosions grant no lifesteal.']) +
          warning('It can be shot down', 'A missile hull has about 24 HP. Accurate gunfire can burst one in flight.')),
        entry('warfare-defense', 'Missile defense', ['interceptor', 'battery', 'radar', 'saturation'],
          list(['Interceptor batteries only ever shoot at MISSILES — never at players, and they deal no player damage.',
            'A battery picks the hostile missile with the shortest impact ETA, and only one battery claims a track, so ammunition is never spent twice.',
            'Interception is certain if the interceptor physically reaches the missile.',
            'Four batteries per faction, at least 24 blocks apart.',
            'Any teammate can load and operate a shared battery.']) +
          tip('Saturation still works', 'More missiles than the reload window allows will get through. Defense buys you time, not immunity.')),
        entry('warfare-air', 'Helicopters', ['helicopter', 'helipad', 'pilot', 'gunner', 'bomb'],
          steps(['Build a Helipad and assemble a Helicopter Airframe.',
            'Deploy the airframe on the pad, then refuel, load bombs and repair there.',
            'Board as pilot or gunner. Only faction members can board.',
            'Pilot: W A S D flies, the camera steers, Space climbs, Shift descends, right-click drops a bomb.',
            'Gunner: look around and fire your own weapon within a sensible side arc.',
            'Press F to step off — near the ground, or as an emergency ejection.']) +
          list(['Two seats, two active helicopters per faction.',
            'Guns, rockets, turrets, explosions and collisions all damage the airframe.',
            'At zero HP both occupants are ejected and hurt, and the wreck explodes.',
            'A pilot who disconnects leaves the airframe in a controlled hover that settles to the ground.',
            'Helicopters cannot enter vault arenas or cross the world boundary.'])),
      ],
    },
    {
      id: 'machines', title: 'Machines & Automation', icon: icon('machine'), summary: 'Production, ownership, fuel, ammunition, upgrades, and safety.', entries: [
        entry('machine-workflow', 'Recommended machine workflow', ['autominer', 'oil derrick', 'turret', 'machine', 'automation'],
          steps(['Secure the area.', 'Place and claim the machine.', 'Configure its filter or loadout.', 'Protect it with walls and lighting.', 'Check storage, fuel, and ammunition regularly.', 'Upgrade only after the site is defensible.']) +
          tip('Separation', 'Do not cluster all machines, storage, and the faction flag into one easy raid target.')),
      ],
    },
    {
      id: 'travel', title: 'Travel & Exploration', icon: icon('travel'), summary: 'Maps, compasses, waypoints, mobility, and long journeys.', entries: [
        entry('travel-tools', 'Exploration toolkit', ['map', 'vault compass', 'waypoint', 'boat', 'glider', 'grappling hook'],
          table(['Tool', 'Use'], [['World map', 'Read territory, structures, and travel routes'], ['Vault Compass', 'Reveal a vault of the matching tier'], ['Waypoint Totem', 'Mark a destination'], ['Respawn Beacon', 'Create a recovery point'], ['Boat / Glider', 'Cross water or descend quickly'], ['Grappling Hook / Jump Boost', 'Reach vertical or exposed terrain']]) +
          warning('Long journeys', 'Carry healing, ammunition, food or recovery supplies, and leave valuables in a protected cache before entering the deep Wilds.')),
      ],
    },
    {
      id: 'teamplay', title: 'Multiplayer & Team Play', icon: icon('team'), summary: 'Roles, boss coordination, and flag-war discipline.', entries: [
        entry('team-roles', 'Useful team roles', ['scout', 'builder', 'defender', 'healer', 'raid leader'],
          list(['Scout and route finder', 'Builder and repair specialist', 'Flag defender', 'Miner and machine operator', 'Boss damage dealer', 'Summon controller', 'Healing and revive carrier', 'Raid leader'])) ,
        entry('group-tactics', 'Group tactics', ['team', 'boss group', 'rally point', 'revive'],
          list(['Keep at least one player applying boss pressure.', 'Have another player control optional summons and protect revives.', 'Rotate healing responsibility.', 'Do not stack during area attacks.', 'No boss requires a crystal, ward, or arena prop to be destroyed.', 'For raids, establish rally points and assign home defenders before departure.'])),
      ],
    },
    {
      id: 'quick', title: 'Quick Reference', icon: icon('help'), summary: 'Fast answers for common high-risk situations.', entries: [
        entry('quick-reference', 'Field checklist', ['quick reference', 'tips'],
          table(['Situation', 'Immediate action'], [['Entering a vault', 'Repair armor, clear inventory space, bring healing and ammo'], ['Boss changes phase', 'Read the new floor preview and keep attacking the boss'], ['Flag alarm', 'Call location, close routes, protect supplies'], ['Raiding', 'Scout, bring cover, plan escape'], ['Machine site', 'Claim, configure, light, wall, and resupply'], ['Lost in Wilds', 'Use map/waypoint tools and establish a safe cache']]))
      ],
    },
  ];
}

export function createFieldGuide(options: FieldGuideOptions): FieldGuideController {
  const sections = fieldGuideSections();
  const overlay = document.createElement('section');
  overlay.id = 'game-guide';
  overlay.className = 'field-guide';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'VOXELON Field Guide');
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="field-guide-shell">
      <header class="field-guide-header">
        <div><span class="field-guide-eyebrow">TACTICAL ARCHIVE</span><h1>VOXELON FIELD GUIDE</h1></div>
        <label class="field-guide-search-label" for="guide-search"><span>Search handbook</span><input id="guide-search" type="search" placeholder="flag, titanium, Bone Warden…" autocomplete="off"></label>
        <div class="field-guide-header-actions"><button id="guide-resume-btn" class="mc-btn">Resume Game</button><button id="guide-close-btn" class="mc-btn" aria-label="Back to pause menu">×</button></div>
      </header>
      <div id="guide-live-warning" class="field-guide-live-warning" hidden>${icon('warning')}Multiplayer continues while the guide is open. Find a safe location first.</div>
      <div class="field-guide-body">
        <button id="guide-mobile-sections" class="mc-btn field-guide-mobile-sections" aria-expanded="false">Sections</button>
        <nav id="guide-nav" class="field-guide-nav" aria-label="Guide sections"></nav>
        <main id="guide-content" class="field-guide-content" tabindex="0"></main>
      </div>
      <footer class="field-guide-footer"><span id="guide-current-section"></span><span>/ focuses search · Esc returns to pause</span><button id="guide-back-btn" class="mc-btn">Back to Pause Menu</button></footer>
    </div>`;
  options.root.appendChild(overlay);

  const nav = overlay.querySelector('#guide-nav') as HTMLElement;
  const content = overlay.querySelector('#guide-content') as HTMLElement;
  const search = overlay.querySelector('#guide-search') as HTMLInputElement;
  const liveWarning = overlay.querySelector('#guide-live-warning') as HTMLElement;
  const current = overlay.querySelector('#guide-current-section') as HTMLElement;
  const mobileSections = overlay.querySelector('#guide-mobile-sections') as HTMLButtonElement;
  let sectionId = sections[0].id;
  let entryId: string | null = sections[0].entries[0]?.id ?? null;
  let active = false;
  let previousFocus: HTMLElement | null = null;
  const scroll = new Map<string, number>();

  function matches(e: FieldGuideEntry, q: string): boolean {
    const haystack = `${e.title} ${e.keywords.join(' ')} ${e.html.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    return haystack.includes(q);
  }

  function render(): void {
    const q = search.value.trim().toLowerCase();
    nav.replaceChildren();
    for (const section of sections) {
      const count = q ? section.entries.filter((e) => matches(e, q)).length : section.entries.length;
      if (q && count === 0) continue;
      const button = document.createElement('button');
      button.className = 'field-guide-nav-item';
      button.dataset.active = String(section.id === sectionId);
      button.innerHTML = `<span>${section.icon}</span><span>${esc(section.title)}</span>${q ? `<small>${count}</small>` : ''}`;
      button.addEventListener('click', () => {
        scroll.set(sectionId, content.scrollTop);
        sectionId = section.id;
        entryId = section.entries.find((e) => !q || matches(e, q))?.id ?? null;
        render();
        nav.classList.remove('mobile-open');
        mobileSections.setAttribute('aria-expanded', 'false');
      });
      nav.appendChild(button);
    }

    const selected = sections.find((s) => s.id === sectionId) ?? sections[0];
    const visible = selected.entries.filter((e) => !q || matches(e, q));
    if (q && visible.length === 0) {
      const first = sections.find((s) => s.entries.some((e) => matches(e, q)));
      if (first) { sectionId = first.id; entryId = first.entries.find((e) => matches(e, q))?.id ?? null; render(); return; }
    }
    current.textContent = selected.title;
    content.innerHTML = `<header class="field-guide-article-header"><span>${selected.icon}</span><div><h2>${esc(selected.title)}</h2><p>${esc(selected.summary)}</p></div></header>` +
      (visible.length ? visible.map((e) => `<article id="guide-entry-${e.id}" class="field-guide-entry"><h3>${esc(e.title)}</h3>${e.html}</article>`).join('') :
        `<div class="field-guide-empty"><h3>No matching articles</h3><p>Try a boss name, weapon, trap, resource, or vault tier.</p></div>`);
    requestAnimationFrame(() => {
      if (q && entryId) document.getElementById(`guide-entry-${entryId}`)?.scrollIntoView({ block: 'start' });
      else content.scrollTop = scroll.get(sectionId) ?? 0;
    });
  }

  function show(): void {
    if (active) return;
    active = true;
    previousFocus = document.activeElement as HTMLElement | null;
    overlay.classList.add('open');
    liveWarning.hidden = !options.multiplayerActive();
    render();
    overlay.focus();
  }

  function hide(): void {
    active = false;
    overlay.classList.remove('open');
    nav.classList.remove('mobile-open');
    previousFocus?.focus?.();
  }

  function backToPause(): void { if (!active) return; hide(); options.onBackToPause(); }
  function closeForResume(): void { if (!active) return; hide(); options.onResume(); }

  search.addEventListener('input', render);
  overlay.querySelector('#guide-back-btn')!.addEventListener('click', backToPause);
  overlay.querySelector('#guide-close-btn')!.addEventListener('click', backToPause);
  overlay.querySelector('#guide-resume-btn')!.addEventListener('click', closeForResume);
  mobileSections.addEventListener('click', () => {
    const open = !nav.classList.contains('mobile-open');
    nav.classList.toggle('mobile-open', open);
    mobileSections.setAttribute('aria-expanded', String(open));
  });
  overlay.addEventListener('pointerdown', (event) => event.stopPropagation());
  overlay.addEventListener('click', (event) => event.stopPropagation());
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); backToPause(); return; }
    if (event.key === '/' && document.activeElement !== search) { event.preventDefault(); search.focus(); return; }
    if (event.key === 'Home' && document.activeElement === content) { event.preventDefault(); content.scrollTop = 0; }
    if (event.key === 'Tab') {
      const focusable = Array.from(overlay.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  return { get open() { return active; }, show, backToPause, closeForResume, closeSilently: hide, destroy: () => overlay.remove() };
}
