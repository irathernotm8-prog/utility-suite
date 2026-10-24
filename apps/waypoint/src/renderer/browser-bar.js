// Waypoint — the booking browser's toolbar.
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let saving = false;
wpb.on((s) => {
  document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('mac', s.platform === 'darwin'); document.documentElement.classList.toggle('win', s.platform === 'win32');
  let host = ''; try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch {}
  const secure = /^https:/.test(s.url || '');
  $('#addr').innerHTML = `${s.loading ? '<span class="spin"></span>' : icon(secure ? 'lock' : 'globe', 14)}<span class="ellip"><b>${esc(host)}</b>${s.title ? ' — ' + esc(s.title) : ''}</span>`;
  $('#back').disabled = !s.back; $('#fwd').disabled = !s.forward;
  $('#trip').textContent = s.trip ? `Saving to ${s.trip}` : '';
  $('#sites').innerHTML = (s.sites || []).map(x => `<button data-site="${x.id}" class="${x.id === s.site ? 'on' : ''}">${esc(x.name)}</button>`).join('');
  document.querySelectorAll('[data-site]').forEach(b => b.onclick = () => wpb.cmd('site', b.dataset.site));
  $('#save').classList.toggle('found', !!s.confirmed && !saving);
  if (!saving) $('#saveTxt').textContent = s.confirmed ? 'Confirmation found — save to trip' : 'Save to trip';
  hydrateIcons(document);
});
$('#back').onclick = () => wpb.cmd('back'); $('#fwd').onclick = () => wpb.cmd('forward'); $('#rel').onclick = () => wpb.cmd('reload'); $('#ext').onclick = () => wpb.cmd('external');
$('#save').onclick = async () => {
  if (saving) return; saving = true; $('#saveTxt').textContent = 'Saving…'; $('#save').disabled = true;
  try { await wpb.cmd('save'); $('#saveTxt').textContent = 'Saved — finish it in Waypoint'; }
  catch (e) { $('#saveTxt').textContent = 'Couldn’t save — try again'; }
  setTimeout(() => { saving = false; $('#save').disabled = false; $('#saveTxt').textContent = 'Save to trip'; }, 2500);
};
hydrateIcons(document);
wpb.cmd('ready');
