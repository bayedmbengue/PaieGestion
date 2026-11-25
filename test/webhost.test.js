'use strict';
// Serveur local (lancement sans Electron) : sécurité, fichiers, canaux, exports. Base SQL simulée.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createWebHost } = require('../src/web/webhost');

function fakeDb() {
  return {
    cfg: { server: 'x', port: 1433, database: 'PaieGestion' },
    query: async (sql) => {
      if (/COUNT\(\*\) AS n FROM paie\.Utilisateur/.test(sql)) return [{ n: 0 }];
      if (/SELECT Annee, Mois FROM paie\.PeriodePaie/.test(sql)) return [{ Annee: 2026, Mois: 11 }];
      if (/FROM paie\.BulletinPaie b JOIN paie\.Employe e/.test(sql)) return [{ Matricule: 'M1', Nom: 'DIOP', Prenom: 'Awa', Brut: 300000, TotalCotisSalariales: 1, ImpotRevenu: 2, TRIMF: 3, AutresRetenues: 4, Net: 5, TotalCotisPatronales: 6, CoutEmployeur: 7 }];
      return [];
    },
    close: async () => {},
  };
}
const fakeConfig = { loadConfig: () => ({ cfg: { server: 'x', database: 'PaieGestion' } }), saveConfig: () => ({ encrypted: true }), publicView: (c) => ({ ...c, hasPassword: false }) };

async function demarrer(opts = {}) {
  const host = createWebHost({ config: fakeConfig, Database: { test: async () => ({ ok: true, state: 'ready' }) }, openDatabase: async () => fakeDb(),
    cleanCfg: (i) => i, ...opts });
  await host.init();
  const port = await host.listen();
  return { host, port };
}

