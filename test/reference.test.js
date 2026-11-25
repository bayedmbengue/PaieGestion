'use strict';
// Test de bout en bout (base simulée) : le bulletin de référence d'octobre 2026 doit être reproduit au franc près,
// en passant par le vrai flux de calcul (rubriques, exonération du transport, retenue de prêt, parts).
const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../src/main/repo');
const { REDUCTION_FAMILLE } = require('../src/main/migrate');

const params = [['IPRES_RG_SAL', 5.6], ['IPRES_RG_PAT', 8.4], ['IPRES_RG_PLAFOND', 432000], ['IPRES_RCC_SAL', 2.4], ['IPRES_RCC_PAT', 3.6],
  ['IPRES_RCC_PLAFOND', 1296000], ['CSS_PF_PAT', 7], ['CSS_ATMP_PAT', 1], ['CSS_PLAFOND', 63000], ['CFCE_PAT', 3], ['ABATTEMENT_IR', 30],
  ['ABATTEMENT_IR_PLAFOND', 900000], ['IPM_SAL', 5], ['IPM_PAT', 6], ['IPM_PLAFOND_SAL', 12500], ['IPM_PLAFOND_PAT', 15000], ['EXO_PRIME_TRANS', 26000]]
  .map(([Code, Valeur]) => ({ Code, Valeur }))
  .concat(REDUCTION_FAMILLE.flatMap(([n, t, mi, ma]) => [{ Code: `RED_FAM_${n}_TAUX`, Valeur: t }, { Code: `RED_FAM_${n}_MIN`, Valeur: mi }, { Code: `RED_FAM_${n}_MAX`, Valeur: ma }]));
const ir = [[0, 630000, 0], [630000, 1500000, 20], [1500000, 4000000, 30], [4000000, 8000000, 35], [8000000, 13500000, 37], [13500000, 50000000, 40], [50000000, null, 43]]
  .map(([TrancheMin, TrancheMax, Taux]) => ({ TrancheMin, TrancheMax, Taux }));
const trimf = [[0, 599999, 900], [600000, 999999, 3600], [1000000, 1999999, 4800], [2000000, 6999999, 12000], [7000000, 11999999, 18000], [12000000, null, 36000]]
  .map(([SalaireMin, SalaireMax, Montant]) => ({ SalaireMin, SalaireMax, Montant }));
const RUB = ['SALBASE', 'IPRES_RG_SAL', 'IPRES_RCC_SAL', 'IPM_SAL', 'IR', 'TRIMF', 'IPRES_RG_PAT', 'IPRES_RCC_PAT', 'IPM_PAT', 'CSS_PF_PAT', 'CSS_ATMP_PAT', 'CFCE_PAT', 'SURSALAIRE', 'PRIME_RESP', 'PRIME_TRANS', 'PRIME_LOG', 'PRIME_REPRES', 'PRET'];
const gain = (id, code, montant) => ({ RubriqueId: id, Code: code, Libelle: code, Type: 'GAIN', Imposable: 1, SoumisCotisation: 1, Ordre: 50, Montant: montant });

test('bulletin de référence reproduit par le flux complet', async () => {
  const inserted = { bulletins: [], lignes: [] };
  const run = async (sql, p) => {
    if (/FROM paie\.Conge c/.test(sql)) return [];
    if (/FROM paie\.BulletinPaie b JOIN paie\.PeriodePaie/.test(sql)) return [];
    if (/FROM paie\.PeriodePaie WHERE Id/.test(sql)) return [{ Id: 1, Annee: 2026, Mois: 10, Cloturee: false }];
    if (/FROM paie\.ParametreLegal/.test(sql)) return params;
    if (/FROM paie\.BaremeIR/.test(sql)) return ir;
    if (/FROM paie\.BaremeTRIMF/.test(sql)) return trimf;
    if (/FROM paie\.Rubrique$/.test(sql.trim())) return RUB.map((Code, i) => ({ Id: i + 1, Code, Libelle: Code, Ordre: i * 10 }));
    if (/FROM paie\.Employe e/.test(sql)) return [{ Id: 1, EstCadre: 1, NombreParts: 3, SituationFamiliale: 'M', ConjointTravaille: false, SalaireBase: 128500 }];
    if (/UNION ALL/.test(sql)) return [
      gain(13, 'SURSALAIRE', 500000), gain(14, 'PRIME_RESP', 100000), gain(15, 'PRIME_TRANS', 26000),
      gain(16, 'PRIME_LOG', 100000), gain(17, 'PRIME_REPRES', 40000),
      { RubriqueId: 18, Code: 'PRET', Libelle: 'Remboursement prêt', Type: 'RETENUE', Imposable: 0, SoumisCotisation: 0, Ordre: 410, Montant: 30000 },
    ];
    if (/DELETE FROM paie\.BulletinPaie/.test(sql)) return [];
    if (/INSERT INTO paie\.BulletinPaie/.test(sql)) { inserted.bulletins.push(p); return [{ Id: 1 }]; }
    if (/INSERT INTO paie\.LigneBulletin/.test(sql)) { inserted.lignes.push(p); return []; }
    throw new Error('Requête inattendue : ' + sql.slice(0, 80));
  };
  const db = { query: async () => [{ n: 0 }], tx: async (fn) => fn(run) };
  await repo.calculerPeriode(db, 1, null);

  const b = inserted.bulletins[0];
  assert.equal(b.brut, 894500);
  assert.equal(b.ts, 57536);         // IPRES 24 192 + IPRES cadre 20 844 + IPM 12 500
  assert.equal(b.ir, 180446);
  assert.equal(b.trimf, 3000);
  assert.equal(b.ar, 30000);
  assert.equal(b.net, 623518);
  assert.equal(b.tp, 113649);
  const pat = (l) => inserted.lignes.find((x) => x.l === l).pat;
  assert.equal(pat('CFCE_PAT'), 26055);          // 3 % de 868 500 (brut 894 500 − transport 26 000)
  assert.equal(pat('IPRES_RCC_PAT'), 31266);
  assert.equal(pat('IPM_PAT'), 15000);
});
