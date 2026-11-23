// Fold — sculpted ribbons of dark material lit from one side, with a hairline of light along their edges.
// Moves slowly (the sheets breathe and the light drifts); the light follows the cursor, and a click sends a pulse
// of light along the edges. Params: Palette (0 xenon blue, 1 graphite, 2 gold, 3 platinum, 4 rose, 5 aurora),
// Motion, Light angle. Drawn at full resolution so the hairlines stay crisp; it's only a few curves per pixel.
float PX;
float ell(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; float k = length(q); return (k - 1.0) * k / max(length(q / r), 1e-4); }
float side(vec2 p, vec2 a, vec2 b) { vec2 d = normalize(b - a); return (p.x - a.x) * d.y - (p.y - a.y) * d.x; }
vec3 pal(float i, float t) { // t: 0 shadow … 1 lit
  vec3 lo, mid, hi;
  if (i < 0.5)      { lo = vec3(0.0, 0.004, 0.02); mid = vec3(0.12, 0.24, 0.5); hi = vec3(0.72, 0.78, 0.88); }
  else if (i < 1.5) { lo = vec3(0.0); mid = vec3(0.22, 0.23, 0.26); hi = vec3(0.82, 0.83, 0.86); }
  else if (i < 2.5) { lo = vec3(0.012, 0.006, 0.0); mid = vec3(0.45, 0.28, 0.06); hi = vec3(1.0, 0.86, 0.58); }
  else if (i < 3.5) { lo = vec3(0.01, 0.012, 0.016); mid = vec3(0.42, 0.45, 0.5); hi = vec3(0.94, 0.95, 0.97); }
  else if (i < 4.5) { lo = vec3(0.016, 0.0, 0.008); mid = vec3(0.5, 0.18, 0.3); hi = vec3(1.0, 0.8, 0.82); }
  else              { lo = vec3(0.0, 0.01, 0.012); mid = vec3(0.05, 0.38, 0.4); hi = vec3(0.7, 0.95, 0.88); }
  return t < 0.5 ? mix(lo, mid, smoothstep(0.0, 0.5, t)) : mix(mid, hi, smoothstep(0.5, 1.0, t));
}
vec3 bgCol(float i) { return i < 0.5 ? vec3(0.13, 0.17, 0.26) : i < 1.5 ? vec3(0.15, 0.15, 0.17) : i < 2.5 ? vec3(0.2, 0.14, 0.07) : i < 3.5 ? vec3(0.2, 0.21, 0.24) : i < 4.5 ? vec3(0.22, 0.12, 0.16) : vec3(0.06, 0.18, 0.2); }
vec3 rimCol(float i) { return i < 0.5 ? vec3(0.85, 0.9, 1.0) : i < 2.5 && i > 1.5 ? vec3(1.0, 0.92, 0.75) : i > 3.5 && i < 4.5 ? vec3(1.0, 0.88, 0.9) : vec3(0.92, 0.95, 1.0); }

