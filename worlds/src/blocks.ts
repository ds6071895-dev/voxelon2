// Block definitions: ids, atlas tiles, hardness (vanilla values), flags.

export const enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  OakLog = 6,
  OakPlanks = 7,
  Leaves = 8,
  Water = 10,
  Sandstone = 12,
  SnowyGrass = 13,
  BirchLog = 14,
  BirchLeaves = 15,
  SpruceLog = 16,
  SpruceLeaves = 17,
  TallGrass = 19,
  Dandelion = 21,
  Poppy = 22,
  Terracotta = 69,
  Basalt = 70,
  CherryLog = 77,
  CherryLeaves = 78,
  CherryPlanks = 79,
  CarvedVaultBrick = 183,
  MossyVaultBrick = 184,
  EmberBrick = 185,
  PrismBrick = 186,
  GildedVaultBrick = 187,
  SoulLantern = 188,
  EmberBrazier = 190,
  PrismLamp = 191,
  GildedLamp = 192,
  LuminousLimestone = 203,
  PearlTile = 204,
  RuneGlass = 205,
  IvoryColumn = 206,
  SpectralMarble = 207,
  JadeMosaic = 208,
  FurnaceCeramic = 209,
  OpalBrick = 210,
  ClockworkGrate = 211,
  VaultMosaic = 212,
  Barrier = 217,
  PackedSnow = 231,
  TeamWoolA = 242,
  TeamWoolB = 243,
  PartyTileC = 244,
  PartyTileD = 245,
  ParkourLaunchPad = 254,
  ParkourBoostPad = 255,
  // Rat and Seek: the Crooked Manor. Ids are stored in a chunk's byte array,
  // so they must stay under 256.
  ManorSlate = 100,
  ManorBoards = 101,
  ManorStoneBrick = 102,
  ManorPlaster = 103,
  ManorBeam = 104,
  ManorWindow = 105,
  ManorPanel = 106,
  ManorRidge = 107,
  ManorChimney = 108,
  ManorPaving = 109,
  ManorLantern = 110,
  ManorCeilingLamp = 111,
  ManorRunner = 112,
  /** 113..128: one floor covering per furnished room (see MANOR_RUGS). */
  ManorRug0 = 113,
  ManorTableLeg = 129,
  ManorCask = 130,
  ManorBookshelf = 131,
  ManorCuriosShelf = 132,
  ManorMarble = 133,
  ManorMarbleSlab = 134,
  ManorStove = 135,
  ManorFlowerPot = 136,
  ManorLinen = 137,
  ManorWashtub = 138,
  ManorPewter = 139,
  ManorCopperTank = 140,
  ManorFurnace = 141,
  ManorHayBale = 142,
  ManorPiano = 143,
  ManorGramophone = 144,
  ManorMusicBox = 145,
  ManorVerdigris = 146,
  ManorHedge = 147,
  ManorMossyPaving = 148,
  ManorGlass = 149,
  ManorMoss = 150,
  ManorGardenPost = 151,
  ManorGilt = 152,
  ManorBronzeTile = 153,
  ManorCageBars = 154,
  /** Stairs climbing toward -z (tall half on the north side). */
  ManorStairN = 155,
  /** Stairs climbing toward +z (tall half on the south side). */
  ManorStairS = 156,
  ManorMousetrap = 157,
  ManorLeverOff = 158,
  ManorLeverOn = 159,
  /** The Cheese Exchange: the brass machine rats trade cheese at. */
  ManorExchangeBase = 160,
  ManorExchangeTop = 161,
}

/** Atlas tiles. Ids are the atlas cell index (and seed each tile's art), so
 *  they are kept stable rather than renumbered. */
