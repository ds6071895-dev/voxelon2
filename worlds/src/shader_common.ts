/** Display curve shared by terrain, sky and both cloud paths. */
export const DISPLAY_KNEE_GLSL = /* glsl */`
vec3 vxKnee(vec3 c) {
  vec3 over = max(c - 0.78, 0.0);
  return c - over + (1.0 - exp(-over / 0.22)) * 0.22;
}
`;
