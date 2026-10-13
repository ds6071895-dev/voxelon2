// Audit the actual release-stage motion at its simulation rate before rendering.
import * as THREE from 'three';
import { worldGenerator } from '../multiverse';
import { TitleTerrain } from '../title_terrain';
import { DragonView } from '../parkour_dragon';
import type { Particles } from '../particles';
import { parkourTheme } from '../parkour_themes';
import { SHOTS } from './shots';
import { createTrailerCourse, trailerShotContext, trailerFrame, trailerEdits, trailerDragonCue } from './staging';
import { warmCaptureDragon } from '../media/dragon';
import { captureVolumeHit, captureSightHit, type GeometryHit, type GeometryPoint } from '../media/geometry';

export interface TrailerLocationIssue { shot: string; check: string; frame: number; endFrame?: number; hit?: GeometryHit }
export interface TrailerLocationReport { seed: number; frames: number; failures: TrailerLocationIssue[]; observations: TrailerLocationIssue[] }

// A brief pass behind cover is valid combat choreography. At the edit's 120 BPM,
// two beats (one second) is the maximum uninterrupted gap; longer gaps fail.
// After clearance correction the actual longest gap is frames 82..126 (0.75 s).
export const TRAILER_BRIEF_OCCLUSION_FRAMES = 60;

export function checkTrailerLocations(): TrailerLocationReport {
  const { seed, course } = createTrailerCourse();
  const report: TrailerLocationReport = { seed, frames: 0, failures: [], observations: [] };
  const lake = new TitleTerrain(0x5ca1ab1e);
  const particles = { update() {}, burst() {} } as unknown as Particles;
  const dragon = new DragonView(new THREE.Scene(), particles);
  const view = new THREE.PerspectiveCamera(58, 16 / 9, .08, 2000);
  for (const s of SHOTS) {
    const base = s.set === 'lake' ? lake : worldGenerator({ kind: s.set === 'manor' ? 'ratseek' : s.set, seed: s.set === 'bedwars' ? 0 : seed });
    // Blocks placed during the shot are part of the scene at the moment they appear.
    const edits = trailerEdits(s);
    let clock = 0;
    const generator = { ...base, bounds: base.bounds, blockAt: (x: number, y: number, z: number): number => {
      for (const [ex, ey, ez, block, at] of edits) if (ex === x && ey === y && ez === z && at <= clock) return block;
      return base.blockAt(x, y, z);
    } } as typeof base;
    const context = trailerShotContext(s, course);
    dragon.clear();
    if (s.set === 'parkour') {
      dragon.enter(course, parkourTheme(seed), 0, 0);
      warmCaptureDragon(dragon, context.firstOrder);
    }
    const recorded = new Set<string>();
    const issue = (check: string, frame: number, hit?: GeometryHit, observation = false) => {
      // Keep the first occurrence per affected cell/check, not thousands of duplicates.
      const key = `${check}:${hit?.cell.join(',') ?? ''}`;
      if (recorded.has(key)) return;
      recorded.add(key);
      (observation ? report.observations : report.failures).push({ shot: s.id, check, frame, hit });
    };
    let previous: THREE.Vector3 | null = null;
    let hiddenFrom: number | null = null;
    const closeVisibilityGap = (endFrame: number) => {
      if (hiddenFrom === null) return;
      const brief = endFrame - hiddenFrom + 1 <= TRAILER_BRIEF_OCCLUSION_FRAMES;
      (brief ? report.observations : report.failures).push({
        shot: s.id, check: brief ? 'brief-subject-occlusion' : 'all-subjects-hidden', frame: hiddenFrom, endFrame,
      });
      hiddenFrom = null;
    };
    for (let frame = 0; frame <= s.duration * 60; frame++) {
      const t = frame / 60;
      clock = t;
      if (s.action === 'pk-run' || s.action === 'pk-dragon') {
        const cue = trailerDragonCue(t, context.firstOrder);
        dragon.sync(cue.front, cue.speed, cue.now);
        dragon.update(frame ? 1 / 60 : 0, cue.now, 0, true);
      }
      const stage = trailerFrame(s, t, { generator, course, context, dragonHead: dragon.headPosition() });
      const cam = stage.camera;
      const p = cam.position;
      // Near-plane-scale clearance, not a player-sized bubble: these are
      // intentionally close cinematic cameras. Sweep between frames as well.
      const from = previous ?? p;
      const clearance = captureVolumeHit(generator,
        [Math.min(from.x, p.x) - .08, Math.min(from.y, p.y) - .08, Math.min(from.z, p.z) - .08],
        [Math.max(from.x, p.x) + .08, Math.max(from.y, p.y) + .08, Math.max(from.z, p.z) + .08]);
      if (clearance) issue('camera-clearance', frame, clearance);
      previous = p;
      view.position.copy(p); view.fov = cam.fov; view.lookAt(cam.target);
      view.updateProjectionMatrix(); view.updateMatrixWorld();
      const subjects: THREE.Vector3[] = [];
      for (const actor of stage.actors) {
        const [x, y, z] = actor.pos;
        // A knocked-back or falling body leaves the floor on purpose.
        if (!actor.tilt) {
          const hit = captureVolumeHit(generator, [x - .3, y + .03, z - .3], [x + .3, y + 1.8, z + .3]);
          if (hit) issue(`actor-${actor.slot}-clearance`, frame, hit);
        }
        subjects.push(new THREE.Vector3(x, y + 1.2, z));
      }
      for (const [i, rat] of stage.rats.entries()) {
        const [x, y, z] = rat.pos;
        // The captive rat is deliberately inside the real prison cage.
        if (!rat.caged) {
          const hit = captureVolumeHit(generator, [x - .15, y + .03, z - .15], [x + .15, y + .9, z + .15]);
          if (hit) issue(`rat-${i}-clearance`, frame, hit);
          subjects.push(new THREE.Vector3(x, y + .5, z));
        }
      }
      if (s.action === 'pk-dragon') subjects.push(dragon.headPosition().clone());
      // Establishing shots aim into real builds, sometimes deliberately at a
      // roof/floor. Record aim occlusion and bound uninterrupted action occlusion.
      const aimHit = captureSightHit(generator, p.toArray() as GeometryPoint, cam.target.toArray() as GeometryPoint);
      if (aimHit) issue('aim-occlusion', frame, aimHit, true);
      if (subjects.length) {
        const visible = subjects.some(subject => {
          const screen = subject.clone().project(view);
          return Math.abs(screen.x) <= 1 && Math.abs(screen.y) <= 1 && screen.z > -1 && screen.z < 1
            && !captureSightHit(generator, p.toArray() as GeometryPoint, subject.toArray() as GeometryPoint);
        });
        if (!visible && hiddenFrom === null) hiddenFrom = frame;
        if (visible) closeVisibilityGap(frame - 1);
      }
      report.frames++;
    }
    closeVisibilityGap(s.duration * 60);
  }
  dragon.dispose();
  return report;
}
