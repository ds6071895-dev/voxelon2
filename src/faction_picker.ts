// THE ALLEGIANCE PLEDGE — the screen that replaces being told which side you
// are on.
//
// VOXELON used to assign your faction at registration to keep the war 50/50, and
// announce it on a card you could only click "Accept" on. Now you inspect both
// sides and choose, and the choice is PERMANENT — so the screen's whole job is
// to make sure you are choosing with the facts in front of you:
//
//   · the sitting president, as a live 3D character who poses when you point at
//     them (the same board the Duels ladder uses), named on the plinth they
//     stand on — or, where the seat is VACANT, the plinth stays empty and says
//     so, because a character standing on an open seat is a president that does
//     not exist
//   · their party, their slogan and the promises they were elected on
//   · the gear they are actually carrying, hoverable for names and runes
//   · the tax you would pay, the kits waiting for recruits, what the treasury
//     holds, and who is already fighting on that side
//
// Nothing here balances the sides. Both cards are always joinable; a faction
// that is already bigger simply says so, and the smaller one advertises the
// underdog's advantage: an empty side's president is YOURS to win in a week.
//
// SELF-CONTAINED: one injected <style>, a `vx-pledge-` prefix used nowhere else,
// nothing added to index.html. Player-authored strings (party names, slogans,
// usernames) are written with textContent and never reach innerHTML.

import { BUST_POSES, type BustEntry } from './avatar_bust';
import { type Cosmetics, sanitizeCosmetics } from './character';
import { iconSvg } from './emoji_icons';
import { PRESET_PROMISES } from './politics';
import type { FactionPublic } from './net/protocol';
import { skinSeed } from './net/protocol';
import { FACTIONS, factionColor, factionName } from './teams';
import { bustStage, hideTip, injectGovStyle, itemChip } from './gov_ui';

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
 * wait for an election to unlock. The government panel gets this right by
 * stating its height outright (see .vx-prez-shell); so does this one now. */
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

/* The pan fills the scrollport exactly, so each card is a known height and can
   scroll its own dossier instead of pushing its JOIN BUTTON off the bottom of
   the screen. That is not a polish detail: swearing allegiance is the only way
   into the world, and a card whose crest, plinth, stats and roster all fit while
   its button sits 200px below the fold reads as a side you are not allowed to
   join. Nothing about the pledge screen may ever require scrolling to find the
   thing you came here to press. */
.vx-pledge-cards {
  display: grid; gap: 18px; grid-template-columns: 1fr 1fr; padding: 2px;
  height: 100%; align-items: stretch;
}

