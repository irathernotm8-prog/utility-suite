// Atrium — publishing: Netlify (personal access token, zip deploy) and GitHub Pages (the GitHub CLI's sign-in,
// pushed to a gh-pages branch). Both upload the same files as the static export.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeZip } = require('./core/zip');
const EX = require('./core/exporters');
const ai = require('./ai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function netlify(site, token, onStep = () => {}) {
  if (!token) throw new Error('Add a Netlify personal access token in Settings › Publishing first (Netlify › User settings › Applications › New access token).');
  const H = { Authorization: `Bearer ${token}` };
  const api = async (method, url, body, type) => {
    const r = await fetch('https://api.netlify.com/api/v1' + url, { method, headers: { ...H, ...(type ? { 'Content-Type': type } : {}) }, body });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { message: t }; }
    if (!r.ok) throw new Error(`Netlify: ${j.message || j.error || r.status}`); return j;
  };
  const pub = site.data.settings.publish || {}; let siteId = pub.netlify && pub.netlify.siteId;
  if (siteId) { try { await api('GET', `/sites/${siteId}`); } catch { siteId = null; } }
  if (!siteId) { onStep('Creating the Netlify site…'); const s = await api('POST', '/sites', JSON.stringify({}), 'application/json'); siteId = s.id; }
  onStep('Uploading…');
  const files = EX.staticFiles(site, { readme: false });
  const dep = await api('POST', `/sites/${siteId}/deploys`, makeZip(files), 'application/zip');
  let d = dep; for (let i = 0; i < 90 && !['ready', 'error'].includes(d.state); i++) { await sleep(1500); onStep(`Netlify is ${d.state || 'processing'}…`); d = await api('GET', `/deploys/${dep.id}`); }
  if (d.state === 'error') throw new Error('Netlify: ' + (d.error_message || 'the deploy failed'));
  const s = await api('GET', `/sites/${siteId}`);
  const url = s.ssl_url || s.url;
  site.setSettings({ publish: { ...pub, netlify: { siteId, url, admin: s.admin_url, at: Date.now() } } }, 'you');
  return { url, admin: s.admin_url, files: files.length };
}

async function github(site, { repo } = {}, onStep = () => {}) {
  const gh = ai.cli('gh'); const git = ai.which('git');
  if (!gh) throw new Error('GitHub Pages uses the GitHub CLI. Install it (brew install gh) and sign in with: gh auth login');
  if (!git) throw new Error('Git isn’t installed on this computer.');
  const run = (bin, args, o = {}) => ai.run(bin, args, { timeout: 300, ...o });
  let login; try { login = JSON.parse((await run(gh.path, ['api', 'user'])).out).login; } catch { throw new Error('The GitHub CLI isn’t signed in. Run: gh auth login'); }
  const pub = site.data.settings.publish || {};
  repo = String(repo || (pub.github && pub.github.repo) || site.data.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'site';
  onStep(`Checking ${login}/${repo}…`);
  try { await run(gh.path, ['repo', 'view', `${login}/${repo}`, '--json', 'name']); }
  catch { onStep('Creating the repository…'); await run(gh.path, ['repo', 'create', `${login}/${repo}`, '--public', '--description', `${site.data.name} — built with Atrium`]); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-gh-'));
  try {
    EX.writeFiles(tmp, [...EX.staticFiles(site, { readme: false }), { name: '.nojekyll', data: '' }]);
    const cred = ['-c', 'credential.helper=', '-c', `credential.helper=!"${gh.path}" auth git-credential`, '-c', 'user.name=Atrium', '-c', 'user.email=atrium@users.noreply.github.com'];
    onStep('Pushing to gh-pages…');
    await run(git, ['init', '-q', '-b', 'gh-pages'], { cwd: tmp });
    await run(git, [...cred, 'add', '-A'], { cwd: tmp });
    await run(git, [...cred, 'commit', '-q', '-m', `Publish ${site.data.name} from Atrium`], { cwd: tmp });
    await run(git, [...cred, 'push', '-f', `https://github.com/${login}/${repo}.git`, 'gh-pages'], { cwd: tmp });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  onStep('Turning on Pages…');
  try { await run(gh.path, ['api', '-X', 'POST', `repos/${login}/${repo}/pages`, '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/']); } catch (e) { if (!/409|already/i.test(e.message)) { try { await run(gh.path, ['api', '-X', 'PUT', `repos/${login}/${repo}/pages`, '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/']); } catch {} } }
  const url = `https://${login}.github.io/${repo}/`;
  site.setSettings({ publish: { ...pub, github: { repo, url, at: Date.now() } } }, 'you');
  return { url, repo: `${login}/${repo}`, note: 'GitHub can take a minute or two to show the first version.' };
}

module.exports = { netlify, github };
