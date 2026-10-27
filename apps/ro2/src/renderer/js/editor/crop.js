// Crop mode for a photo: the whole picture shows behind a crop window. Drag or resize the picture, or resize the window.
import { fabric } from './fab.js';

export async function startCrop(ed, img, { onEnd } = {}) {
  if (ed.cropping) return;
  ed.cropping = { img, starting: true };
  const c = ed.canvas;
  const el = img._originalElement || img.getElement();
  const EW = el.naturalWidth || el.width, EH = el.naturalHeight || el.height;
  const angle = img.angle; const clip = img.clipPath;
  if (angle) { img.rotate(0); img.setCoords(); }
  const s = Math.abs(img.scaleX), sy = Math.abs(img.scaleY);
  const center = img.getCenterPoint();
  // where the full picture sits so the current crop lines up
  const cropCx = (img.cropX || 0) + img.width / 2, cropCy = (img.cropY || 0) + img.height / 2;
  const fx = img.flipX ? -1 : 1, fy = img.flipY ? -1 : 1;
  const ghost = new fabric.FabricImage(el, {
    left: center.x - (cropCx - EW / 2) * s * fx, top: center.y - (cropCy - EH / 2) * sy * fy, scaleX: s, scaleY: sy, flipX: img.flipX, flipY: img.flipY,
    filters: img.filters, lockRotation: true, lockScalingFlip: true, hasBorders: true, borderColor: 'rgba(255,255,255,.6)', opacity: 1,
  });
  if (img.filters?.length) ghost.applyFilters();
  ghost.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });
  const box = new fabric.Rect({
    left: center.x, top: center.y, width: img.width * s, height: img.height * sy, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2, strokeUniform: true,
    lockRotation: true, lockScalingFlip: true, hasBorders: false, objectCaching: false, noScaleCache: true,
  });
  box.setControlsVisibility({ mtr: false });
  const others = c.getObjects().map((o) => ({ o, evented: o.evented, selectable: o.selectable }));
  others.forEach(({ o }) => { o.evented = false; o.selectable = false; });
  img.visible = false; img.clipPath = undefined;
  ed.loading = true; // no history while cropping
  c.add(ghost, box); c.setActiveObject(box);
  let ratio = null; // locked aspect ratio for the window, or null

  const gb = () => { const r = ghost.getBoundingRect(); return { x0: r.left, y0: r.top, x1: r.left + r.width, y1: r.top + r.height }; };
  const bb = () => { const w = box.width * box.scaleX, h = box.height * box.scaleY; return { x0: box.left - w / 2, y0: box.top - h / 2, x1: box.left + w / 2, y1: box.top + h / 2, w, h }; };
  // keep the window inside the picture
  const clampBox = () => {
    const g = gb(); let b = bb();
    let w = Math.min(b.w, g.x1 - g.x0), h = Math.min(b.h, g.y1 - g.y0);
    if (ratio) { if (w / h > ratio) w = h * ratio; else h = w / ratio; }
    box.set({ width: w, height: h, scaleX: 1, scaleY: 1 }); b = bb();
    box.set({ left: Math.min(Math.max(box.left, g.x0 + w / 2), g.x1 - w / 2), top: Math.min(Math.max(box.top, g.y0 + h / 2), g.y1 - h / 2) });
    box.setCoords();
  };
  // keep the picture covering the window
  const clampGhost = () => {
    const b = bb(); const gw = EW * ghost.scaleX, gh = EH * ghost.scaleY;
    if (gw < b.w || gh < b.h) { const k = Math.max(b.w / EW, b.h / EH); ghost.set({ scaleX: k, scaleY: k }); }
    const w2 = (EW * ghost.scaleX) / 2, h2 = (EH * ghost.scaleY) / 2;
    ghost.set({ left: Math.min(Math.max(ghost.left, b.x1 - w2), b.x0 + w2), top: Math.min(Math.max(ghost.top, b.y1 - h2), b.y0 + h2) });
    ghost.setCoords();
  };
  const onMove = (e) => { if (e.target === box) clampBox(); if (e.target === ghost) clampGhost(); };
  const onScale = (e) => { if (e.target === ghost) clampGhost(); };
  const onModified = (e) => { if (e.target === box) clampBox(); if (e.target === ghost) clampGhost(); c.requestRenderAll(); };
  const overlay = ({ ctx }) => {
    if (ctx !== c.getContext()) return;
    const v = c.viewportTransform; const b = bb();
    ctx.save(); ctx.transform(...v);
    ctx.beginPath(); ctx.rect(-1e6, -1e6, 2e6, 2e6); ctx.rect(b.x0, b.y0, b.w, b.h); ctx.fillStyle = 'rgba(8,9,10,0.62)'; ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1 / v[0];
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(b.x0 + (b.w * i) / 3, b.y0); ctx.lineTo(b.x0 + (b.w * i) / 3, b.y1); ctx.moveTo(b.x0, b.y0 + (b.h * i) / 3); ctx.lineTo(b.x1, b.y0 + (b.h * i) / 3); ctx.stroke(); }
    ctx.restore();
  };
  c.on('object:moving', onMove); c.on('object:scaling', onScale); c.on('object:modified', onModified); c.on('after:render', overlay);
  c.requestRenderAll();

  const end = (apply) => {
    c.off('object:moving', onMove); c.off('object:scaling', onScale); c.off('object:modified', onModified); c.off('after:render', overlay);
    clampBox(); clampGhost();
    if (apply) {
      const b = bb(); const k = ghost.scaleX, ky = ghost.scaleY;
      const gx0 = ghost.left - (EW * k) / 2, gy0 = ghost.top - (EH * ky) / 2;
      let lx = (b.x0 - gx0) / k, ly = (b.y0 - gy0) / ky; const w = b.w / k, h = b.h / ky;
      if (ghost.flipX) lx = EW - lx - w; if (ghost.flipY) ly = EH - ly - h;
      img.set({ cropX: Math.max(0, lx), cropY: Math.max(0, ly), width: Math.min(EW, w), height: Math.min(EH, h), scaleX: k, scaleY: ky, left: box.left, top: box.top });
    }
    c.remove(ghost, box);
    others.forEach(({ o, evented, selectable }) => { o.evented = evented; o.selectable = selectable; });
    img.visible = true; img.clipPath = clip;
    if (angle) img.rotate(angle);
    img.setCoords(); ed.loading = false; ed.cropping = null;
    c.setActiveObject(img); c.requestRenderAll();
    if (apply) ed.commit();
    onEnd && onEnd(apply, img);
  };
  Object.assign(ed.cropping, {
    starting: false,
    done: () => end(true), cancel: () => end(false),
    setRatio: (r) => { ratio = r === 'original' ? EW / EH : r; if (ratio) { const b = bb(); let w = b.w, h = b.h; if (w / h > ratio) w = h * ratio; else h = w / ratio; box.set({ width: w, height: h, scaleX: 1, scaleY: 1 }); } box.setControlsVisibility({ ml: !ratio, mr: !ratio, mt: !ratio, mb: !ratio }); clampBox(); c.setActiveObject(box); c.requestRenderAll(); },
    reset: () => { const k = Math.min(b0.w / EW, b0.h / EH); ghost.set({ scaleX: k, scaleY: k, left: box.left, top: box.top }); box.set({ width: EW * k, height: EH * k, scaleX: 1, scaleY: 1 }); ratio = null; box.setControlsVisibility({ ml: true, mr: true, mt: true, mb: true }); ghost.setCoords(); box.setCoords(); c.requestRenderAll(); },
  });
  const b0 = bb();
  return ed.cropping;
}
