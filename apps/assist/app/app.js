// Assist 2.0 — boot, tabs, model status, settings.
import { MODELS, modelById, modelName, engine, ensureModel, isCached, deleteAllModels, recommendedModel, fitFor, contextFor, sys, settings, saveSetting, announce } from "./engine.js";
import { store, uid } from "./store.js";
import { initChat, newChat, setModel, toggleSidebar, importChat, clearAllChats, focusPrompt, BUILTIN_ASSISTANTS, allAssistants, chatState, stop as stopChat } from "./chat.js";
import { initReply, renderHistory, replyGenerate } from "./reply.js";
import { initBridge, setPluginsEnabled } from "./bridge.js";
import { toast, modal, icons } from "./ui.js";

const $ = (id) => document.getElementById(id);
const desktop = window.assistDesktop;
const isMac = /Mac/.test(navigator.platform);

/* ---------- Status pill + loader ---------- */
function setStatus(kind, text) { $("statusPill").className = "status " + kind; $("statusText").textContent = text; }
let loaderHidden = false;
engine.hooks.status = setStatus;
engine.hooks.loadStart = ({ model, cached }) => {
  $("loaderTitle").textContent = cached ? `Starting ${model.name}` : `Downloading ${model.name}`;
  $("loaderSub").textContent = cached
    ? "Loading the model from this computer into memory."
    : `${model.family} · ${model.size} GB, one time only. After that it works offline and nothing you type leaves your computer.`;
  $("barFill").style.width = "0%";
  $("loaderDetail").textContent = "Starting…";
  loaderHidden = false;
  $("loader").hidden = !document.hasFocus() && !!desktop ? true : false;
};
engine.hooks.progress = (p) => {
  const pct = Math.max(0, Math.min(1, p.progress || 0));
  $("barFill").style.width = (pct * 100).toFixed(1) + "%";
  const txt = prettyProgress(p.text);
  $("loaderDetail").textContent = txt;
  if (loaderHidden || $("loader").hidden) setStatus("busy", /MB/.test(txt) ? txt.replace(" downloaded", "") : "Loading…");
};
engine.hooks.loadEnd = () => { $("loader").hidden = true; renderModels(); };
$("loaderHide").onclick = () => { loaderHidden = true; $("loader").hidden = true; };
function prettyProgress(text = "") {
  const m = text.match(/(\d+)MB fetched.*?(\d+)% completed/i);
  if (m) return `${m[1]} MB downloaded · ${m[2]}%`;
  if (/cache/i.test(text) && /loading/i.test(text)) return "Loading from this computer…";
  if (/shader|compil/i.test(text)) return "Preparing your graphics chip…";
  return text.replace(/\[.*?\]\s*/g, "").slice(0, 90) || "Working…";
}
document.addEventListener("engine-activity", (e) => {
  const who = e.detail.who;
  if (who) setStatus("busy", `Writing for ${who}…`);
  else if (engine.loadedModel) setStatus("ready", `${modelName(engine.loadedModel)} · on-device`);
});
$("statusPill").onclick = () => {
  if (!engine.inst || engine.loadedModel !== settings.model) ensureModel(settings.model).catch((e) => toast(e.message));
  else openSettings("models");
};

/* ---------- Tabs ---------- */
function setTab(tab) {
  saveSetting("tab", tab);
  document.body.classList.toggle("tab-chat", tab === "chat");
  document.body.classList.toggle("tab-reply", tab === "reply");
  $("chatView").hidden = tab !== "chat";
  $("replyView").hidden = tab !== "reply";
  document.querySelectorAll(".tabs button").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  if (tab === "chat") focusPrompt();
}
document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });

/* ---------- Drawers ---------- */
function openDrawer(d) { closeDrawers(); d.hidden = false; $("scrim").hidden = false; }
function closeDrawers() { $("settings").hidden = $("history").hidden = $("scrim").hidden = true; }
function openSettings(sec = "models") {
  renderModels(); renderMemories(); renderAssistants(); renderGeneral();
  showSection(sec);
  openDrawer($("settings"));
}
function showSection(sec) {
  document.querySelectorAll("#setTabs button").forEach((b) => b.classList.toggle("on", b.dataset.sec === sec));
  document.querySelectorAll(".set-sec").forEach((s) => (s.hidden = s.dataset.sec !== sec));
}
$("setTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showSection(b.dataset.sec); });
$("settingsBtn").onclick = () => openSettings();
$("historyBtn").onclick = () => { renderHistory($("historyList"), () => { closeDrawers(); }); openDrawer($("history")); };
$("scrim").onclick = closeDrawers;
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeDrawers));
document.addEventListener("open-settings", (e) => openSettings(e.detail || "models"));

