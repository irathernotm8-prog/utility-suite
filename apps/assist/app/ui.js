// Shared interface pieces: icons, toasts, popover menus and simple dialogs.
const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
export const icons = {
  send: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  dots: svg('<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  redo: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  speak: svg('<path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  bookmark: svg('<path d="M7 4h10v16l-5-3.5L7 20V4z"/>'),
  pin: svg('<path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  file: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  settings: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

/* Toast */
let toastTimer;
export function toast(msg, actionLabel, action) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  if (actionLabel) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-action"; b.textContent = actionLabel;
    b.onclick = () => { el.classList.remove("show"); action(); };
    el.append(b);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), actionLabel ? 5500 : 2600);
}

/* Popover menu */
let pop = null;
export function closePopover() { if (pop) { pop.remove(); pop = null; document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", onKey, true); } }
function outside(e) { if (pop && !pop.contains(e.target)) closePopover(); }
function onKey(e) {
  if (!pop) return;
  const items = [...pop.querySelectorAll(".pop-item:not(:disabled)")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); closePopover(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
}
export function openPopover(anchor, items, { align = "start", wide = false } = {}) {
  const wasOpenFor = pop && pop.__anchor === anchor;
  closePopover();
  if (wasOpenFor) return;
  pop = document.createElement("div");
  pop.className = "popover" + (wide ? " wide" : "");
  pop.__anchor = anchor;
  pop.setAttribute("role", "menu");
  for (const it of items) {
    if (it.sep) { const s = document.createElement("div"); s.className = "pop-sep"; pop.append(s); continue; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "pop-item" + (it.danger ? " danger" : "") + (it.checked ? " checked" : "") + (it.dim ? " dim" : "");
    b.setAttribute("role", "menuitem");
    const ic = document.createElement("span"); ic.className = "pop-ic";
    if (it.iconText) { ic.textContent = it.iconText; ic.classList.add("txt"); } else if (it.icon) ic.innerHTML = it.icon;
    const tx = document.createElement("span"); tx.className = "pop-text";
    const l = document.createElement("span"); l.className = "pop-label"; l.textContent = it.label; tx.append(l);
    if (it.sub) { const s = document.createElement("span"); s.className = "pop-sub"; s.textContent = it.sub; tx.append(s); }
    b.append(ic, tx);
    if (it.badge) { const g = document.createElement("span"); g.className = "pop-badge"; g.textContent = it.badge; b.append(g); }
    if (it.checked) { const c = document.createElement("span"); c.className = "pop-check"; c.innerHTML = icons.check; b.append(c); }
    b.onclick = () => { closePopover(); it.run && it.run(); };
    pop.append(b);
  }
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = align === "end" ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  pop.style.left = left + "px"; pop.style.top = top + "px";
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", onKey, true); }, 0);
  const first = pop.querySelector(".pop-item.checked") || pop.querySelector(".pop-item");
  first && first.focus({ preventScroll: true });
}

/* Dialog: resolves to the input text (or true for a confirm), or null when cancelled */
export function modal({ title, text, input, multiline = false, ok = "OK", cancel = "Cancel", danger = false, fields }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "overlay modal-wrap";
    const box = document.createElement("form");
    box.className = "sheet modal";
    const h = document.createElement("h2"); h.textContent = title; box.append(h);
    if (text) { const p = document.createElement("p"); p.className = "muted"; p.textContent = text; box.append(p); }
    let field = null;
    const extra = {};
    if (fields) {
      for (const f of fields) {
        const lab = document.createElement("label"); lab.className = "field";
        const sp = document.createElement("span"); sp.className = "label"; sp.textContent = f.label; lab.append(sp);
        const el = f.multiline ? document.createElement("textarea") : document.createElement("input");
        if (!f.multiline) el.type = "text";
        el.value = f.value || ""; if (f.placeholder) el.placeholder = f.placeholder; if (f.rows) el.rows = f.rows;
        if (f.maxLength) el.maxLength = f.maxLength;
        lab.append(el); box.append(lab); extra[f.name] = el;
        if (!field) field = el;
      }
    } else if (input != null) {
      field = multiline ? document.createElement("textarea") : document.createElement("input");
      if (!multiline) field.type = "text"; else field.rows = 4;
      field.value = input; box.append(field);
    }
    const row = document.createElement("div"); row.className = "modal-actions";
    const c = document.createElement("button"); c.type = "button"; c.className = "btn ghost"; c.textContent = cancel;
    const o = document.createElement("button"); o.type = "submit"; o.className = "btn " + (danger ? "danger-solid" : "primary"); o.textContent = ok;
    row.append(c, o); box.append(row); wrap.append(box); document.body.append(wrap);
    const done = (v) => { wrap.remove(); resolve(v); };
    c.onclick = () => done(null);
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) done(null); });
    box.onsubmit = (e) => { e.preventDefault(); done(fields ? Object.fromEntries(Object.entries(extra).map(([k, el]) => [k, el.value])) : field ? field.value : true); };
    box.onkeydown = (e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) box.requestSubmit(); };
    setTimeout(() => { if (field) { field.focus(); if (field.select && !multiline) field.select(); } else o.focus(); }, 0);
  });
}
