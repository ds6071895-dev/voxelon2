// Venue dimensions shared by the party games and the Parkour generators.
// A leaf module on purpose: partygames, parkour_course and parkour_setpieces
// import each other, and constants read while those modules are still being
// evaluated have to come from somewhere outside that cycle.

export const PARTY_FLOOR_Y = 140;
export const PARTY_STAMP_MIN_Y = 120;
export const PARTY_STAMP_MAX_Y = 190;
export const PARKOUR_VENUE_X = 96;
export const PARKOUR_VENUE_Z = 512;
/** The Parkour route's centre line. */
export const PARKOUR_CENTRE_X = 48;
