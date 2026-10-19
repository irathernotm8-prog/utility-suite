// Assist Chat: conversations with history, memory, files, web access and assistants.
import { MODELS, modelById, modelName, engine, ensureModel, runExclusive, complete, interrupt, approxTokens, settings, saveSetting, isCached, recommendedModel, sys, fitFor } from "./engine.js";
import { chatsDB, uid } from "./store.js";
import { renderMarkdown, plainText } from "./md.js";
import { readFile, selectRelevant } from "./docs.js";
import { research, webAvailable, findUrls, RESEARCH_RULES } from "./research.js";
import { toast, openPopover, modal, icons } from "./ui.js";

/* ---------- Assistants ---------- */
export const BUILTIN_ASSISTANTS = [
  { id: "assist", name: "Assist", icon: "A", desc: "Your everyday helper for anything", prompt: "" },
  { id: "writer", name: "Writer", icon: "✎", desc: "Drafts, rewrites and polishes your writing",
    prompt: "You are an expert editor and ghostwriter. Help the user write clearly and persuasively in their own voice. When asked to rewrite, return the improved text first, then (only if useful) one or two short notes on what changed. Prefer plain, active language. Never pad." },
  { id: "marketer", name: "Marketer", icon: "◎", desc: "Campaigns, social posts, ad copy and strategy",
    prompt: "You are a senior digital marketing strategist with deep experience in social media, paid search, email, CRM, content and brand. Give practical, specific recommendations with clear reasoning. When writing copy, offer 2–3 distinct variations with different angles, respect each platform's conventions and character limits, and include hooks and calls to action. Suggest how to measure results (KPIs) when relevant." },
  { id: "researcher", name: "Researcher", icon: "⌕", desc: "Looks things up and cites its sources", web: true,
    prompt: "You are a careful research assistant. Answer with well-organized findings, cite sources for every factual claim, note disagreements between sources and how recent the information is, and finish with a short bottom line." },
  { id: "summarizer", name: "Summarizer", icon: "≡", desc: "Key points and action items from documents",
    prompt: "You turn long material into clear summaries. Start with a 2–3 sentence overview, then key points as bullets, then action items or decisions (with owners and dates if mentioned). Quote exact figures. Keep it skimmable." },
  { id: "coder", name: "Coder", icon: "</>", desc: "Writes, explains and fixes code",
    prompt: "You are a senior software engineer. Give correct, idiomatic, complete code in fenced code blocks with the language named. Explain briefly what the code does and any assumptions. When fixing bugs, explain the cause first." },
];
export const allAssistants = () => [...BUILTIN_ASSISTANTS, ...settings.assistants];
export const assistantById = (id) => allAssistants().find((a) => a.id === id) || BUILTIN_ASSISTANTS[0];

/* ---------- State ---------- */
const $ = (id) => document.getElementById(id);
const els = {};
const state = { chats: [], current: null, generating: null, search: "", attachments: [], speaking: null };
const visionModel = MODELS.find((m) => m.vision).id;
const currentModel = () => (state.current && state.current.model) || settings.model;

/* ---------- Chats ---------- */
function newChatObject(extra = {}) {
  const a = assistantById(settings.defaultAssistant);
  return {
    id: uid(), title: "New chat", created: Date.now(), updated: Date.now(), pinned: false,
    assistantId: a.id, model: null, web: !!a.web, think: false,
    summary: "", summaryUpTo: 0, notes: "", messages: [], ...extra,
  };
}
const saveTimers = new Map();
function persist(chat, now = false) {
  if (!chat || !chat.messages.length && !chat.notes) return;
  clearTimeout(saveTimers.get(chat.id));
  const run = () => chatsDB.put(JSON.parse(JSON.stringify(chat))).catch((e) => console.error("save chat", e));
  if (now) run(); else saveTimers.set(chat.id, setTimeout(run, 400));
}
function touch(chat) { chat.updated = Date.now(); persist(chat); }

export async function loadChats() {
  try { state.chats = (await chatsDB.all()) || []; } catch (e) { console.error(e); state.chats = []; }
  renderList();
}

export function newChat(focus = true) {
  if (state.current && !state.current.messages.length) { if (focus) els.prompt.focus(); return; }
  state.current = newChatObject();
  state.attachments = [];
  renderAll();
  if (focus) els.prompt.focus();
}
function openChat(id) {
  const c = state.chats.find((x) => x.id === id);
  if (!c) return;
  els.chatView.classList.remove("side-open");
  if (state.current && !state.current.messages.length && state.current.id !== id) { /* drop empty draft chat */ }
  state.current = c;
  state.attachments = [];
  renderAll();
  scrollToBottom(true);
}
function ensureListed(chat) { if (!state.chats.includes(chat)) state.chats.unshift(chat); }
async function deleteChat(id) {
  const c = state.chats.find((x) => x.id === id);
  if (!c) return;
  if (state.generating && state.generating.chat === c) stop();
  state.chats = state.chats.filter((x) => x.id !== id);
  await chatsDB.remove(id).catch(() => {});
  if (state.current && state.current.id === id) { state.current = null; newChat(false); }
  else renderList();
  toast("Chat deleted", "Undo", async () => { state.chats.unshift(c); await chatsDB.put(c); renderList(); });
}
export async function clearAllChats() {
  state.chats = []; await chatsDB.clear();
  state.current = null; newChat(false);
}
export function importChat(convo) {
  // from Quick Ask: { messages:[{role,content}], title }
  const c = newChatObject({ title: (convo && convo.title) || "Quick Ask" });
  c.messages = (convo.messages || []).map((m) => ({ id: uid(), role: m.role, content: m.content, at: Date.now(), model: m.model || null, sources: m.sources || [] }));
  ensureListed(c); state.current = c; persist(c, true); renderAll(); scrollToBottom(true);
}

