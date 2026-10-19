'use strict';
// Inside Electron, the normal `fs` module treats .asar archives as folders, which breaks
// copying, moving and deleting installed apps (every app contains resources/app.asar).
// `original-fs` is Node's untouched fs; outside Electron (tests) it doesn't exist.
let fs;
try { fs = require('original-fs'); } catch { fs = require('fs'); }
module.exports = fs;
