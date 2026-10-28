// fabric.js set up the RO2 way: centre origins, Canva-style handles, the Line object and the extra properties we save.
import * as fabric from '../../vendor/fabric/fabric.min.mjs';
export { fabric };

// Properties RO2 adds to objects (saved in designs, kept by undo).
export const PROPS = ['id', 'ro2Name', 'ro2Role', 'assetId', 'ro2Shape', 'ro2Credit', 'ro2Locked', 'ro2Adjust', 'ro2Filter', 'ro2Frame', 'ro2Fill', 'ro2Upper', 'ro2Icon', 'ro2Qr', 'ro2Curve', 'ro2GradeSrc', 'ro2Grade',
  'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'strokeUniform', 'visible', 'flipX', 'flipY'];

const ACCENT = '#46e6a2';
fabric.config.configure({ perfLimitSizeTotal: 16 * 1024 * 1024, maxCacheSideLimit: 8192, textureSize: 8192 });
Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
  borderColor: ACCENT, borderScaleFactor: 1.6, cornerColor: '#ffffff', cornerStrokeColor: 'rgba(0,0,0,.25)', cornerStyle: 'circle',
  transparentCorners: false, cornerSize: 12, touchCornerSize: 28, padding: 0, borderOpacityWhenMoving: 0.6,
});
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'center', originY: 'center', objectCaching: true });

// ───── handles: round corners, pill-shaped sides, a rotate knob below ─────
function drawCorner(ctx, left, top) {
  ctx.save(); ctx.translate(left, top);
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
  ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.stroke();
  ctx.restore();
}
function sideRenderer(horizontal) {
  return function (ctx, left, top, _s, obj) {
    ctx.save(); ctx.translate(left, top); ctx.rotate(fabric.util.degreesToRadians(obj.getTotalAngle ? obj.getTotalAngle() : obj.angle));
    const w = horizontal ? 18 : 6, hh = horizontal ? 6 : 18;
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.roundRect(-w / 2, -hh / 2, w, hh, 3); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.stroke();
    ctx.restore();
  };
}
function drawRotate(ctx, left, top) {
  ctx.save(); ctx.translate(left, top);
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#1b2025'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, 5, -Math.PI * 0.95, Math.PI * 0.55); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5.6, -4.2); ctx.lineTo(-5, 0.6); ctx.lineTo(-1.2, -2.2); ctx.stroke();
  ctx.restore();
}
function styleControls(controls) {
  for (const k of ['tl', 'tr', 'bl', 'br']) if (controls[k]) { controls[k].render = drawCorner; controls[k].sizeX = controls[k].sizeY = 16; }
  for (const k of ['ml', 'mr']) if (controls[k]) { controls[k].render = sideRenderer(false); controls[k].sizeX = 12; controls[k].sizeY = 24; }
  for (const k of ['mt', 'mb']) if (controls[k]) { controls[k].render = sideRenderer(true); controls[k].sizeX = 24; controls[k].sizeY = 12; }
  if (controls.mtr) { controls.mtr.render = drawRotate; controls.mtr.y = 0.5; controls.mtr.offsetY = 30; controls.mtr.withConnection = false; controls.mtr.sizeX = controls.mtr.sizeY = 24; }
  return controls;
}
fabric.InteractiveFabricObject.createControls = function () { return { controls: styleControls(fabric.controlsUtils.createObjectDefaultControls()) }; };
fabric.Textbox.createControls = function () { return { controls: styleControls(fabric.controlsUtils.createTextboxDefaultControls()) }; };