/* ---------- Rendering: sidebar ---------- */
function groupLabel(t) {
  const d = new Date(t), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return d.toLocaleDateString([], { month: "long", year: "numeric" });
}
function renderList() {
  const q = state.search.trim().toLowerCase();
  const list = state.chats
    .filter((c) => c.messages.length)
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => String(m.content).toLowerCase().includes(q)))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  els.chatList.replaceChildren();
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "list-empty";
    p.textContent = q ? "No chats match." : "Your chats will show up here.";
    els.chatList.append(p);
    return;
  }
  let lastGroup = null;
  for (const c of list) {
    const g = c.pinned ? "Pinned" : groupLabel(c.updated);
    if (g !== lastGroup) {
      const h = document.createElement("div");
      h.className = "list-group"; h.textContent = g;
      els.chatList.append(h); lastGroup = g;
    }
    const item = document.createElement("div");
    item.className = "chat-item" + (state.current && state.current.id === c.id ? " on" : "");
    item.tabIndex = 0;
    item.dataset.id = c.id;
    const a = assistantById(c.assistantId);
    const ic = document.createElement("span");
    ic.className = "chat-ic"; ic.textContent = a.icon;
    const t = document.createElement("span");
    t.className = "chat-title"; t.textContent = c.title;
    if (q) {
      const hit = c.messages.find((m) => String(m.content).toLowerCase().includes(q));
      if (hit && !c.title.toLowerCase().includes(q)) {
        const s = String(hit.content); const i = s.toLowerCase().indexOf(q);
        const sn = document.createElement("span"); sn.className = "chat-snip";
        sn.textContent = (i > 30 ? "…" : "") + s.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, " ");
        t.append(sn);
      }
    }
    const more = document.createElement("button");
    more.type = "button"; more.className = "chat-more"; more.innerHTML = icons.dots; more.setAttribute("aria-label", "Chat options");
    more.onclick = (e) => { e.stopPropagation(); chatMenu(c, more); };
    if (state.generating && state.generating.chat === c) item.classList.add("live");
    item.append(ic, t, more);
    item.onclick = () => openChat(c.id);
    item.onkeydown = (e) => { if (e.key === "Enter") openChat(c.id); };
    item.oncontextmenu = (e) => { e.preventDefault(); chatMenu(c, item); };
    els.chatList.append(item);
  }
}
function chatMenu(c, anchor) {
  openPopover(anchor, [
    { label: "Rename", icon: icons.edit, run: () => renameChat(c) },
    { label: c.pinned ? "Unpin" : "Pin to top", icon: icons.pin, run: () => { c.pinned = !c.pinned; persist(c, true); renderList(); } },
    { label: "Export as Markdown", icon: icons.download, run: () => exportChat(c) },
    { sep: true },
    { label: "Delete", icon: icons.trash, danger: true, run: () => deleteChat(c.id) },
  ], { align: "start" });
}
async function renameChat(c) {
  const v = await modal({ title: "Rename chat", input: c.title, ok: "Rename" });
  if (v == null) return;
  c.title = v.trim() || c.title; c.titled = true;
  persist(c, true); renderList(); renderHead();
}

/* ---------- Rendering: conversation ---------- */
function renderAll() { renderHead(); renderMessages(); renderList(); renderComposer(); renderMemoryPanel(); }

function renderHead() {
  const c = state.current;
  els.convTitle.textContent = c && c.messages.length ? c.title : "New chat";
  const a = assistantById(c ? c.assistantId : settings.defaultAssistant);
  els.assistantBtn.querySelector(".pill-ic").textContent = a.icon;
  els.assistantBtn.querySelector(".pill-label").textContent = a.name;
  const m = modelById(currentModel());
  els.modelBtn.querySelector(".pill-label").textContent = m.name;
  els.modelBtn.title = `${m.name} — ${m.family}`;
  els.memoryBtn.classList.toggle("has", !!(c && (c.summary || c.notes)));
}

function renderMessages() {
  const c = state.current;
  els.messages.replaceChildren();
  if (!c || !c.messages.length) { els.messages.append(welcome()); return; }
  const inner = document.createElement("div");
  inner.className = "thread";
  c.messages.forEach((m, i) => inner.append(messageEl(m, i)));
  els.messages.append(inner);
}

