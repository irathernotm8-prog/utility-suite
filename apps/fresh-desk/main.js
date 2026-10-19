const {app, BrowserWindow, ipcMain, dialog, nativeImage, shell} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('./lib/organizer');
const settings=require('./lib/settings');
const ai=require('./lib/ai');
const crypto=require('node:crypto');
let win, root, plan, busy = false, cancelScan=false, aiRequest=null, aiProposals=[];
const journalPath = () => path.join(app.getPath('userData'), 'history.json');
async function history() { try { return JSON.parse(await fs.readFile(journalPath(), 'utf8')); } catch(e) { if(e.code === 'ENOENT') return []; throw e; } }
async function persist(data) { const p = journalPath(); await fs.writeFile(p+'.tmp', JSON.stringify(data)); await fs.rename(p+'.tmp', p); }
const locked = fn => async (_, ...args) => { if(busy) throw Error('Another operation is running.'); busy=true; try {return await fn(...args);} finally {busy=false;} };
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname,'build/icon.png'));
  win = new BrowserWindow({icon:path.join(__dirname,'build/icon.png'), width: 1280, height: 900, minWidth: 900, minHeight: 700, backgroundColor:'#f6f7f9', webPreferences:{preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true}});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile('renderer/index.html');
});
app.on('window-all-closed', () => app.quit());
ipcMain.handle('choose', locked(async () => {const result = await dialog.showOpenDialog(win,{properties:['openDirectory']}); if(!result.canceled) {root=result.filePaths[0]; plan=null; return root;} return null;}));
ipcMain.handle('scan', locked(async options => {
  if(!root) throw Error('Choose a folder first.');
  plan=null;aiRequest=null;aiProposals=[];cancelScan=false;
  const saved=await settings.load(app.getPath('userData'));
  const profile=saved.profiles.find(p=>p.id===options.profile);
  plan = await core.scan(root, {...options,rules:profile?.rules||[]}, async p => nativeImage.createFromPath(p).getSize(), status=>win.webContents.send('scan-progress',status),()=>cancelScan); return plan;
}));
ipcMain.handle('apply', locked(async ids => {
  if(!plan) throw Error('Scan first.');
  const results = await core.apply(plan, ids, await history(), persist); plan=null; return results;
}));
ipcMain.handle('undo', locked(async () => core.undo(await history(), persist)));
ipcMain.handle('trash', locked(async ids => {
  if(!plan) throw Error('Scan first.');
  const rows = plan.rows.filter(r => ids.includes(r.id) && r.old && !r.keep);
  if(!rows.length) throw Error('Select older files first.');
  const answer = await dialog.showMessageBox(win,{type:'warning', buttons:['Cancel','Move to Trash'], defaultId:0, cancelId:0, message:`Move ${rows.length} selected older files to Trash?`, detail:'Age is based on last modification, not actual usage. Restore trashed files through your operating system.'});
  if(answer.response !== 1) return [];
  const results=[];
  for(const row of rows) {try {await core.validate(row.from,row.fingerprint); await shell.trashItem(row.from); results.push({name:row.name,ok:true});} catch(e) {results.push({name:row.name,ok:false,error:e.message});}}
  plan=null; return results;
}));

ipcMain.on('cancel-scan',()=>{cancelScan=true;});
ipcMain.handle('profiles',locked(async()=>settings.load(app.getPath('userData'))));
ipcMain.handle('saveProfiles',locked(async value=>{const result=await settings.save(app.getPath('userData'),value);plan=null;aiRequest=null;aiProposals=[];return result;}));
ipcMain.handle('revise',locked(async changes=>{
  if(!plan)throw Error('Scan first.');
  if(!Array.isArray(changes)||changes.length>1000)throw Error('Invalid corrections.');
  const updated=await core.revise(plan,changes);aiRequest=null;aiProposals=[];return updated;
}));
ipcMain.handle('assistStatus',locked(async()=>ai.assistStatus(app.getPath('appData'))));
ipcMain.handle('aiPreview',locked(async input=>{
  if(!plan)throw Error('Scan first.');
  const payload=ai.prepare(plan,input.ids,input.goal,!!input.includeContent);
  aiRequest={ticket:crypto.randomUUID(),payload,expires:Date.now()+10*60*1000};aiProposals=[];
  return {ticket:aiRequest.ticket,payload};
}));
ipcMain.handle('aiRun',locked(async input=>{
  if(!plan||!aiRequest||input.ticket!==aiRequest.ticket||Date.now()>aiRequest.expires)throw Error('AI preview expired. Review the request again.');
  const payload=aiRequest.payload;aiRequest=null;
  aiProposals=await ai.complete(input.provider,input.config||{},payload,app.getPath('appData'));
  return aiProposals.map(p=>({...p,name:plan.rows.find(r=>r.id===p.id)?.name}));
}));
ipcMain.handle('acceptAI',locked(async ids=>{
  if(!plan)throw Error('Scan again.');
  const proposals=aiProposals.filter(p=>ids.includes(p.proposalId));
  if(!proposals.length)throw Error('Select a suggestion first.');
  await core.revise(plan,proposals);
  for(const p of proposals){const row=plan.rows.find(r=>r.id===p.id);row.source='ai';row.confidence='review';row.reason=`AI suggestion (${Math.round(p.confidence*100)}% self-rated): ${p.reason}`;}
  aiProposals=[];return plan;
}));
