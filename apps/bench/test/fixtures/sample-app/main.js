// A small app Bench's tests drive: a to-do list with a bug (Throw), an Open dialog, a menu shortcut and a message box.
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
let win;
app.whenReady().then(() => {
  console.log('sample main ready', app.getPath('userData'));
  win = new BrowserWindow({ width: 760, height: 560, show: false, title: 'Sample', webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('saved') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFile() },
      { type: 'separator' }, { role: 'quit' } ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
});
async function openFile() {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a file', properties: ['openFile'] });
  win.webContents.send('opened', r.canceled ? 'cancelled' : r.filePaths[0]);
}
ipcMain.handle('open', () => openFile());
ipcMain.handle('ask', async () => (await dialog.showMessageBox(win, { message: 'Delete everything?', buttons: ['Delete', 'Cancel'], cancelId: 1 })).response);
ipcMain.handle('boom', () => { setTimeout(() => { throw new Error('main process boom'); }, 1); });
app.on('window-all-closed', () => app.quit());
