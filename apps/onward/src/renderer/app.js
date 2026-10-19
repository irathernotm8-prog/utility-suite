/* Onward — renderer core: state, navigation, AI status & activity, helpers */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const App = window.App = {
    $, $$, esc, state: null, views: {}, view: 'jobs',
    fresh: new Set(),     // job ids Claude just touched (highlighted briefly)
    driving: false
  };

  App.load = async () => { App.state = await onward.getState(); return App.state; };

  App.show = (view) => {
    if (view !== 'jobs' && App.views.jobs?.openId?.()) App.views.jobs.close();
    App.view = view;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    App.views[view]?.show?.();
    onward.saveUi({ view });
  };

  App.render = () => {
    const s = App.state;
    const active = s.jobs.filter(j => !['rejected', 'withdrawn'].includes(j.status)).length;
    $('#navJobs').textContent = active || '';
    for (const v of Object.values(App.views)) v.render?.();
    renderClaude();
  };

  // ---------- helpers ----------
  App.host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  App.favicon = (u, size = 64) => { const h = App.host(u); return h ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=${size}` : ''; };
  App.logo = (job, cls = '') => {
    const letter0 = esc((job.company || '?').trim()[0] || '?');
    if (job.logo) return `<div class="logo ${cls}">${letter0}<img src="${esc(job.logo)}" alt="" data-letter="${letter0}" class="full" data-over="1"></div>`;
    const site = job.companyInfo?.website || (job.url && !/linkedin|indeed|glassdoor|greenhouse|lever|workday|ashby|wellfound|ziprecruiter|smartrecruiters/.test(job.url) ? job.url : '');
    const letter = esc((job.company || '?').trim()[0] || '?');
    return `<div class="logo ${cls}">${site ? `<img src="${esc(App.favicon(/^https?:/.test(site) ? site : 'https://' + site))}" alt="" data-letter="${letter}">` : letter}</div>`;
  };
  App.pay = (p) => {
    if (!p) return '';
    if (p.text) return p.text;
    if (!p.min && !p.max) return '';
    const per = { year: '/yr', yr: '/yr', annual: '/yr', hour: '/hr', hr: '/hr', month: '/mo' }[String(p.period || '').toLowerCase()] || (p.period ? '/' + p.period : '');
    const f = (n) => n >= 1000 ? '$' + Math.round(n / 1000) + 'K' : '$' + n;
    return (p.min && p.max ? `${f(p.min)}–${f(p.max)}` : f(p.min || p.max)) + per;
  };
  App.ago = (iso) => {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso)) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 86400 * 7) return Math.floor(d / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  App.date = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  App.toast = (text, ms = 3200) => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = icon('spark') + `<span>${esc(text)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  };

  App.modal = (html, onMount) => {
    const host = $('#modal');
    host.innerHTML = `<div class="modal">${html}</div>`;
    host.classList.add('open');
    const close = () => { host.classList.remove('open'); host.innerHTML = ''; };
    host.onclick = (e) => { if (e.target === host) close(); };
    onMount?.(host.firstElementChild, close);
    return close;
  };

  App.icons = (root = document) => $$('[data-icon]', root).forEach(i => { i.outerHTML = icon(i.dataset.icon); });

  // ---------- AI status + live activity ----------
  App.clientName = (c = App.state.claude || {}) => /codex|openai|chatgpt/i.test(c.client || '') ? 'Codex' : /code/i.test(c.client || '') ? 'Claude Code' : 'Claude';
  function renderClaude() {
    const c = App.state.claude || {};
    const busy = App.driving;
    const name = App.clientName(c);
    const anyConfigured = c.configured || c.codexConfigured;
    $('#claudeCard').innerHTML = `
      <div class="row"><span class="dot ${busy ? 'busy' : c.connected ? 'on' : ''}"></span>${busy ? `${name} is working` : c.connected ? `${name} connected` : 'No assistant connected'}</div>
      <p>${c.connected ? `Ask in ${name} — Onward follows along here.` : anyConfigured ? `Open ${c.configured ? 'Claude' : 'Codex'} and start a chat — Onward connects automatically.` : 'Connect Claude or ChatGPT (Codex) to let it search, tailor and fill applications.'}</p>
      ${!anyConfigured ? '<button class="btn sm primary" id="goConnect">Set up</button>' : ''}`;
    $('#goConnect')?.addEventListener('click', () => App.show('settings'));
  }
  App.renderClaude = renderClaude;

  let busyCount = 0, idleTimer = null;
  const feed = [];
  onward.claude.onActivity((a) => {
    const i = feed.findIndex(x => x.id === a.id);
    if (i >= 0) feed[i] = a; else feed.unshift(a);
    feed.length = Math.min(feed.length, 6);
    if (a.state === 'start') busyCount++; else busyCount = Math.max(0, busyCount - 1);
    setDriving(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!busyCount) setDriving(false); }, 4000);
    App.state.claude = { ...App.state.claude, connected: true };
    $('#activity').innerHTML = feed.map(x => `<div class="item ${x.state}">${icon(x.state === 'start' ? 'spark' : x.state === 'error' ? 'x' : 'check')}<span>${esc(x.label)}</span></div>`).join('');
  });
  function setDriving(on) {
    if (App.driving === on) return;
    App.driving = on;
    renderClaude();
    App.views.browser?.driving?.(on);
  }
  onward.claude.onStatus((s) => { App.state.claude = { ...App.state.claude, ...s }; renderClaude(); App.views.settings?.render?.(); });

  // Claude saved/changed a job → refresh and highlight it
  onward.claude.onJob(async ({ id, created }) => {
    App.fresh.add(id);
    setTimeout(() => { App.fresh.delete(id); App.views.jobs?.render?.(); }, 6000);
    await App.load();
    App.render();
    if (created) App.toast(`${App.clientName()} added a job to your board`);
  });

  // Data changed in the main process (debounced)
  let reloadT = null;
  onward.onChanged(() => { clearTimeout(reloadT); reloadT = setTimeout(async () => { await App.load(); App.render(); }, 150); });
  onward.onView((v) => App.show(v));
  onward.onToast((t) => App.toast(t.text));
  onward.claude.onMessage(({ jobId }) => { App.toast('A message draft is ready for you to review'); App.show('jobs'); setTimeout(() => App.views.jobs?.openDrawer?.(jobId), 300); });
  onward.claude.onDiscover((p) => App.views.discover?.mirror?.(p));

  // Things the main process needs the window for (e.g. Indeed runs in a hidden tab here)
  const rpcHandlers = {};
  App.rpc = (method, fn) => { rpcHandlers[method] = fn; };
  onward.onRpc((method, args) => {
    const fn = rpcHandlers[method];
    if (!fn) throw new Error('Unknown request ' + method);
    return fn(args);
  });

  // ---------- boot ----------
  window.addEventListener('DOMContentLoaded', async () => {
    const isMac = navigator.platform.startsWith('Mac');
    document.body.classList.add(isMac ? 'mac' : 'win');
    App.mod = isMac ? '⌘' : 'Ctrl+';
    if (!isMac) {
      // Show Ctrl instead of ⌘ in labels and tooltips
      // Only write when there's a ⌘ to replace — otherwise the observer would retrigger itself forever
      const swap = (root) => { for (const el of root.querySelectorAll('.kbd, [title]')) { if (el.classList.contains('kbd') && el.textContent.includes('⌘')) el.textContent = el.textContent.replace(/⌘/g, 'Ctrl+'); if (el.title && el.title.includes('⌘')) el.title = el.title.replace(/⌘/g, 'Ctrl+'); } };
      swap(document);
      new MutationObserver(() => swap(document.body)).observe(document.body, { childList: true, subtree: true });
    }
    App.icons();
    // Logos that fail to load fall back to the company's first letter; tab icons just hide
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (t.tagName !== 'IMG') return;
      if (t.dataset.over) t.remove(); else if (t.dataset.letter) t.replaceWith(document.createTextNode(t.dataset.letter)); else t.style.visibility = 'hidden';
    }, true);
    $$('#nav button').forEach(b => b.addEventListener('click', () => App.show(b.dataset.view)));
    await App.load();
    for (const v of Object.values(App.views)) v.init?.();
    App.render();
    App.show(App.state.ui.view || 'jobs');
    onward.ready();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { App.views.jobs?.close?.(); $('#modal').classList.remove('open'); }
      if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) App.show(['jobs', 'discover', 'browser', 'profile', 'settings'][Number(e.key) - 1]);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); App.AI?.toggle(); }
    });
  });
})();
