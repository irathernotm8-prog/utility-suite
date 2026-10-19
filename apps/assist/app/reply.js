// The Reply tab: Assist's original reply drafting (email, text, comment, review, new), streamlined.
import { engine, runExclusive, complete, interrupt, settings, ensureModel, modelName } from "./engine.js";
import { store } from "./store.js";
import { toast } from "./ui.js";

/* ---------- Prompting ---------- */
export const TYPES = {
  email: { label: "The email you received", placeholder: "Paste the email here…",
    guide: "This is a reply to an email. Open with an appropriate greeting using the sender's name if it is known, write clear paragraphs, and close with a sign-off." },
  text: { label: "The text you received", placeholder: "Paste the text message here…",
    guide: "This is a reply to a text message (SMS / chat). Keep it conversational and natural. No greeting line, no sign-off, no subject. Emojis only if the tone is casual or upbeat and only sparingly." },
  comment: { label: "The comment you're replying to", placeholder: "Paste the comment (social post, forum, LinkedIn, YouTube…)…",
    guide: "This is a public reply to an online comment. Keep it concise and appropriate for a public audience. No sign-off, no subject. Address the commenter directly." },
  review: { label: "The review you're responding to", placeholder: "Paste the customer review here…",
    guide: "This is a public response from the business to a customer review. Thank the reviewer, address specific points they raised, and for negative reviews acknowledge the issue without being defensive and invite them to continue the conversation privately. Do not offer refunds or compensation unless the user's instructions say to." },
  new: { label: "What's it for?", placeholder: "Describe the message you need to write, e.g. 'Email to my landlord asking to fix the AC'…",
    guide: "Write a new message from scratch based on the description. Use a format suited to the medium implied by the description." },
};
export const LENGTHS = {
  short: "Keep it short: about 1 to 3 sentences.",
  medium: "Aim for a moderate length: roughly 60 to 140 words.",
  long: "Make it thorough: roughly 150 to 280 words, covering every relevant point.",
};
export const TONES = {
  professional: "professional, polished and courteous",
  friendly: "friendly and warm, but still clear",
  casual: "casual and relaxed, like talking to someone you know",
  empathetic: "empathetic and understanding",
  firm: "firm, direct and confident while staying polite",
  enthusiastic: "upbeat and positive",
};

export function replySystemPrompt() {
  const persona = settings.persona.trim();
  const mem = settings.memoryOn && settings.memories.length ? "\nThings the user asked you to remember:\n" + settings.memories.map((m) => "- " + m.text).join("\n") : "";
  return [
    "You are Assist, an expert writing assistant that drafts replies on the user's behalf.",
    "Rules:",
    "- Output ONLY the finished message text, ready to send. No preamble like 'Here is your reply', no explanations, no notes, no surrounding quotation marks, no markdown.",
    "- Write in the first person as the user.",
    "- Never invent facts, dates, prices, names, promises or commitments the user did not provide. If a specific detail is needed but unknown, use a short placeholder in square brackets, like [date].",
    "- Match the language of the message being replied to.",
    "- When asked to revise, output the full revised message only.",
    persona ? `\nThings to always keep in mind about the user:\n${persona}` : "",
    mem,
  ].join("\n");
}

// Shared by the Reply tab and the plugin bridge
export function draftRequest({ type = "email", tone = "professional", length = "medium", message = "", intent = "", context = "", subject = false, signName, extra = "" }) {
  const t = TYPES[type] || TYPES.email;
  const parts = [t.guide, `Tone: ${TONES[tone] || TONES.professional}.`, LENGTHS[length] || LENGTHS.medium];
  if (type === "email" || (type === "new" && subject)) {
    parts.push(subject ? "Begin with a subject line on its own line formatted exactly as 'Subject: …', then a blank line, then the message." : "Do not include a subject line.");
    const name = (signName ?? settings.signName).trim();
    if (type === "email") parts.push(name ? `Sign off with the name "${name}".` : "Sign off with [Your name].");
  }
  let msg = parts.join(" ") + "\n\n";
  msg += type === "new" ? `What to write:\n"""\n${message.trim()}\n"""\n` : `Message I'm replying to:\n"""\n${message.trim()}\n"""\n`;
  if (intent && intent.trim()) msg += `\nWhat I want my reply to say:\n${intent.trim()}\n`;
  if (context && context.trim()) msg += `\nBackground context:\n${context.trim()}\n`;
  if (extra) msg += `\n${extra}\n`;
  msg += "\nWrite the message now.";
  return msg;
}

