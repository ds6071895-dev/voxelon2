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
  [Block.Turret]: 'Auto-targets enemies. Load it with cannonballs + oil.',
  [Block.Autominer]: 'Mines ore automatically over time. Collect its output.',
  [Block.OilDerrick]: 'Pumps OIL — the fuel for base shields + the war chest.',
  [Item.OilBarrel]: 'Oil: feeds base shields, the treasury and oil bombs.',
  [Item.CobaltIngot]: 'A war-grade metal smelted from cobalt ore.',
  // Travel.
  [Item.Glider]: 'Wear it in the chest slot (right-click to equip); jump in mid-air to glide.',
  // Respawn point.
  [Item.RuneOfIron]: 'Loot-only rune — right-click to socket into worn armor: +1 armor.',
  [Item.RuneOfSwiftness]: 'Loot-only rune — right-click to socket into worn armor: +3% speed.',
  [Item.RuneOfFortune]: 'Loot-only rune — right-click to socket into worn armor: +20% mining speed.',
  [Item.RuneOfFocus]: 'Loot-only rune — right-click to socket into worn armor: −25% gun spread.',
  [Block.RespawnBeacon]: 'Right-click to set your respawn point. Cheap + easily broken.',
  [Block.WaypointTotem]: 'Right-click to attune (max 4). Teleport to attuned totems from the map (M) — 60s cooldown, not while in combat.',
  // Discovery (Milestone C).
  [Item.CrystalShard]: 'Mined from glowing Crystalfields spikes — found only in the WILDS.',
  [Block.CrystalBlock]: 'A glowing crystal spike. Mine it for Crystal Shards.',
  [Block.Mud]: 'Sticky swamp ground — walking through it is slow.',
  // Dungeons (Milestone D).
  [Block.VaultBrick]: 'Ancient dungeon wall. VERY tough — iron pick needed. The door is easier!',
  [Block.VaultChest]: 'The vault treasure! Defeat the Vault Brute, then right-click — everyone gets ONE roll per vault.',
  // Healing consumables.
  [Item.Bandage]: 'Right-click to patch up — a quick burst of fast healing, even mid-fight.',
  [Item.Medkit]: 'Right-click for a powerful surge of regeneration — heals you up fast.',
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