.vx-pledge-card {
  position: relative; display: flex; flex-direction: column; min-height: 0;
  border-radius: 16px; overflow: hidden; background: rgba(12, 20, 30, .88);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12), 0 20px 48px rgba(0, 0, 0, .45);
  transition: box-shadow .18s, transform .18s;
}
.vx-pledge-card:hover {
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

/* The president's plinth. The 3D bust is drawn OVER this box by the shared
   renderer, so it must keep its size whether or not a bust lands in it. */
.vx-pledge-stage {
  position: relative; display: flex; align-items: flex-end; justify-content: center;
  flex: none; height: clamp(132px, 21vh, 210px); margin: 0 18px; border-radius: 13px;
  background: radial-gradient(70% 90% at 50% 12%, color-mix(in srgb, var(--side) 26%, transparent), transparent 72%),
    rgba(0, 0, 0, .28);
}
.vx-pledge-slot { position: absolute; inset: 12px 0 32px; }
/* THE FALLBACK PORTRAIT. A browser hands out a limited number of WebGL contexts
   and the world already spends one, so "no context to spare" is a state a real
   player can land in — and it used to present as a plinth that simply stayed
   empty. When the bust board cannot draw, this monogram stands there instead,
   so a faction's president always has a face on the pledge screen. */
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
/* THE NAMEPLATE. The president's own name, on the plinth they are standing on,
   so the character and the name are one object rather than a portrait with a
   caption somewhere below it. It sits UNDER the bust slot, never behind it —
   the bust canvas paints over anything inside its own rectangle, so text that
   overlaps it is text with a character drawn through it. */
.vx-pledge-stage .vx-pledge-stage-name {
  position: absolute; left: 10px; right: 10px; bottom: 5px;
  font: 700 13px/1.25 inherit; letter-spacing: .6px; text-align: center; color: #fff;
  text-shadow: 0 2px 7px rgba(0, 0, 0, .7);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* THE OPEN SEAT. An unheld faction stands NOBODY on its plinth: the citizens
   who used to fill it read as a government that was there, and they were drawn
   by the bust canvas, which paints over the whole slot — so the very banner
   saying the seat was open had characters standing through it. An empty plinth
   with the vacancy written across the middle of it is the honest picture, and
   the reason to pick that side is spelled out in the card body underneath. */
.vx-pledge-openseat {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  display: flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 999px;
  font: 700 10.5px/1 inherit; letter-spacing: 1.6px; text-transform: uppercase;
  color: #ffd0a0; background: rgba(9, 15, 23, .82);
  box-shadow: inset 0 0 0 1px rgba(237, 160, 26, .35);
}
.vx-pledge-openseat svg { width: 13px; height: 13px; }
.vx-pledge-open-note {
  margin-top: 6px; font-size: 11.5px; line-height: 1.5; color: #9fb0cc;
}

/* The only scrolling part of a card. Everything here is reading material; the
   crest above it and the button below it stay put. */
.vx-pledge-body {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 13px; padding: 15px 18px 18px;
}
.vx-pledge-body::-webkit-scrollbar { width: 7px; }
.vx-pledge-body::-webkit-scrollbar-thumb { border-radius: 4px; background: rgba(232, 238, 252, .18); }
.vx-pledge-prez { text-align: center; }
.vx-pledge-prez-name { font-size: 16px; font-weight: 700; letter-spacing: .5px; }
.vx-pledge-prez-party { margin-top: 3px; font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--side); }
.vx-pledge-prez-slogan { margin-top: 6px; font-size: 12.5px; font-style: italic; color: #c3cfe2; overflow-wrap: anywhere; }

.vx-pledge-promises { display: flex; flex-direction: column; gap: 5px; }
.vx-pledge-promise {
  display: flex; gap: 7px; align-items: flex-start; font-size: 11.5px; line-height: 1.45; color: #b7c4d8;
}
.vx-pledge-promise span { flex: none; color: var(--side); }

.vx-pledge-gear { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.vx-pledge-gear-label { font-size: 9.5px; letter-spacing: 1.8px; text-transform: uppercase; color: #77879f; }

.vx-pledge-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
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

.vx-pledge-join {
  flex: none; padding: 14px 18px 18px;
  background: linear-gradient(180deg, transparent, rgba(6, 11, 17, .55) 40%);
  box-shadow: inset 0 1px 0 rgba(232, 238, 252, .1);
}
.vx-pledge-join .vx-gov-btn { width: 100%; min-height: 46px; font-size: 11.5px; }
.vx-pledge-join[data-confirming="1"] .vx-gov-btn { background: linear-gradient(180deg, #ff9a6a, #e2503b); color: #fff; }
.vx-pledge-warn {
  margin-top: 8px; font-size: 11px; line-height: 1.5; text-align: center; color: #ffb4a4;
  min-height: 2.8em;
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
  /** Item icons are drawn out of the live block atlas. */
  atlasCanvas: HTMLCanvasElement;
  /** The player doing the choosing. Nothing on a card is drawn from them — only
   *  a sitting president ever stands on a plinth — but callers still pass it. */
  viewer?: { username: string; cosmetics?: Cosmetics };
}

/** The one person drawn on a card's stage: its sitting president. */
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
 * card is a screen a new player cannot get off. An unelected presidency is the
 * ordinary case at the start of a season, not an error: a side with no
 * government, no citizens and no treasury is still Crimson or Azure, and is
 * joined by the same button as a side with all three.
 *
 * So every field is defaulted rather than trusted, and `president` stays absent
 * unless a real one was sent — which is exactly what puts the card into its
 * "seat vacant" shape.
 */
function dossiersFor(list: readonly FactionPublic[] | undefined): FactionPublic[] {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return FACTIONS.map((f) => {
    const d = list?.find((i) => i && i.faction === f.id);
    const out: FactionPublic = {
      faction: f.id,
      members: Array.isArray(d?.members) ? d!.members.filter((m) => typeof m === 'string') : [],
      memberCount: num(d?.memberCount),
      taxRate: num(d?.taxRate),
      kitStock: num(d?.kitStock),
      treasuryCount: num(d?.treasuryCount),
      faces: Array.isArray(d?.faces) ? d!.faces : [],
    };
    // A president is only ever half-known: an offline one has no gear, an
    // unparsed one has no promises. Fill the holes here so the card below can
    // read every field without a guard of its own.
    const p = d?.president;
    if (p?.username) {
      out.president = {
        ...p,
        partyName: p.partyName || 'Independent',
        slogan: typeof p.slogan === 'string' ? p.slogan : '',
        promises: Array.isArray(p.promises) ? p.promises : [],
        armor: Array.isArray(p.armor) ? p.armor : [],
      };
    }
    return out;
  });
}

export class FactionPicker {
  private readonly surface: HTMLElement;
  private readonly shell: HTMLElement;
  /** The pan of cards. Its CHILDREN are rebuilt on every render; it is not. */
  private readonly cards: HTMLElement;
  /** The positioned box the cards scroll in and the bust canvas covers. */
  private readonly viewport: HTMLElement;
  /** The hint under the cards. It names whoever is actually standing on the
   *  plinths, which is not always a president. */
  private readonly footText: HTMLElement;
  private isOpen = false;
  private data: PledgeData | null = null;
  /** The card awaiting its second click. A permanent choice gets two. */
  private confirming = -1;

  onPledge?: (faction: number) => void;
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
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });

    this.shell = document.createElement('div');
    this.shell.className = 'vx-pledge-shell';

    const head = document.createElement('div');
    head.className = 'vx-pledge-head';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'vx-gov-eyebrow';
    eyebrow.textContent = 'Swear allegiance';
    const title = document.createElement('h1');
    title.textContent = 'Choose your side';
    const lede = document.createElement('p');
    lede.innerHTML =
      'Every faction elects its own president each week. They set the tax you pay, '
      + 'fund the kits new recruits get, and speak for the whole side. '
      + '<b>You can never switch.</b> Read both before you pick.';
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
    back.type = 'button';
    back.className = 'vx-pledge-back';
    back.textContent = 'Decide later';
    back.addEventListener('click', () => this.hide());
    foot.append(footText, back);

    this.shell.append(head, this.viewport, foot);
    this.surface.appendChild(this.shell);
    host.appendChild(this.surface);
  }

  get open(): boolean { return this.isOpen; }

  show(data: PledgeData): void {
    this.data = data;
    this.confirming = -1;
    if (!this.isOpen) {
      this.isOpen = true;
      this.surface.dataset.open = '1';
      this.onOpen?.();
    }
    bustStage.attach(this.viewport);
    this.render();
    this.surface.focus();
  }

  /** New data while the screen is up (a president was just elected, a treasury
   *  was raided). Keeps any confirmation the player is halfway through. */
  update(data: PledgeData): void {
    this.data = data;
    if (this.isOpen) this.render();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    delete this.surface.dataset.open;
    hideTip();
    bustStage.release(this.viewport);
    this.onClose?.();
  }

  private render(): void {
    const data = this.data;
    if (!data) return;
    const busts: BustEntry[] = [];
    this.cards.replaceChildren();

    // Never the wire's list directly — see dossiersFor. Both sides get a card
    // whether or not anyone has been elected on either of them.
    const dossiers = dossiersFor(data.factions);
    const total = dossiers.reduce((n, f) => n + f.memberCount, 0);
    // Before the first election nobody is a president, and telling the player to
    // point at one is telling them the screen is broken. Name who is really up
    // there instead.
    this.footText.textContent = dossiers.some((f) => f.president)
      ? 'Point at a president to get their attention.'
      : 'No elections have been held yet — either side is yours to join.';

    dossiers.forEach((info, index) => {
      const card = document.createElement('div');
      card.className = 'vx-pledge-card';
      const side = `#${factionColor(info.faction).toString(16).padStart(6, '0')}`;
      card.style.setProperty('--side', side);

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
      // A president stands on it, named. A VACANT seat stands NOBODY: the
      // plinth says the office is open and nothing else, because any character
      // drawn there is a president the faction has not got.
      const stage = document.createElement('div');
      stage.className = 'vx-pledge-stage';
      const plinth = document.createElement('div');
      plinth.className = 'vx-pledge-plinth';
      stage.appendChild(plinth);

      const prez = info.president;
      if (prez) {
        const slot = document.createElement('div');
        slot.className = 'vx-pledge-slot';
        stage.insertBefore(slot, plinth);
        const key = `pledge:${info.faction}:${prez.username.toLowerCase()}`;
        this.standUp(busts, {
          key, slot,
          face: {
            username: prez.username,
            cosmetics: sanitizeCosmetics(prez.cosmetics, skinSeed(prez.username)),
          },
          // The two plinths get different salutes so the screen never plays the
          // same animation twice side by side.
          pose: BUST_POSES[index % BUST_POSES.length],
        });
        // The name belongs to the figure, so it goes on the plinth rather than
        // in the body — and it is the ONLY text on the stage, sitting under the
        // bust slot instead of inside it, where the canvas would paint over it.
        const nameplate = document.createElement('div');
        nameplate.className = 'vx-pledge-stage-name';
        nameplate.textContent = prez.username;
        stage.appendChild(nameplate);
        stage.addEventListener('mouseenter', () => bustStage.setHover(key));
        stage.addEventListener('mouseleave', () => bustStage.setHover(null));
      } else {
        const seat = document.createElement('div');
        seat.className = 'vx-pledge-openseat';
        const seatGlyph = document.createElement('span');
        seatGlyph.innerHTML = iconSvg('crown');
        const seatLabel = document.createElement('span');
        seatLabel.textContent = 'Seat vacant';
        seat.append(seatGlyph, seatLabel);
        stage.appendChild(seat);
      }

      // --- body --------------------------------------------------------------
      const body = document.createElement('div');
      body.className = 'vx-pledge-body';

      const who = document.createElement('div');
      who.className = 'vx-pledge-prez';
      const whoParty = document.createElement('div');
      whoParty.className = 'vx-pledge-prez-party';
      whoParty.textContent = prez ? prez.partyName : 'The office is open';
      // A president is named on their own plinth; repeating it as a heading here
      // said the same word twice, an inch apart.
      if (!prez) {
        const whoName = document.createElement('div');
        whoName.className = 'vx-pledge-prez-name';
        whoName.textContent = 'No president';
        who.appendChild(whoName);
      }
      who.appendChild(whoParty);
      if (prez?.slogan) {
        const slogan = document.createElement('div');
        slogan.className = 'vx-pledge-prez-slogan';
        slogan.textContent = `“${prez.slogan}”`;
        who.appendChild(slogan);
      }
      if (!prez) {
        // Said plainly, because an empty plinth used to read as a side that was
        // shut: an unheld faction is joined like any other, and the vacancy is
        // the reason to pick it rather than a reason not to.
        const note = document.createElement('div');
        note.className = 'vx-pledge-open-note';
        note.textContent = info.memberCount
          ? 'Nobody has won an election here yet. Join now, stand a party, and the presidency could be yours inside the week.'
          : 'Nobody has pledged here yet. Join and you are its first citizen — and its first candidate.';
        who.appendChild(note);
      }
      body.appendChild(who);

      if (prez?.promises.length) {
        const promises = document.createElement('div');
        promises.className = 'vx-pledge-promises';
        for (const i of prez.promises) {
          const line = document.createElement('div');
          line.className = 'vx-pledge-promise';
          const tick = document.createElement('span');
          tick.innerHTML = iconSvg('check');
          const text = document.createElement('span');
          text.textContent = PRESET_PROMISES[i] ?? '';
          line.append(tick, text);
          promises.appendChild(line);
        }
        body.appendChild(promises);
      }

      // The president's actual kit — hover for names and runes.
      if (prez) {
        const gear = document.createElement('div');
        gear.className = 'vx-pledge-gear';
        const label = document.createElement('div');
        label.className = 'vx-pledge-gear-label';
        label.textContent = 'Carrying';
        const chips = document.createElement('div');
        chips.className = 'vx-gov-chips';
        chips.appendChild(itemChip(data.atlasCanvas, prez.held ?? null, 'Empty-handed'));
        const armor = prez.armor ?? [];
        const slots = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
        for (let i = 0; i < 4; i++) {
          chips.appendChild(itemChip(data.atlasCanvas, armor[i] ?? null, `No ${slots[i].toLowerCase()}`));
        }
        gear.append(label, chips);
        body.appendChild(gear);
      }

      const stats = document.createElement('div');
      stats.className = 'vx-pledge-stats';
      const cells: [string, string][] = [
        [String(info.memberCount), 'Citizens'],
        [`${Math.round(info.taxRate * 100)}%`, 'Tax'],
        [String(info.kitStock), 'Kits ready'],
        [String(info.treasuryCount), 'In treasury'],
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

      // --- the commitment ----------------------------------------------------
      const join = document.createElement('div');
      join.className = 'vx-pledge-join';
      const confirming = this.confirming === info.faction;
      if (confirming) join.dataset.confirming = '1';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vx-gov-btn';
      button.dataset.kind = confirming ? 'danger' : 'primary';
      button.textContent = confirming
        ? `Yes — I am ${factionName(info.faction)} for good`
        : `Fight for ${factionName(info.faction)}`;
      button.addEventListener('click', () => {
        if (this.confirming === info.faction) {
          this.onPledge?.(info.faction);
          return;
        }
        // First click arms, second commits. A permanent, unrecoverable choice
        // should never be one stray click away.
        this.confirming = info.faction;
        this.render();
      });
      const warn = document.createElement('div');
      warn.className = 'vx-pledge-warn';
      warn.textContent = confirming
        ? 'This is permanent. You will never be able to join the other side on this account.'
        : '';
      join.append(button, warn);

      card.append(crest, stage, body, join);
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
