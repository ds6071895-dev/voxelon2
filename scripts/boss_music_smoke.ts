import {
  BOSS_SCORE_LOOP_BARS,
  BOSS_SCORE_LOOP_STEPS,
  BOSS_SCORE_PROFILES,
  bossScoreLoopSeconds,
} from '../src/boss_music';
import type { VaultFamily } from '../src/vaults';

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

if (failures > 0) {
  console.error(`\n${failures} BOSS MUSIC FAILURE${failures === 1 ? '' : 'S'}`);
  process.exit(1);
}
console.log('\nAll long-form boss soundtrack checks passed.');
