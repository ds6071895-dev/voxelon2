// ZERO-COST HEAVY CONTENT FILTER
//
// 100% offline, zero API cost, pure TypeScript module running on both client
// and server. Enforces the Voxelon community policy on user-submitted text:
// - Political party names, campaign slogans, and promises
// - Presidential faction broadcasts
//
// Blocks:
// 1. Real-world countries and nationalities (~195 sovereign nations + demonyms)
// 2. Major real cities and regions (London, Paris, Moscow, Beijing, Washington, etc.)
// 3. Real-world political figures, ideologies, and political parties
// 4. Toxicity, slurs, profanity, and vulgarities
//
// Features:
// - Leetspeak substitution normalization (@ -> a, 0 -> o, 1 -> i, 3 -> e, 5/$ -> s, etc.)
// - Repeat-character collapse (fuuuuck -> fuck, r u s s i a -> russia)
// - Word boundary sensitivity (avoids false positives on words like "assassin", "country", "classic")

export interface FilterResult {
  ok: boolean;
  reason?: string;
  matchedTerm?: string;
}

// 1. Comprehensive list of sovereign countries, territories, and demonyms (lowercased)
const COUNTRIES_AND_DEMONYMS: readonly string[] = [
  'afghanistan', 'afghan', 'albania', 'albanian', 'algeria', 'algerian', 'andorra', 'angola',
  'argentina', 'argentine', 'argentinian', 'armenia', 'armenian', 'australia', 'australian',
  'austria', 'austrian', 'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'bangladeshi',
  'barbados', 'belarus', 'belarusian', 'belgium', 'belgian', 'belize', 'benin', 'bhutan',
  'bolivia', 'bosnia', 'bosnian', 'herzegovina', 'botswana', 'brazil', 'brazilian', 'brunei',
  'bulgaria', 'bulgarian', 'burkina faso', 'burundi', 'cambodia', 'cambodian', 'cameroon',
  'canada', 'canadian', 'chad', 'chile', 'chilean', 'china', 'chinese', 'colombia', 'colombian',
  'comoros', 'congo', 'congolese', 'costa rica', 'croatia', 'croatian', 'cuba', 'cuban',
  'cyprus', 'cypriot', 'czech', 'czechia', 'denmark', 'danish', 'djibouti', 'dominica',
  'ecuador', 'egypt', 'egyptian', 'el salvador', 'eritrea', 'estonia', 'estonian', 'eswatini',
  'ethiopia', 'ethiopian', 'fiji', 'finland', 'finnish', 'france', 'french', 'gabon',
  'gambia', 'georgia', 'georgian', 'germany', 'german', 'deutschland', 'ghana', 'ghanaian',
  'greece', 'greek', 'grenada', 'guatemala', 'guinea', 'guyana', 'haiti', 'haitian',
  'honduras', 'hungary', 'hungarian', 'iceland', 'icelandic', 'india', 'indian', 'indonesia',
  'indonesian', 'iran', 'iranian', 'iraq', 'iraqi', 'ireland', 'irish', 'israel', 'israeli',
  'italy', 'italian', 'jamaica', 'jamaican', 'japan', 'japanese', 'jordan', 'jordanian',
  'kazakhstan', 'kenya', 'kenyan', 'kuwait', 'kyrgyzstan', 'laos', 'laotian', 'latvia',
  'latvian', 'lebanon', 'lebanese', 'lesotho', 'liberia', 'libya', 'libyan', 'liechtenstein',
  'lithuania', 'lithuanian', 'luxembourg', 'madagascar', 'malawi', 'malaysia', 'malaysian',
  'maldives', 'mali', 'malta', 'maltese', 'mauritania', 'mauritius', 'mexico', 'mexican',
  'moldova', 'monaco', 'mongolia', 'mongolian', 'montenegro', 'morocco', 'moroccan',
  'mozambique', 'myanmar', 'burma', 'namibia', 'nauru', 'nepal', 'nepalese', 'netherlands',
  'dutch', 'new zealand', 'nicaragua', 'niger', 'nigeria', 'nigerian', 'north korea',
  'norway', 'norwegian', 'oman', 'pakistan', 'pakistani', 'palau', 'palestine', 'palestinian',
  'panama', 'papua new guinea', 'paraguay', 'peru', 'peruvian', 'philippines', 'filipino',
  'poland', 'polish', 'portugal', 'portuguese', 'qatar', 'romania', 'romanian', 'russia',
  'russian', 'rwanda', 'rwandan', 'saudi arabia', 'saudi', 'senegal', 'serbia', 'serbian',
  'singapore', 'singaporean', 'slovakia', 'slovenia', 'somalia', 'somali', 'south africa',
  'south korea', 'korea', 'korean', 'south sudan', 'spain', 'spanish', 'sri lanka', 'sudan',
  'suriname', 'sweden', 'swedish', 'switzerland', 'swiss', 'syria', 'syrian', 'taiwan',
  'taiwanese', 'tajikistan', 'tanzania', 'thailand', 'thai', 'togo', 'tonga', 'trinidad',
  'tunisia', 'turkey', 'turkish', 'turkiye', 'turkmenistan', 'tuvalu', 'uganda', 'ukraine',
  'ukrainian', 'united arab emirates', 'uae', 'united kingdom', 'uk', 'britain', 'british',
  'england', 'english', 'scotland', 'scottish', 'wales', 'welsh', 'united states', 'usa',
  'america', 'american', 'uruguay', 'uzbekistan', 'vanuatu', 'vatican', 'venezuela',
  'venezuelan', 'vietnam', 'vietnamese', 'yemen', 'zambia', 'zimbabwe',
];

