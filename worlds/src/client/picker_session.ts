/** One asynchronous cursor sheet; abort and stale resolutions cannot retain ownership. */
export class PickerSession<T> {
  private controller: AbortController | null = null;
  constructor(private readonly changed: () => void) {}
  get open(): boolean { return this.controller !== null; }
  choose(show: (signal: AbortSignal) => Promise<T | null>, chosen: (value: T) => void): void {
    if (this.open) return;
    const controller = new AbortController();
    this.controller = controller; this.changed();
    const finish = (): boolean => {
      if (this.controller !== controller) return false;
      this.controller = null; this.changed(); return true;
    };
    void show(controller.signal).then(value => {
      if (!finish() || controller.signal.aborted || value === null) return;
      chosen(value);
    }, () => { finish(); });
  }
  hide(): void {
    const controller = this.controller;
    if (!controller) return;
    this.controller = null;
    controller.abort();
    this.changed();
  }
}
