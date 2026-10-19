const { app, BrowserWindow, Menu, net, protocol, shell, ipcMain, globalShortcut, clipboard, dialog, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const web = require("./web");

const APP_DIR = path.join(__dirname, "app");
const SCHEME = "assist";
const isMac = process.platform === "darwin";

// A private, secure origin for the app's files. This gives the app working module
// workers and the persistent cache the AI engine stores the model in.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// WebGPU is on by default on macOS and Windows; Linux needs it switched on.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-unsafe-webgpu");

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let quickWin = null;
// Started by another app (e.g. Relay) just to serve the plugin bridge: keep the window hidden.
const startHidden = process.argv.includes("--background");

const WEB_PREFS = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: true,
};

function guardNavigation(w) {
  // Any link that tries to open a new window goes to the user's real browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  // Right-click: spelling suggestions plus cut / copy / paste.
  w.webContents.on("context-menu", (_e, p) => {
    const items = [];
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => w.webContents.replaceMisspelling(s) });
    if (p.misspelledWord) items.push({ label: "Add to dictionary", click: () => w.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
    if (p.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" });
    else if (p.selectionText) items.push({ role: "copy" });
    if (p.linkURL && /^https?:/.test(p.linkURL)) items.push({ type: "separator" }, { label: "Open link in browser", click: () => shell.openExternal(p.linkURL) }, { label: "Copy link", click: () => clipboard.writeText(p.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

function createWindow(hidden = startHidden) {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 420,
    minHeight: 580,
    show: false,
    title: "Assist",
    backgroundColor: "#0E0F11",
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: "#0E0F11", symbolColor: "#9A9BA3", height: 48 } }),
    webPreferences: {
      ...WEB_PREFS,
      // keep writing at full speed while the window is hidden (plugin + Quick Ask requests)
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => { if (!hidden) win.show(); });
  win.loadURL(`${SCHEME}://app/index.html`);
  guardNavigation(win);
  // On Mac, closing the window keeps Assist (and its loaded model) running for Quick Ask and Relay
  win.on("close", (e) => { if (isMac && !app.__quitting) { e.preventDefault(); win.hide(); } });
  win.on("closed", () => { win = null; bridge.rendererReady = false; });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Chat", accelerator: "CmdOrCtrl+N", click: () => { showWindow(); sendMain("app:command", "new-chat"); } },
        { label: "Quick Ask", accelerator: settingsShortcut(), click: () => toggleQuick() },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Chat", accelerator: "CmdOrCtrl+1", click: () => sendMain("app:command", "tab-chat") },
        { label: "Reply", accelerator: "CmdOrCtrl+2", click: () => sendMain("app:command", "tab-reply") },
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: () => sendMain("app:command", "toggle-sidebar") },
        { type: "separator" },
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function sendMain(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }

/* ---------- System info, web, files (asked for by the interface) ---------- */
ipcMain.handle("sys:info", () => ({
  totalMemGB: Math.round(os.totalmem() / 1073741824),
  platform: process.platform, arch: process.arch, version: app.getVersion(),
  shortcut: settingsShortcut(),
}));
ipcMain.handle("web:search", (_e, query, opts) => web.search(String(query || "").slice(0, 300), opts || {}));
ipcMain.handle("web:fetch", (_e, url) => web.fetchPage(String(url || "")));
ipcMain.handle("file:save", async (e, { name, content }) => {
  const owner = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(owner, { defaultPath: path.join(app.getPath("documents"), String(name || "Assist chat.md")) });
  if (r.canceled || !r.filePath) return { ok: false };
  await fs.promises.writeFile(r.filePath, String(content ?? ""), "utf8");
  return { ok: true, path: r.filePath };
});
ipcMain.handle("clipboard:read", () => clipboard.readText().slice(0, 50000));
ipcMain.on("clipboard:write", (_e, text) => clipboard.writeText(String(text ?? "")));

/* ---------- Quick Ask: a small floating window on a global shortcut ---------- */
let quickShortcut = "CommandOrControl+Shift+Space";
let quickEnabled = true;
function settingsShortcut() { return quickShortcut; }

function createQuick() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 680, h = 460;
  quickWin = new BrowserWindow({
    width: w, height: h, x: Math.round(workArea.x + (workArea.width - w) / 2), y: Math.round(workArea.y + workArea.height * 0.18),
    frame: false, resizable: true, minWidth: 460, minHeight: 200, show: false, skipTaskbar: true,
    alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
    backgroundColor: "#00000000", transparent: isMac, vibrancy: isMac ? "hud" : undefined, visualEffectState: "active",
    roundedCorners: true, hasShadow: true,
    webPreferences: { ...WEB_PREFS, backgroundThrottling: false },
  });
  quickWin.loadURL(`${SCHEME}://app/quick.html`);
  guardNavigation(quickWin);
  quickWin.on("blur", () => { if (quickWin && !quickWin.webContents.isDevToolsOpened() && !quickWin.__pinned) quickWin.hide(); });
  quickWin.on("closed", () => { quickWin = null; });
}
function toggleQuick() {
  if (!quickWin) createQuick();
  if (quickWin.isVisible()) { quickWin.hide(); return; }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w] = quickWin.getSize();
  quickWin.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + workArea.height * 0.18));
  const show = () => { quickWin.show(); quickWin.focus(); quickWin.webContents.send("quick:shown"); };
  if (quickWin.webContents.isLoading()) quickWin.webContents.once("did-finish-load", show); else show();
  if (!win) createWindow(true); // the AI engine lives in the main window (hidden is fine)
}
function registerQuick() {
  globalShortcut.unregisterAll();
  if (!quickEnabled) return true;
  try { return globalShortcut.register(quickShortcut, toggleQuick); } catch { return false; }
}
ipcMain.handle("quick:configure", (_e, { enabled }) => { quickEnabled = !!enabled; return { ok: registerQuick(), shortcut: quickShortcut }; });
ipcMain.on("quick:hide", () => quickWin && quickWin.hide());
ipcMain.on("quick:pin", (_e, on) => { if (quickWin) quickWin.__pinned = !!on; });
ipcMain.on("quick:resize", (_e, height) => {
  if (!quickWin) return;
  const [w] = quickWin.getSize();
  quickWin.setSize(w, Math.max(150, Math.min(760, Math.round(height))), true);
});
// "Continue in Assist": hand the quick conversation to the main window as a new chat
ipcMain.on("quick:continue", (_e, convo) => { if (quickWin) quickWin.hide(); showWindow(); sendMain("app:command", "import-chat", convo); });
// Quick Ask requests run on the main window's engine, through the same queue as everything else
ipcMain.on("quick:ask", (e, id, payload) => {
  const sender = e.sender;
  internalRequest(id, "quick", payload, (evt) => { if (!sender.isDestroyed()) sender.send("quick:event", id, evt); });
});
ipcMain.on("quick:cancel", (_e, id) => { const o = bridge.open.get(id); if (o) { sendMain("bridge:cancel", id); bridge.open.delete(id); } });

