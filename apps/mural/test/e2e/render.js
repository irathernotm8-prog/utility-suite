// Renders every built-in wallpaper in a real wallpaper window and saves a screenshot of each (test/e2e/out/wp-*.png).
const fs = require('fs'); const path = require('path');
module.exports = async ({ app, host, library, API }) => {
  const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  host.on('state', () => {});
  await wait(1500);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const w of library.list().filter((w) => w.builtin && (!only || only.some((o) => w.id.includes(o))))) {
    API.apply(w.id);
    await wait(2600);
    const r = [...host.recs.values()][0];
    if (r.error) errors.push(`${w.id}: ${r.error}`);
    // a click and a cursor move, then shoot
    r.win.webContents.send('wp:pointer', { x: 0.35, y: 0.4, inside: true });
    r.win.webContents.send('wp:click', { x: 0.5, y: 0.5, button: 0 });
    await wait(500);
    const img = await r.win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `wp-${w.id.split('/')[1]}.png`), img.toPNG());
    console.log('RENDERED', w.id, JSON.stringify(r.stats), r.error || '');
  }
  console.log('ERRORS', JSON.stringify(errors));
  app.exit(errors.length ? 1 : 0);
};
