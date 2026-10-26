// Cadence — recorder. Runs inside a page you're clicking through (the Record window of a Browser step, or another
// app's window for a Use an app step): turns clicks, typing, choices and Enter into actions whose targets should
// still work next week (text= for buttons and links, label= for fields). Passwords are never recorded: they become
// {{secrets.…}} placeholders. install() is self-contained so it can also be injected as a string over the debugger.
'use strict';

function install(send, note) {
  if (window.__cadenceRecording) return; window.__cadenceRecording = true;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const clickable = 'a,button,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input[type=submit],input[type=button],summary,label';
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const textUnique = (t) => { const want = norm(t).toLowerCase(); let n = 0; for (const e of document.querySelectorAll(clickable)) if (norm(e.innerText || e.value).toLowerCase() === want) n++; return n === 1; };
  const labelFor = (el) => { if (el.labels && el.labels[0]) return norm(el.labels[0].innerText); const by = el.getAttribute('aria-labelledby'); if (by) { const l = document.getElementById(by); if (l) return norm(l.innerText); } return norm(el.getAttribute('aria-label') || ''); };
  const cssPath = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 6; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}|[:]/.test(e.id)) { parts.unshift(`#${cssEsc(e.id)}`); break; }
      const cls = [...e.classList].filter((c) => !/\d{2,}|^(is-|has-|active|hover|focus|selected|open|on$)/.test(c) && c.length < 30).slice(0, 2);
      if (cls.length) p += '.' + cls.map(cssEsc).join('.');
      const sib = e.parentElement ? [...e.parentElement.children].filter((s) => s.tagName === e.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
      parts.unshift(p);
      if (unique(parts.join(' > '))) break;
    }
    return parts.join(' > ');
  };
  const target = (el) => {
    const t = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
    if (t && unique(`[data-testid="${t}"],[data-test="${t}"],[data-qa="${t}"]`)) return `[data-testid="${t}"],[data-test="${t}"],[data-qa="${t}"]`;
    if (el.id && !/\d{3,}|:/.test(el.id) && unique('#' + cssEsc(el.id))) return '#' + cssEsc(el.id);
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const l = labelFor(el); if (l && l.length < 50) return 'label=' + l;
      if (el.placeholder) return 'placeholder=' + el.placeholder;
      if (el.name && unique(`${el.tagName.toLowerCase()}[name="${el.name}"]`)) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    }
    const txt = norm(el.innerText || el.value || el.getAttribute('aria-label') || '');
    if (txt && txt.length <= 40 && textUnique(txt)) return 'text=' + txt;
    if (el.getAttribute('aria-label') && unique(`[aria-label="${el.getAttribute('aria-label')}"]`)) return `[aria-label="${el.getAttribute('aria-label')}"]`;
    if (el.dataset && Object.keys(el.dataset).length) { const [k, v] = Object.entries(el.dataset)[0]; const sel = `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"]`; if (unique(sel)) return sel; }
    return cssPath(el);
  };
  const isField = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) && !/^(submit|button|checkbox|radio|file|image|reset)$/i.test(el.type || '');
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#__cadence_rec')) return;
    const el = e.target.closest ? e.target.closest(clickable) || e.target : e.target;
    if (isField(el)) return; // focusing a field isn't a step; typing is
    send({ do: 'click', target: target(el) });
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.tagName === 'SELECT') return send({ do: 'select', target: target(el), value: el.options[el.selectedIndex] ? norm(el.options[el.selectedIndex].text) : el.value });
    if (!isField(el)) return;
    const pw = el.type === 'password';
    const host = location.hostname.replace(/^www\./, ''); const base = !host || /^[\d.]+$|^localhost$/.test(host) ? 'SITE' : (host.split('.').slice(-2, -1)[0] || host.split('.')[0] || 'SITE');
    const secretName = pw ? (/^[a-z]/i.test(base) ? base : 'SITE_' + base).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_PASSWORD' : null;
    send({ do: 'type', target: target(el), value: pw ? `{{secrets.${secretName}}}` : el.value, secret: secretName });
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isField(e.target) && e.target.tagName !== 'TEXTAREA') { e.target.dispatchEvent(new Event('change', { bubbles: true })); setTimeout(() => send({ do: 'press', key: 'Enter' }), 0); } }, true);
  const banner = () => {
    if (document.getElementById('__cadence_rec')) return;
    const b = document.createElement('div');
    b.id = '__cadence_rec';
    b.setAttribute('style', 'position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(20,16,32,.92);color:#fff;font:600 12px -apple-system,Segoe UI,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none');
    b.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#ff4d6d;box-shadow:0 0 0 3px rgba(255,77,109,.3)"></span>Cadence is recording — ' + (note || 'press Stop in Cadence when you’re done');
    document.documentElement.appendChild(b);
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', banner); else banner();
}

module.exports = { install };
