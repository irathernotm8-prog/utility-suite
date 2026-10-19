// Small settings store (localStorage) and the chat database (IndexedDB).
export const store = {
  get(k, fallback) { try { const v = localStorage.getItem("assist:" + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem("assist:" + k, JSON.stringify(v)); } catch {} },
};

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open("assist", 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("chats")) d.createObjectStore("chats", { keyPath: "id" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction("chats", mode);
    const s = t.objectStore("chats");
    const out = fn(s);
    t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}
export const chatsDB = {
  all: () => tx("readonly", (s) => s.getAll()),
  put: (chat) => tx("readwrite", (s) => s.put(chat)),
  remove: (id) => tx("readwrite", (s) => s.delete(id)),
  clear: () => tx("readwrite", (s) => s.clear()),
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
