// Shared inline SVG icon set — replaces emoji glyphs across the UI so
// rendering doesn't depend on the platform's emoji font (which varies wildly
// across OS/browser and looks out of place next to the game's own art).
// Every icon is a plain line/fill glyph sized to sit inline with text via
// `currentColor` + `1em` sizing, matching the emoji it replaces.

export type IconName =
  | 'skull' | 'close' | 'dice' | 'chevronUp' | 'chevronDown' | 'palette' | 'layout' | 'keyboard'
  // Geometric/technical glyphs. Several of these (pause, the diamond) carry an
  // emoji presentation and render in the platform's colour emoji font; drawing
  // them keeps every mark on the HUD the game's own.
  | 'diamond' | 'reticle' | 'pause' | 'arrowUp' | 'arrowDown';

const PATHS: Record<IconName, string> = {
  skull: '<path d="M12 2C7 2 3 5.6 3 10c0 2.9 1.6 5.2 4 6.6V19a1 1 0 0 0 1 1h1.2l.8 2h4l.8-2H16a1 1 0 0 0 1-1v-2.4c2.4-1.4 4-3.7 4-6.6 0-4.4-4-8-9-8Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/><path d="M11 13h2l-1 2z" fill="currentColor"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="16" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="16" r="1.3" fill="currentColor"/><circle cx="16" cy="16" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  close: '<path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  chevronUp: '<path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronDown: '<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  diamond: '<path d="M12 2.6 21.4 12 12 21.4 2.6 12 12 2.6Z" fill="currentColor"/>',
  reticle: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1.3" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3" fill="currentColor"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="7.8" cy="12" r="1.15" fill="currentColor"/><circle cx="9.6" cy="8.2" r="1.15" fill="currentColor"/><circle cx="14" cy="7.6" r="1.15" fill="currentColor"/><circle cx="17.2" cy="10.4" r="1.15" fill="currentColor"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5.6" y="6.6" width="5.2" height="3.4" rx="1" fill="currentColor"/><rect x="5.6" y="12" width="5.2" height="5.4" rx="1" fill="currentColor" opacity=".55"/><rect x="13.2" y="6.6" width="5.2" height="10.8" rx="1" fill="currentColor" opacity=".3"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.6h.01M9.5 12.6h.01M13 12.6h.01M16.5 12.6h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M7.6 15.6h8.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};

// --- Emoji substitution ---------------------------------------------------
// The game speaks to the player through a lot of one-line notices, banners and
// chat lines that were written with an emoji at the front. Those glyphs come
// from the platform's emoji font, which is a different weight, a different
// palette and a different era of design on every OS — the one part of the HUD
// the game does not draw. Everything below turns them into the icon set above
// at the point of display, so nothing has to remember to do it by hand.

/** Every emoji the UI writes, mapped to the icon that replaces it. */
const EMOJI_ICONS: Record<string, IconName> = {
  '✕': 'close', '✖': 'close', '⬆': 'chevronUp', '⇩': 'chevronDown', '🎲': 'dice', '⏸': 'pause', '↑': 'arrowUp', '↓': 'arrowDown',
  // NOT '→': it is typography, not an icon — it reads as "becomes".
};

/** Matches any mapped emoji, plus the variation selector and zero-width joiner
 *  that trail some of them, plus anything left in the pictographic ranges so a
 *  glyph nobody mapped is dropped rather than shown in the wrong font. */
const EMOJI_RE = new RegExp(
  `(?:${Object.keys(EMOJI_ICONS).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\uFE0F\u200D]*` +
  '|[\u{1F300}-\u{1FAFF}][\uFE0F\u200D]*',
  'gu',
);

/** Swap emoji for inline SVG inside a string that is ALREADY html. */
function iconifyHtml(html: string): string {
  return html.replace(EMOJI_RE, (match) => {
    const name = EMOJI_ICONS[match.replace(/[\uFE0F\u200D]/gu, '')];
    return name ? iconSvg(name) : '';
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Render PLAIN text (a notice, a banner, a chat line) into an element with its
 *  emoji swapped for icons. The text is escaped first, so a player-supplied
 *  name inside it can never become markup. */
export function setIconText(el: HTMLElement, text: string): void {
  el.innerHTML = iconifyHtml(escapeHtml(text)).trim();
}

/** Inline SVG markup for `name`, sized to sit inline with surrounding text. */
export function iconSvg(name: IconName, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  return `<svg${cls} viewBox="0 0 24 24" width="1em" height="1em" style="display:inline-block;vertical-align:-0.15em;flex:none" aria-hidden="true">${PATHS[name]}</svg>`;
}
