// Item descriptions — short, kid-friendly blurbs shown in the crafting Guide and
// the held-item tooltip. Gadgets pull from the gadget registry; everything else
// comes from a small static map. PURE (no DOM) so it's shared + unit-testable.

import { Item } from './items';
import { Block } from './blocks';
import { gadgetOf } from './gadgets';

const DESCRIPTIONS: Record<number, string> = {
  // Guns + ammo.
  [Item.Pistol]: 'A reliable sidearm. Fast, low damage. Uses bullets.',
  [Item.Rifle]: 'Accurate automatic fire at range. Uses bullets.',
  [Item.RocketLauncher]: 'Fires explosive rockets — big area damage, slow reload.',
  [Item.Shotgun]: 'Close-range spread of pellets. Devastating up close.',
  [Item.SMG]: 'Rapid spray-fire. Great for run-and-gun.',
  [Item.Sniper]: 'Pinpoint, high-damage scoped shots (hold RMB to zoom).',
  [Item.BurstRifle]: 'Fires a tight 3-round burst per trigger pull.',
  [Item.Bullet]: 'Ammo for the pistol, rifle, shotgun, SMG and sniper.',
  [Item.Rocket]: 'Explosive ammo for the rocket launcher.',
  [Item.Cannonball]: 'Ammo for turrets.',
  // War economy + factions.
  [Block.Turret]: 'Auto-targets enemy players and hostile mobs it can see. Load it with cannonballs + oil. Sabotage an enemy one to knock it offline, then hack it.',
  [Block.Autominer]: 'A deep-bore drill: it sinks deeper over time and richer ores (titanium at the bottom) show up. Fuel it with coal or oil, fit better drill bits, and flip OVERDRIVE for double output — until it overheats and jams.',
  [Block.OilDerrick]: 'Drills a wildcat well over desert and ocean oil fields. Strike a GUSHER for a burst of free oil, then cap it before an explosion sets the well ablaze. Keep the pressure up with frac sand; refine crude into Tar or Fuel Tanks.',
  [Item.DrillBitIron]: 'Autominer bit: bores to 75 m, +20% speed. Wears out.',
  [Item.DrillBitDiamond]: 'Autominer bit: bores to 105 m (diamond depth), +45% speed. Wears out.',
  [Item.DrillBitTitanium]: 'Autominer bit: bores the full 120 m to titanium, +80% speed. Wears out.',
  [Item.OilBarrel]: 'Oil: feeds base shields and oil bombs.',
  [Item.CobaltIngot]: 'A war-grade metal found in Tier II & III dungeon chests and boss loot.',
  [Item.TitaniumIngot]: 'A high-tier metal found in Tier II & III dungeon chests and boss loot.',
  [Item.RopeWinch]: 'Install on a landed helicopter to unlock hover hold and a fast rope.',
  [Item.AuxiliaryTank]: 'Install on a landed helicopter to double its base oil capacity.',
  [Item.LongRangeTank]: 'Install after Auxiliary Tanks to triple base oil capacity.',
  // Travel.
  [Item.Glider]: 'Wear it in the chest slot (right-click to equip); jump in mid-air to glide.',
  [Item.Boat]: 'Right-click on water to launch. Steer with your view, W to row — jump to hop out.',
  [Item.VaultCompass1]: 'Right-click: marks the nearest Tier I vault on your map. ONE use.',
  [Item.VaultCompass2]: 'Right-click: marks the nearest Tier II vault (mid Wilds). ONE use.',
  [Item.VaultCompass3]: 'Right-click: marks the nearest Tier III vault (deep Wilds). ONE use.',
  [Block.MobSpawner]: 'A protected vault anchor. Defeat its finite guard wave to silence the room.',
  // Traps.
  // Trapcraft: your traps never fire on you or your allies. Right-click one you
  // own to set its wiring channel.
  [Block.SpikeTrap]: 'Hidden spikes that spring up under enemies — heavy damage plus bleeding. Fires on its channel too.',
  [Block.Landmine]: 'Arms a moment after placing. Detonates under an enemy (never you or allies) — or remotely on its channel.',
  [Block.BearTrap]: 'Snaps shut on an enemy and pins them for seconds — they mash JUMP to break free.',
  [Block.Lever]: 'Right-click to pull: latches its channel ON, firing every receiver on that channel within 24 blocks.',
  [Block.FallTrap]: 'Looks like a solid hatch — a signal on its channel swings it OPEN and the floor drops away!',
  [Block.WallTrap]: 'A flat plate — a signal on its channel springs it UP into a solid wall. Box them in!',
  [Block.PressurePlate]: 'TRIGGER: an enemy stepping on it signals its channel. Camouflaged to enemies.',
  [Block.TripwireHook]: 'TRIGGER: throws a laser up to 8 blocks the way it faces. Enemies breaking the beam signal its channel.',
  [Block.MotionSensor]: 'TRIGGER: signals its channel whenever an enemy comes within 5 blocks.',
  [Block.TrapTimer]: 'TRIGGER: pulses its channel on a steady beat (2-15 s).',
  [Block.Claymore]: 'Directional shrapnel mine: shreds enemies in FRONT of it. Faces the way you look when placed.',
  [Block.FlameJet]: 'Spits a 3-second jet of fire at enemies in front (or above, on floors). Burns oil — load barrels from its panel.',
  [Block.DartLauncher]: 'Fires poison darts at enemies in its line: damage, bleeding and a heavy slow.',
  [Block.NetLauncher]: 'Throws a weighted net over an enemy in its line — they cannot move or fight for a few seconds.',
  [Block.ShockPlate]: 'Stuns enemies who step on it — no moving, no aiming — and recharges in seconds.',
  [Block.AlarmBell]: 'Rings when enemies get close (or on its channel) and pings you and your faction on the map.',
  [Item.TrapDetector]: 'Hold it to reveal hidden enemy traps within 10 blocks. Sneak next to a revealed trap and hold USE to defuse it.',
  // Early-game armor.
  [Item.WoodHelmet]: 'Cheap plank armor — thin, but way better than nothing in a Tier I vault.',
  [Item.WoodChestplate]: 'Cheap plank armor — thin, but way better than nothing in a Tier I vault.',
  [Item.WoodLeggings]: 'Cheap plank armor — thin, but way better than nothing in a Tier I vault.',
  [Item.WoodBoots]: 'Cheap plank armor — thin, but way better than nothing in a Tier I vault.',
  [Item.StoneHelmet]: 'Budget cobble armor — solid early protection for your first vault runs.',
  [Item.StoneChestplate]: 'Budget cobble armor — solid early protection for your first vault runs.',
  [Item.StoneLeggings]: 'Budget cobble armor — solid early protection for your first vault runs.',
  [Item.StoneBoots]: 'Budget cobble armor — solid early protection for your first vault runs.',
  // Respawn point.
  [Item.RuneOfIron]: 'Loot-only rune — right-click to socket into worn armor: +1 armor (past the armor cap, every 2 become 1 toughness).',
  [Item.RuneOfSwiftness]: 'Loot-only rune — right-click to socket into worn armor: +3% speed.',
  [Item.RuneOfFortune]: 'Loot-only rune — right-click to socket into worn armor: +20% mining speed, 8% chance a swing costs no tool durability.',
  [Item.RuneOfFocus]: 'Loot-only rune — right-click to socket into worn armor: −10% gun spread, −5% reload time.',
  [Block.RespawnBeacon]: 'Right-click to set your respawn point. Cheap + easily broken.',
  [Block.WaypointTotem]: 'Right-click to attune (max 4). Teleport to attuned totems from the map (/map) — 60s cooldown, not while in combat.',
  // Discovery (Milestone C).
  [Item.CrystalShard]: 'Mined from glowing Crystalfields spikes — found only in the WILDS.',
  [Block.CrystalBlock]: 'A glowing crystal spike. Mine it for Crystal Shards.',
  [Block.Mud]: 'Sticky swamp ground — walking through it is slow.',
  // Dungeons (Milestone D).
  [Block.VaultBrick]: 'Ancient dungeon wall. VERY tough — iron pick needed. The door is easier!',
  [Block.VaultChest]: 'The vault treasure! Defeat the Vault Brute, then right-click — everyone gets ONE roll per vault.',
  [Block.CarvedVaultBrick]: 'Crypt masonry carved with violet soul channels.',
  [Block.MossyVaultBrick]: 'Damp sanctum masonry reclaimed by moss and roots.',
  [Block.EmberBrick]: 'Forge brick with warm molten seams. Iron pick required.',
  [Block.PrismBrick]: 'Arcane masonry that catches and refracts dungeon light.',
  [Block.GildedVaultBrick]: 'Black vault stone set with bright gold inlay.',
  [Block.SoulLantern]: 'A steady violet crypt light.',
  [Block.GlowFungus]: 'A softly glowing fungus from the mire sanctum.',
  [Block.EmberBrazier]: 'A compact forge brazier with a permanent ember.',
  [Block.PrismLamp]: 'A cool crystalline dungeon lamp.',
  [Block.LuminousLimestone]: 'Bright structural vault stone threaded with cool light.',
  [Block.PearlTile]: 'Polished pearl flooring from the renewed vault halls.',
  [Block.RuneGlass]: 'Translucent glass crossed by radiant protective runes.',
  [Block.IvoryColumn]: 'A fluted architectural column used in grand vault chambers.',
  [Block.SpectralMarble]: 'Pale crypt marble carrying a quiet violet glow.',
  [Block.JadeMosaic]: 'A vivid jade-and-pearl mosaic from mire sanctums.',
  [Block.FurnaceCeramic]: 'Heatproof pale ceramic used around ancient forges.',
  [Block.OpalBrick]: 'Iridescent prism masonry that scatters dungeon light.',
  [Block.ClockworkGrate]: 'A gold-jointed mechanical grate from artificer vaults.',
  [Block.VaultMosaic]: 'Ornamental light-stone mosaic shared by grand vault rooms.',
  [Block.GildedLamp]: 'A warm black-and-gold vault lamp.',
  // Relics: one per vault haul, from that vault's boss. TWO of them craft that
  // boss's Greater Rune — that is the reason to farm a boss, not the trophies.
  [Item.WardenSigil]: 'Relic of the Bone Warden. 2 + a Rune of Iron + a Diamond = Greater Rune of Iron. Also makes crypt trophies.',
  [Item.MireBloom]: 'Relic of the Mire Queen. 2 + a Rune of Swiftness + a Diamond = Greater Rune of Swiftness. Also makes mire trophies.',
  [Item.EmberCore]: 'Relic of the Ember Colossus. 2 + a Rune of Fortune + a Diamond = Greater Rune of Fortune. Also makes forge trophies.',
  [Item.SeerPrism]: 'Relic of the Crystal Seer. 2 + a Rune of Focus + a Diamond = Greater Rune of Focus. Also makes prism trophies.',
  [Item.ArtificerGear]: 'Relic of the Gilded Artificer. 2 + any rune + a Diamond = Greater Rune of Power. Also makes gilded trophies.',
  // Greater Runes: boss-locked armor sockets, far stronger than the base runes.
  [Item.GreaterRuneOfIron]: 'Boss-forged rune — right-click to socket into worn armor: +1 armor AND -1 damage from every hit (never more than half a hit).',
  [Item.GreaterRuneOfSwiftness]: 'Boss-forged rune — right-click to socket into worn armor: +6% move speed.',
  [Item.GreaterRuneOfFortune]: 'Boss-forged rune — right-click to socket into worn armor: +50% mining speed, 15% chance a swing costs no tool durability.',
  [Item.GreaterRuneOfFocus]: 'Boss-forged rune — right-click to socket into worn armor: -15% gun spread, -10% reload time.',
  [Item.GreaterRuneOfPower]: 'Boss-forged rune — right-click to socket into worn armor: +1 armor, +3% speed, +15% mining speed, -5% gun spread, -5% reload time.',
  // Healing consumables.
  [Item.Bandage]: 'Right-click to wrap up (~1s) — a quick burst of fast healing, even mid-fight.',
  [Item.Medkit]: 'Right-click to work it in (~2s) — a powerful surge of regeneration.',
  // Lifesteal (Milestone A).
  [Item.Heart]: 'Right-click to gain +1 max heart (up to 20). Crafting one costs a heart of YOUR OWN — never below 2.',
  [Item.RevivalBeacon]: 'Right-click to bring an ELIMINATED teammate back early. One use.',
};

/** A short description for an item, or '' if none. Gadgets win automatically. */
export function itemDescription(id: number): string {
  const g = gadgetOf(id);
  if (g) return g.desc;
  return DESCRIPTIONS[id] ?? '';
}
