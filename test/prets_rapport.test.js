'use strict';
// Rapport « Prêts du personnel » : situation des prêts et échéances payées.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, reportToCsv, reportToHtml } = require('../src/main/rapports');
const { runReport } = require('../src/main/rapportsRepo');

const pret = (extra = {}) => ({ PretId: 1, EmployeId: 7, Matricule: '0001', Nom: 'DIOP', Prenom: 'Awa', Rubrique: 'Remboursement prêt',
  MontantPret: 600000, DureeMois: 12, Montant: 50000, DateDebut: '2026-09-01', DateFin: null, Actif: 1, Rembourse: 150000, NbPayees: 3, ...extra });

test('situation : échéances payées, remboursé, reste à rembourser et statut', () => {
  const r = buildReport('prets', { prets: [pret()] }, { vue: 'situation', etatPret: 'TOUS' }, {});
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].Echeances, '3 / 12');
  assert.equal(r.rows[0].Reste, 450000);
  assert.equal(r.rows[0].Statut, 'En cours');
  assert.equal(r.totals.Reste, 450000);
  assert.ok(reportToCsv(r).includes('450000') || reportToCsv(r).includes('450 000'));
  assert.ok(reportToHtml(r, { Nom: 'ACME' }).includes('Situation des prêts'));
});

test('prêt soldé, prêt arrêté avec reste dû, et filtre par état', () => {
  const data = { prets: [pret(), pret({ PretId: 2, Rembourse: 600000, NbPayees: 12 }), pret({ PretId: 3, Actif: 0, Rembourse: 100000, NbPayees: 2 })] };
  const tous = buildReport('prets', data, { vue: 'situation', etatPret: 'TOUS' }, {});
  assert.deepEqual(tous.rows.map((x) => x.Statut), ['En cours', 'Soldé', 'Arrêté (reste dû)']);
  assert.equal(buildReport('prets', data, { vue: 'situation', etatPret: 'ENCOURS' }, {}).rows.length, 2);
  const soldes = buildReport('prets', data, { vue: 'situation', etatPret: 'SOLDE' }, {});
  assert.equal(soldes.rows.length, 1);
  assert.equal(soldes.rows[0].Reste, 0);
});

test('échéances payées : numéro, période, cumul remboursé et reste après chaque échéance', () => {
  const ech = (Annee, Mois, Montant) => ({ PretId: 1, Matricule: '0001', Nom: 'DIOP', Prenom: 'Awa', Rubrique: 'Remboursement prêt', MontantPret: 600000, DureeMois: 12, DateDebut: '2026-09-01', Annee, Mois, Montant });
  const r = buildReport('prets', { prets: [pret()], echeances: [ech(2026, 9, 50000), ech(2026, 10, 50000), ech(2026, 11, 20000)] }, { vue: 'echeances', etatPret: 'TOUS' }, {});
  assert.deepEqual(r.rows.map((x) => x.Echeance), ['1 / 12', '2 / 12', '3 / 12']);
  assert.equal(r.rows[2].Periode, 'Novembre 2026');
  assert.deepEqual(r.rows.map((x) => x.Cumul), [50000, 100000, 120000]);
  assert.equal(r.rows[2].ResteApres, 480000);   // la variable de 20 000 a remplacé la mensualité de novembre
  assert.equal(r.totals.Montant, 120000);
});

test('runReport : filtre par état et vue transmis, requêtes limitées à la vue demandée', async () => {
  const vus = [];
  const db = { async query(sql) {
    vus.push(sql);
    if (/FROM paie\.Employe e WHERE e\.Id/.test(sql)) return [];
    if (/FROM paie\.EmployeRubrique er\s+JOIN paie\.Employe e/.test(sql) && /Rembourse/.test(sql)) return [pret()];
    return [];
  } };
  const out = await runReport(db, 'prets', { vue: 'situation', etatPret: 'ENCOURS' });
  assert.equal(out.report.rows.length, 1);
  assert.equal(out.filters.etatPret, 'ENCOURS');
  assert.ok(!vus.some((q) => /pp\.Annee, pp\.Mois, l\.MontantRetenue AS Montant/.test(q)), 'pas de requête d\'échéances en vue « situation »');
});
