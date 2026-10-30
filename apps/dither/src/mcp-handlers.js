// Dither — answers tool calls from Claude / Codex (through the bridge). Plain functions over the project library, a
// render function and the image engine, so they can be tested without Electron. Every result that makes pixels sends
// a picture back, so the AI always sees what it made.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const png = require('./core/png');
const sheets = require('./core/sheets');
const SP = require('./core/sprite');
const FX = require('./core/fxruntime');
const EX = require('./core/exporters');
const snap = require('./core/pixelsnap');
const { LIB } = require('./core/fxlib');
const { guideText } = require('./core/guide');
const SH = require('./core/shade');
const CR = require('./core/critic');

const text = (v) => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) });
const image = (img) => ({ type: 'image', data: png.encode(img).toString('base64'), mimeType: 'image/png' });
const ok = (...content) => ({ content: content.flat().filter(Boolean) });
const err = (m) => ({ content: [text(m)], isError: true });
const home = (p) => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir());

function makeHandlers(ctx) {
  // ctx: { lib, active(): Project, setActive(id), render(code, opts) → {meta, frames}, webm(frames, meta, opts), engine, decodeImage(file) → {w,h,data}, changed(kind, id), activity(msg) }
  let who = 'Claude'; if (!ctx.client) ctx.client = () => who;
  const P = (ref) => (ref ? ctx.lib.get(ref) : ctx.active());
  const summaryOf = (meta, frames) => ({ size: `${meta.w}×${meta.h}`, frames: meta.n, fps: meta.fps, total_ms: meta.durations.reduce((a, b) => a + b, 0), loop: meta.loop, colors_used: sheets.colorsUsed(frames).length, empty_frames: frames.map((f, i) => (sheets.bounds([f], meta.w, meta.h) ? null : i + 1)).filter(Boolean) });
  async function renderEffect(proj, ref, { version, params, seed } = {}) {
    const e = proj.getEffect(ref, version);
    const r = await ctx.render(e.code, { params: { ...(e.params || {}), ...(params || {}) }, seed });
    return { e, ...r };
  }
  const sheetFor = (r, title) => sheets.contactSheet(r.frames, r.meta.w, r.meta.h, { title, durations: r.meta.durations });
  const fbOf = (m) => ({ verdict: m.feedback?.verdict || null, stars: m.feedback?.stars || 0, open_notes: (m.feedback?.notes || []).map((n, i) => ({ index: i, ...n })).filter((n) => !n.done).map(({ index, text: t, frame, v, at }) => ({ index, note: t, frame, on_version: v, at: new Date(at).toISOString() })), resolved_notes: (m.feedback?.notes || []).filter((n) => n.done).length });
  const spriteImg = (s, frames, scale) => { const fr = (frames || s.frames.map((_, i) => i)).map((i) => SP.compose(s, i)); return sheets.contactSheet(fr, s.w, s.h, { title: s.name, durations: s.frames.map((f) => f.duration), scale }); };

  const H = {
    dither_guide: () => ok(text(guideText())),

    dither_context: async () => {
      let a = null; try { a = ctx.active(); } catch {}
      const projects = ctx.lib.list().map((p) => ({ id: p.id, name: p.name, counts: p.counts, active: !!a && p.id === a.id }));
      let eng = null; try { const s = await ctx.engine.status(); eng = s.engine ? { name: s.engine.name, url: s.engine.url, checkpoints: s.engine.checkpoints?.length, sdxl_checkpoints: s.engine.xl?.slice(0, 5), pixel_art_lora: !!s.engine.hasLora } : 'none running (generate_image needs Forge/A1111/ComfyUI running, e.g. from Kiln)'; } catch {}
      return ok(text({
        active_project: a ? { id: a.id, name: a.name, folder: a.dir, sprites: a.listSprites().slice(0, 30).map((s) => ({ id: s.id, name: s.name, size: `${s.w}×${s.h}`, frames: s.frames })), effects: a.listEffects().slice(0, 40).map((e) => ({ id: e.id, name: e.name, version: e.current, board: e.boardId, verdict: e.feedback?.verdict || null, open_notes: (e.feedback?.notes || []).filter((n) => !n.done).length })), boards: a.meta.boards.slice(0, 8).map((b) => ({ id: b.id, idea: b.idea, drafts: b.items.length, status: b.status, round: b.round })), references: a.meta.refs.length } : null,
        projects, palettes: Object.keys(FX.PALETTES), ramps: Object.keys(FX.RAMPS), library: LIB.map((l) => l.id), local_image_engine: eng, platform: process.platform,
      }));
    },

    create_project: ({ name, description }) => { const p = ctx.lib.create(name || 'Untitled', { description }); ctx.setActive(p.id); ctx.changed('projects'); ctx.activity(`Started project “${p.name}”`); return ok(text({ id: p.id, name: p.name, folder: p.dir, active: true })); },
    set_active_project: ({ project }) => { const p = ctx.lib.get(project); ctx.setActive(p.id); ctx.changed('projects'); return ok(text({ active: p.name, id: p.id })); },

    list_library: () => ok(text(LIB.map((l) => ({ id: l.id, name: l.name, group: l.group, about: l.blurb })))),
    get_library_effect: async ({ id, look }) => {
      const l = LIB.find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase()); if (!l) return err(`No library effect “${id}”. Try: ${LIB.map((x) => x.id).join(', ')}`);
      const parts = [text({ id: l.id, name: l.name, about: l.blurb, code: l.code })];
      if (look !== false) { const r = await ctx.render(l.code); parts.push(image(sheetFor(r, l.name))); }
      return ok(parts);
    },

    try_effect: async ({ code, params, seed }) => {
      try { const r = await ctx.render(code, { params, seed }); return ok(text({ ok: true, ...summaryOf(r.meta, r.frames), note: 'Not saved. Use create_effect or create_drafts to keep it.' }), image(sheetFor(r, r.meta.name))); }
      catch (e) { return err(`The code didn’t run: ${e.message}${e.line ? ` (around line ${e.line})` : ''}`); }
    },

    create_drafts: async ({ idea, brief, drafts, project }) => {
      if (!Array.isArray(drafts) || !drafts.length) return err('Pass drafts: [{ name, code, note }] — 5 to 10 different takes on the idea');
      if (drafts.length > 12) return err('Up to 12 drafts per round');
      const proj = P(project); const b = proj.createBoard({ idea, brief, by: ctx.client() });
      const results = [], rows = [];
      for (const d of drafts) {
        const m = proj.createEffect({ name: d.name || `Draft ${results.length + 1}`, code: d.code, by: ctx.client(), note: d.note || '', boardId: b.id });
        try { const r = await ctx.render(d.code); results.push({ id: m.id, name: m.name, ok: true, ...summaryOf(r.meta, r.frames) }); rows.push({ label: `${rows.length + 1}. ${m.name}`, frames: r.frames, w: r.meta.w, h: r.meta.h }); }
        catch (e) { results.push({ id: m.id, name: m.name, ok: false, error: e.message, line: e.line || undefined }); }
      }
      ctx.changed('board', b.id); ctx.activity(`Made ${drafts.length} drafts for “${b.idea}”`, { board: b.id });
      const broken = results.filter((r) => !r.ok).length;
      return ok(text({ board: b.id, idea: b.idea, drafts: results, next: `${broken ? `Fix the ${broken} broken draft${broken === 1 ? '' : 's'} with update_effect. ` : ''}The drafts are playing side by side on the board in Dither. Ask the user to pick favourites and leave notes there, then call get_feedback.` }), rows.length ? image(sheets.boardSheet(rows)) : null);
    },

    create_effect: async ({ name, code, note, project }) => {
      const proj = P(project); const m = proj.createEffect({ name, code, by: ctx.client(), note: note || '' });
      ctx.changed('effect', m.id); ctx.activity(`Created effect “${m.name}”`, { effect: m.id });
      try { const r = await ctx.render(code); return ok(text({ id: m.id, name: m.name, version: 1, ...summaryOf(r.meta, r.frames) }), image(sheetFor(r, m.name))); }
      catch (e) { return ok(text({ id: m.id, name: m.name, version: 1, error: `Saved, but it doesn’t run yet: ${e.message}${e.line ? ` (around line ${e.line})` : ''}. Fix it with update_effect.` })); }
    },

    update_effect: async ({ effect, code, note, name, resolves, project }) => {
      const proj = P(project); let m = proj.updateEffect(effect, { code, by: ctx.client(), note: note || '', name });
      if (resolves !== undefined && resolves !== null) { const list = resolves === 'all' ? ['all'] : [].concat(resolves); for (const i of list) m = proj.feedback(m.id, { resolve: i === 'all' ? 'all' : Number(i) }); }
      ctx.changed('effect', m.id); ctx.activity(`Updated “${m.name}” to v${m.current}${note ? ': ' + note : ''}`, { effect: m.id });
      try { const r = await renderEffect(proj, m.id); return ok(text({ id: m.id, name: m.name, version: m.current, ...summaryOf(r.meta, r.frames) }), image(sheetFor(r, `${m.name} v${m.current}`))); }
      catch (e) { return ok(text({ id: m.id, version: m.current, error: `Saved as v${m.current}, but it doesn’t run: ${e.message}${e.line ? ` (around line ${e.line})` : ''}` })); }
    },

    get_effect: ({ effect, version, project }) => { const e = P(project).getEffect(effect, version); return ok(text({ id: e.id, name: e.name, version: e.version, versions: e.versions, board: e.boardId, params_set_by_user: e.params, feedback: fbOf(e), code: e.code })); },

    list_effects: ({ board, project }) => { const proj = P(project); let list = proj.listEffects(); if (board) { const b = proj.getBoard(board); list = list.filter((e) => b.items.includes(e.id)); } return ok(text(list.map((e) => ({ id: e.id, name: e.name, version: e.current, board: e.boardId, by: e.by, verdict: e.feedback?.verdict || null, stars: e.feedback?.stars || 0, open_notes: (e.feedback?.notes || []).filter((n) => !n.done).length })))); },

    get_feedback: ({ board, effect, project }) => {
      const proj = P(project);
      if (effect) { const m = proj.resolveEffect(effect); return ok(text({ id: m.id, name: m.name, version: m.current, ...fbOf(m) })); }
      if (!proj.meta.boards.length) return ok(text({ note: 'No draft boards yet. Make some with create_drafts.' }));
      const b = proj.getBoard(board || 'latest'); const items = b.items.map((id) => { try { return proj.effectMeta(id); } catch { return null; } }).filter(Boolean);
      const rows = items.map((m) => ({ id: m.id, name: m.name, version: m.current, ...fbOf(m) }));
      const reviewed = rows.filter((r) => r.verdict || r.stars || r.open_notes.length).length;
      return ok(text({ board: b.id, idea: b.idea, brief: b.brief || undefined, round: b.round, board_note: b.note || undefined, reviewed: `${reviewed} of ${rows.length}`, picks: rows.filter((r) => r.verdict === 'pick').map((r) => r.id), drafts: rows, hint: reviewed ? 'Refine the picks (and anything with notes) with update_effect; leave the rest. Mention which notes you addressed.' : 'The user hasn’t reviewed this board yet. Ask them to open Dither, pick favourites and leave notes.' }));
    },

    view: async ({ kind, id, frame, scale, params, project, version, region }) => {
      const proj = P(project);
      if (region && (kind === 'effect' || kind === 'sprite')) {
        const f = await framesOf(proj, kind, id); const fi = Math.max(0, Math.min(f.frames.length - 1, (frame || 1) - 1)); const c = CR.crop(f.frames[fi], f.meta.w, f.meta.h, region);
        const sc = scale || Math.max(4, Math.min(24, Math.floor(480 / Math.max(c.w, c.h))));
        return ok(text({ id, frame: fi + 1, region: { x: region.x | 0, y: region.y | 0, w: c.w, h: c.h }, scale: sc, note: 'Pixel grid at 1 square per pixel; coordinates are sprite pixels.' }), image(gridded(c, sc)));
      }
      if (kind === 'effect') { const r = await renderEffect(proj, id, { version, params }); const fr = frame ? [r.frames[Math.max(0, Math.min(r.frames.length - 1, frame - 1))]] : r.frames; return ok(text({ id: r.e.id, name: r.e.name, version: r.e.version, ...summaryOf(r.meta, r.frames) }), image(sheets.contactSheet(fr, r.meta.w, r.meta.h, { title: `${r.e.name} v${r.e.version}`, scale, durations: frame ? null : r.meta.durations }))); }
      if (kind === 'sprite') { const s = proj.getSprite(id); return ok(text({ id: s.id, name: s.name, size: `${s.w}×${s.h}`, frames: s.frames.length, layers: s.layers.map((l) => l.name) }), image(spriteImg(s, frame ? [frame - 1] : null, scale))); }
      if (kind === 'reference') { const r = proj.meta.refs.find((x) => x.id === id || x.title === id); if (!r) return err('No such reference. Use list_references.'); const img = ctx.decodeImage(proj.p('refs', r.file)); const s = Math.min(1, 1200 / Math.max(img.w, img.h)); return ok(text({ id: r.id, title: r.title, note: r.note }), image(s < 1 ? shrink(img, s) : img)); }
      if (kind === 'board') { const b = proj.getBoard(id || 'latest'); const rows = []; for (const eid of b.items) { try { const r = await renderEffect(proj, eid); rows.push({ label: `${r.e.name}${r.e.feedback?.verdict ? ' (' + r.e.feedback.verdict + ')' : ''}`, frames: r.frames, w: r.meta.w, h: r.meta.h }); } catch {} } return ok(text({ board: b.id, idea: b.idea }), rows.length ? image(sheets.boardSheet(rows)) : null); }
      if (kind === 'library') { return H.get_library_effect({ id }); }
      return err('kind must be effect, sprite, reference, board or library');
    },

    list_references: ({ project }) => ok(text(P(project).meta.refs.map((r) => ({ id: r.id, title: r.title, note: r.note || undefined })))),

    create_sprite: ({ name, w, h, width, height, palette, frames, fps, project }) => {
      const proj = P(project); const s = SP.create({ name: name || 'Sprite', w: w || width || 32, h: h || height || 32, palette: palette || 'pico8', frames: frames || 1, fps: fps || 12 });
      proj.saveSprite(s); ctx.changed('sprite', s.id); ctx.activity(`Created sprite “${s.name}”`, { sprite: s.id });
      return ok(text({ id: s.id, name: s.name, size: `${s.w}×${s.h}`, frames: s.frames.length, layer: s.layers[0].name, palette: s.palette.map((c, i) => `${i.toString(36)}=${c}`).join(' ') }));
    },

    draw_sprite: ({ sprite, ops, frame, layer, look, project }) => {
      if (!Array.isArray(ops)) return err('ops must be an array of draw ops (see dither_guide)');
      const proj = P(project); const s = proj.getSprite(sprite);
      const touched = SP.apply(s, ops, { frame: frame || 0, layer });
      const warnings = s._warnings; delete s._warnings; proj.saveSprite(s); ctx.changed('sprite', s.id);
      const frames = [...new Set(touched.map((k) => s.frames.findIndex((f) => f.id === k.split('/')[1])))].sort((a, b) => a - b);
      return ok(text({ id: s.id, changed_frames: frames.map((i) => i + 1), ops: ops.length, warnings }), look === false ? null : image(spriteImg(s, frames.length ? frames : [frame || 0])));
    },

    draw_svg: ({ sprite, svg, name, w, h, palette, frame, layer, mode, snap, project }) => {
      if (!svg) return err('Pass svg: an <svg viewBox="0 0 W H"> using the sprite’s pixel coordinates');
      const proj = P(project); let s;
      if (sprite) s = proj.getSprite(sprite);
      else { if (!w || !h) return err('Give the sprite to draw on, or w and h (pixels) for a new one'); s = SP.create({ name: name || 'Vector sprite', w, h, palette: palette || [], frames: 1 }); if (!palette) s.palette = []; }
      SP.apply(s, [{ op: 'svg', svg, mode: mode || (sprite ? 'over' : 'replace'), snap: !!snap, frame: frame || 0, layer }]);
      const warnings = s._warnings; delete s._warnings; proj.saveSprite(s); ctx.changed('sprite', s.id); if (!sprite) ctx.activity(`Drew “${s.name}” from vectors`, { sprite: s.id });
      return ok(text({ sprite: s.id, size: `${s.w}×${s.h}`, materials_tagged: s.materials || {}, colors: s.palette.length, warnings, next: Object.keys(s.materials || {}).length ? 'Flats are down. Shade them with shade_sprite (materials come from your data-material tags), then critique.' : 'Tag shapes with data-material="metal|cloth|skin|…" (and data-form) or pass materials to shade_sprite.' }), image(spriteImg(s, [frame || 0])));
    },

    shade_sprite: ({ sprite, materials, light, dither, outline, steps, frames, layer, ao, rim, specular, project }) => {
      const proj = P(project); const s = proj.getSprite(sprite);
      const list = frames === 'all' || frames === undefined && s.frames.length > 1 ? s.frames.map((_, i) => i) : [].concat(frames ?? 0).map((f) => (typeof f === 'number' ? f : 0));
      const before = SP.compose(s, list[0]);
      SP.apply(s, list.map((f) => ({ op: 'shade', materials, light, dither, outline, steps, ao, rim, specular, frame: f, layer })));
      const warnings = s._warnings ? [...new Set(s._warnings)] : undefined; delete s._warnings; proj.saveSprite(s); ctx.changed('sprite', s.id);
      const after = SP.compose(s, list[0]); const pair = sheets.contactSheet([before, after], s.w, s.h, { title: `${s.name}: before / after`, cols: 2 });
      return ok(text({ sprite: s.id, frames_shaded: list.map((i) => i + 1), light: light || 'top-left', palette_size: s.palette.length, warnings, next: 'Run critique to catch stray pixels, jaggies and pillow shading, then fix with draw_sprite.' }), image(pair));
    },

    make_ramp: ({ base, material, steps, hue_shift, contrast, add_to, project }) => {
      if (!base) return err('Pass base: a colour like "#3b5dc9"'); const ramp = SH.makeRamp(base, { material, steps, hueShift: hue_shift, contrast });
      if (add_to) { const proj = P(project); const s = proj.getSprite(add_to); SP.apply(s, []); for (const c of ramp) if (!s.palette.includes(c)) s.palette.push(c); proj.saveSprite(s); ctx.changed('sprite', s.id); }
      const sw = sheets.blank(ramp.length * 24, 24); ramp.forEach((c, i) => { const rgb = FX.hex(c); for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) sw.data.set([rgb[0], rgb[1], rgb[2], 255], ((y * sw.w) + i * 24 + x) * 4); });
      return ok(text({ ramp, dark_to_light: true, materials: Object.keys(SH.MATERIALS) }), image(sw));
    },

    critique: async ({ kind = 'sprite', id, frame, version, project }) => {
      const proj = P(project); const f = await framesOf(proj, kind, id, version);
      const r = CR.critique(f.frames, f.meta.w, f.meta.h, { frame: frame ? frame - 1 : undefined, title: `${f.name}: critique`, allowSparks: kind === 'effect' });
      return ok(text({ ...r.summary, issues: r.issues.map(({ n, type, severity, x, y, w, h, frame: fr, message }) => ({ n, type, severity, at: x != null ? { x, y, w, h } : undefined, frame: fr, message })), how: 'Numbers match the boxes on the picture. Fix majors first; take another look with view (region) to see an area up close.' }), image(r.image));
    },

    get_sprite: ({ sprite, frame, layer, as, project }) => {
      const s = P(project).getSprite(sprite);
      const info = { id: s.id, name: s.name, w: s.w, h: s.h, palette: s.palette.map((c, i) => `${i.toString(36)}=${c}`).join(' '), layers: s.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible })), frames: s.frames.map((f, i) => ({ index: i, duration: f.duration })), tags: s.tags };
      if (as === 'rows' || frame !== undefined) {
        const fi = frame || 0; const l = layer ? s.layers.find((x) => x.id === layer || x.name === layer) : null;
        const d = l ? SP.getCel(s, l.id, s.frames[fi].id) || new Uint8ClampedArray(s.w * s.h * 4) : SP.compose(s, fi);
        const pal = s.palette.map(FX.hex); const extra = {}; let ex = 0;
        const rows = []; for (let y = 0; y < s.h; y++) { let r = ''; for (let x = 0; x < s.w; x++) { const i = (y * s.w + x) * 4; if (!d[i + 3]) { r += '.'; continue; } const k = pal.findIndex((p) => p[0] === d[i] && p[1] === d[i + 1] && p[2] === d[i + 2]); if (k >= 0 && k < 36) r += k.toString(36); else { const hx = FX.toHex([d[i], d[i + 1], d[i + 2]]); if (!extra[hx]) extra[hx] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[ex++] || '?'; r += extra[hx]; } } rows.push(r); }
        info.frame = fi; info.rows = rows; if (ex) info.off_palette = Object.fromEntries(Object.entries(extra).map(([h, k]) => [k, h]));
      }
      return ok(text(info));
    },

    edit_sprite: ({ sprite, action, index, to, count, durations, name, layer, visible, palette, w, h, anchor, from, project }) => {
      const proj = P(project); const s = proj.getSprite(sprite);
      switch (action) {
        case 'add_frame': for (let i = 0; i < (count || 1); i++) SP.addFrame(s, { at: index ?? s.frames.length }); break;
        case 'duplicate_frame': SP.addFrame(s, { at: (index ?? s.frames.length - 1) + 1, copyFrom: index ?? s.frames.length - 1 }); break;
        case 'delete_frame': SP.removeFrame(s, index); break;
        case 'move_frame': SP.moveFrame(s, index, to); break;
        case 'set_durations': (Array.isArray(durations) ? durations : [durations]).forEach((d, i) => { const f = s.frames[(index || 0) + i]; if (f && d) f.duration = Math.max(10, Math.round(d)); }); if (!Array.isArray(durations)) s.frames.forEach((f) => (f.duration = Math.max(10, Math.round(durations)))); break;
        case 'add_layer': SP.addLayer(s, { name }); break;
        case 'delete_layer': SP.removeLayer(s, (s.layers.find((l) => l.id === layer || l.name === layer) || {}).id); break;
        case 'set_layer': { const l = s.layers.find((x) => x.id === layer || x.name === layer); if (!l) return err('No such layer'); if (name) l.name = name; if (visible !== undefined) l.visible = !!visible; break; }
        case 'set_palette': s.palette = FX.resolvePalette(palette); break;
        case 'resize': SP.resize(s, w || s.w, h || s.h, { anchor }); break;
        case 'add_tag': s.tags.push({ name: name || 'tag', from: from ?? 0, to: to ?? s.frames.length - 1, direction: 'forward' }); break;
        case 'rename': s.name = name || s.name; break;
        default: return err('action: add_frame, duplicate_frame, delete_frame, move_frame, set_durations, add_layer, delete_layer, set_layer, set_palette, resize, add_tag, rename');
      }
      proj.saveSprite(s); ctx.changed('sprite', s.id);
      return ok(text({ id: s.id, frames: s.frames.length, durations: s.frames.map((f) => f.duration), layers: s.layers.map((l) => l.name), size: `${s.w}×${s.h}` }));
    },

    bake_effect: async ({ effect, name, project }) => {
      const proj = P(project); const r = await renderEffect(proj, effect);
      const s = SP.fromFrames({ name: name || `${r.e.name} (baked)`, w: r.meta.w, h: r.meta.h, frames: r.frames, durations: r.meta.durations, palette: r.meta.palette });
      s.from = { effect: r.e.id, version: r.e.version }; proj.saveSprite(s); ctx.changed('sprite', s.id); ctx.activity(`Baked “${r.e.name}” into a sprite`, { sprite: s.id });
      return ok(text({ sprite: s.id, name: s.name, frames: s.frames.length }));
    },

    record: async ({ kind = 'effect', id, formats, scale, project }) => {
      const proj = P(project); const { name, frames, meta } = await framesOf(proj, kind, id); const dir = proj.outDir('records'); const base = EX.fileBase(name);
      const want = formats && formats.length ? formats : ['gif', 'sheet']; const files = [];
      const s = scale || Math.max(2, Math.min(8, Math.floor(256 / Math.max(meta.w, meta.h))));
      if (want.includes('gif')) files.push(EX.writeGif(proj.uniqueFile(dir, base, '.gif'), frames, meta.w, meta.h, { durations: meta.durations, scale: s, background: [22, 20, 30], loop: true }));
      if (want.includes('sheet')) files.push(EX.writeContact(proj.uniqueFile(dir, `${base} sheet`, '.png'), frames, meta.w, meta.h, { title: name, durations: meta.durations }));
      if (want.includes('webm') && ctx.webm) { try { const buf = await ctx.webm(frames, meta, { scale: s }); const f = proj.uniqueFile(dir, base, '.webm'); fs.writeFileSync(f, buf); files.push(f); } catch (e) { files.push(`(video skipped: ${e.message})`); } }
      ctx.changed('records'); ctx.activity(`Recorded “${name}”`); return ok(text({ files }));
    },

    export: async ({ kind = 'effect', id, format = 'sheet', dest, scale, cols, padding, project }) => {
      const proj = P(project); const { name, frames, meta, code } = await framesOf(proj, kind, id);
      const dir = dest ? home(dest) : proj.outDir('exports'); fs.mkdirSync(dir, { recursive: true }); let files;
      if (format === 'sheet') files = EX.writeSheet(dir, name, frames, meta.w, meta.h, { durations: meta.durations, cols, padding });
      else if (format === 'gif') files = [EX.writeGif(path.join(dir, `${EX.fileBase(name)}.gif`), frames, meta.w, meta.h, { durations: meta.durations, scale: scale || 1, loop: meta.loop !== false })];
      else if (format === 'frames') files = EX.writeFrames(dir, name, frames, meta.w, meta.h, { scale: scale || 1 });
      else if (format === 'png') { const f = path.join(dir, `${EX.fileBase(name)}.png`); fs.writeFileSync(f, png.encode(scale > 1 ? sheets.scaleImage({ w: meta.w, h: meta.h, data: frames[0] }, scale) : { w: meta.w, h: meta.h, data: frames[0] })); files = [f]; }
      else if (format === 'module') { if (kind !== 'effect') return err('JS modules are for effects. Export sprites as a sheet.'); files = [EX.writeModule(dir, code, meta)]; }
      else return err('format: sheet, gif, frames, png or module');
      ctx.activity(`Exported “${name}” (${format})`); return ok(text({ files }));
    },

    pixelize_image: async ({ path: file, width, colors, palette, remove_background, name, project }) => {
      const proj = P(project); const img = ctx.decodeImage(home(file));
      const r = snap.snap(img, { width, colors, palette, background: remove_background !== false });
      const s = SP.create({ name: name || path.basename(file).replace(/\.[^.]+$/, ''), w: r.img.w, h: r.img.h, palette: r.palette.length ? r.palette : 'pico8' });
      SP.setCel(s, s.layers[0].id, s.frames[0].id, r.img.data); proj.saveSprite(s); ctx.changed('sprite', s.id);
      return ok(text({ sprite: s.id, size: `${s.w}×${s.h}`, grid_cell_px: r.grid.cell, colors: r.palette.length }), image(sheets.contactSheet([r.img.data], r.img.w, r.img.h, { title: s.name })));
    },

    generate_image: async ({ prompt, size, colors, palette, checkpoint, seed, name, project }) => {
      const proj = P(project); ctx.activity(`Generating “${String(prompt).slice(0, 60)}” on this computer…`);
      const g = await ctx.engine.generate({ prompt, checkpoint, seed });
      const img = png.decode(g.png); const r = snap.snap(img, { width: size || undefined, colors: colors || undefined, palette });
      const s = SP.create({ name: name || String(prompt).slice(0, 40), w: r.img.w, h: r.img.h, palette: r.palette.length ? r.palette : 'pico8' });
      SP.setCel(s, s.layers[0].id, s.frames[0].id, r.img.data); s.from = { generated: { prompt, seed: g.seed, checkpoint: g.checkpoint, lora: g.lora } };
      proj.saveSprite(s); const raw = proj.uniqueFile(proj.outDir('records'), `generated ${g.seed}`, '.png'); fs.writeFileSync(raw, g.png); ctx.changed('sprite', s.id);
      return ok(text({ sprite: s.id, size: `${s.w}×${s.h}`, colors: r.palette.length, seed: g.seed, checkpoint: g.checkpoint, pixel_art_lora: g.lora, raw_image: raw, note: 'Pixel-snapped from the model’s output. Clean it up with draw_sprite (outline, stray pixels, palette).' }), image(sheets.contactSheet([r.img.data], r.img.w, r.img.h, { title: s.name })));
    },

    delete_item: ({ kind, id, project }) => {
      const proj = P(project);
      if (kind === 'effect') { const m = proj.resolveEffect(id); proj.removeEffect(m.id); } else if (kind === 'sprite') proj.removeSprite(proj.getSprite(id).id); else if (kind === 'board') proj.removeBoard(id); else return err('kind: effect, sprite or board');
      ctx.changed(kind, id); return ok(text({ deleted: id, note: 'Moved to the project’s .trash folder' }));
    },
  };

  async function framesOf(proj, kind, id, version) {
    if (kind === 'effect') { const r = await renderEffect(proj, id, { version }); return { name: r.e.name, frames: r.frames, meta: r.meta, code: r.e.code }; }
    if (kind === 'sprite') { const s = proj.getSprite(id); return { name: s.name, frames: SP.composeAll(s), meta: { w: s.w, h: s.h, n: s.frames.length, durations: s.frames.map((f) => f.duration), loop: true } }; }
    if (kind === 'library') { const l = LIB.find((x) => x.id === id); if (!l) throw new Error('No such library effect'); const r = await ctx.render(l.code); return { name: l.name, frames: r.frames, meta: r.meta, code: l.code }; }
    throw new Error('kind must be effect, sprite or library');
  }

  return async (name, args, client) => {
    const fn = H[name]; if (!fn) return err('Unknown tool ' + name); if (client) who = client;
    try { return await fn(args || {}); } catch (e) { return err(e.message || String(e)); }
  };
}