/* ---------- Settings: models ---------- */
async function renderModels() {
  const list = $("modelList");
  if (!list) return;
  const rec = recommendedModel();
  $("sysCard").innerHTML = "";
  const sc = document.createElement("div");
  sc.innerHTML = `<b></b><span></span>`;
  sc.querySelector("b").textContent = `This computer: ${sys.totalMemGB} GB memory`;
  sc.querySelector("span").textContent = `Recommended: ${modelName(rec)} (${modelById(rec).family}). Chats can be about ${Math.round(contextFor(modelById(settings.model)) * 0.75 / 1000)}k words long before Assist starts summarizing.`;
  $("sysCard").append(sc);
  const rows = await Promise.all(MODELS.map(async (m) => ({ m, cached: await isCached(m.id) })));
  list.replaceChildren();
  for (const { m, cached } of rows) {
    const fit = fitFor(m);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "model" + (m.id === settings.model ? " on" : "") + (fit === "too-big" ? " dim" : "");
    b.innerHTML = `<span class="name"></span><span class="tag"></span><span class="meta"></span><span class="blurb"></span>`;
    b.querySelector(".name").textContent = m.name;
    b.querySelector(".tag").textContent = m.id === settings.model ? (engine.loadedModel === m.id ? "In use" : "Selected") : m.id === rec ? "Best for you" : cached ? "Downloaded" : m.tag;
    if (m.id === rec && m.id !== settings.model) b.querySelector(".tag").classList.add("rec");
    const flags = [m.think ? "Think" : "", m.vision ? "Images" : ""].filter(Boolean).join(" · ");
    b.querySelector(".meta").textContent = `${m.family} · ${m.size} GB${cached ? " · downloaded" : ""}${flags ? " · " + flags : ""}${fit === "too-big" ? ` · needs ${m.minRAM} GB` : fit === "tight" ? " · may be slow here" : ""}`;
    b.querySelector(".blurb").textContent = m.blurb;
    b.onclick = () => {
      if (fit === "too-big") toast(`${m.name} usually needs ${m.minRAM} GB of memory — it may not load here.`);
      setModel(m.id);
      renderModels();
      if (!engine.busy) ensureModel(m.id).catch((e) => toast(e.message));
      else toast(`${m.name} will load after the current answer`);
    };
    list.append(b);
  }
}
document.addEventListener("model-changed", () => { renderModels(); });

/* ---------- Settings: memory ---------- */
function renderMemories() {
  $("memoryOn").checked = settings.memoryOn;
  $("signName").value = settings.signName;
  $("persona").value = settings.persona;
  const list = $("memList");
  list.replaceChildren();
  if (!settings.memories.length) { const p = document.createElement("p"); p.className = "tiny-text"; p.style.margin = "0"; p.textContent = "No memories yet."; list.append(p); return; }
  for (const m of [...settings.memories].reverse()) {
    const row = document.createElement("div");
    row.className = "mem-row";
    const t = document.createElement("span"); t.className = "mem-text"; t.textContent = m.text; t.title = "Click to edit";
    t.onclick = async () => {
      const v = await modal({ title: "Edit memory", input: m.text, multiline: true, ok: "Save" });
      if (v == null) return;
      saveSetting("memories", v.trim() ? settings.memories.map((x) => (x.id === m.id ? { ...x, text: v.trim() } : x)) : settings.memories.filter((x) => x.id !== m.id));
      renderMemories(); document.dispatchEvent(new CustomEvent("memories-changed"));
    };
    const x = document.createElement("button"); x.type = "button"; x.className = "act"; x.innerHTML = icons.trash; x.title = "Forget";
    x.onclick = () => { saveSetting("memories", settings.memories.filter((y) => y.id !== m.id)); renderMemories(); document.dispatchEvent(new CustomEvent("memories-changed")); };
    row.append(t, x); list.append(row);
  }
}
$("memoryOn").onchange = () => { saveSetting("memoryOn", $("memoryOn").checked); document.dispatchEvent(new CustomEvent("memories-changed")); };
$("memAdd").onsubmit = (e) => {
  e.preventDefault();
  const v = $("memInput").value.trim(); if (!v) return;
  saveSetting("memories", [...settings.memories, { id: uid(), text: v, at: Date.now() }]);
  $("memInput").value = ""; renderMemories(); document.dispatchEvent(new CustomEvent("memories-changed"));
};
$("signName").oninput = () => { saveSetting("signName", $("signName").value); document.dispatchEvent(new CustomEvent("settings-changed")); };
$("persona").oninput = () => saveSetting("persona", $("persona").value);