function welcome() {
  const w = document.createElement("div");
  w.className = "welcome";
  const a = assistantById(state.current ? state.current.assistantId : settings.defaultAssistant);
  const name = settings.signName.trim().split(/\s+/)[0];
  w.innerHTML = `<img class="welcome-mark" src="icons/mark.svg" alt=""><h1></h1><p class="welcome-sub"></p><div class="starters"></div><div class="welcome-banner" hidden></div>`;
  w.querySelector("h1").textContent = a.id === "assist" ? (name ? `How can I help, ${name}?` : "How can I help?") : `${a.name}`;
  w.querySelector(".welcome-sub").textContent = a.id === "assist" ? "Private, on-device AI. Turn on Web when you need the internet." : a.desc;
  const starters = STARTERS[a.id] || STARTERS.assist;
  const box = w.querySelector(".starters");
  for (const s of starters) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "starter";
    b.innerHTML = `<span class="starter-t"></span><span class="starter-d"></span>`;
    b.querySelector(".starter-t").textContent = s.t;
    b.querySelector(".starter-d").textContent = s.d;
    b.onclick = () => {
      if (s.attach) { els.fileInput.click(); els.prompt.value = s.p; autosize(); return; }
      if (s.web && state.current && !state.current.web) { state.current.web = true; renderComposer(); }
      els.prompt.value = s.p; autosize(); els.prompt.focus();
      const sel = s.p.indexOf("[");
      if (sel >= 0) els.prompt.setSelectionRange(sel, s.p.indexOf("]", sel) + 1);
    };
    box.append(b);
  }
  upgradeBanner(w.querySelector(".welcome-banner"));
  return w;
}
const STARTERS = {
  assist: [
    { t: "Draft a message", d: "Email, text or post — with context", p: "Write a [message] to [who] about [what]. Context: " },
    { t: "Summarize a document", d: "PDF, Word or text file", p: "Summarize this document: key points, decisions and action items.", attach: true },
    { t: "Look something up", d: "Uses the web, with sources", p: "What's the latest on [topic]?", web: true },
    { t: "Brainstorm ideas", d: "Campaigns, names, plans", p: "Give me 10 creative ideas for [goal]. For each, one line on why it could work." },
  ],
  writer: [
    { t: "Polish my draft", d: "Clearer, tighter, same voice", p: "Improve this draft, keep my voice:\n\n" },
    { t: "Make it shorter", d: "Cut to the essentials", p: "Cut this to half the length without losing the key points:\n\n" },
    { t: "Change the tone", d: "Friendlier, firmer, more formal", p: "Rewrite this to sound more [friendly / confident / formal]:\n\n" },
    { t: "Write from bullet points", d: "Turn notes into prose", p: "Turn these notes into a well-written [email / post / paragraph]:\n\n" },
  ],
  marketer: [
    { t: "Social post variations", d: "3 angles, platform-ready", p: "Write 3 [LinkedIn / Instagram / X] post variations announcing [news]. Audience: [who]. Include a hook and CTA." },
    { t: "Campaign concept", d: "Big idea, channels, KPIs", p: "Create a campaign concept for [product/offer] targeting [audience] in [market]. Include the big idea, channel plan, timeline and KPIs." },
    { t: "Ad copy", d: "Headlines and descriptions", p: "Write Google Ads copy for [service]: 10 headlines (≤30 chars) and 4 descriptions (≤90 chars). Focus on [benefit]." },
    { t: "Competitor check", d: "Uses the web", p: "Research how [competitor] markets [product] right now and suggest how we can stand out.", web: true },
  ],
  researcher: [
    { t: "Latest news", d: "What's happening now", p: "What are the most important recent developments on [topic]?", web: true },
    { t: "Compare options", d: "Pros, cons, prices", p: "Compare [option A] vs [option B] for [use]. Include current prices.", web: true },
    { t: "Read a page", d: "Paste any link", p: "Summarize the key points of this page: [link]", web: true },
    { t: "Fact check", d: "Is it true?", p: "Is this true? [claim]", web: true },
  ],
  summarizer: [
    { t: "Summarize a file", d: "PDF, Word or text", p: "Summarize this document.", attach: true },
    { t: "Meeting notes → actions", d: "Paste notes or a transcript", p: "Turn these meeting notes into a summary with decisions and action items (owner, due date):\n\n" },
    { t: "TL;DR", d: "Three bullet points", p: "Give me a 3-bullet TL;DR of this:\n\n" },
    { t: "Explain simply", d: "No jargon", p: "Explain this in plain language for a non-expert:\n\n" },
  ],
  coder: [
    { t: "Write a script", d: "Any language", p: "Write a [language] script that [does what]." },
    { t: "Explain this code", d: "Line by line", p: "Explain what this code does:\n\n```\n\n```" },
    { t: "Fix a bug", d: "Paste code + error", p: "This code throws [error]. Find the cause and fix it:\n\n```\n\n```" },
    { t: "Regex / formula", d: "Spreadsheet or regex", p: "Write a [Excel / Google Sheets / regex] formula that [does what]." },
  ],
};

async function upgradeBanner(el) {
  const rec = recommendedModel();
  const cur = settings.model;
  if (!el || !cur || cur === rec) return;
  const curM = modelById(cur), recM = modelById(rec);
  if (curM.size >= recM.size) return;
  if (await isCached(rec)) return;
  el.hidden = false;
  el.innerHTML = `<div><b></b><span></span></div><button type="button" class="btn tiny accent">Switch</button>`;
  el.querySelector("b").textContent = `${recM.name} is recommended for your computer`;
  el.querySelector("span").textContent = `${recM.family} · ${recM.size} GB one-time download · ${recM.blurb}`;
  el.querySelector("button").onclick = () => { setModel(rec); el.hidden = true; ensureModel(rec).catch((e) => toast(e.message)); };
}

function messageEl(m, i) {
  const el = document.createElement("article");
  el.className = `msg ${m.role}`;
  el.dataset.id = m.id;
  if (m.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (m.attachments && m.attachments.length) bubble.append(attachmentChips(m.attachments));
    const t = document.createElement("div");
    t.className = "user-text"; t.textContent = m.content;
    bubble.append(t);
    el.append(bubble, msgActions(m, i));
    return el;
  }
  // assistant
  const a = assistantById(state.current.assistantId);
  const av = document.createElement("div");
  av.className = "avatar"; av.textContent = a.icon;
  const body = document.createElement("div");
  body.className = "msg-body";
  if (m.steps && m.steps.length) body.append(stepsEl(m));
  if (m.thinking) body.append(thinkingEl(m.thinking, false));
  const content = document.createElement("div");
  content.className = "md";
  if (m.error) { content.classList.add("error"); content.textContent = m.error; }
  else content.innerHTML = renderMarkdown(m.content, { sources: m.sources || [] });
  body.append(content);
  if (m.sources && m.sources.length) body.append(sourcesEl(m.sources));
  body.append(msgActions(m, i));
  el.append(av, body);
  return el;
}
function attachmentChips(list) {
  const box = document.createElement("div");
  box.className = "att-chips";
  for (const f of list) {
    const c = document.createElement("span");
    c.className = "att-chip" + (f.kind === "image" ? " img" : "");
    if (f.kind === "image" && f.dataUrl) { const im = document.createElement("img"); im.src = f.dataUrl; im.alt = ""; c.append(im); }
    else c.innerHTML = icons.file;
    const n = document.createElement("span"); n.textContent = f.name + (f.pages ? ` · ${f.pages} pages` : "");
    c.append(n);
    box.append(c);
  }
  return box;
}
function stepsEl(m) {
  const d = document.createElement("details");
  d.className = "steps";
  const s = document.createElement("summary");
  s.innerHTML = icons.globe;
  s.append(document.createTextNode(m.steps.join(" · ")));
  d.append(s);
  return d;
}
function thinkingEl(text, open) {
  const d = document.createElement("details");
  d.className = "thinking"; d.open = !!open;
  const s = document.createElement("summary"); s.textContent = open ? "Thinking…" : "Thought process";
  const p = document.createElement("div"); p.className = "thinking-body"; p.textContent = text;
  d.append(s, p);
  return d;
}
function sourcesEl(sources) {
  const box = document.createElement("div");
  box.className = "sources";
  sources.forEach((s, i) => {
    const a = document.createElement("a");
    a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.className = "source" + (s.read ? " read" : "");
    a.title = s.title + "\n" + s.url;
    let hostName = s.url; try { hostName = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
    a.innerHTML = `<span class="src-n">${i + 1}</span><span class="src-t"></span><span class="src-h"></span>`;
    a.querySelector(".src-t").textContent = s.title;
    a.querySelector(".src-h").textContent = hostName;
    box.append(a);
  });
  return box;
}
function msgActions(m, i) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const add = (icon, label, fn, cls = "") => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "act " + cls; b.innerHTML = icon; b.title = label; b.setAttribute("aria-label", label);
    b.onclick = fn; bar.append(b); return b;
  };
  add(icons.copy, "Copy", () => { copy(m.content); });
  if (m.role === "user") {
    add(icons.edit, "Edit and resend", () => editMessage(m, i));
  } else {
    const last = i === state.current.messages.length - 1;
    if (last) add(icons.redo, "Regenerate", () => regenerate());
    add(icons.speak, "Read aloud", (e) => speak(m, e.currentTarget), "speak");
    add(icons.bookmark, "Save to memory", () => saveToMemory(m));
    if (m.model || m.stats) {
      const meta = document.createElement("span");
      meta.className = "msg-meta";
      meta.textContent = [m.model ? modelName(m.model) : "", m.stats && m.stats.tps ? `${Math.round(m.stats.tps)} tok/s` : ""].filter(Boolean).join(" · ");
      bar.append(meta);
    }
  }
  return bar;
}
function copy(text) {
  const t = String(text || "");
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Copied"), () => { window.assistDesktop?.clipboard?.write(t); toast("Copied"); });
}

