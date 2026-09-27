// Player settings that live in this browser: graphics preset, audio levels,
// look sensitivity and comfort options. (Split out of VOXELON's vault
// presentation module; Worlds keeps the same presets and the same panel.)

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
  effectsVolume: number;
  cameraShake: number;
  reducedMotion: boolean;
  photosensitivitySafe: boolean;
  /** Multiplier on raw mouse/touch look deltas. 1 = the historical feel. */
  lookSensitivity: number;
  graphicsQuality: GraphicsQuality;
}

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  effectsVolume: 0.8,
  cameraShake: 1,
  reducedMotion: false,
  photosensitivitySafe: false,
  lookSensitivity: 1,
  graphicsQuality: 'high',
};

export function sanitizeAccessibility(raw: unknown): AccessibilitySettings {
  const x = raw && typeof raw === 'object' ? raw as Partial<AccessibilitySettings> : {};
  const volume = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
  return {
    effectsVolume: volume(x.effectsVolume, DEFAULT_ACCESSIBILITY.effectsVolume),
    cameraShake: volume(x.cameraShake, DEFAULT_ACCESSIBILITY.cameraShake),
    reducedMotion: x.reducedMotion === true,
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
      localStorage.getItem('worlds.accessibility') ?? 'null'));
  } catch { return { ...DEFAULT_ACCESSIBILITY }; }
}

export function saveAccessibility(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem('worlds.accessibility',
      JSON.stringify(sanitizeAccessibility(settings)));
  } catch { /* storage is optional */ }
}
