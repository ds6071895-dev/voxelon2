// PVP FEEL — the layer between "the server said you hit them" and "that felt
// good". Everything here is PURE PRESENTATION: it is fed by authoritative
// `hitconfirm` / `hurt` messages and can never invent a hit, a kill or a
// number the server did not send.
//
// Three pieces, all reusable in and out of Duels:
//
//   DamageNumbers  a number that pops off whoever you just shot, anchored in
//                  WORLD space so it stays on them while you strafe. This is
//                  the single loudest "my shot landed and it mattered" signal
//                  a shooter can have — the crosshair tick alone can't say how
//                  hard the round bit.
//   KillBanner     the centre-screen slam for an elimination and the streak
//                  calls that ride on it. Queued, so a double kill reads as
//                  two beats rather than one overwritten one.
//   StreakTracker  local, client-side bookkeeping of kills-without-dying and
//                  the multi-kill window, mirroring the authoritative Duels
//                  rules so the open world gets the same vocabulary.
//
// The multi-kill window and spree thresholds are imported from duels.ts rather
// than re-declared, so an open-world RAMPAGE means exactly what a ranked one
// does.

import * as THREE from 'three';
import { DUEL_MULTI_KILL_MS, DUEL_SPREE_STEPS, type DuelEventKind } from './duels';
import { iconSvg } from './emoji_icons';

/** How a landed hit reads: soaked by armor, ordinary, heavy, or the kill. */
export type HitFlavor = 'soak' | 'hit' | 'heavy' | 'kill';

/** Damage at or above this fraction of a full health bar reads as HEAVY. */
const HEAVY_FRACTION = 0.22;

/** Classify one landed hit for presentation. `maxHealth` is the target's bar
 *  where known (Duels normalises to 40), else the standard 20. */
export function hitFlavor(amount: number, killed: boolean, maxHealth = 20): HitFlavor {
  if (killed) return 'kill';
  if (amount <= 0) return 'soak';
  return amount >= maxHealth * HEAVY_FRACTION ? 'heavy' : 'hit';
}

interface FloatingNumber {
  el: HTMLDivElement;
  /** World anchor. Rises on its own so the number leaves the body behind. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Screen-space lateral drift (px/s), so stacked hits fan out instead of
   *  printing on top of each other. */
  driftX: number;
  life: number;
  max: number;
}

const NDC = new THREE.Vector3();

/**
 * World-anchored floating damage numbers.
 *
 * The number is spawned at the victim's chest, given a little upward world
 * velocity and a sideways screen drift, then projected every frame. Anchoring
 * in world space (rather than freezing screen coordinates at spawn) is what
 * makes it feel attached to the target: you can circle-strafe and the number
 * travels with the fight.
 */
export class DamageNumbers {
  private readonly live: FloatingNumber[] = [];
  /** Retired elements, reused so a sustained firefight allocates nothing. */
  private readonly pool: HTMLDivElement[] = [];
  private fan = 0;

  constructor(private readonly host: HTMLElement, private readonly limit = 22) {}

  /**
   * Pop a number off `(x, y, z)`.
   *
   * `amount <= 0` is deliberately still shown (as "0" in the soak colour):
   * a silent crosshair is indistinguishable from a miss, and "your round
   * landed and their kit ate all of it" is exactly the thing a shooter needs
   * to know so they switch weapons instead of emptying the magazine.
   */
  spawn(x: number, y: number, z: number, amount: number, flavor: HitFlavor): void {
    if (this.live.length >= this.limit) this.retire(0);
    const el = this.pool.pop() ?? document.createElement('div');
    el.className = `dmg-num ${flavor}`;
    const value = String(Math.max(0, Math.round(amount)));
    el.innerHTML = flavor === 'kill' ? `${value} ${iconSvg('skull')}` : value;
    el.style.opacity = '0';
    this.host.appendChild(el);
    // Alternate the fan direction so two hits in the same instant separate.
    this.fan = (this.fan + 1) % 4;
    const side = (this.fan % 2 === 0 ? 1 : -1) * (0.55 + (this.fan >> 1) * 0.45);
    this.live.push({
      el,
      pos: new THREE.Vector3(x + (Math.random() - 0.5) * 0.24, y, z + (Math.random() - 0.5) * 0.24),
      vel: new THREE.Vector3(0, flavor === 'kill' ? 1.6 : 1.15, 0),
      driftX: side * 34,
      life: 0,
      max: flavor === 'kill' ? 1.25 : 0.85,
    });
  }

