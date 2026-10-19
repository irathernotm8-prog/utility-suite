// Runs inside every account page (and its sign-in popups) before the page's own scripts.
// Asks the main process which browser identity this page should present, then applies it.
const { ipcRenderer, webFrame } = require('electron');

try {
  const patch = ipcRenderer.sendSync('kiln:navigator-patch', location.href);
  if (patch) webFrame.executeJavaScript(patch);
} catch (e) { /* never break the page */ }
