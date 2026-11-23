// Liquid Metal — polished metal that slowly flows. The cursor presses a dent into it; clicks send ripples across.
// Params: Tint (0 platinum … 1 gold), Flow.
float hash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }

vec2 R; vec2 Q; vec2 MP; vec2 CP; float T;
float height(vec2 uv) {
  float dm = length(uv - MP); float dc = length(uv - CP);
  float rip = iClick.z >= 0.0 ? sin(dc * 38.0 - iClick.z * 9.0) * exp(-iClick.z * 1.3) * exp(-dc * 3.5) * 0.09 : 0.0;
  return fbm(uv * 1.4 + 2.4 * R) - 0.22 * exp(-dm * dm * 14.0) + rip;
}
void mainImage(out vec4 o, in vec2 fc) {
  float asp = iResolution.x / iResolution.y;
  vec2 uv = (fc / iResolution.xy - 0.5) * vec2(asp, 1.0);
  T = iTime * 0.06 * (0.4 + iParams.y);
  MP = (iPointer - 0.5) * vec2(asp, 1.0); CP = (iClick.xy - 0.5) * vec2(asp, 1.0);
  Q = vec2(fbm(uv * 1.4 + T), fbm(uv * 1.4 + vec2(5.2, 1.3) - T));
  R = vec2(fbm(uv * 1.4 + 2.0 * Q + vec2(1.7, 9.2) + T * 0.7), fbm(uv * 1.4 + 2.0 * Q + vec2(8.3, 2.8) - T * 0.6));
  float e = 1.5 / iResolution.y;
  float h = height(uv), hx = height(uv + vec2(e, 0.0)), hy = height(uv + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 3.2));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float sky = smoothstep(-0.35, 0.65, r.y);
  vec3 env = mix(vec3(0.05, 0.055, 0.06), vec3(0.95, 0.96, 0.98), sky);
  env += 0.55 * smoothstep(0.82, 0.86, r.y) * (1.0 - smoothstep(0.9, 0.97, r.y));
  env *= 0.75 + 0.25 * smoothstep(-0.8, 0.4, r.x);
  float spec = pow(max(dot(r, normalize(vec3(-0.4, 0.55, 0.75))), 0.0), 40.0) + 0.5 * pow(max(dot(r, normalize(vec3(0.6, 0.3, 0.75))), 0.0), 18.0);
  vec3 tint = mix(vec3(0.9, 0.93, 0.98), vec3(1.0, 0.76, 0.38), clamp(iParams.x, 0.0, 1.0));
  vec3 col = env * tint + spec * mix(vec3(1.0), vec3(1.0, 0.9, 0.7), iParams.x);
  vec2 v = fc / iResolution.xy - 0.5; col *= 1.0 - dot(v, v) * 0.7;
  o = vec4(col, 1.0);
}
