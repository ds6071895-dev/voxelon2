import { validateText } from '../src/content_filter';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('Testing content_filter...');

// Should pass:
const allowed = [
  'Iron Vanguard',
  'Voxel Knights',
  'Crimson Guard',
  'Azure Legion',
  'Phoenix Rising',
  'Stormbreakers',
  'Dragon Slayers',
  'Compass Guild',
  'Classic Crafters',
  'Mining Syndicate',
  // Scunthorpe guard: ordinary words that CONTAIN a banned substring. Each of
  // these was wrongly rejected while the glued-substring pass applied to every
  // list, geography included.
  'Woman Warriors',
  'Roman Legion',
  'Peacock Squadron',
  'Cockpit Crew',
  'Grape Growers',
  'The Incubators',
  'Dickinson Miners',
  'Therapist Union',
  'Assassin Creed',
  'Together We Build',
  'Chaos Engineers',
  'Arsenal of Freedom',
];

for (const name of allowed) {
  const res = validateText(name, 'Party Name');
  assert(res.ok, `Expected "${name}" to be allowed, but got: ${res.reason}`);
}

// Should reject:
const rejected = [
  'USA Party',
  'United States of America',
  'Russian Federation',
  'China No1',
  'u.s.a.',
  'r u s s i a',
  'Trump 2024',
  'Biden Boys',
  'Communist Manifesto',
  'Nazi Reich',
  'Fascist League',
  'Fuck You',
  'f_u_c_k',
  'fuuuuck',
  'b!tch',
  'London Crew',
  'Paris Guild',
  'Tokyo Drifters',
  // Padded-repeat evasion. Collapsing repeats on the TEXT alone never matched a
  // term that has a double letter of its own, so this walked through.
  'ruuussssiiiaaa',
  // A 'v' -> 'u' leetspeak rule used to fold these into "uietnam" / "uatican",
  // which no term could ever match.
  'Vietnam Vets',
  'Venezuela Rising',
  'Vatican Guard',
  // Slurs glued into longer text still have to die.
  'fuckoff clan',
  'shitheads',
];

for (const name of rejected) {
  const res = validateText(name, 'Party Name');
  assert(!res.ok, `Expected "${name}" to be rejected, but it passed!`);
}

console.log('All content_filter tests passed successfully!');
