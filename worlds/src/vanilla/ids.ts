// Fixed id ranges. Items and blocks share one number space (a block item's id
// is its block id, items.ts `blockItem`), so every range is disjoint.
//
//   0..255       legacy Worlds blocks (Bedwars, Parkour, Rat and Seek, title)
//   119..347     legacy pure items (sparse; they sit in gaps of the block ids)
//   1024..4095   vanilla block states (block items use their family's default)
//   8192..12287  vanilla pure items
//
// Lookup tables are sized BLOCK_ID_LIMIT (blocks.ts); never size them 65536.

export const LEGACY_BLOCK_END = 256;
export const VANILLA_BLOCK_BASE = 1024;
export const VANILLA_BLOCK_END = 4096;
export const VANILLA_ITEM_BASE = 8192;
export const VANILLA_ITEM_END = 12288;

export function isVanillaBlockId(id: number): boolean { return id >= VANILLA_BLOCK_BASE && id < VANILLA_BLOCK_END; }
export function isVanillaItemId(id: number): boolean { return id >= VANILLA_ITEM_BASE && id < VANILLA_ITEM_END; }
