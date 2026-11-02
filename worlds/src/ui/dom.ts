/** Small DOM helpers shared by the game screens. All player text stays text. */
export function uiEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

export function uiButton(parent: HTMLElement, text: string, action: () => void, cls = 'game-button'): HTMLButtonElement {
  const button = uiEl('button', cls, parent, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

export { formatMatchTime as matchTime } from './presentation';