// ───── Line: a straight line with optional arrow heads. Width is its length; the side handles change length. ─────
export class Ro2Line extends fabric.FabricObject {
  static type = 'Ro2Line';
  static ownDefaults = { lineColor: '#1b1f23', lineWidth: 6, dash: 'solid', startCap: 'none', endCap: 'none', fill: '', stroke: null, strokeWidth: 0, lockScalingY: true, objectCaching: false, padding: 6 };
  static getDefaults() { return { ...super.getDefaults(), ...Ro2Line.ownDefaults }; }
  static createControls() {
    const c = fabric.controlsUtils.createObjectDefaultControls();
    const r = fabric.controlsUtils.createResizeControls();
    return { controls: styleControls({ ml: r.ml, mr: r.mr, mtr: c.mtr }) };
  }
  constructor(options = {}) { super(); Object.assign(this, Ro2Line.ownDefaults); this.setOptions(options); this._fit(); }
  _set(key, value) { super._set(key, value); if (key === 'lineWidth' || key === 'startCap' || key === 'endCap') this._fit(); return this; }
  _fit() { const heads = this.startCap !== 'none' || this.endCap !== 'none'; this.height = Math.max(this.lineWidth * (heads ? 4 : 1), 2); }
  _headLen() { return Math.max(10, this.lineWidth * 3.2); }
  _segments() {
    const w = this.width / 2, L = this._headLen();
    const x0 = this.startCap === 'triangle' ? -w + L * 0.85 : this.startCap === 'circle' ? -w + this.lineWidth * 1.2 : -w;
    const x1 = this.endCap === 'triangle' ? w - L * 0.85 : this.endCap === 'circle' ? w - this.lineWidth * 1.2 : w;
    return { w, L, x0, x1 };
  }
  _dashArray() { const lw = this.lineWidth; return this.dash === 'dashed' ? [lw * 2.6, lw * 1.8] : this.dash === 'dotted' ? [0.001, lw * 2] : []; }
  _render(ctx) {
    const { w, L, x0, x1 } = this._segments(); const lw = this.lineWidth;
    ctx.save(); ctx.strokeStyle = this.lineColor; ctx.fillStyle = this.lineColor; ctx.lineWidth = lw; ctx.lineCap = this.dash === 'dotted' ? 'round' : 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash(this._dashArray());
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.stroke(); ctx.setLineDash([]);
    const cap = (x, dir, t) => {
      if (t === 'arrow') { ctx.beginPath(); ctx.moveTo(x - dir * L, -L * 0.62); ctx.lineTo(x, 0); ctx.lineTo(x - dir * L, L * 0.62); ctx.stroke(); }
      else if (t === 'triangle') { ctx.beginPath(); ctx.moveTo(x - dir * L * 1.1, -L * 0.7); ctx.lineTo(x, 0); ctx.lineTo(x - dir * L * 1.1, L * 0.7); ctx.closePath(); ctx.fill(); }
      else if (t === 'circle') { ctx.beginPath(); ctx.arc(x - dir * lw * 1.2, 0, lw * 1.25, 0, Math.PI * 2); ctx.fill(); }
      else if (t === 'bar') { ctx.beginPath(); ctx.moveTo(x, -L * 0.7); ctx.lineTo(x, L * 0.7); ctx.stroke(); }
    };
    cap(-w, -1, this.startCap); cap(w, 1, this.endCap);
    ctx.restore();
  }
  _toSVG() {
    const { w, L, x0, x1 } = this._segments(); const lw = this.lineWidth, c = this.lineColor;
    const da = this._dashArray(); const dash = da.length ? ` stroke-dasharray="${da.join(' ')}"` : '';
    const out = [`<line x1="${x0}" y1="0" x2="${x1}" y2="0" stroke="${c}" stroke-width="${lw}" stroke-linecap="round"${dash}/>\n`];
    const cap = (x, dir, t) => {
      if (t === 'arrow') out.push(`<path d="M${x - dir * L} ${-L * 0.62} L${x} 0 L${x - dir * L} ${L * 0.62}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>\n`);
      else if (t === 'triangle') out.push(`<path d="M${x - dir * L * 1.1} ${-L * 0.7} L${x} 0 L${x - dir * L * 1.1} ${L * 0.7} Z" fill="${c}"/>\n`);
      else if (t === 'circle') out.push(`<circle cx="${x - dir * lw * 1.2}" cy="0" r="${lw * 1.25}" fill="${c}"/>\n`);
      else if (t === 'bar') out.push(`<line x1="${x}" y1="${-L * 0.7}" x2="${x}" y2="${L * 0.7}" stroke="${c}" stroke-width="${lw}" stroke-linecap="round"/>\n`);
    };
    cap(-w, -1, this.startCap); cap(w, 1, this.endCap);
    return out;
  }
  toObject(props = []) { return super.toObject([...props, 'lineColor', 'lineWidth', 'dash', 'startCap', 'endCap']); }
}
fabric.classRegistry.setClass(Ro2Line);
fabric.classRegistry.setSVGClass(Ro2Line);

// ───── Curved text: an IText that follows an invisible arc; its box is grown to hold every glyph ─────
export class Ro2CurvedText extends fabric.IText {
  static type = 'Ro2CurvedText';
  initDimensions() {
    super.initDimensions();
    if (!this.path) return;
    this.calcTextWidth(); // places every glyph on the path
    let mx = 1, my = 1; const hh = this.fontSize * 0.62;
    for (const line of this.__charBounds || []) for (const b of line) {
      if (b.renderLeft == null) continue; const c = Math.cos(b.angle), s = Math.sin(b.angle), hw = b.width / 2;
      for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) { mx = Math.max(mx, Math.abs(b.renderLeft + x * c - y * s)); my = Math.max(my, Math.abs(b.renderTop + x * s + y * c)); }
    }
    this.width = mx * 2; this.height = my * 2;
  }
}
fabric.classRegistry.setClass(Ro2CurvedText);

// Short type names for the UI
export function kindOf(o) {
  if (!o) return null;
  if (o.type === 'activeselection' || o.type === 'ActiveSelection') return 'multi';
  if (o instanceof fabric.Textbox || o instanceof fabric.IText || o instanceof fabric.FabricText) return 'text';
  if (o instanceof fabric.FabricImage) return 'image';
  if (o instanceof Ro2Line) return 'line';
  if (o.ro2Icon) return 'icon';
  if (o instanceof fabric.Group) return 'group';
  return 'shape';
}
export const uid = () => Math.random().toString(36).slice(2, 10);