void mainImage(out vec4 o, in vec2 fc) {
  vec2 p = (fc - 0.5 * iResolution.xy) / iResolution.y;
  PX = 1.0 / iResolution.y;
  float pi = floor(iParams.x + 0.5);
  float t = iTime * 0.06 * (0.25 + iParams.y);
  float b1 = sin(t), b2 = cos(t * 0.73);
  // the light: a slow drift, pulled toward the cursor
  vec2 m = iPointer - 0.5;
  float ang = 2.3 + iParams.z + 0.25 * sin(t * 0.8) - m.x * 1.1 + m.y * 0.5;
  vec2 L = vec2(cos(ang), sin(ang));
  // background: deep, lifting toward one corner
  vec2 uv = fc / iResolution.xy;
  vec3 col = mix(vec3(0.004, 0.006, 0.012), bgCol(pi), smoothstep(0.1, 1.5, uv.x * 0.8 + uv.y * 0.55) * 0.75);
  // click pulse along the edges
  float since = iClick.z, pulse = 0.0;
  if (since >= 0.0 && since < 3.0) { vec2 cp = (iClick.xy - 0.5) * vec2(iResolution.x / iResolution.y, 1.0); pulse = exp(-since * 1.4) * smoothstep(0.18, 0.0, abs(length(p - cp) - since * 0.55)); }
  vec3 rim = rimCol(pi);

  // ---- back sheet: a wide band (outer ellipse minus inner ellipse)
  vec2 cB = vec2(0.3 + 0.015 * b2, -0.62), rB = vec2(0.74 + 0.02 * b1, 0.98), cBi = vec2(0.24, -0.6 + 0.01 * b1), rBi = vec2(0.4, 0.5 + 0.015 * b2);
  float dB = ell(p, cB, rB), dBi = ell(p, cBi, rBi);
  float inB = smoothstep(PX, -PX, dB) * smoothstep(-PX, PX, dBi);
  if (inB > 0.0) {
    vec2 n = normalize(p - cBi);
    float lit = 0.5 + 0.5 * dot(n, -L);              // inner face catches the light on the far side
    float glow = exp(-max(dBi, 0.0) * 18.0);         // light pooling along the inner edge
    float shade = clamp(lit * 0.95 * smoothstep(0.42, 0.0, dBi) + glow * 0.25 * (0.4 + lit), 0.0, 1.0);
    vec3 c = pal(pi, shade) + pal(pi, 0.55) * glow * 0.18;
    col = mix(col, c, inB);
  }
  float rimB = smoothstep(1.4 * PX, 0.0, abs(dB)) * smoothstep(-0.2, 0.25, dot(normalize(p - cB), vec2(0.6, 0.8)) + 0.4);
  col += rim * rimB * (0.75 + pulse * 2.0);

  // ---- front sheet: inside a tall ellipse, cut by a slanted edge, folding over the band
  vec2 cA = vec2(-0.05 + 0.01 * b1, -1.22), rA = vec2(1.2, 1.52 + 0.015 * b2);
  vec2 a0 = vec2(-0.04 + 0.01 * b2, 0.31), a1 = vec2(0.21 + 0.015 * b1, -0.52);
  float dA = ell(p, cA, rA), sA = side(p, a1, a0);
  float inA = smoothstep(PX, -PX, dA) * smoothstep(PX, -PX, sA);
  if (inA > 0.0) {
    float edge = -dA;                                  // depth in from the curved outer edge
    vec2 n = normalize(vec2(p.x - cA.x, (p.y - cA.y) * 0.8));
    float lit = 0.5 + 0.5 * dot(n, L);
    float shade = lit * (1.0 - smoothstep(0.0, 0.55, edge) * 0.95);
    shade += 0.35 * exp(-(-sA) * 9.0) * smoothstep(0.1, -0.3, p.y) * 0.0;
    float band = exp(-pow((edge - 0.16) * 7.0, 2.0)) * 0.18 * lit;  // the blue sheen across the fold
    vec3 c = pal(pi, clamp(shade, 0.0, 1.0)) + pal(pi, 0.55) * band;
    // the fold: a soft shadow cast onto the band just right of the cut edge
    col = mix(col, c, inA);
  }
  float shadow = smoothstep(0.0, 0.12, sA) * (1.0 - smoothstep(0.12, 0.3, sA)) * inB * (1.0 - inA);
  col *= 1.0 - 0.35 * shadow * (1.0 - smoothstep(0.0, 0.12, sA));
  float rimA = smoothstep(1.4 * PX, 0.0, abs(sA)) * smoothstep(PX, -PX, dA);
  col += rim * rimA * (0.85 + pulse * 2.0);
  float rimTop = smoothstep(1.2 * PX, 0.0, abs(dA)) * smoothstep(PX, -PX, sA) * smoothstep(-0.05, 0.25, p.y) * 0.6;
  col += rim * rimTop * (1.0 + pulse);

  float g = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453); col += (g - 0.5) / 255.0; // no banding
  o = vec4(col, 1.0);
}
