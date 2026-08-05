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
  [Item.Boat]: 'Right-click on water to launch. Steer with your view, W to row — jump to hop out.',
  [Item.VaultCompass1]: 'Right-click: marks the nearest Tier I vault on your map. ONE use.',
  [Item.VaultCompass2]: 'Right-click: marks the nearest Tier II vault (mid Wilds). ONE use.',
  [Item.VaultCompass3]: 'Right-click: marks the nearest Tier III vault (deep Wilds). ONE use.',
  [Block.MobSpawner]: 'Vault guards pour out while it stands — break it (iron pick) to silence the room.',
  // Traps.
  [Block.SpikeTrap]: 'Iron spikes — anyone STANDING on them gets hurt. Line moats + walls!',
  [Block.Landmine]: 'Arms when placed. EXPLODES when stepped on — even by YOU. Hide it well.',
  [Block.Lever]: 'Right-click to pull: flips every Fall/Wall Trap within 8 blocks.',
  [Block.FallTrap]: 'Looks like a solid hatch — a linked Lever swings it OPEN and the floor drops away!',
  [Block.WallTrap]: 'A flat plate — a linked Lever springs it UP into a solid wall. Box them in!',
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
  [Item.WardenSigil]: 'Relic of the Bone Warden. Used for crypt trophies and violet decoration.',
  [Item.MireBloom]: 'Relic of the Mire Queen. Used for living trophies and mire decoration.',
  [Item.EmberCore]: 'Relic of the Ember Colossus. Used for forge trophies and ember decoration.',
  [Item.SeerPrism]: 'Relic of the Crystal Seer. Used for arcane trophies and prism decoration.',
  [Item.ArtificerGear]: 'Relic of the Gilded Artificer. Used for mechanical trophies and gilded decoration.',
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
