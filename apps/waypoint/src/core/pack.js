'use strict';
// Waypoint — the offline pack: one self-contained web page with the whole trip (days, bookings and
// confirmation numbers, documents, key facts, budget, places, packing list). It needs no app and no
// internet: open it on a phone, a tablet or any computer. With embed on, documents are inside the page
// (up to a size limit); otherwise the page links to them (the phone link served over Wi-Fi).
const fs = require('fs');
const path = require('path');
const TL = require('./timeline');
const PLACES = require('./places');

const EMBED_ONE = 25 * 1024 * 1024;     // a single document bigger than this stays out of the page
const EMBED_ALL = 120 * 1024 * 1024;    // and the page never carries more than this in documents
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', pkpass: 'application/vnd.apple.pkpass', mp4: 'video/mp4', mov: 'video/quicktime' };
const mimeOf = (ext) => MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';

function payload(trip, { docUrl, docPath, embed }) {
  const facts = { ...(PLACES.get(trip.country) || {}), ...((trip.research || {}).facts || {}) };
  let budgetBytes = 0;
  const docs = trip.docs.map(d => {
    const o = { id: d.id, name: d.name, kind: d.kind, ext: d.ext, tag: d.tag, size: d.size, bookingId: d.bookingId, who: d.who, notes: d.notes, mime: mimeOf(d.ext) };
    if (embed && docPath) {
      try {
        const p = docPath(d);
        const st = fs.statSync(p);
        if (st.size <= EMBED_ONE && budgetBytes + st.size <= EMBED_ALL) { o.data = `data:${o.mime};base64,${fs.readFileSync(p).toString('base64')}`; budgetBytes += st.size; }
        else o.left = true;
      } catch { o.left = true; }
    } else if (docUrl) o.url = docUrl(d);
    return o;
  });
  const b = TL.budget(trip);
  return {
    made: Date.now(), name: trip.name, destination: trip.destination, country: trip.country, flag: PLACES.flag(trip.country), tz: trip.tz,
    start: trip.start, end: trip.end, cover: trip.cover, currency: trip.currency, travelers: trip.travelers,
    days: TL.dayList(trip.start, trip.end),
    items: trip.items.map(i => ({ id: i.id, day: i.day, start: i.start, end: i.end, title: i.title, type: i.type, place: i.place, notes: i.notes, ref: i.ref, bookingId: i.bookingId })),
    bookings: trip.bookings.map(x => ({ id: x.id, type: x.type, title: x.title, ref: x.ref, provider: x.provider, from: x.from, to: x.to, startDate: x.startDate, startTime: x.startTime, endDate: x.endDate, endTime: x.endTime, address: x.address, phone: x.phone, notes: x.notes, cost: x.cost, currency: x.currency, paid: x.paid, seat: x.seat, docs: x.docs || [] })),
    docs, facts,
    places: trip.research.places, packing: trip.research.packing, notes: trip.research.notes, links: trip.research.links,
    money: { planned: b.planned, used: b.used, booked: b.booked, spent: b.spent, left: b.left, settle: b.settle },
    types: Object.fromEntries(Object.entries(TL.TYPES).map(([k, v]) => [k, v.label])),
    btypes: Object.fromEntries(Object.entries(TL.BOOKING_TYPES).map(([k, v]) => [k, v.label])),
  };
}

const COVERS = {
  sunset: ['#ff8a4c', '#ff4f7b', '#7a3cff'], ocean: ['#2fd3c0', '#3a8bff', '#3b3fb8'], forest: ['#a3e36a', '#2fb38a', '#1d5a63'],
  desert: ['#ffd27a', '#ff9a5c', '#c4573a'], dusk: ['#8f7bff', '#d06bff', '#ff7aa8'], alpine: ['#bfe8ff', '#6aa8ff', '#4a5bd0'],
  city: ['#ffc65c', '#ff6f91', '#5a4ff0'], island: ['#7af0d6', '#36c2ff', '#ff9a6b'],
};

