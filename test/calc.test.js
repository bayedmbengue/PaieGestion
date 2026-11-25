'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculer, makeParams } = require('../src/main/calc');
const { REDUCTION_FAMILLE } = require('../src/main/migrate');

const rows = [
  ['IPRES_RG_SAL', 5.6], ['IPRES_RG_PAT', 8.4], ['IPRES_RG_PLAFOND', 432000],
  ['IPRES_RCC_SAL', 2.4], ['IPRES_RCC_PAT', 3.6], ['IPRES_RCC_PLAFOND', 1296000],
  ['CSS_PF_PAT', 7], ['CSS_ATMP_PAT', 1], ['CSS_PLAFOND', 63000], ['CFCE_PAT', 3],
  ['ABATTEMENT_IR', 30], ['ABATTEMENT_IR_PLAFOND', 900000],
  ['IPM_SAL', 5], ['IPM_PAT', 6], ['IPM_PLAFOND_SAL', 12500], ['IPM_PLAFOND_PAT', 15000],
].map(([Code, Valeur]) => ({ Code, Valeur }))
  .concat(REDUCTION_FAMILLE.flatMap(([n, t, mi, ma]) => [{ Code: `RED_FAM_${n}_TAUX`, Valeur: t }, { Code: `RED_FAM_${n}_MIN`, Valeur: mi }, { Code: `RED_FAM_${n}_MAX`, Valeur: ma }]));
const bareme = [[0, 630000, 0], [630000, 1500000, 20], [1500000, 4000000, 30], [4000000, 8000000, 35], [8000000, 13500000, 37], [13500000, 50000000, 40], [50000000, null, 43]]
  .map(([TrancheMin, TrancheMax, Taux]) => ({ TrancheMin, TrancheMax, Taux }));
const trimfBareme = [[0, 599999, 900], [600000, 999999, 3600], [1000000, 1999999, 4800], [2000000, 6999999, 12000], [7000000, 11999999, 18000], [12000000, null, 36000]]
  .map(([SalaireMin, SalaireMax, Montant]) => ({ SalaireMin, SalaireMax, Montant }));
const P = (trimf = []) => makeParams(rows, bareme, trimf);
const run = (brut, extra = {}) => calculer({ brut, brutCotisable: brut, brutImposable: brut, estCadre: false, parts: 1, ...extra }, P());

// ───────── Bulletin de référence (octobre 2026) : cadre marié, 2 enfants, conjoint sans revenus ─────────
test('BULLETIN DE RÉFÉRENCE : tous les montants retrouvés au franc près', () => {
  // Gains : 128 500 + 500 000 + 100 000 + 26 000 (transport, exonéré) + 100 000 (logement) + 40 000 = 894 500
  // Brut social = brut imposable = 868 500 (le transport n'est ni imposable ni soumis à cotisations)
  const r = calculer({
    brut: 894500, brutCotisable: 868500, brutImposable: 868500, estCadre: true,
    parts: 3,        // marié, 2 enfants, conjoint sans revenus
    partsTrimf: 2,   // marié, conjoint sans revenus
    autresRetenues: 30000,   // remboursement de prêt
  }, P(trimfBareme));
  assert.equal(r.ipmSal, 12500);
  assert.equal(r.ipmPat, 15000);
  assert.equal(r.rccSal, 20844);        // IPRES cadre 2,4 % de 868 500
  assert.equal(r.rccPat, 31266);        // 3,6 %
  assert.equal(r.rgSal, 24192);         // IPRES général 5,6 % de 432 000
  assert.equal(r.rgPat, 36288);         // 8,4 %
  assert.equal(r.cssPf, 4410);
  assert.equal(r.cssAtmp, 630);
  assert.equal(r.cfce, 26055);          // 3 % de 868 500
  // IR : 868 500 × 12 = 10 422 000 ; abattement plafonné 900 000 → 9 522 000 ;
  // impôt brut = 174 000 + 750 000 + 1 400 000 + 1 522 000 × 37 % = 2 887 140 ; réduction 3 parts 25 % = 721 785
  // → 2 165 355 / 12 = 180 446
  assert.equal(r.ir, 180446);
  assert.equal(r.trimf, 3000);          // 18 000 × 2 parts / 12
  assert.equal(r.totalCotisSal + r.ir + r.trimf + r.autresRetenues, 270982);   // total des retenues
  assert.equal(r.net, 623518);                                                   // net à payer
  assert.equal(r.totalCotisPat, 113649);                                         // charges patronales
});

