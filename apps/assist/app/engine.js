// The on-device AI engine, shared by Chat, Reply, Quick Ask and the plugin bridge.
// One model is loaded at a time and requests run one after another through a queue.
import { CreateWebWorkerMLCEngine, hasModelInCache, deleteModelAllInfoInCache } from "./web-llm.js";
import { store } from "./store.js";

/* ---------- Model catalog ----------
   size: download size in GB (≈ memory used while running)
   minRAM: smallest computer memory (GB) it's comfortable on
   think: supports "Think deeper" (reasoning before answering)
   vision: can read images */
export const MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Swift", family: "Llama 3.2 · 1B", size: 0.9, minRAM: 4, tag: "Fastest", blurb: "Instant replies. Fine for short drafts on any computer." },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Classic", family: "Qwen 2.5 · 1.5B", size: 1.6, minRAM: 6, tag: "Assist 1.x", blurb: "The original Assist model." },
  { id: "Qwen3.5-2B-q4f16_1-MLC", name: "Balanced", family: "Qwen 3.5 · 2B", size: 2.2, minRAM: 8, tag: "Light", think: true, blurb: "Quick and capable. Good for 8 GB computers." },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Sharp", family: "Llama 3.2 · 3B", size: 2.3, minRAM: 8, tag: "Writing", blurb: "Natural, friendly writing style." },
  { id: "Qwen3.5-4B-q4f16_1-MLC", name: "Smart", family: "Qwen 3.5 · 4B", size: 3.9, minRAM: 12, tag: "Recommended", think: true, blurb: "Big step up in reasoning, research and long chats." },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", name: "Writer Pro", family: "Llama 3.1 · 8B", size: 5.0, minRAM: 16, tag: "Polished", blurb: "Rich, polished long-form writing." },
  { id: "Qwen3.5-9B-q4f16_1-MLC", name: "Pro", family: "Qwen 3.5 · 9B", size: 6.4, minRAM: 16, tag: "Most capable", think: true, blurb: "The strongest model Assist runs. Best with 16 GB or more." },
  { id: "Phi-3.5-vision-instruct-q4f16_1-MLC", name: "Vision", family: "Phi 3.5 Vision · 4B", size: 4.5, minRAM: 12, tag: "Reads images", vision: true, fixedCtx: 4096, blurb: "Understands screenshots, photos and charts you attach." },
];
export const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[1];
export const modelName = (id) => modelById(id).name;

export const sys = { totalMemGB: 8, platform: "", version: "" };

export function recommendedModel(ramGB = sys.totalMemGB) {
  if (ramGB >= 12) return "Qwen3.5-4B-q4f16_1-MLC";
  if (ramGB >= 8) return "Qwen3.5-2B-q4f16_1-MLC";
  return "Llama-3.2-1B-Instruct-q4f16_1-MLC";
}
export function fitFor(m, ramGB = sys.totalMemGB) {
  if (ramGB >= m.minRAM) return "ok";
  if (ramGB >= m.minRAM - 4) return "tight";
  return "too-big";
}
// How much conversation the model can keep in view at once (tokens). More memory → longer chats.
export function contextFor(m, ramGB = sys.totalMemGB) {
  if (m.fixedCtx) return m.fixedCtx;
  if (m.size <= 2.5) return ramGB >= 12 ? 16384 : 8192;
  if (m.size <= 4.2) return ramGB >= 16 ? 16384 : ramGB >= 12 ? 8192 : 4096;
  return ramGB >= 24 ? 16384 : ramGB >= 16 ? 8192 : 4096;
}

/* ---------- Engine state ---------- */
export const engine = {
  inst: null, loadedModel: null, ctx: 4096, loading: null, busy: false, owner: null,
  hooks: { progress: () => {}, loadStart: () => {}, loadEnd: () => {}, status: () => {} },
};

export const isCached = (id) => hasModelInCache(id).catch(() => false);

export async function ensureModel(id) {
  if (engine.inst && engine.loadedModel === id) return engine.inst;
  if (engine.loading && engine.loading.id === id) return engine.loading.p;
  if (engine.loading) await engine.loading.p.catch(() => {});
  if (engine.inst && engine.loadedModel === id) return engine.inst;

  const m = modelById(id);
  const p = (async () => {
    const cached = await isCached(id);
    engine.hooks.loadStart({ model: m, cached });
    engine.hooks.status("busy", cached ? `Starting ${m.name}…` : `Downloading ${m.name}…`);
    const onProgress = (pr) => engine.hooks.progress(pr);
    const tryLoad = async (ctx) => {
      const chatOpts = ctx ? { context_window_size: ctx } : undefined;
      if (engine.inst) {
        engine.inst.setInitProgressCallback(onProgress);
        await engine.inst.reload(id, chatOpts);
      } else {
        const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        engine.inst = await CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: onProgress }, chatOpts);
      }
      engine.ctx = ctx || 4096;
    };
    try {
      const ctx = m.fixedCtx ? null : contextFor(m);
      try { await tryLoad(ctx); }
      catch (e) {
        // Longer context didn't fit (memory) or isn't supported by this model: use the model's own default
        if (!ctx || (!navigator.onLine && !(await isCached(id)))) throw e;
        console.warn("Retrying with the model's default context", e);
        await tryLoad(null);
      }
      engine.loadedModel = id;
      engine.hooks.status("ready", `${m.name} · on-device`);
      announce();
      return engine.inst;
    } catch (err) {
      console.error(err);
      engine.loadedModel = null;
      engine.hooks.status("", "Load failed");
      const msg = String(err && err.message || err);
      const e = new Error(/memory|OOM|allocat/i.test(msg) ? `Not enough memory for ${m.name}. Try a smaller model in Settings.` : !navigator.onLine && !(await isCached(id)) ? "You're offline and this model isn't downloaded yet." : "Couldn't load the model. Check your connection and try again.");
      e.cause = err;
      throw e;
    } finally {
      engine.loading = null;
      engine.hooks.loadEnd();
    }
  })();
  engine.loading = { id, p };
  return p;
}

