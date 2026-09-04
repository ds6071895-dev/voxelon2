// THE ALLEGIANCE PLEDGE — the screen that replaces being told which side you
// are on.
//
// VOXELON used to assign your faction at registration to keep the war 50/50, and
// announce it on a card you could only click "Accept" on. Now you inspect both
// sides and choose, and the choice is PERMANENT — so the screen's whole job is
// to make sure you are choosing with the facts in front of you:
//
//   · the sitting president, as a live 3D character who poses when you point at
//     them (the same board the Duels ladder uses)
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
import { sanitizeCosmetics } from './character';
import { iconSvg } from './emoji_icons';
import { PRESET_PROMISES } from './politics';
import type { FactionPublic } from './net/protocol';
import { skinSeed } from './net/protocol';
import { factionColor, factionName } from './teams';
import { bustStage, hideTip, injectGovStyle, itemChip } from './gov_ui';

const CSS = `
.vx-pledge-shell {
  position: relative; display: flex; flex-direction: column; gap: 18px;
  width: min(1120px, 100%); max-height: 100%; padding: 4px;
}
.vx-pledge-head { text-align: center; }
.vx-pledge-head h1 {
  margin: 6px 0 0; font-size: clamp(24px, 4.4vw, 38px); letter-spacing: 3px; text-transform: uppercase;
}
.vx-pledge-head p {
  margin: 8px auto 0; max-width: 62ch; font-size: 12.5px; line-height: 1.6; color: #9fb0cc;
}
.vx-pledge-head b { color: #ffd98a; }

.vx-pledge-cards { display: grid; gap: 18px; grid-template-columns: 1fr 1fr; padding: 2px; }

.vx-pledge-card {
  position: relative; display: flex; flex-direction: column;
  border-radius: 16px; overflow: hidden; background: rgba(12, 20, 30, .88);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12), 0 20px 48px rgba(0, 0, 0, .45);
  transition: box-shadow .18s, transform .18s;
}
.vx-pledge-card:hover {
  transform: translateY(-3px);
  box-shadow: inset 0 0 0 1px var(--side), 0 26px 60px rgba(0, 0, 0, .55);
}
.vx-pledge-crest {
  display: flex; align-items: center; gap: 11px; padding: 15px 18px;
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
  height: 210px; margin: 0 18px; border-radius: 13px;
  background: radial-gradient(70% 90% at 50% 12%, color-mix(in srgb, var(--side) 26%, transparent), transparent 72%),
    rgba(0, 0, 0, .28);
}
.vx-pledge-slot { position: absolute; inset: 12px 0 26px; }
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
.vx-pledge-vacant {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 7px; text-align: center; padding: 0 24px;
}
.vx-pledge-vacant span { font-size: 27px; color: rgba(232, 238, 252, .3); }
.vx-pledge-vacant b { font-size: 12px; letter-spacing: 1.6px; text-transform: uppercase; color: #9fb0cc; }
.vx-pledge-vacant small { font-size: 11.5px; line-height: 1.5; color: #77879f; }

.vx-pledge-body { display: flex; flex-direction: column; gap: 13px; padding: 15px 18px 18px; }
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

.vx-pledge-join { margin-top: auto; padding: 0 18px 18px; }
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
  .vx-pledge-cards { grid-template-columns: 1fr; }
  .vx-pledge-stage { height: 180px; }
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
}

export class FactionPicker {
  private readonly surface: HTMLElement;
  private readonly shell: HTMLElement;
  /** The pan of cards. Its CHILDREN are rebuilt on every render; it is not. */
  private readonly cards: HTMLElement;
  /** The positioned box the cards scroll in and the bust canvas covers. */
  private readonly viewport: HTMLElement;
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
    footText.textContent = 'Point at a president to get their attention.';
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

    const total = data.factions.reduce((n, f) => n + f.memberCount, 0);

    data.factions.forEach((info, index) => {
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

      // --- the president's plinth -------------------------------------------
      const stage = document.createElement('div');
      stage.className = 'vx-pledge-stage';
      const slot = document.createElement('div');
      slot.className = 'vx-pledge-slot';
      const plinth = document.createElement('div');
      plinth.className = 'vx-pledge-plinth';
      stage.append(slot, plinth);

      const prez = info.president;
      if (prez && !bustStage.available) {
        // No GL context to spare: a monogram medallion rather than a bare plinth.
        const mug = document.createElement('div');
        mug.className = 'vx-pledge-mug';
        const ch = [...prez.username].find((c) => /\S/.test(c)) ?? '?';
        mug.textContent = ch.toUpperCase();
        slot.appendChild(mug);
      } else if (prez) {
        const key = `pledge:${prez.username.toLowerCase()}`;
        busts.push({
          key,
          cosmetics: sanitizeCosmetics(prez.cosmetics, skinSeed(prez.username)),
          slot,
          // The two plinths get different salutes so the screen never plays the
          // same animation twice side by side.
          pose: BUST_POSES[index % BUST_POSES.length],
        });
        stage.addEventListener('mouseenter', () => bustStage.setHover(key));
        stage.addEventListener('mouseleave', () => bustStage.setHover(null));
      } else {
        const vacant = document.createElement('div');
        vacant.className = 'vx-pledge-vacant';
        const glyph = document.createElement('span');
        glyph.innerHTML = iconSvg('crown');
        const label = document.createElement('b');
        label.textContent = 'The seat is vacant';
        const hint = document.createElement('small');
        hint.textContent = 'Nobody has won an election here yet. Join, stand a party, and it could be you inside the week.';
        vacant.append(glyph, label, hint);
        stage.appendChild(vacant);
      }

      // --- body --------------------------------------------------------------
      const body = document.createElement('div');
      body.className = 'vx-pledge-body';

      const who = document.createElement('div');
      who.className = 'vx-pledge-prez';
      const whoName = document.createElement('div');
      whoName.className = 'vx-pledge-prez-name';
      whoName.textContent = prez ? prez.username : 'No president';
      const whoParty = document.createElement('div');
      whoParty.className = 'vx-pledge-prez-party';
      whoParty.textContent = prez ? prez.partyName : 'Awaiting a candidate';
      who.append(whoName, whoParty);
      if (prez?.slogan) {
        const slogan = document.createElement('div');
        slogan.className = 'vx-pledge-prez-slogan';
        slogan.textContent = `“${prez.slogan}”`;
        who.appendChild(slogan);
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
}
