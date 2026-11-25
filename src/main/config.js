'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Deux modes de lancement : fenêtre Electron, ou serveur local + navigateur (quand Electron est bloqué par Windows).
let electron = null;
try { electron = require('electron'); } catch { /* lancement sans Electron */ }
const IN_ELECTRON = !!(electron && typeof electron === 'object' && electron.app && electron.safeStorage);
const { app, safeStorage } = IN_ELECTRON ? electron : {};

const FILE = IN_ELECTRON ? 'db-config.json' : 'db-config-web.json';
const userDir = () => (IN_ELECTRON ? app.getPath('userData') : path.join(process.env.APPDATA || os.homedir(), 'PaieGestion'));
const userPath = () => path.join(userDir(), FILE);
/** Fichier machine (déploiement par le service informatique) : %PROGRAMDATA%\PaieGestion\<fichier> */
const sharedPath = () => (process.env.PROGRAMDATA ? path.join(process.env.PROGRAMDATA, 'PaieGestion', FILE) : null);

const DEFAULTS = {
  server: 'localhost', port: 1433, instance: '', database: 'PaieGestion',
  authType: 'sql', user: '', password: '', domain: '',
  encrypt: true, trustServerCertificate: true,
};

// ───────────── Protection du mot de passe ─────────────
// Electron : coffre du système (safeStorage). Sans Electron : DPAPI de Windows, via PowerShell (lié à votre session Windows).
function ps(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { input, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.error || r.status !== 0) throw new Error((r.error && r.error.message) || String(r.stderr || 'PowerShell a échoué'));
  return String(r.stdout).trim();
}
function protect(plain) {
  if (IN_ELECTRON) return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : null;
  if (process.platform !== 'win32') return null;
  try {
    // transport en base64 (ASCII) : les accents et caractères spéciaux survivent à la console
    return ps('$p = [Console]::In.ReadToEnd(); ConvertTo-SecureString -String $p -AsPlainText -Force | ConvertFrom-SecureString',
      Buffer.from(plain, 'utf8').toString('base64'));
  } catch { return null; }
}
function unprotect(enc) {
  if (IN_ELECTRON) return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  const b64 = ps('$c = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString -String $c; ' +
    '[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', enc);
  return Buffer.from(b64, 'base64').toString('utf8');
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Charge la configuration (utilisateur d'abord, puis fichier machine). null si aucune. */
function loadConfig() {
  let raw = readJson(userPath());
  let source = 'user';
  if (!raw) {
    const sp = sharedPath();
    raw = sp ? readJson(sp) : null;
    source = 'shared';
  }
  if (!raw) return null;
  const cfg = { ...DEFAULTS, ...raw };
  if (raw.passwordEnc) {
    try { cfg.password = unprotect(raw.passwordEnc); } catch { cfg.password = ''; } // autre session Windows : l'utilisateur ressaisira
  }
  if (raw.passwordPlain) cfg.password = raw.passwordPlain;
  delete cfg.passwordEnc;
  delete cfg.passwordPlain;
  return { cfg, source };
}

/** Enregistre la configuration ; le mot de passe est protégé par le système si possible. */
function saveConfig(cfg) {
  const out = { ...DEFAULTS, ...cfg };
  const password = out.password || '';
  delete out.password;
  let encrypted = false;
  if (password) {
    const enc = protect(password);
    if (enc) { out.passwordEnc = enc; encrypted = true; }
    else if (IN_ELECTRON) out.passwordPlain = password; // dernier recours (poste sans coffre) — signalé dans l'interface
    // sans Electron : jamais de mot de passe en clair sur le disque, il sera redemandé au prochain lancement
  }
  fs.mkdirSync(path.dirname(userPath()), { recursive: true });
  fs.writeFileSync(userPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
  return { encrypted, persisted: !password || encrypted || IN_ELECTRON };
}

function clearConfig() {
  try { fs.unlinkSync(userPath()); } catch { /* rien */ }
}

/** Version sans mot de passe, destinée à l'affichage dans le formulaire. */
function publicView(cfg) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  c.hasPassword = !!c.password;
  delete c.password;
  return c;
}

module.exports = { loadConfig, saveConfig, clearConfig, publicView, DEFAULTS, userPath, IN_ELECTRON };