export const enum Tile {
  GrassTop = 0,
  GrassSide = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  LogSide = 6,
  LogTop = 7,
  Planks = 8,
  Leaves = 9,
  Glass = 10,
  Water = 11,
  Sandstone = 13,
  SandstoneTop = 14,
  Snow = 15,
  SnowySide = 16,
  BirchLogSide = 17,
  BirchLogTop = 18,
  SpruceLogSide = 19,
  SpruceLogTop = 20,
  BirchLeaves = 21,
  SpruceLeaves = 22,
  TallGrass = 25,
  Dandelion = 27,
  Poppy = 28,
  IronAxe = 59,
  Bullet = 102,
  Terracotta = 125,
  Basalt = 126,
  BurstRifle = 131,
  JumpBoost = 142,
  CherryLogSide = 153,
  CherryLogTop = 154,
  CherryLeaves = 155,
  CherryPlanks = 156,
  MedkitSprite = 170,
  CarvedVaultBrick = 207,
  MossyVaultBrick = 208,
  EmberBrick = 209,
  PrismBrick = 210,
  GildedVaultBrick = 211,
  SoulLantern = 212,
  EmberBrazier = 214,
  PrismLamp = 215,
  GildedLamp = 216,
  LuminousLimestone = 222,
  PearlTile = 223,
  RuneGlass = 224,
  IvoryColumn = 225,
  SpectralMarble = 226,
  JadeMosaic = 227,
  FurnaceCeramic = 228,
  OpalBrick = 229,
  ClockworkGrate = 230,
  VaultMosaic = 231,
  TeamWoolA = 265,
  TeamWoolB = 266,
  PartyTileC = 267,
  PartyTileD = 268,
  BridgeBow = 271,
  BridgeArrow = 272,
  ParkourLaunchPad = 294,
  ParkourBoostPad = 295,
  // The Crooked Manor (Rat and Seek). 300..369 blocks, 370..399 items.
  ManorSlate = 300,
  ManorBoards = 301,
  ManorStoneBrick = 302,
  ManorPlaster = 303,
  ManorBeamSide = 304,
  ManorBeamTop = 305,
  ManorWindow = 306,
  ManorPanel = 307,
  ManorRidge = 308,
  ManorChimney = 309,
  ManorPaving = 310,
  ManorLantern = 311,
  ManorCeilingLamp = 312,
  ManorRunner = 313,
  /** 314..329: the sixteen room floors. */
  ManorRug0 = 314,
  ManorTableLeg = 330,
  ManorCaskSide = 331,
  ManorCaskTop = 332,
  ManorBookshelf = 333,
  ManorCuriosShelf = 334,
  ManorMarble = 335,
  ManorStoveSide = 336,
  ManorIronTop = 337,
  ManorFlowerPot = 338,
  ManorLinen = 339,
  ManorWashtub = 340,
  ManorPewter = 341,
  ManorCopperTank = 342,
  ManorFurnace = 343,
  ManorHaySide = 344,
  ManorHayTop = 345,
  ManorPiano = 346,
  ManorGramophoneSide = 347,
  ManorGramophoneTop = 348,
  ManorMusicBox = 349,
  ManorVerdigris = 350,
  ManorHedge = 351,
  ManorMossyPaving = 352,
  ManorMoss = 353,
  ManorGardenPost = 354,
  ManorGilt = 355,
  ManorBronzeTile = 356,
  ManorCageBars = 357,
  ManorStair = 358,
  ManorMousetrap = 359,
  ManorLever = 360,
  ManorExchangeFront = 361,
  ManorExchangeTop = 362,
  ManorExchangeDome = 363,
  ManorExchangeCap = 364,
  // Rat and Seek items.
  RatCatcher = 370,
  SeekerCompass = 371,
  ScentPulse = 372,
  Flashlight = 373,
  MousetrapItem = 374,
  CheeseBait = 375,
  SqueakTaunt = 376,
  Scamper = 377,
  CageRattle = 378,
  EscapeCard = 379,
  ClassPicker = 380,
  WhiskerSense = 381,
  CheeseMagnet = 382,
  DecoyRat = 383,
  Disarm = 384,
  Cheese = 385,
  ClassScout = 386,
  ClassThief = 387,
  ClassTrickster = 388,
  ClassTinkerer = 389,
  SeekerPicker = 390,
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';

type BlockShape = 'cube' | 'cross' | 'box';

/** Min/max corner of an axis-aligned box in cell-local [0,1] space. */
export type Box = [[number, number, number], [number, number, number]];
type TintKind = 'grass' | 'foliage' | 'water' | null;

export interface BlockInfo {
  /** Block light emitted (0-15). */
  emission: number;
  /** Tool that mines this block faster. */
  tool: ToolKind | null;
  /** Drops only when mined with the right tool of sufficient tier. */
  requiresTool: boolean;
  /** Minimum tool tier to harvest (wood 0, stone 1, iron 2). */
  minTier: number;
  name: string;
  /** Vanilla hardness; hand break time = hardness * 1.5s. <0 = unbreakable. */
  hardness: number;
  /** Has collision. */
  solid: boolean;
  /** Fully hides faces of neighbouring blocks. */
  opaque: boolean;
  /** Occludes light for ambient-occlusion purposes. */
  occludes: boolean;
  /** cube, cross (billboard plant), or box: one or more sub-boxes (stairs,
   *  slabs, lanterns, plates) that are drawn AND collided exactly. */
  shape: BlockShape;
  /** Sub-boxes of a `box` block. */
  boxes?: Box[];
  /** Tint: grass tints only the top face of Grass, all of TallGrass. */
  tint: TintKind;
  /** Placing a block into this one replaces it (tall grass). */
  replaceable: boolean;
  /** Atlas tile per face (cross shapes use `side`). */
  top: Tile;
  bottom: Tile;
  side: Tile;
}

interface Partial {
  name: string;
  hardness: number;
  top: Tile;
  bottom?: Tile;
  side?: Tile;
  solid?: boolean;
  opaque?: boolean;
  occludes?: boolean;
  shape?: BlockShape;
  tint?: TintKind;
  replaceable?: boolean;
  emission?: number;
  boxes?: Box[];
}

function def(p: Partial): BlockInfo {
  return {
    emission: p.emission ?? 0,
    tool: null,
    requiresTool: false,
    minTier: 0,
    name: p.name,
    hardness: p.hardness,
    solid: p.solid ?? true,
    opaque: p.opaque ?? true,
    occludes: p.occludes ?? true,
    shape: p.shape ?? 'cube',
    tint: p.tint ?? null,
    replaceable: p.replaceable ?? false,
    boxes: p.boxes,
    top: p.top,
    bottom: p.bottom ?? p.top,
    side: p.side ?? p.top,
  };
}

function plant(name: string, tile: Tile, tint: TintKind, replaceable: boolean): BlockInfo {
  return def({
    name, hardness: 0, top: tile,
    solid: false, opaque: false, occludes: false,
    shape: 'cross', tint, replaceable,
  });
}

export const BLOCKS: Record<number, BlockInfo> = {
  [Block.Grass]: def({
    name: 'Grass Block', hardness: 0.6,
    top: Tile.GrassTop, bottom: Tile.Dirt, side: Tile.GrassSide, tint: 'grass',
  }),
  [Block.Dirt]: def({ name: 'Dirt', hardness: 0.5, top: Tile.Dirt }),
  [Block.Stone]: def({ name: 'Stone', hardness: 1.5, top: Tile.Stone }),
  [Block.Cobblestone]: def({ name: 'Cobblestone', hardness: 2.0, top: Tile.Cobblestone }),
  [Block.Sand]: def({ name: 'Sand', hardness: 0.5, top: Tile.Sand }),
  [Block.OakLog]: def({
    name: 'Oak Log', hardness: 2.0, top: Tile.LogTop, side: Tile.LogSide,
  }),
  [Block.OakPlanks]: def({ name: 'Oak Planks', hardness: 2.0, top: Tile.Planks }),
  [Block.Leaves]: def({
    name: 'Oak Leaves', hardness: 0.2, top: Tile.Leaves,
    opaque: false, tint: 'foliage',
  }),
  [Block.Water]: def({
    // Water takes the world's water tint rather than one flat blue.
    name: 'Water', hardness: -1, top: Tile.Water, tint: 'water',
    solid: false, opaque: false, occludes: false,
  }),

  [Block.Sandstone]: def({
    name: 'Sandstone', hardness: 0.8,
    top: Tile.SandstoneTop, side: Tile.Sandstone,
  }),
  [Block.SnowyGrass]: def({
    name: 'Snowy Grass Block', hardness: 0.6,
    top: Tile.Snow, bottom: Tile.Dirt, side: Tile.SnowySide,
  }),
  [Block.PackedSnow]: def({ name: 'Packed Snow', hardness: 0.5, top: Tile.Snow }),
  [Block.BirchLog]: def({
    name: 'Birch Log', hardness: 2.0,
    top: Tile.BirchLogTop, side: Tile.BirchLogSide,
  }),
  [Block.BirchLeaves]: def({
    name: 'Birch Leaves', hardness: 0.2, top: Tile.BirchLeaves, opaque: false,
  }),
  [Block.SpruceLog]: def({
    name: 'Spruce Log', hardness: 2.0,
    top: Tile.SpruceLogTop, side: Tile.SpruceLogSide,
  }),
  [Block.SpruceLeaves]: def({
    name: 'Spruce Leaves', hardness: 0.2, top: Tile.SpruceLeaves, opaque: false,
  }),
  [Block.TallGrass]: plant('Grass', Tile.TallGrass, 'grass', true),
  [Block.Dandelion]: plant('Dandelion', Tile.Dandelion, null, false),
  [Block.Poppy]: plant('Poppy', Tile.Poppy, null, false),
  [Block.Terracotta]: def({ name: 'Terracotta', hardness: 1.25, top: Tile.Terracotta }),
  [Block.Basalt]: def({ name: 'Basalt', hardness: 1.25, top: Tile.Basalt }),
  [Block.CherryLog]: def({
    name: 'Cherry Log', hardness: 2.0, top: Tile.CherryLogTop, side: Tile.CherryLogSide,
  }),
  // Cherry leaves are PINK — painted directly, no biome foliage tint.
  [Block.CherryLeaves]: def({
    name: 'Cherry Leaves', hardness: 0.2, top: Tile.CherryLeaves, opaque: false,
  }),
  [Block.CherryPlanks]: def({ name: 'Cherry Planks', hardness: 2.0, top: Tile.CherryPlanks }),
  // Venue masonry and lamps: the Duels colosseum and the Bridge/Parkour themes.
  [Block.CarvedVaultBrick]: def({
    name: 'Carved Vault Brick', hardness: 18, top: Tile.CarvedVaultBrick,
  }),
  [Block.MossyVaultBrick]: def({
    name: 'Mossy Vault Brick', hardness: 16, top: Tile.MossyVaultBrick,
  }),
  [Block.EmberBrick]: def({
    name: 'Ember Brick', hardness: 20, emission: 2, top: Tile.EmberBrick,
  }),
  [Block.PrismBrick]: def({
    name: 'Prism Brick', hardness: 18, emission: 4, top: Tile.PrismBrick,
  }),
  [Block.GildedVaultBrick]: def({
    name: 'Gilded Vault Brick', hardness: 20, emission: 2, top: Tile.GildedVaultBrick,
  }),
  [Block.SoulLantern]: def({
    name: 'Soul Lantern', hardness: 1.5, emission: 13, top: Tile.SoulLantern,
    opaque: false, occludes: false,
  }),
  [Block.EmberBrazier]: def({
    name: 'Ember Brazier', hardness: 2, emission: 15, top: Tile.EmberBrazier,
    opaque: false, occludes: false,
  }),
  [Block.PrismLamp]: def({
    name: 'Prism Lamp', hardness: 1.5, emission: 14, top: Tile.PrismLamp,
    opaque: false, occludes: false,
  }),
  [Block.GildedLamp]: def({
    name: 'Gilded Lamp', hardness: 1.5, emission: 14, top: Tile.GildedLamp,
    opaque: false, occludes: false,
  }),
  [Block.LuminousLimestone]: def({
    name: 'Luminous Limestone', hardness: 18, emission: 3, top: Tile.LuminousLimestone,
  }),
  [Block.PearlTile]: def({ name: 'Pearl Tile', hardness: 18, emission: 2, top: Tile.PearlTile }),
  [Block.RuneGlass]: def({
    name: 'Rune Glass', hardness: 12, emission: 8, top: Tile.RuneGlass,
    opaque: false, occludes: false,
  }),
  [Block.IvoryColumn]: def({ name: 'Ivory Column', hardness: 20, top: Tile.IvoryColumn }),
  [Block.SpectralMarble]: def({
    name: 'Spectral Marble', hardness: 18, emission: 4, top: Tile.SpectralMarble,
  }),
  [Block.JadeMosaic]: def({ name: 'Jade Mosaic', hardness: 17, emission: 3, top: Tile.JadeMosaic }),
  [Block.FurnaceCeramic]: def({
    name: 'Furnace Ceramic', hardness: 20, emission: 3, top: Tile.FurnaceCeramic,
  }),
  [Block.OpalBrick]: def({ name: 'Opal Brick', hardness: 18, emission: 5, top: Tile.OpalBrick }),
  [Block.ClockworkGrate]: def({
    name: 'Clockwork Grate', hardness: 20, emission: 2, top: Tile.ClockworkGrate,
    opaque: false,
  }),
  [Block.VaultMosaic]: def({ name: 'Vault Mosaic', hardness: 18, emission: 2, top: Tile.VaultMosaic }),
  [Block.Barrier]: def({
    name: 'Barrier', hardness: -1,
    solid: true, opaque: false, occludes: false,
    top: Tile.Glass,
  }),
  // Player-placeable arena blocks. Cheap to break so a bridge fight stays fast.
  [Block.TeamWoolA]: def({ name: 'Crimson Wool', hardness: 0.8, top: Tile.TeamWoolA }),
  [Block.TeamWoolB]: def({ name: 'Cobalt Wool', hardness: 0.8, top: Tile.TeamWoolB }),
  // Parkour's live surfaces. The venue stamps them; the course knows where
  // every one is, so the tile itself carries no behaviour of its own.
  [Block.PartyTileC]: def({ name: 'Crumble Tile', hardness: 0.8, top: Tile.PartyTileC }),
  [Block.PartyTileD]: def({ name: 'Blink Stone', hardness: 0.8, emission: 3, top: Tile.PartyTileD }),
  [Block.ParkourLaunchPad]: def({
    name: 'Launch Pad', hardness: -1, emission: 6, top: Tile.ParkourLaunchPad,
  }),
  [Block.ParkourBoostPad]: def({
    name: 'Boost Pad', hardness: -1, emission: 6, top: Tile.ParkourBoostPad,
  }),

  // ── The Crooked Manor (Rat and Seek). Nothing in the manor can be broken. ──
  [Block.ManorSlate]: def({ name: 'Slate Tiles', hardness: -1, top: Tile.ManorSlate }),
  [Block.ManorBoards]: def({ name: 'Floorboards', hardness: -1, top: Tile.ManorBoards }),
  [Block.ManorStoneBrick]: def({ name: 'Manor Stone', hardness: -1, top: Tile.ManorStoneBrick }),
  [Block.ManorPlaster]: def({ name: 'Limewash Plaster', hardness: -1, top: Tile.ManorPlaster }),
  [Block.ManorBeam]: def({ name: 'Timber Beam', hardness: -1, top: Tile.ManorBeamTop, side: Tile.ManorBeamSide }),
  [Block.ManorWindow]: def({
    name: 'Leaded Window', hardness: -1, top: Tile.ManorWindow, opaque: false, occludes: false,
  }),
  [Block.ManorPanel]: def({ name: 'Wainscot Panel', hardness: -1, top: Tile.ManorPanel }),
  [Block.ManorRidge]: def({ name: 'Ridge Stone', hardness: -1, top: Tile.ManorRidge }),
  [Block.ManorChimney]: def({ name: 'Chimney Brick', hardness: -1, top: Tile.ManorChimney }),
  [Block.ManorPaving]: def({ name: 'Paving', hardness: -1, top: Tile.ManorPaving }),
  [Block.ManorLantern]: def({
    name: 'Oil Lantern', hardness: -1, emission: 15, top: Tile.ManorLantern,
    shape: 'box', opaque: false, occludes: false, boxes: [[[0.3125, 0, 0.3125], [0.6875, 0.5625, 0.6875]]],
  }),
  [Block.ManorCeilingLamp]: def({ name: 'Ceiling Lamp', hardness: -1, emission: 15, top: Tile.ManorCeilingLamp }),
  [Block.ManorRunner]: def({ name: 'Hall Runner', hardness: -1, top: Tile.ManorRunner }),
  [Block.ManorTableLeg]: def({ name: 'Turned Post', hardness: -1, top: Tile.ManorTableLeg }),
  [Block.ManorCask]: def({ name: 'Cask', hardness: -1, top: Tile.ManorCaskTop, side: Tile.ManorCaskSide }),
  [Block.ManorBookshelf]: def({ name: 'Bookcase', hardness: -1, top: Tile.ManorBoards, side: Tile.ManorBookshelf }),
  [Block.ManorCuriosShelf]: def({ name: 'Curio Cabinet', hardness: -1, top: Tile.ManorBoards, side: Tile.ManorCuriosShelf }),
  [Block.ManorMarble]: def({ name: 'Marble', hardness: -1, top: Tile.ManorMarble }),
  [Block.ManorMarbleSlab]: def({
    name: 'Marble Shelf', hardness: -1, top: Tile.ManorMarble,
    shape: 'box', opaque: false, occludes: false, boxes: [[[0, 0, 0], [1, 0.5, 1]]],
  }),
  [Block.ManorStove]: def({ name: 'Iron Range', hardness: -1, top: Tile.ManorIronTop, side: Tile.ManorStoveSide, emission: 4 }),
  [Block.ManorFlowerPot]: def({
    name: 'Flower Pot', hardness: -1, top: Tile.ManorFlowerPot,
    shape: 'box', opaque: false, occludes: false, boxes: [[[0.3125, 0, 0.3125], [0.6875, 0.375, 0.6875]]],
  }),
  [Block.ManorLinen]: def({ name: 'Bed Linen', hardness: -1, top: Tile.ManorLinen }),
  [Block.ManorWashtub]: def({ name: 'Washtub', hardness: -1, top: Tile.ManorWashtub }),
  [Block.ManorPewter]: def({ name: 'Pewter', hardness: -1, top: Tile.ManorPewter }),
  [Block.ManorCopperTank]: def({ name: 'Copper Tank', hardness: -1, top: Tile.ManorCopperTank }),
  [Block.ManorFurnace]: def({ name: 'Boiler Furnace', hardness: -1, top: Tile.ManorIronTop, side: Tile.ManorFurnace, emission: 6 }),
  [Block.ManorHayBale]: def({ name: 'Straw Bale', hardness: -1, top: Tile.ManorHayTop, side: Tile.ManorHaySide }),
  [Block.ManorPiano]: def({ name: 'Piano Lacquer', hardness: -1, top: Tile.ManorPiano }),
  [Block.ManorGramophone]: def({
    name: 'Gramophone Cabinet', hardness: -1, top: Tile.ManorGramophoneTop, side: Tile.ManorGramophoneSide,
  }),
  [Block.ManorMusicBox]: def({ name: 'Music Box', hardness: -1, top: Tile.ManorMusicBox }),
  [Block.ManorVerdigris]: def({ name: 'Verdigris Copper', hardness: -1, top: Tile.ManorVerdigris }),
  [Block.ManorHedge]: def({ name: 'Box Hedge', hardness: -1, top: Tile.ManorHedge, opaque: false }),
  [Block.ManorMossyPaving]: def({ name: 'Mossy Paving', hardness: -1, top: Tile.ManorMossyPaving }),
  [Block.ManorGlass]: def({ name: 'Greenhouse Glass', hardness: -1, top: Tile.Glass, opaque: false, occludes: false }),
  [Block.ManorMoss]: def({ name: 'Potting Moss', hardness: -1, top: Tile.ManorMoss }),
  [Block.ManorGardenPost]: def({
    name: 'Garden Post', hardness: -1, top: Tile.ManorGardenPost,
    shape: 'box', opaque: false, occludes: false, boxes: [[[0.25, 0, 0.25], [0.75, 1, 0.75]]],
  }),
  [Block.ManorGilt]: def({ name: 'Gilt Plinth', hardness: -1, top: Tile.ManorGilt, emission: 2 }),
  [Block.ManorBronzeTile]: def({ name: 'Bronze Plinth', hardness: -1, top: Tile.ManorBronzeTile }),
  [Block.ManorCageBars]: def({ name: 'Cage Bars', hardness: -1, top: Tile.ManorCageBars, opaque: false, occludes: false }),
  [Block.ManorStairN]: def({
    name: 'Stone Stair', hardness: -1, top: Tile.ManorStair,
    shape: 'box', opaque: false, occludes: false,
    boxes: [[[0, 0, 0], [1, 0.5, 1]], [[0, 0.5, 0], [1, 1, 0.5]]],
  }),
  [Block.ManorStairS]: def({
    name: 'Stone Stair', hardness: -1, top: Tile.ManorStair,
    shape: 'box', opaque: false, occludes: false,
    boxes: [[[0, 0, 0], [1, 0.5, 1]], [[0, 0.5, 0.5], [1, 1, 1]]],
  }),
  [Block.ManorMousetrap]: def({
    name: 'Snap Mousetrap', hardness: -1, top: Tile.ManorMousetrap, solid: false,
    shape: 'box', opaque: false, occludes: false, boxes: [[[0.125, 0, 0.1875], [0.875, 0.0625, 0.8125]]],
  }),
  [Block.ManorLeverOff]: def({
    name: 'Chandelier Rope Lever', hardness: -1, top: Tile.ManorLever, solid: false,
    shape: 'box', opaque: false, occludes: false,
    boxes: [[[0.3125, 0, 0.25], [0.6875, 0.1875, 0.75]], [[0.4375, 0.1875, 0.25], [0.5625, 0.75, 0.375]]],
  }),
  [Block.ManorLeverOn]: def({
    name: 'Chandelier Rope Lever', hardness: -1, top: Tile.ManorLever, solid: false,
    shape: 'box', opaque: false, occludes: false,
    boxes: [[[0.3125, 0, 0.25], [0.6875, 0.1875, 0.75]], [[0.4375, 0.1875, 0.625], [0.5625, 0.75, 0.75]]],
  }),
  [Block.ManorExchangeBase]: def({
    name: 'Cheese Exchange', hardness: -1, top: Tile.ManorIronTop, side: Tile.ManorExchangeFront, emission: 3,
  }),
  [Block.ManorExchangeTop]: def({
    name: 'Cheese Exchange', hardness: -1, top: Tile.ManorExchangeCap, side: Tile.ManorExchangeDome, emission: 9,
    opaque: false,
  }),

};

/** The sixteen room floors of the manor, in blueprint order (cellar rooms,
 *  ground floor, upstairs, attic; west-north, east-north, west-south, east-south). */
export const MANOR_RUGS: readonly { name: string; tiled: boolean }[] = [
  { name: 'Claret Floor Tiles', tiled: true }, { name: 'Ash Floor Tiles', tiled: true },
  { name: 'Sage Floor Tiles', tiled: true }, { name: 'Umber Floor Tiles', tiled: true },
  { name: 'Forest Carpet', tiled: false }, { name: 'Mustard Floor Tiles', tiled: true },
  { name: 'Crimson Carpet', tiled: false }, { name: 'Amber Floor Tiles', tiled: true },
  { name: 'Indigo Carpet', tiled: false }, { name: 'Rose Carpet', tiled: false },
  { name: 'Violet Carpet', tiled: false }, { name: 'Sky Floor Tiles', tiled: true },
  { name: 'Cocoa Carpet', tiled: false }, { name: 'Teal Carpet', tiled: false },
  { name: 'Pewter Carpet', tiled: false }, { name: 'Magenta Carpet', tiled: false },
];
MANOR_RUGS.forEach((rug, i) => {
  BLOCKS[Block.ManorRug0 + i] = def({ name: rug.name, hardness: -1, top: (Tile.ManorRug0 + i) as Tile });
});

/** Collision boxes of a SOLID block (full cube unless it is a box shape). */
const FULL_BOX: Box[] = [[[0, 0, 0], [1, 1, 1]]];
export function collisionBoxes(id: number): Box[] | null {
  const info = BLOCKS[id];
  if (!info || !info.solid || id === Block.Air) return null;
  return info.boxes ?? FULL_BOX;
}
/** Does the point (world coordinates) lie inside a solid box of its cell? */
export function pointInSolid(id: number, fx: number, fy: number, fz: number): boolean {
  const boxes = collisionBoxes(id);
  if (!boxes) return false;
  for (const [mn, mx] of boxes) {
    if (fx >= mn[0] && fx < mx[0] && fy >= mn[1] && fy < mx[1] && fz >= mn[2] && fz < mx[2]) return true;
  }
  return false;
}

// Vanilla tool effectiveness and harvest tiers (wood 0, stone 1, iron 2).
const PICKAXE_TIERS: [Block, number][] = [
  [Block.Stone, 0], [Block.Cobblestone, 0], [Block.Sandstone, 0],
  [Block.CarvedVaultBrick, 2], [Block.MossyVaultBrick, 2],
  [Block.LuminousLimestone, 2], [Block.PearlTile, 2], [Block.RuneGlass, 2],
  [Block.IvoryColumn, 2], [Block.SpectralMarble, 2], [Block.JadeMosaic, 2],
  [Block.FurnaceCeramic, 2], [Block.OpalBrick, 2], [Block.ClockworkGrate, 2],
  [Block.VaultMosaic, 2],
  [Block.EmberBrick, 2], [Block.PrismBrick, 2], [Block.GildedVaultBrick, 2],
  [Block.SoulLantern, 1], [Block.EmberBrazier, 1],
  [Block.PrismLamp, 1], [Block.GildedLamp, 1],
];
for (const [b, tier] of PICKAXE_TIERS) {
  BLOCKS[b].tool = 'pickaxe';
  BLOCKS[b].requiresTool = true;
  BLOCKS[b].minTier = tier;
}
for (const b of [Block.OakLog, Block.BirchLog, Block.SpruceLog, Block.OakPlanks]) BLOCKS[b].tool = 'axe';
for (const b of [
  Block.Dirt, Block.Grass, Block.SnowyGrass, Block.PackedSnow, Block.Sand,
]) BLOCKS[b].tool = 'shovel';
for (const b of [Block.Terracotta, Block.Basalt]) BLOCKS[b].tool = 'pickaxe';

export function isSolid(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.solid ?? false);
}
export function isOpaque(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.opaque ?? false);
}
export function occludesAO(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.occludes ?? false);
}
export function isReplaceable(id: number): boolean {
  return id === Block.Air || id === Block.Water ||
    (BLOCKS[id]?.replaceable ?? false);
}
