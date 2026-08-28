// LIVE AVATAR BUSTS for the Duels leaderboard.
//
// A ladder of usernames is a spreadsheet. A ladder of FACES is a hall of fame —
// so every row on the board renders the real, cosmetics-accurate top half of
// that account's character, and salutes when you point at it.
//
// The hard constraint is context count: a browser will hand out roughly a dozen
// WebGL contexts per page and the game already owns one, so "a <canvas> per
// row" is not an option. Instead ONE renderer is stretched across the whole
// leaderboard and each row is drawn into its own scissor rectangle, tracked
// from the row's DOM box every frame. That costs a single context and a single
// clear no matter how long the board gets, and it survives the rows moving —
// hover lift, scroll, resize — because the rectangles are re-read, never cached.
//
// Idle busts breathe. A hovered bust dollies out, spins a few degrees and
// throws a pose, and the whole thing eases back when the pointer leaves.

import * as THREE from 'three';
import type { Cosmetics } from './character';
import { AvatarBody, buildAvatarBody, disposeAvatarBody } from './remoteplayers';

/** Which salute a bust throws on hover. Assigned by placement so the podium
 *  never plays the same animation three times in a row. */
export type BustPose = 'salute' | 'flex' | 'point';

export const BUST_POSES: readonly BustPose[] = ['salute', 'flex', 'point'];

export interface BustEntry {
  /** Stable identity (lowercased username) — reused across re-renders so a
   *  leaderboard refresh does not rebuild every avatar from scratch. */
  key: string;
  cosmetics: Cosmetics;
  /** The element whose box this bust is drawn into. */
  slot: HTMLElement;
  pose: BustPose;
}

interface LiveBust {
  key: string;
  slot: HTMLElement;
  pose: BustPose;
  body: AvatarBody;
  /** 0..1 hover blend, spring-eased toward `target`. */
  blend: number;
  target: number;
  /** Per-bust phase so a row of busts never breathes in lockstep. */
  phase: number;
}

// Framing: tight on the head and shoulders at rest, pulled back on hover so a
// raised arm has somewhere to go.
const REST_DIST = 1.92, REST_AIM = 1.60;
const HOVER_DIST = 3.2, HOVER_AIM = 1.4;

export class AvatarBustBoard {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  /** The single mount point: exactly one bust hangs here at a time. */
  private readonly stage = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 24);
  private readonly busts: LiveBust[] = [];
  private host: HTMLElement | null = null;
  private clock = 0;
  private lost = false;
  /** Last canvas size pushed to the renderer. Re-assigning canvas.width resets
   *  the drawing buffer, so it must only happen when the panel really moved. */
  private sized = { w: 0, h: 0 };

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    // Rows are drawn one after another into the SAME framebuffer, so the
    // per-render clear has to go: the frame is cleared once, up front.
    this.renderer.autoClear = false;
    this.renderer.domElement.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    // A lost context must never take the Arena down with it: the board simply
    // stops drawing and the CSS medallions stand on their own.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.scene.add(this.stage);
  }

  /** Hang the shared canvas over the leaderboard panel. */
  mount(host: HTMLElement): void {
    if (this.host === host) return;
    this.host = host;
    host.appendChild(this.renderer.domElement);
  }

  /**
   * Rebuild the board for a fresh leaderboard. Bodies are keyed by account, so
   * a periodic refresh that only reorders the ladder reuses every avatar and
   * keeps its breathing phase — no flicker, no GPU churn.
   */
  setRoster(entries: BustEntry[]): void {
    const keep = new Map(this.busts.map((b) => [b.key, b]));
    const next: LiveBust[] = [];
    for (const entry of entries) {
      const existing = keep.get(entry.key);
      if (existing) {
        keep.delete(entry.key);
        existing.slot = entry.slot;
        existing.pose = entry.pose;
        next.push(existing);
        continue;
      }
      const body = buildAvatarBody({ ...entry.cosmetics });
      body.group.rotation.y = Math.PI; // face the camera
      next.push({
        key: entry.key, slot: entry.slot, pose: entry.pose, body,
        blend: 0, target: 0, phase: Math.random() * Math.PI * 2,
      });
    }
    for (const stale of keep.values()) {
      this.stage.remove(stale.body.group);
      disposeAvatarBody(stale.body);
    }
    this.busts.length = 0;
    this.busts.push(...next);
  }

  /** Point at a row (or `null` for none). Only one bust poses at a time. */
  setHover(key: string | null): void {
    for (const bust of this.busts) bust.target = bust.key === key ? 1 : 0;
  }

  /** Draw one frame. Cheap no-op while the panel is hidden or empty. */
  render(dt: number): void {
    const host = this.host;
    if (!host || this.lost || !this.busts.length) return;
    const width = host.clientWidth, height = host.clientHeight;
    if (width < 4 || height < 4 || host.offsetParent === null) return;
    this.clock += dt;
    if (width !== this.sized.w || height !== this.sized.h) {
      this.sized.w = width; this.sized.h = height;
      this.renderer.setSize(width, height, false);
    }
    // Clear the whole canvas with the scissor OFF, or last frame's busts stay
    // burned in wherever a row has since moved or gone away.
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    const hostBox = host.getBoundingClientRect();

    for (const bust of this.busts) {
      // Spring the hover blend. Rising is snappier than falling, so pointing at
      // a row feels responsive while leaving it settles gracefully.
      const rate = bust.target > bust.blend ? 9.5 : 6;
      bust.blend += (bust.target - bust.blend) * Math.min(1, dt * rate);
      const box = bust.slot.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const left = box.left - hostBox.left, top = box.top - hostBox.top;
      // Fully-scrolled-out rows cost nothing.
      if (left > width || top > height || left + box.width < 0 || top + box.height < 0) continue;

      this.stage.clear();
      this.stage.add(bust.body.group);
      poseBust(bust.body, bust.pose, bust.blend, this.clock + bust.phase);

      const dist = REST_DIST + (HOVER_DIST - REST_DIST) * bust.blend;
      const aim = REST_AIM + (HOVER_AIM - REST_AIM) * bust.blend;
      this.camera.position.set(0, aim + 0.06 * bust.blend, dist);
      this.camera.lookAt(0, aim, 0);
      this.camera.aspect = box.width / box.height;
      this.camera.updateProjectionMatrix();

      // WebGL's origin is bottom-left; the DOM's is top-left.
      const y = height - (top + box.height);
      this.renderer.setViewport(left, y, box.width, box.height);
      this.renderer.setScissor(left, y, box.width, box.height);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setScissorTest(false);
  }

  /** Release every avatar and the GPU context. */
  dispose(): void {
    this.stage.clear();
    for (const bust of this.busts) disposeAvatarBody(bust.body);
    this.busts.length = 0;
    this.renderer.domElement.remove();
    this.renderer.dispose();
    this.host = null;
  }
}

