/** Small DOM helpers shared by the Bedwars screens. All player text stays text. */
export function bwEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

export function bwButton(parent: HTMLElement, text: string, action: () => void, cls = 'bw-button'): HTMLButtonElement {
  const button = bwEl('button', cls, parent, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

export function bwTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Keep keyboard navigation inside the active sheet, without stealing focus on updates. */
export function bwTrapFocus(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const targets = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    .filter(node => !node.hidden && node.getClientRects().length > 0);
  if (!targets.length) { event.preventDefault(); root.focus(); return; }
  const index = targets.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); targets[targets.length - 1].focus(); }
  else if (!event.shiftKey && (index === targets.length - 1 || index < 0)) { event.preventDefault(); targets[0].focus(); }
}