export function cleanOutput(s) {
  return String(s)
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/^\s*(here('s| is)[^\n]*?:\s*\n+)/i, "")
    .replace(/^\s*["“]([\s\S]*)["”]\s*$/, "$1")
    .replace(/\*\*(Subject:?)\*\*/i, "$1")
    .trimStart();
}
export function splitSubject(s) {
  const m = s.match(/^\s*Subject:\s*(.+?)\s*(\n|$)/i);
  if (!m) return { subject: null, body: s };
  return { subject: m[1], body: s.slice(m[0].length).replace(/^\s*\n/, "") };
}

/* ---------- State ---------- */
const $ = (id) => document.getElementById(id);
let els = {};
const state = {
  type: "email", tone: "professional", len: "medium", busy: false,
  messages: [], current: "", historyId: null,
  count: "single", batch: [], cancel: false,
};

async function draft(messages, { regenerate = false, onText }) {
  const r = await complete({
    model: settings.model, messages, think: false,
    temperature: regenerate ? 0.9 : 0.7, maxTokens: state.len === "long" ? 700 : 450,
    onDelta: (a) => onText(cleanOutput(a)), shouldStop: () => state.cancel,
  });
  return cleanOutput(r.text);
}

const buildRequest = (incomingText = null, extra = "") => draftRequest({
  type: state.type, tone: state.tone, length: state.len,
  message: incomingText ?? els.incoming.value, intent: els.intent.value, context: els.context.value,
  subject: els.subjectToggle.checked, extra,
});

/* ---------- Generation ---------- */
const isBatch = () => state.type === "review" && state.count === "batch";

async function generate({ refine = null, regenerate = false } = {}) {
  if (state.busy) { state.cancel = true; if (engine.owner === "reply") interrupt(); return; }
  if (isBatch() || (state.batch.length && (refine || regenerate) && state.type === "review")) return generateBatch({ refine, regenerate });

  if (!refine && !regenerate) {
    if (!els.incoming.value.trim()) {
      els.incoming.focus();
      toast(state.type === "new" ? "Describe what you want to write first." : "Paste the message you're replying to first.");
      return;
    }
    state.messages = [{ role: "system", content: replySystemPrompt() }, { role: "user", content: buildRequest() }];
    state.historyId = Date.now();
  } else if (refine) {
    state.messages.push({ role: "assistant", content: state.current });
    state.messages.push({ role: "user", content: `Revise the message: ${refine}` });
  }

  state.cancel = false;
  setBusy(true);
  renderDraft("", true);
  if (engine.busy) setWaiting(true);
  if (window.matchMedia("(max-width: 900px)").matches) els.draft.closest(".output").scrollIntoView({ behavior: "smooth", block: "start" });
  let out = "";
  try {
    out = await runExclusive("reply", async () => {
      setWaiting(false);
      if (state.cancel) return "";
      await ensureModel(settings.model);
      return draft(state.messages, { regenerate, onText: (t) => renderDraft(t, true) });
    });
  } catch (err) {
    console.error(err);
    toast(err.message || "Something went wrong while writing. Try again.");
  }
  state.current = out || state.current;
  renderDraft(state.current, false);
  setBusy(false);
  if (out) saveHistory();
}
function setWaiting(on) {
  if (!on) { els.draft.querySelector(".waiting-note")?.remove(); return; }
  const n = document.createElement("span");
  n.className = "waiting-note"; n.textContent = "Waiting for Assist to finish another request…";
  els.draft.append(n);
}

/* ---------- Batch (several reviews) ---------- */
function readReviews() { return [...els.batchList.querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean); }
function batchExtra(prevReplies) {
  const openings = prevReplies.map((r) => r.split(/[.!?\n]/)[0].trim()).filter(Boolean).slice(-6);
  let x = "This is one of several reviews being answered in a batch, so the reply must be specific to THIS review's details.";
  if (openings.length) x += ` Do not reuse these openings already used for other reviews: ${openings.map((o) => `"${o}"`).join("; ")}.`;
  return x;
}
async function generateBatch({ refine = null, regenerate = false, only = null } = {}) {
  if (state.busy) return;
  if (!refine && !regenerate && only == null) {
    const reviews = readReviews();
    if (!reviews.length) { toast("Add at least one review first."); focusFirstReview(); return; }
    state.batch = reviews.map((review) => ({ review, messages: null, output: "" }));
    state.historyId = Date.now();
  }
  if (!state.batch.length) return;
  const targets = only != null ? [only] : state.batch.map((_, i) => i);
  for (const i of targets) {
    const item = state.batch[i];
    if (refine && item.output) item.messages = [...item.messages, { role: "assistant", content: item.output }, { role: "user", content: `Revise the message: ${refine}` }];
    else if (!item.messages || (!regenerate && only == null)) item.needsBuild = true;
  }
  state.cancel = false;
  setBusy(true);
  if (refine || regenerate || only != null) targets.forEach((i) => { state.batch[i].pending = true; });
  else state.batch.forEach((b) => { b.output = ""; b.pending = true; });
  renderBatch(-1);
  try {
    await runExclusive("reply", async () => {
      await ensureModel(settings.model);
      let done = 0;
      for (const i of targets) {
        if (state.cancel) break;
        const item = state.batch[i];
        if (item.needsBuild) {
          const others = state.batch.filter((b, j) => j !== i && b.output && !b.pending).map((b) => b.output);
          item.messages = [{ role: "system", content: replySystemPrompt() }, { role: "user", content: buildRequest(item.review, batchExtra(others)) }];
          item.needsBuild = false;
        }
        setBatchProgress(done, targets.length);
        renderBatch(i);
        const prev = item.output;
        item.output = (await draft(item.messages, { regenerate: regenerate || only != null, onText: (t) => updateReplyText(i, t) })) || prev;
        item.pending = false;
        done++;
      }
    });
  } catch (err) { console.error(err); toast(err.message || "Something went wrong while writing. Try again."); }
  state.batch.forEach((b) => { b.pending = false; });
  state.current = state.batch.map((b) => b.output).filter(Boolean).join("\n\n");
  setBatchProgress(null);
  renderBatch(-1);
  setBusy(false);
  if (state.current) saveHistory();
}
function setBatchProgress(done, total) {
  els.draftLabel.replaceChildren(document.createTextNode(isBatch() || state.batch.length ? "Replies" : "Draft"));
  if (done != null) { const s = document.createElement("span"); s.className = "batch-progress"; s.textContent = `${Math.min(done + 1, total)} of ${total}`; els.draftLabel.append(s); }
}
function renderBatch(activeIndex) {
  els.emptyState.hidden = true;
  els.draft.classList.remove("streaming");
  els.draft.classList.add("multi");
  els.draft.replaceChildren();
  state.batch.forEach((item, i) => {
    const card = document.createElement("article");
    card.className = "reply-card" + (i === activeIndex ? " active" : "") + (item.output && !item.pending ? " done" : "");
    card.dataset.index = i;
    const head = document.createElement("div"); head.className = "reply-head";
    const num = document.createElement("span"); num.className = "batch-num"; num.textContent = i + 1;
    const quote = document.createElement("span"); quote.className = "reply-quote"; quote.textContent = "“" + item.review.replace(/\s+/g, " ") + "”"; quote.title = item.review;
    const tools = document.createElement("div"); tools.className = "reply-tools";
    const redo = document.createElement("button"); redo.type = "button"; redo.className = "btn tiny"; redo.textContent = "Redo"; redo.disabled = state.busy;
    redo.onclick = () => generateBatch({ only: i });
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "btn tiny accent"; copy.textContent = "Copy"; copy.disabled = state.busy || !item.output;
    copy.onclick = () => copyText(item.output);
    tools.append(redo, copy); head.append(num, quote, tools);
    const body = document.createElement("div"); body.className = "reply-body";
    if (item.pending && i !== activeIndex) { body.classList.add("waiting"); body.textContent = item.output ? item.output : "Waiting…"; }
    else body.textContent = item.output;
    card.append(head, body); els.draft.append(card);
  });
  const active = els.draft.querySelector(".reply-card.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}
function updateReplyText(i, text) {
  const body = els.draft.querySelector(`.reply-card[data-index="${i}"] .reply-body`);
  if (body) { body.classList.remove("waiting"); body.textContent = text; }
  const card = body && body.closest(".reply-card");
  if (card) { const r = card.getBoundingClientRect(), d = els.draft.getBoundingClientRect(); if (r.bottom > d.bottom) els.draft.scrollTop += r.bottom - d.bottom + 12; }
}

/* Review inputs */
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function addReview(text = "", focus = true, after = null) {
  const item = document.createElement("div"); item.className = "batch-item";
  const num = document.createElement("span"); num.className = "batch-num";
  const ta = document.createElement("textarea"); ta.rows = 3; ta.placeholder = "Paste a review…"; ta.value = text;
  ta.addEventListener("paste", onReviewPaste);
  const rm = document.createElement("button"); rm.type = "button"; rm.className = "batch-remove"; rm.setAttribute("aria-label", "Remove review"); rm.innerHTML = ICON_X;
  rm.onclick = () => { if (els.batchList.children.length === 1) { ta.value = ""; ta.focus(); return; } item.remove(); renumberReviews(); };
  item.append(num, ta, rm);
  if (after) after.after(item); else els.batchList.append(item);
  renumberReviews();
  if (focus) ta.focus();
  return item;
}
function renumberReviews() { [...els.batchList.children].forEach((el, i) => { el.querySelector(".batch-num").textContent = i + 1; }); }
function focusFirstReview() { const t = els.batchList.querySelector("textarea"); if (t) t.focus(); }
function setReviews(list) { els.batchList.replaceChildren(); (list.length ? list : [""]).forEach((r) => addReview(r, false)); }
let lastSplit = null;
function onReviewPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  const parts = text.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return;
  e.preventDefault();
  const ta = e.target;
  const before = [...els.batchList.querySelectorAll("textarea")].map((t) => t.value);
  let anchor = ta.closest(".batch-item");
  if (!ta.value.trim()) ta.value = parts[0]; else anchor = addReview(parts[0], false, anchor);
  for (const p of parts.slice(1)) anchor = addReview(p, false, anchor);
  lastSplit = before;
  toast(`Split into ${parts.length} reviews`, "Undo", () => { if (lastSplit) setReviews(lastSplit); });
}
function setCount(c) { state.count = c; selectIn(els.countSeg, "count", c); applyCountLayout(); }
function applyCountLayout() {
  const batch = isBatch();
  els.incoming.hidden = batch; els.batchList.hidden = !batch; els.batchFoot.hidden = !batch;
  els.incomingLabel.textContent = batch ? "The reviews you're responding to" : TYPES[state.type].label;
  if (batch && !els.batchList.children.length) setReviews(els.incoming.value.trim() ? [els.incoming.value.trim()] : [""]);
  if (!batch && state.type === "review") { const first = readReviews()[0]; if (first && !els.incoming.value.trim()) els.incoming.value = first; }
  els.generateBtn.querySelector("span").textContent = batch ? "Draft replies" : "Draft reply";
}
function copyText(text) {
  const { subject, body } = splitSubject(text);
  const t = subject ? `Subject: ${subject}\n\n${body}` : body;
  navigator.clipboard.writeText(t).then(() => toast("Copied to clipboard"), () => toast("Couldn't copy. Select the text instead."));
}

function renderDraft(text, streaming) {
  els.emptyState.hidden = true;
  els.draft.classList.remove("multi");
  state.batch = [];
  setBatchProgress(null);
  els.draft.classList.toggle("streaming", streaming);
  const { subject, body } = splitSubject(text);
  els.draft.replaceChildren();
  if (subject) { const s = document.createElement("span"); s.className = "subject"; s.innerHTML = "<b>Subject</b>"; s.append(document.createTextNode(subject)); els.draft.append(s); }
  const b = document.createElement("span"); b.className = "body"; b.textContent = body; els.draft.append(b);
  if (streaming) els.draft.scrollTop = els.draft.scrollHeight;
}
function setBusy(on) {
  state.busy = on;
  els.generateBtn.querySelector("span").textContent = on ? "Stop" : isBatch() ? "Draft replies" : "Draft reply";
  els.copyBtn.textContent = state.batch.length ? "Copy all" : "Copy";
  els.refineInput.placeholder = state.batch.length ? "Tell Assist what to change in every reply…" : "Tell Assist what to change…";
  els.regenBtn.textContent = state.batch.length ? "Redo all" : "Regenerate";
  els.draft.querySelectorAll(".reply-tools button").forEach((b) => { b.disabled = on || (b.textContent === "Copy" && !state.batch[+b.closest(".reply-card").dataset.index]?.output); });
  els.regenBtn.disabled = on || !state.messages.length && !state.batch.length;
  els.copyBtn.disabled = on || !state.current;
  els.refine.hidden = !state.current && !on;
  els.refineInput.disabled = on;
  els.refineChips.querySelectorAll("button").forEach((b) => (b.disabled = on));
}

/* ---------- History ---------- */
function saveHistory() {
  const list = store.get("history", []);
  const entry = {
    id: state.historyId, at: Date.now(), type: state.type, tone: state.tone, len: state.len,
    incoming: els.incoming.value, intent: els.intent.value, context: els.context.value,
    subject: els.subjectToggle.checked, output: state.current,
    batch: state.batch.length ? state.batch.map((b) => ({ review: b.review, output: b.output })) : null,
  };
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  store.set("history", list.slice(0, 50));
}
export function renderHistory(listEl, onPick) {
  const list = store.get("history", []);
  listEl.replaceChildren();
  if (!list.length) { listEl.innerHTML = '<p class="hist-empty">No drafts yet.</p>'; return; }
  for (const e of list) {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "hist-item";
    const top = document.createElement("div"); top.className = "top";
    const type = document.createElement("span"); type.className = "type";
    type.textContent = e.type === "new" ? "New" : e.batch ? `${e.batch.length} reviews` : e.type;
    const when = document.createElement("span");
    when.textContent = new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    top.append(type, when);
    const snip = document.createElement("div"); snip.className = "snip"; snip.textContent = e.output;
    btn.append(top, snip);
    btn.onclick = () => { restore(e); onPick && onPick(); };
    listEl.append(btn);
  }
}
function restore(e) {
  selectType(e.type); selectTone(e.tone); selectLen(e.len);
  if (e.batch) {
    setCount("batch");
    setReviews(e.batch.map((b) => b.review));
    els.intent.value = e.intent; els.context.value = e.context;
    state.historyId = e.id;
    state.batch = e.batch.map((b) => ({ review: b.review, output: b.output, messages: [{ role: "system", content: replySystemPrompt() }, { role: "user", content: buildRequest(b.review, batchExtra([])) }] }));
    state.current = state.batch.map((b) => b.output).join("\n\n");
    setBatchProgress(null); renderBatch(-1); setBusy(false);
    return;
  }
  if (e.type === "review") setCount("single");
  els.incoming.value = e.incoming; els.intent.value = e.intent; els.context.value = e.context;
  els.subjectToggle.checked = !!e.subject;
  state.historyId = e.id; state.current = e.output;
  state.messages = [{ role: "system", content: replySystemPrompt() }, { role: "user", content: buildRequest() }];
  renderDraft(e.output, false); setBusy(false);
}

/* ---------- UI wiring ---------- */
function selectIn(container, attr, value) {
  container.querySelectorAll("button").forEach((b) => { const on = b.dataset[attr] === value; b.classList.toggle("on", on); if (b.hasAttribute("role")) b.setAttribute("aria-checked", on); });
}
function selectType(t) {
  state.type = t; selectIn(els.typeSeg, "type", t);
  els.incomingLabel.textContent = TYPES[t].label; els.incoming.placeholder = TYPES[t].placeholder;
  els.subjectToggleWrap.hidden = !(t === "email" || t === "new");
  els.countSeg.hidden = t !== "review";
  applyCountLayout();
}
function selectTone(t) { state.tone = t; selectIn(els.toneChips, "tone", t); }
function selectLen(l) { state.len = l; selectIn(els.lengthSeg, "len", l); }

export function initReply() {
  for (const id of ["typeSeg", "lengthSeg", "toneChips", "incoming", "incomingLabel", "intent", "context", "subjectToggle", "subjectToggleWrap",
    "generateBtn", "clearBtn", "regenBtn", "copyBtn", "draft", "emptyState", "refine", "refineChips", "refineForm", "refineInput",
    "countSeg", "batchList", "batchFoot", "addReviewBtn", "draftLabel"]) els[id] = $(id);
  els.typeSeg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) selectType(b.dataset.type); });
  els.toneChips.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) selectTone(b.dataset.tone); });
  els.lengthSeg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) selectLen(b.dataset.len); });
  els.generateBtn.onclick = () => generate();
  els.countSeg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !state.busy) setCount(b.dataset.count); });
  els.addReviewBtn.onclick = () => addReview();
  els.regenBtn.onclick = () => generate({ regenerate: true });
  els.refineChips.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && state.current) generate({ refine: b.dataset.refine }); });
  els.refineForm.onsubmit = (e) => { e.preventDefault(); const v = els.refineInput.value.trim(); if (!v || !state.current) return; els.refineInput.value = ""; generate({ refine: v }); };
  els.clearBtn.onclick = () => {
    els.incoming.value = els.intent.value = els.context.value = "";
    state.messages = []; state.current = ""; state.batch = [];
    if (isBatch()) setReviews([]);
    els.draft.classList.remove("multi"); setBatchProgress(null);
    els.draft.replaceChildren(els.emptyState); els.emptyState.hidden = false;
    setBusy(false); els.incoming.focus();
  };
  els.copyBtn.onclick = async () => {
    if (state.batch.length) {
      const all = state.batch.filter((b) => b.output).map((b, i) => `Review ${i + 1}: "${b.review.replace(/\s+/g, " ").slice(0, 80)}${b.review.length > 80 ? "…" : ""}"\n\n${b.output}`).join("\n\n— — —\n\n");
      try { await navigator.clipboard.writeText(all); toast(`Copied ${state.batch.filter((b) => b.output).length} replies`); } catch { toast("Couldn't copy. Select the text instead."); }
      return;
    }
    copyText(state.current);
  };
  if (/Mac|iPhone|iPad/.test(navigator.platform)) els.generateBtn.querySelector("kbd").textContent = "⌘ ↵";
  selectType("email");
  setBusy(false);
  els.refine.hidden = true;
}
export const replyGenerate = () => generate();
export const replyModelLabel = () => modelName(settings.model);
