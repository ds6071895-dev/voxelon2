import type { EncounterSnapshot, HazardShape } from './vault_encounter';
import {
  BOSS_DEFINITIONS, ENCOUNTER_ENRAGE_SECONDS, ENCOUNTER_INTRO_SECONDS, ENCOUNTER_PHASE_TRANSITION_SECONDS,
  ENCOUNTER_VICTORY_CINEMATIC_SECONDS,
} from './vault_encounter';
import { BOSS_SCORE_PROFILES, bossScoreLoopSeconds } from './boss_music';
import { DEFAULT_MUSIC_VOLUME } from './audio';
import { iconSvg } from './emoji_icons';

/** "Ossuary Oath · 5:03" — the score a vault family fights to. Announcing it
 *  in the intro is what makes the encounter read as a set piece with a
 *  soundtrack rather than a mob with a health bar. */
function scoreCredit(family: EncounterSnapshot['family']): string {
  const seconds = Math.round(bossScoreLoopSeconds(family));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return `${iconSvg('music')} ${BOSS_SCORE_PROFILES[family].title.toUpperCase()} · ${clock}`;
}

/** Graphics presets. A browser voxel game runs on whatever hardware opens the
 *  tab, and render distance is by far the most expensive dial (chunk meshing +
 *  draw calls + fog depth), with device pixel ratio second. `antialias` is
 *  fixed when the WebGL context is created, so it is read at boot only — see
 *  the note on the renderer in main.ts.
 *
 *  The ladder is ordered cheapest-first and every rung is a superset of the one
 *  below it, so `GRAPHICS_ORDER` can be used to compare two settings. */
export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra' | 'max';

export interface GraphicsPreset {
  /** Chunks streamed around the player. Must never exceed world.ts's
   *  RENDER_DISTANCE, which sizes the precomputed streaming spiral. */
  renderDistance: number;
  /** Upper bound on devicePixelRatio (hidpi screens cost 4x fill rate). */
  pixelRatioCap: number;
  /** MSAA. Applied on the next reload, not live. */
  antialias: boolean;
  /** Per-vertex light averaged over the four cells touching each corner
   *  instead of one flat level per face. Costs meshing time (a full remesh on
   *  toggle), nothing at all per frame. */
  smoothLighting: boolean;
  /** Post-processing stack: bloom + filmic grade. Costs fill rate per frame. */
  shaders: boolean;
  label: string;
}

export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: {
    renderDistance: 4, pixelRatioCap: 1, antialias: false,
    smoothLighting: false, shaders: false, label: 'Low',
  },
  medium: {
    renderDistance: 6, pixelRatioCap: 1.5, antialias: true,
    smoothLighting: false, shaders: false, label: 'Medium',
  },
  high: {
    renderDistance: 8, pixelRatioCap: 2, antialias: true,
    smoothLighting: false, shaders: false, label: 'High',
  },
  ultra: {
    renderDistance: 10, pixelRatioCap: 2, antialias: true,
    smoothLighting: true, shaders: false, label: 'Extra High',
  },
  max: {
    renderDistance: 12, pixelRatioCap: 2, antialias: true,
    smoothLighting: true, shaders: true, label: 'Max',
  },
};

/** Cheapest to most expensive. */
export const GRAPHICS_ORDER: GraphicsQuality[] =
  ['low', 'medium', 'high', 'ultra', 'max'];

export const MIN_LOOK_SENSITIVITY = 0.25;
export const MAX_LOOK_SENSITIVITY = 3;

export interface AccessibilitySettings {
  musicVolume: number;
  effectsVolume: number;
  cameraShake: number;
  reducedMotion: boolean;
  highContrastTelegraphs: boolean;
  photosensitivitySafe: boolean;
  /** Multiplier on raw mouse/touch look deltas. 1 = the historical feel. */
  lookSensitivity: number;
  graphicsQuality: GraphicsQuality;
}

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  musicVolume: DEFAULT_MUSIC_VOLUME,
  effectsVolume: 0.8,
  cameraShake: 1,
  reducedMotion: false,
  highContrastTelegraphs: false,
  photosensitivitySafe: false,
  lookSensitivity: 1,
  graphicsQuality: 'high',
};

