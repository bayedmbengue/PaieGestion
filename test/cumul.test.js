'use strict';
// IR et TRIMF : impôts annuels retenus par acomptes mensuels (cumul de l'année, plafond, régularisation de départ).
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculer, makeParams, impotAnnuel } = require('../src/main/calc');
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
const P = (extra = []) => makeParams(rows.concat(extra), bareme, trimfBareme);

/** Simule des bulletins successifs : mois = [{ mois, brut, sortie? }] ; renvoie les résultats et les cumuls. */
function simuler(mois, extra = {}, params = P()) {
  const cumul = { nb: 0, brutImposable: 0, brutCfceTrimf: 0, ir: 0, trimf: 0 };
  const out = [];
  for (const m of mois) {
    const r = calculer({ brut: m.brut, brutCotisable: m.brut, brutImposable: m.brut, estCadre: false, parts: 1, partsTrimf: 1,
      cumul: { ...cumul }, sortie: !!m.sortie, regularisation: !!m.sortie || m.mois === 12, ...extra }, params);
    cumul.nb += 1; cumul.brutImposable += m.brut; cumul.brutCfceTrimf += m.brut; cumul.ir += r.ir; cumul.trimf += r.trimf;
    out.push({ ...r, cumulIr: cumul.ir, cumulTrimf: cumul.trimf });
  }
  return out;
}
const annee = (f) => Array.from({ length: 12 }, (_, i) => ({ mois: i + 1, brut: f(i + 1) }));
const irAnnuel = (revenu, parts, p = P()) => Math.round(impotAnnuel(revenu, parts, p).impot);

test('salaire constant : chaque mois pareil et le total de l\'année = l\'IR annuel dû', () => {
  const res = simuler(annee(() => 500000));
  const mensuel = calculer({ brut: 500000, brutCotisable: 500000, brutImposable: 500000, estCadre: false, parts: 1 }, P()).ir;
  for (const r of res) assert.ok(Math.abs(r.ir - mensuel) <= 1, `retenue du mois ${r.ir} ≠ ${mensuel}`);
  assert.equal(res[11].cumulIr, irAnnuel(6000000, 1));
});

test('prime exceptionnelle en mars : le cumul retenu ne dépasse jamais l\'IR dû, et décembre ajuste au franc près', () => {
  const brut = (m) => (m === 3 ? 2500000 : 500000);
  const res = simuler(annee(brut));
  const total = 11 * 500000 + 2500000;
  assert.equal(res[11].cumulIr, irAnnuel(total, 1));          // total de l'année = IR annuel exact
  let cumulBrut = 0;
  res.forEach((r, i) => {
    cumulBrut += brut(i + 1);
    const du = Math.round(irAnnuel(cumulBrut / (i + 1) * 12, 1) * (i + 1) / 12);
    if (i < 11) assert.ok(r.cumulIr <= du + 1, `mois ${i + 1} : retenu ${r.cumulIr} > dû ${du}`);
  });
});

test('trop retenu en cours d\'année : décembre rembourse l\'excédent (retenue négative)', () => {
  // gros salaire au début, petit ensuite : l'IR annuel dû est inférieur à ce qui a été retenu
  const brut = (m) => (m <= 3 ? 2000000 : 300000);
  const res = simuler(annee(brut));
  assert.ok(res.slice(0, 11).every((r) => r.ir >= 0), 'jamais de retenue négative avant la régularisation');
  assert.equal(res[11].cumulIr, irAnnuel(3 * 2000000 + 9 * 300000, 1));
});

test('départ en juin : régularisation sur le dernier bulletin = impôt sur le revenu réellement perçu', () => {
  const mois = [1, 2, 3, 4, 5, 6].map((m) => ({ mois: m, brut: 500000, sortie: m === 6 }));
  const res = simuler(mois);
  const apresMai = res[4].cumulIr;
  const dernier = res[5];
  assert.equal(dernier.cumulIr, irAnnuel(6 * 500000, 1));       // cumul final = impôt annuel sur 3 000 000 perçus
  assert.ok(dernier.ir < 0, 'remboursement du trop-perçu au dernier bulletin');
  assert.equal(dernier.ir, irAnnuel(3000000, 1) - apresMai);
  assert.equal(dernier.regularisation, true);
});

