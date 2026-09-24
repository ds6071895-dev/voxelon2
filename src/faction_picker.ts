// THE ALLEGIANCE ROLL — the screen that decides which side you are on.
//
// Both sides are laid out with the facts in front of you:
//
//   · how many have sworn to it, and who they are
//
// You pick a card, then confirm with the swear button. The result is
// PERMANENT, so nothing is sent until that second, deliberate press.
//
// SELF-CONTAINED: one injected <style>, a `vx-pledge-` prefix used nowhere else,
// nothing added to index.html. Usernames are written with textContent and never
// reach innerHTML.

import { type IconName, iconSvg } from './emoji_icons';
import type { FactionPublic } from './net/protocol';
import { FACTIONS, factionColor, factionName } from './teams';
import { injectGovStyle } from './gov_ui';

const CSS = `
/* DAYLIGHT. The pledge is the last thing a new player does before the world
 * opens, straight after the first-play briefing — so it wears the briefing's
 * clothes: pale sky, drifting graph-paper grid, floating voxels, white glass.
 * Each side's colour washes in from its own edge. --side-a/--side-b are set
 * from FACTIONS at render time. */
.vx-gov-surface.vx-pledge-surface {
  --side-a: #e23b3b; --side-b: #3b78e2;
  --ink: #0f1c25; --ink-2: #4a5c68; --ink-3: #8795a0; --line: #e3e8ef;
  overflow: hidden; color: var(--ink); backdrop-filter: none;
  background:
    radial-gradient(48% 62% at 0% 55%, color-mix(in srgb, var(--side-a) 24%, transparent), transparent 72%),
    radial-gradient(48% 62% at 100% 55%, color-mix(in srgb, var(--side-b) 24%, transparent), transparent 72%),
    radial-gradient(40% 40% at 50% 100%, rgba(255, 214, 140, .45), transparent 70%),
    linear-gradient(180deg, #e8f3ff 0%, #f6f9fc 55%, #fdf7ec 100%);
}
/* A faint isometric grid, like graph paper for a voxel world. */
.vx-pledge-surface::before {
  content: ''; position: absolute; inset: -50%; pointer-events: none; opacity: .55;
  background-image:
    linear-gradient(30deg, rgba(40, 80, 120, .07) 1px, transparent 1px),
    linear-gradient(150deg, rgba(40, 80, 120, .07) 1px, transparent 1px);
  background-size: 56px 32px;
  animation: vx-pledge-grid 40s linear infinite;
}
@keyframes vx-pledge-grid { to { transform: translate(56px, 32px); } }
.vx-pledge-surface .vx-gov-scroll::-webkit-scrollbar-thumb { background: rgba(30, 60, 90, .18); }

/* Voxels: five faces in preserve-3d (the bottom never shows). --s is the edge,
   --c the colour. The same cube the briefing spins. */
.vx-pledge-cube {
  --s: 40px; --c: #2bb6e8;
  position: relative; width: var(--s); height: var(--s); transform-style: preserve-3d;
  transform: rotateX(-30deg) rotateY(45deg);
}
.vx-pledge-cube > i {
  position: absolute; inset: 0; display: grid; place-items: center; font-style: normal;
  backface-visibility: hidden; border-radius: calc(var(--s) * .06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .35);
  color: #fff; font-size: calc(var(--s) * .44);
}
.vx-pledge-cube > i svg { filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .2)); }
.vx-pledge-cube > i:nth-child(1) { transform: translateZ(calc(var(--s) / 2)); background: var(--c); }
.vx-pledge-cube > i:nth-child(2) { transform: rotateY(90deg) translateZ(calc(var(--s) / 2)); background: color-mix(in srgb, var(--c) 78%, #0b1a24); }
.vx-pledge-cube > i:nth-child(3) { transform: rotateX(90deg) translateZ(calc(var(--s) / 2)); background: color-mix(in srgb, var(--c) 55%, #fff); }
.vx-pledge-cube > i:nth-child(4) { transform: rotateY(-90deg) translateZ(calc(var(--s) / 2)); background: color-mix(in srgb, var(--c) 78%, #0b1a24); }
.vx-pledge-cube > i:nth-child(5) { transform: rotateY(180deg) translateZ(calc(var(--s) / 2)); background: var(--c); }
@keyframes vx-pledge-spin { from { transform: rotateX(-30deg) rotateY(0deg); } to { transform: rotateX(-30deg) rotateY(360deg); } }

.vx-pledge-field { position: absolute; inset: 0; pointer-events: none; }
.vx-pledge-float {
  position: absolute; left: var(--x); top: var(--y); opacity: var(--o, .5); perspective: 600px;
  animation: vx-pledge-float var(--d, 14s) ease-in-out var(--delay, 0s) infinite alternate;
}
.vx-pledge-float .vx-pledge-cube { animation: vx-pledge-spin var(--spin, 26s) linear infinite; }
@keyframes vx-pledge-float { from { transform: translateY(0); } to { transform: translateY(-38px); } }

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
  position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px;
  width: min(1120px, 100%); height: min(880px, 100%); padding: 4px;
  animation: vx-pledge-open .7s cubic-bezier(.2, .9, .2, 1) both;
}
@keyframes vx-pledge-open { from { opacity: 0; transform: translateY(26px) scale(.97); } to { opacity: 1; transform: none; } }

.vx-pledge-head { display: flex; flex-direction: column; align-items: center; text-align: center; }
.vx-pledge-chapter {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 13px 7px 10px; border-radius: 999px; background: #fff;
  color: #3d4e59; font-size: 11px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase;
  box-shadow: 0 4px 14px -6px rgba(30, 60, 90, .45);
}
.vx-pledge-chapter::before {
  content: ''; width: 8px; height: 8px; border-radius: 50%;
  background: linear-gradient(90deg, var(--side-a) 50%, var(--side-b) 50%);
  box-shadow: 0 0 0 4px rgba(120, 130, 160, .16);
  animation: vx-pledge-dot 1.8s ease-in-out infinite;
}
@keyframes vx-pledge-dot { 50% { box-shadow: 0 0 0 7px rgba(120, 130, 160, .06); } }
.vx-pledge-head h1 {
  margin: 12px 0 0; color: var(--ink); font-size: clamp(30px, 4.4vw, 52px); font-weight: 900;
  line-height: 1; letter-spacing: -1.2px;
}
.vx-pledge-head h1 em {
  font-style: normal; color: transparent; -webkit-background-clip: text; background-clip: text;
  background-image: linear-gradient(90deg,
    color-mix(in srgb, var(--side-a) 82%, #0e1c26), color-mix(in srgb, var(--side-b) 82%, #0e1c26));
}
.vx-pledge-head p {
  margin: 10px auto 0; max-width: 60ch; font-size: 14px; font-weight: 500; line-height: 1.55; color: var(--ink-2);
}
.vx-pledge-head b { color: var(--ink); font-weight: 800; }

/* The pan fills the scrollport exactly, so each card is a known height and
   scrolls its own dossier. */
.vx-pledge-cards {
  display: grid; gap: 22px; grid-template-columns: 1fr 1fr; padding: 16px 24px 26px;
  height: 100%; align-items: stretch;
}
.vx-pledge-cards.duo { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 16px; }

/* VS: a white medallion ringed half in each side's colour, slowly turning. */
.vx-pledge-vs {
  position: relative; align-self: center; display: grid; place-items: center; width: 70px; height: 70px;
  border-radius: 50%; background: #fff;
  font-style: italic; font-weight: 900; font-size: 21px; line-height: 1; letter-spacing: -.5px; color: var(--ink);
  box-shadow: 0 14px 30px -10px rgba(30, 60, 90, .45);
}
.vx-pledge-vs::before {
  content: ''; position: absolute; inset: -5px; z-index: -1; border-radius: 50%;
  background: conic-gradient(from 0deg, var(--side-a), color-mix(in srgb, var(--side-a) 20%, #fff), var(--side-b), color-mix(in srgb, var(--side-b) 20%, #fff), var(--side-a));
  animation: vx-pledge-turn 6s linear infinite;
}
.vx-pledge-vs::after {
  content: ''; position: absolute; left: 50%; top: -120%; bottom: -120%; width: 2px; z-index: -2;
  transform: translateX(-50%);
  background: linear-gradient(180deg, transparent, rgba(30, 60, 90, .16) 30%, rgba(30, 60, 90, .16) 70%, transparent);
}
@keyframes vx-pledge-turn { to { transform: rotate(360deg); } }

.vx-pledge-card {
  --side-ink: color-mix(in srgb, var(--side) 70%, #0e1c26);
  --side-soft: color-mix(in srgb, var(--side) 11%, #fff);
  position: relative; display: flex; flex-direction: column; min-height: 0; cursor: pointer;
  border-radius: 24px; overflow: hidden;
  /* Solid, not frosted: a backdrop-filter under the bust canvas composites a
     pale veil over the whole viewport the canvas covers. */
  background: rgba(255, 255, 255, .95);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .9), 0 1px 0 rgba(255, 255, 255, .9) inset,
    0 24px 44px -24px rgba(30, 60, 90, .38), 0 10px 22px -14px rgba(30, 60, 90, .2);
  transition: box-shadow .25s, transform .3s cubic-bezier(.2, .9, .25, 1), opacity .3s, filter .3s;
}
.vx-pledge-card:focus-visible { outline: 3px solid var(--side); outline-offset: 4px; }
.vx-pledge-shell[data-phase="idle"] .vx-pledge-card:hover {
  transform: translateY(-5px);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--side) 45%, #fff),
    0 24px 44px -22px color-mix(in srgb, var(--side) 60%, rgba(30, 60, 90, .5)), 0 10px 22px -14px rgba(30, 60, 90, .2);
}
/* The picked side lights up; the other steps back. */
.vx-pledge-card[data-selected="1"] {
  transform: translateY(-6px) scale(1.012);
  box-shadow: inset 0 0 0 3px var(--side), 0 0 0 6px color-mix(in srgb, var(--side) 16%, transparent),
    0 24px 44px -20px color-mix(in srgb, var(--side) 75%, rgba(30, 60, 90, .5));
}
.vx-pledge-shell[data-picked="1"][data-phase="idle"] .vx-pledge-card:not([data-selected="1"]) {
  opacity: .6; filter: saturate(.35);
}
.vx-pledge-shell[data-picked="1"][data-phase="idle"] .vx-pledge-card:not([data-selected="1"]):hover { opacity: .9; filter: none; }

/* THE BANNER. A band of the side's colour, striped like a flag on a pole, with
   its spinning voxel crest and a giant ghost initial behind the name. */
.vx-pledge-crest {
  position: relative; flex: none; display: flex; align-items: center; gap: 18px;
  padding: 20px 22px 22px; overflow: hidden; color: #fff;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, .09) 0 12px, transparent 12px 24px),
    radial-gradient(80% 140% at 0% 0%, color-mix(in srgb, var(--side) 55%, #fff), transparent 60%),
    linear-gradient(135deg, var(--side), color-mix(in srgb, var(--side) 70%, #0e1c26));
}
.vx-pledge-crest::after {
  content: attr(data-initial); position: absolute; right: -8px; bottom: -40px;
  font-weight: 900; font-size: 150px; line-height: 1; letter-spacing: -8px; color: rgba(255, 255, 255, .13); pointer-events: none;
}
.vx-pledge-emblem {
  flex: none; display: grid; place-items: center; width: 64px; height: 64px; perspective: 600px;
  animation: vx-pledge-bob 4.5s ease-in-out infinite;
}
.vx-pledge-emblem .vx-pledge-cube {
  --s: 42px; --c: color-mix(in srgb, var(--side) 85%, #fff);
  animation: vx-pledge-spin 16s linear infinite;
}
.vx-pledge-emblem .vx-pledge-cube > i { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .55); }
.vx-pledge-card[data-selected="1"] .vx-pledge-emblem .vx-pledge-cube { animation-duration: 3s; }
@keyframes vx-pledge-bob { 50% { transform: translateY(-6px); } }
.vx-pledge-crest-text { position: relative; z-index: 1; flex: 1; min-width: 0; }
.vx-pledge-crest h2 {
  margin: 0; font-size: clamp(26px, 3.2vw, 38px); font-weight: 900; line-height: 1; letter-spacing: -.5px;
  color: #fff; text-transform: uppercase;
}
.vx-pledge-motto {
  margin-top: 6px; font-size: 12.5px; font-weight: 600; letter-spacing: .2px; color: rgba(255, 255, 255, .86);
}
.vx-pledge-strength {
  position: relative; z-index: 1; align-self: flex-start;
  padding: 6px 10px; border-radius: 999px; font-weight: 800; font-size: 10px; line-height: 1;
  letter-spacing: 1.2px; text-transform: uppercase; color: var(--side-ink);
  background: #fff; box-shadow: 0 6px 16px -8px rgba(0, 0, 0, .45);
}
.vx-pledge-strength[data-tone="big"] { color: #9a5a00; background: #fff4dc; }
.vx-pledge-strength[data-tone="small"] { color: #137046; background: #e3f8ec; }

/* THE PICK. A wash of the side's colour over the chosen card. */
.vx-pledge-card::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(90% 50% at 50% 100%, color-mix(in srgb, var(--side) 14%, transparent), transparent 72%);
  transition: opacity .25s;
}
.vx-pledge-card[data-selected="1"]::after, .vx-pledge-card[data-fate="won"]::after { opacity: 1; }
.vx-pledge-card[data-fate="won"] {
  animation: vx-pledge-win 1.1s cubic-bezier(.2, .9, .3, 1.3) both;
  box-shadow: inset 0 0 0 3px var(--side), 0 0 0 8px color-mix(in srgb, var(--side) 22%, transparent),
    0 24px 44px -20px color-mix(in srgb, var(--side) 80%, transparent);
}
.vx-pledge-card[data-fate="lost"] { opacity: .3; filter: grayscale(1); transform: scale(.95); }
@keyframes vx-pledge-win {
  0% { transform: scale(1.02); }
  30% { transform: scale(1.07); }
  100% { transform: scale(1.035); }
}

/* The only scrolling part of a card. Everything here is reading material; the
   banner above it and the button below it stay put. */
.vx-pledge-body {
  position: relative; z-index: 1;
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px; padding: 14px 18px 16px;
}
.vx-pledge-body::-webkit-scrollbar { width: 7px; }
.vx-pledge-body::-webkit-scrollbar-thumb { border-radius: 4px; background: rgba(30, 60, 90, .16); }

.vx-pledge-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.vx-pledge-stat {
  display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 11px; align-items: center;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: 15px; background: #fbfcfe;
}
.vx-pledge-stat-glyph {
  display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px;
  font-size: 18px; color: var(--side-ink); background: var(--side-soft);
}
.vx-pledge-stat b { display: block; font-size: 20px; font-weight: 900; line-height: 1.1; color: var(--ink); }
.vx-pledge-stat small { display: block; margin-top: 2px; font-size: 10.5px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--ink-3); }
/* A tug-of-war meter under the numbers: this side's share of all citizens. */
.vx-pledge-share { grid-column: 1 / -1; height: 6px; border-radius: 99px; background: #edf1f5; overflow: hidden; }
.vx-pledge-share > span {
  display: block; height: 100%; border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--side) 60%, #fff), var(--side));
  transition: width .6s cubic-bezier(.2, .8, .2, 1);
}

.vx-pledge-roster { padding: 12px 13px; border: 1px solid var(--line); border-radius: 15px; background: #fbfcfe; }
.vx-pledge-roster-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; color: var(--ink-3);
}
.vx-pledge-roster-names {
  display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; max-height: 78px; overflow-y: auto;
}
.vx-pledge-roster-names::-webkit-scrollbar { width: 6px; }
.vx-pledge-roster-names::-webkit-scrollbar-thumb { border-radius: 3px; background: rgba(30, 60, 90, .16); }
.vx-pledge-name {
  padding: 4px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; color: var(--side-ink);
  background: var(--side-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--side) 16%, #fff);
}
.vx-pledge-roster-empty { margin-top: 8px; font-size: 12.5px; font-weight: 500; color: var(--ink-3); }

/* Per-card pick button, pinned under the dossier. */
.vx-pledge-pick {
  position: relative; z-index: 1;
  flex: none; display: flex; align-items: center; justify-content: center; gap: 8px;
  margin: 0 18px 18px; min-height: 48px; border: 1px solid color-mix(in srgb, var(--side) 30%, #fff);
  border-radius: 14px; cursor: pointer; color: var(--side-ink); background: var(--side-soft);
  font-weight: 800; font-size: 13.5px; line-height: 1; letter-spacing: .2px;
  transition: background .15s, transform .15s, box-shadow .2s, color .15s;
}
.vx-pledge-pick svg { width: 16px; height: 16px; }
.vx-pledge-pick:hover { background: color-mix(in srgb, var(--side) 20%, #fff); }
.vx-pledge-card[data-selected="1"] .vx-pledge-pick {
  color: #fff; border-color: transparent;
  background: linear-gradient(180deg, color-mix(in srgb, var(--side) 88%, #fff), color-mix(in srgb, var(--side) 82%, #0e1c26));
  box-shadow: 0 12px 26px -10px color-mix(in srgb, var(--side) 85%, #0e1c26), inset 0 1px 0 rgba(255, 255, 255, .35);
}

.vx-pledge-roll {
  flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.vx-pledge-surface .vx-pledge-roll .vx-gov-btn {
  position: relative; overflow: hidden;
  width: min(480px, 100%); min-height: 58px; border-radius: 16px;
  font-size: 15px; font-weight: 850; letter-spacing: .2px; text-transform: none;
  color: #8795a0; background: #fff; box-shadow: inset 0 0 0 1px var(--line), 0 10px 24px -14px rgba(30, 60, 90, .4);
}
.vx-pledge-surface .vx-pledge-roll[data-side] .vx-gov-btn:not(:disabled) {
  color: #fff; text-shadow: 0 1px 1px rgba(0, 0, 0, .15);
  background: linear-gradient(180deg, color-mix(in srgb, var(--side) 88%, #fff), color-mix(in srgb, var(--side) 82%, #0e1c26));
  box-shadow: 0 16px 34px -12px color-mix(in srgb, var(--side) 85%, #0e1c26), inset 0 1px 0 rgba(255, 255, 255, .35);
}
/* A sheen that sweeps the live button, so the one thing to press reads as live. */
.vx-pledge-roll .vx-gov-btn::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, .55), transparent);
  transform: skewX(-18deg); animation: vx-pledge-sheen 2.6s ease-in-out infinite;
}
.vx-pledge-roll .vx-gov-btn:disabled { opacity: 1; cursor: default; }
.vx-pledge-roll .vx-gov-btn:disabled::after { display: none; }
@keyframes vx-pledge-sheen { 0%, 55% { left: -40%; } 100% { left: 130%; } }
.vx-pledge-roll-note {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; line-height: 1.5; text-align: center; color: #b4452f;
}
.vx-pledge-roll-note svg { width: 13px; height: 13px; }

/* THE REVEAL. Laid over the whole surface — above the bust layer — once the
   oath is sworn: a daylight flash in the winning colour, the side's name on a
   white banner, and a burst of voxels. */
.vx-pledge-reveal {
  position: absolute; inset: 0; z-index: 10; pointer-events: none;
  display: none; flex-direction: column; align-items: center; justify-content: center;
}
.vx-pledge-reveal[data-show="1"] { display: flex; }
.vx-pledge-flash {
  position: absolute; inset: -10%; opacity: 0;
  background: radial-gradient(45% 45% at 50% 50%, #fff, color-mix(in srgb, var(--side) 30%, #fff) 45%, transparent 75%);
  animation: vx-pledge-flash 1.3s ease-out both;
}
@keyframes vx-pledge-flash { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: .5; } }
.vx-pledge-banner {
  position: relative; display: flex; flex-direction: column; align-items: center;
  padding: 26px 52px 30px; border-radius: 26px; text-align: center;
  background: rgba(255, 255, 255, .96);
  box-shadow: inset 0 0 0 3px var(--side), 0 0 0 10px color-mix(in srgb, var(--side) 18%, transparent),
    0 40px 90px -20px color-mix(in srgb, var(--side) 70%, rgba(30, 60, 90, .5));
  animation: vx-pledge-pop .7s cubic-bezier(.2, 1.4, .4, 1) both .08s;
}
.vx-pledge-banner .vx-pledge-emblem { width: 90px; height: 90px; }
.vx-pledge-banner .vx-pledge-cube { --s: 60px; --c: var(--side); animation-duration: 2.4s; }
.vx-pledge-banner small {
  display: block; margin-top: 10px; font-size: 11px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #8795a0;
}
.vx-pledge-banner strong {
  display: block; margin-top: 6px; font-size: clamp(36px, 7vw, 68px); font-weight: 900; line-height: 1;
  letter-spacing: -1px; text-transform: uppercase; color: var(--side);
}
@keyframes vx-pledge-pop {
  0% { transform: scale(.3) rotate(-6deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
.vx-pledge-spark {
  position: absolute; left: 50%; top: 50%; width: var(--sz, 12px); height: var(--sz, 12px); border-radius: 2px;
  background: var(--c); opacity: 0; box-shadow: inset 0 -3px rgba(0, 0, 0, .18), inset 0 2px rgba(255, 255, 255, .4);
  animation: vx-pledge-burst 1.6s cubic-bezier(.15, .7, .3, 1) both var(--delay);
}
@keyframes vx-pledge-burst {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(0); }
  80% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--rot)); }
}
@media (prefers-reduced-motion: reduce) {
  .vx-pledge-spark, .vx-pledge-roll .vx-gov-btn::after { display: none; }
  .vx-pledge-surface *, .vx-pledge-surface::before, .vx-pledge-shell { animation: none !important; }
  .vx-pledge-card[data-fate="won"], .vx-pledge-banner, .vx-pledge-flash { animation-duration: .01s !important; }
}
.vx-pledge-foot {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 16px;
  font-size: 12px; font-weight: 500; color: var(--ink-3);
}
.vx-pledge-back {
  min-height: 36px; border: 1px solid var(--line); border-radius: 11px; padding: 0 14px; cursor: pointer;
  font-weight: 800; font-size: 12px; line-height: 1; color: #2d3d48; background: #f1f4f8;
}
.vx-pledge-back:hover { background: #e8edf3; }
.vx-pledge-back:disabled { opacity: .35; cursor: default; }
.vx-pledge-back:focus-visible { outline: 2px solid #2bb6e8; outline-offset: 2px; }

@media (max-width: 860px) {
  /* Stacked, the two cards cannot both fill the screen — the pan goes back to
     scrolling, and each card sizes to its own content with the button at its
     foot rather than a screen away from it. */
  .vx-pledge-cards, .vx-pledge-cards.duo { grid-template-columns: 1fr; height: auto; }
  .vx-pledge-vs { justify-self: center; width: 52px; height: 52px; font-size: 17px; }
  .vx-pledge-vs::after { display: none; }
  .vx-pledge-body { overflow-y: visible; }
  .vx-pledge-float { display: none; }
}
@media (max-width: 520px) {
  .vx-gov-surface.vx-pledge-surface { padding: 12px; }
  .vx-pledge-head p { font-size: 13px; }
  .vx-pledge-crest { padding: 38px 16px 18px; gap: 12px; }
  .vx-pledge-crest h2 { font-size: 26px; }
  .vx-pledge-strength { position: absolute; top: 12px; right: 12px; padding: 5px 9px; font-size: 9px; }
  .vx-pledge-emblem { width: 48px; height: 48px; }
  .vx-pledge-emblem .vx-pledge-cube { --s: 32px; }
  .vx-pledge-stats { grid-template-columns: 1fr; }
  .vx-pledge-foot > span { display: none; }
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

/** A five-faced CSS voxel (the bottom never shows). `face` goes on the sides. */
function makeCube(face = ''): HTMLDivElement {
  const cube = document.createElement('div');
  cube.className = 'vx-pledge-cube';
  for (let f = 0; f < 5; f++) {
    const side = document.createElement('i');
    if (face && f !== 2) side.innerHTML = face;
    cube.appendChild(side);
  }
  return cube;
}

/** The spinning crest: a voxel in the side's colour carrying the flag. */
function makeEmblem(): HTMLDivElement {
  const emblem = document.createElement('div');
  emblem.className = 'vx-pledge-emblem';
  emblem.appendChild(makeCube(iconSvg('flag')));
  return emblem;
}

/** One line under each side's name. Flavour only; unknown sides get none. */
const MOTTOS: Record<number, string> = {
  0: 'Strike first. Hold the line.',
  1: 'Outthink them. Outlast them.',
};

const hex = (id: number): string => `#${factionColor(id).toString(16).padStart(6, '0')}`;

