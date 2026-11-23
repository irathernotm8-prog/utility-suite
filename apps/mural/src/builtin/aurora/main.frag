// Aurora — northern lights over a starry ridge. The curtains lean toward the cursor; a click sends a shimmer along them.
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void mainImage(out vec4 o, in vec2 fc) {
  vec2 uv = fc / iResolution.xy; float asp = iResolution.x / iResolution.y;
  vec2 m = iPointer - 0.5;
  float t = iTime * 0.05 * (0.6 + iParams.x);
  vec3 col = mix(vec3(0.004, 0.01, 0.03), vec3(0.02, 0.05, 0.11), uv.y);
  vec2 g = uv * vec2(asp, 1.0) * 170.0; vec2 id = floor(g); float h = hash(id);
  float star = step(0.988, h) * smoothstep(0.45, 0.0, length(fract(g) - 0.5)) * (0.55 + 0.45 * sin(iTime * (1.0 + h * 3.0) + h * 40.0));
  col += star * vec3(0.8, 0.86, 1.0) * smoothstep(0.25, 0.6, uv.y);
  float since = iClick.z;
  float shimmer = since >= 0.0 && since < 4.0 ? exp(-since * 1.2) * smoothstep(0.35, 0.0, abs(uv.x - iClick.x - since * 0.12 * sign(uv.x - iClick.x))) : 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x * asp * 0.7 + m.x * 0.22 * (1.0 + fi * 0.4);
    float base = 0.5 + 0.09 * fi + 0.14 * (fbm(vec2(x * 1.2 + fi * 3.1, t * 2.0 + fi)) - 0.5) - m.y * 0.05;
    float d = uv.y - base;
    float curtain = smoothstep(-0.015, 0.02, d) * exp(-max(d, 0.0) * (4.5 + fi * 2.5));
    float rays = 0.55 + 0.45 * fbm(vec2(x * 7.0 + fi * 11.0, t * 5.0));
    vec3 c = mix(vec3(0.12, 1.0, 0.6), vec3(0.55, 0.32, 1.0), clamp(fi * 0.45 + d * 2.2, 0.0, 1.0));
    col += c * curtain * rays * (0.5 - fi * 0.12) * (1.0 + shimmer * 2.2);
  }
  float ridge = 0.17 + 0.06 * fbm(vec2(uv.x * asp * 1.6, 3.0)) + 0.02 * sin(uv.x * 7.0 + 1.0);
  col = mix(col, vec3(0.003, 0.006, 0.014), smoothstep(ridge + 0.004, ridge - 0.004, uv.y));
  o = vec4(pow(col, vec3(0.92)), 1.0);
}