test('salarié non-cadre 300 000 FCFA, 1 part (calcul fait à la main)', () => {
  const r = run(300000);
  assert.equal(r.rgSal, 16800);          // 5,6 % de 300 000
  assert.equal(r.rgPat, 25200);          // 8,4 %
  assert.equal(r.ipmSal, 12500);         // 5 % = 15 000 → plafonné à 12 500
  assert.equal(r.ipmPat, 15000);         // 6 % = 18 000 → plafonné à 15 000
  assert.equal(r.cssPf, 4410);
  assert.equal(r.cssAtmp, 630);
  assert.equal(r.cfce, 9000);
  // IR : 300 000 × 12 = 3 600 000 ; abattement 30 % = 1 080 000 → plafonné 900 000 → 2 700 000
  // impôt = 174 000 + 1 200 000 × 30 % = 534 000 ; / 12 = 44 500
  assert.equal(r.ir, 44500);
  assert.equal(r.net, 226200);           // 300 000 − 16 800 − 12 500 − 44 500
  assert.equal(r.totalCotisPat, 54240);  // 25 200 + 4 410 + 630 + 9 000 + 15 000
  assert.equal(r.coutEmployeur, 354240);
});

test('cadre à 1 000 000 FCFA : régime complémentaire sur tout le salaire jusqu\'à son plafond', () => {
  const r = run(1000000, { estCadre: true });
  assert.equal(r.rgSal, 24192);          // 5,6 % de 432 000
  assert.equal(r.rgPat, 36288);
  assert.equal(r.rccSal, 24000);         // 2,4 % de 1 000 000
  assert.equal(r.rccPat, 36000);         // 3,6 %
  assert.equal(run(2000000, { estCadre: true }).rccSal, 31104);   // plafonné à 1 296 000 : 2,4 % = 31 104
});

test('non-cadre : jamais de régime complémentaire', () => {
  const r = run(1000000);
  assert.equal(r.rccSal, 0); assert.equal(r.rccPat, 0);
});

test('bas salaire : impôt nul sous la 1re tranche', () => {
  const r = run(60000);
  assert.equal(r.ir, 0);
  assert.equal(r.net, 60000 - 3360 - 3000);   // IPRES 5,6 % + IPM 5 %
});

test("réduction pour charges de famille : 2 parts (15 % = 80 100 < minimum 200 000 → minimum appliqué)", () => {
  assert.equal(run(300000, { parts: 2 }).ir, 27833);   // (534 000 − 200 000) / 12 = 27 833,33
});

test('réduction pour charges de famille : 1,5 part (10 % < minimum 100 000)', () => {
  assert.equal(run(300000, { parts: 1.5 }).ir, 36167);   // (534 000 − 100 000) / 12 = 36 166,67
});

test('réduction pour charges de famille : plafonnée au maximum (5 parts, très haut revenu)', () => {
  // impôt brut 38 352 000 ; 45 % = 17,2 M > maximum 3 180 000 → (38 352 000 − 3 180 000) / 12 = 2 931 000
  assert.equal(run(8000000, { parts: 5 }).ir, 2931000);
});

test("la réduction ne peut pas rendre l'impôt négatif", () => {
  assert.equal(run(100000, { parts: 2 }).ir, 0);   // impôt brut 42 000 < réduction minimale 200 000
});

test('réduction manquante pour un nombre de parts : erreur explicite (pas de calcul silencieusement faux)', () => {
  const sans = makeParams(rows.filter((x) => !x.Code.startsWith('RED_FAM_2_')), bareme, []);
  assert.throws(() => calculer({ brut: 300000, brutCotisable: 300000, brutImposable: 300000, estCadre: false, parts: 2 }, sans), /RED_FAM_2_TAUX/);
});

