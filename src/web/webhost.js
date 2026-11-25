'use strict';
/**
 * Hôte « navigateur » : sert l'interface et les canaux de l'application depuis un petit serveur local.
 * Sécurité : écoute uniquement sur 127.0.0.1 ; jeton aléatoire par lancement (cookie HttpOnly SameSite=Strict) ;
 * contrôle de l'hôte et de l'origine (anti « DNS rebinding » / requêtes d'autres sites) ; fichiers limités au dossier renderer.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { friendlyError } = require('../main/dbcore');
const { registerApi, makeNeed } = require('../main/api');

const RENDERER = path.join(__dirname, '..', '..', 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function createWebHost({ config, Database, openDatabase, cleanCfg, version = '1.0.0', token = crypto.randomBytes(24).toString('hex'),
  onIdle = () => {}, idleMs = 20000, firstPingMs = 120000, checkMs = 2000 }) {
  let db = null;
  let currentUser = null;
  let setupState = { cfg: null, error: null };
  let port = 0;
  let server = null;
  let timer = null;
  const started = Date.now();
  let lastPing = 0;

  const handlers = new Map();
  const handle = (channel, perm, fn) => handlers.set(channel, { perm, fn });
  const need = makeNeed(() => currentUser);
  registerApi(handle, {
    db: () => db, user: () => currentUser, setUser: (u) => { currentUser = u; }, need, version,
    // Fichiers : téléchargés par le navigateur
    saveFile: async (name, _filters, content) => ({
      saved: true,
      download: { name, mime: name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/octet-stream', base64: Buffer.from(content).toString('base64') },
    }),
    // PDF : le navigateur imprime le HTML (« Enregistrer au format PDF »)
    deliverPdf: async (html, name) => ({ saved: false, printHtml: html, name }),
  });

  async function call(channel, args) {
    const h = handlers.get(channel);
    if (!h) return { ok: false, error: `Canal inconnu : ${channel}` };
    try {
      if (!db) throw new Error('Base de données non connectée.');
      if (h.perm) need(h.perm);
      return { ok: true, data: await h.fn(...(Array.isArray(args) ? args : [])) };
    } catch (err) {
      if (!/Droits insuffisants|Session expirée/.test(err.message)) console.error(`[${channel}]`, err.message);
      return { ok: false, error: friendlyError(err) };
    }
  }

  async function init() {
    const loaded = config.loadConfig();
    if (!loaded) { setupState = { cfg: null, error: null }; return; }
    try { db = await openDatabase(loaded.cfg); setupState = { cfg: loaded.cfg, error: null }; }
    catch (err) { setupState = { cfg: loaded.cfg, error: err.message }; }
  }

  const setupAllowed = () => !currentUser || currentUser.role === 'ADMIN';

  async function setupCall(name, input) {
    if (name === 'state') return { config: config.publicView(setupState.cfg), error: setupState.error };
    if (!setupAllowed()) return { ok: false, error: 'Appel non autorisé.' };
    if (name === 'test') return Database.test(cleanCfg(input || {}, setupState.cfg));
    if (name === 'save') {
      const cfg = cleanCfg(input || {}, setupState.cfg);
      let d;
      try { d = await openDatabase(cfg); } catch (err) { return { ok: false, error: err.message }; }
      if (db) await db.close();
      db = d; currentUser = null; setupState = { cfg, error: null };
      const r = config.saveConfig(cfg);
      return { ok: true, encrypted: r.encrypted, persisted: r.persisted };
    }
    if (name === 'open') {
      const loaded = config.loadConfig();
      if (db) { await db.close(); db = null; }
      currentUser = null; setupState = { cfg: (loaded && loaded.cfg) || setupState.cfg, error: null };
      return { ok: true };
    }
    return { ok: false, error: 'Appel inconnu.' };
  }

  // ───────────── HTTP ─────────────
  const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const hostOk = (req) => { const h = String(req.headers.host || ''); return h === `127.0.0.1:${port}` || h === `localhost:${port}`; };
  const authed = (req) => {
    const m = /(?:^|;\s*)paie=([0-9a-f]+)/.exec(String(req.headers.cookie || ''));
    return !!m && safeEq(m[1], token);
  };
  const originOk = (req) => { const o = req.headers.origin; return !o || o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`; };
  const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(body);
  };
  const json = (res, obj) => send(res, 200, JSON.stringify(obj), 'application/json; charset=utf-8');
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 5 * 1024 * 1024) { reject(new Error('Requête trop volumineuse.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('JSON invalide.')); } });
    req.on('error', reject);
  });
  const redirect = (res, to, extra = {}) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...extra }); res.end(); };

  async function api(req, res, pathname) {
    if (!originOk(req)) return send(res, 403, 'Origine non autorisée');
    if (!/^application\/json/i.test(String(req.headers['content-type'] || '')) && pathname !== '/api/ping') return send(res, 415, 'JSON attendu');
    if (pathname === '/api/ping') { lastPing = Date.now(); return json(res, { ok: true }); }
    const body = await readBody(req);
    if (pathname === '/api/call') return json(res, await call(String(body.channel || ''), body.args));
    if (pathname.startsWith('/api/setup/')) return json(res, await setupCall(pathname.slice('/api/setup/'.length), body));
    if (pathname === '/api/openSetup') {
      if (!setupAllowed()) return json(res, { ok: false, error: 'Réservé aux administrateurs.' });
      return json(res, await setupCall('open'));
    }
    return send(res, 404, 'Introuvable');
  }

  function serveStatic(res, pathname) {
    if (pathname === '/') return redirect(res, db ? '/index.html' : '/setup.html');
    if (pathname === '/index.html' && !db) return redirect(res, '/setup.html');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Requête invalide'); }
    if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) return send(res, 403, 'Accès refusé');
    const file = path.join(RENDERER, rel);
    if (!file.startsWith(RENDERER + path.sep)) return send(res, 403, 'Accès refusé');
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return send(res, 404, 'Introuvable');
    fs.readFile(file, (err, data) => (err ? send(res, 404, 'Introuvable') : send(res, 200, data, type)));
  }

  async function onRequest(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      if (!hostOk(req)) return send(res, 403, 'Hôte non autorisé');
      const k = url.searchParams.get('k');
      if (k !== null) {   // amorçage : le lanceur ouvre /?k=JETON, qui pose le cookie puis redirige
        if (!safeEq(k, token)) return send(res, 403, 'Jeton invalide');
        return redirect(res, '/', { 'Set-Cookie': `paie=${token}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (!authed(req)) return send(res, 403, "Accès refusé : ouvrez PaieGestion avec son raccourci.");
      if (req.method === 'POST') return await api(req, res, url.pathname);
      if (req.method === 'GET') return serveStatic(res, url.pathname);
      return send(res, 405, 'Méthode non autorisée');
    } catch (err) {
      console.error('[http]', err.message);
      if (!res.headersSent) send(res, 500, 'Erreur interne');
    }
  }

  function listen() {
    return new Promise((resolve, reject) => {
      server = http.createServer(onRequest);
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        // Arrêt automatique quand la fenêtre est fermée (plus de signal de vie)
        timer = setInterval(() => {
          const now = Date.now();
          if ((lastPing && now - lastPing > idleMs) || (!lastPing && now - started > firstPingMs)) onIdle();
        }, checkMs);
        if (timer.unref) timer.unref();
        resolve(port);
      });
    });
  }

  async function close() {
    if (timer) clearInterval(timer);
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
    db = null;
  }

  return { init, listen, close, token, get port() { return port; }, setUserForTests: (u) => { currentUser = u; }, handlers };
}

module.exports = { createWebHost };