export interface PledgeData {
  factions: FactionPublic[];
}

/** How long the reveal holds before the pledge is sent. */
const REVEAL_MS = 2400;
/** If the screen is still up this long after sending (the server said no),
 *  put the roll back so the player is never stuck behind a dead screen. */
const PLEDGE_RETRY_MS = 8000;

type Phase = 'idle' | 'landed';

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
    };
  });
}

export class FactionPicker {
  private readonly surface: HTMLElement;
  private readonly shell: HTMLElement;
  /** The floating voxels behind everything. */
  private readonly field: HTMLElement;
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

    // Drifting background voxels, alternating the two sides' colours — the
    // same field the first-play briefing floats behind its frame.
    this.field = document.createElement('div');
    this.field.className = 'vx-pledge-field';
    this.field.setAttribute('aria-hidden', 'true');
    const floats: [number, number, number][] = [ // x%, y%, size px
      [4, 12, 34], [12, 80, 22], [30, 4, 16], [66, 92, 28],
      [84, 8, 26], [94, 58, 38], [2, 48, 18], [76, 42, 14],
    ];
    floats.forEach(([x, y, size], n) => {
      const wrap = document.createElement('div');
      wrap.className = 'vx-pledge-float';
      wrap.style.cssText = `--x:${x}%;--y:${y}%;--d:${10 + n * 1.7}s;--delay:${-n * 1.3}s;--spin:${18 + n * 4}s;--o:${.3 + (n % 3) * .14}`;
      const cube = makeCube();
      cube.style.setProperty('--s', `${size}px`);
      // Left of centre floats side A's colour, right of it side B's.
      cube.style.setProperty('--c', x < 50 ? 'var(--side-a)' : 'var(--side-b)');
      wrap.appendChild(cube);
      this.field.appendChild(wrap);
    });
    this.surface.appendChild(this.field);

