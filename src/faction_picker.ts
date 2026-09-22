// THE ALLEGIANCE ROLL — the screen that decides which side you are on.
//
// Both sides are laid out with the facts in front of you:
//
//   · the citizens online on that side right now, as live 3D characters who
//     pose when you point at them (the same board the Duels ladder uses)
//   · how many have sworn to it, and who they are
//
// …but you do not pick. One press of ROLL spins a light across the cards,
// slowing until it settles on a side at random, and the result is PERMANENT.
// The winner is drawn before the spin starts; the animation only reveals it.
//
// SELF-CONTAINED: one injected <style>, a `vx-pledge-` prefix used nowhere else,
// nothing added to index.html. Usernames are written with textContent and never
// reach innerHTML.

import { BUST_POSES, type BustEntry } from './avatar_bust';
import { type Cosmetics, sanitizeCosmetics } from './character';
import { iconSvg } from './emoji_icons';
import type { FactionPublic } from './net/protocol';
import { skinSeed } from './net/protocol';
import { FACTIONS, factionColor, factionName } from './teams';
import { bustStage, injectGovStyle } from './gov_ui';

const CSS = `
/* A DEFINITE HEIGHT, not just a cap.
 *
 * The cards live in .vx-gov-scroll, which is position:absolute — so it adds
 * NOTHING to its parent's content height. With only max-height here the shell
 * had no height of its own to cap, so it sized to its content: header + footer,
 * with a flex: 1 viewport that resolved to ZERO between them. The cards were
 * built and rendered correctly into a scrollport 0px tall, which is why the
 * pledge screen came up reading "Swear allegiance / Choose your side" with
 * nothing under it to press — and why joining looked like something you had to
 * wait for something to unlock. So this states its height outright. */
.vx-pledge-shell {
  position: relative; display: flex; flex-direction: column; gap: 18px;
  width: min(1120px, 100%); height: min(860px, 100%); padding: 4px;
}
.vx-pledge-head { text-align: center; }
.vx-pledge-head h1 {
  margin: 6px 0 0; font-size: clamp(24px, 4.4vw, 38px); letter-spacing: 3px; text-transform: uppercase;
}
.vx-pledge-head p {
  margin: 8px auto 0; max-width: 62ch; font-size: 12.5px; line-height: 1.6; color: #9fb0cc;
}
.vx-pledge-head b { color: #ffd98a; }

/* The pan fills the scrollport exactly, so each card is a known height and
   scrolls its own dossier while the spin lights it as a whole. */
.vx-pledge-cards {
  display: grid; gap: 18px; grid-template-columns: 1fr 1fr; padding: 2px;
  height: 100%; align-items: stretch;
}

.vx-pledge-card {
  position: relative; display: flex; flex-direction: column; min-height: 0;
  border-radius: 16px; overflow: hidden; background: rgba(12, 20, 30, .88);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12), 0 20px 48px rgba(0, 0, 0, .45);
  transition: box-shadow .18s, transform .18s, opacity .35s, filter .35s;
}
.vx-pledge-shell[data-phase="idle"] .vx-pledge-card:hover {
  transform: translateY(-3px);
  box-shadow: inset 0 0 0 1px var(--side), 0 26px 60px rgba(0, 0, 0, .55);
}
.vx-pledge-crest {
  flex: none; display: flex; align-items: center; gap: 11px; padding: 15px 18px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--side) 34%, transparent), transparent);
}
.vx-pledge-crest-mark {
  display: flex; align-items: center; justify-content: center; width: 34px; height: 34px;
  border-radius: 10px; font-size: 17px; color: #0b1119; background: var(--side);
}
.vx-pledge-crest h2 { flex: 1; margin: 0; font-size: 19px; letter-spacing: 2.4px; text-transform: uppercase; }
.vx-pledge-strength {
  padding: 5px 9px; border-radius: 7px; font: 700 9px/1 inherit;
  letter-spacing: 1.3px; text-transform: uppercase; color: #cfd9ea;
  background: rgba(232, 238, 252, .1);
}
.vx-pledge-strength[data-tone="big"] { color: #ffd0a0; background: rgba(237, 160, 26, .2); }
.vx-pledge-strength[data-tone="small"] { color: #a8e8c4; background: rgba(46, 160, 100, .22); }

/* The plinth. The 3D busts are drawn OVER this box by the shared renderer, so
   it must keep its size whether or not a bust lands in it. */
.vx-pledge-stage {
  position: relative; display: flex; align-items: flex-end; justify-content: center;
  flex: none; height: clamp(132px, 21vh, 210px); margin: 0 18px; border-radius: 13px;
  background: radial-gradient(70% 90% at 50% 12%, color-mix(in srgb, var(--side) 26%, transparent), transparent 72%),
    rgba(0, 0, 0, .28);
}
.vx-pledge-slot { position: absolute; top: 12px; bottom: 32px; }
/* THE FALLBACK PORTRAIT. A browser hands out a limited number of WebGL contexts
   and the world already spends one, so "no context to spare" is a state a real
   player can land in — and it used to present as a plinth that simply stayed
   empty. When the bust board cannot draw, this monogram stands there instead. */
.vx-pledge-mug {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -58%);
  display: flex; align-items: center; justify-content: center;
  width: 86px; height: 86px; border-radius: 50%;
  font: 800 34px/1 inherit; letter-spacing: -1px; color: #fff;
  background: linear-gradient(160deg, color-mix(in srgb, var(--side) 62%, #fff), var(--side));
  box-shadow: 0 14px 30px color-mix(in srgb, var(--side) 46%, transparent),
    inset 0 2px 0 rgba(255, 255, 255, .4);
}
.vx-pledge-plinth {
  width: 74%; height: 12px; margin-bottom: 12px; border-radius: 50%;
  background: radial-gradient(50% 100% at 50% 50%, color-mix(in srgb, var(--side) 60%, transparent), transparent 76%);
}
/* THE NAMEPLATE. Each citizen's name, under the slot they stand in. It sits
   UNDER the bust slot, never behind it — the bust canvas paints over anything
   inside its own rectangle, so text that overlaps it is text with a character
   drawn through it. */
.vx-pledge-stage .vx-pledge-stage-name {
  position: absolute; bottom: 5px;
  font: 700 13px/1.25 inherit; letter-spacing: .6px; text-align: center; color: #fff;
  text-shadow: 0 2px 7px rgba(0, 0, 0, .7);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* NOBODY ONLINE. A side with no citizens online stands nobody on its plinth,
   and says so across the middle of it. */
.vx-pledge-empty {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  display: flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 999px;
  font: 700 10.5px/1 inherit; letter-spacing: 1.6px; text-transform: uppercase;
  color: #ffd0a0; background: rgba(9, 15, 23, .82);
  box-shadow: inset 0 0 0 1px rgba(237, 160, 26, .35);
}
.vx-pledge-empty svg { width: 13px; height: 13px; }
.vx-pledge-open-note {
  font-size: 11.5px; line-height: 1.5; color: #9fb0cc; text-align: center;
}

/* THE SPIN. The light that runs across the cards while the roll is live, then
   the winner's glow and the loser's fade once it settles. */
.vx-pledge-card[data-lit="1"] {
  transform: scale(1.025);
  box-shadow: inset 0 0 0 2px var(--side), 0 0 46px color-mix(in srgb, var(--side) 55%, transparent);
}
.vx-pledge-card::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(90% 55% at 50% 0%, color-mix(in srgb, var(--side) 38%, transparent), transparent 72%);
  transition: opacity .12s;
}
.vx-pledge-card[data-lit="1"]::after { opacity: 1; }
.vx-pledge-card[data-fate="won"] {
  animation: vx-pledge-win 1.1s cubic-bezier(.2, .9, .3, 1.3) both;
  box-shadow: inset 0 0 0 3px var(--side), 0 0 90px color-mix(in srgb, var(--side) 70%, transparent);
}
.vx-pledge-card[data-fate="lost"] { opacity: .32; filter: grayscale(.9); transform: scale(.96); }
@keyframes vx-pledge-win {
  0% { transform: scale(1.025); }
  30% { transform: scale(1.075); }
  100% { transform: scale(1.035); }
}

/* The only scrolling part of a card. Everything here is reading material; the
   crest above it and the button below it stay put. */
.vx-pledge-body {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 13px; padding: 15px 18px 18px;
}
.vx-pledge-body::-webkit-scrollbar { width: 7px; }
.vx-pledge-body::-webkit-scrollbar-thumb { border-radius: 4px; background: rgba(232, 238, 252, .18); }

.vx-pledge-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; }
.vx-pledge-stat {
  padding: 9px 8px; border-radius: 9px; text-align: center; background: rgba(232, 238, 252, .06);
}
.vx-pledge-stat b { display: block; font-size: 15px; }
.vx-pledge-stat small { display: block; margin-top: 3px; font-size: 8.5px; letter-spacing: 1.1px; text-transform: uppercase; color: #77879f; }

.vx-pledge-roster { border-radius: 9px; background: rgba(232, 238, 252, .045); padding: 10px 11px; }
.vx-pledge-roster-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 9.5px; letter-spacing: 1.6px; text-transform: uppercase; color: #77879f;
}
.vx-pledge-roster-names {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; max-height: 74px; overflow-y: auto;
}
.vx-pledge-roster-names::-webkit-scrollbar { width: 6px; }
.vx-pledge-roster-names::-webkit-scrollbar-thumb { border-radius: 3px; background: rgba(232, 238, 252, .2); }
.vx-pledge-name {
  padding: 3px 7px; border-radius: 6px; font-size: 10.5px; color: #c3cfe2;
  background: rgba(232, 238, 252, .07);
}
.vx-pledge-roster-empty { margin-top: 8px; font-size: 11.5px; color: #77879f; }

.vx-pledge-roll {
  flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.vx-pledge-roll .vx-gov-btn {
  position: relative; overflow: hidden;
  width: min(440px, 100%); min-height: 54px; font-size: 13px; letter-spacing: 2.6px;
}
/* A sheen that sweeps the idle button, so the one thing to press reads as live. */
.vx-pledge-roll .vx-gov-btn::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, .55), transparent);
  transform: skewX(-18deg); animation: vx-pledge-sheen 2.6s ease-in-out infinite;
}
.vx-pledge-roll .vx-gov-btn:disabled { opacity: .7; cursor: default; }
.vx-pledge-roll .vx-gov-btn:disabled::after { display: none; }
@keyframes vx-pledge-sheen { 0%, 55% { left: -40%; } 100% { left: 130%; } }
.vx-pledge-roll-note { font-size: 11px; line-height: 1.5; text-align: center; color: #ffb4a4; }

/* THE REVEAL. Laid over the whole shell — above the bust layer — once the spin
   settles: a flash in the winning colour, the side's name, and a burst. */
.vx-pledge-reveal {
  position: absolute; inset: 0; z-index: 10; pointer-events: none;
  display: none; flex-direction: column; align-items: center; justify-content: center;
}
.vx-pledge-reveal[data-show="1"] { display: flex; }
.vx-pledge-flash {
  position: absolute; inset: -10%; opacity: 0;
  background: radial-gradient(45% 45% at 50% 50%, color-mix(in srgb, var(--side) 55%, #fff), transparent 70%);
  animation: vx-pledge-flash 1.1s ease-out both;
}
@keyframes vx-pledge-flash { 0% { opacity: 0; } 12% { opacity: .9; } 100% { opacity: 0; } }
.vx-pledge-banner {
  position: relative; padding: 18px 42px 22px; border-radius: 18px; text-align: center;
  background: rgba(7, 12, 19, .9);
  box-shadow: inset 0 0 0 2px var(--side), 0 0 70px color-mix(in srgb, var(--side) 60%, transparent);
  animation: vx-pledge-pop .7s cubic-bezier(.2, 1.4, .4, 1) both .08s;
}
.vx-pledge-banner small {
  display: block; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #b9862d;
}
.vx-pledge-banner strong {
  display: block; margin-top: 6px; font-size: clamp(30px, 6vw, 56px); letter-spacing: 4px;
  text-transform: uppercase; color: var(--side);
  text-shadow: 0 0 26px color-mix(in srgb, var(--side) 70%, transparent) !important;
}
@keyframes vx-pledge-pop {
  0% { transform: scale(.3) rotate(-6deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
.vx-pledge-spark {
  position: absolute; left: 50%; top: 50%; width: 9px; height: 14px; border-radius: 2px;
  background: var(--c); opacity: 0;
  animation: vx-pledge-burst 1.5s cubic-bezier(.15, .7, .3, 1) both var(--delay);
}
@keyframes vx-pledge-burst {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(0); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--rot)); }
}
@media (prefers-reduced-motion: reduce) {
  .vx-pledge-spark, .vx-pledge-roll .vx-gov-btn::after { display: none; }
  .vx-pledge-card[data-fate="won"], .vx-pledge-banner, .vx-pledge-flash { animation-duration: .01s; }
}
.vx-pledge-foot {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  font-size: 11px; color: #77879f;
}
.vx-pledge-back {
  border: 0; border-radius: 8px; padding: 8px 13px; cursor: pointer;
  font: 600 10px/1 inherit; letter-spacing: 1.3px; text-transform: uppercase;
  color: #9fb0cc; background: rgba(232, 238, 252, .08);
}
.vx-pledge-back:hover { color: #e8eefc; background: rgba(232, 238, 252, .16); }
.vx-pledge-back:focus-visible { outline: 2px solid #eda01a; outline-offset: 2px; }

@media (max-width: 860px) {
  /* Stacked, the two cards cannot both fill the screen — the pan goes back to
     scrolling, and each card sizes to its own content with the button at its
     foot rather than a screen away from it. */
  .vx-pledge-cards { grid-template-columns: 1fr; height: auto; }
  .vx-pledge-stage { height: 180px; }
  .vx-pledge-body { overflow-y: visible; }
}
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  injectGovStyle();
  const el = document.createElement('style');
  el.id = 'vx-pledge-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

export interface PledgeData {
  factions: FactionPublic[];
}

/** A uniformly random integer in [0, n). */
function randomIndex(n: number): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0] % n;
  } catch {
    return Math.floor(Math.random() * n);
  }
}

/** The fast first beat of the spin and the extra wait on its last one, in ms. */
const SPIN_FAST_MS = 55;
const SPIN_SLOW_MS = 540;
/** Full passes over the cards before the spin may start to settle. */
const SPIN_MIN_STEPS = 24;
/** How long the reveal holds before the pledge is sent. */
const REVEAL_MS = 2400;
/** If the screen is still up this long after sending (the server said no),
 *  put the roll back so the player is never stuck behind a dead screen. */
const PLEDGE_RETRY_MS = 8000;

type Phase = 'idle' | 'rolling' | 'landed';

/** One person drawn on a card's stage. */
interface Face {
  username: string;
  cosmetics: Cosmetics;
}

/**
 * ONE CARD PER FACTION, ALWAYS.
 *
 * FACTIONS is the source of truth for which sides exist; the dossiers only
 * decorate them. Building the screen straight off the dossier list meant a
 * faction the server had not described yet simply had no card — and since
 * swearing allegiance is the only way into the world, a screen with a missing
 * card is a screen a new player cannot get off. A side with no citizens is the
 * ordinary case at the start of a season, not an error.
 *
 * So every field is defaulted rather than trusted.
 */
function dossiersFor(list: readonly FactionPublic[] | undefined): FactionPublic[] {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return FACTIONS.map((f) => {
    const d = list?.find((i) => i && i.faction === f.id);
    return {
      faction: f.id,
      members: Array.isArray(d?.members) ? d!.members.filter((m) => typeof m === 'string') : [],
      memberCount: num(d?.memberCount),
      faces: Array.isArray(d?.faces)
        ? d!.faces.filter((x) => x && typeof x.username === 'string') : [],
    };
  });
}

export class FactionPicker {
  private readonly surface: HTMLElement;
  private readonly shell: HTMLElement;
  /** The pan of cards. Its CHILDREN are rebuilt on every render; it is not. */
  private readonly cards: HTMLElement;
  /** The positioned box the cards scroll in and the bust canvas covers. */
  private readonly viewport: HTMLElement;
  /** The hint under the cards. */
  private readonly footText: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly rollButton: HTMLButtonElement;
  private readonly reveal: HTMLElement;
  private isOpen = false;
  private data: PledgeData | null = null;
  private phase: Phase = 'idle';
  private timer: number | undefined;
  /** This render's cards by faction id, for the spin to light without a rebuild. */
  private cardEls = new Map<number, HTMLElement>();
  /** This render's busts, so the losing side's can be cleared on landing. */
  private busts: BustEntry[] = [];

  onPledge?: (faction: number) => void;
  /** Each beat of the spin; `progress` runs 0 → 1 as it slows. */
  onTick?: (progress: number) => void;
  /** The spin settled on a side. */
  onLand?: (faction: number) => void;
  onOpen?: () => void;
  onClose?: () => void;

  constructor(host: HTMLElement) {
    injectStyle();
    this.surface = document.createElement('div');
    this.surface.className = 'vx-gov-surface vx-pledge-surface';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Choose your faction');
    this.surface.tabIndex = -1;
    this.surface.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.phase === 'idle') this.hide();
      }
    });

    this.shell = document.createElement('div');
    this.shell.className = 'vx-pledge-shell';
    this.shell.dataset.phase = 'idle';

    const head = document.createElement('div');
    head.className = 'vx-pledge-head';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'vx-gov-eyebrow';
    eyebrow.textContent = 'Swear allegiance';
    const title = document.createElement('h1');
    title.textContent = 'Choose your side';
    const lede = document.createElement('p');
    lede.innerHTML =
      'Fate picks the side you will fight for in every war, flag raid and season. '
      + '<b>You can never switch.</b> Look them over, then roll.';
    head.append(eyebrow, title, lede);

    // The card pan scrolls INSIDE a positioned viewport, and the bust canvas is
    // stretched over that same viewport. Only `cards`' CHILDREN are ever
    // replaced — the viewport and the scroller themselves are permanent, which
    // is what keeps the shared renderer from being torn out of the DOM.
    this.viewport = document.createElement('div');
    this.viewport.className = 'vx-gov-viewport';
    const scroll = document.createElement('div');
    scroll.className = 'vx-gov-scroll';
    this.cards = document.createElement('div');
    this.cards.className = 'vx-pledge-cards';
    scroll.appendChild(this.cards);
    this.viewport.appendChild(scroll);

    const foot = document.createElement('div');
    foot.className = 'vx-pledge-foot';
    const footText = document.createElement('span');
    this.footText = footText;
    // A way out. The choice is permanent, so somebody who opened this to read
    // the dossiers — or who wants to set their character up first — must be able
    // to leave without committing to anything.
    const back = document.createElement('button');
    this.back = back;
    back.type = 'button';
    back.className = 'vx-pledge-back';
    back.textContent = 'Decide later';
    back.addEventListener('click', () => this.hide());
    foot.append(footText, back);

    const roll = document.createElement('div');
    roll.className = 'vx-pledge-roll';
    this.rollButton = document.createElement('button');
    this.rollButton.type = 'button';
    this.rollButton.className = 'vx-gov-btn';
    this.rollButton.dataset.kind = 'primary';
    this.rollButton.addEventListener('click', () => this.roll());
    const note = document.createElement('div');
    note.className = 'vx-pledge-roll-note';
    note.textContent = 'Your side is chosen at random and is permanent on this account.';
    roll.append(this.rollButton, note);

    this.reveal = document.createElement('div');
    this.reveal.className = 'vx-pledge-reveal';
    this.reveal.setAttribute('aria-live', 'assertive');

    this.shell.append(head, this.viewport, roll, foot, this.reveal);
    this.surface.appendChild(this.shell);
    host.appendChild(this.surface);
  }

  get open(): boolean { return this.isOpen; }

  show(data: PledgeData): void {
    this.data = data;
    this.reset();
    if (!this.isOpen) {
      this.isOpen = true;
      this.surface.dataset.open = '1';
      this.onOpen?.();
    }
    bustStage.attach(this.viewport);
    this.render();
    this.surface.focus();
  }

  /** New data while the screen is up (somebody just pledged). A spin in
   *  progress is never rebuilt under the player; it picks the data up after. */
  update(data: PledgeData): void {
    this.data = data;
    if (this.isOpen && this.phase === 'idle') this.render();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.reset();
    this.isOpen = false;
    delete this.surface.dataset.open;
    bustStage.release(this.viewport);
    this.onClose?.();
  }

  /** Back to a fresh, rollable screen: no timers, no light, no reveal. */
  private reset(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.setPhase('idle');
    delete this.reveal.dataset.show;
    this.reveal.replaceChildren();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.shell.dataset.phase = phase;
    this.back.disabled = phase !== 'idle';
    this.rollButton.disabled = phase !== 'idle';
    this.rollButton.textContent = phase === 'idle' ? 'Roll for my side'
      : phase === 'rolling' ? 'Rolling…' : 'Fate has spoken';
  }

  /** Draw the side first, then spin a light over the cards that slows and
   *  stops exactly on it. */
  private roll(): void {
    if (this.phase !== 'idle' || !this.isOpen) return;
    const ids = FACTIONS.map((f) => f.id);
    const n = ids.length;
    const winner = ids[randomIndex(n)];
    const target = ids.indexOf(winner);
    let at = randomIndex(n);
    // Enough beats to feel like a spin, and exactly the number that ends on
    // the winner: (start + steps) % n === target.
    const steps = SPIN_MIN_STEPS + ((((target - at - SPIN_MIN_STEPS) % n) + n) % n);
    this.setPhase('rolling');

    const beat = (left: number): void => {
      at = (at + 1) % n;
      this.light(ids[at]);
      const progress = 1 - (left - 1) / steps;
      this.onTick?.(progress);
      if (left === 1) {
        this.timer = window.setTimeout(() => this.land(winner), SPIN_SLOW_MS);
        return;
      }
      // Ease out: quick at first, then each beat lingers longer.
      const delay = SPIN_FAST_MS + SPIN_SLOW_MS * progress ** 3;
      this.timer = window.setTimeout(() => beat(left - 1), delay);
    };
    beat(steps);
  }

  private light(faction: number): void {
    for (const [id, card] of this.cardEls) {
      if (id === faction) card.dataset.lit = '1';
      else delete card.dataset.lit;
    }
  }

  private land(winner: number): void {
    this.setPhase('landed');
    for (const [id, card] of this.cardEls) {
      card.dataset.fate = id === winner ? 'won' : 'lost';
      if (id === winner) card.dataset.lit = '1';
      else delete card.dataset.lit;
    }
    // Only the winning side keeps its figures standing.
    const keep = `pledge:${winner}:`;
    bustStage.setRoster(this.busts.filter((b) => b.key.startsWith(keep)));
    this.showReveal(winner);
    this.onLand?.(winner);

    this.timer = window.setTimeout(() => {
      this.onPledge?.(winner);
      this.timer = window.setTimeout(() => {
        if (!this.isOpen) return;
        this.reset();
        this.render();
      }, PLEDGE_RETRY_MS);
    }, REVEAL_MS);
  }

  private showReveal(winner: number): void {
    const side = `#${factionColor(winner).toString(16).padStart(6, '0')}`;
    this.reveal.style.setProperty('--side', side);
    const flash = document.createElement('div');
    flash.className = 'vx-pledge-flash';
    const banner = document.createElement('div');
    banner.className = 'vx-pledge-banner';
    const eyebrow = document.createElement('small');
    eyebrow.textContent = 'Fate has chosen';
    const name = document.createElement('strong');
    name.textContent = factionName(winner);
    banner.append(eyebrow, name);
    this.reveal.replaceChildren(flash);
    const colors = [side, '#ffd06a', '#ffffff'];
    for (let i = 0; i < 40; i++) {
      const spark = document.createElement('span');
      spark.className = 'vx-pledge-spark';
      const angle = (i / 40) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 160 + Math.random() * 260;
      spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
      spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist * 0.75)}px`);
      spark.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
      spark.style.setProperty('--delay', `${Math.round(Math.random() * 140)}ms`);
      spark.style.setProperty('--c', colors[i % colors.length]);
      this.reveal.appendChild(spark);
    }
    this.reveal.appendChild(banner);
    this.reveal.dataset.show = '1';
  }

  private render(): void {
    const data = this.data;
    if (!data) return;
    const busts: BustEntry[] = [];
    this.busts = busts;
    this.cardEls.clear();
    this.cards.replaceChildren();

    // Never the wire's list directly — see dossiersFor. Both sides get a card
    // whether or not anyone has joined either of them.
    const dossiers = dossiersFor(data.factions);
    const total = dossiers.reduce((n, f) => n + f.memberCount, 0);
    // Only tell the player to point at somebody when somebody is standing there.
    this.footText.textContent = dossiers.some((f) => f.faces?.length)
      ? 'Point at a citizen to get their attention.'
      : 'Either side is yours to join.';

    dossiers.forEach((info, index) => {
      const card = document.createElement('div');
      card.className = 'vx-pledge-card';
      const side = `#${factionColor(info.faction).toString(16).padStart(6, '0')}`;
      card.style.setProperty('--side', side);
      this.cardEls.set(info.faction, card);

      // --- crest -------------------------------------------------------------
      const crest = document.createElement('div');
      crest.className = 'vx-pledge-crest';
      const mark = document.createElement('div');
      mark.className = 'vx-pledge-crest-mark';
      mark.innerHTML = iconSvg('flag');
      const name = document.createElement('h2');
      name.textContent = factionName(info.faction);
      const strength = document.createElement('span');
      strength.className = 'vx-pledge-strength';
      // Purely informational. Nothing here blocks a join — a lopsided war is a
      // thing players are allowed to cause.
      if (total > 0 && info.memberCount * 2 > total * 1.2) {
        strength.dataset.tone = 'big';
        strength.textContent = 'Overstrength';
      } else if (total > 0 && info.memberCount * 2 < total * 0.8) {
        strength.dataset.tone = 'small';
        strength.textContent = 'Underdog';
      } else {
        strength.textContent = 'Even';
      }
      crest.append(mark, name, strength);

      // --- the plinth --------------------------------------------------------
      // The citizens online on this side right now stand on it, named. With
      // nobody online the plinth stays empty and says so.
      const stage = document.createElement('div');
      stage.className = 'vx-pledge-stage';
      const plinth = document.createElement('div');
      plinth.className = 'vx-pledge-plinth';
      stage.appendChild(plinth);

      const faces = info.faces ?? [];
      if (faces.length) {
        const width = 100 / faces.length;
        faces.forEach((citizen, i) => {
          const slot = document.createElement('div');
          slot.className = 'vx-pledge-slot';
          slot.style.left = `${i * width}%`;
          slot.style.width = `${width}%`;
          stage.insertBefore(slot, plinth);
          const key = `pledge:${info.faction}:${citizen.username.toLowerCase()}`;
          this.standUp(busts, {
            key, slot,
            face: {
              username: citizen.username,
              cosmetics: sanitizeCosmetics(citizen.cosmetics, skinSeed(citizen.username)),
            },
            // Neighbouring figures get different salutes so the screen never
            // plays the same animation twice side by side.
            pose: BUST_POSES[(index + i) % BUST_POSES.length],
          });
          // The name belongs to the figure, so it goes on the plinth under its
          // slot rather than inside it, where the canvas would paint over it.
          const nameplate = document.createElement('div');
          nameplate.className = 'vx-pledge-stage-name';
          nameplate.style.left = `${i * width}%`;
          nameplate.style.width = `${width}%`;
          nameplate.textContent = citizen.username;
          stage.appendChild(nameplate);
          slot.addEventListener('mouseenter', () => bustStage.setHover(key));
          slot.addEventListener('mouseleave', () => bustStage.setHover(null));
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'vx-pledge-empty';
        const glyph = document.createElement('span');
        glyph.innerHTML = iconSvg('flag');
        const label = document.createElement('span');
        label.textContent = 'Nobody online';
        empty.append(glyph, label);
        stage.appendChild(empty);
      }

      // --- body --------------------------------------------------------------
      const body = document.createElement('div');
      body.className = 'vx-pledge-body';

      if (!info.memberCount) {
        const note = document.createElement('div');
        note.className = 'vx-pledge-open-note';
        note.textContent = 'Nobody has pledged here yet. Join and you are its first citizen.';
        body.appendChild(note);
      }

      const stats = document.createElement('div');
      stats.className = 'vx-pledge-stats';
      const cells: [string, string][] = [
        [String(info.memberCount), 'Citizens'],
        [total > 0 ? `${Math.round((info.memberCount / total) * 100)}%` : '—', 'Of all citizens'],
      ];
      for (const [value, label] of cells) {
        const stat = document.createElement('div');
        stat.className = 'vx-pledge-stat';
        const b = document.createElement('b');
        b.textContent = value;
        const small = document.createElement('small');
        small.textContent = label;
        stat.append(b, small);
        stats.appendChild(stat);
      }
      body.appendChild(stats);

      const roster = document.createElement('div');
      roster.className = 'vx-pledge-roster';
      const rosterHead = document.createElement('div');
      rosterHead.className = 'vx-pledge-roster-head';
      const rosterLabel = document.createElement('span');
      rosterLabel.textContent = 'Who fights here';
      const rosterCount = document.createElement('span');
      rosterCount.textContent = info.members.length < info.memberCount
        ? `${info.members.length} of ${info.memberCount}` : '';
      rosterHead.append(rosterLabel, rosterCount);
      roster.appendChild(rosterHead);
      if (info.members.length) {
        const names = document.createElement('div');
        names.className = 'vx-pledge-roster-names';
        for (const member of info.members) {
          const chip = document.createElement('span');
          chip.className = 'vx-pledge-name';
          chip.textContent = member;
          names.appendChild(chip);
        }
        roster.appendChild(names);
      } else {
        const empty = document.createElement('div');
        empty.className = 'vx-pledge-roster-empty';
        empty.textContent = 'Nobody yet. You would be the first.';
        roster.appendChild(empty);
      }
      body.appendChild(roster);

      card.append(crest, stage, body);
      this.cards.appendChild(card);
    });

    // Roster last: the slots have to be in the DOM before the board measures them.
    bustStage.setRoster(busts);
  }

  /**
   * Put one person on a plinth: a live bust when the board can draw, and the
   * monogram medallion when it cannot (a browser hands out a limited number of
   * WebGL contexts and the world already spends one, so "no context to spare"
   * is a state a real player lands in — it must never present as an empty box).
   */
  private standUp(
    busts: BustEntry[],
    entry: { key: string; slot: HTMLElement; face: Face; pose: BustEntry['pose'] }
  ): void {
    if (!bustStage.available) {
      const mug = document.createElement('div');
      mug.className = 'vx-pledge-mug';
      const ch = [...entry.face.username].find((c) => /\S/.test(c)) ?? '?';
      mug.textContent = ch.toUpperCase();
      entry.slot.appendChild(mug);
      return;
    }
    busts.push({
      key: entry.key, slot: entry.slot, pose: entry.pose,
      cosmetics: entry.face.cosmetics,
    });
  }
}
