'use strict';
const { Database } = require('./dbcore');
const { ensureSchema } = require('./migrate');

/** Ouvre la connexion SQL et vérifie / complète le schéma. */
async function openDatabase(cfg) {
  const d = new Database(cfg);
  try { await d.connect(); await ensureSchema(d); return d; } catch (err) { await d.close(); throw err; }
}

/** Nettoie la configuration saisie dans l'écran de connexion SQL. previous sert au mot de passe « inchangé ». */
function cleanCfg(input, previous) {
  const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const cfg = {
    server: s(input.server, 255), instance: s(input.instance, 128), database: s(input.database, 128) || 'PaieGestion',
    port: Number(input.port) || 1433, authType: input.authType === 'windows' ? 'windows' : 'sql',
    user: s(input.user, 128), password: String(input.password || ''), domain: s(input.domain, 128),
    encrypt: input.encrypt !== false, trustServerCertificate: input.trustServerCertificate !== false,
  };
  if (!cfg.password && input.keepPassword && previous) cfg.password = previous.password || '';
  return cfg;
}

module.exports = { openDatabase, cleanCfg };