    this.shell = document.createElement('div');
    this.shell.className = 'vx-pledge-shell';
    this.shell.dataset.phase = 'idle';

    const head = document.createElement('div');
    head.className = 'vx-pledge-head';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'vx-pledge-chapter';
    eyebrow.textContent = 'Final step · Swear allegiance';
    const title = document.createElement('h1');
    title.innerHTML = 'Choose your <em>side</em>';
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

    // The warning sits in the foot row, beside the way out, so the cards keep
    // the height.
    const note = document.createElement('div');
    note.className = 'vx-pledge-roll-note';
    const lock = document.createElement('span');
    lock.innerHTML = iconSvg('lock');
    const noteText = document.createElement('span');
    noteText.textContent = 'Your choice is permanent on this account.';
    note.append(lock, noteText);
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
    foot.append(note, footText, back);

    const roll = document.createElement('div');
    this.rollWrap = roll;
    roll.className = 'vx-pledge-roll';
    this.rollButton = document.createElement('button');
    this.rollButton.type = 'button';
    this.rollButton.className = 'vx-gov-btn';
    this.rollButton.dataset.kind = 'primary';
    this.rollButton.addEventListener('click', () => this.swear());
    roll.append(this.rollButton);

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
      if (btn) {
        const label = document.createElement('span');
        label.textContent = on ? `${factionName(id)} selected` : `Choose ${factionName(id)}`;
        btn.innerHTML = iconSvg(on ? 'check' : 'arrowRight');
        btn.prepend(label);
      }
    }
    if (pick === null) {
      delete this.rollWrap.dataset.side;
      this.rollWrap.style.removeProperty('--side');
    } else {
      this.rollWrap.dataset.side = String(pick);
      this.rollWrap.style.setProperty('--side', hex(pick));
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
    const side = hex(winner);
    this.reveal.style.setProperty('--side', side);
    const flash = document.createElement('div');
    flash.className = 'vx-pledge-flash';
    const banner = document.createElement('div');
    banner.className = 'vx-pledge-banner';
    const eyebrow = document.createElement('small');
    eyebrow.textContent = 'You have sworn to';
    const name = document.createElement('strong');
    name.textContent = factionName(winner);
    banner.append(makeEmblem(), eyebrow, name);
    this.reveal.replaceChildren(flash);
    const colors = [side, '#ffd06a', `color-mix(in srgb, ${side} 45%, #fff)`, '#2bb6e8'];
    for (let i = 0; i < 48; i++) {
      const spark = document.createElement('span');
      spark.className = 'vx-pledge-spark';
      const angle = (i / 48) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 180 + Math.random() * 300;
      spark.style.setProperty('--sz', `${8 + Math.round(Math.random() * 10)}px`);
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
    this.cards.setAttribute('role', 'radiogroup');
    this.cards.setAttribute('aria-label', 'Factions');
    this.cardEls.clear();
    this.cards.replaceChildren();

    // Never the wire's list directly — see dossiersFor. Both sides get a card
    // whether or not anyone has joined either of them.
    const dossiers = dossiersFor(data.factions);
    // On the surface, not the shell: the backdrop washes and floating voxels
    // are tinted with them too.
    if (dossiers[0]) this.surface.style.setProperty('--side-a', hex(dossiers[0].faction));
    if (dossiers[1]) this.surface.style.setProperty('--side-b', hex(dossiers[1].faction));
    this.cards.classList.toggle('duo', dossiers.length === 2);
    const total = dossiers.reduce((n, f) => n + f.memberCount, 0);
    this.footText.textContent = 'Either side is yours to join.';

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
      crest.dataset.initial = factionName(info.faction).charAt(0);
      const text = document.createElement('div');
      text.className = 'vx-pledge-crest-text';
      const name = document.createElement('h2');
      name.textContent = factionName(info.faction);
      text.appendChild(name);
      const mottoLine = MOTTOS[info.faction];
      if (mottoLine) {
        const motto = document.createElement('div');
        motto.className = 'vx-pledge-motto';
        motto.textContent = mottoLine;
        text.appendChild(motto);
      }
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
      crest.append(makeEmblem(), text, strength);

      // --- body --------------------------------------------------------------
      const body = document.createElement('div');
      body.className = 'vx-pledge-body';

      const stats = document.createElement('div');
      stats.className = 'vx-pledge-stats';
      const share = total > 0 ? info.memberCount / total : 0;
      const cells: [IconName, string, string][] = [
        ['shield', String(info.memberCount), 'Citizens'],
        ['scales', total > 0 ? `${Math.round(share * 100)}%` : '—', 'Of all citizens'],
      ];
      for (const [icon, value, label] of cells) {
        const stat = document.createElement('div');
        stat.className = 'vx-pledge-stat';
        const glyph = document.createElement('div');
        glyph.className = 'vx-pledge-stat-glyph';
        glyph.innerHTML = iconSvg(icon);
        const words = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = value;
        const small = document.createElement('small');
        small.textContent = label;
        words.append(b, small);
        stat.append(glyph, words);
        stats.appendChild(stat);
      }
      const meter = document.createElement('div');
      meter.className = 'vx-pledge-share';
      meter.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.style.width = `${Math.round(share * 100)}%`;
      meter.appendChild(fill);
      stats.appendChild(meter);
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
      card.append(crest, body, pick);
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
  }
}
