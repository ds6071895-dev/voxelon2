import {
  BOSS_SCORE_LOOP_BARS,
  BOSS_SCORE_LOOP_STEPS,
  BOSS_SCORE_PROFILES,
  bossScoreLoopSeconds,
  sectionDynamic,
  MUSIC_MAKEUP_GAIN,
} from '../src/boss_music';
import type { VaultFamily } from '../src/vaults';
import type { BossMusicCue } from '../src/boss_music';
import { DEFAULT_MUSIC_VOLUME, ENCOUNTER_AMBIENCE_DUCK, ENCOUNTER_EFFECTS_DUCK,
  ENCOUNTER_MUSIC_BOOST } from '../src/audio';

const families: readonly VaultFamily[] = ['crypt', 'mire', 'ember', 'crystal', 'gilded'];
let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) console.log(`PASS  ${message}`);
  else {
    failures++;
    console.error(`FAIL  ${message}`);
  }
}

function clock(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

check(BOSS_SCORE_LOOP_BARS === 96, 'macro arrangement is exactly 96 bars');
check(BOSS_SCORE_LOOP_STEPS === 1536, '96 bars contain exactly 1,536 sixteenth-note steps');
check(Object.keys(BOSS_SCORE_PROFILES).length === families.length,
  'all five dungeon-boss families have score profiles');
check(ENCOUNTER_MUSIC_BOOST > 1 && ENCOUNTER_MUSIC_BOOST <= 1.3 &&
  ENCOUNTER_EFFECTS_DUCK >= 0.7 && ENCOUNTER_EFFECTS_DUCK < 1 &&
  ENCOUNTER_AMBIENCE_DUCK >= 0.3 && ENCOUNTER_AMBIENCE_DUCK < ENCOUNTER_EFFECTS_DUCK,
  'encounter mix lifts music while safely ducking effects and ambience');
// The score is quiet by construction (polite per-voice gains, then compressed).
// Without real makeup gain it loses to every gunshot in the arena.
check(MUSIC_MAKEUP_GAIN >= 2 && MUSIC_MAKEUP_GAIN <= 4,
  `the score is made up to a competitive level after compression (×${MUSIC_MAKEUP_GAIN})`);
check(DEFAULT_MUSIC_VOLUME >= 0.8 && DEFAULT_MUSIC_VOLUME <= 1,
  `music defaults loud enough to be heard over a fight (${DEFAULT_MUSIC_VOLUME})`);
const redesignedCues: BossMusicCue[] = ['door', 'movement', 'army', 'healing',
  'interrupt', 'combo', 'phase', 'enrage', 'victory', 'reset'];
check(new Set(redesignedCues).size === 10,
  'dramatic encounter cue surface covers movement, armies, healing and lifecycle');

const titles = new Set<string>();
const bosses = new Set<string>();
for (const family of families) {
  const profile = BOSS_SCORE_PROFILES[family];
  const seconds = bossScoreLoopSeconds(family);
  const expected = BOSS_SCORE_LOOP_BARS * 4 * 60 / profile.bpm;

  check(profile.motif.length === 16, `${profile.boss}: signature motif is one complete bar`);
  check(profile.bass.length === 16, `${profile.boss}: bass cell is one complete bar`);
  check(profile.scale.length === 7, `${profile.boss}: scale has seven stable degrees`);
  check(profile.chords.length >= 4, `${profile.boss}: harmonic palette has at least four chords`);
  check(Math.abs(seconds - expected) < 1e-9,
    `${profile.boss}: loop duration is tempo-derived exactly (${clock(seconds)})`);
  check(seconds >= 170 && seconds <= 310,
    `${profile.boss}: long-form loop stays between 2:50 and 5:10`);
  check(profile.reverb >= 0 && profile.reverb <= 1 && profile.delay >= 0 && profile.delay <= 1,
    `${profile.boss}: ambience sends are bounded`);
  titles.add(profile.title);
  bosses.add(profile.boss);
}

check(titles.size === families.length, 'every boss track has a unique title');
check(bosses.size === families.length, 'every profile targets a unique boss');

// The arrangement must actually breathe — a score held at one level for four
// minutes reads as a loop however much the notes underneath it change.
{
  const levels = Array.from({ length: 12 }, (_, i) => sectionDynamic(i, 1));
  const quietest = Math.min(...levels);
  const loudest = Math.max(...levels);
  check(loudest / quietest >= 1.4,
    `the macro arrangement has real dynamic range (${quietest.toFixed(2)}→${loudest.toFixed(2)})`);
  check(levels.every((l) => l >= 0.35 && l <= 1.25),
    'every section level stays inside safe headroom');
  check(sectionDynamic(10, 3) > sectionDynamic(10, 2) &&
    sectionDynamic(10, 2) > sectionDynamic(10, 1),
    'each boss phase raises the score above the last');
  check(sectionDynamic(10, 3, true) > sectionDynamic(10, 3),
    'a boss on its last legs pushes the score harder still');
  check(sectionDynamic(0, 1) === sectionDynamic(12, 1),
    'the dynamic arc repeats exactly at the loop boundary');
}

if (failures > 0) {
  console.error(`\n${failures} BOSS MUSIC FAILURE${failures === 1 ? '' : 'S'}`);
  process.exit(1);
}
console.log('\nAll long-form boss soundtrack checks passed.');
