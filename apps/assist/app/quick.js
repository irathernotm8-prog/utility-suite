// Quick Ask: a floating box on a global shortcut. The AI runs in the main Assist window.
import { renderMarkdown } from "./md.js";
import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
const api = window.assistDesktop;
const q = api.quick;
let web = store.get("quickWeb", false);
let req = null;          // current request id
let convo = [];          // [{role, content}]
let lastSources = [];
let pinned = false;

const ACTIONS = {
  reply: (t) => `Draft a reply to this message. Match its language and tone; keep it ready to send:\n\n"""\n${t}\n"""`,
  improve: (t) => `Improve this text: fix grammar, tighten wording and make it clearer, keeping my voice and meaning. Return only the improved text.\n\n"""\n${t}\n"""`,
  summarize: (t) => `Summarize this in a few bullet points:\n\n"""\n${t}\n"""`,
  explain: (t) => `Explain this in plain language:\n\n"""\n${t}\n"""`,
  translate: (t) => `Translate this into natural English. Return only the translation:\n\n"""\n${t}\n"""`,
};

function fit() {
  requestAnimationFrame(() => q.resize($("card").getBoundingClientRect().height + 2));
}
function autosize() { const t = $("q"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; fit(); }
function setWeb(on) { web = on; store.set("quickWeb", on); $("web").classList.toggle("on", on); }
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 1800);
}

function ask(text, display = text) {
  if (!text.trim()) return;
  if (req) { q.cancel(req); req = null; }
  convo.push({ role: "user", content: text, display });
  const id = crypto.randomUUID();
  req = id;
  lastSources = [];
  $("answer").hidden = false; $("foot").hidden = true;
  $("out").innerHTML = ""; $("sources").replaceChildren();
  $("status").hidden = false; $("statusText").textContent = "Thinking…";
  $("q").value = ""; autosize();
  q.ask(id, { messages: convo.map(({ role, content }) => ({ role, content })), web });
  fit();
}

q.onEvent((id, evt) => {
  if (id !== req) return;
  if (evt.type === "progress") { $("status").hidden = false; $("statusText").textContent = evt.text || "Working…"; fit(); }
  else if (evt.type === "delta") {
    $("status").hidden = true;
    $("out").innerHTML = renderMarkdown(evt.text || "", {});
    $("out").classList.add("streaming");
    $("answer").scrollTop = $("answer").scrollHeight;
    fit();
  } else if (evt.type === "done") {
    req = null;
    $("status").hidden = true;
    lastSources = evt.sources || [];
    $("out").classList.remove("streaming");
    $("out").innerHTML = renderMarkdown(evt.text || "", { sources: lastSources });
    convo.push({ role: "assistant", content: evt.text || "", model: evt.model, sources: lastSources });
    renderSources(lastSources);
    $("meta").textContent = `${evt.modelName || "Assist"} · on-device${lastSources.length ? " · web" : ""}`;
    $("foot").hidden = false;
    $("q").placeholder = "Ask a follow-up…";
    fit();
  } else if (evt.type === "error") {
    req = null;
    $("status").hidden = true;
    $("out").classList.remove("streaming");
    $("out").textContent = evt.message || "Something went wrong.";
    $("foot").hidden = true;
    convo.pop();
    fit();
  }
});
function renderSources(list) {
  const box = $("sources"); box.replaceChildren();
  list.forEach((s, i) => {
    const a = document.createElement("a");
    a.href = s.url; a.target = "_blank"; a.rel = "noopener"; a.className = "source" + (s.read ? " read" : "");
    let h = s.url; try { h = new URL(s.url).hostname.replace(/^www\./, ""); } catch {}
    a.innerHTML = `<span class="src-n">${i + 1}</span><span class="src-t"></span><span class="src-h"></span>`;
    a.querySelector(".src-t").textContent = s.title; a.querySelector(".src-h").textContent = h;
    box.append(a);
  });
}
function reset() {
  if (req) { q.cancel(req); req = null; }
  convo = []; lastSources = [];
  $("answer").hidden = true; $("foot").hidden = true; $("out").innerHTML = "";
  $("q").placeholder = "Ask Assist anything…";
  fit();
}

$("form").onsubmit = (e) => { e.preventDefault(); ask($("q").value.trim()); };
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($("q").value.trim()); }
});
$("q").addEventListener("input", autosize);
$("web").onclick = () => setWeb(!web);
$("clipActions").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const clip = (await api.clipboard.read()).trim();
  if (!clip) { toast("Your clipboard is empty — copy some text first"); return; }
  const extra = $("q").value.trim();
  reset();
  ask(ACTIONS[b.dataset.act](clip) + (extra ? `\n\nAlso: ${extra}` : ""), `${b.textContent}: ${clip.slice(0, 80)}`);
});
$("copy").onclick = () => {
  const last = [...convo].reverse().find((m) => m.role === "assistant");
  if (last) { api.clipboard.write(last.content); toast("Copied"); }
};
$("cont").onclick = () => {
  const first = convo.find((m) => m.role === "user");
  q.continueInAssist({ title: first ? (first.display || first.content).replace(/\s+/g, " ").slice(0, 48) : "Quick Ask", messages: convo.map((m) => ({ role: m.role, content: m.role === "user" ? m.content : m.content, model: m.model, sources: m.sources })) });
  reset();
};
$("pin").onclick = () => { pinned = !pinned; q.pin(pinned); $("pin").classList.toggle("on", pinned); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); if (req) { q.cancel(req); req = null; $("status").hidden = true; } else q.hide(); }
  if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); reset(); $("q").focus(); }
});
q.onShown(() => { $("q").focus(); $("q").select(); fit(); });
setWeb(web);
fit();
$("q").focus();
