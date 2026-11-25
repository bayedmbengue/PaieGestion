'use strict';
// Module « Déclarations sur salaires » : IR, TRIMF, CFCE, IPRES & CSS, IPM, État 1024.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, reportToCsv, reportToHtml, REPORT_TYPES } = require('../src/main/rapports');
const { DECL_TYPES } = require('../src/main/declarations');
const { normalizeFilters } = require('../src/main/rapportsRepo');

const emp = (id, nom, extra = {}) => ({
  EmployeId: id, Matricule: `M${id}`, Nom: nom, Prenom: 'X', SituationFamiliale: 'M', NumeroIPRES: '123', NumeroCSS: '456', NombreParts: 2, NbMois: 1,
  Brut: 500000, BrutImposable: 480000, BrutCfceTrimf: 500000, BaseIPRES: 432000, TotalCotisSalariales: 40000, ImpotRevenu: 30000, TRIMF: 1000, Net: 420000,
  IpresRgSal: 24192, IpresRgPat: 36288, IpresRccSal: 0, IpresRccPat: 0, CssPfPat: 35000, CssAtmpPat: 5000, IpmSal: 12500, IpmPat: 15000, CfcePat: 15000, ...extra,
});
const raw = [emp(1, 'DIOP'), emp(2, 'FALL', { ImpotRevenu: 10000, TRIMF: 0 })];
const f = { annee: 2026, moisDebut: 12, moisFin: 12 };

test('les 6 déclarations sont des types de rapport connus', () => {
  assert.deepEqual(DECL_TYPES, ['decl_ir', 'decl_trimf', 'decl_cfce', 'decl_ipres_css', 'decl_ipm', 'decl_1024']);
  for (const t of DECL_TYPES) assert.ok(REPORT_TYPES.includes(t), t);
});

test('chaque déclaration se construit, s\'exporte en CSV et en PDF (HTML)', () => {
  for (const t of DECL_TYPES) {
    const r = buildReport(t, raw, f, {});
    assert.equal(r.rows.length, 2, t);
    assert.ok(r.totals && r.kpis.length, t);
    assert.ok(reportToCsv(r).includes('DIOP'), t);
    assert.ok(reportToHtml(r, { Nom: 'Ma société' }).includes(r.title.slice(0, 12)), t);
  }
});

test('IR : total à reverser = somme des retenues ; TRIMF et CFCE idem', () => {
  assert.equal(buildReport('decl_ir', raw, f).totals.ImpotRevenu, 40000);
  assert.equal(buildReport('decl_trimf', raw, f).totals.TRIMF, 1000);
  assert.equal(buildReport('decl_cfce', raw, f).totals.CfcePat, 30000);
});

test('IPRES & CSS : récapitulatif par organisme cohérent avec le total des salariés', () => {
  const r = buildReport('decl_ipres_css', raw, f);
  assert.equal(r.secondaryTable.totals.Total, r.totals.SocialTotal);
  assert.equal(r.totals.SocialTotal, 2 * (24192 + 36288 + 35000 + 5000));
});

test('IPM : part salariale + part patronale', () => {
  const r = buildReport('decl_ipm', raw, f);
  assert.equal(r.totals.IpmTotal, 2 * (12500 + 15000));
});

test('État 1024 : annuel par défaut (janvier à décembre) et récapitulatif de l\'exercice', () => {
  const nf = normalizeFilters('decl_1024', { annee: 2026 });
  assert.equal(nf.moisDebut, 1);
  assert.equal(nf.moisFin, 12);
  const r = buildReport('decl_1024', raw, nf, {});
  assert.match(r.title, /1024/);
  assert.equal(r.filenameBase, 'Etat_1024_2026');
  assert.equal(r.secondaryTable.rows[0].Valeur, 2);                   // nombre de salariés
});

test('déclaration mensuelle : le mois demandé est celui du filtre', () => {
  const nf = normalizeFilters('decl_ir', { annee: 2026, moisDebut: 3, moisFin: 3 });
  assert.equal(nf.moisDebut, 3);
  assert.match(buildReport('decl_ir', raw, nf).subtitle, /Mars 2026/);
});
