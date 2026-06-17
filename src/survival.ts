// Survival ticks: passive health regeneration (gated by a post-damage delay)
// and drowning. Energy/stamina lives on the Player itself (it depends on
// sprint input). Typed against a narrow interface so it is testable headless.

import { MAX_AIR } from './player';

export interface SurvivalActor {
  health: number;
  air: number;
  eyeUnderwater: boolean;
  dead: boolean;
  /** Seconds remaining before health regen resumes (set on damage). */
  regenCooldown: number;
  damage(amount: number): void;
}

const REGEN_INTERVAL = 2;    // +1 HP every 2s once out of combat
const DROWN_INTERVAL = 1;    // -2 HP per second with no air
const AIR_REFILL_RATE = 4;   // bubbles return quickly out of water

export class Survival {
  /** Disabled in multiplayer — the server owns regeneration there. */
  enableRegen = true;
  private regenTimer = 0;
  private drownTimer = 0;

  update(dt: number, p: SurvivalActor): void {
    if (p.dead) return;

    // Tick the post-damage cooldown here (not in Player.update) so it keeps
    // counting down while the inventory is open and regen can resume.
    p.regenCooldown = Math.max(0, p.regenCooldown - dt);

    // Passive regeneration once the post-damage cooldown has elapsed.
    if (this.enableRegen && p.regenCooldown <= 0 && p.health < 20) {
      this.regenTimer += dt;
      if (this.regenTimer >= REGEN_INTERVAL) {
        this.regenTimer = 0;
        p.health = Math.min(20, p.health + 1);
      }
    } else {
      this.regenTimer = 0;
    }

    // Drowning.
    if (p.eyeUnderwater) {
      p.air = Math.max(0, p.air - dt);
      if (p.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= DROWN_INTERVAL) {
          this.drownTimer = 0;
          p.damage(2);
        }
      }
    } else {
      p.air = Math.min(MAX_AIR, p.air + dt * AIR_REFILL_RATE);
      this.drownTimer = 0;
    }
  }
}
