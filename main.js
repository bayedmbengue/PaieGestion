'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./src/main/config');
const { Database, friendlyError } = require('./src/main/dbcore');
const { openDatabase, cleanCfg } = require('./src/main/session');
const { registerApi, makeNeed } = require('./src/main/api');

let win = null;
let db = null;
let currentUser = null;          // { id, login, nom, role } — session en mémoire du processus principal
let setupState = { cfg: null, error: null };

app.setAppUserModelId('sn.paiegestion.desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const isAppFrame = (e) => win && !win.isDestroyed() && e.sender === win.webContents;

// ───────────────────────── Fenêtre ─────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1100, minHeight: 680, title: 'PaieGestion', backgroundColor: '#F0F5FA', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.on('closed', () => { win = null; });
}
const showSetup = (cfg, error) => { setupState = { cfg, error: error || null }; currentUser = null; win.loadFile(path.join(__dirname, 'renderer', 'setup.html')); };
const showApp = () => win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

async function start() {
  const loaded = config.loadConfig();
  if (!loaded) return showSetup(null, null);
  try { db = await openDatabase(loaded.cfg); showApp(); } catch (err) { showSetup(loaded.cfg, err.message); }
}

// ───────────────────────── Droits et canaux ─────────────────────────
const need = makeNeed(() => currentUser);
/** Enregistre un canal IPC : vérifie l'origine, la base, la session et le droit requis ; renvoie {ok,data|error}. */
function handle(channel, perm, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      if (!isAppFrame(e) || !db) throw new Error('Base de données non connectée.');
      if (perm) need(perm);
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      if (!/Droits insuffisants|Session expirée/.test(err.message)) console.error(`[${channel}]`, err.message);
      return { ok: false, error: friendlyError(err) };
    }
  });
}

async function saveFileDialog(defaultName, filters, content) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
  if (r.canceled || !r.filePath) return { saved: false };
  fs.writeFileSync(r.filePath, content);
  shell.showItemInFolder(r.filePath);
  return { saved: true, path: r.filePath };
}

async function htmlToPdf(html) {
  const tmp = path.join(os.tmpdir(), `paiegestion-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    return await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    w.destroy();
    fs.unlink(tmp, () => {});
  }
}

registerApi(handle, {
  db: () => db, user: () => currentUser, setUser: (u) => { currentUser = u; }, need, version: app.getVersion(),
  saveFile: saveFileDialog,
  deliverPdf: async (html, name) => saveFileDialog(name, [{ name: 'PDF', extensions: ['pdf'] }], await htmlToPdf(html)),
});

ipcMain.handle('app:openSetup', async (e) => {
  if (!isAppFrame(e)) return;
  if (currentUser && currentUser.role !== 'ADMIN') return { ok: false, error: 'Réservé aux administrateurs.' };
  openSetupScreen();
  return { ok: true };
});

// ───────────────────────── Écran de configuration SQL ─────────────────────────
const setupAllowed = (e) => isAppFrame(e) && (!currentUser || currentUser.role === 'ADMIN');
ipcMain.handle('setup:state', (e) => (isAppFrame(e) ? { config: config.publicView(setupState.cfg), error: setupState.error } : null));
ipcMain.handle('setup:test', async (e, input) => (setupAllowed(e) ? Database.test(cleanCfg(input || {}, setupState.cfg)) : { ok: false, error: 'Appel non autorisé.' }));
ipcMain.handle('setup:save', async (e, input) => {
  if (!setupAllowed(e)) return { ok: false, error: 'Appel non autorisé.' };
  const cfg = cleanCfg(input || {}, setupState.cfg);
  let d;
  try { d = await openDatabase(cfg); } catch (err) { return { ok: false, error: err.message }; }
  if (db) await db.close();
  db = d; currentUser = null;
  const { encrypted } = config.saveConfig(cfg);
  showApp();
  return { ok: true, encrypted };
});
async function openSetupScreen() {
  const loaded = config.loadConfig();
  if (db) { await db.close(); db = null; }
  if (win) showSetup(loaded && loaded.cfg, null);
}

// ───────────────────────── Menu et cycle de vie ─────────────────────────
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      { label: 'Recharger', accelerator: 'F5', click: () => win && win.webContents.reload() },
      { label: 'Configuration SQL Server…', click: () => { if (!currentUser || currentUser.role === 'ADMIN') openSetupScreen(); } },
      { type: 'separator' }, { role: 'quit', label: 'Quitter' } ] },
    { label: 'Édition', submenu: [
      { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' },
      { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' } ] },
    { label: 'Affichage', submenu: [
      { role: 'zoomIn', label: 'Agrandir' }, { role: 'zoomOut', label: 'Réduire' }, { role: 'resetZoom', label: 'Taille normale' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Plein écran' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Outils de développement' }]) ] },
  ]));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  buildMenu();
  createWindow();
  start();
});
app.on('window-all-closed', async () => { if (db) await db.close(); app.quit(); });
