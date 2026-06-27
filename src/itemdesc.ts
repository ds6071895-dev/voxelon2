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
  [Item.Cannonball]: 'Ammo for ship cannons and turrets.',
  // War economy + factions.
  [Block.Core]: 'Founds a BASE in your territory — raises an oil-powered shield.',
  [Block.Turret]: 'Auto-targets enemies. Load it with cannonballs + oil.',
  [Block.ShipHelm]: 'Place on water to build + pilot a ship. Add cannons.',
  [Block.Cannon]: 'A ship weapon — mount it on your hull around the helm.',
  [Block.Autominer]: 'Mines ore automatically over time. Collect its output.',
  [Block.OilDerrick]: 'Pumps OIL — the fuel for base shields + the war chest.',
  [Item.OilBarrel]: 'Oil: feeds base shields, the treasury and oil bombs.',
  [Item.CobaltIngot]: 'A war-grade metal smelted from cobalt ore.',
  // Travel.
  [Item.Glider]: 'Wear it in the chest slot (right-click to equip); jump in mid-air to glide.',
  // Respawn point.
  [Block.RespawnBeacon]: 'Right-click to set your respawn point. Cheap + easily broken.',
};

/** A short description for an item, or '' if none. Gadgets win automatically. */
export function itemDescription(id: number): string {
  const g = gadgetOf(id);
  if (g) return g.desc;
  return DESCRIPTIONS[id] ?? '';
}