// 2. Major real cities and geopolitical regions
const CITIES_AND_REGIONS: readonly string[] = [
  'london', 'paris', 'new york', 'nyc', 'moscow', 'beijing', 'shanghai', 'tokyo',
  'berlin', 'rome', 'madrid', 'washington', 'dc', 'kyiv', 'kiev', 'warsaw', 'jerusalem',
  'tel aviv', 'gaza', 'cairo', 'tehran', 'baghdad', 'damascus', 'riyadh', 'dubai',
  'delhi', 'mumbai', 'seoul', 'bangkok', 'singapore', 'hong kong', 'taipei', 'ottawa',
  'toronto', 'mexico city', 'buenos aires', 'brasilia', 'sao paulo', 'canberra', 'sydney',
  'melbourne', 'europe', 'european', 'asia', 'asian', 'africa', 'african', 'middle east',
  'balkans', 'scandinavia', 'latin america', 'north america', 'south america', 'crimea',
  'donbas', 'donetsk', 'luhansk', 'kremlin', 'pentagon', 'white house', 'capitol',
];

// 3. Real-world political leaders, parties, ideologies, and conflicts
const POLITICAL_TERMS: readonly string[] = [
  'trump', 'biden', 'obama', 'bush', 'clinton', 'reagan', 'nixon', 'kennedy',
  'putin', 'zelensky', 'zelenskiy', 'netanyahu', 'khamenei', 'assad', 'erdogan',
  'xi jinping', 'jinping', 'mao', 'stalin', 'lenin', 'trotsky', 'bolshevik',
  'hitler', 'mussolini', 'franco', 'pinochet', 'pol pot', 'kim jong un', 'kim jong il',
  'churchill', 'thatcher', 'macron', 'scholz', 'merkel', 'sunak', 'starmer',
  'nazi', 'nazism', 'neo-nazi', 'fascist', 'fascism', 'communist', 'communism',
  'socialist', 'socialism', 'marxist', 'marxism', 'leninist', 'maoist',
  'democrat', 'democratic party', 'republican', 'gop', 'libertarian', 'conservative party',
  'labour party', 'tory', 'tories', 'whig', 'baathist', 'zionist', 'zionism',
  'taliban', 'al qaeda', 'isis', 'isil', 'hamas', 'hezbollah', 'houthi',
  'maga', 'antifa', 'white power', 'supremacist', 'jihad', 'apartheid',
];

