// Runs inside every page before the page's own scripts: presents an ordinary browser identity
// (Google and Microsoft refuse sign-in inside "embedded" browsers). Nothing else is exposed to pages.
const { ipcRenderer, webFrame } = require('electron');

try {
  const patch = ipcRenderer.sendSync('glean:navigator-patch', location.href);
  if (patch) webFrame.executeJavaScript(patch);
} catch (e) { /* never break the page */ }
