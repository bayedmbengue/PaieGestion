'use strict';
/**
 * Lancement sans Electron : démarre un serveur local et ouvre PaieGestion dans une fenêtre Edge/Chrome
 * (mode « application », sans barre d'adresse). À utiliser quand Windows bloque electron.exe.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./src/main/config');
const { Database } = require('./src/main/dbcore');
const { openDatabase, cleanCfg } = require('./src/main/session');
const { createWebHost } = require('./src/web/webhost');
const pkg = require('./package.json');

let host = null;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  try { if (host) await host.close(); } catch { /* arrêt */ }
  process.exit(code);
}

function findBrowser() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    ...bases.map((b) => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ...bases.map((b) => path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function openBrowser(url) {
  const exe = findBrowser();
  if (exe) {
    const profile = path.join(process.env.APPDATA || process.cwd(), 'PaieGestion', 'navigateur');
    spawn(exe, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1360,860', '--no-first-run', '--no-default-browser-check'],
      { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (process.platform === 'win32') { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); return true; }
  return false;
}

(async () => {
  host = createWebHost({ config, Database, openDatabase, cleanCfg, version: pkg.version, onIdle: () => shutdown(0) });
  await host.init();
  const port = await host.listen();
  const url = `http://127.0.0.1:${port}/?k=${host.token}`;
  console.log('PaieGestion démarre… (ne fermez pas cette fenêtre tant que vous travaillez)');
  if (!openBrowser(url)) console.log('Aucun navigateur trouvé. Ouvrez cette adresse dans Edge ou Chrome :\n' + url);
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
})().catch((err) => { console.error('Erreur au démarrage :', err.message); process.exit(1); });
