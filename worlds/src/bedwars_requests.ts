// Purchase identity outlives the panel, match entry and socket. Keep the numeric
// wire contract; never restart at 1 while the server retains its replay cache.
const STORAGE_KEY = 'voxelon.bedwars.purchase';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export class BwPurchaseRequests {
  private last = 0;
  constructor(private readonly store: () => Store | null = () => localStorage,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = () => {
      const words = crypto.getRandomValues(new Uint32Array(2));
      return (words[0] & 0x1fffff) * 0x100000000 + words[1];
    }) {}

  next(): number {
    let storage: Store | null = null, saved = 0;
    try { storage = this.store(); saved = Number(storage?.getItem(STORAGE_KEY)); } catch { /* Storage-disabled browser: use secure fresh identities. */ }
    if (!Number.isSafeInteger(saved) || saved < 0) saved = 0;
    // Persist before sending. Clock rollback cannot reuse an earlier identity.
    const floor = Math.max(this.last, saved), clock = Math.floor(this.now()) * 1024;
    let request = storage ? Math.max(floor + 1, clock) : this.random();
    if (!Number.isSafeInteger(request) || request <= 0 || request === this.last) request = floor + 1;
    if (!Number.isSafeInteger(request)) throw new Error('Bedwars purchase identity exhausted');
    try { storage?.setItem(STORAGE_KEY, String(request)); } catch {
      // A readable but unwritable store cannot protect a subsequent reload.
      request = this.random();
      if (request === this.last) request = request === Number.MAX_SAFE_INTEGER ? request - 1 : request + 1;
    }
    this.last = request;
    return request;
  }
}
