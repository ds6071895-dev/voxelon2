// A tiny 8x8 pixel portrait of a player's look, for the account chip and the
// party list. Drawn from the same cosmetic palettes the 3D avatar uses, so the
// face in the corner is recognisably the character on the plinth.

import {
  EYE_COLORS, HAIR_COLORS, HAT_COLORS, SKIN_TONES, defaultCosmetics, sanitizeCosmetics,
  type Cosmetics,
} from '../character';

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
function shade(hex: number, k: number): string {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}

export function drawFace(canvas: HTMLCanvasElement, cosmetics: Cosmetics | undefined, seed: number): void {
  const c = cosmetics ? sanitizeCosmetics(cosmetics, seed) : defaultCosmetics(seed);
  canvas.width = 8; canvas.height = 8;
  const g = canvas.getContext('2d');
  if (!g) return;
  const skin = SKIN_TONES[c.skin]?.hex ?? 0xeec39a;
  const hair = HAIR_COLORS[c.hair]?.hex ?? 0x3b2a20;
  const eyes = EYE_COLORS[c.eyes]?.hex ?? 0x3a5fa8;
  g.fillStyle = css(skin); g.fillRect(0, 0, 8, 8);
  g.fillStyle = shade(skin, .86); g.fillRect(0, 6, 8, 2);
  // Hair: a fringe across the top and down the sides (none when shaved).
  if (c.hairStyle !== 6) {
    g.fillStyle = css(hair);
    g.fillRect(0, 0, 8, 2);
    g.fillRect(0, 2, 1, c.hairStyle === 1 ? 5 : 2);
    g.fillRect(7, 2, 1, c.hairStyle === 1 ? 5 : 2);
  }
  // Eyes: white with the iris on the inside edge.
  g.fillStyle = '#ffffff'; g.fillRect(1, 3, 2, 1); g.fillRect(5, 3, 2, 1);
  g.fillStyle = css(eyes); g.fillRect(2, 3, 1, 1); g.fillRect(5, 3, 1, 1);
  // Mouth.
  g.fillStyle = shade(skin, .6); g.fillRect(3, 5, 2, 1);
  // A hat caps the top rows in its colour.
  if (c.hat > 0) {
    g.fillStyle = css(HAT_COLORS[c.hatColor]?.hex ?? 0x24262b);
    g.fillRect(0, 0, 8, 2);
  }
}

export function faceCanvas(cosmetics: Cosmetics | undefined, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  drawFace(canvas, cosmetics, seed);
  return canvas;
}
