// npm run test:privacy — opens every screen of a brand-new Slate profile and fails if anything
// tries to reach the internet. A stock install should make zero outside requests.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-privacy-'));
const log = path.join(dir, 'net.json');
const electron = require('electron'); // path to the binary
const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])];
const cmd = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', ['-a', electron, ...args]] : [electron, args];
const r = spawnSync(cmd[0], cmd[1], {
  cwd: path.join(__dirname, '..'), stdio: 'ignore', timeout: 120000,
  env: { ...process.env, SLATE_USER_DATA: path.join(dir, 'data'), SLATE_SHOTS: path.join(dir, 'shots'), SLATE_NET_LOG: log,
    SLATE_STEPS: 'overview,accounts,cards,cards:catalog,cards:detail,calendar,planner,credit,statements,report,browser' }
});
if (!fs.existsSync(log)) { console.error('The app didn’t finish the run', r.error || r.status); process.exit(1); }
const seen = JSON.parse(fs.readFileSync(log, 'utf8'));
if (seen.length) { console.error('Requests left the computer:\n' + seen.map(s => `  [${s.session}] ${s.url}`).join('\n')); process.exit(1); }
console.log('Privacy check passed: a fresh install made no outside requests on any screen');
fs.rmSync(dir, { recursive: true, force: true });
