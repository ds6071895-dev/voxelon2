// Shared inline SVG icon set — replaces emoji glyphs across the UI so
// rendering doesn't depend on the platform's emoji font (which varies wildly
// across OS/browser and looks out of place next to the game's own art).
// Every icon is a plain line/fill glyph sized to sit inline with text via
// `currentColor` + `1em` sizing, matching the emoji it replaces.

export type IconName =
  | 'skull' | 'sparkle' | 'heart' | 'shield' | 'flame' | 'music' | 'swords'
  | 'gear' | 'warning' | 'star' | 'dice' | 'backpack' | 'pickaxe' | 'tree'
  | 'coinbag' | 'gun' | 'gem' | 'tools' | 'hand' | 'trash' | 'rocket'
  | 'radioactive' | 'bolt' | 'fuel' | 'vortex' | 'globe' | 'burst' | 'target'
  | 'crown' | 'bomb' | 'explosion' | 'dish' | 'nut' | 'web' | 'heli'
  | 'drum' | 'satellite' | 'dynamite' | 'link' | 'wing' | 'trophy' | 'flag'
  | 'mail' | 'lock' | 'dove' | 'statue' | 'eye' | 'search' | 'blocked'
  | 'command' | 'close' | 'log' | 'chevronUp' | 'chevronDown' | 'droplet';

