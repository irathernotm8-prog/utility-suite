// Mural — what each plugin tool does inside the app. Every result is MCP content: text, and pictures for preview.
'use strict';
const fs = require('fs');
const path = require('path');

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const err = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function makeHandlers({ library, schema, apply, host, store, setSettings, preview, notify }) {
  const resolveId = (id) => {
    if (library.read(id)) return id;
    const w = library.list().find((x) => x.name.toLowerCase() === String(id || '').toLowerCase()); if (w) return w.id;
    throw new Error(`No wallpaper "${id}". Call list_wallpapers for ids.`);
  };
  const readCode = (id, m) => { if (m.type !== 'shader') return null; if (m.code) return m.code; try { return fs.readFileSync(library.fileOf(id, m.shader || 'main.frag'), 'utf8'); } catch (_) { return null; } };
  const findLayer = (layers, ref) => { const i = layers.findIndex((l) => l.id === ref || (l.name || '').toLowerCase() === String(ref || '').toLowerCase()); if (i < 0) throw new Error(`No layer "${ref}". Layers: ${layers.map((l) => `${l.name} (${l.id})`).join(', ')}`); return i; };

  function guide() {
    const kinds = Object.entries(schema.KINDS).map(([k, v]) => `- ${k} — ${v.hint}${v.animated ? ' (draws every frame)' : ' (still: cached, free once drawn)'}\n    ${v.fields.map((f) => `${f.key}: ${f.type}${f.options ? ' [' + f.options.join('|') + ']' : ''}${f.min != null ? ` ${f.min}..${f.max}` : ''} = ${JSON.stringify(f.default)}`).join('; ')}`).join('\n');
    return `# Mural wallpapers

A wallpaper is a folder with mural.json. Types: scene, shader, video, image, web. Ids: "builtin/<slug>" (read-only) or "user/<slug>".

## Scenes
scene.layers is drawn bottom → top (first layer is the back). Positions and sizes are fractions of the screen (0..1; x,y from the top-left).
Every layer also has: ${schema.COMMON.map((f) => `${f.key} (${f.options ? f.options.join('|') : f.type}${f.min != null ? ` ${f.min}..${f.max}` : ''}, default ${JSON.stringify(f.default)})`).join(', ')}, name, hidden, when.
- depth 0..1: how far the layer shifts against the cursor (parallax). Back layers small, front layers bigger.
- when: time-of-day weights, e.g. {"night":1,"dawn":0.2,"day":0,"dusk":0.4} — the layer's opacity is multiplied by the blend of the current parts of the day. Omit for always.
Layer kinds:
${kinds}

scene.effects: ${schema.EFFECTS.map((f) => `${f.key} (${f.options ? f.options.join('|') : f.type}, default ${JSON.stringify(f.default)})`).join(', ')}.
Text tokens: {time} {time24} {seconds} {date} {day} {greeting}. Colors are hex strings. Images/videos: add_asset first, then use the returned name as src.

## Shaders
GLSL ES 1.0 fragment shader, Shadertoy style: void mainImage(out vec4 fragColor, in vec2 fragCoord). Uniforms:
iTime (s), iResolution (vec3), iMouse (vec4: xy cursor px, zw last click px), iPointer (vec2 cursor 0..1, y up, smoothed),
iClick (vec3: xy click 0..1 y up, z seconds since the click; large when none), iDaylight (0 night..1 day), iPhase (vec4 night,dawn,day,dusk), iParams (vec4 from params[0..3].value).
No textures. Mention iMouse/iPointer/iClick in the code and Mural feeds the cursor/clicks; otherwise it doesn't watch them.
Shaders render at quality.scale of the screen's pixels (0.5 is right for soft shaders; use 1 only for hairlines) and are upscaled.

## Web
Any HTML page (index.html). Mural posts messages to it: {mural:'pointer',x,y,inside}, {mural:'click',x,y,button}, {mural:'pause'}, {mural:'resume'}, {mural:'sky',phases,daylight,altitude}. Stop timers on pause. Set interactive {cursor, click} so Mural sends input.

## Performance (a wallpaper runs all day)
Mural caps frames (user setting, usually 30 fps), sleeps between them, stops drawing still scenes, and freezes the page when the desktop is hidden. Help it:
- Still layers (sky, gradient, image, hills, shape, text without {seconds}) are cached; depth/motion only moves the cached bitmap. Use them freely.
- Particles: a few hundred is plenty (rain ~500, snow ~400, fireflies ~60, bokeh ~50).
- Shaders: ≤ 5 noise octaves, a handful of loops, quality.scale 0.5. Check frame time in preview (aim < 4 ms here).

## Workflow
create_wallpaper or update_wallpaper → preview (try hour 6, 12, 19, 23 for time-of-day ones; cursor and click for interactive ones) → fix → apply only when the user wants it on the desktop.`;
  }

  async function save(id, m, files) {
    const nid = library.save(id, m, files);
    notify(); return nid;
  }

  const H = {
    mural_guide: async () => text(guide()),
    list_wallpapers: async () => {
      const st = host.status(); const on = new Set(st.displays.map((d) => d.wallpaperId));
      return text(library.list().map((w) => ({ id: w.id, name: w.name, type: w.type, tags: w.tags, builtin: w.builtin, reacts: Object.entries(w.traits).filter(([, v]) => v).map(([k]) => k), onDesktop: on.has(w.id) })));
    },
    get_wallpaper: async ({ id }) => {
      id = resolveId(id); const w = library.read(id);
      let files = []; try { files = fs.readdirSync(w.dir).filter((f) => !f.startsWith('.')); } catch (_) {}
      return text({ id, builtin: w.builtin, manifest: w.manifest, code: readCode(id, w.manifest), files });
    },
    create_wallpaper: async (a) => {
      const type = schema.TYPES.includes(a.type) ? a.type : 'scene';
      const m = { name: a.name || 'Untitled', type, author: 'Claude', tags: a.tags || [], quality: a.quality || (type === 'shader' ? { fps: 30, scale: 0.5 } : { fps: 30, scale: 1 }) };
      if (a.scene) m.scene = a.scene; else if (type === 'scene') m.scene = { layers: [] };
      if (type === 'shader') { m.shader = 'main.frag'; m.params = a.params || []; }
      if (type === 'web') { m.page = 'index.html'; m.interactive = a.interactive || { cursor: true, click: true }; }
      const id = library.create(m);
      if (type === 'shader') fs.writeFileSync(library.fileOf(id, 'main.frag'), a.code || 'void mainImage(out vec4 c, in vec2 p) { c = vec4(p / iResolution.xy, 0.5, 1.0); }');
      if (type === 'web') fs.writeFileSync(library.fileOf(id, 'index.html'), a.html || '<!doctype html><body style="background:#111"></body>');
      if ((type === 'video' || type === 'image') && a.path) { const name = library.addAsset(id, a.path); const w = library.read(id); await save(id, { ...w.manifest, src: name }); }
      library.invalidate(); notify();
      return text({ id, next: 'Call preview to look at it.' });
    },
    update_wallpaper: async (a) => {
      let id = resolveId(a.id); const w = library.read(id); const m = JSON.parse(JSON.stringify(w.manifest)); const files = {};
      if (a.name) m.name = String(a.name);
      if (a.tags) m.tags = a.tags; if (a.quality) m.quality = { ...m.quality, ...a.quality };
      if (a.scene) m.scene = a.scene;
      if (a.effects) { m.scene = m.scene || { layers: [] }; m.scene.effects = { ...(m.scene.effects || {}), ...a.effects }; }
      if (Array.isArray(a.ops) && a.ops.length) {
        m.scene = m.scene || { layers: [] }; const L = m.scene.layers = m.scene.layers || [];
        for (const op of a.ops) {
          if (op.op === 'add') { const kind = op.layer && op.layer.kind; if (!schema.KINDS[kind]) throw new Error(`Unknown layer kind "${kind}". Kinds: ${Object.keys(schema.KINDS).join(', ')}`); const l = schema.makeLayer(kind, op.layer); const i = op.index == null ? L.length : Math.max(0, Math.min(L.length, op.index)); L.splice(i, 0, l); }
          else if (op.op === 'set') { const i = findLayer(L, op.layer); Object.assign(L[i], op.props || {}); }
          else if (op.op === 'remove') { L.splice(findLayer(L, op.layer), 1); }
          else if (op.op === 'move') { const i = findLayer(L, op.layer); const [l] = L.splice(i, 1); L.splice(Math.max(0, Math.min(L.length, op.index | 0)), 0, l); }
          else throw new Error(`Unknown op "${op.op}" (add, set, remove, move)`);
        }
      }
      if (m.type === 'shader' && (a.code != null || w.builtin)) { m.shader = m.shader || 'main.frag'; delete m.code; files[m.shader] = a.code != null ? a.code : readCode(id, w.manifest) || ''; }
      if (a.params) m.params = a.params;
      if (m.type === 'web' && a.html != null) files[m.page || 'index.html'] = a.html;
      const nid = await save(id, m, files);
      for (const r of host.recs.values()) if (r.wallpaperId === nid) host.load(r, nid);
      return text({ id: nid, copied: nid !== id ? `“${w.manifest.name}” is built in, so this was saved as the user’s own copy.` : undefined, layers: m.scene ? m.scene.layers.map((l) => `${l.name} (${l.kind}, ${l.id})`) : undefined, next: 'Call preview to check it.' });
    },
    preview: async (a) => {
      const id = resolveId(a.id);
      const r = await preview({ id, hour: a.hour, cursor: a.cursor, click: a.click, width: a.width, height: a.height, wait: a.wait });
      const content = [{ type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' }];
      content.push({ type: 'text', text: JSON.stringify({ id, size: r.size, frameMs: r.stats.ms, particles: r.stats.particles || 0, error: r.error || null, hour: a.hour ?? 'now', sky: r.sky || undefined }) });
      return { content, isError: !!r.error };
    },
    add_asset: async ({ id, path: p }) => {
      id = resolveId(id); if (!p || !fs.existsSync(p)) return err('File not found: ' + p);
      if (id.startsWith('builtin/')) { const w = library.read(id); id = await save(id, w.manifest); }
      return text({ id, src: library.addAsset(id, p) });
    },
    apply: async ({ id, display }) => text(apply(resolveId(id), display || null)),
    status: async () => { const s = store.get(); return text({ ...host.status(), settings: { fps: s.fps, scale: s.scale, budget: s.budget, battery: s.battery, pauseCovered: s.pauseCovered, pauseIdle: s.pauseIdle, freeAfter: s.freeAfter, cursor: s.cursor, clicks: s.clicks } }); },
    set_performance: async (a) => {
      const patch = {}; for (const k of ['fps', 'scale', 'budget', 'battery', 'pauseCovered', 'pauseIdle', 'freeAfter']) if (a[k] !== undefined) patch[k] = a[k];
      if (patch.fps) patch.fps = [15, 24, 30, 60].reduce((b, f) => (Math.abs(f - patch.fps) < Math.abs(b - patch.fps) ? f : b), 30);
      if (patch.scale) patch.scale = Math.max(0.4, Math.min(1, patch.scale));
      return text(setSettings(patch));
    }
  };

  return async function handle(name, args) {
    const fn = H[name]; if (!fn) return err('Unknown tool ' + name);
    try { return await fn(args || {}); } catch (e) { return err(e.message || String(e)); }
  };
}

module.exports = { makeHandlers };