test('retenues diverses et TRIMF déduits du net', () => {
  const p = makeParams(rows, bareme, [{ SalaireMin: 0, SalaireMax: null, Montant: 1000 }]);
  const r = calculer({ brut: 60000, brutCotisable: 60000, brutImposable: 60000, estCadre: false, parts: 1, autresRetenues: 5000 }, p);
  assert.equal(r.trimf, 83);                     // 1 000 FCFA/an retenus par douzième = 83
  assert.equal(r.net, 60000 - 3360 - 3000 - 83 - 5000);
});

test('paramètre légal manquant : erreur explicite', () => {
  const p = makeParams(rows.filter((x) => x.Code !== 'CFCE_PAT'), bareme, []);
  assert.throws(() => calculer({ brut: 1, brutCotisable: 1, brutImposable: 1, estCadre: false, parts: 1 }, p), /CFCE_PAT/);
});

const withTrimf = (brut, regle) => calculer({ brut, brutCotisable: brut, brutImposable: brut, estCadre: false, parts: 1 },
  makeParams(regle ? rows.concat([{ Code: 'TRIMF_REGLE', Valeur: regle }]) : rows, bareme, trimfBareme));

test('TRIMF : barème sur revenu annuel, retenue par douzième', () => {
  assert.equal(withTrimf(40000).trimf, 75);      // 480 000 /an → 900 / 12
  assert.equal(withTrimf(100000).trimf, 400);    // 1 200 000 /an → 4 800 / 12
  assert.equal(withTrimf(1000000).trimf, 3000);  // 12 000 000 /an → 36 000 / 12
});

test('TRIMF : règle 2 (minimum) et règle 3 (non due si IR > 0)', () => {
  assert.equal(withTrimf(100000, 1).ir, 3500);   // (1 200 000 − 360 000 − 630 000) × 20 % / 12
  assert.equal(withTrimf(100000, 1).trimf, 400);
  assert.equal(withTrimf(100000, 2).trimf, 0);   // IR (3 500) > TRIMF (400) → seule l'IR reste
  assert.equal(withTrimf(100000, 3).trimf, 0);
  assert.equal(withTrimf(40000, 3).trimf, 75);   // IR nul → TRIMF due
});

test('TRIMF : 2 parts TRIMF (marié, conjoint sans revenus) = montant doublé', () => {
  const r = calculer({ brut: 100000, brutCotisable: 100000, brutImposable: 100000, estCadre: false, parts: 2, partsTrimf: 2 }, P(trimfBareme));
  assert.equal(r.trimf, 800);                    // 2 × 4 800 / 12
});

test('CFCE : base = éléments imposables (hors remboursements de frais)', () => {
  const r = calculer({ brut: 320000, brutCotisable: 300000, brutImposable: 300000, estCadre: false, parts: 1 }, P());
  assert.equal(r.cfce, 9000);                    // 3 % de 300 000, pas de 320 000
});

test("IPM : taux 5 % / 6 % et plafonds de 12 500 et 15 000 FCFA", () => {
  const r = run(200000);
  assert.equal(r.ipmSal, 10000);                 // 5 % de 200 000 (sous le plafond)
  assert.equal(r.ipmPat, 12000);                 // 6 %
  assert.equal(run(1000000).ipmSal, 12500);      // plafonné
  assert.equal(run(1000000).ipmPat, 15000);
});

test("le plafond de l'abattement est bien appliqué", () => {
  const sans = makeParams(rows.map((x) => (x.Code === 'ABATTEMENT_IR_PLAFOND' ? { ...x, Valeur: 1e12 } : x)), bareme, []);
  const a = calculer({ brut: 300000, brutCotisable: 300000, brutImposable: 300000, estCadre: false, parts: 1 }, sans);
  assert.equal(a.ir, 40000);                     // abattement non plafonné : 2 520 000 → 480 000 / 12
  assert.equal(run(300000).ir, 44500);           // avec plafond de 900 000
});

test('barème à 7 tranches : un très haut revenu atteint la tranche à 43 %', () => {
  // 8 000 000 FCFA/mois : 96 000 000 − 900 000 = 95 100 000 par an
  // Impôt = 174 000 + 750 000 + 1 400 000 + 2 035 000 + 14 600 000 + 45 100 000 × 43 % = 38 352 000 → / 12 = 3 196 000
  assert.equal(run(8000000).ir, 3196000);
});
