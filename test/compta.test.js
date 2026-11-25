'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEcritures, regrouperReversements } = require('../src/main/compta');
const { COMPTES_RUBRIQUES, PARAMS_COMPTA } = require('../src/main/migrate');

const params = Object.fromEntries(PARAMS_COMPTA);
const ligne = (Code, Type, Gain, Ret, Pat) => {
  const [d, c] = COMPTES_RUBRIQUES[Code] || [null, null];
  return { Code, Libelle: Code, Type, CompteDebit: d, CompteCredit: c, Gain, Ret, Pat };
};
// Totaux du bulletin de référence (un seul employé)
const rows = [
  ligne('SALBASE', 'GAIN', 128500, 0, 0), ligne('SURSALAIRE', 'GAIN', 500000, 0, 0), ligne('PRIME_RESP', 'GAIN', 100000, 0, 0),
  ligne('PRIME_TRANS', 'GAIN', 26000, 0, 0), ligne('PRIME_LOG', 'GAIN', 100000, 0, 0), ligne('PRIME_REPRES', 'GAIN', 40000, 0, 0),
  ligne('IPRES_RG_SAL', 'COTIS_SAL', 0, 24192, 0), ligne('IPRES_RCC_SAL', 'COTIS_SAL', 0, 20844, 0), ligne('IPM_SAL', 'COTIS_SAL', 0, 12500, 0),
  ligne('IR', 'IMPOT', 0, 180446, 0), ligne('TRIMF', 'IMPOT', 0, 3000, 0), ligne('PRET', 'RETENUE', 0, 30000, 0),
  ligne('IPRES_RG_PAT', 'COTIS_PAT', 0, 0, 36288), ligne('IPRES_RCC_PAT', 'COTIS_PAT', 0, 0, 31266), ligne('IPM_PAT', 'COTIS_PAT', 0, 0, 15000),
  ligne('CSS_PF_PAT', 'COTIS_PAT', 0, 0, 4410), ligne('CSS_ATMP_PAT', 'COTIS_PAT', 0, 0, 630), ligne('CFCE_PAT', 'COTIS_PAT', 0, 0, 26055),
];

test("écriture de paie du bulletin de référence : équilibrée, avec les bons comptes", () => {
  const e = buildEcritures({ rows, netTotal: 623518, params });
  assert.equal(e.totalDebit, 1008149);          // 894 500 de gains + 113 649 de charges patronales
  assert.equal(e.totalCredit, 1008149);         // 57 536 + 180 446 + 3 000 + 30 000 + 113 649 + 623 518
  assert.equal(e.equilibre, true);
  const credit = (compte) => e.lignes.filter((l) => l.compte === compte).reduce((s, l) => s + l.credit, 0);
  const debit = (compte) => e.lignes.filter((l) => l.compte === compte).reduce((s, l) => s + l.debit, 0);
  assert.equal(credit('422'), 623518);          // net à payer
  assert.equal(credit('4471'), 180446);         // IR
  assert.equal(credit('4478'), 3000);           // TRIMF
  assert.equal(credit('421'), 30000);           // prêt
  assert.equal(credit('4312'), 24192 + 36288);  // IPRES régime général : part salariale + patronale
  assert.equal(debit('6413'), 26055);           // CFCE en charge
  assert.equal(credit('4472'), 26055);
  assert.equal(debit('6634'), 26000);           // transport
});

test('rubriques sans compte : compte par défaut utilisé et signalé', () => {
  const e = buildEcritures({ rows, netTotal: 623518, params });
  assert.equal(e.sansCompte.length, 3);          // SURSALAIRE, PRIME_RESP, PRIME_REPRES
  assert.ok(e.sansCompte.some((x) => x.startsWith('SURSALAIRE')));
  assert.equal(e.lignes.filter((l) => l.compte === '6611').reduce((s, l) => s + l.debit, 0), 128500 + 500000 + 100000 + 40000);
});

test("gain négatif (absence non rémunérée) : porté au crédit du compte de charge, écriture toujours équilibrée", () => {
  const r = [ligne('SALBASE', 'GAIN', 300000, 0, 0), ligne('ABS_NR', 'GAIN', -30000, 0, 0), ligne('IPRES_RG_SAL', 'COTIS_SAL', 0, 15120, 0)];
  const e = buildEcritures({ rows: r, netTotal: 270000 - 15120, params });
  assert.equal(e.equilibre, true);
  assert.equal(e.lignes.find((l) => l.libelle === 'ABS_NR').credit, 30000);
});

test('paramètre comptable manquant : erreur explicite', () => {
  const { COMPTE_REMUNERATION_DUE, ...sans } = params;
  assert.throws(() => buildEcritures({ rows, netTotal: 1, params: sans }), /COMPTE_REMUNERATION_DUE/);
});

test('montants à reverser par organisme', () => {
  const r = regrouperReversements(rows.map((x) => ({ Code: x.Code, Ret: x.Ret, Pat: x.Pat })));
  const get = (nom) => r.find((x) => x.organisme.startsWith(nom));
  assert.equal(get('IPRES — régime général').total, 24192 + 36288);
  assert.equal(get('IPRES — régime complémentaire').total, 20844 + 31266);
  assert.equal(get('CSS').total, 4410 + 630);
  assert.equal(get('IPM').total, 12500 + 15000);
  assert.equal(get('Impôt sur le revenu').total, 180446);
  assert.equal(get('TRIMF').total, 3000);
  assert.equal(get('CFCE').total, 26055);
});