export function sanitizeAccessibility(raw: unknown): AccessibilitySettings {
  const x = raw && typeof raw === 'object' ? raw as Partial<AccessibilitySettings> : {};
  const volume = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
  return {
    musicVolume: volume(x.musicVolume, DEFAULT_ACCESSIBILITY.musicVolume),
    effectsVolume: volume(x.effectsVolume, DEFAULT_ACCESSIBILITY.effectsVolume),
    cameraShake: volume(x.cameraShake, DEFAULT_ACCESSIBILITY.cameraShake),
    reducedMotion: x.reducedMotion === true,
    highContrastTelegraphs: x.highContrastTelegraphs === true,
    photosensitivitySafe: x.photosensitivitySafe === true,
    lookSensitivity: typeof x.lookSensitivity === 'number' && Number.isFinite(x.lookSensitivity)
      ? Math.max(MIN_LOOK_SENSITIVITY, Math.min(MAX_LOOK_SENSITIVITY, x.lookSensitivity))
      : DEFAULT_ACCESSIBILITY.lookSensitivity,
    graphicsQuality:
      typeof x.graphicsQuality === 'string'
        && (GRAPHICS_ORDER as string[]).includes(x.graphicsQuality)
        ? x.graphicsQuality as GraphicsQuality
        : DEFAULT_ACCESSIBILITY.graphicsQuality,
  };
}

export function loadAccessibility(): AccessibilitySettings {
  try {
    return sanitizeAccessibility(JSON.parse(
      localStorage.getItem('voxelon.accessibility') ?? 'null'));
  } catch { return { ...DEFAULT_ACCESSIBILITY }; }
}

export function saveAccessibility(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem('voxelon.accessibility',
      JSON.stringify(sanitizeAccessibility(settings)));
  } catch { /* storage is optional */ }
}

// --- In-fight coaching -------------------------------------------------------
// Everything below turns the authoritative snapshot into one plain-language
// instruction, so the HUD can answer "what am I supposed to be doing right now?".

export type CoachTone = 'info' | 'good' | 'warn' | 'danger';
export interface CoachLine {
  text: string;
  tone: CoachTone;
}

/** How long the big "here is how this phase works" card stays up. */
export const PHASE_BRIEF_SECONDS = 11;

const TONE_COLOR: Record<CoachTone, string> = {
  info: '#cfe0ff', good: '#8dffb0', warn: '#ffd86a', danger: '#ff8f7a',
};

/** How you survive each telegraph shape, phrased as an instruction. Derived
 *  from the very same geometry `hazardContains` tests, so the advice can never
 *  drift from the hitbox. */
export function hazardAdvice(shape: HazardShape): string {
  switch (shape) {
    case 'line': return 'step SIDEWAYS out of the lane';
    case 'cone': return 'get out of the wedge — go around its side';
    case 'ring': return 'the ring hits at that distance only — close right in or sprint clear';
    case 'quadrant': return 'that quarter of the floor — move to a clear one';
    case 'rain': return 'keep moving, do not stand in the marked circles';
    default: return 'step out of the marked circle';
  }
}

/** The single most useful instruction for the current instant of the fight.
 *  Pure: HUD-only, snapshot-only, no combat state of its own. */
