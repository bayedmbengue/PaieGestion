'use strict';
/**
 * Canaux de l'application (données, calculs, exports), partagés par les deux modes de lancement :
 *  - fenêtre Electron (main.js) ;
 *  - serveur local + navigateur (server.js), utile quand Electron est bloqué par la stratégie de sécurité de Windows.
 * L'hôte fournit handle(canal, droit, fonction) et l'environnement E (base, utilisateur, enregistrement de fichiers…).
 */
const repo = require('./repo');
const { verifyPassword, hashPassword, Throttle } = require('./auth');
const { calcParts } = require('./parts');
const conges = require('./conges');
const { bulletinsDocument } = require('./bulletin');
const rapportsRepo = require('./rapportsRepo');
const { reportToCsv, reportToHtml } = require('./rapports');

const PERMS = {
  ADMIN: ['read', 'write', 'paie', 'export', 'admin'],
  GESTIONNAIRE: ['read', 'write', 'paie', 'export'],
  COMPTABLE: ['read', 'export'],
  LECTEUR: ['read'],
};
/** Fabrique la fonction de contrôle des droits à partir de l'utilisateur courant. */
function makeNeed(getUser) {
  return (perm) => {
    const u = getUser();
    if (!u) throw new Error('Session expirée : reconnectez-vous.');
    if (!(PERMS[u.role] || []).includes(perm)) throw new Error('Droits insuffisants pour cette action.');
  };
}

const throttle = new Throttle();
const DUMMY = hashPassword('dummy-password-for-timing');

