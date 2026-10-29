// Runs Helm on the pretend computer with test/e2e/hook.js driving it. On Linux it needs a display (xvfb-run).
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const electron = require('electron');
const root = path.join(__dirname, '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-e2e-'));
const env = { ...process.env, HELM_DEMO: '1', HELM_E2E: path.join(__dirname, 'hook.js'), HELM_USER_DATA: data, SUITELINK_DIR: path.join(data, 'link'), ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
const args = [root, '--no-sandbox'];
const cmd = process.platform === 'linux' && !process.env.DISPLAY ? 'xvfb-run' : electron;
const r = spawnSync(cmd, cmd === 'xvfb-run' ? ['-a', '-s', '-screen 0 1920x1080x24', electron, ...args] : args, { env, stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