/** Requête HTTP brute (permet de forcer l'en-tête Host et le chemin exact). */
function req(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const cookie = (host) => `paie=${host.token}`;
const appel = (port, host, channel, args = [], extra = {}) => req(port, { method: 'POST', path: '/api/call', headers: { 'Content-Type': 'application/json', Cookie: cookie(host), ...extra }, body: JSON.stringify({ channel, args }) });

test('sans cookie : tout est refusé (page, fichiers et canaux)', async () => {
  const { host, port } = await demarrer();
  try {
    assert.equal((await req(port, { path: '/' })).status, 403);
    assert.equal((await req(port, { path: '/index.html' })).status, 403);
    assert.equal((await req(port, { path: '/app.js' })).status, 403);
    assert.equal((await req(port, { method: 'POST', path: '/api/call', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { await host.close(); }
});

test('amorçage : le jeton pose un cookie HttpOnly / SameSite=Strict, un mauvais jeton est refusé', async () => {
  const { host, port } = await demarrer();
  try {
    assert.equal((await req(port, { path: '/?k=mauvais' })).status, 403);
    const r = await req(port, { path: `/?k=${host.token}` });
    assert.equal(r.status, 302);
    assert.match(r.headers['set-cookie'][0], /paie=[0-9a-f]+; HttpOnly; SameSite=Strict/);
    const home = await req(port, { path: '/', headers: { Cookie: cookie(host) } });
    assert.equal(home.status, 302);
    assert.equal(home.headers.location, '/index.html');          // base connectée → application
    const page = await req(port, { path: '/index.html', headers: { Cookie: cookie(host) } });
    assert.equal(page.status, 200);
    assert.match(page.text, /web-shim\.js/);
    const js = await req(port, { path: '/app.js', headers: { Cookie: cookie(host) } });
    assert.match(js.headers['content-type'], /javascript/);
  } finally { await host.close(); }
});

test('hôte inattendu (DNS rebinding) et origine étrangère : refusés', async () => {
  const { host, port } = await demarrer();
  try {
    assert.equal((await req(port, { path: '/index.html', headers: { Host: 'pirate.example', Cookie: cookie(host) } })).status, 403);
    assert.equal((await appel(port, host, 'auth:status', [], { Origin: 'http://pirate.example' })).status, 403);
    assert.equal((await appel(port, host, 'auth:status', [], { Origin: `http://127.0.0.1:${port}` })).status, 200);
  } finally { await host.close(); }
});

test('impossible de sortir du dossier renderer', async () => {
  const { host, port } = await demarrer();
  try {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fsrc%2fmain%2fconfig.js', '/%2e%2e%2f%2e%2e%2fpackage.json', '/vendor/../../package.json']) {
      const r = await req(port, { path: p, headers: { Cookie: cookie(host) } });
      assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
      assert.doesNotMatch(r.text, /paiegestion-desktop|mssql/);
    }
    assert.equal((await req(port, { path: '/main.js', headers: { Cookie: cookie(host) } })).status, 404);   // hors renderer
  } finally { await host.close(); }
});

test('canaux : état, droits requis, canal inconnu', async () => {
  const { host, port } = await demarrer();
  try {
    const st = JSON.parse((await appel(port, host, 'auth:status')).text);
    assert.deepEqual(st, { ok: true, data: { needsAdmin: true, user: null } });
    const emp = JSON.parse((await appel(port, host, 'emp:list')).text);
    assert.equal(emp.ok, false);
    assert.match(emp.error, /Session expirée/);                               // pas connecté → refusé
    assert.match(JSON.parse((await appel(port, host, 'inexistant')).text).error, /Canal inconnu/);
    host.setUserForTests({ id: 1, login: 'lect', nom: 'Lecteur', role: 'LECTEUR' });
    assert.equal(JSON.parse((await appel(port, host, 'emp:list')).text).ok, true);        // lecture autorisée
    assert.match(JSON.parse((await appel(port, host, 'users:list')).text).error, /Droits insuffisants/);   // admin requis
    assert.match(JSON.parse((await appel(port, host, 'paie:csv', [1])).text).error, /Droits insuffisants/); // export requis
  } finally { await host.close(); }
});

test('export CSV : fichier livré au navigateur (base64, BOM, séparateur point-virgule)', async () => {
  const { host, port } = await demarrer();
  try {
    host.setUserForTests({ id: 1, login: 'compta', nom: 'Comptable', role: 'COMPTABLE' });
    const r = JSON.parse((await appel(port, host, 'paie:csv', [5])).text);
    assert.equal(r.ok, true);
    assert.equal(r.data.saved, true);
    assert.equal(r.data.download.name, 'Journal_paie_2026-11.csv');
    const txt = Buffer.from(r.data.download.base64, 'base64').toString('utf8');
    assert.ok(txt.startsWith('\uFEFF"Matricule";"Nom"'));
    assert.match(txt, /"M1";"DIOP";"Awa";"300000"/);
  } finally { await host.close(); }
});

test('sans base configurée : redirection vers l\'écran de connexion SQL', async () => {
  const { host, port } = await demarrer({ config: { ...fakeConfig, loadConfig: () => null } });
  try {
    const home = await req(port, { path: '/', headers: { Cookie: cookie(host) } });
    assert.equal(home.headers.location, '/setup.html');
    assert.equal((await req(port, { path: '/index.html', headers: { Cookie: cookie(host) } })).headers.location, '/setup.html');
    assert.equal((await req(port, { path: '/setup.html', headers: { Cookie: cookie(host) } })).status, 200);
    const sauve = await req(port, { method: 'POST', path: '/api/setup/save', headers: { 'Content-Type': 'application/json', Cookie: cookie(host) }, body: JSON.stringify({ server: 'localhost' }) });
    assert.equal(JSON.parse(sauve.text).ok, true);
    assert.equal((await req(port, { path: '/', headers: { Cookie: cookie(host) } })).headers.location, '/index.html');
  } finally { await host.close(); }
});

test('arrêt automatique quand la fenêtre est fermée (plus de signal de vie)', async () => {
  let arrete = false;
  const { host, port } = await demarrer({ onIdle: () => { arrete = true; }, idleMs: 150, checkMs: 40 });
  try {
    await req(port, { method: 'POST', path: '/api/ping', headers: { Cookie: cookie(host) } });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(arrete, false);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(arrete, true);
  } finally { await host.close(); }
});