function registerApi(handle, E) {
  // « db » suit toujours la connexion courante de l'hôte (elle change si l'on reconfigure SQL Server)
  const db = new Proxy({}, { get: (_, k) => { const d = E.db(); const v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } });

  // ───────────────────────── Authentification ─────────────────────────
  handle('auth:status', null, async () => ({ needsAdmin: await repo.needsAdmin(db), user: E.user() }));

  handle('auth:createAdmin', null, async (d) => {
    if (!(await repo.needsAdmin(db))) throw new Error("Un administrateur existe déjà.");
    await repo.createUser(db, d, null, { firstAdmin: true });
    return true;
  });

  handle('auth:login', null, async ({ login, password } = {}) => {
    const key = String(login || '').toLowerCase();
    throttle.check(key);
    const u = (await db.query(`SELECT u.Id, u.Login, u.NomComplet, u.MotDePasseHash, u.Sel, u.Actif, r.Code AS Role
      FROM paie.Utilisateur u JOIN paie.Role r ON r.Id = u.RoleId WHERE u.Login = @l`, { l: String(login || '') }))[0];
    const ref = u || { MotDePasseHash: DUMMY.hash, Sel: DUMMY.salt };      // temps constant même si l'identifiant n'existe pas
    const good = verifyPassword(password, ref.MotDePasseHash, ref.Sel) && u && u.Actif;
    if (!good) {
      throttle.fail(key);
      await repo.audit(db, u ? { id: u.Id } : null, 'ECHEC_CONNEXION', 'Utilisateur', u ? u.Id : null, `login=${String(login || '').slice(0, 50)}`);
      throw new Error('Identifiant ou mot de passe incorrect.');
    }
    throttle.ok(key);
    E.setUser({ id: u.Id, login: u.Login, nom: u.NomComplet, role: u.Role });
    await db.query('UPDATE paie.Utilisateur SET DernierLogin = SYSDATETIME() WHERE Id = @id', { id: u.Id });
    await repo.audit(db, E.user(), 'CONNEXION', 'Utilisateur', u.Id, null);
    return E.user();
  });

  handle('auth:logout', null, async () => { E.setUser(null); return true; });

  // ───────────────────────── Données ─────────────────────────
  handle('emp:list', 'read', () => repo.listEmployes(db));
  handle('emp:get', 'read', (id) => repo.getEmploye(db, Number(id)));
  handle('emp:save', 'write', (d) => repo.saveEmploye(db, d, E.user()));
  handle('emp:deactivate', 'write', (id) => repo.deactivateEmploye(db, Number(id), E.user()));
  handle('rub:list', 'read', () => repo.listRubriquesSaisie(db));
  handle('rub:all', 'read', () => repo.listRubriques(db));
  handle('rub:save', 'admin', (d) => repo.saveRubrique(db, d, E.user()));
  handle('emprub:list', 'read', (f) => repo.listEmployeRubriques(db, f || {}));
  handle('emprub:save', 'write', (d) => repo.saveEmployeRubrique(db, d, E.user()));
  handle('emprub:close', 'write', (id, dateFin) => repo.closeEmployeRubrique(db, Number(id), dateFin, E.user()));
  handle('emprub:delete', 'write', (id) => repo.deleteEmployeRubrique(db, Number(id), E.user()));
  handle('emp:parts', 'read', (d) => calcParts(d || {}));

  handle('per:get', 'read', (annee, mois) => repo.findPeriode(db, annee, mois));
  handle('per:open', 'paie', (annee, mois) => repo.getOrCreatePeriode(db, annee, mois));
  handle('per:close', 'paie', (id) => repo.cloturerPeriode(db, Number(id), E.user()));
  handle('var:list', 'read', (periodeId) => repo.listVariables(db, Number(periodeId)));
  handle('var:save', 'paie', (d) => repo.saveVariable(db, d, E.user()));
  handle('pres:list', 'read', (periodeId) => repo.listPresences(db, Number(periodeId)));
  handle('pres:save', 'paie', (d) => repo.savePresence(db, d, E.user()));
  handle('pres:delete', 'paie', (employeId, periodeId) => repo.deletePresence(db, Number(employeId), Number(periodeId), E.user()));
  handle('var:delete', 'paie', (id, periodeId) => repo.deleteVariable(db, Number(id), Number(periodeId), E.user()));

  handle('paie:calculer', 'paie', (periodeId) => repo.calculerPeriode(db, Number(periodeId), E.user()));
  handle('paie:journal', 'read', (periodeId) => repo.journal(db, Number(periodeId)));
  handle('paie:detail', 'read', async (periodeId, bulletinId) => {
    const d = await repo.getBulletins(db, Number(periodeId), Number(bulletinId));
    return d.bulletins[0] || null;
  });

  handle('paie:pdf', 'export', async (periodeId, bulletinId) => {
    const data = await repo.getBulletins(db, Number(periodeId), bulletinId ? Number(bulletinId) : null);
    if (!data.bulletins.length) throw new Error('Aucun bulletin : calculez la paie avant de générer les PDF.');
    const { Annee, Mois } = data.periode;
    const name = bulletinId
      ? `Bulletin_${data.bulletins[0].Matricule}_${Annee}-${String(Mois).padStart(2, '0')}.pdf`
      : `Bulletins_${Annee}-${String(Mois).padStart(2, '0')}.pdf`;
    await repo.audit(db, E.user(), 'EXPORT_PDF', 'PeriodePaie', Number(periodeId), name);
    return E.deliverPdf(bulletinsDocument(data), name);
  });

  handle('paie:csv', 'export', async (periodeId) => {
    const per = (await db.query('SELECT Annee, Mois FROM paie.PeriodePaie WHERE Id=@id', { id: Number(periodeId) }))[0];
    const rows = await repo.journal(db, Number(periodeId));
    if (!rows.length) throw new Error('Aucun bulletin à exporter.');
    const head = ['Matricule', 'Nom', 'Prénom', 'Brut', 'Cotisations salariales', 'IR', 'TRIMF', 'Autres retenues', 'Net', 'Charges patronales', 'Coût employeur'];
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(';')].concat(rows.map((r) =>
      [r.Matricule, r.Nom, r.Prenom, r.Brut, r.TotalCotisSalariales, r.ImpotRevenu, r.TRIMF, r.AutresRetenues, r.Net, r.TotalCotisPatronales, r.CoutEmployeur].map(cell).join(';')));
    const name = `Journal_paie_${per.Annee}-${String(per.Mois).padStart(2, '0')}.csv`;
    return E.saveFile(name, [{ name: 'CSV', extensions: ['csv'] }], '\uFEFF' + lines.join('\r\n'));
  });


  // ── Catégories et classes professionnelles
  handle('cat:list', 'read', () => repo.listCategories(db));
  handle('cat:save', 'admin', (kind, d) => repo.saveCategorie(db, kind, d, E.user()));

  // ── Congés et absences
  handle('conge:types', 'read', () => repo.listTypesConge(db));
  handle('conge:typeSave', 'admin', (d) => repo.saveTypeConge(db, d, E.user()));
  handle('conge:list', 'read', (f) => repo.listConges(db, f || {}));
  handle('conge:jours', 'read', (debut, fin) => conges.joursOuvrables(debut, fin));
  handle('conge:save', 'write', (d) => { if (d && d.Statut === 'APPROUVE') E.need('paie'); return repo.saveConge(db, d, E.user()); });
  handle('conge:statut', 'paie', (id, statut) => repo.setStatutConge(db, Number(id), statut, E.user()));
  handle('conge:delete', 'write', (id) => repo.deleteConge(db, Number(id), E.user()));
  handle('conge:soldes', 'read', (dateIso) => repo.soldesAt(db, String(dateIso || new Date().toISOString().slice(0, 10)).slice(0, 10)));
  handle('conge:soldeInit', 'write', (employeId, solde, dateIso) => repo.setSoldeInitial(db, Number(employeId), solde, dateIso, E.user()));

  // ── Comptabilité
  handle('compta:ecritures', 'read', (periodeId) => repo.ecrituresPeriode(db, Number(periodeId)));
  handle('compta:reverser', 'read', (periodeId) => repo.reversementsPeriode(db, Number(periodeId)));
  handle('compta:plan', 'read', () => repo.listPlan(db));
  handle('compta:planSave', 'admin', (d) => repo.savePlanCompte(db, d, E.user()));
  handle('compta:rubriques', 'read', () => repo.listComptesRubriques(db));
  handle('compta:rubSave', 'admin', (d) => repo.saveCompteRubrique(db, d, E.user()));
  handle('compta:params', 'read', () => repo.listParamsCompta(db));
  handle('compta:paramSave', 'admin', (cle, valeur) => repo.saveParamCompta(db, cle, valeur, E.user()));

  const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csvNum = (n) => String(Number(n || 0)).replace('.', ',');
  const frDate = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

  handle('compta:csv', 'export', async (periodeId) => {
    const e = await repo.ecrituresPeriode(db, Number(periodeId));
    if (e.vide) throw new Error('Aucun bulletin pour cette période : calculez la paie avant d\'exporter les écritures.');
    const lines = [['Date', 'Journal', 'Pièce', 'Compte', 'Libellé', 'Débit', 'Crédit'].map(csvCell).join(';')]
      .concat(e.lignes.map((l) => [frDate(e.date), e.journal, e.piece, l.compte, l.libelle, csvNum(l.debit), csvNum(l.credit)].map(csvCell).join(';')));
    const name = `Ecritures_paie_${e.periode.Annee}-${String(e.periode.Mois).padStart(2, '0')}.csv`;
    await repo.audit(db, E.user(), 'EXPORT_COMPTA', 'PeriodePaie', Number(periodeId), name);
    return E.saveFile(name, [{ name: 'CSV', extensions: ['csv'] }], '\uFEFF' + lines.join('\r\n'));
  });

  handle('compta:virements', 'export', async (periodeId) => {
    const per = (await db.query('SELECT Annee, Mois FROM paie.PeriodePaie WHERE Id=@id', { id: Number(periodeId) }))[0];
    const rows = await repo.virementsPeriode(db, Number(periodeId));
    if (!rows.length) throw new Error('Aucun bulletin pour cette période.');
    const lines = [['Matricule', 'Nom', 'Prénom', 'Mode de paiement', 'Banque', 'N° de compte', 'Net à payer'].map(csvCell).join(';')]
      .concat(rows.map((r) => [r.Matricule, r.Nom, r.Prenom, r.ModePaiement, r.Banque, r.NumeroCompte, csvNum(r.Net)].map(csvCell).join(';')));
    const name = `Ordre_virement_${per.Annee}-${String(per.Mois).padStart(2, '0')}.csv`;
    return E.saveFile(name, [{ name: 'CSV', extensions: ['csv'] }], '\uFEFF' + lines.join('\r\n'));
  });

  // ── Rapports (requêtes en lecture seule, exports soumis au droit 'export')
  handle('rapport:filters', 'read', () => rapportsRepo.getFilterOptions(db));
  handle('rapport:data', 'read', async (type, filters) => (await rapportsRepo.runReport(db, String(type || ''), filters || {})).report);
  handle('rapport:csv', 'export', async (type, filters) => {
    const { report } = await rapportsRepo.runReport(db, String(type || ''), filters || {});
    if (!report.rows.length) throw new Error('Aucune donnée à exporter pour ces critères.');
    return E.saveFile(`${report.filenameBase}.csv`, [{ name: 'CSV', extensions: ['csv'] }], reportToCsv(report));
  });
  handle('rapport:pdf', 'export', async (type, filters) => {
    const { report } = await rapportsRepo.runReport(db, String(type || ''), filters || {});
    if (!report.rows.length) throw new Error('Aucune donnée à exporter pour ces critères.');
    const ent = await rapportsRepo.getEntreprise(db);
    return E.deliverPdf(reportToHtml(report, ent), `${report.filenameBase}.pdf`);
  });

  handle('params:list', 'read', () => repo.listParams(db));
  handle('params:save', 'admin', (kind, d) => repo.saveRow(db, kind, d, E.user()));
  handle('params:delete', 'admin', (kind, id) => repo.deleteRow(db, kind, id, E.user()));
  handle('ent:get', 'read', () => repo.getEntreprise(db));
  handle('ent:save', 'admin', (d) => repo.saveEntreprise(db, d, E.user()));

  handle('users:list', 'admin', () => repo.listUsers(db));
  handle('users:create', 'admin', (d) => repo.createUser(db, d, E.user()));
  handle('users:setActive', 'admin', (id, actif) => repo.setUserActive(db, Number(id), !!actif, E.user()));
  handle('users:resetPassword', 'admin', (id, pw) => repo.resetPassword(db, Number(id), pw, E.user()));

  handle('app:info', null, async () => {
    const c = db.cfg;
    return { version: E.version, server: `${c.server}${c.instance ? '\\' + c.instance : ':' + (c.port || 1433)}`, database: c.database, roles: repo.ROLES };
  });
}

module.exports = { registerApi, makeNeed, PERMS };