export function encounterCoach(
  snapshot: EncounterSnapshot, incomingWindow = 1.8,
): CoachLine {
  const def = BOSS_DEFINITIONS[snapshot.kind];
  if (snapshot.status === 'intro') {
    return { text: def.phaseBriefs[0], tone: 'info' };
  }
  if (snapshot.status === 'reset_grace') {
    return { text: 'Everyone left the arena — the boss is resetting to full health.', tone: 'warn' };
  }
  if (snapshot.status !== 'active') return { text: '', tone: 'info' };

  // 1. Something is about to land on you. Nothing else matters for ~2 seconds.
  let soonest: EncounterSnapshot['hazards'][number] | null = null;
  for (const h of snapshot.hazards) {
    const left = h.executeAt - snapshot.time;
    if (left < 0 || left > incomingWindow) continue;
    if (!soonest || h.executeAt < soonest.executeAt) soonest = h;
  }
  if (soonest) {
    const name = (soonest.attack || snapshot.cast?.name || 'INCOMING').toUpperCase();
    return { text: `${iconSvg('warning')} ${name} — ${hazardAdvice(soonest.shape)}!`, tone: 'danger' };
  }

  if (snapshot.enrage) {
    return { text: `${iconSvg('skull')} ENRAGED — attacks and movement are accelerating. Finish the fight.`, tone: 'danger' };
  }
  if (snapshot.wave.alive >= 6) {
    return {
      text: `${iconSvg('swords')} ${snapshot.wave.alive} summons on you — thin them out before you push the boss.`,
      tone: 'warn',
    };
  }
  return { text: def.phaseBriefs[snapshot.phase - 1], tone: 'info' };
}