/* ---------- Plugin bridge ----------
   Lets Bilal's other apps (Relay and friends) use Assist. Local only:
   - listens on 127.0.0.1, never on the network
   - every request needs the random token from bridge.json in Assist's app-data folder
   - requests from web pages (anything with an Origin header) are refused
   - can be switched off in Settings → "Let my other apps use Assist"
   The AI still runs in this window's engine, so nothing leaves the computer.
   Endpoints: /v1/hello, /v1/status, /v1/draft, /v1/complete, /v1/show (Assist 1.2 API, unchanged)
              /v1/models, /v1/chat/completions (OpenAI-compatible, new in 2.0) */
const BRIDGE_PORTS = Array.from({ length: 20 }, (_, i) => 47615 + i);
const bridge = { server: null, port: 0, token: crypto.randomBytes(24).toString("hex"), enabled: true, rendererReady: false, waiters: [], open: new Map(), status: null };
const bridgeFile = () => path.join(app.getPath("userData"), "bridge.json");

function rendererReady() {
  if (bridge.rendererReady) return Promise.resolve();
  if (!win) createWindow(true);
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("Assist is still starting")), 30000); bridge.waiters.push(() => { clearTimeout(t); res(); }); });
}
function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((res, rej) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 2 * 1024 * 1024) { rej(new Error("Request too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { rej(new Error("Bad JSON")); } });
    req.on("error", rej);
  });
}

async function handleBridge(req, res) {
  if (req.headers.origin) return json(res, 403, { error: "Not available to web pages" });
  if (req.headers.authorization !== `Bearer ${bridge.token}`) return json(res, 401, { error: "Missing or wrong token" });
  const url = new URL(req.url, "http://127.0.0.1");
  const client = String(req.headers["x-assist-client"] || "another app").slice(0, 40);
  try {
    if (req.method === "GET" && url.pathname === "/v1/hello") return json(res, 200, { app: "Assist", version: app.getVersion(), bridge: 2, enabled: bridge.enabled, openai: true });
    if (req.method === "POST" && url.pathname === "/v1/show") { showWindow(); return json(res, 200, { ok: true }); }
    if (!bridge.enabled) return json(res, 403, { error: "Plugins are turned off in Assist → Settings", code: "disabled" });
    await rendererReady();
    if (req.method === "GET" && url.pathname === "/v1/status") return forward(req, res, "status", {}, false);
    if (req.method === "GET" && url.pathname === "/v1/models") return openaiModels(res);
    if (req.method === "POST" && (url.pathname === "/v1/draft" || url.pathname === "/v1/complete")) {
      const body = await readBody(req);
      return forward(req, res, url.pathname.slice(4), body, true);
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") return openaiChat(req, res, await readBody(req), client);
    json(res, 404, { error: "Unknown endpoint" });
  } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); else res.end(); }
}