/* ---------- Settings: assistants ---------- */
function renderAssistants() {
  const list = $("asstList");
  list.replaceChildren();
  for (const a of allAssistants()) {
    const custom = !BUILTIN_ASSISTANTS.includes(a);
    const row = document.createElement("div");
    row.className = "asst-row";
    row.innerHTML = `<span class="asst-ic"></span><span class="asst-text"><b></b><span></span></span>`;
    row.querySelector(".asst-ic").textContent = a.icon;
    row.querySelector("b").textContent = a.name + (settings.defaultAssistant === a.id ? "  · default" : "");
    row.querySelector(".asst-text span").textContent = a.desc;
    if (custom) {
      const e = document.createElement("button"); e.type = "button"; e.className = "act"; e.innerHTML = icons.edit; e.title = "Edit"; e.onclick = () => editAssistant(a);
      const d = document.createElement("button"); d.type = "button"; d.className = "act"; d.innerHTML = icons.trash; d.title = "Delete";
      d.onclick = () => { saveSetting("assistants", settings.assistants.filter((x) => x.id !== a.id)); if (settings.defaultAssistant === a.id) saveSetting("defaultAssistant", "assist"); renderAssistants(); };
      row.append(e, d);
    }
    list.append(row);
  }
}
async function editAssistant(a) {
  const v = await modal({
    title: a ? "Edit assistant" : "Create an assistant", ok: a ? "Save" : "Create",
    fields: [
      { name: "name", label: "Name", value: a ? a.name : "", placeholder: "e.g. Lyte Social", maxLength: 28 },
      { name: "icon", label: "Icon (1–2 characters or an emoji)", value: a ? a.icon : "★", maxLength: 3 },
      { name: "desc", label: "Short description", value: a ? a.desc : "", placeholder: "What it's for" },
      { name: "prompt", label: "Instructions", value: a ? a.prompt : "", multiline: true, rows: 7, placeholder: "e.g. You write social posts for Lyte Fiber, a Houston fiber internet provider. Voice: friendly, local, confident. Always include a CTA to check availability." },
      { name: "web", label: "Turn on Web for new chats? (yes / no)", value: a && a.web ? "yes" : "no", maxLength: 3 },
    ],
  });
  if (!v || !v.name.trim()) return;
  const item = { id: a ? a.id : "custom-" + uid(), name: v.name.trim(), icon: (v.icon || "★").trim().slice(0, 3), desc: v.desc.trim() || "Custom assistant", prompt: v.prompt.trim(), web: /^y/i.test(v.web) };
  saveSetting("assistants", a ? settings.assistants.map((x) => (x.id === a.id ? item : x)) : [...settings.assistants, item]);
  renderAssistants();
  toast(a ? "Assistant saved" : `${item.name} created — pick it from the menu at the top of a chat`);
}
$("asstNew").onclick = () => editAssistant(null);

