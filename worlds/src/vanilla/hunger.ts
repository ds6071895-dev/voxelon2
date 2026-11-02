// Hunger, saturation and exhaustion (Java Edition, Normal difficulty).
//
// Exhaustion reaching 4 takes 1 saturation, or 1 food once saturation is
// gone. With natural regeneration on: at 20 food with saturation, heal every
// 10 ticks (min(sat, 6)/6 HP, costing that much ×6 exhaustion); at 18+ food,
// heal 1 HP every 80 ticks for 6 exhaustion. At 0 food, starve 1 HP every 80
// ticks down to 1 HP (Normal). Sprinting needs more than 6 food.

export const EXHAUST = {
  sprintPerBlock: .1, swimPerBlock: .01, jump: .05, sprintJump: .2, attack: .1, hurt: .1, mine: .005, heal: 6,
} as const;

export class Hunger {
  food = 20;
  saturation = 5;
  exhaustion = 0;
  private timer = 0;

  exhaust(amount: number): void { this.exhaustion = Math.min(40, this.exhaustion + amount); }

  eat(nutrition: number, saturation: number): void {
    this.food = Math.min(20, this.food + nutrition);
    this.saturation = Math.min(this.food, this.saturation + saturation);
  }
  canEat(always = false): boolean { return always || this.food < 20; }
  canSprint(): boolean { return this.food > 6; }

  /** One tick. Returns HP to add (positive heal, negative starvation). */
  tick(hp: number, maxHp: number, naturalRegen: boolean): number {
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    const hurt = hp < maxHp;
    if (naturalRegen && this.saturation > 0 && this.food >= 20 && hurt) {
      if (++this.timer >= 10) {
        this.timer = 0;
        const amount = Math.min(this.saturation, 6);
        this.exhaust(amount);
        return amount / 6;
      }
      return 0;
    }
    if (naturalRegen && this.food >= 18 && hurt) {
      if (++this.timer >= 80) { this.timer = 0; this.exhaust(EXHAUST.heal); return 1; }
      return 0;
    }
    if (this.food <= 0) {
      if (++this.timer >= 80) { this.timer = 0; return hp > 1 ? -1 : 0; }
      return 0;
    }
    this.timer = 0;
    return 0;
  }
}
