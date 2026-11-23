// Gradient Flow — soft fields of violet, rose, blue and peach that wander slowly. One follows the cursor; a click
// blooms. About the cheapest live wallpaper there is. Params: Hue (turns the whole palette), Speed.
vec3 hue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
void mainImage(out vec4 o, in vec2 fc) {
  float asp = iResolution.x / iResolution.y;
  vec2 uv = fc / iResolution.xy; vec2 p = uv * vec2(asp, 1.0);
  float t = iTime * 0.05 * (0.3 + iParams.y);
  vec2 cs[4]; vec3 cc[4];
  cs[0] = vec2(asp * (0.28 + 0.18 * sin(t * 1.1)), 0.32 + 0.2 * cos(t * 0.9));       cc[0] = vec3(0.33, 0.22, 0.78);
  cs[1] = vec2(asp * (0.78 + 0.14 * cos(t * 0.8)), 0.72 + 0.15 * sin(t * 1.3));      cc[1] = vec3(0.95, 0.42, 0.62);
  cs[2] = vec2(asp * (0.6 + 0.22 * sin(t * 0.6 + 2.0)), 0.18 + 0.14 * sin(t * 0.7 + 1.0)); cc[2] = vec3(0.16, 0.45, 0.92);
  cs[3] = iPointer * vec2(asp, 1.0);                                                 cc[3] = vec3(1.0, 0.7, 0.48);
  vec3 col = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 4; i++) { float d = length(p - cs[i]); float w = 1.0 / (0.03 + d * d * (i == 3 ? 6.0 : 2.0)); col += cc[i] * w; wsum += w; }
  col = hue(col / wsum, iParams.x * 6.2831);
  if (iClick.z >= 0.0 && iClick.z < 2.5) { float d = length(p - iClick.xy * vec2(asp, 1.0)); col += 0.16 * exp(-iClick.z * 2.0) * smoothstep(0.25, 0.0, abs(d - iClick.z * 0.35)); }
  col *= 0.9 + 0.1 * uv.y;
  float g = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453); col += (g - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