/** Dedicated encounter overlay. It owns no combat state and is snapshot-only. */
export class VaultBossHUD {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpLoss: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly hpBar: HTMLDivElement;
  private readonly hpFlash: HTMLDivElement;
  private readonly tally: HTMLDivElement;
  private readonly markers: HTMLElement[] = [];
  private readonly phase: HTMLDivElement;
  private readonly poise: HTMLDivElement;
  private readonly cast: HTMLDivElement;
  private readonly details: HTMLDivElement;
  private readonly coach: HTMLDivElement;
  private readonly brief: HTMLDivElement;
  private displayedHp = 1;
  /** Raw HP last frame (for the tally), the running chunk and when it last grew. */
  private lastHpRaw = -1;
  private lastEncounter = '';
  private tallyValue = 0;
  private tallyAt = 0;
  private shakeUntil = 0;
  /** Phase the brief card is currently showing, and how long it has been up.
   *  HUD-local: the snapshot has no per-phase clock and does not need one. */
  private briefPhase = -1;
  private briefAt = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'mc-font vault-boss-hud';
    this.root.style.cssText =
      'position:absolute;z-index:18;top:max(14px,env(safe-area-inset-top));' +
      'left:50%;transform:translateX(-50%);width:min(680px,calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));' +
      'display:none;pointer-events:none;text-align:center;color:#fff;text-shadow:2px 2px #000;';
    this.name = document.createElement('div');
    this.name.style.cssText =
      'font-size:clamp(12px,2.7vw,16px);letter-spacing:clamp(1px,.45vw,3px);margin-bottom:5px;';
    const hp = document.createElement('div');
    hp.style.cssText =
      'height:clamp(14px,3.2vw,20px);background:#0e0d16;border:2px solid #dfe6ff;position:relative;' +
      'overflow:hidden;box-shadow:0 2px 12px #000,0 0 18px rgba(255,255,255,.12);';
    this.hpLoss = document.createElement('div');
    this.hpLoss.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:100%;background:#fff0a0;' +
      'transition:width .55s cubic-bezier(.2,.8,.2,1);opacity:.65;';
    this.hpFill = document.createElement('div');
    this.hpFill.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:100%;transition:width .12s linear;' +
      'box-shadow:inset 0 1px rgba(255,255,255,.45),0 0 12px currentColor;';
    for (const left of [35, 70]) {
      const marker = document.createElement('i');
      marker.style.cssText =
        `position:absolute;left:${left}%;top:-3px;height:26px;width:2px;background:#fff;opacity:.82;z-index:3;` +
        'transition:opacity .4s,background .4s;';
      hp.appendChild(marker);
      this.markers.push(marker);
    }
    // A white flash laid over the bar on every chunk of damage, and a running
    // "-N" tally beside it: the fight's damage is FELT on the bar, not read.
    this.hpFlash = document.createElement('div');
    this.hpFlash.style.cssText =
      'position:absolute;inset:0;z-index:2;background:#fff;opacity:0;transition:opacity .22s ease-out;';
    hp.appendChild(this.hpFlash);
    this.hpBar = hp;
    this.hpText = document.createElement('div');
    this.hpText.style.cssText =
      'position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;font-size:clamp(8px,2.1vw,11px);';
    hp.append(this.hpLoss, this.hpFill, this.hpText);
    this.tally = document.createElement('div');
    this.tally.style.cssText =
      'position:absolute;right:6px;top:15px;z-index:5;padding:3px 7px;line-height:1;border-radius:4px;' +
      'background:rgba(0,0,0,.62);font-size:clamp(11px,2.4vw,15px);' +
      'color:#ffe28a;text-shadow:2px 2px #000,0 0 10px rgba(255,190,60,.7);opacity:0;transition:opacity .3s;' +
      'white-space:nowrap;';
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;justify-content:space-between;gap:8px;font-size:clamp(8px,2vw,10px);margin-top:4px;';
    this.phase = document.createElement('div');
    this.poise = document.createElement('div');
    this.details = document.createElement('div');
    row.append(this.phase, this.poise, this.details);
    this.cast = document.createElement('div');
    this.cast.style.cssText =
      'min-height:14px;margin:5px auto 0;width:min(82%,520px);color:#ffe7a3;' +
      'font-size:clamp(9px,2.2vw,11px);letter-spacing:.7px;';
    // The coaching strip: one instruction, always answering "what do I do now?".
    this.coach = document.createElement('div');
    this.coach.style.cssText =
      'margin:6px auto 0;width:min(94%,600px);padding:5px 10px;box-sizing:border-box;' +
      'background:rgba(6,8,14,.82);border:1px solid rgba(255,255,255,.16);border-left-width:4px;' +
      'border-radius:4px;font-size:clamp(9px,2.2vw,12px);line-height:1.45;letter-spacing:.3px;' +
      'display:none;';
    // The phase brief: the same coaching, held up big for a few seconds each
    // time the fight changes shape (that is when players are most lost).
    this.brief = document.createElement('div');
    this.brief.style.cssText =
      'margin:7px auto 0;width:min(94%,620px);padding:8px 12px;box-sizing:border-box;' +
      'background:rgba(10,7,2,.86);border:1px solid rgba(255,216,74,.5);border-radius:5px;' +
      'color:#ffe08a;font-size:clamp(10px,2.5vw,13px);line-height:1.5;display:none;' +
      'box-shadow:0 6px 26px rgba(0,0,0,.6);';
    this.root.append(this.name, hp, row, this.cast, this.coach, this.brief, this.tally);
    parent.appendChild(this.root);
  }

  update(snapshot: EncounterSnapshot | null): void {
    const cinematic = document.body.classList.contains('vault-cinematic-active');
    const inGame = document.body.classList.contains('in-game');
    const visible = inGame && !cinematic && snapshot && (snapshot.status === 'intro' ||
      snapshot.status === 'active' || snapshot.status === 'reset_grace');
    this.root.style.display = visible ? 'block' : 'none';
    if (!snapshot || !visible) return;
    const def = BOSS_DEFINITIONS[snapshot.kind];
    this.name.innerHTML = `${familyIcon(snapshot.family)} ${def.name} — ${def.title}`;
    this.name.style.color = def.color;
    this.hpFill.style.background =
      `linear-gradient(90deg,${def.color},color-mix(in srgb,${def.color} 62%,white))`;
    const hp = Math.max(0, snapshot.hpPercent);
    this.hpFill.style.width = `${hp * 100}%`;
    if (hp > this.displayedHp) {
      // Encounter scaling or a reset may raise HP; adopt it immediately rather
      // than animating the damage trail backwards.
      this.displayedHp = hp;
      this.hpLoss.style.width = `${hp * 100}%`;
    } else if (hp < this.displayedHp - 0.0001) {
      // Only schedule a trail transition when HP actually changes. The HUD is
      // updated every frame, so unconditional RAFs would otherwise accumulate.
      this.hpLoss.style.width = `${this.displayedHp * 100}%`;
      this.displayedHp = hp;
      requestAnimationFrame(() => { this.hpLoss.style.width = `${hp * 100}%`; });
    }
    this.hpText.textContent = `${Math.ceil(snapshot.hp)} / ${snapshot.maxHp}`;
    // Damage feel: flash + tally + a small shake scaled by the chunk size.
    const now = performance.now();
    if (snapshot.encounterId !== this.lastEncounter) {
      this.lastEncounter = snapshot.encounterId;
      this.lastHpRaw = snapshot.hp;
      this.tallyValue = 0;
    }
    const lost = this.lastHpRaw - snapshot.hp;
    this.lastHpRaw = snapshot.hp;
    if (lost > 0.5 && snapshot.status === 'active') {
      this.tallyValue = (now - this.tallyAt < 1400 ? this.tallyValue : 0) + lost;
      this.tallyAt = now;
      this.tally.textContent = `-${Math.round(this.tallyValue)}`;
      this.tally.style.opacity = '1';
      this.tally.style.fontSize = `clamp(11px,2.4vw,${Math.round(15 + Math.min(7, this.tallyValue / snapshot.maxHp * 120))}px)`;
      this.hpFlash.style.transition = 'none';
      this.hpFlash.style.opacity = String(Math.min(0.7, 0.25 + lost / snapshot.maxHp * 12));
      void this.hpFlash.offsetWidth;
      this.hpFlash.style.transition = 'opacity .22s ease-out';
      this.hpFlash.style.opacity = '0';
      this.shakeUntil = now + Math.min(260, 90 + lost / snapshot.maxHp * 2500);
    } else if (now - this.tallyAt > 1400) {
      this.tally.style.opacity = '0';
    }
    const calmBar = document.body.classList.contains('reduced-motion');
    this.hpBar.style.transform = now < this.shakeUntil && !calmBar
      ? `translate(${(Math.sin(now * 0.09) * 2.5).toFixed(1)}px,${(Math.cos(now * 0.13) * 1.5).toFixed(1)}px)`
      : '';
    // Phase thresholds already crossed go dim; the next one glows.
    this.markers.forEach((marker, i) => {
      const at = i === 0 ? 0.35 : 0.7;
      marker.style.opacity = hp < at ? '0.25' : '0.95';
      marker.style.background = hp >= at && hp - at < 0.08 ? '#ffd86a' : '#fff';
    });
    this.phase.textContent =
      `PHASE ${snapshot.phase}/3 — ${def.phaseTitles[snapshot.phase - 1].toUpperCase()}`;
    this.poise.textContent = snapshot.enrage
      ? 'DAMAGE OPEN • MAXIMUM THREAT'
      : `DAMAGE OPEN • PHASE ${snapshot.phase} PRESSURE`;
    // The countdown shows for the last minute before the enrage — which fires
    // at ENCOUNTER_ENRAGE_SECONDS (it used to be keyed to an old 360s timer,
    // so the warning never appeared at all).
    const enrageLeft = ENCOUNTER_ENRAGE_SECONDS - snapshot.elapsed;
    const enrage = snapshot.enrage ? ' • ENRAGED'
      : enrageLeft <= 60 ? ` • ENRAGE ${Math.max(0, Math.ceil(enrageLeft))}s` : '';
    this.details.textContent =
      `${snapshot.participants.length} raider${snapshot.participants.length === 1 ? '' : 's'} ` +
      `×${(1 + 0.7 * (snapshot.peakParticipants - 1)).toFixed(1)} • ` +
      `WAVE ${snapshot.wave.number} • ${snapshot.wave.alive}/${snapshot.wave.cap} army${enrage}`;
    // Desperation: once the boss enrages or drops into its last sliver of
    // health the whole bar throbs, so the kill window is felt, not read.
    // Suppressed for players who asked for reduced motion or safe effects.
    const calm = document.body.classList.contains('reduced-motion') ||
      document.body.classList.contains('photosensitivity-safe');
    if ((snapshot.enrage || hp <= 0.15) && !calm) {
      const beat = 0.5 + 0.5 * Math.sin(performance.now() * 0.0138);
      this.root.style.filter =
        `drop-shadow(0 0 ${(5 + beat * 15).toFixed(1)}px rgba(255,72,48,${(0.3 + beat * 0.5).toFixed(2)}))`;
      this.root.style.transform = `translateX(-50%) scale(${(1 + beat * 0.013).toFixed(4)})`;
    } else {
      this.root.style.filter = 'none';
      this.root.style.transform = 'translateX(-50%)';
    }
    this.cast.innerHTML = snapshot.status === 'reset_grace'
      ? 'ARENA EMPTY — RESETTING…'
      : snapshot.status === 'intro' ? def.introLine.toUpperCase()
        : snapshot.cast ? `${iconSvg('warning')} ${snapshot.cast.name.toUpperCase()}` : '';

    // Coaching. The strip is live every frame; the brief is raised for a few
    // seconds whenever the fight changes shape, which is exactly when a player
    // stops understanding what the boss wants from them.
    const coach = encounterCoach(snapshot);
    this.coach.style.display = coach.text ? 'block' : 'none';
    if (coach.text) {
      this.coach.innerHTML = coach.text;
      this.coach.style.color = TONE_COLOR[coach.tone];
      this.coach.style.borderLeftColor = TONE_COLOR[coach.tone];
    }
    const stage = snapshot.status === 'intro' ? 0 : snapshot.phase;
    if (stage !== this.briefPhase) {
      this.briefPhase = stage;
      this.briefAt = performance.now();
    }
    const briefUp = stage > 0 &&
      (performance.now() - this.briefAt) / 1000 < PHASE_BRIEF_SECONDS;
    this.brief.style.display = briefUp ? 'block' : 'none';
    if (briefUp) {
      this.brief.textContent =
        `PHASE ${snapshot.phase} — ${def.phaseBriefs[snapshot.phase - 1]}`;
    }
  }

  hide(): void {
    this.displayedHp = 1;
    this.briefPhase = -1;
    this.lastEncounter = '';
    this.tallyValue = 0;
    this.tally.style.opacity = '0';
    this.update(null);
  }
}