// 4. Inappropriate terms, slurs, profanity, and toxicity
const INAPPROPRIATE_TERMS: readonly string[] = [
  'fuck', 'fucking', 'fucker', 'fucked', 'shit', 'shitty', 'bullshit',
  'bitch', 'bitches', 'bastard', 'cunt', 'cunts', 'dick', 'dicks', 'dickhead',
  'cock', 'cocks', 'cockhead', 'pussy', 'pussies', 'asshole', 'assholes',
  'whore', 'whores', 'slut', 'sluts', 'fag', 'faggot', 'faggots', 'nigger',
  'niggers', 'nigga', 'niggas', 'kike', 'kikes', 'chink', 'chinks', 'spic',
  'spics', 'gook', 'gooks', 'wetback', 'retard', 'retarded', 'pedophile',
  'pedo', 'paedo', 'porn', 'porno', 'hitler', 'swastika', 'genocide',
  'holocaust', 'rape', 'rapist', 'suicide',
];

// Map of common leetspeak substitutions to normalized alphabetic characters
const LEET_MAP: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '/\\': 'a',
  '8': 'b',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '$': 's',
  '5': 's',
  '7': 't',
  '+': 't',
  // NOTE: no 'v' -> 'u' rule. 'v' is an ordinary letter: folding it away
  // mangles innocent words and, worse, makes every term that genuinely
  // contains a 'v' (vietnam, venezuela, vatican, vanuatu) unmatchable.
  // The two-character '\\/' form below is the only real 'u' evasion.
  '\\/': 'u',
};

/**
 * Normalizes user input by unfolding leetspeak, collapsing consecutive repeats,
 * and standardizing whitespace.
 */
export function normalizeForFiltering(raw: string): string {
  if (!raw) return '';
  let str = raw.toLowerCase().trim();

  // Replace multi-char leet substitutions first
  str = str.replace(/\/\\/g, 'a').replace(/\\\//g, 'u');

  // Single-char leetspeak replacements
  let decoded = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    decoded += LEET_MAP[ch] ?? ch;
  }

  return decoded;
}

/**
 * Strips non-alphanumeric characters to catch spacing evasion (e.g. "u . s . a" or "r_u_s_s_i_a").
 */
export function collapseSeparators(str: string): string {
  return str.replace(/[^a-z0-9]/g, '');
}

/** Collapse runs of the same character ("fuuuuck" -> "fuck"). */
function collapseRepeats(str: string): string {
  return str.replace(/(.)\1+/g, '$1');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ordinary words that happen to CONTAIN a banned substring. Without this the
 * glued-text pass below turns into the Scunthorpe problem and eats perfectly
 * good party names — "Peacock Squadron", "Roman Legion", "Grape Growers".
 * Only consulted by the glued pass; a whole-word hit is still a hit.
 */
const SUBSTRING_ALLOWLIST: readonly string[] = [
  // ...cock
  'peacock', 'peacocks', 'cockpit', 'cocktail', 'cocktails', 'cockatoo', 'shuttlecock',
  'weathercock', 'haycock', 'stopcock', 'petcock',
  // ...dick / ...dic
  'dickinson', 'dickens', 'benedick',
  // ...rape / ...rapist
  'grape', 'grapes', 'drape', 'drapes', 'scrape', 'scrapes', 'scraper', 'therapist',
  'therapists', 'therapy', 'trapeze',
  // ...oman / ...man
  'woman', 'women', 'roman', 'romans', 'romance', 'yeoman', 'bowman', 'showman',
  // ...cuba
  'incubate', 'incubator', 'incubators', 'incubation',
  // ...chad
  'chadwick',
  // ...mali
  'normal', 'normally', 'formal', 'formality', 'anomaly', 'normalize',
  // ...shit / ...ass / ...anal
  'shiitake', 'shiatsu', 'assassin', 'assassins', 'classic', 'classics', 'compass',
  'analysis', 'analyst', 'analytic', 'canal', 'arsenal', 'brass', 'glass', 'grass',
  // ...iran / ...iraq / ...laos
  'tirade', 'chaos', 'chaotic',
  // ...mao / ...togo / ...uk
  'together', 'altogether',
];

/**
 * A prohibited term, precompiled once. Building ~600 RegExp objects on every
 * keystroke (the founding form validates as you type) was the old cost.
 */
interface CompiledTerm {
  term: string;
  /** Whole-word match against normalized text. */
  word: RegExp;
  /** Whole-word match against repeat-collapsed text, itself collapsed so
   *  "ruuussssiiiaaa" -> "rusia" can still meet "russia" -> "rusia". */
  collapsedWord: RegExp;
  /** Separator-free form, for "u.s.a." / "r u s s i a" style evasion. */
  stripped: string;
  strippedCollapsed: string;
  /** Slurs and profanity also get a glued-substring pass; geography does not,
   *  because a country name only reads as one when it stands as a word. */
  severe: boolean;
}

function compile(terms: readonly string[], severe: boolean): CompiledTerm[] {
  return terms.map((term) => ({
    term,
    word: new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'),
    collapsedWord: new RegExp(`\\b${escapeRegex(collapseRepeats(term))}\\b`, 'i'),
    stripped: collapseSeparators(term),
    strippedCollapsed: collapseSeparators(collapseRepeats(term)),
    severe,
  }));
}

const COMPILED_TERMS: readonly CompiledTerm[] = [
  ...compile(COUNTRIES_AND_DEMONYMS, false),
  ...compile(CITIES_AND_REGIONS, false),
  ...compile(POLITICAL_TERMS, false),
  ...compile(INAPPROPRIATE_TERMS, true),
];

const ALLOWLIST_STRIPPED: readonly string[] = SUBSTRING_ALLOWLIST.map(collapseSeparators);

/**
 * True when every occurrence of `needle` inside `haystack` sits within an
 * allowlisted ordinary word, i.e. the "hit" is really Scunthorpe.
 */
function onlyInsideAllowedWord(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return true; // no (further) occurrence left unexplained
    const covered = ALLOWLIST_STRIPPED.some((safe) => {
      let s = haystack.indexOf(safe);
      while (s >= 0) {
        if (at >= s && at + needle.length <= s + safe.length) return true;
        s = haystack.indexOf(safe, s + 1);
      }
      return false;
    });
    if (!covered) return false;
    from = at + 1;
  }
}