function build(trip, opts = {}) {
  const data = payload(trip, opts);
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const c = COVERS[trip.cover] || COVERS.sunset;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${c[1]}">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>${esc(trip.name)} · Waypoint</title>
<style>
:root{--bg:#0b0d16;--panel:#141826;--panel2:#1b2033;--line:rgba(220,228,255,.08);--line2:rgba(220,228,255,.14);--fg:#eef1fb;--fg2:#aeb6cc;--mut:#7b839a;--acc:#ff8a4c;--acc2:#ffc04d;--ok:#4fd18b;--bad:#ff5c72;--c0:${c[0]};--c1:${c[1]};--c2:${c[2]};color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f4f1;--panel:#fff;--panel2:#f1eee9;--line:rgba(40,30,20,.08);--line2:rgba(40,30,20,.14);--fg:#1c1a17;--fg2:#57524a;--mut:#8a847a;--acc:#e8692c;color-scheme:light}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}
.hero{position:relative;padding:calc(env(safe-area-inset-top) + 26px) 20px 22px;background:linear-gradient(135deg,var(--c0),var(--c1) 55%,var(--c2));color:#fff;overflow:hidden}
.hero:after{content:"";position:absolute;inset:auto -20% -60% -20%;height:120%;background:radial-gradient(closest-side,rgba(255,255,255,.18),transparent);pointer-events:none}
.hero small{display:block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.hero h1{margin:6px 0 4px;font-size:28px;line-height:1.1;letter-spacing:-.02em}
.hero .sub{opacity:.92;font-size:14px}.hero .chip{display:inline-block;margin-top:12px;padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.22);font-size:13px;font-weight:600;backdrop-filter:blur(6px)}
main{max-width:720px;margin:0 auto;padding:0 0 calc(84px + env(safe-area-inset-bottom))}
.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:4px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);border-top:1px solid var(--line);z-index:5}
.tabs button{flex:1;max-width:150px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;border-radius:12px;font-size:11.5px;font-weight:600;color:var(--mut)}
.tabs button.on{color:var(--acc);background:color-mix(in srgb,var(--acc) 10%,transparent)}
.tabs svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.days{display:flex;gap:8px;overflow-x:auto;padding:14px 16px 6px;scrollbar-width:none;position:sticky;top:0;background:var(--bg);z-index:3}
.days::-webkit-scrollbar{display:none}
.day{flex:none;min-width:58px;padding:8px 10px;border-radius:14px;background:var(--panel);border:1px solid var(--line);text-align:center}
.day b{display:block;font-size:18px}.day span{font-size:11px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.day.on{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#2a1200;border-color:transparent}.day.on span{color:#2a1200b0}
.day.today:not(.on){border-color:var(--acc)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:22px 18px 10px}
.dayhead{margin:10px 18px 4px;font-size:20px;font-weight:750;letter-spacing:-.01em}
.tl{position:relative;margin:6px 16px 0;padding-left:0}
.ev{display:grid;grid-template-columns:58px 18px 1fr;gap:0 8px;padding:0}
.ev .t{text-align:right;font-size:13px;font-weight:650;color:var(--fg2);padding-top:12px;font-variant-numeric:tabular-nums}.ev .t small{display:block;color:var(--mut);font-weight:500;font-size:11.5px}
.ev .rail{position:relative}.ev .rail:before{content:"";position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--line2)}
.ev:first-child .rail:before{top:18px}.ev:last-child .rail:before{bottom:calc(100% - 18px)}
.ev .rail i{position:absolute;left:3px;top:14px;width:12px;height:12px;border-radius:50%;background:var(--k,var(--acc));box-shadow:0 0 0 4px var(--bg)}
.ev .card{margin:6px 0;padding:11px 13px;border-radius:14px;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--k,var(--acc))}
.ev.now .card{box-shadow:0 0 0 2px color-mix(in srgb,var(--acc) 55%,transparent)}
.ev.past{opacity:.55}
.card .ti{font-weight:650}.card .pl{font-size:13px;color:var(--fg2);margin-top:2px}.card .no{font-size:13px;color:var(--fg2);margin-top:6px;white-space:pre-wrap}
.ref{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 9px;border-radius:8px;background:var(--panel2);font:600 13px ui-monospace,Menlo,monospace;letter-spacing:.06em}
.ref:after{content:"copy";font:600 10px system-ui;letter-spacing:.04em;text-transform:uppercase;color:var(--mut)}
.ref.done:after{content:"copied";color:var(--ok)}
.empty{margin:30px 20px;text-align:center;color:var(--mut)}
.box{margin:0 16px 10px;padding:14px 15px;border-radius:16px;background:var(--panel);border:1px solid var(--line)}
.box .row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line);font-size:14px}.box .row:first-child{border-top:0;padding-top:0}
.box .row span:first-child{color:var(--mut)}.box .row span:last-child{text-align:right;font-weight:600}
.bk h3{margin:0;font-size:16px}.bk .meta{color:var(--fg2);font-size:13.5px;margin-top:3px}.bk .big{font:700 22px ui-monospace,Menlo,monospace;letter-spacing:.08em;margin-top:10px}
.bk .kind{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--acc)}
.doc{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line)}.doc:first-child{border-top:0;padding-top:0}
.doc .th{width:44px;height:44px;border-radius:10px;background:var(--panel2);flex:none;display:grid;place-items:center;overflow:hidden;font-size:11px;font-weight:700;color:var(--mut);text-transform:uppercase}
.doc .th img{width:100%;height:100%;object-fit:cover}.doc b{display:block;font-weight:600}.doc span{font-size:12.5px;color:var(--mut)}
.doc a,.doc button{margin-left:auto;color:var(--acc);font-weight:650;font-size:13.5px;text-decoration:none}
.pk{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}.pk:first-child{border-top:0}
.pk input{width:20px;height:20px;accent-color:var(--acc)}.pk.done span{color:var(--mut);text-decoration:line-through}
.bar{height:8px;border-radius:8px;background:var(--panel2);overflow:hidden;margin:8px 0 4px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2))}
.view{display:none}.view.on{display:block}
.viewer{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10;display:none;flex-direction:column}.viewer.on{display:flex}
.viewer header{display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top) + 10px) 16px 10px;color:#fff}
.viewer .body{flex:1;overflow:auto;display:grid;place-items:center}.viewer img{max-width:100%;max-height:100%}.viewer iframe{width:100%;height:100%;border:0;background:#fff}
.foot{margin:26px 18px;color:var(--mut);font-size:12px;text-align:center}
</style></head><body>
<div class="hero" id="hero"></div>
<main>
  <section class="view on" id="v-days"></section>
  <section class="view" id="v-bookings"></section>
  <section class="view" id="v-docs"></section>
  <section class="view" id="v-info"></section>
  <div class="foot" id="foot"></div>
</main>
<nav class="tabs">
  <button data-v="days" class="on"><svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16"/><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 13h3M8 17h6"/></svg>Days</button>
  <button data-v="bookings"><svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M14 6v12" stroke-dasharray="2 2"/></svg>Bookings</button>
  <button data-v="docs"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>Documents</button>
  <button data-v="info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></svg>Info</button>
</nav>
<div class="viewer" id="viewer"><header><b id="vname"></b><button id="vclose" style="color:#fff;font-weight:650">Done</button></header><div class="body" id="vbody"></div></div>
<script id="trip" type="application/json">${json}</script>
<script>
(function(){
var T=JSON.parse(document.getElementById('trip').textContent);
var $=function(s){return document.querySelector(s)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var K={flight:'#6aa8ff',train:'#8f7bff',transit:'#a59aa0',stay:'#a78bfa',food:'#ff7a6b',activity:'#ffc65c',sight:'#2fd3c0',rest:'#a3e36a',note:'#ff6f91'};
function d(s){var p=s.split('-');return new Date(+p[0],p[1]-1,+p[2])}
function fmtDay(s,o){return d(s).toLocaleDateString(undefined,o||{weekday:'long',month:'long',day:'numeric'})}
var H12=new Intl.DateTimeFormat(undefined,{hour:'numeric'}).resolvedOptions().hour12!==false;
function t12(t){if(!t)return'';var p=t.split(':');var h=+p[0],m=+p[1];if(!H12)return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');return(h%12||12)+(m?':'+String(m).padStart(2,'0'):'')+(h<12?'am':'pm')}
function now(){try{if(T.tz){var f=new Intl.DateTimeFormat('en-CA',{timeZone:T.tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());var o={};f.forEach(function(x){o[x.type]=x.value});return{date:o.year+'-'+o.month+'-'+o.day,min:(+o.hour%24)*60+ +o.minute}}}catch(e){}var n=new Date();var p=function(x){return String(x).padStart(2,'0')};return{date:n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate()),min:n.getHours()*60+n.getMinutes()}}
function mins(t){if(!t)return null;var p=t.split(':');return +p[0]*60+ +p[1]}
function money(v){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:T.currency||'USD',maximumFractionDigits:0}).format(v)}catch(e){return Math.round(v)+' '+(T.currency||'')}}
function size(n){return n>1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB'}
var N=now();
// hero
var chip='';
if(T.days.length){var a=T.days[0],z=T.days[T.days.length-1];
 if(N.date<a){var n=Math.round((d(a)-d(N.date))/864e5);chip=n===1?'Tomorrow':'In '+n+' days'}
 else if(N.date>z)chip='Trip complete';
 else chip='Day '+(T.days.indexOf(N.date)+1)+' of '+T.days.length}
$('#hero').innerHTML='<small>'+esc((T.flag?T.flag+'  ':'')+(T.destination||'Trip'))+'</small><h1>'+esc(T.name)+'</h1><div class="sub">'+(T.days.length?esc(fmtDay(T.days[0],{month:'short',day:'numeric'})+' – '+fmtDay(T.days[T.days.length-1],{month:'short',day:'numeric',year:'numeric'})):'')+(T.travelers&&T.travelers.length?' · '+esc(T.travelers.join(', ')):'')+'</div>'+(chip?'<span class="chip">'+esc(chip)+'</span>':'');
$('#foot').textContent='Saved from Waypoint '+new Date(T.made).toLocaleString()+' · works offline';
// days
var cur=T.days.indexOf(N.date)>=0?N.date:(T.days[0]||null);
function refBtn(r){return r?'<button class="ref" data-copy="'+esc(r)+'">'+esc(r)+'</button>':''}
function renderDays(){
 var h='<div class="days">'+T.days.map(function(x,i){return'<button class="day'+(x===cur?' on':'')+(x===N.date?' today':'')+'" data-d="'+x+'"><span>'+esc(fmtDay(x,{weekday:'short'}))+'</span><b>'+d(x).getDate()+'</b></button>'}).join('')+'</div>';
 if(!cur){$('#v-days').innerHTML='<div class="empty">No dates set for this trip yet.</div>';return}
 var it=T.items.filter(function(i){return i.day===cur}).sort(function(a,b){var x=mins(a.start),y=mins(b.start);if(x==null)return 1;if(y==null)return -1;return x-y});
 h+='<div class="dayhead">Day '+(T.days.indexOf(cur)+1)+' · '+esc(fmtDay(cur))+'</div>';
 if(!it.length)h+='<div class="empty">Nothing planned — a free day.</div>';
 h+='<div class="tl">'+it.map(function(i){var s=mins(i.start),e=mins(i.end)||((s||0)+30);var st=cur<N.date||(cur===N.date&&e<N.min)?' past':(cur===N.date&&s!=null&&s<=N.min&&e>=N.min?' now':'');
  return'<div class="ev'+st+'" style="--k:'+(K[i.type]||'#ff8a4c')+'"><div class="t">'+(i.start?esc(t12(i.start)):'—')+(i.end?'<small>'+esc(t12(i.end))+'</small>':'')+'</div><div class="rail"><i></i></div><div class="card"><div class="ti">'+esc(i.title)+'</div>'+(i.place?'<div class="pl">'+esc(i.place)+'</div>':'')+(i.notes?'<div class="no">'+esc(i.notes)+'</div>':'')+refBtn(i.ref)+'</div></div>'}).join('')+'</div>';
 $('#v-days').innerHTML=h;
 var on=document.querySelector('.day.on');if(on&&on.scrollIntoView)on.scrollIntoView({inline:'center',block:'nearest'});
}
function renderBookings(){
 var b=T.bookings.slice().sort(function(a,c){return(a.startDate||'9')>(c.startDate||'9')?1:-1});
 if(!b.length){$('#v-bookings').innerHTML='<div class="empty">No bookings saved.</div>';return}
 $('#v-bookings').innerHTML='<h2>Bookings</h2>'+b.map(function(x){var when=x.startDate?fmtDay(x.startDate,{weekday:'short',month:'short',day:'numeric'})+(x.startTime?' · '+t12(x.startTime):''):'';var until=x.endDate&&x.endDate!==x.startDate?' → '+fmtDay(x.endDate,{weekday:'short',month:'short',day:'numeric'})+(x.endTime?' · '+t12(x.endTime):''):(x.endTime?' → '+t12(x.endTime):'');
  var docs=(x.docs||[]).map(function(id){return T.docs.find(function(q){return q.id===id})}).filter(Boolean);
  return'<div class="box bk"><div class="kind">'+esc(T.btypes[x.type]||x.type)+(x.provider?' · '+esc(x.provider):'')+'</div><h3>'+esc(x.title)+'</h3><div class="meta">'+esc(when+until)+'</div>'+((x.from||x.to)&&(x.type==='flight'||x.type==='train')?'<div class="meta">'+esc([x.from,x.to].filter(Boolean).join(' → '))+'</div>':'')+(x.address?'<div class="meta">'+esc(x.address)+'</div>':'')+(x.seat?'<div class="meta">Seat / room: '+esc(x.seat)+'</div>':'')+(x.phone?'<div class="meta"><a style="color:var(--acc)" href="tel:'+esc(x.phone)+'">'+esc(x.phone)+'</a></div>':'')+(x.ref?'<div class="big">'+esc(x.ref)+'</div>'+refBtn(x.ref):'')+(x.notes?'<div class="meta" style="margin-top:8px;white-space:pre-wrap">'+esc(x.notes)+'</div>':'')+(docs.length?'<div style="margin-top:10px">'+docs.map(docRow).join('')+'</div>':'')+'</div>'}).join('');
}
var TAG={passport:'Passport',visa:'Visa / entry',ticket:'Ticket',booking:'Booking',insurance:'Insurance',license:'Licence / permit',health:'Health',map:'Map',other:'Other'};
function docRow(x){var th=x.kind==='image'&&(x.data||x.url)?'<img src="'+(x.data||x.url)+'" alt="">':esc(x.ext||'file');
 var act=x.left?'<span>On the computer</span>':'<button data-doc="'+x.id+'">Open</button>';
 return'<div class="doc"><div class="th">'+th+'</div><div style="min-width:0"><b>'+esc(x.name)+'</b><span>'+esc((TAG[x.tag]||'')+(x.who?' · '+x.who:'')+' · '+size(x.size||0))+'</span></div>'+act+'</div>'}
function renderDocs(){
 if(!T.docs.length){$('#v-docs').innerHTML='<div class="empty">No documents saved.</div>';return}
 var g={};T.docs.forEach(function(x){(g[x.tag]=g[x.tag]||[]).push(x)});
 $('#v-docs').innerHTML=Object.keys(TAG).filter(function(k){return g[k]}).map(function(k){return'<h2>'+TAG[k]+'</h2><div class="box">'+g[k].map(docRow).join('')+'</div>'}).join('');
}
function renderInfo(){
 var f=T.facts||{},h='';
 var rows=[['Emergency',f.emergency],['Currency',f.currency],['Plugs',f.plugs?'Type '+f.plugs+(f.volts?' · '+f.volts:''):''],['Driving',f.drive?'On the '+f.drive:''],['Dialling code',f.dial],['Language',f.languages],['Time zone',T.tz||f.tz]].filter(function(r){return r[1]});
 if(rows.length)h+='<h2>Key facts</h2><div class="box">'+rows.map(function(r){return'<div class="row"><span>'+esc(r[0])+'</span><span>'+esc(r[1])+'</span></div>'}).join('')+'</div>';
 if(T.money&&(T.money.planned||T.money.used)){var p=T.money.planned?Math.min(100,T.money.used/T.money.planned*100):0;h+='<h2>Budget</h2><div class="box"><div class="row"><span>Used so far</span><span>'+money(T.money.used)+(T.money.planned?' of '+money(T.money.planned):'')+'</span></div>'+(T.money.planned?'<div class="bar"><i style="width:'+p+'%"></i></div>':'')+(T.money.settle||[]).map(function(s){return'<div class="row"><span>'+esc(s.from)+' owes '+esc(s.to)+'</span><span>'+money(s.amount)+'</span></div>'}).join('')+'</div>'}
 var pl=(T.places||[]).filter(function(x){return!x.visited});
 if(pl.length)h+='<h2>Places to go</h2><div class="box">'+pl.map(function(x){return'<div class="row"><span style="color:var(--fg)">'+esc(x.name)+(x.notes?'<br><small style="color:var(--mut)">'+esc(x.notes)+'</small>':'')+'</span><span style="color:var(--mut);font-weight:500">'+esc(x.area||'')+'</span></div>'}).join('')+'</div>';
 if((T.packing||[]).length){var ls={};try{ls=JSON.parse(localStorage.getItem('wp-pack-'+T.name)||'{}')}catch(e){}
  h+='<h2>Packing</h2><div class="box">'+T.packing.map(function(x){var dn=x.id in ls?ls[x.id]:x.done;return'<label class="pk'+(dn?' done':'')+'"><input type="checkbox" data-pk="'+x.id+'"'+(dn?' checked':'')+'><span>'+esc(x.text)+'</span></label>'}).join('')+'</div>'}
 if(T.notes)h+='<h2>Notes</h2><div class="box" style="white-space:pre-wrap">'+esc(T.notes)+'</div>';
 $('#v-info').innerHTML=h||'<div class="empty">Nothing here yet.</div>';
}
renderDays();renderBookings();renderDocs();renderInfo();
document.addEventListener('click',function(e){
 var t=e.target.closest('[data-d]');if(t){cur=t.dataset.d;renderDays();return}
 t=e.target.closest('[data-v]');if(t){document.querySelectorAll('.tabs button').forEach(function(b){b.classList.toggle('on',b===t)});document.querySelectorAll('.view').forEach(function(v){v.classList.toggle('on',v.id==='v-'+t.dataset.v)});scrollTo(0,0);return}
 t=e.target.closest('[data-copy]');if(t){var v=t.dataset.copy;try{navigator.clipboard.writeText(v)}catch(x){}t.classList.add('done');setTimeout(function(){t.classList.remove('done')},1500);return}
 t=e.target.closest('[data-doc]');if(t){openDoc(T.docs.find(function(x){return x.id===t.dataset.doc}));return}
});
document.addEventListener('change',function(e){var t=e.target.closest('[data-pk]');if(!t)return;var ls={};try{ls=JSON.parse(localStorage.getItem('wp-pack-'+T.name)||'{}')}catch(x){}ls[t.dataset.pk]=t.checked;try{localStorage.setItem('wp-pack-'+T.name,JSON.stringify(ls))}catch(x){}t.parentNode.classList.toggle('done',t.checked)});
function blobUrl(u){try{var p=u.split(',');var b=atob(p[1]);var a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return URL.createObjectURL(new Blob([a],{type:p[0].slice(5).split(';')[0]}))}catch(e){return u}}
function openDoc(x){if(!x)return;var src=x.data?blobUrl(x.data):x.url;
 if(x.kind==='image'){$('#vname').textContent=x.name;$('#vbody').innerHTML='<img src="'+src+'" alt="">';$('#viewer').classList.add('on');return}
 var w=window.open(src,'_blank');if(!w){var a=document.createElement('a');a.href=src;a.download=x.name+(x.ext?'.'+x.ext:'');a.click()}}
$('#vclose').onclick=function(){$('#viewer').classList.remove('on');$('#vbody').innerHTML=''};
})();
</script></body></html>`;
}

// A clean, light, printable itinerary (for Save as PDF): every day, then bookings and key facts.
function printable(trip) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  const c = COVERS[trip.cover] || COVERS.sunset;
  const D = (s, o) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', o || { weekday: 'long', month: 'long', day: 'numeric' }); };
  const t12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const days = TL.dayList(trip.start, trip.end);
  const facts = { ...(PLACES.get(trip.country) || {}), ...((trip.research || {}).facts || {}) };
  const daysHtml = days.map((d, i) => {
    const items = TL.itemsOn(trip, d);
    return `<section class="day"><h2><span>Day ${i + 1}</span>${esc(D(d))}</h2>${items.length ? `<table>${items.map(it => `<tr><td class="t">${esc(t12(it.start))}${it.end ? `<br><small>${esc(t12(it.end))}</small>` : ''}</td><td class="k" style="--k:${KCOL[it.type] || c[0]}"></td><td><b>${esc(it.title)}</b>${it.place ? `<div class="m">${esc(it.place)}</div>` : ''}${it.notes ? `<div class="m">${esc(it.notes)}</div>` : ''}${it.ref ? `<div class="ref">${esc(it.ref)}</div>` : ''}</td></tr>`).join('')}</table>` : '<p class="m">Free day.</p>'}</section>`;
  }).join('');
  const bk = (trip.bookings || []).slice().sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9'));
  const bkHtml = bk.length ? `<section class="day"><h2>Bookings</h2><table class="bk">${bk.map(b => `<tr><td><b>${esc(b.title)}</b><div class="m">${esc([TL.BOOKING_TYPES[b.type] ? TL.BOOKING_TYPES[b.type].label : '', b.provider].filter(Boolean).join(' · '))}</div>${b.address ? `<div class="m">${esc(b.address)}</div>` : ''}</td><td class="m">${b.startDate ? esc(D(b.startDate, { month: 'short', day: 'numeric' })) + (b.startTime ? ' ' + esc(t12(b.startTime)) : '') : ''}${b.endDate && b.endDate !== b.startDate ? ' → ' + esc(D(b.endDate, { month: 'short', day: 'numeric' })) : ''}</td><td class="ref">${esc(b.ref || '')}</td></tr>`).join('')}</table></section>` : '';
  const fr = [['Emergency', facts.emergency], ['Currency', facts.currency], ['Plugs', facts.plugs ? `Type ${facts.plugs}${facts.volts ? ' · ' + facts.volts : ''}` : ''], ['Driving', facts.drive ? `On the ${facts.drive}` : ''], ['Dialling code', facts.dial], ['Language', facts.languages]].filter(r => r[1]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(trip.name)}</title><style>
  *{box-sizing:border-box}body{margin:0;font:11pt/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1c1a17}
  header{padding:26px 28px;border-radius:14px;color:#fff;background:linear-gradient(135deg,${c[0]},${c[1]} 55%,${c[2]});-webkit-print-color-adjust:exact;print-color-adjust:exact}
  header small{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:9pt;opacity:.9}header h1{margin:4px 0 2px;font-size:24pt;letter-spacing:-.01em}
  .facts{display:flex;flex-wrap:wrap;gap:6px 22px;margin:14px 2px 0;font-size:9.5pt;color:#57524a}.facts b{color:#1c1a17}
  .day{break-inside:avoid-page;margin-top:20px}h2{font-size:13pt;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #e6e1da}h2 span{color:${c[0]};margin-right:10px;-webkit-print-color-adjust:exact}
  table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:6px 6px;border-bottom:1px solid #f0ebe4}tr{break-inside:avoid}
  td.t{width:74px;text-align:right;font-weight:650;white-space:nowrap}td.t small{color:#8a847a;font-weight:500}td.k{width:6px;padding:8px 0}td.k:before{content:"";display:block;width:4px;height:100%;min-height:18px;border-radius:2px;background:var(--k);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .m{color:#6b655c;font-size:9.5pt}.ref{font:600 9.5pt ui-monospace,Menlo,Consolas,monospace;letter-spacing:.05em;color:#1c1a17}
  .bk td{padding:8px 6px}.bk td:last-child{text-align:right;white-space:nowrap}footer{margin-top:24px;color:#8a847a;font-size:8.5pt;text-align:center}
  </style></head><body><header><small>${esc((PLACES.flag(trip.country) ? PLACES.flag(trip.country) + '  ' : '') + (trip.destination || ''))}</small><h1>${esc(trip.name)}</h1><div>${days.length ? esc(D(days[0], { month: 'long', day: 'numeric' }) + ' – ' + D(days[days.length - 1], { month: 'long', day: 'numeric', year: 'numeric' })) : ''}${(trip.travelers || []).length ? ' · ' + esc(trip.travelers.join(', ')) : ''}</div></header>
  ${fr.length ? `<div class="facts">${fr.map(r => `<span>${esc(r[0])}: <b>${esc(r[1])}</b></span>`).join('')}</div>` : ''}
  ${daysHtml}${bkHtml}<footer>Made with Waypoint · ${esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</footer></body></html>`;
}
const KCOL = { flight: '#6aa8ff', train: '#8f7bff', transit: '#a59aa0', stay: '#a78bfa', food: '#ff7a6b', activity: '#ffc65c', sight: '#2fd3c0', rest: '#a3e36a', note: '#ff6f91' };

module.exports = { build, printable, payload, COVERS, mimeOf, EMBED_ONE, EMBED_ALL };
