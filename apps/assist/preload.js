const { contextBridge, ipcRenderer } = require("electron");

// What the interface can ask the desktop app for. Nothing else from Node is exposed.
contextBridge.exposeInMainWorld("assistDesktop", {
  platform: process.platform,
  info: () => ipcRenderer.invoke("sys:info"),
  web: {
    search: (query, opts) => ipcRenderer.invoke("web:search", query, opts),
    fetch: (url) => ipcRenderer.invoke("web:fetch", url),
  },
  saveFile: (name, content) => ipcRenderer.invoke("file:save", { name, content }),
  clipboard: {
    read: () => ipcRenderer.invoke("clipboard:read"),
    write: (text) => ipcRenderer.send("clipboard:write", text),
  },
  onCommand: (cb) => ipcRenderer.on("app:command", (_e, cmd, arg) => cb(cmd, arg)),
  // Plugin bridge: requests from other apps (Relay) and Quick Ask arrive here and stream back
  bridge: {
    onRequest: (cb) => ipcRenderer.on("bridge:request", (_e, req) => cb(req)),
    onCancel: (cb) => ipcRenderer.on("bridge:cancel", (_e, id) => cb(id)),
    reply: (id, evt) => ipcRenderer.send("bridge:event", id, evt),
    ready: () => ipcRenderer.send("bridge:ready"),
    setEnabled: (on) => ipcRenderer.send("bridge:set-enabled", !!on),
    setModel: (info) => ipcRenderer.send("bridge:model", info),
  },
  quick: {
    configure: (opts) => ipcRenderer.invoke("quick:configure", opts),
    ask: (id, payload) => ipcRenderer.send("quick:ask", id, payload),
    cancel: (id) => ipcRenderer.send("quick:cancel", id),
    onEvent: (cb) => ipcRenderer.on("quick:event", (_e, id, evt) => cb(id, evt)),
    onShown: (cb) => ipcRenderer.on("quick:shown", () => cb()),
    hide: () => ipcRenderer.send("quick:hide"),
    pin: (on) => ipcRenderer.send("quick:pin", !!on),
    resize: (h) => ipcRenderer.send("quick:resize", h),
    continueInAssist: (convo) => ipcRenderer.send("quick:continue", convo),
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("is-desktop", "os-" + process.platform);
});
