// Requests from outside the main window: Relay and other apps (plugin bridge, incl. the
// OpenAI-compatible endpoint) and the Quick Ask window. All run on the same on-device
// engine, one at a time, through the shared queue.
import { engine, runExclusive, complete, ensureModel, isCached, settings, modelName, modelById, interrupt, sys } from "./engine.js";
import { TYPES, TONES, LENGTHS, replySystemPrompt, draftRequest, cleanOutput, splitSubject } from "./reply.js";
import { research, webAvailable, RESEARCH_RULES } from "./research.js";
import { toast } from "./ui.js";

const cancelled = new Set();
let currentId = null;

async function status() {
  const cached = await isCached(settings.model);
  return {
    type: "status", app: "Assist", version: sys.version, enabled: settings.allowPlugins, gpu: !!navigator.gpu && document.getElementById("unsupported").hidden,
    model: settings.model, modelName: modelName(settings.model), downloaded: cached,
    ready: !!engine.inst && engine.loadedModel === settings.model, busy: engine.busy,
    tones: Object.keys(TONES), lengths: Object.keys(LENGTHS), types: Object.keys(TYPES),
    web: webAvailable(), openai: true,
  };
}

function quickSystem(web) {
  const today = new Date().toLocaleString([], { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const me = [];
  if (settings.signName.trim()) me.push(`The user's name is ${settings.signName.trim()}.`);
  if (settings.persona.trim()) me.push(settings.persona.trim());
  if (settings.memoryOn && settings.memories.length) me.push("Things the user asked you to remember:\n" + settings.memories.map((x) => "- " + x.text).join("\n"));
  return [
    "You are Assist, a fast, private AI assistant running on the user's own computer. This is Quick Ask: answer directly and concisely. Use Markdown only when it clearly helps.",
    `Current date and time: ${today}.`,
    web ? RESEARCH_RULES : "",
    me.length ? "About the user:\n" + me.join("\n") : "",
  ].filter(Boolean).join("\n\n");
}

async function run(id, kind, p, send) {
  if (cancelled.has(id)) { cancelled.delete(id); return; }
  const fromApp = kind !== "quick";
  if (fromApp && !settings.allowPlugins) return send({ type: "error", code: "disabled", message: "Plugins are turned off in Assist → Settings." });
  if (!navigator.gpu || !document.getElementById("unsupported").hidden) return send({ type: "error", code: "unsupported", message: "Assist can't run its AI on this computer's graphics chip." });
  const model = settings.model;
  if (!(await isCached(model)) && fromApp && !p.allowDownload) return send({ type: "error", code: "model_missing", message: `Open Assist once to download its AI model (${modelName(model)}).` });
  if (engine.busy) send({ type: "progress", text: "Waiting for Assist to finish another request…" });

  const who = fromApp ? String(p.client || "another app") : "Quick Ask";
  await runExclusive(fromApp ? "plugin" : "quick", async () => {
    if (cancelled.has(id)) { cancelled.delete(id); return; }
    currentId = id;
    document.dispatchEvent(new CustomEvent("engine-activity", { detail: { who } }));
    const prevHook = engine.hooks.progress;
    try {
      engine.hooks.progress = (pr) => { prevHook(pr); send({ type: "progress", text: pr.text, progress: pr.progress || 0 }); };
      try { await ensureModel(model); }
      catch (e) { return send({ type: "error", code: "load_failed", message: e.message || "Assist couldn't load its AI model." }); }
      finally { engine.hooks.progress = prevHook; }

      let messages, maxTokens, temperature, think = false, sources = [], steps = [];
      if (kind === "draft") {
        if (!String(p.message || "").trim()) return send({ type: "error", code: "empty", message: "Nothing to reply to." });
        messages = [{ role: "system", content: replySystemPrompt() }, { role: "user", content: draftRequest({ ...p, type: p.type || "email", length: p.length || "medium" }) }];
        if (Array.isArray(p.revisions)) for (const r of p.revisions) {
          if (r.previous) messages.push({ role: "assistant", content: String(r.previous) });
          if (r.instruction) messages.push({ role: "user", content: `Revise the message: ${r.instruction}` });
        }
        maxTokens = p.length === "long" ? 700 : 450;
        temperature = p.regenerate ? 0.9 : 0.7;
      } else {
        const history = (Array.isArray(p.messages) ? p.messages : [{ role: "user", content: String(p.prompt || "") }])
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
          .map((m) => ({ role: m.role, content: String(m.content).slice(0, 24000) }));
        let webBlock = "";
        if (kind === "quick" && p.web && webAvailable() && history.length) {
          const last = history[history.length - 1];
          const r = await research({
            question: last.content, recent: history.slice(-5, -1), readPages: Math.min(settings.readPages, 3), engine: settings.searchEngine,
            charBudget: Math.floor((engine.ctx || 4096) * 3.6 * 0.38),
            onStatus: (s) => send({ type: "progress", text: s.text }),
            ask: async (q) => (await complete({ model, messages: [{ role: "user", content: q }], think: false, temperature: 0, maxTokens: 32 })).text,
          });
          if (r) { webBlock = r.block; sources = r.sources; steps = r.steps; }
          if (webBlock) history[history.length - 1] = { role: "user", content: `${webBlock}\n\nMy message: ${last.content}` };
        }
        const sys = kind === "quick" ? quickSystem(!!webBlock) : String(p.system || "You are a helpful assistant. Be concise.");
        messages = [{ role: "system", content: sys.slice(0, 12000) }, ...history.slice(-12)];
        maxTokens = Math.max(64, Math.min(2048, +p.maxTokens || (kind === "quick" ? 1200 : 800)));
        temperature = typeof p.temperature === "number" ? p.temperature : 0.6;
        think = kind === "quick" && !!p.think && modelById(model).think;
      }

      const r = await complete({
        model, messages, think, maxTokens, temperature,
        onDelta: (() => { let sent = 0; return (answer) => {
          const text = kind === "draft" ? cleanOutput(answer) : answer;
          const delta = answer.slice(sent); sent = answer.length;
          if (delta) send({ type: "delta", delta, text });
        }; })(),
        shouldStop: () => cancelled.has(id),
      });
      const text = kind === "draft" ? cleanOutput(r.text) : r.text.trim();
      send(kind === "draft" ? { type: "done", text, ...splitSubject(text), model } : { type: "done", text, model, modelName: modelName(model), sources, steps });
    } catch (err) {
      console.error(err);
      send({ type: "error", code: "failed", message: "Something went wrong while writing." });
    } finally {
      cancelled.delete(id); currentId = null;
      document.dispatchEvent(new CustomEvent("engine-activity", { detail: { who: null } }));
    }
  });
}

export function initBridge() {
  const bridge = window.assistDesktop?.bridge;
  if (!bridge) return;
  bridge.setEnabled(settings.allowPlugins);
  bridge.onRequest(({ id, kind, payload }) => {
    const send = (evt) => bridge.reply(id, evt);
    if (kind === "status") { status().then(send); return; }
    run(id, kind, payload || {}, send).catch((e) => send({ type: "error", code: "failed", message: e.message }));
  });
  bridge.onCancel((id) => { cancelled.add(id); if (currentId === id) interrupt(); });
  bridge.ready();
}
export function setPluginsEnabled(on) {
  window.assistDesktop?.bridge?.setEnabled(on);
  toast(on ? "Relay and your other apps can use Assist" : "Plugins turned off");
}
