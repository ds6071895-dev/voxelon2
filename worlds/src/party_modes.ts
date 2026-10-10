// One definition per playable party mode, shared by geometry and the engine.
import { BRIDGE_GOAL_LIMIT } from './bridge_rules';
import { PARKOUR_VENUE_X, PARKOUR_VENUE_Z, BRIDGE_SIZE_X, BRIDGE_SIZE_Z } from './venue_dims';

export type PartyMode = 'bridge' | 'parkour';
export type PartyGameId = PartyMode;
export interface PartyGameDef {
  id: PartyGameId;
  title: string;
  rule: string;
  durationMs: number;
  sizeX: number;
  sizeZ: number;
  queueCapacity: number;
  partyCapacity: number;
}

const MODES: Record<PartyMode, PartyGameDef> = {
  bridge: {
    id: 'bridge', title: 'THE BRIDGE',
    rule: `Iron axe, bow and wool. Sprint-hit rivals off the span, then dive into the enemy portal. First to ${BRIDGE_GOAL_LIMIT} goals.`,
    durationMs: 480_000, sizeX: BRIDGE_SIZE_X, sizeZ: BRIDGE_SIZE_Z,
    queueCapacity: 2, partyCapacity: 2,
  },
  parkour: {
    id: 'parkour', title: 'DRAGON CHASE',
    rule: 'Outrun the dragon to the end. Three lives. Everyone who makes it wins.',
    // The dragon supplies the playable clock; this is only a failsafe.
    durationMs: 1_200_000, sizeX: PARKOUR_VENUE_X, sizeZ: PARKOUR_VENUE_Z,
    queueCapacity: 2, partyCapacity: 4,
  },
};

export function partyGame(id: PartyGameId): PartyGameDef { return MODES[id] ?? MODES.bridge; }
/** The Bridge is a duel; a Dragon Chase party can bring four runners. */
export function partyModeCapacity(mode: PartyMode, fromParty: boolean): number {
  const def = partyGame(mode);
  return fromParty ? def.partyCapacity : def.queueCapacity;
}
