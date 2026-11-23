// Synthwave — a striped sun over a neon grid that runs toward you. The cursor steers the horizon; clicks pulse the grid.
void mainImage(out vec4 o, in vec2 fc) {
  float asp = iResolution.x / iResolution.y;
  vec2 uv = fc / iResolution.xy; vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  vec2 m = iPointer - 0.5;
  float hz = 0.0 - m.y * 0.06;
  vec3 col = mix(vec3(0.02, 0.0, 0.08), vec3(0.45, 0.05, 0.4), smoothstep(0.5, hz, p.y));
  vec2 sp = p - vec2(m.x * 0.15, hz + 0.18); float d = length(sp);
  float stripes = step(0.0, sin((sp.y + 0.02) * 90.0 - iTime * 0.5)) + step(0.06, sp.y);
  float sun = smoothstep(0.205, 0.2, d) * clamp(stripes, 0.0, 1.0);
  col = mix(col, mix(vec3(1.0, 0.2, 0.5), vec3(1.0, 0.85, 0.3), smoothstep(-0.2, 0.2, sp.y)), sun);
  col += vec3(1.0, 0.3, 0.6) * 0.25 * exp(-d * 4.0);
  if (p.y < hz) {
    float z = 0.35 / (hz - p.y + 0.001);
    vec2 g = vec2((p.x - m.x * 0.15) * z, z + iTime * 0.6);
    vec2 f = abs(fract(g) - 0.5); float line = smoothstep(0.03 * z, 0.0, min(f.x, f.y) - 0.0);
    float pulse = iClick.z >= 0.0 && iClick.z < 2.0 ? exp(-iClick.z * 2.5) : 0.0;
    vec3 gc = vec3(0.2, 0.9, 1.0) * (0.6 + pulse * 1.5);
    col = mix(vec3(0.03, 0.0, 0.07), gc, line * smoothstep(40.0, 2.0, z));
    col += vec3(0.6, 0.1, 0.5) * 0.35 * exp(-(hz - p.y) * 12.0);
  }
  o = vec4(col, 1.0);
}
