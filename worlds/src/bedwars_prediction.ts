// A placement owns one cell edit and one item debit, independently. World echoes
// settle edits; authoritative kits settle debits. Neither can settle the other.
import { bwMaxStack, bwConsume, type BwSlots } from './bedwars_inventory';
import type { BwPos } from './bedwars_rules';

interface Prediction extends BwPos {
  sequence: number; block: number; item: number; slot: number; at: number;
  previous: number; placedBefore: boolean; edit: 'pending' | 'echo' | 'expired';
  debit: boolean;
}
export interface BwPredictionPorts {
  slots: BwSlots;
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, block: number): void;
  placed: Set<string>;
  changed(): void;
}
export const bwCellText = (x: number, y: number, z: number): string => `${x},${y},${z}`;
export class BwPredictions {
  private readonly cells = new Map<string, Prediction>();
  private sequence = 0;
  constructor(private readonly d: BwPredictionPorts) {}
  clear(): void { this.cells.clear(); }
  has(p: BwPos): boolean { return this.cells.has(bwCellText(p.x, p.y, p.z)); }
  begin(p: BwPos, block: number, item: number, slot: number, at: number): number | null {
    if (this.has(p) || this.d.slots[slot]?.id !== item || !bwConsume(this.d.slots, slot)) return null;
    const key = bwCellText(p.x, p.y, p.z), sequence = ++this.sequence;
    this.cells.set(key, { ...p, sequence, block, item, slot, at, previous: this.d.getBlock(p.x, p.y, p.z), placedBefore: this.d.placed.has(key), edit: 'pending', debit: true });
    this.d.setBlock(p.x, p.y, p.z, block); this.d.placed.add(key); this.d.changed();
    return sequence;
  }
  echo(p: BwPos): void {
    const key = bwCellText(p.x, p.y, p.z), record = this.cells.get(key);
    if (!record) return;
    record.edit = 'echo';
    if (!record.debit) this.cells.delete(key);
  }
  nack(p: BwPos, sequence?: number): void {
    const key = bwCellText(p.x, p.y, p.z), record = this.cells.get(key);
    if (!record || (sequence !== undefined && sequence !== record.sequence) || record.edit === 'echo') return;
    this.rollback(record); this.cells.delete(key);
  }
  expire(now: number, ttl: number): void {
    for (const record of this.cells.values()) if (record.edit === 'pending' && now - record.at > ttl) {
      this.rollback(record); record.edit = 'expired';
      // Keep a tombstone until a definitive response: a late coordinate-only
      // reply must not undo a newer placement at this same cell.
    }
  }
  /** Called after restoring the kit. Only spends newer than the server's
   * processed placement watermark are reapplied. Legacy kits simply win. */
  kit(placement?: number): void {
    if (placement !== undefined && Number.isSafeInteger(placement)) this.sequence = Math.max(this.sequence, placement);
    for (const [key, record] of this.cells) {
      record.debit = false;
      if (placement !== undefined && record.sequence > placement && record.edit !== 'expired'
        && this.d.slots[record.slot]?.id === record.item) record.debit = bwConsume(this.d.slots, record.slot);
      if (!record.debit && record.edit === 'echo') this.cells.delete(key);
    }
    this.d.changed();
  }
  private rollback(record: Prediction): void {
    if (record.edit === 'expired') return;
    const key = bwCellText(record.x, record.y, record.z);
    if (this.d.getBlock(record.x, record.y, record.z) === record.block) {
      this.d.setBlock(record.x, record.y, record.z, record.previous);
      if (!record.placedBefore) this.d.placed.delete(key);
    }
    if (record.debit) {
      const stack = this.d.slots[record.slot];
      // Refund only into the same item/slot. An authoritative replacement wins.
      if (!stack) this.d.slots[record.slot] = { id: record.item, count: 1 };
      else if (stack.id === record.item && stack.count < bwMaxStack(record.item)) stack.count++;
      record.debit = false;
    }
    this.d.changed();
  }
}
