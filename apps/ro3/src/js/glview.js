// WebGL2 viewer layer for the video editor: draws a <video>/<img> through a 3D LUT (the exact colour grade the
// export uses) and an optional chroma key, so what you see while editing matches the render.
const GLView = (() => {
  const VS = `#version 300 es
  in vec2 p; out vec2 uv;
  void main() { uv = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `#version 300 es
  precision highp float; precision highp sampler3D;
  in vec2 uv; out vec4 o;
  uniform sampler2D img; uniform sampler3D lut; uniform float useLut, lutN;
  uniform float useKey; uniform vec3 keyColor; uniform float keySim, keyBlend, keySpill;
  uniform float vig, vigMid; uniform vec2 res; uniform float sharpen;
  vec3 grade(vec3 c) { float n = lutN; vec3 q = c * ((n - 1.0) / n) + 0.5 / n; return texture(lut, q).rgb; }
  void main() {
    vec4 c = texture(img, uv);
    if (sharpen > 0.0) {
      vec2 px = 1.0 / res;
      vec3 b = (texture(img, uv + vec2(px.x, 0)).rgb + texture(img, uv - vec2(px.x, 0)).rgb + texture(img, uv + vec2(0, px.y)).rgb + texture(img, uv - vec2(0, px.y)).rgb) * 0.25;
      c.rgb = clamp(c.rgb + (c.rgb - b) * sharpen, 0.0, 1.0);
    }
    if (useKey > 0.5) {
      // colorkey-style: distance in RGB from the key colour → alpha, then pull spill toward neutral
      float d = distance(c.rgb, keyColor);
      float a = clamp((d - keySim) / max(keyBlend, 0.001), 0.0, 1.0);
      if (keySpill > 0.0) {
        bool blue = keyColor.b > keyColor.g;
        float lim = blue ? max(c.r, c.g) : max(c.r, c.b);
        if (blue) c.b = mix(c.b, min(c.b, lim), keySpill); else c.g = mix(c.g, min(c.g, lim), keySpill);
      }
      c.a *= a;
    }
    if (useLut > 0.5) c.rgb = grade(c.rgb);
    if (vig > 0.0) { vec2 d = uv - 0.5; float r = length(d * vec2(res.x / res.y, 1.0)) / length(vec2(res.x / res.y, 1.0) * 0.5); c.rgb *= 1.0 - vig * smoothstep(vigMid, 1.05, r); }
    o = vec4(c.rgb * c.a, c.a);
  }`;

  /** Same API without WebGL (blocklisted GPUs, VMs): renders a reduced-size frame on the CPU. */
  function createCpu(canvas) {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    let L = null, key = null, spatial = null;
    return {
      canvas, cpu: true,
      setLut(l) { L = l || null; }, setKey(k) { key = k && k.on ? k : null; }, setSpatial(s) { spatial = s && (s.vignette > 0) ? s : null; },
      draw(src) {
        const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
        if (!sw || !sh) return false;
        const k = Math.min(1, 640 / sw), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        g.clearRect(0, 0, w, h); try { g.drawImage(src, 0, 0, w, h); } catch (_) { return false; }
        if (!L && !key && !spatial) return true;
        const img = g.getImageData(0, 0, w, h), d = img.data;
        const N = L ? L.size : 0, T = L ? L.data : null, s1 = N - 1;
        let kc = null; if (key) { const hx = String(key.color || '#00ff00').replace('#', ''); kc = [0, 2, 4].map(i => parseInt(hx.slice(i, i + 2), 16)); }
        const sim = key ? (key.similarity ?? 30) / 100 * 1.2 * 255 : 0, bl = key ? Math.max(0.01, (key.smooth ?? 10) / 100) * 255 : 1;
        const vig = spatial ? spatial.vignette / 100 * 0.85 : 0, mid = spatial ? 0.25 + (spatial.vignetteMid ?? 50) / 100 * 0.6 : 0, ar = w / h;
        for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
          let r = d[i], gg = d[i + 1], b = d[i + 2];
          if (kc) { const dist = Math.hypot(r - kc[0], gg - kc[1], b - kc[2]); d[i + 3] *= Math.min(1, Math.max(0, (dist - sim) / bl)); }
          if (T) {
            const fx = r / 255 * s1, fy = gg / 255 * s1, fz = b / 255 * s1, x0 = Math.min(s1 - 1, fx | 0), y0 = Math.min(s1 - 1, fy | 0), z0 = Math.min(s1 - 1, fz | 0), tx = fx - x0, ty = fy - y0, tz = fz - z0;
            const o000 = ((z0 * N + y0) * N + x0) * 3, o100 = o000 + 3, o010 = o000 + N * 3, o110 = o010 + 3, o001 = o000 + N * N * 3, o101 = o001 + 3, o011 = o001 + N * 3, o111 = o011 + 3;
            for (let c = 0; c < 3; c++) {
              const v = ((T[o000 + c] * (1 - tx) + T[o100 + c] * tx) * (1 - ty) + (T[o010 + c] * (1 - tx) + T[o110 + c] * tx) * ty) * (1 - tz) + ((T[o001 + c] * (1 - tx) + T[o101 + c] * tx) * (1 - ty) + (T[o011 + c] * (1 - tx) + T[o111 + c] * tx) * ty) * tz;
              if (c === 0) r = v * 255; else if (c === 1) gg = v * 255; else b = v * 255;
            }
          }
          if (vig) { const dx = (x / w - 0.5) * ar, dy = y / h - 0.5, rr = Math.hypot(dx, dy) / Math.hypot(ar * 0.5, 0.5), t = Math.min(1, Math.max(0, (rr - mid) / (1.05 - mid))), m = 1 - vig * t * t * (3 - 2 * t); r *= m; gg *= m; b *= m; }
          d[i] = r; d[i + 1] = gg; d[i + 2] = b;
        }
        g.putImageData(img, 0, 0);
        return true;
      },
    };
  }

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return createCpu(canvas);
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ltex = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, ltex);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(U('img'), 0); gl.uniform1i(U('lut'), 1);
    let lutKey = null, lutN = 2;
    return {
      canvas,
      /** LUT = { size, data: Float32Array red-fastest } or null. */
      setLut(L, key) {
        if (!L) { gl.uniform1f(U('useLut'), 0); lutKey = null; return; }
        if (key && key === lutKey) { gl.uniform1f(U('useLut'), 1); return; }
        const n = L.size, d = new Uint8Array(n * n * n * 4);
        for (let i = 0, j = 0; i < L.data.length; i += 3, j += 4) { d[j] = Math.round(L.data[i] * 255); d[j + 1] = Math.round(L.data[i + 1] * 255); d[j + 2] = Math.round(L.data[i + 2] * 255); d[j + 3] = 255; }
        gl.activeTexture(gl.TEXTURE1); gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
        lutKey = key; lutN = n; gl.uniform1f(U('lutN'), n); gl.uniform1f(U('useLut'), 1);
      },
      setKey(k) {
        if (!k || !k.on) { gl.uniform1f(U('useKey'), 0); return; }
        const hx = String(k.color || '#00ff00').replace('#', ''), c = [0, 2, 4].map(i => parseInt(hx.slice(i, i + 2), 16) / 255);
        gl.uniform1f(U('useKey'), 1); gl.uniform3f(U('keyColor'), ...c);
        gl.uniform1f(U('keySim'), (k.similarity ?? 30) / 100 * 1.2); gl.uniform1f(U('keyBlend'), Math.max(0.01, (k.smooth ?? 10) / 100)); gl.uniform1f(U('keySpill'), (k.spill || 0) / 100);
      },
      setSpatial(g) { gl.uniform1f(U('vig'), g && g.vignette > 0 ? g.vignette / 100 * 0.85 : 0); gl.uniform1f(U('vigMid'), g ? 0.25 + (g.vignetteMid ?? 50) / 100 * 0.6 : 0.5); gl.uniform1f(U('sharpen'), g && g.sharpen > 0 ? g.sharpen / 60 : 0); },
      /** Draw the current frame of `src`. Returns false if the source has no frame yet. */
      draw(src) {
        const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
        if (!w || !h) return false;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h); gl.uniform2f(U('res'), w, h);
        gl.activeTexture(gl.TEXTURE0);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (_) { return false; }
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return true;
      },
    };
  }

  // Baked grades are shared between views (and the scopes).
  const cache = new Map();
  /** LUT for a grade; `lutText` (a loaded .cube/.3dl) is parsed once. */
  function lutFor(grade) {
    if (!grade || !ColorGrade.isColorActive(grade)) return null;
    const g = { ...grade };
    if (g.lut && g.lut.text) { try { g.lut = { ...ColorGrade.parseLut(g.lut.text, g.lut.name), amount: g.lut.amount }; } catch (_) { g.lut = null; } } else g.lut = null;
    const key = ColorGrade.key(g) + (grade.lut && grade.lut.text ? '|' + grade.lut.text.length : '');
    if (!cache.has(key)) { if (cache.size > 24) cache.clear(); cache.set(key, ColorGrade.bake(g, 33)); }
    return { L: cache.get(key), key };
  }
  return { create, lutFor };
})();
