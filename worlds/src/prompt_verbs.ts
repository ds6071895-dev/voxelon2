// Prompt wording that matches the controller in hand: "Right-click" means
// nothing on a phone. Reads the live `html.touch-ui` flag (main.ts keeps it in
// step with the last pointer used); outside a browser it is the desktop text.
export function touchActive(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement?.classList.contains('touch-ui');
}

/** Opening a shop or chest: E, or the USE / SHOP button. */
export function shopVerb(): string { return touchActive() ? 'Tap USE / SHOP' : 'Press E'; }
