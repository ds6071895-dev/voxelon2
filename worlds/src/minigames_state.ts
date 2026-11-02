// Party Games: the client-visible match state, published by the engine
// (minigames.ts) a few times a second and drawn by minigames_client.ts.

export type MgPhase = 'brief' | 'countdown' | 'round' | 'results' | 'podium';

export interface MgStanding { id: number; name: string; points: number; wins: number }

export interface MgResultRow { id: number; name: string; place: number; earned: number; detail: string }

/** A game's own board: Brain Rush's question and answers, Memory Mosaic's stage. */
export interface MgBoard {
  title: string;
  sub?: string;
  options?: { label: string; text: string; color: string; right?: boolean }[];
}

export interface MinigamesState {
  mode: 'minigames';
  serverNow: number;
  phase: MgPhase;
  /** When the current phase (or round) ends, server ms. */
  endsAt: number;
  /** The game being played (catalog id); null on the podium. */
  game: string | null;
  /** 0-based position in the lineup, and its length. */
  index: number;
  total: number;
  doubled: boolean;
  /** One line for the sidebar ("Leader: Sam 12", "Question 3/10"). */
  status: string;
  /** Totals, best first. */
  standings: MgStanding[];
  /** The last finished game's results card. */
  results: { game: string; rows: MgResultRow[] } | null;
  board: MgBoard | null;
  /** Players out of the current round (spectating). */
  out: number[];
  glowing?: number[];
  rings?: Record<number, { x: number; y: number; z: number; nx: number; ny: number; nz: number }>;
  leashes?: { from: [number,number,number]; to: [number,number,number] }[];
  podium: { order: MgStanding[]; awards: { title: string; name: string; detail?: string }[] } | null;
  /** The party leader (host); null from the queue. */
  host: number | null;
  over: boolean;
}
