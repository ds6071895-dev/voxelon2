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

export { formatMatchTime as bwTime } from './ui/presentation';
