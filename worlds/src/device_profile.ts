// First-boot graphics guess. Phones and weak laptops used to open on `high`
// (DPR 2 + MSAA), which is roughly 4x the fill rate of `low`. This reads the
// cheap signals the browser exposes and steps the ladder down from there; a
// preset the player picks by hand always wins (settings.ts `graphicsAuto`).
import { GRAPHICS_ORDER, type GraphicsQuality } from './settings';
import { isTouchDevice } from './touch';

/** GPU strings that mean "no real GPU" — always the cheapest preset. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
/** Older or low-tier mobile/integrated GPUs: one rung lower. */
const WEAK_GPU = /mali-(4\d\d|t\d+|g[3-5]\d)\b|adreno[^0-9]*[2-5]\d\d\b|powervr|sgx|intel\b.*?\bhd graphics\b|\bgma\b/i;

function gpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

export interface DeviceProfile { quality: GraphicsQuality; gpu: string; touch: boolean }

export function detectDeviceProfile(): DeviceProfile {
  const touch = isTouchDevice();
  const gpu = gpuName();
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (SOFTWARE_GPU.test(gpu) || cores <= 2 || memory <= 2) return { quality: 'low', gpu, touch };
  let rung = GRAPHICS_ORDER.indexOf(touch ? 'medium' : 'high');
  if (cores <= 4 || memory <= 4) rung--;
  if (WEAK_GPU.test(gpu)) rung--;
  return { quality: GRAPHICS_ORDER[Math.max(0, rung)], gpu, touch };
}
