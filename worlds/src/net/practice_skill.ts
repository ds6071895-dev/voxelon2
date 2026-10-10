import { GAME_MODES, type GameMode } from './protocol';
import type { Accounts } from './accounts';

interface Identity { username: string; account: boolean }

/** Hidden practice learning belongs to identity, independently of match bodies. */
export class PracticeSkills {
  private readonly guests = new Map<string, number>();
  constructor(private readonly accounts: Accounts, private readonly changed: () => void) {}
  private key(mode: GameMode, name: string): string { return `${mode}:${name.toLowerCase()}`; }
  learned(p: Identity, mode: GameMode): number | undefined {
    return p.account ? this.accounts.skillOf(p.username, mode) : this.guests.get(this.key(mode, p.username));
  }
  remember(p: Identity, mode: GameMode, value: number): void {
    if (!Number.isFinite(value)) return;
    if (p.account) { this.accounts.setSkill(p.username, mode, value); this.changed(); }
    else this.guests.set(this.key(mode, p.username), value);
  }
  /** Registration can keep an offered name instead of the old guest name. */
  register(guestName: string, accountName: string): void {
    for (const mode of GAME_MODES) {
      const key = this.key(mode, guestName), value = this.guests.get(key);
      if (value === undefined) continue;
      this.accounts.setSkill(accountName, mode, value);
      this.guests.delete(key);
    }
  }
}