  /** Project + age every live number. Call once a frame with the render camera. */
  update(dt: number, camera: THREE.Camera): void {
    if (!this.live.length) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const n = this.live[i];
      n.life += dt;
      if (n.life >= n.max) { this.retire(i); continue; }
      const k = n.life / n.max;
      // Rise fast, then coast: the number "pops" out of the body.
      n.vel.y *= Math.pow(0.12, dt);
      n.pos.addScaledVector(n.vel, dt);
      NDC.copy(n.pos).project(camera);
      if (NDC.z > 1) { n.el.style.opacity = '0'; continue; } // behind the camera
      const sx = (NDC.x * 0.5 + 0.5) * width + n.driftX * k;
      const sy = (-NDC.y * 0.5 + 0.5) * height;
      // A short overshoot on birth, then a slow shrink as it fades out.
      const punch = k < 0.14 ? 1 + (0.14 - k) * 3.6 : 1 - (k - 0.14) * 0.22;
      n.el.style.transform = `translate(-50%,-50%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) scale(${punch.toFixed(3)})`;
      n.el.style.opacity = String(Math.min(1, (1 - k) * 2.6));
    }
  }

  /** Drop every number (a death, a match end, leaving the arena). */
  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
  }

  private retire(index: number): void {
    const n = this.live[index];
    n.el.remove();
    if (this.pool.length < this.limit) this.pool.push(n.el);
    this.live.splice(index, 1);
  }
}

/** One queued centre-screen call. */
interface BannerBeat {
  title: string;
  sub: string;
  color: string;
  /** Seconds this beat holds the screen before the next one is allowed in. */
  hold: number;
}

/**
 * The elimination slam. Beats QUEUE rather than overwrite, so a double kill
 * plays "ELIMINATED Foo" and then "DOUBLE KILL" instead of the second call
 * eating the first — the pacing is most of what makes a streak feel earned.
 */
export class KillBanner {
  private readonly queue: BannerBeat[] = [];
  private hold = 0;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;

  constructor(private readonly el: HTMLElement) {
    this.title = document.createElement('b');
    this.sub = document.createElement('small');
    el.append(this.title, this.sub);
  }

  push(title: string, sub: string, color: string, hold = 1.5): void {
    // Never let a backlog build up during a wipe: the newest calls matter most.
    if (this.queue.length >= 3) this.queue.splice(0, this.queue.length - 2);
    this.queue.push({ title, sub, color, hold });
  }

  update(dt: number): void {
    this.hold = Math.max(0, this.hold - dt);
    if (this.hold > 0) return;
    const beat = this.queue.shift();
    if (!beat) {
      this.el.classList.remove('visible');
      return;
    }
    this.title.textContent = beat.title;
    this.sub.textContent = beat.sub;
    this.el.style.setProperty('--slam', beat.color);
    this.el.classList.remove('visible');
    void this.el.offsetWidth; // restart the slam keyframes
    this.el.classList.add('visible');
    this.hold = beat.hold;
  }

  clear(): void {
    this.queue.length = 0;
    this.hold = 0;
    this.el.classList.remove('visible');
  }
}

/**
 * Local kills-without-dying + multi-kill bookkeeping for the OPEN WORLD, where
 * no authoritative announcer exists. Duels keeps using the server's feed; this
 * exists so an open-world firefight speaks the same language.
 */
export class StreakTracker {
  /** Kills since the last death. */
  streak = 0;
  private lastKillAt = -Infinity;
  private multi = 0;
  /** Id of the player who most recently killed us (drives REVENGE). */
  private nemesis = -1;

  /** Record a kill. Returns the beats it earned, most important LAST. */
  kill(victimId: number, nowMs: number): DuelEventKind[] {
    this.streak++;
    this.multi = nowMs - this.lastKillAt <= DUEL_MULTI_KILL_MS ? this.multi + 1 : 1;
    this.lastKillAt = nowMs;
    const beats: DuelEventKind[] = [];
    if (victimId >= 0 && victimId === this.nemesis) {
      beats.push('revenge');
      this.nemesis = -1;
    }
    const spree = [...DUEL_SPREE_STEPS].reverse().find((step) => step.at === this.streak);
    if (spree) beats.push(spree.kind);
    if (this.multi === 2) beats.push('double_kill');
    else if (this.multi === 3) beats.push('triple_kill');
    else if (this.multi >= 4) beats.push('quad_kill');
    return beats;
  }

  /** We died. Remember who to pay back, and drop the streak. */
  died(killerId: number): void {
    this.streak = 0;
    this.multi = 0;
    this.lastKillAt = -Infinity;
    if (killerId >= 0) this.nemesis = killerId;
  }

  /** Full reset (leaving a match / disconnect). */
  reset(): void {
    this.died(-1);
    this.nemesis = -1;
  }
}