/**
 * Main validation function.
 * Returns ok: true if input text contains no prohibited terms.
 * Otherwise returns ok: false with a friendly rejection reason.
 */
export function validateText(
  input: string,
  fieldName = 'Text'
): FilterResult {
  if (!input || typeof input !== 'string') {
    return { ok: true };
  }

  const trimmed = input.trim();
  if (!trimmed) return { ok: true };

  const normalized = normalizeForFiltering(trimmed);
  const collapsedRepeats = collapseRepeats(normalized);
  const stripped = collapseSeparators(normalized);
  const strippedCollapsed = collapseSeparators(collapsedRepeats);

  for (const t of COMPILED_TERMS) {
    // 1. The term used as a word, plainly.
    if (t.word.test(normalized)) return makeRejection(fieldName, t.term);

    // 2. The same, after collapsing padded repeats on BOTH sides — the old
    //    code collapsed only the text, so every term with a double letter
    //    ("russia", "fuck"... ) slipped straight through as "ruuussssiiiaaa".
    if (t.collapsedWord.test(collapsedRepeats)) return makeRejection(fieldName, t.term);

    // 3. Separator evasion: the whole field is one spaced-out term
    //    ("u.s.a.", "r u s s i a", "f_u_c_k").
    if (t.stripped.length >= 3 &&
        (stripped === t.stripped || strippedCollapsed === t.stripped ||
         strippedCollapsed === t.strippedCollapsed)) {
      return makeRejection(fieldName, t.term);
    }

    // 4. Slurs and profanity glued into a longer run of text. Geography is
    //    deliberately excluded: "oman" inside "woman" and "cuba" inside
    //    "incubator" are not references to Oman or Cuba.
    if (t.severe && t.stripped.length >= 4 && stripped.includes(t.stripped) &&
        !onlyInsideAllowedWord(stripped, t.stripped)) {
      return makeRejection(fieldName, t.term);
    }
  }

  return { ok: true };
}

function makeRejection(fieldName: string, matchedTerm: string): FilterResult {
  return {
    ok: false,
    matchedTerm,
    reason: `${fieldName} contains prohibited terms. Real-world countries, places, politics, and inappropriate words are not permitted in Voxelon.`,
  };
}