export function announce() {
  const b = window.assistDesktop?.bridge;
  if (b && b.setModel) b.setModel({ model: engine.loadedModel, modelName: engine.loadedModel ? modelName(engine.loadedModel) : null });
}

export async function deleteAllModels() {
  try { if (engine.inst) await engine.inst.unload(); } catch {}
  engine.inst = null; engine.loadedModel = null;
  for (const m of MODELS) await deleteModelAllInfoInCache(m.id).catch(() => {});
}

/* ---------- One-at-a-time queue ---------- */
let chain = Promise.resolve();
const waiting = [];
export function queueLength() { return waiting.length; }
export function runExclusive(owner, fn) {
  const job = chain.then(async () => {
    waiting.shift();
    engine.busy = true; engine.owner = owner;
    try { return await fn(); }
    finally { engine.busy = false; engine.owner = null; }
  });
  waiting.push(owner);
  chain = job.catch(() => {});
  return job;
}
export function interrupt() { try { engine.inst && engine.inst.interruptGenerate(); } catch {} }

/* ---------- Thinking ---------- */
// Split "<think>…</think>answer" into its parts, even mid-stream.
export function splitThinking(raw, expectThinking = false) {
  const s = raw.replace(/^\s+/, "");
  if (!s.startsWith("<think>")) {
    // Some models start thinking without writing the opening tag
    const close = s.indexOf("</think>");
    if (close >= 0) return { thinking: s.slice(0, close).trim(), answer: s.slice(close + 8).replace(/^\s+/, ""), thinkingOpen: false };
    if (expectThinking) return { thinking: s.trim(), answer: "", thinkingOpen: true };
    return { thinking: "", answer: raw.replace(/<\/?think>/g, ""), thinkingOpen: false };
  }
  const end = s.indexOf("</think>");
  if (end < 0) return { thinking: s.slice(7).trim(), answer: "", thinkingOpen: true };
  return { thinking: s.slice(7, end).trim(), answer: s.slice(end + 8).replace(/^\s+/, ""), thinkingOpen: false };
}

/* ---------- Generate ----------
   messages: OpenAI-style. Streams text through onDelta(answerSoFar, thinkingSoFar).
   Returns { text, thinking, usage, stopped }. Must be called inside runExclusive. */
export async function complete({ model, messages, onDelta = () => {}, think = false, maxTokens = 1024, temperature = 0.7, topP = 0.95, shouldStop = () => false }) {
  const inst = await ensureModel(model);
  const m = modelById(model);
  const req = { messages, stream: true, temperature, top_p: topP, max_tokens: maxTokens, stream_options: { include_usage: true } };
  if (m.think) req.extra_body = { enable_thinking: !!think };
  let raw = "", usage = null, stopped = false;
  const expect = !!(m.think && think);
  const stream = await inst.chat.completions.create(req);
  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const d = chunk.choices?.[0]?.delta?.content || "";
    if (d) {
      raw += d;
      const { thinking, answer } = splitThinking(raw, expect);
      onDelta(answer, thinking);
    }
    if (shouldStop()) { stopped = true; inst.interruptGenerate(); }
  }
  let { thinking, answer } = splitThinking(raw, expect);
  // Never lose an answer: if the model never closed its thinking, show what it wrote as the answer
  if (!answer.trim() && thinking && !/<\/think>/.test(raw)) { answer = thinking; thinking = ""; }
  return { text: answer.trim(), thinking, usage, stopped };
}

// Rough token count (no tokenizer needed): ~3.6 characters per token for English
export const approxTokens = (s) => Math.ceil(String(s || "").length / 3.6);

// Settings shared by all tabs
export const settings = {
  model: store.get("model", null),           // null until first run picks one by memory
  signName: store.get("signName", ""),
  persona: store.get("persona", ""),
  allowPlugins: store.get("allowPlugins", true),
  memoryOn: store.get("memoryOn", true),
  memories: store.get("memories", []),       // [{ id, text, at }]
  quickAsk: store.get("quickAsk", true),
  searchEngine: store.get("searchEngine", "auto"),
  readPages: store.get("readPages", 3),
  assistants: store.get("assistants", []),   // custom assistants
  defaultAssistant: store.get("defaultAssistant", "assist"),
  sidebar: store.get("sidebar", true),
  tab: store.get("tab", "chat"),
};
export function saveSetting(k, v) { settings[k] = v; store.set(k, v); }