/* ---------- Composer ---------- */
function renderComposer() {
  const c = state.current;
  const m = modelById(currentModel());
  els.webToggle.hidden = !webAvailable();
  els.webToggle.classList.toggle("on", !!(c && c.web));
  els.webToggle.setAttribute("aria-pressed", !!(c && c.web));
  els.thinkToggle.hidden = !m.think;
  els.thinkToggle.classList.toggle("on", !!(c && c.think));
  els.thinkToggle.setAttribute("aria-pressed", !!(c && c.think));
  const busy = !!state.generating;
  els.sendBtn.classList.toggle("stop", busy);
  els.sendBtn.innerHTML = busy ? icons.stop : icons.send;
  els.sendBtn.title = busy ? "Stop" : "Send";
  els.composerHint.textContent = `${m.name} · on-device${c && c.web ? " · Web on" : ""}`;
  renderTray();
}
function renderTray() {
  els.attachTray.replaceChildren();
  els.attachTray.hidden = !state.attachments.length;
  state.attachments.forEach((f, idx) => {
    const c = document.createElement("span");
    c.className = "att-chip" + (f.kind === "image" ? " img" : "") + (f.loading ? " loading" : "") + (f.error ? " bad" : "");
    if (f.kind === "image" && f.dataUrl) { const im = document.createElement("img"); im.src = f.dataUrl; im.alt = ""; c.append(im); }
    else c.innerHTML = f.loading ? '<span class="spin"></span>' : icons.file;
    const n = document.createElement("span");
    n.textContent = f.name + (f.error ? ` — ${f.error}` : f.pages ? ` · ${f.pages} pages` : f.chars ? ` · ${Math.round(f.chars / 1000)}k chars` : "");
    const x = document.createElement("button");
    x.type = "button"; x.className = "att-x"; x.innerHTML = icons.x; x.setAttribute("aria-label", "Remove");
    x.onclick = () => { state.attachments.splice(idx, 1); renderTray(); };
    c.append(n, x);
    els.attachTray.append(c);
  });
}
function autosize() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = Math.min(els.prompt.scrollHeight, Math.round(window.innerHeight * 0.4)) + "px";
}
async function addFiles(files) {
  for (const file of files) {
    const entry = { name: file.name || "Pasted image", kind: /^image\//.test(file.type) ? "image" : "text", loading: true };
    state.attachments.push(entry);
    renderTray();
    const r = await readFile(file);
    Object.assign(entry, r, { loading: false });
    if (r.error) toast(`${entry.name}: ${r.error}`);
    if (entry.kind === "image" && !modelById(currentModel()).vision) {
      toast("Images need the Vision model", "Switch", () => setModel(visionModel));
    }
    renderTray();
  }
  els.prompt.focus();
}

/* ---------- Memory ---------- */
const REMEMBER_RE = /^\s*(?:hey\s+assist,?\s*)?(?:please\s+)?(?:remember|note|keep in mind|don['’]t forget|never forget)(?:\s+that)?\s*[:,-]?\s+(.{4,400})$/i;
function addMemory(text, silent = false) {
  const t = text.trim().replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()).replace(/[.!]*$/, ".");
  if (settings.memories.some((m) => m.text.toLowerCase() === t.toLowerCase())) return null;
  const mem = { id: uid(), text: t, at: Date.now() };
  saveSetting("memories", [...settings.memories, mem]);
  if (!silent) toast("Saved to memory", "Undo", () => saveSetting("memories", settings.memories.filter((m) => m.id !== mem.id)));
  document.dispatchEvent(new CustomEvent("memories-changed"));
  return mem;
}
async function saveToMemory(m) {
  const sel = String(window.getSelection() || "").trim();
  const guess = sel || plainText(m.content).split(/(?<=[.!?])\s/)[0].slice(0, 240);
  const v = await modal({ title: "Save to memory", text: "Assist will keep this in mind in every chat. You can edit or remove memories in Settings.", input: guess, multiline: true, ok: "Save" });
  if (v && v.trim()) { addMemory(v); if (!settings.memoryOn) toast("Saved — memory is off in Settings, so it isn't used yet"); }
}

function renderMemoryPanel() {
  const c = state.current;
  els.memSummary.textContent = c && c.summary ? c.summary : "Nothing yet. When this chat gets longer than the model can see at once, Assist writes a running summary here so it never loses the thread.";
  els.memSummary.classList.toggle("muted-text", !(c && c.summary));
  els.memNotes.value = c ? c.notes || "" : "";
  els.memGlobalCount.textContent = settings.memoryOn ? `${settings.memories.length} saved ${settings.memories.length === 1 ? "memory" : "memories"} in use` : "Memory is off";
}

/* ---------- Building the prompt ---------- */
function systemPrompt(chat, { web }) {
  const a = assistantById(chat.assistantId);
  const m = modelById(currentModel());
  const today = new Date().toLocaleString([], { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const parts = [];
  parts.push(`You are ${a.id === "assist" ? "Assist" : a.name}, a helpful AI assistant in the Assist app. You run privately on the user's own computer (${m.family}).`);
  parts.push(`Current date and time: ${today}.`);
  if (a.prompt) parts.push(a.prompt);
  parts.push("Be genuinely helpful, accurate and concise. Use Markdown (headings, bullet lists, tables, fenced code blocks) when it makes the answer easier to read; keep simple answers short. Don't make up facts, quotes, numbers or links — if you're not sure, say so.");
  if (web) parts.push(RESEARCH_RULES);
  else if (webAvailable()) parts.push("You can't browse the web in this message. If the user needs current or online information, tell them to turn on Web (the globe button below the message box).");
  const me = [];
  if (settings.signName.trim()) me.push(`The user's name is ${settings.signName.trim()}.`);
  if (settings.persona.trim()) me.push(settings.persona.trim());
  if (settings.memoryOn && settings.memories.length) me.push("Things the user asked you to remember:\n" + settings.memories.map((x) => "- " + x.text).join("\n"));
  if (me.length) parts.push("About the user:\n" + me.join("\n"));
  if (chat.summary) parts.push("Summary of the earlier part of this conversation (older messages are no longer shown to you):\n" + chat.summary);
  if (chat.notes && chat.notes.trim()) parts.push("Notes the user pinned for this chat — always take them into account:\n" + chat.notes.trim());
  return parts.join("\n\n");
}

function userContentForModel(msg, { isLatest, question, budgetChars }) {
  let text = msg.content;
  const files = (msg.attachments || []).filter((f) => f.kind === "text" && f.text);
  if (files.length) {
    if (isLatest) {
      const per = Math.floor(budgetChars / files.length);
      const docs = files.map((f) => {
        const { text: t, partial } = selectRelevant(f.text, question, per);
        return `<document name="${f.name}"${partial ? ' note="long document — the most relevant excerpts are shown"' : ""}>\n${t}\n</document>`;
      });
      text = docs.join("\n\n") + "\n\n" + text;
    } else {
      text = files.map((f) => `[Attached earlier: ${f.name}] ${f.text.slice(0, 300).replace(/\s+/g, " ")}…`).join("\n") + "\n\n" + text;
    }
  }
  const imgs = (msg.attachments || []).filter((f) => f.kind === "image" && f.dataUrl);
  if (imgs.length && isLatest && modelById(currentModel()).vision) {
    return [{ type: "text", text }, ...imgs.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }))];
  }
  if (imgs.length) text = imgs.map((f) => `[Image attached: ${f.name}]`).join(" ") + "\n" + text;
  return text;
}

// Decide which messages fit, and whether older ones need folding into the chat summary
function planContext(chat, upto, { reserve, extraChars }) {
  const ctx = engine.ctx || 4096;
  const sysTokens = approxTokens(systemPrompt(chat, { web: true }));
  const budget = ctx - reserve - sysTokens - approxTokens("x".repeat(extraChars)) - 64;
  const msgs = chat.messages.slice(0, upto + 1);
  let used = 0, start = msgs.length;
  for (let i = msgs.length - 1; i >= Math.max(chat.summaryUpTo, 0); i--) {
    const m = msgs[i];
    const t = approxTokens(m.content) + (i === msgs.length - 1 ? 0 : (m.attachments || []).length * 90) + 8;
    if (used + t > budget && i < msgs.length - 1) break;
    used += t; start = i;
  }
  // keep pairs tidy: don't start on an assistant message
  while (start < msgs.length - 1 && msgs[start].role === "assistant") start++;
  return { start, needsSummary: start > chat.summaryUpTo };
}

async function updateSummary(chat, upTo, model) {
  // Fold messages [summaryUpTo, upTo) into the running summary, a slice at a time
  const ctx = engine.ctx || 4096;
  const sliceBudget = Math.floor(ctx * 0.55) * 3.6;
  let i = chat.summaryUpTo;
  while (i < upTo) {
    let text = "", j = i;
    while (j < upTo && text.length < sliceBudget) {
      const m = chat.messages[j];
      const files = (m.attachments || []).map((f) => `[file: ${f.name}]`).join(" ");
      text += `${m.role === "user" ? "User" : "Assistant"}: ${files} ${String(m.content).slice(0, 4000)}\n\n`;
      j++;
    }
    const r = await complete({
      model, think: false, temperature: 0.2, maxTokens: 450,
      messages: [
        { role: "system", content: "You maintain a running memory of a conversation so it can continue without the full transcript. Write in compact bullet points. Keep: the user's goals, facts and figures they shared, names, decisions, preferences, drafts or outputs they liked, and open questions. Drop small talk. Max 250 words." },
        { role: "user", content: `${chat.summary ? "Current memory:\n" + chat.summary + "\n\n" : ""}New part of the conversation:\n${text}\nWrite the updated memory.` },
      ],
    });
    if (r.text) chat.summary = r.text.trim();
    chat.summaryUpTo = j;
    i = j;
  }
  persist(chat, true);
  if (state.current === chat) { renderMemoryPanel(); renderHead(); }
}

async function makeTitle(chat, model) {
  if (chat.titled) return;
  const first = chat.messages.find((m) => m.role === "user");
  const fallback = (first ? first.content : "New chat").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ").slice(0, 48) || "New chat";
  chat.title = fallback;
  try {
    const r = await complete({
      model, think: false, temperature: 0.3, maxTokens: 20,
      messages: [{ role: "user", content: `Write a short title (2 to 6 words) for a chat that starts with this message. Reply with the title only, no quotes.\n\n${String(first.content).slice(0, 800)}` }],
    });
    const t = r.text.split("\n")[0].replace(/^["'“#*\s]+|["'”*.\s]+$/g, "").replace(/^title:\s*/i, "").slice(0, 60);
    if (t && t.length > 1) chat.title = t;
  } catch {}
  chat.titled = true;
  persist(chat, true);
  renderList(); if (state.current === chat) renderHead();
}

/* ---------- Sending ---------- */
async function send() {
  if (state.generating) { stop(); return; }
  const text = els.prompt.value.trim();
  const files = state.attachments.filter((f) => !f.loading && !f.error);
  if (state.attachments.some((f) => f.loading)) { toast("Still reading your file…"); return; }
  if (!text && !files.length) { els.prompt.focus(); return; }
  const chat = state.current || (state.current = newChatObject());

  // slash commands
  const cmd = text.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (cmd && !files.length) {
    const [, name, arg] = cmd;
    if (name === "remember" && arg.trim()) { addMemory(arg); els.prompt.value = ""; autosize(); return; }
    if (name === "new") { els.prompt.value = ""; autosize(); newChat(); return; }
    if (name === "web") { chat.web = !chat.web; els.prompt.value = arg; autosize(); renderComposer(); if (!arg.trim()) return; }
  }

  if (files.some((f) => f.kind === "image") && !modelById(currentModel()).vision) {
    toast("Images need the Vision model", "Switch", () => setModel(visionModel));
    return;
  }
  const rem = text.match(REMEMBER_RE);
  if (rem) addMemory(rem[1]);

  const msg = { id: uid(), role: "user", content: text || (files.length === 1 ? `(Attached ${files[0].name})` : `(Attached ${files.length} files)`), at: Date.now(), attachments: files.map(stripAttachment) };
  chat.messages.push(msg);
  els.prompt.value = ""; autosize();
  state.attachments = [];
  ensureListed(chat);
  touch(chat);
  renderAll();
  scrollToBottom(true);
  await respond(chat);
}
function stripAttachment(f) {
  const o = { name: f.name, kind: f.kind, chars: f.chars || 0 };
  if (f.pages) o.pages = f.pages;
  if (f.text) o.text = f.text.slice(0, 400000);
  if (f.dataUrl) o.dataUrl = f.dataUrl;
  return o;
}

export function stop() {
  if (!state.generating) return;
  state.generating.stopped = true;
  if (state.generating.running) interrupt();
}

async function respond(chat) {
  const model = currentModel();
  const userIdx = chat.messages.length - 1;
  const user = chat.messages[userIdx];
  const reply = { id: uid(), role: "assistant", content: "", at: Date.now(), model, sources: [], steps: [] };
  chat.messages.push(reply);
  const gen = { chat, reply, stopped: false, running: false };
  state.generating = gen;
  renderComposer(); renderList();
  const view = () => state.current === chat;
  if (view()) { renderMessages(); scrollToBottom(true); }
  const live = () => view() && els.messages.querySelector(`.msg[data-id="${reply.id}"]`);

  const setStatus = (s) => {
    const el = live(); if (!el) return;
    let st = el.querySelector(".status-line");
    if (!st) { st = document.createElement("div"); st.className = "status-line"; el.querySelector(".msg-body").prepend(st); }
    st.innerHTML = `<span class="spin"></span>`;
    st.append(document.createTextNode(s.text));
  };
  if (queuePending()) setStatus({ text: "Waiting for Assist to finish another request…" });

  try {
    await runExclusive("chat", async () => {
      if (gen.stopped) throw Object.assign(new Error("stopped"), { quiet: true });
      if (!(await isCached(model))) setStatus({ text: `Downloading ${modelName(model)} — first time only…` });
      else if (engine.loadedModel !== model) setStatus({ text: `Loading ${modelName(model)}…` });
      await ensureModel(model);
      gen.running = true;

      // Web research
      let webBlock = "";
      if (chat.web && webAvailable()) {
        const recent = chat.messages.slice(Math.max(0, userIdx - 4), userIdx).map((m) => ({ role: m.role, content: m.content }));
        const r = await research({
          question: user.content, recent, readPages: settings.readPages, engine: settings.searchEngine,
          charBudget: Math.floor((engine.ctx || 4096) * 3.6 * 0.38),
          onStatus: setStatus,
          ask: async (p) => (await complete({ model, messages: [{ role: "user", content: p }], think: false, temperature: 0, maxTokens: 32, shouldStop: () => gen.stopped })).text,
        });
        if (gen.stopped) throw Object.assign(new Error("stopped"), { quiet: true });
        if (r) {
          reply.steps = r.steps; reply.sources = r.sources;
          webBlock = r.block;
          if (r.failed) webBlock = "<web_results>The web search didn't return anything usable. Tell the user, then answer as best you can from what you know (and say it may be out of date).</web_results>";
        }
      } else if (findUrls(user.content).length && webAvailable()) {
        reply.steps = ["Web is off, so links weren't opened"];
      }

      // Context: what fits, and fold older turns into the chat memory if needed
      const think = !!(chat.think && modelById(model).think);
      const reserve = think ? 2048 : 1100;
      const attChars = (user.attachments || []).reduce((n, f) => n + Math.min(f.chars || 0, 40000), 0);
      const docBudget = Math.floor((engine.ctx || 4096) * 3.6 * (webBlock ? 0.25 : 0.5));
      const extraChars = webBlock.length + Math.min(attChars, docBudget);
      const plan = planContext(chat, userIdx, { reserve, extraChars });
      if (plan.needsSummary) {
        setStatus({ text: "Updating this chat's memory…" });
        await updateSummary(chat, plan.start, model);
      }
      const messages = [{ role: "system", content: systemPrompt(chat, { web: !!webBlock }) }];
      for (let i = plan.start; i < userIdx; i++) {
        const m = chat.messages[i];
        if (m.error || !m.content) continue;
        messages.push({ role: m.role, content: m.role === "user" ? userContentForModel(m, { isLatest: false }) : m.content });
      }
      let latest = userContentForModel(user, { isLatest: true, question: user.content, budgetChars: docBudget });
      if (webBlock) {
        if (Array.isArray(latest)) latest[0].text = `${webBlock}\n\n${latest[0].text}`;
        else latest = `${webBlock}\n\nMy message: ${latest}`;
      }
      messages.push({ role: "user", content: latest });
      // Keep the conversation alternating user/assistant
      for (let i = messages.length - 1; i > 1; i--) if (messages[i].role === messages[i - 1].role && messages[i].role !== "system") messages.splice(i - 1, 1);

      // Generate
      let lastPaint = 0;
      const paint = (answer, thinking) => {
        reply.content = answer; reply.thinking = thinking;
        const now = performance.now();
        if (now - lastPaint < 40) return;
        lastPaint = now;
        paintLive(reply, thinking && !answer);
      };
      const res = await complete({
        model, messages, think, maxTokens: think ? 3072 : 2048, temperature: 0.7,
        onDelta: paint, shouldStop: () => gen.stopped,
      });
      reply.content = res.text; reply.thinking = res.thinking || "";
      if (res.usage && res.usage.extra) reply.stats = { tps: res.usage.extra.decode_tokens_per_s, tokens: res.usage.completion_tokens };
      if (res.stopped || gen.stopped) reply.stopped = true;
      if (!reply.content && !reply.stopped) reply.error = "Assist didn't produce an answer. Try again or rephrase.";

      // Title for new chats
      if (!chat.titled && chat.messages.filter((m) => m.role === "user").length === 1 && !gen.stopped) await makeTitle(chat, model);
    });
  } catch (err) {
    if (!err.quiet) {
      console.error(err);
      reply.error = err.message || "Something went wrong.";
    }
    if (!reply.content && err.quiet) chat.messages.splice(chat.messages.indexOf(reply), 1);
  } finally {
    state.generating = null;
    touch(chat);
    persist(chat, true);
    if (view()) { renderMessages(); renderHead(); scrollToBottom(); }
    renderComposer(); renderList();
  }
}
function queuePending() { return engine.busy; }

// Update just the live message while streaming (fast path)
function paintLive(reply, thinkingOnly) {
  const el = els.messages.querySelector(`.msg[data-id="${reply.id}"]`);
  if (!el) return;
  const body = el.querySelector(".msg-body");
  const st = body.querySelector(".status-line");
  if (st && (reply.content || reply.thinking)) st.remove();
  if (reply.steps && reply.steps.length && !body.querySelector(".steps")) body.prepend(stepsEl(reply));
  if (reply.thinking) {
    let t = body.querySelector(".thinking");
    if (!t) { t = thinkingEl(reply.thinking, true); body.querySelector(".md").before(t); }
    t.querySelector(".thinking-body").textContent = reply.thinking;
    if (!thinkingOnly && t.open && t.dataset.auto !== "0") { t.open = false; t.querySelector("summary").textContent = "Thought process"; }
  }
  const md = body.querySelector(".md");
  md.innerHTML = renderMarkdown(reply.content, { sources: reply.sources || [] });
  md.classList.add("streaming");
  scrollToBottom();
}

async function regenerate() {
  const chat = state.current;
  if (!chat || state.generating) return;
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === "assistant") chat.messages.pop();
  if (!chat.messages.length || chat.messages[chat.messages.length - 1].role !== "user") return;
  renderMessages();
  await respond(chat);
}

function editMessage(m, i) {
  if (state.generating) return;
  const el = els.messages.querySelector(`.msg[data-id="${m.id}"]`);
  if (!el) return;
  const box = document.createElement("div");
  box.className = "edit-box";
  const ta = document.createElement("textarea");
  ta.value = m.content; ta.rows = Math.min(10, Math.max(2, m.content.split("\n").length));
  const row = document.createElement("div"); row.className = "edit-row";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn tiny"; cancel.textContent = "Cancel";
  const save = document.createElement("button"); save.type = "button"; save.className = "btn tiny primary"; save.textContent = "Send";
  row.append(cancel, save); box.append(ta, row);
  el.replaceChildren(box);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  cancel.onclick = () => renderMessages();
  const go = async () => {
    const v = ta.value.trim(); if (!v) return;
    const chat = state.current;
    chat.messages = chat.messages.slice(0, i + 1);
    chat.messages[i] = { ...m, content: v, at: Date.now() };
    if (chat.summaryUpTo > i) { chat.summaryUpTo = 0; chat.summary = ""; }
    renderMessages();
    await respond(chat);
  };
  save.onclick = go;
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } if (e.key === "Escape") renderMessages(); };
}