/* ---------- Settings: general ---------- */
function selectSeg(id, attr, val) { $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset[attr] === String(val))); }
function renderGeneral() {
  selectSeg("engineSeg", "engine", settings.searchEngine);
  selectSeg("pagesSeg", "pages", settings.readPages);
  $("quickOn").checked = settings.quickAsk;
  $("allowPlugins").checked = settings.allowPlugins;
  $("aboutLine").textContent = `Assist ${sys.version || ""} · on-device AI by WebLLM · ${sys.totalMemGB} GB memory${engine.loadedModel ? ` · ${modelName(engine.loadedModel)} loaded (${Math.round(engine.ctx / 1024)}k context)` : ""}`;
}
$("engineSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; saveSetting("searchEngine", b.dataset.engine); renderGeneral(); };
$("pagesSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; saveSetting("readPages", +b.dataset.pages); renderGeneral(); };
$("quickOn").onchange = async () => {
  saveSetting("quickAsk", $("quickOn").checked);
  const r = await desktop?.quick?.configure({ enabled: settings.quickAsk });
  if (settings.quickAsk && r && !r.ok) toast("That shortcut is taken by another app");
};
$("allowPlugins").onchange = () => { saveSetting("allowPlugins", $("allowPlugins").checked); setPluginsEnabled(settings.allowPlugins); };
$("clearChatsBtn").onclick = async () => {
  if (!(await modal({ title: "Delete all chats?", text: "This permanently removes every chat on this computer. Memories and settings stay.", ok: "Delete all", danger: true }))) return;
  stopChat(); await clearAllChats(); toast("All chats deleted");
};
$("clearHistoryBtn").onclick = () => { store.set("history", []); toast("Reply history cleared"); };
$("deleteModelsBtn").onclick = async () => {
  if (!(await modal({ title: "Delete downloaded models?", text: "You'll need internet to download a model again.", ok: "Delete", danger: true }))) return;
  await deleteAllModels();
  setStatus("", "Download model");
  announce(); renderModels(); toast("Models deleted");
};

/* ---------- Keyboard + menu commands ---------- */
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "Enter" && settings.tab === "reply") { e.preventDefault(); replyGenerate(); }
  if (mod && (e.key === "n" || e.key === "N") && !desktop) { e.preventDefault(); setTab("chat"); newChat(); }
  if (mod && e.key === "k") { e.preventDefault(); setTab("chat"); toggleSidebarOpen(); $("chatSearch").focus(); }
  if (e.key === "Escape") closeDrawers();
});
function toggleSidebarOpen() { if (!settings.sidebar) toggleSidebar(); }
desktop?.onCommand?.((cmd, arg) => {
  if (cmd === "new-chat") { setTab("chat"); newChat(); }
  else if (cmd === "tab-chat") setTab("chat");
  else if (cmd === "tab-reply") setTab("reply");
  else if (cmd === "toggle-sidebar") { setTab("chat"); toggleSidebar(); }
  else if (cmd === "import-chat" && arg) { setTab("chat"); importChat(arg); }
});
$("quickHint").onclick = () => toast(`Press ${shortcutLabel()} in any app to open Quick Ask`);
function shortcutLabel() { return isMac ? "⌘ ⇧ Space" : "Ctrl ⇧ Space"; }

/* ---------- Boot ---------- */
async function boot() {
  document.body.classList.add(desktop ? "is-desktop" : "is-web");
  if (desktop) document.body.classList.add("os-" + desktop.platform);
  if (isMac) { $("newChatKbd").textContent = "⌘ N"; document.querySelector("#generateBtn kbd").textContent = "⌘ ↵"; }
  $("quickKbd").textContent = shortcutLabel(); $("quickKbd2").textContent = shortcutLabel();
  if (!desktop) $("quickHint").hidden = true;

  if (desktop?.info) Object.assign(sys, await desktop.info().catch(() => ({})));
  else sys.totalMemGB = navigator.deviceMemory || 8;

  // First run: choose a model that suits this computer. Existing users keep theirs.
  if (!settings.model || !MODELS.some((m) => m.id === settings.model)) saveSetting("model", recommendedModel());

  initReply();
  initChat();
  initBridge();
  setTab(settings.tab === "reply" ? "reply" : "chat");
  if (desktop?.quick) desktop.quick.configure({ enabled: settings.quickAsk }).catch(() => {});

  if (!navigator.gpu) { $("unsupported").hidden = false; setStatus("", "Unsupported"); return; }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { $("unsupported").hidden = false; setStatus("", "Unsupported"); return; }
  } catch { $("unsupported").hidden = false; return; }

  announce();
  if (await isCached(settings.model)) ensureModel(settings.model).catch(() => {});
  else setStatus("", "Download model");
}
boot();
