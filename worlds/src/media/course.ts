import { parkourCourse, type ParkourCourse, type SetPieceId } from '../parkour_course';

export interface CaptureCourse { seed: number; course: ParkourCourse }

/** Search the same deterministic seed sequence used by the offline stages. */
export function chooseCaptureCourse(required: readonly SetPieceId[], start = 2026, end = 3026, step = 8): CaptureCourse {
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(step) || step <= 0) {
    throw new Error('Invalid capture course seed range.');
  }
  for (let seed = start; seed < end; seed += step) {
    const course = parkourCourse(seed);
    if (required.every(piece => course.variant.pieces.includes(piece))) return { seed, course };
  }
  throw new Error(`No capture course with ${required.join(' and ')} found.`);
}
