// Mural — GPU shader wallpapers. Shadertoy-style fragment shaders (mainImage(out vec4, in vec2) or a plain main())
// drawn on one full-screen triangle, usually at half resolution and scaled up (smooth shaders look the same and cost a
// quarter). Uniforms:
//   iTime, iResolution, iMouse (xy: cursor px, zw: last click px), iClick (xy: click 0..1, z: seconds since click),
//   iDaylight (0 night … 1 day), iPhase (night, dawn, day, dusk), iParams (four sliders from the wallpaper's params).
const HEADER = `precision highp float;
uniform float iTime; uniform vec3 iResolution; uniform vec4 iMouse; uniform vec3 iClick; uniform float iDaylight; uniform vec4 iPhase; uniform vec4 iParams; uniform vec2 iPointer;
`;
const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

export function wrapSource(code) {
  const src = String(code || '');
  if (/void\s+mainImage\s*\(/.test(src)) return HEADER + src + '\nvoid main(){ vec4 c = vec4(0.0); mainImage(c, gl_FragCoord.xy); gl_FragColor = vec4(c.rgb, 1.0); }';
  return HEADER + src;
}

export class ShaderView {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    if (!gl) throw new Error('This computer’s graphics don’t support WebGL.');
    this.gl = gl; this.prog = null; this.u = {}; this.params = [0, 0, 0, 0];
    this.mouse = [0, 0, -1, -1]; this.clickAt = -100; this.click01 = [0.5, 0.5]; this.pointer = [0.5, 0.5]; this.target = [0.5, 0.5];
    this.sky = { daylight: 1, phases: { night: 0, dawn: 0, day: 1, dusk: 0 } };
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }
  /** Compile; returns null or an error message with line numbers matching the user's code. */
  compile(code) {
    const gl = this.gl;
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { const e = gl.getShaderInfoLog(o) || 'compile error'; gl.deleteShader(o); throw new Error(e); } return o; };
    try {
      const v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, wrapSource(code));
      const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link error');
      if (this.prog) gl.deleteProgram(this.prog);
      this.prog = p; gl.useProgram(p);
      const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['iTime', 'iResolution', 'iMouse', 'iClick', 'iDaylight', 'iPhase', 'iParams', 'iPointer']) this.u[n] = gl.getUniformLocation(p, n);
      return null;
    } catch (e) {
      const off = HEADER.split('\n').length - 1;
      return String(e.message || e).replace(/ERROR: 0:(\d+):/g, (_, n) => `Line ${Math.max(1, n - off)}:`).trim();
    }
  }
  resize(cssW, cssH, dpr) { const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr)); if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; } this.gl.viewport(0, 0, W, H); }
  setSky(sky) { this.sky = sky; }
  setPointer(x, y) { this.target = [x, y]; }
  click(x, y, t) { this.clickAt = t; this.click01 = [x, 1 - y]; this.mouse[2] = x * this.canvas.width; this.mouse[3] = (1 - y) * this.canvas.height; }
  frame(t, dt) {
    const gl = this.gl; if (!this.prog) return false;
    const e = 1 - Math.exp(-dt * 5); this.pointer[0] += (this.target[0] - this.pointer[0]) * e; this.pointer[1] += (this.target[1] - this.pointer[1]) * e;
    const W = this.canvas.width, H = this.canvas.height;
    this.mouse[0] = this.pointer[0] * W; this.mouse[1] = (1 - this.pointer[1]) * H;
    const ph = this.sky.phases || {};
    gl.uniform1f(this.u.iTime, t); gl.uniform3f(this.u.iResolution, W, H, 1); gl.uniform4fv(this.u.iMouse, this.mouse);
    gl.uniform3f(this.u.iClick, this.click01[0], this.click01[1], t - this.clickAt); gl.uniform1f(this.u.iDaylight, this.sky.daylight ?? 1);
    gl.uniform4f(this.u.iPhase, ph.night || 0, ph.dawn || 0, ph.day ?? 1, ph.dusk || 0); gl.uniform4fv(this.u.iParams, this.params);
    gl.uniform2f(this.u.iPointer, this.pointer[0], 1 - this.pointer[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
  destroy() { try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (_) {} }
}
