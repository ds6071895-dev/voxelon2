// THE ALLEGIANCE ROLL — the screen that decides which side you are on.
//
// Both sides are laid out with the facts in front of you:
//
//   · the citizens online on that side right now, as live 3D characters who
//     pose when you point at them (the same board the Duels ladder uses)
//   · how many have sworn to it, and who they are
//
// You pick a card, then confirm with the swear button. The result is
// PERMANENT, so nothing is sent until that second, deliberate press.
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
  --side-a: #e23b3b; --side-b: #3b78e2;
  position: relative; display: flex; flex-direction: column; gap: 18px;
  width: min(1120px, 100%); height: min(860px, 100%); padding: 4px;
}
/* Each side's colour bleeds in from its own edge, meeting in the middle. */
.vx-pledge-shell::before {
  content: ''; position: absolute; inset: -12% -8%; z-index: -1; pointer-events: none;
  background:
    radial-gradient(45% 60% at 0% 55%, color-mix(in srgb, var(--side-a) 34%, transparent), transparent 70%),
    radial-gradient(45% 60% at 100% 55%, color-mix(in srgb, var(--side-b) 34%, transparent), transparent 70%);
  animation: vx-pledge-breathe 6s ease-in-out infinite alternate;
}
@keyframes vx-pledge-breathe { to { opacity: .6; } }
.vx-pledge-head { text-align: center; }
.vx-pledge-head h1 {
  margin: 6px 0 0; font-size: clamp(28px, 5vw, 48px); font-weight: 900; letter-spacing: 4px; text-transform: uppercase;
  background: linear-gradient(90deg, color-mix(in srgb, var(--side-a) 55%, #fff), #fff 50%, color-mix(in srgb, var(--side-b) 55%, #fff));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 20px rgba(0, 0, 0, .55));
}
.vx-pledge-head p {
  margin: 8px auto 0; max-width: 62ch; font-size: 12.5px; line-height: 1.6; color: #9fb0cc;
}
.vx-pledge-head b { color: #ffd98a; }

/* The pan fills the scrollport exactly, so each card is a known height and
   scrolls its own dossier while the spin lights it as a whole. */
.vx-pledge-cards {
  display: grid; gap: 18px; grid-template-columns: 1fr 1fr; padding: 6px;
  height: 100%; align-items: stretch;
}
.vx-pledge-cards.duo { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 14px; }
.vx-pledge-vs {
  align-self: center; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%;
  font: italic 900 20px/1 inherit; letter-spacing: 1px; color: #fff;
  background: radial-gradient(circle at 50% 35%, #26324a, #0a111c);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, .12), -10px 0 30px color-mix(in srgb, var(--side-a) 45%, transparent),
    10px 0 30px color-mix(in srgb, var(--side-b) 45%, transparent);
}

.vx-pledge-card {
  position: relative; display: flex; flex-direction: column; min-height: 0; cursor: pointer;
  border-radius: 18px; overflow: hidden;
  background: linear-gradient(180deg, color-mix(in srgb, var(--side) 10%, rgba(12, 20, 30, .92)), rgba(9, 14, 22, .94));
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12), 0 20px 48px rgba(0, 0, 0, .45);
  transition: box-shadow .2s, transform .2s cubic-bezier(.2, .9, .25, 1), opacity .3s, filter .3s;
}
.vx-pledge-card:focus-visible { outline: 2px solid var(--side); outline-offset: 3px; }
.vx-pledge-shell[data-phase="idle"] .vx-pledge-card:hover {
  transform: translateY(-4px);
  box-shadow: inset 0 0 0 1px var(--side), 0 26px 60px rgba(0, 0, 0, .55),
    0 0 40px color-mix(in srgb, var(--side) 25%, transparent);
}
/* The picked side burns; the other steps back. */
.vx-pledge-card[data-selected="1"] {
  transform: translateY(-4px) scale(1.015);
  box-shadow: inset 0 0 0 2px var(--side), 0 0 60px color-mix(in srgb, var(--side) 50%, transparent),
    0 26px 60px rgba(0, 0, 0, .55);
}
.vx-pledge-shell[data-picked="1"][data-phase="idle"] .vx-pledge-card:not([data-selected="1"]) {
  opacity: .55; filter: saturate(.45);
}
.vx-pledge-shell[data-picked="1"][data-phase="idle"] .vx-pledge-card:not([data-selected="1"]):hover { opacity: .85; filter: none; }
.vx-pledge-crest {
  position: relative; flex: none; display: flex; align-items: center; gap: 13px; padding: 18px 20px;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, .045) 0 10px, transparent 10px 20px),
    linear-gradient(180deg, color-mix(in srgb, var(--side) 45%, transparent), transparent);
}
.vx-pledge-crest-mark {
  display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;
  border-radius: 12px; font-size: 21px; color: #0b1119;
  background: linear-gradient(150deg, color-mix(in srgb, var(--side) 55%, #fff), var(--side));
  box-shadow: 0 0 24px color-mix(in srgb, var(--side) 55%, transparent), inset 0 -3px rgba(0, 0, 0, .25);
}
.vx-pledge-card[data-selected="1"] .vx-pledge-crest-mark { animation: vx-pledge-pulse 1.6s ease-in-out infinite; }
@keyframes vx-pledge-pulse { 50% { box-shadow: 0 0 40px color-mix(in srgb, var(--side) 85%, transparent), inset 0 -3px rgba(0, 0, 0, .25); } }
.vx-pledge-crest h2 {
  flex: 1; margin: 0; font-size: clamp(20px, 2.6vw, 27px); font-weight: 900; letter-spacing: 3px; text-transform: uppercase;
  color: #fff; text-shadow: 0 0 24px color-mix(in srgb, var(--side) 70%, transparent) !important;
}
/* Per-card pick button, pinned under the dossier. */
.vx-pledge-pick {
  flex: none; margin: 0 18px 18px; min-height: 46px; border: 1px solid color-mix(in srgb, var(--side) 55%, transparent);
  border-radius: 12px; cursor: pointer; color: #fff; background: color-mix(in srgb, var(--side) 16%, transparent);
  font: 800 11px/1 inherit; letter-spacing: 2px; text-transform: uppercase;
  transition: background .15s, transform .15s, box-shadow .15s;
}
.vx-pledge-pick:hover { background: color-mix(in srgb, var(--side) 30%, transparent); }
.vx-pledge-card[data-selected="1"] .vx-pledge-pick {
  color: #0b1119; border-color: transparent;
  background: linear-gradient(135deg, color-mix(in srgb, var(--side) 50%, #fff), var(--side));
  box-shadow: 0 10px 28px color-mix(in srgb, var(--side) 45%, transparent);
}
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

/* THE PICK. A wash of the side's colour over the chosen card, then the
   winner's glow and the other side's fade once the oath is sworn. */
.vx-pledge-card::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(90% 55% at 50% 0%, color-mix(in srgb, var(--side) 38%, transparent), transparent 72%);
  transition: opacity .2s;
}
.vx-pledge-card[data-selected="1"]::after, .vx-pledge-card[data-fate="won"]::after { opacity: 1; }
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
  width: min(460px, 100%); min-height: 56px; font-size: 13px; letter-spacing: 2.6px;
}
.vx-pledge-roll[data-side] .vx-gov-btn:not(:disabled) {
  color: #0b1119; background: linear-gradient(135deg, color-mix(in srgb, var(--side) 45%, #fff), var(--side));
  box-shadow: 0 12px 34px color-mix(in srgb, var(--side) 45%, transparent);
}
/* A sheen that sweeps the idle button, so the one thing to press reads as live. */
.vx-pledge-roll .vx-gov-btn::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, .55), transparent);
  transform: skewX(-18deg); animation: vx-pledge-sheen 2.6s ease-in-out infinite;
}
.vx-pledge-roll .vx-gov-btn:disabled { opacity: .55; cursor: default; }
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
  .vx-pledge-shell::before, .vx-pledge-card[data-selected="1"] .vx-pledge-crest-mark { animation: none; }
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
  .vx-pledge-cards, .vx-pledge-cards.duo { grid-template-columns: 1fr; height: auto; }
  .vx-pledge-vs { justify-self: center; width: 48px; height: 48px; font-size: 16px; }
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

