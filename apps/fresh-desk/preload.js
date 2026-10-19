const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desk', Object.fromEntries(['choose','scan','apply','undo','trash','profiles','saveProfiles','revise','assistStatus','aiPreview','aiRun','acceptAI'].map(name => [name, arg => ipcRenderer.invoke(name,arg)])));

contextBridge.exposeInMainWorld('scanEvents',{cancel:()=>ipcRenderer.send('cancel-scan'),onProgress:fn=>{ipcRenderer.on('scan-progress',(_,value)=>fn(value));}});
