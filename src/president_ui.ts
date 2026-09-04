// THE GOVERNMENT MENU (/president) — the ballot, the campaign trail, and the
// powers of office.
//
// Four views on one screen:
//   · ELECTION      the race, read as a race: a segmented projection strip for
//                   the whole ballot, a spotlight on the front-runner, a turnout
//                   dial, and then every party standing as a ranked card with
//                   its founder as a live 3D character who poses when you point
//                   at them, its slogan, its promises, its share and your ballot
//   · CANDIDACY     found your own party — with a LIVE PREVIEW of the ballot
//                   card you are about to put in front of the faction
//   · ADMINISTRATION the levy dial, the broadcast desk and the KIT WORKSHOP —
//                   live for the sitting president, sealed for everybody else
//   · TREASURY      what the faction is holding, laid out the way the hoard
//                   actually stands in the world, plus who robbed it last
//
// THE BROADCAST DESK IS THE OFFICE'S. Addressing the faction is the one power
// that reaches every citizen, including the offline ones, so a citizen who has
// not won the vote does not get a disabled composer — they get a sealed card
// where it would be, and the textarea is never built. main.ts refuses the same
// call before it can reach the wire, and the server re-checks the presidency on
// every govBroadcast; this file is the screen telling the truth about it.
//
// SELF-CONTAINED: one injected <style> under a `vx-prez-` prefix, nothing added
// to index.html, and a single shared bust board (gov_ui.ts) rather than a
// renderer of its own. Player-authored text is written with textContent only.
// It runs the DAYLIGHT skin — `data-theme="light"` on the surface, which is what
// switches the shared chrome in gov_ui.ts; the pledge screen stays on slate.

import { BUST_POSES, type BustEntry } from './avatar_bust';
import { sanitizeCosmetics, type Cosmetics } from './character';
import { iconSvg, type IconName } from './emoji_icons';
import { renderItemIcon } from './icons';
import { ITEMS, type ItemStack } from './items';
import {
  MAX_BROADCAST, MAX_PARTY_NAME, MAX_PROMISES, MAX_SLOGAN, MAX_TAX,
  PRESET_PROMISES, TERM_MS, type Election, type Party, type PoliticsState,
  ballotOf, electionOf, governmentOf, isPresident, partyOfFounder, voteCounts,
} from './politics';
import {
  KIT_ARMOR_SLOTS, KIT_SLOTS, MAX_KIT_STACK, TREASURY_PEDESTALS,
  type KitLoadout, kitCost, kitItemCount, kitSlotAccepts, kitStacks, newKit,
} from './treasury';
import { skinSeed } from './net/protocol';
import { factionColor, factionName, isFaction } from './teams';
import { bustStage, govThemeOf, hideTip, injectGovStyle, itemChip, showTip } from './gov_ui';

