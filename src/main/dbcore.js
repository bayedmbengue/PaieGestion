'use strict';
const sql = require('mssql');

// ───────────── Configuration de connexion (reprise d'ImmoGestion, éprouvée sur SQL Server 2022) ─────────────
function buildSqlConfig(cfg, databaseOverride) {
  if (!cfg || !cfg.server) throw new Error('Serveur SQL non renseigné.');
  const conf = {
    server: cfg.server,
    database: databaseOverride || cfg.database || 'PaieGestion',
    user: cfg.user,
    password: cfg.password,
    connectionTimeout: 15000,
    requestTimeout: 120000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 600000 },
    options: {
      encrypt: cfg.encrypt !== false,
      trustServerCertificate: cfg.trustServerCertificate !== false,
      enableArithAbort: true,
    },
  };
  // TLS 1.3 + moteur d'Electron : coupures possibles avec SQL Server 2022 → on plafonne à TLS 1.2.
  if (conf.options.encrypt) conf.options.cryptoCredentialsDetails = { maxVersion: 'TLSv1.2' };
  if (cfg.instance) conf.options.instanceName = cfg.instance;
  else conf.port = Number(cfg.port) || 1433;
  if (cfg.authType === 'windows') conf.domain = cfg.domain || undefined;
  return conf;
}

function isTransient(err) {
  const txt = String((err && err.message) || '') + ' ' + String((err && (err.code || (err.originalError && err.originalError.code))) || '');
  return /ECONNRESET|ECONNCLOSED|ECONNABORTED|EPIPE|socket hang up|Connection lost|connection is closed/i.test(txt);
}
function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1|::1|\.|\(local\))$/i.test(String(host || '').trim());
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendlyError(err) {
  const msg = String((err && err.message) || err || 'Erreur inconnue');
  const code = err && (err.code || (err.originalError && err.originalError.code));
  if (/ECONNRESET|Connection lost|socket hang up/i.test(msg)) {
    return `La connexion avec SQL Server a été coupée (${msg}). Si SQL Server est sur cet ordinateur, décochez « Chiffrer la connexion (TLS) ». Sinon, vérifiez le réseau, le pare-feu ou l'antivirus.`;
  }
  if (code === 'ESOCKET' || /ECONNREFUSED|getaddrinfo|ENOTFOUND/i.test(msg)) {
    return `Serveur injoignable (${msg}). Vérifiez le nom/l'adresse, le port, que le service SQL Server est démarré et que le protocole TCP/IP est activé.`;
  }
  if (code === 'ETIMEOUT' || /timeout/i.test(msg)) {
    return `Délai dépassé (${msg}). Le serveur ne répond pas : vérifiez le réseau, le pare-feu (port 1433) ou le nom d'instance.`;
  }
  if (/Cannot open database/i.test(msg)) return `La base de données n'existe pas ou ce compte n'y a pas accès. (${msg})`;
  if (/Login failed/i.test(msg) || code === 'ELOGIN') {
    return `Connexion refusée : identifiant ou mot de passe incorrect, ou authentification SQL non activée sur le serveur. (${msg})`;
  }
  if (/self.signed|certificate/i.test(msg)) {
    return `Certificat du serveur non approuvé. Cochez « Faire confiance au certificat du serveur ». (${msg})`;
  }
  return msg;
}

/** Dates SQL → chaînes ISO (AAAA-MM-JJ si minuit UTC) : plus simples à manipuler côté interface. */
function fixRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      const iso = v.toISOString();
      out[k] = iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
    } else out[k] = v;
  }
  return out;
}

function bind(request, params) {
  for (const [k, v] of Object.entries(params || {})) request.input(k, v === undefined ? null : v);
  return request;
}

class Database {
  constructor(cfg) { this.cfg = cfg; this.pool = null; }

  static async _open(cfg) {
    const pool = new sql.ConnectionPool(buildSqlConfig(cfg));
    pool.on('error', (e) => console.error('[sql] erreur de pool :', e.message));
    try { await pool.connect(); } catch (err) { await pool.close().catch(() => {}); throw err; }
    return pool;
  }

  async connect() {
    try {
      this.pool = await Database._open(this.cfg);
    } catch (err) {
      if (isTransient(err) && isLocalHost(this.cfg.server) && this.cfg.encrypt !== false) {
        this.cfg = { ...this.cfg, encrypt: false };
        try { this.pool = await Database._open(this.cfg); return; } catch (e2) { throw new Error(friendlyError(e2)); }
      }
      throw new Error(friendlyError(err));
    }
  }

  static async test(cfg) {
    let pool;
    try {
      try { pool = await Database._open(cfg); }
      catch (e) {
        if (!(isTransient(e) && isLocalHost(cfg.server) && cfg.encrypt !== false)) throw e;
        pool = await Database._open({ ...cfg, encrypt: false });
      }
      const v = await pool.request().query('SELECT @@VERSION AS v');
      const s = await pool.request().query("SELECT OBJECT_ID(N'paie.Employe', N'U') AS id");
      return { ok: true, state: s.recordset[0].id ? 'ready' : 'no-schema', version: String(v.recordset[0].v).split('\n')[0] };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    } finally {
      if (pool) await pool.close().catch(() => {});
    }
  }

  async _withRetry(fn) {
    let last;
    for (let i = 1; i <= 3; i++) {
      try { return await fn(); } catch (err) {
        last = err;
        if (!isTransient(err)) throw err;
        if (i === 3) break;
        await sleep(400 * i);
        try { if (this.pool) await this.pool.close(); } catch (_) { /* déjà fermée */ }
        await this.connect();
      }
    }
    throw last;
  }

  /** Requête SELECT/INSERT… avec paramètres nommés ; retourne les lignes (dates en chaînes ISO). */
  query(text, params) {
    return this._withRetry(async () => {
      const r = await bind(this.pool.request(), params).query(text);
      return (r.recordset || []).map(fixRow);
    });
  }

  /** Script de plusieurs instructions (DDL). */
  batch(text) { return this._withRetry(() => this.pool.request().batch(text)); }

  /** Transaction : fn reçoit run(text, params) ; tout est annulé si fn lève une erreur. */
  async tx(fn) {
    const t = new sql.Transaction(this.pool);
    await t.begin();
    try {
      const run = async (text, params) => {
        const r = await bind(new sql.Request(t), params).query(text);
        return (r.recordset || []).map(fixRow);
      };
      const out = await fn(run);
      await t.commit();
      return out;
    } catch (err) {
      await t.rollback().catch(() => {});
      throw err;
    }
  }

  async close() { if (this.pool) await this.pool.close().catch(() => {}); this.pool = null; }
}

module.exports = { Database, buildSqlConfig, friendlyError, isTransient, isLocalHost };