// a zoomed crop with a faint pixel grid and every 8th line stronger, so coordinates can be read off
function gridded(c, s) {
  const img = sheets.blank(c.w * s + 1, c.h * s + 1, [16, 14, 22]); sheets.checker(img, 0, 0, c.w * s, c.h * s, s); sheets.put(img, c.data, c.w, c.h, 0, 0, s);
  for (let y = 0; y <= c.h * s; y++) for (let x = 0; x <= c.w * s; x++) { const gx = x % s === 0, gy = y % s === 0; if (!gx && !gy) continue; const strong = (gx && (x / s) % 8 === 0) || (gy && (y / s) % 8 === 0); const k = (y * img.w + x) * 4; const a = strong ? 0.5 : 0.18; img.data[k] = img.data[k] * (1 - a) + 255 * a; img.data[k + 1] = img.data[k + 1] * (1 - a) + 255 * a; img.data[k + 2] = img.data[k + 2] * (1 - a) + 255 * a; img.data[k + 3] = 255; }
  return img;
}
function shrink(img, s) { const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s)); const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (Math.min(img.h - 1, Math.floor(y / s)) * img.w + Math.min(img.w - 1, Math.floor(x / s))) * 4; d.set(img.data.subarray(i, i + 4), (y * w + x) * 4); } return { w, h, data: d }; }

module.exports = { makeHandlers };
