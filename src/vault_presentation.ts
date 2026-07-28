import type { EncounterSnapshot } from './vault_encounter';
import { BOSS_DEFINITIONS } from './vault_encounter';

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
  private readonly hpText: HTMLDivElement;
  private readonly phase: HTMLDivElement;
  private readonly poise: HTMLDivElement;
  private readonly cast: HTMLDivElement;
  private readonly details: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vault-cinematic';
    this.root.className = 'mc-font vault-boss-hud';
    this.root.style.cssText =
      'position:absolute;z-index:18;top:max(14px,env(safe-area-inset-top));' +
      'left:50%;transform:translateX(-50%);width:min(680px,72vw);display:none;' +
      'pointer-events:none;text-align:center;color:#fff;text-shadow:2px 2px #000;';
    this.name = document.createElement('div');
    this.name.style.cssText = 'font-size:16px;letter-spacing:2px;margin-bottom:5px;';
    const hp = document.createElement('div');
    hp.style.cssText =
      'height:18px;background:#16141e;border:2px solid #dfe6ff;position:relative;' +
      'box-shadow:0 2px 8px #000;';
    this.hpFill = document.createElement('div');
    this.hpFill.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:100%;transition:width .1s linear;';
    // Exact phase threshold lines.
    for (const left of [30, 65]) {
      const marker = document.createElement('i');
      marker.style.cssText =
        `position:absolute;left:${left}%;top:-3px;height:24px;width:2px;background:#fff;opacity:.8;z-index:2;`;
      hp.appendChild(marker);
    }
    this.hpText = document.createElement('div');
    this.hpText.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;';
    hp.append(this.hpFill, this.hpText);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:10px;margin-top:4px;';
    this.phase = document.createElement('div');
    this.poise = document.createElement('div');
    this.details = document.createElement('div');
    row.append(this.phase, this.poise, this.details);
    this.cast = document.createElement('div');
    this.cast.style.cssText =
      'height:14px;margin:5px auto 0;width:58%;color:#ffe7a3;font-size:11px;';
    this.root.append(this.name, hp, row, this.cast);
    parent.appendChild(this.root);
  }

  update(snapshot: EncounterSnapshot | null): void {
    const visible = snapshot && (snapshot.status === 'intro' ||
      snapshot.status === 'active' || snapshot.status === 'reset_grace');
    this.root.style.display = visible ? 'block' : 'none';
    if (!snapshot || !visible) return;
    const def = BOSS_DEFINITIONS[snapshot.kind];
    this.name.textContent = `${familyIcon(snapshot.family)} ${def.name} — ${def.title}`;
    this.name.style.color = def.color;
    this.hpFill.style.background =
      `linear-gradient(90deg,${def.color},color-mix(in srgb,${def.color} 65%,white))`;
    this.hpFill.style.width = `${Math.max(0, snapshot.hpPercent * 100)}%`;
    this.hpText.textContent = `${Math.ceil(snapshot.hp)} / ${snapshot.maxHp}`;
    this.phase.textContent = `PHASE ${snapshot.phase}/3`;
    this.poise.textContent = snapshot.exposedUntil > 0
      ? '✦ EXPOSED' : `POISE ${Math.round(snapshot.poise)}%`;
    const enrage = snapshot.enrage ? ' • ENRAGED'
      : snapshot.elapsed >= 300 ? ` • ENRAGE ${Math.max(0, Math.ceil(360 - snapshot.elapsed))}s` : '';
    this.details.textContent =
      `${snapshot.participants.length} raider${snapshot.participants.length === 1 ? '' : 's'} ` +
      `×${(1 + 0.6 * (snapshot.peakParticipants - 1)).toFixed(1)} • ` +
      `${snapshot.criticalObjects} objects • ${snapshot.actors.length} summons${enrage}`;
    this.cast.textContent = snapshot.status === 'reset_grace'
      ? 'ARENA EMPTY — RESETTING…'
      : snapshot.cast ? `CASTING: ${snapshot.cast.name}` : '';
  }

  hide(): void { this.update(null); }
}

export class VaultCinematic {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly subtitle: HTMLDivElement;
  private readonly skip: HTMLButtonElement;
  private timer = 0;
  private active = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;inset:0;z-index:17;display:none;pointer-events:none;' +
      'border-style:solid;border-color:#050508;border-width:10vh 0;' +
      'box-sizing:border-box;align-items:center;justify-content:center;flex-direction:column;' +
      'background:linear-gradient(90deg,rgba(0,0,0,.38),transparent,rgba(0,0,0,.38));';
    this.title = document.createElement('div');
    this.title.className = 'mc-font';
    this.title.style.cssText = 'font-size:clamp(20px,4vw,42px);letter-spacing:4px;text-shadow:3px 3px #000;';
    this.subtitle = document.createElement('div');
    this.subtitle.className = 'mc-font';
    this.subtitle.style.cssText = 'font-size:12px;margin-top:9px;color:#d8d8e8;text-shadow:2px 2px #000;';
    this.skip = document.createElement('button');
    this.skip.className = 'mc-font';
    this.skip.textContent = 'SKIP';
    this.skip.style.cssText =
      'position:absolute;right:18px;bottom:calc(10vh + 14px);pointer-events:auto;' +
      'padding:8px 14px;color:#fff;background:#30303a;border:2px solid #aaa;';
    this.skip.addEventListener('pointerdown', () => this.finish());
    this.root.append(this.title, this.subtitle, this.skip);
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (this.active && e.key === 'Escape') this.finish();
    });
    window.addEventListener('pointerdown', (e) => {
      if (this.active && e.button === 0 && e.target !== this.skip) this.finish();
    }, { capture: true });
  }

  play(snapshot: EncounterSnapshot, late = false): void {
    const def = BOSS_DEFINITIONS[snapshot.kind];
    this.active = true;
    this.timer = late ? 1 : 4;
    this.title.textContent = def.name.toUpperCase();
    this.title.style.color = def.color;
    this.subtitle.textContent =
      `${def.title}  •  VAULT TIER ${['I', 'II', 'III'][snapshot.tier - 1]}`;
    this.root.style.display = 'flex';
    document.body.classList.add('vault-cinematic-active');
  }

  update(dt: number): void {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer <= 0) this.finish();
  }

  finish(): void {
    this.active = false;
    this.root.style.display = 'none';
    document.body.classList.remove('vault-cinematic-active');
  }

  get playing(): boolean { return this.active; }
}

function familyIcon(family: EncounterSnapshot['family']): string {
  return family === 'crypt' ? '☠' : family === 'mire' ? '♨'
    : family === 'ember' ? '🔥' : family === 'crystal' ? '◆' : '⚙';
}
