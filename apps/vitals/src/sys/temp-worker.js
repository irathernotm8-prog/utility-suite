// Runs the native temperature reader in its own process (Electron in Node mode), so a sensor problem can never
// take the app down. Protocol: one line in ("r") → one JSON line out.
let s = null; try { s = require('macos-temperature-sensor'); } catch (_) {}
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    buf = buf.slice(i + 1);
    const out = { ok: !!s };
    if (s) { try { out.t = s.temperature(); } catch (e) { out.err = String(e.message || e); } try { out.f = s.fans(); } catch (_) { out.f = []; } }
    process.stdout.write(JSON.stringify(out) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