/** How long the reveal holds before the pledge is sent. */
const REVEAL_MS = 2400;
/** If the screen is still up this long after sending (the server said no),
 *  put the roll back so the player is never stuck behind a dead screen. */
const PLEDGE_RETRY_MS = 8000;

type Phase = 'idle' | 'landed';

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
  /** The side the player has picked but not yet sworn to. */
  private selected: number | null = null;
  private readonly rollWrap: HTMLElement;
  private timer: number | undefined;
  /** This render's cards by faction id, to mark the pick without a rebuild. */
  private cardEls = new Map<number, HTMLElement>();
  /** This render's busts, so the losing side's can be cleared on landing. */
  private busts: BustEntry[] = [];

  onPledge?: (faction: number) => void;
  /** A side was picked (not yet sworn); `progress` is kept for the UI tick sound. */
  onTick?: (progress: number) => void;
  /** The player swore to a side. */
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
      'Pick the side you will fight for in every war, flag raid and season. '
      + '<b>You can never switch.</b> Look them over, then swear.';
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
    this.rollWrap = roll;
    roll.className = 'vx-pledge-roll';
    this.rollButton = document.createElement('button');
    this.rollButton.type = 'button';
    this.rollButton.className = 'vx-gov-btn';
    this.rollButton.dataset.kind = 'primary';
    this.rollButton.addEventListener('click', () => this.swear());
    const note = document.createElement('div');
    note.className = 'vx-pledge-roll-note';
    note.textContent = 'Your choice is permanent on this account.';
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
    this.selected = null;
    this.setPhase('idle');
    delete this.reveal.dataset.show;
    this.reveal.replaceChildren();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.shell.dataset.phase = phase;
    this.back.disabled = phase !== 'idle';
    this.refreshPick();
  }

  /** Reflect the current pick on the cards and the swear button. */
  private refreshPick(): void {
    const pick = this.selected;
    if (pick === null) delete this.shell.dataset.picked; else this.shell.dataset.picked = '1';
    for (const [id, card] of this.cardEls) {
      const on = id === pick;
      if (on) card.dataset.selected = '1'; else delete card.dataset.selected;
      card.setAttribute('aria-checked', String(on));
      const btn = card.querySelector<HTMLButtonElement>('.vx-pledge-pick');
      if (btn) btn.textContent = on ? 'Selected' : `Choose ${factionName(id)}`;
    }
    if (pick === null) {
      delete this.rollWrap.dataset.side;
      this.rollWrap.style.removeProperty('--side');
    } else {
      this.rollWrap.dataset.side = String(pick);
      this.rollWrap.style.setProperty('--side', `#${factionColor(pick).toString(16).padStart(6, '0')}`);
    }
    this.rollButton.disabled = this.phase !== 'idle' || pick === null;
    this.rollButton.textContent = this.phase === 'landed' ? 'Sworn'
      : pick === null ? 'Pick a side' : `Swear allegiance to ${factionName(pick)}`;
  }

  private select(faction: number): void {
    if (this.phase !== 'idle' || !this.isOpen || this.selected === faction) return;
    this.selected = faction;
    this.onTick?.(0.5);
    this.refreshPick();
  }

  /** The second, deliberate press: commit to the picked side. */
  private swear(): void {
    if (this.phase !== 'idle' || !this.isOpen || this.selected === null) return;
    this.land(this.selected);
  }

  private land(winner: number): void {
    this.setPhase('landed');
    for (const [id, card] of this.cardEls) {
      card.dataset.fate = id === winner ? 'won' : 'lost';
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
    eyebrow.textContent = 'You have sworn to';
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
    this.cards.setAttribute('role', 'radiogroup');
    this.cards.setAttribute('aria-label', 'Factions');
    this.busts = busts;
    this.cardEls.clear();
    this.cards.replaceChildren();

    // Never the wire's list directly — see dossiersFor. Both sides get a card
    // whether or not anyone has joined either of them.
    const dossiers = dossiersFor(data.factions);
    const hex = (id: number) => `#${factionColor(id).toString(16).padStart(6, '0')}`;
    if (dossiers[0]) this.shell.style.setProperty('--side-a', hex(dossiers[0].faction));
    if (dossiers[1]) this.shell.style.setProperty('--side-b', hex(dossiers[1].faction));
    this.cards.classList.toggle('duo', dossiers.length === 2);
    const total = dossiers.reduce((n, f) => n + f.memberCount, 0);
    // Only tell the player to point at somebody when somebody is standing there.
    this.footText.textContent = dossiers.some((f) => f.faces?.length)
      ? 'Point at a citizen to get their attention.'
      : 'Either side is yours to join.';

    dossiers.forEach((info, index) => {
      const card = document.createElement('div');
      card.className = 'vx-pledge-card';
      card.style.setProperty('--side', hex(info.faction));
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-label', factionName(info.faction));
      card.tabIndex = 0;
      card.addEventListener('click', () => this.select(info.faction));
      card.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        this.select(info.faction);
      });
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

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'vx-pledge-pick';
      pick.tabIndex = -1; // the card itself is the focus stop
      card.append(crest, stage, body, pick);
      if (index === 1 && dossiers.length === 2) {
        const vs = document.createElement('div');
        vs.className = 'vx-pledge-vs';
        vs.setAttribute('aria-hidden', 'true');
        vs.textContent = 'VS';
        this.cards.appendChild(vs);
      }
      this.cards.appendChild(card);
    });
    this.refreshPick();

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