test('départ en juin, IR_SORTIE_MODE = 2 : revenu annualisé au prorata, donc pas de remboursement si salaire constant', () => {
  const mois = [1, 2, 3, 4, 5, 6].map((m) => ({ mois: m, brut: 500000, sortie: m === 6 }));
  const res = simuler(mois, {}, P([{ Code: 'IR_SORTIE_MODE', Valeur: 2 }]));
  assert.ok(Math.abs(res[5].cumulIr - Math.round(irAnnuel(6000000, 1) / 2)) <= 1);
  assert.ok(res[5].ir >= -1);
});

test('TRIMF : cumul annuel plafonné au montant dû (12 x le douzième pour une année complète)', () => {
  const res = simuler(annee(() => 500000));                      // 6 000 000 / an → tranche 2 000 000-6 999 999 : 12 000
  assert.equal(res[0].trimf, 1000);
  assert.equal(res[11].cumulTrimf, 12000);
  assert.ok(res.every((r) => r.cumulTrimf <= 12000));
});

test('TRIMF : salarié embauché en mars, 10 mois travaillés = 10/12 du montant annuel', () => {
  const mois = Array.from({ length: 10 }, (_, i) => ({ mois: i + 3, brut: 500000 }));
  const res = simuler(mois);
  assert.equal(res[9].cumulTrimf, 10000);
});

test('TRIMF : passage dans une tranche supérieure en cours d\'année, rattrapage automatique', () => {
  const res = simuler(annee((m) => (m <= 6 ? 150000 : 700000)));
  const total = res[11].cumulTrimf;
  assert.ok(total <= 12000 && total >= 3600, `TRIMF annuelle incohérente : ${total}`);
  assert.ok(res.every((r) => r.trimf >= 0 || r.regularisation));
});

test('premier mois sans cumul : identique à l\'ancien calcul mensuel', () => {
  const a = calculer({ brut: 868500, brutCotisable: 868500, brutImposable: 868500, estCadre: true, parts: 3, partsTrimf: 2 }, P());
  const b = calculer({ brut: 868500, brutCotisable: 868500, brutImposable: 868500, estCadre: true, parts: 3, partsTrimf: 2, cumul: { nb: 0, brutImposable: 0, brutCfceTrimf: 0, ir: 0, trimf: 0 } }, P());
  assert.equal(a.ir, 180446);
  assert.equal(a.ir, b.ir);
  assert.equal(a.trimf, b.trimf);
});

test('agent arrivé le 01/11 : décembre régularise l\'IR sur les 2 mois réellement perçus (remboursement du trop retenu en novembre)', () => {
  const res = simuler([{ mois: 11, brut: 500000 }, { mois: 12, brut: 500000 }]);
  assert.equal(res[1].cumulIr, irAnnuel(1000000, 1));   // impôt annuel sur 1 000 000 perçus
  assert.ok(res[1].ir < res[0].ir, 'décembre doit être inférieur à novembre');
  assert.equal(res[1].regularisation, true);
});

test('agent arrivé le 01/11, IR_SORTIE_MODE = 2 : décembre = novembre (revenu annualisé au prorata)', () => {
  const res = simuler([{ mois: 11, brut: 500000 }, { mois: 12, brut: 500000 }], {}, P([{ Code: 'IR_SORTIE_MODE', Valeur: 2 }]));
  assert.ok(Math.abs(res[1].ir - res[0].ir) <= 1);
});

test('réduction pour charges de famille : barème fourni (3,5 parts → plafond 2 030 000) : IR = 403 494 sur 1 723 527 imposables', () => {
  assert.equal(Math.round(impotAnnuel(1723527 * 12, 3.5, P()).impot / 12), 403494);
  const maxi = { 3: 1650000, 3.5: 2030000, 4: 2490000, 4.5: 2755000, 5: 3180000 };
  for (const [parts, m] of Object.entries(maxi)) assert.equal(P().get(`RED_FAM_${parts}_MAX`), m);
});
