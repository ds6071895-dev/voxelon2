import type { ParkourVariant } from './parkour_course';

/** Remember recent runners across replays without retaining every departed id
 *  for the server's lifetime. Eviction changes only very old replay variety. */
export class ParkourHistory {
  private readonly entries = new Map<number, ParkourVariant>();
  constructor(private readonly capacity = 1024) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('History capacity must be positive');
  }
  get(id: number): ParkourVariant | undefined {
    const value = this.entries.get(id);
    if (value) {
      this.entries.delete(id);
      this.entries.set(id, value);
    }
    return value;
  }
  set(id: number, variant: ParkourVariant): void {
    this.entries.delete(id);
    this.entries.set(id, { theme: variant.theme, pieces: [...variant.pieces] });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
  delete(id: number): void { this.entries.delete(id); }
}