export type VaultCinematicMode = 'intro' | 'phase' | 'victory';

export interface VaultCinematicFrame {
  mode: VaultCinematicMode;
  progress: number;
  eased: number;
  snapshot: EncounterSnapshot;
  phase: number;
}

export class VaultCinematic {
  private readonly root: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly sigil: HTMLDivElement;
  private readonly eyebrow: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly subtitle: HTMLDivElement;
  private active = false;
  private reducedMotion = false;
  private elapsed = 0;
  private duration = 0;
  private modeValue: VaultCinematicMode = 'intro';
  private snapshotValue: EncounterSnapshot | null = null;
  private phaseValue = 1;
  private readonly pointers = new Set<number>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vault-cinematic';
    this.root.style.cssText =
      'position:absolute;inset:0;z-index:100;display:none;pointer-events:none;' +
      'align-items:center;justify-content:flex-end;flex-direction:column;overflow:hidden;padding:0 4vw 3vh;' +
      'border-style:solid;border-color:#020207;border-width:12vh 0;box-sizing:border-box;' +
      'background:radial-gradient(circle at 50% 50%,transparent 10%,rgba(0,0,0,.28) 60%,rgba(0,0,0,.7) 100%);';
    this.vignette = document.createElement('div');
    this.vignette.style.cssText =
      'position:absolute;inset:-10%;background:radial-gradient(ellipse,transparent 28%,rgba(0,0,0,.82) 82%);' +
      'opacity:.75;transform:scale(1.1);';
    this.sigil = document.createElement('div');
    this.sigil.className = 'mc-font';
    this.sigil.style.cssText =
      'position:absolute;top:8%;right:6%;font-size:clamp(80px,15vw,190px);opacity:.05;filter:blur(.3px);' +
      'text-shadow:0 0 42px currentColor;transform:scale(.75) rotate(-8deg);';
    this.eyebrow = document.createElement('div');
    this.eyebrow.className = 'mc-font';
    this.eyebrow.style.cssText =
      'position:relative;font-size:clamp(8px,1.6vw,12px);letter-spacing:clamp(3px,1vw,10px);' +
      'color:#d8d8e8;text-shadow:2px 2px #000;margin-bottom:12px;opacity:0;';
    this.title = document.createElement('div');
    this.title.className = 'mc-font';
    this.title.style.cssText =
      'position:relative;font-size:clamp(26px,5vw,56px);letter-spacing:clamp(3px,1.1vw,12px);' +
      'line-height:1;text-align:center;text-shadow:0 3px #000,0 8px 28px #000,0 0 26px currentColor;' +
      'opacity:0;transform:scale(1.2);';
    this.subtitle = document.createElement('div');
    this.subtitle.className = 'mc-font';
    this.subtitle.style.cssText =
      'position:relative;font-size:clamp(9px,2vw,14px);margin-top:14px;color:#e7e7f3;' +
      'letter-spacing:clamp(1px,.45vw,4px);text-align:center;max-width:min(840px,86vw);line-height:1.55;' +
      'text-shadow:2px 2px #000;opacity:0;transform:translateY(12px);';
    this.root.append(this.vignette, this.sigil, this.eyebrow, this.title, this.subtitle);
    parent.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (this.active && e.key === 'Escape' && this.elapsed > 1.5) this.finish();
    });
    window.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.pointers.add(e.pointerId);
      if (this.pointers.size >= 2 && this.elapsed > 1.5) this.finish();
    }, { capture: true });
    const release = (e: PointerEvent): void => { this.pointers.delete(e.pointerId); };
    window.addEventListener('pointerup', release, { capture: true });
    window.addEventListener('pointercancel', release, { capture: true });
  }

  /** Returns true only when a full introduction was actually started. */
  play(snapshot: EncounterSnapshot, late = false): boolean {
    if (late) return false;
    const def = BOSS_DEFINITIONS[snapshot.kind];
    this.modeValue = 'intro';
    this.phaseValue = snapshot.phase;
    this.show(snapshot, ENCOUNTER_INTRO_SECONDS, def.color);
    return true;
  }

  playPhase(snapshot: EncounterSnapshot, phase = snapshot.phase): void {
    const def = BOSS_DEFINITIONS[snapshot.kind];
    this.modeValue = 'phase';
    this.phaseValue = Math.max(1, Math.min(3, Math.floor(phase)));
    this.show(snapshot, ENCOUNTER_PHASE_TRANSITION_SECONDS, def.color);
  }

  playVictory(snapshot: EncounterSnapshot): void {
    this.modeValue = 'victory';
    this.phaseValue = snapshot.phase;
    this.show(snapshot, ENCOUNTER_VICTORY_CINEMATIC_SECONDS, '#ffd84a');
  }

  private show(snapshot: EncounterSnapshot, duration: number, color: string): void {
    this.active = true;
    this.elapsed = 0;
    this.duration = duration;
    this.snapshotValue = snapshot;
    this.pointers.clear();
    this.root.style.color = color;
    this.root.style.display = 'flex';
    this.renderFrame(0);
    document.body.classList.add('vault-cinematic-active');
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    const p = Math.max(0, Math.min(1, this.elapsed / Math.max(0.01, this.duration)));
    this.renderFrame(p);
    if (p >= 1) this.finish();
  }

  setReducedMotion(value: boolean): void { this.reducedMotion = value; }

  private renderFrame(progress: number): void {
    const snapshot = this.snapshotValue;
    if (!snapshot) return;
    const def = BOSS_DEFINITIONS[snapshot.kind];
    const fadeIn = smoothstep(0, 0.14, progress);
    const fadeOut = 1 - smoothstep(0.84, 1, progress);
    const opacity = Math.min(fadeIn, fadeOut);
    const reveal = smoothstep(0.18, 0.48, progress);
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(progress * Math.PI * 2) * 0.012;
    this.root.style.opacity = String(Math.max(0, opacity));
    this.vignette.style.opacity = String(0.55 + progress * 0.3);
    this.sigil.style.opacity = String(0.02 + reveal * 0.035);
    this.sigil.style.transform = `scale(${0.72 + reveal * 0.38}) rotate(${-8 + progress * 18}deg)`;
    this.eyebrow.style.opacity = String(smoothstep(0.12, 0.32, progress) * fadeOut);
    this.title.style.opacity = String(reveal * fadeOut);
    this.title.style.transform = `scale(${this.reducedMotion ? 1 : (1.06 - reveal * 0.06) * pulse})`;
    this.subtitle.style.opacity = String(smoothstep(0.34, 0.58, progress) * fadeOut);
    this.subtitle.style.transform = `translateY(${(1 - reveal) * 12}px)`;

    if (this.modeValue === 'intro') {
      this.sigil.innerHTML = familyIcon(snapshot.family);
      this.eyebrow.textContent = progress < 0.3
        ? `VAULT TIER ${['I', 'II', 'III'][snapshot.tier - 1]}`
        : def.title.toUpperCase();
      this.title.textContent = progress < 0.24 ? 'THE VAULT AWAKENS' : def.name.toUpperCase();
      // Three beats: the threat, then the score credit, then the call to arms.
      this.subtitle.innerHTML = progress < 0.44
        ? def.introLine
        : progress < 0.62
          ? scoreCredit(snapshot.family)
          : progress < 0.84
            ? def.phaseBriefs[0]
            : `${def.phaseTitles[0].toUpperCase()}  •  PREPARE YOURSELF`;
    } else if (this.modeValue === 'phase') {
      const p = this.phaseValue;
      this.sigil.innerHTML = p === 2 ? 'Ⅱ' : 'Ⅲ';
      this.eyebrow.textContent = `${def.name.toUpperCase()} TRANSFORMS`;
      this.title.textContent = `PHASE ${['I', 'II', 'III'][p - 1]}`;
      // The transform is the moment the rules change, so the card says what the
      // new rules ARE rather than only naming them.
      this.subtitle.textContent = progress < 0.42
        ? def.phaseTitles[p - 1].toUpperCase()
        : def.phaseBriefs[p - 1];
    } else {
      this.sigil.innerHTML = iconSvg('star');
      this.eyebrow.textContent = `${def.name.toUpperCase()} HAS FALLEN`;
      this.title.textContent = progress < 0.4 ? 'THE FINAL BLOW' : 'VAULT CONQUERED';
      this.subtitle.textContent = `${def.victoryLine}  •  THE TREASURE AWAKENS`;
    }
  }

  finish(): void {
    if (!this.active && this.root.style.display === 'none') return;
    this.active = false;
    this.elapsed = 0;
    this.duration = 0;
    this.snapshotValue = null;
    this.pointers.clear();
    this.root.style.display = 'none';
    this.root.style.opacity = '0';
    document.body.classList.remove('vault-cinematic-active');
  }

  get playing(): boolean { return this.active; }
  get frame(): VaultCinematicFrame | null {
    if (!this.active || !this.snapshotValue) return null;
    const progress = Math.max(0, Math.min(1, this.elapsed / Math.max(0.01, this.duration)));
    return {
      mode: this.modeValue,
      progress,
      eased: smoothstep(0, 1, progress),
      snapshot: this.snapshotValue,
      phase: this.phaseValue,
    };
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(0.0001, b - a)));
  return t * t * (3 - 2 * t);
}

function familyIcon(family: EncounterSnapshot['family']): string {
  return family === 'crypt' ? iconSvg('skull') : family === 'mire' ? iconSvg('droplet')
    : family === 'ember' ? iconSvg('flame') : family === 'crystal' ? iconSvg('diamond') : iconSvg('gear');
}
