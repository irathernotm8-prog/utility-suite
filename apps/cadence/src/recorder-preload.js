// Cadence — preload for the Browser step's Record window: installs the recorder and forwards each action.
'use strict';
const { ipcRenderer } = require('electron');
require('./recorder-core').install((a) => ipcRenderer.send('cadence-rec', a), 'close this window when you’re done');