function speak(m, btn) {
  const synth = window.speechSynthesis;
  if (!synth) return toast("Read aloud isn't available on this computer");
  if (state.speaking === m.id) { synth.cancel(); state.speaking = null; btn.classList.remove("on"); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(plainText(m.content).slice(0, 8000));
  u.rate = 1.03;
  u.onend = u.onerror = () => { state.speaking = null; btn.classList.remove("on"); };
  state.speaking = m.id; btn.classList.add("on");
  synth.speak(u);
}

/* ---------- Export ---------- */
function chatToMarkdown(c) {
  const a = assistantById(c.assistantId);
  const lines = [`# ${c.title}`, "", `_${new Date(c.created).toLocaleString()} · ${a.name}_`, ""];
  for (const m of c.messages) {
    lines.push(m.role === "user" ? "## You" : `## ${a.name}`, "");
    if (m.attachments && m.attachments.length) lines.push(m.attachments.map((f) => `📎 ${f.name}`).join("  "), "");
    lines.push(m.error ? `> ${m.error}` : m.content, "");
    if (m.sources && m.sources.length) { lines.push("Sources:"); m.sources.forEach((s, i) => lines.push(`${i + 1}. [${s.title}](${s.url})`)); lines.push(""); }
  }
  return lines.join("\n");
}
async function exportChat(c) {
  const md = chatToMarkdown(c);
  const name = c.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) + ".md";
  if (window.assistDesktop?.saveFile) {
    const r = await window.assistDesktop.saveFile(name, md);
    if (r && r.ok) toast("Chat exported");
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

/* ---------- Pickers ---------- */
export function setModel(id) {
  saveSetting("model", id);
  if (state.current) { state.current.model = null; }
  renderHead(); renderComposer();
  document.dispatchEvent(new CustomEvent("model-changed"));
}
async function modelMenu() {
  const items = [];
  for (const m of MODELS) {
    const fit = fitFor(m);
    const cached = await isCached(m.id);
    items.push({
      label: m.name, sub: `${m.family} · ${m.size} GB${cached ? " · downloaded" : ""}${fit === "too-big" ? " · may not fit" : ""}`,
      badge: m.id === recommendedModel() ? "Best for you" : m.vision ? "Images" : m.think ? "Think" : "",
      checked: m.id === currentModel(), dim: fit === "too-big",
      run: () => { setModel(m.id); if (!engine.busy) ensureModel(m.id).catch((e) => toast(e.message)); },
    });
  }
  items.push({ sep: true }, { label: "Model settings…", icon: icons.settings, run: () => document.dispatchEvent(new CustomEvent("open-settings", { detail: "models" })) });
  openPopover(els.modelBtn, items, { align: "end", wide: true });
}
function assistantMenu() {
  const c = state.current;
  const items = allAssistants().map((a) => ({
    label: a.name, sub: a.desc, iconText: a.icon, checked: c ? c.assistantId === a.id : settings.defaultAssistant === a.id,
    run: () => {
      const chat = state.current || (state.current = newChatObject());
      chat.assistantId = a.id;
      if (a.web && !chat.messages.length) chat.web = true;
      saveSetting("defaultAssistant", a.id);
      if (chat.messages.length) touch(chat);
      renderAll();
    },
  }));
  items.push({ sep: true }, { label: "Create an assistant…", icon: icons.plus, run: () => document.dispatchEvent(new CustomEvent("open-settings", { detail: "assistants" })) });
  openPopover(els.assistantBtn, items, { align: "start", wide: true });
}

/* ---------- Scrolling ---------- */
let stick = true;
function scrollToBottom(force = false) {
  if (force) stick = true;
  if (!stick) return;
  requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
}

/* ---------- Init ---------- */
export function initChat() {
  for (const id of ["chatList", "chatSearch", "newChatBtn", "messages", "prompt", "sendBtn", "attachBtn", "fileInput", "webToggle", "thinkToggle",
    "attachTray", "composerHint", "convTitle", "assistantBtn", "modelBtn", "memoryBtn", "chatMoreBtn", "memoryPanel", "memSummary", "memNotes",
    "memGlobalCount", "memClose", "memReset", "memManage", "sidebarToggle", "chatView", "convDrop"]) els[id] = $(id);

  els.newChatBtn.onclick = () => { els.chatView.classList.remove("side-open"); newChat(); };
  els.messages.addEventListener("mousedown", () => els.chatView.classList.remove("side-open"));
  els.chatSearch.oninput = () => { state.search = els.chatSearch.value; renderList(); };
  els.prompt.addEventListener("input", autosize);
  els.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!state.generating) send(); }
  });
  els.prompt.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  els.sendBtn.onclick = () => send();
  els.attachBtn.onclick = () => els.fileInput.click();
  els.fileInput.onchange = () => { addFiles([...els.fileInput.files]); els.fileInput.value = ""; };
  els.webToggle.onclick = () => {
    const c = state.current || (state.current = newChatObject());
    c.web = !c.web; if (c.messages.length) touch(c); renderComposer();
    toast(c.web ? "Web on — Assist will search and read pages for this chat" : "Web off — fully offline");
  };
  els.thinkToggle.onclick = () => {
    const c = state.current || (state.current = newChatObject());
    c.think = !c.think; if (c.messages.length) touch(c); renderComposer();
    toast(c.think ? "Think deeper on — slower, but better at hard questions" : "Think deeper off");
  };
  els.modelBtn.onclick = () => modelMenu();
  els.assistantBtn.onclick = () => assistantMenu();
  els.memoryBtn.onclick = () => { els.memoryPanel.hidden = !els.memoryPanel.hidden; renderMemoryPanel(); };
  els.memClose.onclick = () => { els.memoryPanel.hidden = true; };
  els.memNotes.oninput = () => { const c = state.current || (state.current = newChatObject()); c.notes = els.memNotes.value; if (c.messages.length) touch(c); renderHead(); };
  els.memReset.onclick = () => { const c = state.current; if (!c) return; c.summary = ""; c.summaryUpTo = 0; touch(c); renderMemoryPanel(); renderHead(); toast("Chat memory cleared"); };
  els.memManage.onclick = () => document.dispatchEvent(new CustomEvent("open-settings", { detail: "memory" }));
  els.chatMoreBtn.onclick = () => {
    const c = state.current;
    if (!c || !c.messages.length) return toast("Nothing to export yet");
    openPopover(els.chatMoreBtn, [
      { label: "Rename", icon: icons.edit, run: () => renameChat(c) },
      { label: c.pinned ? "Unpin" : "Pin to top", icon: icons.pin, run: () => { c.pinned = !c.pinned; persist(c, true); renderList(); } },
      { label: "Copy whole chat", icon: icons.copy, run: () => copy(chatToMarkdown(c)) },
      { label: "Export as Markdown", icon: icons.download, run: () => exportChat(c) },
      { sep: true },
      { label: "Delete chat", icon: icons.trash, danger: true, run: () => deleteChat(c.id) },
    ], { align: "end" });
  };
  els.convTitle.ondblclick = () => state.current && state.current.messages.length && renameChat(state.current);
  els.sidebarToggle.onclick = () => toggleSidebar();
  els.messages.addEventListener("scroll", () => {
    const gap = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    stick = gap < 80;
  });
  els.messages.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b) { const code = b.closest(".code").querySelector("code").textContent; copy(code); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1400); }
  });
  // drag & drop files anywhere on the conversation
  const conv = els.chatView;
  let depth = 0;
  conv.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { depth++; els.convDrop.hidden = false; } });
  conv.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; els.convDrop.hidden = true; } });
  conv.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  conv.addEventListener("drop", (e) => { e.preventDefault(); depth = 0; els.convDrop.hidden = true; if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

  document.addEventListener("memories-changed", renderMemoryPanel);
  document.addEventListener("settings-changed", () => { renderHead(); renderComposer(); if (state.current && !state.current.messages.length) renderMessages(); });
  applySidebar();
  newChat(false);
  loadChats();
}
const narrow = () => window.innerWidth <= 820;
export function toggleSidebar() {
  if (narrow()) { els.chatView.classList.toggle("side-open"); return; }
  saveSetting("sidebar", !settings.sidebar); applySidebar();
}
function applySidebar() { els.chatView.classList.toggle("no-sidebar", !settings.sidebar); }
export function focusPrompt() { els.prompt && els.prompt.focus(); }
export const chatState = state;
