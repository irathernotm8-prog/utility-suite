// The floating bar: timer, latest line, pause / mark / open / stop.
const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const PAUSE = '<path d="M9 6v12M15 6v12"/>', PLAY = '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>';
let paused = false;
window.bar.onState((s) => {
  $('time').textContent = fmt(s.elapsed);
  $('line').textContent = s.stopping ? 'Finishing the transcript…' : s.paused ? 'Paused' : (s.line || 'Listening…');
  if (paused !== !!s.paused) { paused = !!s.paused; $('pause').querySelector('svg').innerHTML = paused ? PLAY : PAUSE; $('pause').title = paused ? 'Resume' : 'Pause'; }
  $('pill').classList.toggle('paused', paused);
});
$('pause').onclick = () => window.bar.cmd(paused ? 'resume' : 'pause');
$('mark').onclick = () => window.bar.cmd('mark');
$('open').onclick = () => window.bar.cmd('open');
$('stop').onclick = () => window.bar.cmd('stop');