const CSS = `
/* THE DAYLIGHT SKIN. The government menu is the one screen in VOXELON you read
   rather than fight in, so it is lit like paper: white cards on a soft wash,
   ink-on-white type, and the faction's own colour used as the ONLY strong hue —
   it bleeds through the header, the plinths, the vote bars and the card rings so
   the whole menu reads as belonging to your side.

   Every colour is a token on the shell, so the four views cannot drift apart.
   \`--side\` is set per-render from the faction palette. */
.vx-prez-shell {
  --paper: #ffffff;
  --ink: #0f1826;
  --muted: #55657d;
  --faint: #8593a7;
  --line: rgba(15, 26, 44, .11);
  --tint: #f2f6fc;
  --gold: #8a5a06;
  --gold-lit: #f0a521;

  position: relative; display: flex; flex-direction: column;
  width: min(1180px, 100%); height: min(820px, 100%);
  border-radius: 22px; overflow: hidden; color: var(--ink);
  background: linear-gradient(180deg, #fdfeff 0%, #eef3fa 100%);
  box-shadow: 0 40px 90px rgba(13, 27, 48, .3), 0 0 0 1px rgba(15, 26, 44, .1),
    inset 0 1px 0 rgba(255, 255, 255, .9);
}
/* A faction-coloured aurora bleeding down from the top edge. Everything after
   the header sits on z-index 1 so this never paints over content. */
.vx-prez-shell::before {
  content: ''; position: absolute; inset: 0 0 auto; height: 240px; pointer-events: none;
  background:
    radial-gradient(78% 130% at 10% -34%, color-mix(in srgb, var(--side) 40%, transparent), transparent 68%),
    radial-gradient(66% 120% at 92% -44%, color-mix(in srgb, var(--side) 24%, transparent), transparent 70%);
  opacity: .6;
}
.vx-prez-shell > * { position: relative; z-index: 1; }

.vx-prez-head { display: flex; align-items: center; gap: 16px; padding: 18px 22px 12px; }
.vx-prez-crest {
  position: relative; flex: none;
  display: flex; align-items: center; justify-content: center; width: 46px; height: 46px;
  border-radius: 15px; font-size: 21px; color: #fff;
  background: linear-gradient(158deg, color-mix(in srgb, var(--side) 62%, #fff), var(--side));
  box-shadow: 0 10px 22px color-mix(in srgb, var(--side) 40%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, .55);
}
/* The ring around the seal — a president's crest, not a toolbar icon. */
.vx-prez-crest::after {
  content: ''; position: absolute; inset: -5px; border-radius: 19px;
  border: 1px solid color-mix(in srgb, var(--side) 38%, transparent);
}
.vx-prez-titles { flex: 1; min-width: 0; }
.vx-prez-titles h1 {
  margin: 5px 0 0; font-size: 23px; font-weight: 800; letter-spacing: -.3px;
  color: var(--ink); overflow-wrap: anywhere;
}
.vx-prez-clock {
  flex: none; min-width: 138px; padding: 9px 13px 10px; border-radius: 14px; text-align: right;
  background: rgba(255, 255, 255, .78);
  box-shadow: inset 0 0 0 1px var(--line), 0 6px 18px rgba(15, 26, 44, .07);
}
.vx-prez-clock b {
  display: block; letter-spacing: -.5px; color: var(--gold);
  font: 800 19px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.vx-prez-clock small {
  display: block; margin-top: 5px; font-size: 8.5px; letter-spacing: 1.5px;
  text-transform: uppercase; color: var(--faint);
}
/* How much of the term has run — the countdown made a shape you can read at a
   glance instead of a number you have to convert. */
.vx-prez-clockbar {
  margin-top: 7px; height: 4px; border-radius: 2px; overflow: hidden;
  background: rgba(15, 26, 44, .1);
}
.vx-prez-clockbar i {
  display: block; height: 100%; border-radius: 2px; transition: width .6s ease;
  background: linear-gradient(90deg, var(--gold-lit), color-mix(in srgb, var(--side) 72%, #fff));
}

/* The tab strip is a segmented control: one recessed track, the live tab lifted
   out of it on a white card. */
.vx-prez-tabs {
  display: flex; gap: 3px; margin: 0 22px; padding: 4px; border-radius: 14px;
  background: rgba(15, 26, 44, .055); box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-tab {
  position: relative; flex: 1; border: 0; border-radius: 11px; cursor: pointer;
  padding: 10px 12px; background: none; color: var(--muted);
  font: 800 10px/1 inherit; letter-spacing: 1.4px; text-transform: uppercase;
  transition: color .16s, background .16s, box-shadow .16s;
}
.vx-prez-tab:hover { color: var(--ink); }
.vx-prez-tab[aria-selected="true"] {
  color: var(--ink); background: #fff;
  box-shadow: 0 3px 8px rgba(15, 26, 44, .13), inset 0 0 0 1px rgba(15, 26, 44, .06);
}
.vx-prez-tab[aria-selected="true"]::after {
  content: ''; position: absolute; left: 50%; bottom: 5px; width: 14px; height: 2px;
  border-radius: 1px; transform: translateX(-50%); background: var(--side);
}
.vx-prez-tab:focus-visible { outline: 2px solid var(--gold-lit); outline-offset: 1px; }
/* A tab carrying something you can act on right now (a kit waiting to be
   claimed, a vote you have not cast) wears a dot rather than a number. */
.vx-prez-tab[data-dot="1"]::before {
  content: ''; position: absolute; top: 7px; right: 9px; width: 6px; height: 6px;
  border-radius: 50%; background: var(--gold-lit);
  box-shadow: 0 0 0 2px rgba(240, 165, 33, .25);
}

.vx-prez-body { padding: 16px 22px 24px; }

.vx-prez-note {
  position: relative; overflow: hidden;
  padding: 13px 15px 13px 18px; border-radius: 13px; margin-bottom: 14px;
  font-size: 12px; line-height: 1.6; color: #3f4f68;
  background: linear-gradient(180deg, #fff, var(--tint));
  box-shadow: inset 0 0 0 1px var(--line), 0 4px 14px rgba(15, 26, 44, .05);
}
.vx-prez-note::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--side);
}
.vx-prez-note b { color: var(--gold); }
.vx-prez-note[data-tone="bad"]::before { background: #d0472f; }
.vx-prez-note[data-tone="bad"] { color: #7d2417; }

/* Section headings inside a view, with a hairline running out to the edge so a
   long screen reads as chapters rather than one scroll. */
.vx-prez-rule {
  display: flex; align-items: center; gap: 11px; margin: 22px 0 12px;
  font: 800 9.5px/1 inherit; letter-spacing: 1.9px; text-transform: uppercase;
  color: var(--faint);
}
.vx-prez-rule::after {
  content: ''; flex: 1; height: 1px; background: var(--line);
}
.vx-prez-rule:first-child { margin-top: 4px; }

/* --- the race ------------------------------------------------------------- */
/* The projection strip: the WHOLE ballot as one bar, so "who is winning and by
   how much" is a single glance rather than a column of percentages to compare.
   Segments are ordered exactly the way the count resolves them. */
.vx-prez-race {
  padding: 15px 17px 14px; border-radius: 16px; margin-bottom: 14px; background: #fff;
  box-shadow: inset 0 0 0 1px var(--line), 0 10px 26px rgba(15, 26, 44, .07);
}
.vx-prez-racehead {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  margin-bottom: 11px;
}
.vx-prez-racehead h3 {
  margin: 0; font: 800 10px/1 inherit; letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--muted);
}
.vx-prez-racehead span { font-size: 11px; color: var(--faint); }
.vx-prez-strip {
  position: relative; display: flex; height: 26px;
  border-radius: 9px; overflow: hidden; background: rgba(15, 26, 44, .07);
}
/* \`flex: none\` matters: these carry percentage widths that must stay exactly
   proportional to the count, and a shrinking flex item would quietly redraw the
   race. The divider is a hairline inside the segment rather than a gap, for the
   same reason. */
.vx-prez-seg {
  position: relative; flex: none; min-width: 3px; cursor: pointer;
  transition: filter .15s;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, .6);
}
.vx-prez-seg:last-of-type { box-shadow: none; }
.vx-prez-seg:hover { filter: brightness(1.12); }
.vx-prez-seg b {
  font: 800 9.5px/1 inherit; color: #fff; letter-spacing: .3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .35); pointer-events: none;
}
.vx-prez-seg[data-thin="1"] b { display: none; }
/* The majority line. A party past it wins outright even if everybody else
   combines, which is the one threshold on this screen worth marking. */
.vx-prez-major {
  position: absolute; top: -4px; bottom: -4px; left: 50%; width: 2px;
  background: repeating-linear-gradient(180deg, rgba(15, 26, 44, .55) 0 3px, transparent 3px 6px);
  pointer-events: none;
}
.vx-prez-legend {
  display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 11px;
  font-size: 11px; color: var(--muted);
}
.vx-prez-legend span { display: flex; align-items: center; gap: 6px; }
.vx-prez-legend i { width: 9px; height: 9px; border-radius: 3px; flex: none; }

/* The front-runner. One wide card, because the projected president is not just
   the first row of a list — it is the answer to the question the screen exists
   to ask. */
.vx-prez-spot {
  position: relative; display: grid; grid-template-columns: 210px 1fr auto;
  gap: 18px; align-items: stretch; overflow: hidden;
  border-radius: 18px; margin-bottom: 6px;
  background: linear-gradient(135deg, #fffdf6, #fff 52%);
  box-shadow: inset 0 0 0 1px rgba(200, 137, 26, .3), 0 16px 38px rgba(15, 26, 44, .1);
}
.vx-prez-spot-stage {
  position: relative; min-height: 208px;
  background:
    radial-gradient(70% 80% at 50% 4%, color-mix(in srgb, var(--side) 34%, transparent), transparent 72%),
    linear-gradient(180deg, #eef3fa, #dfe8f4);
}
.vx-prez-spot-body {
  display: flex; flex-direction: column; gap: 8px; justify-content: center;
  padding: 20px 4px 20px 0; min-width: 0;
}
.vx-prez-spot-tag {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  padding: 5px 10px; border-radius: 999px;
  font: 800 8.5px/1 inherit; letter-spacing: 1.6px; text-transform: uppercase;
  color: #3b2708; background: linear-gradient(180deg, #ffd77a, #f0a521);
  box-shadow: 0 4px 12px rgba(237, 160, 26, .4);
}
.vx-prez-spot-body h2 {
  margin: 0; font-size: 25px; font-weight: 800; letter-spacing: -.5px; overflow-wrap: anywhere;
}
.vx-prez-spot-aside {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 20px 22px 20px 0;
}

/* The share ring: a percentage drawn as a dial. \`--pct\` is set per render. */
.vx-prez-ring {
  position: relative; width: 104px; height: 104px; border-radius: 50%; flex: none;
  background: conic-gradient(var(--side) calc(var(--pct) * 1%), rgba(15, 26, 44, .09) 0);
}
.vx-prez-ring::after {
  content: ''; position: absolute; inset: 9px; border-radius: 50%; background: #fff;
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-ring b {
  position: absolute; inset: 0; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  letter-spacing: -1px; color: var(--ink);
  font: 800 25px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.vx-prez-ring small {
  position: absolute; left: 0; right: 0; bottom: 22px; z-index: 1; text-align: center;
  font-size: 8px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--faint);
}

/* --- the ballot ----------------------------------------------------------- */
.vx-prez-ballothead {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
}
.vx-prez-ballothead .vx-prez-rule { margin: 0; flex: 1; min-width: 150px; }
/* A miniature of the tab strip, for sorting the ballot. */
.vx-prez-sort {
  display: flex; gap: 2px; padding: 3px; border-radius: 10px;
  background: rgba(15, 26, 44, .055); box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-sortbtn {
  border: 0; border-radius: 8px; cursor: pointer; padding: 7px 11px; background: none;
  color: var(--muted); font: 800 9px/1 inherit; letter-spacing: 1.1px; text-transform: uppercase;
  transition: color .15s, background .15s;
}
.vx-prez-sortbtn:hover { color: var(--ink); }
.vx-prez-sortbtn[aria-pressed="true"] {
  color: var(--ink); background: #fff; box-shadow: 0 2px 6px rgba(15, 26, 44, .12);
}

.vx-prez-parties { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(324px, 1fr)); }
.vx-prez-party {
  position: relative; display: grid; grid-template-columns: 124px 1fr;
  border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 2px 4px rgba(15, 26, 44, .05), 0 12px 28px rgba(15, 26, 44, .07),
    inset 0 0 0 1px var(--line);
  transition: box-shadow .18s, transform .18s;
}
.vx-prez-party:hover {
  transform: translateY(-3px);
  box-shadow: 0 20px 42px rgba(15, 26, 44, .15),
    inset 0 0 0 1px color-mix(in srgb, var(--side) 55%, transparent);
}
.vx-prez-party[data-mine="1"] { box-shadow: 0 12px 28px rgba(15, 26, 44, .09), inset 0 0 0 2px rgba(240, 165, 33, .75); }
.vx-prez-party[data-incumbent="1"] { background: linear-gradient(180deg, #fffaef, #fff 46%); }
/* The party you have actually voted for. It is the one fact on this screen you
   own, so it gets a ring of its own rather than sharing the incumbent's. */
.vx-prez-party[data-voted="1"] {
  box-shadow: 0 14px 32px color-mix(in srgb, var(--side) 24%, transparent),
    inset 0 0 0 2px var(--side);
}
/* THE PLINTH FILLS THE CARD. It used to carry a fixed 156px inside a grid row
   that the promises column routinely made half as tall again, so every card had
   a white gap under its bust and a character standing in the top third of its
   own stage. A grid item stretches to its row by default; DROPPING the fixed
   height is the whole fix, and \`min-height\` only sets the floor for a card with
   very little in it. */
.vx-prez-stage {
  position: relative; min-height: 176px;
  background:
    radial-gradient(72% 84% at 50% 6%, color-mix(in srgb, var(--side) 30%, transparent), transparent 72%),
    linear-gradient(180deg, #eef3fa, #e1e9f5);
}
/* A soft contact shadow so a floating 3D bust looks like it is standing on the
   plinth rather than hovering above it. */
.vx-prez-stage::after {
  content: ''; position: absolute; left: 15%; right: 15%; bottom: 15px; height: 11px; border-radius: 50%;
  background: radial-gradient(50% 100% at 50% 50%, rgba(15, 26, 44, .24), transparent 72%);
}
.vx-prez-slot { position: absolute; inset: 8px 0 18px; z-index: 1; }
/* THE FALLBACK PORTRAIT. A browser hands out a limited number of WebGL contexts
   and the world, the icons and the character preview already spend several, so
   "no context to spare" is a state a real player can land in — and it used to
   present as a plinth that simply stayed empty forever. When the bust board
   cannot draw, this monogram medallion stands on the plinth instead, so there
   is always somebody on the card. */
.vx-prez-mug {
  position: absolute; left: 50%; top: 50%; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  width: 74px; height: 74px; border-radius: 50%; transform: translate(-50%, -58%);
  font: 800 30px/1 inherit; letter-spacing: -1px; color: #fff;
  background: linear-gradient(160deg, color-mix(in srgb, var(--side) 58%, #fff), var(--side));
  box-shadow: 0 12px 26px color-mix(in srgb, var(--side) 44%, transparent),
    inset 0 2px 0 rgba(255, 255, 255, .45);
}
/* Standing in the count: gold for the leader, plain for the rest. */
.vx-prez-rank {
  position: absolute; top: 9px; left: 9px; z-index: 2;
  display: flex; align-items: center; justify-content: center; min-width: 22px; height: 22px;
  padding: 0 6px; border-radius: 8px; color: #55657d; background: rgba(255, 255, 255, .92);
  font: 800 10px/1 inherit; letter-spacing: .4px;
  box-shadow: inset 0 0 0 1px var(--line), 0 3px 8px rgba(15, 26, 44, .12);
}
.vx-prez-rank[data-lead="1"] {
  color: #3b2708; background: linear-gradient(180deg, #ffd77a, #f0a521);
  box-shadow: 0 4px 12px rgba(237, 160, 26, .45);
}
/* How far behind the leader this party is. Absent on the leader itself. */
.vx-prez-gap {
  position: absolute; top: 9px; right: 9px; z-index: 2;
  padding: 4px 7px; border-radius: 7px; background: rgba(255, 255, 255, .92);
  font: 800 9px/1 inherit; letter-spacing: .3px; color: #b33b26;
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-sash {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 5px 6px; text-align: center;
  font: 800 8.5px/1.3 inherit; letter-spacing: 1.4px; text-transform: uppercase;
  color: #3b2708; background: linear-gradient(180deg, #ffd77a, #f0a521);
}
.vx-prez-info { display: flex; flex-direction: column; gap: 7px; padding: 13px 14px; min-width: 0; }
.vx-prez-pname { font-size: 15px; font-weight: 800; letter-spacing: -.2px; overflow-wrap: anywhere; }
.vx-prez-founder {
  display: flex; align-items: center; gap: 5px;
  font-size: 9.5px; letter-spacing: 1.5px; text-transform: uppercase;
  color: color-mix(in srgb, var(--side) 72%, #0f1826);
}
.vx-prez-slogan { font-size: 12px; font-style: italic; color: #4d5d75; overflow-wrap: anywhere; }
/* Promises as chips rather than a bulleted list: a platform is a set of things
   somebody stands for, and a set reads as chips. */
.vx-prez-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 1px; }
.vx-prez-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 5px 9px; border-radius: 999px;
  font-size: 10.5px; line-height: 1.35; color: #3f4f68;
  background: color-mix(in srgb, var(--side) 8%, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--side) 22%, transparent);
}
.vx-prez-chip i { color: var(--side); font-style: normal; display: flex; flex: none; }
.vx-prez-bar {
  position: relative; height: 8px; border-radius: 4px; overflow: hidden;
  background: rgba(15, 26, 44, .085);
}
.vx-prez-bar i {
  display: block; height: 100%; border-radius: 4px; transition: width .45s cubic-bezier(.4, 0, .2, 1);
  background: linear-gradient(90deg, color-mix(in srgb, var(--side) 55%, #fff), var(--side));
}
/* A slow sheen travelling the track — the only motion on the ballot, and it
   reads as "the count is live". */
.vx-prez-bar::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .6), transparent);
  animation: vx-prez-sheen 3.4s ease-in-out infinite;
}
@keyframes vx-prez-sheen { 0%, 58% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.vx-prez-tally { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; }
.vx-prez-votes { font-size: 11px; color: var(--faint); }
.vx-prez-actions { display: flex; gap: 6px; }
.vx-prez-empty {
  padding: 46px 24px; text-align: center; color: var(--faint); font-size: 12.5px; line-height: 1.65;
  border-radius: 14px; background: rgba(255, 255, 255, .6);
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-empty b { display: block; margin-bottom: 6px; color: var(--ink); font-size: 14px; }

/* --- forms ---------------------------------------------------------------- */
/* Standing for office is a two-column desk: the form on the left, the ballot
   card you are building on the right, updating as you type. Nobody should have
   to submit a party to find out what it looks like. */
.vx-prez-desk { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 22px; align-items: start; }
.vx-prez-form { display: flex; flex-direction: column; gap: 15px; }
.vx-prez-field { display: flex; flex-direction: column; gap: 6px; }
.vx-prez-field > label {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 9.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--muted);
}
.vx-prez-field > label span { color: var(--faint); letter-spacing: .4px; text-transform: none; font-size: 10px; }
.vx-prez-input, .vx-prez-area {
  width: 100%; padding: 11px 13px; border: 0; border-radius: 11px;
  font: 500 13px/1.55 inherit; color: var(--ink); background: #fff;
  box-shadow: inset 0 0 0 1px var(--line), inset 0 1px 2px rgba(15, 26, 44, .05);
  transition: box-shadow .15s;
}
.vx-prez-input::placeholder, .vx-prez-area::placeholder { color: #a7b3c4; }
.vx-prez-area { resize: vertical; min-height: 82px; }
.vx-prez-input:focus, .vx-prez-area:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--gold-lit), 0 0 0 3px rgba(240, 165, 33, .22);
}
.vx-prez-input:disabled, .vx-prez-area:disabled { color: #8593a7; background: #f4f7fb; }
.vx-prez-picks { display: grid; gap: 7px; }
.vx-prez-pick {
  display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-radius: 11px;
  cursor: pointer; font-size: 12px; line-height: 1.5; color: #3f4f68; background: #fff;
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow .15s, background .15s, transform .12s;
}
.vx-prez-pick:hover { transform: translateY(-1px); box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .2), 0 6px 16px rgba(15, 26, 44, .08); }
.vx-prez-pick[data-on="1"] {
  color: var(--ink); background: color-mix(in srgb, var(--side) 9%, #fff);
  box-shadow: inset 0 0 0 2px var(--side), 0 6px 16px color-mix(in srgb, var(--side) 22%, transparent);
}
.vx-prez-pick[data-full="1"]:not([data-on="1"]) { opacity: .45; cursor: not-allowed; }
.vx-prez-pick input { margin: 2px 0 0; accent-color: var(--gold-lit); }
.vx-prez-row { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }
.vx-prez-err { font-size: 11.5px; line-height: 1.5; color: #c0392b; min-height: 1.5em; }

/* --- administration ------------------------------------------------------- */
.vx-prez-panel {
  padding: 16px 18px; border-radius: 15px; margin-bottom: 14px; background: #fff;
  box-shadow: inset 0 0 0 1px var(--line), 0 8px 22px rgba(15, 26, 44, .06);
}
.vx-prez-panel h3 {
  display: flex; align-items: center; gap: 9px; margin: 0 0 5px;
  font-size: 11px; letter-spacing: 1.8px; text-transform: uppercase; color: var(--ink);
}
/* The little tinted glyph that gives each power of office a face. */
.vx-prez-panel h3 i {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 26px; height: 26px; border-radius: 9px; font-size: 13px; font-style: normal;
  color: color-mix(in srgb, var(--side) 78%, #0f1826);
  background: color-mix(in srgb, var(--side) 14%, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--side) 26%, transparent);
}
/* A trailing pill on a panel heading — the one number that panel is about. */
.vx-prez-panel h3 em {
  margin-left: auto; padding: 4px 9px; border-radius: 999px; font-style: normal;
  font-size: 9.5px; letter-spacing: 1.2px; color: var(--gold);
  background: rgba(240, 165, 33, .13);
}
.vx-prez-panel p { margin: 0 0 13px; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
.vx-prez-taxrow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.vx-prez-taxrow input[type="range"] { flex: 1; min-width: 190px; accent-color: var(--gold-lit); }
.vx-prez-taxval {
  min-width: 3.4ch; letter-spacing: -1px; color: var(--gold);
  font: 800 30px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
/* What the dial MEANS, in the only unit a player actually feels: how much of a
   stack they hand over. A percentage nobody can price is not a decision. */
.vx-prez-taxhint {
  display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px;
  font-size: 11px; color: var(--muted);
}
.vx-prez-taxhint b { color: var(--ink); font-variant-numeric: tabular-nums; }

.vx-prez-bill { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--muted); }
.vx-prez-billline { display: flex; justify-content: space-between; gap: 16px; }
.vx-prez-billline[data-short="1"] { color: #c0392b; font-weight: 700; }

/* --- the kit workshop ----------------------------------------------------- */
/* The loadout is edited in the SHAPE IT WILL ARRIVE IN: four armor slots down
   the side, nine hotbar slots across the bottom, exactly like the inventory the
   recruit opens ten seconds later. Editing a kit as a list of lines is how you
   ship a kit nobody can picture. */
.vx-prez-kit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.vx-prez-mannequin {
  display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center;
  padding: 15px; border-radius: 14px;
  background: linear-gradient(180deg, #fbfdff, #eef3fa);
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-armorcol { display: flex; flex-direction: column; gap: 6px; }
.vx-prez-hotbar { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.vx-prez-kitfoot { margin-top: 12px; }
/* One slot in the workshop: an inventory square that also takes a click. */
.vx-prez-slotbtn {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 46px; height: 46px; padding: 0; border: 0; border-radius: 10px; cursor: pointer;
  background: linear-gradient(180deg, #fff, #eef3fa);
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .12);
  transition: box-shadow .14s, transform .12s, background .14s;
}
.vx-prez-slotbtn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: inset 0 0 0 2px var(--side), 0 6px 16px rgba(15, 26, 44, .12);
}
.vx-prez-slotbtn:disabled { cursor: default; }
.vx-prez-slotbtn[data-armed="1"] {
  background: color-mix(in srgb, var(--gold-lit) 16%, #fff);
  box-shadow: inset 0 0 0 2px var(--gold-lit), 0 6px 16px rgba(240, 165, 33, .3);
}
.vx-prez-slotbtn[data-empty="1"] canvas { display: none; }
.vx-prez-slotbtn canvas { width: 32px; height: 32px; image-rendering: pixelated; }
.vx-prez-slotbtn u {
  position: absolute; right: 3px; bottom: 1px; text-decoration: none;
  font: 800 10px/1 inherit; color: var(--ink); text-shadow: 0 1px 0 #fff;
}
/* The ghost glyph in an empty armor slot, so the four squares read as helmet,
   chest, legs, boots rather than as four identical holes. */
.vx-prez-slotbtn s {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  text-decoration: none; font-size: 15px; color: rgba(15, 26, 44, .2);
}
.vx-prez-slotbtn[data-empty="0"] s { display: none; }

.vx-prez-pocket {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr));
  gap: 6px; max-height: 210px; overflow-y: auto;
  padding: 11px; border-radius: 14px;
  background: linear-gradient(180deg, #fbfdff, #eef3fa);
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-kitstat {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 9px;
  margin-bottom: 12px;
}

/* The seat you do not hold. A hazard-taped card in place of the controls, so
   "you are not the president" is a STATE you can see rather than a row of dead
   buttons you have to poke to discover. */
.vx-prez-locked {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: 46px 1fr; gap: 15px; align-items: start;
  padding: 17px 19px; border-radius: 15px; margin-bottom: 14px;
  background:
    repeating-linear-gradient(135deg, rgba(240, 165, 33, .1) 0 11px, rgba(240, 165, 33, .028) 11px 22px),
    #fff;
  box-shadow: inset 0 0 0 1px rgba(200, 137, 26, .32), 0 8px 22px rgba(15, 26, 44, .06);
}
.vx-prez-locked-mark {
  display: flex; align-items: center; justify-content: center; width: 46px; height: 46px;
  border-radius: 14px; font-size: 21px; color: var(--gold); background: #fff;
  box-shadow: inset 0 0 0 1px rgba(200, 137, 26, .35), 0 4px 12px rgba(200, 137, 26, .16);
}
.vx-prez-locked h4 {
  margin: 3px 0 5px; font-size: 11px; letter-spacing: 1.7px; text-transform: uppercase; color: var(--gold);
}
.vx-prez-locked p { margin: 0 0 12px; font-size: 12px; line-height: 1.6; color: #3f4f68; }
.vx-prez-locked p:last-child { margin-bottom: 0; }
.vx-prez-locked b { color: var(--ink); }

/* --- treasury ------------------------------------------------------------- */
.vx-prez-vault {
  display: grid; grid-template-columns: repeat(9, 1fr); gap: 6px; max-width: 480px;
  padding: 11px; border-radius: 15px; background: #fff;
  box-shadow: inset 0 0 0 1px var(--line), 0 8px 22px rgba(15, 26, 44, .06);
}
.vx-prez-ledger { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 15px; }
.vx-prez-led {
  padding: 13px 15px; border-radius: 14px; background: #fff;
  box-shadow: inset 0 0 0 1px var(--line), 0 8px 22px rgba(15, 26, 44, .06);
}
.vx-prez-led b {
  display: block; letter-spacing: -.6px; color: var(--ink);
  font: 800 23px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.vx-prez-led small {
  display: block; margin-top: 5px; font-size: 8.5px; letter-spacing: 1.3px;
  text-transform: uppercase; color: var(--faint);
}
.vx-prez-led[data-tone="bad"] b { color: #c0392b; }

/* The hoard as it actually stands in the world: eight pedestals in a ring
   around the flag. Reading the panel and walking the ring should be the same
   act, so the panel is drawn as the ring. */
.vx-prez-ring-map {
  position: relative; width: 100%; max-width: 320px; aspect-ratio: 1;
  margin: 4px auto 0; border-radius: 50%;
  background:
    radial-gradient(closest-side, color-mix(in srgb, var(--side) 12%, #fff) 62%, transparent 63%),
    conic-gradient(from 0deg, color-mix(in srgb, var(--side) 16%, transparent), transparent 40%,
      color-mix(in srgb, var(--side) 16%, transparent));
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-prez-ring-pole {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  font-size: 9px; letter-spacing: 1.3px; text-transform: uppercase; color: var(--faint);
}
.vx-prez-ring-pole i { font-size: 22px; color: var(--side); font-style: normal; }
.vx-prez-ring-ped {
  position: absolute; transform: translate(-50%, -50%);
  display: flex; align-items: center; justify-content: center;
  width: 46px; height: 46px; border-radius: 12px;
  background: #fff; box-shadow: inset 0 0 0 1px var(--line), 0 5px 14px rgba(15, 26, 44, .12);
}
.vx-prez-ring-ped canvas { width: 30px; height: 30px; image-rendering: pixelated; }
.vx-prez-ring-ped[data-empty="1"] { opacity: .34; }
.vx-prez-ring-ped u {
  position: absolute; right: 2px; bottom: 0; text-decoration: none;
  font: 800 9.5px/1 inherit; color: var(--ink);
}

@media (max-width: 900px) {
  .vx-prez-desk, .vx-prez-kit { grid-template-columns: 1fr; }
  .vx-prez-spot { grid-template-columns: 170px 1fr; }
  .vx-prez-spot-aside { grid-column: 1 / -1; flex-direction: row; justify-content: flex-start; padding: 0 20px 18px; }
}
@media (max-width: 720px) {
  .vx-prez-shell { height: 100%; border-radius: 0; }
  .vx-prez-head { padding: 14px 16px 10px; }
  .vx-prez-tabs { margin: 0 16px; }
  .vx-prez-tab { letter-spacing: .8px; padding: 10px 6px; }
  .vx-prez-body { padding: 14px 16px 20px; }
  .vx-prez-party, .vx-prez-spot { grid-template-columns: 1fr; }
  .vx-prez-stage, .vx-prez-spot-stage { min-height: 186px; }
  .vx-prez-vault { grid-template-columns: repeat(5, 1fr); }
  .vx-prez-hotbar { grid-template-columns: repeat(5, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .vx-prez-bar::after { animation: none; display: none; }
  .vx-prez-party, .vx-prez-pick, .vx-prez-slotbtn { transition: none; }
}
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  injectGovStyle();
  const el = document.createElement('style');
  el.id = 'vx-prez-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

type View = 'election' | 'candidacy' | 'admin' | 'treasury';
/** How the ballot below the spotlight is ordered. */
type Sort = 'standing' | 'newest' | 'name';

export interface GovernActions {
  onFoundParty: (name: string, slogan: string, promises: number[]) => void;
  onDisbandParty: () => void;
  onVote: (partyId: string) => void;
  onBroadcast: (text: string) => void;
  onSetTax: (rate: number) => void;
  /** Rewrite the recruit loadout (4 armor slots then 9 hotbar slots). */
  onSetKit: (slots: KitLoadout) => void;
  /** `source` says which purse pays — the treasury, or the president's pockets. */
  onFundKits: (count: number, source: 'treasury' | 'inventory') => void;
  onClaimKit: () => void;
}

export interface GovernData {
  state: PoliticsState;
  faction: number;
  username: string;
  /** Your faction's treasury contents (server-sent; empty while unpledged). */
  treasury: (ItemStack | null)[];
  /** What YOU are carrying — the shelf the kit workshop builds a loadout from,
   *  and the purse the "fund from my pockets" button spends. */
  pocket: (ItemStack | null)[];
  /** Avatars for the party founders who are currently online. */
  cosmeticsOf: (username: string) => Cosmetics | undefined;
  atlasCanvas: HTMLCanvasElement;
  kitClaimed: boolean;
}

/** A panel heading with its own tinted glyph, and optionally the one number
 *  that panel is about. Every power of office gets a face so the Administration
 *  tab scans as three things rather than one wall. */
function panelHead(icon: IconName, label: string, badge?: string): HTMLElement {
  const h = document.createElement('h3');
  const mark = document.createElement('i');
  mark.innerHTML = iconSvg(icon);
  const text = document.createElement('span');
  text.textContent = label;
  h.append(mark, text);
  if (badge) {
    const em = document.createElement('em');
    em.textContent = badge;
    h.appendChild(em);
  }
  return h;
}

/** A section rule with a label — the chapter headings inside one view. */
function sectionRule(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vx-prez-rule';
  el.textContent = label;
  return el;
}

/** One big number with a caption. The ledger unit, used on three views. */
function statCard(value: string, label: string, tone?: 'bad'): HTMLElement {
  const led = document.createElement('div');
  led.className = 'vx-prez-led';
  if (tone) led.dataset.tone = tone;
  const b = document.createElement('b');
  b.textContent = value;
  const small = document.createElement('small');
  small.textContent = label;
  led.append(b, small);
  return led;
}

/** "3d 4h" / "6h 12m" / "48m" — a term countdown people can read at a glance. */
function untilText(ms: number): string {
  const s = Math.max(0, ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/**
 * A distinct-but-on-side tint for the `i`th party on the projection strip.
 *
 * Everything on this screen is meant to read as belonging to your faction, so
 * segments are not arbitrary colours: the faction's own hue is walked in both
 * directions and up and down in lightness, which keeps twelve parties legibly
 * apart while every one of them still looks like your side.
 */
function partyTint(base: number, i: number): string {
  const r = ((base >> 16) & 255) / 255, g = ((base >> 8) & 255) / 255, b = (base & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  // Alternate sides of the base hue so neighbouring segments never collide.
  const swing = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 17;
  const lift = ((i % 3) - 1) * 9;
  return `hsl(${(h + swing + 360) % 360} ${Math.round(Math.min(0.9, s) * 100)}% `
    + `${Math.round(Math.max(0.28, Math.min(0.68, l)) * 100 + lift)}%)`;
}

/** The monogram shown on a plinth when the bust board cannot draw. */
function initialOf(name: string): string {
  const ch = [...(name || '?')].find((c) => /\S/.test(c));
  return (ch ?? '?').toUpperCase();
}

export class PresidentUI {
  private readonly surface: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly crest: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly clockValue: HTMLElement;
  private readonly clockLabel: HTMLElement;
  /** Term-progress fill inside the countdown pill. */
  private readonly clockFill: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly body: HTMLElement;
  /** The positioned box the body scrolls in and the bust canvas covers. */
  private readonly viewport: HTMLElement;
  private isOpen = false;
  private view: View = 'election';
  private data: GovernData | null = null;
  private actions: GovernActions | null = null;
  /** Draft candidacy, kept across re-renders so an incoming politics sync never
   *  wipes what somebody is halfway through typing. */
  private draft = { name: '', slogan: '', promises: new Set<number>() };
  private draftBroadcast = '';
  private draftTax: number | null = null;
  private draftKits = 5;
  /** The loadout being edited, or null while it simply mirrors the government's.
   *  Kept across re-renders for the same reason the party draft is. */
  private draftKit: KitLoadout | null = null;
  /** Which pocket stack is armed to be placed into the next slot clicked. */
  private armedItem: number | null = null;
  private sort: Sort = 'standing';
  private error = '';
  private clockTimer = 0;

  onOpen?: () => void;
  onClose?: () => void;

  constructor(host: HTMLElement) {
    injectStyle();
    this.surface = document.createElement('div');
    this.surface.className = 'vx-gov-surface vx-prez-surface';
    // The daylight skin. `gov_ui.ts` keys its light overrides off this, so the
    // allegiance pledge — same classes, same stylesheet — stays on slate.
    this.surface.dataset.theme = 'light';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Faction government');
    this.surface.tabIndex = -1;
    this.surface.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });
    this.surface.addEventListener('mousedown', (e) => {
      if (e.target === this.surface) this.hide();
    });

    this.shell = document.createElement('div');
    this.shell.className = 'vx-prez-shell';

    const head = document.createElement('div');
    head.className = 'vx-prez-head';
    this.crest = document.createElement('div');
    this.crest.className = 'vx-prez-crest';
    this.crest.innerHTML = iconSvg('crown');
    const titles = document.createElement('div');
    titles.className = 'vx-prez-titles';
    this.eyebrow = document.createElement('div');
    this.eyebrow.className = 'vx-gov-eyebrow';
    this.title = document.createElement('h1');
    titles.append(this.eyebrow, this.title);
    const clock = document.createElement('div');
    clock.className = 'vx-prez-clock';
    this.clockValue = document.createElement('b');
    this.clockLabel = document.createElement('small');
    this.clockLabel.textContent = 'Until the vote';
    // How much of the term has already run. A countdown alone tells you when;
    // the bar tells you where in the term you are without doing the arithmetic.
    const clockTrack = document.createElement('div');
    clockTrack.className = 'vx-prez-clockbar';
    this.clockFill = document.createElement('i');
    clockTrack.appendChild(this.clockFill);
    clock.append(this.clockValue, this.clockLabel, clockTrack);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vx-gov-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hide());
    head.append(this.crest, titles, clock, close);

    this.tabs = document.createElement('div');
    this.tabs.className = 'vx-prez-tabs';
    this.tabs.setAttribute('role', 'tablist');

    // `body` scrolls inside a positioned viewport, and the shared bust canvas is
    // stretched over that same viewport — so a party card scrolled out of view
    // takes its bust with it instead of painting over the tabs. Only `body`'s
    // CHILDREN are replaced; the viewport and the scroller are permanent, which
    // is what stops a re-render from orphaning the renderer's canvas.
    this.viewport = document.createElement('div');
    this.viewport.className = 'vx-gov-viewport';
    const scroll = document.createElement('div');
    scroll.className = 'vx-gov-scroll';
    this.body = document.createElement('div');
    this.body.className = 'vx-prez-body';
    scroll.appendChild(this.body);
    this.viewport.appendChild(scroll);

    this.shell.append(head, this.tabs, this.viewport);
    this.surface.appendChild(this.shell);
    host.appendChild(this.surface);
  }

  get open(): boolean { return this.isOpen; }

  show(data: GovernData, actions: GovernActions, view: View = 'election'): void {
    this.data = data;
    this.actions = actions;
    this.view = view;
    this.error = '';
    if (!this.isOpen) {
      this.isOpen = true;
      this.surface.dataset.open = '1';
      this.onOpen?.();
      // The term countdown is the only thing on this screen that moves on its
      // own, and it only needs to move once a second.
      this.clockTimer = window.setInterval(() => this.renderClock(), 1000);
    }
    bustStage.attach(this.viewport);
    this.render();
    this.surface.focus();
  }

  /** A politics sync arrived while the screen is up. */
  update(data: GovernData): void {
    this.data = data;
    if (this.isOpen) this.render();
  }

  /** The server refused something — shown in place, not as a world toast. */
  setError(reason: string): void {
    this.error = reason;
    if (this.isOpen) this.render();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    delete this.surface.dataset.open;
    window.clearInterval(this.clockTimer);
    hideTip();
    bustStage.release(this.viewport);
    this.onClose?.();
  }

  private setView(view: View): void {
    this.view = view;
    this.error = '';
    this.render();
  }

  private renderClock(): void {
    const data = this.data;
    const e = data && electionOf(data.state, data.faction);
    if (!e) {
      this.clockValue.textContent = '—';
      this.clockFill.style.width = '0%';
      return;
    }
    const left = e.endsAt - Date.now();
    this.clockValue.textContent = untilText(left);
    // Elapsed, not remaining: the bar fills as the term is spent.
    const spent = Math.max(0, Math.min(1, 1 - left / TERM_MS));
    this.clockFill.style.width = `${(spent * 100).toFixed(1)}%`;
  }

  private render(): void {
    const data = this.data;
    if (!data) return;
    const e = electionOf(data.state, data.faction);
    const g = governmentOf(data.state, data.faction);
    const side = `#${factionColor(data.faction).toString(16).padStart(6, '0')}`;
    this.shell.style.setProperty('--side', side);

    this.eyebrow.textContent = isFaction(data.faction)
      ? `${factionName(data.faction)} · Term ${e?.cycle ?? 1}` : 'No faction';
    this.title.textContent = e?.president
      ? `President ${e.president}` : 'The seat is vacant';
    this.renderClock();

    // Tabs. The dots mark the two things a citizen can act on the moment they
    // open the menu, so neither is buried behind a tab they had no reason to try.
    const unvoted = !!e && !!e.parties.length && !ballotOf(e, data.username);
    const kitWaiting = !!g && g.kitStock > 0 && !data.kitClaimed;
    this.tabs.replaceChildren();
    const views: [View, string, boolean][] = [
      ['election', 'Election', unvoted],
      ['candidacy', 'Stand', false],
      ['admin', 'Administration', kitWaiting],
      ['treasury', 'Treasury', false],
    ];
    for (const [id, label, dot] of views) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'vx-prez-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(this.view === id));
      if (dot && this.view !== id) tab.dataset.dot = '1';
      tab.textContent = label;
      tab.addEventListener('click', () => this.setView(id));
      this.tabs.appendChild(tab);
    }

    this.body.replaceChildren();
    if (!e || !g || !isFaction(data.faction)) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      const head = document.createElement('b');
      head.textContent = 'You have not sworn allegiance';
      empty.append(head,
        'Press Play and choose a side. A citizen gets a vote, a treasury and the '
        + 'right to stand for office; nobody else gets any of the three.');
      this.body.appendChild(empty);
      bustStage.setRoster([]);
      return;
    }

    if (this.error) {
      const err = document.createElement('div');
      err.className = 'vx-prez-note';
      err.dataset.tone = 'bad';
      err.textContent = this.error;
      this.body.appendChild(err);
    }

    switch (this.view) {
      case 'election': this.renderElection(data); break;
      case 'candidacy': this.renderCandidacy(data); break;
      case 'admin': this.renderAdmin(data); break;
      case 'treasury': this.renderTreasury(data); break;
    }
  }

  // --- the race ---------------------------------------------------------------

  /**
   * Party ids ordered exactly the way `tallyElection` would resolve them: most
   * votes first, and a draw going to whichever party stood EARLIEST. Every
   * ranking on this screen — the strip, the spotlight, the medals, the gaps —
   * reads off this one list, so the panel cannot rank the race differently from
   * the count that decides it.
   */
  private standingsOf(e: Election, counts: Record<string, number>): Party[] {
    return [...e.parties].sort((a, b) =>
      (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.createdAt - b.createdAt);
  }

  private renderElection(data: GovernData): void {
    const e = electionOf(data.state, data.faction)!;
    const counts = voteCounts(e);
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    const myBallot = ballotOf(e, data.username);
    const standings = this.standingsOf(e, counts);
    const busts: BustEntry[] = [];
    const side = factionColor(data.faction);
    const tintOf = new Map(standings.map((p, i) => [p.id, partyTint(side, i)]));

    if (!e.parties.length) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      const head = document.createElement('b');
      head.textContent = 'Nobody is standing';
      empty.append(head,
        'The ballot is blank and the seat will stay exactly as it is when the term '
        + 'runs out. Open “Stand” and put your own name on it — an unopposed party '
        + 'wins on a single vote.');
      const row = document.createElement('div');
      row.className = 'vx-prez-row';
      row.style.justifyContent = 'center';
      row.style.marginTop = '16px';
      const stand = document.createElement('button');
      stand.type = 'button';
      stand.className = 'vx-gov-btn';
      stand.dataset.kind = 'primary';
      stand.textContent = 'Stand for election';
      stand.addEventListener('click', () => this.setView('candidacy'));
      row.appendChild(stand);
      this.body.append(empty, row);
      bustStage.setRoster([]);
      return;
    }

    // --- the projection strip -------------------------------------------------
    this.body.appendChild(this.buildRaceStrip(e, standings, counts, total, tintOf));

    // --- the front-runner -----------------------------------------------------
    const leader = standings[0];
    if (total > 0 && leader) {
      this.body.appendChild(sectionRule('Projected to take office'));
      this.body.appendChild(this.buildSpotlight(
        data, e, leader, standings[1] ?? null, counts, total, myBallot, busts));
    }

    // --- the ballot -----------------------------------------------------------
    const head = document.createElement('div');
    head.className = 'vx-prez-ballothead';
    head.appendChild(sectionRule(total > 0 ? 'The rest of the ballot' : 'On the ballot'));
    head.appendChild(this.buildSortControl());
    this.body.appendChild(head);

    const listed = this.orderFor(standings)
      .filter((p) => !(total > 0 && leader && p.id === leader.id));

    const wrap = document.createElement('div');
    wrap.className = 'vx-prez-parties';
    if (!listed.length) {
      const only = document.createElement('div');
      only.className = 'vx-prez-empty';
      only.textContent = 'Nobody else is standing. This party takes the seat unopposed '
        + 'unless somebody else puts their name forward before the count.';
      wrap.appendChild(only);
    }
    for (const party of listed) {
      wrap.appendChild(this.buildPartyCard(
        data, e, party, counts, total, myBallot, standings, tintOf, busts));
    }
    this.body.appendChild(wrap);

    // Slots must be in the document before the board measures their boxes.
    bustStage.setRoster(busts);
  }

  /** The whole ballot as one segmented bar, plus turnout and the majority mark. */
  private buildRaceStrip(
    e: Election, standings: Party[], counts: Record<string, number>,
    total: number, tintOf: Map<string, string>
  ): HTMLElement {
    const race = document.createElement('div');
    race.className = 'vx-prez-race';

    const head = document.createElement('div');
    head.className = 'vx-prez-racehead';
    const h3 = document.createElement('h3');
    h3.textContent = total > 0 ? 'The count so far' : 'The count has not started';
    const sub = document.createElement('span');
    sub.textContent = total > 0
      ? `${total} vote${total === 1 ? '' : 's'} cast · ${e.parties.length} part`
        + `${e.parties.length === 1 ? 'y' : 'ies'} standing`
      : `${e.parties.length} part${e.parties.length === 1 ? 'y' : 'ies'} standing · `
        + 'the first vote decides the lead';
    head.append(h3, sub);
    race.appendChild(head);

    const strip = document.createElement('div');
    strip.className = 'vx-prez-strip';
    if (total > 0) {
      for (const party of standings) {
        const n = counts[party.id] ?? 0;
        if (n <= 0) continue;
        const pct = (n / total) * 100;
        const seg = document.createElement('div');
        seg.className = 'vx-prez-seg';
        seg.style.width = `${pct}%`;
        seg.style.background = tintOf.get(party.id) ?? '#888';
        if (pct < 11) seg.dataset.thin = '1';
        const b = document.createElement('b');
        b.textContent = `${Math.round(pct)}%`;
        seg.appendChild(b);
        // Player-authored: the tooltip writes it as text, never as markup.
        seg.addEventListener('mousemove', (ev) => showTip(
          ev, party.name, `${party.founder} · ${n} vote${n === 1 ? '' : 's'}`,
          govThemeOf(seg)));
        seg.addEventListener('mouseleave', hideTip);
        strip.appendChild(seg);
      }
      const major = document.createElement('div');
      major.className = 'vx-prez-major';
      strip.appendChild(major);
    }
    race.appendChild(strip);

    const legend = document.createElement('div');
    legend.className = 'vx-prez-legend';
    if (total > 0) {
      for (const party of standings.slice(0, 6)) {
        const n = counts[party.id] ?? 0;
        if (n <= 0) continue;
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.background = tintOf.get(party.id) ?? '#888';
        const label = document.createElement('span');
        label.textContent = `${party.name} · ${n}`;   // player-authored: text node
        item.append(swatch, label);
        legend.appendChild(item);
      }
    } else {
      const hint = document.createElement('span');
      hint.textContent = 'One vote each, counted when the term runs out. A draw goes to '
        + 'whichever party stood first.';
      legend.appendChild(hint);
    }
    race.appendChild(legend);
    return race;
  }

  /** The front-runner, given the room the answer deserves. */
  private buildSpotlight(
    data: GovernData, e: Election, party: Party, runnerUp: Party | null,
    counts: Record<string, number>, total: number, myBallot: string | null,
    busts: BustEntry[]
  ): HTMLElement {
    const votes = counts[party.id] ?? 0;
    const card = document.createElement('div');
    card.className = 'vx-prez-spot';

    const stage = document.createElement('div');
    stage.className = 'vx-prez-spot-stage';
    const slot = document.createElement('div');
    slot.className = 'vx-prez-slot';
    stage.appendChild(slot);
    this.mountBust(data, `prez:${party.id}`, party.founder, slot, stage, 0, busts);
    if (party.id === e.presidentPartyId) {
      const sash = document.createElement('div');
      sash.className = 'vx-prez-sash';
      sash.textContent = 'In office';
      stage.appendChild(sash);
    }

    const body = document.createElement('div');
    body.className = 'vx-prez-spot-body';
    const tag = document.createElement('span');
    tag.className = 'vx-prez-spot-tag';
    tag.innerHTML = iconSvg('crown');
    const tagText = document.createElement('span');
    tagText.textContent = party.id === e.presidentPartyId
      ? 'Incumbent · leading' : 'Would take the seat';
    tag.appendChild(tagText);
    const name = document.createElement('h2');
    name.textContent = party.name;
    const founder = document.createElement('div');
    founder.className = 'vx-prez-founder';
    founder.innerHTML = iconSvg('statue');
    const founderName = document.createElement('span');
    founderName.textContent = party.founder;
    founder.appendChild(founderName);
    const slogan = document.createElement('div');
    slogan.className = 'vx-prez-slogan';
    slogan.textContent = `“${party.slogan}”`;
    body.append(tag, name, founder, slogan);
    if (party.promises.length) body.appendChild(this.buildPromiseChips(party.promises));

    const lead = document.createElement('div');
    lead.className = 'vx-prez-votes';
    const margin = runnerUp ? votes - (counts[runnerUp.id] ?? 0) : votes;
    lead.textContent = runnerUp
      ? `${votes} vote${votes === 1 ? '' : 's'} — ${margin === 0
        ? 'level with the runner-up, and ahead only because they stood first'
        : `${margin} ahead of ${runnerUp.name}`}`
      : `${votes} vote${votes === 1 ? '' : 's'}, unopposed on the count`;
    body.appendChild(lead);

    const aside = document.createElement('div');
    aside.className = 'vx-prez-spot-aside';
    const ring = document.createElement('div');
    ring.className = 'vx-prez-ring';
    const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
    ring.style.setProperty('--pct', String(pct));
    const ringValue = document.createElement('b');
    ringValue.textContent = `${pct}%`;
    const ringLabel = document.createElement('small');
    ringLabel.textContent = 'of the vote';
    ring.append(ringValue, ringLabel);
    aside.appendChild(ring);
    aside.appendChild(this.buildVoteButton(party, myBallot));
    card.append(stage, body, aside);
    return card;
  }

  /** Promises as chips — a platform is a set, and a set reads as chips. */
  private buildPromiseChips(promises: readonly number[]): HTMLElement {
    const chips = document.createElement('div');
    chips.className = 'vx-prez-chips';
    for (const i of promises) {
      const chip = document.createElement('div');
      chip.className = 'vx-prez-chip';
      const tick = document.createElement('i');
      tick.innerHTML = iconSvg('check');
      const text = document.createElement('span');
      text.textContent = PRESET_PROMISES[i] ?? '';
      chip.append(tick, text);
      chips.appendChild(chip);
    }
    return chips;
  }

  /** The one button that changes the outcome. Shared by card and spotlight so
   *  the wording can never drift between them. */
  private buildVoteButton(party: Party, myBallot: string | null): HTMLElement {
    const vote = document.createElement('button');
    vote.type = 'button';
    vote.className = 'vx-gov-btn';
    const isMine = myBallot === party.id;
    if (!isMine) vote.dataset.kind = 'primary';
    vote.textContent = isMine ? 'Your vote' : myBallot ? 'Switch to this' : 'Vote';
    vote.disabled = isMine;
    vote.addEventListener('click', () => this.actions?.onVote(party.id));
    return vote;
  }

  /** Park a live bust on a plinth, or a monogram medallion when the board has no
   *  context to draw with. Either way the plinth is never left empty. */
  private mountBust(
    data: GovernData, key: string, founder: string, slot: HTMLElement,
    stage: HTMLElement, index: number, busts: BustEntry[]
  ): void {
    if (!bustStage.available) {
      const mug = document.createElement('div');
      mug.className = 'vx-prez-mug';
      mug.textContent = initialOf(founder);
      slot.appendChild(mug);
      return;
    }
    busts.push({
      key,
      cosmetics: sanitizeCosmetics(data.cosmeticsOf(founder), skinSeed(founder)),
      slot,
      pose: BUST_POSES[index % BUST_POSES.length],
    });
    stage.addEventListener('mouseenter', () => bustStage.setHover(key));
    stage.addEventListener('mouseleave', () => bustStage.setHover(null));
  }

  private buildSortControl(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vx-prez-sort';
    const options: [Sort, string][] = [
      ['standing', 'Standing'], ['newest', 'Newest'], ['name', 'A–Z'],
    ];
    for (const [id, label] of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vx-prez-sortbtn';
      btn.setAttribute('aria-pressed', String(this.sort === id));
      btn.textContent = label;
      btn.addEventListener('click', () => { this.sort = id; this.render(); });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  /** The ballot in whichever order the reader asked for. `standings` is already
   *  the count's own order, so "Standing" is a pass-through rather than a
   *  second, subtly different sort. */
  private orderFor(standings: Party[]): Party[] {
    if (this.sort === 'standing') return standings;
    const list = [...standings];
    if (this.sort === 'newest') list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  private buildPartyCard(
    data: GovernData, e: Election, party: Party, counts: Record<string, number>,
    total: number, myBallot: string | null, standings: Party[],
    tintOf: Map<string, string>, busts: BustEntry[]
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'vx-prez-party';
    if (party.founder.toLowerCase() === data.username.toLowerCase()) card.dataset.mine = '1';
    if (party.id === e.presidentPartyId) card.dataset.incumbent = '1';
    if (myBallot === party.id) card.dataset.voted = '1';

    const place = standings.findIndex((p) => p.id === party.id) + 1;
    const votes = counts[party.id] ?? 0;

    const stage = document.createElement('div');
    stage.className = 'vx-prez-stage';
    const slot = document.createElement('div');
    slot.className = 'vx-prez-slot';
    stage.appendChild(slot);
    this.mountBust(data, `prez:${party.id}`, party.founder, slot, stage, place, busts);

    // Standing in the count. Only meaningful once a ballot has been cast, so
    // an untouched election shows plinths rather than a fake leaderboard.
    if (total > 0) {
      const rank = document.createElement('div');
      rank.className = 'vx-prez-rank';
      if (place === 1) rank.dataset.lead = '1';
      rank.textContent = `#${place}`;
      stage.appendChild(rank);
      const leadVotes = counts[standings[0].id] ?? 0;
      if (place > 1 && leadVotes > votes) {
        const gap = document.createElement('div');
        gap.className = 'vx-prez-gap';
        gap.textContent = `−${leadVotes - votes}`;
        stage.appendChild(gap);
      }
    }
    if (party.id === e.presidentPartyId) {
      const sash = document.createElement('div');
      sash.className = 'vx-prez-sash';
      sash.textContent = 'In office';
      stage.appendChild(sash);
    }

    const info = document.createElement('div');
    info.className = 'vx-prez-info';
    const pname = document.createElement('div');
    pname.className = 'vx-prez-pname';
    pname.textContent = party.name;
    const founder = document.createElement('div');
    founder.className = 'vx-prez-founder';
    founder.innerHTML = iconSvg('statue');
    const founderName = document.createElement('span');
    founderName.textContent = party.founder;
    founder.appendChild(founderName);
    const slogan = document.createElement('div');
    slogan.className = 'vx-prez-slogan';
    slogan.textContent = `“${party.slogan}”`;
    info.append(pname, founder, slogan);
    if (party.promises.length) info.appendChild(this.buildPromiseChips(party.promises));

    const bar = document.createElement('div');
    bar.className = 'vx-prez-bar';
    const fill = document.createElement('i');
    fill.style.width = `${total > 0 ? Math.round(votes / total * 100) : 0}%`;
    // The bar wears the same tint as this party's segment on the strip above,
    // so the two readings of the same number are visibly the same number.
    const tint = tintOf.get(party.id);
    if (tint) fill.style.background = tint;
    bar.appendChild(fill);

    const tally = document.createElement('div');
    tally.className = 'vx-prez-tally';
    const label = document.createElement('span');
    label.className = 'vx-prez-votes';
    label.textContent = `${votes} vote${votes === 1 ? '' : 's'}`
      + (total > 0 ? ` · ${Math.round(votes / total * 100)}%` : '');
    const actions = document.createElement('div');
    actions.className = 'vx-prez-actions';
    actions.appendChild(this.buildVoteButton(party, myBallot));
    tally.append(label, actions);

    info.append(bar, tally);
    card.append(stage, info);
    return card;
  }

  // --- standing for office ---------------------------------------------------

  private renderCandidacy(data: GovernData): void {
    const e = electionOf(data.state, data.faction)!;
    const mine = partyOfFounder(e, data.username);

    if (mine) {
      bustStage.setRoster([]);
      const note = document.createElement('div');
      note.className = 'vx-prez-note';
      const strong = document.createElement('b');
      strong.textContent = mine.name;
      note.append('You lead ', strong, `. “${mine.slogan}”. `,
        'One party per citizen — withdraw this one if you want to stand on something else. '
        + 'Any votes cast for it are released, not lost.');
      const row = document.createElement('div');
      row.className = 'vx-prez-row';
      row.style.marginTop = '12px';
      const disband = document.createElement('button');
      disband.type = 'button';
      disband.className = 'vx-gov-btn';
      disband.dataset.kind = 'danger';
      disband.textContent = 'Withdraw my party';
      disband.addEventListener('click', () => this.actions?.onDisbandParty());
      row.appendChild(disband);
      this.body.append(note, row);
      return;
    }

    const note = document.createElement('div');
    note.className = 'vx-prez-note';
    note.textContent = 'Everything you write here goes on the ballot under your own name. '
      + 'The card on the right is exactly what the faction will see.';
    this.body.appendChild(note);

    const desk = document.createElement('div');
    desk.className = 'vx-prez-desk';
    const form = document.createElement('div');
    form.className = 'vx-prez-form';

    // The live preview is rebuilt in place on every keystroke; only its own
    // subtree is replaced, so nothing else on the desk flickers.
    const previewHost = document.createElement('div');
    const busts: BustEntry[] = [];
    const refreshPreview = (): void => {
      previewHost.replaceChildren();
      busts.length = 0;
      previewHost.appendChild(sectionRule('How it will look on the ballot'));
      previewHost.appendChild(this.buildPreviewCard(data, busts));
      bustStage.setRoster(busts);
    };

    const nameField = document.createElement('div');
    nameField.className = 'vx-prez-field';
    const nameLabel = document.createElement('label');
    const nameLabelText = document.createElement('span');
    nameLabelText.textContent = `Up to ${MAX_PARTY_NAME} characters`;
    nameLabel.append('Party name', nameLabelText);
    const nameInput = document.createElement('input');
    nameInput.className = 'vx-prez-input';
    nameInput.maxLength = MAX_PARTY_NAME;
    nameInput.placeholder = 'The Miners’ Union';
    nameInput.value = this.draft.name;
    nameInput.addEventListener('input', () => {
      this.draft.name = nameInput.value;
      refreshPreview();
    });
    nameField.append(nameLabel, nameInput);

    const sloganField = document.createElement('div');
    sloganField.className = 'vx-prez-field';
    const sloganLabel = document.createElement('label');
    const sloganLabelText = document.createElement('span');
    sloganLabelText.textContent = `Up to ${MAX_SLOGAN} characters`;
    sloganLabel.append('Slogan', sloganLabelText);
    const sloganInput = document.createElement('input');
    sloganInput.className = 'vx-prez-input';
    sloganInput.maxLength = MAX_SLOGAN;
    sloganInput.placeholder = 'Low tax, deep tunnels, no surprises.';
    sloganInput.value = this.draft.slogan;
    sloganInput.addEventListener('input', () => {
      this.draft.slogan = sloganInput.value;
      refreshPreview();
    });
    sloganField.append(sloganLabel, sloganInput);

    const pickField = document.createElement('div');
    pickField.className = 'vx-prez-field';
    const pickLabel = document.createElement('label');
    const pickCount = document.createElement('span');
    const refreshCount = (): void => {
      pickCount.textContent = `${this.draft.promises.size} of ${MAX_PROMISES} chosen`;
    };
    pickLabel.append('Campaign promises', pickCount);
    const picks = document.createElement('div');
    picks.className = 'vx-prez-picks';
    const refreshPicks = (): void => {
      const full = this.draft.promises.size >= MAX_PROMISES;
      for (const [i, row] of [...picks.children].entries()) {
        const el = row as HTMLElement;
        const on = this.draft.promises.has(i);
        el.dataset.on = on ? '1' : '0';
        el.dataset.full = full ? '1' : '0';
        (el.querySelector('input') as HTMLInputElement).checked = on;
      }
      refreshCount();
    };
    PRESET_PROMISES.forEach((text, i) => {
      const row = document.createElement('label');
      row.className = 'vx-prez-pick';
      const box = document.createElement('input');
      box.type = 'checkbox';
      const copy = document.createElement('span');
      copy.textContent = text;
      row.append(box, copy);
      box.addEventListener('change', () => {
        if (this.draft.promises.has(i)) this.draft.promises.delete(i);
        // The cap is enforced here rather than by silently dropping extras on
        // submit — you always see exactly what you are running on.
        else if (this.draft.promises.size < MAX_PROMISES) this.draft.promises.add(i);
        refreshPicks();
        refreshPreview();
      });
      picks.appendChild(row);
    });
    pickField.append(pickLabel, picks);
    refreshPicks();

    const err = document.createElement('div');
    err.className = 'vx-prez-err';

    const row = document.createElement('div');
    row.className = 'vx-prez-row';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'vx-gov-btn';
    submit.dataset.kind = 'primary';
    submit.textContent = 'Put me on the ballot';
    submit.addEventListener('click', () => {
      const name = this.draft.name.trim(), slogan = this.draft.slogan.trim();
      if (name.length < 3) { err.textContent = 'A party name needs at least 3 characters.'; return; }
      if (slogan.length < 3) { err.textContent = 'Give your party a slogan.'; return; }
      if (!this.draft.promises.size) { err.textContent = 'Pick at least one campaign promise.'; return; }
      err.textContent = '';
      this.actions?.onFoundParty(name, slogan, [...this.draft.promises]);
    });
    row.appendChild(submit);

    form.append(nameField, sloganField, pickField, err, row);
    desk.append(form, previewHost);
    this.body.appendChild(desk);
    refreshPreview();
  }

  /** The ballot card the candidate is building, drawn from the live draft. */
  private buildPreviewCard(data: GovernData, busts: BustEntry[]): HTMLElement {
    const card = document.createElement('div');
    card.className = 'vx-prez-party';
    card.dataset.mine = '1';
    card.style.gridTemplateColumns = '1fr';

    const stage = document.createElement('div');
    stage.className = 'vx-prez-stage';
    const slot = document.createElement('div');
    slot.className = 'vx-prez-slot';
    stage.appendChild(slot);
    this.mountBust(data, 'prez:preview', data.username, slot, stage, 0, busts);

    const info = document.createElement('div');
    info.className = 'vx-prez-info';
    const pname = document.createElement('div');
    pname.className = 'vx-prez-pname';
    const name = this.draft.name.trim();
    pname.textContent = name || 'Your party';
    if (!name) pname.style.opacity = '.4';
    const founder = document.createElement('div');
    founder.className = 'vx-prez-founder';
    founder.innerHTML = iconSvg('statue');
    const founderName = document.createElement('span');
    founderName.textContent = data.username;
    founder.appendChild(founderName);
    const slogan = document.createElement('div');
    slogan.className = 'vx-prez-slogan';
    const line = this.draft.slogan.trim();
    slogan.textContent = line ? `“${line}”` : '“…and what do you stand for?”';
    if (!line) slogan.style.opacity = '.4';
    info.append(pname, founder, slogan);

    if (this.draft.promises.size) {
      info.appendChild(this.buildPromiseChips([...this.draft.promises]));
    }

    const tally = document.createElement('div');
    tally.className = 'vx-prez-tally';
    const label = document.createElement('span');
    label.className = 'vx-prez-votes';
    label.textContent = '0 votes — not standing yet';
    tally.appendChild(label);
    info.appendChild(tally);

    card.append(stage, info);
    return card;
  }

  // --- the powers of office --------------------------------------------------

  private renderAdmin(data: GovernData): void {
    bustStage.setRoster([]);
    const e = electionOf(data.state, data.faction)!;
    const g = governmentOf(data.state, data.faction)!;
    const inOffice = isPresident(data.state, data.faction, data.username);

    const note = document.createElement('div');
    note.className = 'vx-prez-note';
    note.textContent = inOffice
      ? 'You hold the office. Everything here takes effect for the whole faction the moment you set it.'
      : 'Only the sitting president can change these. This is what they have set.';
    this.body.appendChild(note);

    // The state of the office, before the controls that change it.
    const strip = document.createElement('div');
    strip.className = 'vx-prez-ledger';
    const held = data.treasury.reduce((n, s) => n + (s?.count ?? 0), 0);
    strip.append(
      statCard(`${Math.round(g.taxRate * 100)}%`, 'Current levy'),
      statCard(String(g.kitStock), 'Kits stashed'),
      statCard(String(held), 'In the treasury'),
      statCard(String(kitItemCount(g.kit)), 'Items per kit'),
    );
    this.body.appendChild(strip);

    this.body.appendChild(sectionRule('The levy'));
    this.body.appendChild(this.buildTaxPanel(g.taxRate, inOffice));

    // The broadcast desk. THE ONE WAY to reach every citizen at once, including
    // the offline ones — so it is the power of office most worth locking, and
    // the office is the ONLY key. A citizen who has not won the vote gets the
    // sealed card below instead of a dead textarea: the composer is not built
    // at all, so there is nothing on screen to type into, nothing to enable
    // from a console, and no ambiguity about why. (The server re-checks the
    // presidency on every `govBroadcast` regardless — this is the screen
    // telling the truth, not the enforcement.)
    this.body.appendChild(sectionRule('The microphone'));
    this.body.appendChild(inOffice ? this.buildBroadcastDesk() : this.buildSealedDesk(e));

    this.body.appendChild(sectionRule('The recruit kit'));
    this.body.appendChild(this.buildKitWorkshop(data, inOffice));
  }

  /** The levy dial, priced in the unit a player actually feels. */
  private buildTaxPanel(rate: number, inOffice: boolean): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'vx-prez-panel';
    panel.append(panelHead('scales', 'The levy', `${Math.round(rate * 100)}% today`));
    const copy = document.createElement('p');
    copy.textContent = 'A share of everything your citizens mine, farm from machines and haul '
      + 'out of vaults goes to the treasury. The treasury is the only thing that pays for recruit kits.';
    const row = document.createElement('div');
    row.className = 'vx-prez-taxrow';
    const value = document.createElement('div');
    value.className = 'vx-prez-taxval';
    const shown = this.draftTax ?? rate;
    value.textContent = `${Math.round(shown * 100)}%`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(Math.round(MAX_TAX * 100));
    slider.step = '1';
    slider.value = String(Math.round(shown * 100));
    slider.disabled = !inOffice;
    const hint = document.createElement('div');
    hint.className = 'vx-prez-taxhint';
    // What the dial means, twice over: what one citizen gives up on a stack,
    // and what a busy day of mining across the faction is worth to the bank.
    const refreshHint = (pct: number): void => {
      hint.replaceChildren();
      const lines: [string, string][] = [
        ['Of a 64 stack, the treasury takes', `${(64 * pct / 100).toFixed(1)}`],
        ['Per 1,000 blocks a citizen mines', `${Math.round(1000 * pct / 100)} items`],
        ['A miner still keeps', `${(100 - pct).toFixed(0)}%`],
      ];
      for (const [label, val] of lines) {
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = val;
        span.append(`${label} `, b);
        hint.appendChild(span);
      }
    };
    refreshHint(Math.round(shown * 100));
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'vx-gov-btn';
    apply.dataset.kind = 'primary';
    apply.textContent = 'Set the rate';
    apply.disabled = !inOffice || (this.draftTax ?? rate) === rate;
    slider.addEventListener('input', () => {
      this.draftTax = Number(slider.value) / 100;
      value.textContent = `${slider.value}%`;
      refreshHint(Number(slider.value));
      apply.disabled = !inOffice || this.draftTax === rate;
    });
    apply.addEventListener('click', () => {
      this.actions?.onSetTax(this.draftTax ?? rate);
      this.draftTax = null;
    });
    row.append(value, slider, apply);
    panel.append(copy, row, hint);
    return panel;
  }

  // --- the kit workshop ------------------------------------------------------

  /** The loadout currently on the bench: the president's unsaved edit if there
   *  is one, otherwise whatever the faction is issuing right now. */
  private kitOnBench(data: GovernData): KitLoadout {
    if (this.draftKit) return this.draftKit;
    const g = governmentOf(data.state, data.faction);
    return (g?.kit ?? newKit()).map((s) => (s ? { ...s } : null));
  }

  /** Start editing (copy-on-write), so a politics sync never overwrites a
   *  loadout somebody is halfway through laying out. */
  private benchDraft(data: GovernData): KitLoadout {
    if (!this.draftKit) this.draftKit = this.kitOnBench(data);
    return this.draftKit;
  }

  /**
   * The kit workshop: the loadout laid out in the SHAPE IT WILL ARRIVE IN.
   *
   * Four armor slots down the side and nine hotbar slots across, exactly like
   * the inventory a recruit opens ten seconds later. You arm a stack from your
   * own pockets on the right and click the slot it should go in; the bill, what
   * the treasury can cover and what your own pockets can cover are all priced
   * live underneath, so "can I afford this" is never a question you answer by
   * pressing the button and reading an error.
   */
  private buildKitWorkshop(data: GovernData, inOffice: boolean): HTMLElement {
    const g = governmentOf(data.state, data.faction)!;
    const panel = document.createElement('div');
    panel.className = 'vx-prez-panel';
    panel.append(panelHead('backpack', 'Recruit kits',
      `${g.kitStock} stashed`));
    const copy = document.createElement('p');
    copy.textContent = inOffice
      ? 'Lay out what a new citizen is handed. Every recruit can claim exactly one, '
        + 'ever — so a well-stocked faction is one that new players actually want to join.'
      : 'What your faction hands a new citizen. Every recruit can claim exactly one, ever.';
    panel.appendChild(copy);

    const kit = this.kitOnBench(data);
    const grid = document.createElement('div');
    grid.className = 'vx-prez-kit';

    // --- the mannequin --------------------------------------------------------
    const bench = document.createElement('div');
    const mannequin = document.createElement('div');
    mannequin.className = 'vx-prez-mannequin';
    const armor = document.createElement('div');
    armor.className = 'vx-prez-armorcol';
    const ARMOR_GHOSTS = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let i = 0; i < KIT_ARMOR_SLOTS; i++) {
      armor.appendChild(this.buildKitSlot(data, kit, i, ARMOR_GHOSTS[i], inOffice));
    }
    const hotbar = document.createElement('div');
    hotbar.className = 'vx-prez-hotbar';
    for (let i = KIT_ARMOR_SLOTS; i < KIT_SLOTS; i++) {
      hotbar.appendChild(this.buildKitSlot(data, kit, i, 'empty', inOffice));
    }
    mannequin.append(armor, hotbar);
    bench.appendChild(mannequin);

    if (inOffice) {
      const foot = document.createElement('div');
      foot.className = 'vx-prez-row vx-prez-kitfoot';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'vx-gov-btn';
      save.dataset.kind = 'primary';
      save.textContent = 'Issue this loadout';
      save.disabled = !this.draftKit || !kitStacks(kit).length;
      save.addEventListener('click', () => {
        const slots = this.draftKit;
        if (!slots) return;
        this.draftKit = null;
        this.armedItem = null;
        this.actions?.onSetKit(slots);
      });
      const revert = document.createElement('button');
      revert.type = 'button';
      revert.className = 'vx-gov-btn';
      revert.textContent = 'Discard changes';
      revert.disabled = !this.draftKit;
      revert.addEventListener('click', () => {
        this.draftKit = null;
        this.armedItem = null;
        this.render();
      });
      const state = document.createElement('span');
      state.className = 'vx-prez-votes';
      state.textContent = this.draftKit
        ? 'Unsaved — recruits still get the old loadout'
        : `Issuing ${kitItemCount(kit)} item${kitItemCount(kit) === 1 ? '' : 's'} per recruit`;
      foot.append(save, revert, state);
      bench.appendChild(foot);
    }
    grid.appendChild(bench);

    // --- the shelf + the bill -------------------------------------------------
    const right = document.createElement('div');
    if (inOffice) {
      const shelfLabel = document.createElement('label');
      shelfLabel.style.cssText =
        'display:block;margin-bottom:7px;font-size:9.5px;letter-spacing:1.6px;'
        + 'text-transform:uppercase;color:var(--muted)';
      shelfLabel.textContent = this.armedItem !== null
        ? 'Now click the slot it goes in'
        : 'Your pockets — click an item to arm it';
      right.appendChild(shelfLabel);
      right.appendChild(this.buildPocketShelf(data));
    }
    right.appendChild(this.buildKitBill(data, kit, inOffice));
    grid.appendChild(right);

    panel.appendChild(grid);

    // A citizen who has not claimed theirs gets the one button that matters.
    if (!inOffice && g.kitStock > 0 && !data.kitClaimed) {
      const claimRow = document.createElement('div');
      claimRow.className = 'vx-prez-row';
      claimRow.style.marginTop = '13px';
      const claim = document.createElement('button');
      claim.type = 'button';
      claim.className = 'vx-gov-btn';
      claim.dataset.kind = 'primary';
      claim.textContent = 'Claim my recruit kit';
      claim.addEventListener('click', () => this.actions?.onClaimKit());
      claimRow.appendChild(claim);
      panel.appendChild(claimRow);
    }
    return panel;
  }

  /** One slot on the mannequin. Clicking it places the armed stack, or — with
   *  nothing armed — clears the slot, so a mistake is one click to undo. */
  private buildKitSlot(
    data: GovernData, kit: KitLoadout, index: number, ghost: string, inOffice: boolean
  ): HTMLElement {
    const stack = kit[index] ?? null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vx-prez-slotbtn';
    btn.disabled = !inOffice;
    btn.dataset.empty = stack ? '0' : '1';
    const armed = this.armedItem;
    if (armed !== null && kitSlotAccepts(index, armed)) btn.dataset.armed = '1';

    if (stack && ITEMS[stack.id]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      renderItemIcon(canvas, data.atlasCanvas, stack.id);
      btn.appendChild(canvas);
      if (stack.count > 1) {
        const count = document.createElement('u');
        count.textContent = String(stack.count);
        btn.appendChild(count);
      }
    } else {
      const mark = document.createElement('s');
      mark.innerHTML = iconSvg(index < KIT_ARMOR_SLOTS ? 'shield' : 'square');
      btn.appendChild(mark);
    }

    const name = stack && ITEMS[stack.id] ? ITEMS[stack.id].name : `Empty ${ghost} slot`;
    const sub = !inOffice ? undefined
      : stack ? 'Click to clear · shift-click to add another'
        : armed !== null && kitSlotAccepts(index, armed)
          ? `Place ${ITEMS[armed]?.name ?? 'the armed item'} here`
          : index < KIT_ARMOR_SLOTS ? `Only a ${ghost} fits here` : 'Arm an item from your pockets';
    btn.addEventListener('mousemove', (ev) => showTip(ev, name, sub, govThemeOf(btn)));
    btn.addEventListener('mouseleave', hideTip);
    if (!inOffice) return btn;

    btn.addEventListener('click', (ev) => {
      const bench = this.benchDraft(data);
      const current = bench[index];
      if (this.armedItem === null) {
        // Nothing armed: a click clears the slot. That is the fastest possible
        // undo for the mistake this panel makes easiest to make.
        bench[index] = null;
        this.error = '';
        this.render();
        return;
      }
      const id = this.armedItem;
      if (!kitSlotAccepts(index, id)) {
        this.error = index < KIT_ARMOR_SLOTS
          ? `A ${ITEMS[id]?.name ?? 'that'} does not go in the ${ghost} slot.`
          : 'That cannot go there.';
        this.render();
        return;
      }
      this.error = '';
      const max = Math.min(MAX_KIT_STACK, Math.max(1, ITEMS[id]?.maxStack ?? 1));
      // Shift stacks the same item up; a plain click sets one.
      if (ev.shiftKey && current && current.id === id) {
        current.count = Math.min(max, current.count + Math.min(8, max));
      } else {
        bench[index] = { id, count: current && current.id === id ? current.count : 1 };
      }
      this.render();
    });
    return btn;
  }

  /** The president's own carried items, as an arming shelf. */
  private buildPocketShelf(data: GovernData): HTMLElement {
    const shelf = document.createElement('div');
    shelf.className = 'vx-prez-pocket';
    // Merge by item id: the shelf is a menu of WHAT you have, not of which slot
    // it happens to sit in.
    const totals = new Map<number, number>();
    for (const s of data.pocket) {
      if (!s || !ITEMS[s.id]) continue;
      totals.set(s.id, (totals.get(s.id) ?? 0) + s.count);
    }
    if (!totals.size) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;padding:14px 4px;text-align:center;'
        + 'font-size:11.5px;line-height:1.6;color:var(--faint)';
      empty.textContent = 'You are carrying nothing. Anything in your inventory can go '
        + 'in the kit — go and dig some of it up.';
      shelf.appendChild(empty);
      return shelf;
    }
    for (const [id, count] of [...totals].sort((a, b) => b[1] - a[1])) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vx-prez-slotbtn';
      if (this.armedItem === id) btn.dataset.armed = '1';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      renderItemIcon(canvas, data.atlasCanvas, id);
      btn.appendChild(canvas);
      const label = document.createElement('u');
      label.textContent = String(count);
      btn.appendChild(label);
      btn.addEventListener('mousemove', (ev) => showTip(
        ev, ITEMS[id].name,
        this.armedItem === id ? 'Armed — click a slot' : 'Click to arm', govThemeOf(btn)));
      btn.addEventListener('mouseleave', hideTip);
      btn.addEventListener('click', () => {
        this.armedItem = this.armedItem === id ? null : id;
        this.render();
      });
      shelf.appendChild(btn);
    }
    return shelf;
  }

  /**
   * What funding costs and who can pay it.
   *
   * Priced against BOTH purses at once, line by line: what the treasury holds
   * and what the president is carrying. A president with a full backpack and an
   * empty treasury can still equip the faction, and the panel says so before
   * they press anything.
   */
  private buildKitBill(data: GovernData, kit: KitLoadout, inOffice: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.marginTop = inOffice ? '14px' : '0';
    const lines = kitCost(kitStacks(kit));

    const stats = document.createElement('div');
    stats.className = 'vx-prez-kitstat';
    const g = governmentOf(data.state, data.faction)!;
    stats.append(
      statCard(String(g.kitStock), 'Kits stashed'),
      statCard(String(kitItemCount(kit)), 'Items per kit'),
    );
    wrap.appendChild(stats);

    if (!lines.length) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      empty.style.padding = '22px 16px';
      empty.textContent = 'The kit is empty. Put at least one item in it before funding any.';
      wrap.appendChild(empty);
      return wrap;
    }
    if (!inOffice) {
      const list = document.createElement('div');
      list.className = 'vx-gov-chips';
      for (const line of lines) {
        list.appendChild(itemChip(data.atlasCanvas, { id: line.id, count: line.count }));
      }
      wrap.appendChild(list);
      return wrap;
    }

    // How much of each purse there is, per item.
    const inBank = new Map<number, number>();
    for (const slot of data.treasury) {
      if (slot) inBank.set(slot.id, (inBank.get(slot.id) ?? 0) + slot.count);
    }
    const inPocket = new Map<number, number>();
    for (const slot of data.pocket) {
      if (slot) inPocket.set(slot.id, (inPocket.get(slot.id) ?? 0) + slot.count);
    }

    const row = document.createElement('div');
    row.className = 'vx-prez-row';
    row.style.marginBottom = '11px';
    const count = document.createElement('input');
    count.type = 'number';
    count.className = 'vx-prez-input';
    count.style.width = '92px';
    count.min = '1';
    count.max = '100';
    count.value = String(this.draftKits);
    const countLabel = document.createElement('span');
    countLabel.className = 'vx-prez-votes';
    countLabel.textContent = 'kits to fund';
    row.append(count, countLabel);

    const bill = document.createElement('div');
    bill.className = 'vx-prez-bill';
    const buttons = document.createElement('div');
    buttons.className = 'vx-prez-row';
    buttons.style.marginTop = '12px';
    const fromBank = document.createElement('button');
    fromBank.type = 'button';
    fromBank.className = 'vx-gov-btn';
    fromBank.dataset.kind = 'primary';
    fromBank.textContent = 'Fund from the treasury';
    const fromPocket = document.createElement('button');
    fromPocket.type = 'button';
    fromPocket.className = 'vx-gov-btn';
    fromPocket.textContent = 'Fund from my pockets';
    buttons.append(fromBank, fromPocket);

    const refresh = (): void => {
      const n = Math.max(1, Math.min(100, Math.floor(Number(count.value) || 1)));
      this.draftKits = n;
      bill.replaceChildren();
      let bankOk = true, pocketOk = true;
      const header = document.createElement('div');
      header.className = 'vx-prez-billline';
      header.style.cssText = 'font-size:9px;letter-spacing:1.3px;text-transform:uppercase;'
        + 'color:var(--faint)';
      const hLeft = document.createElement('span');
      hLeft.textContent = `Bill for ${n} kit${n === 1 ? '' : 's'}`;
      const hRight = document.createElement('span');
      hRight.textContent = 'Treasury / pockets / needed';
      header.append(hLeft, hRight);
      bill.appendChild(header);
      for (const line of lines) {
        const need = line.count * n;
        const bank = inBank.get(line.id) ?? 0;
        const pocket = inPocket.get(line.id) ?? 0;
        if (bank < need) bankOk = false;
        if (pocket < need) pocketOk = false;
        const el = document.createElement('div');
        el.className = 'vx-prez-billline';
        if (bank < need && pocket < need) el.dataset.short = '1';
        const label = document.createElement('span');
        label.textContent = ITEMS[line.id]?.name ?? `#${line.id}`;
        const amount = document.createElement('span');
        amount.textContent = `${bank} / ${pocket} / ${need}`;
        el.append(label, amount);
        bill.appendChild(el);
      }
      fromBank.disabled = !bankOk;
      fromPocket.disabled = !pocketOk;
      fromBank.textContent = bankOk ? 'Fund from the treasury' : 'Treasury cannot cover it';
      fromPocket.textContent = pocketOk ? 'Fund from my pockets' : 'Not carrying enough';
    };
    count.addEventListener('input', refresh);
    refresh();
    fromBank.addEventListener('click', () => this.actions?.onFundKits(this.draftKits, 'treasury'));
    fromPocket.addEventListener('click', () => this.actions?.onFundKits(this.draftKits, 'inventory'));

    wrap.append(row, bill, buttons);
    return wrap;
  }

  /** The live broadcast composer. Only ever built for the sitting president. */
  private buildBroadcastDesk(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'vx-prez-panel';
    panel.append(panelHead('horn', 'Address the faction'));
    const copy = document.createElement('p');
    copy.textContent = 'Lands in every citizen’s dispatch inbox, including anyone who is '
      + 'offline right now — they will read it next time they log in.';
    const area = document.createElement('textarea');
    area.className = 'vx-prez-area';
    area.maxLength = MAX_BROADCAST;
    area.placeholder = 'Muster at the flag at sundown. Bring cobalt.';
    area.value = this.draftBroadcast;
    area.addEventListener('input', () => {
      this.draftBroadcast = area.value;
      send.disabled = area.value.trim().length < 2;
      remaining.textContent = `${MAX_BROADCAST - area.value.length} left`;
    });
    const row = document.createElement('div');
    row.className = 'vx-prez-row';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'vx-gov-btn';
    send.dataset.kind = 'primary';
    send.textContent = 'Broadcast';
    send.disabled = area.value.trim().length < 2;
    send.addEventListener('click', () => {
      this.actions?.onBroadcast(area.value.trim());
      this.draftBroadcast = '';
      area.value = '';
      send.disabled = true;
    });
    const remaining = document.createElement('span');
    remaining.className = 'vx-prez-votes';
    remaining.textContent = `${MAX_BROADCAST - area.value.length} left`;
    row.append(send, remaining);
    panel.append(copy, area, row);
    return panel;
  }

  /** What a citizen who has not won the election sees where the desk would be:
   *  who currently holds the microphone, and the one route to taking it. */
  private buildSealedDesk(e: Election): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'vx-prez-locked';
    const mark = document.createElement('div');
    mark.className = 'vx-prez-locked-mark';
    mark.innerHTML = iconSvg('lock');

    const body = document.createElement('div');
    const head = document.createElement('h4');
    head.textContent = 'The broadcast desk is sealed';
    const copy = document.createElement('p');
    if (e.president) {
      const who = document.createElement('b');
      who.textContent = e.president;              // player-authored: text node only
      copy.append('Only ', who, ', elected to this term, can put a dispatch in every '
        + 'citizen’s inbox. Win the seat and the desk is yours.');
    } else {
      copy.textContent = 'The seat is vacant, so nobody can address the faction at all. '
        + 'An unopposed party wins on a single vote — stand, and the desk is yours.';
    }
    body.append(head, copy);

    const row = document.createElement('div');
    row.className = 'vx-prez-row';
    const stand = document.createElement('button');
    stand.type = 'button';
    stand.className = 'vx-gov-btn';
    stand.textContent = 'Stand for election';
    stand.addEventListener('click', () => this.setView('candidacy'));
    row.appendChild(stand);
    body.appendChild(row);

    panel.append(mark, body);
    return panel;
  }

  // --- the strongbox ---------------------------------------------------------

  private renderTreasury(data: GovernData): void {
    bustStage.setRoster([]);
    const g = governmentOf(data.state, data.faction)!;
    const held = data.treasury.reduce((n, s) => n + (s?.count ?? 0), 0);

    const note = document.createElement('div');
    note.className = 'vx-prez-note';
    note.textContent = 'Your hoard stands in the open at the flag: a strongbox beside the pole '
      + 'and a ring of pedestals around it, one per slice of what is banked. While a war window '
      + 'is open the shields drop and the enemy can walk in and haul stacks off it, so what is '
      + 'out there is worth defending.';
    this.body.appendChild(note);

    const ledger = document.createElement('div');
    ledger.className = 'vx-prez-ledger';
    ledger.append(
      statCard(String(held), 'Items held'),
      statCard(`${Math.round(g.taxRate * 100)}%`, 'Current levy'),
      statCard(String(g.kitStock), 'Kits stashed'),
      statCard(String(data.treasury.filter((s) => s).length), 'Slots in use'),
    );
    this.body.appendChild(ledger);

    this.body.appendChild(sectionRule('The ring, as it stands at the flag'));
    this.body.appendChild(this.buildRingMap(data));

    this.body.appendChild(sectionRule('Every slot in the strongbox'));
    const vault = document.createElement('div');
    vault.className = 'vx-prez-vault';
    for (let i = 0; i < Math.max(27, data.treasury.length); i++) {
      vault.appendChild(itemChip(data.atlasCanvas, data.treasury[i] ?? null, 'Empty'));
    }
    this.body.appendChild(vault);

    if (!held) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      empty.style.marginTop = '14px';
      const head = document.createElement('b');
      head.textContent = 'Nothing on the ring';
      empty.append(head, g.taxRate > 0
        ? 'It fills as your citizens mine — every levy lands here, and the pedestals '
          + 'out at the flag rise with it.'
        : 'The levy is at 0%, so nothing will arrive until a president sets a rate.');
      this.body.appendChild(empty);
    }
  }

  /**
   * The hoard drawn the way it actually stands in the world: eight pedestals in
   * a ring around the flag pole, biggest stack first, exactly as
   * `treasury_models.ts` lays them out. Reading this panel and walking the ring
   * should be the same act — which is only true if the panel IS the ring.
   */
  private buildRingMap(data: GovernData): HTMLElement {
    const map = document.createElement('div');
    map.className = 'vx-prez-ring-map';

    const pole = document.createElement('div');
    pole.className = 'vx-prez-ring-pole';
    const glyph = document.createElement('i');
    glyph.innerHTML = iconSvg('flag');
    const label = document.createElement('span');
    label.textContent = 'The flag';
    pole.append(glyph, label);
    map.appendChild(pole);

    const stacks = data.treasury
      .filter((s): s is ItemStack => !!s && !!ITEMS[s.id])
      .sort((a, b) => b.count - a.count);

    for (let i = 0; i < TREASURY_PEDESTALS; i++) {
      // The same angle `pedestalLocation` uses, half a step off the axis, so
      // walking the ring and reading this map put the piles in the same places.
      const a = (Math.PI * 2 * (i + 0.5)) / TREASURY_PEDESTALS;
      const ped = document.createElement('div');
      ped.className = 'vx-prez-ring-ped';
      ped.style.left = `${50 + Math.cos(a) * 37}%`;
      ped.style.top = `${50 + Math.sin(a) * 37}%`;
      const stack = stacks[i];
      if (stack) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        renderItemIcon(canvas, data.atlasCanvas, stack.id);
        ped.appendChild(canvas);
        const count = document.createElement('u');
        count.textContent = String(stack.count);
        ped.appendChild(count);
        ped.addEventListener('mousemove', (ev) => showTip(
          ev, ITEMS[stack.id].name, `${stack.count} on this pedestal`, govThemeOf(ped)));
      } else {
        ped.dataset.empty = '1';
        ped.innerHTML = iconSvg('square');
        ped.addEventListener('mousemove', (ev) => showTip(
          ev, 'Bare pedestal', 'Nothing banked here yet', govThemeOf(ped)));
      }
      ped.addEventListener('mouseleave', hideTip);
      map.appendChild(ped);
    }
    return map;
  }
}

/** Which tab a caller wants opened — exported so main.ts can name it. */
export type PresidentView = View;