// Hand the request to the window (where the AI engine lives) and stream its events back as NDJSON
function forward(req, res, kind, payload, stream) {
  const id = crypto.randomUUID();
  bridge.open.set(id, { res, stream, done: false });
  if (stream) res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  res.on("close", () => { const o = bridge.open.get(id); if (o && !o.done) sendMain("bridge:cancel", id); bridge.open.delete(id); });
  sendMain("bridge:request", { id, kind, payload: { ...payload, client: String(req.headers["x-assist-client"] || "another app").slice(0, 40) } });
}
// Same queue, but the events go to a function (Quick Ask, OpenAI-compatible endpoint)
function internalRequest(id, kind, payload, sink) {
  bridge.open.set(id, { sink, done: false });
  rendererReady().then(() => sendMain("bridge:request", { id, kind, payload }))
    .catch((e) => { sink({ type: "error", message: e.message }); bridge.open.delete(id); });
}
ipcMain.on("bridge:event", (_e, id, evt) => {
  const o = bridge.open.get(id);
  if (!o) return;
  const final = evt && (evt.type === "done" || evt.type === "error" || evt.type === "status");
  if (o.sink) { o.sink(evt); if (final) { o.done = true; bridge.open.delete(id); } return; }
  if (o.stream) { o.res.write(JSON.stringify(evt) + "\n"); if (final) { o.done = true; o.res.end(); } }
  else if (final) { o.done = true; json(o.res, evt.type === "error" ? 500 : 200, evt); }
});
ipcMain.on("bridge:ready", () => { bridge.rendererReady = true; bridge.waiters.splice(0).forEach((f) => f()); });
ipcMain.on("bridge:set-enabled", (_e, on) => { bridge.enabled = !!on; writeBridgeFile(); });
ipcMain.on("bridge:model", (_e, info) => { bridge.status = info; });

/* OpenAI-compatible: any app that speaks the OpenAI chat format can point at Assist */
function openaiModels(res) {
  const m = bridge.status || {};
  json(res, 200, { object: "list", data: [{ id: m.model || "assist", object: "model", owned_by: "assist-on-device", name: m.modelName || "Assist" }] });
}
function openaiChat(req, res, body, client) {
  const id = "chatcmpl-" + crypto.randomBytes(8).toString("hex");
  const created = Math.floor(Date.now() / 1000);
  const model = (bridge.status && bridge.status.model) || "assist";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter((m) => m.role === "system").map((m) => typeof m.content === "string" ? m.content : "").join("\n\n");
  const payload = {
    client, system: system || undefined,
    messages: messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") : "") })),
    maxTokens: body.max_tokens || body.max_completion_tokens, temperature: body.temperature,
  };
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  let open = true;
  const rid = crypto.randomUUID();
  res.on("close", () => { if (open) { sendMain("bridge:cancel", rid); bridge.open.delete(rid); } });
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(chunk({ role: "assistant", content: "" }));
    internalRequest(rid, "complete", payload, (evt) => {
      if (evt.type === "delta") res.write(chunk({ content: evt.delta }));
      else if (evt.type === "done") { open = false; res.write(chunk({}, "stop")); res.write("data: [DONE]\n\n"); res.end(); }
      else if (evt.type === "error") { open = false; res.write(`data: ${JSON.stringify({ error: { message: evt.message, code: evt.code } })}\n\n`); res.end(); }
    });
  } else {
    internalRequest(rid, "complete", payload, (evt) => {
      if (evt.type === "done") { open = false; json(res, 200, { id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content: evt.text }, finish_reason: "stop" }] }); }
      else if (evt.type === "error") { open = false; json(res, evt.code === "model_missing" ? 503 : 500, { error: { message: evt.message, code: evt.code } }); }
    });
  }
}

function writeBridgeFile() {
  if (!bridge.port) return;
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(bridgeFile(), JSON.stringify({
      app: "Assist", bridge: 2, version: app.getVersion(), port: bridge.port, token: bridge.token, pid: process.pid,
      enabled: bridge.enabled, startedAt: Date.now(), openaiBaseUrl: `http://127.0.0.1:${bridge.port}/v1`,
    }, null, 2), { mode: 0o600 });
  } catch (e) { console.error("bridge file", e); }
}
function startBridge(i = 0) {
  if (i >= BRIDGE_PORTS.length) return;
  const server = http.createServer((req, res) => { handleBridge(req, res); });
  server.once("error", () => startBridge(i + 1));
  server.listen(BRIDGE_PORTS[i], "127.0.0.1", () => { bridge.server = server; bridge.port = BRIDGE_PORTS[i]; writeBridgeFile(); });
}
function stopBridge() {
  try { const f = JSON.parse(fs.readFileSync(bridgeFile(), "utf8")); if (f.pid === process.pid) fs.unlinkSync(bridgeFile()); } catch {}
  try { bridge.server?.close(); } catch {}
}
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(false); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
app.on("before-quit", () => { app.__quitting = true; });
app.on("will-quit", () => { stopBridge(); globalShortcut.unregisterAll(); });

app.whenReady().then(() => {
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(APP_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(APP_DIR)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  buildMenu();
  createWindow();
  startBridge();
  registerQuick();

  app.on("activate", () => showWindow());
});

app.on("second-instance", (_e, argv) => {
  if (argv.includes("--background")) return; // another app just made sure Assist is running
  showWindow();
});

app.on("window-all-closed", () => { if (!isMac) app.quit(); });