/**
 * Blend a bust between its idle breathing and its hover salute.
 *
 * `parts` is [leftLeg, rightLeg, leftArm, rightArm]; limbs pivot at the top and
 * the model faces -z, so a NEGATIVE rotation.x lifts an arm backwards over the
 * head and rotation.z swings it out to the side.
 */
function poseBust(body: AvatarBody, pose: BustPose, blend: number, time: number): void {
  const [, , armL, armR] = body.parts;
  const idle = 1 - blend;
  // Idle: a slow breath, a drifting glance, and the faintest sway.
  const breath = Math.sin(time * 1.5) * 0.5 + 0.5;
  body.group.position.y = Math.sin(time * 1.5) * 0.012 * idle + blend * 0.02;
  body.head.rotation.y = Math.sin(time * 0.62) * 0.22 * idle;
  body.head.rotation.x = Math.sin(time * 0.9) * 0.05 * idle;
  body.head.rotation.z = 0;
  armL.rotation.set(0, 0, 0);
  armR.rotation.set(0, 0, 0);
  armL.rotation.x = Math.sin(time * 1.5) * 0.04 * idle;
  armR.rotation.x = -Math.sin(time * 1.5) * 0.04 * idle;
  armL.rotation.z = 0.03 * breath * idle;
  armR.rotation.z = -0.03 * breath * idle;
  body.group.rotation.y = Math.PI + Math.sin(time * 0.5) * 0.06 * idle;
  body.group.rotation.z = 0;

  if (blend <= 0.001) return;

  // The pose lands with a small overshoot so it arrives with a snap rather
  // than sliding into place.
  const e = blend * (1 + 0.16 * Math.sin(Math.min(1, blend) * Math.PI));
  const bob = Math.sin(time * 5.2) * 0.03 * blend;

  switch (pose) {
    case 'salute': {
      // Both arms thrown up in a champion's V, chin lifted, turned off-square.
      body.group.rotation.y += -0.34 * e;
      armR.rotation.x += (-2.62 + bob) * e;
      armR.rotation.z += -0.34 * e;
      armL.rotation.x += (-2.48 - bob) * e;
      armL.rotation.z += 0.38 * e;
      body.head.rotation.x += -0.2 * e;
      body.group.position.y += 0.05 * e + bob * 0.4;
      break;
    }
    case 'flex': {
      // A double bicep: arms out and folded up, shoulders squared, slow lean.
      body.group.rotation.y += 0.3 * e;
      body.group.rotation.z += 0.05 * e;
      armR.rotation.x += -1.05 * e;
      armR.rotation.z += (-1.42 - bob) * e;
      armL.rotation.x += -1.05 * e;
      armL.rotation.z += (1.42 + bob) * e;
      body.head.rotation.y += 0.24 * e;
      body.head.rotation.x += -0.08 * e;
      break;
    }
    case 'point': {
      // Turned side-on, one arm levelled straight down the lens at you.
      body.group.rotation.y += 0.52 * e;
      armR.rotation.x += (-1.62 + bob * 0.5) * e;
      armR.rotation.z += -0.2 * e;
      armL.rotation.x += 0.34 * e;
      armL.rotation.z += 0.5 * e;
      body.head.rotation.y += -0.5 * e;
      body.head.rotation.x += -0.1 * e;
      break;
    }
  }
}
