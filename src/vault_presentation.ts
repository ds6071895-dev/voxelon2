import type { EncounterSnapshot } from './vault_encounter';
import {
  BOSS_DEFINITIONS, ENCOUNTER_INTRO_SECONDS, ENCOUNTER_PHASE_TRANSITION_SECONDS,
  ENCOUNTER_VICTORY_CINEMATIC_SECONDS,
} from './vault_encounter';

export interface AccessibilitySettings {
  musicVolume: number;
  effectsVolume: number;
  cameraShake: number;
  reducedMotion: boolean;
  highContrastTelegraphs: boolean;
  photosensitivitySafe: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  musicVolume: 0.65,
  effectsVolume: 0.8,
  cameraShake: 1,
  reducedMotion: false,
  highContrastTelegraphs: false,
  photosensitivitySafe: false,
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

/** Dedicated encounter overlay. It owns no combat state and is snapshot-only. */
export class VaultBossHUD {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpLoss: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly phase: HTMLDivElement;
  private readonly poise: HTMLDivElement;
  private readonly cast: HTMLDivElement;
  private readonly details: HTMLDivElement;
  private displayedHp = 1;

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
        `position:absolute;left:${left}%;top:-3px;height:26px;width:2px;background:#fff;opacity:.82;z-index:3;`;
      hp.appendChild(marker);
    }
    this.hpText = document.createElement('div');
    this.hpText.style.cssText =
      'position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;font-size:clamp(8px,2.1vw,11px);';
    hp.append(this.hpLoss, this.hpFill, this.hpText);
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
    this.root.append(this.name, hp, row, this.cast);
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
    this.name.textContent = `${familyIcon(snapshot.family)} ${def.name} — ${def.title}`;
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
    this.phase.textContent =
      `PHASE ${snapshot.phase}/3 — ${def.phaseTitles[snapshot.phase - 1].toUpperCase()}`;
    this.poise.textContent = snapshot.healing.active
      ? `❤ HEALING +${snapshot.healing.rate.toFixed(1)}/s — DESTROY ${snapshot.healing.sources} SOURCE${snapshot.healing.sources === 1 ? '' : 'S'}`
      : snapshot.exposedUntil > 0
        ? `✦ EXPOSED ${snapshot.exposedUntil.toFixed(1)}s`
        : snapshot.criticalObjects > 0
          ? `🛡 DESTROY ${snapshot.criticalObjects} SOURCE${snapshot.criticalObjects === 1 ? '' : 'S'}`
          : `POISE ${Math.round(snapshot.poise)}%`;
    const enrage = snapshot.enrage ? ' • ENRAGED'
      : snapshot.elapsed >= 300 ? ` • ENRAGE ${Math.max(0, Math.ceil(360 - snapshot.elapsed))}s` : '';
    this.details.textContent =
      `${snapshot.participants.length} raider${snapshot.participants.length === 1 ? '' : 's'} ` +
      `×${(1 + 0.6 * (snapshot.peakParticipants - 1)).toFixed(1)} • ` +
      `WAVE ${snapshot.wave.number} • ${snapshot.wave.alive}/${snapshot.wave.cap} army${enrage}`;
    this.cast.textContent = snapshot.status === 'reset_grace'
      ? 'ARENA EMPTY — RESETTING…'
      : snapshot.status === 'intro' ? def.introLine.toUpperCase()
        : snapshot.cast ? `⚠ ${snapshot.cast.name.toUpperCase()}` : '';
  }

  hide(): void {
    this.displayedHp = 1;
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
      'align-items:center;justify-content:center;flex-direction:column;overflow:hidden;' +
      'border-style:solid;border-color:#020207;border-width:12vh 0;box-sizing:border-box;' +
      'background:radial-gradient(circle at 50% 50%,transparent 10%,rgba(0,0,0,.28) 60%,rgba(0,0,0,.7) 100%);';
    this.vignette = document.createElement('div');
    this.vignette.style.cssText =
      'position:absolute;inset:-10%;background:radial-gradient(ellipse,transparent 28%,rgba(0,0,0,.82) 82%);' +
      'opacity:.75;transform:scale(1.1);';
    this.sigil = document.createElement('div');
    this.sigil.className = 'mc-font';
    this.sigil.style.cssText =
      'position:absolute;font-size:clamp(110px,24vw,290px);opacity:.08;filter:blur(.3px);' +
      'text-shadow:0 0 42px currentColor;transform:scale(.75) rotate(-8deg);';
    this.eyebrow = document.createElement('div');
    this.eyebrow.className = 'mc-font';
    this.eyebrow.style.cssText =
      'position:relative;font-size:clamp(8px,1.6vw,12px);letter-spacing:clamp(3px,1vw,10px);' +
      'color:#d8d8e8;text-shadow:2px 2px #000;margin-bottom:12px;opacity:0;';
    this.title = document.createElement('div');
    this.title.className = 'mc-font';
    this.title.style.cssText =
      'position:relative;font-size:clamp(28px,7vw,76px);letter-spacing:clamp(3px,1.1vw,12px);' +
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

  private renderFrame(progress: number): void {
    const snapshot = this.snapshotValue;
    if (!snapshot) return;
    const def = BOSS_DEFINITIONS[snapshot.kind];
    const fadeIn = smoothstep(0, 0.14, progress);
    const fadeOut = 1 - smoothstep(0.84, 1, progress);
    const opacity = Math.min(fadeIn, fadeOut);
    const reveal = smoothstep(0.18, 0.48, progress);
    const pulse = 1 + Math.sin(progress * Math.PI * 8) * 0.018 * (1 - progress);
    this.root.style.opacity = String(Math.max(0, opacity));
    this.vignette.style.opacity = String(0.55 + progress * 0.3);
    this.sigil.style.opacity = String(0.03 + reveal * 0.1);
    this.sigil.style.transform = `scale(${0.72 + reveal * 0.38}) rotate(${-8 + progress * 18}deg)`;
    this.eyebrow.style.opacity = String(smoothstep(0.12, 0.32, progress) * fadeOut);
    this.title.style.opacity = String(reveal * fadeOut);
    this.title.style.transform = `scale(${(1.18 - reveal * 0.18) * pulse})`;
    this.subtitle.style.opacity = String(smoothstep(0.34, 0.58, progress) * fadeOut);
    this.subtitle.style.transform = `translateY(${(1 - reveal) * 12}px)`;

    if (this.modeValue === 'intro') {
      this.sigil.textContent = familyIcon(snapshot.family);
      this.eyebrow.textContent = progress < 0.3
        ? `VAULT TIER ${['I', 'II', 'III'][snapshot.tier - 1]}`
        : def.title.toUpperCase();
      this.title.textContent = progress < 0.24 ? 'THE VAULT AWAKENS' : def.name.toUpperCase();
      this.subtitle.textContent = progress < 0.54
        ? def.introLine
        : `${def.phaseTitles[0].toUpperCase()}  •  PREPARE YOURSELF`;
    } else if (this.modeValue === 'phase') {
      const p = this.phaseValue;
      this.sigil.textContent = p === 2 ? 'Ⅱ' : 'Ⅲ';
      this.eyebrow.textContent = `${def.name.toUpperCase()} TRANSFORMS`;
      this.title.textContent = `PHASE ${['I', 'II', 'III'][p - 1]}`;
      this.subtitle.textContent = def.phaseTitles[p - 1].toUpperCase();
    } else {
      this.sigil.textContent = '✦';
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
  return family === 'crypt' ? '☠' : family === 'mire' ? '♨'
    : family === 'ember' ? '🔥' : family === 'crystal' ? '◆' : '⚙';
}