const PATHS: Record<IconName, string> = {
  skull: '<path d="M12 2C7 2 3 5.6 3 10c0 2.9 1.6 5.2 4 6.6V19a1 1 0 0 0 1 1h1.2l.8 2h4l.8-2H16a1 1 0 0 0 1-1v-2.4c2.4-1.4 4-3.7 4-6.6 0-4.4-4-8-9-8Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/><path d="M11 13h2l-1 2z" fill="currentColor"/>',
  sparkle: '<path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Z" fill="currentColor"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-10-9C.5 8.1 2 4.5 5.5 4.2c2-.2 3.6.9 4.5 2.5.9-1.6 2.5-2.7 4.5-2.5C18 4.5 19.5 8.1 22 11.5c-2.5 4.4-10 9-10 9Z" fill="currentColor"/>',
  shield: '<path d="M12 2l7 3v6c0 5-3.5 8.6-7 11-3.5-2.4-7-6-7-11V5l7-3Z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  flame: '<path d="M12 2c1 3-2 4-2 7a3 3 0 0 0 6 0c1.5 1.5 2 3.5 2 5a6 6 0 0 1-12 0c0-4 3-6 3-9 1 1 1.5 1.5 1.5 3.5C10.8 6 11 3.5 12 2Z" fill="currentColor"/>',
  music: '<path d="M9 18a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm0 0V5l10-2v11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.5" cy="12.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  swords: '<path d="M4 4l7 7M20 4l-7 7M4 20l6-6M20 20l-6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  gear: '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  warning: '<path d="M12 3 2 20h20L12 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/>',
  star: '<path d="M12 2.5l2.6 5.8 6.3.6-4.8 4.2 1.5 6.2L12 16.2 6.4 19.3l1.5-6.2-4.8-4.2 6.3-.6L12 2.5Z" fill="currentColor"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="16" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="16" r="1.3" fill="currentColor"/><circle cx="16" cy="16" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  backpack: '<path d="M8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5" y="8" width="14" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 12h6M9 21v-5h6v5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  pickaxe: '<path d="M4 10c4-5 12-7 16-4-3 4-5 12-10 16-1-2-1-3 0-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 15l-5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  tree: '<path d="M12 2 6 11h3l-5 7h7v4h2v-4h7l-5-7h3L12 2Z" fill="currentColor"/>',
  coinbag: '<path d="M9 3h6l1.5 3.2C19 7.5 20 9.7 20 12.5A7 7 0 0 1 6 12.5c0-2.8 1-5 3.5-6.3L9 3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 10v5M10.5 11.3h3M10.5 13.7h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  gun: '<path d="M3 14h9v-3h6v3h2v3h-4v2h-4v-2H9l-2 3H4l1-3H3v-3Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9l4-6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 9h20M9 3l3 6-3 12M15 3l-3 6 3 12" stroke="currentColor" stroke-width="1.1"/>',
  tools: '<path d="M14.7 6.3a3.5 3.5 0 0 0-4.6 4.2L4 16.6l2.4 2.4 6.1-6.1a3.5 3.5 0 0 0 4.2-4.6l-2 2-1.7-1.7 2-2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11.5V6a1.5 1.5 0 0 1 3 0v8M8 12l-1.5-1.6a1.6 1.6 0 0 0-2.4 2.1L7 16.5C8.4 19 10.7 21 14 21c3.6 0 6-2.4 6-6.5V9.5a1.5 1.5 0 0 0-3 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  rocket: '<path d="M12 2c3 2 5 6 5 10 0 2-1 4-2 5l-3-1-3 1c-1-1-2-3-2-5 0-4 2-8 5-10Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/><path d="M9 16l-2.5 5M15 16l2.5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  radioactive: '<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 4v4.2M6.5 15.8l3.6-2.1M17.5 15.8l-3.6-2.1" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/>',
  fuel: '<path d="M5 20V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v14M4 20h10M15 8h1.5L19 10.5V17a1.5 1.5 0 0 1-3 0v-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 8h4" stroke="currentColor" stroke-width="1.3"/>',
  vortex: '<path d="M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  burst: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M4.9 19.1l4.2-4.2M14.9 9.1l4.2-4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  target: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="4.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  crown: '<path d="M4 18h16l1-9-5 3-4-6-4 6-5-3 1 9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  bomb: '<circle cx="11" cy="14" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15 8l2-2M15.5 3.5l2 2 2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  explosion: '<path d="M12 2l1.6 4.8L18 4l-1.3 5 5.3.5-4 3.4 3.4 4-5.3-.8L17 21l-4-3.6L9 21l1.1-5-5.3.8 3.4-4-4-3.4 5.3-.5L8 4l4.4 2.8L12 2Z" fill="currentColor"/>',
  dish: '<path d="M4 13a8 8 0 0 1 8-8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 16c6-6 12-9 18-9l-9 9-9 0Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 16v5M9 21h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  nut: '<path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  web: '<path d="M12 2v20M2 12h20M4.5 4.5l15 15M19.5 4.5l-15 15" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1"/>',
  heli: '<path d="M3 5h9M7.5 2v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="5" y="8" width="9" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M14 12h5l2 4H9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 19h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  drum: '<rect x="5" y="4" width="14" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 9h14M5 15h14" stroke="currentColor" stroke-width="1.3"/>',
  satellite: '<rect x="9" y="9" width="6" height="6" rx="1" transform="rotate(45 12 12)" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 4l3 3M20 4l-3 3M6 18l-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  dynamite: '<rect x="6" y="9" width="4" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="12" y="9" width="4" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 5c0-1.5 1.5-1.5 1.5-3M14 5c1 0 .5-2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  link: '<path d="M9 15l6-6M8 12l-2.5 2.5a3 3 0 0 0 4.2 4.2L12 16.4M16 12l2.5-2.5a3 3 0 0 0-4.2-4.2L12 7.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  wing: '<path d="M3 14c4 1 8-1 10-6 2 5 6 7 10 6-4 4-9 6-10 3-1 3-6 1-10-3Z" fill="currentColor"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M12 13v3M8 20h8M9.5 17h5l.5 3h-6l.5-3Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  flag: '<path d="M5 3v18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 4h13l-3 4 3 4H5V4Z" fill="currentColor"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/>',
  dove: '<path d="M3 14c2-4 6-6 10-5-1-2-3-3-3-3 4-1 7 2 8 5 1 3-1 6-4 7-3 1-8 0-11-4Z" fill="currentColor"/><circle cx="16" cy="8.5" r="1" fill="#fff"/>',
  statue: '<path d="M9 3h6l1 4-2 2v3l3 9H7l3-9V9L8 7l1-4Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  blocked: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 6l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  command: '<path d="M8 6.5A2.5 2.5 0 1 1 10.5 9H15a2.5 2.5 0 1 1-2.5 2.5V15a2.5 2.5 0 1 1-2.5-2.5H9a2.5 2.5 0 1 1 2.5-2.5V6.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  close: '<path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  log: '<rect x="3" y="9" width="18" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/>',
  chevronUp: '<path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronDown: '<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  droplet: '<path d="M12 2c4 5 7 9.5 7 13a7 7 0 0 1-14 0c0-3.5 3-8 7-13Z" fill="currentColor"/>',
};

/** Inline SVG markup for `name`, sized to sit inline with surrounding text. */
export function iconSvg(name: IconName, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  return `<svg${cls} viewBox="0 0 24 24" width="1em" height="1em" style="display:inline-block;vertical-align:-0.15em;flex:none" aria-hidden="true">${PATHS[name]}</svg>`;
}
