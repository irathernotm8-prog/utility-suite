// Nebula Drift — clouds of gas and three layers of stars that drift apart as the cursor moves. Click for a flare.
float hash(vec2 p) { p = fract(p * vec2(443.8, 441.4)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 1.3; a *= 0.5; } return v; }
float stars(vec2 p, float dens) { vec2 id = floor(p); float h = hash(id); return step(1.0 - dens, h) * smoothstep(0.42, 0.0, length(fract(p) - 0.5)) * (0.6 + 0.4 * sin(iTime * 1.5 + h * 50.0)); }
void mainImage(out vec4 o, in vec2 fc) {
  float asp = iResolution.x / iResolution.y;
  vec2 uv = (fc / iResolution.xy - 0.5) * vec2(asp, 1.0);
  vec2 m = (iPointer - 0.5) * 0.12;
  float t = iTime * 0.012;
  vec2 p = uv * 1.6 + m * 0.6 + vec2(t, -t * 0.6);
  float n1 = fbm(p + fbm(p * 1.3 + t * 2.0));
  float n2 = fbm(p * 2.2 - vec2(3.0, 1.0) + n1);
  vec3 col = vec3(0.01, 0.008, 0.025);
  col += vec3(0.45, 0.12, 0.6) * pow(n1, 3.0) * 1.6;
  col += vec3(0.05, 0.35, 0.65) * pow(n2, 3.5) * 1.8;
  col += vec3(0.95, 0.4, 0.35) * pow(n1 * n2, 4.0) * 3.0;
  col += stars(uv * 90.0 + m * 30.0, 0.015) * 0.6 + stars(uv * 50.0 + m * 60.0, 0.012) * 0.8 + stars(uv * 24.0 + m * 110.0, 0.01) * vec3(1.0, 0.95, 0.85);
  vec2 cp = (iClick.xy - 0.5) * vec2(asp, 1.0);
  if (iClick.z >= 0.0 && iClick.z < 3.0) { float d = length(uv - cp); col += vec3(0.8, 0.85, 1.0) * exp(-iClick.z * 1.8) * (0.02 / (d + 0.02) + 0.6 * smoothstep(0.02, 0.0, abs(d - iClick.z * 0.25))); }
  o = vec4(col, 1.0);
}
