/** Small camera correction, never a redirected shot or an expanded hitbox.
 * Candidates must already be eligible opponents; visibility is checked only
 * inside the narrow cone. No prediction, head targeting, or idle tracking. */
export interface AimPoint { x: number; y: number; z: number }
const CONE = 5 * Math.PI / 180;
const MAX_SPEED = 12 * Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function aimAssist(
  yaw: number, pitch: number, eye: AimPoint, targets: readonly AimPoint[],
  range: number, dt: number, active: boolean, visible: (point: AimPoint) => boolean,
): { yaw: number; pitch: number } {
  if (!active || dt <= 0) return { yaw, pitch };
  let best = CONE, dyaw = 0, dpitch = 0;
  for (const p of targets) {
    const x = p.x - eye.x, y = p.y - eye.y, z = p.z - eye.z;
    const distance = Math.hypot(x, y, z);
    if (distance < .1 || distance > range) continue;
    const targetYaw = Math.atan2(-x, -z), targetPitch = Math.atan2(y, Math.hypot(x, z));
    const yd = wrap(targetYaw - yaw), pd = targetPitch - pitch;
    // Actual spherical angle keeps the cone narrow even near vertical views.
    const angle = Math.acos(Math.max(-1, Math.min(1,
      Math.sin(pitch) * Math.sin(targetPitch) + Math.cos(pitch) * Math.cos(targetPitch) * Math.cos(yd))));
    if (angle >= best || !visible(p)) continue;
    best = angle; dyaw = yd; dpitch = pd;
  }
  const error = Math.hypot(dyaw, dpitch);
  if (error < 1e-6) return { yaw, pitch };
  const step = Math.min(1 - Math.exp(-2.5 * Math.min(dt, .05)), MAX_SPEED * Math.min(dt, .05) / error);
  return { yaw: yaw + dyaw * step, pitch: pitch + dpitch * step };
}
